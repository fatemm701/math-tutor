// test/engine.test.js —— 引擎自检：出题质量 / 分步解析 / 判卷 / 提示
// 用法：node test/engine.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));

const html = fs.readFileSync(path.join(root, 'frontend/practice.html'), 'utf8');
const start = html.indexOf('function rand(min, max, excludeZero');
const end = html.indexOf('// 2. 前端交互与防作弊逻辑');
if (start < 0 || end < 0) {
    console.error('无法在 frontend/practice.html 中定位引擎代码');
    process.exit(1);
}
const E = new Function('math', html.slice(start, end) +
    '\nreturn { generateQuestion, evaluateAnswer, parseToPoly, formatPoly, normalizeExpr, buildSteps, hintsFor };')(math);

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else if (fails.length < 20) fails.push(msg); else fails.length++; };
const norm = (s) => String(s).replace(/\s+/g, '');
const samePoly = (a, b) => a.size === b.size && [...a.entries()].every(([k, v]) => b.get(k) === v);
const answerOf = (question) => E.formatPoly(E.parseToPoly(question)).replace(/\s/g, '');

// ---------- 1. 出题质量 + 分步解析：4 档各 300 道 ----------
const stats = {};
for (let lv = 1; lv <= 4; lv++) {
    stats[lv] = { steps: 0, n: 0 };
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv);
        stats[lv].n++;

        ok(!/(^|[^\d.])1\(/.test(q.question), '题面出现 1(...): ' + q.question);
        ok(!/-1\(/.test(q.question), '题面出现 -1(...): ' + q.question);
        ok(q.question.includes('('), '题面没有括号: ' + q.question);
        ok(q.question !== '3 - (x + 3)', 'L' + lv + ' 命中兜底题');

        const ans = answerOf(q.question);
        ok(ans === q.answer, '答案不一致: ' + q.question + ' | ' + q.answer + ' vs ' + ans);
        ok(ans !== '0', '答案不能是 0: ' + q.question);
        ok(!/[abx]\^([4-9])/.test(ans), '次数过高: ' + q.question);

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

// ---------- 4. 提示分类 ----------
ok(E.hintsFor('3 - (x + 3)').some(h => /变号/.test(h)), 'L1 题应命中「变号」提示');
ok(E.hintsFor('2(x - 3) - 4(x + 1)').some(h => /漏乘/.test(h)), 'L2 题应命中「漏乘」提示');
ok(E.hintsFor('-x - (4(x + 2) - 2)').some(h => /套着括号/.test(h)), '嵌套题应命中「嵌套」提示');
ok(E.hintsFor('a(b + 2) - 3(a^2 - ab)').some(h => /a 和 b/.test(h)), '双字母题应命中「a/b」提示');
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
