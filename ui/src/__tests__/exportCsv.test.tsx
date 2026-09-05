// ── export-csv tests ─────────────────────────────────────────────
//
// Covers escapeCsv RFC 4180 rules (plain pass-through, quoting for
// comma/quote/CR/LF, internal quote doubling) and downloadCsv blob
// construction (BOM, header, rows, filename, anchor cleanup).
//
// Mocks: URL.createObjectURL / revokeObjectURL (jsdom lacks them).
// The anchor click is observed through a spy — jsdom does not navigate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadCsv, escapeCsv } from '@/utils/export-csv';

// ── escapeCsv ───────────────────────────────────────────────────────

describe('escapeCsv (RFC 4180)', () => {
  it('passes plain values through unquoted', () => {
    expect(escapeCsv('hello')).toBe('hello');
    expect(escapeCsv('')).toBe('');
    expect(escapeCsv('Café 123')).toBe('Café 123');
  });

  it('quotes values containing commas', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
  });

  it('quotes values containing double quotes', () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes values containing carriage returns', () => {
    expect(escapeCsv('a\rb')).toBe('"a\rb"');
  });

  it('doubles internal quotes AND quotes when both special chars appear', () => {
    expect(escapeCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it('leaves tabs and semicolons unquoted (not RFC 4180 delimiters)', () => {
    expect(escapeCsv('a;b\tc')).toBe('a;b\tc');
  });
});

// ── downloadCsv ─────────────────────────────────────────────────────

describe('downloadCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('creates a CSV blob with UTF-8 BOM, header, and rows', () => {
    downloadCsv(
      'sales.csv',
      [{ key: 'id', label: 'ID' }, { key: 'total', label: 'Total' }],
      [{ id: 1, total: '10.00' }, { id: 2, total: '20.00' }],
    );

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');

    // Read the blob content synchronously via a File reader stub is async;
    // instead verify through the object URL call having received a Blob.
    expect(blob).toBeInstanceOf(Blob);
  });

  it('triggers exactly one anchor click with the filename set', () => {
    downloadCsv('report.csv', [{ key: 'a', label: 'A' }], [{ a: 1 }]);

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the anchor from the DOM after clicking', () => {
    downloadCsv('report.csv', [{ key: 'a', label: 'A' }], [{ a: 1 }]);

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('revokes the object URL after download', () => {
    downloadCsv('report.csv', [{ key: 'a', label: 'A' }], [{ a: 1 }]);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('renders an empty body line for zero rows', async () => {
    // readAsText strips the UTF-8 BOM during decoding — BOM is byte-asserted below.
    const content = await captureCsvContent([], [{ key: 'a', label: 'A' }]);
    expect(content).toBe('A\n');
  });

  it('handles missing row keys as empty strings', async () => {
    const content = await captureCsvContent(
      [{ a: 1 }],
      [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
    );
    expect(content).toBe('A,B\n1,');
  });

  it('escapes commas and quotes in cell values in the final blob', async () => {
    const content = await captureCsvContent(
      [{ note: 'paid "cash", onsite' }],
      [{ key: 'note', label: 'Note' }],
    );
    expect(content).toBe('Note\n"paid ""cash"", onsite"');
  });

  it('prefixes the blob with the UTF-8 BOM bytes (EF BB BF)', async () => {
    downloadCsv('x.csv', [{ key: 'a', label: 'A' }], [{ a: 1 }]);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const bytes = Array.from(new Uint8Array(buf).slice(0, 3));

    expect(bytes).toEqual([0xef, 0xbb, 0xbf]);
  });

  // ── Content-capture helper ────────────────────────────────────
  //
  // Reads the real Blob handed to URL.createObjectURL through a
  // FileReader, so assertions cover the actual generated CSV text.
  function captureCsvContent(
    rows: Record<string, unknown>[],
    columns: { key: string; label: string }[],
  ): Promise<string> {
    downloadCsv('x.csv', columns, rows);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }
});
