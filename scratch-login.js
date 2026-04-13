const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data: profiles, error } = await supabase.from('profiles').select('*').eq('role', 'partner').limit(1);
    console.log("Partner:", profiles);
})();
