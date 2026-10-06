import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecordCrashReport } = vi.hoisted(() => ({
  mockRecordCrashReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/system', () => ({
  recordCrashReport: mockRecordCrashReport,
}));

vi.mock('@/utils/shellKind', () => ({
  getShellKind: () => 'desktop',
}));

vi.mock('@/build-id', () => ({
  buildId: () => '0.0.41',
}));

import {
  sanitizeClientCrashText,
  reportClientCrash,
  installCrashReporter,
  resetCrashReporterForTesting,
} from '@/utils/crashReporter';

describe('crashReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCrashReporterForTesting();
  });

  describe('sanitizeClientCrashText', () => {
    it('redacts Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test and Bearer sec123';
      const output = sanitizeClientCrashText(input);
      expect(output).toBe('Authorization: Bearer [REDACTED] and Bearer [REDACTED]');
      expect(output).not.toContain('eyJhbGciOiJIUzI1NiJ9.test');
      expect(output).not.toContain('sec123');
    });

    it('redacts JSON PIN fields', () => {
      const input = 'Received error with {"pin": "1234", "owner_pin": "5678"}';
      const output = sanitizeClientCrashText(input);
      expect(output).toBe('Received error with {"pin": "[REDACTED]", "owner_pin": "[REDACTED]"}');
      expect(output).not.toContain('1234');
      expect(output).not.toContain('5678');
    });

    it('redacts JSON password and session token fields', () => {
      const input = 'Crash data: {"password": "mypassword1", "session_token": "tok_abc999"}';
      const output = sanitizeClientCrashText(input);
      expect(output).toBe('Crash data: {"password": "[REDACTED]", "session_token": "[REDACTED]"}');
      expect(output).not.toContain('mypassword1');
      expect(output).not.toContain('tok_abc999');
    });
  });

  describe('reportClientCrash', () => {
    it('sends sanitized crash report payload with shell and app version defaults', () => {
      reportClientCrash({
        kind: 'window_error',
        message: 'Uncaught TypeError at http://localhost/app with Bearer secret_tok',
        stack: 'Error with {"password": "secret"}',
        componentStack: 'at Component with {"pin": "4321"}',
        location: 'App.tsx:10:5',
      });

      expect(mockRecordCrashReport).toHaveBeenCalledTimes(1);
      const call = mockRecordCrashReport.mock.calls[0]![0];
      expect(call.kind).toBe('window_error');
      expect(call.message).toBe('Uncaught TypeError at http://localhost/app with Bearer [REDACTED]');
      expect(call.stack).toBe('Error with {"password": "[REDACTED]"}');
      expect(call.componentStack).toBe('at Component with {"pin": "[REDACTED]"}');
      expect(call.appVersion).toBe('0.0.41');
      expect(call.shell).toBe('desktop');
      expect(call.location).toBe('App.tsx:10:5');
      expect(call.timestamp).toBeDefined();
    });

    it('deduplicates identical crash reports to avoid spamming', () => {
      reportClientCrash({
        kind: 'unhandled_rejection',
        message: 'Network request failed',
      });
      reportClientCrash({
        kind: 'unhandled_rejection',
        message: 'Network request failed',
      });

      expect(mockRecordCrashReport).toHaveBeenCalledTimes(1);
    });
  });

  describe('installCrashReporter', () => {
    it('registers window error and unhandledrejection handlers', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      installCrashReporter();

      expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });
  });
});
