// ── UX Compliance: No Minor Units Leaked in UX ───────────────────────
//
// In kasir.mu, "minor units" (integer cents / rupiah) is strictly a backend,
// database, and IPC internal representation (Money struct, rusqlite, domain Money).
//
// End users, cashiers, and store managers must NEVER see developer jargon like:
// - "minor units" / "in minor units" / "(minor units)"
// - "(unit minor)" / "unit kecil"
//
// All UI inputs and displays must accept and present natural human currency amounts
// (e.g., $4.50, Rp 50.000) and translate to/from integer minor units at the boundary
// via canonical `parseMoneyInput` and `formatMoneyInput`.
//
// This test suite acts as an automated regression guard across:
// 1. All Fluent translation bundles in `shared-ui/locales/*.ftl` (both EN and ID).
// 2. All React UI components and screens in `ui/src/features/` and `ui/src/components/`.
// 3. The canonical domain conversion boundary (`parseMoneyInput` / `formatMoneyInput`).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseMoneyInput, formatMoneyInput } from '@/types/domain';

const LOCALES_DIR = path.resolve(__dirname, '../../../shared-ui/locales');
const FEATURES_DIR = path.resolve(__dirname, '../features');
const COMPONENTS_DIR = path.resolve(__dirname, '../components');

// Regex patterns that identify forbidden UX jargon
const FORBIDDEN_UX_PATTERNS = [
  { pattern: /\bminor\s+units?\b/i, name: 'minor unit(s)' },
  { pattern: /\bunit\s+minor\b/i, name: 'unit minor' },
  { pattern: /\bunit\s+kecil\b/i, name: 'unit kecil' },
];

describe('UX compliance — no minor units jargon in Fluent translation bundles', () => {
  const ftlFiles = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.ftl'));

  it('locales directory has translation bundles', () => {
    expect(ftlFiles.length).toBeGreaterThan(0);
  });

  for (const filename of ftlFiles) {
    it(`bundle ${filename} contains no minor units jargon in translation messages`, () => {
      const filePath = path.join(LOCALES_DIR, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Skip comment-only lines in FTL files (# ...)
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
          continue;
        }

        for (const { pattern, name } of FORBIDDEN_UX_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(`Line ${i + 1} matches "${name}": ${trimmed}`);
          }
        }
      }

      expect(
        violations,
        `Found minor unit jargon in ${filename}:\n${violations.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('UX compliance — no minor units jargon in user-facing JSX/TSX components', () => {
  function getTsxFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip test directories and mock handlers
        if (entry.name === '__tests__' || entry.name === 'dev-mock') {
          continue;
        }
        results.push(...getTsxFiles(fullPath));
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const uiFiles = [...getTsxFiles(FEATURES_DIR), ...getTsxFiles(COMPONENTS_DIR)];

  it('scanned UI component files', () => {
    expect(uiFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of uiFiles) {
    const relativePath = path.relative(path.resolve(__dirname, '../..'), filePath);

    it(`UI file ${relativePath} contains no minor units in rendered JSX text or attributes`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Strip comments so code documentation about backend minor units isn't flagged
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/\/\/.*$/gm, ''); // line comments

      const lines = stripped.split('\n');
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        for (const { pattern, name } of FORBIDDEN_UX_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(`Line ${i + 1} matches "${name}": ${line.trim()}`);
          }
        }
      }

      expect(
        violations,
        `Found user-visible minor unit jargon in ${relativePath}:\n${violations.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('UX compliance — natural money input and formatting contracts', () => {
  it('correctly parses natural human currency amounts without requiring raw cents', () => {
    // IDR (exponent 0) - typed as natural rupiah
    expect(parseMoneyInput('5000', 'IDR')).toBe(5000);
    expect(parseMoneyInput('50.000', 'IDR')).toBe(50000);
    expect(parseMoneyInput('150,000', 'IDR')).toBe(150000);

    // USD (exponent 2) - typed as dollars and cents
    expect(parseMoneyInput('4.50', 'USD')).toBe(450);
    expect(parseMoneyInput('100', 'USD')).toBe(10000);
    expect(parseMoneyInput('100.00', 'USD')).toBe(10000);
    expect(parseMoneyInput('0.99', 'USD')).toBe(99);

    // EUR (exponent 2) - handles European comma notation
    expect(parseMoneyInput('12,50', 'EUR')).toBe(1250);
    expect(parseMoneyInput('1.234,50', 'EUR')).toBe(123450);
  });

  it('correctly formats integer minor units back to human-editable input strings', () => {
    // IDR (no decimals in UX input)
    expect(formatMoneyInput(5000, 'IDR')).toBe('5000');
    expect(formatMoneyInput(50000, 'IDR')).toBe('50000');

    // USD (decimal format in UX input, whole numbers trimmed)
    expect(formatMoneyInput(450, 'USD')).toBe('4.50');
    expect(formatMoneyInput(10000, 'USD')).toBe('100');
    expect(formatMoneyInput(99, 'USD')).toBe('0.99');
    expect(formatMoneyInput(0, 'USD')).toBe('0');
  });

  it('round-trips natural user input through parse and format seamlessly', () => {
    const testCases: Array<{ input: string; currency: string; expectedMinor: number }> = [
      { input: '5000', currency: 'IDR', expectedMinor: 5000 },
      { input: '125000', currency: 'IDR', expectedMinor: 125000 },
      { input: '4.50', currency: 'USD', expectedMinor: 450 },
      { input: '100.00', currency: 'USD', expectedMinor: 10000 },
      { input: '0.99', currency: 'USD', expectedMinor: 99 },
    ];

    for (const { input, currency, expectedMinor } of testCases) {
      const parsedMinor = parseMoneyInput(input, currency);
      expect(parsedMinor).toBe(expectedMinor);

      const formatted = formatMoneyInput(parsedMinor!, currency);
      expect(parseMoneyInput(formatted, currency)).toBe(expectedMinor);
    }
  });

  it('rejects invalid, negative, or over-precision input gracefully at the UI boundary', () => {
    expect(parseMoneyInput('-50', 'USD')).toBeNull();
    expect(parseMoneyInput('-5000', 'IDR')).toBeNull();
    expect(parseMoneyInput('abc', 'IDR')).toBeNull();
    expect(parseMoneyInput('', 'IDR')).toBeNull();

    // Rejects fractional cents in decimal currencies
    expect(parseMoneyInput('4.555', 'USD')).toBeNull();

    // Rejects fractional units in 0-exponent currencies
    expect(parseMoneyInput('5000.5', 'IDR')).toBeNull();
  });
});
