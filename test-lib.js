const NOHOLibrary = require('./noho-lib');

async function test() {
    console.log('🧪 Testing NOHO Library...\n');
    
    const lib = new NOHOLibrary({
        aiKey: 'test-key',
        dbPath: './test_data'
    });
    
    // انتظر التهيئة
    await new Promise(r => setTimeout(r, 500));
    
    try {
        // 1. اختبار التسجيل
        console.log('1️⃣ Testing register...');
        const user = await lib.registerUser('ahmed@test.com', '12345678', 'ahmed');
        console.log('✅ User created:', user.username);
        console.log('   API Key:', user.apiKey.substring(0, 20) + '...');
        
        // 2. اختبار تسجيل الدخول
        console.log('\n2️⃣ Testing login...');
        const login = await lib.loginUser('ahmed@test.com', '12345678');
        console.log('✅ Login successful, token:', login.token.substring(0, 20) + '...');
        
        // 3. اختبار إنشاء صفحة
        console.log('\n3️⃣ Testing create page...');
        const page = await lib.createPage(
            user.userId, 
            '/hello', 
            'res.send("<h1>Hello from NOHO!</h1>")',
            { public: true }
        );
        console.log('✅ Page created:', page.route);
        console.log('   ID:', page.id);
        
        // 4. اختبار استرجاع الصفحة
        console.log('\n4️⃣ Testing get page...');
        const found = lib.getPageByRoute('/ahmed/hello');
        console.log('✅ Page found:', found ? 'YES' : 'NO');
        console.log('   Views:', found.stats.views);
        
        // 5. اختبار الإحصائيات
        console.log('\n5️⃣ Testing stats...');
        const stats = lib.getUserStats(user.userId);
        console.log('✅ Stats:', JSON.stringify(stats, null, 2));
        
        console.log('\n🎉 All tests passed!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

test();
