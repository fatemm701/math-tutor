// backend/routes/attempts.js —— 做题记录上报 / 学生查自己的记录
const express = require('express');
const store = require('../store');
const auth = require('../auth');
const scoring = require('../scoring');

const router = express.Router();

// parentheses = 答案对但没去括号；unmerged = 答案对但没合并同类项。
// partial 是旧客户端/旧版本用的，写入时统一归到 unmerged，避免老页面缓存上报被拒。
const RESULTS = ['correct', 'wrong', 'parentheses', 'unmerged', 'error'];
const LEGACY_RESULTS = { partial: 'unmerged' };
const TAGS = ['fraction', 'decimal'];
// 题型：整式化简 / 一元一次方程 / 口算训练。旧客户端不带 topic，写入时存 null，统计里按化简算。
// 'decimal' 只给口算题里的小数题打标记，目前只做透传（不单开计数口径）。
const TOPICS = ['simplify', 'equation', 'arithmetic'];
const MAX_MS = 6 * 60 * 60 * 1000;

function normalizeResult(value) {
    if (RESULTS.includes(value)) return value;
    if (Object.prototype.hasOwnProperty.call(LEGACY_RESULTS, value)) return LEGACY_RESULTS[value];
    return null;
}

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// 标签只接受白名单，旧客户端不带 tags 时按整数题处理
function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(tag => TAGS.includes(tag)))].slice(0, 5);
}

// 题型只接受白名单，缺省或非法值一律存 null（统计时回落成化简）
function normalizeTopic(value) {
    if (TOPICS.includes(value)) return value;
    return null;
}

router.post('/', auth.requireLogin, (req, res) => {
    const body = req.body || {};

    const result = normalizeResult(body.result);
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
        topic: normalizeTopic(body.topic),
        tags: normalizeTags(body.tags),
        question,
        answer: text(body.answer, 200).trim(),
        studentAnswer: text(body.studentAnswer, 300).trim(),
        result,
        usedHint: !!body.usedHint,
        revealed: !!body.revealed,
        // gaveUp 只在学生主动点「看解析」时为 true；revealed 含义不变（包括错两次被动给解析）
        gaveUp: !!body.gaveUp,
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

// 学生自己看自己的统计：只看本人记录，不接受任何 userId 参数，从接口层杜绝越权。
// 计分口径与老师看板共用 backend/scoring.js，两边数字天然一致。
router.get('/mine/summary', auth.requireLogin, (req, res) => {
    const now = Date.now();
    const list = store.getDb().attempts.filter(a => a.userId === req.user.id);
    res.json({
        success: true,
        data: {
            user: auth.publicUser(req.user),
            stats: scoring.summarize(list),
            counts: scoring.buildCounts(list, now),
            now
        }
    });
});

module.exports = router;
