// facebook-auth.js
const { Facebook } = require('@harambee-devs/facebook-private-api');
const fs = require('fs');

async function setupFacebookAuth() {
    const fb = new Facebook({
        email: 'your_facebook_email@example.com',
        password: 'your_facebook_password',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
    });

    try {
        await fb.login();
        const cookies = await fb.getCookies();
        
        // Save cookies to file
        fs.writeFileSync('./facebook_session.json', JSON.stringify(cookies, null, 2));
        console.log('✅ Facebook session saved to facebook_session.json');
        
        const user = await fb.getCurrentUser();
        console.log('✅ Logged in as:', user.name);
    } catch (error) {
        console.error('❌ Facebook authentication failed:', error);
    }
}

setupFacebookAuth();