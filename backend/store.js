// backend/store.js —— data/db.json 的读写
// 单进程、同步写入（文件很小），临时文件 + rename 保证不写坏
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';

function emptyDb() {
    return { version: 1, users: [], sessions: {}, attempts: [] };
}

let db = null;

function writeNow(value) {
    const content = JSON.stringify(value, null, 2);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, content, 'utf8');
    try {
        fs.renameSync(TMP_FILE, DB_FILE);
    } catch (err) {
        // Windows 上目标文件被别的程序占用时 rename 会失败，退回直接写
        fs.writeFileSync(DB_FILE, content, 'utf8');
        try { fs.unlinkSync(TMP_FILE); } catch (e) { /* ignore */ }
    }
}

function readFromDisk() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
        writeNow(emptyDb());
        return emptyDb();
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) return emptyDb();

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error('data/db.json 内容损坏（' + err.message + '），请先备份文件再修复');
    }
    return {
        version: 1,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : []
    };
}

function getDb() {
    if (!db) db = readFromDisk();
    return db;
}

function pruneSessions(target) {
    const now = Date.now();
    Object.keys(target.sessions).forEach(token => {
        const sess = target.sessions[token];
        if (!sess || !sess.expiresAt || sess.expiresAt <= now) delete target.sessions[token];
    });
}

// 同步落盘：路由里改完 db 就调用它，返回即可对外响应
function save() {
    const target = getDb();
    pruneSessions(target);
    try {
        writeNow(target);
    } catch (err) {
        console.error('[store] 写入 data/db.json 失败:', err.message);
        throw err;
    }
}

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function findUserByName(name) {
    return getDb().users.find(u => u.name === name) || null;
}

function findUserById(id) {
    return getDb().users.find(u => u.id === id) || null;
}

function addUser(user) {
    getDb().users.push(user);
    return user;
}

function addAttempt(attempt) {
    getDb().attempts.push(attempt);
    return attempt;
}

module.exports = {
    DATA_DIR,
    DB_FILE,
    getDb,
    save,
    newId,
    findUserByName,
    findUserById,
    addUser,
    addAttempt
};
