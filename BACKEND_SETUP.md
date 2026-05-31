# American Dev Corp Backend Setup

The private intake account requires a backend-capable deployment. GitHub Pages can serve the public HTML, but it cannot run the admin login, private inboxes, access-code generation, stored submissions, or email-triggering API routes.

## Required deployment target

Deploy this repository to Netlify or another host that supports the serverless functions in `netlify/functions/`.

## Required environment variables

Set these variables in the deployment provider:

- `ADMIN_PASSWORD`: private password for `/admin/`
- `ADMIN_SESSION_SECRET`: long random secret used to sign the admin session cookie
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
