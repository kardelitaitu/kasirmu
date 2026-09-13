//! Period-over-period delta pill. The `tone` prop flips the colour
//! semantics for metrics where "up" is bad (voids, refunds, restock cost,
//! turn time).

import { useLocalization } from '@fluent/react';

export function DeltaChip({ value, tone, compare }: { value: number; tone?: 'good' | 'bad'; compare?: boolean }) {
  const { l10n } = useLocalization();
  const up = value >= 0;
  // For metrics where up is bad (voids, refunds, restock cost, turn time)
  // the pill's colour follows the *semantic* direction, not the sign.
  const good = tone === 'bad' ? !up : up;
  return (
    <span className={`analytics-delta${good ? ' analytics-delta--up' : ' analytics-delta--down'}`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%{compare ? ` ${l10n.getString('analytics-card-vs-prev')}` : ''}
    </span>
  );
}
