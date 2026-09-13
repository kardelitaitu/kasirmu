// ui/src/features/kds/components/ModifierBadge.tsx
//
// Modifier badge for KDS tickets (todo-kds-agents-3, Phase 3.1).
//
// A KDS line item carries zero or more `KdsModifier` rows (name / choice /
// price_minor) — the POS side (features/sales ItemModifierModal + cart) writes
// the same `{ name, choice, price_minor }` shape into `kds_line_items.modifiers`
// through create_kds_order_from_sale, so the badge reads exactly what
// `get_kds_order_lines_scoped` returns. Nothing is re-mapped here.
//
// Before this component the ticket card rendered the raw `choice` string as a
// bullet line (`kds-ticket-modifier-row`). That worked for "EXTRA CHEESE" as
// well as for "NO ONIONS" — two operationally opposite intents (add vs omit)
// distinguished only by reading the text. The badge classifies the choice into
// a tone and encodes it with colour AND a +/− glyph (the design language's
// "never color alone" rule), so an expeditor glancing at a bumped ticket sees
// at a glance whether something was removed from or added to a dish.
//
// The classifier is a heuristic over the free-text `choice` (the backend stores
// whatever the cashier picked), applied case-insensitively to English modifier
// vocabulary — which is what the POS modifier groups ship. Unknown wording
// falls to `neutral`, never a wrong red/green.
//
// `price_minor` is deliberately NOT rendered: `KdsModifier` carries no currency
// code, and guessing one on a kitchen screen invites misreads. Pricing stays
// on the receipt surface where the currency context is authoritative.

import type { KdsModifier } from '@/api/kds';
import './ModifierBadge.css';

/** Visual tone of a modifier: omit-something, add-something, or neither. */
export type ModifierTone = 'removal' | 'addition' | 'neutral';

/**
 * Removal phrasings: "NO ONIONS", "NO-ONIONS", "NO/NO GARLIC", "WITHOUT X",
 * "SKIP X", "DELETE X", "OMIT X", "HOLD THE X" (kitchen jargon for omit).
 * Tested FIRST so "WITHOUT" can never be re-read as an addition by the WITH
 * rule below.
 */
const REMOVAL_RE = /^(?:no[\s\-/]|without\b|skip\b|delete\b|omit\b|hold\b|exclude\b)/i;

/** Addition phrasings: "EXTRA CHEESE", "MORE RICE", "ADD BACON", "DOUBLE X", "WITH X", "SIDE OF X". */
const ADDITION_RE = /^(?:extra\b|more\b|add\b|double\b|triple\b|with\b|side\b)/i;

/**
 * Classify a modifier choice into a badge tone.
 *
 * Exported for tests (ModifierBadge.test.tsx) — the component derives its
 * class from this, so testing the tone means testing one pure function
 * instead of re-deriving the regexes inside the suite.
 */
export function classifyModifier(choice: string): ModifierTone {
  const text = choice.trim();
  if (text === '') return 'neutral';
  if (REMOVAL_RE.test(text)) return 'removal';
  if (ADDITION_RE.test(text)) return 'addition';
  return 'neutral';
}

/** Glyph per tone. Color-blind-safe encoding: shape carries the meaning too. */
const TONE_GLYPH: Record<ModifierTone, string> = {
  removal: '\u2212',  // minus sign, not a hyphen
  addition: '+',
  neutral: '\u2022',  // bullet
};

// The tone class names are written as literals inside the `className`
// template below — NOT hoisted into a lookup map — because the
// screenExtraction static scan only reads strings that appear in a
// `className` attribute. A map value elsewhere in the file is invisible to
// it, and the three CSS rules would be reported as dead classes.

/** Props for the ModifierBadge component. */
export interface ModifierBadgeProps {
  /** The modifier row from a KDS line item. */
  modifier: KdsModifier;
}

/**
 * A single modifier rendered as a status pill.
 *
 * Presentational: takes the data row, renders it. The `choice` text is
 * operator-entered data, not a translatable string, so it renders raw (and
 * the badge carries no Fluent message of its own).
 */
export function ModifierBadge({ modifier }: ModifierBadgeProps) {
  const tone = classifyModifier(modifier.choice);
  return (
    <span
      className={`kds-modifier-badge${tone === 'removal' ? ' kds-modifier-badge--removal' : tone === 'addition' ? ' kds-modifier-badge--addition' : ' kds-modifier-badge--neutral'}`}
      data-testid="kds-modifier-badge"
    >
      <span className="kds-modifier-badge-glyph" aria-hidden="true">
        {TONE_GLYPH[tone]}
      </span>
      <span className="kds-modifier-badge-text">{modifier.choice}</span>
    </span>
  );
}

export default ModifierBadge;
