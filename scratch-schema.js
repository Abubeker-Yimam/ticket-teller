const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    // Let's get a single profile
    const { data: profile } = await supabase.from('profiles').select('*').limit(1).single();
    console.log("Profiles schema preview:", profile);
    
    // Check if activity logs exists
    const { data: logs, error } = await supabase.from('activity_logs').select('*').limit(1);
    console.log("Activity logs error:", error?.message);
})();
