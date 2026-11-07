// backend/server.js —— Express 服务入口：静态页面 + 账号/记录 API
// 计算全部在浏览器完成，这里不碰数学，只发页面、管登录、存记录
const express = require('express');
const path = require('path');
const os = require('os');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);                       // 放在 Nginx/Caddy 后面时能识别 HTTPS
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => {
    const db = store.getDb();
    res.json({ success: true, data: { ok: true, users: db.users.length, attempts: db.attempts.length } });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/attempts', require('./routes/attempts'));
app.use('/api/teacher', require('./routes/teacher'));

app.use('/api', (req, res) => {
    res.status(404).json({ success: false, msg: '接口不存在' });
});

// 统一错误响应：JSON 格式错误给 400，其它给 500
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ success: false, msg: '请求体不是合法 JSON' });
    }
    console.error('[Poly-Drill] 服务器错误:', err && err.message);
    res.status(500).json({ success: false, msg: '服务器内部错误' });
});

function localUrls(port) {
    const rows = [{ label: '本机', url: `http://localhost:${port}` }];
    const ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(name => {
        (ifaces[name] || []).forEach(net => {
            if (net.family !== 'IPv4' || net.internal) return;
            rows.push({
                label: /zerotier/i.test(name) ? 'ZeroTier' : '网卡',
                url: `http://${net.address}:${port}`,
                iface: name
            });
        });
    });
    return rows;
}

function start(port = PORT) {
    const server = app.listen(port, () => {
        const actual = server.address().port;
        let db = null;
        try { db = store.getDb(); } catch (err) { /* 数据损坏的提示在 getDb 里 */ }
        console.log('[Poly-Drill] 数据文件: ' + store.DB_FILE);
        localUrls(actual).forEach(r => {
            const label = r.iface ? r.label + '(' + r.iface + ')' : r.label;
            console.log('[Poly-Drill] ' + label + '  ' + r.url);
        });
        if (db) {
            console.log('[Poly-Drill] 账号 ' + db.users.length + ' 个 / 记录 ' + db.attempts.length + ' 条');
        }
    });
    return server;
}

if (require.main === module) {
    try {
        store.getDb();
    } catch (err) {
        console.error('[Poly-Drill] 启动失败：' + err.message);
        process.exit(1);
    }
    start();
}

module.exports = { app, start };
