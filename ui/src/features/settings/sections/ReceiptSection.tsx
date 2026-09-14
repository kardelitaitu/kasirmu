// DEAD (2026-09-15 · HEAD f0ad9b170e): the `receipt` route is closed. No entry in SETTINGS_SCREENS
// (screens/registry.ts:27-42) and no NAV_ITEMS/KEPT_SECTIONS key names it, so renderSection
// (SettingsPage.tsx:63-66) can never mount this file and no deep link can reach it. Nothing in
// production imports it; its tests grade UI no user can reach.
// Successor: ../screens/ReceiptFormatSettingsCard.tsx, mounted inside BusinessDefaultsScreen.
// Comment only — the code below is deliberately untouched.
import { Localized } from '@fluent/react';
import type { ReactLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { Card } from '@/components/Card';
import SettingsSelect from '../SettingsSelect';
import type { ReceiptSettingsDto } from '@/api/settings';

export interface ReceiptSectionProps {
  receipt: ReceiptSettingsDto;
  setReceipt: (r: ReceiptSettingsDto) => void;
  setDecimalSep: (v: string) => void;
  markDirty: () => void;
  l10n: ReactLocalization;
}

export default function ReceiptSection({
  receipt,
  setReceipt,
  setDecimalSep,
  markDirty,
  l10n,
}: ReceiptSectionProps) {
  return (
    <Card
      shadow="sm"
      header={<Localized id="settings-section-receipt"><h2 className="settings-section-title">Receipt</h2></Localized>}
    >
      <div className="settings-form">
        {/* Show currency */}
        <div className="settings-field settings-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="receipt-show-currency" className="settings-label">
            <Localized id="settings-toggle-show-currency">
              <span>Show currency symbol on amounts</span>
            </Localized>
          </label>
          <span className="settings-field-input-wrap">
            <label className="settings-toggle" htmlFor="receipt-show-currency">
              <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
              <span className="settings-toggle-switch">
                <input
                  id="receipt-show-currency"
                  type="checkbox"
                  role="switch"
                  checked={receipt.showCurrency}
                  aria-checked={receipt.showCurrency}
                  onChange={(e) => { setReceipt({ ...receipt, showCurrency: e.target.checked }); markDirty(); }}
                />
                <span className="settings-toggle-slider" />
              </span>
            </label>
          </span>
        </div>

        {/* Decimal separator */}
        <div className="settings-field settings-field--horizontal">
          { }
          <label htmlFor="settings-field-decimal-separator" className="settings-label">
            {l10n.getString('settings-field-decimal-separator')}
          </label>
          <span className="settings-field-input-wrap">
            <SettingsSelect
              id="settings-field-decimal-separator"
              value={receipt.decimalSeparator}
              onChange={(v) => {
                setReceipt({ ...receipt, decimalSeparator: v });
                setDecimalSep(v);
                markDirty();
              }}
              options={[
                { value: 'dot', label: l10n.getString('settings-decimal-separator-dot') },
                { value: 'comma', label: l10n.getString('settings-decimal-separator-comma') },
                { value: 'none', label: l10n.getString('settings-decimal-separator-none') },
              ]}
            />
          </span>
        </div>

        {/* Show tax */}
        <div className="settings-field settings-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="receipt-show-tax" className="settings-label">
            <Localized id="settings-toggle-show-tax">
              <span>Show tax line on receipts</span>
            </Localized>
          </label>
          <span className="settings-field-input-wrap">
            <label className="settings-toggle" htmlFor="receipt-show-tax">
              <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
              <span className="settings-toggle-switch">
                <input
                  id="receipt-show-tax"
                  type="checkbox"
                  role="switch"
                  checked={receipt.showTax}
                  aria-checked={receipt.showTax}
                  onChange={(e) => { setReceipt({ ...receipt, showTax: e.target.checked }); markDirty(); }}
                />
                <span className="settings-toggle-slider" />
              </span>
            </label>
          </span>
        </div>

        {/* Paper width */}
        <div className="settings-field settings-field--horizontal">
          { }
          <label htmlFor="settings-field-paper-width" className="settings-label">
            {l10n.getString('settings-field-paper-width')}
          </label>
          <span className="settings-field-input-wrap">
            <SettingsSelect
              id="settings-field-paper-width"
              value={receipt.paperWidth}
              onChange={(v) => { setReceipt({ ...receipt, paperWidth: v }); markDirty(); }}
              options={[
                { value: 'standard', label: l10n.getString('settings-paper-width-standard') },
                { value: 'narrow', label: l10n.getString('settings-paper-width-narrow') },
              ]}
            />
          </span>
        </div>

        {/* Footer */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-field-receipt-footer" className="settings-label">
            {l10n.getString('settings-field-footer')}
          </label>
          <span className="settings-field-input-wrap">
            <Localized id="settings-footer-placeholder" attrs={{ placeholder: true }}>
              <textarea
                className="settings-input settings-textarea"
                id="settings-field-receipt-footer"
                rows={3}
                maxLength={500}
                placeholder="Thank you for shopping!"
                value={receipt.footer}
                onChange={(e) => { setReceipt({ ...receipt, footer: e.target.value }); markDirty(); }}
              />
            </Localized>
            <span className="settings-hint settings-char-count">
              {receipt.footer.length}/500
            </span>
          </span>
        </div>

        {/* Show table number */}
        <div className="settings-field settings-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- @fluent/react Localized wrapper */}
          <label htmlFor="receipt-show-table-number" className="settings-label">
            <Localized id="settings-toggle-show-table-number">
              <span>Show table number on cart and receipts</span>
            </Localized>
          </label>
          <span className="settings-field-input-wrap">
            <label className="settings-toggle" htmlFor="receipt-show-table-number">
              <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
              <span className="settings-toggle-switch">
                <input
                  id="receipt-show-table-number"
                  type="checkbox"
                  role="switch"
                  checked={receipt.showTableNumber}
                  aria-checked={receipt.showTableNumber}
                  onChange={(e) => { setReceipt({ ...receipt, showTableNumber: e.target.checked }); markDirty(); }}
                />
                <span className="settings-toggle-slider" />
              </span>
            </label>
          </span>
        </div>

        {/* Paper Margins */}
        <div className="settings-field settings-field--horizontal">
          <span className="settings-label settings-label--section">
            <Localized id="settings-margins-heading">
              <span>Paper Margins (mm)</span>
            </Localized>
          </span>
          <span className="settings-field-input-wrap" />
        </div>

        <div className="settings-field settings-field--horizontal">
          <label htmlFor="receipt-margin-top" className="settings-label">
            {l10n.getString('settings-margin-top')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="number"
              id="receipt-margin-top"
              min={0}
              max={20}
              step={1}
              value={receipt.marginTop}
              onChange={(e) => { setReceipt({ ...receipt, marginTop: Math.max(0, Math.min(20, Number(e.target.value) || 0)) }); markDirty(); }}
            />
          </span>
        </div>

        <div className="settings-field settings-field--horizontal">
          <label htmlFor="receipt-margin-bottom" className="settings-label">
            {l10n.getString('settings-margin-bottom')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="number"
              id="receipt-margin-bottom"
              min={0}
              max={20}
              step={1}
              value={receipt.marginBottom}
              onChange={(e) => { setReceipt({ ...receipt, marginBottom: Math.max(0, Math.min(20, Number(e.target.value) || 0)) }); markDirty(); }}
            />
          </span>
        </div>

        <div className="settings-field settings-field--horizontal">
          <label htmlFor="receipt-margin-left" className="settings-label">
            {l10n.getString('settings-margin-left')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="number"
              id="receipt-margin-left"
              min={0}
              max={20}
              step={1}
              value={receipt.marginLeft}
              onChange={(e) => { setReceipt({ ...receipt, marginLeft: Math.max(0, Math.min(20, Number(e.target.value) || 0)) }); markDirty(); }}
            />
          </span>
        </div>

        <div className="settings-field settings-field--horizontal">
          <label htmlFor="receipt-margin-right" className="settings-label">
            {l10n.getString('settings-margin-right')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="number"
              id="receipt-margin-right"
              min={0}
              max={20}
              step={1}
              value={receipt.marginRight}
              onChange={(e) => { setReceipt({ ...receipt, marginRight: Math.max(0, Math.min(20, Number(e.target.value) || 0)) }); markDirty(); }}
            />
          </span>
        </div>
      </div>
    </Card>
  );
}
