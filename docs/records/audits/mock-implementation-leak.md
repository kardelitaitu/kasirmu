# The mock-implementation leak: `clearAllMocks()` keeps implementations (round 92)

## The measurement

Probed on this repo's vitest, with a file reduced to the question:

```ts
const fn = vi.fn(() => 'default');
it('sets an implementation', () => {
  fn.mockImplementation(() => 'override');
  expect(fn()).toBe('override');
});
it('after clearAllMocks, is the implementation kept?', () => {
  vi.clearAllMocks();
  expect(fn()).toBe('default');   // FAILS: got 'override'
});
```

**`vi.clearAllMocks()` clears CALLS, not IMPLEMENTATIONS.** `vi.restoreAllMocks()` does
not undo them either when the `vi.fn()` was created by a `vi.mock` FACTORY, which is how
every shared module mock in this repo is built.

## Why it matters here

`PosScreenCoreFlow.test.tsx` replaced `settingsApi.getSettingScoped` with a
`mockImplementation` in two cases and never restored it. The replacement answered `null`
for every key it did not care about, so it silently changed the behaviour of every case
AFTER it -- in the same file, and (through the shared module instance) in the run.

The symptom was misleading on purpose:

* the file passed when run ALONE;
* the full suite failed, but on FOUR DAMAGE-REPORTING cases rather than the cause;
* it failed intermittently, so each of rounds 88, 90 and 91 read a green run as proof
  and shipped a fix to the wrong thing.

What actually settled it (both cheap, both should come first next time):

1. **Skip the suspect and re-run.** With the one case `it.skip`-ed the full suite was
   green. That is causation, not correlation -- no amount of re-running establishes it.
2. **Read the suspect's own failure text.** It was `Unable to find an element by:
   [data-testid="cart-panel-line-item"]` -- the scan never added a line. Every earlier
   hypothesis had been inferred from the NEIGHBOURS' failures.

## The fix, and the general rule

`beforeEach` now restores the one mock the cases replace:

```ts
vi.mocked(settingsApi.getSettingScoped).mockImplementation(() => Promise.resolve(null));
```

Targeted on purpose: `resetAllMocks()` would also drop the FACTORY defaults and break
every case. Only the mocks a case actually replaces need this line.

**The rule: a case that calls `mockImplementation` owns a reset for that mock.** A
`mockResolvedValueOnce` does not have this problem -- it is consumed by the next call --
which is why the eleven cases in the same file that use one were never affected, and why
the difference was invisible on inspection.

## Verified

Kill-test: removing the `beforeEach` reset fails the file inside the full suite
(12628 passed / the file errors) while the same shape passes with it. Restored, the suite
is green under both the default and the verbose reporter.