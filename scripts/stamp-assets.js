// scripts/stamp-assets.js —— 给页面里的本地 css/js 引用打上 ?v=<版本号>
//
// 为什么需要：浏览器按 URL 缓存样式和脚本。改完 css/js 不发版号，学生端会继续用缓存里的
// 旧文件（侧边栏高度/配色改完不生效就是这么来的），还得教会所有人 Ctrl+F5。
//
// 版本号取值（优先级从高到低）：
//   1. 环境变量 ASSET_VERSION（想用日期/自定义标记时：ASSET_VERSION=20261109 npm run stamp）
//   2. 手动标记：页面里已经写了 ?v=manual-xxx —— 有它就直接用，不再被提交号覆盖
//   3. 沿用页面里已有的版本号（只在还没有版本号时，才用当前 HEAD 前 8 位初始化）
//
// 为什么不一味追当前提交号：提交会改变哈希，写完「当前 HEAD」再提交，版本号立刻落后一步；
// 靠 amend 反复逼近也追不上（amend 同样改哈希）。一旦版本号与提交号绑定，每次提交都会把
// 四个页面改脏。所以原则是：**版本号只在真的改了 css/js 时才手动推进一次**，
// 推进方式 = 改环境变量或直接改页面里的 ?v= 值，脚本本身保持幂等、不自动跳号。
//
// 用法：
//   node scripts/stamp-assets.js                    # 补全缺失的版本号 / 统一四页
//   ASSET_VERSION=20261109 npm run stamp            # 改了 css/js 之后推进版本号（推荐）
//   node scripts/stamp-assets.js --check            # 只检查格式与四页一致，不改文件
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
const headSha = readHeadSha();
const headVersion = headSha ? headSha.slice(0, 8) : null;

// 页面里已写的版本号：只取第一个（四页应一致，不一致由 test 负责报）
function existingVersion(html) {
    const m = html.match(/[?&]v=([\w.-]+)/);
    return m ? m[1] : null;
}

// 是否落后于 HEAD：拿当前提交树的哈希试比，命中说明这串就是某个旧提交，必然落后
function isStaleVersion(ver, html) {
    return !!ver && ver !== headVersion;
}

// 版本号的「新旧」无法从字符串顺序判断，这里只做格式校验；是否推进由调用方决定

let total = 0;
let changed = 0;
const stale = [];

PAGES.forEach((name) => {
    const file = path.join(root, 'frontend', name);
    const before = fs.readFileSync(file, 'utf8');
    // 版本号决策：显式指定 > manual- 手动标记 > 沿用已有 > HEAD
    // 沿用已有的原因见文件头：无条件追 HEAD 会导致「提交改哈希 → 版本号永远落后一步」的死循环
    const envVersion = (process.env.ASSET_VERSION || '').trim();
    const manual = before.match(/[?&]v=(manual-[\w.-]+)/);
    const written = existingVersion(before);
    let useVersion;
    if (envVersion) useVersion = envVersion;
    else if (manual) useVersion = manual[1];
    else if (written && !isStaleVersion(written, before)) useVersion = written;
    else if (written) useVersion = written;   // 落后也不自动追：追 HEAD 会把文件再次改脏，见文件头
    else {
        if (!headVersion) {
            console.error('页面里还没有版本号，且拿不到提交号；请设置 ASSET_VERSION=...');
            process.exit(1);
        }
        useVersion = headVersion;
    }
    if (!/^[\w.-]+$/.test(useVersion)) {
        console.error('版本号只能是字母数字和 . _ -：' + useVersion);
        process.exit(1);
    }
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