import { createToken } from "./_shared/auth.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { signInCodeStore } from "./_shared/storage.mjs";

const encoder = new TextEncoder();
const allowedEmail = "gilbert.aguirre.office@gmail.com";

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

async function signature(payload) {
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

async function createUserToken(email) {
  const payload = base64url(encoder.encode(JSON.stringify({
    role: "site-user",
    email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })));
  return `${payload}.${await signature(payload)}`;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const email = normalizeEmail(body.email);
  const code = cleanCode(body.code);

  if (!email || code.length !== 6) {
    return json({ error: "Enter the 6-digit code." }, { status: 400 });
  }
  if (email !== allowedEmail) {
    return json({ error: "This email is not authorized." }, { status: 403 });
  }

  const store = signInCodeStore();
  const record = await store.get(email, { type: "json" });
  if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
    return json({ error: "That code expired. Request a new one." }, { status: 401 });
  }

  if ((record.attempts || 0) >= 5) {
    await store.delete(email);
    return json({ error: "Too many attempts. Request a new code." }, { status: 401 });
  }

  const codeHash = await digest(`${email}:${code}`);
  if (codeHash !== record.codeHash) {
    await store.setJSON(email, { ...record, attempts: (record.attempts || 0) + 1 });
    return json({ error: "Invalid code." }, { status: 401 });
  }

  await store.delete(email);
  const token = await createUserToken(email);
  const adminToken = await createToken();

  return json(
    { ok: true, email, admin_token: adminToken },
    {
      headers: {
        "Set-Cookie": `adc_user=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
      }
    }
  );
};

export const config = {
  path: "/api/sign-in/verify"
};
