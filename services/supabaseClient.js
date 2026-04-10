'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  logger.error('Supabase configuration missing in .env');
}

// ─── Client Initialization ───────────────────────────────────────────────────
let supabase, supabaseAdmin;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  logger.error('❌ FATAL: Supabase configuration missing from environment variables!');
  // We don't initialize the clients to prevent crashing the entire process.
  // Instead, we export dummy objects that will log errors if used.
  const dummy = new Proxy({}, {
    get: () => { throw new Error('Supabase client used before initialization. Please check your Netlify environment variables.'); }
  });
  supabase = dummy;
  supabaseAdmin = dummy;
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    logger.info('✅ Supabase clients initialized successfully.');
  } catch (err) {
    logger.error('❌ Failed to initialize Supabase client:', err.message);
    const dummy = new Proxy({}, {
      get: () => { throw new Error('Supabase initialization failed: ' + err.message); }
    });
    supabase = dummy;
    supabaseAdmin = dummy;
  }
}

module.exports = { supabase, supabaseAdmin };
