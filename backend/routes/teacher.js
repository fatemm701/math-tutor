// backend/routes/teacher.js —— 老师看板数据 + 直接添加学生
const express = require('express');
const store = require('../store');
const auth = require('../auth');
const scoring = require('../scoring');

const router = express.Router();

// 计分口径统一放在 backend/scoring.js（老师看板与学生自查共用一份）
const { BUCKETS, CORRECT_BUCKETS, classify, summarize, buildCounts } = scoring;

router.get('/students', auth.requireTeacher, (req, res) => {
    const db = store.getDb();
    const now = Date.now();
    const students = db.users
        .filter(u => u.role === 'student' && u.teacherId === req.user.id)
        .map(u => {
            const list = db.attempts.filter(a => a.userId === u.id);
            return {
                user: auth.publicUser(u),
                stats: summarize(list),
                counts: buildCounts(list, now)
            };
        });

    // 老师自己用这个账号试做的记录：单独给一块，不混进学生统计
    const selfAttempts = db.attempts.filter(a => a.userId === req.user.id);
    const self = selfAttempts.length
        ? { user: auth.publicUser(req.user), stats: summarize(selfAttempts) }
        : null;

    res.json({ success: true, data: { students, self, now } });
});

router.get('/attempts', auth.requireTeacher, (req, res) => {
    const studentId = String(req.query.studentId || '');
    const student = store.findUserById(studentId);
    if (!student || student.teacherId !== req.user.id) {
        return res.status(404).json({ success: false, msg: '没有这个学生' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const attempts = store.getDb().attempts
        .filter(a => a.userId === studentId)
        .slice(-limit)
        .reverse();
    res.json({ success: true, data: { student: auth.publicUser(student), attempts } });
});

router.post('/students', auth.requireTeacher, (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const password = String(body.password || '');

    const bad = auth.validateCredentials(name, password);
    if (bad) return res.status(400).json({ success: false, msg: bad });
    if (store.findUserByName(name)) {
        return res.status(409).json({ success: false, msg: '这个姓名已经被注册了' });
    }

    const { salt, hash } = auth.hashPassword(password);
    const user = {
        id: store.newId('u'),
        name,
        role: 'student',
        teacherId: req.user.id,
        inviteCode: null,
        salt,
        hash,
        createdAt: Date.now()
    };
    store.addUser(user);
    store.save();
    res.json({ success: true, data: { user: auth.publicUser(user) } });
});

module.exports = router;
// 计分口径对测试也可见（test/api.test.js 直接引用这几项做对照）
module.exports.classify = classify;
module.exports.summarize = summarize;
module.exports.buildCounts = buildCounts;
module.exports.BUCKETS = BUCKETS;
module.exports.CORRECT_BUCKETS = CORRECT_BUCKETS;
