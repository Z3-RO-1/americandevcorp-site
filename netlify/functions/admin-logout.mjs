import { json } from "./_shared/json.mjs";

export default async () => {
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": "adc_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      }
    }
  );
};

export const config = {
  path: "/api/admin/logout"
};
