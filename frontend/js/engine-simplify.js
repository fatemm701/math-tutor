// frontend/js/engine-simplify.js —— 整式化简题型：出题、判题、分步解析、提示
// 依赖 math-core.js 提供的基础多项式能力，不接触 DOM、KaTeX、网络和本地存储。

(function (global) {
    'use strict';

    function createSimplifyEngine(math, core) {
        const {
            VAR_ORDER,
            normalizeExpr,
            parseToPoly,
            formatPoly,
            samePoly,
            maxExponent
        } = core;
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

        function formatTerm(coef, variable) {
            if (coef === 0) return '0';
            if (variable === '') return `${coef}`;
            if (coef === 1) return variable;
            if (coef === -1) return `-${variable}`;
            return `${coef}${variable}`;
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
                const k1 = randMul(-4, 4);
                const k2 = randMul(-4, 4);
                const mono = formatTerm(rand(-4, 4), rand(1, 2) === 1 ? 'a' : 'b');
                const pool = ['const', 'a', 'b', 'ab', 'a^2', 'b^2'];
                const P1 = genPoly(pool, rand(2, 3), -5, 5);
                const P2 = genPoly(pool, 2, -5, 5);
                const type = rand(1, 4);
                if (type === 1) return joinSigned(joinSigned(mono, '-', `${k1}(${P1})`), '+', formatTerm(k2, 'b'));
                if (type === 2) return joinSigned(`${k1}(${P1})`, '-', `${k2}(${P2})`);
                if (type === 3) return joinSigned(`a(${genPoly(['a', 'b'], 2, -3, 3)})`, '-', `${k2}(${P2})`);
                return joinSigned(`-(${P1})`, '+', `${k2}(${P2})`);
            }
        }

        function generateQuestion(level = 1) {
            for (let i = 0; i < 500; i++) {
                const expr = buildTemplate(level);
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

                return { level, question: expr, answer: ansStr };
            }
            return { level, question: '3 - (x + 3)', answer: '-x' };
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
                if (isEquivalent && hasParentheses) return { status: 'partial', msg: '结果正确，但尚未去括号' };
                if (isEquivalent && !hasParentheses && !isMerged) return { status: 'partial', msg: '去括号正确，但未合并同类项' };
                return { status: 'wrong', msg: '答案错误，请再检查一下计算' };
            } catch (e) {
                return { status: 'error', msg: '表达式无法解析，请检查输入格式' };
            }
        }

        // ==========================================
        // 1b. 提示与分步解析
        // ==========================================
        // 题面 -> [ { coef, vars:[x,a,b 的指数], inner:[子项] | null } ]
        // 所有中间步骤都从这个结构渲染，保证每一步都与最终答案等价
        function addVars(a, b) {
            return a.map((v, i) => v + b[i]);
        }

        function varsToStr(vars) {
            let s = '';
            vars.forEach((e, i) => {
                if (e === 1) s += VAR_ORDER[i];
                else if (e > 1) s += `${VAR_ORDER[i]}^${e}`;
            });
            return s;
        }

        function itemBody(it) {              // 不含正负号
            const v = varsToStr(it.vars);
            const a = Math.abs(it.coef);
            if (v === '') return `${a}`;
            return a === 1 ? v : `${a}${v}`;
        }

        function renderSum(items) {
            if (items.length === 0) return '0';
            return items.map((it, i) => {
                let body = itemBody(it);
                if (it.inner) {
                    const v = varsToStr(it.vars);
                    const a = Math.abs(it.coef);
                    const pre = (a === 1 && v === '') ? '' : `${a}${v}`;
                    body = `${pre}(${renderSum(it.inner)})`;
                }
                if (i === 0) return it.coef < 0 ? `-${body}` : body;
                return it.coef < 0 ? ` - ${body}` : ` + ${body}`;
            }).join('');
        }

        // 单项式 × 一串项：系数/字母挂到括号外面，括号里的加减法留给后面展开
        function mulItem(x, list) {
            if (list.length === 1) {
                const y = list[0];
                return { coef: x.coef * y.coef, vars: addVars(x.vars, y.vars), inner: y.inner };
            }
            if (list.some(it => it.inner)) throw new Error('不支持的括号相乘');
            return { coef: x.coef, vars: x.vars, inner: list };
        }

        function nodeToItems(node) {
            if (node.isParenthesisNode) {
                // 括号里有加减法时，保留成"一个括号组"，后面才能按步展开
                const inner = nodeToItems(node.content);
                if (inner.length === 1 && !inner[0].inner) return inner;
                return [{ coef: 1, vars: [0, 0, 0], inner }];
            }

            if (node.isConstantNode) {
                const v = Number(node.value);
                if (!Number.isInteger(v)) throw new Error('系数必须是整数');
                return [{ coef: v, vars: [0, 0, 0], inner: null }];
            }

            if (node.isSymbolNode) {
                const idx = VAR_ORDER.indexOf(node.name);
                if (idx < 0) throw new Error('不支持的字母');
                const vars = [0, 0, 0];
                vars[idx] = 1;
                return [{ coef: 1, vars, inner: null }];
            }

            if (node.isOperatorNode) {
                if (node.args.length === 1) {
                    // 负号：把符号乘进括号里的每一项
                    return nodeToItems(node.args[0]).map(it => ({
                        coef: -it.coef, vars: it.vars.slice(), inner: it.inner
                    }));
                }
                if (node.op === '+' || node.op === '-') {
                    const left = nodeToItems(node.args[0]);
                    const right = nodeToItems(node.args[1]);
                    if (node.op === '+') return left.concat(right);
                    return left.concat(right.map(it => ({
                        coef: -it.coef, vars: it.vars.slice(), inner: it.inner
                    })));
                }
                if (node.op === '*') {
                    const a = nodeToItems(node.args[0]);
                    const b = nodeToItems(node.args[1]);
                    // 乘数 × 括号：把乘数的系数/字母挂到括号上，留到"乘进括号"那一步展开
                    if (a.length === 1 && !a[0].inner) return [mulItem(a[0], b)];
                    if (b.length === 1 && !b[0].inner) return [mulItem(b[0], a)];
                    throw new Error('不支持的乘法');
                }
                if (node.op === '^') {
                    const base = nodeToItems(node.args[0]);
                    const exp = node.args[1].isConstantNode ? Number(node.args[1].value) : NaN;
                    if (base.length !== 1 || !Number.isInteger(exp) || exp < 0 || exp > 6) {
                        throw new Error('不支持的乘方');
                    }
                    if (base[0].inner) throw new Error('不支持的括号乘方');
                    return [{
                        coef: Math.pow(base[0].coef, exp),
                        vars: base[0].vars.map(v => v * exp),
                        inner: null
                    }];
                }
            }

            throw new Error('表达式不支持');
        }

        // 括号内部：把「乘数 × 括号」的乘法算掉，内层括号随之消失、摊平到这一层
        function expandContent(items) {
            const out = [];
            items.forEach(it => {
                if (!it.inner) { out.push(it); return; }
                const content = expandContent(it.inner);
                const k = Math.abs(it.coef);
                const hasVars = it.vars.some(e => e !== 0);
                if (k === 1 && !hasVars) {
                    out.push({ coef: it.coef, vars: it.vars.slice(), inner: content });
                } else {
                    content.forEach(sub => out.push({
                        coef: it.coef * sub.coef,
                        vars: addVars(it.vars, sub.vars),
                        inner: sub.inner
                    }));
                }
            });
            return out;
        }

        // 把「乘数 × 括号」的乘数乘进去，但保留这一层括号；
        // 只有 -(x + 3) 这种纯变号的括号原样保留，交给「去括号」那一步
        function distributeOneLevel(items) {
            return items.map(it => {
                if (!it.inner) return it;
                const content = expandContent(it.inner);
                const k = Math.abs(it.coef);
                const hasVars = it.vars.some(e => e !== 0);
                if (k === 1 && !hasVars) {
                    return { coef: it.coef, vars: it.vars.slice(), inner: content };
                }
                const scaled = content.map(sub => ({
                    coef: sub.coef * k,
                    vars: addVars(it.vars, sub.vars),
                    inner: sub.inner
                }));
                return { coef: it.coef < 0 ? -1 : 1, vars: [0, 0, 0], inner: scaled };
            });
        }

        function combineItems(items) {
            const out = [];
            const index = new Map();
            items.forEach(it => {
                if (it.inner) { out.push(it); return; }   // 还带括号的先不合并
                const key = it.vars.join(',');
                const found = index.get(key);
                if (found) found.coef += it.coef;
                else {
                    const copy = { coef: it.coef, vars: it.vars.slice(), inner: null };
                    index.set(key, copy);
                    out.push(copy);
                }
            });
            return out.filter(it => it.coef !== 0);
        }

        function combineInside(items) {
            return items.map(it => it.inner
                ? { coef: it.coef, vars: it.vars.slice(), inner: combineItems(it.inner) }
                : it);
        }

        function flattenItems(items) {
            const out = [];
            items.forEach(it => {
                if (!it.inner) { out.push(it); return; }
                flattenItems(it.inner).forEach(sub => out.push({
                    coef: it.coef * sub.coef,
                    vars: addVars(it.vars, sub.vars),
                    inner: null
                }));
            });
            return out;
        }

        function normalizeForCompare(s) {
            return String(s).replace(/\s+/g, '');
        }

        // 原式 -> 乘进括号 -> 括号内合并 -> 去括号 -> 合并同类项
        function buildSteps(question, answer) {
            const steps = [];
            let items;
            try {
                items = nodeToItems(math.parse(normalizeExpr(question)));
            } catch (e) {
                return [{ title: '答案', expr: answer }];
            }

            const push = (title, expr) => {
                const last = steps[steps.length - 1];
                if (last && normalizeForCompare(last.expr) === normalizeForCompare(expr)) return;
                steps.push({ title, expr });
            };

            push('原式', question);

            const distributed = distributeOneLevel(items);
            push('乘进括号', renderSum(distributed));

            const combined = combineInside(distributed);
            push('括号内合并', renderSum(combined));

            const flat = flattenItems(combined);
            push('去括号', renderSum(flat));

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
            let items = null;
            try {
                items = nodeToItems(math.parse(normalizeExpr(question)));
            } catch (e) {
                items = null;
            }

            if (items) {
                let nested = false, negativeBracket = false, numberTimes = false, varTimes = false;
                const walk = (list) => list.forEach(it => {
                    if (!it.inner) return;
                    if (it.inner.some(sub => sub.inner)) nested = true;
                    if (it.coef < 0) negativeBracket = true;
                    if (Math.abs(it.coef) > 1) numberTimes = true;
                    if (it.vars.some(e => e !== 0)) varTimes = true;
                    walk(it.inner);
                });
                walk(items);

                if (nested) hints.push('括号里还套着括号，从最里面那一层开始去。');
                if (varTimes) hints.push('字母乘括号：把字母乘到括号里的每一项上，指数相同的才能合并。');
                if (negativeBracket) hints.push('括号前面是减号，去掉括号时里面每一项都要变号，别只改第一项。');
                if (numberTimes) hints.push('括号外面的数要乘到括号里的每一项，别漏乘最后一项。');
            }

            const q = String(question).replace(/\s+/g, '');
            if (/[ab]/.test(q)) hints.push('a 和 b 不是同类项；ab、a²、b² 也各算一类，别合并到一起。');
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
