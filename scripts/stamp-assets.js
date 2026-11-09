// scripts/stamp-assets.js —— 给页面里的本地 css/js 引用打上 ?v=<版本号>
//
// 为什么需要：浏览器按 URL 缓存样式和脚本。改完 css/js 不发版号，学生端会继续用缓存里的
// 旧文件（侧边栏高度/配色改完不生效就是这么来的），还得教会所有人 Ctrl+F5。
//
// 版本号取值（优先级从高到低）：
//   1. 环境变量 ASSET_VERSION（想用日期/自定义标记时）
//   2. 手动标记：页面里已经写了 ?v=manual-xxx —— 有它就直接用，不再被提交号覆盖
//   3. 当前 HEAD 提交号前 8 位
//
// 因为默认取提交号，改完代码提交后版本号会变一次；重复跑 `node scripts/stamp-assets.js`
// 再提交一次即可收敛（第二次的结果表里不会再出现「已更新」）。嫌麻烦就统一用 ASSET_VERSION。
//
// 用法：
//   node scripts/stamp-assets.js          # 写入
//   node scripts/stamp-assets.js --check  # 只检查，不一致时退出码 1
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PAGES = ['index.html', 'practice.html', 'equations.html', 'teacher.html'];
// 只处理自己维护的 css/js；vendor/（KaTeX、mathjs）是第三方固定版本，不动
const REF = /(?<ref>(?:href|src)=")(?<url>css\/[\w.-]+\.css|js\/[\w.-]+\.js)(?:\?v=[\w.-]+)?(?=")/g;

function readHeadSha() {
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

const checkOnly = process.argv.includes('--check');
let version = (process.env.ASSET_VERSION || '').trim();
if (!version) {
    const sha = readHeadSha();
    if (!sha) {
        console.error('拿不到当前提交号；请设置 ASSET_VERSION=... 再运行');
        process.exit(1);
    }
    version = sha.slice(0, 8);
}
if (!/^[\w.-]+$/.test(version)) {
    console.error('版本号只能是字母数字和 . _ -：' + version);
    process.exit(1);
}

let total = 0;
let changed = 0;
const stale = [];

PAGES.forEach((name) => {
    const file = path.join(root, 'frontend', name);
    const before = fs.readFileSync(file, 'utf8');
    // manual- 开头的手动标记优先：想长期固定在某个标记上时用
    const manual = before.match(/[?&]v=(manual-[\w.-]+)/);
    const useVersion = manual ? manual[1] : version;
    let count = 0;
    const after = before.replace(REF, (all, prefix, url) => {
        count += 1;
        return prefix + url + '?v=' + useVersion;
    });
    total += count;
    const dirty = after !== before;
    if (dirty) {
        changed += 1;
        if (!checkOnly) {
            if (/\uFFFD/.test(after)) {
                console.error(name + '：替换后出现乱码，已中止（未写入）');
                process.exit(1);
            }
            fs.writeFileSync(file, after, 'utf8');
        }
    }
    const label = dirty ? (checkOnly ? '需要更新' : '已更新') : '已是最新';
    console.log(`${name}：${count} 处引用 → ?v=${useVersion}（${label}）`);
    if (dirty) stale.push(name);
});

if (checkOnly) {
    if (stale.length) {
        console.error(`资源版本号不一致：${stale.join('、')}（运行 npm run stamp 更新）`);
        process.exit(1);
    }
    console.log(`资源版本号检查通过（共 ${total} 处引用）`);
} else {
    console.log(changed ? `写入完成，共 ${total} 处引用` : `无需改动，共 ${total} 处引用`);
}