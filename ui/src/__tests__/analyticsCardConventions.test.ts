/**
 * Card CONFORMITY, not card behaviour.
 *
 * Every existing analytics test checks that a given card renders the right thing
 * with the right data. None of them would notice a NEW card that forgot the
 * conventions all its siblings follow, because nothing writes the convention
 * down. That gap is real and it bit: `PiutangCollectionsCard` shipped without a
 * CSV export while 15 of 15 siblings had one, and every gate stayed green.
 *
 * So this suite reads the SOURCE of every card and asserts the invariants that
 * are true of all of them. It is deliberately structural: it cannot tell whether
 * a card is CORRECT, only whether it is built the way this directory builds
 * cards. Each case names what it protects.
 */
import { describe, it, expect } from 'vitest';
import { CARD_LOADERS, CARD_PAYLOAD_VALIDATORS } from '@/features/analytics/analytics-data';

const CARD_SOURCES = import.meta.glob('../features/analytics/cards/*Card.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `../features/analytics/cards/AovCard.tsx` -> `AovCard.tsx` */
const nameOf = (path: string) => path.split('/').pop()!;

const cards = Object.entries(CARD_SOURCES).map(([path, source]) => ({
  name: nameOf(path),
  source,
}));

describe('analytics card conventions', () => {
  // A glob that silently matched nothing would make every case below vacuously
  // pass -- the same empty-corpus trap the Python checkers guard against. Pin a
  // floor: the directory has had 15+ cards for months.
  it('finds the card sources at all', () => {
    expect(cards.length).toBeGreaterThanOrEqual(15);
  });

  // Protected: a card that renders no export button gives the operator no way to
  // take the numbers into a spreadsheet, and nothing else notices the omission.
  //
  // MUTATION-TESTED 2026-10-25: replacing every `ExportCsvButton` occurrence in
  // PiutangCollectionsCard.tsx fails this case and names the file. The FIRST
  // attempt removed only the JSX tag and left the `import`, so the string was
  // still present and the case stayed green -- the plant has to remove every
  // occurrence or it grades nothing. Recorded so the next person does not
  // conclude the check is vacuous from a mutation of the wrong shape.
  it('every card offers a CSV export', () => {
    const missing = cards.filter((c) => !c.source.includes('ExportCsvButton')).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  // Protected: the error surface. A card that reads `error` but never renders it
  // shows a blank panel on failure, which reads as "no data" rather than
  // "the query broke" -- the AUD-09 shape this codebase has fixed repeatedly.
  it('every card renders a CardError and a CardLoading', () => {
    const missing = cards
      .filter((c) => !(c.source.includes('<CardError') && c.source.includes('<CardLoading')))
      .map((c) => c.name);
    expect(missing).toEqual([]);
  });

  // Protected: the data path. A card reading its IPC command directly would skip
  // the per-card TTL cache and the payload validator, so a schema change would
  // reach the renderer unchecked.
  it('every card reads through useCardData/useCardDataCompare', () => {
    const missing = cards.filter((c) => !c.source.includes('useCardData')).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  // Protected: the three registries must agree. A key in a card but missing from
  // CARD_LOADERS throws at runtime; a key in CARD_PAYLOAD_VALIDATORS but in no
  // card is dead weight that hides a rename.
  it('every card key resolves to a loader AND a payload validator', () => {
    const keys = new Set<string>();
    for (const c of cards) {
      for (const m of c.source.matchAll(/useCardData(?:Compare)?<[^>]*>\(\s*'([^']+)'/g)) {
        keys.add(m[1]!);
      }
    }
    expect(keys.size).toBeGreaterThanOrEqual(15);
    for (const key of keys) {
      expect(CARD_LOADERS, `no loader for card key '${key}'`).toHaveProperty(key);
      expect(CARD_PAYLOAD_VALIDATORS, `no validator for card key '${key}'`).toHaveProperty(key);
    }
  });
});
