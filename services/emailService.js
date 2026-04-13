'use strict';

const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME = process.env.FROM_NAME || 'Referral System';

/**
 * Sends a referral notification email to a partner (Sale)
 */
async function sendSaleNotification(data) {
  try {
    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.partnerEmail],
      subject: `New Referral Reward! 🎉`,
      html: `
        <h1>Congratulations, ${data.partnerName}!</h1>
        <p>You've earned a new referral commission from <strong>${data.eventName}</strong>.</p>
        <hr>
        <ul style="list-style:none; padding:0;">
          <li><strong>Event:</strong> ${data.eventName}</li>
          <li><strong>Partner:</strong> ${data.partnerName}</li>
          <li><strong>Referral ID:</strong> ${data.referralTag}</li>
          <li><strong>Tickets Sold:</strong> ${data.ticketQuantity}</li>
          <li><strong>Order Ref:</strong> ${data.orderId}</li>
          <li><strong>Commission:</strong> ${data.commissionFormatted}</li>
          <li><strong>Date/Time:</strong> ${data.occurredAtFormatted}</li>
        </ul>
        <br>
        <p><a href="${process.env.APP_URL || 'https://referrals.sunbolon.com'}" style="background: #059669; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Go to Dashboard</a></p>
        <hr>
        <p style="font-size: 12px; color: #6b7280;">This is an automated notification. Please do not reply to this email.</p>
      `,
    });

    if (error) throw error;
    console.log(`[Email] Sale notification sent to ${data.partnerEmail}`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send sale notification:`, err.message);
    throw err;
  }
}

/**
 * Sends a cancellation notification email to a partner
 */
async function sendCancellationNotification(data) {
  try {
    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.partnerEmail],
      subject: `Order Cancelled — ${data.eventName}`,
      html: `
        <h1>Order Cancelled</h1>
        <p>Hi ${data.partnerName}, unfortunately an order referred by you was cancelled.</p>
        <hr>
        <ul>
          <li><strong>Order ID:</strong> ${data.orderId}</li>
          <li><strong>Impact:</strong> ${data.commissionFormatted} will be deducted from your total.</li>
        </ul>
        <hr>
      `,
    });

    if (error) throw error;
    console.log(`[Email] Cancellation notification sent to ${data.partnerEmail}`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send cancellation notification:`, err.message);
    throw err;
  }
}

/**
 * Sends a simple alert to the admin
 */
async function sendAdminAlert(subject, message) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;

    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [adminEmail],
      subject: `[Referral System Alert] ${subject}`,
      text: message,
    });

    if (error) throw error;
    console.log(`[Email] Admin alert sent: ${subject}`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send admin alert:`, err.message);
  }
}

/**
 * Sends a secure invitation email to a new partner
 */
async function sendInvitationEmail(data) {
  try {
    const onboardingUrl = `${data.origin || ''}/onboarding.html?token=${data.token}`;
    
    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.email],
      subject: `Invite: Join the SunBolon SA Partner Network`,
      html: `
        <div style="font-family: 'Inter', sans-serif; color: #1f2937; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background: #064e3b; padding: 40px 20px; text-align: center;">
            <img src="${data.origin}/logo.png" alt="SunBolon SA" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #059669;">
            <h1 style="color: #ffffff; margin-top: 20px; font-size: 24px;">Partner Invitation</h1>
          </div>
          <div style="padding: 40px 30px;">
            <p style="font-size: 16px; line-height: 1.6;">Hello <strong>${data.name}</strong>,</p>
            <p style="font-size: 16px; line-height: 1.6;">You have been invited to join the <strong>SunBolon SA Referral Partner Network</strong>. As a partner, you'll be able to promote our events, track your referrals in real-time, and earn commissions.</p>
            
            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 30px 0;">
              <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Your Partner Structure</h3>
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin-bottom: 10px; font-size: 15px;"><strong>Commission Rate:</strong> ${data.commissionRate}</li>
                <li style="margin-bottom: 10px; font-size: 15px;"><strong>Partner ID (Referral Tag):</strong> <code>${data.partnerId}</code></li>
                ${data.discountCode ? `<li style="margin-bottom: 10px; font-size: 15px;"><strong>Assigned Discount Code:</strong> <code>${data.discountCode}</code></li>` : ''}
              </ul>
            </div>

            <p style="font-size: 16px; line-height: 1.6; text-align: center; margin: 40px 0;">
              <a href="${onboardingUrl}" style="background: #059669; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block;">Activate Your Account</a>
            </p>

            <p style="font-size: 14px; color: #6b7280; text-align: center;">
              This invitation link will expire on <strong>${new Date(data.expiresAt).toLocaleDateString()}</strong>.
            </p>
          </div>
          <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af;">
            &copy; ${new Date().getFullYear()} SunBolon SA &middot; Referral Hub
          </div>
        </div>
      `,
    });

    if (error) throw error;
    console.log(`[Email] Invitation sent to ${data.email}`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send invitation:`, err.message);
    throw err;
  }
}

/**
 * Sends a notification when account status changes (activated/deactivated)
 */
async function sendAccountStatusAlert(data) {
  try {
    const statusFormatted = data.status.charAt(0).toUpperCase() + data.status.slice(1);
    const htmlContent = data.status === 'active'
      ? `<p>Hello ${data.name},</p><p>We are pleased to inform you that your referral partner account is now <strong>Active</strong>. You can now log into the portal and access all features.</p>`
      : `<p>Hello ${data.name},</p><p>Your referral partner account is currently <strong>Inactive</strong>. You will not be able to log into the portal. Please contact the administrator for any questions.</p>`;

    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.email],
      subject: `Account Status Update: ${statusFormatted}`,
      html: `
        <div style="font-family: 'Inter', sans-serif; color: #1f2937;">
          ${htmlContent}
          <br>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="font-size: 12px; color: #6b7280;">This is an automated notification. Please do not reply to this email.</p>
        </div>
      `,
    });

    if (error) throw error;
    console.log(`[Email] Account status alert sent to ${data.email} (${data.status})`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send account status alert:`, err.message);
  }
}

/**
 * Sends a password reset notification from Admin
 */
async function sendPasswordResetAdminAlert(data) {
  try {
    const { data: res, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.email],
      subject: `Your Password has been Reset by Administrator`,
      html: `
        <div style="font-family: 'Inter', sans-serif; color: #1f2937;">
          <p>Hello ${data.name},</p>
          <p>An administrator has reset your password for the Referral Hub.</p>
          <p>Your temporary password is: <br><strong style="font-size: 18px; padding: 10px; background: #f3f4f6; display: inline-block; margin-top: 5px;">${data.tempPassword}</strong></p>
          <p>You will be required to change this password immediately upon your next login.</p>
          <p><a href="${data.origin || 'https://referrals.sunbolon.com'}/login.html" style="color: #059669; font-weight: 600;">Log In to Referral Hub</a></p>
          <br>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="font-size: 12px; color: #6b7280;">This is an automated notification. Please do not reply to this email.</p>
        </div>
      `,
    });

    if (error) throw error;
    console.log(`[Email] Admin password reset sent to ${data.email}`);
    return res;
  } catch (err) {
    console.error(`[Email] Failed to send admin password reset email:`, err.message);
    throw err;
  }
}

/**
 * Empty wrapper: Supabase currently handles forgot password via trigger, 
 * but if we need a custom notification we can put it here.
 */
async function sendPasswordResetRequestEmail(data) {}

/**
 * Notifies admin when a partner saves/updates their payment method.
 */
async function sendPaymentMethodSavedAlert(data) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [adminEmail],
      subject: `[Payout] Partner Payment Method Updated — ${data.partnerName}`,
      html: `
        <div style="font-family:'Inter',sans-serif;color:#1f2937;max-width:600px;margin:0 auto;">
          <h2 style="color:#059669;">Partner Payment Method Updated</h2>
          <p><strong>${data.partnerName}</strong> (Tag: <code>${data.partnerTag}</code>) has saved their payment information.</p>
          <ul>
            <li><strong>Method:</strong> ${data.methodType.replace('_', ' ')}</li>
            <li><strong>Partner Email:</strong> ${data.partnerEmail || 'N/A'}</li>
          </ul>
          <p>Log in to the admin dashboard to review and process payout when ready.</p>
          <p><a href="${process.env.APP_URL || 'https://referrals.sunbolon.com'}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Open Admin Dashboard</a></p>
        </div>
      `,
    });
    console.log(`[Email] Payment method alert sent to admin for partner ${data.partnerTag}`);
  } catch (err) {
    console.error('[Email] sendPaymentMethodSavedAlert failed:', err.message);
  }
}

/**
 * Notifies partner when their commission has been approved by admin.
 */
async function sendCommissionApprovedNotification(data) {
  try {
    if (!data.partnerEmail) return;
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.partnerEmail],
      subject: `✅ Commission Approved — CHF Available for Payout`,
      html: `
        <div style="font-family:'Inter',sans-serif;color:#1f2937;max-width:600px;margin:0 auto;">
          <h2 style="color:#059669;">Commission Approved!</h2>
          <p>Hello <strong>${data.partnerName}</strong>,</p>
          <p>Your commission has been approved and is now available for payout.</p>
          <ul>
            <li><strong>Available Balance:</strong> ${data.availableAmount}</li>
          </ul>
          <p>Please ensure your payment details are up to date in your partner portal so we can process your payout promptly.</p>
          <p><a href="${process.env.APP_URL || 'https://referrals.sunbolon.com'}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">View My Earnings</a></p>
        </div>
      `,
    });
    console.log(`[Email] Commission approved notification sent to ${data.partnerEmail}`);
  } catch (err) {
    console.error('[Email] sendCommissionApprovedNotification failed:', err.message);
  }
}

/**
 * Notifies partner when their payout is being processed.
 */
async function sendPayoutProcessingNotification(data) {
  try {
    if (!data.partnerEmail) return;
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.partnerEmail],
      subject: `⏳ Your Payout is Being Processed`,
      html: `
        <div style="font-family:'Inter',sans-serif;color:#1f2937;max-width:600px;margin:0 auto;">
          <h2 style="color:#3b82f6;">Payout Processing</h2>
          <p>Hello <strong>${data.partnerName}</strong>,</p>
          <p>Your payout of <strong>${data.amount}</strong> is currently being processed. You will receive a confirmation once the payment has been sent.</p>
          <p>If you have any questions, please contact us via the messaging system on your portal.</p>
          <p><a href="${process.env.APP_URL || 'https://referrals.sunbolon.com'}" style="background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">View My Payouts</a></p>
        </div>
      `,
    });
    console.log(`[Email] Payout processing notification sent to ${data.partnerEmail}`);
  } catch (err) {
    console.error('[Email] sendPayoutProcessingNotification failed:', err.message);
  }
}

/**
 * Notifies partner when their payout has been marked as paid.
 */
async function sendPayoutPaidNotification(data) {
  try {
    if (!data.partnerEmail) return;
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [data.partnerEmail],
      subject: `🎉 Payout Sent — ${data.amount}`,
      html: `
        <div style="font-family:'Inter',sans-serif;color:#1f2937;max-width:600px;margin:0 auto;">
          <h2 style="color:#059669;">Payout Confirmed!</h2>
          <p>Hello <strong>${data.partnerName}</strong>,</p>
          <p>Your payout of <strong>${data.amount}</strong> has been sent.</p>
          <ul>
            ${data.paymentReference ? `<li><strong>Payment Reference:</strong> ${data.paymentReference}</li>` : ''}
            ${data.payoutDate ? `<li><strong>Payment Date:</strong> ${new Date(data.payoutDate).toLocaleDateString()}</li>` : ''}
          </ul>
          <p>Please allow 1–5 business days for the payment to reflect in your account, depending on your payment method.</p>
          <p><a href="${process.env.APP_URL || 'https://referrals.sunbolon.com'}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">View Payout History</a></p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="font-size:12px;color:#6b7280;">This is an automated notification from Referral Hub. Please do not reply to this email.</p>
        </div>
      `,
    });
    console.log(`[Email] Payout paid notification sent to ${data.partnerEmail}`);
  } catch (err) {
    console.error('[Email] sendPayoutPaidNotification failed:', err.message);
  }
}

module.exports = {
  sendSaleNotification,
  sendCancellationNotification,
  sendAdminAlert,
  sendInvitationEmail,
  sendAccountStatusAlert,
  sendPasswordResetAdminAlert,
  sendPasswordResetRequestEmail,
  sendPaymentMethodSavedAlert,
  sendCommissionApprovedNotification,
  sendPayoutProcessingNotification,
  sendPayoutPaidNotification,
};
