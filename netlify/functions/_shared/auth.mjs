import { json } from "./json.mjs";

const encoder = new TextEncoder();

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
  const secret = env("ADMIN_SESSION_SECRET") || env("ADMIN_PASSWORD") || "dev-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(signed);
}

export async function createToken() {
  const payload = base64url(encoder.encode(JSON.stringify({
    role: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 12
  })));
  return `${payload}.${await signature(payload)}`;
}

export async function verifyToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (sig !== await signature(payload)) return false;

  try {
    const parsed = JSON.parse(base64urlDecode(payload).toString("utf8"));
    return parsed.role === "admin" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function cookieToken(req) {
  const cookie = req.headers.get("cookie") || "";
  return cookie
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("adc_admin="))
    ?.split("=")[1];
}

export async function requireAdmin(req) {
  if (await verifyToken(cookieToken(req))) return null;
  return json({ error: "Unauthorized" }, { status: 401 });
}

export function adminPasswordMatches(password) {
  const configured = env("ADMIN_PASSWORD");
  return configured && password === configured;
}
