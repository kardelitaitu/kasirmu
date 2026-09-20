// ── StepAccount in-flight copy (ADR #54 §2.6-§2.7) ──────────────────
//
// The defect this file exists to catch: the tablet's emailed-code path rendered the Google
// string `setup-account-waiting` ("Waiting for your browser…") while it was SENDING AN
// EMAIL, and rendered nothing at all while it was verifying. Both are copy defects on the
// only account route Android can take — a browser string on a tablet opens no browser, and
// a silent gap between clicking Verify and the result reads as a dead button.
//
// Three in-flight states, three pinned strings: sending and verifying on the tablet, and
// the Google path's browser wording, which stays where a browser really does open.
//
// The two tablet cases hold the IPC promise open, because the state under test IS the
// pending one; a resolved mock would step past it before the assertion ran.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import StepAccount from '@/features/setup/components/StepAccount';
import { setShellKind } from '@/utils/shellKind';
import settingsFtl from '@/locales/settings.ftl?raw';

// ── The three IPC doors this step calls ─────────────────────────────

const mockRequest = vi.fn();
const mockConsume = vi.fn();
const mockGoogle = vi.fn();

vi.mock('@/api/license', () => ({
  requestDeviceLinkCode: (email: string) => mockRequest(email),
  consumeDeviceLinkCode: (code: string) => mockConsume(code),
  linkDeviceGoogle: () => mockGoogle(),
}));

/** A promise that never settles — the in-flight state is the one being pinned. */
const pending = () => new Promise(() => {});

/** Render the step with the strings a merchant actually reads. */
const render = () => renderWithFluentSync(<StepAccount />, settingsFtl);

/** Fill the address so the send button is enabled, then press it. */
function sendCodeTo(email: string) {
  fireEvent.change(screen.getByLabelText('Account email'), { target: { value: email } });
  fireEvent.click(screen.getByText('Email me a code'));
}

describe('StepAccount — in-flight copy', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockConsume.mockReset();
    mockGoogle.mockReset();
  });

  afterEach(() => setShellKind('desktop'));

  it('tells the tablet it is sending a code, not waiting for a browser', () => {
    setShellKind('tablet');
    mockRequest.mockReturnValue(pending());
    render();

    sendCodeTo('owner@example.com');

    expect(screen.getByText('Sending the code…')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for your browser…')).toBeNull();
  });

  it('tells the tablet it is checking the code once Verify is pressed', async () => {
    setShellKind('tablet');
    mockRequest.mockResolvedValue(undefined);
    mockConsume.mockReturnValue(pending());
    render();

    sendCodeTo('owner@example.com');
    fireEvent.change(await screen.findByLabelText('6-digit code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('Verify'));

    expect(screen.getByText('Checking the code…')).toBeInTheDocument();
  });

  it('keeps the browser wording on the Google control, which does open one', () => {
    setShellKind('desktop');
    mockGoogle.mockReturnValue(pending());
    render();

    fireEvent.click(screen.getByText('Continue with Google'));

    expect(screen.getByText('Waiting for your browser…')).toBeInTheDocument();
    expect(screen.queryByText('Sending the code…')).toBeNull();
  });
});
