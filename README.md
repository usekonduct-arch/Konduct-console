# Konduct Console

The staff web platform: routes and fares, driver onboarding, vehicle stickers, riders, approvals,
disputes, deposits, kill switches, staff roles, the audit log and pilot sign-ups.

```
npm install
npm run dev      # http://localhost:5190
npm run build
```

Deploy on Vercel as its own project (framework: Vite, output `dist`). Optional env vars:
`VITE_BACKEND_URL` (default `https://konduct-backend.onrender.com`), `VITE_FIREBASE_API_KEY`.

## How it talks to Konduct

- **Reads** are live Firestore listeners. The security rules (`staffReader` in konduct-backend/firestore.rules)
  only allow staff with a staff role, a completed second sign-in step and an active profile.
- **Changes** are backend callables on the Render server (`staff*` in konduct-backend/functions/src/index.ts),
  which re-check role, MFA, verified email and status, and audit every change. Sensitive ones
  (refunds over ₦5,000, balance adjustments, deposit assignment, limit changes, staff roles, resuming
  payouts) only create a request that a *different* staff member approves in Approvals.
- The Render server only accepts browser calls from origins in its `CONSOLE_ORIGINS` env var.

## Sign-in

Email + password, then a 6-digit code from an authenticator app (TOTP). On first sign-in the console
asks the person to verify their email and link an authenticator. Until they have a staff role, it
shows their account ID to send to an admin.

## Roles

| Role | Can |
| --- | --- |
| admin | everything: switches, staff roles, approving adjustments, limits and role changes |
| ops | routes, vehicles, approvals, refunds, deposits, limit and balance requests |
| agent | invite drivers at the park, print stickers, lock/unlock accounts (no lists) |
| support | disputes, deposits, lock/unlock accounts |
| auditor | read everything, including the audit log |
| marshal | nothing in the console yet |

## First-time setup

1. Firebase console → Authentication → Settings → upgrade to **Firebase Authentication with Identity Platform**,
   then enable TOTP multi-factor (see konduct-backend README).
2. Two founders each sign in to the console once, verify their email and link an authenticator.
3. From `konduct-backend/functions`, make them the two founding admins:
   `FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run bootstrap-admin -- --email founder@example.com` (once per founder).
4. Everyone else signs in, sends their account ID to an admin, who adds them under Staff; the other admin approves.
