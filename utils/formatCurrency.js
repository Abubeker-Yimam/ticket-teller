'use strict';

/**
 * Formats a raw integer amount (in the smallest currency unit, e.g. pesewas, pence, cents)
 * into a human-readable string.
 *
 * @param {number} amount   - Raw amount from Ticket Tailor (smallest unit)
 * @param {string} currency - ISO 4217 currency code e.g. "CHF", "USD", "GBP"
 * @returns {string}        - e.g. "CHF 75.00"
 */
function formatAmount(amount, currency = 'CHF') {
  if (typeof amount !== 'number' || isNaN(amount)) return `${currency} 0.00`;
  
  // Normalize currency to string if it's an object from Ticket Tailor
  const currencyCode = typeof currency === 'object' && currency.code 
    ? currency.code.toUpperCase() 
    : String(currency || 'CHF').toUpperCase();

  try {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: currencyCode,
    }).format(amount / 100);
  } catch (err) {
    // Fallback if invalid currency code still passed
    return `${currencyCode} ${(amount / 100).toFixed(2)}`;
  }
}

/**
 * Calculates commission from a raw order total.
 *
 * @param {number} orderTotal      - Raw order total (smallest unit)
 * @param {number} commissionRate  - Rate as a decimal e.g. 0.10 for 10%
 * @param {string} currency
 * @returns {{ raw: number, formatted: string }}
 */
function calculateCommission(orderTotal, commissionRate, currency = 'CHF') {
  if (!orderTotal || !commissionRate) return { raw: 0, formatted: formatAmount(0, currency) };
  const rawCommission = Math.round(orderTotal * commissionRate);
  return {
    raw: rawCommission,
    formatted: formatAmount(rawCommission, currency),
  };
}

/**
 * Formats a UTC ISO timestamp into a readable local string.
 *
 * @param {string} isoString
 * @returns {string}
 */
function formatDateTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    return new Date(isoString).toLocaleString('en-GB', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Africa/Accra',
    });
  } catch {
    return isoString;
  }
}

module.exports = { formatAmount, calculateCommission, formatDateTime };
