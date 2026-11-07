const { rationalize } = require('mathjs');

function evaluateAnswer(studentAns, standardAns) {
    // 1. 语法防火墙
    if (/[+\-*/]{2,}/.test(studentAns.replace(/\s/g, ''))) {
        return { status: 'error', msg: '含有连续符号，请写成最简形式' };
    }

    try {
        // 2. 检查数学等价性
        const diff = rationalize(`(${studentAns}) - (${standardAns})`).toString();
        const isEquivalent = diff === '0';

        // 3. 检查是否还有括号
        const hasParentheses = /[()]/.test(studentAns);

        // 4. 终极绝招：对比“多项式的项数”
        const getTermCount = (expr) => {
            // 去除空格和乘号
            let clean = expr.replace(/[\s*]/g, '');
            // 按照加减号前瞻拆分 (例如 "-10+6x" 会被拆成 ["-10", "+6x"])
            const terms = clean.split(/(?=[+-])/).filter(t => t !== '');
            return terms.length;
        };

        const stuTermCount = getTermCount(studentAns);
        // 注意这里 rationalize 会输出类似 '6 * x - 10'
        const simpTermCount = getTermCount(rationalize(studentAns).toString());

        const isMerged = stuTermCount <= simpTermCount;

        if (isEquivalent && !hasParentheses && isMerged) {
            return { status: 'correct', msg: '完全正确' };
        } else if (isEquivalent && hasParentheses) {
            // 含有括号，说明第一步展开都没做完
            return { status: 'partial', msg: '未去括号' };
        } else if (isEquivalent && !hasParentheses && !isMerged) {
            // 没括号了，但是项数偏多，说明同类项没合并
            return { status: 'partial', msg: '未合并同类项' };
        } else {
            return { status: 'wrong', msg: '答案错误' };
        }
    } catch (e) {
        return { status: 'error', msg: '表达式无法解析，请检查拼写' };
    }
}

// --- 细化状态测试用例 ---
const standard = '2 * (x - 3) - 4 * (-x + 1)'; // 最简结果应为 6x - 10

console.log('测试 1 (带括号):', evaluateAnswer('2x - 6 - 4(-x + 1)', standard));
console.log('测试 2 (未合并):', evaluateAnswer('2x - 6 + 4x - 4', standard));
console.log('测试 3 (全做完):', evaluateAnswer('6x - 10', standard));