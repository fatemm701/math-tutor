// test/teacher.smoke.js —— 老师看板冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：老师加载学生列表 / 汇总卡片 / 明细视图 / 返回列表 / 添加学生 / 学生误入被拦 / KaTeX 失效兜底
// 用法：node test/teacher.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/teacher.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)][0][1];

// ---------- 最小 DOM 桩 ----------
class El {
    constructor(tag, id) {
        this.tagName = tag;
        this.id = id || '';
        this.children = [];
        this.dataset = {};
        this.hidden = false;
        this.textContent = '';
        this.style = {};
        this.title = '';
        this.disabled = false;
        this.value = '';
        this._html = '';
        this._classes = new Set();
        this.handlers = {};
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = v; this.children = []; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
}

const IDS = [
    'who', 'summary', 'denied', 'list-view', 'students-body', 'list-empty', 'updated',
    'self-view', 'self-stats', 'self-detail',
    'add-name', 'add-pass', 'add-btn', 'add-msg', 'add-form',
    'detail-view', 'detail-title', 'detail-body', 'detail-empty', 'detail-msg',
    'back', 'refresh', 'logout'
];

function makeDom() {
    const byId = {};
    IDS.forEach(id => { byId[id] = new El(id === 'add-form' ? 'form' : 'div', id); });
    return {
        byId,
        document: {
            getElementById: (id) => byId[id] || null,
            createElement: (tag) => new El(tag || 'div'),
            querySelector: () => null,
            querySelectorAll: () => []
        }
    };
}

// ---------- 假数据 ----------
const now = Date.now();
const zeroLevels = [1, 2, 3, 4].map(level => ({ level, total: 0, correct: 0, avgMs: 0, accuracy: null }));

const studentA = {
    user: { id: 'u_a', name: '小明', role: 'student', createdAt: now - 86400000 },
    stats: {
        total: 10, correct: 6, wrong: 3, hinted: 1, revealed: 0, scored: 9,
        accuracy: 66.7, avgMs: 15000, lastAt: now,
        byLevel: [
            { level: 1, total: 4, correct: 3, avgMs: 9000, accuracy: 75 },
            { level: 2, total: 6, correct: 3, avgMs: 19000, accuracy: 50 },
            { level: 3, total: 0, correct: 0, avgMs: 0, accuracy: null },
            { level: 4, total: 0, correct: 0, avgMs: 0, accuracy: null }
        ]
    }
};

const studentB = {
    user: { id: 'u_b', name: '小红', role: 'student', createdAt: now - 1000 },
    stats: {
        total: 0, correct: 0, wrong: 0, hinted: 0, revealed: 0, scored: 0,
        accuracy: null, avgMs: 0, lastAt: null, byLevel: zeroLevels
    }
};

const attemptsPayload = [
    {
        id: 'a1', level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10', studentAnswer: '-2x-10',
        result: 'correct', usedHint: false, revealed: false, ms: 8000, createdAt: now - 1000
    },
    {
        id: 'a2', level: 3, question: '-3(4x^2 + 4) + x', answer: 'x-12x^2-12', studentAnswer: '3x',
        result: 'wrong', usedHint: true, revealed: false, ms: 20000, createdAt: now - 2000
    },
    {
        id: 'a3', level: 4, question: 'a(b + 2) - 3(a^2 - ab)', answer: '4ab+2a-3a^2', studentAnswer: '',
        result: 'wrong', usedHint: false, revealed: true, ms: 60000, createdAt: now - 3000
    }
];

// 老师自己用这个账号试做的记录（后端 /api/teacher/students 的 self 字段）
const selfPayload = {
    user: { id: 'u_t', name: '王老师', role: 'teacher' },
    stats: {
        total: 8, correct: 5, wrong: 2, hinted: 1, revealed: 0, scored: 7,
        accuracy: 71.4, avgMs: 12000, lastAt: now, byLevel: zeroLevels
    }
};

function makeFetch(role, apiCalls) {
    const json = (body, status) => ({
        ok: !status || status < 400,
        status: status || 200,
        json: async () => body
    });
    return async (url, opts) => {
        apiCalls.push({ url, opts: opts || {} });
        if (url === '/api/auth/me') {
            const user = role === 'teacher'
                ? { id: 'u_t', name: '王老师', role: 'teacher', inviteCode: 'TZDGJG' }
                : { id: 'u_s', name: '学生甲', role: 'student' };
            return json({ success: true, data: { user } });
        }
        if (url === '/api/teacher/students') {
            if (opts && opts.method === 'POST') {
                return json({ success: true, data: { user: { id: 'u_new', name: '张三', role: 'student' } } });
            }
            // 故意把小红排在前面，页面应按「最近做过」重排
            return json({ success: true, data: { students: [studentB, studentA], self: selfPayload } });
        }
        if (url.indexOf('/api/attempts/mine') === 0) {
            return json({ success: true, data: { attempts: attemptsPayload } });
        }
        if (url.indexOf('/api/teacher/attempts') === 0) {
            return json({ success: true, data: { student: studentA.user, attempts: attemptsPayload } });
        }
        if (url === '/api/auth/logout') return json({ success: true, data: {} });
        return json({ success: false, msg: '未知接口 ' + url }, 404);
    };
}

// ---------- 启动页面 ----------
const settle = () => new Promise(r => setImmediate(r));

async function boot(role, options) {
    const opts = options || {};
    const dom = makeDom();
    const apiCalls = [];
    const location = { replaced: null, replace(to) { this.replaced = to; } };
    const katexStub = {
        render: (text, el) => {
            if (opts.katexBroken) throw new Error('simulated katex failure');
            el._tex = text;
            el.textContent = text;
        }
    };
    const page = new Function('document', 'location', 'fetch', 'katex', inline + '\n');
    page(dom.document, location, makeFetch(role, apiCalls), katexStub);
    await settle();
    await settle();
    return { dom, apiCalls, location };
}

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const cells = (el) => (el && el.children) || [];
const text = (el) => (el ? String(el.textContent) : null);

(async () => {
    // ---------- 1. 老师身份 ----------
    const t = await boot('teacher');
    const who = text(t.dom.byId['who']);
    check(/老师/.test(who) && /TZDGJG/.test(who), '顶部应显示老师姓名和邀请码，实际: ' + who);

    const cards = cells(t.dom.byId['summary']);
    check(cards.length === 7, '汇总卡片应有 7 张，实际 ' + cards.length);
    const pairs = cards.map(c => text(cells(c)[0]) + '=' + text(cells(c)[1]));
    check(pairs[0] === '学生=2 人', '学生数不对: ' + pairs[0]);
    check(pairs[1] === '总记录=10 条', '总记录不对: ' + pairs[1]);
    check(pairs[2] === '正确率（不含提示/看解析）=66.7%', '正确率不对: ' + pairs[2]);
    check(pairs[3] === '独立做对=6 题', '独立做对不对: ' + pairs[3]);
    check(pairs[4] === '平均用时=15 秒', '平均用时不对: ' + pairs[4]);
    check(pairs[5] === '用过提示=1 题', '提示数不对: ' + pairs[5]);
    check(pairs[6] === '看解析=0 题', '看解析数不对: ' + pairs[6]);

    // ---------- 2. 学生列表 ----------
    const rows = cells(t.dom.byId['students-body']);
    check(rows.length === 2, '应渲染 2 个学生，实际 ' + rows.length);
    check(text(cells(rows[0])[0]) === '小明', '最近做过的学生应排第一，实际 ' + text(cells(rows[0])[0]));

    const r1 = cells(rows[0]);
    check(text(r1[1]) === '10', '记录数不对: ' + text(r1[1]));
    check(text(r1[2]) === '66.7%', '正确率不对: ' + text(r1[2]));
    check(text(r1[3]) === '3', '错题数不对: ' + text(r1[3]));
    check(text(r1[4]) === '1', '提示数不对: ' + text(r1[4]));
    check(text(r1[5]) === '0', '看解析数不对: ' + text(r1[5]));
    check(text(r1[6]) === '15 秒', '平均用时不对: ' + text(r1[6]));
    check(/^今天 \d\d:\d\d$/.test(text(r1[7])), '最近时间格式不对: ' + text(r1[7]));
    check(text(r1[8]) === '3/4', '① 入门列不对: ' + text(r1[8]));
    check(text(r1[9]) === '3/6', '② 基础列不对: ' + text(r1[9]));
    check(text(r1[10]) === '—' && text(r1[11]) === '—', '没做过的难度应显示 —');
    check(/正确率 75%/.test(r1[8].title), '分难度悬停提示不对: ' + r1[8].title);
    check(text(cells(r1[12])[0]) === '明细', '应有明细按钮');

    const r2 = cells(rows[1]);
    check(text(r2[0]) === '小红', '第二个学生名不对: ' + text(r2[0]));
    check(text(r2[1]) === '0' && text(r2[2]) === '—', '没做过的学生应显示 0 / —');

    // ---------- 3. 点明细 ----------
    (cells(r1[12])[0].handlers.click || []).forEach(fn => fn({ stopPropagation() {} }));
    await settle();
    check(t.dom.byId['list-view'].hidden === true, '进入明细后应隐藏列表');
    check(t.dom.byId['detail-view'].hidden === false, '进入明细后应显示明细');
    check(/小明/.test(text(t.dom.byId['detail-title'])), '明细标题应包含学生姓名');

    const attemptCalls = t.apiCalls.filter(c => c.url.indexOf('/api/teacher/attempts') === 0);
    check(attemptCalls.length === 1, '应请求一次明细接口，实际 ' + attemptCalls.length);
    check(attemptCalls.length && attemptCalls[0].url.indexOf('studentId=u_a') > 0,
        '明细请求应带上 studentId: ' + (attemptCalls[0] || {}).url);

    const drows = cells(t.dom.byId['detail-body']);
    check(drows.length === 3, '应渲染 3 条记录，实际 ' + drows.length);
    const d0 = cells(drows[0]);
    const d1 = cells(drows[1]);
    const d2 = cells(drows[2]);
    check(text(d0[1]) === '② 基础', '难度标签不对: ' + text(d0[1]));
    check(d0[2]._tex === '2(x - 3) - 4(x + 1)', '题目应渲染出来: ' + d0[2]._tex);
    check(d0[4]._tex === '-2x-10', '标准答案应渲染出来: ' + d0[4]._tex);
    check(text(cells(d0[5])[0]) === '独立对', '答对应显示「独立对」，实际 ' + text(cells(d0[5])[0]));
    check(text(cells(d1[5])[0]) === '提示后错', '用提示后答错应显示「提示后错」，实际 ' + text(cells(d1[5])[0]));
    check(text(cells(d2[5])[0]) === '看解析', '看解析应显示「看解析」，实际 ' + text(cells(d2[5])[0]));
    check(d2[3]._tex === '（空）', '空答案应显示（空），实际 ' + d2[3]._tex);
    check(text(d2[6]) === '1 分', '60 秒应显示 1 分，实际 ' + text(d2[6]));
    check(t.dom.byId['detail-empty'].hidden === true, '有记录时不该显示空状态');

    // ---------- 4. 返回列表 ----------
    (t.dom.byId['back'].handlers.click || []).forEach(fn => fn({}));
    check(t.dom.byId['list-view'].hidden === false, '返回后应显示列表');
    check(t.dom.byId['detail-view'].hidden === true, '返回后应隐藏明细');

    // ---------- 5. 添加学生 ----------
    const getBefore = t.apiCalls.filter(c => c.url === '/api/teacher/students' && !c.opts.method).length;
    t.dom.byId['add-name'].value = '张三';
    t.dom.byId['add-pass'].value = '123456';
    (t.dom.byId['add-form'].handlers.submit || []).forEach(fn => fn({ preventDefault() {} }));
    await settle();
    await settle();

    const posts = t.apiCalls.filter(c => c.url === '/api/teacher/students' && c.opts.method === 'POST');
    check(posts.length === 1, '应提交一次添加学生，实际 ' + posts.length);
    let sent = null;
    try { sent = JSON.parse(posts[0].opts.body); } catch (e) { sent = null; }
    check(sent && sent.name === '张三' && sent.password === '123456', '提交内容不对: ' + (posts[0] || {}).opts.body);
    check(/ok/.test(t.dom.byId['add-msg'].className), '添加成功应显示绿色提示');
    check(/已添加/.test(text(t.dom.byId['add-msg'])), '成功提示文案不对: ' + text(t.dom.byId['add-msg']));
    check(t.apiCalls.filter(c => c.url === '/api/teacher/students' && !c.opts.method).length === getBefore + 1,
        '添加成功后应重新拉一次列表');
    check(t.dom.byId['add-name'].value === '' && t.dom.byId['add-pass'].value === '',
        '添加成功后应清空输入框');

    // ---------- 6. 密码太短本地拦下 ----------
    t.dom.byId['add-name'].value = '李四';
    t.dom.byId['add-pass'].value = '123';
    (t.dom.byId['add-form'].handlers.submit || []).forEach(fn => fn({ preventDefault() {} }));
    await settle();
    check(/至少 6 位/.test(text(t.dom.byId['add-msg'])), '密码太短应本地拦下，实际: ' + text(t.dom.byId['add-msg']));
    check(t.apiCalls.filter(c => c.opts.method === 'POST').length === 1, '密码太短不应发出请求');

    // ---------- 7. 学生身份打不开 ----------
    const s = await boot('student');
    check(s.dom.byId['denied'].hidden === false, '学生进来应显示无权提示');
    check(s.dom.byId['list-view'].hidden === true, '学生进来不该显示学生列表');
    check(/学生/.test(text(s.dom.byId['who'])), '顶部应提示当前是学生');
    check(s.apiCalls.every(c => c.url === '/api/auth/me'), '学生身份不该请求老师接口');

    // ---------- 8. KaTeX 挂了也要能看 ----------
    const k = await boot('teacher', { katexBroken: true });
    const kRow = cells(k.dom.byId['students-body'])[0];
    (cells(cells(kRow)[12])[0].handlers.click || []).forEach(fn => fn({ stopPropagation() {} }));
    await settle();
    const kFirst = cells(cells(k.dom.byId['detail-body'])[0]);
    check(text(kFirst[2]) === '2(x - 3) - 4(x + 1)', 'KaTeX 失效时应退化成纯文本，实际: ' + text(kFirst[2]));

    // ---------- 9. 我自己（老师本账号的记录）----------
    check(t.dom.byId['self-view'].hidden === false, '老师自己有记录时应显示「我自己」面板');
    const selfStats = text(t.dom.byId['self-stats']);
    check(/练了 8 题/.test(selfStats), '自练题数不对: ' + selfStats);
    check(/正确率 71.4%/.test(selfStats), '自练正确率不对: ' + selfStats);
    check(/平均用时 12 秒/.test(selfStats), '自练平均用时不对: ' + selfStats);

    (t.dom.byId['self-detail'].handlers.click || []).forEach(fn => fn({}));
    await settle();
    check(t.dom.byId['self-view'].hidden === true, '看自练明细时应隐藏「我自己」面板');
    check(t.dom.byId['detail-view'].hidden === false, '点「看明细」应打开明细');
    check(t.apiCalls.some(c => c.url.indexOf('/api/attempts/mine') === 0),
        '自练明细应走 /api/attempts/mine');
    check(!t.apiCalls.some(c => c.url.indexOf('/api/teacher/attempts') === 0 && c.url.indexOf('u_t') > 0),
        '自练明细不该用老师查学生的接口');

    (t.dom.byId['back'].handlers.click || []).forEach(fn => fn({}));
    check(t.dom.byId['self-view'].hidden === false, '返回列表后「我自己」应重新出现');

    // ---------- 汇总 ----------
    console.log('=== 老师看板冒烟 ===');
    if (fails.length === 0) console.log('  全部通过');
    else {
        fails.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
})().catch(err => {
    console.log('看板脚本执行失败:', err && err.message ? err.message : err);
    process.exit(1);
});
