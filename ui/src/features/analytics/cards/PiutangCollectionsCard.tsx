//! Receivable collections card — decision Q1's collection-day line.
//!
//! A receivable repayment is money arriving against goods sold EARLIER. The
//! `payments` card reports what was SOLD in the period and therefore excludes
//! `pay_later` (a promise, not money); this card reports what was COLLECTED.
//! A day whose only takings were repayments is invisible to the former and
//! fully visible here, which is exactly the drawer mismatch Q1 was written to
//! prevent. They stay separate cards rather than one merged list for that
//! reason — merging loses the ability to read either number on its own.

import { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import { type AnalyticsQuery, type PiutangCollectionRow } from '../analytics-data';
import { exportPiutangCollectionsCsv } from '../utils/analyticsCardCsv';
import { PAYMENT_NAMES } from './shared/constants';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function PiutangCollectionsCard({ q, title, compare }: {
  q: AnalyticsQuery;
  title: string;
  expanded?: boolean | undefined;
  compare?: boolean | undefined;
}) {
  const { l10n } = useLocalization();
  const { fmtIn } = useMoney();
  const { data: rows, error } = useCardDataCompare<PiutangCollectionRow[]>(
    'piutang-collections',
    q,
    compare ?? false,
  );
  // REP-06: rows are per tender AND currency, so a total is only meaningful
  // within one currency. The card reads the DOMINANT currency and says so rather
  // than summing minor units across currencies into a number that is not money.
  const { currency, total, byTender } = useMemo(() => {
    if (!rows || rows.length === 0) {
      return { currency: '', total: 0, byTender: [] as { name: string; amount: number; count: number }[] };
    }
    const perCurrency = new Map<string, number>();
    for (const r of rows) perCurrency.set(r.currency, (perCurrency.get(r.currency) ?? 0) + r.total_minor);
    let top = '';
    let topSum = -1;
    for (const [code, sum] of perCurrency) {
      if (sum > topSum) {
        top = code;
        topSum = sum;
      }
    }
    const scoped = rows.filter((r) => r.currency === top);
    return {
      currency: top,
      total: topSum,
      byTender: scoped.map((r) => ({
        name: PAYMENT_NAMES[r.payment_method]
          ? l10n.getString(PAYMENT_NAMES[r.payment_method]!)
          : r.payment_method,
        amount: r.total_minor,
        count: r.payment_count,
      })),
    };
  }, [rows, l10n]);
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  if (rows.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={fmtIn(total, currency)} label={l10n.getString('analytics-card-piutang-total')} />
        <div className="analytics-kpi-actions">
          <ExportCsvButton
            ariaLabel={l10n.getString('analytics-export-piutang-aria')}
            onClick={() =>
              exportPiutangCollectionsCsv(rows, q.from, q.to, fmtIn, (id) => l10n.getString(id))
            }
          />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ul className="analytics-piutang-tenders">
          {byTender.map((t) => (
            <li key={t.name} className="analytics-piutang-tender">
              <span className="analytics-piutang-tender-name">{t.name}</span>
              <span className="analytics-piutang-tender-amount">{fmtIn(t.amount, currency)}</span>
              <span className="analytics-piutang-tender-count">
                {l10n.getString('analytics-card-piutang-count', { count: t.count })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Visual>
  );
}
