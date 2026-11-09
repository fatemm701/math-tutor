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
// 解析范围到软键盘之后的 <script> 为止：提交键必须完整收进来（前面按 data-action="submit"
// 截断只会得到半截属性、把 submit 键漏掉，这样「动作键一致」这类对照就形同虚设）。
function keysFromHtml(html, fileLabel) {
    const start = html.indexOf('id="keyboard"');
    if (start < 0) throw new Error(fileLabel + ' 里找不到 id="keyboard"');
    const after = html.indexOf('<script', start);
    const block = html.slice(start, after < 0 ? html.length : after);
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
const practiceHtml = fs.readFileSync(path.join(root, 'frontend', 'practice.html'), 'utf8');
const htmlKeys = keysFromHtml(practiceHtml, 'practice.html');

// ---------- 侧边栏（app-nav）夹具解析 ----------
// 四个页面共用同一段侧边栏结构：只解析、不在桩里跑 app-nav.js（那是 nav.smoke.js 的活）。
// 返回 { hasNav, navBlock, links:[{href, nav, ariaCurrent}], bodyClass, bodyAuth, refs }，
// 让「两页侧边栏结构一致」这类断言可以逐项比较，而不是各写一套正则。
function navFromHtml(html) {
    const navStart = html.indexOf('id="app-nav"');
    const navBlock = navStart < 0 ? '' : (() => {
        // 从 <aside 开始到它的 </aside> 结束
        const asideStart = html.lastIndexOf('<aside', navStart);
        const asideEnd = html.indexOf('</aside>', navStart);
        return asideStart < 0 || asideEnd < 0 ? '' : html.slice(asideStart, asideEnd + '</aside>'.length);
    })();
    const links = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(navBlock))) {
        const attrs = m[1];
        const nav = (attrs.match(/data-nav="([^"]*)"/) || [])[1];
        if (!nav) continue;
        links.push({
            href: (attrs.match(/href="([^"]*)"/) || [])[1] || null,
            nav,
            ariaCurrent: (attrs.match(/aria-current="([^"]*)"/) || [])[1] || null,
            // 侧边栏链接的文字在 .app-nav-text 里
            text: (m[2].match(/class="app-nav-text"[^>]*>([^<]*)</) || [])[1]
                || m[2].replace(/<[^>]*>/g, '').trim()
        });
    }
    const bodyTag = (html.match(/<body\b([^>]*)>/) || [])[1] || '';
    return {
        hasNav: navBlock.length > 0,
        navBlock,
        links,
        bodyClass: (bodyTag.match(/class="([^"]*)"/) || [])[1] || '',
        bodyAuth: (bodyTag.match(/data-auth="([^"]*)"/) || [])[1] || null,
        headScripts: [...(html.slice(0, html.indexOf('</head>')).matchAll(/<script\s+src="([^"]+)"><\/script>/g))].map(x => x[1]),
        headLinks: [...(html.slice(0, html.indexOf('</head>')).matchAll(/<link\b[^>]*href="([^"]+)"/g))].map(x => x[1])
    };
}

const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};

const katex = { render: (text, el) => { el._tex = text; el.textContent = text; } };

// 假的 fetch：/api/auth/me 返回一个学生，/api/attempts 记下来。
// 每个页面各自一个缓冲（bootPage 会把当前页的 buffer 换成新的），这样化简页和方程页的
// 上报不会混在同一个计数窗口里；apiCalls 始终保留全量历史，供化简页原有断言使用。
const apiCalls = [];
let apiSink = apiCalls;
const fakeUser = { id: 'u_test', name: '小明', role: 'student' };
const fetchStub = async (url, opts) => {
    const record = { url, opts: opts || {} };
    apiCalls.push(record);
    if (apiSink !== apiCalls) apiSink.push(record);
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
const PolyKey = 'poly_current_q:u_test';   // 与 practice.js 里的 `poly_current_q:` + 用户 id 一致
const FixedQuestion = { level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10' };
store.set(PolyKey, JSON.stringify(
    Object.assign({}, FixedQuestion, { startedAt: Date.now(), clientId: 'c_test' })
));

new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math', 'fetch',
    practiceCode + '\n')(fakeWindow, document, katex, localStorage, () => true,
    () => 0, () => { }, math, fetchStub);

const fails = [];
let checksRun = 0;   // 只在 UI_SMOKE_STATS=1 时汇报，默认输出不变
const check = (cond, msg) => { checksRun++; if (!cond) fails.push(msg); };
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
const KEY = PolyKey;

// 页面级软键盘夹具：数字/符号键 + x、y 两个字母斜体键 + 五个动作键。
// 化简页与方程页共用同一套按键（方程页会通过 extraKeys 再补一个 =），由下方
// 「对照 equations.html / practice.html 解析出的真实软键盘」的断言保证不跑偏。
const KEY_SPECS = [
    { name: 'k_7', val: '7' }, { name: 'k_8', val: '8' }, { name: 'k_9', val: '9' },
    { name: 'k_+', val: '+' }, { name: 'k_/', val: '/' },
    { name: 'k_4', val: '4' }, { name: 'k_5', val: '5' }, { name: 'k_6', val: '6' },
    { name: 'k_-', val: '-' }, { name: 'k_^2', val: '^2' },
    { name: 'k_1', val: '1' }, { name: 'k_2', val: '2' }, { name: 'k_3', val: '3' },
    { name: 'k_*', val: '*' }, { name: 'k_^3', val: '^3' },
    { name: 'k_0', val: '0' },
    { name: 'x_var', val: 'x', classes: 'var' }, { name: 'y_var', val: 'y', classes: 'var' },
    { name: 'k_(', val: '(' }, { name: 'k_)', val: ')' },
    { name: 'clear', action: 'clear', classes: 'action' },
    { name: 'backspace', action: 'backspace', classes: 'action' },
    { name: 'hint', action: 'hint', classes: 'action' },
    { name: 'giveup', action: 'giveup', classes: 'action' },
    { name: 'submit', action: 'submit', classes: 'submit' }
];
// 方程页多出来的那个键（data-val="="）
const EQ_EXTRA_KEY = { name: 'k_=', val: '=' };

// 通用的「开一页」：清空 DOM 桩与本地存货，按需预置缓存和夜间模式，
// 再执行页面脚本的 IIFE 并等它启动完成。化简页和方程页都走这里，保证两页在
// 同一套桩、同一套断言口径下比较。
async function bootPage(cfg) {
    const spec = cfg.keyboard || KEY_SPECS;
    katex.render = (value, el) => { el._tex = value; el.textContent = value; };   // 恢复正常的桩
    registry.length = 0;
    Object.keys(byId).forEach(k => delete byId[k]);
    store.clear();
    // 本页自己的 fetch 缓冲：页面脚本里的 fetch 用闭包捕获构造时的 apiSink，
    // 所以在 new Function 之前切换，这一页的所有请求就只落进 pageCalls。
    const pageCalls = [];
    apiSink = pageCalls;
    if (cfg.cached) {
        Object.keys(cfg.cached).forEach(k => store.set(k, String(cfg.cached[k])));
    }
    // 模拟 <head> 里那段主题初始化脚本：从 localStorage 恢复夜间模式
    const docEl = new El('html');
    const savedTheme = (cfg.opts && cfg.opts.theme) || null;
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
    const hints = mk('hint-display');
    const steps = mk('steps-display');
    // 侧边栏（app-nav）骨架：页面脚本按 id 取 #who / #theme-toggle / #logout，
    // 这些元素现在住在侧边栏脚部；#board-link 已改名 #nav-board（页面脚本取不到时会安全跳过）。
    // 这里只补节点防报错，不断言 app-nav.js 的行为（那是 nav.smoke.js 的活）。
    mk('app-nav', 'aside', 'app-nav');
    mk('nav-toggle', 'button');
    mk('nav-group-practice', 'button');
    mk('nav-sub-practice');
    mk('app-nav-backdrop');
    mk('who', 'span', 'app-nav-who');
    mk('nav-board', 'a', 'app-nav-link');
    mk('logout', 'button');
    const themeBtn = mk('theme-toggle', 'button');

    const keyboardEl = mk('keyboard');
    const freshKeys = {};
    function addKey(opts) {
        const el = mk('', 'div', 'key' + (opts.classes ? ' ' + opts.classes : ''));
        if (opts.val !== undefined) el.dataset.val = opts.val;
        if (opts.action) el.dataset.action = opts.action;
        keyboardEl.appendChild(el);
        freshKeys[opts.name] = el;
    }
    spec.forEach(addKey);

    // 事件处理里的异常要和真实浏览器一样「不打断页面」：记下来、返回 false，
    // 由测试在对应小节报告，而不是把整个测试进程带崩。
    const lastError = { value: null };
    const click = (name) => {
        if (!freshKeys[name]) throw new Error('键盘上没有 ' + name + ' 键');
        lastError.value = null;
        try {
            (keyboardEl.handlers.click || []).forEach(fn => fn({ target: freshKeys[name] }));
        } catch (e) {
            lastError.value = e;
        }
        return lastError.value === null;
    };
    const type = (text) => [...text].forEach(ch => {
        const name = ch === '=' ? 'k_=' : (ch === 'x' ? 'x_var' : (ch === 'y' ? 'y_var' : 'k_' + ch));
        if (!freshKeys[name]) throw new Error('键盘上没有 ' + ch);
        click(name);
    });

    const pageWindow = {
        onload: null,
        location: { replaced: null, replace(to) { this.replaced = to; } }
    };
    if (cfg.engine) pageWindow[cfg.engineGlobal] = cfg.engine;

    // 故障注入用例会主动让页面报错，用 silent 把页面的 console.error/warn 吞掉，
    // 免得测试输出里混进「初始化失败: simulated engine failure」这种我们制造出来的噪音。
    const realError = console.error;
    const realWarn = console.warn;
    if (cfg.silent) {
        console.error = () => { };
        console.warn = () => { };
    }

    new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math', 'fetch',
        cfg.code + '\n')(pageWindow, document, katex, localStorage, cfg.confirm || (() => true),
        () => 0, () => { }, math, fetchStub);

    try {
        await pageWindow.onload();
    } finally {
        console.error = realError;
        console.warn = realWarn;
    }
    await new Promise(r => setImmediate(r));
    const byClass = (sel) => (keyboardEl.children || []).filter(el => matches(el, sel));
    return {
        window: pageWindow, tabs, question, tag, input, feedback, hints, steps,
        keys: freshKeys, click, type, byClass, themeBtn, docEl,
        calls: pageCalls,
        lastError: () => lastError.value
    };
}

// 化简页（保持原有调用习惯：cached 为单题对象，存到 poly_current_q:u_test）
async function bootFreshPage(cached, opts) {
    return bootPage({
        code: practiceCode,
        engine: engine,
        engineGlobal: 'PolyEngine',
        keyboard: KEY_SPECS,
        cached: cached ? { [KEY]: JSON.stringify(cached) } : null,
        opts
    });
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
check(htmlKeys.filter(k => k.val).length === 20,
    '软键盘应有 20 个 data-val 键，实际 ' + htmlKeys.filter(k => k.val).length);
check(htmlKeys.filter(k => k.action).length === 5,
    '软键盘应有 5 个动作键（clear/backspace/hint/giveup/submit），实际 '
    + htmlKeys.filter(k => k.action).map(k => k.action).join(','));
// 20 个值键 + 5 个动作键 = 25 个键（解析范围现在完整包含 submit，submit 也算进动作键）
check(htmlKeys.length === 25, '软键盘应为 20 个值键 + 5 个动作键 = 25 个键，实际 ' + htmlKeys.length);
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

// ============================================================
// 下面是「一元一次方程」练习页
// ============================================================
// 
// 方程页和整式化简页是并列的两个页面（equations.html + practice-equations.js），
// 交互节奏、缓存、上报的形状都相同，只是题型、引擎和缓存键不同。所以这里复用上面
// 同一套 DOM 桩 / bootPage 工厂，只把「页面脚本 + 引擎 + 软键盘多一个 = 键」换掉，
// 保证两页是在同一套桩和同一套断言口径下比较的。

const eqAbs = (rel) => path.join(root, rel);

// 引擎和页面脚本都还在实现中：缺失时记成失败项，而不是让整个文件半路崩掉，
// 这样化简页那部分断言照样能跑、能看出「只有方程页没就绪」。
const readSrc = (rel) => {
    try { return fs.readFileSync(eqAbs(rel), 'utf8'); } catch (e) { return null; }
};
function loadEquationEngine() {
    try {
        const factory = require(eqAbs('frontend/js/equation-engine.js'));
        return { engine: factory(math, core), err: null };
    } catch (e) {
        return { engine: null, err: e };
    }
}
const equationCode = readSrc('frontend/js/practice-equations.js');
const equationsHtmlSrc = readSrc('frontend/equations.html');
const eqEngineLoad = loadEquationEngine();
const equationEngineErr = eqEngineLoad.err;

const EQ_KEY = 'eq_current_q:u_test';   // 与 practice-equations.js 里的 `eq_current_q:` + 用户 id 一致
// 固定方程：难度 2、不含分数（tags 为空），解是 x=4（左 2·4+3=11，右 4+7=11）。
// 换题后页面会随机抽新题，下面需要「真答案」的地方都从缓存里读当前题，避免用固定值硬套。
const FixedEq = { level: 2, question: '2x + 3 = x + 7', answer: 'x=4', tags: [] };

// 方程页的软键盘 = 化简页的 25 个键 + 一个 = 键
const EQ_KEY_SPECS = KEY_SPECS.concat([EQ_EXTRA_KEY]);

// 给引擎套一层计数壳：既不影响页面行为（返回值原样透传），又能在页面跑完后
// 核对「页面确实问了引擎」这类交叉证据（例如换题后缓存的题必须是引擎给出的答案形状）。
const eqCalls = {};
const equationEngine = equationEngineErr ? null : new Proxy(eqEngineLoad.engine, {
    get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return function (...args) {
            eqCalls[prop] = (eqCalls[prop] || 0) + 1;
            return value.apply(target, args);
        };
    }
});

const eqCheck = (cond, msg) => check(cond, '[方程页] ' + msg);
const eqNorm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
// 把「页面渲染出来的 LaTeX」还原成可比较的式子：
// 页面统一走引擎的 toLatexText，等号会渲染成 \;=\;，乘号渲染成 \cdot，分数渲染成 \dfrac{a}{b}。
// 比较时把这些排版糖一并去掉，只比数学内容（否则断言绑死在排版细节上）。
const eqTexNorm = (s) => String(s == null ? '' : s)
    .replace(/\\[;,!:]/g, '')          // \, \; \! \: 这类间距
    .replace(/\\cdot/g, '*')
    .replace(/\\left|\\right/g, '')
    .replace(/\\dfrac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    // 页面在「解析不了」时会退回纯文本，并把字母并置补成显式乘号（x5 -> x\cdot 5、xy -> x\cdot y）。
    // 比对数学内容时把这个补出来的乘号去掉，否则「学生写 x5」和「页面显示 x·5」永远对不上。
    .replace(/([a-z])\*([a-z0-9])/g, '$1$2');
// 直接问未包装的引擎判题（被包进 try 里：引擎半成品时会抛异常，不能把测试进程带崩）
const eqEvalRaw = (student, answer) => {
    if (!eqEngineLoad.engine) return { status: 'no-engine', msg: 'equation-engine 未加载' };
    try {
        const r = eqEngineLoad.engine.evaluateAnswer(student, answer);
        return r && typeof r === 'object' ? r : { status: 'bad-return', msg: String(r) };
    } catch (e) {
        return { status: 'throw', msg: e && e.message ? e.message : String(e) };
    }
};
// 把某一时刻起的 fetch 记录解析成上报 payload
const attemptsSince = (from) => apiCalls.slice(from)
    .filter(c => c.url === '/api/attempts')
    .map(c => { try { return JSON.parse(c.opts.body); } catch (e) { return null; } });

// 开一页方程页：复用上面的 bootPage，只换页面脚本 / 引擎 / 软键盘 / 缓存键。
// 同时往化简页的 poly_current_q 里放一个「哨兵」：方程页若误写/误清这个键，
// 哨兵就变了，下面的断言能抓到（两题型各留各的题，互不干扰）。
const PolySentinel = JSON.stringify({
    level: 3, question: '1/2(x + 4) - 3', answer: 'x/2-1', tags: ['fraction'],
    startedAt: Date.now(), clientId: 'c_poly_sentinel'
});
async function bootEquations(cached) {
    if (!equationCode || !equationEngine) return null;
    Object.keys(eqCalls).forEach(k => delete eqCalls[k]);
    const cachedMap = { [PolyKey]: PolySentinel };
    if (cached !== undefined) cachedMap[EQ_KEY] = JSON.stringify(cached);
    return bootPage({
        code: equationCode,
        engine: equationEngine,
        engineGlobal: 'EquationEngine',
        keyboard: EQ_KEY_SPECS,
        // 方程页的「看解析」会弹确认框：默认点「确定」（与化简页一致）
        confirm: () => true,
        cached: cachedMap
    });
}

// 缓存里当前那道题（页面每换一题都会写回缓存，是「页面认为的当前题」的可靠来源）
const cachedEqNow = () => {
    try { return JSON.parse(store.get(EQ_KEY)); } catch (e) { return null; }
};
// 缓存里这道题是否被页面「启动」过（写入了 clientId/startedAt）
const cachedEqIsLive = () => {
    const q = cachedEqNow();
    return !!(q && typeof q.clientId === 'string' && q.clientId && typeof q.startedAt === 'number');
};

if (!equationCode) eqCheck(false, '缺少 frontend/js/practice-equations.js，方程页交互无法冒烟');
if (!equationEngine) {
    eqCheck(false, 'equation-engine.js 加载失败：' + (equationEngineErr && equationEngineErr.message || '未知错误'));
}

if (equationCode && equationEngine) {
    // 页面/引擎还在实现中时，某个交互可能直接抛异常（例如引擎还没提供 evaluateAnswer）。
    // tryStep 把它记成一条带小节名的失败，后面的小节照常跑，方便一次看到所有没就绪的点。
    const tryStep = (label, fn) => {
        try { fn(); } catch (e) {
            eqCheck(false, label + ' 抛异常: ' + (e && e.message ? e.message : String(e)));
        }
    };
    // 临时诊断（UI_SMOKE_DEBUG=1 时打印，不影响断言）：把某个面板的行结构打出来
    const dumpRows = (label, el) => {
        if (!process.env.UI_SMOKE_DEBUG || !el) return;
        console.log('--- ' + label + ' children=' + (el.children ? el.children.length : 'n/a'));
        (el.children || []).forEach((row, i) => {
            console.log('  行' + i, JSON.stringify({
                cls: row.className,
                cells: (row.children || []).map(c => ({ cls: c.className, text: c.textContent, tex: c._tex }))
            }));
        });
    };

    // ---------- 1. 缓存题按原样渲染 / 难度高亮 / 初始面板状态 ----------
    // 记下启动前的 fetch 序号：化简页那几轮已经产生了很多 /api/attempts 记录，
    // 方程页的上报断言只统计这之后产生的，否则会混进化简页的记录。
    const eqStart = apiCalls.length;
    const eqPage = await bootEquations(Object.assign({}, FixedEq, {
        startedAt: Date.now() - 60 * 1000, clientId: 'c_eq_test'
    }));
    if (!eqPage) {
        eqCheck(false, '方程页启动失败（bootEquations 返回空）');
    } else if (/页面初始化失败/.test(eqPage.feedback.textContent || '')) {
        eqCheck(false, '方程页初始化失败: ' + eqPage.feedback.textContent);
    } else {
        const activeLevel = () => {
            const active = eqPage.tabs.filter(t => t.classList.contains('active'));
            return active.length === 1 ? active[0].dataset.level : 'active=' + active.length;
        };
        tryStep('初始渲染', () => {
            eqCheck(eqTexNorm(eqPage.question._tex).includes(eqTexNorm(FixedEq.question)),
                '应渲染缓存的方程题（含等号），实际: ' + eqPage.question._tex);
            eqCheck(activeLevel() === '2', '难度应高亮②（缓存的 level=2），实际 ' + activeLevel());
            eqCheck(eqPage.hints.hidden === true && eqPage.steps.hidden === true, '初始应隐藏提示与解析面板');
            eqCheck(eqPage.tag.hidden === true, '整数方程不应显示「分数」标签');
            eqCheck(eqPage.keys.submit.textContent === '提交答案',
                '提交键文案不对: ' + eqPage.keys.submit.textContent);
            eqCheck(eqPage.input.textContent === '请点击下方键盘输入',
                '输入区初始应是占位提示，实际: ' + eqPage.input.textContent);
            eqCheck(/学生/.test(document.getElementById('who').textContent), '顶部应显示当前学生');

            // 缓存必须按 eq_current_q:<uid> 这个键存，且页面要认「缓存的这道题就是当前题」
            // （缓存键写错/没读，题目就不会是题面上的 2x + 3 = x + 7）。
            // 同时断言方程页没有顺手去写化简页的 poly_current_q 键 —— 两题型各留各的题，
            // 这里用「化简页缓存里预先放一道化简题，方程页跑完它必须原封不动」来验证。
            eqCheck(cachedEqIsLive(), '加载后缓存应写回 eq_current_q:u_test（含 clientId/startedAt）');
            const polySnapshot = store.get(PolyKey);
            eqCheck(polySnapshot === PolySentinel, '方程页启动不应改写化简页的 poly_current_q 缓存，实际: ' + polySnapshot);
            check(cachedEqNow() && eqNorm(cachedEqNow().question) === eqNorm(FixedEq.question),
                '[方程页] 缓存里应仍是缓存的那道固定题，实际: ' + JSON.stringify(cachedEqNow()));
        });

        // ---------- 2. 「=」键输入 ----------
        tryStep('= 键', () => {
            eqPage.type('x=');
            eqCheck(eqTexNorm(eqPage.input._tex) === 'x=',
                '点 = 键应能输入等号，实际输入区: ' + eqPage.input._tex);
            eqPage.click('backspace');
            eqCheck(eqTexNorm(eqPage.input._tex) === 'x',
                '退格应能删掉等号，实际: ' + eqPage.input._tex);
            // 方程页只有 x，y 是误触：按 x 再按 y 不能静默渲染成并置字母「xy」（学生会看成乘积）。
            // 页面把这种情况渲染成 x\cdot y（显式乘号）即可，这里只断言「不是两个字母直接贴在一起」。
            eqPage.click('clear');
            eqPage.type('xy');
            const xyTex = String(eqPage.input._tex || '');
            eqCheck(!/^[a-zA-Z]{2}$/.test(xyTex.replace(/\s+/g, '')),
                '误按 y 后不应把输入渲染成字母并置（xy），实际: ' + xyTex);
            eqCheck(/cdot|[*·]/.test(xyTex) || xyTex.length > 2,
                '误按 y 后应能看出是两个量相乘（如 x\\cdot y），实际: ' + xyTex);
            eqPage.click('clear');
            eqCheck(eqPage.input.textContent === '请点击下方键盘输入',
                '清空后输入区应恢复占位提示，实际: ' + eqPage.input.textContent);
        });

        // ---------- 3. 答对：绿字 + 给过程 + 按钮变「下一题」 ----------
        tryStep('答对', () => {
            eqPage.click('clear');   // 从上一步的 xy 里恢复干净状态
            eqPage.type('x=4');
            eqCheck(eqTexNorm(eqPage.input._tex) === 'x=4',
                '输入 x=4 后应完整渲染，实际: ' + eqPage.input._tex);
            eqPage.click('submit');
            eqCheck(/正确/.test(eqPage.feedback.textContent),
                '方程答对应提示正确，实际: ' + eqPage.feedback.textContent);
            eqCheck(/var\(--ok\)/.test(eqPage.feedback.style.color || ''),
                '答对反馈应是绿色（var(--ok)），实际: ' + eqPage.feedback.style.color);
            eqCheck(eqPage.steps.hidden === false, '答对后也应展开完整过程');
            eqCheck(eqPage.keys.submit.textContent === '下一题' && eqPage.keys.submit.dataset.action === 'next',
                '答对后应停在本题等「下一题」，实际按钮: ' + eqPage.keys.submit.textContent);
            // 只取真正的步骤行（第 0 行是面板标题 div，不是 step-row）
            const okRows = eqPage.steps.children.filter(r => r.classList.contains('step-row'));
            dumpRows('答对后的 steps', eqPage.steps);
            eqCheck(okRows.length >= 2, '答对的过程应有至少 2 步，实际 ' + okRows.length);
            eqCheck(!okRows.some(r => r.classList.contains('step-mine')),
                '答对时不该出现「你的答案」对照行');
            eqCheck(eqTexNorm(cellTex(okRows[0], 1)) === eqTexNorm(FixedEq.question),
                '过程第一步应是原方程，实际: ' + cellTex(okRows[0], 1));
            eqCheck(eqTexNorm(cellTex(okRows[okRows.length - 1], 1)) === eqTexNorm(FixedEq.answer),
                '过程最后一步应是 x=4，实际: ' + cellTex(okRows[okRows.length - 1], 1));
        });

        // ---------- 4. 本题结束后键盘锁定 ----------
        tryStep('锁键盘', () => {
            const lockedInput = eqPage.input._tex;
            const lockedFb = eqPage.feedback.textContent;
            eqPage.click('k_5');
            eqPage.click('backspace');
            eqCheck(eqPage.input._tex === lockedInput && eqPage.feedback.textContent === lockedFb,
                '本题结束后键盘应被锁住（输入和反馈都不该被改动）');
        });

        // ---------- 5. 下一题：换题清面板、按钮复原、缓存换掉 ----------
        tryStep('下一题', () => {
            const oldQuestion = eqPage.question._tex;
            const oldCache = store.get(EQ_KEY);
            eqPage.click('submit');
            eqCheck(eqPage.question._tex !== oldQuestion, '点下一题应换新题');
            eqCheck(String(eqPage.question._tex || '').indexOf('=') !== -1, '新题也应是方程（带等号）');
            eqCheck(eqPage.steps.hidden === true && eqPage.hints.hidden === true, '换题后应清空提示与解析');
            eqCheck(eqPage.feedback.textContent === '', '换题后应清空反馈，实际: ' + eqPage.feedback.textContent);
            eqCheck(eqPage.input.textContent === '请点击下方键盘输入', '换题后输入区应恢复占位提示');
            eqCheck(eqPage.keys.submit.textContent === '提交答案' && eqPage.keys.submit.dataset.action === 'submit',
                '换题后按钮应复原');
            eqCheck(!!store.get(EQ_KEY) && store.get(EQ_KEY) !== oldCache, '换题后应把新题写回缓存');
            const newCache = cachedEqNow();
            eqCheck(!!newCache && /^x=-?\d+(\/\d+)?$/.test(newCache.answer || ''),
                '缓存里的新题答案应是 x=… 形状，实际: ' + (newCache && newCache.answer));
            eqCheck(!!newCache && newCache.level === 2, '换题应保持当前难度 2，实际: ' + (newCache && newCache.level));
            eqCheck((eqCalls.generateQuestion || 0) >= 1, '点下一题应走引擎出题（generateQuestion 未被调用）');
        });

        // 页面当前这道题的正确答案（换题后从缓存读，是最可靠的来源）
        const currentEqAnswer = () => (cachedEqNow() || {}).answer || '';
        const currentEqLevel = () => (cachedEqNow() || {}).level;

        // ---------- 6. 错两次：第一次只提示、第二次给完整过程 + 「你的答案」对照行 ----------
        let firstWrongEntry = null;   // 供第 7、8 节核对上报
        tryStep('错两次', () => {
            const right = currentEqAnswer();
            const rightNum = Number(String(right).split('=')[1]);
            const bad1 = rightNum === 5 ? 6 : 5;              // 和正确答案不同
            const bad2 = bad1 === 9 ? 8 : 9;                  // 两次错得也不一样
            eqPage.type('x' + bad1);
            eqCheck(eqTexNorm(eqPage.input._tex) === 'x' + bad1,
                '应能输入错误答案 x=' + bad1 + '，实际: ' + eqPage.input._tex);
            eqPage.click('submit');
            eqCheck(/还有 1 次机会/.test(eqPage.feedback.textContent),
                '第一次错应有「还有 1 次机会」提示，实际: ' + eqPage.feedback.textContent);
            eqCheck(eqPage.steps.hidden === true, '第一次错不应直接给解析');
            eqCheck(eqPage.keys.submit.dataset.action === 'submit', '第一次错后仍应能继续提交');
            eqPage.click('clear');
            eqPage.type('x' + bad2);
            eqPage.click('submit');
            eqCheck(eqPage.steps.hidden === false, '错两次应展开完整过程');
            eqCheck(/错了两次/.test(eqPage.feedback.textContent), '二次错反馈不对: ' + eqPage.feedback.textContent);
            eqCheck(eqPage.keys.submit.textContent === '下一题', '错两次后应变成下一题');
            const wrongRows = eqPage.steps.children.filter(r => r.classList.contains('step-row'));
            const wrongMine = wrongRows[0];
            eqCheck(!!(wrongMine && wrongMine.classList.contains('step-mine')),
                '错两次时应显示「你的答案」对照行');
            eqCheck(cellText(wrongMine, 0) === '你的答案', '对照行标签不对: ' + cellText(wrongMine, 0));
            eqCheck(eqTexNorm(cellTex(wrongMine, 1)) === 'x' + bad2,
                '对照行应显示学生原答案 x' + bad2 + '，实际: ' + cellTex(wrongMine, 1));
            // 过程渲染出来的最后一步，拿引擎自己的判题再验一遍：页面显示的「标准答案」
            // 和引擎判的不是一回事，就是典型的分支实现不一致。
            // 注意比较的是「去掉 LaTeX 排版记号后」的式子（页面把 = 渲染成 \;=\;），
            // 但也不能喂 LaTeX 给引擎判 —— 引擎吃的是纯文本 x=-6，所以先还成纯文本再判。
            const lastStepTex = cellTex(wrongRows[wrongRows.length - 1], 1);
            const lastStepPlain = String(lastStepTex == null ? '' : lastStepTex)
                .replace(/\\[;,!:]/g, '').replace(/\\cdot/g, '*').replace(/\s+/g, '');
            const probe = eqEvalRaw(lastStepPlain, right);
            eqCheck(probe.status === 'correct',
                '过程末步 ' + lastStepPlain + ' 应能被引擎判为 correct（对照答案 ' + right + '），实际 ' + probe.status);
            firstWrongEntry = { answer: right, level: currentEqLevel(), student: 'x' + bad2 };
        });

        // ---------- 7. 看解析：完整过程 + 对照行 + 锁键盘 ----------
        let giveUpEntry = null;
        tryStep('看解析', () => {
            if (!firstWrongEntry) throw new Error('前置的「错两次」未完成，跳过');
            eqPage.click('submit');   // 错两次 → 下一题（换题后缓存里才是「这一题」的答案）
            eqCheck(eqPage.steps.hidden === true, '错两次后点下一题应清空解析面板');
            const right = currentEqAnswer();   // 必须在换题之后再读
            giveUpEntry = { answer: right, student: 'x=99' };
            eqPage.type('x=99');
            eqPage.click('giveup');
            eqCheck(eqPage.steps.hidden === false, '看解析应展开完整过程');
            eqCheck(eqPage.keys.submit.textContent === '下一题',
                '看解析后应停在本题等「下一题」，实际: ' + eqPage.keys.submit.textContent);
            const rows = eqPage.steps.children.filter(r => r.classList.contains('step-row'));
            const mine = rows[0];
            eqCheck(!!(mine && mine.classList.contains('step-mine')), '看解析时应显示「你的答案」对照行');
            eqCheck(eqTexNorm(cellTex(mine, 1)) === 'x=99', '对照行应显示学生原答案 x=99，实际: ' + cellTex(mine, 1));
            eqCheck(eqTexNorm(cellTex(rows[rows.length - 1], 1)) === eqTexNorm(right),
                '看解析时过程最后一步应是标准答案 ' + right + '，实际: ' + cellTex(rows[rows.length - 1], 1));
            eqCheck(eqTexNorm(eqPage.input._tex) === eqTexNorm(right),
                '看解析后输入区应显示标准答案，实际: ' + eqPage.input._tex);
            const locked = eqPage.input._tex;
            eqPage.click('k_5');
            eqCheck(eqPage.input._tex === locked, '看解析后键盘应被锁住');
        });

        // ---------- 8. 上报：topic=equation + question/answer/level/tags 正确 ----------
        await new Promise(r => setImmediate(r));
        try {
            // 只统计方程页这一页自己的请求（bootPage 的 calls 缓冲），且必须全是方程类上报
            const posts = eqPage.calls
                .filter(c => c.url === '/api/attempts')
                .map(c => { try { return JSON.parse(c.opts.body); } catch (e) { return null; } });
            const expectCount = firstWrongEntry && giveUpEntry ? 3 : (firstWrongEntry ? 2 : (giveUpEntry ? 1 : 0));
            eqCheck(posts.length === expectCount, expectCount ? ('三题应各上报 ' + expectCount + ' 次，实际 ' + posts.length)
                : '上报断言依赖前置交互，未能触发');
            eqCheck(posts.every(Boolean), '上报内容应是 JSON');
            eqCheck(posts.every(p => p && p.topic === 'equation'), '每条上报都应带 topic:"equation"，实际: '
                + JSON.stringify(posts.map(p => p && p.topic)));
            if (posts[0]) {
                eqCheck(eqNorm(posts[0].question) === eqNorm(FixedEq.question),
                    '缓存的固定题应上报原题面，实际: ' + posts[0].question);
                eqCheck(eqNorm(posts[0].answer) === eqNorm(FixedEq.answer),
                    '缓存的固定题应上报答案 x=4，实际: ' + posts[0].answer);
                eqCheck(posts[0].result === 'correct' && posts[0].revealed === false, '答对应记 correct 且未 revealed');
                eqCheck(eqNorm(posts[0].studentAnswer) === 'x=4', '答对应带学生答案 x=4');
                eqCheck(posts[0].usedHint === false, '没点提示时 usedHint 应为 false');
                eqCheck(posts[0].clientId === 'c_eq_test', '应沿用缓存题里的 clientId');
            }
            eqCheck(posts.every(p => p && p.number === undefined),
                '上报不应带 number 字段（契约字段是 question/answer/tags/level/topic）');
            eqCheck(posts.every(p => p && p.level === 2), '应带难度 level=2');
            eqCheck(posts.every(p => p && Array.isArray(p.tags)), '上报应带 tags 数组');
            eqCheck(posts[0] && posts[0].tags.length === 0, '整数方程标签应为空数组');
            eqCheck(posts.every(p => p && typeof p.ms === 'number' && p.ms >= 0), '上报应带耗时 ms');
            // 换题后那道题的两次错误应各有 1 条：第一次不 revealed、第二次 revealed 且不是 gaveUp
            const wrongPosts = posts.filter(p => p && p.result === 'wrong');
            if (firstWrongEntry) {
                eqCheck(wrongPosts.length >= 1, '错两次至少应上报 1 条');
                const last = wrongPosts[0];
                eqCheck(last && last.revealed === true, '错两次应记 revealed（看到了完整过程）');
                eqCheck(last && last.gaveUp === false, '错两次被动给解析不应记 gaveUp');
                eqCheck(last && eqNorm(last.studentAnswer) === firstWrongEntry.student,
                    '错两次上报应带学生原答案 ' + firstWrongEntry.student + '，实际: ' + (last && last.studentAnswer));
            }
            if (giveUpEntry) {
                const gu = wrongPosts.find(p => p && p.gaveUp === true);
                eqCheck(!!gu, '看解析应上传一条 gaveUp=true 的记录');
                eqCheck(gu && gu.revealed === true, '看解析应记 revealed');
                eqCheck(gu && eqNorm(gu.studentAnswer) === 'x=99', '看解析应带上学生原答案 x=99');
            }
        } catch (e) {
            eqCheck(false, '上报 抛异常: ' + (e && e.message ? e.message : String(e)));
        }

        // ---------- 9. 提示：方程思路（移项/变号/合并同类项），不直接给答案 ----------
        const hintPage = await bootEquations(Object.assign({}, FixedEq, {
            startedAt: Date.now(), clientId: 'c_eq_hint'
        }));
        if (!hintPage) eqCheck(false, '提示用例：方程页启动失败');
        else {
            hintPage.click('hint');
            eqCheck(hintPage.hints.hidden === false, '点提示后面板应展开');
            eqCheck(hintPage.hints.children.length === 2, '提示面板应含标题 + 列表');
            const hintItems = hintPage.hints.children.length > 1 ? hintPage.hints.children[1].children : [];
            eqCheck(hintItems.length >= 2, '方程题提示条目应 >= 2，实际 ' + hintItems.length);
            const hintText = hintItems.map(li => String(li.textContent)).join(' | ');
            eqCheck(/移(项|到)/.test(hintText), '方程提示应讲到「移项」，实际: ' + hintText);
            eqCheck(/变号/.test(hintText), '方程提示应讲到移项要「变号」，实际: ' + hintText);
            eqCheck(/合并同类项|化系数为一/.test(hintText),
                '方程提示应讲到「合并同类项」或「化系数为一」，实际: ' + hintText);
            eqCheck(!/x\s*=\s*4/.test(hintText), '提示不应直接给出答案 x=4，实际: ' + hintText);
            // 重复点提示：不能重新渲染（只比数量抓不到「重建了一遍但数量一样」的情况，
            // 所以记住标题节点的身份 —— 重新渲染会 createElement 一个新节点，引用就变了）
            const hintTitleBefore = hintPage.hints.children[0];
            const hintListBefore = hintPage.hints.children[1];
            const hintCount = hintPage.hints.children.length;
            hintPage.click('hint');
            eqCheck(hintPage.hints.children.length === hintCount, '重复点提示不应重复展开');
            eqCheck(hintPage.hints.children[0] === hintTitleBefore && hintPage.hints.children[1] === hintListBefore,
                '重复点提示不应重建提示节点（应直接忽略第二次点击）；若这里是新节点，说明 hintUsed 防重入失效');
            // 看了提示再交卷：上报 usedHint 应为 true
            const beforeHintPost = apiCalls.length;
            hintPage.type('x=4');
            hintPage.click('submit');
            await new Promise(r => setImmediate(r));
            const hintPosts = attemptsSince(beforeHintPost);
            eqCheck(hintPosts.length === 1 && hintPosts[0] && hintPosts[0].usedHint === true,
                '看过提示再交卷，上报 usedHint 应为 true');
        }

        // ---------- 10. unmerged（同解但没化系数为一）走「给过程并结束本题」分支 ----------
        // 引擎口径：2x=8 与 x=4 同解 → unmerged。页面必须按「没完成」登记并结束本题，
        // 不能当成普通错误继续消耗「还有 1 次机会」。
        const unmergedPage = await bootEquations(Object.assign({}, FixedEq, {
            startedAt: Date.now(), clientId: 'c_eq_um'
        }));
        if (!unmergedPage) eqCheck(false, 'unmerged 用例：方程页启动失败');
        else {
            const beforeUm = apiCalls.length;
            unmergedPage.type('2x=8');
            unmergedPage.click('submit');
            eqCheck(/var\(--warn\)/.test(unmergedPage.feedback.style.color || ''),
                'unmerged 反馈应是黄色（var(--warn)），实际: ' + unmergedPage.feedback.style.color);
            eqCheck(unmergedPage.steps.hidden === false, 'unmerged 应展开完整过程');
            eqCheck(unmergedPage.keys.submit.textContent === '下一题', 'unmerged 后应停在本题等「下一题」');
            const umRows = unmergedPage.steps.children.filter(r => r.classList.contains('step-row'));
            const umMine = umRows[0];
            eqCheck(!!(umMine && umMine.classList.contains('step-mine')),
                'unmerged 应显示「你的答案」对照行');
            eqCheck(eqTexNorm(cellTex(umMine, 1)) === '2x=8', '对照行应显示 2x=8，实际: ' + cellTex(umMine, 1));
            await new Promise(r => setImmediate(r));
            const umPosts = attemptsSince(beforeUm);
            eqCheck(umPosts.length === 1 && umPosts[0] && umPosts[0].result === 'unmerged'
                && eqNorm(umPosts[0].studentAnswer) === '2x=8',
                'unmerged 应上报 result=unmerged + 学生原答案，实际: ' + JSON.stringify(umPosts[0] && umPosts[0].result));
            eqCheck(umPosts[0] && umPosts[0].topic === 'equation', 'unmerged 上报也应带 topic:"equation"');
        }

        // ---------- 11. 引擎出题失败时页面应给可见错误、不整页崩 ----------
        // 故障注入：故意让引擎出题抛错，验证页面走 showBootError 分支而不是白屏。
        // silent 会临时吞掉页面脚本自己的 console.error/warn，避免测试输出里出现吓人的
        // 「初始化失败: simulated engine failure」——那是我们主动注入的，不是真故障。
        const brokenEngine = Object.assign({}, eqEngineLoad.engine, {
            generateQuestion: () => { throw new Error('simulated engine failure'); }
        });
        const brokenPage = await bootPage({
            code: equationCode,
            engine: brokenEngine,
            engineGlobal: 'EquationEngine',
            keyboard: EQ_KEY_SPECS,
            confirm: () => true,
            silent: true,
            cached: null
        }).catch(() => null);
        eqCheck(!!brokenPage, '引擎出题抛错时页面不应把异常抛出去');
        if (brokenPage) {
            eqCheck(/失败/.test(brokenPage.feedback.textContent || ''),
                '引擎出题失败时应给出可见错误提示，实际: ' + brokenPage.feedback.textContent);
        }
    }
}

// ---------- 方程页静态夹具（直接读 equations.html） ----------
// equationsHtmlSrc / equationCode / equationEngine 在方程页交互那一段开头已经读好/加载好了
if (!equationsHtmlSrc) {
    eqCheck(false, '缺少 frontend/equations.html');
} else {
    // head 里按顺序引入 math-core → poly-tree → equation-engine，body 末尾再引页面脚本
    const headEnd = equationsHtmlSrc.indexOf('</head>');
    const headBlock = headEnd < 0 ? '' : equationsHtmlSrc.slice(0, headEnd);
    const headScripts = [...headBlock.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
    const need = ['js/math-core.js', 'js/poly-tree.js', 'js/equation-engine.js'];
    const positions = need.map(s => headScripts.indexOf(s));
    eqCheck(positions.every(p => p >= 0),
        'equations.html 的 <head> 应引入 ' + need.join(' / ') + '，实际: ' + headScripts.join(', '));
    eqCheck(positions.every((p, i) => i === 0 || p > positions[i - 1]),
        '引擎脚本应按 math-core → poly-tree → equation-engine 的顺序加载，实际: ' + headScripts.join(', '));
    const mathJsPos = headScripts.indexOf('vendor/math.js');
    eqCheck(mathJsPos >= 0 && mathJsPos < positions[0], 'math.js 应在 math-core.js 之前加载');
    const katexPos = headScripts.indexOf('vendor/katex/katex.min.js');
    eqCheck(katexPos >= 0 && katexPos < positions[0], 'katex.min.js 应在 math-core.js 之前加载');
    const allScripts = [...equationsHtmlSrc.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
    eqCheck(allScripts.indexOf('js/practice-equations.js') > allScripts.indexOf('js/equation-engine.js'),
        'practice-equations.js 应在 equation-engine.js 之后加载（body 末尾）');
    eqCheck(/href="vendor\/katex\/katex\.min\.css"/.test(headBlock) && /href="css\/practice\.css"/.test(headBlock),
        'equations.html 应复用 practice.css 与 KaTeX 样式');

    // 内联脚本只允许「夜间模式」那一段
    const inlineScripts = [...equationsHtmlSrc.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1])
        .filter(code => code.trim().length > 0);
    eqCheck(inlineScripts.length === 1,
        'equations.html 只应有 1 段内联脚本（夜间模式），实际 ' + inlineScripts.length + ' 段');
    const inline = inlineScripts.join('\n');
    eqCheck(/getItem\s*\(\s*['"]poly-theme['"]\s*\)/.test(inline),
        '内联脚本应读取 poly-theme（首帧前恢复夜间模式）');
    eqCheck(/setAttribute\s*\(\s*['"]data-theme['"]/.test(inline),
        '内联脚本应把 data-theme 挂到 <html> 上，避免先闪白底');
    eqCheck(!/generateQuestion|evaluateAnswer|buildSteps|hintsFor|fetch\s*\(|localStorage\.setItem/.test(inline),
        '夜间模式内联脚本不应涉及出题/判题/网络/写缓存逻辑');
    eqCheck(!/document\.getElementById|document\.querySelector/.test(inline),
        'equations.html 内联脚本不应操作题目区 DOM（交互应在 practice-equations.js）');
}

// ---------- 两页软键盘对照：equations.html = practice.html + '=' ----------
// （软键盘解析用文件前部共用的 keysFromHtml，两页走完全相同的解析口径）
if (equationsHtmlSrc) {
    let eqHtmlKeys = [];
    let eqParseErr = null;
    try {
        eqHtmlKeys = keysFromHtml(equationsHtmlSrc, 'equations.html');
    } catch (e) {
        eqParseErr = e;
    }
    eqCheck(!eqParseErr, 'equations.html 软键盘解析失败: ' + (eqParseErr && eqParseErr.message));
    if (!eqParseErr) {
        const uniq = (arr) => [...new Set(arr)].sort();
        const polyValSet = uniq(htmlKeys.filter(k => k.val).map(k => k.val));
        const eqValSet = uniq(eqHtmlKeys.filter(k => k.val).map(k => k.val));
        const missing = polyValSet.filter(v => !eqValSet.includes(v));
        const extra = eqValSet.filter(v => !polyValSet.includes(v));
        eqCheck(missing.length === 0 && extra.join(',') === '=',
            '方程页 data-val 集合应正好是化简页的集合 + "="，缺: [' + missing.join(',') + '] 多: [' + extra.join(',') + ']'
            + '（方程页实际: ' + eqValSet.join(',') + '）');
        eqCheck(eqHtmlKeys.filter(k => k.val === '=').length === 1, '方程页应正好有一个 = 键');
        // 动作键集合完全一致：clear/backspace/hint/giveup/submit。
        // 注意 = 键可能带 action 样式类但没有 data-action；按 data-action 比较才是真正「有行为的键」。
        const polyActions = uniq(htmlKeys.map(k => k.action).filter(Boolean));
        const eqActions = uniq(eqHtmlKeys.map(k => k.action).filter(Boolean));
        eqCheck(polyActions.join(',') === eqActions.join(','),
            '方程页动作键应和化简页完全一致，化简页: ' + polyActions.join(',')
            + '，方程页: ' + eqActions.join(','));
        eqCheck(polyActions.join(',') === 'backspace,clear,giveup,hint,submit',
            '化简页动作键应是 clear/backspace/hint/giveup/submit，实际: ' + polyActions.join(','));
        eqCheck(uniq(eqHtmlKeys.filter(k => k.classes.split(/\s+/).includes('submit')).map(k => k.action)).join(',') === 'submit',
            '方程页应有「提交答案」键（class="key submit"，data-action="submit"）：'
            + 'submit 类的键实际 data-action = [' + eqHtmlKeys.filter(k => k.classes.split(/\s+/).includes('submit'))
                .map(k => k.action).join(',') + ']');
        // 变量斜体键同样是 x、y
        eqCheck(uniq(eqHtmlKeys.filter(k => /\bvar\b/.test(k.classes)).map(k => k.val)).join(',') === 'x,y',
            '方程页带数学斜体的键应正好是 x、y');
        eqCheck(eqHtmlKeys.filter(k => k.action === 'clear').length === 1 &&
            eqHtmlKeys.filter(k => k.action === 'backspace').length === 1 &&
            eqHtmlKeys.filter(k => k.action === 'hint').length === 1 &&
            eqHtmlKeys.filter(k => k.action === 'giveup').length === 1,
            '方程页应保留清空/退格/提示/看解析四个动作键');
        // 顶栏互链已换成左侧常驻侧边栏，这里改为对侧边栏的检查（见下方「侧边栏」小节）
        eqCheck(/id="question-display"/.test(equationsHtmlSrc), 'equations.html 应有题目区 #question-display');
        eqCheck(/id="input-display"/.test(equationsHtmlSrc) && /id="feedback-display"/.test(equationsHtmlSrc)
            && /id="hint-display"/.test(equationsHtmlSrc) && /id="steps-display"/.test(equationsHtmlSrc),
        'equations.html 应保留输入/反馈/提示/解析四个面板的 id（与化简页一致）');
        eqCheck(/解方程/.test(equationsHtmlSrc), 'equations.html 题目前应有「解方程」前缀，帮学生分清题型');
    }
}

// ============================================================
// 侧边栏夹具：两页共用同一段 app-nav 结构
// ============================================================
// 页面结构从「顶部横向互链」换成了「左侧常驻侧边栏」，这里逐页检查：
// 引用 app-nav.css / app-nav.js、body 上的 nav-layout、三个导航入口及当前页高亮。
// 注意：只查结构（谁链谁、谁被标当前页），不查 app-nav.js 的交互行为 —— 那是 nav.smoke.js 的事。
const PAGES = [
    { file: 'practice.html', html: practiceHtml, here: 'simplify', hereHref: 'practice.html', label: '化简页', script: 'js/practice.js' },
    { file: 'equations.html', html: equationsHtmlSrc, here: 'equation', hereHref: 'equations.html', label: '方程页', script: 'js/practice-equations.js' }
];
const NAV_TARGETS = [
    { nav: 'simplify', href: 'practice.html', label: '整式化简' },
    { nav: 'equation', href: 'equations.html', label: '一元一次方程' },
    { nav: 'board', href: 'teacher.html', label: '看板' }
];

PAGES.forEach(page => {
    if (!page.html) {
        eqCheck(false, '缺少 frontend/' + page.file + '，侧边栏检查无法进行');
        return;
    }
    const nav = navFromHtml(page.html);
    const tag = '[' + page.label + '侧边栏] ';

    // 1. 资源引用：样式和脚本都要引，否则侧边栏在页面上是不可用 / 不可交互的
    eqCheck(nav.headLinks.includes('css/app-nav.css'),
        tag + '应在 <head> 引用 css/app-nav.css，实际: ' + nav.headLinks.join(', '));
    eqCheck(/<script\s+src="js\/app-nav\.js"><\/script>/.test(page.html),
        tag + '应引用 js/app-nav.js');
    // 侧边栏脚本要在页面脚本之前加载（页面脚本启动时可能依赖侧边栏已就位）
    const navJsPos = page.html.indexOf('js/app-nav.js');
    const pageScript = page.here === 'simplify' ? 'js/practice.js' : 'js/practice-equations.js';
    eqCheck(navJsPos >= 0 && page.html.indexOf(pageScript) > navJsPos,
        tag + 'app-nav.js 应在 ' + pageScript + ' 之前加载');

    // 2. body 上挂布局类和登录态标记（app-nav.js 按 data-auth 决定是否请求 /api/auth/me）
    eqCheck(nav.bodyClass.split(/\s+/).includes('nav-layout'),
        tag + '<body> 应有 class="nav-layout"，实际: ' + nav.bodyClass);
    eqCheck(nav.bodyAuth === 'app',
        tag + '<body> 应有 data-auth="app"（页面内应用页，侧边栏要请求登录态），实际: ' + nav.bodyAuth);

    // 3. 侧边栏本体存在，且三个入口齐全、href 指向正确页面
    eqCheck(nav.hasNav, tag + '应有 <aside id="app-nav">');
    const byNav = {};
    nav.links.forEach(l => { byNav[l.nav] = l; });
    NAV_TARGETS.forEach(t => {
        const link = byNav[t.nav];
        eqCheck(!!link, tag + '缺少 data-nav="' + t.nav + '" 的入口（实际只有: '
            + nav.links.map(l => l.nav).join(',') + '）');
        if (!link) return;
        eqCheck(link.href === t.href,
            tag + 'data-nav="' + t.nav + '" 应链到 ' + t.href + '，实际: ' + link.href);
        eqCheck(String(link.text).length > 0, tag + 'data-nav="' + t.nav + '" 应有可读文字');
        // 只查「长度 > 0」不够：.app-nav-text 空了会退回图标字符（'∑' / '='），文字其实已经没了。
        // 这里直接查链接文字里有没有可读的汉字，图标字符和纯符号都不算。
        eqCheck(/[\u4e00-\u9fa5]/.test(String(link.text)),
            tag + 'data-nav="' + t.nav + '" 的文字应是可读中文（不能只有图标），实际: '
            + JSON.stringify(link.text));
    });
    // 不允许出现重复入口（同一个 data-nav 出现两次，高亮和禁用逻辑都会乱）
    const navNames = nav.links.map(l => l.nav);
    eqCheck(navNames.length === new Set(navNames).size,
        tag + 'data-nav 入口不应重复，实际: ' + navNames.join(','));

    // 4. 当前页高亮：本页对应的那个带 aria-current="page"，另外两个都不带。
    //    这是「以后加页面忘了标当前页」的守卫 —— 两页都要查，且必须互为镜像。
    const current = nav.links.filter(l => l.ariaCurrent === 'page');
    eqCheck(current.length === 1,
        tag + '应正好有 1 个入口标 aria-current="page"，实际 ' + current.length
        + ' 个: ' + current.map(l => l.nav).join(','));
    eqCheck(current.length === 1 && current[0].nav === page.here,
        tag + '当前页高亮应标在 data-nav="' + page.here + '" 上，实际标在: '
        + current.map(l => l.nav).join(',') || '(无)');
    nav.links.filter(l => l.nav !== page.here).forEach(l => {
        eqCheck(l.ariaCurrent !== 'page',
            tag + '非当前页入口 data-nav="' + l.nav + '" 不应带 aria-current="page"');
    });

    // 5. 顶栏互链已删除、旧 id 已改名：留着会导致「点了没反应」或死链
    eqCheck(!/id="board-link"/.test(page.html),
        tag + '旧的 #board-link 应已改名为 #nav-board（页面脚本取不到会安全跳过）');
    eqCheck(/id="nav-board"/.test(page.html), tag + '应有 #nav-board 看板入口');
});

// 四个页面的侧边栏是同一段结构复制过去的（最容易出现「改了一页忘另一页」）。
// 但「逐字一致」不能字面比：每页要标自己的 aria-current="page"，高亮位置本来就不同。
// 正确的口径是「去掉 aria-current 之后逐字一致」—— 这样任何一处漏改（少个入口、
// 文字被改、忘记加 hidden、品牌链接指错页）都会被发现，而正确的高亮差异不会被误报。
{
    const navRaw = (html) => {
        const s = html.indexOf('id="app-nav"');
        if (s < 0) return null;
        const a = html.lastIndexOf('<aside', s);
        const e = html.indexOf('</aside>', s);
        return a < 0 || e < 0 ? null : html.slice(a, e + '</aside>'.length);
    };
    // 去掉 aria-current="page"（含多余空白），再比结构内容。
    // 刻意忽略行首缩进和空行：equations.html 整段多缩进 4 格、换行风格也不同（LF vs CRLF），
    // 那是格式化差异，不是缺陷；这条断言要抓的是「少个入口 / 文字被改 / 忘了 hidden」这类真问题。
    const normalizeNav = (block) => block
        .replace(/\s+aria-current="page"/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n');

    const teacherHtmlPath = path.join(root, 'frontend', 'teacher.html');
    const teacherSrc = fs.existsSync(teacherHtmlPath) ? fs.readFileSync(teacherHtmlPath, 'utf8') : null;
    const NAV_PAGES = [
        { file: 'practice.html', html: practiceHtml, here: 'simplify' },
        { file: 'equations.html', html: equationsHtmlSrc, here: 'equation' },
        { file: 'teacher.html', html: teacherSrc, here: 'board' },
        { file: 'index.html', html: readSrc('frontend/index.html'), here: null }   // 登录页不属于任何练习入口，不该标高亮
    ];

    const base = navRaw(practiceHtml);
    eqCheck(!!base, '[侧边栏] practice.html 里应能取到 app-nav 块');
    if (base) {
        const baseNorm = normalizeNav(base);
        NAV_PAGES.forEach(p => {
            if (!p.html) return;   // 页面不存在的情况由各自的套件负责
            const block = navRaw(p.html);
            if (!block) { eqCheck(false, '[侧边栏] ' + p.file + ' 里应能取到 app-nav 块'); return; }
            eqCheck(normalizeNav(block) === baseNorm,
                '[侧边栏] ' + p.file + ' 的侧边栏应与 practice.html 逐字一致（仅 aria-current 高亮位置可不同）'
                + '——四个页面共用同一段结构，这里不同就说明有一页漏改了');
        });

        // 登录页底部多一个「登录」按钮（访客态由 app-nav.js 显露），其余页面也要有且默认隐藏，
        // 否则已登录用户会看到一个多余的「登录」入口
        NAV_PAGES.forEach(p => {
            if (!p.html) return;
            const block = navRaw(p.html);
            eqCheck(/id="nav-login"/.test(block),
                '[侧边栏] ' + p.file + ' 应有 #nav-login（底部登录入口，四个页面结构一致）');
            const loginTag = (block.match(/<a\b[^>]*id="nav-login"[^>]*>/) || [''])[0];
            eqCheck(/\bhidden\b/.test(loginTag),
                '[侧边栏] ' + p.file + ' 的 #nav-login 默认应带 hidden（由 app-nav.js 在访客态显露），实际: '
                + JSON.stringify(loginTag));
            // 品牌链接四个页面统一指向 index.html
            const brandHref = (block.match(/class="app-nav-brand"\s+href="([^"]+)"/) || [])[1]
                || (block.match(/<a\b[^>]*app-nav-brand[^>]*>/) || [''])[0].match(/href="([^"]+)"/)?.[1];
            eqCheck(brandHref === 'index.html',
                '[侧边栏] ' + p.file + ' 的品牌链接应指向 index.html，实际: ' + brandHref);
        });
    }
}

// 两页侧边栏必须完全一致（同一段结构复制到每个页面，最容易出现「改了一页忘另一页」）
if (equationsHtmlSrc) {
    const a = navFromHtml(practiceHtml);
    const b = navFromHtml(equationsHtmlSrc);
    const shape = (n) => n.links.map(l => l.nav + '→' + l.href).sort().join(' | ');
    eqCheck(shape(a) === shape(b),
        '[侧边栏] 两页的导航入口应完全一致，化简页: ' + shape(a) + '，方程页: ' + shape(b));
    // 高亮必须互为镜像：化简页高亮 simplify、方程页高亮 equation
    const currentOf = (n) => (n.links.find(l => l.ariaCurrent === 'page') || {}).nav;
    eqCheck(currentOf(a) === 'simplify' && currentOf(b) === 'equation',
        '[侧边栏] 两页当前页高亮应互为镜像（化简页=simplify、方程页=equation），实际: '
        + currentOf(a) + ' / ' + currentOf(b));
}

// 6. keysFromHtml 的解析前提：id="keyboard" 之后第一个 <script> 必须在软键盘**全部按键之后**。
//    解析区间就截到这个 <script>，一旦有人把脚本挪进键盘块（或又在键盘后面塞一段脚本），
//    软键盘解析就会少键，而「动作键一致」这类断言会悄悄失效 —— 这条把它钉死。
//    注意：侧边栏改造后，键盘后第一个脚本是 js/app-nav.js（页面脚本在它后面），
//    所以预期值随页面而异，但「必须晚于最后一个按键」这个前提不变。
PAGES.forEach(page => {
    if (!page.html) return;
    const kStart = page.html.indexOf('id="keyboard"');
    if (kStart < 0) {
        eqCheck(false, '[' + page.label + '] 找不到 id="keyboard"');
        return;
    }
    const firstScript = page.html.indexOf('<script', kStart);
    // 键盘块的真正结尾：键盘之后第一个 </div> 之后紧接 </main>（键盘是 container 的最后一个子节点）
    const keyboardClose = page.html.indexOf('</main>', kStart);
    const lastKey = page.html.indexOf('data-action="submit"', kStart);
    const scriptSrc = firstScript < 0 ? null
        : ((page.html.slice(firstScript).match(/<script\s+src="([^"]+)"/) || [])[1] || '(内联脚本)');
    // 用 submit 键的真实位置比较：截断点必须落在最后一个按键之后
    eqCheck(firstScript > lastKey,
        '[' + page.label + '] id="keyboard" 之后第一个 <script> 必须晚于提交键，'
        + '否则 keysFromHtml 的解析区间会被截断（脚本@' + firstScript + '，提交键@' + lastKey + '）');
    // 更强的守卫：整段键盘块里（到 </main> 前）不允许出现任何 <script>
    const keyboardBlock = page.html.slice(kStart, keyboardClose < 0 ? page.html.length : keyboardClose);
    const innerScript = keyboardBlock.indexOf('<script');
    eqCheck(innerScript < 0,
        '[' + page.label + '] 软键盘块内（#keyboard 到 </main> 之间）不应出现 <script>，'
        + '否则 keysFromHtml 会把按键解析截断；实际出现在块内偏移 ' + innerScript);
    eqCheck(scriptSrc === 'js/app-nav.js',
        '[' + page.label + '] id="keyboard" 之后第一个 <script> 应是侧边栏脚本 js/app-nav.js，实际: ' + scriptSrc);
    // 页面脚本必须在这个截断点之后（否则它会被当成软键盘块的一部分，解析必然出错）
    const pageScriptPos = page.html.indexOf('<script src="' + page.script + '">');
    eqCheck(pageScriptPos > firstScript,
        '[' + page.label + '] 页面脚本 ' + page.script + ' 应在截断点之后加载，实际位置: ' + pageScriptPos
        + '（截断点 ' + firstScript + '）');
    // 解析结果本身必须是完整的：20 个 data-val + 5 个 data-action（化简页），
    // 这是「动作键一致」等下游对照的输入，短一个就说明口径已经偏了
    const parsedNow = (() => { try { return keysFromHtml(page.html, page.file); } catch (e) { return []; } })();
    const wantVals = page.here === 'simplify' ? 20 : 21;
    eqCheck(parsedNow.filter(k => k.val).length === wantVals,
        '[' + page.label + '] 从页面解析出的 data-val 键应是 ' + wantVals + ' 个，实际 '
        + parsedNow.filter(k => k.val).length + ' 个（少了说明解析区间被截断）');
    eqCheck(parsedNow.filter(k => k.action).length === 5,
        '[' + page.label + '] 从页面解析出的 data-action 键应是 5 个，实际 '
        + parsedNow.filter(k => k.action).length + ' 个');
});

// ---------- 引擎级对照：页面脚本的假设是否成立（不依赖实现细节，只验证契约） ----------
if (!equationEngine) {
    eqCheck(false, 'equation-engine.js 加载失败：' + (equationEngineErr && equationEngineErr.message));
} else {
    // 固定题：判对 / unmerged（同解但没化系数为一）/ 判错 / 格式错
    const eqEval = (stu, ans) => eqEvalRaw(stu, ans === undefined ? FixedEq.answer : ans);
    eqCheck(eqEval('x=4').status === 'correct', 'x=4 应判 correct，实际 ' + eqEval('x=4').status);
    eqCheck(eqEval('x = 4').status === 'correct', '带空格的 x = 4 也应判 correct');
    // 「同解但没化系数为一」：页面按 unmerged 给过程并结束本题
    ['2x=8', 'x+3=7', '4=x'].forEach(stu => {
        const st = eqEval(stu).status;
        eqCheck(st === 'correct' || st === 'unmerged',
            stu + ' 与 x=4 同解，应判 correct 或 unmerged，实际 ' + st);
    });
    eqCheck(eqEval('x=5').status === 'wrong', 'x=5 应判 wrong，实际 ' + eqEval('x=5').status);
    // unmerged 只属于「同解」：错解（x=5）绝不能落到 unmerged，否则页面会对错答案给过程还记 unmerged
    eqCheck(eqEval('x=5').status !== 'unmerged', 'x=5 与 x=4 不同解，不能判 unmerged');
    const eqEvalStatuses = ['correct', 'unmerged', 'wrong', 'error'];
    ['x=', 'x==4', '=4', '2x+3=', '((('].forEach(stu => {
        const r = eqEval(stu);
        eqCheck(eqEvalStatuses.includes(r.status) && typeof r.msg === 'string' && r.msg.length > 0,
            '残缺/非法输入 ' + JSON.stringify(stu) + ' 应返回 {status∈4 种, msg}，实际 ' + JSON.stringify(r));
    });
    // 分数解（按数值同解判）
    eqCheck(eqEval('x=2/4', 'x=1/2').status === 'correct',
        'x=2/4 与 x=1/2 同解，应判 correct，实际 ' + eqEval('x=2/4', 'x=1/2').status);

    // 分步过程：最后一步恰好是答案、第一步是原方程、中间步不含 LaTeX 宏
    const eqSafe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
    const eqSteps = eqSafe(() => equationEngine.buildSteps(FixedEq.question, FixedEq.answer), []) || [];
    eqCheck(Array.isArray(eqSteps) && eqSteps.length >= 3, '固定方程的过程应有 >= 3 步，实际 ' + eqSteps.length);
    const eqStepNorm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
    const eqStepsLast = eqSteps[eqSteps.length - 1] || {};
    eqCheck(eqStepNorm(eqStepsLast.expr) === eqStepNorm(FixedEq.answer),
        '过程最后一步应恰好等于答案 x=4，实际 title=' + eqStepsLast.title + ' expr=' + eqStepsLast.expr);
    eqCheck(eqStepNorm(eqSteps[0] && eqSteps[0].expr) === eqStepNorm(FixedEq.question),
        '过程第一步应是原方程，实际 ' + (eqSteps[0] && eqSteps[0].expr));
    eqCheck(eqSteps.every(s => s && typeof s.title === 'string' && s.title.length > 0
        && typeof s.expr === 'string' && s.expr.length > 0),
        '每步都应有 title 和 expr');
    eqCheck(eqSteps.every(s => !/\\[a-zA-Z]+/.test(s.expr)), '每步 expr 不应含 LaTeX 宏（页面统一渲染）');
    eqCheck(eqSteps.every(s => !/[+\-] [+\-]/.test(s.expr)), '过程不应出现连续符号');
    // 每一步都应真是「同一道题」的中间态：把每步当成学生答案交回去，不能落到 error
    eqSteps.forEach((s, i) => {
        const r = eqSafe(() => equationEngine.evaluateAnswer(s.expr, FixedEq.answer), { status: 'throw' });
        eqCheck(r.status !== 'error' && r.status !== 'throw',
            '过程第 ' + (i + 1) + ' 步 ' + s.expr + ' 不应判成 error/异常，实际 ' + r.status);
    });

    // 提示：移项 / 变号 / 合并同类项 / 化系数为一
    const eqHints = (eqSafe(() => equationEngine.hintsFor(FixedEq.question), []) || []).map(String);
    eqCheck(eqHints.length >= 2, '固定方程提示应 >= 2 条，实际 ' + eqHints.length);
    const eqHintAll = eqHints.join(' | ');
    eqCheck(/移(项|到)/.test(eqHintAll), '方程提示应讲到「移项」，实际: ' + eqHintAll);
    eqCheck(/变号/.test(eqHintAll), '方程提示应讲到移项「变号」，实际: ' + eqHintAll);
    eqCheck(/合并同类项|化系数为一/.test(eqHintAll), '方程提示应讲到「合并同类项/化系数为一」，实际: ' + eqHintAll);
    eqCheck(!eqHints.some(h => /x\s*=\s*4/.test(h)), '提示不应直接给出答案');

    // 出题：四档都能出、题面带等号、答案 x=…、tags 是数组
    const eqSeen = {};
    for (let lv = 1; lv <= 4; lv++) {
        for (let i = 0; i < 20; i++) {
            const q = eqSafe(() => equationEngine.generateQuestion(lv), null);
            if (!q) { eqCheck(false, '第 ' + lv + ' 档出题为空或抛异常'); break; }
            eqCheck(q.level === lv, '第 ' + lv + ' 档出题 level 不对: ' + q.level);
            eqCheck(typeof q.question === 'string' && q.question.includes('='),
                '第 ' + lv + ' 档题目应带等号: ' + q.question);
            eqCheck(typeof q.answer === 'string' && /^x=-?\d+(\/\d+)?$/.test(q.answer),
                '第 ' + lv + ' 档答案应是 x=数值，实际: ' + q.answer);
            eqCheck(Array.isArray(q.tags), '第 ' + lv + ' 档 tags 应是数组');
            // 生成的题必须能判对、能给过程、能给提示（防止生成了自己解不了的题）
            const selfEval = eqSafe(() => equationEngine.evaluateAnswer(q.answer, q.answer), { status: 'throw' });
            eqCheck(selfEval.status === 'correct', '自己出的答案应判 correct: ' + q.answer + ' → ' + selfEval.status);
            const st = eqSafe(() => equationEngine.buildSteps(q.question, q.answer), []) || [];
            eqCheck(Array.isArray(st) && st.length >= 2, '生成的题应能给出过程: ' + q.question);
            eqCheck(eqStepNorm(st[st.length - 1] && st[st.length - 1].expr) === eqStepNorm(q.answer),
                '生成题的过程末步应等于答案: ' + q.question + ' / ' + q.answer);
            eqCheck((eqSafe(() => equationEngine.hintsFor(q.question), []) || []).length >= 1, '生成的题应能给提示: ' + q.question);
            eqSeen[q.question] = true;
        }
    }
    eqCheck(Object.keys(eqSeen).length > 4, '四档应能出出多样的题，实际去重后 ' + Object.keys(eqSeen).length + ' 道');
}

// 引擎对「答案里带 =」的 LaTeX 转换：页面会用它渲染题目和输入
if (equationEngine) {
    const eqTex = (() => { try { return equationEngine.toLatexText('x=4'); } catch (e) { return 'THROW: ' + e.message; } })();
    eqCheck(typeof eqTex === 'string' && eqTex.length > 0, 'toLatexText(x=4) 应返回可用文本，实际 ' + eqTex);
}

// ---------- 汇总 ----------
console.log('=== 交互冒烟 ===');
if (process.env.UI_SMOKE_STATS) console.log('  共执行 ' + checksRun + ' 条断言');
if (fails.length === 0) console.log('  全部通过');
else {
    fails.forEach(f => console.log('  ✗ ' + f));
    process.exitCode = 1;
}
})();

const window = { onload: null };
