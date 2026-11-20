// frontend/js/arith-engine.js —— 口算训练：出题、判题、分步解析、提示、LaTeX
// 依赖 math-core.js 提供的 R（有理数）；所有数值都用 R 精确计算，不碰浮点。
// 不接触 DOM / KaTeX / 网络 / localStorage；Node 端 require，浏览器端挂 window.ArithEngine。
//
// ---- 四档（SPEC 第 0 节）----
//   ① 入门：百以内正负数加减，三项连算式（-17 + 42 - 35）
//   ② 基础：① + 分数加减（异分母通分、分数与整数混合，值仍落在百以内）
//   ③ 进阶：② + 乘除（负数乘除、分数乘除约分、小数乘除）
//   ④ 挑战：混合运算与简算（括号优先级、分数连乘除、平方/立方、分配律/平方差凑整）
//
// ---- 题面写法（SPEC 2.2）----
//   乘号写 *，除号/分数线写 /，负数跟在运算符后面时加括号（12 - (-5)、(-7) * 8），
//   题面开头的负数可以直接写 -17；乘方写 ^2 / ^3 且底数带括号（(-2)^3、(3/4)^2）；
//   题面里不出现连续符号（+- / -- / *- / /-）。
//
// ---- 数值口径 ----
//   出题先挑「题面里的数」（整数、分数、小数都由整数构造），再用 R 精确求答案；
//   小数一律由「整百分数 -> 文本」生成，避免 0.1 + 0.2 的浮点尾巴；
//   加数里的分数一律已是最简分数，约分只出现在答案位置上。
//   每道题出完后用 validQuestion 自检（字符集、连续符号、各档梯度、答案规模、
//   解析值必须等于标准答案），不合法就重摇。
//
// ---- 步骤与提示（SPEC 2.3 / 2.4）----
//   buildSteps 只依赖题面本身：把题面解析成语法树，再一步一步折叠「最该先算」的子式
//   （乘方 -> 括号 -> 乘除 -> 加减），每步都是等价变形，末步就是答案。分数题在通分/约分
//   时会给出通分过程；④ 档的简算题走「用分配律 / 凑整 / 平方差」的讲解。

(function (global) {
    'use strict';

    function createArithEngine(math, core) {
        if (!math) throw new Error('arith-engine.js 需要 mathjs');
        let mathCore = core;
        if (!mathCore) {
            // 浏览器端页面先加载 math-core.js（挂 window.MathCore）；Node 端测试直接 require
            mathCore = typeof require === 'function'
                ? require('./math-core.js')(math)
                : global.MathCore;
        }
        if (!mathCore) throw new Error('math-core.js 未加载');

        const R = mathCore.rational;

        // ==================================================================
        // 0. 小工具
        // ==================================================================
        function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        function randNonZero(min, max) {
            let v = 0;
            while (v === 0) v = rand(min, max);
            return v;
        }
        function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
        function coinf(p) { return Math.random() < p; }
        function signOf() { return coinf(0.5) ? 1 : -1; }
        function norm(text) { return String(text).replace(/\s+/g, ''); }

        function gcd(a, b) {
            let x = Math.abs(a);
            let y = Math.abs(b);
            while (y) { const t = x % y; x = y; y = t; }
            return x || 1;
        }
        function lcmOf(a, b) { return a / gcd(a, b) * b; }

        // R 的内部表示：n/d/s 都是 bigint，符号在 s 上
        function numOf(f) { return Number(f.s) * Number(f.n); }
        function denOf(f) { return Number(f.d); }
        function fracValue(f) { return numOf(f) / denOf(f); }

        // 算式开头的数：整数负数写 (-7)，分数按 -3/4 写（分数线已经把三项连成一个数）
        function lead(n, d) {
            if (d === 1) return n < 0 ? `(${n})` : String(n);
            return n < 0 ? `-${-n}/${d}` : `${n}/${d}`;
        }
        // 运算数位置上的数：负数要括号，得到 12 + (-5)、12 - (-5)
        function term(n, d) {
            const text = d === 1 ? String(n) : `${n}/${d}`;
            return n < 0 ? `(${text})` : text;
        }
        function fracText(n, d) { return d === 1 ? String(n) : `${n}/${d}`; }

        // 小数由「整百分数 -> 文本」生成：decText(-125, 2) -> "-1.25"，decText(75, 2) -> "0.75"
        function decText(hundreds, places) {
            const v = Math.abs(hundreds);
            const scale = Math.pow(10, places);
            const whole = Math.floor(v / scale);
            const rest = String(v % scale).padStart(places, '0');
            return `${hundreds < 0 ? '-' : ''}${whole}.${rest}`;
        }
        // 「分母不太大」：结果化成最简后分母 <= 12，学生才口算得出来
        function niceDen(f) { return Number(f.d) <= 12; }

        // 小数题按小数的样子显示答案：1.4 * 3 的值是 21/5，学生写 4.2 才是他算出来的东西。
        // 只有「题面里全是小数/整数、且值能被 ≤3 位小数精确写出」才转，
        // 像 1/3 这种写不尽的仍显示分数——否则就把一个准确的答案拆成了近似值。
        // 返回 null 表示不转（调用方继续用原来的分数写法）
        function decimalAnswerText(str) {
            if (!hasDecimalToken(str)) return null;
            let text;
            try {
                text = R.toPlain(evalExpr(str));
            } catch (err) {
                return null;
            }
            const m = /^(-?)(\d+)(?:\/(\d+))?$/.exec(text);
            if (!m) return null;
            let n = BigInt(m[2]);
            let d = m[3] ? BigInt(m[3]) : 1n;
            if (d === 1n) return text; // 整数答案本来就是整数，不用改
            // d 去掉 2、5 因子后还剩 1，这个分数才能写成有限小数
            let rest = d;
            let twos = 0;
            let fives = 0;
            while (rest % 2n === 0n) { rest /= 2n; twos++; }
            while (rest % 5n === 0n) { rest /= 5n; fives++; }
            if (rest !== 1n) return null;
            const places = Math.max(twos, fives);
            if (places > 3) return null;
            const digits = String(n * BigInt(Math.pow(10, places)) / d);
            const padded = digits.padStart(places + 1, '0');
            const whole = padded.slice(0, padded.length - places);
            const tail = padded.slice(padded.length - places);
            return (m[1] ? '-' : '') + whole + '.' + tail;
        }

        // 分数作为加数时要已经是最简分数（不能出现 6/8、8/12）
        function isReduced(n, d) { return d === 1 || gcd(Math.abs(n), d) === 1; }

        // ==================================================================
        // 1. 解析与求值
        // ==================================================================

        // 全角 / 常见错写的运算符统一成半角：（ ） ＋ － × ÷ ＝ 以及各种乘除异体
        function toHalfWidth(text) {
            return String(text === undefined || text === null ? '' : text)
                .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
                .replace(/\u3000/g, ' ')
                .replace(/[×✕✖⋅·＊]/g, '*')
                .replace(/[÷∕／]/g, '/')
                .replace(/[−–—]/g, '-')
                .replace(/\s+/g, '')
                .trim();
        }

        // 浮点结果 -> 有理数：只接受「有限小数」，取近分数后核对误差。
        // mathjs 的 Fraction 把负号放在 s 上（-5 存成 n=5、s=-1），核对时必须带上 s，
        // 否则负数会被误判成「不是有限小数」。
        function numberToR(value) {
            if (!Number.isFinite(value)) throw new Error('结果不是有限数');
            const fr = math.fraction(value);
            const back = Number(fr.s) * Number(fr.n) / Number(fr.d);
            if (!Number.isFinite(back) || Math.abs(back - value) > 1e-9) throw new Error('结果不是有限小数');
            return R.from(numOf(fr), denOf(fr));
        }

        function valueToR(value) {
            if (typeof value === 'number') return numberToR(value);
            if (value && typeof value === 'object'
                && typeof value.n === 'bigint' && typeof value.d === 'bigint') return value;
            throw new Error('结果不支持');
        }

        // 纯文本算式 -> 有理数；非法一律抛错（调用方负责折成 status:'error'）
        function evalExpr(text) {
            const s = toHalfWidth(text);
            if (!s) throw new Error('空式子');
            if (s.indexOf('=') >= 0) throw new Error('只能写一个数');
            if (/[^0-9+\-*/().^]/.test(s)) throw new Error('含有不能识别的字符');
            // 开头允许一个负号（-17、-(3/4)），其余位置不允许连续符号
            const body = s.charAt(0) === '-' ? s.slice(1) : s;
            if (/[+\-*/^]{2}/.test(body) || s.indexOf('..') >= 0) throw new Error('出现了连续符号');
            let value;
            try {
                value = math.parse(s).compile().evaluate({});
            } catch (err) {
                throw new Error('式子写法不对');
            }
            return valueToR(value);
        }

        // ==================================================================
        // 2. 题面结构工具
        // ==================================================================
        function tokensOf(str) { return String(str).split(' ').filter((p) => p !== ''); }
        function stripParens(tok) { return tok.replace(/^\(/, '').replace(/\)$/, ''); }

        // 真正的「分数」token：3/4、-3/4；(3/4) 是括号里的算式，不算
        function hasFractionToken(str) {
            return tokensOf(str).some((tok) => /^-?\d+\/\d+$/.test(tok) && tok.charAt(0) !== '(');
        }
        function hasDecimalToken(str) { return /\d\.\d/.test(str); }

        function opsOf(str) {
            const s = norm(str);
            const ops = [];
            if (s.indexOf('^') >= 0) ops.push('^');
            if (s.indexOf('(') >= 0) ops.push('()');
            if (s.indexOf('*') >= 0) ops.push('*');
            if (s.indexOf('/') >= 0) ops.push('/');
            if (s.indexOf('+') >= 0) ops.push('+');
            if (s.indexOf('-') >= 0) ops.push('-');
            return ops;
        }

        function tagsOf(str) {
            const tags = [];
            if (hasFractionToken(str)) tags.push('fraction');
            if (hasDecimalToken(str)) tags.push('decimal');
            return tags;
        }

        // ==================================================================
        // 3. 解析树（只认数字、+ - * / ^ 和括号）
        // ==================================================================
        // node: { k:'num', v } / { k:'neg', v } / { k:'group', v } / { k:'op', op, l, r } / { k:'pow', base, exp }
        function parseTree(text) {
            const s = norm(text);
            if (!s) return null;
            const tokens = [];
            for (let i = 0; i < s.length;) {
                const ch = s.charAt(i);
                if (/[0-9.]/.test(ch)) {
                    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
                    if (!m) return null;
                    tokens.push({ t: 'num', v: m[0] });
                    i += m[0].length;
                    continue;
                }
                if ('+-*/^'.indexOf(ch) >= 0 || ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue; }
                return null;
            }
            let i = 0;
            // 预先把「数字 / 数字」合成一个分数 token：3/4 * 5/6 是「两个分数相乘」，
            // 不能按左结合变成 ((3/4)*5)/6；36 / 4 * 3 里的 36/4 同样先合成分数（36/4 = 9）。
            // 只合并「纯数字 / 非零纯数字」，分母是 0 不合并（交给求值时报错）。
            for (let k = 0; k + 2 < tokens.length; k++) {
                const a = tokens[k];
                const b = tokens[k + 1];
                const c = tokens[k + 2];
                if (!(a && a.t === 'num' && b && b.t === '/' && c && c.t === 'num')) continue;
                if (Number(c.v) === 0) continue;
                // 除法是左结合，但「数字/数字」在口算题里几乎总是分数：3/4 * 5/6 是两分数相乘，
// 48 * 6 / 4 里的 6/4 当分数算也不影响结果（48 × 1.5 = 72）。
                // 唯一不能合并的是紧跟在除号后面的那个 a/b（1 / 6 / 4 = 1/24，不是 1/(6/4)）。
                const leftDiv = k > 0 && tokens[k - 1] && tokens[k - 1].t === '/';
                if (leftDiv) continue;
                tokens.splice(k, 3, { t: 'frac', v: `${a.v}/${c.v}` });
            }
            function expr() {
                let node = term();
                while (i < tokens.length && (tokens[i].t === '+' || tokens[i].t === '-')) {
                    const op = tokens[i++].t;
                    node = { k: 'op', op, l: node, r: term() };
                }
                return node;
            }
            function term() {
                let node = unary();
                while (i < tokens.length && (tokens[i].t === '*' || tokens[i].t === '/')) {
                    const op = tokens[i++].t;
                    node = { k: 'op', op, l: node, r: unary() };
                }
                return node;
            }
            // 纯数字（没有括号、没有运算符）的节点
            function isPureNumNode(node) {
                if (!node) return false;
                if (node.k === 'num') return true;
                if (node.k === 'neg') return isPureNumNode(node.v);
                return false;
            }
            function unary() {
                if (tokens[i] && tokens[i].t === '-') { i++; return { k: 'neg', v: unary() }; }
                if (tokens[i] && tokens[i].t === '+') { i++; return unary(); }
                return power();
            }
            function power() {
                const base = atom();
                if (!base) return null;
                if (tokens[i] && tokens[i].t === '^') {
                    i++;
                    const exp = atom();
                    if (!exp) return null;
                    return { k: 'pow', base, exp };
                }
                return base;
            }
            function atom() {
                const tk = tokens[i];
                if (!tk) return null;
                if (tk.t === '(') {
                    i++;
                    const inner = expr();
                    if (!inner || !tokens[i] || tokens[i].t !== ')') return null;
                    i++;
                    return { k: 'group', v: inner };
                }
                if (tk.t === 'num') { i++; return { k: 'num', v: tk.v }; }
                // 分数 token：3/4 解析成 op '/' + num 3 + num 4（isFractionNode 认它）
                if (tk.t === 'frac') {
                    i++;
                    const parts = tk.v.split('/');
                    return { k: 'op', op: '/', l: { k: 'num', v: parts[0] }, r: { k: 'num', v: parts[1] } };
                }
                return null;
            }
            const tree = expr();
            if (!tree || i !== tokens.length) return null;
            return tree;
        }

        function treeValue(node) {
            if (node.k === 'val') return node.v;
            if (node.k === 'num') return numberToR(Number(node.v));
            if (node.k === 'neg') return R.neg(treeValue(node.v));
            if (node.k === 'group') return treeValue(node.v);
            if (node.k === 'pow') {
                const v = treeValue(node.exp);
                if (v.d !== 1n || R.sign(v) < 0) throw new Error('指数不合法');
                return R.pow(treeValue(node.base), Number(v.n));
            }
            const a = treeValue(node.l);
            const b = treeValue(node.r);
            if (node.op === '+') return R.add(a, b);
            if (node.op === '-') return R.sub(a, b);
            if (node.op === '*') return R.mul(a, b);
            return R.div(a, b);
        }

        // 「已经是一个数」：7、0.75、3/4、-3/4、(-5)
        function isAtomic(node) {
            if (node.k === 'val' || node.k === 'num') return true;
            if (node.k === 'neg') return isAtomic(node.v);
            if (node.k === 'group') return isAtomic(node.v);
            if (node.k === 'op' && node.op === '/' && isNumLike(node.l) && isNumLike(node.r)) return true;
            return false;
        }
        // 「腰上一层括号/负号包裹的整数」：11、(-11)、(11)、--11（题面不会这么写）
        function isNumLike(node) {
            if (node.k === 'num') return true;
            if (node.k === 'neg') return isNumLike(node.v);
            if (node.k === 'group') return isNumLike(node.v);
            return false;
        }
        // 真正的分数：分子分母都是整数（允许外面裹一层括号/负号）
        function isFractionNode(node) {
            return node.k === 'op' && node.op === '/' && isNumLike(node.l) && isNumLike(node.r);
        }
        function isNegativeAtomic(node) {
            if (node.k === 'val') return R.sign(node.v) < 0;
            if (node.k === 'num') return node.v.charAt(0) === '-';
            if (node.k === 'neg') return true;
            return false;
        }

        // ==================================================================
        // 4. 出题：每档一组题型生成器
        //    生成器返回 { question, answer, kind }；validQuestion 兜底自检。
        // ==================================================================

        // ---------- ① 入门：a ± b ± c（绝对值都在百以内，至少一个负数） ----------
        function genAddSub() {
            // 四种「符号形态」都真实出现，而不是永远「负 + 正 + 正」
            const shapes = [
                () => [-randNonZero(11, 90), randNonZero(2, 80), randNonZero(2, 80), '++'],
                () => [-randNonZero(11, 90), randNonZero(2, 80), randNonZero(2, 80), '-+'],
                () => [-randNonZero(11, 90), randNonZero(2, 80), randNonZero(2, 80), '+-'],
                () => [-randNonZero(11, 90), randNonZero(2, 80), randNonZero(2, 80), '--'],
                () => [randNonZero(2, 90), -randNonZero(11, 80), randNonZero(2, 80), '++'],
                () => [randNonZero(2, 90), -randNonZero(11, 80), -randNonZero(2, 80), '--'],
                () => [randNonZero(2, 90), randNonZero(2, 80), -randNonZero(11, 80), '+-'],
                () => [-randNonZero(11, 90), -randNonZero(2, 80), -randNonZero(2, 80), '--']
            ];
            for (let t = 0; t < 40; t++) {
                const cfg = pick(shapes)();
                const a = cfg[0];
                const b = cfg[1];
                const c = cfg[2];
                const os = cfg[3];
                // 符号：os 决定「加减号」，b/c 自己带不带负号由形态决定
                const bSigned = b;
                const cSigned = c;
                const answer = a + (os.charAt(0) === '-' ? -bSigned : bSigned) + (os.charAt(1) === '-' ? -cSigned : cSigned);
                if (Math.abs(answer) > 99) continue;
                const negativeCount = (a < 0 ? 1 : 0) + (bSigned < 0 ? 1 : 0) + (cSigned < 0 ? 1 : 0);
                if (negativeCount === 0) continue;
                // 负数在运算符后要用括号；开头负数直接写 -17
                const bTxt = bSigned < 0 ? term(bSigned, 1) : String(bSigned);
                const cTxt = cSigned < 0 ? term(cSigned, 1) : String(cSigned);
                const question = `${a} ${os.charAt(0)} ${bTxt} ${os.charAt(1)} ${cTxt}`;
                // 把「运算符后面的括号负数」整体替换掉，再看有没有 12 - -5 这种连续符号
                const flat = question.replace(/\s+/g, '').replace(/\(-\d+\)/g, 'x');
                if (/[+\-*/]{2}/.test(flat)) continue;
                // 兜底：题面里不能出现「- x」这种怪写法
                return { question, answer: R.from(answer), kind: 'add-sub' };
            }
            return { question: '-7 + 42 - 35', answer: R.from(0), kind: 'add-sub' };
        }

        // ---------- ② 基础：分数加减（加数都已是最简分数） ----------
        const DEN_POOL = [2, 3, 4, 5, 6, 8, 9, 10, 12];

        // 分数 ± 分数 ± 整数：异分母通分 + 结果约分
        function genFractionInt() {
            const d1 = pick(DEN_POOL);
            const cands = DEN_POOL.filter((x) => x !== d1 && gcd(x, d1) > 1 && lcmOf(x, d1) <= 24);
            if (!cands.length) return null;
            const d2 = pick(cands);
            const n1 = randNonZero(1, d1 - 1) * signOf();
            const n2 = randNonZero(1, d2 - 1);
            if (!isReduced(n1, d1) || !isReduced(n2, d2)) return null;
            const k = randNonZero(1, 12) * signOf();
            const os = pick(['+-', '++', '--', '-+']);
            const mid = os.charAt(0) === '+' ? R.add(R.from(n1, d1), R.from(n2, d2)) : R.sub(R.from(n1, d1), R.from(n2, d2));
            const answer = os.charAt(1) === '+' ? R.add(mid, R.from(k)) : R.sub(mid, R.from(k));
            return {
                question: `${lead(n1, d1)} ${os.charAt(0)} ${term(n2, d2)} ${os.charAt(1)} ${term(k, 1)}`,
                answer,
                kind: 'fraction'
            };
        }

        // 分数 ± 分数（异分母）：纯通分题
        function genFractionPair() {
            const d1 = pick(DEN_POOL);
            const cands = DEN_POOL.filter((x) => x !== d1 && gcd(x, d1) > 1 && lcmOf(x, d1) <= 24);
            if (!cands.length) return null;
            const d2 = pick(cands);
            const n1 = randNonZero(1, d1 - 1) * signOf();
            const n2 = randNonZero(1, d2 - 1);
            if (!isReduced(n1, d1) || !isReduced(n2, d2)) return null;
            const op = coinf(0.5) ? '+' : '-';
            return {
                question: `${lead(n1, d1)} ${op} ${term(n2, d2)}`,
                answer: op === '+' ? R.add(R.from(n1, d1), R.from(n2, d2)) : R.sub(R.from(n1, d1), R.from(n2, d2)),
                kind: 'fraction'
            };
        }

        // 分数与整数混合：整数先写成 k = kd/d 再合并
        function genFractionWhole() {
            let n = 0;
            let d = 1;
            for (let t = 0; t < 20; t++) {
                d = pick([2, 3, 4, 5, 6, 8]);
                n = randNonZero(1, d - 1) * signOf();
                if (isReduced(n, d)) break;
            }
            const k = randNonZero(1, 6);
            const op = coinf(0.5) ? '+' : '-';
            const first = coinf(0.5);
            const question = first
                ? `${term(k, 1)} ${op} ${term(n, d)}`
                : `${lead(n, d)} ${op} ${term(k, 1)}`;
            const answer = first
                ? (op === '+' ? R.add(R.from(k), R.from(n, d)) : R.sub(R.from(k), R.from(n, d)))
                : (op === '+' ? R.add(R.from(n, d), R.from(k)) : R.sub(R.from(n, d), R.from(k)));
            return { question, answer, kind: 'fraction' };
        }

        // ---------- ③ 进阶：乘除 / 小数 ----------
        // 负数 × 负数 ± 整数：负负得正、先乘后加减
        function genMulInt() {
            const a = randNonZero(2, 12) * signOf();
            const b = randNonZero(2, 9) * signOf();
            const c = randNonZero(1, 40);
            const op = coinf(0.5) ? '+' : '-';
            const product = R.mul(R.from(a), R.from(b));
            return {
                question: `${lead(a, 1)} * ${term(b, 1)} ${op} ${c}`,
                answer: op === '+' ? R.add(product, R.from(c)) : R.sub(product, R.from(c)),
                kind: 'multiply'
            };
        }

        // a × b ÷ c：从左往右算（b ÷ c 写成 b / c 会被当成一个分数，所以这里用括号把乘法整体括起来）
        function genMulDivInt() {
            const b = randNonZero(2, 9);
            const c = pick([2, 3, 4, 5, 6]);
            const k = randNonZero(2, 12) * signOf();
            const a = k * c;
            const div = coinf(0.5);
            if (div) {
                return {
                    question: `(${lead(a, 1)} * ${b}) / ${c}`,
                    answer: R.div(R.mul(R.from(a), R.from(b)), R.from(c)),
                    kind: 'multiply'
                };
            }
            return {
                question: `${lead(a, 1)} * ${b} / ${c}`,
                answer: R.div(R.mul(R.from(a), R.from(b)), R.from(c)),
                kind: 'multiply'
            };
        }

        // 分数 × 分数：交叉约分（加数最简，两个分母必有公因数，好让学生练约分）
        function genFracMul() {
            const b = pick(DEN_POOL);
            const cands = DEN_POOL.filter((x) => x !== b && gcd(x, b) > 1);
            if (!cands.length) return null;
            const d = pick(cands);
            const n1 = randNonZero(1, b - 1) * signOf();
            const n2 = randNonZero(1, d - 1) * signOf();
            if (!isReduced(n1, b) || !isReduced(n2, d)) return null;
            // 乘积不要太零碎：分子分母都 <= 200
            const pv = R.mul(R.from(n1, b), R.from(n2, d));
            if (pv.n > 200n || pv.d > 200n) return null;
            return {
                question: `${lead(n1, b)} * ${term(n2, d)}`,
                answer: pv,
                kind: 'multiply'
            };
        }

        // 分数 ÷ 分数：乘倒数（商的分母控制在 12 以内，答案好写）
        function genFracDiv() {
            const b = pick([2, 3, 4, 5, 6, 8]);
            const d = pick([2, 3, 4, 5, 6].filter((x) => x !== b));
            const n1 = randNonZero(1, b - 1) * signOf();
            const n2 = randNonZero(1, d - 1);
            if (!isReduced(n1, b) || !isReduced(n2, d)) return null;
            const qv = R.div(R.from(n1, b), R.from(n2, d));
            if (qv.n > 200n || qv.d > 12n) return null;
            // 除号右边的分数必须带括号，否则 1/2 / 3/4 会被从左往右算成 ((1/2)/3)/4
            const right = n2 < 0 ? `(-${Math.abs(n2)}/${d})` : `(${n2}/${d})`;
            return {
                question: `${lead(n1, b)} / ${right}`,
                answer: qv,
                kind: 'multiply'
            };
        }

        // 小数 × 整数：按「先当整数乘、再点小数点」出题，结果两位小数内
        function genDecimalMul() {
            if (coinf(0.7)) {
                // 一位小数：h 是 10 倍后的整数，去掉整十（避免 5.0 这种尾零），乘积的分子 ≤ 400
                const y = randNonZero(2, 8);
                const maxH = Math.min(95, Math.floor(400 / y));
                if (maxH < 11) return null;
                let h = 0;
                for (let g = 0; g < 12; g++) {
                    h = randNonZero(11, maxH);
                    if (h % 10 !== 0) break;
                }
                if (h % 10 === 0) return null;
                return {
                    question: `${decText(h * signOf(), 1)} * ${term(y, 1)}`,
                    answer: R.mul(R.from(h * signOf(), 10), R.from(y)),
                    kind: 'multiply'
                };
            }
            const y2 = randNonZero(2, 4);
            const maxH2 = Math.min(275, Math.floor(4000 / y2));
            let h2 = 0;
            for (let g = 0; g < 12; g++) {
                h2 = randNonZero(105, maxH2);
                if (h2 % 10 !== 0) break;
            }
            if (h2 % 10 === 0) return null;
            return {
                question: `${decText(h2 * signOf(), 2)} * ${term(y2, 1)}`,
                answer: R.mul(R.from(h2 * signOf(), 100), R.from(y2)),
                kind: 'multiply'
            };
        }

        // 小数 × 整数 ± 整数：先乘后加减（乘积与结果都控制在 40 以内，分数答案分子不上 400）
        function genDecimalAdd() {
            const h = randNonZero(11, 79) * signOf();
            const y = randNonZero(2, 5);
            const m = randNonZero(1, 25);
            const op = coinf(0.5) ? '+' : '-';
            const product = R.mul(R.from(h, 10), R.from(y));
            const value = op === '+' ? R.add(product, R.from(m)) : R.sub(product, R.from(m));
            const hAbs = h < 0 ? -h : h;
            if (hAbs * y > 350) return null;
            if (R.abs(value).n > 400n) return null;
            return {
                question: `${decText(h, 1)} * ${y} ${op} ${m}`,
                answer: value,
                kind: 'multiply'
            };
        }

        // 小数 ÷ 小数：商是整数（1.5 / 0.5 = 3）
        function genDecimalDiv() {
            const q = randNonZero(2, 30) * signOf();
            const item = pick([[5, 1], [25, 2], [4, 1], [2, 1]]);
            const dInt = item[0];
            const places = item[1];
            if (Math.abs(q * dInt) >= 1000) return null;
            return {
                question: `${decText(q * dInt, 2)} / ${decText(dInt, places)}`,
                answer: R.from(q),
                kind: 'multiply'
            };
        }

        // ---------- ④ 挑战：混合运算与简算 ----------
        // a + b × c：先乘后加（负号穿插）
        function genParenMul() {
            const a = randNonZero(2, 20) * signOf();
            const b = randNonZero(2, 9) * signOf();
            const c = randNonZero(2, 9);
            return {
                question: `${lead(a, 1)} + ${lead(b, 1)} * ${c}`,
                answer: R.add(R.from(a), R.mul(R.from(b), R.from(c))),
                kind: 'mixed'
            };
        }

        // (a ± b) × c：先算括号
        function genGroupMul() {
            const a = randNonZero(2, 9) * signOf();
            const b = randNonZero(2, 9) * signOf();
            const c = randNonZero(2, 9) * signOf();
            const op = coinf(0.5) ? '+' : '-';
            const inner = op === '+' ? a + b : a - b;
            return {
                question: `(${a} ${op} ${b}) * ${term(c, 1)}`,
                answer: R.mul(R.from(inner), R.from(c)),
                kind: 'mixed'
            };
        }

        // a ÷ (b − c)：先算括号，再除
        function genGroupDiv() {
            const b = randNonZero(3, 9);
            const c = randNonZero(1, b - 2);
            const q = randNonZero(2, 9) * signOf();
            const inner = b - c;
            return {
                question: `${lead(q * inner, 1)} / (${b} - ${c})`,
                answer: R.from(q),
                kind: 'mixed'
            };
        }

        // 分数连乘 / 分数除再乘：先约分再算
        function genFracChain() {
            if (coinf(0.6)) {
                const b = pick([2, 3, 4, 6, 8]);
                const cands = [2, 3, 4, 5, 6].filter((x) => x !== b && gcd(x, b) > 1);
                if (!cands.length) return null;
                const d = pick(cands);
                const e = pick([2, 3, 4, 5]);
                const n1 = randNonZero(1, b - 1) * signOf();
                const n2 = randNonZero(1, d - 1) * signOf();
                const n3 = randNonZero(1, e - 1);
                if (!isReduced(n1, b) || !isReduced(n2, d) || !isReduced(n3, e)) return null;
                return {
                    question: `${lead(n1, b)} * ${term(n2, d)} * ${fracText(n3, e)}`,
                    answer: R.mul(R.mul(R.from(n1, b), R.from(n2, d)), R.from(n3, e)),
                    kind: 'mixed'
                };
            }
            const b = pick([2, 3, 4, 5, 6]);
            const d = pick([2, 3, 4, 5].filter((x) => x !== b));
            const n1 = randNonZero(1, b - 1) * signOf();
            const n2 = randNonZero(1, d - 1);
            const k = randNonZero(2, 8) * signOf();
            if (!isReduced(n1, b) || !isReduced(n2, d)) return null;
            return {
                question: `${lead(n1, b)} / ${term(n2, d)} * ${term(k, 1)}`,
                answer: R.mul(R.div(R.from(n1, b), R.from(n2, d)), R.from(k)),
                kind: 'mixed'
            };
        }

        // (分数 ± 分数) × 整数：括号 + 通分 + 乘法；做减法时保证括号里不为 0
        function genFractionGroup() {
            const d1 = pick([2, 3, 4, 6]);
            const d2 = pick([2, 3, 4, 6].filter((x) => x !== d1 && gcd(x, d1) > 1));
            let n1 = 0;
            let n2 = 0;
            for (let t = 0; t < 20; t++) {
                n1 = randNonZero(1, d1 - 1);
                n2 = randNonZero(1, d2 - 1);
                if (isReduced(n1, d1) && isReduced(n2, d2)) break;
            }
            if (n1 / d1 === n2 / d2) return null;
            const op = coinf(0.5) ? '+' : '-';
            const inner = op === '+' ? R.add(R.from(n1, d1), R.from(n2, d2)) : R.sub(R.from(n1, d1), R.from(n2, d2));
            const k = randNonZero(2, 6) * signOf();
            return {
                question: `(${fracText(n1, d1)} ${op} ${fracText(n2, d2)}) * ${term(k, 1)}`,
                answer: R.mul(inner, R.from(k)),
                kind: 'mixed'
            };
        }

        // 平方 / 立方：底数一律带括号，负数的奇偶次方对比
        function genPower() {
            const p = coinf(0.6) ? 2 : 3;
            if (coinf(0.35)) {
                const d = pick([2, 3, 4, 5]);
                const n = randNonZero(1, d - 1) * signOf();
                if (!isReduced(n, d)) return null;
                return { question: `(${fracText(n, d)})^${p}`, answer: R.pow(R.from(n, d), p), kind: 'mixed' };
            }
            const base = (p === 3 ? randNonZero(2, 4) : randNonZero(3, 15)) * signOf();
            const value = R.pow(R.from(base), p);
            // 大多数带一个加减项，最后才是纯乘方（纯乘方一步就算完，教学信息少）
            if (!coinf(0.35)) return { question: `(${base})^${p}`, answer: value, kind: 'mixed' };
            const k = randNonZero(2, 30) * signOf();
            const op = coinf(0.5) ? '+' : '-';
            return {
                question: `(${base})^${p} ${op} ${term(k, 1)}`,
                answer: op === '+' ? R.add(value, R.from(k)) : R.sub(value, R.from(k)),
                kind: 'mixed'
            };
        }

        // 分配律：a × b + a × c，b + c 凑成整百
        function genDistribute() {
            const a = pick([12, 15, 18, 25, 35, 45, 101, 125]);
            const base = pick([100, 200]);
            const b = randNonZero(1, 9) * (base / 10);
            const c = base - b;
            if (c <= 0) return null;
            return { question: `${a} * ${b} + ${a} * ${c}`, answer: R.from(a * base), kind: 'mixed' };
        }

        // 分配律（减法方向）：a × b − a × c
        function genDistributeSub() {
            const a = pick([12, 15, 18, 25, 35, 45, 101, 125]);
            const base = pick([100, 200]);
            const c = randNonZero(1, 9) * (base / 10);
            const b = base + c;
            return { question: `${a} * ${b} - ${a} * ${c}`, answer: R.from(a * base), kind: 'mixed' };
        }

        // 凑整：a × 99 + a 看成 a × 100
        function genRound() {
            const a = randNonZero(2, 25);
            const near = pick([9, 19, 29, 99]);
            return { question: `${a} * ${near} + ${a}`, answer: R.from(a * near), kind: 'mixed' };
        }

        // 平方差：(a + b) × (a − b) = a² − b²
        function genSquareDiff() {
            const a = pick([11, 12, 13, 15, 21, 25, 31, 41, 51, 101, 103]);
            const b = randNonZero(1, 9);
            if (a - b <= 0) return null;
            if (coinf(0.5)) {
                return {
                    question: `(${a} + ${b}) * (${a} - ${b})`,
                    answer: R.from((a + b) * (a - b)),
                    kind: 'mixed'
                };
            }
            return { question: `(${a})^2 - (${b})^2`, answer: R.from(a * a - b * b), kind: 'mixed' };
        }

        // 每档的题型权重（数字越大越常出），也是四档梯度所在
        const GENERATORS = {
            1: [[genAddSub, 1]],
            2: [[genFractionInt, 4], [genFractionPair, 3], [genFractionWhole, 2]],
            3: [
                [genMulInt, 3], [genMulDivInt, 2], [genFracMul, 3], [genFracDiv, 2],
                [genDecimalMul, 4], [genDecimalAdd, 2], [genDecimalDiv, 2]
            ],
            4: [
                [genParenMul, 2], [genGroupMul, 2], [genGroupDiv, 2], [genFracChain, 3],
                [genFractionGroup, 2], [genPower, 3], [genDistribute, 2],
                [genDistributeSub, 1], [genRound, 1], [genSquareDiff, 2]
            ]
        };

        function weightedPick(table) {
            const total = table.reduce((s, item) => s + item[1], 0);
            let r = Math.random() * total;
            for (let i = 0; i < table.length; i++) {
                r -= table[i][1];
                if (r <= 0) return table[i];
            }
            return table[table.length - 1];
        }

        // 题面里的数别太难看：分母 <= 12、绝对值 <= 2000
        function uglyToken(text) {
            const tokens = tokensOf(text);
            for (let i = 0; i < tokens.length; i++) {
                const t = stripParens(tokens[i]);
                const m = /^(-?)(\d+)\/(\d+)$/.exec(t);
                if (m) {
                    if (Number(m[3]) > 12 || Number(m[2]) > 2000) return true;
                    continue;
                }
                if (/^-?\d+$/.test(t) && Math.abs(Number(t)) > 2000) return true;
            }
            return false;
        }

        // 出题自检：题面写法 + 四档梯度 + 答案规模 + 解析值 + 「加数已最简」
        function validQuestion(level, question, answer) {
            if (typeof question !== 'string' || !question) return false;
            if (!/^[0-9+\-*/().^ ]+$/.test(question)) return false;
            const nq = norm(question);
            if (nq.length > 80) return false;
            // 题面不允许连续符号；开头的负号（-17、(-2)^3）允许
            const body = nq.charAt(0) === '-' ? nq.slice(1) : nq;
            if (/[+\-*/^]{2}/.test(body)) return false;
            if (uglyToken(question)) return false;
            const absAnswer = R.abs(answer);
            if (absAnswer.n > 2000n || absAnswer.d > 400n) return false;
            if (!niceDen(answer)) return false;
            let value;
            try { value = evalExpr(question); } catch (err) { return false; }
            if (!R.eq(value, answer)) return false;
            // 加数里的分数必须已是最简（约分只作为答案化简出现）
            const tokens = tokensOf(question);
            for (let i = 0; i < tokens.length; i++) {
                const m = /^(-?\d+)\/(\d+)$/.exec(stripParens(tokens[i]));
                if (m && !isReduced(Number(m[1]), Number(m[2]))) return false;
            }
            if (level === 1) {
                // ① 档只有加减；括号只用来包负数（12 - (-5)），不能出现乘除和乘方
                const noBracket = nq.split(/\(\s*-\d+\s*\)/).join('');
                if (/[*/^()]/.test(noBracket)) return false;
                if ((nq.match(/[+\-]/g) || []).length < 2) return false;
                if (R.abs(answer).n > 99n) return false;
                for (let i = 0; i < tokens.length; i++) {
                    const t = stripParens(tokens[i]);
                    if (Math.abs(Number(t)) > 99) return false;
                }
            }
            if (level === 2) {
                // ② 档只用加减：先把「分数 token」整体抠掉，再看还有没有 * / ^ 和括号
                const rest = tokens.map((tok) => stripParens(tok))
                    .filter((tok) => !/^-?\d+\/\d+$/.test(tok)).join('');
                if (/[*/^()]/.test(rest)) return false;
                if (!hasFractionToken(question)) return false;
                if (Math.abs(fracValue(answer)) > 100) return false;
            }
            if (level === 3) {
                if (!/[*/]/.test(nq)) return false;
            }
            if (level === 4) {
                // 挑战档必须有「结构」：括号、乘方，或者分数连乘除
                const structural = /\(|\^/.test(nq)
                    || (hasFractionToken(question) && (nq.match(/[*/]/g) || []).length >= 2);
                if (!structural) return false;
            }
            return true;
        }

        function buildQuestion(level) {
            const lv = Number(level);
            if (!GENERATORS[lv]) throw new Error('口算档位只能是 1~4');
            const table = GENERATORS[lv];
            for (let attempt = 0; attempt < 200; attempt++) {
                const item = weightedPick(table);
                let raw = null;
                try { raw = item[0](); } catch (err) { raw = null; }
                if (!raw || !raw.question || !raw.answer) continue;
                const question = raw.question.replace(/\s+/g, ' ').trim();
                if (!validQuestion(lv, question, raw.answer)) continue;
                const answer = R.toPlain(raw.answer);
                return {
                    level: lv,
                    question,
                    // answer / answerDisplay 的值完全相同，只是写法不同：
                    // 判题、上报、测试一律用 answer；页面给人看的时候用 answerDisplay
                    answer,
                    answerDisplay: decimalAnswerText(question) || answer,
                    tags: tagsOf(question),
                    kind: raw.kind,
                    ops: opsOf(question)
                };
            }
            // 生成器表坏了才会走到这里：直接报错，开发时能第一时间发现
            throw new Error('口算出题失败：第 ' + lv + ' 档连续 200 次没摇出合法题');
        }

        function generateQuestion(level) {
            return buildQuestion(level);
        }

        // ==================================================================
        // 5. 判题
        // ==================================================================
        const ANSWER_FORM = '答案只写一个数：分数写 3/4，小数写 0.75，负数写 -5';

        // 学生输入的结构检查（放在求值之前，好给出更具体的中文提示）
        function sanitizeInput(input) {
            const s = toHalfWidth(input);
            if (!s) return { ok: false, msg: '还没输入答案呢，先写一个数吧' };
            if (/[a-zA-Z\u4e00-\u9fa5]/.test(s)) {
                return { ok: false, msg: '答案里不能有字母或汉字——' + ANSWER_FORM };
            }
            if (s.indexOf('=') >= 0) return { ok: false, msg: '不用写等号，直接写结果就行——' + ANSWER_FORM };
            if (/[^0-9+\-*/().]/.test(s)) return { ok: false, msg: '出现了不认识的符号——' + ANSWER_FORM };
            const body = s.charAt(0) === '-' ? s.slice(1) : s;
            if (/[+\-*/]{2,}/.test(body)) {
                return { ok: false, msg: '出现了连续符号（比如 -- 或 +-），先合并成一种符号再写' };
            }
            return { ok: true, text: s };
        }

        // 学生写的是不是「一个数」本身（而不是算出来的过程）
        function isPlainNumber(text) {
            return /^-?\d+(\.\d+)?$/.test(text) || /^(\(-)?\d+\/\d+\)?$/.test(text);
        }

        // 返回 { status:'correct'|'wrong'|'error', msg }；任何情况都不抛异常
        function evaluateAnswer(studentInput, correctAnswer) {
            let correct;
            try {
                correct = evalExpr(correctAnswer);
            } catch (err) {
                return { status: 'error', msg: '这道题的标准答案格式有问题，请刷新题目' };
            }
            const checked = sanitizeInput(studentInput);
            if (!checked.ok) return { status: 'error', msg: checked.msg };
            let student;
            try {
                student = evalExpr(checked.text);
            } catch (err) {
                return { status: 'error', msg: '看不懂这个写法——' + ANSWER_FORM };
            }
            if (!R.eq(student, correct)) {
                return { status: 'wrong', msg: '再算一次，看看是不是符号或通分出了问题' };
            }
            if (!isPlainNumber(checked.text)) {
                return { status: 'correct', msg: '对，口算题建议直接写结果' };
            }
            return { status: 'correct', msg: '答对了！' };
        }

        // ==================================================================
        // 6. 答案解析 buildSteps：把题面一步一步折叠成数
        //    折叠顺序：乘方 -> 乘除（同级从左往右）-> 加减（同级从左往右）。
        //    每步只把「一个子式」换成它的值，其余原样保留，所以每步都是等价变形；
        //    末步就等于整个算式的值（必然等于标准答案）。
        //    渲染按运算优先级加括号：乘除的操作数是复合式就加括号、加减的右操作数是
        //    复合式就加括号，保证 dfrac{}{} 不会把整段算式吞成分子或分母。
        // ==================================================================

        // 一个数的 tex：整数原样、分数 dfrac{}{}、小数原样
        function plainToTex(plain) {
            const m = /^(-?)(\d+)\/(\d+)$/.exec(String(plain));
            if (m) return `${m[1]}\\dfrac{${m[2]}}{${m[3]}}`;
            return String(plain);
        }
        function valNode(v) { return { k: 'val', v, text: R.toPlain(v), tex: plainToTex(R.toPlain(v)) }; }

        // 分数分子/分母的整数绝对值：写成 -3/5 而不是 \dfrac{-3}{5} 用
        function intAbsOf(node) {
            const v = treeValue(node);
            if (!v || typeof v.d !== 'bigint' || v.d !== 1n) return null;
            const n = BigInt(v.s) * BigInt(v.n);
            return String(n < 0n ? -n : n);
        }
        // 一个数的 tex（原子）：4、0.75、\\dfrac{3}{4}、-\\dfrac{3}{4}（负号写在分式外面）
        function numTex(node) {
            if (node.k === 'val') return node.tex;
            if (node.k === 'num') return node.v;
            if (node.k === 'neg') return `-${numTex(node.v)}`;
            if (isFractionNode(node)) {
                // 负号提到分式外面：-3/5 写成 -\dfrac{3}{5}，不写 \dfrac{-3}{5}
                const neg = R.sign(treeValue(node)) < 0;
                const a = intAbsOf(node.l);
                const b = intAbsOf(node.r);
                if (a === null || b === null) {
                    return `\\dfrac{${numTex(node.l)}}{${numTex(node.r)}}`;
                }
                const body = `\\dfrac{${a}}{${b}}`;
                return neg ? `-${body}` : body;
            }
            if (node.k === 'group') return numTex(node.v);
            return plainToTex(R.toPlain(treeValue(node)));
        }
        // 一个数的纯文本：4、0.75、3/4、-3/4
        function numText(node) {
            if (node.k === 'val') return node.text;
            if (node.k === 'num') return node.v;
            if (node.k === 'neg') return `-${numText(node.v)}`;
            if (isFractionNode(node)) return `${numText(node.l)}/${numText(node.r)}`;
            if (node.k === 'group') return numText(node.v);
            return R.toPlain(treeValue(node));
        }

        // 子式的 tex：按运算符优先级决定要不要包 \\left( \\right)
        function nodeTexH(node) {
            if (node.k === 'val') return node.tex;
            if (node.k === 'num') return node.v;
            if (node.k === 'neg') return `-${nodeTexH(node.v)}`;
            if (node.k === 'group') return `\\left(${nodeTexH(node.v)}\\right)`;
            if (isFractionNode(node)) return `\\dfrac{${nodeTexH(node.l)}}{${nodeTexH(node.r)}}`;
            if (node.k === 'pow') {
                const base = node.base.k === 'group' ? nodeTexH(node.base) : `\\left(${nodeTexH(node.base)}\\right)`;
                return `${base}^{${nodeTexH(node.exp)}}`;
            }
            if (node.op === '/') {
                return `\\dfrac{${operandTexH(node.l, 'l', '/')}}{${operandTexH(node.r, 'r', '/')}}`;
            }
            const sign = node.op === '*' ? '\\times' : node.op;
            return `${operandTexH(node.l, 'l', node.op)} ${sign} ${operandTexH(node.r, 'r', node.op)}`;
        }

        // 某个子式作为操作数出现时的 tex
        // side：'l' 左操作数 / 'r' 右操作数；op：外层的运算符
        function operandTexH(node, side, op) {
            // 题面里被括号包着的一个数：括号是题面的一部分，保留
            if (node.k === 'group' && isAtomic(node.v)) {
                return `\\left(${numTex(node.v)}\\right)`;
            }
            // 左边是负数且外层是加减：-80 + 41、-2/3 + 2/9 都直接写，负数本身已经看得清
            if (isAtomic(node)) {
                // 左边是负原子而外层是乘除：包一层括号，(-3) \\times 9；但分数自带分数线，不用包
                if (side === 'l' && isNegativeAtomic(node) && (op === '*' || op === '/') && !isFractionNode(node)) {
                    if (node.k !== 'group') return `\\left(${numTex(node)}\\right)`;
                }
                return numTex(node);
            }
            // 负的复合式（-3/5 之类被 neg 包着的）当乘除左操作数：也不加括号
            if (side === 'l' && (op === '*' || op === '/') && node.k === 'neg') {
                return numTex(node);
            }
            // 复合式子：乘除的操作数全部加括号；加减只给右操作数加括号（左结合）。
            // 分数和乘方自己就看得清（-4/9、2^{3} 不会被误读），不必再套一层括号。
            if (op === '*' || op === '/') {
                if (node.k === 'group' || node.k === 'pow' || isFractionNode(node)) return nodeTexH(node);
                // 乘除同级左结合：左操作数即使是个乘除式也不用括号（44 * 4 / 4 就是 (44*4)/4）
                if (side === 'l' && (node.op === '*' || node.op === '/')) return nodeTexH(node);
                // 乘法右边是「加减式」才要括号；右边本身是乘除就不用
                if (node.op === '*' || node.op === '/') return nodeTexH(node);
                return `\\left(${nodeTexH(node)}\\right)`;
            }
            // 外层是加减：右操作数是个加减式才要括号；乘方式本来优先级更高，不加
            if (side === 'r' && (node.k === 'op') && (node.op === '+' || node.op === '-')) {
                return `\\left(${nodeTexH(node)}\\right)`;
            }
            return nodeTexH(node);
        }

        // 渲染整式（最外层不套括号）
        function renderTexH(root) {
            if (root.k === 'group' && !isAtomic(root.v)) return nodeTexH(root.v);
            return nodeTexH(root);
        }
        // 求值后的展示形态：比 1 大的假分数写成「带分数」式 4 + 1/7，
        // 学生一眼能看出答的是几位数；整数还是整数
        function prettyTex(v) {
            const plain = R.toPlain(v);
            const m = /^(-?)(\d+)\/(\d+)$/.exec(plain);
            if (!m) return plain;
            const neg = m[1] === '-';
            const n = Number(m[2]);
            const d = Number(m[3]);
            const whole = Math.floor(n / d);
            const rest = n - whole * d;
            if (whole === 0) return plainToTex(plain);
            const head = (neg ? '-' : '') + String(whole);
            if (rest === 0) return head;
            return `${head} + ${plainToTex(`${rest}/${d}`)}`;
        }

        // 找出「最该先算」的子式；test 决定要哪一类
        // 后序遍历找「最里层」满足条件的节点：这样 a - b + c 会先算 a - b，不会一步算完整条链
        function findNode(node, test) {
            if (node.k === 'val') return null;
            if (node.k === 'neg' || node.k === 'group') {
                const inner = findNode(node.v, test);
                if (inner) return inner;
            } else if (node.k === 'pow') {
                const inner = findNode(node.base, test) || findNode(node.exp, test);
                if (inner) return inner;
            } else if (node.k === 'op') {
                const inner = findNode(node.l, test) || findNode(node.r, test);
                if (inner) return inner;
            }
            return test(node) ? node : null;
        }

        function replaceNode(node, target, replacement) {
            if (node === target) return replacement;
            if (node.k === 'neg' || node.k === 'group') {
                return { k: node.k, v: replaceNode(node.v, target, replacement) };
            }
            if (node.k === 'pow') {
                return {
                    k: 'pow',
                    base: replaceNode(node.base, target, replacement),
                    exp: replaceNode(node.exp, target, replacement)
                };
            }
            if (node.k === 'op') {
                return {
                    k: 'op',
                    op: node.op,
                    l: replaceNode(node.l, target, replacement),
                    r: replaceNode(node.r, target, replacement)
                };
            }
            return node;
        }

        function opName(op) {
            return op === '+' ? '加法' : op === '-' ? '减法' : op === '*' ? '乘法' : '除法';
        }

// 某一步的「为什么这么算」：title 进步骤标题，detail/detailTex 只用于讲解放大
        function explainTargetH(target) {
            if (target.k === 'pow') {
                const exp = Number(treeValue(target.exp).n);
                const base = treeValue(target.base);
                const val = R.pow(base, exp);
                const factors = [];
                for (let i = 0; i < exp; i++) factors.push(nodeTexH(target.base));
                const baseTex = target.base.k === 'group' ? nodeTexH(target.base) : `\\left(${nodeTexH(target.base)}\\right)`;
                if (R.sign(base) < 0) {
                    const odd = exp % 2 === 1;
                    return {
                        title: '先算乘方',
                        detail: `(${numText(target.base)}) 的 ${exp} 次方 = ${R.toPlain(val)}（负数${odd ? '奇' : '偶'}次方是${odd ? '负' : '正'}的）`,
                        detailTex: `${baseTex}^{${exp}} = ${factors.join(' \\times ')} = ${plainToTex(R.toPlain(val))}`
                    };
                }
                return {
                    title: '先算乘方',
                    detail: `${numText(target.base)} 的 ${exp} 次方 = ${R.toPlain(val)}`,
                    detailTex: `${baseTex}^{${exp}} = ${factors.join(' \\times ')} = ${plainToTex(R.toPlain(val))}`
                };
            }
            if (target.k === 'group') {
                const v = treeValue(target.v);
                const prev = R.toPlain(v);
                return {
                    title: '先算括号里的',
                    detail: `括号里算出来是 ${prev}`,
                    // 括号里是分数时给一份 tex：纯文本行的 19/12 在手机上只能显示成斜杠写法，
                    // 和上面的公式不是一套排法（详情行会优先用 detailTex）。
                    // 注意 target.v 指向的是括号内部的节点，分数里裹括号时这里拿不到，所以看 prev 的写法
                    detailTex: prev.indexOf('/') >= 0 ? `= ${plainToTex(prev)}` : ''
                };
            }
            if (target.k === 'op' && (target.op === '*' || target.op === '/')) {
                const l = treeValue(target.l);
                const r = treeValue(target.r);
                const val = target.op === '*' ? R.mul(l, r) : R.div(l, r);
                if (isFractionNode(target)) {
                    // 单个分数本身：只是把它化成最简分数/整数
                    return {
                        title: '约分',
                        detail: `${R.toPlain(l)} / ${R.toPlain(r)} = ${R.toPlain(val)}`,
                        detailTex: `\\dfrac{${numTex(target.l)}}{${numTex(target.r)}} = ${plainToTex(R.toPlain(val))}`
                    };
                }
                if (target.op === '*' && R.sign(l) < 0 && R.sign(r) < 0) {
                    return {
                        title: '负负得正',
                        detail: `(${R.toPlain(l)}) * (${R.toPlain(r)}) = ${R.toPlain(val)}`,
                        detailTex: `${numTex(target.l)} \\times \\left(${numTex(target.r)}\\right) = ${plainToTex(R.toPlain(val))}`
                    };
                }
                if (target.op === '/' && (R.sign(l) >= 0) === (R.sign(r) >= 0) && (R.sign(l) < 0 || R.sign(r) < 0)) {
                    return {
                        title: '同号得正',
                        detail: `(${R.toPlain(l)}) / (${R.toPlain(r)}) = ${R.toPlain(val)}`,
                        detailTex: `\\dfrac{${numTex(target.l)}}{${numTex(target.r)}} = ${plainToTex(R.toPlain(val))}`
                    };
                }
                // 小数乘法：先按整数乘，再点小数点
                if (target.op === '*' && (hasDecimalToken(numText(target.l)) || hasDecimalToken(numText(target.r)))) {
                    return { title: '先算小数乘法', detail: '', detailTex: '' };
                }
                return { title: '再算' + opName(target.op), detail: '', detailTex: '' };
            }
            if (target.k === 'op' && (target.op === '+' || target.op === '-')) {
                const l = treeValue(target.l);
                const r = treeValue(target.r);
                if (target.op === '-' && R.sign(r) < 0) {
                    const negR = R.toPlain(R.neg(r));
                    return {
                        title: '减去负数等于加上正数',
                        detail: `${R.toPlain(l)} - (${R.toPlain(r)}) = ${R.toPlain(l)} + ${negR} = ${R.toPlain(R.add(l, r))}`,
                        detailTex: `${numTex(target.l)} - \\left(${numTex(target.r)}\\right) = ${numTex(target.l)} + ${negR} = ${plainToTex(R.toPlain(R.add(l, r)))}`
                    };
                }
                if (isFractionNode(target.l) || isFractionNode(target.r)) {
                    const ln = numOf(l);
                    const ld = denOf(l);
                    const rn = numOf(r);
                    const rd = denOf(r);
                    const L = lcmOf(ld, rd);
                    // 分母不同才有通分；把两个分数都化成以 L 为分母
                    if (ld !== rd) {
                        const a = ln * (L / ld);
                        const b = rn * (L / rd);
                        const raw = target.op === '+' ? a + b : a - b;
                        return {
                            title: '通分',
                            detail: `${R.toPlain(l)} ${target.op} ${R.toPlain(r)} = ${a}/${L} ${target.op} ${Math.abs(b)}/${L} = ${raw}/${L}`,
                            detailTex: `${numTex(target.l)} ${target.op} ${numTex(target.r)} = \\dfrac{${a}}{${L}} ${target.op} \\dfrac{${Math.abs(b)}}{${L}} = ${plainToTex(`${raw}/${L}`)}`
                        };
                    }
                    // 同分母相加后能约分的，单独给一步「约分」
                    const raw2 = ln + (target.op === '+' ? rn : -rn);
                    if (raw2 !== 0 && gcd(Math.abs(raw2), ld) > 1) {
                        return {
                            title: '约分',
                            detail: `${raw2}/${ld} 约分得 ${R.toPlain(R.div(R.from(raw2), R.from(ld)))}`,
                            detailTex: `\\dfrac{${raw2}}{${ld}} = ${plainToTex(R.toPlain(R.div(R.from(raw2), R.from(ld))))}`
                        };
                    }
                }
            }
            return { title: '再算' + opName(target.op || '+'), detail: '', detailTex: '' };
        }

        // ==================================================================
        // 7. 简算题（④ 档）的讲解：用分配律 / 凑整 / 平方差
        //    只识别「一眼能看出凑整」的常见形态，识别不了就返回空数组，
        //    由普通折叠步骤来讲（不会伪造步骤）。
        // ==================================================================
        function specialStepsH(question) {
            const q = norm(question);
            const steps = [];
            let m;

            // a * b + a * c = a * (b + c)（两边同因数）
            m = /^(\d+)\*(\d+)\+(\d+)\*(\d+)$/.exec(q);
            if (m && m[1] === m[3]) {
                const a = Number(m[1]);
                const b = Number(m[2]);
                const c = Number(m[4]);
                const sum = b + c;
                steps.push({
                    title: '用分配律',
                    expr: `${a} * (${b} + ${c})`,
                    tex: `${a} \\times \\left(${b} + ${c}\\right)`,
                    detail: `${a} * ${b} + ${a} * ${c} = ${a} * (${b} + ${c}) = ${a} * ${sum}，两个乘法都有因数 ${a}，先加起来再乘。`,
                    // 「为什么」那行也用公式排：纯文本里的 `*` 与 `^2` 与上面的公式不是一套写法
                    detailTex: `${a} \\times ${b} + ${a} \\times ${c} = ${a} \\times \\left(${b} + ${c}\\right) = ${a} \\times ${sum}`
                });
                return steps;
            }
            // a * b - a * c = a * (b - c)
            m = /^(\d+)\*(\d+)-(\d+)\*(\d+)$/.exec(q);
            if (m && m[1] === m[3]) {
                const a = Number(m[1]);
                const b = Number(m[2]);
                const c = Number(m[4]);
                const diff = b - c;
                steps.push({
                    title: '用分配律',
                    expr: `${a} * (${b} - ${c})`,
                    tex: `${a} \\times \\left(${b} - ${c}\\right)`,
                    detail: `${a} * ${b} - ${a} * ${c} = ${a} * (${b} - ${c}) = ${a} * ${diff}，两个乘法都有因数 ${a}，先减再乘。`,
                    detailTex: `${a} \\times ${b} - ${a} \\times ${c} = ${a} \\times \\left(${b} - ${c}\\right) = ${a} \\times ${diff}`
                });
                return steps;
            }
            // (a + b) * c + (a + b) * d：括号是同一个整体，也能用分配律
            m = /^\((\d+)\+(\d+)\)\*(\d+)\+\((\d+)\+(\d+)\)\*(\d+)$/.exec(q);
            if (m && m[1] === m[4] && m[2] === m[5]) {
                const a = Number(m[1]);
                const b = Number(m[2]);
                steps.push({
                    title: '用分配律',
                    expr: `(${a} + ${b}) * (${m[3]} + ${m[6]})`,
                    tex: `\\left(${a} + ${b}\\right) \\times \\left(${m[3]} + ${m[6]}\\right)`,
                    detail: `两个括号里都是 ${a} + ${b}，把它当整体提出来，先算括号。`,
                    detailTex: null
                });
                return steps;
            }
            // a * (b + c) 型：括号里能凑整（b + c 是 10 的倍数）
            m = /^(\d+)\*\((\d+)\+(\d+)\)$/.exec(q);
            if (m && (Number(m[2]) + Number(m[3])) % 10 === 0) {
                const sum = Number(m[2]) + Number(m[3]);
                steps.push({
                    title: '凑整',
                    expr: `${m[1]} * ${sum}`,
                    tex: `${m[1]} \\times ${sum}`,
                    detail: `${m[2]} + ${m[3]} = ${sum} 正好是整十数，先算括号再乘，比硬乘快。`,
                    detailTex: `${m[2]} + ${m[3]} = ${sum}`
                });
                return steps;
            }
            // a × n + a、a × n - a：n 离整十数只差 1，凑整成 a × (n ± 1)
            m = /^(\d+)\*(\d+)([+\-])(\d+)$/.exec(q);
            if (m && m[2] === m[4] && (m[3] === '+' || Number(m[2]) > Number(m[4]))) {
                const a = Number(m[2]);
                const b = Number(m[1]);
                const sgn = m[3] === '+' ? 1 : -1;
                const target = b + sgn;
                if (target % 10 === 0 && target > 0) {
                    steps.push({
                        title: '凑整',
                        expr: `${a} * ${target}`,
                        tex: `${a} \\times ${target}`,
                        detail: `${a} * ${b} ${m[3]} ${a} = ${a} * ${b} ${m[3]} ${a} * 1 = ${a} * (${b} ${m[3]} 1) = ${a} * ${target}，把单独的 ${a} 看成 ${a} * 1，凑成整十数再乘。`,
                        detailTex: `${a} \\times ${b} ${m[3]} ${a} = ${a} \\times ${b} ${m[3]} ${a} \\times 1 = ${a} \\times \\left(${b} ${m[3]} 1\\right) = ${a} \\times ${target}`
                    });
                    return steps;
                }
            }
            // (a + b) * c 且 a + b 是整十数：括号里正好凑整
            m = /^\((\d+)\+(\d+)\)\*(\d+)$/.exec(q);
            if (m && (Number(m[1]) + Number(m[2])) % 10 === 0 && Number(m[1]) + Number(m[2]) > 0) {
                const sum = Number(m[1]) + Number(m[2]);
                steps.push({
                    title: '凑整',
                    expr: `${sum} * ${m[3]}`,
                    tex: `${sum} \\times ${m[3]}`,
                    detail: `${m[1]} + ${m[2]} = ${sum} 正好是整十数，先算括号再乘，比硬乘快。`,
                    detailTex: `${m[1]} + ${m[2]} = ${sum}`
                });
                return steps;
            }
            // (a + b) * (a - b) = a^2 - b^2
            m = /^\((\d+)\+(\d+)\)\*\((\d+)-(\d+)\)$/.exec(q);
            if (m && m[1] === m[3] && m[2] === m[4]) {
                const A = Number(m[1]);
                const B = Number(m[2]);
                steps.push({
                    title: '凑整（平方差）',
                    expr: `${A * A} - ${B * B}`,
                    tex: `${A}^{2} - ${B}^{2}`,
                    detail: `(${A} + ${B}) * (${A} - ${B}) = ${A}^2 - ${B}^2 = ${A * A} - ${B * B}，平方差公式。`,
                    detailTex: `\\left(${A} + ${B}\\right) \\times \\left(${A} - ${B}\\right) = ${A}^{2} - ${B}^{2} = ${A * A} - ${B * B}`
                });
                return steps;
            }
            // (a)^2 - (b)^2 = (a + b) * (a - b)
            m = /^\((\d+)\)\^2-\((\d+)\)\^2$/.exec(q);
            if (m) {
                const A = Number(m[1]);
                const B = Number(m[2]);
                steps.push({
                    title: '凑整（平方差）',
                    expr: `(${A} + ${B}) * (${A} - ${B})`,
                    tex: `\\left(${A} + ${B}\\right) \\times \\left(${A} - ${B}\\right)`,
                    detail: `${A}^2 - ${B}^2 = (${A} + ${B}) * (${A} - ${B}) = ${A + B} * ${A - B}，平方差公式，省去算两个大平方。`,
                    detailTex: `${A}^{2} - ${B}^{2} = \\left(${A} + ${B}\\right) \\times \\left(${A} - ${B}\\right) = ${A + B} \\times ${A - B}`
                });
                return steps;
            }
            return steps;
        }

        // 比 n 大的、最小的 10 的倍数（n=99 -> 100、n=29 -> 30）
        function roundUp(n) {
            if (n % 10 === 0) return n + 10;
            return n + (10 - (n % 10));
        }

        // 要不要先给一个「通分 / 化成小数」的中间形态：
        // 两个分数（或分数与整数）直接加减时，学生思路是「先通分成同分母再算」，
        // 这一步单独摆出来，解析才有教学味道；求值不变，只是把加数写成同分母。
        function fractionPrepStep(node, foldedTree, used) {
            if (!node || node.k !== 'op' || (node.op !== '+' && node.op !== '-')) return null;
            const lv = treeValue(node.l);
            const rv = treeValue(node.r);
            if (!lv || !rv) return null;
            const bothFrac = lv.d !== 1n && rv.d !== 1n;
            const oneFrac = (lv.d !== 1n) !== (rv.d !== 1n);
            // 两个都是整数、或一个分数都没有：不需要通分步
            if (!bothFrac && !oneFrac) return null;
            const lcm = (a, b) => {
                let x = a < 0n ? -a : a;
                let y = b < 0n ? -b : b;
                while (y) { const t = x % y; x = y; y = t; }
                return (a < 0n ? -a : a) / x * (b < 0n ? -b : b);
            };
            const common = lcm(lv.d, rv.d);
            const ln = BigInt(lv.s) * BigInt(lv.n) * (common / lv.d);
            const rn = BigInt(rv.s) * BigInt(rv.n) * (common / rv.d);
            const sign = node.op === '-' ? '-' : '+';
            // 负数加数按位置决定写法：开头/减号后直接写 -3/4，加号后写 (-3/4)，不出现「+ -」
            const wrap = (n, d, pos) => {
                const a = String(n < 0n ? -n : n);
                const isNeg = n < 0n;
                const body = isNeg ? `-\\dfrac{${a}}{${d}}` : `\\dfrac{${a}}{${d}}`;
                const plain = `${isNeg ? '-' : ''}${a}/${d}`;
                const needParen = isNeg && pos !== 'lead';
                return {
                    text: needParen ? `(${plain})` : plain,
                    tex: body
                };
            };
            const lt = wrap(ln, common, 'lead');
            const rt = wrap(rn, common, node.op === '+' ? 'plus' : 'minus');
            // 第二次及以后的通分步标「再通分」，题目最多两次
            const title = used > 1 ? '再通分' : '通分';
            return {
                title: title,
                expr: `${lt.text} ${sign} ${rt.text}`,
                tex: `${lt.tex} ${sign} ${rt.tex}`,
                detail: '先把两个数化成同分母，分母取最小公倍数；分子跟着放大同样的倍数。',
                detailTex: null,
                used: used
            };
        }

        function buildSteps(question, answer) {
            const q = String(question === undefined || question === null ? '' : question).trim();
            if (!q) return [];
            const out = [{ title: '原式', expr: q, tex: null }];
            const tree = parseTree(q);
            if (!tree) return out;
            try { out[0].tex = renderTexH(tree); } catch (err) { out[0].tex = null; }
            let target;
            try {
                target = R.toPlain(treeValue(tree));
            } catch (err) {
                // 解析不了就按标准答案收尾（正常出题不会走到这里）
                try {
                    target = answer === undefined || answer === null ? '' : R.toPlain(evalExpr(answer));
                } catch (err2) {
                    return out;
                }
            }

            // ④ 档的简算题先给「为什么能简算」：分配律 / 凑整 / 平方差
            specialStepsH(q).forEach((step) => {
                out.push({
                    title: step.title,
                    expr: step.expr,
                    tex: step.tex,
                    // 简算步的讲解最有用（「把 99 看成 100 - 1」这类），别在渲染时丢掉
                    detail: step.detail || '',
                    detailTex: step.detailTex || ''
                });
            });

            // 一步一步折叠「最该先算」的子式；同一题面只记一次，避免重复步骤
            const seen = {};
            seen[norm(q)] = true;
            let current = tree;
            for (let guard = 0; guard < 8 && out.length < 6; guard++) {
                const next = pickNextStepH(current);
                if (!next) break;
                const why = explainTargetH(next.node);
                const folded = replaceNode(current, next.node, valNode(treeValue(next.node)));
                const expr = texToExprH(renderTexH(folded));
                current = folded;
                // 这一步就把整式算完了：要是分数加减，先把「通分」摆出来再给结果
                if (norm(expr) === norm(target)) {
                    const prep = fractionPrepStep(next.node, current, out.length);
                    if (prep) out.push(prep);
                    break;
                }
                if (seen[norm(expr)]) continue;
                seen[norm(expr)] = true;
                const tex = renderTexH(folded);
                out.push({
                    title: next.title,
                    expr: expr,
                    tex: tex,
                    detail: why.detail || '',
                    detailTex: why.detailTex || ''
                });
            }
            // 收尾：末步必须就是答案。这里用 R.toPlain 而不是 prettyTex——
            // prettyTex 是给「题面」好看的（会把 7/2 拆成「3 + 1/2」这种带分数写法），
            // 放在「结果」这一步会跟正确格式（假分数）打架；答案该长什么样就长什么样。
            out.push({ title: '结果', expr: target, tex: plainToTex(R.toPlain(treeValue(tree))) });
            return out;
        }

        // 解析树 -> 每步算哪个子式
        function pickNextStepH(root) {
            if (isAtomic(root)) return null;
            // 1) 乘方（先算乘方）
            const pow = findNode(root, (n) => n.k === 'pow');
            if (pow) return { node: pow, title: explainTargetH(pow).title };
            // 2) 括号里的整体：括号里的式子算出来
            const group = findNode(root, (n) => n.k === 'group' && !isAtomic(n.v));
            if (group) return { node: group, title: '先算括号里的' };
            // 3) 乘除（同级从左往右；分子分母全是整数的分数看成一个数，不拆）
            const mul = findNode(root, (n) => n.k === 'op' && (n.op === '*' || n.op === '/') && !isFractionNode(n));
            if (mul) return { node: mul, title: explainTargetH(mul).title };
            // 4) 加减（同级从左往右；分数照样是加数）
            const add = findNode(root, (n) => n.k === 'op' && (n.op === '+' || n.op === '-') && !isFractionNode(n));
            if (add) return { node: add, title: explainTargetH(add).title };
            // 5) 剩下的就是「分数本身」：化成最简分数/整数（这一步就是「约分」）
            const frac = findNode(root, (n) => isFractionNode(n));
            if (frac) return { node: frac, title: '约分' };
            return null;
        }

        // tex 之外再给一个纯文本 expr：把 \dfrac{a}{b} 还原成 a/b、\times 还原成 *
        // 用「从里到外」的逐字符扫描来配对花括号，不用正则（反斜杠在 JS 正则里太容易写错）
        function texToExprH(tex) {
            let s = String(tex);
            for (let round = 0; round < 10; round++) {
                const at = s.lastIndexOf('\\dfrac{');
                if (at < 0) break;
                const n1 = s.indexOf('{', at);
                const e1 = matchBrace(s, n1);
                if (e1 < 0) break;
                const n2 = s.indexOf('{', e1 + 1);
                const e2 = matchBrace(s, n2);
                if (n2 < 0 || e2 < 0) break;
                const num = s.slice(n1 + 1, e1);
                const den = s.slice(n2 + 1, e2);
                s = s.slice(0, at) + '(' + num + ')/(' + den + ')' + s.slice(e2 + 1);
            }
            const bs = String.fromCharCode(92);
            s = s.split(bs + 'times').join('*');
            s = s.split(bs + 'div').join('/');
            s = s.split(bs + 'left(').join('(');
            s = s.split(bs + 'left.').join('(');
            s = s.split(bs + 'right)').join(')');
            s = s.split(bs + 'right.').join(')');
            s = s.split(bs + 'cdot').join('*');
            // 幂的写法 ^{2} 还原成 ^2
            s = s.replace(/\^\{([^{}]*)\}/g, '^$1');
            // 收拾括号：(-(7)/(9)) -> -7/9、((5)/(12)) -> 5/12、(7)/(4) -> 7/4
            // 注意：运算符后面的负数要留括号（-1 - (-65)），只在开头/等号后/左括号后去掉
            for (let round = 0; round < 6; round++) {
                const before = s;
                s = s.replace(/\(\((-?\d+)\)\/\((\d+)\)\)/g, '($1/$2)');
                s = s.replace(/\(\s*(-\d+)\s*\)\s*\/\s*\(\s*(\d+)\s*\)/g, '$1/$2');
                s = s.replace(/\(\s*(\d+)\s*\)\s*\/\s*\(\s*(\d+)\s*\)/g, '$1/$2');
                s = s.replace(/^\(\s*(-?\d+\/\d+)\s*\)$/, '$1');
                s = s.replace(/^\(\s*(-?\d+)\s*\)/, '$1');
                s = s.replace(/\s+/g, ' ').trim();
                if (s === before) break;
            }
            // 运算符号后面的负数一律加括号：6 + -72 -> 6 + (-72)、-1 - -65 -> -1 - (-65)
            s = s.replace(/([+\-*/])\s+(-[\d.]+(?:\/\d+)?)(?![\d)])/g, (all, op, num) => `${op} ${num.includes('/') ? num : `(${num})`}`);
            s = s.replace(/([+\-*/])\s*(-[\d.]+(?:\/\d+)?)(?![\d)])/g, (all, op, num) => `${op} ${num.includes('/') ? num : `(${num})`}`);
            s = s.replace(/\s+/g, ' ').trim();
            return s;
        }

        // 从 { 开始找配对的 }，返回下标；找不到返回 -1
        function matchBrace(text, start) {
            if (start < 0 || text.charAt(start) !== '{') return -1;
            let depth = 0;
            for (let i = start; i < text.length; i++) {
                const ch = text.charAt(i);
                if (ch === '{') depth++;
                else if (ch === '}') {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return -1;
        }

        // ==================================================================
        // 7. 提示：1~3 条中文，只说方法、不给答案
        // ==================================================================
        function hintsFor(question) {
            const q = String(question === undefined || question === null ? '' : question).trim();
            const hints = [];
            if (!q) return ['先看清题目里的数字和符号'];
            const s = norm(q);
            // 分数线也是 /，所以「除法」要看有没有不是分数的 / 才算
            const tokens = tokensOf(q).map(stripParens);
            const hasRealMul = tokens.some((tok) => tok.indexOf('*') >= 0);
            const hasRealDiv = tokens.some((tok) => tok.indexOf('/') >= 0 && !/^-?\d+\/\d+$/.test(tok));
            if (s.includes('^')) hints.push('先算乘方；负数的偶次方是正的，奇次方是负的');
            if (s.includes('(') || s.includes(')')) hints.push('有括号先算括号里的');
            if (hasFractionToken(q)) {
                if (hasRealMul) hints.push('分数相乘：分子乘分子、分母乘分母，能约分先约分');
                if (hasRealDiv) hints.push('分数相除：除以一个分数等于乘它的倒数');
                if (!hasRealMul && !hasRealDiv) hints.push('异分母先通分再加减，最后看看能不能约分');
            }
            if (hasDecimalToken(q)) hints.push('小数乘法先按整数算，再数一数两个因数一共有几位小数');
            if (hasRealMul || hasRealDiv) hints.push('先乘除，后加减');
            if (hasRealMul && (s.includes('+') || s.includes('-'))) hints.push('两边都有同一个因数时，试试用分配律凑整');
            if (s.includes('*') && s.includes('/') && hasFractionToken(q)) hints.push('连乘连除从左往右算，能约分的先约掉再乘');
            // 减去一个负数：只要说清法则，不写具体数字（避免泄露题面里的数）
            if (/-\(-\d/.test(s)) hints.push('减去一个负数等于加上它的相反数，把减号和一个负号合并成加号');
            else if (/\+\(-\d/.test(s)) hints.push('加上一个负数等于减去它的相反数，符号先定好再算');
            if (!hints.length) hints.push('按运算顺序一步一步算，注意正负号');
            return hints.slice(0, 3);
        }

        // ==================================================================
        // 8. LaTeX：题面文本 -> KaTeX 字符串；解析不了返回 null
        //    * -> \times；/ -> \dfrac{分子}{分母}；负数括号保留为 \left( \right)
        // ==================================================================
        // 题面文本 -> KaTeX 字符串；解析不了返回 null
        function toLatexText(text) {
            if (typeof text !== 'string') return null;
            const raw = text.trim();
            if (!raw) return null;
            const s = toHalfWidth(raw);
            if (!s || /[^0-9+\-*/().^]/.test(s)) return null;
            const tree = parseTree(s);
            if (!tree) return null;
            try {
                return renderTexH(tree);
            } catch (err) {
                return null;
            }
        }
        // ==================================================================
        // 9. 导出
        // ==================================================================
        return {
            LEVELS: [1, 2, 3, 4],
            LEVEL_NAMES: ['入门', '基础', '进阶', '挑战'],
            generateQuestion,
            evaluateAnswer,
            buildSteps,
            hintsFor,
            toLatexText,
            valueOfExpr: evalExpr
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        // 某些打包器会注入 module 但没有 CommonJS 语义，所以两个出口都挂上
        module.exports = createArithEngine;
    }
    if (typeof global !== 'undefined' && global.math && global.MathCore) {
        global.ArithEngine = createArithEngine(global.math, global.MathCore);
    } else if (typeof global !== 'undefined' && global.math) {
        // 缺 math-core 时不能悄悄什么都不挂：页面拿到 undefined 只会白屏，
        // 挂个带 __loadError 的占位对象，页面才能把「缺哪个文件」直接写到学生眼前
        global.ArithEngine = { __loadError: 'js/math-core.js 未加载' };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
