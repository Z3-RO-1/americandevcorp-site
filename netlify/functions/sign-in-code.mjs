import { sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { signInCodeStore } from "./_shared/storage.mjs";
import { resolveStoreHostByEmail } from "./_shared/market-directory-data.mjs";

const codeLifetimeMs = 1000 * 60 * 10;
const siteAdminEmail = "gilbert.aguirre.office@gmail.com";
const marketDirectoryAdminEmail = "gilbert.aguirre.office@gmail.com";
const roles = ["consumer", "store-host", "admin"];

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}

async function digest(value) {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Buffer.from(hash).toString("hex");
}

function storeKeyFor(role, email) {
  return role ? `${role}:${email}` : email;
}

// Consumers may be requesting a code to *create* an account — email delivery itself proves
// ownership, so code issuance never gates on an existing consumer record. Whether this call
// ends up being a sign-in or an account creation is resolved at verify time instead.
async function accountExistsForRole(role, email) {
  if (role === "admin") return email === marketDirectoryAdminEmail;
  if (role === "store-host") return Boolean(await resolveStoreHostByEmail(email));
  return true;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const email = normalizeEmail(body.email);
  const role = roles.includes(body.role) ? body.role : null;

  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!role) {
    // Original site-admin flow (website's own /admin login) — unchanged behavior, existing
    // callers that never send a role (e.g. projects/index.html) keep working exactly as before.
    if (email !== siteAdminEmail) {
      return json({ error: "This email is not authorized." }, { status: 403 });
    }
  } else if (!(await accountExistsForRole(role, email))) {
    // Deliberately identical response whether or not an account exists, to avoid confirming
    // or denying account existence to the caller.
    return json({ ok: true, message: "If that email has an account, a code was sent." });
  }

  const code = makeCode();
  const codeHash = await digest(`${email}:${code}`);
  const expiresAt = new Date(Date.now() + codeLifetimeMs).toISOString();

  await signInCodeStore().setJSON(storeKeyFor(role, email), {
    email,
    role,
    codeHash,
    expiresAt,
    attempts: 0,
    createdAt: new Date().toISOString()
  });

  const emailResult = await sendEmail({
    to: email,
    subject: role ? "Your Market Directory sign-in code" : "Your American Dev Corp sign-in code",
    text: [
      `Use this code to sign in${role ? " to The Market Directory" : " to American Dev Corp"}:`,
      "",
      code,
      "",
      "This code expires in 10 minutes. If you did not request it, you can ignore this email."
    ].join("\n")
  });

  if (!emailResult.sent) {
    await signInCodeStore().delete(storeKeyFor(role, email));
    return json({ error: "Email delivery is not configured on the server." }, { status: 503 });
  }

  return json({ ok: true, message: "Code sent." });
};

export const config = {
  path: "/api/sign-in/code"
};
