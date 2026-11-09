// test/auth.smoke.js —— 登录/注册页冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：登录/注册切换、学生只看邀请码、老师只看管理员口令、提交时的字段名、
//       注册成功展示邀请码、学生注册成功跳练习页、[hidden] 的 CSS 兜底
// 用法：node test/auth.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
// 页面里现在有两段内联脚本：head 里的夜间模式启动脚本 + 体尾的登录/注册逻辑。
// 取错了会得到「只有夜间模式」的那段（后面 handlers.click 全是 undefined）。
// 按内容挑：登录脚本一定含 auth-form 的提交处理，而不是按位置 [0] 硬猜。
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const authCandidates = inlineScripts.filter(s => /auth-form/.test(s));
const inline = authCandidates[0];

let fails = 0;
function check(ok, msg) {
    if (ok) console.log('  ✓ ' + msg);
    else { fails++; console.error('  ✗ ' + msg); }
}

// ---------- 最小 DOM 桩 ----------
class El {
    constructor(tag, id) {
        this.tagName = tag;
        this.id = id || '';
        this.dataset = {};
        this.attrs = {};
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.textContent = '';
        this.handlers = {};
        this._classes = new Set();
        const self = this;
        this.classList = {
            add: c => self._classes.add(c),
            remove: c => self._classes.delete(c),
            contains: c => self._classes.has(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (self._classes.has(c)) self._classes.delete(c); else self._classes.add(c);
                } else if (force) self._classes.add(c);
                else self._classes.delete(c);
            }
        };
    }
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name]; }
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

// 页面元素（id 与 index.html 一一对应）
const tabLogin = mk('', 'button', 'tab');
tabLogin.dataset.mode = 'login';
tabLogin.classList.add('active');
const tabRegister = mk('', 'button', 'tab');
tabRegister.dataset.mode = 'register';
mk('', 'div', 'tabs');

const form = mk('auth-form', 'form');
const nameEl = mk('name', 'input');
const passwordEl = mk('password', 'input');
const registerOnly = mk('register-only');
const roleStudent = mk('', 'input');
roleStudent.attrs.name = 'role';
roleStudent.value = 'student';
roleStudent.checked = true;
const roleTeacher = mk('', 'input');
roleTeacher.attrs.name = 'role';
roleTeacher.value = 'teacher';

const inviteRow = mk('invite-row', 'label');
const inviteEl = mk('invite', 'input');
const teacherRow = mk('teacher-row', 'label');
const teacherEl = mk('teacher-invite', 'input');
const submitBtn = mk('submit-btn', 'button');
mk('msg', 'p');
const inviteResult = mk('invite-result', 'div');
const inviteCodeEl = mk('invite-code', 'div');

// 对应 HTML 里的 hidden 属性（登录模式下这些都是隐藏的）
registerOnly.hidden = true;
inviteRow.hidden = true;
teacherRow.hidden = true;
inviteResult.hidden = true;

function selectAll(sel) {
    if (sel === 'input[name="role"]') return registry.filter(e => e.attrs.name === 'role');
    if (sel === 'input[name="role"]:checked') return registry.filter(e => e.attrs.name === 'role' && e.checked);
    if (sel.startsWith('.')) return registry.filter(e => e._classes.has(sel.slice(1)));
    return [];
}

const document = {
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => selectAll(sel)[0] || null,
    querySelectorAll: (sel) => selectAll(sel)
};

const replaced = [];
const location = { replace: (url) => replaced.push(url) };

let lastRegister = null;
const calls = [];
async function fetchStub(url, opts) {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    if (url === '/api/auth/me') return { ok: false, status: 401, json: async () => ({ success: false }) };
    if (url === '/api/auth/login') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { user: { name: 'x', role: 'teacher' } } }) };
    }
    if (url === '/api/auth/register') {
        lastRegister = body;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                data: { user: { name: body.name, role: body.role }, inviteCode: body.role === 'teacher' ? 'ABC123' : null }
            })
        };
    }
    return { ok: false, status: 404, json: async () => ({ success: false, msg: 'no stub: ' + url }) };
}

async function submit() {
    const handler = form.handlers.submit[0];
    await handler({ preventDefault() { } });
}

(async () => {
    console.log('=== 注册页冒烟 ===');
    new Function('document', 'location', 'fetch', inline)(document, location, fetchStub);
    await new Promise(r => setImmediate(r));   // 等页面启动时的 /api/auth/me 检查

    // 0. CSS 兜底：label{display:flex} 会盖掉 [hidden]，必须有 !important 规则
    check(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(html),
        '[hidden] 有 display:none !important 兜底（否则隐藏的行照样显示）');

    // 0b. 内联脚本选对了：登录脚本才会处理 #auth-form
    check(!!inline && /auth-form/.test(inline),
        '取到的是登录/注册脚本（按内容挑，不按位置猜）');
    // 夜间模式脚本必须留在 <head> 里（首帧前就要挂 data-theme），
    // 所以只看 head 段的内联脚本，别混进页面尾部的业务脚本
    const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
    const headInline = [...head.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    check(headInline.some(s => /poly-theme/.test(s)),
        '页面除登录脚本外还有一段夜间模式启动脚本');
    const themeScript = headInline.find(s => /poly-theme/.test(s)) || '';
    check(!/fetch|document\.getElementById/.test(themeScript),
        '夜间模式脚本只碰 documentElement，不请求接口也不取业务节点');

    // 0c. 侧边栏：登录页也挂同一套 app-nav，未登录时由 app-nav.js 置灰入口
    const navBlock = (() => {
        const s = html.indexOf('id="app-nav"');
        if (s < 0) return '';
        const a = html.lastIndexOf('<aside', s);
        const e = html.indexOf('</aside>', s);
        return a < 0 || e < 0 ? '' : html.slice(a, e);
    })();
    check(/css\/app-nav\.css/.test(html), '登录页引用 css/app-nav.css');
    check(/<script\s+src="js\/app-nav\.js"><\/script>/.test(html), '登录页引用 js/app-nav.js');
    const bodyTag = (html.match(/<body\b([^>]*)>/) || [])[1] || '';
    check(/\bnav-layout\b/.test((bodyTag.match(/class="([^"]*)"/) || [])[1] || ''),
        '登录页 <body> 有 class="nav-layout"');
    // 关键：登录页必须是 guest，否则 app-nav.js 会去请求 /api/auth/me 并把链接当已登录处理
    check(/data-auth="guest"/.test(bodyTag), '登录页 <body> 标了 data-auth="guest"（不请求登录态）');
    check(/id="app-nav"/.test(html), '登录页有侧边栏 #app-nav');
    const navHrefs = [...navBlock.matchAll(/<a\b[^>]*data-nav="([^"]+)"[^>]*>/g)]
        .map(m => ({ nav: m[1], href: (m[0].match(/href="([^"]*)"/) || [])[1] }));
    const hrefOf = (n) => (navHrefs.find(l => l.nav === n) || {}).href;
    check(hrefOf('simplify') === 'practice.html' && hrefOf('equation') === 'equations.html'
        && hrefOf('board') === 'teacher.html',
        '登录页侧边栏三个入口链到 practice / equations / teacher，实际: '
        + navHrefs.map(l => l.nav + '→' + l.href).join(','));
    // 登录页不属于任何练习页，所有链接都不该带 aria-current="page"
    check(!/aria-current="page"/.test(navBlock), '登录页侧边栏不应把任何入口标为当前页');

    // 1. 登录模式：邀请码行、口令行都不显示
    check(inviteRow.hidden === true && teacherRow.hidden === true, '登录模式不显示邀请码/管理员口令');

    // 2. 切到注册（默认学生）：只显示邀请码
    tabRegister.handlers.click[0]();
    check(registerOnly.hidden === false, '注册模式显示角色选择');
    check(inviteRow.hidden === false, '学生注册显示邀请码');
    check(teacherRow.hidden === true, '学生注册不显示管理员口令');

    // 3. 选中"我是老师"：只显示管理员口令
    roleStudent.checked = false;
    roleTeacher.checked = true;
    roleTeacher.handlers.change.forEach(fn => fn());
    check(inviteRow.hidden === true, '老师注册不显示学生邀请码');
    check(teacherRow.hidden === false, '老师注册显示管理员口令');

    // 4. 老师注册提交：带 teacherInvite，不带 inviteCode
    nameEl.value = 'gyf';
    passwordEl.value = 'secret123';
    teacherEl.value = 'TEST-INVITE1';
    await submit();
    check(lastRegister && lastRegister.role === 'teacher', '提交的角色是 teacher');
    check(lastRegister && lastRegister.teacherInvite === 'TEST-INVITE1', '老师提交带上管理员口令');
    check(lastRegister && lastRegister.inviteCode === '', '老师提交不带学生邀请码');
    check(inviteResult.hidden === false && inviteCodeEl.textContent === 'ABC123', '注册成功展示拿到的邀请码');

    // 5. 学生注册提交：带 inviteCode，不带 teacherInvite，成功后跳练习页
    form.hidden = false;
    inviteResult.hidden = true;
    inviteCodeEl.textContent = '';
    roleTeacher.checked = false;
    roleStudent.checked = true;
    roleStudent.handlers.change.forEach(fn => fn());
    check(inviteRow.hidden === false && teacherRow.hidden === true, '切回学生：显示邀请码、隐藏管理员口令');
    inviteEl.value = 'TZDGJG';
    await submit();
    check(lastRegister.role === 'student', '提交的角色是 student');
    check(lastRegister.inviteCode === 'TZDGJG', '学生提交带上邀请码');
    check(lastRegister.teacherInvite === '', '学生提交不带管理员口令');
    check(replaced.includes('practice.html'), '学生注册成功后跳转练习页');

    console.log(fails === 0 ? '  全部通过' : '  ' + fails + ' 项失败');
    process.exit(fails === 0 ? 0 : 1);
})();
