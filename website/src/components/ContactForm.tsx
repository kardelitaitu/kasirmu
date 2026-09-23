import { useEffect, useRef, useState } from 'react';
import { t, type Labels } from '../i18n/labels';
import { contactEndpoint } from '../lib/runtime-config';
import { useContactRoute } from '../lib/use-runtime-config';

/**
 * Support contact form. Posts { name, email, message } as JSON to the
 * configured contact endpoint — the route that forwards the message to the
 * Discord channel. The webhook URL must never be exposed to the browser, so
 * the site only ever talks to that route.
 *
 * The form is only the right affordance when the deployment has a route. The
 * Worker states whether it does in `/__oz/runtime-config.js` (`contactEndpoint`
 * is null unless CONTACT_WEBHOOK_URL is set), and on a deployment without one
 * this island renders its mailto path as the primary affordance instead of a
 * form whose every submit can only 503 — the visitor learns before typing, not
 * after. Measured on the live host 2026-09-23: `/api/contact` answered 503
 * "Webhook not configured" to every submission while the page still offered the
 * form.
 *
 * Two things this must not break, both kept: a deployment that never answers
 * (a plain static host, a local preview) still gets the form, because silence
 * is not an answer — that is the `unknown` state, see [contactRouteState]; and
 * a visitor who has already engaged with the form keeps it, because replacing a
 * half-filled form (or the one focus is sitting in) throws their work away.
 * The submit-time degrade to a pre-filled mailto: link is untouched, so the
 * remaining cases — unknown, or engaged — still end somewhere useful.
 */
const SUPPORT_EMAIL = 'support@kasir.mu';

interface Props {
  /** Strings this form reads; `support.astro` builds it with `labelMap`. */
  labels: Labels;
}

/** Keys this form reads, so the page can hand it exactly those strings. */
export const SUPPORT_LABELS = [
  'login.email',
  'login.emailPlaceholder',
  'support.formError',
  'support.formUnavailable',
  'support.message',
  'support.messagePlaceholder',
  'support.name',
  'support.namePlaceholder',
  'support.sendAnother',
  'support.sending',
  'support.submit',
  'support.success',
] as const;

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function ContactForm({ labels }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — bots fill it, humans never see it
  const [status, setStatus] = useState<Status>('idle');
  // Set by focusing anything inside the form, not only by typing in it: the
  // config can land ~1s after first paint, and a form swapped out from under
  // the field a keyboard user is sitting in strands focus on <body>.
  const [touched, setTouched] = useState(false);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const successRef = useRef<HTMLParagraphElement | null>(null);
  const previousStatus = useRef<Status>('idle');
  const route = useContactRoute();
  const routeMissing = route === 'unconfigured';
  const engaged = touched || Boolean(name || email || message);

  /**
   * Focus recovery for the three states this form can end up in.
   *
   * Measured in a browser 2026-09-23 at 390px and 1440px, en and id: the submit
   * button carries `disabled={status === 'sending'}`, so the button the visitor
   * had just pressed was disabled mid-request and focus fell to <body>. On
   * success the whole form is replaced by the confirmation panel, so the button
   * that had focus ceased to exist; on failure the form stayed but focus was
   * not returned; and pressing "Send another message" removed that panel's only
   * control the same way.
   *
   * - success: the confirmation itself, which is the outcome and the only thing
   *   on screen afterwards (tabindex="-1"; it is NOT also a live region, or the
   *   sentence would be announced twice).
   * - error: the submit button, which survives and is the retry.
   * - back to the form: the first field, so the form is usable immediately.
   */
  useEffect(() => {
    const from = previousStatus.current;
    previousStatus.current = status;
    if (status === 'success') successRef.current?.focus();
    else if (status === 'error') submitRef.current?.focus();
    else if (status === 'idle' && from === 'success') nameRef.current?.focus();
  }, [status]);

  const inputClass =
    'w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink transition';
  const labelClass = 'mb-1 block text-sm text-muted';

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    // Honeypot filled → pretend success without sending.
    if (website.trim()) {
      setStatus('success');
      return;
    }
    setStatus('sending');

    const endpoint = contactEndpoint();
    if (!endpoint) {
      // No route on this deployment: skip a request that can only 404 and put
      // the mailto fallback in front of the visitor immediately.
      setStatus('error');
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          message: message.trim(),
        }),
      });
      if (!res.ok) throw new Error('contact failed');
      setName('');
      setEmail('');
      setMessage('');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface/40 p-6 text-center">
        <p ref={successRef} tabIndex={-1} className="text-sm text-ink">{t(labels, 'support.success')}</p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-4 rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink/5"
        >
          {t(labels, 'support.sendAnother')}
        </button>
      </div>
    );
  }

  // No route and no visitor to disturb yet: lead with the way to actually
  // reach us. Rendered from the config's answer, never from silence.
  if (routeMissing && !engaged) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface/40 p-6 text-center">
        <p className="text-sm text-muted">{t(labels, 'support.formUnavailable')}</p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      onFocus={() => setTouched(true)}
      className="rounded-xl border border-ink/10 bg-surface/40 p-6"
      aria-label={t(labels, 'support.submit')}
    >
      {/* The form stayed because the visitor is already using it, so the same
          warning belongs above it — role=status announces the arrival, and it
          is never the focus target, so nothing is read twice. */}
      {routeMissing && (
        <p className="mb-4 text-sm text-muted" role="status">
          {t(labels, 'support.formUnavailable')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t(labels, 'support.name')}</span>
          <input
            ref={nameRef}
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(labels, 'support.namePlaceholder')}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t(labels, 'login.email')}</span>
          <input
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t(labels, 'login.emailPlaceholder')}
            className={inputClass}
          />
        </label>
      </div>
      <label className="mt-4 block">
        <span className={labelClass}>{t(labels, 'support.message')}</span>
        <textarea
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(labels, 'support.messagePlaceholder')}
          className={`${inputClass} resize-y`}
        />
      </label>
      {/* Honeypot — visually hidden, bots fill it, humans can't tab to it. */}
      <label className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <span className={labelClass}>Website</span>
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </label>
      {status === 'error' && (
        <div className="mt-3 text-sm text-link" role="alert">
          <p>{t(labels, 'support.formError')}</p>
          <p className="mt-1 text-xs text-muted">
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Support: ${name || 'Inquiry'}`)}&body=${encodeURIComponent(message)}`}
              className="text-link underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      )}
      <button
        ref={submitRef}
        type="submit"
        disabled={status === 'sending'}
        className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60 sm:w-auto"
      >
        {status === 'sending' ? t(labels, 'support.sending') : t(labels, 'support.submit')}
      </button>
    </form>
  );
}
