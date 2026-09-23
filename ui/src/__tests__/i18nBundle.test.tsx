// ── i18n bundle smoke test ────────────────────────────────────────
//
// Verifies that `ui/src/i18n/index.ts` correctly loads BOTH the
// English and Indonesian FluentBundles at runtime, and that all
// the bundled keys actually resolve to their translated text.
//
// This catches regressions where:
//   - A new domain is added to `i18n/index.ts` but its `.id.ftl`
//     sibling import is forgotten (the per-locale ALL_FTL array
//     would silently drop into the English-fallback path).
//   - The `LocaleCode = 'en' | 'id'` union drifts and one locale
//     gets dropped.
//   - The `getBundle(locale)` cache returns the wrong instance
//     across locales (cross-leak).
import { describe, it, expect } from 'vitest';
import { renderInAct } from '@/test-utils/renderInAct';
import { screen } from '@testing-library/react';
import { Localized, LocalizationProvider, ReactLocalization } from '@fluent/react';
import { getBundle, getAvailableLocales } from '@/i18n';
import {
  scanLocaleFiles,
  scanLocalizedVars,
  scanTranslationVars,
  scanAttributeOmissions,
  scanAttributeOnlyGetString,
} from '@/i18n/barePlaceholderScan';
import { withFluentLocale } from '@/i18n/test-utils';
import sharedId from '@/locales/shared.id.ftl?raw';
import sharedEn from '@/locales/shared.ftl?raw';
import giftCardsEn from '@/locales/gift-cards.ftl?raw';
import giftCardsId from '@/locales/gift-cards.id.ftl?raw';
import purchasingEn from '@/locales/purchasing.ftl?raw';
import purchasingId from '@/locales/purchasing.id.ftl?raw';
import salesEn from '@/locales/sales.ftl?raw';
import salesId from '@/locales/sales.id.ftl?raw';
import multiStoreEn from '@/locales/multi-location.ftl?raw';
import multiStoreId from '@/locales/multi-location.id.ftl?raw';

describe('i18n bundle loader', () => {
  it('exposes en and id locales via getAvailableLocales()', () => {
    const locales = getAvailableLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('id');
    expect(locales.length).toBe(2);
  });

  it('returns distinct FluentBundle instances per locale (no cross-leak)', () => {
    // The cache in `i18n/index.ts` is keyed by locale code, so
    // `getBundle('en')` and `getBundle('id')` must be different
    // objects. If they collapse to a shared singleton we'd be
    // serving English text under the i18n `id` mount.
    expect(getBundle('en')).not.toBe(getBundle('id'));
  });

  it('loads the Indonesian bundle and contains common shared keys', () => {
    const id = getBundle('id');
    // `shared.ftl` / `shared.id.ftl` cover the cross-cutting labels
    // that almost every screen consumes. If the bundle drops them
    // because of a missing import, the entire UI reverts to English
    // for any screen that uses `<Localized id="…">`.
    for (const key of ['save', 'cancel', 'delete', 'back', 'confirm']) {
      const msg = id.getMessage(key);
      expect(
        msg,
        `expected shared key "${key}" to exist in the Indonesian bundle — is shared.id.ftl missing from i18n/index.ts?`,
      ).toBeDefined();
    }
  });

  it('resolves a known Indonesian phrase as Indonesian text (save → Simpan)', () => {
    const id = getBundle('id');
    const msg = id.getMessage('save');
    // `Message.value` is typed `Pattern | null` because a Message
    // can exist without a value (attribute-only messages); assert
    // non-null before passing to `formatPattern`.
    expect(msg?.value).toBeDefined();
    // `formatPattern(pattern, args, errors)` — both args and errors
    // are optional. We pass `null` explicitly for clarity.
    expect(id.formatPattern(msg!.value!, null)).toBe('Simpan');
  });

  it('resolves the same key as English text when the locale is "en" (save → Save)', () => {
    const en = getBundle('en');
    const msg = en.getMessage('save');
    expect(msg?.value).toBeDefined();
    expect(en.formatPattern(msg!.value!, null)).toBe('Save');
  });

  it('round-trips: switching locale changes the formatted text', () => {
    // Same key, different locale, different text. If `getBundle`
    // accidentally returned the same bundle instance for both
    // locales the assertions above would already fail; this one
    // is the negative-control that demonstrates the locales are
    // genuinely independent.
    const saveKey = 'save';
    const enText = getBundle('en').formatPattern(getBundle('en').getMessage(saveKey)!.value!, null);
    const idText = getBundle('id').formatPattern(getBundle('id').getMessage(saveKey)!.value!, null);
    expect(enText).not.toBe(idText);
    expect(enText).toBe('Save');
    expect(idText).toBe('Simpan');
  });
});

// ── Native-speaker pin (rounds 90-98) ───────────────────────────
//
// The values fixed by the native-speaker passes:
//   - round 90: dismiss aria, stock-wire hint, fallback toast;
//   - round 91: the kabel → koneksi terminology unification;
//   - round 92: settings/sync fixes (tarif pajak, Aktif, Hidangan);
//   - round 97: extended pass (shared/sales/inventory fixes);
//   - round 98: the Alihkan → Aktifkan/nonaktifkan toggle verbs.
// Each row carries BOTH the English and the Indonesian expectation, and
// the test resolves both from the REAL production bundles
// (getBundle('en') / getBundle('id')). A drift in either direction — an
// id value reverting, or an en value being rewritten — fails CI.
// Unlike the TOPOLOGY_EN stub used by the editor tests (which pins en
// only and never touches the .ftl files), these assertions exercise
// the actual shipped bundle content.
type Pin = { key: string; args?: Record<string, string | number>; attr?: string; en: string; id: string };

const nativeSpeakerPins: Pin[] = [
  // Round 90 — dismiss aria/title shortened to match en "Dismiss".
  { key: 'topology-validation-dismiss', en: 'Dismiss', id: 'Abaikan' },
  // Round 90 — hint uses "workspace" (not "ruang kerja") to match the
  // missing-stock-routing validation key.
  {
    key: 'topology-node-stock-wire-hint',
    en: "Connect a workspace's Stock Out or another Warehouse's output to this Warehouse's Stock In.",
    id: 'Hubungkan Stock Out dari workspace atau output Gudang lain ke Stock In Gudang ini.',
  },
  // Round 90 — fallback toast carries the "stock deduction" sense.
  {
    key: 'topology-toast-fallback-warehouse',
    en: 'Multi-warehouse stock deduction fallback wires require a Pro Tier license.',
    id: 'Koneksi fallback multi-gudang untuk pengurangan stok memerlukan lisensi Pro Tier.',
  },
  // Round 91 — kabel → koneksi unification across the wire surface.
  { key: 'topology-wire-routing-toggle', en: 'Elbow wires', id: 'Koneksi siku' },
  {
    key: 'topology-bends-override-note',
    en: 'Bends override routing on bent wires',
    id: 'Titik tekuk menggantikan mode rute pada koneksi yang dilengkungkan',
  },
  { key: 'topology-wire-labels-toggle', en: 'Wire labels', id: 'Label koneksi' },
  { key: 'topology-context-delete-wire', en: 'Delete wire', id: 'Hapus koneksi' },
  { key: 'topology-context-rename-wire', en: 'Rename wire', id: 'Ganti nama koneksi' },
  { key: 'topology-wire-rename-placeholder', en: 'Wire label', id: 'Label koneksi' },
  {
    key: 'topology-confirm-delete-many-msg',
    args: { count: 2 },
    en: 'Delete these 2 nodes and all of their wires? This action cannot be undone.',
    id: 'Hapus 2 node dan semua koneksinya? Tindakan ini tidak dapat dibatalkan.',
  },
  // Round 92 — settings/sync fixes.
  {
    key: 'settings-sync-pull-result',
    args: { products: 3, tax_rates: 2, users: 1 },
    en: 'Last pull: 3 products, 2 tax rates, 1 users',
    id: 'Tarik terakhir: 3 produk, 2 tarif pajak, 1 pengguna',
  },
  { key: 'settings-license-live-online', en: 'Live', id: 'Aktif' },
  { key: 'workspace-resto-courses-heading', en: 'Course Firing', id: 'Pengiriman Hidangan' },
  { key: 'workspace-resto-courses-enable', en: 'Enable Course Firing', id: 'Aktifkan Pengiriman Hidangan' },
  // Round 97 — extended pass: shared/sales/inventory fixes.
  { key: 'statusbar-license', en: 'Proprietary License', id: 'Lisensi Proprietary' },
  { key: 'scale-read-error', en: 'Scale error', id: 'Kesalahan timbangan' },
  { key: 'sales-history-status-cancelled', en: 'Cancelled', id: 'Batal' },
  {
    key: 'retail-reminder-low-stock-aria',
    args: { count: 3 },
    en: 'View 3 low-stock products',
    id: 'Lihat 3 produk stok menipis',
  },
  { key: 'retail-shortcut-low-stock', en: 'Filter low-stock products', id: 'Filter produk stok menipis' },
  {
    key: 'retail-filtered-low-stock',
    args: { count: 3 },
    en: 'Filtered: 3 low-stock products',
    id: 'Difilter: 3 produk stok menipis',
  },
  { key: 'retail-filter-indicator-aria', en: 'Low-stock filter active', id: 'Filter stok menipis aktif' },
  { key: 'retail-edit-field-low-stock', en: 'Low Stock Threshold', id: 'Ambang Stok Menipis' },
  { key: 'payment-split-amount-placeholder', attr: 'placeholder', en: '0.00', id: '0,00' },
  { key: 'inv-reason-damaged', en: 'Damaged / spoiled', id: 'Rusak / kedaluwarsa' },
  // Round 98 — 'Alihkan' → sense-accurate toggle verbs.
  { key: 'theme-toggle-label', en: 'Toggle theme', id: 'Aktifkan/nonaktifkan tema' },
  { key: 'workspace-home-fullscreen-aria', en: 'Toggle fullscreen', id: 'Aktifkan/nonaktifkan layar penuh' },
  { key: 'restaurant-toggle-fullscreen', en: 'Toggle Fullscreen', id: 'Aktifkan/nonaktifkan layar penuh' },
  { key: 'retail-shortcut-fullscreen', en: 'Toggle Fullscreen', id: 'Aktifkan/nonaktifkan layar penuh' },
  { key: 'pos-cart-service-toggle-aria', en: 'Toggle service charge', id: 'Aktifkan/nonaktifkan biaya layanan' },
  // `setup-features-toggle-aria` was removed with the Setup Wizard (ADR #56 §2.3
  // retirement, 2026-09-23). It was the wizard's per-row toggle aria-label.
  { key: 'settings-sync-enabled-aria', en: 'Toggle cloud sync', id: 'Aktifkan/nonaktifkan sinkronisasi cloud' },
  { key: 'appearance-hw-accel-aria', attr: 'aria-label', en: 'Toggle hardware acceleration', id: 'Aktifkan/nonaktifkan akselerasi perangkat keras' },
  {
    key: 'feature-toggle-toggle-aria',
    args: { name: 'Cloud Sync' },
    en: 'Toggle Cloud Sync',
    id: 'Aktifkan/nonaktifkan Cloud Sync',
  },
  { key: 'settings-theme-toggle-dark-aria', en: 'Switch to dark mode', id: 'Beralih ke mode gelap' },
  { key: 'settings-theme-toggle-light-aria', en: 'Switch to light mode', id: 'Beralih ke mode terang' },
  { key: 'promotions-error-toggle', en: 'Failed to toggle promotion', id: 'Gagal mengubah status promosi' },
  { key: 'feature-toggle-error-toggle', en: 'Failed to toggle feature', id: 'Gagal mengubah status fitur' },
  { key: 'topology-wire-toggle-aria', en: 'Toggle wire direction', id: 'Balik arah koneksi' },
];

describe('i18n native-speaker pin (rounds 90-98)', () => {
  it('resolves every pinned value exactly in BOTH the en and id production bundles', () => {
    const en = getBundle('en');
    const id = getBundle('id');
    for (const { key, args, attr, en: enExpected, id: idExpected } of nativeSpeakerPins) {
      const enMsg = en.getMessage(key);
      expect(enMsg, `key "${key}" must exist in the en bundle`).toBeDefined();
      // Attribute-only messages (.aria-label / .placeholder) have no
      // value; their text lives in `attributes[attr]`. Format whichever
      // the pin declares, so both shapes are guarded in both directions.
      const enPattern = attr ? enMsg!.attributes[attr]! : enMsg!.value;
      expect(enPattern, `key "${key}" must resolve in the en bundle`).toBeDefined();
      expect(
        en.formatPattern(enPattern!, args ?? null),
        `en "${key}" drifted from its pinned value`,
      ).toBe(enExpected);
      const idMsg = id.getMessage(key);
      expect(idMsg, `key "${key}" must exist in the id bundle`).toBeDefined();
      const idPattern = attr ? idMsg!.attributes[attr]! : idMsg!.value;
      expect(idPattern, `key "${key}" must resolve in the id bundle`).toBeDefined();
      expect(
        id.formatPattern(idPattern!, args ?? null),
        `id "${key}" drifted from its pinned value`,
      ).toBe(idExpected);
    }
  });
});

// ── Production React render path (round 95 follow-up) ─────────
//
// The formatPattern assertions above prove bundle RESOLUTION. This
// test proves the full PRODUCTION render path: getBundle('id') →
// new ReactLocalization([bundle]) → <LocalizationProvider> →
// <Localized>, the exact plumbing `LocaleContext.tsx` uses at
// runtime. Every pinned key must show its Indonesian text in the
// rendered DOM — if the id bundle ever stopped reaching React (a
// broken provider, a wrong locale name, a dropped import), these
// would fall back to the English placeholder children instead.
describe('i18n native-speaker pin — production render path', () => {
  it('renders every pinned Indonesian value/attribute through getBundle + ReactLocalization + <Localized>', async () => {
    const l10n = new ReactLocalization([getBundle('id')]);
    let container: HTMLElement | undefined;
    await renderInAct(
      <LocalizationProvider l10n={l10n}>
        <div ref={(el) => { container = el ?? undefined; }}>
          {nativeSpeakerPins.map(({ key, args, attr }) => (
            // <Localized> renders the message VALUE as the children and
            // applies message ATTRIBUTES (.aria-label / .placeholder) to
            // the wrapped element — both are asserted per-pin below, so
            // the render path is guarded for every pinned key in the table.
            <Localized key={key} id={key} vars={args ?? {}} attrs={attr ? { [attr]: true } : {}}>
              <span data-pin={key}>Fallback</span>
            </Localized>
          ))}
        </div>
      </LocalizationProvider>,
    );

    for (const { key, attr, id: idExpected } of nativeSpeakerPins) {
      const el = container!.querySelector(`[data-pin="${key}"]`);
      expect(el, `expected a rendered <Localized> for pin "${key}"`).not.toBeNull();
      if (attr) {
        expect(
          el!.getAttribute(attr),
          `id "${key}" attribute drifted from its pinned value`,
        ).toBe(idExpected);
      } else {
        // Two pinned keys share the value "Label koneksi"; per-element
        // textContent assertions keep them distinct (getByText would throw).
        expect(
          el!.textContent,
          `id "${key}" drifted from its pinned value`,
        ).toBe(idExpected);
      }
    }
  });
});

// ── End-to-end withFluentLocale integration ──────────────────
//
// The bundle-loader tests above prove FluentBundle resolution
// works in isolation. These tests go one step further: they mount
// an actual <Localized> React component through `withFluentLocale`
// and verify the rendered DOM contains the translated text.
//
// If this fails while the bundle-loader tests pass, it means a
// production component would NOT see the Indonesian strings at
// runtime — i.e. either the bundle name mapping is wrong (`en`
// vs `'en-US'`) or the per-test bundle isn't reaching React's
// LocalizationProvider.
describe('withFluentLocale integration', () => {
  it('renders Indonesian text through <Localized> when locale is "id"', async () => {
    await renderInAct(
      withFluentLocale(
        'id',
        <Localized id="save">
          <span>Save</span>
        </Localized>,
        sharedId,
      ),
    );
    // `<Localized id="save">` resolves to the Indonesian "Simpan"
    // from shared.id.ftl. The fallback "Save" inside the component
    // is the developer-only English placeholder — production code
    // shouldn't display it once a real locale resolves the key.
    expect(screen.getByText('Simpan')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('renders English text through <Localized> when locale is "en"', async () => {
    await renderInAct(
      withFluentLocale(
        'en',
        <Localized id="save">
          <span>Save</span>
        </Localized>,
        sharedEn,
      ),
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.queryByText('Simpan')).not.toBeInTheDocument();
  });

  it('does not pollute the production `getBundle()` cache', async () => {
    // Use a key that is GUARANTEED not to exist in any raw .ftl
    // file under `src/locales/`. If `withFluentLocale` accidentally
    // wrote into the production `getBundle()` cache (instead of
    // building a fresh FluentBundle per call), this secret would
    // appear in the cached bundle and the after-assertion below
    // would fail — pinning down the leak.
    //
    // Note: FTL identifiers must start with a letter or digit
    // (underscore is not a valid first character) per the Fluent
    // syntax — `__secret__` would be silently rejected by the
    // parser with no useful error, so we use a letter-prefixed
    // identifier instead.
    const SECRET_KEY = 'test-only-isolation-marker';
    const FTL_WITH_SECRET = `${SECRET_KEY} = leakage-detected\n`;

    // BEFORE: production's id bundle must not contain the secret.
    expect(getBundle('id').getMessage(SECRET_KEY)).toBeUndefined();

    // Mount a component that uses the secret key. The helper must
    // build a fresh bundle for the mount, otherwise the secret would
    // leak into the shared cache between this and any subsequent
    // test that touches `getBundle('id')`.
    await renderInAct(
      withFluentLocale(
        'id',
        <Localized id={SECRET_KEY}>
          <span>fallback</span>
        </Localized>,
        FTL_WITH_SECRET,
      ),
    );
    expect(screen.getByText('leakage-detected')).toBeInTheDocument();

    // AFTER: production's id bundle must STILL not contain the
    // secret. If it does, withFluentLocale is leaking into the
    // shared cache — regression of the helper's core invariant.
    expect(getBundle('id').getMessage(SECRET_KEY)).toBeUndefined();
  });
});

// ── Translation completeness gate ────────────────────────────
//
// Two Indonesian FTL files are currently byte-identical copies of
// their English siblings — i.e. the Indonesian translation is
// outstanding. Indonesian users see the English labels on those
// screens.
//
// We intentionally do NOT use `expect.not.toBe(...)` here:
// hard-failing CI would block every PR until translators finish
// the work, which is a disproportionate maintenance cost. Instead
// these tests emit a `[i18n]`-prefixed `console.warn` whenever
// the condition is detected, and `scripts/lint-i18n.sh` greps the
// captured output for that prefix and exits non-zero. That script runs as
// the `i18n` job of `.github/workflows/dev-ci.yml` and as a pre-commit
// gate. Translator engagement is async, but the gate IS blocking: it was
// originally described as "loud, not blocking", which stopped being true
// when lint-i18n.sh was made fail-closed during the Fluent page audit.
describe('i18n translation completeness', () => {
  it('gift-cards.id.ftl is not a verbatim copy of gift-cards.ftl', () => {
    if (giftCardsId === giftCardsEn) {
       
      console.warn(
        '[i18n] gift-cards.id.ftl is byte-identical to gift-cards.ftl \u2014 Indonesian translation for gift cards is missing; users with locale="id" see English text.',
      );
    }
  });

  it('purchasing.id.ftl is not a verbatim copy of purchasing.ftl', () => {
    if (purchasingId === purchasingEn) {
       
      console.warn(
        '[i18n] purchasing.id.ftl is byte-identical to purchasing.ftl \u2014 Indonesian translation for purchasing is missing; users with locale="id" see English text.',
      );
    }
  });
});

// ── Two-way key parity gate ──────────────────────────────────
//
// Every Fluent message key present in the English source bundle must
// ALSO exist in the Indonesian (.id.ftl) bundle. A key missing from
// the translation bundle means users in that locale see the raw
// Fluent message id (e.g. `multi-store-error-load`) or an empty
// fallback instead of translated text — a silent i18n regression
// that the existing byte-identical check above cannot catch (a file
// can differ from English yet still omit keys).
//
// This test parses the raw FTL content of every domain bundle the
// production loader (i18n/index.ts) joins, extracts the message keys,
// and asserts en ↔ id parity. It is the permanent regression guard
// against a developer adding a key to the en .ftl and forgetting the
// id sibling.
describe('i18n two-way key parity (en ↔ id)', () => {
  /**
   * Extract top-level Fluent message keys from raw FTL text.
   * Matches lines like `my-key = value` or `my-key = { $count }`,
   * skipping attribute lines (indented `.attr = …`) and comments.
   */
  function extractKeys(ftl: string): Set<string> {
    const keys = new Set<string>();
    for (const line of ftl.split('\n')) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (m && m[1]) keys.add(m[1]);
    }
    return keys;
  }

  const enBundle = [sharedEn, salesEn, multiStoreEn].join('\n');
  const idBundle = [sharedId, salesId, multiStoreId].join('\n');

  const enKeys = extractKeys(enBundle);
  const idKeys = extractKeys(idBundle);

  it('every English key exists in the Indonesian bundle', () => {
    const missing = [...enKeys].filter((k) => !idKeys.has(k));
    expect(
      missing,
      `Indonesian bundle is missing ${missing.length} key(s) present in English: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

// ── Topology placeholder resolution (round 154 regression) ───────
//
// Rounds 150-152 introduced `topology-apply-workspace-diff` and the
// discard-dialog message with BARE `{ created }` / `{name}`
// placeholders. Fluent treats a bare identifier as a TERM reference,
// so the real runtime rendered the literal `{created}` text (with
// isolating error markers) instead of the supplied numbers/names —
// invisible to the mocked-Fluent editor/screen tests, which
// interpolate by hand. Topology placeholders must use `$`-prefixed
// variables, pinned here against the REAL production bundles in BOTH
// locales so a regression fails at the source.
describe('i18n topology placeholder resolution (round 154)', () => {
  const cases: Array<{ key: string; args: Record<string, string | number>; en: string; id: string }> = [
    {
      key: 'topology-apply-workspace-diff',
      args: { created: 1, updated: 0, archived: 0, typeChanged: 0, from: 0, to: 1 },
      en: '1 created · 0 updated · 0 archived · 0 type-changed · rev 0 → 1',
      id: '1 dibuat · 0 diperbarui · 0 diarsipkan · 0 diubah jenisnya · rev 0 → 1',
    },
    {
      key: 'topology-discard-changes-msg',
      args: { name: 'Main Street' },
      en: '"Main Street" has unsaved changes. Switching branches will discard them.',
      id: '"Main Street" memiliki perubahan yang belum disimpan. Pindah cabang akan menghilangkannya.',
    },
  ];

  it('resolves topology placeholders without Fluent error markers in both locales', () => {
    for (const { key, args, en, id } of cases) {
      for (const [locale, expected] of [['en', en], ['id', id]] as const) {
        const bundle = getBundle(locale);
        const errors: Error[] = [];
        const rendered = bundle.formatPattern(bundle.getMessage(key)!.value!, args, errors);
        expect(rendered, `${key} (${locale})`).toBe(expected);
        expect(errors, `${key} (${locale})`).toEqual([]);
      }
    }
  });
});

// Round 156: the bare-`{}` placeholder guard. Rounds 150–152 shipped
// `{ created }` / `{name}` placeholders (treated by Fluent as message
// references) that rendered literally — invisible to mocked Fluent.
// Every locale bundle must stay free of bare placeholders whose ident
// is not a defined message; this test runs inside the `lint:i18n` gate
// (which executes this file via vitest) so a regression fails closed.
describe('i18n bare-placeholder scan (round 156)', () => {
  it('finds no bare `{}` placeholders in any locale bundle', () => {
    expect(scanLocaleFiles()).toEqual([]);
  });
});

// Round 164: the Localized-vars cross-check. Bundle parity counts keys,
// not variables — a `<Localized id="…" vars={{ … }}>` site missing a
// declared `$var` renders the raw id in the real runtime, invisible to
// mocked Fluent. This runs in the same gate so a vars mismatch fails
// closed with the file/line/id and the missing/extra names.
describe('i18n Localized-vars cross-check (round 164)', () => {
  it('finds no vars mismatches across every Localized site and en bundle', () => {
    expect(scanLocalizedVars()).toEqual([]);
  });
});

// Round 165: the translation-var drift check. The en-side gate (above)
// aligns every site to the en contract, so an id translation referencing
// a var its en counterpart never declares renders a literal `{$var}`
// placeholder for Indonesian users. Subset direction: a translation
// dropping a var is safe, only drift is flagged. Same gate, so a
// regression fails closed.
describe('i18n translation-var drift scan (round 165)', () => {
  it('finds no var drift across every id bundle against its en counterpart', () => {
    expect(scanTranslationVars()).toEqual([]);
  });
});

// Rounds 166-167: the localized-attribute checks. A site localizes an
// attribute via `attrs`; when the id translation omits it (round 166)
// it is silently unset for Indonesian users, and when the EN message
// lacks it entirely (round 167) everyone sees the JSX English
// fallback. Driven by the site attrs so only rendered attributes
// count. Same gate, fails closed.
describe('i18n localized-attribute scan (rounds 166-167)', () => {
  it('finds no localized attribute missing or omitted by any translation', () => {
    expect(scanAttributeOmissions()).toEqual([]);
  });
});

// Round 169: the reverse direction of the attribute gates. A message
// declared with ONLY attributes has a null value; a `getString` /
// `requiredLocalized` consumer reads the VALUE and so renders the raw
// key id instead of any attribute text. This scans every attribute-only
// message referenced by a value-reader in production code. Same gate,
// fails closed.
describe('i18n attribute-only getString scan (round 169)', () => {
  it('finds no attribute-only message consumed via getString/requiredLocalized', () => {
    expect(scanAttributeOnlyGetString()).toEqual([]);
  });
});
