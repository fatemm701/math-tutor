// frontend/js/engine-simplify.js —— 整式化简题型：出题、判题、分步解析、提示
// 依赖 math-core.js 提供的基础多项式能力、poly-tree.js 提供的「项 -> 括号 -> 项」树
// （方程引擎也用同一棵树），不接触 DOM、KaTeX、网络和本地存储。

(function (global) {
    'use strict';

    function createSimplifyEngine(math, core) {
        const {
            VAR_ORDER,
            normalizeExpr,
            parseToPoly,
            formatPoly,
            samePoly,
            maxExponent,
            monomialBody,
            rational: R
        } = core;
        // 浏览器端页面先加载 poly-tree.js；Node 端（测试）直接 require，两条路都要能取到
        const tree = core.tree || (typeof require === 'function'
            ? require('./poly-tree.js')(math, core)
            : global.PolyTree);
        if (!tree) throw new Error('poly-tree.js 未加载');
        const { PolyTerm, PolySum, normalizeForCompare } = tree;
        function rand(min, max, excludeZero = true) {
            let val;
            do { val = Math.floor(Math.random() * (max - min + 1)) + min; }
            while (excludeZero && val === 0);
            return val;
        }

        // 乘数系数：排除 0 和 ±1 —— 1(x + 3) 没有练习价值，-1(x + 3) 本来就该写成 -(x + 3)
        // 这样题面不会出现 1(...) / -1(...) 这种难看的写法
        function randMul(min, max) {
            let val;
            do { val = rand(min, max); } while (Math.abs(val) === 1);
            return val;
        }

        // 分数题混入比例：L1 保持整数入门，L2/L3/L4 逐档增加
        const FRACTION_RATE = { 1: 0, 2: 0.25, 3: 0.4, 4: 0.5 };
        // 分母限制在 2/3/4/6，分子取 1/3/5，避免过于繁琐的分数运算
        const FRACTION_COEFS = [
            R.from(1, 2), R.from(-1, 2),
            R.from(1, 3), R.from(-1, 3),
            R.from(2, 3), R.from(-2, 3),
            R.from(1, 4), R.from(-1, 4),
            R.from(3, 4), R.from(-3, 4),
            R.from(1, 6), R.from(-1, 6),
            R.from(5, 6), R.from(-5, 6)
        ];

        function formatTermR(coef, variable) {
            if (R.isZero(coef)) return '0';
            const body = monomialBody(coef, variable);
            return R.sign(coef) < 0 ? `-${body}` : body;
        }

        function formatTerm(coef, variable) {
            return formatTermR(R.fromNumber(coef), variable);
        }

        // 拼接两项，自动合并符号：同号得正、异号得负
        //   joinSigned('(4x + 10)', '-', '-4(x - 7)') -> '(4x + 10) + 4(x - 7)'
        //   joinSigned('3(x + 1)',  '-', '-5x')       -> '3(x + 1) + 5x'
        // 没有它的话，负系数的乘数接在写死的 +/- 后面就会出现 "+ -4(..)"、"- -5x"
        function joinSigned(left, op, right) {
            const text = String(right);
            const neg = text.startsWith('-');
            const body = neg ? text.slice(1) : text;
            const plus = (op === '+') !== neg;
            return `${left} ${plus ? '+' : '-'} ${body}`;
        }

        function genPoly(pool, num, minCoef, maxCoef) {
            const selectedTypes = [...pool].sort(() => 0.5 - Math.random()).slice(0, num);
            const terms = selectedTypes.map(type => formatTerm(rand(minCoef, maxCoef), type === 'const' ? '' : type));
            return terms.reduce((acc, term, idx) => {
                if (idx === 0) return term;
                return term.startsWith('-') ? `${acc} - ${term.slice(1)}` : `${acc} + ${term}`;
            }, "");
        }

        function pickFraction() {
            return FRACTION_COEFS[Math.floor(Math.random() * FRACTION_COEFS.length)];
        }

        // 分数乘数乘括号：1/2(x + 4)、-1/3(a - b)
        function fracBracket(coef, inner) {
            return `${formatTermR(coef, '')}(${inner})`;
        }

        // 括号里的「变量 + 常数」：x + 4、x - 3
        function plusConst(base, c) {
            return c < 0 ? `${base} - ${Math.abs(c)}` : `${base} + ${c}`;
        }

        function buildFractionTemplate(level) {
            if (level <= 2) {
                const q = pickFraction();
                const c = rand(-6, 6);
                const d = rand(-9, 9);
                const inner = plusConst('x', c);
                const type = rand(1, 4);
                // q(x + c) + d 或 d ± q(x + c)
                if (type <= 2) return joinSigned(fracBracket(q, inner), '+', String(d));
                return joinSigned(String(d), type === 3 ? '+' : '-', fracBracket(q, inner));
            }
            if (level === 3) {
                const q1 = pickFraction();
                const q2 = pickFraction();
                const c1 = rand(-6, 6);
                const c2 = rand(-6, 6);
                const type = rand(1, 3);
                if (type === 1) {
                    return joinSigned(fracBracket(q1, plusConst('x', c1)), '-', fracBracket(q2, plusConst('x', c2)));
                }
                if (type === 2) {
                    return joinSigned(fracBracket(q1, plusConst('x^2', c1)), '-', fracBracket(q2, plusConst('x', c2)));
                }
                const d = rand(-9, 9);
                return joinSigned(joinSigned(fracBracket(q1, plusConst('x', c1)), '+', formatTermR(q2, 'x')), '+', String(d));
            }
            const q1 = pickFraction();
            const q2 = pickFraction();
            const c = rand(-4, 4);
            const type = rand(1, 3);
            if (type === 1) {
                return joinSigned(fracBracket(q1, 'x + 2y'), '-', fracBracket(q2, plusConst('x - y', c)));
            }
            if (type === 2) {
                return joinSigned(fracBracket(q1, plusConst('x^2 + y', c)), '-', fracBracket(q2, 'xy - x'));
            }
            // 嵌套：q1(x + 2y - q2(x - y))
            const inner = joinSigned('x + 2y', '-', fracBracket(q2, 'x - y'));
            return fracBracket(q1, inner);
        }

        function buildTemplate(level) {
            if (level === 1) {
                const A = rand(-10, 10);
                const P1 = genPoly(['const', 'x'], 2, -5, 5);
                const type = rand(1, 4);
                if (type === 1) return joinSigned(String(A), '-', `(${P1})`);
                if (type === 2) return joinSigned(String(A), '+', `(${P1})`);
                if (type === 3) return joinSigned(`-(${P1})`, '+', String(A));
                return `-(${P1})`;
            }
            else if (level === 2) {
                const k1 = randMul(-5, 5);
                const k2 = randMul(-5, 5);
                const P1 = genPoly(['const', 'x'], 2, -10, 10);
                const P2 = genPoly(['const', 'x'], 2, -10, 10);
                const mono = formatTerm(rand(-5, 5), 'x');
                const type = rand(1, 4);
                if (type === 1) return joinSigned(`${k1}(${P1})`, '-', `${k2}(${P2})`);
                if (type === 2) return joinSigned(`${k1}(${P1})`, '-', mono);
                if (type === 3) return joinSigned(`(${P1})`, '+', `${k2}(${P2})`);
                return joinSigned(`(${P1})`, '-', `${k2}(${P2})`);
            }
            else if (level === 3) {
                const k = randMul(-4, 4);
                const mono = formatTerm(rand(-4, 4), 'x');
                const P1 = genPoly(['const', 'x', 'x^2'], rand(2, 3), -6, 6);
                const P2 = genPoly(['const', 'x', 'x^2'], 2, -6, 6);
                const P3 = genPoly(['const', 'x'], 2, -4, 4);
                const type = rand(1, 4);
                if (type === 1) return joinSigned(mono, '-', `${k}(${P1} - (${P3}))`);
                if (type === 2) return joinSigned(`${k}(${P1})`, '-', mono);
                if (type === 3) return joinSigned(`x(${P3})`, '-', `${k}(${P2})`);
                const tail = joinSigned(`${k}(${P3})`, '-', String(rand(1, 9)));
                return joinSigned(mono, '-', `(${tail})`);
            }
            else {
                // 挑战档用 x、y 两个字母：xy、x²、y² 各算一类，考「同类项」和「字母乘括号」
                const k1 = randMul(-4, 4);
                const k2 = randMul(-4, 4);
                const mono = formatTerm(rand(-4, 4), rand(1, 2) === 1 ? 'x' : 'y');
                const pool = ['const', 'x', 'y', 'xy', 'x^2', 'y^2'];
                const P1 = genPoly(pool, rand(2, 3), -5, 5);
                const P2 = genPoly(pool, 2, -5, 5);
                const type = rand(1, 4);
                if (type === 1) return joinSigned(joinSigned(mono, '-', `${k1}(${P1})`), '+', formatTerm(k2, 'y'));
                if (type === 2) return joinSigned(`${k1}(${P1})`, '-', `${k2}(${P2})`);
                if (type === 3) return joinSigned(`y(${genPoly(['x', 'y'], 2, -3, 3)})`, '-', `${k2}(${P2})`);
                return joinSigned(`-(${P1})`, '+', `${k2}(${P2})`);
            }
        }

        function generateQuestion(level = 1, options = {}) {
            const lv = [1, 2, 3, 4].includes(Number(level)) ? Number(level) : 1;
            const kind = options && options.kind;
            const useFraction = kind === 'fraction'
                || (kind !== 'integer' && Math.random() < (FRACTION_RATE[lv] || 0));
            const fallback = useFraction
                ? { level: lv, question: '1/2(x + 4) - 3', answer: 'x/2-1', tags: ['fraction'] }
                : { level: lv, question: '3 - (x + 3)', answer: '-x', tags: [] };

            for (let i = 0; i < 500; i++) {
                const expr = useFraction ? buildFractionTemplate(lv) : buildTemplate(lv);
                // 题面不许出现连续符号（+ -、- - 之类）：学生看着别扭，也容易跟着抄错
                if (/[+\-][+\-]/.test(expr.replace(/\s+/g, ''))) continue;
                if (!expr.includes('(')) continue;
                let poly;
                try {
                    // 按显式乘号解析，避免 5a 被当成单位、3ab 被当成符号 "ab"
                    poly = parseToPoly(expr);
                } catch (e) { continue; }

                const ansStr = formatPoly(poly).replace(/\s/g, '');
                if (ansStr === '0' || normalizeExpr(expr) === ansStr) continue;
                if (poly.size < 2 || poly.size > 6) continue;
                if (maxExponent(poly) > 3) continue;
                // 分数题必须有分数答案，避免「分数」标签配一个整数答案
                if (useFraction && !ansStr.includes('/')) continue;

                return { level: lv, question: expr, answer: ansStr, tags: useFraction ? ['fraction'] : [] };
            }
            return fallback;
        }

        function evaluateAnswer(studentAns, standardAns) {
            if (/[+\-*/]{2,}/.test(studentAns.replace(/\s/g, ''))) {
                return { status: 'error', msg: '含有连续符号，请写成最简形式' };
            }
            try {
                const stuPoly = parseToPoly(studentAns);
                const stdPoly = parseToPoly(standardAns);
                const isEquivalent = samePoly(stuPoly, stdPoly);
                const hasParentheses = /[()]/.test(studentAns);

                // 学生写的项数多于最简项数 -> 没有合并同类项
                const getTermCount = (e) => e.replace(/[\s*]/g, '').split(/(?=[+-])/).filter(t => t !== '').length;
                const stuTermCount = getTermCount(studentAns);
                const isMerged = stuTermCount <= stdPoly.size;

                if (isEquivalent && !hasParentheses && isMerged) return { status: 'correct', msg: '完全正确！' };
                // 两种「答案对但形式不标准」分开报，看板才能分别统计
                if (isEquivalent && hasParentheses) return { status: 'parentheses', msg: '结果正确，但尚未去括号' };
                if (isEquivalent && !hasParentheses && !isMerged) return { status: 'unmerged', msg: '去括号正确，但未合并同类项' };
                return { status: 'wrong', msg: '答案错误，请再检查一下计算' };
            } catch (e) {
                return { status: 'error', msg: '表达式无法解析，请检查输入格式' };
            }
        }

        // ==========================================
        // 1b. 提示与分步解析
        // ==========================================
        // PolyTerm / PolySum 已抽到 poly-tree.js（方程引擎共用同一棵树），文件开头已取到本地引用。

        // 原式 -> 乘进括号 -> 括号内合并 -> 去括号 -> 合并同类项
        // 每一步都返回新的 PolySum，链式调用的顺序就是黑板上的解题顺序
        function buildSteps(question, answer) {
            const steps = [];
            let terms;
            try {
                terms = PolySum.fromNode(math.parse(normalizeExpr(question)));
            } catch (e) {
                return [{ title: '答案', expr: answer }];
            }

            const push = (title, expr) => {
                const last = steps[steps.length - 1];
                if (last && normalizeForCompare(last.expr) === normalizeForCompare(expr)) return;
                steps.push({ title, expr });
            };

            push('原式', question);

            const distributed = terms.distributeOneLevel();
            push('乘进括号', distributed.render());

            const combined = distributed.combineInside();
            push('括号内合并', combined.render());

            const flat = combined.flatten();
            push('去括号', flat.render());

            push('合并同类项', answer);

            if (steps.length < 2) steps.push({ title: '答案', expr: answer });
            if (normalizeForCompare(steps[steps.length - 1].expr) !== normalizeForCompare(answer)) {
                steps.push({ title: '合并同类项', expr: answer });
            }
            return steps;
        }

        // 按题面结构给提示（可同时命中多条）
        function hintsFor(question) {
            const hints = [];
            let terms = null;
            try {
                terms = PolySum.fromNode(math.parse(normalizeExpr(question)));
            } catch (e) {
                terms = null;
            }

            if (terms) {
                let nested = false, negativeBracket = false, numberTimes = false, varTimes = false;
                terms.walk(term => {
                    if (!term.isBracket) return;
                    if (term.hasNestedBracket) nested = true;
                    if (term.isNegative) negativeBracket = true;
                    if (!R.isInt(R.abs(term.coef), 1)) numberTimes = true;
                    if (term.hasVars) varTimes = true;
                });

                if (nested) hints.push('括号里还套着括号，从最里面那一层开始去。');
                if (varTimes) hints.push('字母乘括号：把字母乘到括号里的每一项上，指数相同的才能合并。');
                if (negativeBracket) hints.push('括号前面是减号，去掉括号时里面每一项都要变号，别只改第一项。');
                if (numberTimes) hints.push('括号外面的数要乘到括号里的每一项，别漏乘最后一项。');
            }

            const q = String(question).replace(/\s+/g, '');
            if (/[xy]/.test(q)) hints.push('x 和 y 不是同类项；xy、x²、y² 也各算一类，别合并到一起。');
            else if (/\^2/.test(q)) hints.push('x 和 x² 不是同类项，要分开合并。');

            hints.push('先去括号（乘进括号、注意变号），最后再合并同类项。');
            return hints;
        }

        return {
            ...core,
            generateQuestion,
            evaluateAnswer,
            buildSteps,
            hintsFor
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createSimplifyEngine;
    } else {
        global.PolyEngine = createSimplifyEngine(global.math, global.MathCore);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
