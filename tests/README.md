# Tests — Sayem WebStore

Three honest, deterministic suites. They never touch production: the browser tests
launch Chromium with `--host-resolver-rules` that dead-end the real Firebase database
host, the IP-lookup host and the ad-network host at `127.0.0.1`, and every Firebase
write helper is replaced by an in-page spy that records payloads instead of sending
them. Data comes from `tests/fixtures.mjs` (5 apps incl. duplicate names, 4 users with
different acquisition histories, 1 admin).

## Requirements

- Node.js ≥ 20 (uses ESM, global `fetch`, module syntax detection for the CJS/ESM mix)
- Puppeteer (browser suites only): `npm i puppeteer` in any directory, then set
  `PUPPETEER_PATH` or install it next to the repo. The suites resolve puppeteer via
  `createRequire("/tmp/e2e/package.json")` in this sandbox; change that path in
  `tests/e2e.test.mjs` to wherever you installed puppeteer.
- Chromium system libraries (Debian/Ubuntu): `libnss3 libnspr4 libatk1.0-0
  libatk-bridge2.0-0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2 libcups2 libdrm2`

## Run

```bash
node tests/unit.test.mjs        # pure logic: slugs, ratings, update checker,
                                # attribution state machine, sitemap, JSON-LD, renderers
node tests/functions.test.mjs   # real HTTP vs tools/dev-server.mjs + mock Firebase:
                                # routing matrix, crawler SSR pages, sitemap, headers
node tests/e2e.test.mjs         # Puppeteer: storefront UX, guest downloads, attribution
                                # scenarios A–F, signup writes, responsive, admin panel
```

Each suite exits non-zero on failure. Screenshots from the responsive run land in
`/tmp/shots/`.

`tools/dev-server.mjs` mirrors `vercel.json` locally (crawler-UA conditional rewrites,
`/sitemap.xml` → `api/sitemap.js`, SPA fallbacks, 404 page) so the serverless behaviour
can be tested without deploying. It accepts `FIREBASE_DATABASE_URL` and
`SHELL_BASE_URL` env overrides, which the tests use to point at the mock REST server.

## What is covered

- **Unit (61):** slug collisions are deterministic and order-independent; ratings are
  `null` without real reviews; the update-checker matrix (older/equal/newer/missing);
  source detection for every UTM/referrer family incl. subdomain variants; first-touch
  immutability; internal navigation never overwrites; 90-day expiry; corrupted state;
  signup attribution always carries both detected + user-selected source; sitemap
  contains every real record exactly once, no utm/admin URLs; JSON-LD honesty
  (aggregateRating only with real reviews); guest vs logged-in renderer output.
- **Integration (17):** routing parity with vercel.json; Googlebot/Facebookbot get
  fully rendered unique pages (title/canonical/OG/JSON-LD/content/breadcrumbs);
  humans get the fast shell; unknown slug = real 404; wrong type prefix = 301;
  dynamic sitemap XML + cache headers; security headers; PWA assets.
- **E2E (34):** branding + production SEO head; client routing incl. deep links, back
  button, categories, search; guest download fires the counter without login; review
  form gated behind login with a clear message; report gating; update banner matrix
  via `?pkg=&vc=`; attribution scenarios A–F end-to-end including the signup write
  payload; referrer normalization; corrupted-storage fallback; responsive 360/768/1280
  without horizontal overflow; service worker registration; admin login, users table
  with source/campaign filters, user detail acquisition view, traffic dashboard ranges,
  source-row → filtered users drill-down, campaign link generator validation, and
  version fields in Add/Edit App.
