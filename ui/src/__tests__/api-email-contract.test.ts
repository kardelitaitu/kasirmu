// ── IPC contract tests for email.ts ─────────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  sendTestReport,
  getReportSchedule,
  getReportScheduleScoped,
  saveReportSchedule,
  type ReportScheduleConfig,
} from '@/api/email';

const SCHEDULE: ReportScheduleConfig = {
  enabled: true,
  cadence: 'weekly',
  report_types: ['revenue', 'shifts'],
  recipients: ['owner@example.com'],
  send_at_time: '08:00',
  timezone: 'Asia/Jakarta',
  lookback_days: 7,
};

describe('email.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('sendTestReport → send_test_report with sessionToken', async () => {
    mockInvoke.mockResolvedValue('test report queued');
    const result = await sendTestReport('tok_email');
    expect(mockInvoke).toHaveBeenCalledWith('send_test_report', { sessionToken: 'tok_email' });
    expect(result).toBe('test report queued');
  });

  it('getReportSchedule → get_report_schedule (no args) and passes the config through', async () => {
    mockInvoke.mockResolvedValue(SCHEDULE);
    const result = await getReportSchedule();
    expect(mockInvoke).toHaveBeenCalledWith('get_report_schedule', undefined);
    expect(result).toEqual(SCHEDULE);
  });

  it('getReportScheduleScoped → get_report_schedule_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue(SCHEDULE);
    const result = await getReportScheduleScoped('tok_email_scoped');
    expect(mockInvoke).toHaveBeenCalledWith('get_report_schedule_scoped', {
      sessionToken: 'tok_email_scoped',
    });
    expect(result).toEqual(SCHEDULE);
  });

  it('getReportScheduleScoped forwards the token verbatim (ADR #7 permission gate)', async () => {
    mockInvoke.mockResolvedValue(SCHEDULE);
    await getReportScheduleScoped('');
    expect(mockInvoke).toHaveBeenCalledWith('get_report_schedule_scoped', { sessionToken: '' });
  });

  it('saveReportSchedule → save_report_schedule with sessionToken + config', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await saveReportSchedule('tok_email', SCHEDULE);
    expect(mockInvoke).toHaveBeenCalledWith('save_report_schedule', {
      sessionToken: 'tok_email',
      config: SCHEDULE,
    });
  });

  it('saveReportSchedule sends the full config shape (no field dropped)', async () => {
    const disabled: ReportScheduleConfig = {
      enabled: false,
      cadence: 'daily',
      report_types: [],
      recipients: [],
      send_at_time: '23:30',
      timezone: 'UTC',
      lookback_days: 1,
    };
    mockInvoke.mockResolvedValue(undefined);
    await saveReportSchedule('tok_email', disabled);
    const call = mockInvoke.mock.calls[0];
    expect(call?.[1]).toEqual({ sessionToken: 'tok_email', config: disabled });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('SMTP not configured'));
    await expect(sendTestReport('tok_email')).rejects.toThrow('SMTP not configured');
  });

  it('propagates permission errors from the scoped read', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('missing permission: reports.schedule'));
    await expect(getReportScheduleScoped('tok_email')).rejects.toThrow(
      'missing permission: reports.schedule',
    );
  });
});
