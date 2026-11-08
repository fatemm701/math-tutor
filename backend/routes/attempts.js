// backend/routes/attempts.js —— 做题记录上报 / 学生查自己的记录
const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();

const RESULTS = ['correct', 'wrong', 'partial', 'error'];
const TAGS = ['fraction'];
const MAX_MS = 6 * 60 * 60 * 1000;

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// 标签只接受白名单，旧客户端不带 tags 时按整数题处理
function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(tag => TAGS.includes(tag)))].slice(0, 5);
}

router.post('/', auth.requireLogin, (req, res) => {
    const body = req.body || {};

    const result = RESULTS.includes(body.result) ? body.result : null;
    if (!result) return res.status(400).json({ success: false, msg: 'result 不合法' });

    const level = Number(body.level);
    if (![1, 2, 3, 4].includes(level)) {
        return res.status(400).json({ success: false, msg: 'level 不合法' });
    }

    const question = text(body.question, 300).trim();
    if (!question) return res.status(400).json({ success: false, msg: '缺少题目' });

    const clientId = text(body.clientId, 64).trim() || null;
    const db = store.getDb();

    // 同一道题重复上报（刷新、重试）只记一次
    if (clientId && db.attempts.some(a => a.userId === req.user.id && a.clientId === clientId)) {
        return res.json({ success: true, data: { duplicate: true } });
    }

    const attempt = {
        id: store.newId('a'),
        userId: req.user.id,
        clientId,
        level,
        tags: normalizeTags(body.tags),
        question,
        answer: text(body.answer, 200).trim(),
        studentAnswer: text(body.studentAnswer, 300).trim(),
        result,
        usedHint: !!body.usedHint,
        revealed: !!body.revealed,
        ms: Math.max(0, Math.min(Number(body.ms) || 0, MAX_MS)),
        createdAt: Date.now()
    };

    store.addAttempt(attempt);
    store.save();
    res.json({ success: true, data: { id: attempt.id } });
});

router.get('/mine', auth.requireLogin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const list = store.getDb().attempts
        .filter(a => a.userId === req.user.id)
        .slice(-limit)
        .reverse();
    res.json({ success: true, data: { attempts: list } });
});

module.exports = router;
