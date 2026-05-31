import { adminApplicationEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON, required } from "./_shared/json.mjs";
import { accessCodeStore, applicationStore, makeId } from "./_shared/storage.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const code = String(body.code || "").trim();
  const requestId = String(body.requestId || "").trim();
  const fields = body.fields || {};
  const email = String(fields.Email || fields["Client Email"] || "").trim().toLowerCase();

  if (!required(code) || !required(requestId) || !required(email) || !required(fields["Full Application Name"])) {
    return json({ error: "Missing required application intake fields" }, { status: 422 });
  }

  const access = await accessCodeStore().get(code, { type: "json" });
  if (!access || access.requestId !== requestId || access.status !== "available" || String(access.email).toLowerCase() !== email) {
    return json({ error: "Wrong email or access code." }, { status: 401 });
  }

  const now = new Date().toISOString();
  const record = {
    id: makeId("app"),
    type: "application",
    status: "new",
    requestId,
    accessCode: code,
    createdAt: now,
    appName: fields["Full Application Name"],
    requesterEmail: email,
    fields
  };

  await applicationStore().setJSON(record.id, record);
  await accessCodeStore().setJSON(code, { ...access, status: "used", usedAt: now, applicationId: record.id });
  await sendEmail(adminApplicationEmail(record));

  return json({ ok: true, id: record.id });
};

export const config = {
  path: "/api/intake/application"
};
