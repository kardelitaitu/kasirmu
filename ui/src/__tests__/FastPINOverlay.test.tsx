import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FastPINOverlay from "@/components/FastPINOverlay";

// ── Mock staff login API ────────────────────────────────────────────

const mockStaffLogin = vi.fn();
vi.mock("@/api/staff", () => ({
  staffLogin: (...args: unknown[]) => mockStaffLogin(...args),
}));

// ── Mock AuthContext ─────────────────────────────────────────────────

const mockSwapSession = vi.fn();
const mockAuthValue = {
  session: {
    user_id: "user-current",
    display_name: "Alice",
    role_name: "cashier",
    role_id: "role-cashier",
  },
  loading: false,
  error: null,
  login: vi.fn(),
  logout: vi.fn(),
  clearError: vi.fn(),
  isManager: false,
  isOwner: false,
  swapSession: mockSwapSession,
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ── Mock WorkspaceContext ────────────────────────────────────────────

const mockSwapSessionToken = vi.fn();
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    swapSessionToken: mockSwapSessionToken,
    activeWorkspace: "store-pos",
    activeInstance: null,
    sessionToken: "token-abc",
    setActiveWorkspace: vi.fn(),
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: "default",
  }),
  useWorkspaceScope: () => ({
    storeId: "default",
    instanceId: "default-store-pos",
    typeKey: "store-pos",
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ── Mock @fluent/react ──────────────────────────────────────────────

vi.mock("@fluent/react", () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => id,
    },
  }),
  Localized: ({
    children,
  }: {
    id: string;
    children: React.ReactNode;
    attrs?: Record<string, boolean>;
    vars?: Record<string, string>;
  }) => <>{children}</>,
}));

// ── Helpers ─────────────────────────────────────────────────────────

function renderOverlay(open = true, onClose = vi.fn()) {
  return render(<FastPINOverlay open={open} onClose={onClose} />);
}

function typeUsername(name: string) {
  fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: name } });
}

function clickDigit(digit: string) {
  fireEvent.click(screen.getByLabelText(digit));
}

function clickButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe("FastPINOverlay", () => {
  describe("rendering", () => {
    it("renders nothing when closed", () => {
      const { container } = renderOverlay(false);
      expect(container.innerHTML).toBe("");
    });

    it("renders the overlay when open", () => {
      renderOverlay(true);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows username step by default", () => {
      renderOverlay(true);
      expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
    });

    it("shows close button", () => {
      renderOverlay(true);
      const closeBtn = screen.getByLabelText("modal-close-aria");
      expect(closeBtn).toBeInTheDocument();
    });

    it("shows cancel button in footer", () => {
      renderOverlay(true);
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("focuses the username input on open", async () => {
      renderOverlay(true);
      // Small delay for the setTimeout in the component
      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Username")).toHaveFocus();
        },
        { timeout: 100 },
      );
    });
  });

  describe("username step", () => {
    it("advances to PIN step when username is entered and submitted", async () => {
      renderOverlay(true);
      typeUsername("cashier1");
      clickButton("Next");

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText("Username"),
        ).not.toBeInTheDocument();
      });
    });

    it("does not advance with empty username", () => {
      renderOverlay(true);
      const nextBtn = screen.getByText("Next");
      expect(nextBtn).toBeDisabled();
    });

    it("closes when overlay backdrop is clicked", async () => {
      const onClose = vi.fn();
      renderOverlay(true, onClose);
      // Click the backdrop (outer overlay div, no longer role="presentation")
      const overlay = document.querySelector(".fastpin-overlay")!;
      fireEvent.click(overlay);
      // Component uses 200ms exit animation before calling onClose
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("closes when close button is clicked", async () => {
      const onClose = vi.fn();
      renderOverlay(true, onClose);
      fireEvent.click(screen.getByLabelText("modal-close-aria"));
      // Component uses 200ms exit animation before calling onClose
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("PIN step", () => {
    async function advanceToPinStep() {
      renderOverlay(true);
      typeUsername("cashier1");
      clickButton("Next");
    }

    it("shows PIN dots and keypad", async () => {
      await advanceToPinStep();
      const dots = document.querySelectorAll(".fastpin-pin-dot");
      expect(dots.length).toBe(4);
      const keys = document.querySelectorAll(".fastpin-pad-key");
      expect(keys.length).toBeGreaterThanOrEqual(10);
    });

    it("fills PIN dots as digits are entered", async () => {
      await advanceToPinStep();
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");

      const filled = document.querySelectorAll(".fastpin-pin-dot--filled");
      expect(filled.length).toBe(3);
    });

    it("clears PIN when clear button is pressed", async () => {
      await advanceToPinStep();
      clickDigit("1");
      clickDigit("2");

      clickButton("Clear");

      const filled = document.querySelectorAll(".fastpin-pin-dot--filled");
      expect(filled.length).toBe(0);
    });

    it("backspace removes last digit", async () => {
      await advanceToPinStep();
      clickDigit("1");
      clickDigit("2");
      clickButton("Backspace");

      const filled = document.querySelectorAll(".fastpin-pin-dot--filled");
      expect(filled.length).toBe(1);
    });

    it("goes back to username step when Back is clicked", async () => {
      await advanceToPinStep();
      clickButton("← Back");

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
      });
    });
  });

  describe("verification", () => {
    beforeEach(() => {
      mockStaffLogin.mockReset();
      mockSwapSession.mockReset();
      mockSwapSessionToken.mockReset();
    });

    it("calls staffLogin then swapSession then swapSessionToken on success", async () => {
      const onClose = vi.fn();
      mockStaffLogin.mockResolvedValue({
        session: {
          user_id: "user-new",
          display_name: "Bob",
          role_name: "manager",
          role_id: "role-manager",
        },
        picker_ticket: "ticket-new",
      });
      mockSwapSessionToken.mockResolvedValue(undefined);

      render(<FastPINOverlay open={true} onClose={onClose} />);

      // Enter username
      typeUsername("bob");
      clickButton("Next");

      // Enter PIN
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");

      await waitFor(() => {
        expect(mockStaffLogin).toHaveBeenCalledWith({
          username: "bob",
          pin: "1234",
        });
      });

      await waitFor(() => {
        expect(mockSwapSession).toHaveBeenCalledWith(
          {
            user_id: "user-new",
            display_name: "Bob",
            role_name: "manager",
            role_id: "role-manager",
          },
          "ticket-new",
        );
      });

      await waitFor(() => {
        expect(mockSwapSessionToken).toHaveBeenCalledWith(
          "user-new",
          "role-manager",
        );
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("shows error on failed verification", async () => {
      mockStaffLogin.mockRejectedValue(new Error("Invalid PIN"));

      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      // Enter username
      typeUsername("bob");
      clickButton("Next");

      // Enter enough PIN digits to trigger auto-submit
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");
      clickDigit("5");
      clickDigit("6");

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText('PIN verification failed')).toBeInTheDocument();
      });

      // Should not have called swap
      expect(mockSwapSession).not.toHaveBeenCalled();
    });

    it("fires onVerified callback on success", async () => {
      const onVerified = vi.fn();
      mockStaffLogin.mockResolvedValue({
        session: {
          user_id: "user-new",
          display_name: "Bob",
          role_name: "manager",
          role_id: "role-manager",
        },
      });
      mockSwapSessionToken.mockResolvedValue(undefined);

      render(
        <FastPINOverlay open={true} onClose={vi.fn()} onVerified={onVerified} />,
      );

      typeUsername("bob");
      clickButton("Next");

      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");

      await waitFor(() => {
        expect(onVerified).toHaveBeenCalled();
      });

      // onVerified fires _before_ onClose
      await waitFor(() => {
        expect(onVerified).toHaveBeenCalledOnce();
      });
    });

    it("disables all interactive elements while loading", async () => {
      mockStaffLogin.mockImplementation(
        () => new Promise(() => {}), // never resolves — keeps loading=true
      );

      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      typeUsername("bob");
      clickButton("Next");

      // Enter PIN to trigger auto-submit
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");

      await waitFor(() => {
        // Close button should be disabled
        expect(screen.getByLabelText("modal-close-aria")).toBeDisabled();
      });

      // All PIN pad keys should be disabled
      const padKeys = document.querySelectorAll(".fastpin-pad-key");
      padKeys.forEach((key) => {
        expect(key).toBeDisabled();
      });

      // Cancel button should be disabled
      expect(screen.getByText("Cancel")).toBeDisabled();

      // Spinner should be visible
      expect(document.querySelector(".fastpin-btn-spinner")).toBeInTheDocument();
    });

    it("submits PIN when Enter is pressed in PIN step", async () => {
      mockStaffLogin.mockResolvedValue({
        session: {
          user_id: "user-new",
          display_name: "Bob",
          role_name: "manager",
          role_id: "role-manager",
        },
      });
      mockSwapSessionToken.mockResolvedValue(undefined);

      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      typeUsername("bob");
      clickButton("Next");

      // Enter full 4-digit PIN
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");

      // Press Enter on the dialog
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

      await waitFor(() => {
        expect(mockStaffLogin).toHaveBeenCalled();
      });
    });

    it("clears PIN dots on error", async () => {
      mockStaffLogin.mockRejectedValue(new Error("Invalid PIN"));

      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      typeUsername("bob");
      clickButton("Next");

      // Enter full PIN — auto-submit triggers
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");
      clickDigit("4");

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      // PIN dots should be cleared after error
      const filled = document.querySelectorAll(".fastpin-pin-dot--filled");
      expect(filled.length).toBe(0);
    });

    it("does not auto-submit with fewer than max PIN digits", async () => {
      vi.useFakeTimers();
      render(<FastPINOverlay open={true} onClose={vi.fn()} />);

      typeUsername("bob");
      clickButton("Next");

      clickDigit("1");
      clickDigit("2");

      // Advance timers by 100ms — should NOT have called staffLogin
      vi.advanceTimersByTime(100);
      expect(mockStaffLogin).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("reset on open", () => {
    it("resets state when reopened", async () => {
      const { rerender } = render(
        <FastPINOverlay open={true} onClose={vi.fn()} />,
      );

      // Enter username and advance to PIN
      typeUsername("bob");
      clickButton("Next");

      // Enter some digits
      clickDigit("1");
      clickDigit("2");
      const filled = document.querySelectorAll(".fastpin-pin-dot--filled");
      expect(filled.length).toBe(2);

      // Close
      rerender(<FastPINOverlay open={false} onClose={vi.fn()} />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Reopen
      rerender(<FastPINOverlay open={true} onClose={vi.fn()} />);

      // Should be back at username step with empty state
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
      });
    });
  });

  // ── S1: PIN minimum length enforcement ────────────────────────────

  describe("PIN minimum length (S1)", () => {
    it("does not call staffLogin with fewer than 4 digits", async () => {
      renderOverlay(true);
      typeUsername("cashier1");
      clickButton("Next");

      await waitFor(() => {
        expect(screen.queryByPlaceholderText("Username")).not.toBeInTheDocument();
      });

      // Enter only 3 digits.
      clickDigit("1");
      clickDigit("2");
      clickDigit("3");

      // staffLogin must NOT have been called.
      expect(mockStaffLogin).not.toHaveBeenCalled();

      // Enter the 4th digit — NOW staffLogin should be called.
      clickDigit("4");
      await waitFor(() => {
        expect(mockStaffLogin).toHaveBeenCalled();
      });
    });

    it("Enter key does not trigger verify with fewer than 4 digits", async () => {
      renderOverlay(true);
      typeUsername("cashier1");
      clickButton("Next");

      await waitFor(() => {
        expect(screen.queryByPlaceholderText("Username")).not.toBeInTheDocument();
      });

      // Type 3 digits then press Enter.
      // The keyDown handler is on the document, so we fire on the pad
      // group element which is the keyboard focus target.
      const pad = document.querySelector(".fastpin-pad");
      expect(pad).toBeTruthy();
      fireEvent.keyDown(pad!, { key: "1" });
      fireEvent.keyDown(pad!, { key: "2" });
      fireEvent.keyDown(pad!, { key: "3" });
      fireEvent.keyDown(pad!, { key: "Enter" });

      // staffLogin must NOT have been called.
      expect(mockStaffLogin).not.toHaveBeenCalled();
    });
  });
});

// ── CSS integrity: the keypad is ring-free by decision, the rest is not ──────
//
// Companion guard to StaffLoginScreen.test.tsx and SessionLockScreen.test.tsx,
// added when `.fastpin-pad-key:focus-visible` dropped its 2px ring. Here the
// boundary matters more than the suppression: this overlay mixes a text input and
// four real buttons with the keypad, so a `outline: none` widened past the keys
// would silently take the cue off controls that have no PIN-dot display to fall
// back on. JSDOM (css:false) cannot reflect any of this, hence the source read.

describe("FastPINOverlay CSS integrity", () => {
  const css = readFileSync(
    resolve(__dirname, "..", "components", "FastPINOverlay.css"),
    "utf8",
  );
  const tsx = readFileSync(
    resolve(__dirname, "..", "components", "FastPINOverlay.tsx"),
    "utf8",
  );

  function ruleBody(selector: string): string {
    const pattern = new RegExp(
      selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
    );
    const match = css.match(pattern);
    expect(match, `${selector} rule must exist in FastPINOverlay.css`).not.toBeNull();
    const body = match![1]!.trim();
    expect(body, `${selector} rule body must not be empty`).not.toHaveLength(0);
    return body;
  }

  it("has no focus outline on the keypad keys", () => {
    const body = ruleBody(".fastpin-pad-key:focus-visible");
    expect(body).toContain("outline: none");
    expect(body).not.toMatch(/outline:\s*2px/);
  });

  it("keeps a visible focus outline on the four non-keypad buttons", () => {
    for (const selector of [
      ".fastpin-close-btn:focus-visible",
      ".fastpin-submit-btn:focus-visible",
      ".fastpin-back-btn:focus-visible",
      ".fastpin-cancel-btn:focus-visible",
    ]) {
      const body = ruleBody(selector);
      expect(body, `${selector} must keep its 2px outline`).toMatch(/outline:\s*2px\s+solid/);
      expect(body).not.toContain("outline: none");
    }
  });

  it("keeps a focus cue on the username text field", () => {
    // .fastpin-input suppresses `outline` in its BASE rule and paints the cue with
    // border-color + box-shadow instead, so the keypad decision must not have been
    // made by quietly dropping that substitute.
    const body = ruleBody(".fastpin-input:focus-visible");
    expect(body).toMatch(/border-color\s*:/);
    expect(body).toMatch(/box-shadow\s*:/);
  });

  it("leaves the pad container unfocusable, so it needs no container suppression", () => {
    // The two PIN screens focus their pad programmatically (tabIndex={-1}) and
    // therefore need a scoped `.x-pad:focus-visible { outline: none }`. This pad is
    // a plain role="group". If that changes, add the container rule the way
    // SessionLockScreen.css and StaffLoginScreen.css do -- otherwise the bare
    // :focus-visible ring in themes/reset.css paints a blue box around the keypad.
    const padOpenTag = tsx.match(/<div\b[^>]*className="fastpin-pad"[^>]*>/);
    expect(
      padOpenTag,
      "the .fastpin-pad opening tag must stay findable in FastPINOverlay.tsx",
    ).not.toBeNull();
    expect(padOpenTag![0]).not.toMatch(/tabIndex/);
    expect(css).not.toMatch(/\.fastpin-pad\s*\{[^}]*outline\s*:/);
  });
});
