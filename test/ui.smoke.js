// test/ui.smoke.js —— 练习页交互冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：出题渲染 / 提示 / 错两次给解析 / 锁键盘 / 下一题
// 用法：node test/ui.smoke.js
const fs = require('fs');
const path = require('path');
const math = require('mathjs');

const root = path.join(__dirname, '..');
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

[1, 2, 3, 4].forEach(lv => {
    const el = mk('', 'button', 'level-tab');
    el.dataset.level = String(lv);
});

const qEl = mk('question-display');
const inEl = mk('input-display');
const fbEl = mk('feedback-display');
const hintsEl = mk('hint-display');
const stepsEl = mk('steps-display');
const levelTabs = mk('level-tabs');
const keyboard = mk('keyboard');

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

// ---------- 启动页面脚本 ----------
const FixedQuestion = { level: 2, question: '2(x - 3) - 4(x + 1)', answer: '-2x-10' };
store.set('poly_current_q', JSON.stringify(FixedQuestion));

const fakeWindow = { onload: null };

new Function('window', 'document', 'katex', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', 'math',
    inline + '\n')(fakeWindow, document, katex, localStorage, () => true,
    () => 0, () => { }, math);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const clickKey = (name) => (keyboard.handlers.click || []).forEach(fn => fn({ target: keys[name] }));
const type = (s) => [...s].forEach(ch => {
    if (!keys['k_' + ch]) throw new Error('键盘上没有 ' + ch);
    clickKey('k_' + ch);
});

try {
    fakeWindow.onload();
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

// 3. 第一次答错 -> 只提示还有一次机会
type('2x-6-4x+4');
clickKey('submit');
check(/还有 1 次机会/.test(fbEl.textContent), '第一次错应有提示语，实际: ' + fbEl.textContent);
check(stepsEl.hidden === true, '第一次错不应直接给解析');

// 4. 第二次答错 -> 出解析、锁键盘、按钮变下一题
clickKey('submit');
check(stepsEl.hidden === false, '错两次应展开完整过程');
check(/错了两次/.test(fbEl.textContent), '二次错反馈不对: ' + fbEl.textContent);
check(keys.submit.textContent === '下一题' && keys.submit.dataset.action === 'next', '提交键应变成下一题');
const rows = stepsEl.children.slice(1);
check(rows.length >= 3, '解析步数应 >= 3，实际 ' + rows.length);
const lastBody = rows.length ? rows[rows.length - 1].children[1] : { _tex: '' };
check(String(lastBody._tex).replace(/\s+/g, '') === FixedQuestion.answer, '最后一步应等于答案: ' + lastBody._tex);

// 5. 锁定后键盘无效
const beforeLock = inEl._tex;
clickKey('k_5');
check(inEl._tex === beforeLock, '解析展开后键盘应被锁住');

// 6. 下一题
const oldQuestion = qEl._tex;
clickKey('submit');
check(qEl._tex !== oldQuestion, '点下一题应换新题');
check(stepsEl.hidden === true && hintsEl.hidden === true, '换题后应清空提示与解析');
check(keys.submit.textContent === '提交答案' && keys.submit.dataset.action === 'submit', '换题后按钮应复原');

// ---------- 汇总 ----------
console.log('=== 交互冒烟 ===');
if (fails.length === 0) console.log('  全部通过');
else {
    fails.forEach(f => console.log('  ✗ ' + f));
    process.exitCode = 1;
}

const window = { onload: null };
