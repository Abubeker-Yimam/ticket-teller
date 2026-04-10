'use strict';

/**
 * Builds the HTML email template for an order.placed notification.
 *
 * Design: Clean, branded, mobile-responsive card with a highlighted commission row.
 * Privacy: Contains ONLY this partner's order data. No aggregate revenue, no other partners.
 *
 * @param {Object} d - notification data object from orderPlaced handler
 * @returns {string} - Full HTML string
 */
function buildOrderPlacedTemplate(d) {
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Referral Sale</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f0fdf4;
      padding: 32px 16px;
      color: #1a1a1a;
    }
    .card {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .header {
      background: linear-gradient(135deg, #1b4332, #2d6a4f);
      padding: 32px 28px 24px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header p {
      color: #b7e4c7;
      font-size: 14px;
      margin-top: 6px;
    }
    .badge {
      display: inline-block;
      background: #52b788;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .body {
      padding: 28px;
    }
    .greeting {
      font-size: 16px;
      color: #333;
      margin-bottom: 6px;
    }
    .intro {
      font-size: 14px;
      color: #555;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      border-radius: 8px;
      overflow: hidden;
    }
    .detail-table tr:nth-child(odd) td {
      background-color: #f8fafb;
    }
    .detail-table td {
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid #e8edf0;
      vertical-align: top;
    }
    .detail-table td:first-child {
      font-weight: 600;
      color: #374151;
      width: 45%;
    }
    .detail-table td:last-child {
      color: #1f2937;
    }
    .commission-row td {
      background-color: #d8f3dc !important;
      border-bottom: none;
      border-top: 2px solid #52b788;
    }
    .commission-row td:first-child {
      color: #1b4332;
    }
    .commission-row td:last-child {
      color: #1b4332;
      font-weight: 700;
      font-size: 16px;
    }
    .footer {
      padding: 16px 28px 24px;
      border-top: 1px solid #e8edf0;
    }
    .note {
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
      text-align: center;
    }
    .order-id {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      color: #6b7280;
    }
    @media (max-width: 480px) {
      .body { padding: 20px; }
      .header { padding: 24px 20px 18px; }
      .header h1 { font-size: 19px; }
    }
  </style>
</head>
<body>
  <div class="card">

    <div class="header">
      <div class="badge">🎟️ Referral Sale</div>
      <h1>New ticket sale via your link!</h1>
      <p>${d.occurredAtFormatted}</p>
    </div>

    <div class="body">
      <p class="greeting">Hi <strong>${escapeHtml(d.partnerName)}</strong>,</p>
      <p class="intro">
        Great news — a customer just purchased tickets through your referral link.
        Here are the details of this sale:
      </p>

      <table class="detail-table">
        <tr>
          <td>Event</td>
          <td>${escapeHtml(d.eventName || 'N/A')}</td>
        </tr>
        <tr>
          <td>Order ID</td>
          <td><span class="order-id">${escapeHtml(d.orderId)}</span></td>
        </tr>
        <tr>
          <td>Tickets Sold</td>
          <td>${d.ticketQuantity}</td>
        </tr>
        <tr>
          <td>Order Total</td>
          <td>${escapeHtml(d.orderTotalFormatted)}</td>
        </tr>
        <tr class="commission-row">
          <td>💰 Your Commission</td>
          <td>${escapeHtml(d.commissionFormatted)}</td>
        </tr>
      </table>
    </div>

    <div class="footer">
      <p class="note">
        This notification is sent exclusively to you and contains only data from your referral sales.
        Commission payouts follow the schedule in your partner agreement.
        Questions? Reply to this email.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/** Basic HTML entity escaping to prevent injection in email templates */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { buildOrderPlacedTemplate };
