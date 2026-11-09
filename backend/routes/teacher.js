// backend/routes/teacher.js —— 老师看板数据 + 直接添加学生
const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();

// ---------- 计分口径（前后端必须一致，test/api.test.js 与 test/teacher.smoke.js 各有一份对照断言）----------
// 算对：独立做对、提示后做对           （提示没给答案，所以提示后做对算对）
// 算错：提示后做错、没去括号、没合并同类项、格式错、看解析
const BUCKETS = ['correct', 'hintedCorrect', 'hintedWrong', 'unmerged', 'error', 'revealed', 'wrong'];
const CORRECT_BUCKETS = ['correct', 'hintedCorrect'];
// 新记录用 result 区分「没去括号（parentheses）」和「没合并同类项（unmerged）」；
// 旧记录的 partial 分不出是哪一种，历史数据只能统一按 unmerged 计。
const PARTIAL_RESULTS = ['parentheses', 'unmerged', 'partial'];

function isFraction(attempt) {
    return Array.isArray(attempt.tags) && attempt.tags.includes('fraction');
}

// 旧记录没有 gaveUp 字段：只能靠「看到了完整解析且没做对」近似判定是主动看的
function gaveUpOf(attempt) {
    if (typeof attempt.gaveUp === 'boolean') return attempt.gaveUp;
    return attempt.revealed === true && attempt.result !== 'correct';
}

// 分类有优先级：看解析 > 提示后对/错 > 独立对 > 形式不标准 > 格式错 > 错
function classify(attempt) {
    if (gaveUpOf(attempt)) return 'revealed';
    if (attempt.usedHint) return attempt.result === 'correct' ? 'hintedCorrect' : 'hintedWrong';
    if (attempt.result === 'correct') return 'correct';
    if (PARTIAL_RESULTS.includes(attempt.result)) return 'unmerged';
    if (attempt.result === 'error') return 'error';
    return 'wrong';
}

function isCorrectBucket(bucket) {
    return CORRECT_BUCKETS.includes(bucket);
}

function emptyBucketStats() {
    const out = { total: 0, correct: 0, wrong: 0, hinted: 0, revealed: 0, gaveUp: 0, scored: 0, accuracy: null, avgMs: 0 };
    BUCKETS.forEach(b => { out[b] = 0; });
    return out;
}

function finishBuckets(stats, ms) {
    stats.hinted = stats.hintedCorrect + stats.hintedWrong;
    stats.correctCount = stats.correct + stats.hintedCorrect;   // 计入正确率的分子
    stats.scored = stats.total;                                 // 提示和看解析不再从分母里剔除
    stats.accuracy = stats.scored ? Math.round((stats.correctCount / stats.scored) * 1000) / 10 : null;
    stats.avgMs = stats.total ? Math.round(ms / stats.total) : 0;
    return stats;
}

function summarize(list) {
    const stats = emptyBucketStats();
    stats.lastAt = null;
    stats.fraction = emptyBucketStats();
    stats.byLevel = [1, 2, 3, 4].map(level => ({ level, total: 0, correct: 0, avgMs: 0, accuracy: null }));

    let totalMs = 0;
    let fractionMs = 0;
    const levelMs = { 1: 0, 2: 0, 3: 0, 4: 0 };

    list.forEach(a => {
        const bucket = classify(a);
        const ms = a.ms || 0;

        stats.total++;
        stats[bucket]++;
        if (gaveUpOf(a)) stats.gaveUp++;
        totalMs += ms;

        // 分数题单列口径，计分方式与总表一致
        if (isFraction(a)) {
            stats.fraction.total++;
            stats.fraction[bucket]++;
            fractionMs += ms;
        }

        const row = stats.byLevel.find(r => r.level === a.level);
        if (row) {
            row.total++;
            levelMs[a.level] += ms;
            if (isCorrectBucket(bucket)) row.correct++;
        }
        if (!stats.lastAt || a.createdAt > stats.lastAt) stats.lastAt = a.createdAt;
    });

    finishBuckets(stats, totalMs);
    finishBuckets(stats.fraction, fractionMs);
    stats.byLevel.forEach(row => {
        row.avgMs = row.total ? Math.round(levelMs[row.level] / row.total) : 0;
        row.accuracy = row.total ? Math.round((row.correct / row.total) * 1000) / 10 : null;
    });

    return stats;
}

// ---------- 筛选用的稀疏计数 ----------
// 看板要在「结果 × 难度 × 题型 × 时间范围」上组合筛选，又不想每次都拉全量明细，
// 所以这里按桶预先数好：counts[范围][结果][难度][fraction|integer] = 条数。
// 时间范围在服务端算好，避免浏览器时区和服务端对不齐。
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(now) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// 范围可以互相包含（今天 ⊂ 最近 7 天 ⊂ 全部），前端只要把选中的范围对应计数加起来即可
function rangeKeys(createdAt, todayStart, now) {
    const keys = ['all'];
    if (createdAt >= now - 7 * DAY_MS) keys.push('week');
    if (createdAt >= todayStart) keys.push('today');
    return keys;
}

function emptyCounts() {
    const counts = {};
    ['all', 'week', 'today'].forEach(range => {
        counts[range] = {};
        BUCKETS.forEach(bucket => {
            counts[range][bucket] = {};
            [1, 2, 3, 4].forEach(level => {
                counts[range][bucket][level] = { fraction: 0, integer: 0 };
            });
        });
    });
    return counts;
}

function buildCounts(list, now) {
    const stats = emptyCounts();
    const todayStart = startOfToday(now);
    list.forEach(a => {
        if (![1, 2, 3, 4].includes(a.level)) return;
        const bucket = classify(a);
        const kind = isFraction(a) ? 'fraction' : 'integer';
        rangeKeys(a.createdAt || 0, todayStart, now).forEach(range => {
            stats[range][bucket][a.level][kind]++;
        });
    });
    return stats;
}

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
module.exports.classify = classify;
module.exports.summarize = summarize;
module.exports.buildCounts = buildCounts;
module.exports.BUCKETS = BUCKETS;
module.exports.CORRECT_BUCKETS = CORRECT_BUCKETS;