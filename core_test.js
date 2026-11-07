const { rationalize } = require('mathjs');

// 核心判卷函数
function evaluateAnswer(studentAns, standardAns) {
    // 1. 语法防火墙：拦截连续符号 (例如 --, +-, -+, /*)
    // 先去掉空格，如果发现连续两个运算符号，直接打回
    if (/[+\-*/]{2,}/.test(studentAns.replace(/\s/g, ''))) {
        return { status: 'error', msg: '含有连续符号 (如 -- 或 +-)，请写成最简形式' };
    }

    try {
        // 2. 检查数学等价性
        const diff = rationalize(`(${studentAns}) - (${standardAns})`).toString();
        const isEquivalent = diff === '0';

        // 3. 检查括号
        const hasParentheses = /[()]/.test(studentAns);

        // 4. 检查是否合并了同类项（终极方案：剥离非本质字符后对比长度）
        // 去除学生答案中的空格、乘号（*）。如果学生开头写了 +，也去掉。
        let cleanStu = studentAns.replace(/[\s*]/g, '');
        if (cleanStu.startsWith('+')) cleanStu = cleanStu.slice(1);

        // 获取 math.js 化简后的绝对最简结果，同样去掉空格和乘号
        const cleanSimp = rationalize(studentAns).toString().replace(/[\s*]/g, '');

        // 如果学生的答案没有完全合并（比如 2x-4x，长度4），化简后是 -2x (长度3)
        // 只要学生的有效长度大于最简结果长度，说明一定有项没合并！
        const isMerged = cleanStu.length <= cleanSimp.length;

        if (isEquivalent && !hasParentheses && isMerged) {
            return { status: 'correct', msg: '完全正确' };
        } else if (isEquivalent) {
            return { status: 'partial', msg: '结果正确，但未完全化简去括号或合并同类项' };
        } else {
            return { status: 'wrong', msg: '答案错误' };
        }
    } catch (e) {
        return { status: 'error', msg: '表达式无法解析，请检查拼写' };
    }
}

// --- 测试用例 ---
const standard = '2 * (x - 3) - 4 * (-x + 1)'; // 标准答案应为 -2x - 10

console.log('测试 1 (标准答案):', evaluateAnswer('6x - 10', standard));
console.log('测试 2 (换个位置):', evaluateAnswer('-10 + 6x', standard));
console.log('测试 3 (未合并):', evaluateAnswer('2x - 6 - 4x - 4', standard));
console.log('测试 4 (带括号):', evaluateAnswer('-(2x + 10)', standard));
console.log('测试 5 (错答案):', evaluateAnswer('-2x + 10', standard));
console.log('测试 6 (连续符号):', evaluateAnswer('-2x - - 10', standard));
console.log('测试 7 (x+x这种未合并):', evaluateAnswer('-2x - 10 + x - x', standard));