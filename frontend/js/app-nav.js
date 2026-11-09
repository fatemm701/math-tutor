// frontend/js/app-nav.js —— 左侧导航栏的交互（四个页面共用）
//
// 只做三件事，业务逻辑一概不碰：
//   1. 按登录角色显示看板入口文字；未登录时把入口置灰
//   2. 菜单按钮：宽屏切换「收起 / 展开」，窄屏开合抽屉；状态记在 localStorage
//   3. 「练习」分组折叠 / 展开，状态也记在本机
//   4. 侧边栏高度：内容不满一屏时整列铺满，内容更长时改成随页面滚动的 sticky 列
//
// 页面里已经有 #who / #theme-toggle / #logout 的脚本（practice.js、practice-equations.js、
// teacher.html 内联脚本），这里不重复处理它们，免得事件绑两次。
(function (global) {
    'use strict';

    const NAV_KEY = 'poly-nav';          // 'collapsed' | 缺省（展开）
    const GROUP_KEY = 'poly-nav-group';  // 'closed' | 缺省（展开）
    const NARROW = '(max-width: 768px)';
    const TALL_DELTA = 2;                // 内容比视口高出这么多像素才算「要滚动」

    function readFlag(key) {
        try {
            return global.localStorage.getItem(key);
        } catch (e) {
            return null;   // 隐私模式下 localStorage 不可用，本次会话内照样能切
        }
    }

    function writeFlag(key, value) {
        try {
            if (value === null) global.localStorage.removeItem(key);
            else global.localStorage.setItem(key, value);
        } catch (e) { /* 记不住就算了 */ }
    }

    // 窄屏判断：桩测试里没有 matchMedia 时按宽屏处理，页面行为不受影响
    function isNarrow() {
        try {
            return typeof global.matchMedia === 'function' && global.matchMedia(NARROW).matches;
        } catch (e) {
            return false;
        }
    }

    // 侧边栏高度形态：内容比一屏长时给 body 加 nav-tall，
    // CSS 里把侧边栏换成 sticky（贴视口）。判断依据是「内容真实高度 > 视口」，
    // 不是 scrollHeight，避免某些环境下的循环判定
    function syncNavHeight() {
        const body = document.body;
        if (!body || !body.classList || !body.classList.contains('nav-layout')) return;
        const main = typeof document.querySelector === 'function' ? document.querySelector('.app-main') : null;
        const doc = document.documentElement;
        if (!main || !doc || typeof main.getBoundingClientRect !== 'function') return;
        const viewH = doc.clientHeight || (global.innerHeight || 0);
        const contentH = main.getBoundingClientRect ? main.getBoundingClientRect().height : 0;
        body.classList.toggle('nav-tall', viewH > 0 && contentH > viewH + TALL_DELTA);
    }

    function init() {
        const nav = document.getElementById('app-nav');
        if (!nav) return;   // 没挂侧边栏的页面直接跳过

        const body = document.body;
        const toggle = document.getElementById('nav-toggle');
        const backdrop = document.getElementById('app-nav-backdrop');
        const groupBtn = document.getElementById('nav-group-practice');
        const group = groupBtn ? groupBtn.parentNode : null;   // .app-nav-group，负责 data-open 状态
        const sub = document.getElementById('nav-sub-practice');

        // ---------- 1. 初始形态 ----------
        const narrow = isNarrow();
        const collapsed = narrow ? true : readFlag(NAV_KEY) === 'collapsed';
        body.classList.toggle('nav-collapsed', collapsed);
        body.classList.add('nav-layout');
        body.classList.toggle('nav-narrow', narrow);
        syncToggleLabel(toggle, collapsed, narrow);

        // ---------- 2. 菜单按钮 ----------
        if (toggle) {
            toggle.addEventListener('click', () => {
                // 窄屏：开合抽屉；宽屏：收起 / 展开
                if (body.classList.contains('nav-narrow')) {
                    const open = body.classList.toggle('nav-open');
                    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                    return;
                }
                const next = !body.classList.contains('nav-collapsed');
                body.classList.toggle('nav-collapsed', next);
                writeFlag(NAV_KEY, next ? 'collapsed' : null);
                syncToggleLabel(toggle, next, false);
            });
        }

        // 窄屏抽屉：点遮罩、或点了任一链接就关上
        if (backdrop) backdrop.addEventListener('click', () => closeDrawer(toggle));
        nav.addEventListener('click', (event) => {
            const target = event.target;
            const link = target && typeof target.closest === 'function' ? target.closest('a[data-nav]') : null;
            if (link) closeDrawer(toggle);
        });

        // 视口宽度变了（转屏 / 拖窗口）：重新判断是哪一种形态
        if (typeof global.matchMedia === 'function') {
            try {
                const mq = global.matchMedia(NARROW);
                const onChange = () => {
                    const nowNarrow = mq.matches;
                    body.classList.toggle('nav-narrow', nowNarrow);
                    if (nowNarrow) {
                        body.classList.add('nav-collapsed');
                        closeDrawer(toggle);
                    } else {
                        body.classList.remove('nav-open');
                        body.classList.toggle('nav-collapsed', readFlag(NAV_KEY) === 'collapsed');
                    }
                    syncToggleLabel(toggle, body.classList.contains('nav-collapsed'), nowNarrow);
                };
                if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
                else if (typeof mq.addListener === 'function') mq.addListener(onChange);
            } catch (e) { /* 老浏览器没有 change 事件，保持初始形态 */ }
        }

        // ---------- 3. 「练习」分组折叠 ----------
        const closed = readFlag(GROUP_KEY) === 'closed';
        setGroupOpen(groupBtn, group, sub, !closed);
        if (groupBtn) {
            groupBtn.addEventListener('click', () => {
                if (groupBtn.classList.contains('is-disabled')) return;   // 访客态不让点
                const open = groupBtn.getAttribute('aria-expanded') !== 'true';
                setGroupOpen(groupBtn, group, sub, open);
                writeFlag(GROUP_KEY, open ? null : 'closed');
            });
        }

        // ---------- 4. 当前页高亮 ----------
        // 页面自己也可以标（更明确）；这里按文件名兜底，防止以后新页面忘了加
        const here = ((global.location && global.location.pathname) || '').split('/').pop() || '';
        if (here) {
            const links = nav.querySelectorAll ? nav.querySelectorAll('a[data-nav]') : document.querySelectorAll('a[data-nav]');
            Array.prototype.forEach.call(links, (a) => {
                if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
            });
        }

        // ---------- 2.5 侧边栏高度：跟着内容长与不长切换形态 ----------
        syncNavHeight();
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('resize', syncNavHeight);
        }
        if (typeof global.ResizeObserver === 'function') {
            // 题目切换、解析展开都会让内容变高变矮，这里跟着重算（老浏览器没有就只在 resize 时算）
            try {
                const main = typeof document.querySelector === 'function' ? document.querySelector('.app-main') : null;
                if (main) new global.ResizeObserver(syncNavHeight).observe(main);
            } catch (e) { /* 个别环境构造失败就跳过 */ }
        }

        // ---------- 5. 登录角色 ----------
        // 登录页在 <body data-auth="guest"> 上标明，不去请求 /api/auth/me
        if (body.getAttribute('data-auth') === 'guest') {
            applyGuest();
            return;
        }
        loadUser(body, nav);
    }

    function syncToggleLabel(toggle, collapsed, narrow) {
        if (!toggle) return;
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        let label;
        if (narrow) label = collapsed ? '打开菜单' : '收起菜单';
        else label = collapsed ? '展开菜单' : '收起菜单';
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
    }

    function closeDrawer(toggle) {
        const body = document.body;
        if (!body.classList.contains('nav-narrow')) return;
        body.classList.remove('nav-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function setGroupOpen(btn, group, sub, open) {
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (group && group.setAttribute) group.setAttribute('data-open', open ? 'true' : 'false');
        if (sub) sub.hidden = !open;
    }

    // 未登录：练习、看板都置灰，底部换成「去登录」
    function applyGuest() {
        const nav = document.getElementById('app-nav');
        const links = (nav && nav.querySelectorAll ? nav.querySelectorAll('a[data-nav]') : document.querySelectorAll('a[data-nav]'));
        Array.prototype.forEach.call(links, (a) => {
            a.classList.add('is-disabled');
            a.setAttribute('aria-disabled', 'true');
            a.removeAttribute('href');
        });
        const whoEl = document.getElementById('who');
        if (whoEl) whoEl.textContent = '未登录';
        const logoutBtn = document.getElementById('logout');
        if (logoutBtn) logoutBtn.hidden = true;
        const loginBtn = document.getElementById('nav-login');   // 练习页也有这个入口，访客态露出来
        if (loginBtn) loginBtn.hidden = false;
        const groupBtn = document.getElementById('nav-group-practice');
        if (groupBtn) groupBtn.classList.add('is-disabled');
    }

    async function loadUser(body, nav) {
        let user = null;
        try {
            const res = await global.fetch('/api/auth/me', { credentials: 'same-origin' });
            if (res.ok) {
                const json = await res.json();
                user = json && json.success ? json.data.user : null;
            }
        } catch (e) {
            user = null;
        }
        if (!user) {
            applyGuest();
            return;
        }

        // 账号区文字由页面自己的脚本负责写（练习页在 rememberUser 里写），
        // 这里只补看板入口的显示与文字：学生看到的是「我的看板」
        const board = document.getElementById('nav-board') || document.getElementById('board-link');
        if (board) {
            const isTeacher = user.role === 'teacher';
            const label = isTeacher ? '看板' : '我的看板';
            const textEl = typeof board.querySelector === 'function' ? board.querySelector('.app-nav-text') : null;
            if (typeof board.hidden === 'boolean') board.hidden = false;
            if (textEl) textEl.textContent = label;
            else if (typeof board.textContent === 'string') board.textContent = label;
            board.setAttribute('title', isTeacher ? '看全班学生的练习情况' : '看我自己的练习情况');
        }
        // 先填一个，避免页面脚本还没跑到时是空的
        const whoEl = document.getElementById('who');
        if (whoEl && (!whoEl.textContent || whoEl.textContent === '加载中…')) {
            const roleLabel = user.role === 'teacher' ? '老师' : '学生';
            const invite = user.inviteCode ? ' · 邀请码 ' + user.inviteCode : '';
            whoEl.textContent = roleLabel + ' · ' + user.name + invite;
        }
        return nav;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露只读常量给桩测试
    global.AppNav = { isNarrow, NAV_KEY, GROUP_KEY, syncNavHeight };
})(window);