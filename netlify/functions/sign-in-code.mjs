import { sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { signInCodeStore } from "./_shared/storage.mjs";

const codeLifetimeMs = 1000 * 60 * 10;

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

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const code = makeCode();
  const codeHash = await digest(`${email}:${code}`);
  const expiresAt = new Date(Date.now() + codeLifetimeMs).toISOString();

  await signInCodeStore().setJSON(email, {
    email,
    codeHash,
    expiresAt,
    attempts: 0,
    createdAt: new Date().toISOString()
  });

  await sendEmail({
    to: email,
    subject: "Your American Dev Corp sign-in code",
    text: [
      "Use this code to sign in to American Dev Corp:",
      "",
      code,
      "",
      "This code expires in 10 minutes. If you did not request it, you can ignore this email."
    ].join("\n")
  });

  return json({ ok: true, message: "Code sent." });
};

export const config = {
  path: "/api/sign-in/code"
};
