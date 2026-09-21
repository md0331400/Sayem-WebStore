# Downloads & Update Architecture — Sayem WebStore

Two separate systems. Do not mix them.

```
                SAYEM WEBSTORE
                     |
          +----------+----------+
          |                     |
          v                     v
   WEBSITE DOWNLOAD       UPDATE API (JSON)
          |                     |
          v                     v
   GitHub Raw APK         Firebase `apps`
   (file host)            (source of truth)
                                |
                                v
                       packageName + versionCode
                                |
                                v
                        Future Android App
                                |
                                v
                     NATIVE update dialog
                     (owned by the app, NOT the website)
```

## A) Website download system (Direct Download)

1. Upload the APK to this GitHub repository (e.g. `apps/myapp.apk`).
2. Copy its **Raw** URL: `https://raw.githubusercontent.com/md0331400/Sayem-WebStore/main/apps/myapp.apk`
3. Open **Sayem WebStore Admin → Add App** (or Edit App).
4. Download Type is fixed to **Direct Download** (value stored: `direct`).
5. Paste the Raw URL into **Download URL (GitHub Raw APK)**.
6. Set **Version Name** (human-readable, e.g. `1.2.0`).
7. Set **Version Code** (Android integer, e.g. `12`) — used for update comparison.
8. Set **Package Name** (Android application id, e.g. `com.amisayem.example`).
9. Save.

Behaviour:

- The Download button hands the browser the stored URL **in the same tab**
  (no `target="_blank"`, no new window). Chrome/Android starts the APK
  download straight from GitHub Raw.
- The download counter increments **exactly once per genuine click**
  (transaction completes before the hand-off navigation).
- Guests download without login. Login is required only for reviews,
  ratings and reports.
- The APK is **never** fetched, streamed, proxied or cached by Vercel or by
  the service worker (`githubusercontent.com`, `github.com` and `*.apk`
  requests are bypassed by `service-worker.js`).
- Old app records without `downloadType` keep working: their `link` field is
  treated as the direct download URL.

## B) Update check API (future Android app)

Endpoint (public, read-only, no login, CORS-open):

```
GET https://sayemwebstore.vercel.app/api/app-update?packageName=com.amisayem.sayemapp&versionCode=20
```

Rules:

- Reads the same Firebase `apps` catalog the website and admin use.
- Compares **Version Code only**: `latestVersionCode > installedVersionCode`
  → `updateAvailable: true`; equal or lower → `false` (never a false update).
- Missing/invalid `versionCode` or malformed `packageName` → HTTP 400 JSON.
- Unknown package → `{ "found": false, "updateAvailable": false, "reason": "not-listed" }`.
- Missing website version data → `updateAvailable: false`,
  `reason: "version-unavailable"`.
- Responses are `Cache-Control: no-store`, so an admin version bump is visible
  on the next check without redeploying the website.
- `downloadUrl` is the stored GitHub Raw URL, returned as-is (never proxied).

The Android app shows its **own native update dialog** from this JSON.
**The website itself never shows an update banner, modal or "Update Now"
button** — `?pkg=`/`?vc=` parameters no longer trigger any website UI.
`window.SayemWebStore.checkAppUpdate()` remains only as a thin client of the
API for tests/compatibility.

## Adding another app later

No backend changes needed: the single generic endpoint matches any app by
`packageName`, so every app added from the Admin Panel is automatically
supported by the update API.
