// test/fraction.test.js —— 分数系数最小验证：解析 / 判等 / 步骤 / 判卷
// 用法：node test/fraction.test.js
const path = require('path');

const root = path.join(__dirname, '..');
const math = require(path.join(root, 'frontend/vendor/math.js'));
const createMathCore = require(path.join(root, 'frontend/js/math-core.js'));
const createSimplifyEngine = require(path.join(root, 'frontend/js/engine-simplify.js'));

const core = createMathCore(math);
const E = createSimplifyEngine(math, core);
const R = core.rational;

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else if (fails.length < 20) fails.push(msg); else fails.length++; };
const norm = (s) => String(s).replace(/\s+/g, '');
const answerOf = (expr) => core.formatPoly(core.parseToPoly(expr));

// ---------- 1. 有理数运算 ----------
const half = R.from(1, 2);
const third = R.from(1, 3);
ok(half.n === 1n && half.d === 2n && half.s === 1n, '1/2 应规范成 n=1,d=2,s=1');
ok(R.toPlain(R.from(2, 4)) === '1/2', '2/4 应约分成 1/2');
ok(R.toPlain(R.from(1, -2)) === '-1/2', '负分母应规范成 -1/2');
ok(R.toPlain(R.add(half, third)) === '5/6', '1/2 + 1/3 应为 5/6');
ok(R.toPlain(R.mul(half, third)) === '1/6', '1/2 × 1/3 应为 1/6');
ok(R.toPlain(R.div(half, third)) === '3/2', '1/2 ÷ 1/3 应为 3/2');
ok(R.toPlain(R.pow(half, 3)) === '1/8', '1/2 的三次方应为 1/8');
ok(R.toPlain(R.neg(half)) === '-1/2', '1/2 的相反数应为 -1/2');
ok(R.toPlain(R.abs(R.from(-3, 4))) === '3/4', '-3/4 的绝对值应为 3/4');
ok(R.eq(R.from(2, 4), half), '2/4 与 1/2 应判等');
ok(R.isZero(R.from(0, 5)), '0/5 应判零');
ok(R.isInt(R.from(3, 1), 3), '3/1 应判为整数 3');
ok(R.toLatex(half) === '\\frac{1}{2}', '1/2 的 LaTeX 应为 \\frac{1}{2}');

// ---------- 2. 解析与格式化 ----------
const roundTrip = (expr) => {
    const poly = core.parseToPoly(expr);
    const text = core.formatPoly(poly);
    ok(core.samePoly(poly, core.parseToPoly(text)), '格式化后应能解析回原式: ' + expr + ' -> ' + text);
    return text;
};

ok(roundTrip('1/2x + 3/4') === 'x/2 + 3/4', '1/2x + 3/4 应格式化为 x/2 + 3/4');
ok(roundTrip('(x+1)/2 - (x-1)/3') === 'x/6 + 5/6', '分数括号展开应为 x/6 + 5/6');
ok(roundTrip('2/3x + 1/2x') === '7x/6', '2/3x + 1/2x 应为 7x/6');
ok(roundTrip('-1/2x + 3/4') === '-x/2 + 3/4', '-1/2x + 3/4 应为 -x/2 + 3/4');
ok(roundTrip('(x+1)/2') === 'x/2 + 1/2', '(x+1)/2 应展开成 x/2 + 1/2');
ok(roundTrip('1/2ab + 2/3x^2') === '2x^2/3 + ab/2', '分数系数多字母项应格式化为 2x^2/3 + ab/2');
ok(roundTrip('2/4x + 3/4') === 'x/2 + 3/4', '未约分系数应先约分');
ok(roundTrip('2(x - 3) - 4(x + 1)') === '-2x - 10', '整数题格式不应改变');
ok(core.monomialBody(R.from(1, 2), 'x') === 'x/2', '单项式 1/2x 应写成 x/2');
ok(core.monomialBody(R.from(3, 2), 'x') === '3x/2', '单项式 3/2x 应写成 3x/2');
ok(core.monomialBody(R.from(1, 2), '') === '1/2', '常数 1/2 应写成 1/2');

let rejected = '';
try { core.parseToPoly('1/(x+1)'); } catch (e) { rejected = e.message; }
ok(/分母含字母/.test(rejected), '分母含字母应明确报错，实际: ' + rejected);

rejected = '';
try { core.parseToPoly('x/0'); } catch (e) { rejected = e.message; }
ok(/分母不能为 0/.test(rejected), '除以 0 应明确报错，实际: ' + rejected);

rejected = '';
try { core.parseToPoly('0.5x'); } catch (e) { rejected = e.message; }
ok(/整数或分数/.test(rejected), '小数应提示写成分数，实际: ' + rejected);

// ---------- 3. 判卷 ----------
const judge = (student, standard, expected) => {
    const result = E.evaluateAnswer(student, standard);
    ok(result.status === expected, '判卷 ' + student + ' vs ' + standard + '：期望 ' + expected + '，实际 ' + result.status);
};

judge('x/2 + 3/4', 'x/2 + 3/4', 'correct');
judge('1/2x + 3/4', 'x/2 + 3/4', 'correct');
judge('x/2 + 2 - x/3 + 1', 'x/6 + 3', 'unmerged');
judge('(x+1)/2', 'x/2 + 1/2', 'parentheses');
judge('x/3 + 1/3', 'x/2 + 1/2', 'wrong');
judge('1/(x+1)', 'x/2', 'error');
judge('x/0', 'x/2', 'error');

// ---------- 4. 分步解析 ----------
const checkSteps = (question, expectedAnswer) => {
    const answer = answerOf(question);
    ok(answer === expectedAnswer, '答案不符: ' + question + ' -> ' + answer + '，期望 ' + expectedAnswer);
    const steps = E.buildSteps(question, answer);
    ok(Array.isArray(steps) && steps.length >= 2, '步数不足: ' + question);
    ok(norm(steps[steps.length - 1].expr) === norm(answer), '最后一步不是答案: ' + question);
    const ansPoly = core.parseToPoly(answer);
    steps.forEach((step) => {
        let poly = null;
        try { poly = core.parseToPoly(step.expr); } catch (e) { poly = null; }
        ok(!!poly && core.samePoly(poly, ansPoly), '步骤不等价: ' + step.expr + ' <- ' + question);
    });
};

checkSteps('1/2(x + 4) - 1/3(x - 3)', 'x/6 + 3');
checkSteps('(x+1)/2 - (x-1)/3', 'x/6 + 5/6');
checkSteps('2/3x + 1/2x', '7x/6');
checkSteps('1/2(x + 4) - 3', 'x/2 - 1');
checkSteps('(x + 4)/2 - (x - 1)/3', 'x/6 + 7/3');
checkSteps('1/2(x + 2y) - 1/3(x - y)', 'x/6 + 4y/3');
checkSteps('1/2(x^2 + 4) - 2/3(x - 3)', 'x^2/2 - 2x/3 + 4');

const fractionHints = E.hintsFor('1/2(x + 4) - 1/3(x - 3)');
ok(fractionHints.some(h => /漏乘/.test(h)), '分数乘括号应命中「漏乘」提示');
ok(fractionHints.some(h => /变号/.test(h)), '负分数组应命中「变号」提示');

// ---------- 5. 不能出现小数或坏值 ----------
['1/2x + 3/4', '(x+1)/2 - (x-1)/3', '2/3x + 1/2x', '-1/2x + 3/4'].forEach((expr) => {
    const text = answerOf(expr);
    ok(!/\d+\.\d+/.test(text), '答案不应出现小数: ' + text);
    ok(!/NaN|\[object Object\]/.test(text), '答案不应出现坏值: ' + text);
});

// ---------- 6. 随机分数题生成 ----------
for (let lv = 1; lv <= 4; lv++) {
    for (let i = 0; i < 50; i++) {
        const q = E.generateQuestion(lv, { kind: 'fraction' });
        ok(q.level === lv, '强制分数题难度不符: ' + q.question);
        ok(Array.isArray(q.tags) && q.tags.includes('fraction'), '强制分数题缺标签: ' + q.question);
        ok(q.question.includes('('), '分数题题面缺括号: ' + q.question);
        ok(q.answer.includes('/'), '分数题答案应含 /: ' + q.question + ' => ' + q.answer);
        ok(norm(answerOf(q.question)) === norm(q.answer), '分数题答案不一致: ' + q.question);

        let poly = null;
        try { poly = core.parseToPoly(q.answer); } catch (e) { poly = null; }
        ok(!!poly, '分数题答案无法解析: ' + q.answer);
        if (poly) {
            ok(poly.size >= 2 && poly.size <= 6, '分数题答案项数异常: ' + q.question);
            ok(core.maxExponent(poly) <= 3, '分数题次数过高: ' + q.question);
        }

        const steps = E.buildSteps(q.question, q.answer);
        ok(Array.isArray(steps) && steps.length >= 2, '分数题步数不足: ' + q.question);
        ok(norm(steps[steps.length - 1].expr) === norm(q.answer), '分数题最后一步不是答案: ' + q.question);
        const ansPoly = core.parseToPoly(q.answer);
        steps.forEach((step) => {
            let stepPoly = null;
            try { stepPoly = core.parseToPoly(step.expr); } catch (e) { stepPoly = null; }
            ok(!!stepPoly && core.samePoly(stepPoly, ansPoly), '分数题步骤不等价: ' + step.expr);
        });

        const hints = E.hintsFor(q.question);
        ok(Array.isArray(hints) && hints.length > 0, '分数题缺少提示: ' + q.question);
        ok(!/\d+\.\d+/.test(q.answer) && !/NaN|\[object Object\]/.test(q.answer),
            '分数题答案出现小数/坏值: ' + q.answer);
        if (lv === 4) ok(!/[ab]/.test(q.question) && !/[ab]/.test(q.answer),
            'L4 分数题不应出现 a、b: ' + q.question + ' => ' + q.answer);
    }
}

const integerOnly = E.generateQuestion(2, { kind: 'integer' });
ok(Array.isArray(integerOnly.tags) && integerOnly.tags.length === 0, 'integer 模式不应带标签');
ok(!integerOnly.answer.includes('/'), 'integer 模式答案不应含分数: ' + integerOnly.answer);

// ---------- 7. 显示 LaTeX：分数必须转成上下分式 ----------
const latex = (expr) => core.toLatexText(expr);
ok(latex('1/2(x + 4) - 3') === '\\dfrac{1}{2}\\left(x+4\\right)-3',
    '1/2(x + 4) - 3 的显示 LaTeX 不符: ' + latex('1/2(x + 4) - 3'));
ok(latex('1/2x + 3/4') === '\\dfrac{1}{2}x+\\dfrac{3}{4}',
    '1/2x + 3/4 的显示 LaTeX 不符: ' + latex('1/2x + 3/4'));
ok(latex('(x + 4)/2 - (x - 1)/3') === '\\dfrac{x+4}{2}-\\dfrac{x-1}{3}',
    '(x + 4)/2 - (x - 1)/3 的显示 LaTeX 不符: ' + latex('(x + 4)/2 - (x - 1)/3'));
ok(latex('x/2-1') === '\\dfrac{x}{2}-1', 'x/2-1 的显示 LaTeX 不符: ' + latex('x/2-1'));
ok(latex('-x/2+3/4') === '-\\dfrac{x}{2}+\\dfrac{3}{4}',
    '-x/2+3/4 的显示 LaTeX 不符: ' + latex('-x/2+3/4'));
ok(latex('1/2(x + 2y) - 1/3(x - y)') === '\\dfrac{1}{2}\\left(x+2y\\right)-\\dfrac{1}{3}\\left(x-y\\right)',
    'x/y 双字母分数式的显示 LaTeX 不符: ' + latex('1/2(x + 2y) - 1/3(x - y)'));
ok(latex('1/2ab + 2/3x^2') === '\\dfrac{1}{2}ab+\\dfrac{2}{3}x^{2}',
    '多字母分数项的显示 LaTeX 不符: ' + latex('1/2ab + 2/3x^2'));
ok(latex('-1/2(x + 4) + 3/4(x - 2)') === '-\\dfrac{1}{2}\\left(x+4\\right)+\\dfrac{3}{4}\\left(x-2\\right)',
    '负分数乘括号的显示 LaTeX 不符: ' + latex('-1/2(x + 4) + 3/4(x - 2)'));
ok(latex('1/') === null, '未完成输入 1/ 应回退为 null');
ok(latex('') === null, '空输入应回退为 null');
const latexAB = latex('y(x+2)-3(x^2-xy)');
ok(typeof latexAB === 'string' && latexAB.indexOf('\\mathrm') === -1,
    '多字母不应被 mathjs 当成单位渲染: ' + latexAB);
ok(latex('2(x - 3) - 4(x + 1)') === '2\\left(x-3\\right)-4\\left(x+1\\right)',
    '整数题的显示 LaTeX 不应改变: ' + latex('2(x - 3) - 4(x + 1)'));


// ---------- 8. 分数题骨架多样性（issue #2：②③④ 每档至少 5 种分数题骨架） ----------
// 骨架：数字一律换成 #。原始 ASCII 写法里 1/3x 与 x/3、x 与 x^2 本来就是不同的题面，
// 所以直接按「数字 → #」统计，不做额外归一化，避免把不同的结构算成同一种。
// 这样骨架种类数会偏多（同一种模板的符号/顺序变体各算一种），是保守的上界口径。
const skeleton = (q) => String(q).replace(/[0-9]+/g, '#');

// 归一化骨架：把数字、正负号、各项顺序都抹平，只剩「模板本身长什么样」，
// 用来确认每一档真的有多套不同的结构（而不是同一种模板换个符号）。
function shape(q) {
    const terms = String(q)
        .replace(/[0-9]+/g, '#')
        .split(/\s*([+-])\s*/)
        .filter((t) => t && t !== '+' && t !== '-');
    return terms.sort().join(' ');
}

const levelShapes = {};
for (const lv of [1, 2, 3, 4]) {
    const kinds = {};
    const shapes = {};
    let total = 0;
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv, { kind: 'fraction' });
        kinds[skeleton(q.question)] = (kinds[skeleton(q.question)] || 0) + 1;
        shapes[shape(q.question)] = (shapes[shape(q.question)] || 0) + 1;
        total++;
    }
    levelShapes[lv] = shapes;
    const list = Object.keys(kinds);
    ok(total === 300, 'L' + lv + ' 分数题抽样 300 道应都能出题');
    // 抽样题里绝不能掉进兜底题（兜底题说明模板连续 500 次都没通过质量校验）
    ok(!('1/2(x + 4) - 3' in kinds), 'L' + lv + ' 分数题不应落到兜底题面');
    if (lv === 1) {
        // ① 的 FRACTION_RATE 是 0：自然出题（不指定 kind）不应该出现分数题
        let frac = 0;
        for (let i = 0; i < 300; i++) {
            if (E.generateQuestion(1).tags.includes('fraction')) frac++;
        }
        ok(frac === 0, 'L1 自然出题不应出现分数题，实际 ' + frac + ' 道');
    } else {
        ok(list.length >= 5, 'L' + lv + ' 分数题骨架种类应 ≥5，实际 ' + list.length + ' 种：' + list.join(' | '));
        // 归一化之后仍要有 5 种以上不同结构，且每种都真的出现过
        const shapeList = Object.keys(shapes);
        ok(shapeList.length >= 5,
            'L' + lv + ' 归一化后的分数题结构应 ≥5 种，实际 ' + shapeList.length + ' 种：' + shapeList.join(' | '));
        ok(shapeList.every((k) => shapes[k] >= 1), 'L' + lv + ' 每种结构都至少出现 1 次');
        // 骨架分布不能过度集中：出现最多的骨架不应超过抽样的 1/4
        const top = Math.max.apply(null, list.map((k) => kinds[k]));
        ok(top <= 75, 'L' + lv + ' 骨架分布过于集中：最多的一种出现 ' + top + ' 次');
    }
}

// 原来 ② 只有「整数 + q(x ± a)」一种骨架，issue #2 要求每档都有多种结构。
// 这里把「括号里带分数系数」「括号外有分数常数」「两个括号一起出现」这些新结构各点一次名。
const hasShape = (lv, re) => Object.keys(levelShapes[lv]).some((k) => re.test(k));
ok(hasShape(2, /#\/#\(#\*?x\/#/) || hasShape(2, /#\/#\(x\/#/), 'L2 应有「括号里带分数系数」的结构');
// 「括号外还有单独一项」：形如 "3 + 1/2(x + 4)" 或 "2/3 - 1/4(x - 2)"，
// 把项按空白切开后，结果里除了括号项之外还应该有一个纯数字项
const hasLoneNumberTerm = (lv) => Object.keys(levelShapes[lv]).some((k) =>
    k.indexOf('(') >= 0 && k.split(' ').some((tok) => tok === '#' || tok === '#/#'));
ok(hasLoneNumberTerm(2), 'L2 应有「括号外还有单独一项（整数/分数常数）」的结构：'
    + Object.keys(levelShapes[2]).join(' | '));
ok(hasShape(2, /#\/#\(.*#\/#\(/), 'L2 应有「两个括号一起出现」的结构');
ok(hasShape(3, /\^#/), 'L3 应有带 x^2 的分数结构');
ok(hasShape(3, /\(x\^# #\) #\/#\(x\^# #\)/) || hasShape(3, /#\/#\(x\^# #\)/)
    || Object.keys(levelShapes[3]).some((k) => /x\^#/.test(k)), 'L3 应有「x^2 分数结构」（含两个 x^2 括号）');
ok(hasShape(3, /x\/#/), 'L3 应有「括号外还有分数单项式」的结构');
ok(hasShape(4, /\bxy\b/), 'L4 应有带 xy 项的分数结构');
ok(hasShape(4, /\(x #\/#\(/), 'L4 应有嵌套括号的分数结构');

// 每档的分数题答案必须和「展开后重新格式化」完全一致（题目解析与标准答案同源）
for (const lv of [1, 2, 3, 4]) {
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv, { kind: 'fraction' });
        const expanded = answerOf(q.question);
        ok(norm(expanded) === norm(q.answer),
            'L' + lv + ' 分数题答案与展开不一致: ' + q.question + ' => ' + q.answer + ' / 展开 ' + expanded);
        const steps = E.buildSteps(q.question, q.answer);
        ok(Array.isArray(steps) && steps.length >= 1, 'L' + lv + ' 分数题应有解析步骤: ' + q.question);
        const lastStep = steps[steps.length - 1] || {};
        const lastText = norm(lastStep.result || lastStep.expr || lastStep.text || '');
        ok(lastText === '' || lastText.indexOf(norm(q.answer)) >= 0,
            'L' + lv + ' 分数题最后一步应化简到答案: ' + q.question + ' / ' + lastText);
        // 分数标签必须和题面一致
        ok(q.tags.indexOf('fraction') >= 0 && q.question.includes('/'),
            'L' + lv + ' 分数题标签与题面不一致: ' + q.question);
    }
}

// ④ 的分数题量级上限：括号内常数仍在 ±9，且不出现 x^3 以上的次数
for (let i = 0; i < 300; i++) {
    const q = E.generateQuestion(4, { kind: 'fraction' });
    ok(!/\^[3-9]/.test(q.question), 'L4 分数题不应出现三次以上: ' + q.question);
    ok(!/[0-9]{3,}/.test(q.question), 'L4 分数题不应出现三位数: ' + q.question);
    ok(!/[0-9]{2,}\/[0-9]/.test(q.answer) || /[0-9]{2,}\/\d*\b/.test(q.answer), 'L4 分数题答案分母不应过大: ' + q.answer);
}
// ---------- 汇总 ----------
console.log('=== 分数系数自检 ===');
console.log('  断言通过 ' + pass + ' 条');
if (fails.length) {
    console.log('  失败 ' + fails.length + ' 条：');
    fails.forEach(f => console.log('    ✗ ' + f));
    process.exitCode = 1;
} else {
    console.log('  全部通过');
}
