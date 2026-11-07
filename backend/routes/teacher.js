// backend/routes/teacher.js —— 老师看板数据 + 直接添加学生
const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();

// 计分口径：看了解析/答案的单独统计；用过提示的单独统计；剩下才进正确率
function bucketOf(attempt) {
    if (attempt.revealed) return 'revealed';
    if (attempt.usedHint) return 'hinted';
    return attempt.result === 'correct' ? 'correct' : 'wrong';
}

function summarize(list) {
    const stats = {
        total: 0,
        correct: 0,
        wrong: 0,
        hinted: 0,
        revealed: 0,
        scored: 0,
        accuracy: null,
        avgMs: 0,
        lastAt: null,
        byLevel: [1, 2, 3, 4].map(level => ({ level, total: 0, correct: 0, avgMs: 0 }))
    };
    let totalMs = 0;
    const levelMs = { 1: 0, 2: 0, 3: 0, 4: 0 };

    list.forEach(a => {
        const bucket = bucketOf(a);
        stats.total++;
        stats[bucket]++;
        totalMs += a.ms || 0;

        const row = stats.byLevel.find(r => r.level === a.level);
        if (row) {
            row.total++;
            levelMs[a.level] += a.ms || 0;
            if (bucket === 'correct') row.correct++;
        }
        if (!stats.lastAt || a.createdAt > stats.lastAt) stats.lastAt = a.createdAt;
    });

    stats.scored = stats.correct + stats.wrong;
    stats.accuracy = stats.scored ? Math.round((stats.correct / stats.scored) * 1000) / 10 : null;
    stats.avgMs = stats.total ? Math.round(totalMs / stats.total) : 0;
    stats.byLevel.forEach(row => {
        row.avgMs = row.total ? Math.round(levelMs[row.level] / row.total) : 0;
        row.accuracy = row.total ? Math.round((row.correct / row.total) * 1000) / 10 : null;
    });

    return stats;
}

router.get('/students', auth.requireTeacher, (req, res) => {
    const db = store.getDb();
    const students = db.users
        .filter(u => u.role === 'student' && u.teacherId === req.user.id)
        .map(u => ({
            user: auth.publicUser(u),
            stats: summarize(db.attempts.filter(a => a.userId === u.id))
        }));

    // 老师自己用这个账号试做的记录：单独给一块，不混进学生统计
    const selfAttempts = db.attempts.filter(a => a.userId === req.user.id);
    const self = selfAttempts.length
        ? { user: auth.publicUser(req.user), stats: summarize(selfAttempts) }
        : null;

    res.json({ success: true, data: { students, self } });
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
module.exports.bucketOf = bucketOf;
module.exports.summarize = summarize;
