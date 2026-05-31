import { json, readJSON, required } from "./_shared/json.mjs";
import { accessCodeStore, requestStore } from "./_shared/storage.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const code = String(body.code || "").trim();
  const email = String(body.email || "").trim().toLowerCase();

  if (!required(code) || !required(email)) {
    return json({ error: "Enter the email and access code." }, { status: 422 });
  }

  const access = await accessCodeStore().get(code, { type: "json" });
  if (!access || access.status !== "available" || String(access.email).toLowerCase() !== email) {
    return json({ error: "Wrong email or access code." }, { status: 401 });
  }

  const request = await requestStore().get(access.requestId, { type: "json" });
  if (!request) {
    return json({ error: "Request record not found." }, { status: 404 });
  }

  return json({
    ok: true,
    requestId: access.requestId,
    code,
    prefill: request.fields
  });
};

export const config = {
  path: "/api/intake/code"
};
