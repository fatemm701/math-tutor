// frontend/js/practice-equations.js —— 一元一次方程练习页渲染与交互：DOM、KaTeX、键盘、缓存、上报
// 结构和错题节奏与 practice.js 保持一致（错 1 次只提示、错 2 次给过程），便于两个页面互相切换时体验不乱；
// 数学计算全部来自 window.EquationEngine（与 PolyEngine 同构），本文件不定义出题/判题逻辑。

(function (window) {
    'use strict';

    const engine = window.EquationEngine;
    if (!engine) {
        console.error('[poly-drill] 方程引擎未加载');
        return;
    }

    const {
        generateQuestion,
        evaluateAnswer,
        buildSteps,
        hintsFor,
        toLatexText
    } = engine;

    // ==========================================
    // 1c. 数学排版：优先 KaTeX，加载失败就退化成纯 HTML
    // ==========================================
    function escapeMathHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*+/g, '·')
            .replace(/\^(-?\d)/g, '<sup>$1</sup>');
    }

    // 一元一次方程只用 x，软键盘上却和化简页一样留了 y 键，学生误按很常见；
    // 连按两个字母（xy、xx、5xx）在引擎里是 error，但 toLatexText 对这类输入返回的是原样文本而不是 null，
    // 直接交给 KaTeX 就会并排显示成「xy」，学生看着像乘法、以为写对了。
    // 只有「引擎给不出 LaTeX」这一步才需要补乘号：真 LaTeX 里的连续字母是命令名（\dfrac、\left），
    // 一旦拆开整页公式就坏了，所以规范化放在兜底分支里，而不是对 tex 也跑一遍
    const ADJACENT_LETTERS = /([a-zA-Z])\1|([a-zA-Z])(?=[a-zA-Z])/g;
    function explicitLetterProduct(text) {
        return String(text).replace(ADJACENT_LETTERS, (match, dup, ahead) => {
            if (dup) return dup + '*' + dup;
            return ahead + '*';
        });
    }

    // 与化简页不同：方程题的字面量里有 '='，而且整数方程（x=4）也可能含分数形式，
    // 所以只要引擎能给出 LaTeX 就走它——toLatexText 返回 null（输入还没写完/写法不合法）时退回原文本
    function displayLatex(text) {
        const raw = String(text);
        if (typeof toLatexText === 'function') {
            // toLatexText 本应是纯函数，但引擎还在演进，不能让它内部异常把整页渲染打断
            let tex = null;
            try {
                tex = toLatexText(raw);
            } catch (e) {
                tex = null;
            }
            // 引擎对非法输入（xy、5xx）会原样返回文本，这种「看似 LaTeX 其实没排版」的结果也要补乘号；
            // 判断依据：真正的 LaTeX 一定带反斜杠命令，纯文本没有
            if (tex) {
                return tex.indexOf('\\') === -1
                    ? explicitLetterProduct(tex).replace(/\*/g, '\\cdot ')
                    : tex;
            }
        }
        return explicitLetterProduct(raw).replace(/\*/g, '\\cdot ');
    }

    function renderMath(el, text, displayMode) {
        if (!el) return;
        if (typeof katex !== 'undefined') {
            try {
                katex.render(displayLatex(text), el, {
                    displayMode: !!displayMode,
                    throwOnError: false
                });
                return;
            } catch (err) {
                // 落到下面的纯文本兜底
            }
        }
        el.innerHTML = escapeMathHtml(text);
    }

    // ==========================================
    // 1d. 夜间模式：与练习页共用 poly-theme 这个键，两页来回切换不会一边亮一边暗
    //     （equations.html 的 <head> 里另有一小段脚本负责首帧前恢复主题，避免闪白）
    // ==========================================
    const THEME_KEY = 'poly-theme';

    function readTheme() {
        try {
            return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
        } catch (e) {
            // 隐私模式下 localStorage 可能直接抛错：当作没选过
            const attr = document.documentElement && document.documentElement.getAttribute
                ? document.documentElement.getAttribute('data-theme') : null;
            return attr === 'dark' ? 'dark' : 'light';
        }
    }

    function applyTheme(theme, btn) {
        const dark = theme === 'dark';
        if (document.documentElement) {
            if (dark) document.documentElement.setAttribute('data-theme', 'dark');
            else document.documentElement.removeAttribute('data-theme');
        }
        if (btn) {
            btn.textContent = dark ? '☀️' : '🌙';
            btn.title = dark ? '白天模式' : '夜间模式';
            btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        }
        try {
            localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
        } catch (e) { /* 记不住就算了，本次会话内照样能切 */ }
    }

    function initThemeToggle() {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        // 首帧的状态由 <head> 里的脚本决定，这里只把按钮图标对齐
        applyTheme(readTheme(), btn);
        btn.addEventListener('click', () => {
            applyTheme(readTheme() === 'dark' ? 'light' : 'dark', btn);
        });
    }

    // ==========================================
    // 2. 前端交互与防作弊逻辑
    // ==========================================
    window.onload = async () => {
        const LEVELS = [1, 2, 3, 4];
        // 新学生第一次进来从「① 入门」开始，由易到难；已经做过的题由缓存恢复，不打断
        const DEFAULT_LEVEL = 1;
        // 缓存只管「刷新/误触不丢当前题」；放太久（隔了课）就丢掉，重新从入门开始
        const CACHE_TTL_MS = 30 * 60 * 1000;
        // 化简页用的是 poly_current_q，这里单独一个键：两种题型各留各的题，来回切换不会互相顶掉
        let STORAGE_KEY = "eq_current_q";

        let currentUser = null;
        let currentInput = "";
        let currentQ = null;
        let isLocked = false;   // 一题结束后锁定，禁止继续输入
        let wrongCount = 0;     // 本题已经错了多少次（满 2 次放解析）
        let hintUsed = false;   // 本题是否已展开过提示

        const qEl = document.getElementById("question-display");
        const inEl = document.getElementById("input-display");
        const fbEl = document.getElementById("feedback-display");
        const hintsEl = document.getElementById("hint-display");
        const stepsEl = document.getElementById("steps-display");
        const levelTabs = document.getElementById("level-tabs");
        const tagEl = document.getElementById("q-tag");
        const submitKey = document.querySelector(".key.submit");

        // ---------- 账号 ----------
        async function fetchMe() {
            try {
                const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
                if (!res.ok) return null;
                const json = await res.json();
                return json && json.success ? json.data.user : null;
            } catch (err) {
                return null;
            }
        }

        function rememberUser(user) {
            currentUser = user;
            STORAGE_KEY = 'eq_current_q:' + user.id;   // 同一浏览器换人登录不会串题
            const whoEl = document.getElementById('who');
            if (whoEl) {
                const roleLabel = user.role === 'teacher' ? '老师' : '学生';
                const invite = user.inviteCode ? ' · 邀请码 ' + user.inviteCode : '';
                whoEl.textContent = roleLabel + '：' + user.name + invite;
            }
            const boardLink = document.getElementById('board-link');
            // 登录后都能进看板：老师看全班，学生只看自己（页面内部按角色分流）
            if (boardLink) boardLink.hidden = false;
        }

        function makeClientId() {
            return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        }

        // 隐私模式/禁用站点数据时 localStorage 会抛错，不能让它影响做题
        function cacheQuestion() {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentQ)); } catch (e) { /* 忽略 */ }
        }

        function clearCachedQuestion() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
        }

        // 一题结束时上报一次；失败只警告，绝不影响做题
        // topic 让服务端/看板把方程记录和整式化简记录分开统计（同为 unmerged，含义不同）
        // gaveUp：学生主动点了「看解析」。revealed 仍表示「看到了完整解析」，含错两次被动给出。
        function reportAttempt(result, revealed, studentAnswer, gaveUp) {
            if (!currentUser || !currentQ || !currentQ.clientId) return;
            const payload = {
                topic: 'equation',
                clientId: currentQ.clientId,
                level: currentQ.level,
                tags: Array.isArray(currentQ.tags) ? currentQ.tags : [],
                question: currentQ.question,
                answer: currentQ.answer,
                studentAnswer: studentAnswer || '',
                result,
                usedHint: hintUsed,
                revealed: !!revealed,
                gaveUp: !!gaveUp,
                ms: Math.max(0, Date.now() - (currentQ.startedAt || Date.now()))
            };
            fetch('/api/attempts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            }).then(res => {
                if (res.ok) return null;
                return res.json()
                    .catch(() => ({}))
                    .then(json => { throw new Error((json && json.msg) || ('HTTP ' + res.status)); });
            }).catch(err => {
                console.warn('[poly-drill] 记录上报失败（不影响做题）：' + err.message);
            });
        }

        function isValidQuestion(q) {
            return !!q && typeof q.question === 'string' && typeof q.answer === 'string'
                && LEVELS.includes(q.level);
        }

        // 分数题徽标：旧缓存没有 tags，按整数题处理
        function renderTag() {
            if (!tagEl) return;
            const isFraction = !!currentQ && Array.isArray(currentQ.tags)
                && currentQ.tags.includes('fraction');
            tagEl.hidden = !isFraction;
            tagEl.textContent = isFraction ? '分数' : '';
        }

        // 加载题目：默认优先读取本地存货，刷新页面不丢当前题
        function loadQuestion(level = DEFAULT_LEVEL, forceNew = false) {
            isLocked = false;
            currentInput = "";
            wrongCount = 0;
            hintUsed = false;
            fbEl.textContent = "";
            fbEl.style.color = "";
            resetPanels();
            setSubmitKey('submit', '提交答案');

            let saved = null;
            if (!forceNew) {
                try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { saved = null; }
                if (!isValidQuestion(saved)) saved = null;
                // 上次那题放太久了就别再端出来，重新从默认难度出题
                if (saved && Date.now() - (saved.startedAt || 0) > CACHE_TTL_MS) saved = null;
            }

            if (saved) {
                currentQ = saved;
                if (!currentQ.startedAt) currentQ.startedAt = Date.now();
                if (!currentQ.clientId) currentQ.clientId = makeClientId();
                cacheQuestion();
            } else {
                currentQ = generateQuestion(level);
                currentQ.startedAt = Date.now();
                currentQ.clientId = makeClientId();
                cacheQuestion();
            }

            // 旧缓存没有 tags；生成器可能返回 undefined，这里统一成数组
            currentQ.tags = Array.isArray(currentQ.tags)
                ? currentQ.tags.filter(t => typeof t === 'string')
                : [];
            cacheQuestion();
            renderTag();

            // 高亮当前难度
            document.querySelectorAll('.level-tab').forEach(tab => {
                tab.classList.toggle('active', parseInt(tab.dataset.level) === currentQ.level);
            });

            renderMath(qEl, currentQ.question, true);
            renderInput();
        }

        function renderInput() {
            if (currentInput === "") {
                inEl.textContent = "请点击下方键盘输入";
                inEl.style.color = "var(--placeholder)";
                return;
            }
            inEl.style.color = "var(--primary)";
            renderMath(inEl, currentInput, true);
        }

        function resetPanels() {
            hintsEl.innerHTML = "";
            stepsEl.innerHTML = "";
            hintsEl.hidden = true;
            stepsEl.hidden = true;
        }

        function setSubmitKey(action, label) {
            submitKey.dataset.action = action;
            submitKey.textContent = label;
        }

        // 提示：按题型给 1~3 句话，同一题只展开一次
        function showHints() {
            if (hintUsed) return;
            hintUsed = true;

            hintsEl.innerHTML = "";
            const title = document.createElement('div');
            title.className = 'panel-title';
            title.textContent = '提示';
            hintsEl.appendChild(title);

            const ul = document.createElement('ul');
            hintsFor(currentQ.question).forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
            hintsEl.appendChild(ul);
            hintsEl.hidden = false;
        }

        // 分步解析：每一步都与标准答案等价，最后一步就是答案
        // studentAnswer：学生自己写的等式；非空且没有完全做对时，顶部多一行对照
        function showSteps(studentAnswer, studentStatus) {
            stepsEl.innerHTML = "";
            const title = document.createElement('div');
            title.className = 'panel-title';
            title.textContent = '完整过程';
            stepsEl.appendChild(title);

            const mine = String(studentAnswer || '').trim();
            if (mine && studentStatus !== 'correct') {
                const row = document.createElement('div');
                row.className = 'step-row step-mine';

                const label = document.createElement('span');
                label.className = 'step-title';
                label.textContent = '你的答案';

                const body = document.createElement('span');
                body.className = 'step-body';
                renderMath(body, mine, false);

                row.appendChild(label);
                row.appendChild(body);
                stepsEl.appendChild(row);
            }

            buildSteps(currentQ.question, currentQ.answer).forEach((step, i) => {
                const row = document.createElement('div');
                row.className = 'step-row';

                const label = document.createElement('span');
                label.className = 'step-title';
                label.textContent = (i + 1) + '. ' + step.title;

                const body = document.createElement('span');
                body.className = 'step-body';
                renderMath(body, step.expr, false);

                row.appendChild(label);
                row.appendChild(body);
                stepsEl.appendChild(row);
            });
            stepsEl.hidden = false;
        }

        // 本题结束（已看到完整过程），等学生自己点「下一题」
        function enterResultMode() {
            isLocked = true;
            setSubmitKey('next', '下一题');
        }

        // 难度切换（放弃当前题，不计入记录）
        levelTabs.addEventListener("click", (e) => {
            const tab = e.target.closest('.level-tab');
            if (!tab) return;

            const newLevel = parseInt(tab.dataset.level);
            if (newLevel === currentQ.level) return;
            if (!confirm("切换难度将放弃当前题目（不计入记录），确认切换吗？")) return;

            clearCachedQuestion();
            loadQuestion(newLevel, true);
        });

        // 虚拟键盘
        document.getElementById("keyboard").addEventListener("click", (e) => {
            const btn = e.target.closest('.key');
            if (!btn) return;

            const val = btn.dataset.val;
            const action = btn.dataset.action;
            // 本题结束后只允许「下一题」
            if (isLocked && action !== 'next') return;

            fbEl.textContent = ""; // 隐藏上一次的反馈

            if (val) {
                // data-val 是字符串，"=" 也能走到这里，和数字/字母一样直接拼进输入
                currentInput += val;
            } else if (action === "clear") {
                currentInput = "";
            } else if (action === "backspace") {
                if (currentInput.match(/\^[23]$/)) {
                    currentInput = currentInput.slice(0, -2);
                } else {
                    currentInput = currentInput.slice(0, -1);
                }
            } else if (action === "hint") {
                showHints();
            } else if (action === "giveup") {
                // 看解析：和「错两次」一样给出完整过程，而不是只丢一个最简答案
                if (!confirm("查看解析将放弃本题（记为看解析），确认吗？")) return;

                const beforeGiveUp = currentInput;
                currentInput = currentQ.answer;
                renderInput();

                showSteps(beforeGiveUp, 'wrong');
                fbEl.textContent = "标准答案如上，完整过程在下面。看完点「下一题」继续。";
                fbEl.style.color = 'var(--warn)';

                enterResultMode();
                reportAttempt('wrong', true, beforeGiveUp, true);
            } else if (action === "submit") {
                if (currentInput === "") return;

                // 判题在引擎里，任何解析异常都不该把学生卡死：出错就当作格式错重来，不锁题也不上报
                let result;
                try {
                    result = evaluateAnswer(currentInput, currentQ.answer);
                } catch (err) {
                    console.error('[poly-drill] 判题出错:', err);
                    result = { status: 'error', msg: '这个答案暂时判不了，换一种写法（比如 x=4）再提交一次。' };
                }
                // 四个分支的顺序和 practice.js 对齐：先正确，再「对但没做完」，最后才是错与格式错
                if (result.status === 'correct') {
                    fbEl.style.color = 'var(--ok)';
                    fbEl.textContent = result.msg + " 完整过程在下面，对照检查一下，看完点「下一题」。";
                    reportAttempt('correct', false, currentInput);
                    showSteps(currentInput, 'correct');
                    enterResultMode();
                } else if (result.status === 'unmerged') {
                    // 「对，但还没化系数为一」：答案等价却停在 2x=8 这种形式，按没做完登记；判题口径全部交给引擎
                    fbEl.style.color = 'var(--warn)';
                    fbEl.textContent = "对，但还没化系数为一。完整过程在下面，看完点「下一题」。";
                    reportAttempt('unmerged', false, currentInput);
                    showSteps(currentInput, 'unmerged');
                    enterResultMode();
                } else if (result.status === 'wrong') {
                    fbEl.style.color = 'var(--danger)';
                    wrongCount++;
                    if (wrongCount >= 2) {
                        // 同一题错了两次：给出完整过程，本题结束
                        showSteps(currentInput, 'wrong');
                        fbEl.textContent = "这题错了两次，完整过程在下面，对照看看是哪一步出的问题。看完点「下一题」。";
                        enterResultMode();
                        reportAttempt('wrong', true, currentInput);
                    } else {
                        fbEl.textContent = result.msg + "（还有 1 次机会，再想想；卡住可以点「提示」）";
                    }
                } else {
                    // 引擎自己报的格式/解析错误：不算做错、不锁题，让学生改一下再提交
                    fbEl.style.color = 'var(--danger)';
                    fbEl.textContent = result.msg;
                }
            } else if (action === "next") {
                clearCachedQuestion();
                loadQuestion(currentQ.level, true);
                return; // 已经换题，不再渲染旧输入
            }

            if (!isLocked) renderInput();
        });

        // ---------- 启动：先确认登录，再出题 ----------
        function showBootError(err) {
            const msg = (err && err.message) ? err.message : String(err);
            fbEl.textContent = '页面初始化失败：' + msg + '（按 F12 看控制台详情）';
            fbEl.style.color = 'var(--danger)';
            const whoEl = document.getElementById('who');
            if (whoEl) whoEl.textContent = '初始化失败';
        }

        try {
            initThemeToggle();

            if (typeof katex === 'undefined') {
                console.warn('[poly-drill] KaTeX 未加载，已改用纯文本排版');
            }
            if (typeof math === 'undefined') {
                console.warn('[poly-drill] mathjs 未加载，题目无法正常生成');
            }

            const me = await fetchMe();
            if (!me) {
                window.location.replace('index.html');
                return;
            }
            rememberUser(me);

            const logoutBtn = document.getElementById('logout');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', async () => {
                    try {
                        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
                    } catch (err) { /* 忽略，退出后照样回登录页 */ }
                    window.location.replace('index.html');
                });
            }

            loadQuestion(DEFAULT_LEVEL);

            if (typeof math === 'undefined') {
                fbEl.textContent = '题库未加载，请刷新页面（Ctrl+F5）';
                fbEl.style.color = 'var(--danger)';
            }
        } catch (err) {
            console.error('[poly-drill] 初始化失败:', err);
            showBootError(err);
        }
    };
})(window);