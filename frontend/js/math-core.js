// frontend/js/math-core.js —— 纯数学基础：表达式规范化、展开、多项式格式化
// 只依赖外部注入的 mathjs；不接触 DOM、KaTeX、网络和本地存储。

(function (global) {
    'use strict';

    function createMathCore(math) {
        // mathjs 会把隐式乘号当成单位或函数调用（a=are、b=bit、x(3) 当函数调用），
        // 解析前先补全显式乘号：3ab -> 3*a*b，x( -> x*(，)( -> )*(
        function normalizeExpr(expr) {
            let s = String(expr).replace(/\s+/g, '');
            s = s.replace(/([a-zA-Z)])(?=[a-zA-Z(])/g, '$1*'); // ab -> a*b, x( -> x*(, )( -> )*(
            s = s.replace(/(\d)(?=[a-zA-Z(])/g, '$1*');        // 3a -> 3*a, 3( -> 3*(
            s = s.replace(/([a-zA-Z)])(?=\d)/g, '$1*');        // x2 -> x*2
            return s;
        }

        // 把表达式展开成「单项式 -> 系数」，用于精确判等和输出最简答案
        // （mathjs 的 rationalize/simplify 处理 a、b 这种多字母多项式时会漏合并）
        const VAR_ORDER = ['x', 'a', 'b'];

        function expandExpr(node) {
            if (node.isParenthesisNode) return expandExpr(node.content);
            if (node.isConstantNode) {
                const v = Number(node.value);
                if (!Number.isInteger(v)) throw new Error('系数必须是整数');
                return v === 0 ? new Map() : new Map([['0,0,0', v]]);
            }
            if (node.isSymbolNode) {
                const idx = VAR_ORDER.indexOf(node.name);
                if (idx < 0) throw new Error('不支持的字母');
                const exp = [0, 0, 0];
                exp[idx] = 1;
                return new Map([[exp.join(','), 1]]);
            }
            if (node.isOperatorNode) {
                if (node.op === 'unaryMinus' || (node.op === '-' && node.args.length === 1)) {
                    return polyScale(expandExpr(node.args[0]), -1);
                }
                if (node.op === '+' || node.op === '-') {
                    return polyAdd(expandExpr(node.args[0]), expandExpr(node.args[1]), node.op === '-' ? -1 : 1);
                }
                if (node.op === '*') {
                    return polyMul(expandExpr(node.args[0]), expandExpr(node.args[1]));
                }
                if (node.op === '^') {
                    const exp = node.args[1].isConstantNode ? Number(node.args[1].value) : NaN;
                    if (!Number.isInteger(exp) || exp < 0 || exp > 6) throw new Error('指数不合法');
                    const base = expandExpr(node.args[0]);
                    let result = new Map([['0,0,0', 1]]);
                    for (let i = 0; i < exp; i++) result = polyMul(result, base);
                    return result;
                }
            }
            throw new Error('表达式不支持');
        }

        function polyScale(poly, k) {
            const out = new Map();
            poly.forEach((c, key) => {
                if (c * k !== 0) out.set(key, c * k);
            });
            return out;
        }

        function polyAdd(a, b, sign) {
            const out = new Map(a);
            b.forEach((c, key) => {
                const v = (out.get(key) || 0) + sign * c;
                v === 0 ? out.delete(key) : out.set(key, v);
            });
            return out;
        }

        function polyMul(a, b) {
            const out = new Map();
            a.forEach((ca, ka) => {
                const ea = ka.split(',').map(Number);
                b.forEach((cb, kb) => {
                    const eb = kb.split(',').map(Number);
                    const key = ea.map((v, i) => v + eb[i]).join(',');
                    const v = (out.get(key) || 0) + ca * cb;
                    v === 0 ? out.delete(key) : out.set(key, v);
                });
            });
            return out;
        }

        function samePoly(a, b) {
            if (a.size !== b.size) return false;
            for (const [key, coef] of a) {
                if (b.get(key) !== coef) return false;
            }
            return true;
        }

        // 输出隐含乘号的写法：8ab - 2a + 3
        function formatPoly(poly) {
            const terms = [...poly.entries()].map(([key, coef]) => {
                const exp = key.split(',').map(Number);
                let varStr = '';
                exp.forEach((e, i) => {
                    if (e === 1) varStr += VAR_ORDER[i];
                    else if (e > 1) varStr += `${VAR_ORDER[i]}^${e}`;
                });
                return { coef, varStr, exp, degree: exp.reduce((s, v) => s + v, 0) };
            }).sort((p, q) => (q.degree - p.degree)
                || (q.exp[2] - p.exp[2]) || (q.exp[1] - p.exp[1]) || (q.exp[0] - p.exp[0]));

            if (terms.length === 0) return '0';
            return terms.map((t, i) => {
                const abs = Math.abs(t.coef);
                const body = t.varStr === '' ? `${abs}` : (abs === 1 ? t.varStr : `${abs}${t.varStr}`);
                if (i === 0) return t.coef < 0 ? `-${body}` : body;
                return `${t.coef < 0 ? ' - ' : ' + '}${body}`;
            }).join('');
        }

        function parseToPoly(expr) {
            return expandExpr(math.parse(normalizeExpr(expr)));
        }

        function maxExponent(poly) {
            let max = 0;
            poly.forEach((c, key) => {
                key.split(',').forEach(e => { max = Math.max(max, Number(e)); });
            });
            return max;
        }
        return {
            VAR_ORDER,
            normalizeExpr,
            expandExpr,
            polyScale,
            polyAdd,
            polyMul,
            samePoly,
            formatPoly,
            parseToPoly,
            maxExponent
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createMathCore;
    } else {
        global.MathCore = createMathCore(global.math);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
