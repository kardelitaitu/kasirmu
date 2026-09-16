import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import { CartLineItem } from '@/features/sales/components/CartLineItem';
import {
  formatMoney,
  COURSES,
  type CartLine,
  type CourseId,
  type LineId,
  type Sku,
} from '@/types/domain';

// ── CartLineItem behavioural tests ───────────────────────────────────
//
// One swipeable row of the cart: thumbnail, name + unit price, optional
// price-override control, qty −/+ with the value between them, an always
// visible remove button, an optional category ribbon, and a remove panel
// that lives UNDER the row and is only reachable by swiping.
//
// Correcting the planning doc, permanently, by assertion: the doc claimed a
// class 'cart-panel-line-item' at :103. Measured against the source, :103 is
// a data-testid attribute, the className at :99 is pos-cart-line, and
// 'cart-panel-line-item' appears 0 times as a CSS selector anywhere in the
// sales stylesheets. Case 1 pins all three facts.
//
// Also measured: this component has NO modifier or discount props, and
// modifiers still have no data path anywhere in the app (see F1 in
// .agents/resto-pos-ui-review.md). COURSING IS now a prop surface —
// onAssignCourse / courseMenuLine / onCourseMenuLineChange — added so a line
// can be given a courseId; until then the restaurant firing bar had nothing
// to fire. The remaining optional render slots are onOverride, line.category
// and line.name, and case 6 asserts what an absent one does (nothing),
// because the doc's "modifier rows render here" reading would otherwise
// survive this file.
//
// triggerInteraction is mocked: the sound/vibration it schedules is not this
// component's contract, and jsdom has no HTMLMediaElement.play. What IS
// asserted is that the component reports the right named interaction.

const { triggerInteractionMock } = vi.hoisted(() => ({
  triggerInteractionMock: vi.fn(),
}));

vi.mock('@/utils/interaction', () => ({
  triggerInteraction: (name: string) => triggerInteractionMock(name),
}));

const PRICE = { minor_units: 15000, currency: 'IDR' };

let seq = 0;

function makeLine(opts: {
  qty?: number;
  name?: string;
  category?: string;
} = {}): CartLine {
  seq += 1;
  return {
    id: ('line-' + seq) as LineId,
    // The sku is deliberately constant: every accessible name in this file is
    // asserted as the bundle string with the sku interpolated into it, so a
    // per-fixture sku would make each expectation depend on call order.
    // Identity is carried by the id, which does increment.
    sku: 'SKU-1' as Sku,
    qty: opts.qty ?? 2,
    unit_price: PRICE,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.category !== undefined ? { category: opts.category } : {}),
  };
}

function renderItem(props: {
  line?: CartLine;
  onOverride?: (line: CartLine) => void;
  registerRef?: (lineId: LineId, el: HTMLDivElement | null) => void;
  onAssignCourse?: (lineId: LineId, courseId: CourseId) => void;
  courseMenuLine?: LineId | null;
  onCourseMenuLineChange?: (lineId: LineId | null) => void;
} = {}) {
  const line = props.line ?? makeLine();
  const onRemove = vi.fn();
  const onDecreaseQty = vi.fn();
  const onIncreaseQty = vi.fn();
  const result = render(
    withFluent(
      <CartLineItem
        line={line}
        onRemove={onRemove}
        onDecreaseQty={onDecreaseQty}
        onIncreaseQty={onIncreaseQty}
        {...(props.onOverride ? { onOverride: props.onOverride } : {})}
        {...(props.registerRef ? { registerRef: props.registerRef } : {})}
        // Coursing is opt-in: no onAssignCourse, no chip — see the cases below.
        {...(props.onAssignCourse ? {
          onAssignCourse: props.onAssignCourse,
          courseMenuLine: props.courseMenuLine ?? null,
          onCourseMenuLineChange: props.onCourseMenuLineChange ?? vi.fn(),
        } : {})}
      />,
      salesFtl,
    ),
  );
  return { ...result, line, onRemove, onDecreaseQty, onIncreaseQty };
}

beforeEach(() => {
  triggerInteractionMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CartLineItem', () => {
  it('is a labelled group whose className is pos-cart-line, never cart-panel-line-item', () => {
    const { container, line } = renderItem();

    const row = screen.getByTestId('cart-panel-line-item');
    expect(row.getAttribute('role')).toBe('group');
    // The doc error, pinned three ways.
    expect(row.className).toBe('pos-cart-line');
    expect(container.querySelector('.pos-cart-line')).not.toBeNull();
    expect(container.querySelector('.cart-panel-line-item')).toBeNull();
    // The name carries sku, qty and the formatted unit price — all three.
    expect(row.getAttribute('aria-label')).toBe(
      'SKU-1, 2 ' + String.fromCharCode(215) + ' ' + formatMoney(PRICE),
    );
    expect(row.getAttribute('data-line-id')).toBe(line.id);
    expect(row.getAttribute('tabindex')).toBe('0');
    // The row lives inside a wrapper that owns the swipe/reveal state.
    expect(row.parentElement?.className).toContain('pos-cart-line-wrap');
  });

  it('exposes three accessible named controls while the swipe panel stays out of the a11y tree', () => {
    const { container } = renderItem();

    const buttons = screen.getAllByRole('button');
    // Measured: THREE, not four. pos-cart-line-swipe-remove exists in the
    // DOM but its wrapper is aria-hidden until a swipe reveals it
    // (CartLineItem.tsx:182), so role queries must not see it.
    expect(buttons).toHaveLength(3);
    expect(container.querySelectorAll('button')).toHaveLength(4);
    expect(
      container.querySelector('.pos-cart-line-swipe-action')?.getAttribute('aria-hidden'),
    ).toBe('true');

    const sku = 'SKU-1';
    expect(
      screen.getByRole('button', { name: 'Decrease quantity of ' + sku }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Increase quantity of ' + sku }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove ' + sku + ' from cart' }),
    ).toBeTruthy();
    // The quantity is text, not an input, and carries its own label.
    const qty = container.querySelector('.pos-cart-qty-value');
    expect(qty?.textContent).toBe('2');
    expect(qty?.getAttribute('aria-label')).toBe('Quantity: 2');
    // Icons, thumbnail and ribbon are decoration: none may reach the name.
    expect(qty?.parentElement?.querySelectorAll('svg[aria-hidden="true"]').length).toBe(2);
    expect(container.querySelector('.pos-cart-line-thumb')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('sends exactly the line it was given to the qty handlers and nothing else', () => {
    const { container, line, onIncreaseQty, onDecreaseQty, onRemove } = renderItem({
      line: makeLine({ qty: 3 }),
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Increase quantity of SKU-1' }),
    );
    expect(onIncreaseQty).toHaveBeenCalledTimes(1);
    expect(onIncreaseQty).toHaveBeenCalledWith(line);
    expect(onDecreaseQty).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Decrease quantity of SKU-1' }),
    );
    expect(onDecreaseQty).toHaveBeenCalledTimes(1);
    expect(onDecreaseQty).toHaveBeenCalledWith(line);
    expect(onIncreaseQty).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pos-cart-qty-value')?.textContent).toBe('3');
    // Both qty controls share one class and the remove control has its own.
    expect(container.querySelectorAll('.pos-cart-qty-btn')).toHaveLength(2);
    expect(container.querySelector('.pos-cart-line-remove')).not.toBeNull();
  });

  it('disallows decreasing at qty 1 and never disables increase or remove', () => {
    const single = makeLine({ qty: 1 });
    const { container, onDecreaseQty } = renderItem({ line: single });

    // getByRole returns HTMLElement, which carries no `disabled` — every
    // query in this case selects a real <button>, so the generic names the
    // element the query already found (same form as
    // CartFooterTotals.test.tsx:202) instead of casting at the use site.
    const decrease = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Decrease quantity of SKU-1',
    });
    expect(decrease.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Increase quantity of SKU-1',
      }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Remove SKU-1 from cart',
      }).disabled,
    ).toBe(false);
    // A disabled control must be inert, not merely styled.
    fireEvent.click(decrease);
    expect(onDecreaseQty).not.toHaveBeenCalled();
    expect(container.querySelector('.pos-cart-qty-value')?.textContent).toBe('1');
  });

  it('defers onRemove behind the exit animation and reports the named interaction', () => {
    vi.useFakeTimers();
    const { container, line, onRemove } = renderItem();

    fireEvent.click(screen.getByRole('button', { name: 'Remove SKU-1 from cart' }));
    // The row must still be on screen: removal is the parent's job, and only
    // after the fade. An instant onRemove here would drop the animation.
    expect(onRemove).not.toHaveBeenCalled();
    expect(container.querySelector('.pos-cart-line-wrap')?.className).toContain(
      'pos-cart-line-wrap--exiting',
    );
    expect(triggerInteractionMock).toHaveBeenCalledWith('remove-item');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(line);
  });

  it('renders nothing for the slots it is not given, and an override control when it is', () => {
    const noExtras = renderItem({ line: makeLine() });
    const { container } = noExtras;
    // No name, no category, no onOverride: the row falls back to the sku and
    // the two optional nodes are simply absent.
    expect(container.querySelector('.pos-cart-line-name')?.textContent).toBe('SKU-1');
    expect(container.querySelector('.pos-cart-line-ribbon')).toBeNull();
    expect(container.querySelector('.pos-cart-line-override')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    noExtras.unmount();

    const onOverride = vi.fn();
    const full = renderItem({
      line: makeLine({ name: 'Espresso', category: 'Drinks' }),
      onOverride,
    });
    const { container: c2 } = full;
    expect(c2.querySelector('.pos-cart-line-name')?.textContent).toBe('Espresso');
    expect(c2.querySelector('.pos-cart-line-ribbon')).not.toBeNull();
    expect(c2.querySelectorAll('.pos-cart-line-ribbon')).toHaveLength(1);
    expect(c2.querySelector('.pos-cart-line-thumb')?.getAttribute('style')).toContain(
      '--thumb-hue',
    );
    // The override button is the fourth accessible control, named per line.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    const override = screen.getByRole('button', { name: 'Override price for Espresso' });
    expect(override.textContent).toBe('Override');
    fireEvent.click(override);
    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(onOverride).toHaveBeenCalledWith(full.line);
  });
});

describe('CartLineItem — course assignment (restaurant coursing)', () => {
  // The chip is how a line acquires a courseId, which is what the firing bar
  // counts. Before this existed the restaurant stack could fire courses but
  // never assign one, so every hold count was structurally zero.
  //
  // The open/closed state lives in CartPanel (so only one dropdown can be open
  // at a time), which is why the tests below pass `courseMenuLine` directly
  // instead of clicking the chip and waiting for it to appear.

  it('renders no course chip at all when onAssignCourse is absent', () => {
    renderItem();

    expect(screen.queryByTestId('cart-line-course-chip')).toBeNull();
    expect(screen.queryByTestId('cart-line-course-dropdown')).toBeNull();
  });

  it('renders a closed chip when coursing is available', () => {
    renderItem({ onAssignCourse: vi.fn() });

    const chip = screen.getByTestId('cart-line-course-chip');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    // Closed means no options in the a11y tree, not merely hidden ones.
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('asks the panel to open this line, rather than opening itself', () => {
    const onCourseMenuLineChange = vi.fn();
    const { line } = renderItem({ onAssignCourse: vi.fn(), onCourseMenuLineChange });

    fireEvent.click(screen.getByTestId('cart-line-course-chip'));

    expect(onCourseMenuLineChange).toHaveBeenCalledTimes(1);
    expect(onCourseMenuLineChange).toHaveBeenCalledWith(line.id);
  });

  it('closes again when the chip is clicked while already open', () => {
    const onCourseMenuLineChange = vi.fn();
    const line = makeLine();
    renderItem({ line, onAssignCourse: vi.fn(), onCourseMenuLineChange, courseMenuLine: line.id });

    fireEvent.click(screen.getByTestId('cart-line-course-chip'));

    expect(onCourseMenuLineChange).toHaveBeenCalledWith(null);
  });

  it('offers every course plus a None option, and reports the choice with the line id', () => {
    const onAssignCourse = vi.fn();
    const onCourseMenuLineChange = vi.fn();
    const line = makeLine({ name: 'Espresso' });
    renderItem({
      line,
      onAssignCourse,
      onCourseMenuLineChange,
      courseMenuLine: line.id,
    });

    expect(screen.getByTestId('cart-line-course-dropdown').getAttribute('role')).toBe('listbox');
    // The four COURSES plus the explicit "no course" entry.
    expect(screen.getAllByRole('option')).toHaveLength(COURSES.length + 1);

    fireEvent.click(screen.getByTestId('cart-line-course-option-dessert'));

    expect(onAssignCourse).toHaveBeenCalledTimes(1);
    expect(onAssignCourse).toHaveBeenCalledWith(line.id, 'dessert');
    // Choosing closes the menu.
    expect(onCourseMenuLineChange).toHaveBeenCalledWith(null);
  });

  it('clears the course when None is chosen', () => {
    const onAssignCourse = vi.fn();
    const line = { ...makeLine(), courseId: 'main' as CourseId };
    renderItem({ line, onAssignCourse, courseMenuLine: line.id });

    fireEvent.click(screen.getByTestId('cart-line-course-option-none'));

    expect(onAssignCourse).toHaveBeenCalledWith(line.id, '');
  });

  it('shows the assigned course on the chip instead of the prompt', () => {
    const line = { ...makeLine(), courseId: 'main' as CourseId };
    renderItem({ line, onAssignCourse: vi.fn() });

    const chip = screen.getByTestId('cart-line-course-chip');
    expect(chip.className).toContain('pos-cart-course-chip--set');
    expect(chip.textContent).toContain('Main Course');
  });
});
