import { t } from '../../i18n';

/**
 * Billing & tax invoices section — a hint plus a mailto link to the sales
 * address with the tenant email URL-encoded in the subject. Presentational.
 */
interface Props {
  locale: string;
  tenantEmail: string;
}

export default function AccountBilling({ locale, tenantEmail }: Props) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(locale, 'account.billingInvoices')}>
      <h2 className="text-lg font-semibold">{t(locale, 'account.billingInvoices')}</h2>
      <p className="mt-1 text-sm text-muted">{t(locale, 'account.billingInvoicesHint')}</p>
      <div className="mt-4 rounded-lg border border-ink/10 bg-surface p-4 space-y-2">
        <p className="text-xs text-muted leading-relaxed">{t(locale, 'account.invoiceNote')}</p>
        <div className="pt-2 flex items-center gap-3">
          <a
            href={`mailto:sales@kasir.mu?subject=${encodeURIComponent(t(locale, 'account.invoiceSubject').replace('{email}', tenantEmail))}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            {t(locale, 'account.viewReceipts')}
          </a>
        </div>
      </div>
    </section>
  );
}
