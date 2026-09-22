import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labelMap } from '../i18n';
import { ACCOUNT_LABELS } from '../components/AccountView';
import { AUTH_FORM_LABELS } from '../components/AuthForm';
import { SUPPORT_LABELS } from '../components/ContactForm';
import { PRICING_LABELS } from '../components/PricingGrid';
import { SEARCH_LABELS } from '../components/SearchModal';
import { SIGNUP_FORM_LABELS } from '../components/SignupForm';
import { PAIR_LABELS } from '../components/PairView';
import { AUTH_ERROR_LABELS } from '../lib/useAuth';

/**
 * A hydrated island cannot read a locale dictionary without shipping it: it gets
 * a key→string map as a prop (`labelMap` on the server, `../i18n/labels` in the
 * browser). That is only safe while two things stay true, and both are silent
 * when they break — a missing key renders as the raw key text, and one stray
 * import puts ~19 KB gzip of dictionary back on the page. These assertions are
 * the alarm:
 *
 *   1. every key an island's modules read is declared in that island's list;
 *   2. every declared key resolves in *both* locales;
 *   3. no production `.ts`/`.tsx` under components/ or lib/ imports a dictionary.
 *
 * `files` is the island's client graph — the modules the island's entry point
 * renders. Adding a section to an island means adding its file here.
 */
interface Island {
  name: string;
  list: readonly string[];
  files: string[];
}

const ISLANDS: Island[] = [
  {
    name: 'pricing (pricing.astro)',
    list: PRICING_LABELS,
    files: ['../components/PricingGrid.tsx', '../components/CheckoutButton.tsx'],
  },
  {
    name: 'support (support.astro)',
    list: SUPPORT_LABELS,
    files: ['../components/ContactForm.tsx'],
  },
  {
    name: 'search (Header.astro → docs)',
    list: SEARCH_LABELS,
    files: ['../components/SearchModal.tsx', '../components/SearchTrigger.tsx'],
  },
  {
    name: 'login (login.astro)',
    list: AUTH_FORM_LABELS,
    files: [
      '../components/AuthForm.tsx',
      '../components/PasswordField.tsx',
      '../components/PasswordStrength.tsx',
      '../lib/useAuth.ts',
    ],
  },
  {
    name: 'signup (signup.astro)',
    list: SIGNUP_FORM_LABELS,
    files: [
      '../components/SignupForm.tsx',
      '../components/PasswordField.tsx',
      '../components/PasswordStrength.tsx',
      '../lib/useAuth.ts',
    ],
  },
  {
    name: 'account (account.astro)',
    list: ACCOUNT_LABELS,
    files: [
      '../components/AccountView.tsx',
      '../components/PasswordField.tsx',
      '../components/PasswordStrength.tsx',
      '../components/account/AccountBilling.tsx',
      '../components/account/AccountDevices.tsx',
      '../components/account/AccountLicense.tsx',
      '../components/account/AccountPassword.tsx',
      '../components/account/AccountProfile.tsx',
      '../components/account/AccountQuickActions.tsx',
      '../components/account/AccountRegion.tsx',
      '../components/account/AccountSubscription.tsx',
      '../components/account/accountShared.ts',
    ],
  },
  {
    name: 'pair (pair.astro)',
    list: PAIR_LABELS,
    files: ['../components/PairView.tsx'],
  },
];

const read = (relativeToTest: string): string =>
  readFileSync(new URL(relativeToTest, import.meta.url), 'utf8');

const literalKeys = (source: string): string[] => [
  ...new Set([...source.matchAll(/t\(labels, '([^']+)'/g)].map((m) => m[1])),
];

describe('island label coverage', () => {
  for (const island of ISLANDS) {
    it(`${island.name} declares every key its modules read`, () => {
      const missing: string[] = [];
      for (const file of island.files) {
        for (const key of literalKeys(read(file))) {
          if (!island.list.includes(key)) missing.push(`${key} (${file})`);
        }
      }
      expect(missing, `keys read but not declared in the island's labels list`).toEqual([]);
    });

    it(`${island.name} resolves every declared key in both locales`, () => {
      for (const locale of ['en', 'id']) {
        const map = labelMap(locale, island.list);
        const unresolved = island.list.filter((key) => !map[key] || map[key] === key);
        expect(unresolved, `${locale}: keys with no string in the dictionary`).toEqual([]);
      }
    });
  }

  it('keeps every dictionary out of the client graph', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(new URL(dir, import.meta.url))) {
        const path = `${dir}/${entry}`;
        if (statSync(new URL(path, import.meta.url)).isDirectory()) {
          if (entry !== '__tests__') walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
        if (/from\s+['"][^'"]*\/i18n['"]/.test(read(path))) offenders.push(path);
      }
    };
    walk('../components');
    walk('../lib');
    expect(offenders, 'these modules import a locale dictionary instead of ../i18n/labels').toEqual(
      [],
    );
  });

  it('keeps the shared key sets owned by the component that reads them', () => {
    // The password strings and the checkout strings are read by components
    // shared across islands, so each set has one owner and the islands spread it.
    expect(read('../components/AuthForm.tsx')).toContain('...PASSWORD_FIELD_LABELS');
    expect(read('../components/SignupForm.tsx')).toContain('...PASSWORD_STRENGTH_LABELS');
    expect(read('../components/AccountView.tsx')).toContain('...PASSWORD_FIELD_LABELS');
    expect(read('../components/PricingGrid.tsx')).toContain('...CHECKOUT_LABELS');
    expect(AUTH_ERROR_LABELS.every((key) => AUTH_FORM_LABELS.includes(key))).toBe(true);
  });
});
