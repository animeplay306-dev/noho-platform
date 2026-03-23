const NOHOLibrary = require('./noho-lib');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = '.noho_session.json';

function loadSession() {
    try {
        return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function saveSession(data) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    const lib = new NOHOLibrary({ dbPath: './noho_data' });
    await new Promise(r => setTimeout(r, 500));
    
    switch(command) {
        case 'register':
            const [username, email, password] = args.slice(1);
            if (!username || !email || !password) {
                console.log('Usage: node noho-cli.js register <username> <email> <password>');
                return;
            }
            const user = await lib.registerUser(email, password, username);
            console.log('✅ User created:', user.username);
            console.log('API Key:', user.apiKey);
            saveSession({
                apiKey: user.apiKey,
                username: user.username,
                userId: user.userId
            });
            break;
            
        case 'login':
            const [loginEmail, loginPass] = args.slice(1);
            if (!loginEmail || !loginPass) {
                console.log('Usage: node noho-cli.js login <email> <password>');
                return;
            }
            const login = await lib.loginUser(loginEmail, loginPass);
            console.log('✅ Logged in as:', login.user.username);
            console.log('Token:', login.token);
            saveSession({
                token: login.token,
                apiKey: login.user.apiKey,
                username: login.user.username,
                userId: login.user.id
            });
            break;
            
        case 'whoami':
            const session = loadSession();
            if (!session) {
                console.log('❌ Not logged in. Use: login or register');
                return;
            }
            console.log('👤 Logged in as:', session.username);
            console.log('API Key:', session.apiKey);
            break;
            
        case 'create-page':
            const sess = loadSession();
            if (!sess) {
                console.log('❌ Login first');
                return;
            }
            const [route, ...codeParts] = args.slice(1);
            const code = codeParts.join(' ');
            if (!route || !code) {
                console.log('Usage: node noho-cli.js create-page <route> <code>');
                console.log('Example: node noho-cli.js create-page /hello \'res.send("<h1>Hi</h1>")\'');
                return;
            }
            const page = await lib.createPage(sess.userId, route, code, { public: true });
            console.log('✅ Page created:', page.route);
            console.log('URL: http://localhost:5000' + page.route);
            break;
            
        case 'list-pages':
            const s = loadSession();
            if (!s) {
                console.log('❌ Login first');
                return;
            }
            const userData = lib.users.get(s.userId);
            console.log('📄 Pages for', s.username + ':');
            userData.pages.forEach(pid => {
                const p = lib.pages.get(pid);
                if (p) {
                    console.log('  -', p.route, '(Views:', p.stats.views + ')');
                }
            });
            break;
            
        default:
            console.log(`
🚀 NOHO CLI

Commands:
  register <username> <email> <password>  - Create account
  login <email> <password>                - Login
  whoami                                  - Show current user
  create-page <route> <code>              - Create new page
  list-pages                              - List your pages

Examples:
  node noho-cli.js register ahmed ahmed@test.com 12345678
  node noho-cli.js login ahmed@test.com 12345678
  node noho-cli.js create-page /welcome 'res.send("<h1>Hello</h1>")'
            `);
    }
}

main().catch(console.error);
