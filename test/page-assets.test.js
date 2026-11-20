// test/page-assets.test.js —— 页面脚本依赖链自检（静态解析 HTML，不开浏览器）
// 事故背景：frontend/math.html 漏了 js/math-core.js，口算页 window.ArithEngine 为 undefined，
// 整页空白不可用；而 npm test 全绿——因为 test/ui.smoke.js 在 Node 里手工造 window 桩、
// 手动把引擎塞进去，测的是「逻辑依赖」，不是真实 HTML 的 <script> 顺序。
// 本文件补这条护栏：真去读五页 HTML，按出现顺序解析 <script src> / <link href>，断言
//   1) 依赖顺序：谁先谁后（表驱动，不写死某一页的特例）
//   2) 资源存在：每个本地引用都要在磁盘上找得到
//   3) 版本号口径：同页内 ?v= 一致且是提交号格式（vendor 不要求，与现状一致）
//   4) 结构：<main> 之前的 <div> 开闭配平、</main> 前没有多余的 </div>
// 用法：node test/page-assets.test.js     （失败 exit 1）
// 变异验证（手工把某页 HTML 改坏、确认本测试会红）时，可以用 PAGE_ASSETS_FRONTEND
// 指到一个临时复制出来的 frontend 目录，别去动仓库里的真实页面：
//   PAGE_ASSETS_FRONTEND=%TEMP%\pd-mut node test/page-assets.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FRONTEND = process.env.PAGE_ASSETS_FRONTEND
    ? path.resolve(process.env.PAGE_ASSETS_FRONTEND)
    : path.join(root, 'frontend');
const PAGES = ['index.html', 'practice.html', 'equations.html', 'math.html', 'teacher.html'];

// ==========================================================================
// 1. 表：「文件 -> 它要用的浏览器全局名 -> 谁负责提供这个全局名」
//    这张表就是依赖图。加了新引擎/新页面脚本，在这里补一行即可，
//    下面所有断言都从这张表推出来，不需要在断言里写死某一页。
// ==========================================================================
const GLOBAL_PROVIDER = {
    math: 'vendor/math.js',                 // mathjs（UMD，本地 vendor）
    katex: 'vendor/katex/katex.min.js',     // 数学排版
    MathCore: 'js/math-core.js',
    PolyTree: 'js/poly-tree.js',
    PolyEngine: 'js/engine-simplify.js',
    EquationEngine: 'js/equation-engine.js',
    ArithEngine: 'js/arith-engine.js',
    QuadraticRoots: 'js/quadratic-roots.js',
    AppNav: 'js/app-nav.js'
};

const FILE_DEPS = {
    // vendor/ 下的三方库：只登记一下（依赖为空），免得每次跑都刷「表里没登记」的提示
    'vendor/math.js': [],
    'vendor/katex/katex.min.js': [],
    'vendor/katex/katex.min.css': [],
    // 引擎（IIFE，挂 window.<名字>），都靠 mathjs 的分数/表达式能力和 math-core 的 R
    'js/math-core.js': ['math'],
    'js/poly-tree.js': ['math', 'MathCore'],
    'js/engine-simplify.js': ['math', 'MathCore'],
    'js/equation-engine.js': ['math', 'MathCore', 'PolyTree'],
    'js/arith-engine.js': ['math', 'MathCore'],
    'js/quadratic-roots.js': ['math', 'MathCore'],
    // 侧边栏交互：只操作页面上的 DOM（#app-nav 等），不依赖别人的全局名，
    // 自己挂的 AppNav 是给别处用的出口，不算自己的依赖
    'js/app-nav.js': [],
    // 页面脚本：不挂全局，进来就取 window.<引擎>，拿不到就 console.error + 整页不动
    'js/practice.js': ['katex', 'math', 'MathCore', 'PolyEngine'],
    'js/practice-equations.js': ['katex', 'math', 'MathCore', 'PolyTree', 'EquationEngine'],
    'js/math-drill-page.js': ['katex', 'math', 'MathCore', 'ArithEngine']
};

// ==========================================================================
// 2. 每页的硬性参与要求（哪一页跑哪个引擎）
//    引擎文件漏了整页就没法用，所以这里要求「必须引用」，而不是「引用了才检查顺序」。
// ==========================================================================
const PAGE_REQUIRED = {
    'index.html': ['css/app-nav.css', 'js/app-nav.js'],
    'practice.html': ['vendor/math.js', 'js/math-core.js', 'js/poly-tree.js',
        'js/engine-simplify.js', 'js/app-nav.js', 'js/practice.js'],
    'equations.html': ['vendor/math.js', 'js/math-core.js', 'js/poly-tree.js',
        'js/equation-engine.js', 'js/app-nav.js', 'js/practice-equations.js'],
    'math.html': ['vendor/math.js', 'js/math-core.js', 'js/arith-engine.js'],
    'teacher.html': ['css/app-nav.css', 'js/app-nav.js']
};

let pass = 0;
const failures = [];
function check(cond, msg) {
    if (cond) pass += 1;
    else failures.push(msg);
}

// ==========================================================================
// 3. 解析工具
// ==========================================================================
// 注释里写了 <script src="..."> 不能算数（HTML 注释里的脚本不会执行，
// 也不能用来满足依赖）：先把注释替换成等长空白，保证行号不变
function blankComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, s => s.replace(/[^\n]/g, ' '));
}

function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line += 1;
    return line;
}

// 本地资源 = 不带协议的相对引用；http(s):// 、//cdn、data: 这类外链一律跳过
function isExternal(url) {
    return /^(?:[a-z][\w+.-]*:|\/\/)/i.test(url);
}

function isPageLink(url) {
    return /\.html(?:$|[?#])/i.test(url);
}

function isAssetsPath(url) {
    return /^(?:css|js|vendor)\//.test(url);
}

function stripVer(url) {
    return String(url).split('#')[0].split('?')[0];
}

function versionOf(url) {
    const m = String(url).match(/[?&]v=([^&#]+)/);
    return m ? m[1] : null;
}

// 按出现顺序扫出所有引用的本地资源（<script src> 与 <link href> 混在一起按原文位置排序）
function collectRefs(html) {
    const text = blankComments(html);
    const found = [];
    const push = (m, kind) => {
        const url = m[1];
        if (isExternal(url)) return;
        found.push({
            kind,                 // 'script' | 'link'
            file: stripVer(url),  // 去掉 ?v= 的路径
            url,                  // 原样（带版本号），报错时显示
            version: versionOf(url),
            index: m.index,       // 在原文里的位置，用来排序和算行号
            line: lineOf(text, m.index)
        });
    };
    for (const m of text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) push(m, 'script');
    for (const m of text.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) push(m, 'link');
    found.sort((a, b) => a.index - b.index);
    return found;
}

function readPage(name) {
    const file = path.join(FRONTEND, name);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
}

const warnings = [];
const pages = {};
PAGES.forEach(name => {
    const html = readPage(name);
    check(!!html, '缺少页面 frontend/' + name);
    if (!html) return;
    pages[name] = { html, refs: collectRefs(html) };
});

// ==========================================================================
// 4. 资源存在性：引用了就必须在磁盘上（防「路径写错 / 文件被删」这类回退）
// ==========================================================================
PAGES.forEach(name => {
    const page = pages[name];
    if (!page) return;
    const assets = page.refs.filter(r => r.kind === 'script' || isAssetsPath(r.file));
    check(assets.length > 0, name + ' 应引用本地脚本/样式，实际解析到 0 条');
    assets.forEach(r => {
        const abs = path.join(FRONTEND, r.file);
        check(fs.existsSync(abs), name + ':' + r.line + ' 引用的 ' + r.file + ' 不存在'
            + '（<link href> 与 <script src> 用的是前端目录的相对路径，检查文件名或路径是否写错）');
    });
    // 页面内的链接（侧边栏、登录后跳转）目标也得存在，否则一点就 404
    page.refs.filter(r => isPageLink(r.file)).forEach(r => {
        check(fs.existsSync(path.join(FRONTEND, r.file)),
            name + ':' + r.line + ' 链接的 ' + r.file + ' 不存在（导航/跳转会 404）');
    });
});

// ==========================================================================
// 5. 依赖顺序：按表驱动，逐个「页面里出现的文件」检查它的依赖有没有在它之前加载
//    比对用的是「文件路径」，不看版本号（?v= 只影响缓存，不影响执行顺序）
//    表里登记了、页面却没引用的文件不算错（那不是这几页要用的东西）；
//    但页面引用了、表里没登记的文件要提示，免得新加的脚本绕过检查。
// ==========================================================================
PAGES.forEach(name => {
    const page = pages[name];
    if (!page) return;
    const order = [];
    const firstIdx = new Map();
    page.refs.filter(r => r.kind === 'script').forEach(r => {
        if (firstIdx.has(r.file)) return;
        firstIdx.set(r.file, order.length);
        order.push(r);
    });

    order.forEach((ref, idx) => {
        const globals = FILE_DEPS[ref.file];
        if (!globals) {
            warnings.push(name + ' 引用了 ' + ref.file + '，但测试的 FILE_DEPS 里没登记它的依赖，'
                + '新脚本请补一行表（否则它的依赖顺序不受保护）');
            return;
        }
        // 每个依赖全局名：先确认页面上有脚本提供它，再看提供者是不是排在前面
        globals.forEach(globalName => {
            const provider = GLOBAL_PROVIDER[globalName];
            if (!provider) {
                check(false, '测试依赖表不完整：' + ref.file + ' 依赖 window.' + globalName
                    + '，但 GLOBAL_PROVIDER 里没登记谁提供它');
                return;
            }
            const providerIdx = firstIdx.get(provider);
            const dep = globalName === 'math' ? 'mathjs' : globalName;
            if (providerIdx === undefined) {
                check(false, name + ':' + ref.line + ' 的 ' + ref.file + ' 之前缺少 ' + provider
                    + '（它要用 window.' + dep + '，页面必须先加载 ' + provider
                    + '，否则这个脚本一进页面就报错、整页功能不可用）');
                return;
            }
            check(providerIdx < idx,
                name + ':' + ref.line + ' 的 ' + ref.file + ' 依赖 ' + provider + ' 提供的 window.' + dep
                + '，但 ' + provider + ' 排在第 ' + (providerIdx + 1) + ' 个脚本、' + ref.file
                + ' 排在第 ' + (idx + 1) + ' 个——顺序需要反过来');
        });
    });
});

// ==========================================================================
// 6. 每页必须参与的那几个文件（引擎文件漏一行，整页就是空白）
// ==========================================================================
PAGES.forEach(name => {
    const page = pages[name];
    if (!page) return;
    const loaded = new Set(page.refs.filter(r => r.kind === 'script').map(r => r.file));
    (PAGE_REQUIRED[name] || []).forEach(file => {
        const isScript = /\.js$/.test(file);
        if (isScript) {
            check(loaded.has(file), name + ' 没有加载 ' + file
                + '（该页的依赖表要求它，缺了页面会直接不可用）');
        } else {
            const hasLink = page.refs.some(r => r.kind === 'link' && r.file === file);
            check(hasLink, name + ' 没有引用样式 ' + file);
        }
    });
});

// ==========================================================================
// 7. 版本号口径：同页内所有带 ?v= 的资源必须一致且是提交号格式
//    vendor/ 下的三方库按现状不强制带版本号（不强于现状：现状就是不带）
//    缺版本号这件事由 test/asset-version.test.js 负责报，这里不重复报
// ==========================================================================
PAGES.forEach(name => {
    const page = pages[name];
    if (!page) return;
    const versioned = page.refs.filter(r => isAssetsPath(r.file) && r.version);
    const versions = [...new Set(versioned.map(r => r.version))];
    if (!versioned.length) return;
    check(versions.length === 1, name + ' 页内资源版本号应一致，实际混用了: ' + versions.join(', '));
    versions.forEach(v => {
        check(/^[0-9a-fA-F]{7,}$/.test(v),
            name + ' 的资源版本号应为提交号格式（7 位以上十六进制）: ' + v);
    });
});

// ==========================================================================
// 8. 结构：<main class="app-main"> 之前的 <div> 必须配平
//    侧边栏那一坨 div 漏一个 </div>，<main> 就会被嵌进侧边栏里，
//    宽屏下整页布局塌掉，而逻辑测试一条都发现不了。
//    统计时跳过注释和 <style>/<script> 块，只看真实标签。
// ==========================================================================
function markupUpToMain(html) {
    const text = blankComments(html);
    const mainIdx = text.search(/<main\b[^>]*\bclass="[^"]*\bapp-main\b/i);
    const end = mainIdx < 0 ? text.length : mainIdx;
    return text.slice(0, end);
}

PAGES.forEach(name => {
    const page = pages[name];
    if (!page) return;
    const head = markupUpToMain(page.html);
    const mainMatch = page.html.match(/<main\b[^>]*\bclass="([^"]*\bapp-main\b[^"]*)"/i);
    check(!!mainMatch, name + ' 应有 <main class="app-main">');
    const opens = (head.match(/<div\b/gi) || []).length;
    const closes = (head.match(/<\/div\s*>/gi) || []).length;
    check(opens === closes, name + ' 的 <main class="app-main"> 之前 <div> 不配平：开 ' + opens
        + ' 个、闭 ' + closes + ' 个（' + (opens > closes ? '少了 ' + (opens - closes) + ' 个 </div>'
            : '多了 ' + (closes - opens) + ' 个 </div>') + '，<main> 会被吞进侧边栏里）');
    const mainLine = mainMatch ? lineOf(page.html, page.html.search(/<main\b[^>]*\bclass="[^"]*\bapp-main\b/i)) : 0;
    check(!/<\/div\s*>\s*<\/div\s*>\s*<main\b/i.test(head),
        name + ':' + mainLine + ' 的 </main> 前一段应是单层收尾，出现了连续两个 </div> 紧跟 <main>，'
        + '像是多补了一个闭合标签（<main> 会被挤到侧边栏外面）');
});

// ==========================================================================
// 9. 专项：math.html —— 事故页。修复后的终态是 math.js -> math-core.js -> arith-engine.js
// ==========================================================================
if (pages['math.html']) {
    const refs = pages['math.html'].refs.filter(r => r.kind === 'script');
    const order = refs.map(r => r.file);
    const at = f => order.indexOf(f);
    check(refs.some(r => r.file === 'vendor/math.js'),
        'math.html 的 <head> 里缺少 vendor/math.js（口算引擎要 window.math，缺了连 MathCore 都建不起来）');
    check(refs.some(r => r.file === 'js/math-core.js'),
        'math.html 之前缺少 js/math-core.js（口算引擎要用 window.MathCore，缺了 ArithEngine 变成 undefined，整页空白）');
    check(refs.some(r => r.file === 'js/arith-engine.js'),
        'math.html 之前缺少 js/arith-engine.js（页面拿不到 window.ArithEngine）');
    check(order.join('|') === 'vendor/katex/katex.min.js|vendor/math.js|js/math-core.js|js/arith-engine.js'
        + '|js/app-nav.js|js/math-drill-page.js',
        'math.html 的脚本顺序应为 katex.min.js -> math.js -> math-core.js -> arith-engine.js'
        + ' -> app-nav.js -> math-drill-page.js，实际: ' + order.join(' -> '));
    if (at('js/math-core.js') >= 0 && at('js/arith-engine.js') >= 0) {
        check(at('js/math-core.js') < at('js/arith-engine.js'),
            'math.html 的 arith-engine.js 之前缺少 math-core.js：math-core.js（第 '
            + (at('js/math-core.js') + 1) + ' 个脚本）必须排在 arith-engine.js（第 '
            + (at('js/arith-engine.js') + 1) + ' 个脚本）之前，否则 window.MathCore 还没挂上，'
            + 'ArithEngine 出不来，口算页整页空白');
    }
    if (at('vendor/math.js') >= 0 && at('js/arith-engine.js') >= 0) {
        check(at('vendor/math.js') < at('js/arith-engine.js'),
            'math.html 的 arith-engine.js 之前缺少 vendor/math.js');
    }
    // 页面脚本必须在引擎之后（同一个 <script> 顺序问题：math-drill-page.js 进来就取 window.ArithEngine）
    if (at('js/math-drill-page.js') >= 0 && at('js/arith-engine.js') >= 0) {
        check(at('js/arith-engine.js') < at('js/math-drill-page.js'),
            'math.html 的 js/math-drill-page.js 必须排在 js/arith-engine.js 之后');
    }
}

// ==========================================================================
// 10. 自检：依赖表本身不能写歪（登记了不存在的文件 / 依赖了自己 / 页面上的脚本漏登记）
// ==========================================================================
Object.keys(FILE_DEPS).forEach(file => {
    check(fs.existsSync(path.join(FRONTEND, file)), '依赖表里登记的 ' + file + ' 根本不存在，表已过期');
    const deps = FILE_DEPS[file].map(g => GLOBAL_PROVIDER[g]).filter(Boolean);
    check(!deps.includes(file), '依赖表写错了：' + file + ' 依赖了自己');
});
Object.keys(GLOBAL_PROVIDER).forEach(g => {
    const file = GLOBAL_PROVIDER[g];
    check(fs.existsSync(path.join(FRONTEND, file)), 'GLOBAL_PROVIDER 里 window.' + g + ' 指向的 '
        + file + ' 不存在');
});
Object.keys(PAGE_REQUIRED).forEach(name => {
    check(PAGES.includes(name), 'PAGE_REQUIRED 里的 ' + name + ' 不在五页清单里（表已过期）');
    (PAGE_REQUIRED[name] || []).forEach(file => {
        check(fs.existsSync(path.join(FRONTEND, file)),
            'PAGE_REQUIRED 给 ' + name + ' 要求的 ' + file + ' 根本不存在，表已过期');
    });
});

// ==========================================================================
// 输出（口径与 test/asset-version.test.js 一致）
// ==========================================================================
warnings.forEach(w => console.log('  ! ' + w));
console.log('=== 页面脚本依赖自检 ===');
failures.forEach(f => console.log('  ✗ ' + f));
if (failures.length) {
    console.log('  断言通过 ' + pass + ' 条，失败 ' + failures.length + ' 条');
    process.exit(1);
}
console.log('  断言通过 ' + pass + ' 条');
console.log('  全部通过');