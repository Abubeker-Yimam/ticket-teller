'use strict';

const { supabaseAdmin } = require('./supabaseClient');
const logger = require('../utils/logger');

/**
 * ActivityLogger module for recording system events directly into Supabase.
 */
class ActivityLogger {
  /**
   * Logs an activity to the activity_logs table
   * @param {string|null} userId 
   * @param {string} role 
   * @param {string} activityType 
   * @param {string} description 
   * @param {object} metadata - optional JSON blob containing contexts like orderId
   * @param {string|null} ipAddress 
   */
  async logActivity(userId, role, activityType, description, metadata = {}, ipAddress = null) {
    try {
      const { error } = await supabaseAdmin.from('activity_logs').insert([{
        user_id: userId,
        role: role || 'system',
        activity_type: activityType,
        description: description,
        metadata: metadata,
        ip_address: ipAddress
      }]);

      if (error) {
        logger.error(`Failed to record activity log [${activityType}] in database:`, error.message);
      } else {
        logger.info(`Activity logged: [${activityType}] ${description}`);
      }
    } catch (err) {
      logger.error('ActivityLogger exception:', err.message);
    }
  }
}

const activityLogger = new ActivityLogger();
module.exports = activityLogger;
