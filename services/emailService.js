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
        <p>You've earned a new referral commission from **${data.eventName}**.</p>
        <hr>
        <ul>
          <li><strong>Order ID:</strong> ${data.orderId}</li>
          <li><strong>Tickets:</strong> ${data.ticketQuantity}</li>
          <li><strong>Commission:</strong> ${data.commissionFormatted}</li>
        </ul>
        <hr>
        <p>Keep up the great work!</p>
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

module.exports = {
  sendSaleNotification,
  sendCancellationNotification,
  sendAdminAlert,
};
