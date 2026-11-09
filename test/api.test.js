// test/api.test.js —— 服务端链路自检：注册→登录→上报→统计→冷启动
// 用临时数据目录，不会碰到 data/db.json
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-drill-api-'));
process.env.DATA_DIR = dataDir;

const backendDir = path.join(__dirname, '..', 'backend');

// 每次 require 都是一次"冷启动"：清掉后端模块缓存，强制重新读盘
function loadServer() {
    Object.keys(require.cache).forEach(key => {
        if (key.startsWith(backendDir)) delete require.cache[key];
    });
    return require('../backend/server.js');
}

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };

function makeClient(getBase) {
    let cookie = '';
    return async function call(method, url, body) {
        const headers = { Connection: 'close' };   // 测试里不复用连接（重启后端口会重开）
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (cookie) headers.Cookie = cookie;

        const res = await fetch(getBase() + url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        setCookies.forEach(raw => {
            const m = /^([^=]+)=([^;]*)/.exec(raw);
            if (!m) return;
            if (m[2] === '' || /Max-Age=0/i.test(raw)) cookie = '';
            else cookie = m[1] + '=' + m[2];
        });

        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        return { status: res.status, body: json };
    };
}

function listen(port) {
    const { start } = loadServer();
    const server = start(port);
    return new Promise(resolve => {
        server.once('listening', () => resolve({ server, port: server.address().port }));
    });
}

(async () => {
    let started = await listen(0);
    let server = started.server;
    const base = 'http://127.0.0.1:' + started.port;
    const getBase = () => base;

    const teacher = makeClient(getBase);
    const student = makeClient(getBase);
    const anon = makeClient(getBase);

    // 1. 健康检查
    let r = await anon('GET', '/api/health');
    ok(r.status === 200 && r.body && r.body.data && r.body.data.ok, '健康检查失败: ' + JSON.stringify(r.body));

    // 2. 未登录不能上报
    r = await anon('POST', '/api/attempts', { level: 2, question: 'x', result: 'correct' });
    ok(r.status === 401, '未登录上报应 401，实际 ' + r.status);

    // 3. 还没有老师时，学生注册拿不到邀请码
    r = await anon('POST', '/api/auth/register', { name: '小明', password: '123456', role: 'student', inviteCode: 'XXXXXX' });
    ok(r.status === 400, '没有老师时学生注册应失败，实际 ' + r.status);

    // 4. 老师注册 + 邀请码
    r = await teacher('POST', '/api/auth/register', { name: '张老师', password: 'teacher123', role: 'teacher' });
    ok(r.status === 200 && r.body.data.user.role === 'teacher', '老师注册失败: ' + JSON.stringify(r.body));
    const invite = r.body.data.inviteCode;
    ok(/^[A-Z0-9]{6}$/.test(invite || ''), '邀请码格式不对: ' + invite);

    // 5. /me 里带邀请码
    r = await teacher('GET', '/api/auth/me');
    ok(r.status === 200 && r.body.data.user.inviteCode === invite, '/me 应返回邀请码');

    // 6. 学生注册：错误邀请码 / 正确邀请码（大小写不敏感）
    r = await student('POST', '/api/auth/register', { name: '小明', password: '123456', role: 'student', inviteCode: 'AAAAAA' });
    ok(r.status === 400, '错误邀请码应 400，实际 ' + r.status);
    r = await student('POST', '/api/auth/register', { name: '小明', password: '123456', role: 'student', inviteCode: invite.toLowerCase() });
    ok(r.status === 200 && r.body.data.user.role === 'student', '学生注册失败: ' + JSON.stringify(r.body));

    // 7. 重名 / 短密码
    r = await anon('POST', '/api/auth/register', { name: '小明', password: '123456', role: 'student', inviteCode: invite });
    ok(r.status === 409, '重名应 409，实际 ' + r.status);
    r = await anon('POST', '/api/auth/register', { name: '小红', password: '123', role: 'student', inviteCode: invite });
    ok(r.status === 400, '短密码应 400，实际 ' + r.status);

    // 8. 上报三题：独立做对 / 用提示做对 / 看解析
    const q = '2(x - 3) - 4(x + 1)';
    const a = '-2x - 10';
    const qf = '1/2(x + 4) - 3';
    const af = 'x/2 - 1';
    r = await student('POST', '/api/attempts', { clientId: 'c1', level: 2, question: qf, answer: af, studentAnswer: af, result: 'correct', usedHint: false, revealed: false, tags: ['fraction'], ms: 12000 });
    ok(r.status === 200, '上报失败: ' + JSON.stringify(r.body));
    r = await student('POST', '/api/attempts', { clientId: 'c2', level: 2, question: qf, answer: af, studentAnswer: af, result: 'correct', usedHint: true, revealed: false, tags: ['fraction', 'bogus', 'fraction'], ms: 30000 });
    ok(r.status === 200, '上报失败（用提示）: ' + JSON.stringify(r.body));
    r = await student('POST', '/api/attempts', { clientId: 'c3', level: 3, question: q, answer: a, studentAnswer: '2x - 6', result: 'wrong', usedHint: false, revealed: true, gaveUp: true, ms: 45000 });
    ok(r.status === 200, '上报失败（看解析）: ' + JSON.stringify(r.body));
    // c4：提示后做错；c5：答案对但没去括号；c6：答案对但没合并同类项；c7：旧客户端上报 partial
    r = await student('POST', '/api/attempts', { clientId: 'c4', level: 2, question: q, answer: a, studentAnswer: '-2x + 10', result: 'wrong', usedHint: true, revealed: false, gaveUp: false, ms: 5000 });
    ok(r.status === 200, '上报失败（提示后错）: ' + JSON.stringify(r.body));
    r = await student('POST', '/api/attempts', { clientId: 'c5', level: 3, question: q, answer: a, studentAnswer: '2(x - 3) - 4(x + 1)', result: 'parentheses', usedHint: false, revealed: false, gaveUp: false, ms: 7000 });
    ok(r.status === 200, '上报失败（没去括号）: ' + JSON.stringify(r.body));
    r = await student('POST', '/api/attempts', { clientId: 'c6', level: 1, question: q, answer: a, studentAnswer: '2x - 6 - 4x - 4', result: 'unmerged', usedHint: false, revealed: false, gaveUp: false, ms: 3000 });
    ok(r.status === 200, '上报失败（没合并）: ' + JSON.stringify(r.body));
    r = await student('POST', '/api/attempts', { clientId: 'c7', level: 1, question: q, answer: a, studentAnswer: '2x - 6 - 4x - 4', result: 'partial', usedHint: false, ms: 2000 });
    ok(r.status === 200 && r.body.data.id, '旧客户端的 partial 应被接受（映射为 unmerged）: ' + JSON.stringify(r.body));

    // 9. 同一道题重复上报只记一次
    r = await student('POST', '/api/attempts', { clientId: 'c1', level: 2, question: qf, answer: af, studentAnswer: af, result: 'correct', tags: ['fraction'] });
    ok(r.status === 200 && r.body.data.duplicate === true, '重复上报应去重: ' + JSON.stringify(r.body));
    r = await student('GET', '/api/attempts/mine');
    ok(r.body.data.attempts.length === 7, '学生自己应看到 7 条，实际 ' + r.body.data.attempts.length);

    // 10. 学生不能看老师接口
    r = await student('GET', '/api/teacher/students');
    ok(r.status === 403, '学生访问老师接口应 403，实际 ' + r.status);


    // 11. 老师看统计（提示后做对算对；提示后错、没化简完、格式错、看解析算错）
    r = await teacher('GET', '/api/teacher/students');
    ok(r.status === 200, '老师看板接口失败: ' + JSON.stringify(r.body));
    ok(r.body.data.students.length === 1, '应有 1 个学生，实际 ' + r.body.data.students.length);
    const st = r.body.data.students[0].stats;
    ok(st.total === 7, '总题数应为 7，实际 ' + st.total);
    ok(st.correct === 1, '独立做对 1 题，实际 ' + st.correct);
    ok(st.hintedCorrect === 1, '提示后对应为 1，实际 ' + st.hintedCorrect);
    ok(st.hintedWrong === 1, '提示后错应为 1，实际 ' + st.hintedWrong);
    ok(st.hinted === 2, '用过提示应为 2，实际 ' + st.hinted);
    ok(st.unmerged === 3, '没化简完应为 3（c5 + c6 + 旧 partial c7），实际 ' + st.unmerged);
    ok(st.revealed === 1, '看解析应为 1，实际 ' + st.revealed);
    ok(st.gaveUp === 1, '主动看解析应为 1，实际 ' + st.gaveUp);
    ok(st.wrong === 0, '纯答错应为 0，实际 ' + st.wrong);
    ok(st.scored === 7, '提示和看解析应计入分母，实际 scored=' + st.scored);
    ok(st.correctCount === 2, '算对总数应为 2，实际 ' + st.correctCount);
    ok(st.accuracy === 28.6, '正确率应为 2/7=28.6%，实际 ' + st.accuracy);
    ok(st.avgMs === Math.round((12000 + 30000 + 45000 + 5000 + 7000 + 3000 + 2000) / 7),
        '平均用时不符，实际 ' + st.avgMs);
    ok(st.byLevel.length === 4, '应返回 4 个难度');
    ok(st.fraction && st.fraction.total === 2, '分数题应为 2 条，实际 ' + JSON.stringify(st.fraction));
    ok(st.fraction && st.fraction.correct === 1 && st.fraction.hintedCorrect === 1,
        '分数题应 1 条独立做对 + 1 条提示后对，实际 ' + JSON.stringify(st.fraction));
    ok(st.fraction && st.fraction.scored === 2 && st.fraction.accuracy === 100,
        '分数题正确率口径不符，实际 ' + JSON.stringify(st.fraction));
    ok(st.fraction && st.fraction.avgMs === 21000,
        '分数题平均用时应为 (12000+30000)/2=21000，实际 ' + JSON.stringify(st.fraction));

    // 11b. 筛选用的稀疏计数
    const counts = r.body.data.students[0].counts;
    ok(counts && counts.all && counts.week && counts.today, '应返回 all/week/today 三组计数');
    ok(counts.all.correct[2].fraction === 1, 'all/correct/L2/fraction 应为 1，实际 ' + JSON.stringify(counts.all.correct[2]));
    ok(counts.all.hintedCorrect[2].fraction === 1, 'all/hintedCorrect/L2/fraction 应为 1，实际 ' + JSON.stringify(counts.all.hintedCorrect[2]));
    ok(counts.all.unmerged[1].integer === 2, 'all/unmerged/L1/integer 应为 2（c6 + 旧 partial c7），实际 ' + JSON.stringify(counts.all.unmerged[1]));
    ok(counts.all.unmerged[3].integer === 1, 'all/unmerged/L3/integer 应为 1（c5 没去括号），实际 ' + JSON.stringify(counts.all.unmerged[3]));
    ok(counts.all.revealed[3].integer === 1, 'all/revealed/L3/integer 应为 1，实际 ' + JSON.stringify(counts.all.revealed[3]));
    ok(counts.today.correct[2].fraction === 1, '今天的计数应包含刚上报的记录');
    ok(typeof r.body.data.now === 'number', '应返回服务端当前时间戳，供前端算时间范围');

    // 12. 老师看明细
    const studentId = r.body.data.students[0].user.id;
    r = await teacher('GET', '/api/teacher/attempts?studentId=' + studentId + '&limit=10');
    ok(r.status === 200 && r.body.data.attempts.length === 7, '明细应为 7 条，实际 ' + (r.body.data.attempts || []).length);
    ok(r.body.data.attempts[0].createdAt >= r.body.data.attempts[1].createdAt, '明细应按时间倒序');
    const c2Attempt = r.body.data.attempts.find(x => x.clientId === 'c2');
    ok(c2Attempt && Array.isArray(c2Attempt.tags) && c2Attempt.tags.length === 1 && c2Attempt.tags[0] === 'fraction',
        'tags 应去重并过滤未知标签，实际 ' + JSON.stringify(c2Attempt && c2Attempt.tags));
    const c3Attempt = r.body.data.attempts.find(x => x.clientId === 'c3');
    ok(c3Attempt && Array.isArray(c3Attempt.tags) && c3Attempt.tags.length === 0,
        '未传 tags 的旧客户端应存空数组');
    r = await teacher('GET', '/api/teacher/attempts?studentId=u_not_exist');
    ok(r.status === 404, '不存在的学生应 404，实际 ' + r.status);

    // 13. 老师直接加学生，新学生能登录
    r = await teacher('POST', '/api/teacher/students', { name: '小红', password: 'hong123' });
    ok(r.status === 200 && r.body.data.user.role === 'student', '老师加学生失败: ' + JSON.stringify(r.body));
    const newStudentId = r.body.data.user.id;

    const hong = makeClient(getBase);
    r = await hong('POST', '/api/auth/login', { name: '小红', password: 'hong123' });
    ok(r.status === 200, '新加的学生应能登录: ' + JSON.stringify(r.body));
    r = await teacher('GET', '/api/teacher/students');
    ok(r.body.data.students.length === 2 && r.body.data.students.some(s => s.user.id === newStudentId),
        '老师名下应有 2 个学生');

    // 13b. 老师自己试做的记录单独给一块，不算成学生
    r = await teacher('POST', '/api/attempts', { clientId: 'ct1', level: 2, question: q, answer: a, studentAnswer: a, result: 'correct', usedHint: false, revealed: false, ms: 5000 });
    ok(r.status === 200, '老师自己上报失败: ' + JSON.stringify(r.body));
    r = await teacher('GET', '/api/teacher/students');
    ok(r.body.data.students.length === 2, '老师自己的记录不该混进学生列表，实际 ' + r.body.data.students.length);
    ok(r.body.data.self && r.body.data.self.stats.total === 1, '应返回 self 且只有 1 条');
    ok(r.body.data.self && r.body.data.self.user.role === 'teacher', 'self 应是老师本账号');
    ok(r.body.data.self && r.body.data.self.stats.correct === 1, '老师自练的那题应算独立做对');

    // 14. 登录失败限速
    for (let i = 0; i < 5; i++) {
        await anon('POST', '/api/auth/login', { name: '小红', password: 'wrong' + i });
    }
    r = await anon('POST', '/api/auth/login', { name: '小红', password: 'hong123' });
    ok(r.status === 429, '连续错 5 次后应限速，实际 ' + r.status);

    // 15. 落盘检查：明文密码不能出现
    const raw = fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8');
    ok(!raw.includes('teacher123'), 'db.json 里不应出现明文密码');
    ok(!raw.includes('hong123'), 'db.json 里不应出现明文密码');
    const db = JSON.parse(raw);
    ok(db.users.length === 3, 'db.json 应有 3 个用户，实际 ' + db.users.length);
    ok(db.attempts.length === 8, 'db.json 应有 8 条记录（学生 7 + 老师自练 1），实际 ' + db.attempts.length);
    ok(db.attempts.filter(a => a.clientId === 'c7').every(a => a.result === 'unmerged'),
        '旧客户端的 partial 应落库为 unmerged，实际 ' + JSON.stringify(db.attempts.filter(a => a.clientId === 'c7').map(a => a.result)));
    ok(db.attempts.find(a => a.clientId === 'c3').gaveUp === true, '主动看解析应落库 gaveUp=true');
    ok(db.attempts.find(a => a.clientId === 'c4').gaveUp === false, '提示后错应落库 gaveUp=false');
    ok(db.users.every(u => u.salt && u.hash && u.hash.length === 128), '密码盐和哈希应写入');

    // 16. 冷启动：关服务 → 清模块缓存 → 同端口重启 → 数据还在
    const samePort = started.port;
    await new Promise(res => server.close(res));
    started = await listen(samePort);
    server = started.server;

    r = await teacher('GET', '/api/auth/me');
    ok(r.status === 200 && r.body.data.user.name === '张老师', '重启后会话应仍然有效，实际 ' + r.status);
    r = await teacher('GET', '/api/teacher/students');
    ok(r.body.data.students[0].stats.total === 7, '重启后记录应还在，实际 ' + r.body.data.students[0].stats.total);

    // 17. 退出登录后会话失效
    r = await teacher('POST', '/api/auth/logout');
    ok(r.status === 200, '退出应成功');
    r = await teacher('GET', '/api/auth/me');
    ok(r.status === 401, '退出后 /me 应 401，实际 ' + r.status);

    // 18. 未知接口
    r = await anon('GET', '/api/nope');
    ok(r.status === 404, '未知接口应 404，实际 ' + r.status);

    await new Promise(res => server.close(res));
    fs.rmSync(dataDir, { recursive: true, force: true });

    console.log('=== 服务端链路自检 ===');
    console.log('  断言通过 ' + pass + ' 条');
    if (fails.length) {
        fails.forEach(f => console.log('  ✗ ' + f));
        process.exitCode = 1;
    } else {
        console.log('  全部通过');
    }

    // global fetch（undici）会留下连接对象，主动退出，避免测试进程挂住
    setImmediate(() => process.exit(process.exitCode || 0));
})().catch(err => {
    console.error('测试异常:', err);
    process.exitCode = 1;
});
