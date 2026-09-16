/* eslint-disable jsx-a11y/label-has-associated-control -- <Localized> blocks static analysis */
import { useContext, useState, useCallback } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Localized } from '@/frontend/shared/Localized';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { openUpgradePricing } from '@/utils/upgrade';
import { detectDefaultCurrency } from '@/utils/currency';
import LiveSetupPreview from './components/LiveSetupPreview';
import './SetupWizard.css';

// ── Types ──────────────────────────────────────────────────────────

/** Supported store-type presets for quick-setup. */
export type Preset = 'simple-retail' | 'restaurant' | 'full-store' | 'cafe' | 'franchise' | 'custom';

/** A single feature toggle shown in the wizard section. */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
}

/** Aggregate state of the entire wizard — chosen preset, per-feature toggles, and the default currency. */
export interface WizardState {
  preset: Preset | null;
  features: Record<string, boolean>;
  default_currency: string;
}

// ── Constants ──────────────────────────────────────────────────────

const STEPS = [
  'Store Type',
  'Payments',
  'Products',
  'Staff',
  'Hardware',
  'Business Rules',
  'Data & Cloud',
  'Review',
] as const;

/** Total number of steps in the setup wizard. */
// eslint-disable-next-line react-refresh/only-export-components
export const TOTAL_STEPS = STEPS.length;

/** Suffixes used to build the FTL id for each step (e.g. `setup-step-store-type`). */
const STEP_IDS = [
  'store-type',
  'payments',
  'products',
  'staff',
  'hardware',
  'business-rules',
  'data-cloud',
  'review',
] as const;

interface PresetOption {
  value: Preset;
  emoji: string;
  name: string;
  description: string;
}

const PRESETS: PresetOption[] = [
  {
    value: 'simple-retail',
    emoji: '🛒',
    name: 'Simple Retail',
    description: 'Barcode scan, cash, receipt, inventory, tax — all essentials',
  },
  {
    value: 'restaurant',
    emoji: '🍽️',
    name: 'Restaurant',
    description: 'Tables, KDS, discounts, staff login — built for dining',
  },
  {
    value: 'full-store',
    emoji: '🏪',
    name: 'Full Store',
    description: 'Everything except cloud — payments, staff, loyalty, reports',
  },
  {
    value: 'cafe',
    emoji: '☕',
    name: 'Cafe / Bakery',
    description: 'Quick-service with kitchen display, cash+card, discounts',
  },
  {
    value: 'franchise',
    emoji: '🏢',
    name: 'Franchise',
    description: 'Multi-store, multi-terminal, restaurant + full admin stack',
  },
  {
    value: 'custom',
    emoji: '⚙️',
    name: 'Custom',
    description: 'Start from scratch — enable exactly what you need',
  },
];

/** Features shown per wizard step. */
const STEP_FEATURES: { sectionId: string; title: string; features: FeatureDef[] }[] = [
  // Step 2 — Payments
  {
    sectionId: 'payments',
    title: 'Payment Methods',
    features: [
      { key: 'cash-payment', label: 'Cash', description: 'Accept cash payments and track cash drawer' },
      { key: 'card-payment', label: 'Card', description: 'Accept debit and credit card payments' },
      { key: 'multi-currency', label: 'Multi-Currency', description: 'Support multiple currencies with exchange rates' },
    ],
  },
  // Step 3 — Products
  {
    sectionId: 'products',
    title: 'Products & Inventory',
    features: [
      { key: 'inventory-tracking', label: 'Inventory Tracking', description: 'Track stock levels per product with alerts' },
      { key: 'product-variants', label: 'Product Variants', description: 'Size, colour, flavour variants per product' },
      { key: 'categories-enabled', label: 'Categories', description: 'Group products by category with colour coding' },
    ],
  },
  // Step 4 — Staff
  {
    sectionId: 'staff',
    title: 'Staff Management',
    features: [
      { key: 'staff-login', label: 'Staff Login', description: 'PIN or password login for cashiers' },
      { key: 'staff-roles', label: 'Staff Roles', description: 'Owner, manager, cashier permission levels' },
      { key: 'shift-management', label: 'Shift Management', description: 'Open/close shifts with cash reconciliation' },
      { key: 'audit-log', label: 'Audit Log', description: 'Immutable log of sensitive actions' },
    ],
  },
  // Step 5 — Hardware
  {
    sectionId: 'hardware',
    title: 'Hardware & Peripherals',
    features: [
      { key: 'barcode-scanning', label: 'Barcode Scanner', description: 'USB, serial, or Bluetooth barcode scanning' },
      { key: 'receipt-printing', label: 'Receipt Printer', description: 'USB, serial, or network receipt printing' },
      { key: 'cash-drawer', label: 'Cash Drawer', description: 'Automatic cash drawer via printer GPIO' },
      { key: 'customer-display', label: 'Customer Display', description: 'Secondary display facing the customer' },
      { key: 'nfc-reader', label: 'NFC Reader', description: 'Contactless payment and loyalty card reading' },
    ],
  },
  // Step 6 — Business Rules
  {
    sectionId: 'business-rules',
    title: 'Business Rules',
    features: [
      { key: 'discount-engine', label: 'Discounts', description: 'Percentage and fixed-amount discounts on items or cart' },
      { key: 'tax-engine', label: 'Tax Engine', description: 'Tax inclusive/exclusive with configurable rates' },
      { key: 'loyalty-program', label: 'Loyalty Program', description: 'Customer points, tiers, and rewards' },
      { key: 'promotions-engine', label: 'Promotions', description: 'Buy-X-get-Y, time-limited offers, bundles' },
      { key: 'product-bundles', label: 'Product Bundles', description: 'Sell multiple SKUs together as a single item' },
    ],
  },
  // Step 7 — Data & Cloud
  {
    sectionId: 'data-cloud',
    title: 'Data, Reporting & Cloud',
    features: [
      { key: 'reporting', label: 'Reporting', description: 'Sales, inventory, and shift reports' },
      { key: 'analytics', label: 'Analytics', description: 'Charts, top products, hourly heatmap, CSV exports' },
      { key: 'export-import', label: 'Export & Import', description: 'Encrypted data export and import (.ozpkg)' },
      { key: 'cloud-sync', label: 'Cloud Sync', description: 'Sync data to cloud PostgreSQL with backup' },
      { key: 'multi-store', label: 'Multi-Store', description: 'Manage multiple store locations' },
      { key: 'multi-terminal', label: 'Multi-Terminal', description: 'Multiple POS terminals per store' },
      { key: 'plugin-system', label: 'Plugin System', description: 'Third-party plugins and custom drivers' },
    ],
  },
];

/** Feature keys enabled by default for each preset. */
const PRESET_FEATURES: Record<Preset, string[]> = {
  'simple-retail': [
    'barcode-scanning',
    'receipt-printing',
    'cash-payment',
    'inventory-tracking',
    'categories-enabled',
    'tax-engine',
  ],
  restaurant: [
    'receipt-printing',
    'cash-payment',
    'inventory-tracking',
    'categories-enabled',
    'discount-engine',
    'tax-engine',
    'staff-login',
  ],
  'full-store': [
    'cash-payment',
    'card-payment',
    'multi-currency',
    'inventory-tracking',
    'product-variants',
    'categories-enabled',
    'staff-login',
    'staff-roles',
    'shift-management',
    'audit-log',
    'barcode-scanning',
    'receipt-printing',
    'cash-drawer',
    'customer-display',
    'nfc-reader',
    'discount-engine',
    'tax-engine',
    'loyalty-program',
    'promotions-engine',
    'product-bundles',
    'reporting',
    'analytics',
    'export-import',
  ],
  cafe: [
    'cash-payment',
    'card-payment',
    'receipt-printing',
    'customer-display',
    'discount-engine',
    'tax-engine',
    'promotions-engine',
  ],
  franchise: [
    'cash-payment',
    'card-payment',
    'multi-currency',
    'inventory-tracking',
    'product-variants',
    'categories-enabled',
    'staff-login',
    'staff-roles',
    'shift-management',
    'audit-log',
    'receipt-printing',
    'discount-engine',
    'tax-engine',
    'reporting',
    'analytics',
    'cloud-sync',
    'multi-store',
    'multi-terminal',
  ],
  custom: [],
};

/** Human-readable labels for review summary. */
const FEATURE_LABELS: Record<string, string> = {
  'cash-payment': 'Cash',
  'card-payment': 'Card',
  'multi-currency': 'Multi-Currency',
  'inventory-tracking': 'Inventory',
  'product-variants': 'Variants',
  'categories-enabled': 'Categories',
  'staff-login': 'Staff Login',
  'staff-roles': 'Staff Roles',
  'shift-management': 'Shifts',
  'audit-log': 'Audit Log',
  'barcode-scanning': 'Barcode',
  'receipt-printing': 'Receipts',
  'cash-drawer': 'Cash Drawer',
  'customer-display': 'Customer Display',
  'nfc-reader': 'NFC',
  'discount-engine': 'Discounts',
  'tax-engine': 'Tax',
  'loyalty-program': 'Loyalty',
  'promotions-engine': 'Promotions',
  'product-bundles': 'Bundles',
  'reporting': 'Reports',
  'analytics': 'Analytics',
  'export-import': 'Export/Import',
  'cloud-sync': 'Cloud Sync',
  'multi-store': 'Multi-Store',
  'multi-terminal': 'Multi-Terminal',
  'plugin-system': 'Plugins',
};

const PRESET_NAMES: Record<Preset, string> = {
  'simple-retail': 'Simple Retail',
  restaurant: 'Restaurant',
  'full-store': 'Full Store',
  cafe: 'Cafe / Bakery',
  franchise: 'Franchise',
  custom: 'Custom',
};

// ── Props ──────────────────────────────────────────────────────────

export interface SetupWizardProps {
  /** Called when the wizard completes with the chosen state. */
  onComplete?: (state: WizardState) => void;
  /** Called to skip the wizard entirely. */
  onSkip?: () => void;
  /** Called to dismiss the completion screen without touching the DB. */
  onLaunch?: () => void;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * 8-step first-run Setup Wizard.
 *
 * Steps:
 *   1. Store Type / Preset  5. Hardware
 *   2. Payments             6. Business Rules
 *   3. Products             7. Data & Cloud
 *   4. Staff                8. Review & Confirm
 */
export default function SetupWizard({ onComplete, onSkip, onLaunch }: SetupWizardProps) {
  const { l10n } = useLocalization();
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [completed, setCompleted] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState(detectDefaultCurrency);
  // Note: internal state uses camelCase, but WizardState and API use
  // default_currency (snake_case) to match the Rust backend field name.

  // ── Preset selection ────────────────────────────────────────────
  const handleSelectPreset = useCallback((p: Preset) => {
    setPreset(p);
    // Convert the array of feature keys to a boolean record.
    const enabled: Record<string, boolean> = {};
    for (const key of PRESET_FEATURES[p]) {
      enabled[key] = true;
    }
    setFeatures(enabled);
    // Advance to step 2 so the user can customise.
    setStep(1);
  }, []);

  // ── Feature toggle ──────────────────────────────────────────────
  const toggleFeature = useCallback((key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Navigation ──────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    }
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  }, [step]);

  const handleComplete = useCallback(() => {
    setCompleted(true);
    if (onComplete && preset) {
      onComplete({ preset, features, default_currency: defaultCurrency });
    }
  }, [onComplete, preset, features, defaultCurrency]);
  // ── All-features list for review ─────────────────────────────────

  const allFeatures = STEP_FEATURES.flatMap((s) => s.features);
  const enabledCount = Object.values(features).filter(Boolean).length;

  // ── Step indicator dots ──────────────────────────────────────────
  const stepIndicator = (
    <nav className="setup-progress" aria-label={l10n.getString('setup-progress-aria')}>
        {STEPS.map((label, i) => {
          const stepLabel = requiredLocalized(l10n, `setup-step-${STEP_IDS[i]}`);
          return (
            <span key={label} className="setup-step-group">
              <span
                className={
                  i === step
                    ? 'setup-step-dot setup-step-dot--active'
                    : i < step || (completed && i === TOTAL_STEPS - 1)
                      ? 'setup-step-dot setup-step-dot--completed'
                      : 'setup-step-dot setup-step-dot--pending'
                }
                aria-current={i === step ? 'step' : undefined}
                aria-label={requiredLocalized(l10n, 'setup-step-aria', { number: i + 1, label: stepLabel })}
              >
                {i < step || (completed && i === TOTAL_STEPS - 1) ? '✓' : i + 1}
              </span>
              {i < TOTAL_STEPS - 1 && (
                <span
                  className={
                    i < step
                      ? 'setup-step-line setup-step-line--completed'
                      : 'setup-step-line setup-step-line--pending'
                  }
                  aria-hidden="true"
                />
              )}
            </span>
          );
        })}
      </nav>
  );

  // ── Completion screen ───────────────────────────────────────────
  if (completed) {
    return (
      <div className="setup-page">
        <div className="setup-container">
          <div className="setup-header">
            <Localized id="setup-logo">
              <div className="setup-logo">kasir.mu</div>
            </Localized>
          </div>

          {stepIndicator}

          <div className="setup-complete">
            <div className="setup-complete-check" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <Localized id="setup-complete-title">
              <h1 className="setup-complete-title">All Set!</h1>
            </Localized>
            <Localized id="setup-complete-desc" vars={{ preset: requiredLocalized(l10n, `setup-preset-${preset ?? 'custom'}`) }}>
              <p className="setup-complete-desc">
                {PRESET_NAMES[preset ?? 'custom']} &mdash; ready to go.
              </p>
            </Localized>
            <Localized id="setup-complete-features" vars={{ count: String(enabledCount) }}>
              <p className="setup-complete-features">
                {enabledCount} feature{enabledCount !== 1 ? 's' : ''} enabled.
              </p>
            </Localized>
            <Button size="lg" onClick={() => onLaunch?.()}>
              <Localized id="setup-launch">Launch kasir.mu</Localized>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Navigation footer ────────────────────────────────────────────
  const showBack = step > 0;
  const showSkip = step === 0 && !preset;
  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div className="setup-page">
      <div className="setup-container">
        {/* ── Header ──────────────────────────────── */}
        <div className="setup-header">
          <Localized id="setup-logo">
            <div className="setup-logo">kasir.mu</div>
          </Localized>
          <Localized id="setup-tagline">
            <div className="setup-tagline">Point of Sale — Simplified</div>
          </Localized>
        </div>

        {stepIndicator}

        {/* ── Step content ────────────────────────── */}
        <div className="setup-step-content" key={step}>
          <div className="setup-step-panel">
            {step === 0 && (
              <StepPreset
                selected={preset}
                onSelect={handleSelectPreset}
              />
            )}

            {step >= 1 && step <= 6 && (
              <StepFeatures
                sectionId={STEP_FEATURES[step - 1]!.sectionId}
                title={STEP_FEATURES[step - 1]!.title}
                features={STEP_FEATURES[step - 1]!.features}
                enabled={features}
                onToggle={toggleFeature}
              />
            )}

            {/* Step 2 — QRIS setup gate (C1 Free→Plus trigger): QRIS is a
                Plus+ feature. The checkout path is gated in PaymentModal;
                this row gates the onboarding surface — on tiers without
                supports_qris() it renders the upgrade prompt instead of
                setup UI. It never writes a persisted feature toggle (the
                wizard feature keys map to the Rust Feature enum, and QRIS
                is not one of them — the gate is purely tier-driven). */}
            {step === 1 && <QrisSetupRow />}

            {step === 7 && (
              <StepReview
                preset={preset}
                features={features}
                allFeatures={allFeatures}
                defaultCurrency={defaultCurrency}
                onDefaultCurrencyChange={setDefaultCurrency}
              />
            )}

            {/* Side preview panel on preset & review steps */}
            {(step === 0 || step === 7) && (
              <LiveSetupPreview
                selectedFeatures={new Set(Object.keys(features).filter((k) => features[k]))}
              />
            )}
          </div>
        </div>

        {/* ── Navigation ──────────────────────────── */}
        <div className="setup-nav">
          <div className="setup-nav-left">
            {showBack && (
              <Button variant="ghost" onClick={goBack}>
                <Localized id="setup-back">Back</Localized>
              </Button>
            )}
          </div>

          <div className="setup-nav-right">
            {showSkip && onSkip && (
              <button
                type="button"
                className="setup-skip-btn"
                onClick={onSkip}
              >
                <Localized id="setup-skip">Skip setup</Localized>
              </button>
            )}

            {isLastStep ? (
              <Button
                variant="primary"
                size="lg"
                onClick={handleComplete}
                disabled={!preset}
              >
                <Localized id="setup-finish">Complete Setup</Localized>
              </Button>
            ) : (
              step > 0 && (
                <Button variant="primary" onClick={goNext}>
                  <Localized id="setup-next">Next</Localized>
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Preset Selection ────────────────────────────────────────

function StepPreset({
  selected,
  onSelect,
}: {
  selected: Preset | null;
  onSelect: (p: Preset) => void;
}) {
  const { l10n } = useLocalization();
  return (
    <>
      <Localized id="setup-preset-question">
        <h2 className="setup-step-title">What kind of store are you running?</h2>
      </Localized>
      <Localized id="setup-preset-desc">
        <p className="setup-step-desc">
          Choose a preset to get started quickly, or customise every feature later.
        </p>
      </Localized>

      <div className="setup-presets" role="radiogroup" aria-label={l10n.getString('setup-preset-group-aria')}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected === p.value}
              className={
                selected === p.value
                  ? 'setup-preset-card setup-preset-card--selected'
                  : 'setup-preset-card'
              }
              onClick={() => onSelect(p.value)}
            >
              <span className="setup-preset-emoji" aria-hidden="true">
                {p.emoji}
              </span>
              <Localized id={`setup-preset-${p.value}`}>
                <span className="setup-preset-name">{p.name}</span>
              </Localized>
              <Localized id={`setup-preset-${p.value}-desc`}>
                <span className="setup-preset-desc">{p.description}</span>
              </Localized>
            </button>
          ))}          </div>
    </>
  );
}

// ── Steps 2–7: Feature Toggles ──────────────────────────────────────

function StepFeatures({
  sectionId,
  title,
  features,
  enabled,
  onToggle,
}: {
  sectionId: string;
  title: string;
  features: FeatureDef[];
  enabled: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const { l10n } = useLocalization();
  const localizedTitle = requiredLocalized(l10n, `setup-features-section-${sectionId}`);

  return (
    <>
      <Localized id="setup-features-title" vars={{ title: localizedTitle }}>
        <h2 className="setup-step-title">{title}</h2>
      </Localized>
      <Localized id="setup-features-desc">
        <p className="setup-step-desc">
          Toggle the features you need. You can change these later.
        </p>
      </Localized>

      <div className="setup-features" role="group" aria-label={l10n.getString('setup-features-group-aria', { title: localizedTitle })}>
          {features.map((f) => {
            const isOn = !!enabled[f.key];
            // All 27 setup-feature-*-label keys resolve in both bundles,
            // so the plain-key fallback this line chained through was dead
            // code behind a stale comment claiming the id bundle had only
            // 12 of 27. setupWizardFeatureLabels.test.ts now asserts that.
            const label = requiredLocalized(l10n, `setup-feature-${f.key}-label`);
            return (
              <label
                key={f.key}
                className="setup-feature-row"
              >
                <div className="setup-feature-info">
                  <Localized id={`setup-feature-${f.key}-label`}>
                    <div className="setup-feature-name">{f.label}</div>
                  </Localized>
                  <Localized id={`setup-feature-${f.key}-desc`}>
                    <div className="setup-feature-desc">{f.description}</div>
                  </Localized>
                </div>

                <span className="toggle-switch">
                  <Localized id="setup-features-toggle-aria" attrs={{ 'aria-label': true }} vars={{ label }}>
                    <input
                      id={`setup-feature-${f.key}`}
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onToggle(f.key)}
                      aria-label={requiredLocalized(l10n, 'setup-feature-toggle-aria', { name: label })}
                    />
                  </Localized>
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </span>
              </label>
            );
          })}          </div>
    </>
  );
}

// ── Step 2 (Payments): QRIS setup row ──────────────────────────────
//
// Gates QRIS setup in onboarding per `supports_qris()` (subscription-tiers.md
// §3): a Free-tier merchant sees the upgrade prompt instead of QRIS setup UI
// (Fluent key `setup-qris-upgrade-required`), while Plus+ tiers see QRIS as
// an included payment method. `caps === null` while loading / on IPC failure
// renders the available state — gates degrade open rather than blocking
// onboarding (C2.2 convention).
function QrisSetupRow() {
  const { l10n } = useLocalization();
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const { caps } = useSubscription();
  const locked = !!caps && !caps.supportsQris;

  return (
    <div
      className={`setup-feature-row setup-qris-row${locked ? ' setup-qris-row--locked' : ''}`}
      data-testid="setup-qris-row"
    >
      <div className="setup-feature-info">
        <div className="setup-feature-name">{l10n.getString('setup-qris-label')}</div>
        <div className="setup-feature-desc">
          {locked
            ? l10n.getString('setup-qris-upgrade-required')
            : l10n.getString('setup-qris-available')}
        </div>
      </div>
      {locked ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => openUpgradePricing(locale, 'plus')}
        >
          {l10n.getString('setup-qris-upgrade-cta')}
        </Button>
      ) : (
        <span className="setup-qris-badge" role="status">
          {l10n.getString('setup-qris-included')}
        </span>
      )}
    </div>
  );
}

// ── Step 8: Review & Confirm ───────────────────────────────────────

function StepReview({
  preset,
  features,
  allFeatures,
  defaultCurrency,
  onDefaultCurrencyChange,
}: {
  preset: Preset | null;
  features: Record<string, boolean>;
  allFeatures: FeatureDef[];
  defaultCurrency: string;
  onDefaultCurrencyChange: (v: string) => void;
}) {
  const { l10n } = useLocalization();
  const enabledFeatures = allFeatures.filter((f) => features[f.key]);
  const disabledFeatures = allFeatures.filter((f) => !features[f.key]);

  return (
    <>
      <Localized id="setup-review-title">
        <h2 className="setup-step-title">Review Your Setup</h2>
      </Localized>
      <Localized id="setup-review-desc">
        <p className="setup-step-desc">
          Here&rsquo;s a summary of your configuration. You can change anything later.
        </p>
      </Localized>

      <div className="setup-review-list">
        {/* Preset summary */}
        <Card padding="md" shadow="sm">
          <p className="setup-preset-summary">
            {l10n.getString('setup-review-preset', {
              name: preset ? requiredLocalized(l10n, `setup-preset-${preset}`) : requiredLocalized(l10n, 'setup-review-none'),
            })}
          </p>
        </Card>

        {/* Enabled features */}
        <div className="setup-review-section">
          <h3 className="setup-review-section-title">
            {l10n.getString('setup-review-enabled', { count: enabledFeatures.length })}
          </h3>
          <div className="setup-tag-cloud">
            {enabledFeatures.length === 0 ? (
              <Localized id="setup-review-none">
                <span className="setup-tag setup-tag--disabled">None</span>
              </Localized>
            ) : (
              enabledFeatures.map((f) => (
                <Localized key={f.key} id={`setup-feature-${f.key}`}>
                  <span className="setup-tag setup-tag--enabled">
                    {FEATURE_LABELS[f.key] ?? f.label}
                  </span>
                </Localized>
              ))
            )}
          </div>
        </div>

        {/* Default currency */}
        <div className="setup-review-section">
          <Localized id="setup-default-currency-label">
            <h3 className="setup-review-section-title">Default Currency</h3>
          </Localized>
          <select
            className="setup-currency-select"
            value={defaultCurrency}
            onChange={(e) => onDefaultCurrencyChange(e.target.value)}
            aria-label={l10n.getString('setup-default-currency-label')}
          >
            <option value="IDR">IDR — Indonesian Rupiah (Rp)</option>
            <option value="USD">USD — US Dollar ($)</option>
          </select>
        </div>

        {/* Disabled features */}
        <div className="setup-review-section">
          <h3 className="setup-review-section-title">
            {l10n.getString('setup-review-disabled', { count: disabledFeatures.length })}
          </h3>
          <div className="setup-tag-cloud">
            {disabledFeatures.length === 0 ? (
              <Localized id="setup-review-all-on">
                <span className="setup-tag setup-tag--enabled">Everything on!</span>
              </Localized>
            ) : (
              disabledFeatures.slice(0, 20).map((f) => (
                <Localized key={f.key} id={`setup-feature-${f.key}`}>
                  <span className="setup-tag setup-tag--disabled">
                    {FEATURE_LABELS[f.key] ?? f.label}
                  </span>
                </Localized>
              ))
            )}
            {disabledFeatures.length > 20 && (
              <span className="setup-tag setup-tag--disabled">
                {l10n.getString('setup-review-more', { count: disabledFeatures.length - 20 })}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
