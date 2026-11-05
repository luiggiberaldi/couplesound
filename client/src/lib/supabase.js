import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// Si faltan las variables no reventamos el render: la app muestra una tarjeta de
// configuración en vez de una pantalla en blanco.
export const supabase = createClient(
  url || 'https://configuracion-pendiente.supabase.co',
  anonKey || 'anon-key-pendiente',
  {
    realtime: { params: { eventsPerSecond: 20 } },
    auth: { persistSession: false, autoRefreshToken: false }
  }
);
