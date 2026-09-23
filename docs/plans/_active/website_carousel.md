# Website Hero Carousel — Video Format Plan

> Status: **planned — blocked on two things, not one.** No code has been changed.
> Scope: `website/src/components/HeroCarousel.tsx` + `website/public/videos/hero/`.
>
> 1. **A decision from §7.0** — the video mounts *inside* `SlideWindow`'s
>    `content` slot, whose box is ~1280×693, not the 1280×720 this plan encodes
>    at. Pick A/B/C before recording; it changes the capture, not just the CSS.
> 2. **The video assets themselves.**
>
> When both are settled, follow §6 (encode) and §7 (integrate) in order.
>
> Re-audited against the tree on 2026-09-04. §1 and §7.0 were corrected; §2–§6
> and §8 were verified accurate (`DWELL_MS = 10000`, `aspectRatio: '1280 / 720'`,
> `SLIDE_IDS` matching §5, the `/videos/*` immutable rule at `_headers:32`, and
> `hero-carousel.test.tsx` existing).

## 1. Context

The homepage hero (`Hero.astro`) mounts `HeroCarousel` (`client:load`) — a 5-slide
mockup carousel (restaurant / retail / kitchen / warehouse / topology) with a
`max-w-[1280px]` stage at `aspect-ratio: 1280/720`, auto-dwell `DWELL_MS = 10000`,
pause-on-hover (WCAG 2.2.2). Plan: mount a **10 s · 15 fps · muted · looping video**
inside each slide instead of / behind the static mockup markup.

## 2. Decision summary

| Decision | Choice | Rationale |
|---|---|---|
| Codecs | **VP9 (WebM) + H.264 (MP4) dual source** | ~97% browser coverage at −70% size vs H.264-only; zero decode concerns at 15 fps; only 2 files per slide per resolution |
| Resolutions | **960×540 (mobile) + 1280×720 (desktop)** via `<source media>` | Phones render the stage at ~360–400 CSS px → 960 px covers 2× DPR; desktop gets full sharpness |
| Frame rate | 15 fps | UI-screen content has no fast motion; halves payload vs 30 fps |
| Frame size budget | ≤ 1.5 MB per 720p clip, ≤ 1 MB per 540p clip | 5 slides × 2 variants; only the active slide ever downloads (lazy activation, §7) |
| Container | MP4 `+faststart` (H.264), WebM (VP9), both **yuv420p, no audio** | faststart = instant start on MP4; silence is mandatory for autoplay |

## 3. Measured size comparison (10 s · 15 fps · silent)

Synthetic source clip with calm, UI-like motion (closest proxy to product-screen
footage), encoded locally with the exact target settings:

| Codec (quality-matched) | 1280×720 | 960×540 | vs H.264 CRF 23 |
|---|---:|---:|---:|
| H.264 / MP4 (CRF 23) | 126 KB | 91 KB | baseline |
| H.264 / MP4 (CRF 28) | 76 KB | 56 KB | −40% |
| **VP9 / WebM (CRF 34)** | **39 KB** | **29 KB** | **−69%** |
| AV1 / MP4 (CRF 35) | 25 KB | 20 KB | −80% |

Two honesty caveats that shape the budget in §2:

1. **Synthetic gradients compress far better than real footage.** Expect real
   product-UI recordings to land ~3–10× higher: roughly 0.5–1 MB (VP9) and
   1.5–3 MB (H.264) per 10 s at 720p. The *codec ratios* hold.
2. **Content dominates codec.** Same encoder, busy test-pattern clip at 720p:
   **2,422 KB vs 126 KB**. Keep footage calm — no rapid cuts, minimal panning —
   and you save more than any format choice gives you.

If a real clip busts the budget: raise VP9 CRF (34 → 38) or H.264 CRF (26 → 28)
before dropping resolution or fps.

## 4. Format comparison for this use case

| | H.264 + MP4 | VP9 + WebM | AV1 + MP4 (not chosen) |
|---|---|---|---|
| Browser support | ~100% (all, incl. old Safari) | ~97% (Safari 14+) | ~85–88% (Safari 17+) |
| Size @ equal quality | baseline | −30–50% | −50–65% |
| Decode cost @ 720p15 | trivial | low (SW decode cheap at 15 fps) | low–medium on old CPUs |
| Encode time (10 s clip) | ~0.5 s | ~1.1 s | ~1.1 s |

AV1 was left out: the extra ~35% over VP9 isn't worth a third file per slide at
these absolute sizes. Revisit only if the clips end up large.

## 5. Deliverables

```
website/public/videos/hero/
  restaurant-540.webm   restaurant-540.mp4   restaurant-720.webm   restaurant-720.mp4
  retail-540.webm       retail-540.mp4       retail-720.webm       retail-720.mp4
  kitchen-540.webm      kitchen-540.mp4      kitchen-720.webm      kitchen-720.mp4
  warehouse-540.webm    warehouse-540.mp4    warehouse-720.webm    warehouse-720.mp4
  topology-540.webm     topology-540.mp4     topology-720.webm     topology-720.mp4
  <slide>-720.webp      # poster frame per slide (first frame), used by both variants
```

Naming = `SlideId` from `HeroCarousel.tsx` (`restaurant|retail|kitchen|warehouse|topology`)
so the component can build URLs from the id directly.

## 6. Encode commands (run when footage is ready)

From the recorded master clip (any resolution/fps ≥ target, trimmed to 10 s):

```powershell
$S = 'restaurant'   # slide id per §5
$M = 'master.mp4'   # source footage

# ── VP9 / WebM (serves ~97% of visitors)
ffmpeg -i $M -t 10 -vf "fps=15,scale=1280:720:flags=lanczos" -an `
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -deadline good -cpu-used 4 -pix_fmt yuv420p `
  "$S-720.webm"
ffmpeg -i $M -t 10 -vf "fps=15,scale=960:540:flags=lanczos" -an `
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -deadline good -cpu-used 4 -pix_fmt yuv420p `
  "$S-540.webm"

# ── H.264 / MP4 fallback (faststart for instant playback)
ffmpeg -i $M -t 10 -vf "fps=15,scale=1280:720:flags=lanczos" -an `
  -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -movflags +faststart `
  "$S-720.mp4"
ffmpeg -i $M -t 10 -vf "fps=15,scale=960:540:flags=lanczos" -an `
  -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -movflags +faststart `
  "$S-540.mp4"

# ── Poster frame (first frame)
ffmpeg -i "$S-720.mp4" -frames:v 1 "$S-720.webp"
```

Acceptance per clip: duration `00:00:10.00`, 15 fps, no audio stream, within the
§2 budget (VP9 ≤ 1.5 MB @720p / ≤ 1 MB @540p; MP4 may exceed — it's the fallback).

## 7. Integration into `HeroCarousel.tsx`

### 7.0 Where the video actually mounts — read `SlideWindow` first

Every slide renders inside `<SlideWindow title content>` (`HeroCarousel.tsx:92`).
That component's own doc comment already settles the question the rest of §7
assumed was open:

> "Later the user drops a PNG of each app surface into the content area… **The
> chrome (traffic lights + window title) is intentionally NOT part of the PNG —
> it stays as live DOM** so it scales crisply at any hero width and keeps one
> consistent look across every slide." — `mockups/SlideWindow.tsx:6-10`

So the contract is settled, not an open decision:

* The video goes in the **`content` slot**, inside the frame. It does **not**
  replace `SlideWindow`.
* Recordings must therefore be **chrome-free** — no OS title bar, no window
  buttons in the footage. Capturing with the frame visible would double the
  chrome and break the "one consistent look" property the comment names.

**⚠️ This invalidates the §2/§5/§6 resolution numbers.** The content slot is
`min-h-0 flex-1` (`SlideWindow.tsx:43`) sitting *below* a chrome bar of `px-4
py-1.5` around 11px text plus a 1px border — roughly **27px**. The box a
1280×720 clip drops into is therefore about **1280×693**, not 1280×720. Encode
before resolving this and every clip letterboxes or crops ~3.75% vertically,
which can clip the app's own menu bar.

Three ways out — pick one **before recording**, because it changes the capture,
not just the CSS:

| Option | How | Cost |
|---|---|---|
| **A. Record at the true content box** | master at 1280×693 / 960×520 | odd dimensions; many capture tools won't offer them |
| **B. `object-fit: cover`** | keep 1280×720, crop the overflow | loses ~13px top+bottom — footage must keep UI out of that band |
| **C. `object-fit: contain` + frame gradient** | keep 1280×720, letterbox into `from-bg to-surface/30` | visible bars — though the frame already uses that gradient, so it reads as intentional |

Recommendation: **B**, with recordings framed to keep the app's top bar clear of
the crop band. It leaves §6's encode commands unchanged and costs under 4%.

### 7.1 Steps

1. **Lazy activation** — render the `<video>` only for the *active* slide
   (conditional render keyed by slide id) with `preload="none"`. Offscreen slides
   therefore cost **0 bytes**; at most one video is downloading at any time.
   For `restaurant` the video replaces `<RestaurantMockup />` in the `content`
   slot; for the other four it replaces the placeholder caption.
2. **Loop alignment** — 10 s video ↔ `DWELL_MS = 10000`. On slide activation:
   `video.currentTime = 0; video.play()`. Show the poster until `canplay`.
3. **Source selection** — `<source media="(min-width: 1024px)">` picks 720p;
   following sources pick 540p. WebM before MP4 within each breakpoint:

   ```html
   <video autoplay muted loop playsinline preload="none"
          poster="/videos/hero/${id}-720.webp" width="1280" height="720">
     <source media="(min-width: 1024px)" src="/videos/hero/${id}-720.webm" type="video/webm">
     <source media="(min-width: 1024px)" src="/videos/hero/${id}-720.mp4"  type="video/mp4">
     <source src="/videos/hero/${id}-540.webm" type="video/webm">
     <source src="/videos/hero/${id}-540.mp4"  type="video/mp4">
   </video>
   ```
4. **Reduced motion** — honor `prefers-reduced-motion`: skip autoplay, render the
   poster image only (video becomes click-to-play or static). Autoplay attributes
   (`muted playsinline`) already satisfy browser autoplay policies.
5. **A11y** — keep existing pause-on-hover/focus (WCAG 2.2.2) covering video;
   carousel stays `aria-roledescription="carousel"`, inactive slides stay
   `aria-hidden`. Videos are decorative → no caption track required, but add
   `aria-label` from the existing slide label.
6. **Fallback when `.webm` unsupported** — browser walks `<source>` list
   automatically; no JS needed.
7. **Tests** — extend `hero-carousel.test.tsx`: only active slide mounts a
   `<video>`; `preload="none"` present; poster attribute set; reduced-motion path
   renders no autoplaying video.

## 8. Caching

**Already in place:** `website/public/_headers` carries the immutable
`/videos/*` rule (added with the site-wide cache-lifetime fix — see the
`/_astro/*`, `/admin/*`, `/og-image.png`, `/favicon.svg` rules in the same
file). Nothing further to do here.

If a clip is ever re-encoded after deploy, bump the filename (or a `?v=`
query) — a year-long immutable TTL means browsers will not re-check.
