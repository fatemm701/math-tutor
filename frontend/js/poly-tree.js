// frontend/js/poly-tree.js —— 分步解析用的「项 -> 括号 -> 项」小树（纯计算）
// 整式化简与一元一次方程两套引擎共用：两边都要按「乘进括号 -> 括号内合并 -> 去括号」推进，
// 只是各自的步骤编排不同，所以把树本身单独放这里，避免在其中一个引擎里 import 另一个。
// 依赖 math-core.js 提供的基础多项式能力，不接触 DOM、KaTeX、网络和本地存储。

(function (global) {
    'use strict';

    function createPolyTree(math, core) {
        const {
            VAR_ORDER,
            monomialBody,
            rational: R
        } = core;

        // PolyTerm 是一个项（系数 × 字母 × 可选括号内容），值对象；
        // PolySum  是一串项（和），负责跨项的分配/合并/摊平/渲染。
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

        return {
            PolyTerm,
            PolySum,
            normalizeForCompare(text) {
                return String(text).replace(/\s+/g, '');
            }
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createPolyTree;
    } else {
        global.PolyTree = createPolyTree(global.math, global.MathCore);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);