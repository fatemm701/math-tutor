(function () {
    const root = document.getElementById("drill-app");
    if (!root) return;

    const topic = root.dataset.topic;
    const LEVEL_NAMES = { 1: "① 入门", 2: "② 基础", 3: "③ 进阶", 4: "④ 挑战" };

    const elPrompt = document.getElementById("question-prompt");
    const elBadgeLevel = document.getElementById("badge-level");
    const elBadgeFrac = document.getElementById("badge-frac");
    const elInput = document.getElementById("answer-input");
    const elSubmit = document.getElementById("btn-submit");
    const elHintBtn = document.getElementById("btn-hint");
    const elGiveUpBtn = document.getElementById("btn-giveup");
    const elNextBtn = document.getElementById("btn-next");
    const elHintBox = document.getElementById("hint-box");
    const elFeedback = document.getElementById("feedback-box");
    const elStepsCard = document.getElementById("steps-card");
    const elStepsList = document.getElementById("steps-list");
    const elYourRow = document.getElementById("your-answer-row");
    const elYourTex = document.getElementById("your-answer-tex");
    const elKeyboard = document.getElementById("soft-keyboard");

    let state = {
        level: 1,
        token: "",
        clientId: "",
        hint: "",
        usedHint: false,
        wrongCount: 0,
        locked: false,
        startedAt: 0,
    };

    function newClientId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function renderTex(el, tex, displayMode = false) {
        if (window.katex) {
            window.katex.render(tex, el, { displayMode, throwOnError: false });
        } else {
            el.textContent = tex;
        }
    }

    function setLocked(locked) {
        state.locked = locked;
        elInput.disabled = locked;
        elSubmit.disabled = locked;
        elGiveUpBtn.disabled = locked;
        elKeyboard.querySelectorAll("button").forEach((b) => { b.disabled = locked; });
    }

    function showFeedback(text, kind) {
        elFeedback.textContent = text;
        elFeedback.className = `feedback-box is-${kind}`;
        elFeedback.hidden = false;
    }

    function renderSteps(steps, studentTex, studentRaw) {
        elStepsList.innerHTML = "";
        if (studentTex || studentRaw) {
            elYourRow.hidden = false;
            if (studentTex) renderTex(elYourTex, studentTex, false);
            else elYourTex.textContent = studentRaw;
        } else {
            elYourRow.hidden = true;
        }

        steps.forEach((st, idx) => {
            const item = document.createElement("div");
            item.className = "step-item";

            const title = document.createElement("div");
            title.className = "step-title";
            title.textContent = `${idx + 1}. ${st.title}`;

            const formula = document.createElement("div");
            formula.className = "step-formula";
            renderTex(formula, st.tex, false);

            item.appendChild(title);
            item.appendChild(formula);

            if (st.note || st.noteTex) {
                const note = document.createElement("div");
                note.className = "step-note";
                if (st.noteTex) {
                    const texSpan = document.createElement("span");
                    renderTex(texSpan, st.noteTex, false);
                    note.appendChild(texSpan);
                    if (st.note) note.appendChild(document.createTextNode(" " + st.note));
                } else {
                    note.textContent = st.note;
                }
                item.appendChild(note);
            }
            elStepsList.appendChild(item);
        });
        elStepsCard.hidden = false;
    }

    async function loadNext() {
        elHintBox.hidden = true;
        elFeedback.hidden = true;
        elStepsCard.hidden = true;
        elInput.value = "";
        setLocked(false);

        const res = await fetch(`/api/drill/${topic}/next?level=${state.level}`);
        const json = await res.json();
        if (!json.success) {
            showFeedback(json.msg || "出题失败", "error");
            return;
        }
        const q = json.data;
        state.token = q.token;
        state.clientId = newClientId();
        state.hint = q.hint;
        state.usedHint = false;
        state.wrongCount = 0;
        state.startedAt = Date.now();

        elBadgeLevel.textContent = LEVEL_NAMES[q.level] || "";
        elBadgeFrac.hidden = !q.isFraction;
        renderTex(elPrompt, q.promptTex, true);
        elInput.focus();
    }

    async function handleSubmit() {
        if (state.locked) return;
        const val = elInput.value.trim();
        if (!val) {
            showFeedback("请先输入答案", "warn");
            return;
        }
        const nextAttempt = state.wrongCount + 1;
        const res = await fetch(`/api/drill/${topic}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: state.token,
                clientId: state.clientId,
                studentAnswer: val,
                usedHint: state.usedHint,
                attemptNum: nextAttempt,
                ms: Date.now() - state.startedAt,
            }),
        });
        const json = await res.json();
        if (!json.success) {
            showFeedback(json.msg || "提交失败", "error");
            return;
        }
        const d = json.data;
        if (d.isCorrect) {
            showFeedback(d.feedback, "ok");
            setLocked(true);
            renderSteps(d.steps || [], "", "");
            return;
        }

        if (d.result !== "error") {
            state.wrongCount += 1;
        }
        showFeedback(d.feedback, d.result === "error" ? "warn" : "error");
        if (d.locked) {
            setLocked(true);
            renderSteps(d.steps || [], d.studentTex, val);
        }
    }

    async function handleGiveUp() {
        if (state.locked) return;
        const res = await fetch(`/api/drill/${topic}/giveup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: state.token,
                clientId: state.clientId,
                studentAnswer: elInput.value.trim(),
                usedHint: state.usedHint,
                ms: Date.now() - state.startedAt,
            }),
        });
        const json = await res.json();
        if (!json.success) return;
        setLocked(true);
        showFeedback("已查看解析（本题计为未独立完成）", "warn");
        renderSteps(json.data.steps || [], "", elInput.value.trim());
    }

    // 难度切换
    document.querySelectorAll("#level-bar .level-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#level-bar .level-btn").forEach((b) => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            state.level = Number(btn.dataset.level);
            loadNext();
        });
    });

    // 软键盘输入
    elKeyboard.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn || state.locked) return;
        const ins = btn.dataset.ins;
        const act = btn.dataset.act;
        if (act === "clear") {
            elInput.value = "";
        } else if (act === "backspace") {
            elInput.value = elInput.value.slice(0, -1);
        } else if (ins) {
            elInput.value += ins;
        }
        elInput.focus();
    });

    elSubmit.addEventListener("click", handleSubmit);
    elInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSubmit();
    });
    elHintBtn.addEventListener("click", () => {
        state.usedHint = true;
        elHintBox.textContent = `提示：${state.hint}`;
        elHintBox.hidden = false;
    });
    elGiveUpBtn.addEventListener("click", handleGiveUp);
    elNextBtn.addEventListener("click", loadNext);

    loadNext();
})();