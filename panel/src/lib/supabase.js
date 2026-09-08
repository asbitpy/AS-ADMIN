import { createClient } from '@supabase/supabase-js';

// El panel usa la ANON key (nunca la service key del backend). El acceso
// de cada dueño a sus propios datos está garantizado por las políticas de
// RLS de migrations/003_panel_auth_rls.sql, no por lógica del frontend.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
