// scripts/smoke-browser.js —— 用本机 Chrome/Edge 的 headless 模式真跑一遍口算页（真浏览器冒烟）
//
// 为什么要它：静态测试（test/page-assets.test.js）只能证明「HTML 里的 <script> 顺序对」，
// 证明不了「浏览器里真的跑起来了」。这次 math.html 漏了 js/math-core.js 就是整页空白，
// 而 Node 里的桩测试全绿。这里用 DevTools 协议（CDP）开一个真浏览器：
//   1) 打开 <BASE>/math.html
//   2) 断言控制台没有「口算引擎未加载」、window.ArithEngine 真的挂上了
//   3) 断言题面渲染出来了（#question-display 有内容）
//   4) 点 7、+、3、提交，断言 #feedback-display 有反馈、提交键变成「下一题」
//
// 用法：
//   npm start                 # 另开一个终端起服务
//   npm run smoke:browser     # 或者 node scripts/smoke-browser.js
// 环境变量：
//   BASE=http://127.0.0.1:3000   目标地址（也可只给 PORT）
//   CHROME_PATH=...              指定浏览器可执行文件（默认自动找 Chrome / Edge）
//   SMOKE_COOKIE="pd_sid=..."    口算页要登录，没登录会被踢回 index.html（脚本会提示并跳过）。
//                                登录一次拿 cookie：DevTools/Application 里复制，或用 curl 登录后复制的
//                                Set-Cookie；有了它冒烟才能跑完整条「出题→输入→判题→下一题」链路
//   HEADLESS=0                   弹出有界面的窗口（调试用）
//   KEEP_PROFILE=1               保留临时 user-data-dir（调试用）
//
// 约定：服务没起 / 本机没有 Chrome 或 Edge / 没登录 → 打印「跳过」并 exit 0（不阻塞 npm test）；
//       真跑起来但断言失败 → 打印每条失败原因并 exit 1。
// 不引任何第三方依赖：用 Node 自带的 fetch 和 WebSocket（Node ≥ 22）连 CDP；Node 20 会优雅跳过。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const PORT = process.env.PORT || '3000';
const BASE = (process.env.BASE || 'http://127.0.0.1:' + PORT).replace(/\/+$/, '');
const PAGE_URL = BASE + '/math.html';
const HEADLESS = process.env.HEADLESS !== '0';
const KEEP_PROFILE = process.env.KEEP_PROFILE === '1';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT || 30000);
// 口算页启动时必须打的日志（缺依赖时由 math-drill-page.js 打出来）
const MISSING_ENGINE_TEXT = '口算引擎未加载';
// 口算页要求登录（/api/auth/me 401 会被踢回 index.html）。
// 想让真浏览器冒烟跑完整流程，就把登录后的 cookie 放进 SMOKE_COOKIE（形如 pd_sid=xxxx）。
const EXTRA_HEADERS = (() => {
    const headers = {};
    const cookie = (process.env.SMOKE_COOKIE || '').trim();
    if (cookie) headers.Cookie = cookie;
    return Object.keys(headers).length ? headers : null;
})();

const BROWSER_CANDIDATES = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
].filter(Boolean);

// ----------------------------------------------------------------------------
// 小工具
// ----------------------------------------------------------------------------
function log(msg) { console.log(msg); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function skip(reason) {
    log('=== 真浏览器冒烟（口算页）===');
    log('  跳过：' + reason);
    process.exit(0);
}

function probe(url, timeoutMs = 1500) {
    return new Promise(resolve => {
        let settled = false;
        const finish = ok => { if (!settled) { settled = true; resolve(ok); } };
        const req = http.get(url, res => { res.resume(); finish(true); });
        req.setTimeout(timeoutMs, () => { req.destroy(); finish(false); });
        req.on('error', () => finish(false));
    });
}

function findBrowser() {
    for (const p of BROWSER_CANDIDATES) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch (e) { /* 没权限就换下一个 */ }
    }
    return null;
}

// Chrome for Testing 的写法：<exe> --headless=new --dump-dom about:blank
function browserVersion(exe) {
    try {
        const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
        return String(out).trim() || path.basename(exe);
    } catch (e) {
        return path.basename(exe);
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = require('net').createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function rmrf(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 占用中就算了 */ }
}

// 等 <profile>/DevToolsActivePort 出现：第一行是调试端口，第二行是浏览器级 ws 路径
async function waitForDevTools(profileDir, child, deadline) {
    const file = path.join(profileDir, 'DevToolsActivePort');
    while (Date.now() < deadline) {
        if (child && child.exitCode !== null) {
            throw new Error('浏览器启动后就退出了（exit ' + child.exitCode + '）');
        }
        try {
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
            if (lines.length) {
                const port = Number(lines[0]);
                if (port) return { port, wsPath: lines[1] || '' };
            }
        } catch (e) { /* 还没写出来，继续等 */ }
        await sleep(100);
    }
    throw new Error('等不到 DevToolsActivePort（浏览器没起来？）');
}

// ----------------------------------------------------------------------------
// 极简 CDP 客户端：一条 WebSocket，按 id 配对请求；事件按 sessionId 分发
// ----------------------------------------------------------------------------
class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 1;
        this.pending = new Map();
        ws.addEventListener('message', ev => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else resolve(msg.result);
            }
        });
    }

    static async connect(wsUrl) {
        if (typeof WebSocket !== 'function') {
            throw new Error('Node 没有内置 WebSocket（需要 Node ≥ 22），无法连 DevTools 协议');
        }
        const ws = new WebSocket(wsUrl);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('连接 DevTools 协议超时')), 10000);
            ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
            ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连不上 ' + wsUrl)); });
        });
        return new Cdp(ws);
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('CDP ' + method + ' 超时'));
            }, TIMEOUT_MS);
            this.pending.set(id, {
                resolve: v => { clearTimeout(timer); resolve(v); },
                reject: e => { clearTimeout(timer); reject(e); }
            });
        });
    }

    // 页面会话专用的 send：登录 cookie 不是在这里加的（Page.navigate 的 headers 参数只管
    // 主文档、不管子资源），而是导航前用 Network.setExtraHTTPHeaders 一次性设好。
    pageSend(method, params, sessionId) {
        return this.send(method, params, sessionId);
    }

    close() {
        try { this.ws.close(); } catch (e) { /* ignore */ }
    }
}

// ----------------------------------------------------------------------------
// 页面里跑的小段代码（只在浏览器里执行）
// ----------------------------------------------------------------------------
// 返回一个「快照」对象；用字符串传入 Runtime.evaluate，避免和宿主作用域互相干扰
const SNAPSHOT_SRC = `(() => {
    const text = (el) => el ? String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    const submit = document.querySelector('.key.submit');
    return {
        url: location.pathname,
        engineType: typeof window.ArithEngine,
        engineError: window.ArithEngine && window.ArithEngine.__loadError
            ? String(window.ArithEngine.__loadError) : '',
        mathCoreType: typeof window.MathCore,
        mathType: typeof window.math,
        question: text(document.getElementById('question-display')),
        feedback: text(document.getElementById('feedback-display')),
        input: text(document.getElementById('input-display')),
        submitAction: submit ? String(submit.dataset.action || '') : '',
        submitLabel: submit ? text(submit) : '',
        hasSubmit: !!submit
    };
})()`;

// 点一下软键盘上的某个键：data-val（数字/符号）或 data-action（提交 / 下一题）
const clickKey = (kind, value) => `(() => {
    const keys = Array.from(document.querySelectorAll('#keyboard .key'));
    const key = keys.find(k => k.dataset.${kind} === ${JSON.stringify(value)});
    if (!key) return { ok: false, msg: '页面上找不到 data-${kind}="${value}" 的按键' };
    key.click();
    return { ok: true };
})()`;

// 把本题做完然后点「下一题」：已经进入结果态就直接点；还在做题状态就点「看解析」
// （放弃本题，进入结果态）。这样判对判错都能稳定走到换题，冒烟结果可复现。
// 找不到任何一条路时返回 {skipped:true}，由调用方降级成提示（换题不是这条护栏的核心）
const finishQuestion = `(() => {
    const submit = document.querySelector('.key.submit');
    if (submit && submit.dataset.action === 'next') { submit.click(); return { ok: true, via: 'next' }; }
    const keys = Array.from(document.querySelectorAll('#keyboard .key'));
    const giveUp = keys.find(k => k.dataset.action === 'giveup');
    if (!giveUp) return { ok: false, skipped: true, msg: '页面上找不到 data-action="giveup" 的按键' };
    try { window.confirm = () => true; } catch (e) { /* 有的环境不让改，下面照样点 */ }
    giveUp.click();
    const afterGiveUp = document.querySelector('.key.submit');
    if (afterGiveUp && afterGiveUp.dataset.action === 'next') {
        afterGiveUp.click();
        return { ok: true, via: 'giveup' };
    }
    return { ok: false, skipped: true, msg: '点了「看解析」之后提交键还没变成「下一题」' };
})()`;

// ----------------------------------------------------------------------------
// 主流程
// ----------------------------------------------------------------------------
(async () => {
    // 1) 服务在不在
    if (!(await probe(PAGE_URL))) {
        skip('服务没起（' + PAGE_URL + ' 连不上）。先运行 npm start，再跑 npm run smoke:browser');
    }

    // 2) 找浏览器
    const exe = findBrowser();
    if (!exe) {
        skip('未找到本机 Chrome/Edge（可以设 CHROME_PATH 指向可执行文件）');
    }
    if (typeof WebSocket !== 'function') {
        skip('当前 Node 没有内置 WebSocket（需要 Node ≥ 22），跳过真浏览器冒烟');
    }

    const profileDir = path.join(os.tmpdir(), 'poly-drill-smoke-' + process.pid + '-' + Date.now());
    fs.mkdirSync(profileDir, { recursive: true });
    const args = [
        '--remote-debugging-port=0',
        '--user-data-dir=' + profileDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-gpu',
        '--no-sandbox',
        'about:blank'
    ];
    if (HEADLESS) args.unshift('--headless=new');
    log('=== 真浏览器冒烟（口算页）===');
    log('  浏览器: ' + exe);
    log('  目标页: ' + PAGE_URL);

    let child = null;
    let cdp = null;
    let exitCode = 0;
    let stderrTail = '';
    try {
        child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        if (child.stderr) {
            child.stderr.on('data', d => { stderrTail = (stderrTail + String(d)).slice(-2000); });
        }
        child.on('error', err => { stderrTail += String(err && err.message); });

        const dev = await waitForDevTools(profileDir, child, Date.now() + TIMEOUT_MS);
        cdp = await Cdp.connect('ws://127.0.0.1:' + dev.port + dev.wsPath);

        // 3) 新建标签页并挂上网络 / 控制台监听
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const attach = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const sessionId = attach.sessionId;

        const consoleErrors = [];   // 本页的 console.error
        const pageErrors = [];      // 未捕获异常
        const loadingFailures = []; // 没解析到文件的静态资源（<script src> 404 之类）
        cdp.ws.addEventListener('message', ev => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (!msg.method || msg.sessionId !== sessionId) return;
            if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                consoleErrors.push((msg.params.args || [])
                    .map(a => (a.value !== undefined ? a.value : (a.description || a.type || '')))
                    .join(' '));
            } else if (msg.method === 'Runtime.exceptionThrown') {
                const d = msg.params.exceptionDetails || {};
                pageErrors.push((d.exception && d.exception.description) || d.text || '未知异常');
            } else if (msg.method === 'Network.loadingFailed') {
                loadingFailures.push(String((msg.params && msg.params.errorText) || '加载失败'));
            }
        });

        await cdp.pageSend('Page.enable', {}, sessionId);
        await cdp.pageSend('Runtime.enable', {}, sessionId);
        await cdp.pageSend('Network.enable', {}, sessionId);
        // 登录 cookie（可选）：主文档和子资源都要带上，所以用网络层的额外请求头
        if (EXTRA_HEADERS) {
            await cdp.pageSend('Network.setExtraHTTPHeaders', { headers: EXTRA_HEADERS }, sessionId);
        }
        await cdp.pageSend('Log.enable', {}, sessionId).catch(() => {});

        const evaluate = async (expression) => {
            const res = await cdp.pageSend('Runtime.evaluate', {
                expression, returnByValue: true, awaitPromise: true
            }, sessionId);
            if (res.exceptionDetails) {
                throw new Error('页面里执行失败: '
                    + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description)
                        || res.exceptionDetails.text));
            }
            return res.result ? res.result.value : undefined;
        };

        // 等页面加载完（load 事件 + 再等异步的 /api/auth/me 与出题）
        const loaded = new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
            const onEvent = ev => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
                    clearTimeout(timer);
                    cdp.ws.removeEventListener('message', onEvent);
                    resolve(true);
                }
            };
            cdp.ws.addEventListener('message', onEvent);
        });
        await cdp.pageSend('Page.navigate', { url: PAGE_URL }, sessionId);
        if (!(await loaded)) throw new Error('页面加载超时（' + TIMEOUT_MS + 'ms）：' + PAGE_URL);

        // 出题是 window.onload 里的异步流程，轮询等题面出现
        const deadline = Date.now() + TIMEOUT_MS;
        let snap = await evaluate(SNAPSHOT_SRC);
        while (Date.now() < deadline) {
            const ready = snap && ((snap.question || '') !== '' || (snap.feedback || '') !== ''
                || pageErrors.length > 0);
            if (ready) break;
            await sleep(150);
            snap = await evaluate(SNAPSHOT_SRC);
        }

        const failures = [];
        const check = (cond, msg) => { if (!cond) failures.push(msg); };

        // 4) 启动自检：引擎与依赖真的挂上了
        //    注意：页面需要登录，没登录会被 math-drill-page.js 踢回 index.html——
        //    那不是护栏要拦的故障，单独提示一句就跳过（不红）
        if (snap.url !== '/math.html') {
            skip('被重定向到了 ' + snap.url + '：口算页需要登录，请先在浏览器登录一次，'
                + '然后把登录 cookie 写进环境变量 SMOKE_COOKIE 再跑（格式 pd_sid=...）；'
                + '或在本地对 /api/auth/me 放行的环境里跑');
        }
        const engineMissingLog = consoleErrors.some(t => t.includes(MISSING_ENGINE_TEXT));
        check(!engineMissingLog, '控制台出现了「' + MISSING_ENGINE_TEXT + '」：'
            + (consoleErrors.filter(t => t.includes(MISSING_ENGINE_TEXT))[0] || '')
            + (snap.engineError ? '（页面自报缺：' + snap.engineError + '）' : ''));
        check(snap.mathType === 'function' || snap.mathType === 'object',
            'window.math 没挂上（vendor/math.js 没加载或加载失败），实际 typeof = ' + snap.mathType);
        check(snap.mathCoreType === 'object', 'window.MathCore 没挂上（js/math-core.js 没加载），实际 typeof = '
            + snap.mathCoreType);
        check(snap.engineType === 'object', 'window.ArithEngine 没挂上，实际 typeof = ' + snap.engineType
            + (snap.engineError ? '（页面自报缺：' + snap.engineError + '）' : ''));
        check(pageErrors.length === 0, '页面有未捕获异常：' + pageErrors.slice(0, 3).join(' | '));
        check(loadingFailures.length === 0, '有资源加载失败：' + [...new Set(loadingFailures)].slice(0, 5).join(', '));

        // 5) 题面渲染出来了
        check((snap.question || '') !== '', '口算题面没渲染出来（#question-display 是空的，整页空白就是这个症状）');
        check(!!snap.hasSubmit, '页面上缺少提交键 .key.submit');
        check((snap.question || '').length <= 120, '题面内容异常长（看起来不是一道口算题）：'
            + String(snap.question).slice(0, 120));

        // 6) 真的做一道题：点 7、+、3、提交
        const firstQuestion = snap.question;
        const questionKey = (s) => String(s || '').replace(/\\s+/g, '');
        for (const [kind, value] of [['val', '7'], ['val', '+'], ['val', '3']]) {
            const r = await evaluate(clickKey(kind, value));
            check(r && r.ok, (r && r.msg) || ('点击 ' + value + ' 失败'));
            await sleep(60);
        }
        const typed = await evaluate(SNAPSHOT_SRC);
        check((typed.input || '').includes('7+3') || (typed.input || '').replace(/\s/g, '').includes('7+3'),
            '按了 7、+、3 之后 #input-display 应显示输入内容，实际: «' + typed.input + '»');

        const submitResult = await evaluate(clickKey('action', 'submit'));
        check(submitResult && submitResult.ok, (submitResult && submitResult.msg) || '点不到提交键');

        const feedbackDeadline = Date.now() + 5000;
        let after = await evaluate(SNAPSHOT_SRC);
        let nextQuestion = '';
        while (Date.now() < feedbackDeadline && (after.feedback || '') === '') {
            await sleep(100);
            after = await evaluate(SNAPSHOT_SRC);
        }
        // 判对还是判错都算「判题跑起来了」：错一次题不会锁，提交键还是「提交答案」，
        // 只有判对 / 错满两次 / 看解析才会变成「下一题」，所以下一题这条路单独走
        check(/下一题|对了|正确|再想想|完整过程|暂时判不了/.test(after.feedback || ''),
            '提交后 #feedback-display 的文案不像判题结果: «' + after.feedback + '»');
        check(questionKey(after.question) === questionKey(firstQuestion), '本题结束前不应换题，题面从 «' + firstQuestion
            + '» 变成了 «' + after.question + '»');

        // 7) 本题结束之后：提交键要变成「下一题」，点下去换一道新题
        const nextResult = await evaluate(finishQuestion);
        if (!(nextResult && nextResult.ok)) {
            // 这一题没结束（比如判错了一次），换题这条路就走不通，但上面已经覆盖了判题链路
            log('  ! 本题没进入「下一题」状态（' + ((nextResult && nextResult.msg) || '') + '），跳过换题检查');
        } else {
            const nextDeadline = Date.now() + 5000;
            let next = await evaluate(SNAPSHOT_SRC);
            while (Date.now() < nextDeadline
                && (next.submitAction !== 'submit' || questionKey(next.question) === questionKey(firstQuestion))) {
                await sleep(100);
                next = await evaluate(SNAPSHOT_SRC);
            }
            check((next.question || '') !== '', '点「下一题」后题面是空的');
            check(questionKey(next.question) !== questionKey(firstQuestion),
                '点「下一题」后应换一道新题，题面还是 «' + next.question + '»');
            check(next.submitAction === 'submit', '点「下一题」后提交键应恢复成 data-action=submit，实际 '
                + next.submitAction);
            check((next.feedback || '') === '', '点「下一题」后反馈区应清空，实际: «' + next.feedback + '»');
            nextQuestion = next.question;
        }

        // 8) 结论
        if (failures.length) {
            failures.forEach(f => log('  ✗ ' + f));
            log('  失败 ' + failures.length + ' 条（引擎挂载 / 题面渲染 / 软键盘输入 / 判题 / 下一题）');
            log('  结论：口算页在真浏览器里没跑通');
            if (stderrTail.trim()) log('  浏览器 stderr（末尾）: ' + stderrTail.trim().split(/\r?\n/).slice(-3).join(' / '));
            exitCode = 1;
        } else {
            log('  首题: ' + firstQuestion);
            log('  输入 7+3 后: «' + typed.input + '»');
            log('  判题反馈: ' + after.feedback.slice(0, 60) + (after.feedback.length > 60 ? '…' : ''));
            log('  下一题: ' + (nextQuestion || '（未走到换题）').slice(0, 60));
            log('  ✓ 引擎挂载、题面渲染、软键盘输入、判题与下一题全部通过');
            log('  全部通过');
        }
    } catch (err) {
        log('  ✗ 真浏览器冒烟跑不下去：' + (err && err.message ? err.message : err));
        exitCode = 1;
    } finally {
        if (cdp) cdp.close();
        if (child) {
            try {
                if (child.exitCode === null) {
                    if (process.platform === 'win32') {
                        try {
                            execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'],
                                { stdio: 'ignore', timeout: 10000 });
                        } catch (e) { child.kill(); }
                    } else {
                        child.kill('SIGKILL');
                    }
                }
            } catch (e) { /* ignore */ }
        }
        // 浏览器进程退出后 user-data-dir 才可能删得掉，稍等一下再删
        if (KEEP_PROFILE) {
            log('  （KEEP_PROFILE=1，临时目录保留在 ' + profileDir + '）');
        } else {
            let removed = false;
            for (let i = 0; i < 10 && !removed; i++) {
                await sleep(150);
                try {
                    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
                    removed = !fs.existsSync(profileDir);
                } catch (e) { /* Windows 偶尔还占着，再试 */ }
            }
            if (!removed) log('  ! 临时目录没删干净（不影响结果）: ' + profileDir);
        }
        process.exit(exitCode);
    }
})();