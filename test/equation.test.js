// test/equation.test.js —— 一元一次方程引擎自检：出题质量 / 分步解析 / 判题 / 提示 / LaTeX
// 用法：node test/equation.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 用浏览器实际加载的那份 mathjs（frontend/vendor/math.js），保证测试和线上一致
const math = require(path.join(root, 'frontend/vendor/math.js'));
const createMathCore = require(path.join(root, 'frontend/js/math-core.js'));
const createPolyTree = require(path.join(root, 'frontend/js/poly-tree.js'));
const createEquationEngine = require(path.join(root, 'frontend/js/equation-engine.js'));
const core = createMathCore(math);
const tree = createPolyTree(math, core);
const E = createEquationEngine(math, core, tree);

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else if (fails.length < 25) fails.push(msg); else fails.length++; };
const norm = (s) => String(s).replace(/\s+/g, '');
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const R = core.rational;

// ---------- 0. 分层检查：计算模块不依赖浏览器 ----------
const engineSource = readText('frontend/js/equation-engine.js');
const treeSource = readText('frontend/js/poly-tree.js');
const simplifySource = readText('frontend/js/engine-simplify.js');
const browserApi = /\b(document|window|katex|localStorage|fetch|confirm|alert)\b/;
ok(!browserApi.test(engineSource), 'equation-engine.js 不应依赖浏览器 API');
ok(!browserApi.test(treeSource), 'poly-tree.js 不应依赖浏览器 API');
ok(!browserApi.test(simplifySource), 'engine-simplify.js 不应依赖浏览器 API');
// 两套引擎共用一份括号树：化简引擎里不应再留着自己的 PolyTerm/PolySum 定义
ok(!/class PolyTerm|class PolySum/.test(simplifySource), 'engine-simplify.js 不应再定义 PolyTerm/PolySum（已抽到 poly-tree.js）');
ok(typeof tree.PolyTerm === 'function' && typeof tree.PolySum === 'function', 'poly-tree.js 应导出 PolyTerm / PolySum');
ok(typeof E.generateQuestion === 'function' && typeof E.evaluateAnswer === 'function'
    && typeof E.buildSteps === 'function' && typeof E.hintsFor === 'function'
    && typeof E.toLatexText === 'function', 'equation-engine.js 应导出完整方程引擎 API');

// ---------- 1. 出题质量 + 分步解析：4 档各 300 道 ----------
const stats = {};
const L4_WITH_DEN_MIN = 300;   // 挑战档每道题都必须带数字分母
let l4WithDen = 0;
for (let lv = 1; lv <= 4; lv++) {
    stats[lv] = { n: 0, steps: 0 };
    for (let i = 0; i < 300; i++) {
        const q = E.generateQuestion(lv);
        stats[lv].n++;
        stats[lv].steps += E.buildSteps(q.question, q.answer).length;

        ok(q.level === lv, 'L' + lv + ' 题目 level 不对: ' + JSON.stringify(q));
        ok(typeof q.question === 'string' && q.question.includes('='), '题面应含等号: ' + q.question);
        ok(/^[^=]+ = [^=]+$/.test(q.question), '题面应是「左边 = 右边」且只有一个等号: ' + q.question);
        ok(!/[+\-]{2}/.test(norm(q.question)), '题面出现连续符号: ' + q.question);
        ok(!/\d\.\d/.test(q.question), '题面不应出现小数: ' + q.question);
        ok(!/[^0-9x+\-*/()^= .]/.test(q.question), '题面出现未知字符: ' + q.question);
        ok(/x/.test(q.question), '题面应含未知数 x: ' + q.question);
        ok(/^x=-?\d+(\/\d+)?$/.test(norm(q.answer)), '答案应是 x=整数/分数: ' + q.answer);
        ok(!/^x=0$/.test(norm(q.answer)), '答案不应是 0: ' + q.question + ' => ' + q.answer);
        ok(Array.isArray(q.tags) && q.tags.every(t => t === 'fraction'), 'tags 只允许 fraction: ' + JSON.stringify(q.tags));
        ok(q.tags.includes('fraction') === q.question.includes('/'), '分数标签应与题面一致: ' + q.question);
        if (lv === 4) { l4WithDen++; ok(q.question.includes('/'), 'L4 挑战档必须带数字分母: ' + q.question); }
        if (lv === 1) ok(!q.question.includes('(') && !q.question.includes('/'), 'L1 不应有括号和分母: ' + q.question);
        if (lv <= 2) ok(!q.question.includes('/'), 'L1-L2 不应出现分母: ' + q.question);

        // 出题自洽：题面解析后必须是「一次方程、唯一解、解与答案一致」
        let eq;
        try { eq = E.Equation.parse(q.question); } catch (err) { eq = null; }
        ok(!!eq, '题面应能解析: ' + q.question);
        if (eq) {
            const sol = eq.solution();
            ok(typeof sol !== 'string' && !R.isZero(sol), '题面必须有唯一非零解: ' + q.question);
            if (typeof sol !== 'string') {
                ok(R.eq(sol, E.parseEquation(q.answer).right.c), '答案与题面的解不一致: ' + q.question + ' => ' + q.answer);
            }
        }

        // 分步解析：每一步都与原方程同解，最后一步就是答案
        const steps = E.buildSteps(q.question, q.answer);
        ok(Array.isArray(steps) && steps.length >= 2, '步数不足: ' + q.question);
        ok(steps[0].title === '原方程' && norm(steps[0].expr) === norm(q.question), '首步应是原方程: ' + q.question);
        ok(norm(steps[steps.length - 1].expr) === norm(q.answer), '末步应等于答案: ' + q.question + ' => ' + steps[steps.length - 1].expr);
        ok(steps.every(s => typeof s.title === 'string' && s.title.length > 0), '每一步都应有标题: ' + q.question);
        ok(steps.every(s => /^[^\\{}]+$/.test(s.expr)), '步骤文本不应含 LaTeX 宏: ' + q.question);
        let prev = E.parseEquation(q.question);
        steps.forEach((st, idx) => {
            let stEq = null;
            try { stEq = E.parseEquation(st.expr); } catch (err) { stEq = null; }
            if (!stEq) { ok(false, '第' + (idx + 1) + '步无法解析: ' + q.question + ' || ' + st.expr); return; }
            ok(E.sameSolution(prev, stEq), '第' + (idx + 1) + '步与原方程不同解: ' + q.question + ' || ' + st.expr);
            prev = stEq;
        });

        // 题目自己的答案必须判对（负数、分数都要覆盖到）
        const self = E.evaluateAnswer(q.answer, q.answer);
        ok(self.status === 'correct', '标准答案应判 correct: ' + q.question + ' => ' + q.answer + ' 实际 ' + self.status);

        // 提示：至少两条，中文
        const hints = E.hintsFor(q.question);
        ok(Array.isArray(hints) && hints.length >= 2 && hints.every(h => typeof h === 'string' && h), '提示异常: ' + q.question);

        // LaTeX：题面与每一步都能转换
        ok(typeof E.toLatexText(q.question) === 'string', '题面 LaTeX 为空: ' + q.question);
        steps.forEach(s => ok(typeof E.toLatexText(s.expr) === 'string', '步骤 LaTeX 为空: ' + s.expr));
    }
}
ok(l4WithDen === L4_WITH_DEN_MIN, 'L4 带分母的题数应为 ' + L4_WITH_DEN_MIN + '，实际 ' + l4WithDen);

// 出题多样性：同一档连续 200 道不应只有一两道题（防止模板失效回落兜底题）
for (let lv = 1; lv <= 4; lv++) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(E.generateQuestion(lv).question);
    ok(seen.size >= 40, 'L' + lv + ' 出题太单一，200 道只有 ' + seen.size + ' 种题面');
}

// ---------- 2. 分步解析的固定样例（防止逻辑被改坏） ----------
const stepsOf = (question, answer) => E.buildSteps(question, answer).map(s => s.title + '|' + norm(s.expr));

ok(JSON.stringify(stepsOf('2x + 4 = 8', 'x=2')) === JSON.stringify([
    '原方程|2x+4=8',
    '移项|2x=-4+8',
    '合并同类项|2x=4',
    '化系数为一|x=2'
]), '2x + 4 = 8 的解析步骤不符: ' + JSON.stringify(stepsOf('2x + 4 = 8', 'x=2')));

ok(JSON.stringify(stepsOf('2(x - 1) = 3(x + 1) - 7', 'x=2')) === JSON.stringify([
    '原方程|2(x-1)=3(x+1)-7',
    '去括号|2x-2=3x+3-7',
    '移项|2x=3x+2+3-7',
    '移项|-3x+2x=2+3-7',
    '合并同类项|-x=-2',
    '化系数为一|x=2'
]), '带括号方程 2(x - 1) = 3(x + 1) - 7 的解析步骤不符: ' + JSON.stringify(stepsOf('2(x - 1) = 3(x + 1) - 7', 'x=2')));

// 分母在括号外面：先去分母，(x + 4) 的括号要保留到「去括号」那一步
ok(JSON.stringify(stepsOf('1/2(x + 4) = 3', 'x=2')) === JSON.stringify([
    '原方程|1/2(x+4)=3',
    '去分母|(x+4)=6',
    '去括号|x+4=6',
    '移项|x=-4+6',
    '合并同类项|x=2'
]), '分数方程 1/2(x + 4) = 3 的解析步骤不符: ' + JSON.stringify(stepsOf('1/2(x + 4) = 3', 'x=2')));

// 去分母：两边都有分母时同乘最小公倍数，1/3(2x - 1) 变成 2(2x - 1)
ok(JSON.stringify(stepsOf('1/2(x + 1) = 1/3(2x - 1) + 1', 'x=-1')) === JSON.stringify([
    '原方程|1/2(x+1)=1/3(2x-1)+1',
    '去分母|3(x+1)=2(2x-1)+6',
    '去括号|3x+3=4x-2+6',
    '移项|3x=4x-3-2+6',
    '移项|-4x+3x=-3-2+6',
    '合并同类项|-x=1',
    '化系数为一|x=-1'
]), '两边带分母的方程解析步骤不符: ' + JSON.stringify(stepsOf('1/2(x + 1) = 1/3(2x - 1) + 1', 'x=-1')));

// 移项一步只挪一项，且「把 x 挪到左边」也会单独成一步
ok(JSON.stringify(stepsOf('4 - x = 11', 'x=-7')) === JSON.stringify([
    '原方程|4-x=11',
    '移项|-x=-4+11',
    '合并同类项|-x=7',
    '化系数为一|x=-7'
]), '4 - x = 11 的解析步骤不符: ' + JSON.stringify(stepsOf('4 - x = 11', 'x=-7')));

// ---------- 3. 判题 ----------
const judge = (student, question, expected) => {
    const r = E.evaluateAnswer(student, question);
    ok(r.status === expected, '判题 ' + JSON.stringify(student) + '（标准 ' + question + '）：期望 ' + expected + '，实际 ' + r.status);
};
// 等价写法都算对：带 x、不带 x、换到左边、分数约分、有限小数
judge('x=4', 'x=4', 'correct');
judge('4', 'x=4', 'correct');
judge('4=x', 'x=4', 'correct');
judge(' x = 4 ', 'x=4', 'correct');
judge('x=8/2', 'x=4', 'correct');
judge('x=2.5', 'x=5/2', 'correct');
judge('x=1/2', 'x=1/2', 'correct');
judge('0.5', 'x=1/2', 'correct');
// 负数解（回归：曾经把「=」后面的负号当连续符号）
judge('x=-3', 'x=-3', 'correct');
judge('x=-3/2', 'x=-3/2', 'correct');
judge('-4', 'x=-4', 'correct');
// 同解但没化系数为一
judge('2x=8', 'x=4', 'unmerged');
judge('x+3=7', 'x=4', 'unmerged');
judge('2x-8=0', 'x=4', 'unmerged');
// 解错
judge('x=5', 'x=4', 'wrong');
judge('5', 'x=4', 'wrong');
judge('x=-4', 'x=4', 'wrong');
judge('x=--3', 'x=-3', 'error');
// 格式错
judge('x+', 'x=4', 'error');
judge('', 'x=4', 'error');
judge('x=1=2', 'x=4', 'error');
judge('x=1.23456789012345', 'x=4', 'error');   // 位数太多的「小数」不当作有限小数
judge('6 - -3', 'x=4', 'error');               // 同一侧连续符号

// ---------- 4. 提示分类 ----------
ok(E.hintsFor('1/2(x + 1) = 3').some(h => /去分母/.test(h)), '带分母的题应讲「去分母」');
ok(E.hintsFor('2(x + 1) = 5').some(h => /去括号/.test(h)), '带括号的题应讲「去括号」');
ok(E.hintsFor('3x + 1 = 2x + 7').some(h => /移项|移到/.test(h)), '未知数在两边的题应讲「移项」');
ok(E.hintsFor('x + 3 = 7').every(h => !/去分母/.test(h)), '没有分母的题不应讲「去分母」');

// ---------- 5. LaTeX ----------
const latexOf = (text) => E.toLatexText(text);
ok(latexOf('2x + 3 = x + 7') === '2x+3\\;=\\;x+7', '整数方程 LaTeX 不符: ' + latexOf('2x + 3 = x + 7'));
ok(latexOf('x=4') === 'x\\;=\\;4', '单变量答案 LaTeX 不符: ' + latexOf('x=4'));
ok(latexOf('x/2=3') === '\\dfrac{x}{2}\\;=\\;3', '分数方程 LaTeX 不符: ' + latexOf('x/2=3'));
ok(latexOf('1/2(x+1) = 3/2') === '\\dfrac{1}{2}\\left(x+1\\right)\\;=\\;\\dfrac{3}{2}',
    '分数系数方程 LaTeX 不符: ' + latexOf('1/2(x+1) = 3/2'));
ok(latexOf('x=') === null && latexOf('') === null && latexOf(null) === null, '无法解析时应返回 null');

// ---------- 汇总 ----------
console.log('=== 方程引擎自检 ===');
for (let lv = 1; lv <= 4; lv++) {
    console.log('  L' + lv + '：' + stats[lv].n + ' 道，平均解析步数 ' + (stats[lv].steps / stats[lv].n).toFixed(2));
}
console.log('  断言通过 ' + pass + ' 条');
if (fails.length) {
    console.log('  失败 ' + fails.length + ' 条：');
    fails.forEach(f => console.log('    ✗ ' + f));
    process.exitCode = 1;
} else {
    console.log('  全部通过');
}