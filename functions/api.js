'use strict';

const serverless = require('serverless-http');
const app = require('../server');

// Entry point for Netlify Functions
module.exports.handler = serverless(app);
