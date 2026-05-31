import { adminRequestEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON, required } from "./_shared/json.mjs";
import { makeId, requestStore } from "./_shared/storage.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const fields = await readJSON(req);
  if (!required(fields["Full Name"]) || !required(fields.Email) || !required(fields["App Name or Working Title"])) {
    return json({ error: "Missing required service request fields" }, { status: 422 });
  }

  const now = new Date().toISOString();
  const record = {
    id: makeId("req"),
    type: "request",
    status: "new",
    createdAt: now,
    appName: fields["App Name or Working Title"],
    requesterEmail: fields.Email,
    fields
  };

  await requestStore().setJSON(record.id, record);
  await sendEmail(adminRequestEmail(record));

  return json({ ok: true, id: record.id });
};

export const config = {
  path: "/api/intake/request"
};
