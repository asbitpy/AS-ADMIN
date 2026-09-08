const { createClient } = require('@supabase/supabase-js');

// Usamos la service key porque el backend corre en un servidor de confianza,
// no en el navegador — nunca expongas esta key en un frontend.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = supabase;
