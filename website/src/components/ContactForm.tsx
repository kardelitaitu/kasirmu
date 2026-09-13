import { useState } from 'react';
import { t } from '../i18n';

/**
 * Support contact form. Posts { name, email, message } as JSON to
 * PUBLIC_CONTACT_ENDPOINT — the license server's future /api/v1/web/contact
 * route, which will forward the message to the Discord channel. The webhook
 * URL must never be exposed to the browser, so the site only ever talks to
 * the endpoint.
 *
 * When the endpoint is unset the form degrades to a mailto: link with the
 * entered fields pre-filled, so the UI stays fully usable.
 */
const API = '/api/contact';
const SUPPORT_EMAIL = 'support@ozpos.my.id';

interface Props {
  locale: string;
}

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function ContactForm({ locale }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — bots fill it, humans never see it
  const [status, setStatus] = useState<Status>('idle');

  const inputClass =
    'w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-accent';
  const labelClass = 'mb-1 block text-sm text-muted';

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    // Honeypot filled → pretend success without sending.
    if (website.trim()) {
      setStatus('success');
      return;
    }
    setStatus('sending');



    try {
      const res = await fetch(API, {
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
        <p className="text-sm text-ink">{t(locale, 'support.success')}</p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-4 rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink/5"
        >
          {t(locale, 'support.sendAnother')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-ink/10 bg-surface/40 p-6" aria-label={t(locale, 'support.submit')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t(locale, 'support.name')}</span>
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(locale, 'support.namePlaceholder')}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t(locale, 'login.email')}</span>
          <input
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t(locale, 'login.emailPlaceholder')}
            className={inputClass}
          />
        </label>
      </div>
      <label className="mt-4 block">
        <span className={labelClass}>{t(locale, 'support.message')}</span>
        <textarea
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(locale, 'support.messagePlaceholder')}
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
          <p>{t(locale, 'support.formError')}</p>
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
        type="submit"
        disabled={status === 'sending'}
        className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60 sm:w-auto"
      >
        {status === 'sending' ? t(locale, 'support.sending') : t(locale, 'support.submit')}
      </button>
    </form>
  );
}
