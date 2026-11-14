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
// 题型：旧记录没有 topic 字段，一律按化简算，保证历史数据口径不变
// 顺序即看板上的展示顺序：整式化简 / 一元一次方程 / 口算训练
const TOPICS = ['simplify', 'equation', 'arithmetic'];

function isFraction(attempt) {
    return Array.isArray(attempt.tags) && attempt.tags.includes('fraction');
}

// 口算题（含分数口算、小数口算）：有自己的一类计数，不混进化简/方程的分数题口径
function isArithmetic(attempt) {
    return attempt.topic === 'arithmetic';
}

// 未知 / 缺省 topic 一律回落化简（旧客户端兼容）；只认白名单里的题型，别的一律当化简
function topicOf(attempt) {
    return TOPICS.includes(attempt.topic) ? attempt.topic : 'simplify';
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
    // 题型分表：化简 / 方程 / 口算各一份，计分方式与总表完全一致
    stats.byTopic = {};
    TOPICS.forEach(topic => {
        stats.byTopic[topic] = emptyBucketStats();
        stats.byTopic[topic].lastAt = null;
    });
    stats.byLevel = [1, 2, 3, 4].map(level => ({ level, total: 0, correct: 0, avgMs: 0, accuracy: null }));

    let totalMs = 0;
    let fractionMs = 0;
    const topicMs = { simplify: 0, equation: 0, arithmetic: 0 };
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

        // 题型分表：同一条记录按它自己的分类计入，两边加起来等于总表
        const topic = topicOf(a);
        stats.byTopic[topic].total++;
        stats.byTopic[topic][bucket]++;
        topicMs[topic] += ms;
        if (!stats.byTopic[topic].lastAt || a.createdAt > stats.byTopic[topic].lastAt) {
            stats.byTopic[topic].lastAt = a.createdAt;
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
    TOPICS.forEach(topic => finishBuckets(stats.byTopic[topic], topicMs[topic]));
    stats.byLevel.forEach(row => {
        row.avgMs = row.total ? Math.round(levelMs[row.level] / row.total) : 0;
        row.accuracy = row.total ? Math.round((row.correct / row.total) * 1000) / 10 : null;
    });

    return stats;
}

// ---------- 筛选用的稀疏计数 ----------
// 看板要在「结果 × 难度 × 题型 × 时间范围」上组合筛选，又不想每次都拉全量明细，
// 所以这里按桶预先数好：
//   counts[范围][结果][难度][fraction|integer|equation|equationFraction|arithmetic|arithmeticFraction] = 条数。
// 化简题照旧只落在 fraction / integer（按有没有「分数」标签拆）；
// 方程题只落在 equation，其中带「分数」标签的再额外落一份 equationFraction；
// 口算题只落在 arithmetic，其中带「分数」标签的再额外落一份 arithmeticFraction。
// equationFraction / arithmeticFraction 都是各自父字段的子集，不是另算一类，
// 带「小数（decimal）」标签的口算题只做标签透传，不单开计数叶子。
// 于是每个叶节点上恒成立：
//   「全部」  = fraction + integer + equation + arithmetic      （四个字段互不重叠）
//   「分数题」= fraction + equationFraction + arithmeticFraction  （只挑了各自带分数标签的那部分）
//   「方程题」= equation，「口算题」= arithmetic，「化简题」= fraction + integer
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
                counts[range][bucket][level] = {
                    fraction: 0,
                    integer: 0,
                    equation: 0,
                    equationFraction: 0,
                    arithmetic: 0,
                    arithmeticFraction: 0
                };
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
        const hasFraction = isFraction(a);
        const kind = hasFraction ? 'fraction' : 'integer';
        const isEquation = topicOf(a) === 'equation';
        const isArith = isArithmetic(a);
        rangeKeys(a.createdAt || 0, todayStart, now).forEach(range => {
            const cell = stats[range][bucket][a.level];
            // 三类题型互斥：先判口算，再判方程，剩下的（含旧记录、非法 topic）都算化简题
            if (isArith) {
                // 口算题只落 arithmetic，带分数标签再落一份子集 arithmeticFraction
                cell.arithmetic++;
                if (hasFraction) cell.arithmeticFraction++;
            } else if (isEquation) {
                // 方程题不计入化简题的 fraction / integer；旧记录（无 topic）已由 topicOf 回落成 simplify
                cell.equation++;
                if (hasFraction) cell.equationFraction++;
            } else {
                cell[kind]++;
            }
        });
    });
    return stats;
}

module.exports = {
    BUCKETS,
    CORRECT_BUCKETS,
    PARTIAL_RESULTS,
    TOPICS,
    DAY_MS,
    isFraction,
    isArithmetic,
    topicOf,
    gaveUpOf,
    classify,
    isCorrectBucket,
    summarize,
    startOfToday,
    buildCounts
};