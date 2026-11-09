// 给四个页面的本地 CSS/JS 引用加 ?v=<提交号>，发版后浏览器自动重取新文件。
//
//   node scripts/stamp-assets.js            写入（默认取 git HEAD 的短提交号）
//   node scripts/stamp-assets.js --check    只检查：版本号与当前 HEAD 不一致就 exit 1
//   ASSET_VERSION=20261109 node scripts/stamp-assets.js    手动指定（--check 时会认为一致）
//
// 不加版本号的是 vendor/（KaTeX、math.js）：第三方固定版本，文件名不带哈希也无所谓，
// 而且它们本来就是长缓存，每次发版重下一遍没意义。
//
// 注意：不在沙箱里调 git 子进程（Windows 沙箱会 EPERM），直接读 .git 目录：
//   支持「分支引用文件」和「packed-refs」两种存放方式。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'practice.html', 'equations.html', 'teacher.html'];
const RE = /(?<ref>(?:href|src)=")(?<url>(?:css\/[\w.-]+\.css|js\/[\w.-]+\.js))(?:\?v=[\w.-]+)?(?=")/g;

function readHeadSha() {
  const gitDir = path.join(root, '.git');
  let head;
  try {
    head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch (e) {
    return null;
  }
  if (!head.startsWith('ref: ')) return head;              // 游离 HEAD，内容是提交号
  const ref = head.slice(5).trim();
  try {
    return fs.readFileSync(path.join(gitDir, ref), 'utf8').trim();
  } catch (e) { /* 提交后引用会被打包进 packed-refs */ }
  try {
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40,64})\s+(.+)$/);
      if (m && m[2] === ref) return m[1];
    }
  } catch (e) { /* 没有 packed-refs 文件 */ }
  return null;
}

const check = process.argv.includes('--check');
const manual = process.env.ASSET_VERSION;
const sha = readHeadSha();
if (!manual && !sha) {
  console.error('读不到 git 提交号（不在仓库里？），可以用 ASSET_VERSION=xxx 指定');
  process.exit(1);
}
const version = manual || sha.slice(0, 8);

let stale = 0;
let total = 0;
for (const name of pages) {
  const file = path.join(root, 'frontend', name);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('\uFFFD')) {
    console.error(name + ' 里有乱码，先修好再说');
    process.exit(1);
  }
  let sites = 0;
  const stamped = html.replace(RE, (m, ref, url) => {
    sites += 1;
    return ref + url + '?v=' + version;
  });
  total += sites;
  if (check) {
    // --check 只要求「和当前 HEAD 一致」；手动指定版本号时不追究内容
    if (!manual && stamped !== html) {
      console.error(name + '：资源版本号落后了（应为 ' + version + '），跑一次 node scripts/stamp-assets.js');
      stale += 1;
    }
    continue;
  }
  if (stamped !== html) {
    fs.writeFileSync(file, stamped, 'utf8');
    console.log(name + '：' + sites + ' 处引用 → ?v=' + version);
  } else {
    console.log(name + '：' + sites + ' 处引用已是 ?v=' + version);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log('资源版本号检查通过（共 ' + total + ' 处引用）');
} else {
  console.log('写入完成，共 ' + total + ' 处引用');
}