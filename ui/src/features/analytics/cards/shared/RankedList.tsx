//! Compact ranked list with proportional bars — no chart lib needed.

import { useLocalization } from '@fluent/react';
import type { RankRow } from '../../analytics-data';

export function RankedList({ rows, ariaLabel, limit }: { rows: RankRow[]; ariaLabel: string; limit?: number | undefined }) {
  const { l10n } = useLocalization();
  const shown = limit !== undefined ? rows.slice(0, limit) : rows;
  const max = Math.max(...shown.map((r) => r.value), 1);
  return (
    <ul className="analytics-rank-list" aria-label={ariaLabel}>
      {shown.map((r, i) => (
        <li
          key={`${r.name}-${i}`}
          className="analytics-rank-row"
          aria-label={r.delta !== undefined
            ? l10n.getString('analytics-rank-delta-aria', {
                name: r.name,
                value: r.display,
                dir: l10n.getString(r.delta >= 0 ? 'analytics-rank-up' : 'analytics-rank-down'),
                pct: Math.abs(r.delta).toFixed(1),
              })
            : undefined}
        >
          <span className="analytics-rank-index">{i + 1}</span>
          <span className="analytics-rank-name">{r.name}</span>
          <span className="analytics-rank-bar-track">
            <span className="analytics-rank-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          {r.delta !== undefined && (
            <span
              className={`analytics-rank-delta${r.delta >= 0 ? ' analytics-rank-delta--up' : ' analytics-rank-delta--down'}`}
              aria-hidden="true"
            >
              {r.delta >= 0 ? '▲' : '▼'} {Math.abs(r.delta).toFixed(1)}%
            </span>
          )}
          <span className="analytics-rank-value">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}
