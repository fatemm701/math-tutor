// frontend/js/quadratic-roots.js —— 一元二次方程求根（独立工具，暂未接入 equation-engine.js 流程）
// 只依赖 math-core.js 的有理数运算；不接触 DOM、KaTeX、网络和本地存储。
//
// 调用：createQuadraticRoots(math, core)
//   quadraticRoots(a, b, c) 解 ax^2 + bx + c = 0（a、b、c 可为数字、"3/2" 字符串或 Fraction）
//   返回 { status, roots, approx? }：
//     'not-quadratic' a = 0，不是一元二次方程
//     'no-real-root'  判别式 < 0，没有实数根
//     'two-equal'     判别式 = 0，两个相等实根（返回两个相同的值）
//     'two-roots'     判别式 > 0 且是完全平方数，两个有理数根
//     'irrational'    判别式 > 0 但不是完全平方数，roots 为空，approx 给近似值
//
// 说明：按要求只加函数、不接流程；equation-engine.js 里没有任何地方调用它。

(function (global) {
    'use strict';

    function createQuadraticRoots(math, core) {
        const { rational: R } = core;

        // 系数统一成有理数：数字、"3/2" 字符串、已经是 Fraction 的原样收
        function coefToR(value) {
            if (value === undefined || value === null) return R.zero;
            if (typeof value === 'string') {
                const text = value.trim();
                const m = /^(-?\d+)\/(\d+)$/.exec(text);
                if (m) return R.from(Number(m[1]), Number(m[2]));
                return R.from(Number(text));
            }
            if (typeof value === 'number') return R.from(value);
            return value;
        }

        // 判别式：D = b^2 - 4ac
        function discriminant(a, b, c) {
            return R.sub(R.mul(b, b), R.mul(R.fromNumber(4), R.mul(a, c)));
        }

        // 有理数 -> 近似小数，只在 irrational 时使用
        function approxOf(value) {
            return Number(value.s * value.n) / Number(value.d);
        }

        function quadraticRoots(a, b, c) {
            const qa = coefToR(a);
            const qb = coefToR(b);
            const qc = coefToR(c);
            if (R.isZero(qa)) return { status: 'not-quadratic', roots: [] };

            const D = discriminant(qa, qb, qc);
            const twoA = R.mul(R.fromNumber(2), qa);
            const negB = R.neg(qb);
            if (R.sign(D) < 0) return { status: 'no-real-root', roots: [] };
            if (R.isZero(D)) {
                const x0 = R.div(negB, twoA);
                return { status: 'two-equal', roots: [x0, x0] };
            }

            // 判别式是完全平方数才有理数根：D.n 与 D.d 都必须是完全平方数
            const n = Number(D.n);
            const d = Number(D.d);
            const rn = Math.round(Math.sqrt(n));
            const rd = Math.round(Math.sqrt(d));
            if (rn * rn !== n || rd * rd !== d) {
                const base = approxOf(R.div(negB, twoA));
                const delta = Math.sqrt(n / d) / (2 * approxOf(qa));
                return { status: 'irrational', roots: [], approx: [base + delta, base - delta] };
            }
            const sqrtD = R.from(rn, rd);
            const unit = R.div(R.one, twoA);
            const x1 = R.mul(R.add(negB, sqrtD), unit);
            const x2 = R.mul(R.sub(negB, sqrtD), unit);
            return { status: 'two-roots', roots: [x1, x2] };
        }

        return { quadraticRoots, discriminant };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createQuadraticRoots;
    } else {
        global.QuadraticRoots = createQuadraticRoots(global.math, global.MathCore);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);