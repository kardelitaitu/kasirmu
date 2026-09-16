import { useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { formatMoney, type Money } from '@/types/domain';
import type { PrintSalesReceiptArgs, MoneyDto } from '@/api/sales';
import './ReceiptPreview.css';

/** Convert a MoneyDto (camelCase from IPC) to a Money (snake_case domain type). */
function dtoToMoney(dto: MoneyDto): Money {
  return { minor_units: dto.minorUnits, currency: dto.currency };
}

export interface ReceiptPreviewProps {
  /** Full receipt data (same shape as printSalesReceipt args). */
  receipt: PrintSalesReceiptArgs;
  /** Whether the receipt is still being generated/loaded. */
  loading?: boolean;
  /** Called when the user clicks "Print". */
  onPrint: () => void;
  /** Called when the user dismisses without printing. */
  onSkip: () => void;
  /** Optional payment link template for QR code rendering. */
  paymentLinkTemplate?: string;
  /** Whether to show a barcode on the receipt. */
  showBarcode?: boolean;
}

/**
 * Styled receipt preview shown after a successful sale, before the physical
 * receipt is printed. Users can review the receipt, then choose Print or Skip.
 */
export default function ReceiptPreview({
  receipt,
  loading = false,
  onPrint,
  onSkip,
  paymentLinkTemplate,
  showBarcode = false,
}: ReceiptPreviewProps) {
  const { l10n } = useLocalization();

  const separator = '─'.repeat(40);
  const thinSep = '·'.repeat(40);

  const formatLine = (name: string, qty: number, price: MoneyDto, total: MoneyDto) => {
    const nameStr = name.length > 22 ? `${name.slice(0, 20)}…` : name;
    const qtyStr = String(qty);
    const priceStr = formatMoney(dtoToMoney(price));
    const totalStr = formatMoney(dtoToMoney(total));
    return `${nameStr.padEnd(22)} ${qtyStr.padStart(3)}  ${priceStr.padStart(6)} ${totalStr.padStart(6)}`;
  };

  // Build the QR code URL if a template is provided
  const qrUrl = paymentLinkTemplate
    ? paymentLinkTemplate
        .replace('{receipt}', receipt.receiptNumber)
        .replace('{amount}', String(receipt.total.minorUnits))
    : null;

  return (
    <div className="receipt-preview" role="region" aria-label={l10n.getString('receipt-preview-aria', null, 'Receipt Preview')}>
      <div className="receipt-preview-paper">
        {/* ── Store Header ── */}
        <div className="receipt-preview-header">
          <div className="receipt-preview-store-name">
            {l10n.getString('receipt-preview-store-name', null, 'kasir.mu Store')}
          </div>
          <div className="receipt-preview-receipt-info">
            <span className="receipt-preview-date">{receipt.date}</span>
            <span className="receipt-preview-receipt-number">{receipt.receiptNumber}</span>
          </div>
        </div>

        <div className="receipt-preview-separator">{separator}</div>

        {/* ── Column Headers ── */}
        <div className="receipt-preview-col-headers">
          <span className="receipt-preview-col-name">{l10n.getString('receipt-preview-col-item', null, 'Item')}</span>
          <span className="receipt-preview-col-qty">{l10n.getString('receipt-preview-col-qty', null, 'Qty')}</span>
          <span className="receipt-preview-col-price">{l10n.getString('receipt-preview-col-price', null, 'Price')}</span>
          <span className="receipt-preview-col-total">{l10n.getString('receipt-preview-col-total', null, 'Total')}</span>
        </div>

        <div className="receipt-preview-separator-thin">{thinSep}</div>

        {/* ── Line Items ── */}
        <div className="receipt-preview-items">
          {receipt.items.map((item, i) => (
            <div key={i} className="receipt-preview-item">
              <span className="receipt-preview-item-line">
                {formatLine(item.name, item.quantity, item.unitPrice, item.totalPrice)}
              </span>
              {item.taxAmount && (
                <span className="receipt-preview-item-tax">
                  Tax: {formatMoney(dtoToMoney(item.taxAmount))}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="receipt-preview-separator">{separator}</div>

        {/* ── Totals ── */}
        <div className="receipt-preview-totals">
          <div className="receipt-preview-total-line">
            <span className="receipt-preview-total-label">
              {l10n.getString('receipt-preview-subtotal', null, 'SUBTOTAL:')}
            </span>
            <span className="receipt-preview-total-value">
              {formatMoney(dtoToMoney(receipt.subtotal))}
            </span>
          </div>
          {receipt.tax && (
            <div className="receipt-preview-total-line">
              <span className="receipt-preview-total-label">
                {l10n.getString('receipt-preview-tax', null, 'TAX:')}
              </span>
              <span className="receipt-preview-total-value">
                {formatMoney(dtoToMoney(receipt.tax))}
              </span>
            </div>
          )}
          <div className="receipt-preview-separator">{separator}</div>
          <div className="receipt-preview-grand-total">
            <span className="receipt-preview-grand-label">
              {l10n.getString('receipt-preview-total', null, 'TOTAL:')}
            </span>
            <span className="receipt-preview-grand-value">
              {formatMoney(dtoToMoney(receipt.total))}
            </span>
          </div>
        </div>

        {/* ── Payments ── */}
        <div className="receipt-preview-payments">
          {receipt.payments.map((pmt, i) => (
            <div key={i} className="receipt-preview-payment-line">
              <span className="receipt-preview-payment-method">{pmt.method}</span>
              <span className="receipt-preview-payment-amount">
                {formatMoney(dtoToMoney(pmt.amount))}
              </span>
            </div>
          ))}
          {receipt.payments.map((pmt) =>
            pmt.change ? (
              <div key={`change-${pmt.method}`} className="receipt-preview-payment-line">
                <span className="receipt-preview-payment-method">
                  {l10n.getString('receipt-preview-change', null, 'CHANGE:')}
                </span>
                <span className="receipt-preview-payment-amount">
                  {formatMoney(dtoToMoney(pmt.change))}
                </span>
              </div>
            ) : null,
          )}
        </div>

        {/* ── Barcode ── */}
        {showBarcode && (
          <div className="receipt-preview-barcode">
            <div className="receipt-preview-barcode-visual" aria-hidden="true">
              {generateBarcodeBars(receipt.receiptNumber)}
            </div>
            <div className="receipt-preview-barcode-text">{receipt.receiptNumber}</div>
          </div>
        )}

        {/* ── QR Code (placeholder) ── */}
        {qrUrl && (
          <div className="receipt-preview-qr">
            <div className="receipt-preview-qr-label">
              {l10n.getString('receipt-preview-qr-label', null, 'Scan to pay')}
            </div>
            <div className="receipt-preview-qr-visual" aria-label={qrUrl} title={qrUrl}>
              <svg viewBox="0 0 33 33" className="receipt-preview-qr-svg" role="img" aria-label={l10n.getString('receipt-preview-qr-aria', null, 'Payment QR code')}>
                {generateQrModules(33).map((row, y) =>
                  row.map((filled, x) =>
                    filled ? (
                      <rect
                        key={`${x}-${y}`}
                        x={x}
                        y={y}
                        width={1}
                        height={1}
                        fill="var(--color-fg)"
                      />
                    ) : null,
                  ),
                )}
              </svg>
            </div>
            <div className="receipt-preview-qr-url">{qrUrl}</div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="receipt-preview-footer">
          {l10n.getString('receipt-preview-thanks', null, 'Thank you for your purchase!')}
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="receipt-preview-actions">
        <Button variant="ghost" onClick={onSkip} disabled={loading}>
          {l10n.getString('receipt-preview-skip', null, 'Skip')}
        </Button>
        <Button variant="primary" onClick={onPrint} loading={loading}>
          {l10n.getString('receipt-preview-print', null, 'Print Receipt')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Generate a simplified Code128 barcode-like pattern.
 * Uses vertical bars of varying widths proportional to the ASCII values.
 */
function generateBarcodeBars(code: string): string {
  const chars = code.split('');
  const bars = chars.map((c) => {
    const val = c.charCodeAt(0);
    const width = (val % 4) + 1;
    return '█'.repeat(width) + ' '.repeat(5 - width);
  });
  return '  ███ ' + bars.join('') + ' ███  ';
}

/**
 * Generate a simplified QR code module grid for preview.
 * Creates a deterministic pattern based on a hash of the position.
 */
function generateQrModules(size: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    const row: boolean[] = [];
    for (let j = 0; j < size; j++) {
      row.push(false);
    }
    grid.push(row);
  }

  // Finder patterns (3 corners)
  const drawFinder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isOuter = y === 0 || y === 6 || x === 0 || x === 6;
        const isInner = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        if (isOuter || isInner) {
          if (ox + x < size && oy + y < size) {
             
            grid[oy + y]![ox + x] = true;
          }
        }
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
     
    grid[6]![i] = i % 2 === 0;
     
    grid[i]![6] = i % 2 === 0;
  }

  // Data area — scattered modules for visual texture
  for (let y = 9; y < size - 8; y += 2) {
    for (let x = 9; x < size - 8; x += 2) {
       
      grid[y]![x] = ((x * y) % 7) < 3;
    }
  }

  return grid;
}
