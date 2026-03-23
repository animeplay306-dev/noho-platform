const NOHOLibrary = require('./noho-lib');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (q) => new Promise(resolve => rl.question(q, resolve));

async function loginCLI() {
    console.log('🔐 NOHO Login\n');
    
    const lib = new NOHOLibrary({
        dbPath: './noho_data'
    });
    
    await new Promise(r => setTimeout(r, 500));
    
    const email = await question('Email: ');
    const password = await question('Password: ');
    
    try {
        const result = await lib.loginUser(email, password);
        console.log('\n✅ Login successful!');
        console.log('Token:', result.token);
        console.log('Username:', result.user.username);
        console.log('API Key:', result.user.apiKey);
        
        // حفظ في ملف للاستخدام لاحقاً
        const fs = require('fs');
        const session = {
            token: result.token,
            apiKey: result.user.apiKey,
            username: result.user.username,
            userId: result.user.id,
            loginTime: new Date().toISOString()
        };
        fs.writeFileSync('.noho_session.json', JSON.stringify(session, null, 2));
        console.log('\n💾 Session saved to .noho_session.json');
        
    } catch (error) {
        console.log('\n❌ Error:', error.message);
    }
    
    rl.close();
}

loginCLI();
