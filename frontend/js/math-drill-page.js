// frontend/js/math-drill-page.js —— 口算训练页渲染与交互：DOM、KaTeX、键盘、缓存、上报
// 结构与错题节奏和 practice.js / practice-equations.js 完全一致（错 1 次只提示、错 2 次给过程），
// 三个练习页互相切换时体验不乱；出题/判题/解析/提示全部来自 window.ArithEngine，
// 本文件不定义任何数学逻辑，只负责显示、键盘、缓存与上报。

(function (window) {
    'use strict';

    const engine = window.ArithEngine;
    // 引擎缺失时只有一个 console.error，学生看到的是「页面一片空白」，没有任何人能据此修：
    // 所以后面仍然挂上 window.onload，把缺的文件名直接写到 #feedback-display 上。
    // （引擎出口在缺 math-core 时会挂一个 { __loadError } 占位对象，这里一并当成缺失处理）
    const engineMissing = !engine || typeof engine.generateQuestion !== 'function';
    const engineErrorText = engine
        ? (engine.__loadError || '口算引擎不完整（缺 generateQuestion），请按 Ctrl+F5 强制刷新')
        : '口算引擎未加载（缺 js/arith-engine.js），请按 Ctrl+F5 强制刷新';
    if (engineMissing) console.error('[poly-drill] 口算引擎未加载：' + engineErrorText);

    // 占位对象上没有 generateQuestion，解构出来是 undefined，只在真正出题时才会被发现；
    // 这里先按「没有引擎」处理，下面的启动自检会把缺的文件名全部报出来
    const {
        generateQuestion,
        LEVEL_NAMES
    } = engineMissing ? {} : engine;

    // ---------- 启动自检 ----------
    // 这四个文件缺任何一个，页面都做不了题。写明文件名，学生/老师照着截图就能判断是哪次发版漏了文件
    const ENV_FILES = {
        mathjs: 'vendor/math.js（mathjs）',
        core: 'js/math-core.js',
        arith: 'js/arith-engine.js',
        katex: 'vendor/katex/katex.min.js'
    };

    // 返回缺失项的中文描述；全都齐了返回空字符串
    // 引擎和页面是一个整体：引擎能起来就说明 math.js / math-core.js 都在（引擎运行时依赖它们），
    // 所以只有引擎缺失时才逐个点名上游文件，省得引擎正常时还拿两个全局变量误报一遍
    function assertEnv() {
        const problems = [];
        if (engineMissing) {
            if (!window.math) problems.push('缺 ' + ENV_FILES.mathjs + '，题目无法生成');
            if (!window.MathCore) problems.push('缺 ' + ENV_FILES.core + '，口算引擎起不来');
            // 占位对象已经说明了具体缺哪个文件，这里的文件名只用来区分「没请求到」和「不完整」
            problems.push(engine && engine.__loadError
                ? '缺 ' + ENV_FILES.arith + '（' + engine.__loadError + '）'
                : '缺或不完整的 ' + ENV_FILES.arith);
        }
        // KaTeX 缺失只影响排版：renderMath 会自动退化成纯文本，老设备上照常能做，
        // 所以只提示不挡路（下面的启动流程不会因为它停下）
        if (!window.katex) console.warn('[poly-drill] 缺 ' + ENV_FILES.katex + '，题面改用纯文本排版');
        return problems.join('；');
    }

    // 显眼地把启动失败写给学生看：反馈区 + 侧边栏身份，侧边栏单独标一次，免得学生只盯题面
    function showFatalError(msg) {
        const fb = document.getElementById('feedback-display');
        if (fb) {
            fb.textContent = msg;
            fb.style.color = 'var(--danger)';
        }
        const who = document.getElementById('who');
        if (who) who.textContent = '加载失败';
    }

    // 引擎的判题/解析/提示/LaTeX 转换是页面主要依赖；但引擎和页面是并行开发的，
    // 缺哪个就退回 math-core 的 toLatexText（排版）或一个明确的中文报错，页面不整体崩。
    // toLatexText 的兜底用 math-core：它已经能把 3/4、(-2)^3 排成上下分式和上标，
    // 缺引擎封装时学生看到的题面不会变成一坨字符串。
    const core = window.MathCore;
    const engineToLatex = typeof engine.toLatexText === 'function'
        ? (text) => engine.toLatexText(text)
        : (core && typeof core.toLatexText === 'function' ? (text) => core.toLatexText(text) : null);

    function missingEnginePart(name) {
        return new Error('口算引擎缺少 ' + name + '，请刷新页面重试（Ctrl+F5）');
    }

    function evaluateAnswer(studentInput, correctAnswer) {
        if (typeof engine.evaluateAnswer !== 'function') throw missingEnginePart('判题（evaluateAnswer）');
        return engine.evaluateAnswer(studentInput, correctAnswer);
    }

    function buildSteps(question, answer) {
        if (typeof engine.buildSteps !== 'function') throw missingEnginePart('分步解析（buildSteps）');
        return engine.buildSteps(question, answer);
    }

    function hintsFor(question) {
        if (typeof engine.hintsFor !== 'function') return ['先把题拆成两步算：先算前面的，再和最后一个数合并。'];
        return engine.hintsFor(question);
    }

    // 档位说明（SPEC 3.2）：这一档比上一档多了什么，切换难度时显示在 #level-tabs 下面
    const LEVEL_DESCS = {
        1: '百以内正负数加减',
        2: '加入分数加减',
        3: '加入乘除（含负数、分数、小数）',
        4: '混合运算与简算（括号、乘方、凑整）'
    };
    // 按钮上用的①②③④；引擎给了 LEVEL_NAMES 就用引擎的档名，保持一致
    const LEVEL_CIRCLED = { 1: '①', 2: '②', 3: '③', 4: '④' };
    function levelTitle(level, names) {
        const name = (names && names[level - 1]) || '';
        return (LEVEL_CIRCLED[level] || '') + (name ? ' ' + name : '');
    }

    // ==========================================
    // 1c. 数学排版：优先 KaTeX，加载失败就退化成纯 HTML
    // ==========================================
    // 退化路径用的转义：口算题面只有数字和 + - * / . ( ) ^，没有字母，
    // 所以只需把乘方按上标排一下、乘号写漂亮一点，其余原样输出即可
    function escapeMathHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\^(-?\d)/g, '<sup>$1</sup>');
    }

    // 与方程页不同，口算没有字母：引擎的 toLatexText 是唯一排版来源，
    // 它返回 null（输入还没写完 / 写法不合法，如 "3/"、"-"）时退回原文本。
    // 这样学生边打边看也不会因为半截输入把 KaTeX 弄炸
    function displayLatex(text) {
        const raw = String(text);
        if (typeof engineToLatex === 'function') {
            // toLatexText 本应是纯函数，但引擎还在演进，不能让它内部异常把整页渲染打断
            let tex = null;
            try {
                tex = engineToLatex(raw);
            } catch (e) {
                tex = null;
            }
            if (tex) return tex;
        }
        return raw.replace(/\\/g, '\\backslash ');
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

    // 引擎的 buildSteps 每步可能自带 tex / detailTex（已是 KaTeX 源码），
    // 直接用可以省掉一次 toLatexText 往返，也避免链条式 expr（`5^2 = 5 * 5 = 25`）
    // 整段转不了 LaTeX 时把漂亮的排版丢掉。约定：tex 不是纯算式文本，不再二次转换；
    // 若万一带了 $...$ 分隔符，按行内公式剥掉（KaTeX 的 render 不认 $）。
    function stripMathDelims(tex) {
        let out = String(tex == null ? '' : tex).trim();
        const wrapped = out.match(/^\$\$([\s\S]*)\$\$$/) || out.match(/^\$([\s\S]*)\$$/);
        if (wrapped) out = wrapped[1].trim();
        return out;
    }

    // 有现成 tex 就直接渲；否则退回「toLatexText(纯文本)」，再退回转义后的纯文本
    function renderStepMath(el, tex, plain) {
        if (!el) return;
        const pre = stripMathDelims(tex);
        if (pre && typeof katex !== 'undefined') {
            try {
                katex.render(pre, el, { displayMode: false, throwOnError: false });
                return;
            } catch (err) {
                // 落到下面的普通路径
            }
        }
        renderMath(el, plain, false);
    }

    // ==========================================
    // 1d. 夜间模式：与其它练习页共用 poly-theme 这个键，来回切换不会一边亮一边暗
    //     （math.html 的 <head> 里另有一小段脚本负责首帧前恢复主题，避免闪白）
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

    // 当前是不是夜里：以 <html data-theme> 为准（首帧脚本和应用都会同步它），
    // 它代表「屏幕上现在是什么」，localStorage 只代表「上次存了什么」
    function isDarkNow() {
        const root = document.documentElement;
        return !!(root && root.getAttribute && root.getAttribute('data-theme') === 'dark');
    }

    function initThemeToggle() {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        // 首帧的状态由 <head> 里的脚本决定，这里只把按钮图标对齐
        applyTheme(readTheme(), btn);
        // 切换要看「当前真实状态」，不能再读一遍 localStorage：applyTheme 后两者总是一致，
        // 但只要哪次写入被浏览器拒掉，读回旧值就会卡在同一档，按钮看着像坏了
        btn.addEventListener('click', () => {
            // 状态以 <html data-theme> 为准：applyTheme 之后两者总是一致，
            // 但只要哪次写入被浏览器拒掉，读回 localStorage 旧值就会卡在同一档，按钮看着像坏了
            applyTheme(isDarkNow() ? 'light' : 'dark', btn);
        });
    }

    // ==========================================
    // 2. 前端交互与防作弊逻辑
    // ==========================================
    window.onload = async () => {
        const LEVELS = [1, 2, 3, 4];
        // 新学生第一次进来从「① 入门」开始，由易到难；已经做过的题由缓存恢复，不打断
        const DEFAULT_LEVEL = 1;
        // 缓存只管「刷新/误触不丢当前题」；放太久（隔了课）就丢掉，重新从入门开始。
        // 口算题一题几秒钟，30 分钟足够覆盖刷新、误关标签页这类情况
        const CACHE_TTL_MS = 30 * 60 * 1000;
        // 化简页是 poly_current_q、方程页是 eq_current_q，口算单独一个 arith_current_q：
        // 三种题型各留各的题，来回切换不会互相顶掉
        let STORAGE_KEY = 'arith_current_q';
        // 本档进度只记在浏览器里（arith_progress:<用户 id>），不新增后端请求：
        // 看板要的是做题记录，这里只是给学生「这一档已经练了多少、对了多少」的心理锚点
        let PROGRESS_KEY = 'arith_progress';
        // { '1': { done, correct }, '2': ... }；localStorage 不可用时停在内存里，本次会话照常计数
        let progress = null;

        let currentUser = null;
        let currentInput = '';
        let currentQ = null;
        let isLocked = false;   // 一题结束后锁定，禁止继续输入
        let wrongCount = 0;     // 本题已经错了多少次（满 2 次放解析）
        let hintUsed = false;   // 本题是否已展开过提示

        const qEl = document.getElementById('question-display');
        const inEl = document.getElementById('input-display');
        const fbEl = document.getElementById('feedback-display');
        const hintsEl = document.getElementById('hint-display');
        const stepsEl = document.getElementById('steps-display');
        const levelTabs = document.getElementById('level-tabs');
        const levelLabel = document.getElementById('level-label');
        const levelDesc = document.getElementById('level-desc');
        const tagEl = document.getElementById('q-tag');              // 「分数」标签，复用 .tag-fraction
        const decimalTagEl = document.getElementById('q-tag-decimal'); // 「小数」标签，.tag-decimal
        const keyboardEl = document.getElementById('keyboard');
        const submitKey = document.querySelector('.key.submit');
        // 进度小字：由脚本创建、挂在 #level-label 后面（不新增 HTML 节点，样式沿用 .level-desc）
        let progressEl = null;

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
            STORAGE_KEY = 'arith_current_q:' + user.id;   // 同一浏览器换人登录不会串题
            PROGRESS_KEY = 'arith_progress:' + user.id;   // 同一个浏览器换人登录也不会串进度
            loadProgress();
            const whoEl = document.getElementById('who');
            if (whoEl) {
                const roleLabel = user.role === 'teacher' ? '老师' : '学生';
                const invite = user.inviteCode ? ' · 邀请码 ' + user.inviteCode : '';
                whoEl.textContent = roleLabel + '：' + user.name + invite;
            }
            // 看板入口在左侧导航里（#nav-board，旧页面叫 #board-link），显示与文字由 app-nav.js 负责
            const boardLink = document.getElementById('nav-board') || document.getElementById('board-link');
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

        // ---------- 本档进度（只存 localStorage） ----------
        // 记成 { '1': { done: 24, correct: 19 }, ... }：done 是这一档做完的题数，
        // correct 是其中答对的题数；看解析/错两次算做完但不算对
        function loadProgress() {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch (e) { saved = null; }
            progress = saved && typeof saved === 'object' ? saved : {};
        }

        function saveProgress() {
            try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* 记不住就算了，本次会话内照样计数 */ }
        }

        function bumpProgress(level, isCorrect) {
            if (!progress) progress = {};
            const key = String(level);
            const item = progress[key] && typeof progress[key] === 'object' ? progress[key] : { done: 0, correct: 0 };
            progress[key] = {
                done: (Number(item.done) || 0) + 1,
                correct: (Number(item.correct) || 0) + (isCorrect ? 1 : 0)
            };
            saveProgress();
            renderProgress();
        }

        // 小字跟着当前档走：换档时显示的是新档自己的计数（还没做过就是 0）
        function renderProgress() {
            if (!progressEl || !progressEl.parentNode) return;
            const level = (currentQ && currentQ.level) || DEFAULT_LEVEL;
            const item = (progress && progress[String(level)]) || { done: 0, correct: 0 };
            progressEl.textContent = '本档已做 ' + (Number(item.done) || 0) + ' 题 · 正确 ' + (Number(item.correct) || 0) + ' 题';
        }

        // 节点由脚本建在 #level-label 后面：改 html 会牵动软键盘夹具的静态断言，
        // 而进度本来就是运行时数据，不值得为它在页面上占一个空壳
        function initProgressEl() {
            if (!levelLabel || !levelLabel.parentNode) return;
            if (typeof document.createElement !== 'function') return;
            progressEl = document.createElement('p');
            progressEl.className = 'level-desc';
            progressEl.id = 'level-progress';
            if (typeof levelLabel.insertAdjacentElement === 'function') {
                levelLabel.insertAdjacentElement('afterend', progressEl);
            } else {
                levelLabel.parentNode.appendChild(progressEl);
            }
            renderProgress();
        }

        // 一题结束时上报一次；失败只警告，绝不影响做题
        // topic:'arithmetic' 让服务端/看板把口算记录和化简、方程分开统计。
        // result 只用 correct / wrong / error —— 口算只有「对」「错」和「格式写错」三种，没有 unmerged。
        // gaveUp：学生主动点了「看解析」。revealed 仍表示「看到了完整解析」，含错两次被动给出。
        function reportAttempt(result, revealed, studentAnswer, gaveUp) {
            if (!currentUser || !currentQ || !currentQ.clientId) return;
            const payload = {
                topic: 'arithmetic',
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

        // 包一层：引擎抛异常不该把整个 onload 打断（打断后页面就停在半初始化状态，
        // 连「下一题」都点不动），所以异常交给调用方记下来，由它决定重试还是报错
        function attemptGenerate(level, onError) {
            try {
                return generateQuestion(level);
            } catch (err) {
                onError(err);
                return null;
            }
        }

        // 顶部标题：档名 + 内容（「① 入门 · 百以内正负数加减」）
        // #q-tag / #q-tag-decimal 是标题里的两枚徽标，用 textNode 拼回去，
        // 这样口径与方程页一致（标签是 #level-label 的子节点，不是被覆盖的 innerHTML）
        function renderLevelLabel() {
            if (!levelLabel) return;
            const level = currentQ && currentQ.level;
            const title = levelTitle(level, LEVEL_NAMES) || '口算训练';
            const desc = levelDesc && levelDesc.textContent ? String(levelDesc.textContent) : '';
            const text = desc ? title + ' · ' + desc : title;
            // 保留两枚标签节点，只换掉开头的文字节点
            const first = levelLabel.firstChild;
            if (first && first.nodeType === 3) first.nodeValue = text + ' ';
            else levelLabel.insertBefore(document.createTextNode(text + ' '), levelLabel.firstChild);
        }

        // 分数题 / 小数题徽标：旧缓存没有 tags，按普通整数题处理
        function renderTag() {
            const tags = (currentQ && Array.isArray(currentQ.tags)) ? currentQ.tags : [];
            const isFraction = tags.includes('fraction');
            const isDecimal = tags.includes('decimal');
            if (tagEl) {
                tagEl.hidden = !isFraction;
                tagEl.textContent = isFraction ? '分数' : '';
            }
            if (decimalTagEl) {
                decimalTagEl.hidden = !isDecimal;
                decimalTagEl.textContent = isDecimal ? '小数' : '';
            }
        }

        // 难度说明：随档切换改 #level-desc 的小字和顶部标题
        function renderLevelInfo() {
            const level = (currentQ && currentQ.level) || DEFAULT_LEVEL;
            if (levelDesc) levelDesc.textContent = LEVEL_DESCS[level] || '';
            renderLevelLabel();
            renderProgress();
        }

        // 一题没生成出来时不能白屏：题面位置写明原因，提交键切到「下一题」，
        // 学生点一下就能换一题重新出（换题会再走一次 generateQuestion）
        function showGenerateFailure(level, err, shownErr) {
            console.error('[poly-drill] 出题失败:', err || shownErr);
            isLocked = true;
            currentQ = null;
            currentInput = '';
            resetPanels();
            renderInput();
            if (qEl) qEl.textContent = '这一题没出出来';
            if (fbEl) {
                fbEl.style.color = 'var(--danger)';
                fbEl.textContent = '这一题没生成出来，点「下一题」重试';
                if (shownErr) fbEl.textContent += '（' + shownErr + '）';
            }
            if (levelDesc) levelDesc.textContent = LEVEL_DESCS[level] || levelDesc.textContent;
            setSubmitKey('next', '下一题');
        }

        // 加载题目：默认优先读取本地存货，刷新页面不丢当前题
        // failState 只给「重新出题」用：连出三次都失败就不再换档重试，免得原地打转
        function loadQuestion(level = DEFAULT_LEVEL, forceNew = false, failState) {
            isLocked = false;
            currentInput = '';
            wrongCount = 0;
            hintUsed = false;
            fbEl.textContent = '';
            fbEl.style.color = '';
            resetPanels();
            setSubmitKey('submit', '提交答案');

            let saved = null;
            if (!forceNew) {
                try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { saved = null; }
                if (!isValidQuestion(saved)) saved = null;
                // 上次那题放太久了就别再端出来，重新从指定难度出题
                if (saved && Date.now() - (saved.startedAt || 0) > CACHE_TTL_MS) saved = null;
            }

            if (saved) {
                currentQ = saved;
                if (!currentQ.startedAt) currentQ.startedAt = Date.now();
                if (!currentQ.clientId) currentQ.clientId = makeClientId();
                cacheQuestion();
            } else {
                // 出题在引擎里，随机边界上偶尔会抛异常或吐出半截对象：
                // 记下次数重试（同一档最多 3 次），实在不行就把原因摆到页面上，不让学生面对空白
                const tries = (failState && Number(failState.tries)) || 0;
                let picked = null;
                let thrown = null;
                for (let i = 0; i < 3 && !picked; i++) {
                    const candidate = attemptGenerate(level, err => { thrown = err; });
                    if (isValidQuestion(candidate)) picked = candidate;
                }
                const shownErr = thrown ? String(thrown.message || thrown) : '';
                if (!picked) {
                    if (!failState || tries < 3) {
                        return loadQuestion(level, true, { tries: tries + 1 });
                    }
                    return showGenerateFailure(level, thrown, shownErr);
                }
                currentQ = picked;
                currentQ.startedAt = Date.now();
                currentQ.clientId = makeClientId();
                cacheQuestion();
            }

            // 旧缓存可能没有 tags；生成器也可能返回 undefined，这里统一成数组
            currentQ.tags = Array.isArray(currentQ.tags)
                ? currentQ.tags.filter(t => typeof t === 'string')
                : [];
            cacheQuestion();
            renderTag();
            renderLevelInfo();

            // 高亮当前难度
            document.querySelectorAll('.level-tab').forEach(tab => {
                tab.classList.toggle('active', parseInt(tab.dataset.level) === currentQ.level);
            });

            renderMath(qEl, currentQ.question, true);
            renderInput();
        }

        function renderInput() {
            if (currentInput === '') {
                inEl.textContent = '请点击下方键盘输入';
                inEl.style.color = 'var(--placeholder)';
                return;
            }
            inEl.style.color = 'var(--primary)';
            renderMath(inEl, currentInput, true);
        }

        function resetPanels() {
            hintsEl.innerHTML = '';
            stepsEl.innerHTML = '';
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

            hintsEl.innerHTML = '';
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
        // studentAnswer：学生自己写的数；非空且没有完全做对时，顶部多一行对照
        function showSteps(studentAnswer, studentStatus) {
            stepsEl.innerHTML = '';
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
                // 引擎给的 tex 优先（已是 KaTeX 源码）；没有时走 toLatexText；再不行纯文本
                renderStepMath(body, step.tex, step.expr);

                row.appendChild(label);
                row.appendChild(body);

                // 「为什么」那一行小字：通分、约分、用分配律、凑整……有就显示，没有就不占位。
                // 有说明时给行加 .has-detail，CSS 靠它把 flex 行改成可换行，说明才能落到下一行
                const detail = step.detail;
                const detailTex = stripMathDelims(step.detailTex);
                if (detail || detailTex) {
                    row.className = 'step-row has-detail';
                    const note = document.createElement('div');
                    note.className = 'step-detail';
                    if (detailTex && typeof katex !== 'undefined') {
                        try {
                            katex.render(detailTex, note, { displayMode: false, throwOnError: false });
                        } catch (err) {
                            note.textContent = detail || '';
                        }
                    } else {
                        note.textContent = detail || '';
                    }
                    row.appendChild(note);
                }

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
        levelTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.level-tab');
            if (!tab) return;

            const newLevel = parseInt(tab.dataset.level);
            if (!LEVELS.includes(newLevel)) return;
            // 同一档：只是刷新说明文字，不换题
            if (currentQ && newLevel === currentQ.level) return;
            if (!confirm('切换难度将放弃当前题目（不计入记录），确认切换吗？')) return;

            clearCachedQuestion();
            loadQuestion(newLevel, true);
        });

        // 虚拟键盘
        keyboardEl.addEventListener('click', handleKeyAction);

        // 一个按键的全部行为：虚拟键盘点一下和物理键盘按一下都走这里，
        // 判题、上锁、上报只有这一份，两边不会跑出不同的结果
        function handleKeyAction(e) {
            const btn = e.target.closest('.key');
            if (!btn) return;

            const val = btn.dataset.val;
            const action = btn.dataset.action;
            // 本题结束后只允许「下一题」
            if (isLocked && action !== 'next') return;

            fbEl.textContent = ''; // 隐藏上一次的反馈

            if (val) {
                // data-val 是字符串：数字、运算符、小数点、括号都直接拼进输入
                currentInput += val;
            } else if (action === 'clear') {
                currentInput = '';
            } else if (action === 'backspace') {
                // 口算没有 ^2/^3 这种两字符键，退一格就是一个字符
                currentInput = currentInput.slice(0, -1);
            } else if (action === 'hint') {
                showHints();
            } else if (action === 'giveup') {
                // 看解析：和「错两次」一样给出完整过程，而不是只丢一个最简答案
                if (!confirm('查看解析将放弃本题（记为看解析），确认吗？')) return;

                const beforeGiveUp = currentInput;
                currentInput = currentQ.answer;
                renderInput();

                showSteps(beforeGiveUp, 'wrong');
                fbEl.textContent = '标准答案如上，完整过程在下面。看完点「下一题」继续。';
                fbEl.style.color = 'var(--warn)';

                enterResultMode();
                reportAttempt('wrong', true, beforeGiveUp, true);
                // 看了标准答案就不算做对：记进「已做」但正确数不动
                bumpProgress(currentQ.level, false);
            } else if (action === 'submit') {
                if (currentInput === '') return;

                // 判题在引擎里，任何解析异常都不该把学生卡死：出错就当作格式错重来，不锁题也不上报
                let result;
                try {
                    result = evaluateAnswer(currentInput, currentQ.answer);
                } catch (err) {
                    console.error('[poly-drill] 判题出错:', err);
                    result = { status: 'error', msg: '这个答案暂时判不了，换一种写法（分数写 3/4，小数写 0.75）再提交一次。' };
                }
                // 三个分支的顺序和其它练习页对齐：先正确，再错，最后是格式错
                if (result.status === 'correct') {
                    fbEl.style.color = 'var(--ok)';
                    fbEl.textContent = result.msg + ' 完整过程在下面，对照检查一下，看完点「下一题」。';
                    reportAttempt('correct', false, currentInput);
                    bumpProgress(currentQ.level, true);
                    showSteps(currentInput, 'correct');
                    enterResultMode();
                } else if (result.status === 'wrong') {
                    fbEl.style.color = 'var(--danger)';
                    wrongCount++;
                    if (wrongCount >= 2) {
                        // 同一题错了两次：给出完整过程，本题结束
                        showSteps(currentInput, 'wrong');
                        fbEl.textContent = '这题错了两次，完整过程在下面，对照看看是哪一步出的问题。看完点「下一题」。';
                        enterResultMode();
                        reportAttempt('wrong', true, currentInput);
                        bumpProgress(currentQ.level, false);
                    } else {
                        fbEl.textContent = result.msg + '（还有 1 次机会，再想想；卡住可以点「提示」）';
                    }
                } else {
                    // 引擎自己报的格式/解析错误：不算做错、不锁题，让学生改一下再提交
                    fbEl.style.color = 'var(--danger)';
                    fbEl.textContent = result.msg;
                }
            } else if (action === 'next') {
                clearCachedQuestion();
                // 上一题出题失败时 currentQ 是空的，这会儿学生手上没有档位可用，退回默认档
                loadQuestion((currentQ && currentQ.level) || DEFAULT_LEVEL, true);
                return; // 已经换题，不再渲染旧输入
            }

            if (!isLocked) renderInput();
        }

        // 键盘直接输入：学生多半是用电脑做题，只用鼠标点虚拟键盘太慢。
        // 只认口算需要的字符（数字、.+ - × ÷、括号），其它按键一律放过，
        // 免得抢掉浏览器快捷键和中文输入法
        const KEY_CHARS = {
            '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
            '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
            '.': '.', ',': '.',
            '-': '-', '−': '-', '_': '-',
            '+': '+', '/': '/', '*': '*', '×': '*', '÷': '/', 'x': '*', 'X': '*',
            '(': '(', ')': ')'
        };

        // 输入区没有真实的 <input>，全部状态在 currentInput 里，
        // 所以键盘事件只能自己维护：拼接、退格、清空、提交四件事，与虚拟键盘共用同一套提交逻辑
        const onKeydown = (e) => {
            // 焦点在输入框/下拉里时用户可能在做别的事（比如登录名），不抢
            const target = e.target;
            const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;   // Ctrl+R 之类的浏览器快捷键不拦
            // 输入法候选框打开时按键用来选词，这时候接走会打断中文输入
            if (e.isComposing || e.keyCode === 229) return;

            if (e.key === 'Enter') {
                // 锁定后回车就是「下一题」，和按钮行为一致，连着做题不用去摸鼠标
                if (isLocked) {
                    pressKey('next');
                } else if (currentInput !== '') {
                    pressKey('submit');
                }
                e.preventDefault();
                return;
            }
            if (e.key === 'Backspace') {
                if (!isLocked && currentInput !== '') {
                    currentInput = currentInput.slice(0, -1);
                    renderInput();
                }
                // 输入区没有 <input>，浏览器默认的「后退」行为必须拦住
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape') {
                if (!isLocked && currentInput !== '') {
                    currentInput = '';
                    renderInput();
                }
                // 不 preventDefault：按 Esc 时学生可能同时想退出全屏或关弹窗
                return;
            }
            if (isLocked) return;   // 本题已经结束，字符不再进输入

            const ch = KEY_CHARS[e.key];
            if (!ch) return;        // 白名单外（字母、F1、Tab 等）一律不碰
            currentInput += ch;
            fbEl.textContent = '';
            renderInput();
            e.preventDefault();
        };

        // 键盘只是锦上添花：挂不上（老设备、无头环境）时虚拟键盘照样能用，
        // 不能因为这一行让整个页面启动失败
        if (typeof document.addEventListener === 'function') {
            document.addEventListener('keydown', onKeydown);
        }

        // 键盘和虚拟键盘走同一条提交路径：伪造一次「点了这个键」交给同一个处理函数，
        // 判题、上锁、上报都还是原来那段逻辑，不复制第二份
        function pressKey(action) {
            handleKeyAction({ target: { closest: () => ({ dataset: { action } }) } });
        }

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
            initProgressEl();

            // 缺文件时先把话说明白：这一步比后面的出题重要，
            // 因为学生看到「页面空白」只会以为是自己网卡了，永远不会去按 F12
            const envProblem = assertEnv();
            if (envProblem) {
                showFatalError('页面缺少必要文件：' + envProblem + '。请按 Ctrl+F5 强制刷新；仍然不行请联系老师。');
                return;
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
        } catch (err) {
            console.error('[poly-drill] 初始化失败:', err);
            showBootError(err);
        }
    };
})(window);