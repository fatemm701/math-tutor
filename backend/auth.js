// backend/auth.js —— 密码哈希、会话、登录校验中间件（不引第三方依赖）
const crypto = require('crypto');
const store = require('./store');

const COOKIE_NAME = 'pd_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 天
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // 走 HTTPS 时设 1

const NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,20}$/;

function validateCredentials(name, password) {
    if (!NAME_RE.test(name)) return '姓名只能是 1-20 位中英文、数字、下划线或短横线';
    if (password.length < 6 || password.length > 64) return '密码长度要在 6-64 位之间';
    return null;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, expectedHex) {
    try {
        const actual = crypto.scryptSync(String(password), String(salt), 64);
        const expected = Buffer.from(String(expectedHex), 'hex');
        if (actual.length !== expected.length) return false;
        return crypto.timingSafeEqual(actual, expected);
    } catch (err) {
        return false;
    }
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i < 0) return;
        const key = part.slice(0, i).trim();
        const raw = part.slice(i + 1).trim();
        if (!key) return;
        try { out[key] = decodeURIComponent(raw); } catch (e) { out[key] = raw; }
    });
    return out;
}

function createSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    store.getDb().sessions[token] = {
        userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
    };
    return token;
}

function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const db = store.getDb();
    const sess = db.sessions[token];
    if (!sess) return null;
    if (!sess.expiresAt || sess.expiresAt <= Date.now()) {
        delete db.sessions[token];
        return null;
    }
    return db.users.find(u => u.id === sess.userId) || null;
}

function destroySession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return;
    const db = store.getDb();
    if (db.sessions[token]) delete db.sessions[token];
}

function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        maxAge: SESSION_TTL_MS,
        path: '/'
    });
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireLogin(req, res, next) {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ success: false, msg: '请先登录' });
    req.user = user;
    next();
}

function requireTeacher(req, res, next) {
    requireLogin(req, res, () => {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ success: false, msg: '只有老师可以访问' });
        }
        next();
    });
}

// 对外只暴露安全字段，salt/hash 绝不出现在响应里
function publicUser(user) {
    const out = { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
    if (user.role === 'teacher' && user.inviteCode) out.inviteCode = user.inviteCode;
    return out;
}

module.exports = {
    COOKIE_NAME,
    SESSION_TTL_MS,
    validateCredentials,
    hashPassword,
    verifyPassword,
    parseCookies,
    createSession,
    currentUser,
    destroySession,
    setSessionCookie,
    clearSessionCookie,
    requireLogin,
    requireTeacher,
    publicUser
};
