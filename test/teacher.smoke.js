// test/teacher.smoke.js —— 老师看板冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：老师加载学生列表 / 汇总卡片 / 明细视图 / 返回列表 / 添加学生 / 学生误入被拦 / KaTeX 失效兜底
// 用法：node test/teacher.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/teacher.html'), 'utf8');
// 看板页有两段内联脚本：<head> 里的夜间模式初始化 + 页面底部的主逻辑，这里取最长的那段
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1])
    .sort((a, b) => b.length - a.length)[0];

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
    setAttribute(name, value) { (this.attrs = this.attrs || {})[name] = String(value); }
    getAttribute(name) { return this.attrs ? (this.attrs[name] === undefined ? null : this.attrs[name]) : null; }
    removeAttribute(name) { if (this.attrs) delete this.attrs[name]; }
}

const IDS = [
    'who', 'summary', 'denied', 'list-view', 'students-body', 'list-empty', 'updated',
    'self-view', 'self-stats', 'self-detail',
    'mine-view', 'mine-updated', 'mine-filter', 'mine-filter-summary', 'mine-suggestion', 'mine-detail',
    'add-name', 'add-pass', 'add-btn', 'add-msg', 'add-form',
    'detail-view', 'detail-title', 'detail-body', 'detail-empty', 'detail-msg',
    'list-filter', 'list-filter-summary', 'detail-filter', 'detail-filter-summary',
    'back', 'refresh', 'logout', 'theme-toggle'
];

function makeDom() {
    const byId = {};
    IDS.forEach(id => { byId[id] = new El(id === 'add-form' ? 'form' : 'div', id); });
    // 页面里默认隐藏的视图：挨个标成 hidden，和 HTML 里的 hidden 属性对齐
    ['self-view', 'mine-view', 'detail-view', 'denied'].forEach(id => { byId[id].hidden = true; });
    const documentElement = new El('html');
    return {
        byId,
        documentElement,
        document: {
            documentElement,
            getElementById: (id) => byId[id] || null,
            createElement: (tag) => new El(tag || 'div'),
            querySelector: () => null,
            querySelectorAll: () => []
        }
    };
}

// 极简 localStorage 桩：节点自带的 localStorage 需要 --localstorage-file，太啰嗦
function makeStore() {
    const map = new Map();
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k)
    };
}

// ---------- 假数据 ----------
const now = Date.now();
const zeroLevels = [1, 2, 3, 4].map(level => ({ level, total: 0, correct: 0, avgMs: 0, accuracy: null }));

// 后端 /api/teacher/students 返回的稀疏计数：counts[range][bucket][level] = { fraction, integer }
const EMPTY_COUNTS = () => {
    const range = () => {
        const buckets = {};
        ['correct', 'hintedCorrect', 'hintedWrong', 'wrong', 'unmerged', 'error', 'revealed'].forEach(b => {
            buckets[b] = {};
            [1, 2, 3, 4].forEach(lv => { buckets[b][lv] = { fraction: 0, integer: 0 }; });
        });
        return buckets;
    };
    return { all: range(), week: range(), today: range() };
};

// 小明：10 条记录 → 独立对 6（L1 整数 2、L2 整数 2 + 分数 2）、提示后对 1（L2 分数）、
// 提示后错 1（L3 整数）、没化简完 2（L1 整数 1 条 = 没合并、L2 整数 1 条 = 没去括号）、看解析 0
// 分数题：4 条（L2 3 条：独立对 2 + 提示后对 1；L3 1 条：答错），算对 3
function countsA() {
    const c = EMPTY_COUNTS();
    c.all.correct[1].integer = 2;
    c.all.correct[2].integer = 2;
    c.all.correct[2].fraction = 2;
    c.all.hintedCorrect[2].fraction = 1;
    c.all.hintedWrong[3].integer = 1;
    c.all.unmerged[1].integer = 1;
    c.all.unmerged[2].integer = 1;
    // 时间范围：最近 7 天少掉 2 条独立对，今天只剩 1 条独立对 + 1 条提示后对
    c.week.correct[1].integer = 1;
    c.week.correct[2].integer = 1;
    c.week.correct[2].fraction = 2;
    c.week.hintedCorrect[2].fraction = 1;
    c.week.hintedWrong[3].integer = 1;
    c.week.unmerged[1].integer = 1;
    c.week.unmerged[2].integer = 1;
    c.today.correct[1].integer = 1;
    c.today.hintedCorrect[2].fraction = 1;
    return c;
}

const fractionZero = () => ({
    total: 0, correct: 0, hintedCorrect: 0, hintedWrong: 0, wrong: 0, unmerged: 0, error: 0,
    revealed: 0, gaveUp: 0, hinted: 0, scored: 0, correctCount: 0, accuracy: null, avgMs: 0
});

// 分数题：3 条（L2：独立对 2 + 提示后对 1），按口径算对 3
const studentA = {
    user: { id: 'u_a', name: '小明', role: 'student', createdAt: now - 86400000 },
    stats: {
        total: 10, correct: 6, hintedCorrect: 1, hintedWrong: 1, hinted: 2, wrong: 0,
        unmerged: 2, error: 0, revealed: 0, gaveUp: 0, scored: 10, correctCount: 7,
        accuracy: 70, avgMs: 15000, lastAt: now,
        fraction: Object.assign(fractionZero(), {
            total: 3, correct: 2, hintedCorrect: 1, hinted: 1,
            scored: 3, correctCount: 3, accuracy: 100, avgMs: 12000
        }),
        byLevel: [
            { level: 1, total: 4, correct: 3, avgMs: 9000, accuracy: 75 },
            { level: 2, total: 6, correct: 3, avgMs: 19000, accuracy: 50 },
            { level: 3, total: 0, correct: 0, avgMs: 0, accuracy: null },
            { level: 4, total: 0, correct: 0, avgMs: 0, accuracy: null }
        ]
    },
    counts: countsA()
};

const studentB = {
    user: { id: 'u_b', name: '小红', role: 'student', createdAt: now - 1000 },
    stats: {
        total: 0, correct: 0, hintedCorrect: 0, hintedWrong: 0, hinted: 0, wrong: 0,
        unmerged: 0, error: 0, revealed: 0, gaveUp: 0, scored: 0, correctCount: 0,
        accuracy: null, avgMs: 0, lastAt: null,
        fraction: fractionZero(),
        byLevel: zeroLevels
    },
    counts: EMPTY_COUNTS()
};

const attemptsPayload = [
    {
        id: 'a1', level: 2, question: '1/2(x + 4) - 3', answer: 'x/2-1', studentAnswer: 'x/2-1',
        result: 'correct', usedHint: false, revealed: false, gaveUp: false,
        tags: ['fraction'], ms: 8000, createdAt: now - 1000
    },
    {
        id: 'a2', level: 3, question: '-3(4x^2 + 4) + x', answer: 'x-12x^2-12', studentAnswer: '3x',
        result: 'wrong', usedHint: true, revealed: false, gaveUp: false, ms: 20000, createdAt: now - 2000
    },
    {
        id: 'a3', level: 4, question: 'a(b + 2) - 3(a^2 - ab)', answer: '4ab+2a-3a^2', studentAnswer: '',
        result: 'wrong', usedHint: false, revealed: true, gaveUp: true, tags: ['fraction'], ms: 60000, createdAt: now - 3000
    },
    {
        id: 'a4', level: 1, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10', studentAnswer: '2(x - 3) - 4(x + 1)',
        result: 'parentheses', usedHint: false, revealed: false, gaveUp: false, ms: 4000, createdAt: now - 4000
    }
];

// 老师自己用这个账号试做的记录（后端 /api/teacher/students 的 self 字段）
const selfPayload = {
    user: { id: 'u_t', name: '王老师', role: 'teacher' },
    stats: {
        total: 8, correct: 5, hintedCorrect: 1, hintedWrong: 0, hinted: 1, wrong: 2,
        unmerged: 0, error: 0, revealed: 0, gaveUp: 0, scored: 8, correctCount: 6,
        accuracy: 75, avgMs: 12000, lastAt: now,
        fraction: fractionZero(),
        byLevel: zeroLevels
    },
    counts: EMPTY_COUNTS()
};

// 学生自己点「看板」时后端 /api/attempts/mine/summary 返回的内容
// 8 条：独立对 4（L1 整数 1、L2 整数 2、L2 分数 1）、提示后对 1（L3 分数）、
// 没合并同类项 1（L1 整数）、格式错 1（L2 整数）、看解析 1（L4 整数）
function countsMine() {
    const c = EMPTY_COUNTS();
    c.all.correct[1].integer = 1;
    c.all.correct[2].integer = 2;
    c.all.correct[2].fraction = 1;
    c.all.hintedCorrect[3].fraction = 1;
    c.all.unmerged[1].integer = 1;
    c.all.error[2].integer = 1;
    c.all.revealed[4].integer = 1;
    c.week.correct[1].integer = 1;
    c.week.correct[2].integer = 2;
    c.week.correct[2].fraction = 1;
    c.week.hintedCorrect[3].fraction = 1;
    c.today.correct[2].fraction = 1;
    return c;
}

const minePayload = {
    user: { id: 'u_s', name: '学生甲', role: 'student' },
    stats: {
        total: 8, correct: 4, hintedCorrect: 1, hintedWrong: 0, hinted: 1, wrong: 0,
        unmerged: 1, error: 1, revealed: 1, gaveUp: 1, scored: 8, correctCount: 5,
        accuracy: 62.5, avgMs: 9000, lastAt: now,
        fraction: Object.assign(fractionZero(), {
            total: 2, correct: 1, hintedCorrect: 1, hinted: 1,
            scored: 2, correctCount: 2, accuracy: 100, avgMs: 11000
        }),
        byLevel: [
            { level: 1, total: 2, correct: 1, avgMs: 7000, accuracy: 50 },
            { level: 2, total: 4, correct: 3, avgMs: 8000, accuracy: 75 },
            { level: 3, total: 1, correct: 1, avgMs: 12000, accuracy: 100 },
            { level: 4, total: 1, correct: 0, avgMs: 20000, accuracy: 0 }
        ]
    },
    counts: countsMine(),
    now
};

function makeFetch(role, apiCalls, opts) {
    const json = (body, status) => ({
        ok: !status || status < 400,
        status: status || 200,
        json: async () => body
    });
    return async (url, fetchOpts) => {
        apiCalls.push({ url, opts: fetchOpts || {} });
        if (url === '/api/auth/me') {
            const user = role === 'teacher'
                ? { id: 'u_t', name: '王老师', role: 'teacher', inviteCode: 'TZDGJG' }
                : { id: 'u_s', name: '学生甲', role: 'student' };
            return json({ success: true, data: { user } });
        }
        if (url === '/api/teacher/students') {
            if (fetchOpts && fetchOpts.method === 'POST') {
                return json({ success: true, data: { user: { id: 'u_new', name: '张三', role: 'student' } } });
            }
            // 故意把小红排在前面，页面应按「最近做过」重排
            return json({ success: true, data: { students: [studentB, studentA], self: selfPayload } });
        }
        if (url === '/api/attempts/mine/summary') {
            // 老师也走这个接口看自己（主页面的「我自己」用的是 selfPayload），这里统一给老师的记录
            if (role === 'teacher') {
                return json({ success: true, data: { user: selfPayload.user, stats: selfPayload.stats, counts: selfPayload.counts, now } });
            }
            if (opts && opts.mineEmpty) {
                return json({
                    success: true,
                    data: {
                        user: minePayload.user,
                        stats: Object.assign({}, minePayload.stats, {
                            total: 0, correct: 0, hintedCorrect: 0, hinted: 0, scored: 0, correctCount: 0,
                            accuracy: null, avgMs: 0, lastAt: null, fraction: fractionZero(), byLevel: zeroLevels
                        }),
                        counts: EMPTY_COUNTS(),
                        now
                    }
                });
            }
            return json({ success: true, data: minePayload });
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
    const store = makeStore();
    if (opts.theme === 'dark') {
        store.setItem('poly-theme', 'dark');
        dom.documentElement.setAttribute('data-theme', 'dark');
    }
    const location = { replaced: null, replace(to) { this.replaced = to; } };
    const katexStub = {
        render: (text, el) => {
            if (opts.katexBroken) throw new Error('simulated katex failure');
            el._tex = text;
            el.textContent = text;
        }
    };
    const page = new Function('document', 'location', 'fetch', 'katex', 'localStorage', inline + '\n');
    page(dom.document, location, makeFetch(role, apiCalls, opts), katexStub, store);
    await settle();
    await settle();
    return { dom, apiCalls, location, store };
}

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const cells = (el) => (el && el.children) || [];
const text = (el) => (el ? String(el.textContent) : null);
// 汇总卡片：「标题=数值」列表
const formatCards = (box) => cells(box).map(c => text(cells(c)[0]) + '=' + text(cells(c)[1]));
const chipOf = (el) => ({
    field: (el.dataset && el.dataset.field) || el.getAttribute('data-field'),
    value: (el.dataset && el.dataset.value) || el.getAttribute('data-value')
});
// 筛选条重绘时 box.innerHTML = '' 会清空 children，所以每点一次都重新取一遍
const findChip = (box, field, value) => cells(box)
    .flatMap(line => cells(line))
    .filter(el => { const c = chipOf(el); return c.field === field && String(c.value) === String(value); })[0];
const clickChip = function (box, field, value) {
    const chip = findChip(box, field, value);
    check(!!chip, '筛选里应点得到 ' + field + '=' + value);
    if (chip) (chip.handlers.click || []).forEach(fn => fn({}));
};
const chipsOn = (box) => cells(box)
    .flatMap(line => cells(line))
    .filter(el => el.getAttribute && el.getAttribute('data-field'))
    .filter(el => /(^|\s)on(\s|$)/.test(el.className))
    .map(el => el.getAttribute('data-field') + ':' + el.getAttribute('data-value'));

(async () => {
    // ---------- 1. 老师身份 ----------
    const t = await boot('teacher');
    const who = text(t.dom.byId['who']);
    check(/老师/.test(who) && /TZDGJG/.test(who), '顶部应显示老师姓名和邀请码，实际: ' + who);

    const cards = cells(t.dom.byId['summary']);
    check(cards.length === 10, '汇总卡片应有 10 张，实际 ' + cards.length);
    const pairs = cards.map(c => text(cells(c)[0]) + '=' + text(cells(c)[1]));
    check(pairs[0] === '学生=2 人', '学生数不对: ' + pairs[0]);
    check(pairs[1] === '记录数=10 条', '总记录不对: ' + pairs[1]);
    check(pairs[2] === '正确率（提示算对，看解析算错）=70%', '正确率不对: ' + pairs[2]);
    check(pairs[3] === '独立做对=6 题', '独立做对不对: ' + pairs[3]);
    check(pairs[4] === '提示后对=1 题', '提示后对不对: ' + pairs[4]);
    check(pairs[5] === '错误=3 题', '错误数不对: ' + pairs[5]);
    check(pairs[6] === '用过提示=2 题', '提示数不对: ' + pairs[6]);
    check(pairs[7] === '看解析=0 题', '看解析数不对: ' + pairs[7]);
    check(pairs[8] === '分数题（对/总）=3/3', '分数题汇总不对: ' + pairs[8]);
    check(pairs[9] === '平均用时=15 秒', '平均用时不对: ' + pairs[9]);
    check(/筛选后 10 条 \/ 全部 10 条/.test(text(t.dom.byId['list-filter-summary'])),
        '看板应有筛选汇总文案，实际: ' + text(t.dom.byId['list-filter-summary']));

    // ---------- 1b. 筛选条初始选中态 ----------
    let onNow = chipsOn(t.dom.byId['list-filter']);
    check(onNow.indexOf('result:') >= 0, '结果筛选初始应选中「全部」，实际 ' + JSON.stringify(onNow));
    check(onNow.indexOf('kind:') >= 0, '题型筛选初始应选中「全部」，实际 ' + JSON.stringify(onNow));
    check(onNow.indexOf('range:') >= 0, '时间筛选初始应选中「全部」，实际 ' + JSON.stringify(onNow));
    check(!onNow.some(s => s.indexOf('level:1') === 0 || s.indexOf('level:2') === 0
        || s.indexOf('level:3') === 0 || s.indexOf('level:4') === 0),
        '难度筛选初始不该选中具体档位，实际 ' + JSON.stringify(onNow));

    // ---------- 2. 学生列表 ----------
    const rows = cells(t.dom.byId['students-body']);
    check(rows.length === 2, '应渲染 2 个学生，实际 ' + rows.length);
    check(text(cells(rows[0])[0]) === '小明', '最近做过的学生应排第一，实际 ' + text(cells(rows[0])[0]));

    const r1 = cells(rows[0]);
    check(text(r1[1]) === '10', '记录数不对: ' + text(r1[1]));
    check(text(r1[2]) === '70%', '正确率不对: ' + text(r1[2]));
    check(/算对 7 \/ 共 10/.test(r1[2].title), '正确率悬停应说明算对口径，实际: ' + r1[2].title);
    check(text(r1[3]) === '3', '错题数不对: ' + text(r1[3]));
    check(text(r1[4]) === '2', '提示数不对: ' + text(r1[4]));
    check(text(r1[5]) === '0', '看解析数不对: ' + text(r1[5]));
    check(text(r1[6]) === '15 秒', '平均用时不对: ' + text(r1[6]));
    check(/^今天 \d\d:\d\d$/.test(text(r1[7])), '最近时间格式不对: ' + text(r1[7]));
    check(text(r1[8]) === '3/4', '① 入门列不对: ' + text(r1[8]));
    check(text(r1[9]) === '3/6', '② 基础列不对: ' + text(r1[9]));
    check(text(r1[10]) === '—' && text(r1[11]) === '—', '没做过的难度应显示 —');
    check(/正确率 75%/.test(r1[8].title), '分难度悬停提示不对: ' + r1[8].title);
    check(text(r1[12]) === '3/3', '分数题列不对: ' + text(r1[12]));
    check(/正确率 100%/.test(r1[12].title) && /平均 12 秒/.test(r1[12].title),
        '分数题悬停提示不对: ' + r1[12].title);
    check(text(cells(r1[13])[0]) === '明细', '应有明细按钮');

    const r2 = cells(rows[1]);
    check(text(r2[0]) === '小红', '第二个学生名不对: ' + text(r2[0]));
    check(text(r2[1]) === '0' && text(r2[2]) === '—', '没做过的学生应显示 0 / —');
    check(text(r2[12]) === '—', '没做过分数题的学生应显示 —');

    // ---------- 3. 点明细 ----------
    (cells(r1[13])[0].handlers.click || []).forEach(fn => fn({ stopPropagation() {} }));
    await settle();
    check(t.dom.byId['list-view'].hidden === true, '进入明细后应隐藏列表');
    check(t.dom.byId['detail-view'].hidden === false, '进入明细后应显示明细');
    check(/小明/.test(text(t.dom.byId['detail-title'])), '明细标题应包含学生姓名');

    const attemptCalls = t.apiCalls.filter(c => c.url.indexOf('/api/teacher/attempts') === 0);
    check(attemptCalls.length === 1, '应请求一次明细接口，实际 ' + attemptCalls.length);
    check(attemptCalls.length && attemptCalls[0].url.indexOf('studentId=u_a') > 0,
        '明细请求应带上 studentId: ' + (attemptCalls[0] || {}).url);

    const drows = cells(t.dom.byId['detail-body']);
    check(drows.length === 4, '应渲染 4 条记录，实际 ' + drows.length);
    const d0 = cells(drows[0]);
    const d1 = cells(drows[1]);
    const d2 = cells(drows[2]);
    const d3 = cells(drows[3]);
    check(text(d0[1]) === '② 基础', '难度标签不对: ' + text(d0[1]));
    check(text(cells(d0[1])[0]) === '分数', '分数题明细应显示「分数」标签，实际: ' + text(cells(d0[1])[0]));
    check(d0[2]._tex === '1/2(x + 4) - 3', '题目应渲染出来: ' + d0[2]._tex);
    check(d0[4]._tex === 'x/2-1', '标准答案应渲染出来: ' + d0[4]._tex);
    check(text(cells(d0[5])[0]) === '独立对', '答对应显示「独立对」，实际 ' + text(cells(d0[5])[0]));
    check(text(cells(d1[5])[0]) === '提示后错', '用提示后答错应显示「提示后错」，实际 ' + text(cells(d1[5])[0]));
    check(text(cells(d2[5])[0]) === '看解析', '看解析应显示「看解析」，实际 ' + text(cells(d2[5])[0]));
    check(text(cells(d3[5])[0]) === '没去括号', '答案对但没去括号应显示「没去括号」，实际 ' + text(cells(d3[5])[0]));
    check(/tag-partial/.test(cells(d3[5])[0].className), '没化简完应使用 partial 样式');
    check(d2[3]._tex === '（空）', '空答案应显示（空），实际 ' + d2[3]._tex);
    check(text(d2[6]) === '1 分', '60 秒应显示 1 分，实际 ' + text(d2[6]));
    check(t.dom.byId['detail-empty'].hidden === true, '有记录时不该显示空状态');
    check(/筛选后 4 条 \/ 全部 4 条/.test(text(t.dom.byId['detail-filter-summary'])),
        '明细页应有筛选汇总文案，实际: ' + text(t.dom.byId['detail-filter-summary']));

    // ---------- 3b. 明细页筛选 ----------
    const offResultChip = function () {
        const chip = cells(t.dom.byId['detail-filter'])
            .flatMap(line => cells(line))
            .filter(el => chipOf(el).field === 'result' && !/(^|\s)on(\s|$)/.test(el.className))[0];
        return chip ? String(chipOf(chip).value) : null;
    };
    const clickChip = function (box, field, value) {
        const chip = findChip(box, field, value);
        check(!!chip, '筛选里应点得到 ' + field + '=' + value);
        if (chip) (chip.handlers.click || []).forEach(fn => fn({}));
    };
    const chipRows = (box) => cells(box).map(line => cells(line).map(chipOf));
    clickChip(t.dom.byId['detail-filter'], 'result', 'unmerged');
    let shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 1, '筛「没化简完」后应只剩 1 条，实际 ' + shown.length);
    check(text(cells(cells(shown[0])[5])[0]) === '没去括号', '筛选后剩下的是没去括号那条');
    clickChip(t.dom.byId['detail-filter'], 'kind', 'fraction');
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 0, '没化简完 + 分数题应没有记录，实际 ' + shown.length);
    check(t.dom.byId['detail-empty'].hidden === false, '筛选没结果时应显示空提示');
    check(/没有符合筛选条件/.test(text(t.dom.byId['detail-empty'])),
        '空提示应说明是筛选导致，实际: ' + text(t.dom.byId['detail-empty']));
    // 恢复：先点某个未被选中的结果项打开筛选，再点同一个取消，回到「全部」
    const anyResultChip = function () {
        const chip = cells(t.dom.byId['detail-filter'])
            .flatMap(line => cells(line))
            .filter(el => chipOf(el).field === 'result')[0];
        return chip ? String(chipOf(chip).value) : null;
    };
    const clickChipByKey = function (box, field, key) {
        const row = cells(box).map(line => cells(line).map(chipOf))
            .filter(line => line.some(c => c.field === field))[0] || [];
        const found = row.filter(c => String(c.value) === String(key))[0];
        const allChips = cells(box).flatMap(line => cells(line));
        const chip = allChips.filter(el => { const c = chipOf(el); return c.field === field && String(c.value) === String(found ? found.value : ''); })[0];
        check(!!chip, '筛选里应点得到 ' + field + '=' + key);
        if (chip) (chip.handlers.click || []).forEach(fn => fn({}));
    };
    clickChipByKey(t.dom.byId['detail-filter'], 'result', '');
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 2, '取消结果筛选后分数筛选仍在，应只剩 2 条分数题，实际 ' + shown.length);
    check(text(cells(cells(shown[0])[5])[0]) === '独立对', '剩下两条中的第一条应是独立做的分数题，实际 ' + text(cells(cells(shown[0])[5])[0]));
    clickChipByKey(t.dom.byId['detail-filter'], 'result', 'correct');
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 1, '独立对 + 分数题应只剩 1 条，实际 ' + shown.length);
    clickChipByKey(t.dom.byId['detail-filter'], 'result', 'correct');
    clickChipByKey(t.dom.byId['detail-filter'], 'kind', 'fraction');
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 4, '清空筛选后应恢复 4 条，实际 ' + shown.length);
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 4, '全部结果 + 全部题型的显式选择应是 4 条，实际 ' + shown.length);
    clickChipByKey(t.dom.byId['detail-filter'], 'kind', 'fraction');
    shown = cells(t.dom.byId['detail-body']);
    check(shown.length === 2, '只看分数题应剩 2 条（a1、a3），实际 ' + shown.length);
    check(/筛选后 2 条 \/ 全部 4 条/.test(text(t.dom.byId['detail-filter-summary'])),
        '只看分数题后明细汇总文本不符，实际 ' + text(t.dom.byId['detail-filter-summary']));
    check(t.dom.byId['detail-empty'].hidden === true, '有结果时应隐藏空提示');
    clickChipByKey(t.dom.byId['detail-filter'], 'kind', 'all');     // 恢复全部

    // ---------- 4. 返回列表 ----------
    (t.dom.byId['back'].handlers.click || []).forEach(fn => fn({}));
    check(t.dom.byId['list-view'].hidden === false, '返回后应显示列表');
    check(t.dom.byId['detail-view'].hidden === true, '返回后应隐藏明细');
    check(formatCards(t.dom.byId['summary'])[1] === '记录数=10 条', '明细页的筛选不该影响看板汇总');

    // ---------- 6b. 看板筛选 ----------
    clickChip(t.dom.byId['list-filter'], 'result', 'correct');
    let listCards = formatCards(t.dom.byId['summary']);
    check(listCards[1] === '记录数=6 条', '筛「独立对」后记录数应为 6，实际 ' + listCards[1]);
    check(listCards[2] === '正确率（提示算对，看解析算错）=100%', '筛选后正确率应为 100%');
    check(listCards[3] === '独立做对=6 题', '筛选后独立做对应为 6');
    check(/筛选后 6 条 \/ 全部 10 条/.test(text(t.dom.byId['list-filter-summary'])),
        '筛选文案不对: ' + text(t.dom.byId['list-filter-summary']));
    check(listCards[9] === '平均用时=—', '筛选后的平均用时无法准确计算，应显示 —');

    clickChip(t.dom.byId['list-filter'], 'kind', 'fraction');
    listCards = formatCards(t.dom.byId['summary']);
    check(listCards[1] === '记录数=2 条', '独立对 + 分数题应只有 2 条，实际 ' + listCards[1]);
    check(listCards[8] === '分数题（对/总）=2/2', '分数题卡片应跟随筛选，实际 ' + listCards[8]);

    clickChip(t.dom.byId['list-filter'], 'range', 'today');
    listCards = formatCards(t.dom.byId['summary']);
    check(listCards[1] === '记录数=0 条', '今天没有独立对的分数题，应为 0 条，实际 ' + listCards[1]);

    clickChip(t.dom.byId['list-filter'], 'result', 'correct');   // 取消结果筛选
    clickChip(t.dom.byId['list-filter'], 'kind', 'fraction');    // 取消题型筛选
    clickChip(t.dom.byId['list-filter'], 'range', '');           // 回到全部时间
    listCards = formatCards(t.dom.byId['summary']);
    check(listCards[1] === '记录数=10 条', '全部取消后应回到 10 条，实际 ' + listCards[1]);
    check(listCards[9] === '平均用时=15 秒', '没有筛选时平均用时应恢复');
    check(/筛选后 10 条 \/ 全部 10 条/.test(text(t.dom.byId['list-filter-summary'])),
        '取消筛选后文案应恢复');

    // 点「全部」或再点同一项，都应回到该组无筛选，且「全部」重新高亮
    clickChipByKey(t.dom.byId['list-filter'], 'kind', 'fraction');
    onNow = chipsOn(t.dom.byId['list-filter']);
    check(onNow.indexOf('kind:fraction') >= 0, '点分数题后该 chip 应高亮，实际 ' + JSON.stringify(onNow));
    check(onNow.indexOf('kind:') < 0, '点分数题后「全部」不该再高亮，实际 ' + JSON.stringify(onNow));
    clickChipByKey(t.dom.byId['list-filter'], 'kind', '');
    onNow = chipsOn(t.dom.byId['list-filter']);
    check(onNow.indexOf('kind:') >= 0, '点「全部」后应回到无筛选，实际 ' + JSON.stringify(onNow));
    clickChipByKey(t.dom.byId['list-filter'], 'range', 'today');
    onNow = chipsOn(t.dom.byId['list-filter']);
    check(onNow.indexOf('range:today') >= 0, '点今天后该 chip 应高亮，实际 ' + JSON.stringify(onNow));
    clickChipByKey(t.dom.byId['list-filter'], 'range', '');
    listCards = formatCards(t.dom.byId['summary']);
    check(listCards[1] === '记录数=10 条', '时间筛选复位后应回到 10 条，实际 ' + listCards[1]);

    // 夜间模式下选中态不能靠 CSS 变量漏配（否则点了也看不出变化）
    const darkCss = (html.match(/html\[data-theme="dark"\][\s\S]*?\}/) || [''])[0];
    check(/--chip-on-fg/.test(darkCss), '夜间配色应定义 --chip-on-fg');
    check(/--chip-ring/.test(darkCss), '夜间配色应定义 --chip-ring');
    check(/\.chip\.on[\s\S]*?var\(--chip-on-fg\)/.test(html), '选中 chip 的前景色应使用 --chip-on-fg');

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

    // ---------- 7. 学生身份：只看自己的「我的练习」 ----------
    const s = await boot('student');
    check(s.dom.byId['mine-view'].hidden === false, '学生进来应看到「我的练习」面板');
    check(s.dom.byId['list-view'].hidden === true, '学生进来不该显示学生列表');
    check(s.dom.byId['self-view'].hidden === true, '学生不该看到「我自己」那块');
    check(/学生/.test(text(s.dom.byId['who'])) && /学生甲/.test(text(s.dom.byId['who'])),
        '顶部应显示学生身份，实际 ' + text(s.dom.byId['who']));
    check(s.apiCalls.every(c => c.url === '/api/auth/me' || c.url === '/api/attempts/mine/summary'),
        '学生身份只该请求自己的汇总，实际 ' + JSON.stringify(s.apiCalls.map(c => c.url)));

    // 学生视角没有「几个学生」这张卡，其余和看板同一套口径
    const mineCards = formatCards(s.dom.byId['summary']);
    check(mineCards.length === 9, '学生视角应有 9 张卡（去掉「学生 N 人」），实际 ' + mineCards.length + ' ' + JSON.stringify(mineCards));
    check(mineCards[0] === '记录数=8 条', '自己的记录数不对: ' + mineCards[0]);
    check(mineCards[1] === '正确率（提示算对，看解析算错）=62.5%', '自己的正确率不对: ' + mineCards[1]);
    check(mineCards[2] === '独立做对=4 题', '自己的独立做对不对: ' + mineCards[2]);
    check(mineCards[3] === '提示后对=1 题', '自己的提示后对不对: ' + mineCards[3]);
    check(mineCards[4] === '错误=2 题', '自己的错误数不对: ' + mineCards[4]);
    check(mineCards[6] === '看解析=1 题', '自己的看解析数不对: ' + mineCards[6]);
    check(mineCards[7] === '分数题（对/总）=2/2', '自己的分数题不对: ' + mineCards[7]);
    check(mineCards[8] === '平均用时=9 秒', '自己的平均用时不对: ' + mineCards[8]);
    check(/筛选后 8 条 \/ 全部 8 条/.test(text(s.dom.byId['mine-filter-summary'])),
        '我的练习应有筛选汇总文案，实际: ' + text(s.dom.byId['mine-filter-summary']));
    check(/练得最多的是 ② 基础/.test(text(s.dom.byId['mine-suggestion'])),
        '应给出档位建议，实际: ' + text(s.dom.byId['mine-suggestion']));
    check(/③ 进阶只做了 1 题/.test(text(s.dom.byId['mine-suggestion'])),
        '应点出练得最少的档位，实际: ' + text(s.dom.byId['mine-suggestion']));

    // 学生也能筛自己的记录
    const mineChipsOn = () => chipsOn(s.dom.byId['mine-filter']);
    check(mineChipsOn().indexOf('kind:') >= 0, '我的练习筛选初始应选中题型「全部」');
    clickChip(s.dom.byId['mine-filter'], 'kind', 'fraction');
    const mineFrac = formatCards(s.dom.byId['summary']);
    check(mineFrac[0] === '记录数=2 条', '只看分数题应为 2 条，实际 ' + mineFrac[0]);
    check(mineFrac[7] === '分数题（对/总）=2/2', '只看分数题时分数题卡应为 2/2，实际 ' + mineFrac[7]);
    check(mineFrac[8] === '平均用时=—', '筛选后平均用时不该给不准的数，实际 ' + mineFrac[8]);
    check(/筛选后 2 条 \/ 全部 8 条/.test(text(s.dom.byId['mine-filter-summary'])),
        '我的练习筛选文案不对: ' + text(s.dom.byId['mine-filter-summary']));
    clickChip(s.dom.byId['mine-filter'], 'kind', 'fraction');   // 点同一项取消
    check(formatCards(s.dom.byId['summary'])[0] === '记录数=8 条', '取消筛选后应回到 8 条');

    // 学生看自己的明细，返回时回到「我的练习」
    (s.dom.byId['mine-detail'].handlers.click || []).forEach(fn => fn({}));
    await settle();
    await settle();
    check(s.dom.byId['detail-view'].hidden === false, '点「看全部明细」应打开明细视图');
    check(s.dom.byId['mine-view'].hidden === true, '看明细时应收起「我的练习」');
    check(/学生甲 的做题记录/.test(text(s.dom.byId['detail-title'])),
        '明细标题不对: ' + text(s.dom.byId['detail-title']));
    check(cells(s.dom.byId['detail-body']).length === 4, '明细应有 4 行，实际 ' + cells(s.dom.byId['detail-body']).length);
    check(s.apiCalls.some(c => /^\/api\/attempts\/mine/.test(c.url)), '学生看明细应走自己的接口');
    (s.dom.byId['back'].handlers.click || []).forEach(fn => fn({}));
    check(s.dom.byId['detail-view'].hidden === true, '点返回应关掉明细');
    check(s.dom.byId['mine-view'].hidden === false, '学生点返回应回到「我的练习」，而不是学生列表');
    check(s.dom.byId['list-view'].hidden === true, '学生点返回不该露出学生列表');

    // 还没做过题的学生：给一句去练习的提示
    const fresh = await boot('student', { mineEmpty: true });
    check(/还没做过题/.test(text(fresh.dom.byId['mine-suggestion'])),
        '没有记录时应提示去练习，实际: ' + text(fresh.dom.byId['mine-suggestion']));
    check(formatCards(fresh.dom.byId['summary'])[0] === '记录数=0 条', '没有记录时记录数应为 0');

    // ---------- 8. KaTeX 挂了也要能看 ----------
    const k = await boot('teacher', { katexBroken: true });
    const kRow = cells(k.dom.byId['students-body'])[0];
    (cells(cells(kRow)[13])[0].handlers.click || []).forEach(fn => fn({ stopPropagation() {} }));
    await settle();
    const kFirst = cells(cells(k.dom.byId['detail-body'])[0]);
    check(text(kFirst[2]) === '1/2(x + 4) - 3', 'KaTeX 失效时应退化成纯文本，实际: ' + text(kFirst[2]));

    // ---------- 9. 我自己（老师本账号的记录）----------
    check(t.dom.byId['self-view'].hidden === false, '老师自己有记录时应显示「我自己」面板');
    const selfStats = text(t.dom.byId['self-stats']);
    check(/练了 8 题/.test(selfStats), '自练题数不对: ' + selfStats);
    check(/正确率 75%/.test(selfStats), '自练正确率不对: ' + selfStats);
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

    // ---------- 10. 夜间模式 ----------
    const themeBtn = t.dom.byId['theme-toggle'];
    check(t.dom.documentElement.getAttribute('data-theme') === null, '默认应是白天模式');
    check(text(themeBtn) === '🌙', '白天时按钮应显示 🌙，实际: ' + text(themeBtn));
    const toggleTheme = () => (themeBtn.handlers.click || []).forEach(fn => fn({}));
    toggleTheme();
    check(t.dom.documentElement.getAttribute('data-theme') === 'dark', '点一次应切到夜间模式');
    check(text(themeBtn) === '☀️', '夜间时按钮应显示 ☀️，实际: ' + text(themeBtn));
    check(themeBtn.getAttribute('aria-pressed') === 'true', '夜间时 aria-pressed 应为 true');
    check(t.store.getItem('poly-theme') === 'dark', '夜间模式应写进 localStorage，实际: ' + t.store.getItem('poly-theme'));
    toggleTheme();
    check(t.dom.documentElement.getAttribute('data-theme') === null, '再点一次应切回白天');
    check(t.store.getItem('poly-theme') === 'light', '切回白天应记 light，实际: ' + t.store.getItem('poly-theme'));
    // 上次选了夜间，重进看板应直接是夜间，按钮显示 ☀️
    const darkBoard = await boot('teacher', { theme: 'dark' });
    check(darkBoard.dom.documentElement.getAttribute('data-theme') === 'dark',
        '上次选了夜间模式，重进看板应直接是夜间');
    check(text(darkBoard.dom.byId['theme-toggle']) === '☀️', '恢复夜间后按钮应为 ☀️');
    // 练习页和看板共用同一个开关：两边取的都是 poly-theme
    check(html.indexOf("localStorage.getItem('poly-theme') === 'dark'") > 0 &&
        html.indexOf("localStorage.setItem('poly-theme'") > 0,
        '看板应和练习页共用 poly-theme 这个键');

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
