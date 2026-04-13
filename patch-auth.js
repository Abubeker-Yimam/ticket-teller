const fs = require('fs');

let authJs = fs.readFileSync('public/js/auth.js', 'utf8');

const loginPatch = `
      const profile = await this.getProfile();
      if (profile && profile.status === 'inactive') {
        await this.logout();
        throw new Error('Your account is currently inactive. Please contact the administrator.');
      }
      return data;
`;

authJs = authJs.replace(
  "return data;",
  loginPatch
);

fs.writeFileSync('public/js/auth.js', authJs);
console.log("Patched auth.js!");
