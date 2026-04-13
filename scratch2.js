require('dotenv').config();
const jwt = require('jsonwebtoken');

// Construct a fake JWT to test the API route directly
const token = jwt.sign({ sub: 'd4847e09-3220-43f1-b8f4-6ddc4f4bd9cb', role: 'admin', app_metadata: { role: 'admin'}, user_metadata: { role: 'admin'} }, 'supa-secret-just-for-testing', { expiresIn: '1h' });

// We cannot easily fake Express middleware req.user. 
// We'd better just test it with a real request.
