// frontend/js/math-core.js —— 纯数学基础：表达式规范化、展开、多项式格式化
// 只依赖外部注入的 mathjs；不接触 DOM、KaTeX、网络和本地存储。

(function (global) {
    'use strict';

    // 有理数系数：底层用 mathjs Fraction，保证 1/2、3/4 这类系数不变成小数。
    // core 和步骤引擎统一通过 R 做运算，避免各自用 JS number 算。
    function createRational(math) {
        const F = (n, d = 1) => math.fraction(n, d);
        const asFraction = (value) => {
            if (value && typeof value === 'object'
                && typeof value.n === 'bigint' && typeof value.d === 'bigint' && typeof value.s === 'bigint') {
                return value;
            }
            return F(value);
        };
        const zero = F(0, 1);
        const one = F(1, 1);
        const minusOne = F(-1, 1);

        function from(n, d = 1) { return F(n, d); }
        function fromNumber(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) throw new Error('系数不合法');
            if (!Number.isInteger(n)) throw new Error('系数必须是整数或分数');
            return F(n);
        }
        function isZero(value) {
            if (value === undefined || value === null) return true;
            return asFraction(value).n === 0n;
        }
        function sign(value) {
            if (value === undefined || value === null) return 0;
            const f = asFraction(value);
            return f.n === 0n ? 0 : Number(f.s);
        }
        function abs(value) {
            const f = asFraction(value);
            return F(f.n, f.d);
        }
        function neg(value) {
            const f = asFraction(value);
            return F(-f.s * f.n, f.d);
        }
        function add(a, b) { return math.add(asFraction(a), asFraction(b)); }
        function sub(a, b) { return math.subtract(asFraction(a), asFraction(b)); }
        function mul(a, b) { return math.multiply(asFraction(a), asFraction(b)); }
        function div(a, b) { return math.divide(asFraction(a), asFraction(b)); }
        function pow(value, n) {
            if (!Number.isInteger(n) || n < 0) throw new Error('指数不合法');
            const f = asFraction(value);
            let out = one;
            for (let i = 0; i < n; i++) out = math.multiply(out, f);
            return out;
        }
        function eq(a, b) {
            if (a === undefined || a === null || b === undefined || b === null) return false;
            const x = asFraction(a);
            const y = asFraction(b);
            return x.n === y.n && x.d === y.d && x.s === y.s;
        }
        function cmp(a, b) {
            const x = asFraction(a);
            const y = asFraction(b);
            const left = x.s * x.n * y.d;
            const right = y.s * y.n * x.d;
            return left < right ? -1 : (left > right ? 1 : 0);
        }
        function isInt(value, n) {
            const f = asFraction(value);
            const target = typeof n === 'bigint' ? n : BigInt(n);
            return f.d === 1n && f.s * f.n === target;
        }
        function toPlain(value) {
            const f = asFraction(value);
            if (f.n === 0n) return '0';
            const prefix = f.s < 0n ? '-' : '';
            return f.d === 1n ? `${prefix}${f.n}` : `${prefix}${f.n}/${f.d}`;
        }
        function toLatex(value) {
            const f = asFraction(value);
            if (f.n === 0n) return '0';
            if (f.d === 1n) return String(f.s * f.n);
            const body = `\\frac{${f.n}}{${f.d}}`;
            return f.s < 0n ? `-${body}` : body;
        }

        return {
            zero, one, minusOne, from, fromNumber,
            isZero, sign, abs, neg, add, sub, mul, div, pow, eq, cmp, isInt,
            toPlain, toLatex
        };
    }

    function createMathCore(math) {
        const R = createRational(math);

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
                const c = R.fromNumber(node.value);
                return R.isZero(c) ? new Map() : new Map([['0,0,0', c]]);
            }
            if (node.isSymbolNode) {
                const idx = VAR_ORDER.indexOf(node.name);
                if (idx < 0) throw new Error('不支持的字母');
                const exp = [0, 0, 0];
                exp[idx] = 1;
                return new Map([[exp.join(','), R.one]]);
            }
            if (node.isOperatorNode) {
                if (node.op === 'unaryMinus' || (node.op === '-' && node.args.length === 1)) {
                    return polyScale(expandExpr(node.args[0]), R.minusOne);
                }
                if (node.op === '+' || node.op === '-') {
                    return polyAdd(expandExpr(node.args[0]), expandExpr(node.args[1]),
                        node.op === '-' ? R.minusOne : R.one);
                }
                if (node.op === '*') {
                    return polyMul(expandExpr(node.args[0]), expandExpr(node.args[1]));
                }
                if (node.op === '/') {
                    const numerator = expandExpr(node.args[0]);
                    const denominator = expandExpr(node.args[1]);
                    if (denominator.size === 0) throw new Error('分母不能为 0');
                    if (denominator.size !== 1 || !denominator.has('0,0,0')) {
                        throw new Error('分母含字母暂不支持');
                    }
                    return polyScale(numerator, R.div(R.one, denominator.get('0,0,0')));
                }
                if (node.op === '^') {
                    const exp = node.args[1].isConstantNode ? Number(node.args[1].value) : NaN;
                    if (!Number.isInteger(exp) || exp < 0 || exp > 6) throw new Error('指数不合法');
                    const base = expandExpr(node.args[0]);
                    let result = new Map([['0,0,0', R.one]]);
                    for (let i = 0; i < exp; i++) result = polyMul(result, base);
                    return result;
                }
            }
            throw new Error('表达式不支持');
        }

        function polyScale(poly, k) {
            const out = new Map();
            poly.forEach((c, key) => {
                const v = R.mul(c, k);
                if (!R.isZero(v)) out.set(key, v);
            });
            return out;
        }

        function polyAdd(a, b, sign) {
            const out = new Map(a);
            b.forEach((c, key) => {
                const v = R.add(out.get(key) || R.zero, R.mul(sign, c));
                R.isZero(v) ? out.delete(key) : out.set(key, v);
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
                    const v = R.add(out.get(key) || R.zero, R.mul(ca, cb));
                    R.isZero(v) ? out.delete(key) : out.set(key, v);
                });
            });
            return out;
        }

        function samePoly(a, b) {
            if (a.size !== b.size) return false;
            for (const [key, coef] of a) {
                if (!b.has(key) || !R.eq(coef, b.get(key))) return false;
            }
            return true;
        }

        // 单项式正文（不含正负号）：整数保持 2x，分数写成 x/2、3x/4
        function monomialBody(coef, varStr) {
            const a = R.abs(coef);
            if (R.isZero(a)) return '0';
            if (varStr === '') return R.toPlain(a);
            if (R.isInt(a, 1)) return varStr;
            if (a.d !== 1n) {
                const num = a.n === 1n ? '' : String(a.n);
                return `${num}${varStr}/${a.d}`;
            }
            return `${a.n}${varStr}`;
        }

        // 输出隐含乘号/分数写法：8ab - 2a + 3，x/2 + 3/4
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
                const body = monomialBody(t.coef, t.varStr);
                const negative = R.sign(t.coef) < 0;
                if (i === 0) return negative ? `-${body}` : body;
                return `${negative ? ' - ' : ' + '}${body}`;
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
            rational: R,
            normalizeExpr,
            expandExpr,
            polyScale,
            polyAdd,
            polyMul,
            samePoly,
            monomialBody,
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
