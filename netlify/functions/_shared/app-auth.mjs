import { json } from "./json.mjs";

const encoder = new TextEncoder();

// Separate namespace from _shared/auth.mjs (the website's own adc_admin dashboard login) and
// from sign-in-code.mjs's default site-user token — a distinct secret + "aud" claim means a
// leaked/rotated secret in one system can never be replayed as a valid token in another.
const audience = "market-directory";

const roleLifetimeMs = {
  admin: 1000 * 60 * 60 * 12,
  "store-host": 1000 * 60 * 60 * 24 * 30,
  consumer: 1000 * 60 * 60 * 24 * 30
};

function env(name) {
  return Netlify.env.get(name);
}

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64urlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64");
}

async function signature(payload) {
  const secret = env("MARKET_DIRECTORY_SESSION_SECRET") || "dev-secret";
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

export async function createAppToken({ role, email }) {
  const lifetime = roleLifetimeMs[role] || roleLifetimeMs.consumer;
  const payload = base64url(encoder.encode(JSON.stringify({
    aud: audience,
    role,
    email,
    iat: Date.now(),
    exp: Date.now() + lifetime
  })));

  return `${payload}.${await signature(payload)}`;
}

// Returns { role, email } for a valid, unexpired token minted by this module, or null.
export async function verifyAppToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, sig] = token.split(".");
  if (sig !== await signature(payload)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64urlDecode(payload).toString("utf8"));
    if (parsed.aud !== audience) return null;
    if (!["admin", "store-host", "consumer"].includes(parsed.role)) return null;
    if (!parsed.email) return null;
    if (!(parsed.exp > Date.now())) return null;

    return { role: parsed.role, email: parsed.email };
  } catch {
    return null;
  }
}

export function bearerToken(req) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

// Establishes *who* is calling. `requiredRole`, when set, also accepts "admin" as an
// implicit superset of any single role. Endpoints still do their own resource-level
// ownership checks (e.g. "is claims.email the owner of this storefront") using the
// returned claims — this only answers "is there a valid identity, and is its role allowed
// to call this endpoint at all."
//
// Returns { claims, unauthorized: null } on success, or { claims: null, unauthorized: Response }
// when the caller should return `unauthorized` directly.
export async function requireAppAuth(req, requiredRole) {
  const claims = await verifyAppToken(bearerToken(req));

  if (!claims) {
    return { claims: null, unauthorized: json({ error: "Sign in required." }, { status: 401 }) };
  }

  if (requiredRole && claims.role !== requiredRole && claims.role !== "admin") {
    return { claims: null, unauthorized: json({ error: "Not authorized for this action." }, { status: 403 }) };
  }

  return { claims, unauthorized: null };
}

export function isAdmin(claims) {
  return !!claims && claims.role === "admin";
}
