'use strict';

/**
 * Supabase Auth Service for the Frontend
 */

let supabaseClient = null;

function initSupabase() {
  if (supabaseClient) return supabaseClient;
  
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.error('Supabase Public Config missing');
    return null;
  }
  
  supabaseClient = supabase.createClient(url, key);
  return supabaseClient;
}

const auth = {
  async login(email, password) {
    const client = initSupabase();
    console.log('[Auth] Attempting login for:', email);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async logout() {
    const client = initSupabase();
    console.log('[Auth] Logging out...');
    await client.auth.signOut();
    window.location.href = '/login.html';
  },

  async getSession() {
    const client = initSupabase();
    const { data: { session } } = await client.auth.getSession();
    return session;
  },

  async getProfile() {
    try {
      const session = await this.getSession();
      if (!session) {
        console.warn('[Auth] No session found during getProfile');
        return null;
      }
      
      const client = initSupabase();
      console.log('[Auth] Fetching profile for ID:', session.user.id);
      
      const { data: profile, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
        
      if (error) {
        console.error('[Auth] Profile fetch error:', error.message);
        return null;
      }
      
      if (!profile) {
        console.error('[Auth] No profile row found in public.profiles table');
        return null;
      }

      console.log('[Auth] Profile loaded successfully:', profile.email, `(${profile.role})`);
      return profile;
    } catch (err) {
      console.error('[Auth] getProfile exception:', err.message);
      return null;
    }
  },

  async changePassword(newPassword) {
    const client = initSupabase();
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
    
    // Once password is changed, clear the temp_password field if it exists
    const session = await this.getSession();
    await client.from('profiles').update({ temp_password: null }).eq('id', session.user.id);
  }
};

window.auth = auth;
