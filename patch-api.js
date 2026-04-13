const fs = require('fs');

let apiJs = fs.readFileSync('routes/api.js', 'utf8');

// Update requireAuth to pull status and check if inactive
apiJs = apiJs.replace(
  ".select('role, partner_id, email, name, pii_exception_enabled')",
  ".select('role, partner_id, email, name, status, pii_exception_enabled, force_password_change')"
);

const requireAuthBlock = `
  if (profile.status === 'inactive') {
    return res.status(403).json({ error: 'Your account is currently inactive. Please contact the administrator.' });
  }

  req.user = { id: user.id, ...profile };
`;

apiJs = apiJs.replace(
  "req.user = { id: user.id, ...profile };",
  requireAuthBlock
);

// We need an endpoint for Admin to toggle status
const statusRoute = `
// ─── PUT /api/partners/:id/status ────────────────────────────────────────────
// Admin-only — toggle activate/deactivate partner profile.
router.put('/partners/:id/status', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ status })
      .eq('partner_id', req.params.id);

    if (error) throw error;

    logger.info('Partner status toggled', {
      adminId:   req.user.id,
      partnerId: req.params.id,
      status
    });
    
    // We will hook email and activity log here later when those modules are ready
    if (global.activityLogger) {
      global.activityLogger.logActivity(
        req.user.id, 'admin', 
        status === 'active' ? 'partner_activated' : 'partner_deactivated',
        \`Admin \${req.user.email} changed status of \${req.params.id} to \${status}\`,
        { targetPartnerId: req.params.id }, req.callerIp
      );
    }
    if (global.emailService) {
        // Find partner email
        const { data: profile } = await supabaseAdmin.from('profiles').select('email, name').eq('partner_id', req.params.id).single();
        if (profile) {
            global.emailService.sendAccountStatusAlert({
              email: profile.email,
              name: profile.name,
              status
            });
        }
    }

    res.json({ success: true, partnerId: req.params.id, status });
  } catch (err) {
    logger.error('PUT /partners/status error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
`;

apiJs = apiJs.replace(
  "// ─── DELETE /api/partners/:id ────────────────────────────────────────────────",
  statusRoute + "\n// ─── DELETE /api/partners/:id ────────────────────────────────────────────────"
);

// We also need to return the 'status' in GET /partners
apiJs = apiJs.replace(
  "pii_exception_enabled: p.pii_exception_enabled === true,",
  "pii_exception_enabled: p.pii_exception_enabled === true,\n      status: p.status || 'active',"
);

// We also need to fix `active: true, // simplified`
apiJs = apiJs.replace(
  "active: true, // simplified",
  "active: p.status !== 'inactive',"
);

fs.writeFileSync('routes/api.js', apiJs);
console.log("Patched api.js!");
