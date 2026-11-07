// backend/routes/auth.js —— 注册 / 登录 / 登出 / 当前用户
const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉了容易看错的 0 O 1 I
const TEACHER_INVITE = process.env.TEACHER_INVITE || '';    // 设了它，老师注册必须带这个口令

// 登录失败限速（内存计数，重启清零）：同一 IP + 姓名 5 分钟内最多错 5 次
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const FAIL_MAX = 5;
const failures = new Map();

function failKey(req, name) {
    return (req.ip || 'unknown') + '|' + name;
}

function tooManyFailures(key) {
    const rec = failures.get(key);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > FAIL_WINDOW_MS) {
        failures.delete(key);
        return false;
    }
    return rec.count >= FAIL_MAX;
}

function noteFailure(key) {
    const rec = failures.get(key);
    if (!rec || Date.now() - rec.firstAt > FAIL_WINDOW_MS) {
        failures.set(key, { count: 1, firstAt: Date.now() });
    } else {
        rec.count++;
    }
}

function makeInviteCode() {
    const db = store.getDb();
    for (let i = 0; i < 100; i++) {
        const bytes = crypto.randomBytes(6);
        let code = '';
        for (let j = 0; j < 6; j++) code += INVITE_ALPHABET[bytes[j] % INVITE_ALPHABET.length];
        if (!db.users.some(u => u.inviteCode === code)) return code;
    }
    return crypto.randomBytes(6).toString('hex').toUpperCase();
}

router.post('/register', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'teacher' ? 'teacher' : 'student';

    const bad = auth.validateCredentials(name, password);
    if (bad) return res.status(400).json({ success: false, msg: bad });

    const db = store.getDb();
    if (db.users.some(u => u.name === name)) {
        return res.status(409).json({ success: false, msg: '这个姓名已经被注册了' });
    }

    let teacherId = null;
    let inviteCode = null;

    if (role === 'teacher') {
        if (TEACHER_INVITE && String(body.teacherInvite || '') !== TEACHER_INVITE) {
            return res.status(403).json({ success: false, msg: '老师注册需要管理员口令' });
        }
        inviteCode = makeInviteCode();
    } else {
        const code = String(body.inviteCode || '').trim().toUpperCase();
        const teacher = db.users.find(u => u.role === 'teacher' && u.inviteCode === code);
        if (!teacher) {
            return res.status(400).json({ success: false, msg: '邀请码不正确，请向老师确认' });
        }
        teacherId = teacher.id;
    }

    const { salt, hash } = auth.hashPassword(password);
    const user = {
        id: store.newId('u'),
        name,
        role,
        teacherId,
        inviteCode,
        salt,
        hash,
        createdAt: Date.now()
    };
    store.addUser(user);

    const token = auth.createSession(user.id);
    store.save();
    auth.setSessionCookie(res, token);

    res.json({ success: true, data: { user: auth.publicUser(user), inviteCode } });
});

router.post('/login', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const key = failKey(req, name);

    if (tooManyFailures(key)) {
        return res.status(429).json({ success: false, msg: '密码错误次数太多，请 5 分钟后再试' });
    }

    const user = store.findUserByName(name);
    if (!user || !auth.verifyPassword(password, user.salt, user.hash)) {
        noteFailure(key);
        return res.status(401).json({ success: false, msg: '姓名或密码不正确' });
    }

    failures.delete(key);
    const token = auth.createSession(user.id);
    store.save();
    auth.setSessionCookie(res, token);
    res.json({ success: true, data: { user: auth.publicUser(user) } });
});

router.post('/logout', (req, res) => {
    auth.destroySession(req);
    store.save();
    auth.clearSessionCookie(res);
    res.json({ success: true, data: null });
});

router.get('/me', auth.requireLogin, (req, res) => {
    res.json({ success: true, data: { user: auth.publicUser(req.user) } });
});

module.exports = router;
