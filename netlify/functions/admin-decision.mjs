import { requireAdmin } from "./_shared/auth.mjs";
import { approvalEmail, denialEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { accessCodeStore, requestStore } from "./_shared/storage.mjs";

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async (req) => {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const { id, decision } = body;
  const requests = requestStore();
  const record = await requests.get(id, { type: "json" });

  if (!record) {
    return json({ error: "Request not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const clientEmail = record.fields?.Email || record.fields?.["Client Email"];
  const clientName = record.fields?.["Full Name"] || record.fields?.["Client Full Name"];
  const appName = record.fields?.["App Name or Working Title"] || record.fields?.["Application Name"];

  if (!clientEmail) {
    return json({ error: "Request is missing an email address" }, { status: 422 });
  }

  if (decision === "approved") {
    const code = generateCode();
    const access = {
      code,
      requestId: id,
      email: clientEmail,
      status: "available",
      createdAt: now,
      usedAt: null
    };
    await accessCodeStore().setJSON(code, access);
    await requests.setJSON(id, { ...record, status: "approved", decidedAt: now, accessCode: code });

    const email = approvalEmail({ name: clientName, appName, code });
    await sendEmail({ to: clientEmail, ...email });
    return json({ ok: true, status: "approved", code });
  }

  if (decision === "denied") {
    await requests.setJSON(id, { ...record, status: "denied", decidedAt: now });
    const email = denialEmail({ name: clientName, appName });
    await sendEmail({ to: clientEmail, ...email });
    return json({ ok: true, status: "denied" });
  }

  return json({ error: "Decision must be approved or denied" }, { status: 422 });
};

export const config = {
  path: "/api/admin/decision"
};
