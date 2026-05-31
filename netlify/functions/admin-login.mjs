import { adminPasswordMatches, createToken } from "./_shared/auth.mjs";
import { json, readJSON } from "./_shared/json.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  if (!adminPasswordMatches(body.password || "")) {
    return json({ error: "Invalid sign in" }, { status: 401 });
  }

  const token = await createToken();
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `adc_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`
      }
    }
  );
};

export const config = {
  path: "/api/admin/login"
};
