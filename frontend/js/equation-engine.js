// frontend/js/equation-engine.js —— 一元一次方程：出题、判题、分步解析、提示
// 依赖 math-core.js（有理数、多项式解析与 LaTeX）和 poly-tree.js（括号树）。
// 不接触 DOM、KaTeX、网络和本地存储。
//
// ---- 表示 ----
// 式子 = [Term]。Term：
//   原子：{ kind:'x'|'c', coef }            —— coef × x 或常数
//   括号：{ kind:'g', coef, items:[Term] }  —— coef × (items 的和)
// 数值上永远按 coef 算；括号项把乘数挂在括号外，所以题面里 3(x+1) 在「去括号」之前一直是 3(x+1)。
// 分数系数用 coef 的分母表示：1/2x 的 coef 是 1/2，(x+1)/2 的 coef 是 1/2 的括号 —— 两者渲染不同，
// 见 Term.render。
//
// ---- 步骤 ----
//   原方程 -> 去分母(*) -> 去括号(*) -> 移项(*) -> 合并同类项(*) -> 化系数为一
// 每一步都返回新的等价等式；带 * 的步骤重复到做不动为止。
//
// ---- 出题 ----
// 先定解与结构，再用「常数项配平」反推出等式（b = 目标右侧 - 系数 × 解），保证一定有解。

(function (global) {
    'use strict';

    function createEquationEngine(math, core, tree) {
        let polyTree = tree;
        if (!polyTree) {
            // 浏览器端页面先加载 poly-tree.js；Node 端（测试）直接 require，两条路都要能取到
            polyTree = typeof require === 'function'
                ? require('./poly-tree.js')(math, core)
                : global.PolyTree;
        }
        if (!polyTree) throw new Error('poly-tree.js 未加载');

        const {
            normalizeExpr,
            parseToPoly,
            monomialBody,
            toLatexText: baseLatexText,
            rational: R
        } = core;
        const { PolySum } = polyTree;

        const TWO = R.fromNumber(2);

        function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        function randNonZero(min, max) {
            let v = 0;
            while (v === 0) v = rand(min, max);
            return v;
        }
        function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
        function norm(text) { return String(text).replace(/\s+/g, ''); }

        // 系数统一成有理数：数字、"3/2" 字符串、已经是 Fraction 的原样收
        function coefToR(value) {
            if (value === undefined || value === null) return R.one;
            if (typeof value === 'string') {
                const text = value.trim();
                const m = /^(-?\d+)\/(\d+)$/.exec(text);
                if (m) return R.from(Number(m[1]), Number(m[2]));
                return R.from(Number(text));
            }
            if (typeof value === 'number') return R.from(value);
            return value;
        }
        // 把 2.0 这种整数 Fraction 收敛成 2，避免 "2/1" 落在题面里
        function tidy(v) { return R.isInt(v, Math.round(Number(v.s * v.n / v.d))) && v.d === 1n ? v : v; }

        // ======================================================================
        // 1. 解析与求值：一切以「两边各自展开成 ax + b」为准
        // ======================================================================
        function linearOf(poly) {
            let x = R.zero;
            let c = R.zero;
            poly.forEach((coef, key) => {
                const exps = String(key).split('').map(Number);
                if (exps[0] === 1 && exps.every((e, i) => i === 0 || e === 0)) x = coef;
                else if (exps.every(e => e === 0)) c = coef;
                else throw new Error('不是一次式');
            });
            return { x, c };
        }
        function parseSide(text) { return linearOf(parseToPoly(text)); }
        function parseEquation(text) {
            const parts = String(text).trim().split('=');
            if (parts.length !== 2) throw new Error('方程格式不对');
            return { left: parseSide(parts[0]), right: parseSide(parts[1]) };
        }
        function formatLinear({ x, c }) {
            const terms = [];
            if (!R.isZero(x)) terms.push({ coef: x, body: monomialBody(x, 'x') });
            if (!R.isZero(c)) terms.push({ coef: c, body: R.toPlain(R.abs(c)) });
            if (!terms.length) return '0';
            return terms.map((t, i) => {
                if (i === 0) return R.sign(t.coef) < 0 ? `-${t.body}` : t.body;
                return `${R.sign(t.coef) < 0 ? ' - ' : ' + '}${t.body}`;
            }).join('');
        }
        function solutionOf(eq) {
            const k = R.sub(eq.left.x, eq.right.x);
            const b = R.sub(eq.right.c, eq.left.c);
            if (R.isZero(k)) return R.isZero(b) ? 'identity' : 'none';
            return R.div(b, k);
        }
        function sameSolution(a, b) {
            const sa = solutionOf(a);
            const sb = solutionOf(b);
            if (typeof sa === 'string' || typeof sb === 'string') return sa === sb;
            return R.eq(sa, sb);
        }
        // 按显式乘号解析，避开 mathjs 把 5x 当单位之类的坑；
        // 小数单独报错 —— math-core 的系数只接受整数/分数，直接放进来会得到一个看不懂的异常
        function safeParse(text) {
            if (/\./.test(String(text))) throw new Error('不支持小数');
            return math.parse(normalizeExpr(text));
        }

        // ======================================================================
        // 2. 项与等式
        // ======================================================================
        class Term {
            constructor(kind, coef, items) {
                this.kind = kind;                   // 'x' | 'c' | 'g'
                this.coef = coefToR(coef);
                this.items = items || null;
            }

            static x(coef) { return new Term('x', coef); }
            static num(coef) { return new Term('c', coef); }
            static group(coef, items) { return new Term('g', coef, items); }

            get isBracket() { return this.kind === 'g'; }
            get signed() { return R.sign(this.coef) < 0; }
            get isZero() {
                if (this.isBracket) return R.isZero(this.coef) || this.items.every(t => t.isZero);
                return R.isZero(this.coef);
            }
            get hasVar() {
                if (this.isBracket) return this.items.some(t => t.hasVar);
                return this.kind === 'x';
            }

            clone() {
                return new Term(this.kind, R.toPlain(this.coef),
                    this.isBracket ? this.items.map(t => t.clone()) : null);
            }

            times(f) {
                return new Term(this.kind, R.mul(this.coef, f),
                    this.isBracket ? this.items.map(t => t.clone()) : null);
            }

            // 括号项展开：系数乘到每一项上（内部若还有括号，由调用方继续展开）
            expandOneLevel() {
                if (!this.isBracket) return [this];
                return this.items.map(inner => inner.times(this.coef));
            }

            // 渲染（不含正负号）
            body() {
                const a = R.abs(this.coef);
                if (this.isBracket) {
                    const pre = R.isInt(a, 1) ? '' : R.toPlain(a);
                    return `${pre}(${renderSide(this.items)})`;
                }
                if (this.kind === 'x') return monomialBody(a, 'x');
                return monomialBody(a, '');
            }

            render(first) {
                const body = this.body();
                if (this.signed) return first ? `-${body}` : ` - ${body}`;
                return first ? body : ` + ${body}`;
            }
        }

        function renderSide(terms) {
            const list = terms.filter(t => !t.isZero);
            if (!list.length) return '0';
            return list.map((t, i) => t.render(i === 0)).join('');
        }

        function valueOf(terms) {
            let x = R.zero;
            let c = R.zero;
            terms.forEach(term => {
                if (term.isBracket) {
                    const inner = valueOf(term.items);
                    x = R.add(x, R.mul(inner.x, term.coef));
                    c = R.add(c, R.mul(inner.c, term.coef));
                } else if (term.kind === 'x') {
                    x = R.add(x, term.coef);
                } else {
                    c = R.add(c, term.coef);
                }
            });
            return { x, c };
        }

        class Equation {
            constructor(left, right) {
                this.left = left;
                this.right = right;
            }

            static parse(text) {
                const parts = String(text).trim().split('=');
                if (parts.length !== 2) throw new Error('方程格式不对');
                return new Equation(sideOf(parts[0]), sideOf(parts[1]));
            }

            clone() {
                return new Equation(this.left.map(t => t.clone()), this.right.map(t => t.clone()));
            }

            render() {
                // 题面和每一步都写成 "左边 = 右边"：等号两边留空格，学生看着不挤
                return `${renderSide(this.left)} = ${renderSide(this.right)}`;
            }

            value() {
                return { left: valueOf(this.left), right: valueOf(this.right) };
            }

            solution() {
                return solutionOf(this.value());
            }
        }

        // 字符串 -> Term[]：保留括号结构（乘数 × 括号），不提前展开
        function sideOf(text) {
            return PolySum.fromNode(safeParse(text)).items.map(termFromPolyTerm);
        }
        function termFromPolyTerm(term) {
            if (term.isBracket) {
                return Term.group(R.toPlain(term.coef), term.inner.items.map(termFromPolyTerm));
            }
            const vars = term.vars;
            if (vars[0] === 1 && vars.every((e, i) => i === 0 || e === 0)) {
                return Term.x(R.toPlain(term.coef));
            }
            return Term.num(R.toPlain(term.coef));
        }

        // ======================================================================
        // 3. 分步解析
        // ======================================================================
        // Term 的渲染由 coef 决定，所以「2x = 3」这一步（两边同乘分母后）要重新推导：
        //   - 现在这一项是 "x/2" 这种（coef 的分母 2，且不是括号项），乘 2 之后 coef 变整数 -> 显示 x
        //   - 括号项 1/2(x+1) 乘 2 之后系数 1、(x+1) -> 显示 x+1
        // 也就是说「两边乘 L」直接落在 coef 上，渲染自然变成化简后的写法，不需要额外标记。

        // 收集每一项的分母：系数实际是分数就算有分母（x/2、1/2(x+3)、3/4 都算）
        function termDenoms(terms, out) {
            terms.forEach(term => {
                if (term.isBracket) termDenoms(term.items, out);
                if (term.coef.d !== 1n) out.push(Number(term.coef.d));
            });
            return out;
        }
        function lcm(values) {
            let out = 1;
            values.forEach(v => { out = math.lcm(out, v); });
            return out;
        }
        function isUnitMultiplier(coef) { return R.isInt(R.abs(coef), 1); }

        // 去分母：两边每一项乘以 L。括号项的乘数乘进去（3(x+1) 变成 6(x+1)），
        // 括号里还有分母的，下一轮再乘（一层一层来，保证中间态写得出来）
        function clearDenominators(eq) {
            const L = lcm(termDenoms(eq.left.concat(eq.right), []));
            const scale = (terms) => terms.map(term => term.times(R.fromNumber(L)));
            return new Equation(scale(eq.left), scale(eq.right));
        }

        function hasDenominators(terms) {
            return termDenoms(terms, []).length > 0;
        }

        // 去括号：展开一层。普通括号直接展开；括号前面是减号（或乘数）时，
        // 每个内部项都要乘上外面的系数，所以展开后符号自然正确
        function expandOneLevel(terms) {
            const out = [];
            terms.forEach(term => {
                if (!term.isBracket) { out.push(term); return; }
                term.expandOneLevel().forEach(inner => out.push(inner));
            });
            return out;
        }
        function hasBrackets(terms) {
            return terms.some(term => term.isBracket);
        }

        // 合并同类项：把同一侧的所有原子项按「x 项 / 常数」分别合并，结果保持出现顺序
        function mergeTerms(terms) {
            let xAt = -1;
            let cAt = -1;
            let xSum = R.zero;
            let cSum = R.zero;
            const out = [];
            terms.forEach(term => {
                if (term.isBracket || R.isZero(term.coef)) return;
                if (term.kind === 'x') {
                    if (xAt < 0) { xAt = out.length; out.push(Term.x(term.coef)); }
                    else xSum = R.add(xSum, term.coef);
                } else {
                    if (cAt < 0) { cAt = out.length; out.push(Term.num(term.coef)); }
                    else cSum = R.add(cSum, term.coef);
                }
            });
            if (xAt >= 0) out[xAt] = Term.x(R.add(out[xAt].coef, xSum));
            if (cAt >= 0) out[cAt] = Term.num(R.add(out[cAt].coef, cSum));
            return out.filter(term => !term.isZero || term.isBracket);
        }
        // 合并之前有多少个「可合并的同类项」：>1 才值得写一步
        function mergeNeeded(terms) {
            let x = 0;
            let c = 0;
            terms.forEach(term => {
                if (term.isBracket || R.isZero(term.coef)) return;
                if (term.kind === 'x') x++;
                else c++;
            });
            return x > 1 || c > 1;
        }

        // 移项：左边只留含 x 的项，右边只留常数项，移过去的项变号。一次只移一项。
        // 顺序：先把左边的常数挪到右边，再从右边挪一样东西到左边
        // （优先挪右边的 x 项，没有的话就挪右边的常数），这样「12 = 3(4x - 1)」这类题
        // 也会先把 x 项移到左边，而不是原地反号。
        function moveNeeded(eq) {
            const leftConst = eq.left.some(t => !t.hasVar);
            const rightVar = eq.right.some(t => t.hasVar);
            const leftVar = eq.left.some(t => t.hasVar);
            const rightConst = eq.right.some(t => !t.hasVar);
            if (leftConst) return true;
            if (rightVar) return true;
            return !leftVar && !rightConst;
        }
        function moveOneTerm(eq) {
            const next = eq.clone();
            const leftConst = next.left.findIndex(t => !t.hasVar);
            if (leftConst >= 0) return moveAt(next, 'left', leftConst);
            const rightVar = next.right.findIndex(t => t.hasVar);
            if (rightVar >= 0) return moveAt(next, 'right', rightVar);
            const rightConst = next.right.findIndex(t => !t.hasVar);
            if (rightConst >= 0) return moveAt(next, 'right', rightConst);
            return null;
        }
        function moveAt(eq, from, index) {
            const list = from === 'left' ? eq.left : eq.right;
            const target = from === 'left' ? eq.right : eq.left;
            const item = list.splice(index, 1)[0].times(R.minusOne);
            // 插到同类项旁边：含 x 的排在一起，常数排在一起，读起来更顺
            const wantVar = item.hasVar;
            let at = -1;
            target.forEach((t, i) => {
                if (at < 0 && t.hasVar === wantVar) at = i;
            });
            if (at < 0) at = target.length;
            target.splice(at, 0, item);
            return eq;
        }

        // 化系数为一：左边合并成一串后只剩 kx（k ≠ 1 且右边只剩常数），两边同除 k
        function divideCoefficient(eq) {
            const left = mergeTerms(eq.left);
            if (left.length !== 1 || left[0].isBracket || left[0].kind !== 'x') return null;
            const k = left[0].coef;
            if (R.isZero(k) || left[0].isZero) return null;
            const right = mergeTerms(eq.right);
            if (right.length !== 1 || right[0].isBracket || right[0].kind !== 'c') return null;
            // 系数是 1 就不用再除了（x = 4 已经是最简）
            if (R.isInt(k, 1)) return null;
            const f = R.div(R.one, k);
            return new Equation(
                [Term.x(R.one)],
                [Term.num(R.mul(right[0].coef, f))]
            );
        }

        // 原方程 -> 去分母 -> 去括号 -> 移项 -> 合并同类项 -> 化系数为一
        // 每一步都返回 { title, expr, reason }，expr 是纯文本（页面再交给 toLatexText 排版）
        function buildSteps(question, answer) {
            const steps = [];
            const push = (title, eq, reason) => {
                const expr = eq.render();
                const last = steps[steps.length - 1];
                if (last && norm(last.expr) === norm(expr)) return;
                steps.push({ title, expr, reason: reason || '' });
            };

            let eq;
            try {
                eq = Equation.parse(question);
            } catch (e) {
                return [{ title: '答案', expr: answer, reason: '' }];
            }
            push('原方程', eq);

            // 去分母：有分母就一直去掉（嵌套括号里的分母也会在后续轮次处理）
            for (let guard = 0; guard < 6; guard++) {
                if (!hasDenominators(eq.left) && !hasDenominators(eq.right)) break;
                const L = lcm(termDenoms(eq.left.concat(eq.right), []));
                eq = clearDenominators(eq);
                push('去分母', eq, `两边同乘 ${L}`);
            }

            // 去括号：一层一层剥
            let bracketGuard = 0;
            while (hasBrackets(eq.left) || hasBrackets(eq.right)) {
                if (++bracketGuard > 6) break;
                eq = new Equation(expandOneLevel(eq.left), expandOneLevel(eq.right));
                push('去括号', eq, '括号前的数要乘到括号里的每一项，减号要变号');
            }

            // 移项：先移常数、后移含 x 的项；一次移一项
            let moveGuard = 0;
            while (moveNeeded(eq)) {
                if (++moveGuard > 8) break;
                eq = moveOneTerm(eq);
                if (!eq) break;
                const lastStep = steps[steps.length - 1];
                const expr = eq.render();
                if (lastStep && norm(lastStep.expr) === norm(expr)) break;
                push('移项', eq, '把含 x 的项移到左边、常数项移到右边，移过去的项要变号');
            }

            // 合并同类项：合并后还有同类项就不再输出（一步到位）
            if (mergeNeeded(eq.left) || mergeNeeded(eq.right)) {
                eq = new Equation(mergeTerms(eq.left), mergeTerms(eq.right));
                push('合并同类项', eq, '系数相加，字母部分不变');
            }

            // 化系数为一
            const solved = divideCoefficient(eq);
            if (solved) {
                eq = solved;
                push('化系数为一', eq, '两边同除以 x 的系数');
            }

            // 最后一步必须正好是 x = answer（answer 形如 "x=4"）
            if (norm(steps[steps.length - 1].expr) !== norm(answer)) {
                steps.push({ title: '化系数为一', expr: answer, reason: '两边同除以 x 的系数' });
            }
            return steps;
        }

        // ======================================================================
        // 形如 2.5、-0.25 的有限小数（结果能精确表示）：允许学生这样写
        function isTerminatingDecimal(text) {
            const re = /\d*\.\d+/g;
            let m = re.exec(text);
            let seen = false;
            while (m) {
                seen = true;
                if (m[0].length > 12) return false;
                m = re.exec(text);
            }
            return seen;
        }

        // 4. 判题
        // ======================================================================
        // 学生写的常量「化成最简了吗」：只看写法，不看数值。
        // rational 一经运算就自动约分（mathjs Fraction 的 n/d 永远互质），解析出来再去比 n、d 是查不出
        // 15/10、4/6 的，所以这里回到学生答案的原始文本上数：逐个斜杠取出紧挨着的分子和分母，
        // 出现 a/b 且 gcd(a, b) > 1 就说明能约没约（-2/4 的负号在式子里，不影响分母的 gcd）。
        // 分子/分母允许是括号组（(2*3)/4），只要整段只含数字就能算成一个整数参与判断；
        // 含 x 之类算不出来的片段跳过，交给后面的数值判等兜底。
        function hasUnreducedFraction(text) {
            const expr = String(text || '').replace(/\s/g, '');
            for (let i = 0; i < expr.length; i++) {
                if (expr[i] !== '/') continue;
                // 分子分母各取紧挨着斜杠的那一段：3/2+0/4 里的 0/4 才不会被并成 (3/2+0)/4
                const numText = scanOperand(expr, i, -1);
                const denText = scanOperand(expr, i, 1);
                if (!numText || !denText) continue;
                const num = staticValue(numText);
                const den = staticValue(denText);
                // 分母是 ±1 的分数等于整数、分子是 0 的分数就是 0：约不约都一样，不算没约分
                if (num === null || den === null || den === 0 || Math.abs(den) === 1 || num === 0) continue;
                if (gcdInt(Math.abs(num), Math.abs(den)) > 1) return true;
            }
            return false;
        }
        // 从斜杠位置往左（dir=-1）或往右（dir=1）取紧挨着的那个「原子」：
        // 就是它自己所在的这一个分数，不把旁边的加减项卷进来（3/2+0/4 只看 0/4）。
        function scanOperand(expr, slash, dir) {
            let i = slash + dir;
            if (i < 0 || i >= expr.length) return '';
            // 符号位跟着紧邻的原子（4/-2 里的 -2），但斜杠前面的 3-2/4 不能把 3- 当成分子
            const start = i;
            if (expr[i] === '-' || expr[i] === '+') i += dir;
            if (expr[i] === '(') {
                // 括号组：找配对的那一个括号
                let depth = 0;
                for (; i >= 0 && i < expr.length; i += dir) {
                    if (expr[i] === ')') depth++;
                    else if (expr[i] === '(') { depth--; if (depth === 0) break; }
                }
                if (i < 0 || i >= expr.length) return '';
                i += dir;
            } else {
                // 数字串（含小数点）：一直吃到不是数字为止
                while (i >= 0 && i < expr.length && /[0-9.]/.test(expr[i])) i += dir;
            }
            return dir > 0 ? expr.slice(start, i) : expr.slice(i + 1, start + 1);
        }
        // 一段只含数字和运算符的文本能算成整数就返回它，否则返回 null（含 x、带分数之类一律跳过）
        function staticValue(text) {
            let v;
            try { v = parseSide(text); } catch (e) { return null; }
            if (!R.isZero(v.x) || v.c.d !== 1n) return null;
            return Number(v.c.s * v.c.n);
        }
        function gcdInt(a, b) {
            while (b) { const t = a % b; a = b; b = t; }
            return a;
        }
        // 化到 x = 常数但常数能约分（15/10、4/6）时给出提示；已经最简返回 null
        function unreducedNotice(studentText, goal) {
            if (!goal || goal.d === 1n) return null;
            if (!hasUnreducedFraction(studentText)) return null;
            return '对，但结果没化成最简分数，请把 x 的值约到最简（如 ' + R.toPlain(goal) + '）';
        }

        function evaluateAnswer(studentAnswer, standardAnswer) {
            const raw = String(studentAnswer === undefined || studentAnswer === null ? '' : studentAnswer).trim();
            if (!raw) return { status: 'error', msg: '还没有写答案呢' };

            // 连续符号只拦「同一侧」的：x=-3 里 = 后面的 - 是合法的符号位
            const compact = raw.replace(/\s/g, '');
            const parts = compact.split('=');
            if (parts.length > 2) return { status: 'error', msg: '式子里有超过一个等号，请检查输入格式' };
            if (parts.some(p => /[+\-*/]{2,}/.test(p))) {
                return { status: 'error', msg: '式子里有连续符号，请检查输入格式' };
            }
            // 有限小数（2.5、-0.25）转成分子/分母再算；不是有限小数就提醒用分数
            let text = compact;
            if (/\./.test(text)) {
                if (!isTerminatingDecimal(text)) {
                    return { status: 'error', msg: '请用分数作答，比如 1/2，不要写小数' };
                }
                text = text.replace(/\d*\.\d+/g, (m) => {
                    const [intPart, frac] = m.split('.');
                    return `${intPart || 0}${frac}/${'1' + '0'.repeat(frac.length)}`;
                });
            }
            const pieces = text.split('=');

            let std;
            try {
                std = parseEquation(standardAnswer);
            } catch (e) {
                return { status: 'error', msg: '标准答案异常，请刷新题目' };
            }

            // 标准答案是 x = 常数：直接比数值。
            // 学生写 4、-3、1/2、5/2、4 = x、x = 4 都算「化到了系数一」；
            // 写成 2x = 8、x + 3 = 7 这种同解但没化简的，算 unmerged。
            const stdK = R.sub(std.left.x, std.right.x);
            const goal = R.isInt(stdK, 1) && R.isZero(std.left.c) ? std.right.c : null;
            if (goal) {
                const direct = trySolveValue(pieces);
                if (direct === 'identity' || direct === 'none') {
                    return { status: 'wrong', msg: '答案不对，再检查一下移项和变号' };
                }
                if (direct !== null && R.eq(direct, goal)) {
                    // 数值/形式都对，但把 x 的值写成了没约分的分数（15/10）：按「没做完」处理
                    const unreduced = unreducedNotice(compact, goal);
                    if (unreduced) return { status: 'unmerged', msg: unreduced };
                    return { status: 'correct', msg: '完全正确！' };
                }
            }

            // 兜底：把学生写的当成一个方程，和标准方程比是否同解
            let stu;
            try {
                stu = parseEquationAnswer(pieces);
            } catch (e) {
                return { status: 'error', msg: '式子无法解析，请检查输入格式（用 x 表示未知数）' };
            }
            const stuSol = solveOf(stu);
            const stdSol = solveOf(std);
            const equal = (typeof stuSol === 'string' || typeof stdSol === 'string')
                ? stuSol === stdSol
                : R.eq(stuSol, stdSol);
            if (!equal) return { status: 'wrong', msg: '答案不对，再检查一下移项和变号' };
            if (!isSolvedForm(stu)) {
                return { status: 'unmerged', msg: '对，但还没有化系数为一（结果要写成 x = 几）' };
            }
            return { status: 'correct', msg: '完全正确！' };
        }

        // 「x = 常数」「4 = x」，或者干脆只写一个数：都映射到 x 的值
        // 返回 R（x 的值）、'identity'、'none'，解析不了返回 null
        function trySolveValue(pieces) {
            if (pieces.length === 1) {
                const v = safeValue(pieces[0]);
                return v && R.isZero(v.x) ? v.c : null;
            }
            const left = safeValue(pieces[0]);
            const right = safeValue(pieces[1]);
            if (!left || !right) return null;
            if (R.isZero(left.x) && R.isInt(right.x, 1) && R.isZero(right.c)) return left.c;
            if (R.isZero(right.x) && R.isInt(left.x, 1) && R.isZero(left.c)) return right.c;
            return null;
        }
        function safeValue(text) {
            try { return parseSide(text); } catch (e) { return null; }
        }
        // 学生写的等式 -> { left, right }（都是 { x, c }）；只写一个式子时当成 0 = 式子
        function parseEquationAnswer(pieces) {
            if (pieces.length === 2) {
                return { left: parseSide(pieces[0]), right: parseSide(pieces[1]) };
            }
            return { left: { x: R.zero, c: R.zero }, right: parseSide(pieces[0]) };
        }
        function solveOf(eq) {
            const k = R.sub(eq.left.x, eq.right.x);
            const c = R.sub(eq.right.c, eq.left.c);
            if (R.isZero(k)) return R.isZero(c) ? 'identity' : 'none';
            return R.div(c, k);
        }
        // 已经化到「x = 常数」：等号左边是单个 x、右边是常数（4 = x 也算，能一眼看出答案）
        function isSolvedForm(eq) {
            if (R.isInt(eq.left.x, 1) && R.isZero(eq.left.c) && R.isZero(eq.right.x)) return true;
            return R.isZero(eq.left.x) && R.isZero(eq.left.c) && R.isInt(eq.right.x, 1);
        }

        // ======================================================================
        // 5. 提示
        // ======================================================================
        function hintsFor(question) {
            const hints = [];
            let eq = null;
            try { eq = Equation.parse(question); } catch (e) { eq = null; }

            if (eq) {
                const hasDen = hasDenominators(eq.left) || hasDenominators(eq.right);
                const hasBrk = hasBrackets(eq.left) || hasBrackets(eq.right);
                const leftVar = eq.left.some(t => t.hasVar);
                const rightVar = eq.right.some(t => t.hasVar);
                if (hasDen) hints.push('这个方程有分母，先去分母：两边同乘各分母的最小公倍数，别忘了乘不含分母的项。');
                if (hasBrk) hints.push('先去括号：括号外面的数要乘到括号里的每一项，括号前是减号时每一项都要变号。');
                if (leftVar && rightVar) hints.push('未知数在两边：把含 x 的项都移到左边、常数都移到右边，移过去的项要变号。');
                else if (leftVar) hints.push('先把常数项移到右边、把含 x 的项留在左边，移过去的项要变号。');
                else hints.push('先把含 x 的项移到左边，再处理常数。');
                hints.push('移完项后合并同类项，最后两边同除以 x 的系数（化系数为一）。');
            } else {
                hints.push('先把方程整理成左边含 x、右边是常数的形式，再移项、合并、化系数为一。');
            }
            return hints;
        }

        // ======================================================================
        // 6. 出题
        // ======================================================================
        // 思路：先定「解 x0」，按档位挑结构，再用「把常数项设成能配平的值」反推等式，
        // 保证一定有解；最后用同解判定复核。
        // 分数的写法统一用「括号项 × 分数系数」：1/2(x + 3)。渲染成 1/2(x + 3)，
        // 去分母后自然变成 (x + 3)，与课本写法一致。
        const FRACTION_RATE = { 1: 0, 2: 0.2, 3: 0.4, 4: 0.6 };
        const FRACTIONS = [R.from(1, 2), R.from(-1, 2), R.from(1, 3), R.from(-1, 3),
            R.from(1, 4), R.from(-1, 4), R.from(1, 5), R.from(-1, 5), R.from(1, 6), R.from(-1, 6)];

        // 解：整数为主，偶尔分数（分母 2~4），避免 0（和化简页「答案不能是 0」口径一致）
        function pickSolution(useFraction) {
            if (!useFraction) return R.fromNumber(randNonZero(-9, 9));
            const d = pick([2, 3, 4]);
            const n = randNonZero(-6, 6);
            if (n % d === 0) return R.fromNumber(n / d);
            return R.from(n, d);
        }
        // 常数项（配平用）：让两边都写得出来、又不太大
        function pickConst(max) {
            const v = rand(-max, max);
            return R.fromNumber(v);
        }
        // 一元一次式的「一边」：k1 · x + b，k1 可为分数
        function sideOfLinear(k, b) {
            const out = [];
            if (!R.isZero(k)) out.push(Term.x(k));
            if (!R.isZero(b)) out.push(Term.num(b));
            if (!out.length) out.push(Term.num(R.zero));
            return out;
        }
        // 取一个「不为 0 的系数」：整数档 ±2..9（偶尔 ±1），分数档 ±1/2 之类
        // 一半概率取负：只取正系数时 L4 把 1/m 直接乘出去会得到 -1/2(x)，去分母要清括号里的一层数字，
        // 「去分母」那一步就被吞掉了（步骤里只剩去括号），学生看不到「两边同乘」的讲解
        function pickCoefficient(useFraction) {
            if (useFraction) return pick(FRACTIONS);
            const v = randNonZero(2, 9);
            return R.fromNumber(Math.random() < 0.5 ? v : -v);
        }
        // 取一个「整数括号乘数」：1..9，避免 1 和 -1 直接写出来太单调
        function pickMultiplier() {
            return R.fromNumber(Math.random() < 0.15 ? pick([1, -1]) : randNonZero(2, 9));
        }

        // 由 x0 反推：a·x + b = c，其中 a、c 是随机数，b = c - a·x0
        function fromLinear(useFraction) {
            const x0 = pickSolution(useFraction);
            const a = pickCoefficient(useFraction);
            const c = useFraction ? pick(FRACTIONS) : pickConst(9);
            const b = R.sub(c, R.mul(a, x0));
            if (R.isZero(b)) return null;
            return { left: sideOfLinear(a, b), right: sideOfLinear(R.zero, c), x0 };
        }
        // a(x + b) = c 形式：b 先选，c 由配平算
        function fromGrouped() {
            const x0 = R.fromNumber(randNonZero(-6, 6));
            const a = pickMultiplier();
            const b = pickConst(6);
            const c = R.mul(a, R.add(x0, b));
            if (R.isZero(c)) return null;
            return {
                left: [Term.group(a, [Term.x(R.one), Term.num(b)])],
                right: sideOfLinear(R.zero, c),
                x0
            };
        }
        // 分数形式：f·(x + b) = 常数
        function fromFraction() {
            const x0 = pickSolution(true);
            const m = R.fromNumber(pick([2, 3, 4, 6]));
            const f = R.div(R.one, m);
            const b = pickConst(9);
            const c = R.mul(f, R.add(x0, b));
            if (R.isZero(c)) return null;
            return {
                left: [Term.group(f, [Term.x(R.one), Term.num(b)])],
                right: sideOfLinear(R.zero, c),
                x0
            };
        }

        // 具体模板（按档位）
        function template(level, useFraction) {
            if (level === 1) {
                // x + a = b、a - x = b、ax = b 之类：一次移项就出来
                const t = rand(1, 3);
                if (t === 1) {
                    const x0 = R.fromNumber(randNonZero(-9, 9));
                    const a = R.fromNumber(randNonZero(-9, 9));
                    return { left: [Term.x(R.one), Term.num(a)], right: [Term.num(R.add(x0, a))], x0 };
                }
                if (t === 2) {
                    const x0 = R.fromNumber(randNonZero(-9, 9));
                    const b = R.fromNumber(randNonZero(-9, 9));
                    return { left: [Term.num(b), Term.x(R.minusOne)], right: [Term.num(R.sub(b, x0))], x0 };
                }
                return fromLinear(false);
            }
            if (level === 2) {
                // ax + b = cx + d：未知数在两边；或 a(x + b) = c
                const x0 = R.fromNumber(randNonZero(-6, 6));
                const a = R.fromNumber(randNonZero(2, 9));
                const c = R.fromNumber(randNonZero(2, 9));
                if (R.eq(a, c)) return null;
                const b = pickConst(9);
                const d = R.add(R.mul(R.sub(a, c), x0), b);
                if (!isSmallConst(d, 60)) return null;
                return { left: sideOfLinear(a, b), right: sideOfLinear(c, d), x0 };
            }
            if (level === 3) {
                // 括号：a(x + b) = c(x + d)，或 a(x + b) + c = dx + e
                const x0 = R.fromNumber(randNonZero(-6, 6));
                const a = pickMultiplier();
                const c = pickMultiplier();
                if (R.eq(a, c)) return null;
                if (rand(1, 2) === 1) {
                    // 由 x0 反推括号里的常数项 p、q：a(x0 + p) = c(x0 + q)
                    const p = pickConst(6);
                    const need = R.div(R.mul(a, R.add(x0, p)), c);
                    const q = R.sub(need, x0);
                    if (q.d !== 1n || !isSmallConst(q, 12)) return null;
                    // 括号里只有 x（p 或 q 为 0）时渲染出来是 4(x) 这种别扭写法，换一种模板
                    if (R.isZero(q) || R.isZero(p)) return null;
                    return {
                        left: [Term.group(a, [Term.x(R.one), Term.num(p)])],
                        right: [Term.group(c, [Term.x(R.one), Term.num(q)])],
                        x0
                    };
                }
                // a(x + b) + c = dx + e：左边带括号、右边含 x
                const p = pickConst(6);
                if (R.isZero(p)) return null;
                const tail = pickConst(9);
                const d = R.fromNumber(randNonZero(2, 9));
                if (R.eq(a, d)) return null;
                const e = R.sub(R.mul(R.sub(a, d), x0), R.add(R.mul(a, p), tail));
                if (!isSmallConst(e, 40)) return null;
                return {
                    left: [Term.group(a, [Term.x(R.one), Term.num(p)]), Term.num(tail)],
                    right: sideOfLinear(d, e),
                    x0
                };
            }
            // level 4：必须带数字分母
            const x0 = pickSolution(true);
            const t = rand(1, 3);
            if (t === 1) {
                // f·(x + a) + g·(x + b) = c：两项都带分母
                const m = R.fromNumber(pick([2, 3, 4]));
                const n = R.fromNumber(pick([2, 3, 4, 6]));
                const a = pickConst(6);
                const b = pickConst(6);
                // 括号里只有 x 时渲染成 1/3(x)，和后面的常数项不搭，换一种模板
                if (R.isZero(a) || R.isZero(b)) return null;
                const c = R.add(R.div(R.add(x0, a), m), R.div(R.add(x0, b), n));
                if (!isSmallConst(c, 60)) return null;
                return {
                    left: [
                        Term.group(R.div(R.one, m), [Term.x(R.one), Term.num(a)]),
                        Term.group(R.div(R.one, n), [Term.x(R.one), Term.num(b)])
                    ],
                    right: sideOfLinear(R.zero, c),
                    x0
                };
            }
            if (t === 2) {
                // f·(ax + b) = c：单项带分母
                // m 与 a 有公因数时 1/m·a 可以直接约掉（1/4·(4x + 3) 就是 x + 3/4），
                // 那样写出来是 (x + 3/4)，学生看不出「分母」在哪，所以要求 m 和 a 互质
                const m = R.fromNumber(pick([2, 3, 4]));
                const a = R.fromNumber(randNonZero(2, 6));
                if (Number(m.n) % Number(a.n) === 0) return null;
                const b = pickConst(9);
                if (R.isZero(b)) return null;
                const c = R.div(R.add(R.mul(a, x0), b), m);
                return {
                    left: [Term.group(R.div(R.one, m), [Term.x(a), Term.num(b)])],
                    right: sideOfLinear(R.zero, c),
                    x0
                };
            }
            // (x + a)/m = (x + b)/n：两边都有分母
            const m = R.fromNumber(pick([2, 3]));
            const n = R.fromNumber(pick([3, 4]));
            const a = pickConst(6);
            const b = R.sub(R.mul(R.div(n, m), R.add(x0, a)), x0);
            if (b.d !== 1n || !isSmallConst(b, 30)) return null;
            // 括号里只有 x 时是 1/2(x) 这种别扭写法，两边都要带常数项
            if (R.isZero(a) || R.isZero(b)) return null;
            return {
                left: [Term.group(R.div(R.one, m), [Term.x(R.one), Term.num(a)])],
                right: [Term.group(R.div(R.one, n), [Term.x(R.one), Term.num(b)])],
                x0
            };
        }
        function isSmallConst(v, max) {
            return v.d === 1n && Math.abs(Number(v.s * v.n)) <= max;
        }

        // 模板 -> 题目对象；带统一的质量校验，不合格返回 null 让外层重试
        function assemble(candidate) {
            if (!candidate) return null;
            const eq = new Equation(candidate.left, candidate.right);
            const sol = eq.solution();
            if (typeof sol === 'string' || !sol) return null;
            if (!R.eq(sol, candidate.x0)) return null;
            if (R.isZero(sol)) return null;
            const question = eq.render();
            if (/[+\-][+\-]/.test(norm(question))) return null;
            if (/\./.test(question)) return null;
            const nums = question.match(/\d+/g) || [];
            if (nums.some(n => Number(n) > 30)) return null;
            return { question, answer: 'x=' + R.toPlain(sol), sol };
        }

        // 对外：按难度出题
        function generateQuestion(level, options) {
            const lv = [1, 2, 3, 4].includes(Number(level)) ? Number(level) : 1;
            const kind = options && options.kind;
            const forceFraction = lv === 4;
            const useFraction = forceFraction || kind === 'fraction'
                || (kind !== 'integer' && Math.random() < FRACTION_RATE[lv]);

            for (let i = 0; i < 400; i++) {
                let built = null;
                try {
                    built = assemble(template(lv, useFraction));
                } catch (e) { continue; }
                if (!built) continue;
                const fraction = built.question.includes('/');
                if (forceFraction && !fraction) continue;
                const out = {
                    level: lv,
                    question: built.question,
                    answer: built.answer,
                    tags: fraction ? ['fraction'] : []
                };
                if (buildSteps(out.question, out.answer).length < 2) continue;
                return out;
            }
            return forceFraction || useFraction
                ? { level: lv, question: '1/2(x + 1) = 3/2', answer: 'x=2', tags: ['fraction'] }
                : { level: lv, question: '2x + 3 = x + 7', answer: 'x=4', tags: [] };
        }

        // ======================================================================
        // 7. LaTeX：方程页所有公式都走这里
        // ======================================================================
        // math-core 的 toLatexText 不认识 '='（会直接抛错返回 null），
        // 而方程题面、输入、每一步里都带等号，所以按 = 两侧分别转换再拼起来。
        function toLatexText(expr) {
            if (typeof expr !== 'string' || expr.trim() === '') return null;
            const parts = expr.split('=');
            const tex = [];
            for (let i = 0; i < parts.length; i++) {
                const piece = baseLatexText(parts[i]);
                if (!piece) return null;
                tex.push(piece);
            }
            // 等号两侧留一点空隙：KaTeX 默认把 a=b 排得很挤
            return tex.join('\\;=\\;');
        }

        return {
            generateQuestion,
            evaluateAnswer,
            buildSteps,
            hintsFor,
            parseEquation,
            sameSolution,
            Equation,
            Term,
            toLatexText
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createEquationEngine;
    } else {
        global.EquationEngine = createEquationEngine(global.math, global.MathCore, global.PolyTree);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);