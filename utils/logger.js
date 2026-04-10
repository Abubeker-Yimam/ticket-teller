'use strict';

const winston = require('winston');

// ─── Log Format ───────────────────────────────────────────────────────────────
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
  })
);

// ─── Winston Logger ───────────────────────────────────────────────────────────
// DEPLOYMENT NOTE: File-based logging is disabled for Netlify/Serverless.
// Logs are directed to Console only, where they can be viewed in the Netlify Dashboard.
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        logFormat
      ),
    })
  ],
});

module.exports = logger;
