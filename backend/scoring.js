// backend/scoring.js —— 计分口径与筛选计数（老师看板 / 学生自查共用一份）
//
// 算对：独立做对、提示后做对           （提示没给答案，所以提示后做对算对）
// 算错：提示后做错、没去括号、没合并同类项、格式错、看解析
//
// 这里只管纯计算，不依赖 express / store，方便单测和复用。

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

module.exports = {
    BUCKETS,
    CORRECT_BUCKETS,
    PARTIAL_RESULTS,
    DAY_MS,
    isFraction,
    gaveUpOf,
    classify,
    isCorrectBucket,
    summarize,
    startOfToday,
    buildCounts
};