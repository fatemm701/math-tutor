// backend/server.js
const express = require('express');
const path = require('path');
const { generateQuestion, evaluateAnswer } = require('./core/mathEngine');

const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 格式的请求体
app.use(express.json());

// 托管前端静态文件 (把之前写的 html 放入 frontend 文件夹)
app.use(express.static(path.join(__dirname, '../frontend')));

// --- API 路由 ---

// 1. 获取题目接口
app.get('/api/question', (req, res) => {
    // 从 URL 参数中获取难度，默认为 1
    const level = parseInt(req.query.level) || 1;
    const qData = generateQuestion(level);

    // 注意：不要把 standard_answer 传给前端，防止学生通过浏览器审查元素作弊
    // 我们把标准答案暂时存在服务端 (后续可以用 session 或直接存入数据库)
    // 这里为了最快打通全链路，我们暂时把它一起发给前端(仅做联调测试)，或者让前端在提交时带上题面，后端重新计算标准答案
    res.json({
        success: true,
        data: {
            level: qData.level,
            question: qData.question,
            hint: qData.hint
        }
    });
});

// 2. 提交并判卷接口
app.post('/api/evaluate', (req, res) => {
    const { question, studentAnswer } = req.body;

    if (!question || !studentAnswer) {
        return res.status(400).json({ success: false, msg: '缺少参数' });
    }

    // 后端利用 mathjs 的 rationalize 动态计算当前题面的标准答案，杜绝前端作弊
    const { rationalize } = require('mathjs');
    const standardAnswer = rationalize(question).toString();

    // 调用核心判卷逻辑
    const result = evaluateAnswer(studentAnswer, standardAnswer);

    res.json({
        success: true,
        data: result // { status: 'correct'|'partial'|'wrong'|'error', msg: '...' }
    });
});

app.listen(PORT, () => {
    console.log(`[Poly-Drill] 服务器已启动: http://localhost:${PORT}`);
    console.log(`[Poly-Drill] 答题页: http://localhost:${PORT}/practice.html`);
});