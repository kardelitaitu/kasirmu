// ModifierBadge unit + KdsTicketCard integration tests (todo-kds-agents-3, M1).
//
// Split deliberately: `classifyModifier` is tested as a pure function (the
// tone→class mapping is exercised through the rendered element's classes,
// never by re-declaring the regexes here), and the card integration asserts
// that a ticket whose line items carry modifiers renders one badge per
// modifier — the replacement for the old raw `kds-ticket-modifier-row` text.

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithFluent, renderWithFluentSync } from '@/__tests__/test-utils/render';
import ModifierBadge, { classifyModifier } from '@/features/kds/components/ModifierBadge';
import { KdsTicketCard } from '@/features/kds/components/KdsTicketCard';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { KdsLineItem, KdsModifier, KdsOrder } from '@/api/kds';

const mockGetKdsOrderLines = vi.fn().mockResolvedValue([]);
const mockPlayAlert = vi.fn();
const mockSlaResult = { level: 'green', display: '0s', elapsedSeconds: 0 };

vi.mock('@/api/kds', () => ({
  getKdsOrderLinesScoped: (_token: string, _orderId: string) => mockGetKdsOrderLines(),
}));

vi.mock('@/features/kds/hooks/useTicketSla', () => ({
  useTicketSla: () => mockSlaResult,
}));

vi.mock('@/components/useSound', () => ({
  useSound: () => ({ playAlert: mockPlayAlert }),
}));

function makeModifier(choice: string): KdsModifier {
  return { name: 'Custom', choice, price_minor: 0 };
}

// ── 1. classifyModifier (pure) ──────────────────────────────────────

describe('classifyModifier', () => {
  it.each([
    'NO ONIONS',
    'no garlic',
    'NO-ONIONS',
    'NO/MUSHROOMS',
    'WITHOUT ICE',
    'skip lettuce',
    'DELETE OLIVES',
    'omit salt',
    'hold the bun',
    'exclude peanuts',
  ])('reads "%s" as a removal', (choice) => {
    expect(classifyModifier(choice)).toBe('removal');
  });

  it.each([
    'EXTRA CHEESE',
    'extra sauce',
    'MORE RICE',
    'ADD BACON',
    'DOUBLE PATTY',
    'TRIPLE SHRIMP',
    'WITH GARLIC BREAD',
    'side of salad',
  ])('reads "%s" as an addition', (choice) => {
    expect(classifyModifier(choice)).toBe('addition');
  });

  it.each(['MILD', 'WELL DONE', 'CUT IN HALF', 'ALLERGY - PENUTS TRACES', ''])(
    'reads "%s" as neutral',
    (choice) => {
      expect(classifyModifier(choice)).toBe('neutral');
    },
  );

  it('never reads "WITHOUT" as an addition despite the WITH rule', () => {
    // The regexes are applied removal-first; this is the ordering contract.
    expect(classifyModifier('WITHOUT ONIONS')).toBe('removal');
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyModifier('   EXTRA CHEESE  ')).toBe('addition');
    expect(classifyModifier('\t NO ICE \n')).toBe('removal');
  });

  it('does not classify a word merely STARTING with "no" as removal', () => {
    // "NO " requires a separator — "NOT SPICY" is neither add nor omit.
    expect(classifyModifier('NOT SPICY')).toBe('neutral');
    expect(classifyModifier('NACHOS')).toBe('neutral');
  });
});

// ── 2. ModifierBadge (rendered) ─────────────────────────────────────

describe('ModifierBadge', () => {
  function renderBadge(choice: string) {
    return renderWithFluentSync(<ModifierBadge modifier={makeModifier(choice)} />, kdsFtl);
  }

  it('renders the modifier choice text verbatim', () => {
    renderBadge('EXTRA CHEESE');
    expect(screen.getByText('EXTRA CHEESE')).toBeInTheDocument();
  });

  it('carries the removal tone class and minus glyph for a removal', () => {
    renderBadge('NO ONIONS');
    const badge = screen.getByTestId('kds-modifier-badge');
    expect(badge).toHaveClass('kds-modifier-badge', 'kds-modifier-badge--removal');
    expect(badge).toHaveTextContent('−');
  });

  it('carries the addition tone class and plus glyph for an addition', () => {
    renderBadge('EXTRA CHEESE');
    const badge = screen.getByTestId('kds-modifier-badge');
    expect(badge).toHaveClass('kds-modifier-badge', 'kds-modifier-badge--addition');
    expect(badge).toHaveTextContent('+');
  });

  it('falls back to the neutral tone class for unknown wording', () => {
    renderBadge('WELL DONE');
    const badge = screen.getByTestId('kds-modifier-badge');
    expect(badge).toHaveClass('kds-modifier-badge', 'kds-modifier-badge--neutral');
  });

  it('hides the tone glyph from assistive tech (shape is decorative duplication)', () => {
    renderBadge('NO ONIONS');
    const badge = screen.getByTestId('kds-modifier-badge');
    const glyph = badge.querySelector('span[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    // The choice text itself remains readable to assistive tech.
    expect(badge.querySelector('span[aria-hidden="true"]')?.nextElementSibling?.textContent).toBe('NO ONIONS');
  });
});

// ── 3. KdsTicketCard integration ────────────────────────────────────

const baseOrder: KdsOrder = {
  id: 'order-1',
  sale_id: 'sale-1',
  store_id: null,
  status: 'preparing',
  items_summary: '1x Burger',
  item_count: 1,
  display_number: 7,
  received_at: new Date().toISOString(),
  started_at: null,
  ready_at: null,
  served_at: null,
  prep_time_seconds: 0,
  kitchen_zone: null,
  notes: '',
  table_number: null,
  priority: false,
};

function makeLine(overrides: Partial<KdsLineItem>): KdsLineItem {
  return {
    id: 'line-1',
    kds_order_id: 'order-1',
    sku: 'BRG-1',
    display_name: 'Burger',
    qty: 1,
    course: 'main',
    modifiers: [],
    line_position: 0,
    item_status: 'preparing',
    started_at: null,
    ready_at: null,
    served_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('KdsTicketCard modifier badges', () => {
  it('renders one ModifierBadge per modifier on a line item', async () => {
    mockGetKdsOrderLines.mockResolvedValue([
      makeLine({
        modifiers: [makeModifier('NO ONIONS'), makeModifier('EXTRA CHEESE')],
      }),
    ]);
    await renderWithFluent(
      <KdsTicketCard order={baseOrder} onAdvance={() => {}} sessionToken="tok" />,
      sharedFtl,
      kdsFtl,
    );
    await vi.waitFor(() => {
      expect(screen.getByText('NO ONIONS')).toBeInTheDocument();
    });
    expect(screen.getByText('EXTRA CHEESE')).toBeInTheDocument();
    expect(screen.getAllByTestId('kds-modifier-badge')).toHaveLength(2);
    mockGetKdsOrderLines.mockResolvedValue([]);
  });

  it('renders no badges when the line has no modifiers', async () => {
    mockGetKdsOrderLines.mockResolvedValue([makeLine({ modifiers: [] })]);
    const { container } = await renderWithFluent(
      <KdsTicketCard order={baseOrder} onAdvance={() => {}} sessionToken="tok" />,
      sharedFtl,
      kdsFtl,
    );
    await vi.waitFor(() => {
      expect(screen.getByText('Burger')).toBeInTheDocument();
    });
    expect(container.querySelectorAll('[data-testid="kds-modifier-badge"]')).toHaveLength(0);
  });
});
