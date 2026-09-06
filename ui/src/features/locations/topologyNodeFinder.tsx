//! Node finder (Ctrl+F) quick-jump overlay for the topology editor.
//!
//! A combobox-pattern overlay (filter input + option list) that lets the user
//! type to filter nodes by name/subtitle and Enter to jump the viewport to the
//! highlighted match. The open state stays owned by the editor (its central
//! keydown handler opens it on Ctrl+F and closes it on a canvas-focus Escape);
//! this component owns the query, the highlighted index, the match list, the
//! input's own keydown (Esc closes, arrows move, Enter jumps), and its focus.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import type { TopologyNodeData } from './NodeTopologyEditor';

export interface TopologyNodeFinderProps {
  /** Whether the overlay is visible (owned by the editor's Ctrl+F / Escape). */
  open: boolean;
  /** Every node in the diagram — the pool the finder searches. */
  nodes: TopologyNodeData[];
  /** Jump to a match: select it and center the viewport (parent-owned). */
  onJump: (match: TopologyNodeData) => void;
  /** Close the overlay (input Escape). */
  onClose: () => void;
}

/**
 * The Ctrl+F node finder overlay. Owns its query/index state and resets both
 * (plus refocuses the input) whenever it opens, matching the editor's
 * previous Ctrl+F reset behavior.
 */
export function TopologyNodeFinder({ open, nodes, onJump, onClose }: TopologyNodeFinderProps) {
  const { l10n } = useLocalization();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query + highlight and focus the input when the overlay opens. A
  // layout effect runs before paint, so a stale query from a previous session
  // never flashes for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    inputRef.current?.focus();
  }, [open]);

  /** Nodes matching the query (name or subtitle, case-insensitive). An empty
   *  query lists every node so Enter always has a target. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => n.name.toLowerCase().includes(q) || (n.subtitle ?? '').toLowerCase().includes(q));
  }, [nodes, query]);

  if (!open) return null;

  const activeIndex = Math.min(index, Math.max(0, matches.length - 1));
  // The finder is a combobox pattern: the input announces its active match
  // via aria-activedescendant so a screen-reader user knows what Enter will
  // jump to. The empty-state option carries the "no matches" announcement.
  const activeDescendant = matches.length > 0
    ? `topology-finder-option-${matches[activeIndex]!.id}`
    : query.trim() !== ''
      ? 'topology-finder-empty'
      : undefined;

  return (
    // The overlay sits on top of the canvas; its mousedown must not fall
    // through and start a canvas marquee/pan. Interaction lives in the
    // combobox input, so the dialog itself has no activation handler.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="topology-finder"
      role="dialog"
      aria-label={l10n.getString('topology-finder-aria')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="topology-finder-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="topology-finder-listbox"
        aria-activedescendant={activeDescendant}
        value={query}
        placeholder={l10n.getString('topology-finder-placeholder')}
        aria-label={l10n.getString('topology-finder-aria')}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => {
              if (matches.length === 0) return 0;
              // Navigate from the VISIBLY-active row: the stored index can
              // sit past the end after the match list shrinks (a node deleted
              // while the finder is open), and an un-clamped modulo would
              // swallow exactly one arrow press.
              const active = Math.min(i, matches.length - 1);
              return (active + 1) % matches.length;
            });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => {
              if (matches.length === 0) return 0;
              const active = Math.min(i, matches.length - 1);
              return (active - 1 + matches.length) % matches.length;
            });
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const match = matches[Math.min(index, Math.max(0, matches.length - 1))];
            if (match) onJump(match);
          }
        }}
      />
      <ul
        id="topology-finder-listbox"
        className="topology-finder-list"
        role="listbox"
      >
        {matches.length === 0 ? (
          <li
            id="topology-finder-empty"
            className="topology-finder-empty"
            role="option"
            aria-selected="false"
          >
            {l10n.getString('topology-finder-no-matches')}
          </li>
        ) : matches.map((n, i) => (
          <li
            key={n.id}
            id={`topology-finder-option-${n.id}`}
            role="option"
            aria-selected={i === activeIndex}
            className={`topology-finder-item ${i === activeIndex ? 'is-active' : ''}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              onJump(n);
            }}
          >
            <span className="topology-finder-item-name">{n.name}</span>
            <span className="topology-finder-item-sub">{n.subtitle}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
