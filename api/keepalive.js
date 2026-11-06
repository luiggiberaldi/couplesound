// Latido diario contra Supabase para que el plan gratuito no pause el proyecto
// por inactividad. Usa solo la clave anónima, que ya viaja en el frontend: no
// necesita ni acepta service_role.

const RPC_PATH = '/rest/v1/rpc/keepalive_ping';

export function resolveSupabaseCredentials(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

export async function pingSupabase({ url, key, fetchImpl = fetch }) {
  const response = await fetchImpl(`${url}${RPC_PATH}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
    throw new Error(`Supabase respondió ${response.status}${suffix}`);
  }

  const rooms = await response.json().catch(() => null);
  return { rooms };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }

  const credentials = resolveSupabaseCredentials();
  if (!credentials) {
    res.status(503).json({
      ok: false,
      error: 'Faltan SUPABASE_URL y SUPABASE_ANON_KEY en el entorno del servidor'
    });
    return;
  }

  try {
    const result = await pingSupabase(credentials);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
}
