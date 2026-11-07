// test/ui.smoke.js —— 练习页交互冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：出题渲染 / 提示 / 答对给过程 / 错两次给过程 / 看解析给过程 + 学生答案对照 / 锁键盘 / 下一题
// 用法：node test/ui.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));
const html = fs.readFileSync(path.join(root, 'frontend/practice.html'), 'utf8');
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
        this._html = '';
        this.handlers = {};
        this._classes = new Set();
        const self = this;
        this.classList = {
            add: (c) => self._classes.add(c),
            remove: (c) => self._classes.delete(c),
            contains: (c) => self._classes.has(c),
            toggle: (c, force) => {
                if (force === undefined) { self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c); }
                else if (force) self._classes.add(c);
                else self._classes.delete(c);
            }
        };
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = v; this.children = []; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
    closest(sel) { return matches(this, sel) ? this : null; }
}

function matches(el, sel) {
    if (!sel.startsWith('.')) return false;
    return sel.slice(1).split('.').every(c => el._classes.has(c));
}

const registry = [];
const byId = {};
function mk(id, tag, classes) {
    const el = new El(tag || 'div', id);
    if (classes) classes.split(' ').forEach(c => el._classes.add(c));
    registry.push(el);
    if (id) byId[id] = el;
    return el;
}

const tabEls = [1, 2, 3, 4].map(lv => {
    const el = mk('', 'button', 'level-tab');
    el.dataset.level = String(lv);
    return el;
});

const qEl = mk('question-display');
const inEl = mk('input-display');
const fbEl = mk('feedback-display');
const hintsEl = mk('hint-display');
const stepsEl = mk('steps-display');
const levelTabs = mk('level-tabs');
const keyboard = mk('keyboard');
const whoEl = mk('who');
const logoutEl = mk('logout');

const keys = {};
function key(name, opts) {
    const el = mk('', 'div', 'key' + (opts.classes ? ' ' + opts.classes : ''));
    if (opts.val !== undefined) el.dataset.val = opts.val;
    if (opts.action) el.dataset.action = opts.action;
    keyboard.appendChild(el);
    keys[name] = el;
}
['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '0', 'x', '(', ')', 'a', 'b', '^2', '^3']
    .forEach(v => key('k_' + v, { val: v }));
key('backspace', { action: 'backspace', classes: 'action' });
key('hint', { action: 'hint', classes: 'action' });
key('giveup', { action: 'giveup', classes: 'action' });
key('submit', { action: 'submit', classes: 'submit' });

const document = {
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => registry.find(e => matches(e, sel)) || null,
    querySelectorAll: (sel) => registry.filter(e => matches(e, sel)),
    createElement: (tag) => new El(tag)
};

const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};

const katex = { render: (text, el) => { el._tex = text; el.textContent = text; } };

// 假的 fetch：/api/auth/me 返回一个学生，/api/attempts 记下来
const apiCalls = [];
const fakeUser = { id: 'u_test', name: '小明', role: 'student' };
const fetchStub = async (url, opts) => {
    apiCalls.push({ url, opts: opts || {} });
    if (url === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { user: fakeUser } }) };
    }
    if (url === '/api/attempts') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'a_test' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: null }) };
};

const fakeWindow = {
    onload: null,
    location: { replaced: null, replace(to) { this.replaced = to; } }
};

// ---------- 启动页面脚本 ----------
const FixedQuestion = { level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10' };
store.set('poly_current_q:u_test', JSON.stringify(
    Object.assign({}, FixedQuestion, { startedAt: Date.now(), clientId: 'c_test' })
));

new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math', 'fetch',
    inline + '\n')(fakeWindow, document, katex, localStorage, () => true,
    () => 0, () => { }, math, fetchStub);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
// 取某一行的第 i 个单元格（行结构缺失时返回 null，避免测试自己崩掉、掩盖真正的失败）
const cellText = (row, i) => {
    const cell = row && row.children ? row.children[i || 0] : null;
    return cell ? String(cell.textContent) : null;
};
const cellTex = (row, i) => {
    const cell = row && row.children ? row.children[i || 0] : null;
    return cell && cell._tex !== undefined && cell._tex !== null ? String(cell._tex) : null;
};
const clickKey = (name) => (keyboard.handlers.click || []).forEach(fn => fn({ target: keys[name] }));
const type = (s) => [...s].forEach(ch => {
    if (!keys['k_' + ch]) throw new Error('键盘上没有 ' + ch);
    clickKey('k_' + ch);
});

(async () => {
try {
    await fakeWindow.onload();
} catch (err) {
    console.log('页面脚本初始化失败:', err.message);
    process.exit(1);
}

// 1. 初始状态
check(qEl._tex === FixedQuestion.question, '题目未按缓存渲染: ' + qEl._tex);
check(hintsEl.hidden === true && stepsEl.hidden === true, '初始应隐藏提示与解析面板');
check(keys.submit.textContent === '提交答案', '提交键文案不对: ' + keys.submit.textContent);

// 2. 提示
clickKey('hint');
check(hintsEl.hidden === false, '点提示后面板应展开');
check(hintsEl.children.length === 2, '提示面板应含标题 + 列表');
const hintItems = hintsEl.children.length > 1 ? hintsEl.children[1].children : [];
check(hintItems.length >= 2, '提示条目应 >= 2，实际 ' + hintItems.length);
check(hintItems.some(li => /变号/.test(li.textContent)), '应命中「变号」提示');
check(hintItems.some(li => /漏乘/.test(li.textContent)), '应命中「漏乘」提示');
const hintCountBefore = hintsEl.children.length;
clickKey('hint');
check(hintsEl.children.length === hintCountBefore, '重复点提示不应重复展开');

// 3. 答对也给完整过程，并且停在这一题不再自动跳
type('-2x-10');
clickKey('submit');
check(/正确/.test(fbEl.textContent), '答对应提示正确，实际: ' + fbEl.textContent);
check(stepsEl.hidden === false, '答对后也应展开完整过程');
check(keys.submit.textContent === '下一题' && keys.submit.dataset.action === 'next',
    '答对后应停在本题等「下一题」，实际按钮: ' + keys.submit.textContent);
const okRows = stepsEl.children;
check(okRows.length >= 3, '答对的过程应有标题 + 至少 2 步，实际 ' + okRows.length);
check(!(okRows[1] && okRows[1].classList.contains('step-mine')), '答对时不该出现「你的答案」对照行');
const okLastTex = cellTex(okRows[okRows.length - 1], 1);
check(okLastTex !== null && okLastTex.replace(/\s+/g, '') === FixedQuestion.answer, '最后一步应等于答案: ' + okLastTex);

// 4. 一题结束后键盘无效
const beforeLock = inEl._tex;
clickKey('k_5');
check(inEl._tex === beforeLock, '本题结束后键盘应被锁住');

// 5. 下一题：清空面板、按钮复原
const oldQuestion = qEl._tex;
clickKey('submit');
check(qEl._tex !== oldQuestion, '点下一题应换新题');
check(stepsEl.hidden === true && hintsEl.hidden === true, '换题后应清空提示与解析');
check(keys.submit.textContent === '提交答案' && keys.submit.dataset.action === 'submit', '换题后按钮应复原');

// 6. 错两次：出过程，并把学生原答案放在最上面做对照
type('555');
clickKey('submit');
check(/还有 1 次机会/.test(fbEl.textContent), '第一次错应有提示语，实际: ' + fbEl.textContent);
check(stepsEl.hidden === true, '第一次错不应直接给解析');

clickKey('submit');
check(stepsEl.hidden === false, '错两次应展开完整过程');
check(/错了两次/.test(fbEl.textContent), '二次错反馈不对: ' + fbEl.textContent);
check(keys.submit.textContent === '下一题', '错两次后应变成下一题');
const wrongRows = stepsEl.children;
const wrongMine = wrongRows[1];
check(!!(wrongMine && wrongMine.classList.contains('step-mine')), '错两次时应显示「你的答案」对照行');
check(cellText(wrongMine, 0) === '你的答案', '对照行标签不对: ' + cellText(wrongMine, 0));
check(cellTex(wrongMine, 1) === '555', '对照行应显示学生原答案，实际: ' + cellTex(wrongMine, 1));
check(wrongRows.length >= 4, '应含标题 + 对照行 + 至少 2 步，实际 ' + wrongRows.length);

// 7. 错两次后点下一题换题
const wrongQuestion = qEl._tex;
clickKey('submit');
check(qEl._tex !== wrongQuestion, '错两次后点下一题应换题');

// 8. 看解析：同样给完整过程 + 对照，并停在这一题
type('9x+9x');
clickKey('giveup');
check(stepsEl.hidden === false, '看解析应展开完整过程');
check(keys.submit.textContent === '下一题', '看解析后应停在本题等「下一题」，实际: ' + keys.submit.textContent);
const giveRows = stepsEl.children;
const giveMine = giveRows[1];
check(!!(giveMine && giveMine.classList.contains('step-mine')), '看解析时应显示「你的答案」对照行');
check(cellTex(giveMine, 1) === '9x+9x', '对照行应显示学生原答案，实际: ' + cellTex(giveMine, 1));
check(giveRows.length >= 4, '看解析应含标题 + 对照行 + 至少 2 步，实际 ' + giveRows.length);
const norm = (s) => String(s).replace(/\s+/g, '').replace(/\\cdot/g, '*');
const giveLastTex = cellTex(giveRows[giveRows.length - 1], 1);
check(giveLastTex !== null && giveLastTex.length > 0, '看解析的最后一步不应为空');
check(giveLastTex !== null && norm(inEl._tex) === norm(giveLastTex), '看解析时输入区应显示标准答案，实际: ' + inEl._tex);

// 9. 看解析后键盘无效
const beforeLock2 = inEl._tex;
clickKey('k_5');
check(inEl._tex === beforeLock2, '看解析后键盘应被锁住');

// 10. 上报：答对 / 错两次 / 看解析各 1 条，只有后两条标 revealed
await new Promise(r => setImmediate(r));
const posts = apiCalls.filter(c => c.url === '/api/attempts').map(c => {
    try { return JSON.parse(c.opts.body); } catch (e) { return null; }
});
check(posts.length === 3, '三题应各上报 1 次，实际 ' + posts.length);
check(posts.every(Boolean), '上报内容应是 JSON');
check(posts[0] && posts[0].result === 'correct' && posts[0].revealed === false, '答对应为 correct 且未 revealed');
check(posts[0] && posts[0].clientId === 'c_test', '应带上 clientId');
check(posts[1] && posts[1].result === 'wrong' && posts[1].revealed === true, '错两次应记 revealed');
check(posts[2] && posts[2].result === 'wrong' && posts[2].revealed === true, '看解析应记 revealed');
check(posts[2] && posts[2].studentAnswer === '9x+9x', '看解析应带上学生原答案');
check(posts.every(p => p && p.level === 2), '应带难度');

// 11. 顶部显示当前学生
check(/小明/.test(whoEl.textContent), '顶部应显示学生姓名，实际: ' + whoEl.textContent);

// 12. KaTeX 渲染失败时要退化成纯文本，题目仍然看得见
katex.render = () => { throw new Error('simulated katex failure'); };
(levelTabs.handlers.click || []).forEach(fn => fn({ target: tabEls[2] }));
await new Promise(r => setImmediate(r));
const shownQuestion = String(qEl._html || qEl.textContent || '');
check(shownQuestion.length > 0, 'KaTeX 失败时题目应退化为纯文本，实际为空');
check(/[0-9xab(]/.test(shownQuestion), '退化内容应包含题目字符，实际: ' + shownQuestion);

// ---------- 汇总 ----------
console.log('=== 交互冒烟 ===');
if (fails.length === 0) console.log('  全部通过');
else {
    fails.forEach(f => console.log('  ✗ ' + f));
    process.exitCode = 1;
}
})();

const window = { onload: null };
