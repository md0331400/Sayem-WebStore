# Production Checklist — Sayem WebStore

Cloudflare is intentionally excluded from this checklist for now.

## Code-side work already prepared

- Firebase Authentication is used for new accounts.
- Successful Firebase Auth login removes the legacy plaintext password field from the matched profile.
- User accounts can be blocked/unblocked from the admin panel.
- User-facing and admin password reset flows use Firebase Authentication.
- Review/report forms verify the active Firebase Auth uid before writing.
- Review and report lengths are validated client-side.
- PWA HTML/JS/CSS/manifest requests are network-first with offline cache fallback.
- GitHub/APK requests bypass the service worker.
- Additional response hardening headers are configured in `vercel.json`.
- Proposed Firebase rules now validate download increments, reviews, reports and protected user status fields.

## Firebase Console migration — manual

1. Confirm Firebase Authentication → Email/Password is enabled.
2. Ensure every trusted admin has a Firebase Auth account.
3. Ensure each trusted admin profile has its matching `uid`.
4. Build and verify `/adminUids/{uid}: true` for every trusted admin using a trusted/manual process. Do not make this node client-writable.
5. Allow existing users to migrate through the existing legacy-login upgrade flow.
6. Monitor migration coverage and identify any remaining profiles without `uid`.
7. When the legacy client login fallback is no longer needed, remove the plaintext-password comparison path from `app.js` and `admin/index.html`.
8. Purge all remaining `password` fields from migrated `/users` and `/admins` records.
9. Review `database.rules.proposed.json` against the final data model.
10. Deploy the reviewed rules only after the legacy client scans of `/users` and `/admins` have been retired.

## Security checks after migration

- Anonymous users can read only intentionally public catalog/settings data.
- Anonymous users cannot read `/users`, `/admins`, `/reports`, `/adminActivity`, or other private nodes.
- A normal user can only modify their own user record and their own review/report data.
- A normal user cannot change their own `blocked` or `status` fields.
- Admin-only writes require a trusted admin uid.
- Download counter writes can only increase the nested `downloads` value by one per accepted transaction.
- Visitor archive records are not writable by the current client path.

## Operational hygiene

- Revoke/rotate any GitHub token that was previously exposed and use a fine-grained repository-scoped token.
- Do not commit Firebase service-account keys, private tokens or server secrets.
- Keep regular Firebase data backups using the Admin Panel export before major migrations.
- Test login, signup, password reset, review, report, download, app publish/feature, user block/unblock and PWA install after every major release.

## Release sequence

Security migration → rules verification → functional regression test → production deploy → browser/mobile smoke test → Cloudflare later.