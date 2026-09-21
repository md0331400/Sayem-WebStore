# Security Notes — Sayem WebStore

Last updated: 2026-09-21 (production hardening release)

This document describes known security weaknesses in the current system, what this
release changed (and deliberately did **not** change), and the recommended path to
fix each issue without breaking existing users or data.

---

## 1. Plaintext passwords in Firebase Realtime Database (pre-existing, NOT fixed destructively)

**Status: migration support is now in the website; final Firebase Console/rules rollout is still required.**

- New storefront accounts use Firebase Authentication and no longer store a plaintext `password` field.
- Legacy storefront accounts still have a transitional password field until a successful login migrates them.
- Admin accounts support the same Firebase Auth migration path when an email is available.
- Login works by reading the user list client-side and comparing the stored password,
  which requires the `/users` node to be readable by the web client.

**Impact:** anyone who can read the database (see §2) can read every stored password.
Password reuse across sites makes this worse.

**Why it was not "fixed" in this release:** converting existing accounts to hashed
passwords or to Firebase Auth would invalidate every existing login (there is no way
to re-derive a password from a hash, and Firebase Auth accounts cannot be created from
plaintext passwords without the user re-entering them). The task constraints explicitly
forbade destructive user migration, so this release keeps behaviour identical and
documents the migration path instead:

1. Enable **Firebase Authentication → Email/Password** in the Firebase console.
2. Add a one-time "re-secure your account" flow: existing users log in the old way once,
   then are asked to create a Firebase Auth credential; store the Firebase `uid` on the
   existing `/users/{key}` record (`uid` field) and keep the old fields for history.
3. Switch login/signup code paths to Firebase Auth for accounts that have a `uid`;
   keep the legacy path only as a fallback until migration coverage is acceptable,
   then remove it.
4. Once no client needs to scan `/users`, apply the proposed rules (see §4) and delete
   the plaintext `password` field from migrated records.
5. Migrated user sessions use `userUids/{uid}` as a fast profile-key mapping; legacy scan fallback remains only for unmigrated accounts.

Until then: advise users not to reuse passwords, and treat the password column as
public data (because, under current rules, it effectively is).

## 2. Open database rules (pre-existing)

The Realtime Database currently relies on permissive rules so that the client-side app
can read `/apps`, `/settings`, `/ads` and legacy account records. In practice this also
exposes `/reports`, `/visitors`, `/admins` and legacy plaintext passwords to anonymous
readers until the migration is completed.

`database.rules.proposed.json` in this repository contains a ruleset that closes reads
and writes to the minimum the app needs **after** the Firebase Auth migration in §1 is
done. **Do not deploy it before the migration** — it would break legacy login (which
needs to read `/users`) and legacy admin login.

## 3. Client-exposed Firebase config

`apiKey`, `databaseURL`, etc. in `app.js` / `admin/index.html` are client identifiers,
not secrets — they must stay in the browser code. The real protection boundary is the
database rules (§2) plus application-level validation. No server secrets exist in this
repository; none were added.

## 4. Proposed Realtime Database rules (not applied automatically)

See `database.rules.proposed.json`. Highlights:

- `/apps`, `/settings`, `/ads`, `/adStats`: public read; writes require an admin uid.
- `/users/{uid}`: authenticated owner access; trusted admins can read/update through the admin mapping, and users cannot change their own `blocked`/`status` fields or recreate a `password` field.
- `/userUids/{uid}`: owner-only mapping from Firebase Auth uid to the profile record key.
- `/reports`: authenticated create/update by the owning uid; read for admins; size/type validation included.
- `/visitors`: no client writes in the proposed rules because the current public analytics path no longer needs visitor-record writes.
- `/admins/{key}`: access limited to the mapped trusted admin uid; plaintext password fields are rejected.
- `/adminUids/{uid}`: trusted setup data; client writes remain disabled.
- `/analytics`: admin read access; anonymous aggregate writes remain permitted because `/api/visit` is a public, privacy-light beacon.

Applying these rules is a **breaking change for the legacy auth flow** — pair the
deployment with the migration steps in §1.

## 5. Admin panel hardening notes

- The admin panel is a static page; "protection" today is knowing the URL plus the
  plaintext admin credential check against `/admins`. Move admin sessions to Firebase
  Auth with custom claims (`admin: true`) and enforce them in rules / serverless
  functions.
- Admin activity log exists (`/adminActivity`) — keep it and alert on unusual writes.
- The admin page is excluded from robots and from the sitemap; it is not security by
  obscurity, just hygiene.

## 6. What this release did NOT introduce

- No new secrets, keys or tokens anywhere in the repository.
- No fingerprinting, no full-referrer storage, no per-pageview analytics writes.
  Attribution stores only normalized source/medium/campaign/content/term plus
  timestamps and landing path, client-side, with a 90-day TTL.
- No third-party analytics scripts were added.
- The service worker and PWA cache were kept and version-bumped only.

## 7. Credential hygiene for this project's tooling

- The GitHub personal access token used to push this branch was exposed in a chat
  transcript. **Rotate/revoke it now** and issue a fine-grained token scoped to this
  repository only (contents: write, pull-requests: write).
- Never commit tokens: the repository remote URL is token-free and the token was only
  ever held in a temporary file outside the repo.
- The Firebase web API key in client code is public by design (see §3); the risk is the
  rules, not the key.

## 8. Reporting issues

Email abusayem0866@gmail.com (also linked in the site footer) for security reports.

## 9. Production hardening added in this release

- Browser sessions no longer persist user password fields.
- New accounts use Firebase Authentication instead of storing plaintext passwords.
- Public catalog supports explicit `published` and `featured` flags; unpublished apps are excluded from public routes/search/hero.
- Admin backup export excludes user password fields.
- App image/screenshot inputs are constrained to HTTP(S) URLs in the admin UI and rendered with the same safety rule on the public side.
- Download counters now update only the nested `apps/{key}/downloads` value, preparing the database for a ruleset that keeps the rest of each app record admin-only.
- Vercel responses now include HSTS, same-origin frame protection and a restrictive Permissions-Policy.
- Service-worker cache version was bumped to include the Firebase Auth runtime.

## 10. Download counter abuse resistance (honest limitations)

- Counters increment through a Firebase `runTransaction` on the app record, so concurrent clicks do not lose increments (atomic read-modify-write).
- The proposed rules additionally validate that a client write can only increase the nested `downloads` value by exactly one.
- The counter remains client-initiated until the rules are reviewed and deployed; direct database abuse cannot be fully eliminated by frontend code alone.

## 11. Visitor tracking discontinuation & anonymous analytics

- A pre-existing per-device visitor tracker stored IP address, user-agent, screen, RAM/CPU, battery state and (when logged in) the account's name/email/phone per visit. That collection was **removed** from the client in this release; no code path writes to `visitors/` anymore.
- Legacy `visitors/` records remain in the database until the owner purges them (admin → Visitors → Clear All). The admin UI now masks identifying fields (only device name, platform, browser, language, visit counts and timestamps are rendered).
- Replacement analytics (`POST /api/visit`) is aggregate-only: at most one event per browser session (sessionStorage-gated), carrying normalized source/sourceType/campaign/landing-path. The server stores only daily counters (`analytics/daily/{date}/…`). No IP, no cookies, no fingerprint, no per-pageview writes. Signup conversion adds exactly one increment per signup.

## 12. Attribution storage summary

- Priority: UTM parameters > external referrer > Direct. First-touch attribution is immutable once stored; latest-touch updates only from external referrers; pre-signup state lives in `localStorage` (`sayemweb_attribution_v1`) with a 90-day TTL and is validated on read (corrupted values fall back safely).
- At signup the attribution snapshot is stored on the user record together with, but separate from, the user's own "how did you hear about us" answer.

## 12. Production hardening added on 2026-09-21

- LocalStorage is no longer treated as the source of truth for the logged-in user state; Firebase Auth must confirm the session.
- Protected review/report writes verify that the local profile uid matches the active Firebase Auth uid.
- Reviews are limited to ratings 1–5 and 2000 comment characters; reports are bounded to the proposed-rule limits.
- Blocked user accounts are rejected on login/session hydration and can be controlled from the admin panel.
- User/admin password reset uses Firebase Authentication.
- Admin password changes reauthenticate with the current password before calling updatePassword.
- The PWA service worker now uses network-first fetching for HTML, JavaScript, CSS and the manifest, while keeping an offline fallback.
- Deployment headers and cache freshness are tightened in vercel.json.
- See PRODUCTION-CHECKLIST.md for the remaining Firebase Console migration steps.