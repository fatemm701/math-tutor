// frontend/js/practice.js —— 练习页渲染与交互：DOM、KaTeX、键盘、缓存、上报
// 数学计算全部来自 window.PolyEngine；本文件不定义多项式/出题/判题逻辑。

(function (window) {
    'use strict';

    const engine = window.PolyEngine;
    if (!engine) {
        console.error('[poly-drill] 数学引擎未加载');
        return;
    }

    const {
        generateQuestion,
        evaluateAnswer,
        buildSteps,
        hintsFor
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

        // toLatex：可选，把显示文本转成 LaTeX（只在 KaTeX 可用时使用）
        function renderMath(el, text, displayMode, toLatex) {
            if (!el) return;
            if (typeof katex !== 'undefined') {
                try {
                    katex.render(toLatex ? toLatex(text) : text, el, {
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
        // 2. 前端交互与防作弊逻辑
        // ==========================================
        window.onload = async () => {
            const LEVELS = [1, 2, 3, 4];
            // 新学生第一次进来从「① 入门」开始，由易到难；已经做过的题由缓存恢复，不打断
            const DEFAULT_LEVEL = 1;
            // 缓存只管「刷新/误触不丢当前题」；放太久（隔了课）就丢掉，重新从入门开始
            const CACHE_TTL_MS = 30 * 60 * 1000;
            let STORAGE_KEY = "poly_current_q";

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
                STORAGE_KEY = 'poly_current_q:' + user.id;   // 同一浏览器换人登录不会串题
                const whoEl = document.getElementById('who');
                if (whoEl) {
                    const roleLabel = user.role === 'teacher' ? '老师' : '学生';
                    const invite = user.inviteCode ? ' · 邀请码 ' + user.inviteCode : '';
                    whoEl.textContent = roleLabel + '：' + user.name + invite;
                }
                const boardLink = document.getElementById('board-link');
                if (boardLink) boardLink.hidden = user.role !== 'teacher';   // 只有老师能进看板
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
            function reportAttempt(result, revealed, studentAnswer) {
                if (!currentUser || !currentQ || !currentQ.clientId) return;
                const payload = {
                    clientId: currentQ.clientId,
                    level: currentQ.level,
                    tags: Array.isArray(currentQ.tags) ? currentQ.tags : [],
                    question: currentQ.question,
                    answer: currentQ.answer,
                    studentAnswer: studentAnswer || '',
                    result,
                    usedHint: hintUsed,
                    revealed: !!revealed,
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
                    inEl.style.color = "#9CA3AF";
                    return;
                }
                inEl.style.color = "var(--primary)";
                renderMath(inEl, currentInput, true, (text) => text.replace(/\*/g, '\\cdot '));
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

            // 分步解析：每步都与标准答案等价，最后一步就是答案
            // studentAnswer：学生自己写的式子；非空且没有完全做对时，顶部多一行对照
            function showSteps(studentAnswer) {
                stepsEl.innerHTML = "";
                const title = document.createElement('div');
                title.className = 'panel-title';
                title.textContent = '完整过程';
                stepsEl.appendChild(title);

                const mine = String(studentAnswer || '').trim();
                if (mine && evaluateAnswer(mine, currentQ.answer).status !== 'correct') {
                    const row = document.createElement('div');
                    row.className = 'step-row step-mine';

                    const label = document.createElement('span');
                    label.className = 'step-title';
                    label.textContent = '你的答案';

                    const body = document.createElement('span');
                    body.className = 'step-body';
                    renderMath(body, mine, false, (text) => text.replace(/\*/g, '\\cdot '));

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
                    currentInput += val;
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

                    showSteps(beforeGiveUp);
                    fbEl.textContent = "标准答案如上，完整过程在下面。看完点「下一题」继续。";
                    fbEl.style.color = '#F59E0B';

                    enterResultMode();
                    reportAttempt('wrong', true, beforeGiveUp);
                } else if (action === "submit") {
                    if (currentInput === "") return;

                    const result = evaluateAnswer(currentInput, currentQ.answer);
                    fbEl.style.color = result.status === 'correct' ? '#10B981' : (result.status === 'error' || result.status === 'wrong' ? '#EF4444' : '#F59E0B');

                    if (result.status === 'correct') {
                        fbEl.textContent = result.msg + " 完整过程在下面，对照检查一下，看完点「下一题」。";
                        reportAttempt('correct', false, currentInput);
                        showSteps(currentInput);
                        enterResultMode();
                    } else if (result.status === 'wrong') {
                        wrongCount++;
                        if (wrongCount >= 2) {
                            // 同一题错了两次：给出完整过程，本题结束
                            showSteps(currentInput);
                            fbEl.textContent = "这题错了两次，完整过程在下面，对照看看是哪一步出的问题。看完点「下一题」。";
                            enterResultMode();
                            reportAttempt('wrong', true, currentInput);
                        } else {
                            fbEl.textContent = result.msg + "（还有 1 次机会，再想想；卡住可以点「提示」）";
                        }
                    } else {
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
                fbEl.style.color = '#EF4444';
                const whoEl = document.getElementById('who');
                if (whoEl) whoEl.textContent = '初始化失败';
            }

            try {
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
                    fbEl.textContent = '题目库未加载，请刷新页面（Ctrl+F5）';
                    fbEl.style.color = '#EF4444';
                }
            } catch (err) {
                console.error('[poly-drill] 初始化失败:', err);
                showBootError(err);
            }
        };
})(window);
