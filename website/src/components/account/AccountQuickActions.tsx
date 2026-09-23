import { t, type Labels } from '../../i18n/labels';

/**
 * Quick-action navigation grid — download, activation guide, and support
 * links. Pure presentational.
 */
interface Props {
  locale: string;
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
}

export default function AccountQuickActions({ locale, labels }: Props) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.quickActions')}>
      <h2 className="text-lg font-semibold">{t(labels, 'account.quickActions')}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href={`/${locale}/pair`}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-ink/10 bg-surface p-4 text-center transition hover:border-accent hover:shadow-sm"
        >
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span className="text-sm font-semibold text-ink">{t(labels, 'account.registerTerminal')}</span>
        </a>
        <a
          href={`/${locale}/download`}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-ink/10 bg-surface p-4 text-center transition hover:border-accent hover:shadow-sm"
        >
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="text-sm font-semibold text-ink">{t(labels, 'account.downloadApp')}</span>
        </a>
        <a
          href={`/${locale}/docs/activation`}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-ink/10 bg-surface p-4 text-center transition hover:border-accent hover:shadow-sm"
        >
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-sm font-semibold text-ink">{t(labels, 'account.activationGuide')}</span>
        </a>
        <a
          href={`/${locale}/support`}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-ink/10 bg-surface p-4 text-center transition hover:border-accent hover:shadow-sm"
        >
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span className="text-sm font-semibold text-ink">{t(labels, 'account.contactSupport')}</span>
        </a>
      </div>
    </section>
  );
}
