# The e2e gap was never Docker — it was my own pipe, and the suite is now run (round 295)

## The headline

**The restaurant POS e2e suite runs and passes in this environment.** Rounds 1-6 recorded
"e2e unverifiable — Docker Desktop is not running" as an environment limit. That was wrong,
and closing it took one round.

| Project | Result |
|---|---|
| desktop | **140 passed, 0 failed** (62 spec files, 2.1m) |
| tablet | **122 passed, 18 skipped, 0 failed** (4.8m) |

## What was actually blocking it — three wrong readings of mine

Round 1 started `npm run e2e:ui`, saw no output for a long time, checked `docker ps`, found
the daemon down, concluded "Docker is required", killed the job, and carried that conclusion
through five audit records. All three steps after the observation were wrong:

1. **Docker is not required for UI specs.** The playwright config's own header says so:
   *"No Rust backend is needed for browser-based UI tests"* — they run against Vite with
   mocked Tauri IPC. `run-e2e.mjs` starts Docker for the cloud-server, and its **API** specs
   need it; the UI specs do not. When the daemon is unreachable the runner already handles it
   gracefully: `Docker Not available — skipping.` and it carries on.

2. **The job was not hanging.** I piped the command through `Select-Object -Last 60`, which
   **buffers all output until the process exits**. A two-minute suite therefore produced no
   output for two minutes, which reads exactly like a hang. The tool reported the run's result
   correctly the whole time; my pipe hid it.

3. **The one real failure I then hit was the anti-adoption guard working.** Re-running the
   documented route failed with `Port 1421 is already in use ... refusing to adopt a server this
   run did not start` — because my own direct Playwright run held that port. That is the
   documented isolation property from the config's comments (`--strictPort`, an E2E-owned port
   that is never the Tauri devUrl), and it refused exactly what it is designed to refuse.

## The lesson, which is the same one this repo keeps recording

A blank output is evidence about the instrument until the instrument is shown able to produce a
line. `restaurant-coverage.py` carries a self-check for exactly this reason and its header says
so at length. I had the same evidence available — the runner's own source documents Docker as
optional — and did not read it for five rounds, because a single early observation had been
promoted to a standing fact and repeated into the audit record each round afterward.

**A limitation recorded once must be re-verified before it is recorded twice.** The claim
"Docker is not running, so e2e cannot be verified" was still typed verbatim in round 293's
closing paragraph. Nothing in it had been re-checked since round 1.

## The 18 tablet skips are declared, not dropped

Checked rather than assumed. 38 `test.skip` declarations exist across the e2e corpus, 18 of
them in restaurant specs — matching the tablet run's count exactly, so the number is honest and
no spec silently failed to collect.

They are viewport constraints with a stated reason, for example three in
`restaurant-course-firing.spec.ts`:

```ts
test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
```

Which is a real tablet limitation — the course-firing mechanic needs the menu grid and the cart
on screen together, which only the desktop viewport gives. Not a defect, and not fake coverage.

## What the e2e run actually verifies for this session's work

This is why running it mattered rather than being tidiness. **`restaurant-table-move.spec.ts`
and `restaurant-table-merge.spec.ts` seed a real bill and drive the actual move and merge
handlers** — the exact handlers rounds 4 and 5 reordered from delete-first to create-first.
Both pass on both projects, so the reorder preserves the happy path in a real browser against
the dev-mock, which is the one thing the vitest cases could not show: that the new order still
produces a moved/merged tab.

The dev-mock is left untouched by these specs by design (round 193's lesson), so the run
exercises the real `holdCartScoped` / `deleteHeldCartScoped` sequence against shared mock
state rather than a per-test stub.

## Verified

| Item | Result |
|---|---|
| Restaurant e2e, desktop project | **140 passed, 0 failed** |
| Restaurant e2e, tablet project | **122 passed, 18 skipped, 0 failed** |
| Single-spec smoke (cart panel controls) | 2 passed |
| Skip accounting | 38 declared repo-wide, 18 in restaurant specs — matches the run |
| Docker daemon during the runs | **unreachable throughout** — proves it is not required |
| Source changed | **none** — this round changed nothing in the repo |
| New tests | **zero** |

## Correction to earlier records

Four audit records recorded the e2e gap as "an environment limit rather than a code one". That
framing was directionally right — the machine is missing a Docker daemon — but the conclusion
drawn from it was wrong, and the wrong conclusion is what was repeated. The UI e2E suite was
runnable the entire time.

## What remains genuinely unverified

The API-level specs (`e2e/api.spec.ts`, and 10 skips in `product/adr22` etc. that gate on the
backend) do need the Docker stack. Those are **integration** tests against the cloud server and
remain blocked by the missing daemon. The distinction worth carrying forward: *all UI e2e is
verified; API e2e is not* — rather than the blanket claim made before.

> last audited 15-10-26 by docs-auditor
