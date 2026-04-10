'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  logger.error('Supabase configuration missing in .env');
}

/**
 * Public Client: Used for dashboard authentication and RLS-protected queries.
 * This client respects Row Level Security.
 */
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Admin Client: Used for background tasks like webhooks and seeding.
 * This client BYPASSES Row Level Security.
 */
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = { supabase, supabaseAdmin };
