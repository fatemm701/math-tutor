// test/engine.test.js —— 引擎自检：出题质量 / 分步解析 / 判卷 / 提示
// 用法：node test/engine.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));

const createMathCore = require(path.join(root, 'frontend/js/math-core.js'));
const createSimplifyEngine = require(path.join(root, 'frontend/js/engine-simplify.js'));

const core = createMathCore(math);
const E = createSimplifyEngine(math, core);

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else if (fails.length < 20) fails.push(msg); else fails.length++; };
const norm = (s) => String(s).replace(/\s+/g, '');
const samePoly = (a, b) => E.samePoly(a, b);
const answerOf = (question) => E.formatPoly(E.parseToPoly(question)).replace(/\s/g, '');
// ---------- 0. 分层检查：计算模块不依赖浏览器 ----------
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mathCoreSource = readText('frontend/js/math-core.js');
const simplifySource = readText('frontend/js/engine-simplify.js');
const practiceHtml = readText('frontend/practice.html');
const practiceSource = readText('frontend/js/practice.js');
const browserApi = /\b(document|window|katex|localStorage|fetch|confirm|alert)\b/;
ok(!browserApi.test(mathCoreSource), 'math-core.js 不应依赖浏览器 API');
ok(!browserApi.test(simplifySource), 'engine-simplify.js 不应依赖浏览器 API');
ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(practiceHtml), 'practice.html 不应再有内联脚本');
ok(!/\bfunction\s+(expandExpr|polyMul|generateQuestion|evaluateAnswer|buildSteps|hintsFor)\b/.test(practiceSource), 'practice.js 不应再定义数学引擎函数');
ok(typeof core.expandExpr === 'function' && typeof core.parseToPoly === 'function', 'math-core.js 应导出基础多项式函数');
ok(typeof core.toLatexText === 'function', 'math-core.js 应导出 toLatexText');
ok(JSON.stringify(core.VAR_ORDER) === JSON.stringify(['x', 'y', 'a', 'b']),
    '变量顺序应为 x、y、a、b（a、b 只用于兼容旧题），实际 ' + JSON.stringify(core.VAR_ORDER));
// 旧题目（改版前生成的 a/b 题）仍要能解析、判等 —— 教师看板里存着这些记录
const legacyPoly = core.parseToPoly('a(b + 2) - 3(a^2 - ab)');
ok(core.formatPoly(legacyPoly) === '-3a^2 + 4ab + 2a',
    '旧 a/b 题应仍可解析并按新排序输出，实际 ' + core.formatPoly(legacyPoly));
// 指数用逐位相加：两位指数（x^6·x^6）应报错而不是串位算错
let overflowErr = '';
try { core.parseToPoly('x^6*x^6'); } catch (e) { overflowErr = e.message; }
ok(/指数/.test(overflowErr), '指数越界应明确报错，实际: ' + overflowErr);
ok(typeof E.generateQuestion === 'function' && typeof E.evaluateAnswer === 'function'
    && typeof E.buildSteps === 'function' && typeof E.hintsFor === 'function',
    'engine-simplify.js 应导出完整化简引擎 API');

// ---------- 1. 出题质量 + 分步解析：4 档各 300 道 ----------
const stats = {};
for (let lv = 1; lv <= 4; lv++) {
    stats[lv] = { steps: 0, n: 0 };
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv);
        stats[lv].n++;

        ok(!/(^|[^\d.])1\(/.test(q.question), '题面出现 1(...): ' + q.question);
        ok(!/-1\(/.test(q.question), '题面出现 -1(...): ' + q.question);
        ok(!/[+\-]{2}/.test(norm(q.question)), '题面出现连续符号: ' + q.question);
        ok(q.question.includes('('), '题面没有括号: ' + q.question);
        ok(q.question !== '3 - (x + 3)', 'L' + lv + ' 命中兜底题');

        ok(Array.isArray(q.tags), 'tags 应为数组: ' + q.question);
        ok(q.tags.every(t => t === 'fraction'), '出现未知标签: ' + q.question);
        if (lv === 1) ok(!q.tags.includes('fraction'), 'L1 不应混入分数题: ' + q.question);
        if (q.tags.includes('fraction')) {
            ok(q.question.includes('/'), '分数题题面应含 /: ' + q.question);
            ok(q.answer.includes('/'), '分数题答案应含 /: ' + q.question + ' => ' + q.answer);
        }

        const ans = answerOf(q.question);
        ok(ans === q.answer, '答案不一致: ' + q.question + ' | ' + q.answer + ' vs ' + ans);
        ok(ans !== '0', '答案不能是 0: ' + q.question);
        ok(!/[abx]\^([4-9])/.test(ans), '次数过高: ' + q.question);
        if (lv === 4) {
            // 挑战档统一用 x、y，不再出现 a、b
            ok(!/[ab]/.test(q.question), 'L4 题面不应出现 a、b: ' + q.question);
            ok(!/[ab]/.test(q.answer), 'L4 答案不应出现 a、b: ' + q.question + ' => ' + q.answer);
        } else {
            ok(!/y/.test(q.question), 'L' + lv + ' 不应出现 y: ' + q.question);
        }
        ok(/[xy]/.test(q.question), '题面应有 x 或 y: ' + q.question);

        const steps = E.buildSteps(q.question, q.answer);
        stats[lv].steps += steps.length;
        ok(Array.isArray(steps) && steps.length >= 2, '步数不足: ' + q.question);
        ok(norm(steps[steps.length - 1].expr) === norm(q.answer), '最后一步不是答案: ' + q.question);

        const ansPoly = E.parseToPoly(q.answer);
        steps.forEach((st, idx) => {
            let p = null;
            try { p = E.parseToPoly(st.expr); } catch (err) { p = null; }
            ok(!!p && samePoly(p, ansPoly), '第' + (idx + 1) + '步不等价: ' + st.expr + '  <- ' + q.question);
        });

        const hints = E.hintsFor(q.question);
        ok(Array.isArray(hints) && hints.length > 0 && hints.every(h => typeof h === 'string' && h),
            '提示异常: ' + q.question);
    }
}

// ---------- 2. 分步解析的固定样例（防止逻辑被改坏） ----------
const stepsOf = (question) => E.buildSteps(question, answerOf(question)).map(s => s.title + '|' + norm(s.expr));

ok(JSON.stringify(stepsOf('3 - (x + 3)')) === JSON.stringify([
    '原式|3-(x+3)',
    '去括号|3-x-3',
    '合并同类项|-x'
]), '3 - (x + 3) 的解析步骤不符: ' + JSON.stringify(stepsOf('3 - (x + 3)')));

ok(JSON.stringify(stepsOf('2(x - 3) - 4(x + 1)')) === JSON.stringify([
    '原式|2(x-3)-4(x+1)',
    '乘进括号|(2x-6)-(4x+4)',
    '去括号|2x-6-4x-4',
    '合并同类项|-2x-10'
]), '2(x - 3) - 4(x + 1) 的解析步骤不符: ' + JSON.stringify(stepsOf('2(x - 3) - 4(x + 1)')));

ok(JSON.stringify(stepsOf('-x - (4(x + 2) - 2)')) === JSON.stringify([
    '原式|-x-(4(x+2)-2)',
    '乘进括号|-x-(4x+8-2)',
    '括号内合并|-x-(4x+6)',
    '去括号|-x-4x-6',
    '合并同类项|-5x-6'
]), '嵌套题的解析步骤不符: ' + JSON.stringify(stepsOf('-x - (4(x + 2) - 2)')));

// 嵌套 ±1 括号（L3 type1 模板）：内层括号要留到「去括号」那一步才拆，不能被提前摊平
ok(JSON.stringify(stepsOf('2x + 3(6 + 2x^2 - (x + 4))')) === JSON.stringify([
    '原式|2x+3(6+2x^2-(x+4))',
    '乘进括号|2x+(18+6x^2-3(x+4))',
    '去括号|2x+18+6x^2-3x-12',
    '合并同类项|6x^2-x+6'
]), '嵌套 ±1 括号的解析步骤不符: ' + JSON.stringify(stepsOf('2x + 3(6 + 2x^2 - (x + 4))')));

ok(JSON.stringify(stepsOf('-x - 4(6x - 4 + 5x^2 - (-4x - 2))')) === JSON.stringify([
    '原式|-x-4(6x-4+5x^2-(-4x-2))',
    '乘进括号|-x-(24x-16+20x^2-4(-4x-2))',
    '去括号|-x-24x+16-20x^2-16x-8',
    '合并同类项|-20x^2-41x+8'
]), '嵌套负括号的解析步骤不符: ' + JSON.stringify(stepsOf('-x - 4(6x - 4 + 5x^2 - (-4x - 2))')));

// 字母乘括号：字母指数相加，括号内部先摊平
ok(JSON.stringify(stepsOf('x(x + 1) - 2(x^2 - 3)')) === JSON.stringify([
    '原式|x(x+1)-2(x^2-3)',
    '乘进括号|(x^2+x)-(2x^2-6)',
    '去括号|x^2+x-2x^2+6',
    '合并同类项|-x^2+x+6'
]), '字母乘括号的解析步骤不符: ' + JSON.stringify(stepsOf('x(x + 1) - 2(x^2 - 3)')));

// 双字母（挑战档）：xy 与 x^2 各算一类，不能合并到一起
ok(JSON.stringify(stepsOf('y(x + 2) - 3(x^2 - xy)')) === JSON.stringify([
    '原式|y(x+2)-3(x^2-xy)',
    '乘进括号|(xy+2y)-(3x^2-3xy)',
    '去括号|xy+2y-3x^2+3xy',
    '合并同类项|-3x^2+4xy+2y'
]), '双字母题的解析步骤不符: ' + JSON.stringify(stepsOf('y(x + 2) - 3(x^2 - xy)')));

// 分数系数：乘进括号后系数保留分数，答案/步骤统一用斜杠线性写法
ok(JSON.stringify(stepsOf('1/2(x + 4) - 3')) === JSON.stringify([
    '原式|1/2(x+4)-3',
    '乘进括号|(x/2+2)-3',
    '去括号|x/2+2-3',
    '合并同类项|x/2-1'
]), '分数题 1/2(x + 4) - 3 的解析步骤不符: ' + JSON.stringify(stepsOf('1/2(x + 4) - 3')));

ok(JSON.stringify(stepsOf('(x + 4)/2 - (x - 1)/3')) === JSON.stringify([
    '原式|(x+4)/2-(x-1)/3',
    '乘进括号|(x/2+2)-(x/3-1/3)',
    '去括号|x/2+2-x/3+1/3',
    '合并同类项|x/6+7/3'
]), '分数题 (x + 4)/2 - (x - 1)/3 的解析步骤不符: ' + JSON.stringify(stepsOf('(x + 4)/2 - (x - 1)/3')));

ok(JSON.stringify(stepsOf('1/2(x + 2y) - 1/3(x - y)')) === JSON.stringify([
    '原式|1/2(x+2y)-1/3(x-y)',
    '乘进括号|(x/2+y)-(x/3-y/3)',
    '去括号|x/2+y-x/3+y/3',
    '合并同类项|x/6+4y/3'
]), '分数题 1/2(x + 2y) - 1/3(x - y) 的解析步骤不符: ' + JSON.stringify(stepsOf('1/2(x + 2y) - 1/3(x - y)')));

// ---------- 3. 判卷 ----------
const judge = (student, question, expected) => {
    const r = E.evaluateAnswer(student, answerOf(question));
    ok(r.status === expected, '判卷 ' + student + ' vs ' + question + '：期望 ' + expected + '，实际 ' + r.status);
};
judge('-2x - 10', '2(x - 3) - 4(x + 1)', 'correct');
judge('  6x  -  10  ', '2(x - 3) - 4(x + 1) + 8x', 'correct');
judge('2x - 6 - 4x - 4', '2(x - 3) - 4(x + 1)', 'partial');       // 未合并
judge('2(x - 3) - 4(x + 1)', '2(x - 3) - 4(x + 1)', 'partial');   // 未去括号
judge('2x - 6 - 4x + 4', '2(x - 3) - 4(x + 1)', 'wrong');         // 变号错
judge('-4x - 20', '2(x - 3) - 4(x + 1)', 'wrong');                // 差 2 倍
judge('2x - 3 - 4x + 1', '2(x - 3) - 4(x + 1)', 'wrong');         // 漏乘
judge('6x - -10', '2(x - 3) - 4(x + 1)', 'error');                // 连续符号
judge('x +', '2(x - 3) - 4(x + 1)', 'error');                     // 语法错
judge('-x', '3 - (x + 3)', 'correct');
judge('3ab - 2a + 5b', 'a(3b) - 2a + 5b', 'correct');
judge('x/2 - 1', '1/2(x + 4) - 3', 'correct');
judge('(x + 4)/2 - 3', '1/2(x + 4) - 3', 'partial');   // 未去括号
judge('x/2 + 1', '1/2(x + 4) - 3', 'wrong');           // 常数算错

// ---------- 4. 提示分类 ----------
ok(E.hintsFor('3 - (x + 3)').some(h => /变号/.test(h)), 'L1 题应命中「变号」提示');
ok(E.hintsFor('2(x - 3) - 4(x + 1)').some(h => /漏乘/.test(h)), 'L2 题应命中「漏乘」提示');
ok(E.hintsFor('-x - (4(x + 2) - 2)').some(h => /套着括号/.test(h)), '嵌套题应命中「嵌套」提示');
ok(E.hintsFor('1/2(x + 4) - 3').some(h => /漏乘/.test(h)), '分数题应命中「漏乘」提示');
ok(E.hintsFor('3 - 1/2(x + 4)').some(h => /变号/.test(h)), '分数题应命中「变号」提示');
ok(E.hintsFor('y(x + 2) - 3(x^2 - xy)').some(h => /x 和 y/.test(h)), '双字母题应命中「x/y」提示');
ok(E.hintsFor('x^2 + 2x - 1').some(h => /x²/.test(h)), '含平方的题应命中「x 和 x²」提示');

// ---------- 汇总 ----------
console.log('=== 引擎自检 ===');
for (let lv = 1; lv <= 4; lv++) {
    console.log('  L' + lv + '：300 道，平均解析步数 ' + (stats[lv].steps / stats[lv].n).toFixed(2));
}
console.log('  断言通过 ' + pass + ' 条');
if (fails.length) {
    console.log('  失败 ' + fails.length + ' 条：');
    fails.forEach(f => console.log('    ✗ ' + f));
    process.exitCode = 1;
} else {
    console.log('  全部通过');
}
