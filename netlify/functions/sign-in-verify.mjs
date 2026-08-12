import { json, readJSON } from "./_shared/json.mjs";
import { makeId, marketDirectoryStore, signInCodeStore } from "./_shared/storage.mjs";
import { createAppToken } from "./_shared/app-auth.mjs";
import { ageFromISODate, parseBirthDate, resolveConsumerByEmail, resolveStoreHostByEmail, text } from "./_shared/market-directory-data.mjs";

const encoder = new TextEncoder();
const siteAdminEmail = "gilbert.aguirre.office@gmail.com";
const marketDirectoryAdminEmail = "gilbert.aguirre.office@gmail.com";
const roles = ["consumer", "store-host", "admin"];

function env(name) {
  return Netlify.env.get(name);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function digest(value) {
  const encoded = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Buffer.from(hash).toString("hex");
}

async function siteUserSignature(payload) {
  const secret = env("USER_SESSION_SECRET") || env("ADMIN_SESSION_SECRET") || env("ADMIN_PASSWORD") || "dev-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(signed);
}

async function createSiteUserToken(email) {
  const payload = base64url(encoder.encode(JSON.stringify({
    role: "site-user",
    email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })));
  return `${payload}.${await siteUserSignature(payload)}`;
}

function storeKeyFor(role, email) {
  return role ? `${role}:${email}` : email;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const email = normalizeEmail(body.email);
  const code = cleanCode(body.code);
  const role = roles.includes(body.role) ? body.role : null;

  if (!email || code.length !== 6) {
    return json({ error: "Enter the 6-digit code." }, { status: 400 });
  }
  if (!role && email !== siteAdminEmail) {
    return json({ error: "This email is not authorized." }, { status: 403 });
  }
  if (role === "admin" && email !== marketDirectoryAdminEmail) {
    return json({ error: "This email is not authorized." }, { status: 403 });
  }

  const store = signInCodeStore();
  const storeKey = storeKeyFor(role, email);
  const record = await store.get(storeKey, { type: "json" });

  if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
    return json({ error: "That code expired. Request a new one." }, { status: 401 });
  }

  if ((record.attempts || 0) >= 5) {
    await store.delete(storeKey);
    return json({ error: "Too many attempts. Request a new code." }, { status: 401 });
  }

  const codeHash = await digest(`${email}:${code}`);
  if (codeHash !== record.codeHash) {
    await store.setJSON(storeKey, { ...record, attempts: (record.attempts || 0) + 1 });
    return json({ error: "Invalid code." }, { status: 401 });
  }

  await store.delete(storeKey);

  if (!role) {
    // Original website admin flow — unchanged.
    const token = await createSiteUserToken(email);
    return json(
      { ok: true, email },
      { headers: { "Set-Cookie": `adc_user=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` } }
    );
  }

  if (role === "admin") {
    const token = await createAppToken({ role: "admin", email });
    return json({ ok: true, token, role, email });
  }

  if (role === "store-host") {
    const host = await resolveStoreHostByEmail(email);
    if (!host) {
      return json({ error: "No Store Host account found for this email." }, { status: 404 });
    }
    const token = await createAppToken({ role: "store-host", email });
    return json({ ok: true, token, role, email, business_name: host.business_name });
  }

  // role === "consumer"
  const existing = await resolveConsumerByEmail(email);
  if (existing) {
    const token = await createAppToken({ role: "consumer", email });
    return json({
      ok: true,
      token,
      role,
      email,
      first_name: existing.first_name || "",
      age: ageFromISODate(existing.birth_date)
    });
  }

  // No account yet — create one now only if profile fields were submitted alongside the
  // code, so account creation and proof of email ownership happen in one atomic step.
  const firstName = text(body.first_name);
  const lastName = text(body.last_name);
  const birthDate = parseBirthDate(body);

  if (!firstName || !lastName || !birthDate.valid) {
    return json({ error: "No account found for this email. Create an account first.", accountExists: false }, { status: 404 });
  }

  const now = new Date().toISOString();
  const signupRecord = {
    id: makeId("market_consumer_signup"),
    type: "market-directory",
    endpoint: "consumer-signup",
    title: email,
    status: "new",
    createdAt: now,
    payload: {
      first_name: firstName,
      last_name: lastName,
      email,
      address: text(body.address),
      birth_date: birthDate.isoDate,
      agreement_version: text(body.agreement_version) || "consumer-guidelines-2026-05"
    }
  };

  await marketDirectoryStore().setJSON(signupRecord.id, signupRecord);

  const token = await createAppToken({ role: "consumer", email });
  return json({
    ok: true,
    token,
    role,
    email,
    first_name: firstName,
    age: ageFromISODate(birthDate.isoDate)
  });
};

export const config = {
  path: "/api/sign-in/verify"
};
