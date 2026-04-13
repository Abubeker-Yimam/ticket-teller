const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data: profiles, error } = await supabase.from('profiles').select('*').ilike('name', '%hawa%');
    console.log("Profiles:", profiles);
    if(profiles && profiles.length > 0) {
       const partnerId = profiles[0].partner_id;
       const { data: convs } = await supabase.from('conversations').select('*').eq('partner_id', partnerId);
       console.log("Convs:", convs);
    }
})();
