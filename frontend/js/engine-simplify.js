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

        // 随机抽一个分数系数并丢掉符号：括号里出现「1/3x」时用，符号统一由外面的加减号决定
        // （写成「+ -1/3x」会撞上下面「连续符号」的质量校验，正确写法是把负号提到括号外：-(1/3x - 4)）
        function pickFractionBody() {
            return R.abs(pickFraction());
        }

        // 分数乘数乘括号：1/2(x + 4)、-1/3(a - b)
        function fracBracket(coef, inner) {
            return `${formatTermR(coef, '')}(${inner})`;
        }

        // 括号里的「变量 + 常数」：x + 4、x - 3
        function plusConst(base, c) {
            return c < 0 ? `${base} - ${Math.abs(c)}` : `${base} + ${c}`;
        }

        // 分数题骨架：返回「按模板名分好组」的生成器，_width 是这个模板在轮转里的名额，
        // _fallback 是兜底骨架（质量校验刷光时会补一个，保证每档都能稳定出题）。
        // prompt 只用随机数、不依赖参数，所以按槽位轮转 + 展开不会重复抽到可能凑出 1 的额外随机数
        // （如果 prompt 里再 rand() 一次，展开的空槽和白抽的槽会抽到不同的值，轮转就不再均匀）。
        // 抽题时先按 _width 轮转选模板、再均匀选槽位，做法见 pickSlot()。
        //
        // 所有模板都沿用现有 ASCII 写法：`*` 不出现（相邻因子的写法在 normalizeExpr 里补乘号）、
        // `/` 表示分数、负数加括号、负数常数由 joinSigned() 拼成「- 负数」的形式，不会出现「+ -」。
        // 分数的选择沿用 FRACTION_COEFS（分母 2/3/4/6、分子 ±1/±2/±3/±5），括号里的常数在 ±9 以内。
        // 分数题骨架：每档一张模板表，轮转抽题时「相邻两题的骨架不会落在同一类」，
        // _weight 是这个骨架在轮转里的名额（结构简单的老骨架名额多一点，新骨架各占一份）。
        // 题面里用到的随机数由下面 pick() 的「按槽位轮转」给出（见 fractionPick），
        // 负数、正负号这些不影响骨架的量才用 rand()/Math.random() 现抽。
        //
        // 写法沿用现有约定：数字紧跟字母（2x）、`/` 表示分数（1/2、x/3）、
        // 负数常数由 joinSigned()/plusConst() 拼成「- 3」「x - 3」，不会出现「+ -」。
        // 分数的选择沿用 FRACTION_COEFS（分母 2/3/4/6、分子 ±1/±2/±3/±5），括号里的常数在 ±9 以内。

        const FRACTION_TEMPLATES = {
            // ② 基础：分数题仍是「括号 + 常数」的量级，结构从原来的 1 种扩到 5 种
            2: [
                {
                    // 老骨架①：q(x ± c) + d，分数乘括号后和整数合并
                    name: 'single-bracket', weight: 2,
                    build: ({ q }) => joinSigned(fracBracket(q(), plusConst('x', rand(-6, 6))), '+', String(rand(-9, 9)))
                },
                {
                    // 老骨架②：d - q(x ± c)，常数在前、括号前是减号，括号里每一项都要变号
                    name: 'reverse-const', weight: 2,
                    build: ({ q }) => joinSigned(String(rand(-9, 9)), '-', fracBracket(q(), plusConst('x', rand(-6, 6))))
                },
                {
                    // 两个分数系数相加：q1(x ± c1) ± q2(x ± c2)，x 项和常数项分别合并
                    name: 'two-bracket', weight: 2,
                    build: ({ q }) => {
                        const q1 = q();
                        const q2 = q() === q1 ? -q1 : q();
                        return joinSigned(fracBracket(q1, plusConst('x', rand(-6, 6))),
                            Math.random() < 0.5 ? '+' : '-', fracBracket(q2, plusConst('x', rand(-6, 6))));
                    }
                },
                {
                    // 括号里自带分数系数：q(1/m x ± c)，先分数 × 分数，再合并
                    name: 'inner-coef', weight: 2,
                    build: ({ q }) => {
                        const f = R.abs(q());
                        return fracBracket(f, plusConst(formatTermR(f, 'x'), rand(-6, 6)));
                    }
                },
                {
                    // 分数常数减分数乘括号：1/2 - 1/3(x - 6)，括号前是减号，里面每一项都要变号
                    name: 'frac-const', weight: 2,
                    build: ({ q }) => joinSigned(formatTermR(q(), ''), '-', fracBracket(R.abs(q()), plusConst('x', rand(-6, 6))))
                },
                {
                    // 三项：d ± q1(x ± c1) - q2(x ± c2)，带负号的那整个括号要变号
                    name: 'const-plus-two', weight: 1,
                    build: ({ q }) => {
                        const q1 = q();
                        const q2 = q() === q1 ? -q1 : q();
                        const head = joinSigned(String(rand(-9, 9)), '+', fracBracket(q1, plusConst('x', rand(-6, 6))));
                        return joinSigned(head, '-', fracBracket(q2, plusConst('x', rand(-6, 6))));
                    }
                }
            ],
            // ③ 进阶：分数系数 + 整式项 + x²，括号前带减号、括号里带分数都要会处理
            3: [
                {
                    // 老骨架①：q1(x² ± c) - q2(x ± c)
                    name: 'square-minus', weight: 2,
                    build: ({ q }) => joinSigned(fracBracket(q(), plusConst('x^2', rand(-6, 6))),
                        '-', fracBracket(q(), plusConst('x', rand(-6, 6))))
                },
                {
                    // 老骨架②：q(x ± c) ± q2x ± d，分数系数与单项式、整数一起合并
                    name: 'bracket-mono', weight: 2,
                    build: ({ q }) => {
                        const q1 = q();
                        const mono = formatTermR(q1 === R.one ? q() : q(), 'x');
                        return joinSigned(joinSigned(fracBracket(q1, plusConst('x', rand(-6, 6))),
                            Math.random() < 0.5 ? '+' : '-', mono), '+', String(rand(-9, 9)));
                    }
                },
                {
                    // q1(x ± c1) - q2(x ± c2) + d：两个分数乘括号再加整数，常数项要通分
                    name: 'two-bracket-const', weight: 2,
                    build: ({ q }) => {
                        const q1 = q();
                        const q2 = q() === q1 ? -q1 : q();
                        return joinSigned(joinSigned(fracBracket(q1, plusConst('x', rand(-6, 6))), '-',
                            fracBracket(q2, plusConst('x', rand(-6, 6)))), '+', String(rand(-9, 9)));
                    }
                },
                {
                    // q(1/m x ± c) ± 分数常数：括号里分数系数、括号外分数常数
                    name: 'inner-coef-const', weight: 2,
                    build: ({ q }) => {
                        const f = R.abs(q());
                        return joinSigned(fracBracket(f, plusConst(formatTermR(f, 'x'), rand(-6, 6))),
                            Math.random() < 0.5 ? '+' : '-', formatTermR(q(), ''));
                    }
                },
                {
                    // q1(x² ± c1) - q2(x² ± c2) + 分数常数 - qx：x²、x 分开算，考「同类项要认次数」
                    name: 'square-pair', weight: 2,
                    build: ({ q }) => {
                        const q1 = q();
                        const q2 = q() === q1 ? -q1 : q();
                        const apart = joinSigned(joinSigned(fracBracket(q1, plusConst('x^2', rand(-6, 6))), '-',
                            fracBracket(q2, plusConst('x^2', rand(-6, 6)))), '+', formatTermR(q(), ''));
                        const tail = formatTermR(q(), 'x');
                        return joinSigned(apart, tail.startsWith('-') ? '+' : '-', tail);
                    }
                },
                {
                    // q1(x² ± c) + q2(2x ± c2)：括号里是 x² 与 x 两项，不能当成同类项合并
                    name: 'square-times', weight: 1,
                    build: ({ q }) => joinSigned(fracBracket(q(), plusConst('x^2', rand(-6, 6))),
                        '+', fracBracket(q(), plusConst('2x', rand(-6, 6))))
                }
            ],
            // ④ 挑战：仍然只用 x、y（和整数题口径一致），分数题考「x、x²、y、y²、xy 各算一类」
            4: [
                {
                    // 老骨架①：q1(x + 2y) - q2(x - y ± c)，括号前是减号
                    name: 'two-var-bracket', _group: 'two-var-bracket', weight: 2,
                    build: ({ q }) => joinSigned(fracBracket(q(), 'x + 2y'), '-',
                        fracBracket(q(), plusConst('x - y', rand(-4, 4))))
                },
                {
                    // 老骨架②：q1(x² + y ± c) - q2(xy - x)
                    name: 'two-var-square', _group: 'two-var-square', weight: 2,
                    build: ({ q }) => joinSigned(fracBracket(q(), plusConst('x^2 + y', rand(-4, 4))), '-',
                        fracBracket(q(), 'xy - x'))
                },
                {
                    // 老骨架③（嵌套）：q1(x + 2y - q2(x - y))，从最里面那一层括号开始去
                    name: 'nested', _group: 'nested', weight: 2,
                    build: ({ q }) => fracBracket(q(), joinSigned('x + 2y', '-', fracBracket(q(), 'x - y')))
                },
                {
                    // q1(x - y) ± q2(y - x)：同一个括号换个顺序，x 项与 y 项分别合并
                    name: 'swap-bracket', _group: 'swap-bracket', weight: 2,
                    build: ({ q }) => {
                        const q1 = q();
                        const q2 = q() === q1 ? -q1 : q();
                        return joinSigned(fracBracket(q1, 'x - y'), '+', fracBracket(q2, 'y - x'));
                    }
                },
                {
                    // q1(x² + y) - q2(x² - y) + q(y ± c)：x²、x、y 三类都要分清
                    name: 'square-y', _group: 'square-y', weight: 2,
                    build: ({ q }) => joinSigned(joinSigned(fracBracket(q(), 'x^2 + y'), '-',
                        fracBracket(q(), 'x^2 - y')), '+', fracBracket(q(), plusConst('y', rand(-4, 4))))
                },
                {
                    // q(1/m x - y ± c) - q2(x - y)：括号里分数系数 + 双字母
                    name: 'two-var-inner-coef', _group: 'two-var-inner-coef', weight: 1,
                    build: ({ q }) => {
                        const f = R.abs(q());
                        return joinSigned(fracBracket(f, plusConst(formatTermR(f, 'x'), rand(-4, 4)) + ' - y'),
                            '-', fracBracket(q(), 'x - y'));
                    }
                }
            ]
        };


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

        // 分数题抽题：模板按 _weight 轮流上场，题里的随机数按「槽位」轮流取，
        // 这样连着抽 300 题时每种骨架都会稳定出现，不会因为纯随机而有的骨架一次都不出。
        // （学生做题是单次调用，看不出轮转；测试和大批量出题则能覆盖到全部骨架。）
        const fractionCursor = {};
        const fractionSlot = {};

        // 同一题里最多用到 4 个分数系数；short 是这个模板真正会用到的个数，
        // 每次调用换一个起点（0..3），避免总是把 ±1/2 放在第一个槽位上。
        function fractionPick(stage, short = 4) {
            const n = short > 0 ? Math.min(short, 4) : 4;
            if (short === 0) {
                // 纯整数槽位，不用分数
                return rand(1, 9);
            }
            const key = String(n);
            if (!(fractionSlot[key] === undefined)) {
                // 有槽位约束：取一个还没用过的分数
                const used = fractionSlot[key];
                const rest = FRACTION_COEFS.filter((c) => !used.some((u) => R.equals(u, c)));
                const coef = rest.length ? rest[Math.floor(Math.random() * rest.length)] : pickFraction();
                used.push(coef);
                return coef;
            }
            const idx = (fractionCursor[key] || 0) % FRACTION_COEFS.length;
            fractionCursor[key] = idx + 1;
            return FRACTION_COEFS[idx];
        }

        // 模板轮转：按 _weight 展开成一圈，逐个取；
        // 正负号、文字顺序这类「同类型」的变体单独分组，轮转按组均匀走——
        // 否则 weight 高的同类骨架会盖住别的骨架，题面看着就单调了。
        const fractionTurn = { 2: 0, 3: 0, 4: 0 };
        const fractionGroupTurn = {};

        function pickFractionTemplate(lv) {
            const table = FRACTION_TEMPLATES[lv] || FRACTION_TEMPLATES[2];
            const wheel = [];
            table.forEach((t) => {
                for (let i = 0; i < (t._weight || 1); i++) wheel.push(t);
            });
            const idx = (fractionTurn[lv] || 0) % wheel.length;
            fractionTurn[lv] = idx + 1;
            const group = wheel[idx]._group || wheel[idx].name;
            const members = table.filter((t) => (t._group || t.name) === group);
            const gIdx = (fractionGroupTurn[group] || 0) % members.length;
            fractionGroupTurn[group] = gIdx + 1;
            return members[gIdx];
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
                let expr;
                if (useFraction) {
                    const tpl = pickFractionTemplate(lv);
                    const n = tpl.uses || 4;
                    // 起始槽位每次挪一格：q() 从这里开始按 fractionPick 依次取
                    const start = Math.floor(Math.random() * n);
                    let used = 0;
                    const q = () => fractionPick((start + used++) % n, n);
                    expr = tpl.build({ q });
                    // 把「同一题里不许重复」的槽位记录清掉
                    Object.keys(fractionSlot).forEach((k) => { delete fractionSlot[k]; });
                } else {
                    expr = buildTemplate(lv);
                }
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
