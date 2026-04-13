'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabaseAdmin } = require('../services/supabaseClient');
const { requireAuth } = require('./api'); // Reuse auth middleware
const { sendInvitationEmail } = require('../services/emailService');
const logger = require('../utils/logger');

// ─── ADMIN ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/invitations - List all invitations
router.get('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { data, error } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    logger.error('Failed to fetch invitations', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invitations - Create and send an invitation
router.post('/', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  const { name, email, partner_id, commission_rate, discount_code } = req.body;
  if (!name || !email || !partner_id || !commission_rate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

    // 2. Store in database
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .insert({
        name,
        email,
        token,
        partner_id,
        commission_rate,
        discount_code,
        expires_at: expiresAt.toISOString(),
        status: 'pending'
      })
      .select()
      .single();

    if (inviteError) {
      if (inviteError.code === '23505') return res.status(400).json({ error: 'An invitation for this email already exists.' });
      throw inviteError;
    }

    // 3. Send Email
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    await sendInvitationEmail({
      name,
      email,
      token,
      commissionRate: commission_rate,
      partnerId: partner_id,
      discountCode: discount_code,
      expiresAt,
      origin
    });

    res.json({ success: true, invite });
  } catch (err) {
    logger.error('Failed to create invitation', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invitations/:id/resend - Resend an existing invitation
router.post('/:id/resend', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { data: invite, error: fetchError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !invite) return res.status(404).json({ error: 'Invitation not found' });

    // Refresh token and expiry
    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    const { error: updateError } = await supabaseAdmin
      .from('invitations')
      .update({
        token: newToken,
        expires_at: newExpiresAt.toISOString(),
        status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', invite.id);

    if (updateError) throw updateError;

    // Send Email
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    await sendInvitationEmail({
      name: invite.name,
      email: invite.email,
      token: newToken,
      commissionRate: invite.commission_rate,
      partnerId: invite.partner_id,
      discountCode: invite.discount_code,
      expiresAt: newExpiresAt,
      origin
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to resend invitation', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invitations/:id - Revoke an invitation
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to revoke invitation', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});


// ─── PUBLIC ENDPOINTS ────────────────────────────────────────────────────────

// GET /api/invitations/verify/:token - Verify invitation token
router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const { data: invite, error } = await supabaseAdmin
      .from('invitations')
      .select('id, name, email, status, expires_at')
      .eq('token', token)
      .single();

    if (error || !invite) return res.status(404).json({ error: 'Invalid or expired invitation link.' });

    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `This invitation has already been ${invite.status}.` });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation link has expired. Please contact administration for a new one.' });
    }

    res.json(invite);
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/invitations/accept - Finalize onboarding
router.post('/accept', express.json(), async (req, res) => {
  const { token, password, termsAccepted } = req.body;

  if (!token || !password || !termsAccepted) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Validate invitation
    const { data: invite, error: fetchError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !invite) return res.status(404).json({ error: 'Invalid invitation link' });
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation is no longer valid' });
    }

    // 2. Create Supabase User
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password: password,
      email_confirm: true,
      user_metadata: { role: 'partner', partner_id: invite.partner_id }
    });

    if (authError) throw authError;

    // 3. Create Profile
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: authData.user.id,
      email: invite.email,
      name: invite.name,
      role: 'partner',
      partner_id: invite.partner_id,
      commission_rate: invite.commission_rate,
      discount_code: invite.discount_code,
      terms_accepted_at: new Date().toISOString(),
      invitation_id: invite.id
    });

    if (profileError) throw profileError;

    // 4. Update Invitation Status
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', invite.id);

    logger.info('Partner onboarding complete', { email: invite.email, partner_id: invite.partner_id });

    res.json({ success: true, email: invite.email });
  } catch (err) {
    logger.error('Onboarding failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
