// test/auth.smoke.js —— 登录/注册页冒烟（最小 DOM 桩，不需要浏览器）
// 覆盖：登录/注册切换、学生只看邀请码、老师只看管理员口令、提交时的字段名、
//       注册成功展示邀请码、学生注册成功跳练习页、[hidden] 的 CSS 兜底
// 用法：node test/auth.smoke.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)][0][1];

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
    teacherEl.value = 'PDT-K7M2Q9';
    await submit();
    check(lastRegister && lastRegister.role === 'teacher', '提交的角色是 teacher');
    check(lastRegister && lastRegister.teacherInvite === 'PDT-K7M2Q9', '老师提交带上管理员口令');
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
