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
    
      const profile = await this.getProfile();
      if (profile && profile.status === 'inactive') {
        await this.logout();
        throw new Error('Your account is currently inactive. Please contact the administrator.');
      }
      
      if (profile && profile.force_password_change) {
        return { forceChange: true, ...data };
      }
      
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

  async changePassword(newPassword, currentPassword) {
    const client = initSupabase();
    
    // 1. Verify current password by attempting to sign in
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('No active user session');

    const { error: verifyError } = await client.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (verifyError) {
      console.warn('[Auth] Current password verification failed:', verifyError.message);
      throw new Error('Verification failed: Current password is incorrect.');
    }

    // 2. Proceed with update
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
    
    // 3. Clear temporary password if this was a first-time change
    await client.from('profiles').update({ temp_password: null, force_password_change: false }).eq('id', user.id);
  },

  async resetPasswordForEmail(email) {
    const client = initSupabase();
    console.log('[Auth] Requesting password reset for:', email);
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html'
    });
    if (error) throw error;
    
    // Log activity using our new endpoint if the user is already found? 
    // Usually forgot password doesn't log on backend unless hooked there,
    // but the email is sent natively by Supabase.
    return data;
  }
};

window.auth = auth;
