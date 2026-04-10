'use strict';

const { google } = require('googleapis');
const path = require('path');
const logger = require('../utils/logger');

// ─── Fallback JSON Registry ────────────────────────────────────────────────────
const partnerMapJson = require('../config/partnerMap.json');

// ─── In-Memory Cache ───────────────────────────────────────────────────────────
// Avoids hitting Google Sheets API on every webhook. Refreshes every 5 minutes.
let sheetsCache = {
  data: null,
  expiresAt: 0,
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches all partner rows from Google Sheets and returns a keyed map.
 * Columns expected: A=partner_id, B=name, C=email, D=commission_rate, E=active
 *
 * @returns {Promise<Object>} Map of { partner_id: { name, email, commission_rate, active } }
 */
async function fetchFromSheets() {
  const now = Date.now();
  if (sheetsCache.data && now < sheetsCache.expiresAt) {
    logger.debug('Partner registry: serving from cache');
    return sheetsCache.data;
  }

  logger.info('Partner registry: fetching from Google Sheets');

  const auth = new google.auth.GoogleAuth({
    // Prefers GOOGLE_APPLICATION_CREDENTIALS env var pointing to service-account.json
    // OR falls back to service-account.json in the project root
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Partners!A2:E', // Skip header row
  });

  const rows = response.data.values || [];
  const map = {};

  for (const row of rows) {
    const [partnerId, name, email, commissionRateStr, activeStr] = row;
    if (!partnerId || !email) continue;

    map[partnerId.trim().toUpperCase()] = {
      name: name?.trim() || partnerId,
      email: email.trim().toLowerCase(),
      commission_rate: parseFloat(commissionRateStr?.replace('%', '') || '0') / 100,
      active: activeStr?.toString().trim().toUpperCase() === 'TRUE',
    };
  }

  sheetsCache = { data: map, expiresAt: now + CACHE_TTL_MS };
  logger.info(`Partner registry loaded: ${Object.keys(map).length} partners`);
  return map;
}

/**
 * Looks up a partner by their referral tag.
 * Auto-selects Google Sheets or JSON based on REGISTRY_MODE env var.
 *
 * @param {string} referralTag - The raw referral_tag from the Ticket Tailor webhook
 * @returns {Promise<{ name: string, email: string, commission_rate: number, active: boolean } | null>}
 */
async function lookupPartner(referralTag) {
  if (!referralTag) return null;

  // Normalize tag: uppercase, trim whitespace
  const tag = referralTag.trim().toUpperCase();
  const mode = (process.env.REGISTRY_MODE || 'json').toLowerCase();

  try {
    if (mode === 'sheets') {
      const map = await fetchFromSheets();
      return map[tag] || null;
    }

    // JSON fallback
    return partnerMapJson[tag] || partnerMapJson[referralTag] || null;
  } catch (err) {
    logger.error('Partner registry lookup failed, falling back to JSON', {
      referralTag: tag,
      error: err.message,
    });
    // Graceful degradation: fall back to JSON if Sheets is unavailable
    return partnerMapJson[tag] || partnerMapJson[referralTag] || null;
  }
}

/**
 * Invalidates the Google Sheets cache (useful after partner updates).
 */
function invalidateCache() {
  sheetsCache = { data: null, expiresAt: 0 };
  logger.info('Partner registry cache invalidated');
}

module.exports = { lookupPartner, invalidateCache };
