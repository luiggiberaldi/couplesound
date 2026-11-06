import test from 'node:test';
import assert from 'node:assert/strict';

import { pingSupabase, resolveSupabaseCredentials } from '../../api/keepalive.js';

function createFetch({ status = 200, body = 0, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body
    };
  };
}

test('llama a la RPC del latido con la clave anónima', async () => {
  const calls = [];
  const result = await pingSupabase({
    url: 'https://demo.supabase.co',
    key: 'anon-123',
    fetchImpl: createFetch({ body: 4, calls })
  });

  assert.deepEqual(result, { rooms: 4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://demo.supabase.co/rest/v1/rpc/keepalive_ping');
  assert.equal(calls[0].options.headers.apikey, 'anon-123');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer anon-123');
});

test('nunca envía una credencial de servicio', async () => {
  const calls = [];
  await pingSupabase({
    url: 'https://demo.supabase.co',
    key: 'anon-123',
    fetchImpl: createFetch({ body: 0, calls })
  });

  const headers = JSON.stringify(calls[0].options.headers);
  assert.equal(headers.includes('service_role'), false);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer anon-123');
});

test('propaga el fallo con el estado HTTP de Supabase', async () => {
  await assert.rejects(
    pingSupabase({
      url: 'https://demo.supabase.co',
      key: 'anon-123',
      fetchImpl: createFetch({ status: 401, body: 'no autorizado' })
    }),
    /Supabase respondió 401/
  );
});

test('resuelve credenciales del servidor y acepta las de Vite como respaldo', () => {
  assert.deepEqual(
    resolveSupabaseCredentials({ SUPABASE_URL: 'https://s.supabase.co/', SUPABASE_ANON_KEY: 'srv' }),
    { url: 'https://s.supabase.co', key: 'srv' }
  );
  assert.deepEqual(
    resolveSupabaseCredentials({ VITE_SUPABASE_URL: 'https://v.supabase.co', VITE_SUPABASE_ANON_KEY: 'vite' }),
    { url: 'https://v.supabase.co', key: 'vite' }
  );
  assert.equal(resolveSupabaseCredentials({ VITE_SUPABASE_URL: 'https://v.supabase.co' }), null);
});
