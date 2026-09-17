/**
 * Tests for `auditCatalog` — the audit action/outcome → Fluent-id mapping.
 *
 * The catalog is the single source of truth for rendering audit entries.
 * These tests pin the parity contract:
 * - every action/outcome maps to a Fluent id that EXISTS in the shared
 *   bundle (a missing id renders a raw key to users)
 * - every CRITICAL_ACTIONS entry is a real catalog action (no dead keys)
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ACTION_FLUENT_IDS,
  ACTION_FALLBACK_ID,
  OUTCOME_FLUENT_IDS,
  OUTCOME_FALLBACK_ID,
  CRITICAL_ACTIONS,
} from '@/features/audit/auditCatalog';

// Load the shared FTL bundle and collect every declared message id.
const SHARED_FTL = path.resolve(process.cwd(), '../shared-ui/locales/shared.ftl');

const ftlIds = new Set<string>();
const content = fs.readFileSync(SHARED_FTL, 'utf-8');
for (const line of content.split('\n')) {
  const m = line.match(/^([a-z0-9-]+)\s*=/);
  if (m) ftlIds.add(m[1]!);
}

describe('auditCatalog parity (AUD-08)', () => {
  it('loads the shared FTL bundle', () => {
    expect(ftlIds.size).toBeGreaterThan(50);
  });

  it('every action maps to a Fluent id that exists in shared.ftl', () => {
    const missing = Object.entries(ACTION_FLUENT_IDS)
      .filter(([, fluentId]) => !ftlIds.has(fluentId))
      .map(([action, fluentId]) => `${action} -> ${fluentId}`);
    expect(missing, `missing Fluent ids:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the action fallback id exists in shared.ftl', () => {
    expect(ftlIds.has(ACTION_FALLBACK_ID)).toBe(true);
  });

  it('every outcome maps to a Fluent id that exists in shared.ftl', () => {
    const missing = Object.entries(OUTCOME_FLUENT_IDS)
      .filter(([, fluentId]) => !ftlIds.has(fluentId))
      .map(([outcome, fluentId]) => `${outcome} -> ${fluentId}`);
    expect(missing, `missing outcome Fluent ids:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the outcome fallback id exists in shared.ftl', () => {
    expect(ftlIds.has(OUTCOME_FALLBACK_ID)).toBe(true);
  });

  it('every CRITICAL_ACTIONS entry is a real catalog action', () => {
    const dead = [...CRITICAL_ACTIONS].filter((action) => !(action in ACTION_FLUENT_IDS));
    expect(dead, `critical actions without a catalog entry:\n${dead.join('\n')}`).toEqual([]);
  });

  it('known actions map to the expected ids (spot check)', () => {
    expect(ACTION_FLUENT_IDS['sale.complete']).toBe('audit-action-sale-complete');
    expect(ACTION_FLUENT_IDS['sale.completed']).toBe('audit-action-sale-complete');
    expect(ACTION_FLUENT_IDS['login.failed']).toBe('audit-action-login-failed');
    expect(OUTCOME_FLUENT_IDS['success']).toBe('audit-log-outcome-success');
  });
});
