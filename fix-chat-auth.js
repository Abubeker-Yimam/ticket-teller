const fs = require('fs');
let content = fs.readFileSync('routes/chat.js', 'utf8');

// fix getConversation
content = content.replace(
  "if (data.partner_user_id === user.id) return data;",
  "if (data.partner_id === user.partner_id || data.partner_user_id === user.id) return data;"
);

// fix GET /conversations isolation
content = content.replace(
  "query = query.eq('partner_user_id', userId);",
  "query = query.eq('partner_id', req.user.partner_id);"
);

// Also maybe update partner_user_id if it's a POST /conversations ?
content = content.replace(
  "if (existing) return res.json(existing);",
  `if (existing) {
      if (existing.partner_user_id !== userId) {
        // sync the auth ID if partner was recreated
        await supabaseAdmin.from('conversations').update({ partner_user_id: userId }).eq('id', existing.id);
        existing.partner_user_id = userId;
      }
      return res.json(existing);
    }`
);

fs.writeFileSync('routes/chat.js', content);
console.log("Fixed routes/chat.js");
