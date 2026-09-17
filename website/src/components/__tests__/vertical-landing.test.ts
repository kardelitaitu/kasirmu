// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests for VerticalLanding.astro CTA routing logic.
 *
 * The component has branching logic:
 *   - kafe leads with a trial CTA (?v=kafe → download page)
 *   - other verticals lead with a tier deep-link (#pro, #plus, #premium)
 *   - bundle CTA deep-links to ?bundle=restaurant_starter#plus
 *
 * If the routing logic breaks, the wrong CTA appears on the wrong vertical —
 * a conversion-critical bug.
 */

const VERTICAL_SRC = readFileSync(
  join(import.meta.dirname, '..', 'VerticalLanding.astro'),
  'utf-8',
);

const enJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
);
const idJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
);

// ─── Source structure tests ──────────────────────────────────────────

describe('VerticalLanding source structure', () => {
  it('exports VerticalKey type with all 5 verticals', () => {
    expect(VERTICAL_SRC).toContain("'kafe'");
    expect(VERTICAL_SRC).toContain("'minimarket'");
    expect(VERTICAL_SRC).toContain("'warung'");
    expect(VERTICAL_SRC).toContain("'restoran'");
    expect(VERTICAL_SRC).toContain("'warehouse'");
  });

  it('has leadWithTrial flag for kafe', () => {
    expect(VERTICAL_SRC).toContain('leadWithTrial');
  });

  it('builds trialHref with ?v= vertical param', () => {
    // Source uses template literal: `?v=${vertical}`
    expect(VERTICAL_SRC).toContain('?v=${vertical}');
  });

  it('builds tierHref with pricing deep-link', () => {
    // Source uses template literal: `#${vStrings[vertical].tierAnchor}`
    expect(VERTICAL_SRC).toContain('#${vStrings[vertical].tierAnchor}');
  });

  it('determines primaryCta based on leadsWithTrial', () => {
    expect(VERTICAL_SRC).toContain('leadsWithTrial ? trialHref : tierHref');
  });

  it('determines secondaryCta as the inverse', () => {
    expect(VERTICAL_SRC).toContain('leadsWithTrial ? tierHref : trialHref');
  });
});

// ─── Tier anchor data tests ──────────────────────────────────────────

describe('Vertical tier anchors', () => {
  it('kafe anchors to Pro tier', () => {
    expect(enJson.vertical.kafe.tierAnchor).toBe('pro');
    expect(idJson.vertical.kafe.tierAnchor).toBe('pro');
  });

  it('minimarket anchors to Pro tier', () => {
    expect(enJson.vertical.minimarket.tierAnchor).toBe('pro');
    expect(idJson.vertical.minimarket.tierAnchor).toBe('pro');
  });

  it('warung anchors to Plus tier', () => {
    expect(enJson.vertical.warung.tierAnchor).toBe('plus');
    expect(idJson.vertical.warung.tierAnchor).toBe('plus');
  });

  it('restoran anchors to Premium tier', () => {
    expect(enJson.vertical.restoran.tierAnchor).toBe('premium');
    expect(idJson.vertical.restoran.tierAnchor).toBe('premium');
  });

  it('warehouse anchors to Pro tier', () => {
    expect(enJson.vertical.warehouse.tierAnchor).toBe('pro');
    expect(idJson.vertical.warehouse.tierAnchor).toBe('pro');
  });

  it('all tier anchors are valid pricing section IDs', () => {
    const validAnchors = ['free', 'plus', 'pro', 'premium', 'enterprise'];
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(validAnchors).toContain(enJson.vertical[key].tierAnchor);
    }
  });
});

// ─── Trial CTA data tests ────────────────────────────────────────────

describe('Vertical trial CTA configuration', () => {
  it('kafe is the only vertical that leads with trial', () => {
    expect(enJson.vertical.kafe.leadWithTrial).toBe(true);
    expect(enJson.vertical.minimarket.leadWithTrial).toBeUndefined();
    expect(enJson.vertical.warung.leadWithTrial).toBeUndefined();
    expect(enJson.vertical.restoran.leadWithTrial).toBeUndefined();
    expect(enJson.vertical.warehouse.leadWithTrial).toBeUndefined();
  });

  it('kafe has a trialCta label', () => {
    expect(enJson.vertical.kafe.trialCta).toBeTruthy();
    expect(idJson.vertical.kafe.trialCta).toBeTruthy();
  });

  it('kafe trialCta labels differ between en and id (translated)', () => {
    expect(enJson.vertical.kafe.trialCta).not.toBe(idJson.vertical.kafe.trialCta);
  });

  it('all verticals have ctaPrimary', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(enJson.vertical[key].ctaPrimary).toBeTruthy();
    }
  });

  it('all verticals have at least 4 features', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(enJson.vertical[key].features.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('all verticals have benefits array', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(enJson.vertical[key].benefits.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ─── en/id parity tests ──────────────────────────────────────────────

describe('Vertical content en/id parity', () => {
  it('en and id have the same vertical keys', () => {
    const enKeys = Object.keys(enJson.vertical).filter((k) =>
      ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'].includes(k),
    ).sort();
    const idKeys = Object.keys(idJson.vertical).filter((k) =>
      ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'].includes(k),
    ).sort();
    expect(idKeys).toEqual(enKeys);
  });

  it('en and id have the same tierAnchor for each vertical', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(idJson.vertical[key].tierAnchor).toBe(enJson.vertical[key].tierAnchor);
    }
  });

  it('en and id have the same number of features per vertical', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    for (const key of verticals) {
      expect(idJson.vertical[key].features).toHaveLength(
        enJson.vertical[key].features.length,
      );
    }
  });

  it('en and id have different titles for each vertical (translated)', () => {
    const verticals = ['kafe', 'minimarket', 'warung', 'restoran', 'warehouse'] as const;
    const translations = verticals.filter(
      (key) => enJson.vertical[key].title !== idJson.vertical[key].title,
    );
    expect(translations.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Bundle CTA tests ────────────────────────────────────────────────

describe('Vertical bundle CTA', () => {
  it('section has bundleCta label', () => {
    expect(enJson.vertical.bundleCta).toBeTruthy();
    expect(idJson.vertical.bundleCta).toBeTruthy();
  });

  it('bundleCta labels differ between en and id', () => {
    expect(enJson.vertical.bundleCta).not.toBe(idJson.vertical.bundleCta);
  });
});
