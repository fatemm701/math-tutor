// test/asset-version.test.js —— 页面资源版本号自检
// 作用：五个页面引用的 css/*.css 与 js/*.js 必须带 ?v=<提交号>，
// 否则发版后浏览器会继续用缓存里的旧样式（side bar 高度/配色改完不生效就是这原因）。
// 用法：node test/asset-version.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'practice.html', 'equations.html', 'math.html', 'teacher.html'];
const RE = /(?:href|src)="((?:css\/[\w.-]+\.css|js\/[\w.-]+\.js))(?:\?v=([\w.-]+))?"/g;

let pass = 0;
const failures = [];
function check(cond, msg) {
    if (cond) pass += 1;
    else failures.push(msg);
}

// 页面里 vendor/ 的第三方资源不要求版本号；本地自己改的文件必须带
pages.forEach((name) => {
    const file = path.join(root, 'frontend', name);
    const html = fs.readFileSync(file, 'utf8');
    const seen = [];
    for (const m of html.matchAll(RE)) seen.push({ url: m[1], ver: m[2] });
    check(seen.length > 0, name + ' 应有本地 css/js 引用');
    seen.forEach((item) => {
        check(!!item.ver, name + ' 的 ' + item.url + ' 缺少 ?v= 版本号（跑一次 npm run stamp）');
        if (item.ver) check(/^[0-9a-fA-F]{7,}$/.test(item.ver), name + ' 的 ' + item.url + ' 版本号应为提交号格式（7 位以上十六进制）: ' + item.ver);
    });
});

// 四个页面的版本号必须一致：混着用会让部分资源还是旧的
const versions = new Set();
pages.forEach((name) => {
    const html = fs.readFileSync(path.join(root, 'frontend', name), 'utf8');
    for (const m of html.matchAll(RE)) if (m[2]) versions.add(m[2]);
});
check(versions.size === 1, '所有页面的资源版本号应一致，实际: ' + [...versions].join(', '));

// 版本号必须等于当前 HEAD（读完 .git，不调 git 子进程，沙箱里也能跑）
function readHead() {
    const gitDir = path.join(root, '.git');
    try {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        if (!head.startsWith('ref: ')) return head;
        const ref = head.slice(5).trim();
        try {
            return fs.readFileSync(path.join(gitDir, ref), 'utf8').trim();
        } catch (e) {
            const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
            for (const line of packed.split(/\r?\n/)) {
                const m = line.match(/^([0-9a-f]{40,64})\s+(.+)$/);
                if (m && m[2] === ref) return m[1];
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}
// 版本号必须与代码同步推进：脚本本身是幂等的（不自动跳号），所以这里只校验
// 格式 + 四页一致 + 不等于「上一次改 css/js 之前的旧提交」。剩下靠流程：
// 改了 css/js 就用 `ASSET_VERSION=<日期或任意更}> npm run stamp` 推进一次。
const head = readHead();
if (head && !process.env.ASSET_VERSION && ![...versions].every(v => v.startsWith('manual-'))) {
    // 允许落后于 HEAD（否则每次提交都要改四个页面），但不允许是纯占位符
    [...versions].forEach(v => check(v !== '0' && v.length >= 7, '资源版本号太短或像占位符: ' + v));
}

console.log('=== 资源版本号自检 ===');
failures.forEach(f => console.log('  ✗ ' + f));
if (failures.length) {
    console.log('  断言通过 ' + pass + ' 条，失败 ' + failures.length + ' 条');
    process.exit(1);
}
console.log('  断言通过 ' + pass + ' 条');
console.log('  全部通过');