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
            maxExponent,
            monomialBody,
            rational: R
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
            const c = R.fromNumber(coef);
            if (R.isZero(c)) return '0';
            const body = monomialBody(c, variable);
            return R.sign(c) < 0 ? `-${body}` : body;
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
        // 分步解析用一棵「项 -> 括号 -> 项」的小树承载中间状态：
        //   PolyTerm 是一个项（系数 × 字母 × 可选括号内容），值对象；
        //   PolySum  是一串项（和），负责跨项的分配/合并/摊平/渲染。
        // 所有方法都返回新实例、绝不原地修改，所以任意一步的树都能重新渲染，
        // 步骤之间也不会因为共享节点而互相污染。
        class PolyTerm {
            constructor(coef, vars, inner = null) {
                this.coef = coef;    // 有理数系数（math-core 的 R，底层是 Fraction）
                this.vars = vars;    // 指数数组，[2, 0, 0] 表示 x^2；视为只读
                this.inner = inner;  // 括号里的项（PolySum），没有括号时为 null
            }

            static zeros() {
                return VAR_ORDER.map(() => 0);
            }

            static addExponents(a, b) {
                return a.map((v, i) => v + b[i]);
            }

            get isBracket() { return this.inner !== null; }
            get hasVars() { return this.vars.some(e => e !== 0); }
            get isNegative() { return R.sign(this.coef) < 0; }
            get isZero() { return R.isZero(this.coef); }
            // 乘数是 ±1 且不带字母：只需变号，不必乘进括号（1(x + 3)、-(x + 3)）
            get isUnitMultiplier() { return R.isInt(R.abs(this.coef), 1) && !this.hasVars; }
            get hasNestedBracket() { return this.isBracket && this.inner.some(t => t.isBracket); }

            // 字母部分：'x^2' / 'ab' / ''
            varString() {
                let s = '';
                this.vars.forEach((e, i) => {
                    if (e === 1) s += VAR_ORDER[i];
                    else if (e > 1) s += `${VAR_ORDER[i]}^${e}`;
                });
                return s;
            }

            // 同类项的判定键：字母指数完全相同
            key() {
                return this.vars.join(',');
            }

            // 单项式 × 单项式：系数相乘、同字母指数相加
            times(other) {
                return new PolyTerm(
                    R.mul(this.coef, other.coef),
                    PolyTerm.addExponents(this.vars, other.vars),
                    other.inner
                );
            }

            // 同类项相加：只合并系数
            plus(other) {
                return new PolyTerm(R.add(this.coef, other.coef), this.vars, null);
            }

            // 单项式 × 一串项：只有一项时直接相乘；否则系数/字母挂到括号外面，留给「乘进括号」
            multiplyGroup(group) {
                if (group.size === 1) return this.times(group.first());
                if (group.some(t => t.isBracket)) throw new Error('不支持的括号相乘');
                return new PolyTerm(this.coef, this.vars, group);
            }

            // 展开「自己括号里的内容」：内层乘数乘进去，纯变号的括号原样保留
            expandContent() {
                if (!this.isBracket) return new PolySum([this]);
                const content = this.inner.expandContent();
                if (this.isUnitMultiplier) return new PolySum([new PolyTerm(this.coef, this.vars, content)]);
                return content.map(sub => this.times(sub));
            }

            // 乘进括号：把这一层的乘数乘进去，但保留这一层括号，交给「去括号」
            distributeOneLevel() {
                if (!this.isBracket) return this;
                const content = this.inner.expandContent();
                if (this.isUnitMultiplier) return new PolyTerm(this.coef, this.vars, content);
                const k = R.abs(this.coef);
                const scaled = content.map(sub => new PolyTerm(
                    R.mul(sub.coef, k),
                    PolyTerm.addExponents(this.vars, sub.vars),
                    sub.inner
                ));
                const sign = this.isNegative ? R.minusOne : R.one;
                return new PolyTerm(sign, PolyTerm.zeros(), scaled);
            }

            // 括号内合并同类项（只合并这一层括号自己的内容）
            combineInside() {
                return this.isBracket ? new PolyTerm(this.coef, this.vars, this.inner.combine()) : this;
            }

            // 去括号：把自己的系数乘到括号里的每一项，得到一串没有括号的项
            flatten() {
                if (!this.isBracket) return new PolySum([this]);
                return this.inner.flatten().map(sub => this.times(sub));
            }

            // 不含正负号的正文；括号项要带上外面的乘数
            body() {
                const v = this.varString();
                if (!this.isBracket) return monomialBody(this.coef, v);
                const pre = this.isUnitMultiplier ? '' : monomialBody(this.coef, v);
                return `${pre}(${this.inner.render()})`;
            }

            // 带正负号的渲染；isFirst 为 true 时正号省略
            render(isFirst) {
                const body = this.body();
                if (this.isNegative) return isFirst ? `-${body}` : ` - ${body}`;
                return isFirst ? body : ` + ${body}`;
            }
        }

        // 一串项（和）：承担「乘进括号 -> 括号内合并 -> 去括号」这些跨项的操作。
        // PolyTerm 只管自己那一项，谁在遍历、怎么合并由 PolySum 调度。
        class PolySum {
            constructor(items = []) {
                this.items = items;
            }

            // 题面 AST -> 一串项
            static fromNode(node) {
                if (node.isParenthesisNode) {
                    // 括号里有加减法时，保留成"一个括号组"，后面才能按步展开
                    const inner = PolySum.fromNode(node.content);
                    if (inner.size === 1 && !inner.first().isBracket) return inner;
                    return new PolySum([new PolyTerm(R.one, PolyTerm.zeros(), inner)]);
                }

                if (node.isConstantNode) {
                    return new PolySum([new PolyTerm(R.fromNumber(node.value), PolyTerm.zeros())]);
                }

                if (node.isSymbolNode) {
                    const idx = VAR_ORDER.indexOf(node.name);
                    if (idx < 0) throw new Error('不支持的字母');
                    const vars = PolyTerm.zeros();
                    vars[idx] = 1;
                    return new PolySum([new PolyTerm(R.one, vars)]);
                }

                if (node.isOperatorNode) {
                    if (node.args.length === 1) {
                        // 负号：把符号乘进括号里的每一项
                        return PolySum.fromNode(node.args[0])
                            .map(term => new PolyTerm(R.neg(term.coef), term.vars, term.inner));
                    }
                    if (node.op === '+' || node.op === '-') {
                        const left = PolySum.fromNode(node.args[0]);
                        const right = PolySum.fromNode(node.args[1]);
                        if (node.op === '+') return new PolySum(left.items.concat(right.items));
                        const negated = right.map(term => new PolyTerm(R.neg(term.coef), term.vars, term.inner));
                        return new PolySum(left.items.concat(negated.items));
                    }
                    if (node.op === '/') {
                        const left = PolySum.fromNode(node.args[0]);
                        const right = PolySum.fromNode(node.args[1]);
                        if (right.size !== 1 || right.first().isBracket) throw new Error('不支持的除法');
                        const divisor = right.first();
                        if (divisor.hasVars) throw new Error('分母含字母暂不支持');
                        if (divisor.isZero) throw new Error('分母不能为 0');
                        return left.map(term => new PolyTerm(R.div(term.coef, divisor.coef), term.vars, term.inner));
                    }
                    if (node.op === '*') {
                        const a = PolySum.fromNode(node.args[0]);
                        const b = PolySum.fromNode(node.args[1]);
                        // 乘数 × 括号：把乘数的系数/字母挂到括号上，留到"乘进括号"那一步展开
                        if (a.size === 1 && !a.first().isBracket) return new PolySum([a.first().multiplyGroup(b)]);
                        if (b.size === 1 && !b.first().isBracket) return new PolySum([b.first().multiplyGroup(a)]);
                        throw new Error('不支持的乘法');
                    }
                    if (node.op === '^') {
                        const base = PolySum.fromNode(node.args[0]);
                        const exp = node.args[1].isConstantNode ? Number(node.args[1].value) : NaN;
                        if (base.size !== 1 || !Number.isInteger(exp) || exp < 0 || exp > 6) {
                            throw new Error('不支持的乘方');
                        }
                        const item = base.first();
                        if (item.isBracket) throw new Error('不支持的括号乘方');
                        return new PolySum([new PolyTerm(R.pow(item.coef, exp), item.vars.map(v => v * exp))]);
                    }
                }

                throw new Error('表达式不支持');
            }

            get size() { return this.items.length; }

            first() { return this.items[0]; }

            map(fn) { return new PolySum(this.items.map(fn)); }

            some(fn) { return this.items.some(fn); }

            // 深度优先访问这一串项以及所有括号里的项（提示分类要用）
            walk(visitor) {
                this.items.forEach(term => {
                    visitor(term);
                    if (term.isBracket) term.inner.walk(visitor);
                });
                return this;
            }

            // 括号内部：把「乘数 × 括号」的乘法算掉，内层括号随之消失、摊平到这一层
            expandContent() {
                const out = [];
                this.items.forEach(term => out.push(...term.expandContent().items));
                return new PolySum(out);
            }

            // 把「乘数 × 括号」的乘数乘进去，但保留这一层括号；
            // 只有 -(x + 3) 这种纯变号的括号原样保留，交给「去括号」那一步
            distributeOneLevel() {
                return this.map(term => term.distributeOneLevel());
            }

            // 括号内合并同类项
            combineInside() {
                return this.map(term => term.combineInside());
            }

            // 合并同类项：只合并这一层，还带括号的项先跳过
            combine() {
                const out = [];
                const index = new Map();
                this.items.forEach(term => {
                    if (term.isBracket) { out.push(term); return; }
                    const key = term.key();
                    if (!index.has(key)) { index.set(key, out.length); out.push(term); return; }
                    const at = index.get(key);
                    out[at] = out[at].plus(term);
                });
                return new PolySum(out.filter(term => !term.isZero));
            }

            // 去括号：逐个项摊平成没有括号的项
            flatten() {
                const out = [];
                this.items.forEach(term => out.push(...term.flatten().items));
                return new PolySum(out);
            }

            render() {
                if (this.size === 0) return '0';
                return this.items.map((term, i) => term.render(i === 0)).join('');
            }
        }

        function normalizeForCompare(s) {
            return String(s).replace(/\s+/g, '');
        }

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
