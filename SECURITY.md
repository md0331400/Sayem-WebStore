# Security Notes — Sayem WebStore

Last updated: 2026-09-20 (release: SEO + attribution production upgrade)

This document describes known security weaknesses in the current system, what this
release changed (and deliberately did **not** change), and the recommended path to
fix each issue without breaking existing users or data.

---

## 1. Plaintext passwords in Firebase Realtime Database (pre-existing, NOT fixed destructively)

**Status: known weakness — documented, migration recommended, no destructive change made.**

- Storefront accounts (`/users/{key}`) store `password` in plaintext.
- Admin accounts (`/admins/{key}`) also store plaintext credentials.
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

1. Enable **Firebase Authentication (Email/Password + optional Google)** in the console.
2. Add a one-time "re-secure your account" flow: existing users log in the old way once,
   then are asked to create a Firebase Auth credential; store the Firebase `uid` on the
   existing `/users/{key}` record (`uid` field) and keep the old fields for history.
3. Switch login/signup code paths to Firebase Auth for accounts that have a `uid`;
   keep the legacy path only as a fallback until migration coverage is acceptable,
   then remove it.
4. Once no client needs to scan `/users`, apply the proposed rules (see §4) and delete
   the plaintext `password` field from migrated records.

Until then: advise users not to reuse passwords, and treat the password column as
public data (because, under current rules, it effectively is).

## 2. Open database rules (pre-existing)

The Realtime Database currently relies on permissive rules so that the client-side app
can read `/apps`, `/settings`, `/ads` and scan `/users` for login. In practice this also
exposes `/reports`, `/visitors`, `/admins` and the plaintext passwords to anonymous
readers.

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
- `/users/{uid}`: readable/writable only by the owning authenticated user; admins get
  read access for support tooling (with an audit trail recommended).
- `/reports`: create-only for authenticated users; read for admins.
- `/visitors`: write-only for clients (aggregated counters), no public read of raw rows.
- `/admins`: no client reads at all; admin checks move server-side or to custom claims.

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
