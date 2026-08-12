# American Dev Corp Backend Setup

The private intake account requires a backend-capable deployment. GitHub Pages can serve the public HTML, but it cannot run the admin login, private inboxes, access-code generation, stored submissions, or email-triggering API routes.

## Required deployment target

Deploy this repository to Netlify or another host that supports the serverless functions in `netlify/functions/`.

## Required environment variables

Set these variables in the deployment provider:

- `ADMIN_PASSWORD`: private password for `/admin/`
- `ADMIN_SESSION_SECRET`: long random secret used to sign the admin session cookie
- `USER_SESSION_SECRET`: long random secret used to sign the private user sign-in cookie
- `RESEND_API_KEY`: API key used by the backend to send email
- `FROM_EMAIL`: verified sender, for example `American Dev Corp <noreply@americandevcorp.com>`

Admin/request emails are routed to:

- `gilbert.aguirre.office@gmail.com`

## Backend flows

- Public service requests post to `/api/intake/request`
- Admin sign-in posts to `/api/admin/login`
- Admin inbox reads from `/api/admin/submissions?type=requests`
- Admin approval/denial posts to `/api/admin/decision`
- Approved requests receive a generated 6-digit access code by email
- Access-code verification posts to `/api/intake/code`
- Authorized application submissions post to `/api/intake/application`
- Application submissions appear in a separate admin inbox from service requests

## Market Directory (iOS app) backend

The Market Directory iOS app talks to this same site's backend under `/api/market-directory/*`
and shares the site's email-OTP sign-in endpoints (`/api/sign-in-code`, `/api/sign-in-verify`),
now generalized to serve four callers from one pair of functions: the website's own admin login
(no `role` field, unchanged behavior) and the app's three roles (`consumer`, `store-host`,
`admin`, selected via a `role` field in the request body).

### Additional required environment variables

- `MARKET_DIRECTORY_SESSION_SECRET`: long random secret used to sign app bearer tokens
  (`_shared/app-auth.mjs`). Separate from `ADMIN_SESSION_SECRET`/`USER_SESSION_SECRET` on purpose —
  a leaked or rotated secret in one system can't be replayed as a valid token in the other.
- `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`:
  App Store Connect API credentials, used by `_shared/app-store.mjs` to verify purchase
  transactions server-side against Apple before granting any billing effect. The private key
  (a `.p8` file from App Store Connect) should be base64-encoded before being set as the env var.
  Without these three set, `billing-receipt` fails closed with a clear "not configured" error
  rather than trusting the client.

### Before purchases will work: confirm the product ID mapping

`market-directory.mjs` maps verified Apple product identifiers to their effect (activate
subscription, mark setup package purchased, grant an edit-request credit) via a `productEffects`
object near the top of the file. Those identifiers follow this app's bundle ID convention
(`american-dev-corp.The-Market-Directory.<product>`) but were **not** confirmed against what's
actually configured in App Store Connect — update them to match the real product identifiers
before relying on this in production. An unrecognized product ID fails the request loudly
(422) rather than silently doing nothing.

### Role-based sign-in flow

1. `POST /api/sign-in-code` with `{ email, role }` — sends a 6-digit code. For `store-host`
   and `admin`, code issuance is gated on an existing account so the response is deliberately
   identical (`"If that email has an account, a code was sent."`) whether or not one exists, to
   avoid confirming account existence to the caller. `consumer` always sends a code — email
   delivery itself proves ownership; whether the call becomes a sign-in or an account creation
   is resolved at verify time.
2. `POST /api/sign-in-verify` with `{ email, code, role, ... }` — on success returns a bearer
   token (`_shared/app-auth.mjs`, 12h for admin, 30 days for consumer/store-host) to send as
   `Authorization: Bearer <token>` on every `/api/market-directory/*` call. A first-time
   `consumer` verify must also include `first_name`, `last_name`, and a birth date
   (`birth_month`/`birth_day`/`birth_year`) — the account is created atomically at verify time
   rather than through a separate open signup endpoint.

### Becoming a Store Host

There is no open self-serve Store Host signup. The flow is admin-gated end to end:

1. Anyone `POST`s `/api/market-directory/host-access-request` with business details (no auth
   required — the requester doesn't have an account yet).
2. An admin lists pending requests via `GET /api/market-directory/host-access-request` (admin
   token required) and approves or denies via `POST` with `{ id, action: "approve" | "deny" }`.
3. Approval generates a one-time code, stores it against that email
   (`market-directory-host-access-codes` blob store), and emails it.
4. The applicant redeems it via `POST /api/market-directory/store-host-signup` with
   `{ email, code, business_name, ... }`, which creates the storefront record and returns a
   store-host bearer token directly.

### Endpoint summary

All endpoints below live at `/api/market-directory/:endpoint`. Unless noted, writes require an
`Authorization: Bearer` app token; admin tokens satisfy any single-role requirement.

| Endpoint | GET | POST |
|---|---|---|
| `store-hosts` | Public directory (full billing/contact fields only for admin or the host's own token) | — |
| `consumers` | Admin-only list | — |
| `product` | Public, by `?storefront=` | Store-host create; `{ product_id }` to remove (owner or admin) |
| `storefront-review` | Public, by `?storefront=` | Consumer only; reviewer name comes from the verified account, not client input |
| `storefront-upvote` | Public count + `upvoted_by_me`, by `?storefront=` | Consumer only; idempotent per-consumer toggle, not an increment |
| `message` | Auth required; `?conversation_id=` for a thread, omitted for a conversation list | Consumer starts a thread; consumer/store-host/admin reply within one they're part of |
| `support-request` | Admin-only list | Any authenticated role to file; admin `{ id, status }` to update |
| `host-access-request` | Admin-only list | Open to file; admin `{ id, action }` to approve/deny (see above) |
| `sponsorship-request` | Admin-only list | Store-host (own storefront) or admin to file; admin `{ id, status }` to update |
| `storefront-status` | — | Admin (any field) or the owning store-host (profile fields only — never billing fields) |
| `billing-receipt` | — | Store-host; verifies `transaction_id` against Apple before applying any effect |
| `consumer-signup` | — | Consumer only; updates name/address on the caller's own profile (account creation itself happens via sign-in-verify, above) |
| `store-host-signup` | — | Redeems a host-access code (see above) |
| `account-delete` | — | Consumer or store-host; deletes the caller's own account (consumer: tombstoned; store-host: storefront set to `Scheduled for Deletion`) |
