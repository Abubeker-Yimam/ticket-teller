'use strict';

/**
 * In-memory circular event store.
 *
 * Keeps the last MAX_EVENTS webhook events and commission totals in RAM.
 * Data resets on server restart — for persistence, connect a DB.
 *
 * Exposed to the dashboard API via /api/events, /api/stats, /api/partners-summary.
 */

const MAX_EVENTS = 200; // rolling window
const events = [];

// Running totals (reset on restart)
const totals = {
  totalSales: 0,
  totalCommission: 0,       // in smallest unit (pesewas/pence/cents)
  totalCancellations: 0,
  totalTickets: 0,
  currency: 'CHF',
  lastUpdated: null,
};

// Per-partner aggregates  { [partnerEmail]: { name, email, referralTag, sales, commission, tickets, lastSale } }
const partnerStats = {};

/**
 * Records a new event into the store.
 *
 * @param {'sale'|'cancellation'|'unknown_tag'|'error'} type
 * @param {Object} data
 */
function recordEvent(type, data = {}) {
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Prepend newest first
  events.unshift(entry);

  // Keep circular buffer size
  if (events.length > MAX_EVENTS) events.pop();

  totals.lastUpdated = entry.timestamp;

  // Update aggregates
  if (type === 'sale') {
    totals.totalSales += 1;
    totals.totalTickets += data.ticketQuantity || 0;
    totals.totalCommission += data.rawCommission || 0;
    if (data.currency) totals.currency = data.currency;

    if (data.partnerEmail) {
      const key = data.partnerEmail;
      if (!partnerStats[key]) {
        partnerStats[key] = {
          name: data.partnerName || key,
          email: data.partnerEmail,
          referralTag: data.referralTag || '',
          sales: 0,
          commission: 0,
          tickets: 0,
          lastSale: null,
        };
      }
      partnerStats[key].sales += 1;
      partnerStats[key].tickets += data.ticketQuantity || 0;
      partnerStats[key].commission += data.rawCommission || 0;
      partnerStats[key].lastSale = entry.timestamp;
    }
  }

  if (type === 'cancellation') {
    totals.totalCancellations += 1;
    // Reverse commission
    totals.totalCommission = Math.max(0, totals.totalCommission - (data.rawCommission || 0));
    if (data.partnerEmail && partnerStats[data.partnerEmail]) {
      partnerStats[data.partnerEmail].commission = Math.max(
        0,
        partnerStats[data.partnerEmail].commission - (data.rawCommission || 0)
      );
    }
  }

  return entry;
}

/** Returns events filtered/sliced for API consumption */
function getEvents({ limit = 50, type = null } = {}) {
  let result = type ? events.filter(e => e.type === type) : events;
  return result.slice(0, limit);
}

/** Returns running totals */
function getTotals() {
  return { ...totals };
}

/** Returns per-partner aggregates as sorted array */
function getPartnerStats() {
  return Object.values(partnerStats).sort((a, b) => b.sales - a.sales);
}

module.exports = { recordEvent, getEvents, getTotals, getPartnerStats };
