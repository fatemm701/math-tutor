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
ok(roundTrip('1/2ab + 2/3x^2') === 'ab/2 + 2x^2/3', '分数系数多字母项应格式化为 ab/2 + 2x^2/3');
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
judge('x/2 + 2 - x/3 + 1', 'x/6 + 3', 'partial');
judge('(x+1)/2', 'x/2 + 1/2', 'partial');
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

const fractionHints = E.hintsFor('1/2(x + 4) - 1/3(x - 3)');
ok(fractionHints.some(h => /漏乘/.test(h)), '分数乘括号应命中「漏乘」提示');
ok(fractionHints.some(h => /变号/.test(h)), '负分数组应命中「变号」提示');

// ---------- 5. 不能出现小数或坏值 ----------
['1/2x + 3/4', '(x+1)/2 - (x-1)/3', '2/3x + 1/2x', '-1/2x + 3/4'].forEach((expr) => {
    const text = answerOf(expr);
    ok(!/\d+\.\d+/.test(text), '答案不应出现小数: ' + text);
    ok(!/NaN|\[object Object\]/.test(text), '答案不应出现坏值: ' + text);
});

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
