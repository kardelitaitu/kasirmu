import { t, type Labels } from '../i18n/labels';
import {
  passwordByteLength,
  passwordClassCount,
  passwordMaxBytes,
  passwordMinClasses,
  passwordMinLen,
  passwordRuneCount,
} from '../lib/passwordPolicy';

/**
 * Password strength meter — the policy itself lives in
 * ../lib/passwordPolicy.ts (the single client-side source of truth,
 * mirrored from the server's web_password.go and pinned to the shared
 * scripts/password-policy-cases.json fixture by both test suites). This
 * component only renders it.
 *
 * The meter shows 4 segments — one per class — lit in the strength color;
 * the label reads Too short / Weak / Fair / Good / Strong. isStrong is
 * the exact server gate, so the submit button can be disabled on the same
 * rule the server enforces.
 */

/**
 * Keys this meter reads. Owned here because this is the component that reads
 * them; every island that renders a password field spreads this list into its
 * own alongside `PASSWORD_FIELD_LABELS`.
 */
export const PASSWORD_STRENGTH_LABELS = [
  'password.hint',
  'password.meterLabel',
  'password.minLength',
  'password.strengthGood',
  'password.strengthStrong',
  'password.strengthTooShort',
  'password.strengthWeak',
] as const;

interface Props {
  /** Strings this meter reads; the owning island passes its own map. */
  labels: Labels;
  password: string;
}

export default function PasswordStrength({ labels, password }: Props) {
  const classes = passwordClassCount(password);
  const minLenOk =
    passwordByteLength(password) >= passwordMinLen &&
    passwordByteLength(password) <= passwordMaxBytes &&
    passwordRuneCount(password) >= passwordMinLen;

  let labelKey: string;
  let color = 'var(--callout-danger)';
  if (minLenOk) {
    if (classes < passwordMinClasses) {
      labelKey = t(labels, 'password.strengthWeak');
    } else if (classes === passwordMinClasses) {
      labelKey = t(labels, 'password.strengthGood');
      color = 'var(--callout-tip)';
    } else {
      labelKey = t(labels, 'password.strengthStrong');
      color = 'var(--color-accent)';
    }
  } else {
    labelKey = t(labels, 'password.strengthTooShort');
  }

  return (
    <div className="space-y-1.5">
      <div
        className="grid grid-cols-4 gap-1"
        role="meter"
        aria-label={t(labels, 'password.meterLabel')}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={classes}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-colors"
            style={{
              backgroundColor: i < classes ? color : 'color-mix(in srgb, var(--color-ink) 12%, transparent)',
            }}
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        {labelKey}
        {!minLenOk && <span> — {t(labels, 'password.minLength')}</span>}
      </p>
      <p className="text-xs text-muted">{t(labels, 'password.hint')}</p>
    </div>
  );
}
