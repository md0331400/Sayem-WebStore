# Final Report — Sayem WebStore Production Hardening (v4.2 release)

Branch `main`, commit `5748906` (on top of `3611c40`). Production: https://sayemwebstore.vercel.app/
This report supersedes all earlier reports. Every claim below was re-verified against the
current code and test runs in this session — not copied from earlier documents.

---

## 1. Actual Mobile Bug Causes

The reported symptom (a "desktop-ish", horizontally pannable page on phones) reproduced only
at **effective viewports below ~300 px** — Chrome page-zoom, Android display-size, split-screen
and foldable cover screens. Earlier diagnostics started at 320 px, which is why the bug survived
previous "responsive passes". Each cause below was found with an automated offender walk that
reports the exact selector and its bounding box, and confirmed with a min-content probe that
walks `scrollWidth > clientWidth` from `<body>` down to the true driver.

| # | File / selector | Cause | Fix |
|---|-----------------|-------|-----|
| 1 | `style.css` → `.app-download-btn` | 140 px intrinsic nowrap pill inside the card-head flex row; its min-content floor pushed every card (and therefore the page) to ≥ ~276 px | `flex-shrink:1; min-width:0; max-width:46%; overflow:hidden; text-overflow:ellipsis` on the pill |
| 2 | `style.css` → `.nav-shell` | grid `1fr auto 1fr`: the `auto` middle column's floor = brand + actions min-content (~274 px) | `auto minmax(0,1fr) auto` + `min-width:0` chain on brand/title + ellipsis on `.brand-title` |
| 3 | `style.css` → `.banner-slide` / `.banner-title` / banner `.btn` | grid `1fr auto` + nowrap button labels; at large font scales the label ("⬇️ Download Now") alone needs ~170 px | `minmax(0,1fr) auto`, `max-width:100%` on title, side column stacks under the copy ≤ 360 px |
| 4 | `style.css` → `.apps-grid` | `repeat(auto-fill, minmax(230px,1fr))` — the 230 px track floor overflows 240–280 px containers | `minmax(min(230px,100%),1fr)` + forced 1 column ≤ 340 px |
| 5 | `style.css` → `.btn` (login / download labels) | `white-space:nowrap` labels set the hero/detail min-content at font scales 20–28 | `white-space:normal` ≤ 420 px |
| 6 | `style.css` → `.app-info-row` | `flex-shrink:0` definition column ("Version", "Size"…) floors the detail page at font 28 / 240 px | stacks to `display:block` ≤ 360 px |
| 7 | `style.css` → `.app-stats`, `.trust-grid` | fixed 3-column rows | `repeat(auto-fit,minmax(min(90px,100%),1fr))` / auto-fit trust grid |
| 8 | `style.css` → `.modal` | fixed 500 px width + vh-based height | `width:min(calc(100% - 8px),500px)`, `max-height` in `dvh`, `max-width:calc(100vw - 16px)` |
| 9 | `admin/index.html` grids, inline form grids, inputs | bare `1fr` tracks and input intrinsic widths floored admin pages | all tracks `minmax(0,…)`; inline form grids replaced by `.form-cols-2/.form-cols-3`; `input,select,textarea{min-width:0}`; tables bounded with internal scroll; tab bar scrolls |
| 10 | `admin/index.html` viewport meta | `maximum-scale=1.0` locked zoom (accessibility bug) while the public page had a second, conflicting viewport tag elsewhere | single normalized viewport `width=device-width, initial-scale=1.0, viewport-fit=cover` on public + admin; **no zoom lock anywhere** |

Overflow-wrap hardening (`overflow-wrap:anywhere` on long-token containers) and breakpoints at
420/360/340/300 px complete the set. **No `overflow-x:hidden` on body, no `zoom`, no
`transform:scale`, no forced desktop widths were used anywhere.**

Verification: `tools/mobile-diag.mjs` full matrix — widths 240/280/320/360/375/390/412/430 +
landscape 568×320 & 844×390 + tablet/desktop, × font scales 16/20/24/28, × routes
(home, /apps, /games, /search, /app/{slug}, /game/{slug}, signup, login) = **zero** overflowing
elements and `document.scrollWidth == viewport` everywhere; screenshots at 360 px inspected
visually (banner title ellipsizes, pills shrink, buttons wrap — layout stays mobile).

---

## 2. File Summary

### Production code
| File | Change |
|------|--------|
| `style.css` | v4.2 hardening block + base-rule fixes (causes 1–8, 10 above) |
| `index.html` | normalized viewport; honest trust-card copy; FAQ/Terms/Privacy rewritten to match reality |
| `app.js` | legacy per-device visitor tracker **removed** (IP/UA/hardware/battery + linked account writes); signup aggregate increment; `window._increment` exposed |
| `attribution.js` | `sendVisitBeacon()` — once-per-session anonymous aggregate beacon |
| `api/visit.js` | **new** serverless aggregate endpoint (daily source/campaign/landing counters; input-normalizing; no identity) |
| `admin/index.html` | responsive hardening (cause 9–10); conversion + landing-page tables in Traffic; Visitors tab becomes masked legacy archive with purge path |
| `service-worker.js` | cache names v13 → v14 (install `skipWaiting`, activate deletes old caches + `clients.claim` — verified) |
| `tools/dev-server.mjs` | mounts `/api/visit` for local parity with vercel.json |

### Tests
| File | Purpose |
|------|---------|
| `tests/responsive.test.mjs` | **new** regression suite: 16 viewports × 8 routes overflow matrix with selector-level diagnostics, font-scale stress, mobile-state assertions, SPA-navigation consistency, cold deep links, screenshot-rail containment, real old→new SW deploy-transition test, admin matrix incl. zoom-lock check, 57-screenshot archive |
| `tests/e2e.test.mjs` | + beacon once-per-session, signup aggregate increment, admin conversion/landing tables, public-copy honesty |
| `tests/functions.test.mjs` | + `/api/visit` aggregation, normalization, GET/OPTIONS, no cookies |
| `tests/fixtures.mjs` | + `FIXTURE_ANALYTICS` |
| `tools/mobile-diag.mjs` | **new** standalone diagnostic (device emulation, offender walk, font stress, live-slug mode) |

### Docs
| File | Change |
|------|--------|
| `SECURITY.md` | + §9 download-counter abuse resistance (honest limits), §10 visitor-tracking discontinuation & analytics design, §11 attribution storage summary |
| `FINAL-REPORT.md` | this document (supersedes previous) |

---

## 3. Feature Summary

**Preserved (re-verified by tests):** Firebase catalogue + search + categories; detail pages;
crawler SSR with SSO-shell guard; sitemap/robots/JSON-LD; PWA offline + theme; ad slots;
download counters (transactional increments); guest downloads (login-free); gated
reviews/ratings/reports; attribution (UTM > external referrer > Direct, immutable first touch,
external-only latest touch, 90-day TTL, corruption-safe) + signup source stored separately from
the user's manual answer; admin analytics/campaign generator/version fields/update checker;
admin panel; existing users/apps data untouched.

**Added:** anonymous aggregate analytics — once-per-session beacon → daily counters
(source/campaign/landing/total); signup conversion increments (one write per signup, never per
pageview); admin Traffic tab gains *Visitor → Signup conversion* and *Landing pages* tables that
honour the existing Today/Yesterday/7d/30d/Month/Custom range selector and the source/campaign
row filters. No IP, no cookies, no fingerprint, no identity anywhere in the pipeline.

**Removed (privacy remediation):** per-device visitor tracking (`visitors/{deviceToken}` writes
with IP, user-agent, screen, RAM/CPU, battery and linked account identity). Legacy records stay
in the database (non-destructive) but the admin UI masks identifying fields and offers purge.

---

## 4. Test Results (exact counts, this session)

| Suite | Command | Result |
|-------|---------|--------|
| Unit | `node tests/unit.test.mjs` | **61 passed, 0 failed** |
| Integration/functions | `node tests/functions.test.mjs` | **19 passed, 0 failed** |
| E2E (real browser, mobile emulation) | `node tests/e2e.test.mjs` | **38 passed, 0 failed** |
| Responsive regression | `node tests/responsive.test.mjs` | **30 passed, 0 failed** |
| **Total** | | **148 passed, 0 failed** |

Plus the standalone diagnostic matrix (`FONT_ALL=1 node tools/mobile-diag.mjs`): 10 device
profiles × 4 font scales × 8 routes = 0 overflow findings, and a live-production run
(`LIVE_SLUGS=1`) against sayemwebstore.vercel.app before the fix that reproduced the floors.

---

## 5. Honest Limitations

1. **Download counters** remain client-initiated transactions because the Realtime Database rules
   are open; atomic increments prevent lost updates but a determined attacker with direct DB
   access can inflate counts. Server-side enforcement requires deploying
   `database.rules.proposed.json`, intentionally left to the owner's review.
2. **Passwords** are still stored in the legacy plaintext format until the owner migrates
   accounts to Firebase Authentication (non-destructive path documented in SECURITY.md §1).
3. **Admin authentication** is a shared-credential session, not a security boundary; the panel is
   additionally `noindex`ed but that is obscurity, not protection (SECURITY.md §5).
4. Aggregate analytics are **daily totals only** — by design they cannot answer per-user or
   per-session questions, and legacy `visitors/` rows predating this release still exist in the
   database until purged.
5. Range filtering of daily buckets compares UTC day keys against the admin's local-day range
   boundaries; around midnight in UTC+offset timezones a bucket can appear under the previous
   local day.
6. SSR renders the same component as the client, but crawlers receive no client-side interactivity
   (by design); JSON-LD/sitemap purity and real 404s are covered by tests instead.

---

## 6. Live Verification (performed after deployment of `5748906`)

- **Deployment confirmed:** https://sayemwebstore.vercel.app/ serves the new build
  (`style.css` contains the v4.2 `minmax(min(230px, 100%), 1fr)` rule; `service-worker.js`
  serves `sayem-static-v14` with `skipWaiting`, old-cache deletion and `clients.claim`;
  `last-modified: Mon, 21 Sep 2026 08:29 UTC`).
- **Routes:** `/`, `/apps`, `/games`, `/search?q=calc`, `/privacy`, `/terms`, `/faq`,
  `/disclaimer`, `/admin`, `/sitemap.xml`, `/robots.txt`, `/manifest.json` all HTTP 200.
  Unknown path (`/nonexistent-page-xyz`) returns a real 404 with
  `<title>404 — Page Not Found | Sayem WebStore`.
- **Sitemap purity:** 19 `<url>` entries = the 11 live Firebase apps + static pages; no
  fixture/test slugs, no admin, no auth pages.
- **New endpoint live:** `OPTIONS /api/visit` → 204 (mounted; probe performed without
  writing any counter).
- **Real mobile emulation against production:** `LIVE_SLUGS=1 FONT_ALL=1
  node tools/mobile-diag.mjs` → **160/160 checks pass, 0 offenders**: device profiles
  240/280/320/360/375/390/412/430 portrait + 568×320 & 844×390 landscape × font scales
  16/20/24/28 × home//apps/detail(app)/detail(game)/auth; `document.scrollWidth` equals the
  viewport on every check.
- **Screenshots inspected visually** (360 px, production): banner title ellipsizes, download
  pill shrinks, install prompt and the rewritten "Direct Publisher Links" copy render fully
  inside the viewport.
- **PWA returning clients:** the v13→v14 transition (stale cache deleted, new CSS served
  without a manual refresh) is proven end-to-end by
  `tests/responsive.test.mjs › old v13 client adopts the new build on next visit`; the
  production bundle contains the same lifecycle code verified above.

---

## 7. Addendum — v4.3 (commit `90d4add`): the "tiny UI + clipped rows" report

After the v4.2 release, real-device screenshots still showed (a) rows clipped at the right
edge and (b) a shell that occupied only ~80% of the visible screen. Re-investigation with
bounding-box measurement on the LIVE detail pages found one additional root cause plus one
user-side amplifier:

**Cause 11 (overflow, confirmed by measurement):** `.app-detail-layout` is a CSS grid with an
*implicit `auto` column*. Measured on production before the fix (360 px viewport,
`/game/samva-online-tic-tac-toe`): `document.scrollWidth = 497`; the column track computed to
`472px`, and `.app-detail-hero`, `.app-stats`, `.app-desc`, `.detail-actions` and
`.screenshots-scroll` all rendered 472 px wide inside a 340 px container. The track's
min-content contributor is the screenshot rail: a horizontal scroll container does **not**
shrink its intrinsic (min-content) contribution — six fixed-width thumbs ≈ 472 px — and an
`auto` track honours that floor. Content-poor apps (2 screenshots, the shape used by earlier
fixtures and by the slugs sampled in the first live pass) stay below the viewport, which is
why earlier matrices read clean.
**Fix:** explicit `grid-template-columns: minmax(0, 1fr)` on `.app-detail-layout` (plus
`min-width:0; max-width:100%` on its children), capped second column on `.app-detail-hero`,
`min-width:0` on `.screenshots-scroll`, and pre-emptive caps on the other wide implicit-auto
grids (`.app-info-table`, `.reviews-list`, `.auth-benefits`, `.update-banner`). The rail still
scrolls internally; nothing was hidden or scaled.

**Cause 12 (perceived "tiny UI", user-side amplifier):** the device's Chrome held a per-site
page-zoom of ≈85% (visual viewport ≈423 CSS px while the layout viewport stayed 360). The
340–360 px shell then painted onto ~80% of the visible area with the page background showing
as a dark band on the right, and the 472 px rows ran under the screen edge — exactly the
"zoomed-out desktop canvas" appearance. No `zoom`, `transform: scale`, fixed desktop canvas or
viewport override exists in the codebase (verified by scan and by computed-style probes);
after Cause 11 is fixed there is no reason to pinch-zoom, and resetting the site zoom to 100%
(Chrome menu → zoom) restores full-size rendering. Condition-B guard added to the regression
suite: every route now also asserts the shell width ≥ viewport − 48 px, so a shrink-wrapped
"desktop canvas" can never pass the tests again.

**Regression coverage added:** fixture game now carries five screenshots (live shape), so the
whole matrix (16 viewports × 8 routes × font scales) exercises the rail; the offender walker
additionally reports shell narrowness; the SW deploy-transition test is version-agnostic.

**Re-verification after deploy of `90d4add`:** the two URLs from the user's screenshots
(`/game/samva-online-tic-tac-toe`, `/app/ami-ai`) plus home pass 21/21 checks at
320/360/360×780/375/390/412/430 (dark theme, real mobile emulation): `scrollWidth == viewport`,
zero offenders, shell == viewport; live full matrix (`LIVE_SLUGS=1 FONT_ALL=1`) 160/160 clean;
local suites unit 61 / functions 19 / e2e 38 / responsive 30 = 148 passed; SW now
`sayem-static-v15`.
