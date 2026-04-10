'use strict';

/**
 * Builds the HTML email template for an order.cancelled notification.
 *
 * Design: Amber-toned warning variant to visually distinguish from sale emails.
 * Clearly communicates that the associated commission is reversed.
 *
 * @param {Object} d - notification data object from orderCancelled handler
 * @returns {string} - Full HTML string
 */
function buildOrderCancelledTemplate(d) {
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sale Cancelled</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #fffbeb;
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
      background: linear-gradient(135deg, #92400e, #b45309);
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
      color: #fde68a;
      font-size: 14px;
      margin-top: 6px;
    }
    .badge {
      display: inline-block;
      background: #f59e0b;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .body { padding: 28px; }
    .greeting { font-size: 16px; color: #333; margin-bottom: 6px; }
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
    .detail-table tr:nth-child(odd) td { background-color: #fffbf0; }
    .detail-table td {
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid #fde68a;
      vertical-align: top;
    }
    .detail-table td:first-child {
      font-weight: 600;
      color: #374151;
      width: 45%;
    }
    .detail-table td:last-child { color: #1f2937; }
    .reversal-row td {
      background-color: #fef3c7 !important;
      border-bottom: none;
      border-top: 2px solid #f59e0b;
    }
    .reversal-row td:first-child { color: #92400e; }
    .reversal-row td:last-child {
      color: #92400e;
      font-weight: 700;
      font-size: 16px;
    }
    .footer {
      padding: 16px 28px 24px;
      border-top: 1px solid #fde68a;
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
      <div class="badge">⚠️ Order Cancelled</div>
      <h1>A referral sale has been cancelled</h1>
      <p>${d.occurredAtFormatted}</p>
    </div>

    <div class="body">
      <p class="greeting">Hi <strong>${escapeHtml(d.partnerName)}</strong>,</p>
      <p class="intro">
        We wanted to notify you that an order previously made through your referral link
        has been cancelled. The associated commission has been reversed accordingly.
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
          <td>Tickets</td>
          <td>${d.ticketQuantity}</td>
        </tr>
        <tr>
          <td>Order Total</td>
          <td>${escapeHtml(d.orderTotalFormatted)}</td>
        </tr>
        <tr class="reversal-row">
          <td>↩ Commission Reversed</td>
          <td>${escapeHtml(d.commissionFormatted)}</td>
        </tr>
      </table>
    </div>

    <div class="footer">
      <p class="note">
        If you believe this cancellation was made in error, please reply to this email
        and our team will investigate. Commission adjustments are reflected in your
        next payout cycle as per your partner agreement.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { buildOrderCancelledTemplate };
