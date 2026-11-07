const { rationalize } = require('mathjs');

// 1. 基础随机函数
function rand(min, max, excludeZero = true) {
    let val;
    do { val = Math.floor(Math.random() * (max - min + 1)) + min; }
    while (excludeZero && val === 0);
    return val;
}

// 2. 核心零件：标准化项生成 (处理 1x -> x, -1x -> -x)
function formatTerm(coef, variable) {
    if (coef === 0) return '0';
    if (variable === '') return `${coef}`; // 常数项
    if (coef === 1) return variable;
    if (coef === -1) return `-${variable}`;
    return `${coef}${variable}`;
}

// 3. 完美去重的多项式生成器（解决同类项和双常数问题）
// pool: 允许的项类型，例如 ['const', 'x', 'x^2']
// num: 需要几项 (必须 <= pool.length)
function genPoly(pool, num, minCoef, maxCoef) {
    // 随机打乱池子并抽出 num 个不同的项类型
    const selectedTypes = [...pool].sort(() => 0.5 - Math.random()).slice(0, num);

    // 生成对应的项
    const terms = selectedTypes.map(type => {
        const coef = rand(minCoef, maxCoef);
        return formatTerm(coef, type === 'const' ? '' : type);
    });

    // 拼接并处理符号 (例如 "3x" 和 "-5" 拼成 "3x - 5")
    return terms.reduce((acc, term, idx) => {
        if (idx === 0) return term;
        return term.startsWith('-') ? `${acc} - ${term.slice(1)}` : `${acc} + ${term}`;
    }, "");
}

// 4. 四个难度的模板库
function buildTemplate(level) {
    if (level === 1) {
        // ① 入门：练去括号变号
        const A = rand(-10, 10);
        const P1 = genPoly(['const', 'x'], 2, -5, 5); // 必定是一次项+常数
        const type = rand(1, 4);
        if (type === 1) return `${A} - (${P1})`;
        if (type === 2) return `${A} + (${P1})`;
        if (type === 3) return `-(${P1}) + ${A}`;
        return `-(${P1})`;
    }
    else if (level === 2) {
        // ② 基础：数字乘括号，分配律
        const k1 = rand(-5, 5);
        const k2 = rand(-5, 5);
        const P1 = genPoly(['const', 'x'], 2, -10, 10);
        const P2 = genPoly(['const', 'x'], 2, -10, 10);
        const mono = formatTerm(rand(-5, 5), 'x');
        const type = rand(1, 4);

        if (type === 1) return `${k1}(${P1}) - ${k2}(${P2})`;
        if (type === 2) return `${k1}(${P1}) - ${mono}`;
        if (type === 3) return `(${P1}) + ${k2}(${P2})`;
        return `(${P1}) - ${k2}(${P2})`;
    }
    else if (level === 3) {
        // ③ 进阶：嵌套、平方、单项式乘括号
        const k = rand(-4, 4);
        const mono = formatTerm(rand(-4, 4), 'x');
        const P1 = genPoly(['const', 'x', 'x^2'], rand(2, 3), -6, 6);
        const P2 = genPoly(['const', 'x', 'x^2'], 2, -6, 6);
        const P3 = genPoly(['const', 'x'], 2, -4, 4);
        const type = rand(1, 4);

        if (type === 1) return `${mono} - ${k}(${P1} - (${P3}))`; // 嵌套
        if (type === 2) return `${k}(${P1}) - ${mono}`;
        if (type === 3) return `x(${P3}) - ${k}(${P2})`; // x乘括号
        return `${mono} - (${k}(${P3}) - ${rand(1, 9)})`;
    }
    else {
        // ④ 挑战：a b 双字母
        const k1 = rand(-4, 4);
        const k2 = rand(-4, 4);
        const mono = formatTerm(rand(-4, 4), rand(1, 2) === 1 ? 'a' : 'b');
        // 项池加入双字母特性
        const pool = ['const', 'a', 'b', 'ab', 'a^2', 'b^2'];
        const P1 = genPoly(pool, rand(2, 3), -5, 5);
        const P2 = genPoly(pool, 2, -5, 5);
        const type = rand(1, 4);

        if (type === 1) return `${mono} - ${k1}(${P1}) + ${formatTerm(k2, 'b')}`;
        if (type === 2) return `${k1}(${P1}) - ${k2}(${P2})`;
        if (type === 3) return `a(${genPoly(['a', 'b'], 2, -3, 3)}) - ${k2}(${P2})`;
        return `-(${P1}) + ${k2}(${P2})`;
    }
}

// 5. 提示生成器
function getHint(expr) {
    if (/\-\s*\(|\)\s*\-/.test(expr)) {
        return "提示：括号前面是减号，去掉括号时里面每一项都要变号，别只改第一项。";
    }
    if (/\d+\s*\(|\)\s*\d+/.test(expr)) {
        return "提示：括号外面的数字要乘到括号里的每一项，别漏乘最后一项。";
    }
    return "提示：先乘进括号，再去掉括号，最后合并同类项（字母和指数相同的项）。";
}

// 6. 最终的生成流水线 (带质量闸门)
function generateQuestion(level = 1) {
    const maxTries = 500;

    for (let i = 0; i < maxTries; i++) {
        const expr = buildTemplate(level);

        // 闸门 1：必须有括号
        if (!expr.includes('(')) continue;

        let ansStr;
        try {
            // 利用上一节我们写的判卷逻辑核心，算出绝对标准答案
            ansStr = rationalize(expr).toString().replace(/\s/g, '');
        } catch (e) { continue; }

        // 闸门 2：答案不能是 0
        if (ansStr === '0') continue;

        // 闸门 3：题面不能等于答案 (清理空格后对比)
        if (expr.replace(/\s/g, '') === ansStr) continue;

        // 闸门 4：项数控制 (2 到 6 项)
        const termCount = ansStr.split(/(?=[+-])/).filter(t => t !== '').length;
        if (termCount < 2 || termCount > 6) continue;

        // 闸门 5：排除 4 次及以上的项 (初中不考)
        if (ansStr.includes('^4') || ansStr.includes('^5')) continue;

        // 全部通过，输出成品
        return {
            level: level,
            question: expr,
            answer: ansStr, // 内部记录的标准答案，不显示给学生
            hint: getHint(expr)
        };
    }

    // 兜底方案
    return {
        level: level,
        question: '3 - (x + 3)',
        answer: '-x',
        hint: '提示：括号前面是减号，去掉括号时里面每一项都要变号。'
    };
}

// --- 测试 ---
console.log(generateQuestion(1));
console.log(generateQuestion(2));
console.log(generateQuestion(3));
console.log(generateQuestion(4));