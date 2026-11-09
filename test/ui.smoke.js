// test/ui.smoke.js —— 练习页交互冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：出题渲染 / 提示 / 答对给过程 / 错两次给过程 / 看解析给过程 + 学生答案对照 / 锁键盘 / 下一题
// 用法：node test/ui.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));
const createMathCore = require(path.join(root, 'frontend/js/math-core.js'));
const createSimplifyEngine = require(path.join(root, 'frontend/js/engine-simplify.js'));
const practiceCode = fs.readFileSync(path.join(root, 'frontend/js/practice.js'), 'utf8');

const core = createMathCore(math);
const engine = createSimplifyEngine(math, core);

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
    setAttribute(name, value) { (this.attrs = this.attrs || {})[name] = String(value); }
    getAttribute(name) { return this.attrs ? (this.attrs[name] === undefined ? null : this.attrs[name]) : null; }
    removeAttribute(name) { if (this.attrs) delete this.attrs[name]; }
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
const tagEl = mk('q-tag');
const inEl = mk('input-display');
const fbEl = mk('feedback-display');
const hintsEl = mk('hint-display');
const stepsEl = mk('steps-display');
const levelTabs = mk('level-tabs');
const keyboard = mk('keyboard');
const whoEl = mk('who');
const boardEl = mk('board-link');
const logoutEl = mk('logout');

const keys = {};
function key(name, opts) {
    const el = mk('', 'div', 'key' + (opts.classes ? ' ' + opts.classes : ''));
    if (opts.val !== undefined) el.dataset.val = opts.val;
    if (opts.action) el.dataset.action = opts.action;
    keyboard.appendChild(el);
    keys[name] = el;
}
['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '/', '0', 'x', '(', ')', 'y', '^2', '^3']
    .forEach(v => key('k_' + v, { val: v }));
key('x_var', { val: 'x', classes: 'var' });
key('y_var', { val: 'y', classes: 'var' });
key('clear', { action: 'clear', classes: 'action' });
key('backspace', { action: 'backspace', classes: 'action' });
key('hint', { action: 'hint', classes: 'action' });
key('giveup', { action: 'giveup', classes: 'action' });
key('submit', { action: 'submit', classes: 'submit' });

const document = {
    documentElement: new El('html'),
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => registry.find(e => matches(e, sel)) || null,
    querySelectorAll: (sel) => registry.filter(e => matches(e, sel)),
    createElement: (tag) => new El(tag)
};

// 从 practice.html 解析出真实软键盘，测试夹具必须和页面一致（多了/少了一个键就失败）
function keyboardFromHtml() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'practice.html'), 'utf8');
    const start = html.indexOf('id="keyboard"');
    const stop = html.indexOf('data-action="submit"');
    const block = html.slice(start, stop < 0 ? html.length : stop);
    const re = /<div class="key([^"]*)"([^>]*)>([^<]*)<\/div>/g;
    const list = [];
    let m;
    while ((m = re.exec(block))) {
        const attrs = m[2];
        const val = (attrs.match(/data-val="([^"]*)"/) || [])[1];
        const action = (attrs.match(/data-action="([^"]*)"/) || [])[1];
        list.push({ classes: m[1].trim(), val, action, text: m[3].trim() });
    }
    return list;
}
const htmlKeys = keyboardFromHtml();
const practiceHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'practice.html'), 'utf8');

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
fakeWindow.PolyEngine = engine;

// ---------- 启动页面脚本 ----------
const FixedQuestion = { level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10' };
store.set('poly_current_q:u_test', JSON.stringify(
    Object.assign({}, FixedQuestion, { startedAt: Date.now(), clientId: 'c_test' })
));

new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math', 'fetch',
    practiceCode + '\n')(fakeWindow, document, katex, localStorage, () => true,
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
check(tagEl.hidden === true, '整数题不应显示「分数」标签');
check(!!keys['k_/'], '软键盘应有 / 键');
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
check(posts[1] && posts[1].gaveUp === false, '错两次被动给解析不应记 gaveUp');
check(posts[2] && posts[2].result === 'wrong' && posts[2].revealed === true, '看解析应记 revealed');
check(posts[2] && posts[2].gaveUp === true, '主动点看解析应记 gaveUp');
check(posts[2] && posts[2].studentAnswer === '9x+9x', '看解析应带上学生原答案');
check(posts.every(p => p && p.level === 2), '应带难度');
check(posts.every(p => p && Array.isArray(p.tags)), '上报应带 tags 数组');
check(posts[0] && posts[0].tags.length === 0, '整数缓存题的 tags 应为空数组');
check(posts.every(p => p.question.includes('/') === (p.tags.includes('fraction'))),
    'tags 应与分数题面一致');

// 11. 顶部显示当前学生
check(/小明/.test(whoEl.textContent), '顶部应显示学生姓名，实际: ' + whoEl.textContent);
check(boardEl.hidden === false, '学生也应看到「看板」入口（进去只看自己）');

// 12. KaTeX 渲染失败时要退化成纯文本，题目仍然看得见
katex.render = () => { throw new Error('simulated katex failure'); };
(levelTabs.handlers.click || []).forEach(fn => fn({ target: tabEls[2] }));
await new Promise(r => setImmediate(r));
const shownQuestion = String(qEl._html || qEl.textContent || '');
check(shownQuestion.length > 0, 'KaTeX 失败时题目应退化为纯文本，实际为空');
check(/[0-9xab(]/.test(shownQuestion), '退化内容应包含题目字符，实际: ' + shownQuestion);

// 13. 进入页面的默认难度 + 缓存时效
const normalKatexRender = katex.render;
const KEY = 'poly_current_q:u_test';

async function bootFreshPage(cached, opts) {
    katex.render = (value, el) => { el._tex = value; el.textContent = value; };   // 恢复正常的桩
    registry.length = 0;
    Object.keys(byId).forEach(k => delete byId[k]);
    store.clear();
    if (cached) store.set(KEY, JSON.stringify(cached));
    // 模拟 <head> 里那段主题初始化脚本：从 localStorage 恢复夜间模式
    const docEl = new El('html');
    const savedTheme = (opts && opts.theme) || null;
    if (savedTheme) store.set('poly-theme', savedTheme);
    if (savedTheme === 'dark') docEl.setAttribute('data-theme', 'dark');
    document.documentElement = docEl;

    const tabs = [1, 2, 3, 4].map(lv => {
        const el = mk('', 'button', 'level-tab');
        el.dataset.level = String(lv);
        return el;
    });
    mk('level-tabs');
    const question = mk('question-display');
    const tag = mk('q-tag');
    const input = mk('input-display');
    const feedback = mk('feedback-display');
    mk('hint-display');
    const steps = mk('steps-display');
    mk('who');
    mk('board-link');
    mk('logout');
    const themeBtn = mk('theme-toggle', 'button');

    const keyboardEl = mk('keyboard');
    const freshKeys = {};
    function addKey(name, opts) {
        const el = mk('', 'div', 'key' + (opts.classes ? ' ' + opts.classes : ''));
        if (opts.val !== undefined) el.dataset.val = opts.val;
        if (opts.action) el.dataset.action = opts.action;
        keyboardEl.appendChild(el);
        freshKeys[name] = el;
    }
    ['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '/', '0', 'x', '(', ')', 'y', '^2', '^3']
        .forEach(v => addKey('k_' + v, { val: v }));
    addKey('x_var', { val: 'x', classes: 'var' });
    addKey('y_var', { val: 'y', classes: 'var' });
    addKey('clear', { action: 'clear', classes: 'action' });
    addKey('backspace', { action: 'backspace', classes: 'action' });
    addKey('hint', { action: 'hint', classes: 'action' });
    addKey('giveup', { action: 'giveup', classes: 'action' });
    addKey('submit', { action: 'submit', classes: 'submit' });

    const click = (name) => (keyboardEl.handlers.click || []).forEach(fn => fn({ target: freshKeys[name] }));
    const type = (text) => [...text].forEach(ch => {
        if (!freshKeys['k_' + ch]) throw new Error('键盘上没有 ' + ch);
        click('k_' + ch);
    });

    new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math', 'fetch',
        practiceCode + '\n')(fakeWindow, document, katex, localStorage, () => true,
        () => 0, () => { }, math, fetchStub);

    await fakeWindow.onload();
    await new Promise(r => setImmediate(r));
    const byClass = (sel) => (keyboardEl.children || []).filter(el => matches(el, sel));
    return { tabs, question, tag, input, feedback, steps, keys: freshKeys, click, type, byClass, themeBtn, docEl };
}

const activeLevelOf = (tabs) => {
    const active = tabs.filter(t => t.classList.contains('active'));
    return active.length === 1 ? active[0].dataset.level : 'active=' + active.length;
};

const freshPage = await bootFreshPage(null);
check(activeLevelOf(freshPage.tabs) === '1',
    '新学生（无缓存）应默认「① 入门」，实际 ' + activeLevelOf(freshPage.tabs));
check(String(freshPage.question._tex || '').length > 0, '默认难度的题应渲染出来');
check(freshPage.tag.hidden === true, '入门题不应显示「分数」标签');

// 夜间模式：默认亮色，点按钮切深色并记住，再点切回；重新进页面能恢复
check(freshPage.docEl.getAttribute('data-theme') === null,
    '默认应为白天模式（<html> 上不该有 data-theme）');
check(freshPage.themeBtn.textContent === '🌙', '白天时按钮应显示 🌙，实际: ' + freshPage.themeBtn.textContent);
check(freshPage.themeBtn.getAttribute('aria-pressed') === 'false', '白天时 aria-pressed 应为 false');
const toggleTheme = () => (freshPage.themeBtn.handlers.click || []).forEach(fn => fn({ target: freshPage.themeBtn }));
toggleTheme();
check(freshPage.docEl.getAttribute('data-theme') === 'dark', '点一次应切到夜间模式');
check(freshPage.themeBtn.textContent === '☀️', '夜间时按钮应显示 ☀️，实际: ' + freshPage.themeBtn.textContent);
check(freshPage.themeBtn.getAttribute('aria-pressed') === 'true', '夜间时 aria-pressed 应为 true');
check(store.get('poly-theme') === 'dark', '夜间模式应写进 localStorage，实际: ' + store.get('poly-theme'));
toggleTheme();
check(freshPage.docEl.getAttribute('data-theme') === null, '再点一次应切回白天');
check(store.get('poly-theme') === 'light', '切回白天应记 light，实际: ' + store.get('poly-theme'));
const darkPage = await bootFreshPage(null, { theme: 'dark' });
check(darkPage.docEl.getAttribute('data-theme') === 'dark',
    '上次选了夜间模式，重进页面应直接是夜间');
check(darkPage.themeBtn.textContent === '☀️', '恢复夜间模式后按钮应为 ☀️，实际: ' + darkPage.themeBtn.textContent);

// 软键盘：只有 x、y 两个字母键，且都带 math 斜体样式；「清空」键能清掉输入
const varKeys = freshPage.byClass('.key.var');
check(varKeys.length === 2, '变量键应只有 x、y 两个，实际 ' + varKeys.length);
check(varKeys.map(k => k.dataset.val).sort().join(',') === 'x,y',
    '变量键应是 x、y，实际 ' + varKeys.map(k => k.dataset.val).join(','));
check(freshPage.byClass('.key.action').filter(k => k.dataset.action === 'clear').length === 1,
    '软键盘应有「清空」键');
freshPage.type('2x');
check(freshPage.input._tex === '2x', '输入 2x 后应渲染出来，实际: ' + freshPage.input._tex);
freshPage.click('clear');
check(freshPage.input.textContent === '请点击下方键盘输入',
    '点「清空」后输入区应恢复占位提示，实际: ' + freshPage.input.textContent);
freshPage.type('1');
check(freshPage.input._tex === '1', '清空后仍应能继续输入，实际: ' + freshPage.input._tex);
freshPage.click('clear');

const oldPage = await bootFreshPage({
    level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10',
    startedAt: Date.now() - 2 * 60 * 60 * 1000, clientId: 'c_old'
});
check(activeLevelOf(oldPage.tabs) === '1',
    '两小时前的旧题应丢弃、重新从入门开始，实际 ' + activeLevelOf(oldPage.tabs));

const warmPage = await bootFreshPage({
    level: 3, question: 'x - (3x - 2)', answer: '-2x+2',
    startedAt: Date.now() - 60 * 1000, clientId: 'c_warm'
});
check(activeLevelOf(warmPage.tabs) === '3',
    '刚做过的题刷新后应接着做，实际 ' + activeLevelOf(warmPage.tabs));
check(warmPage.tag.hidden === true, '整数缓存题不应显示「分数」标签');
check(warmPage.question._tex === 'x - (3x - 2)',
    '整数题不应被改成 LaTeX 括号形式，实际: ' + warmPage.question._tex);

// 14. 分数题：标签、斜杠输入、判题、上报 tags
const beforeFraction = apiCalls.length;
const fractionPage = await bootFreshPage({
    level: 2, question: '1/2(x + 4) - 3', answer: 'x/2-1',
    tags: ['fraction'], startedAt: Date.now() - 60 * 1000, clientId: 'c_frac'
});
check(activeLevelOf(fractionPage.tabs) === '2',
    '分数缓存题应保持原难度，实际 ' + activeLevelOf(fractionPage.tabs));
check(fractionPage.tag.hidden === false, '分数题应显示「分数」标签');
check(fractionPage.tag.textContent === '分数', '标签文案应为「分数」，实际: ' + fractionPage.tag.textContent);
check(String(fractionPage.question._tex || '').includes('\\dfrac{1}{2}'),
    '分数题题目应渲染成上下分式，实际: ' + fractionPage.question._tex);
fractionPage.type('x/2-1');
check(fractionPage.input._tex === '\\dfrac{x}{2}-1',
    '分数输入应实时渲染成上下分式，实际: ' + fractionPage.input._tex);
fractionPage.click('submit');
check(/正确/.test(fractionPage.feedback.textContent), '分数题答对应提示正确，实际: ' + fractionPage.feedback.textContent);
const fracRows = fractionPage.steps.children;
const fracLast = fracRows[fracRows.length - 1];
check(cellTex(fracLast, 1) === '\\dfrac{x}{2}-1',
    '分数题最后一步应渲染成上下分式，实际: ' + cellTex(fracLast, 1));

await new Promise(r => setImmediate(r));
const fracPosts = apiCalls.slice(beforeFraction)
    .filter(c => c.url === '/api/attempts')
    .map(c => { try { return JSON.parse(c.opts.body); } catch (e) { return null; } });
check(fracPosts.length === 1, '分数题应上报 1 次，实际 ' + fracPosts.length);
check(fracPosts[0] && fracPosts[0].level === 2, '分数题应带难度');
check(fracPosts[0] && Array.isArray(fracPosts[0].tags) && fracPosts[0].tags.includes('fraction'),
    '分数题上报应带 fraction 标签');

katex.render = normalKatexRender;

// 页面上的软键盘必须和上面这套夹具一致：字母只剩 x、y，还会多一个「清空」键
const htmlVals = htmlKeys.filter(k => k.val).map(k => k.val);
check(htmlKeys.length > 0, '没能从 practice.html 解析出软键盘');
[7, 8, 9, '+', 4, 5, 6, '-', 1, 2, 3, '*', '/', 0, 'x', '(', ')', 'y', '^2', '^3']
    .forEach(v => check(htmlVals.includes(String(v)), '页面软键盘缺键: ' + v));
['a', 'b'].forEach(v => check(!htmlVals.includes(v), '页面软键盘不应再有字母键: ' + v));
check(htmlKeys.filter(k => k.action === 'clear').length === 1, '页面软键盘应有「清空」键');
check(htmlKeys.filter(k => /\bvar\b/.test(k.classes)).map(k => k.val).sort().join(',') === 'x,y',
    '页面上带数学斜体的键应正好是 x、y');
check(htmlKeys.length === 24, '软键盘应为 24 个键（提交按钮单独统计），实际 ' + htmlKeys.length);
// 第四排：0、x、y、左右括号（按页面里的文档顺序）
const valKeys = htmlKeys.filter(k => k.val).map(k => k.val);
check(valKeys.slice(-5).join(',') === '0,x,y,(,)',
    '第四排按键应为 0 x y ( )，实际 ' + valKeys.slice(-5).join(','));
check(htmlKeys.filter(k => k.action === 'backspace').length === 1 &&
    htmlKeys.filter(k => k.action === 'hint').length === 1 &&
    htmlKeys.filter(k => k.action === 'giveup').length === 1,
    '页面软键盘应保留退格/提示/看解析三个动作键');
check(practiceHtml.slice(practiceHtml.indexOf('data-action="submit"') - 40, practiceHtml.indexOf('data-action="submit"')).includes('class="key submit"'),
    '页面应有「提交答案」键');

// ---------- 汇总 ----------
console.log('=== 交互冒烟 ===');
if (fails.length === 0) console.log('  全部通过');
else {
    fails.forEach(f => console.log('  ✗ ' + f));
    process.exitCode = 1;
}
})();

const window = { onload: null };
