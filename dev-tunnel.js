#!/usr/bin/env node
'use strict';
/**
 * dev-tunnel.js
 * -------------
 * Starts the local Express server AND a localtunnel in one command.
 * Prints the public webhook URL to paste into Ticket Tailor.
 *
 * Usage: node dev-tunnel.js
 *
 * What it does:
 *  1. Starts server.js on PORT (default 3000)
 *  2. Opens a localtunnel pointing to that port
 *  3. Prints the full webhook URL for Ticket Tailor
 *  4. Keeps running until Ctrl+C (cleans up tunnel automatically)
 */

require('dotenv').config();

const { spawn } = require('child_process');
const localtunnel = require('localtunnel');

const PORT = parseInt(process.env.PORT) || 3000;
const SUBDOMAIN = process.env.LT_SUBDOMAIN || null; // optional: set LT_SUBDOMAIN=my-teller in .env for a stable URL

// ── 1. Start the Express server ───────────────────────────────────────────────
console.log(`\n🚀 Starting local server on port ${PORT}...`);

const serverProcess = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env }
});

serverProcess.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

// ── 2. Open the tunnel after a short delay (let Express bind first) ───────────
setTimeout(async () => {
  try {
    const tunnelOpts = { port: PORT };
    if (SUBDOMAIN) tunnelOpts.subdomain = SUBDOMAIN;

    console.log('🔗 Opening localtunnel...');
    const tunnel = await localtunnel(tunnelOpts);

    const webhookUrl = `${tunnel.url}/webhook`;

    console.log('\n' + '═'.repeat(62));
    console.log('✅ TUNNEL OPEN — paste this into Ticket Tailor:');
    console.log('');
    console.log(`   Webhook URL: ${webhookUrl}`);
    console.log('');
    console.log('How to set it:');
    console.log('  Ticket Tailor → Settings → Webhooks → Edit → URL');
    console.log('  Events to subscribe: order.created, order.placed, order.updated, order.cancelled');
    console.log('═'.repeat(62) + '\n');

    tunnel.on('close', () => {
      console.log('\n⚠️  Tunnel closed. Restarting...');
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err.message);
    });

    // ── 3. Cleanup on Ctrl+C ───────────────────────────────────────────────
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      tunnel.close();
      serverProcess.kill();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      tunnel.close();
      serverProcess.kill();
      process.exit(0);
    });

  } catch (err) {
    console.error('Failed to open tunnel:', err.message);
    console.log('\nFallback: run manually with:');
    console.log(`  npx localtunnel --port ${PORT}`);
    console.log('Then update the webhook URL in Ticket Tailor.\n');
  }
}, 2500);
