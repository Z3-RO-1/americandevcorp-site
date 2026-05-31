export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

export async function readJSON(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}
