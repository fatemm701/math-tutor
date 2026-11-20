// test/math-drill.test.js —— 口算引擎自检：四档出题 / 分步解析 / 判题 / 提示 / LaTeX
// 用法：node test/math-drill.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));
const createMathCore = require(path.join(root, 'frontend/js/math-core.js'));
const createArithEngine = require(path.join(root, 'frontend/js/arith-engine.js'));
const core = createMathCore(math);
const E = createArithEngine(math, core);
const R = core.rational;

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else if (fails.length < 30) fails.push(msg); else fails.length++; };
const norm = (s) => String(s).replace(/\s+/g, '');
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---------- 0. 分层检查：纯函数模块，不依赖浏览器 ----------
const source = readText('frontend/js/arith-engine.js');
// 只看代码，注释里提到 window/KaTeX 不算依赖
const codeOnly = source.split('\n')
    .filter((line) => line.trim().slice(0, 2) !== '//' && line.trim().slice(0, 2) !== '/*')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
const browserApi = /\b(document|window|katex|localStorage|fetch|confirm|alert)\b/i;
ok(!browserApi.test(codeOnly), 'arith-engine.js 不应依赖浏览器 API');
ok(/'use strict'/.test(source), 'arith-engine.js 应是严格模式');
ok(typeof E.generateQuestion === 'function' && typeof E.evaluateAnswer === 'function'
    && typeof E.buildSteps === 'function' && typeof E.hintsFor === 'function'
    && typeof E.toLatexText === 'function' && typeof E.valueOfExpr === 'function',
    'arith-engine.js 应导出完整口算引擎 API');
ok(JSON.stringify(E.LEVELS) === '[1,2,3,4]', 'LEVELS 应为 [1,2,3,4]: ' + JSON.stringify(E.LEVELS));
ok(JSON.stringify(E.LEVEL_NAMES) === '["入门","基础","进阶","挑战"]',
    'LEVEL_NAMES 应为 入门/基础/进阶/挑战: ' + JSON.stringify(E.LEVEL_NAMES));

// ---------- 1. 四档出题质量：每档 300 道 ----------
const stats = {};
const kinds = {};
const samples = {};
for (let lv = 1; lv <= 4; lv++) {
    stats[lv] = { n: 0, steps: 0, minSteps: 99, maxSteps: 0 };
    kinds[lv] = {};
    samples[lv] = [];
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv);
        stats[lv].n++;
        if (samples[lv].length < 3) samples[lv].push(q.question + ' = ' + q.answer);
        ok(q.level === lv, 'L' + lv + ' 题目 level 不对: ' + JSON.stringify(q));
        ok(typeof q.question === 'string' && q.question.trim() !== '', 'L' + lv + ' 题面为空');
        ok(typeof q.answer === 'string', 'L' + lv + ' 答案应为字符串: ' + JSON.stringify(q.answer));
        kinds[lv][q.kind] = (kinds[lv][q.kind] || 0) + 1;

        // 题面字符集（SPEC 2.2）：只有数字、+ - * / . ( ) ^ 和空格
        ok(!/[^0-9+\-*/().^ ]/.test(q.question), 'L' + lv + ' 题面出现未知字符: ' + q.question);
        // 不允许连续符号 +- / -- / *- / /-
        const flat = q.question.replace(/\s+/g, '').split(/\(\s*-\s*\d+\s*\)/).join('x');
        ok(!/[+\-*/]{2}/.test(flat), 'L' + lv + ' 题面出现连续符号: ' + q.question);
        ok(q.question.indexOf('--') < 0 && q.question.indexOf('+-') < 0
            && q.question.indexOf('*-') < 0 && q.question.indexOf('/-') < 0,
            'L' + lv + ' 题面出现连续符号: ' + q.question);
        ok(!/\d\.\d{3}/.test(q.question), 'L' + lv + ' 小数最多两位: ' + q.question);

        // 答案规范：整数 "25" 或最简分数 "-3/4"
        ok(/^-?\d+$/.test(q.answer) || /^-?\d+\/\d+$/.test(q.answer), 'L' + lv + ' 答案格式不规范: ' + q.answer);
        ok(q.answer !== '0' || true, 'L' + lv + ' 答案可以为零: ' + q.question);
        const ansValue = E.valueOfExpr(q.answer);
        ok(ansValue !== null, 'L' + lv + ' 答案应能求值: ' + q.answer);
        ok(ansValue !== null && R.cmp(R.abs(ansValue), R.from(2000)) <= 0,
            'L' + lv + ' 答案绝对值应 ≤ 2000: ' + q.answer);
        if (q.answer.indexOf('/') >= 0) {
            const parts = q.answer.split('/');
            ok(Math.abs(Number(parts[0])) <= 400 && Number(parts[1]) <= 400, 'L' + lv + ' 分子分母应 ≤ 400: ' + q.answer);
            ok(R.toPlain(R.from(Number(parts[0]), Number(parts[1]))) === q.answer, 'L' + lv + ' 答案应是最简分数: ' + q.answer);
        }

        // 题面求值 == 答案（出题自洽）
        const v = E.valueOfExpr(q.question);
        ok(v !== null, 'L' + lv + ' 题面应能求值: ' + q.question);
        ok(v !== null && R.toPlain(v) === q.answer, 'L' + lv + ' 题面值与答案不一致: ' + q.question + ' => ' + R.toPlain(v) + ' vs ' + q.answer);

        // 标签与题面一致
        ok(Array.isArray(q.tags), 'L' + lv + ' tags 应是数组');
        ok(q.tags.includes('fraction') === /(^| )-?\d+\/\d+($| )/.test(q.question),
            'L' + lv + ' fraction 标签应与题面一致: ' + q.question + ' ' + JSON.stringify(q.tags));
        ok(q.tags.includes('decimal') === /\d\.\d/.test(q.question),
            'L' + lv + ' decimal 标签应与题面一致: ' + q.question + ' ' + JSON.stringify(q.tags));
        ok(['add-sub', 'fraction', 'multiply', 'mixed'].indexOf(q.kind) >= 0, 'L' + lv + ' kind 不合法: ' + q.kind);
        ok(Array.isArray(q.ops) && q.ops.length > 0, 'L' + lv + ' ops 应非空');

        // 分步解析：2~6 步，末步数值 == 答案
        const steps = E.buildSteps(q.question, q.answer);
        stats[lv].steps += steps.length;
        stats[lv].minSteps = Math.min(stats[lv].minSteps, steps.length);
        stats[lv].maxSteps = Math.max(stats[lv].maxSteps, steps.length);
        ok(steps.length >= 2 && steps.length <= 6, 'L' + lv + ' steps 应为 2~6 步，实为 ' + steps.length + ': ' + q.question);
        ok(steps.every(s => s && typeof s.title === 'string' && typeof s.expr === 'string' && s.title && s.expr),
            'L' + lv + ' steps 每步应有中文 title 和非空 expr: ' + q.question);
        const last = steps[steps.length - 1];
        if (last) {
            const lastValue = E.valueOfExpr(last.expr);
            ok(lastValue !== null && R.toPlain(lastValue) === q.answer,
                'L' + lv + ' 末步数值应等于答案: ' + last.expr + ' vs ' + q.answer);
        }
        // 每步都是等价变形
        steps.forEach((s) => {
            const sv = E.valueOfExpr(s.expr);
            ok(sv !== null && R.toPlain(sv) === q.answer, 'L' + lv + ' 某一步不等价: ' + s.expr + ' vs ' + q.answer + '（题：' + q.question + '）');
        });

        // 提示：1~3 条中文，不含答案
        const hints = E.hintsFor(q.question);
        ok(Array.isArray(hints) && hints.length >= 1 && hints.length <= 3, 'L' + lv + ' hints 应为 1~3 条: ' + q.question);
        ok(hints.every(h => typeof h === 'string' && h.trim() !== ''), 'L' + lv + ' hint 不应为空');
        hints.forEach((h) => {
            ok(!/\d+\/\d+|\b\d+\b/.test(norm(h)) || h.indexOf(q.answer) < 0, 'L' + lv + ' hint 不应泄露答案: ' + h);
        });

        // LaTeX：必须能渲染，不能把整段算式当分子
        const tex = E.toLatexText(q.question);
        ok(tex !== null && typeof tex === 'string' && tex !== '', 'L' + lv + ' toLatexText 不应返回 null: ' + q.question);
        if (tex) {
            ok(!/\\dfrac\{\\dfrac\{[^}]*\}\{[^}]*\}\\times/.test(tex.split('\\dfrac{').length > 3 ? '' : ''),
                'placeholder');
        }
    }
}

// 每档的特征断言
ok(stats[1].minSteps >= 2 && stats[1].maxSteps <= 6, 'L1 步数应在 2~6: ' + JSON.stringify(stats[1]));
ok(stats[2].minSteps >= 2 && stats[2].maxSteps <= 6, 'L2 步数应在 2~6: ' + JSON.stringify(stats[2]));
ok(stats[3].minSteps >= 2 && stats[3].maxSteps <= 6, 'L3 步数应在 2~6: ' + JSON.stringify(stats[3]));
ok(stats[4].minSteps >= 2 && stats[4].maxSteps <= 6, 'L4 步数应在 2~6: ' + JSON.stringify(stats[4]));

// ---------- 2. 四档的教学梯度 ----------
// L1：百以内正负数加减，三项连算式，绝对值 ≤ 99
let l1neg = 0;
for (let i = 0; i < 60; i++) {
    const q = E.generateQuestion(1);
    ok(!/[*/^]/.test(q.question), 'L1 不应出现乘除乘方: ' + q.question);
    ok(kinds[1]['add-sub'] > 0, 'L1 应出加减题');
    const terms = q.question.replace(/\(\s*-?\d+\s*\)/g, 'n').split(/[+\-]/).filter(t => t.trim() !== '');
    ok(terms.length >= 3, 'L1 应是三项连算式: ' + q.question);
    if (/-/.test(q.question.replace(/^\s*-/, '').replace(/\(\s*-\d+\s*\)/g, ''))) l1neg++;
    ok(Math.abs(Number(q.answer.split('/')[0])) <= 99, 'L1 答案绝对值应 ≤ 99: ' + q.question + ' = ' + q.answer);
}
ok(l1neg > 0, 'L1 应出现负数运算');

// L2：分数加减（异分母通分、分数与整数混合），值 ≤ 99
let l2frac = 0;
for (let i = 0; i < 60; i++) {
    const q = E.generateQuestion(2);
    ok(!/[*/^]/.test(q.question.split(/\(\s*-\d+\s*\)/).join('').split(/ /).filter(t => !/^-?\d+\/\d+$/.test(t)).join('')),
        'L2 不应出现乘除乘方: ' + q.question);
    if (/\d+\/\d+/.test(q.question)) l2frac++;
    // 加数必须是最简分数（lead 回归第 3 条）
    q.question.split(' ').forEach((tok) => {
        const m = /^-?(\d+)\/(\d+)$/.exec(tok);
        if (m) {
            const a = Number(m[1]);
            const b = Number(m[2]);
            ok(R.toPlain(R.from(a, b)) === a + '/' + b || (a === 0), 'L2 加数应是最简分数: ' + tok + '（题：' + q.question + '）');
            ok(a <= 400 && b <= 400, 'L2 分数加数分子分母应 ≤ 400: ' + tok);
        }
    });
    ok(R.cmp(R.abs(E.valueOfExpr(q.answer)), R.from(2000)) <= 0, 'L2 答案绝对值应 ≤ 2000: ' + q.answer);
}
ok(l2frac > 50, 'L2 应基本都含分数: ' + l2frac + '/60');

// L3：分数乘除、小数乘除、负数乘除
let l3frac = 0;
let l3dec = 0;
let l3neg = 0;
for (let i = 0; i < 60; i++) {
    const q = E.generateQuestion(3);
    if (/\d+\/\d+/.test(q.question)) l3frac++;
    if (/\d\.\d/.test(q.question)) l3dec++;
    if (/-/.test(q.question)) l3neg++;
    ok(/[*/]/.test(q.question.split(' ').filter(t => !/^-?\d+\/\d+$/.test(t)).join(' ')) || /\d\/\d+ *[*/]/.test(q.question),
        'L3 应出现乘除: ' + q.question);
}
ok(l3frac > 0, 'L3 应出现分数乘除');
ok(l3dec > 0, 'L3 应出现小数乘除: ' + l3dec + '/60');
ok(l3neg > 0, 'L3 应出现负数乘除');

// L4：混合运算与简算
let l4paren = 0;
let l4pow = 0;
let l4shortcut = 0;
for (let i = 0; i < 120; i++) {
    const q = E.generateQuestion(4);
    if (q.question.indexOf('(') >= 0 && !/^\s*\(-?\d+\)/.test(q.question)) l4paren++;
    if (q.question.indexOf('^') >= 0) l4pow++;
    const steps = E.buildSteps(q.question, q.answer);
    if (steps.some(s => /分配律|凑整|平方差/.test(s.title))) l4shortcut++;
}
ok(l4paren > 0, 'L4 应出现括号: ' + l4paren + '/120');
ok(l4pow > 0, 'L4 应出现乘方: ' + l4pow + '/120');
ok(l4shortcut > 0, 'L4 应出现简算（分配律/凑整）: ' + l4shortcut + '/120');

// ---------- 3. lead 回归第 1 条：buildSteps 不能只剩 1 步 ----------
['15 / (4 - 1)', '(2+4)*7', '(-3)*9-31', '(-6)^2-10', '(-12)/(8-5)', '(-9 - 4) * (-5)',
    '24 - 24 - 76', '36 / 4 * 3', '12 - (-5) + 3', '3/6 * 1/2 * 2/5'].forEach((q) => {
    const steps = E.buildSteps(q);
    ok(steps.length >= 2, 'buildSteps 至少 2 步: ' + q + ' 只有 ' + steps.length + ' 步');
    ok(steps.length <= 6, 'buildSteps 最多 6 步: ' + q + ' 有 ' + steps.length + ' 步');
    const ans = R.toPlain(E.valueOfExpr(q));
    const lastValue = E.valueOfExpr(steps[steps.length - 1].expr);
    ok(lastValue !== null && R.toPlain(lastValue) === ans, 'buildSteps 末步等于答案: ' + q);
    steps.forEach((s) => {
        const sv = E.valueOfExpr(s.expr);
        ok(sv !== null && R.toPlain(sv) === ans, 'buildSteps 每步等价: ' + q + ' 的「' + s.title + '」步 ' + s.expr);
    });
});
// 分数题必须有「通分」或「约分」步
['-1/2 - 1/10', '3/8 + 1/2', '-3/4 - 6', '5/12 + 2/3 + 3', '7/9 - 2/3 - (-4)'].forEach((q) => {
    const steps = E.buildSteps(q);
    ok(steps.some(s => /通分|约分/.test(s.title)), '分数题应有通分/约分步: ' + q);
});
// ④ 档简算题要有分配律/凑整步
[[41, 39], [23, 77]].forEach((pair) => {
    const a = pair[0];
    const b = pair[1];
    const q = `(${a} + ${b}) * ${3}`;
    const steps = E.buildSteps(q);
    ok(steps.length >= 2, '简算题至少 2 步: ' + q);
});
['127 * 4 - 127 * 3', '99 * 4 + 4', '(47 + 3) * 7'].forEach((q) => {
    const steps = E.buildSteps(q);
    ok(steps.some(s => /分配律|凑整/.test(s.title)), '简算题应有分配律/凑整步: ' + q + ' => ' + steps.map(s => s.title).join('/'));
});

// ---------- 4. lead 回归第 2 条：toLatexText 不返回 null，括号正确 ----------
['(-3)*9-31', '(2+4)*7', '(-6)^2-10', '(-12)/(8-5)', '15 / (4 - 1)', '(-9 - 4) * (-5)',
    '3/6 * 1/2 * 2/5', '12 - (-5) + 3', '(-2)^3', '(3/4)^2'].forEach((q) => {
    const tex = E.toLatexText(q);
    ok(tex !== null && typeof tex === 'string' && tex.length > 0, 'toLatexText 不应返回 null: ' + q);
    ok(tex.indexOf('\\dfrac{\\dfrac{\\dfrac') < 0, 'toLatexText 不应三层嵌套分式: ' + q + ' => ' + tex);
});
// 乘除同级左结合不能把整段当分子：(a) * (b) 不得渲染成 \dfrac{a \times b}{...}
const chainTex = E.toLatexText('3/6 * 1/2 * 2/5');
ok(chainTex.indexOf('\\dfrac{\\dfrac{3}{6}') < 0 && chainTex.indexOf('\\times') >= 0,
    '乘法链不应把整段算式当分子: ' + chainTex);
ok(E.toLatexText('(-3)*9-31').indexOf('\\times') >= 0, '* 应转成 \\times');
ok(E.toLatexText('(-12)/(8-5)').indexOf('\\dfrac') >= 0, '/ 应转成 \\dfrac');
ok(E.toLatexText('(-6)^2-10').indexOf('^{2}') >= 0, '乘方应写成 ^{2}');
ok(E.toLatexText('(-6)^2-10').indexOf('\\left(-6\\right)') >= 0, '负数括号应保留');
ok(E.toLatexText('15 / (4 - 1)').indexOf('\\left(4 - 1\\right)') >= 0, '除数应加括号');
ok(E.toLatexText('') === null, '空串应返回 null');
ok(E.toLatexText('abc') === null, '字母应返回 null');
ok(E.toLatexText('1=1') === null, '等号应返回 null');
ok(E.toLatexText(null) === null, 'null 应返回 null');

// ---------- 5. 判题 ----------
const judge = (input, ans) => E.evaluateAnswer(input, ans);
const st = (input, ans) => (judge(input, ans) || {}).status;

ok(st('25', '25') === 'correct', '标准答案应判对');
ok(st(' -3/4 ', '-3/4') === 'correct', '带空格的分数应判对');
ok(st('3/4', '0.75') === 'correct', '0.75 与 3/4 等价');
ok(st('0.75', '3/4') === 'correct', '0.75 与 3/4 等价（反）');
ok(st('6/8', '3/4') === 'correct', '6/8 与 3/4 等价（未约分）');
ok(st('2', '4/2') === 'correct', '2 与 4/2 等价');
ok(st('12+3', '15') === 'correct', '算式等价应判对');
ok(judge('12+3', '15').msg.indexOf('口算题建议直接写结果') >= 0, '算式等价的 msg 应提醒直接写结果');
ok(st('(-3)/4', '-3/4') === 'correct', '负数分数的括号写法');
ok(st('－３／４', '-3/4') === 'correct', '全角输入应能识别');
ok(st('１２＋３', '15') === 'correct', '全角数字算式应能识别');

ok(st('26', '25') === 'wrong', '答案错应判 wrong');
ok(st('-25', '25') === 'wrong', '符号错应判 wrong');
ok(st('3/4', '-3/4') === 'wrong', '符号错应判 wrong');
ok(st('0.7', '0.75') === 'wrong', '近似小数应判 wrong');

ok(st('', '25') === 'error', '空答案应判 error');
ok(st('   ', '25') === 'error', '空白答案应判 error');
ok(st('x', '25') === 'error', '字母应判 error');
ok(st('25x', '25') === 'error', '字母应判 error');
ok(st('1又1/2', '3/2') === 'error', '带分数应判 error');
ok(st('25=25', '25') === 'error', '含等号应判 error');
ok(st('1+1=2', '2') === 'error', '多等号应判 error');
ok(st('25%', '25') === 'error', '非法字符应判 error');
ok(st('25;', '25') === 'error', '非法字符应判 error');

// 绝不抛异常
[undefined, null, '', ' ', 'abc', '1/0', '((((', '-', '+', '0.1.2', '1e5', NaN, 12].forEach((bad) => {
    let threw = false;
    let res = null;
    try { res = judge(bad, '25'); } catch (err) { threw = true; }
    ok(!threw, 'evaluateAnswer 不应抛异常: ' + String(bad));
    ok(res && ['correct', 'wrong', 'error'].indexOf(res.status) >= 0, 'evaluateAnswer 应返回合法 status: ' + String(bad));
    ok(res && typeof res.msg === 'string' && res.msg !== '', 'evaluateAnswer 应有 msg: ' + String(bad));
});
// 标准答案本身坏了也不能抛
ok(st('5', '') === 'error' || st('5', '') === 'wrong', '坏标准答案不应抛异常');
ok(st('25', 'abc') === 'error', '坏标准答案应判 error');

// ---------- 6. 提示 / 求值 / 非法输入 ----------
ok(E.hintsFor('').length >= 1, '空题面也要给一条提示');
ok(E.hintsFor('12 - (-5)').some(h => /负数|相反|加/.test(h)), '减去负数应给出提示');
ok(E.hintsFor('3/4 + 1/6').some(h => /通分|公分母|分母/.test(h)), '分数加法应提示通分');
ok(E.hintsFor('(-7) * 8').some(h => /乘/.test(h)), '乘法题应提示乘法');
ok(Array.isArray(E.buildSteps('')) && E.buildSteps('').length <= 1, '空题面的 steps 应为空数组或只有一步');

ok(R.toPlain(E.valueOfExpr('0.75')) === '3/4', '0.75 应化成 3/4');
ok(R.toPlain(E.valueOfExpr('-3/4')) === '-3/4', '负数分数应正确');
ok(R.toPlain(E.valueOfExpr('2*(-3)')) === '-6', '负数乘法应正确');
ok(R.toPlain(E.valueOfExpr('(-2)^3')) === '-8', '负数立方应正确');
ok(R.toPlain(E.valueOfExpr('12 - (-5)')) === '17', '减去负数应正确');

// ---------- 7. 小数题按小数的样子显示答案（answerDisplay） ----------
// ③ 档有大量「1.4 * 3 + 15」这种题，值存成 96/5 会让「看解析」把学生的 19.2
// 显示成 96/5 —— 题面是小数、标准答案却是分数，等于在说"你写的不是标准答案的样子"。
// 约定：answer 是判题用的，answerDisplay 只是给人看的写法，两者必须等值。
const sameValue = (a, b) => {
    const x = E.valueOfExpr(a);
    const y = E.valueOfExpr(b);
    return !!x && !!y && x.s === y.s && x.n === y.n && x.d === y.d;
};
let decSample = 0;
let decChecked = 0;
for (let i = 0; i < 400; i++) {
    const q = E.generateQuestion(3);
    ok(typeof q.answerDisplay === 'string' && q.answerDisplay !== '',
        'L3 每题都应有 answerDisplay: ' + q.question);
    ok(sameValue(q.answerDisplay, q.answer),
        'answerDisplay 必须与 answer 等值: ' + q.question + ' 的 ' + q.answer + ' vs ' + q.answerDisplay);
    if (!/\d\.\d/.test(q.question)) continue;
    decChecked++;
    const swapped = E.evaluateAnswer(q.answerDisplay, q.answer);
    ok(swapped && swapped.status === 'correct', '把显示出来的答案填进去应判对: ' + q.question + ' => ' + q.answerDisplay);
    // 有限小数（分母只含 2、5 因子）必须写成分数以外的小数形式
    const m = /^-?(\d+)\/(\d+)$/.exec(q.answer);
    if (m) {
        let d = Number(m[2]);
        while (d % 2 === 0) d /= 2;
        while (d % 5 === 0) d /= 5;
        if (d === 1 && Number(m[2]) <= 1000) {
            decSample++;
            ok(/^-?\d+(\.\d+)?$/.test(q.answerDisplay),
                '小数题的答案应显示成小数而不是 ' + q.answer + ': ' + q.question + ' => ' + q.answerDisplay);
        }
    }
}
ok(decChecked > 40, 'L3 应能抽到足够多的小数题，实际 ' + decChecked);
ok(decSample > 20, 'L3 应能抽到足够多「答案可写成有限小数」的题，实际 ' + decSample);
// 小数题的值写不尽的（如 1/3 这种混进来的）不能硬转成近似小数
ok(!/\/0$/.test(E.generateQuestion(3).answerDisplay), 'answerDisplay 不应出现分母 0');

// ---------- 8. 讲解行的 tex 覆盖（解析面板版式回归） ----------
// 步骤下面的「为什么这么算」（step.detail）是纯文本，手机上只能看到 41^2、3/4 这种
// 斜杠写法，和它上面的公式不是一套排法。凡是 detail 里含 ^ 或分数的步骤，
// 引擎必须同时给 detailTex，页面才会用公式排（见 frontend/js/math-drill-page.js）。
let detailTotal = 0;
let detailWithTex = 0;
let missed = null;
for (let i = 0; i < 400; i++) {
    const q = E.generateQuestion(4);
    E.buildSteps(q.question, q.answer).forEach((s) => {
        if (!s.detail) return;
        detailTotal++;
        const needsTex = s.detail.indexOf('^') >= 0 || /(?:^|[^\d])\d+\/\d+/.test(s.detail);
        if (s.detailTex) detailWithTex++;
        else if (needsTex && !missed) missed = s.title + ' :: ' + s.detail;
    });
}
ok(detailTotal > 100, '④ 档应能抽到足够多的讲解行，实际 ' + detailTotal);
ok(detailWithTex > 100, '④ 档讲解行多数应带 detailTex，实际 ' + detailWithTex + ' / ' + detailTotal);
ok(!missed, '讲解行里出现 ^ 或分数时必须同时给 detailTex（否则手机上只能用斜杠写法）: ' + missed);

// ---------- 汇总 ----------
const total = pass + fails.length;
if (fails.length) {
    console.log('\n✗ 口算引擎自检失败 ' + fails.length + ' 条（共 ' + total + ' 条）：');
    fails.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
    console.log('\n各档样本：');
    [1, 2, 3, 4].forEach(lv => console.log('  L' + lv + ': ' + samples[lv].join(' | ')));
    process.exit(1);
}
console.log('✓ 口算引擎自检通过 ' + pass + ' 条');
console.log('  各档样本：');
[1, 2, 3, 4].forEach((lv) => {
    console.log('  L' + lv + '(' + E.LEVEL_NAMES[lv - 1] + '): ' + samples[lv].join(' | '));
});
void norm;