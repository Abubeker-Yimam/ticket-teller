const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data, error } = await supabase.rpc('exec_sql', { query: 'SELECT 1;' });
    console.log("exec_sql Error:", error?.message || "Success");
})();
