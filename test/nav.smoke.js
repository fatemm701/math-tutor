// test/nav.smoke.js —— 左侧导航栏冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：折叠 / 分组开合的记忆、窄屏抽屉、当前页 aria-current、访客置灰、
//       登录后看板入口按角色出现与文案、没有侧边栏的页面不受影响
// 用法：node test/nav.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'frontend/js/app-nav.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/css/app-nav.css'), 'utf8');

let fails = 0;
let passes = 0;
function check(ok, msg) {
    if (ok) { passes++; console.log('  ✓ ' + msg); }
    else { fails++; console.error('  ✗ ' + msg); }
}
const hasCls = (el, c) => el.classList.contains(c);

// ---------- 最小 DOM 桩 ----------
class El {
    constructor(tag, id) {
        this.tagName = tag;
        this.id = id || '';
        this.dataset = {};
        this.attrs = {};
        this.hidden = false;
        this.disabled = false;
        this.listeners = {};
        this.textContent = '';
        this._classes = new Set();
        const self = this;
        this.classList = {
            add: c => { self._classes.add(c); return self; },
            remove: c => { self._classes.delete(c); return self; },
            contains: c => self._classes.has(c),
            toggle: (c, force) => {
                let on;
                if (force === undefined) on = !self._classes.has(c);
                else on = !!force;
                if (on) self._classes.add(c); else self._classes.delete(c);
                return on;
            }
        };
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }
    removeAttribute(name) { delete this.attrs[name]; }
    fire(type, ev) { (this.listeners[type] || []).forEach(fn => fn(ev || { type, target: this })); }
}

function makeWindow(o) {
    const opts = o || {};
    const store = Object.assign({}, opts.store || {});
    const byId = {};
    const body = new El('body');
    if (opts.auth) body.attrs['data-auth'] = opts.auth;

    function add(tag, id, cls) {
        const el = new El(tag, id);
        if (cls) cls.split(' ').forEach(c => el._classes.add(c));
        if (id) byId[id] = el;
        return el;
    }

    const nav = add('aside', 'app-nav', 'app-nav');
    const toggle = add('button', 'nav-toggle', 'app-nav-toggle');
    const groupBtn = add('button', 'nav-group-practice', 'app-nav-group-btn');
    const group = add('div', '', 'app-nav-group');
    group.attrs['data-open'] = 'true';
    groupBtn.parentNode = group;
    const sub = add('div', 'nav-sub-practice', 'app-nav-sub');
    const who = add('span', 'who', 'app-nav-who');
    who.textContent = '加载中…';
    const logout = add('button', 'logout');
    const backdrop = add('div', 'app-nav-backdrop', 'app-nav-backdrop');

    // 三个导航链接（与页面 HTML 一致：练习页没有 aria-current 由脚本补）
    const links = [];
    [['simplify', 'practice.html', false], ['equation', 'equations.html', false], ['board', 'teacher.html', true]]
        .forEach(([key, href, hidden]) => {
            const a = add('a', key === 'board' ? 'nav-board' : '', 'app-nav-link');
            a.dataset.nav = key;
            a.attrs.href = href;
            a.hidden = hidden;
            const icon = new El('span');
            const text = new El('span');
            text._classes.add('app-nav-text');
            if (key === 'board') text.textContent = '看板';
            a.children = [icon, text];
            a.querySelector = sel => (sel === '.app-nav-text' ? text : null);
            a.textContent = (key === 'board' ? '看板' : '');
            links.push(a);
        });
    nav.children = [toggle, groupBtn, group, links[0], links[1], links[2], who, logout];

    const document = {
        body,
        getElementById: id => (Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null),
        querySelectorAll: sel => {
            if (/data-nav/.test(sel)) return links;
            return [];
        }
    };

    const mediaHandlers = [];
    const mql = { matches: !!opts.narrow, addEventListener: (t, fn) => mediaHandlers.push(fn) };
    const localStorage = {
        getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const fetchCalls = [];
    const fetchFn = url => {
        fetchCalls.push(url);
        const res = opts.me || { ok: false, status: 401, json: async () => ({}) };
        return Promise.resolve(res);
    };

    const win = {
        localStorage,
        document,
        location: { pathname: '/' + (opts.page || 'practice.html'), replace() {} },
        fetch: fetchFn,
        matchMedia: () => mql,
        console
    };

    return {
        win, document, body, nav, toggle, groupBtn, group, sub, who, logout, backdrop, links,
        store, fetchCalls,
        mediaFire(matches) { mql.matches = matches; mediaHandlers.forEach(fn => fn({ matches })); },
        async flush() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }
    };
}

function load(stub) {
    const w = stub.win;
    const fn = new Function('window', 'document', 'localStorage', 'location', 'fetch', 'matchMedia', 'console', 'setTimeout', src);
    fn(w, w.document, w.localStorage, w.location, w.fetch, w.matchMedia, console, setTimeout);
}

// ---------- 1. 源码形态 ----------
console.log('导航栏 · 源码形态');
check(src.includes("'poly-nav'"), '收起状态的键是 poly-nav');
check(src.includes("'poly-nav-group'"), '分组开合另有独立的键 poly-nav-group');
check(!/^\s*(import|export)\b/m.test(src), 'app-nav.js 是普通脚本（不是 ES module）');
check(src.includes('aria-current'), '脚本会写 aria-current 标记当前页');
check(src.includes('/api/auth/me'), '登录态取自 /api/auth/me');
check(src.includes('is-disabled'), '访客态用 is-disabled 置灰');
check(!/document\.querySelectorAll\([^)]*\)\.forEach/.test(src), '不走 NodeList.forEach（老浏览器没有这个 API），统一 Array.prototype.forEach.call');
check(css.includes('--nav-width: 220px'), 'CSS 常驻宽度 220px');
check(/--nav-width-collapsed:\s*60px/.test(css), 'CSS 收起宽度 60px');
check(/max-width:\s*768px/.test(css), 'CSS 在 768px 处切换成抽屉');
check(/translateX\(-100%\)/.test(css), '窄屏下侧边栏移出屏幕');
check(/\[hidden\][\s\S]{0,40}display:\s*none\s*!important/.test(css), 'CSS 给 [hidden] 兜底');

(async () => {
    // ---------- 2. 宽屏收起 ----------
    console.log('导航栏 · 宽屏收起态');
    {
        const s = makeWindow({ page: 'practice.html' });
        load(s);
        check(hasCls(s.body, 'nav-layout'), '默认给 body 加 nav-layout');
        check(!hasCls(s.body, 'nav-collapsed'), '没存过状态时默认展开');
        check(!hasCls(s.body, 'nav-narrow'), '宽屏不加 nav-narrow');
        s.toggle.fire('click');
        check(hasCls(s.body, 'nav-collapsed'), '点 ☰ 收起');
        check(s.store['poly-nav'] === 'collapsed', '收起状态写进 localStorage');
        check(s.toggle.getAttribute('aria-expanded') === 'false', '收起后 aria-expanded=false');
        s.toggle.fire('click');
        check(!hasCls(s.body, 'nav-collapsed'), '再点一次展开');
        check(!('poly-nav' in s.store), '展开时清掉记录，不写死 expanded');
    }
    {
        const s = makeWindow({ page: 'practice.html', store: { 'poly-nav': 'collapsed' } });
        load(s);
        check(hasCls(s.body, 'nav-collapsed'), '下次进页面沿用收起状态');
    }

    // ---------- 3. 分组开合 ----------
    console.log('导航栏 · 练习分组');
    {
        const s = makeWindow({ page: 'practice.html' });
        load(s);
        check(s.sub.hidden === false, '默认展开练习分组');
        s.groupBtn.fire('click');
        check(s.sub.hidden === true && s.group.attrs['data-open'] === 'false', '点分组标题收起子项');
        check(s.store['poly-nav-group'] === 'closed', '分组收起写入 poly-nav-group');
        check(s.groupBtn.getAttribute('aria-expanded') === 'false', '分组按钮 aria-expanded=false');
        s.groupBtn.fire('click');
        check(s.sub.hidden === false && s.group.attrs['data-open'] === 'true', '再点展开');
        check(!('poly-nav-group' in s.store), '展开后清掉记录');
    }
    {
        const s = makeWindow({ page: 'equations.html', store: { 'poly-nav-group': 'closed' } });
        load(s);
        check(s.sub.hidden === true, '下次进页面沿用分组收起');
    }

    // ---------- 4. 窄屏抽屉 ----------
    console.log('导航栏 · 窄屏抽屉');
    {
        const s = makeWindow({ page: 'practice.html', narrow: true });
        load(s);
        check(hasCls(s.body, 'nav-narrow'), '窄屏给 body 加 nav-narrow');
        check(hasCls(s.body, 'nav-collapsed'), '窄屏默认收起成图标条');
        check(!hasCls(s.body, 'nav-open'), '窄屏默认抽屉关着');
        s.toggle.fire('click');
        check(hasCls(s.body, 'nav-open'), '窄屏点 ☰ 打开抽屉');
        check(!('poly-nav' in s.store), '窄屏不往 localStorage 写抽屉状态');
        s.backdrop.fire('click');
        check(!hasCls(s.body, 'nav-open'), '点遮罩关抽屉');
        s.toggle.fire('click');
        const link = s.links[0];
        const navClick = s.nav.listeners.click[0];
        navClick({ target: { closest: sel => (sel === 'a[data-nav]' ? link : null) } });
        check(!hasCls(s.body, 'nav-open'), '点导航项后自动关抽屉');
        const navClickEmpty = s.nav.listeners.click[0];
        navClickEmpty({ target: { closest: () => null } });
        check(hasCls(s.body, 'nav-open') === false, '点在空白处不报错也不乱改');
    }
    {
        const s = makeWindow({ page: 'practice.html' });
        load(s);
        s.mediaFire(true);
        check(hasCls(s.body, 'nav-narrow'), '窗口缩窄时自动切抽屉模式');
        s.toggle.fire('click');
        check(hasCls(s.body, 'nav-open'), '缩放后 ☰ 同样是开抽屉');
        s.mediaFire(false);
        check(!hasCls(s.body, 'nav-narrow'), '拉宽后恢复常驻');
        check(!hasCls(s.body, 'nav-open'), '拉宽后不会残留抽屉打开态');
        check(!hasCls(s.body, 'nav-collapsed'), '拉宽后按记忆恢复展开');
    }
    {
        const s = makeWindow({ page: 'practice.html', store: { 'poly-nav': 'collapsed' } });
        load(s);
        s.mediaFire(true);
        s.mediaFire(false);
        check(hasCls(s.body, 'nav-collapsed'), '拉宽后按记忆恢复成收起');
    }

    // ---------- 5. 当前页高亮 ----------
    console.log('导航栏 · 当前页');
    {
        const s = makeWindow({ page: 'equations.html' });
        load(s);
        check(s.links[1].getAttribute('aria-current') === 'page', '方程页高亮方程入口');
        check(s.links[0].getAttribute('aria-current') === null, '方程页不高亮整式化简');
        check(s.links[2].getAttribute('aria-current') === null, '方程页不高亮看板');
    }
    {
        const s = makeWindow({ page: 'teacher.html' });
        load(s);
        check(s.links[2].getAttribute('aria-current') === 'page', '看板页高亮看板入口');
        check(s.links[0].getAttribute('aria-current') === null, '看板页不高亮练习入口');
    }
    {
        const s = makeWindow({ page: 'practice.html' });
        load(s);
        check(s.links[0].getAttribute('aria-current') === 'page', '整式化简页高亮对应入口');
        check(s.links[1].getAttribute('aria-current') === null, '整式化简页不高亮方程入口');
    }
    {
        const s = makeWindow({ page: 'index.html' });
        load(s);
        check(s.links.every(a => a.getAttribute('aria-current') === null), '登录页没有高亮任何练习入口');
    }

    // ---------- 6. 访客态 ----------
    console.log('导航栏 · 访客态');
    {
        const s = makeWindow({ page: 'index.html', auth: 'guest' });
        load(s);
        check(s.links.every(a => a.getAttribute('href') === null), '访客：所有导航入口去掉 href（点不动）');
        check(s.links.every(a => hasCls(a, 'is-disabled') && a.getAttribute('aria-disabled') === 'true'), '访客：入口置灰且 aria-disabled=true');
        check(s.who.textContent === '未登录', '访客：侧边栏底部写「未登录」');
        check(s.logout.hidden === true, '访客：隐藏退出按钮');
        check(hasCls(s.groupBtn, 'is-disabled'), '访客：练习分组按钮置灰');
        s.groupBtn.fire('click');
        check(s.sub.hidden === false, '访客：点分组标题也不响应');
        check(s.fetchCalls.length === 0, '访客：不去请求 /api/auth/me');
        check(s.links[2].hidden === true, '访客：看板入口保持隐藏');
    }

    // ---------- 7. 登录态 ----------
    console.log('导航栏 · 登录态');
    const me = (role, name, code) => ({
        ok: true, status: 200,
        json: async () => ({ success: true, data: { user: { role, name, inviteCode: code } } })
    });
    {
        const s = makeWindow({ page: 'practice.html', me: me('student', '小明', 'ABC123') });
        load(s);
        await s.flush();
        check(s.fetchCalls.length === 1 && s.fetchCalls[0] === '/api/auth/me', '登录态请求一次 /api/auth/me');
        check(s.who.textContent === '学生 · 小明 · 邀请码 ABC123', '登录态：#who 显示「学生 · 小明 · 邀请码 ABC123」');
        check(s.links[2].hidden === false, '学生也能看到看板入口（看自己的记录）');
        check(s.links[2].children[1].textContent === '我的看板', '学生看到的看板入口叫「我的看板」');
        check(s.links[2].getAttribute('title').indexOf('我自己') > 0, '学生看板入口的提示说「我自己」');
        check(s.logout.hidden === false, '登录态显示退出按钮');
    }
    {
        const s = makeWindow({ page: 'teacher.html', me: me('teacher', '王老师', 'TCH555') });
        load(s);
        await s.flush();
        check(s.who.textContent === '老师 · 王老师 · 邀请码 TCH555', '老师：#who 显示「老师 · 王老师 · 邀请码 TCH555」');
        check(s.links[2].children[1].textContent === '看板', '老师的看板入口叫「看板」');
        check(s.links[2].hidden === false, '老师能看到看板入口');
        check(s.links[2].getAttribute('aria-current') === 'page', '看板页高亮不被登录逻辑冲掉');
    }
    {
        // 账号区已被页面脚本写过：不被导航脚本覆盖
        const s = makeWindow({ page: 'practice.html', me: me('student', '小明', 'ABC123') });
        s.who.textContent = '学生：小明 · 邀请码 ABC123';
        load(s);
        await s.flush();
        check(s.who.textContent === '学生：小明 · 邀请码 ABC123', '页面脚本已写好的账号信息不被覆盖');
    }
    {
        const s = makeWindow({ page: 'practice.html', me: { ok: false, status: 401, json: async () => ({}) } });
        load(s);
        await s.flush();
        check(s.links[2].hidden === true, '接口 401 时看板入口保持隐藏');
        check(s.who.textContent === '未登录', '接口 401 时按访客处理');
    }
    {
        const s = makeWindow({ page: 'practice.html' });
        load(s);
        await s.flush();
        check(s.links.every(a => a.getAttribute('href') === null), '接口失败也把入口置灰，不留可点但打不开的链接');
    }

    // ---------- 8. 没有侧边栏的页面 ----------
    console.log('导航栏 · 无关页面');
    {
        const s = makeWindow({ page: 'practice.html' });
        s.document.getElementById = id => (id === 'app-nav' ? null : s.win.document.getElementById(id));
        let threw = null;
        try { load(s); } catch (e) { threw = e; }
        check(threw === null, '页面没有侧边栏时脚本静默退出，不抛错');
    }
    {
        const s = makeWindow({ page: 'practice.html' });
        s.win.matchMedia = () => { throw new Error('no matchMedia'); };
        let threw = null;
        try { load(s); } catch (e) { threw = e; }
        check(threw === null, '浏览器没有 matchMedia 时按宽屏处理、不抛错');
    }
    {
        const s = makeWindow({ page: 'practice.html' });
        s.win.localStorage = { getItem() { throw new Error('QuotaExceeded'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('QuotaExceeded'); } };
        let threw = null;
        try { load(s); } catch (e) { threw = e; }
        check(threw === null, 'localStorage 被禁用时不影响页面（隐私模式）');
        s.toggle.fire('click');
        check(hasCls(s.body, 'nav-collapsed'), 'localStorage 不可用时照样能收起');
    }

    console.log('');
    console.log('导航栏冒烟：' + passes + ' 通过，' + fails + ' 失败');
    if (fails > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });