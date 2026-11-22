(function () {
    const root = document.getElementById("drill-app");
    if (!root) return;

    const topic = root.dataset.topic;
    const LEVEL_NAMES = { 1: "① 入门", 2: "② 基础", 3: "③ 进阶", 4: "④ 挑战" };

    // 触屏（手机 / 平板）上不主动聚焦输入框：脚本 focus() 会唤出系统键盘，
    // 而页面已经提供软键盘。桌面端保持原有的自动聚焦体验。
    const finePointer = window.matchMedia("(pointer: fine)");
    const LONG_PRESS_MS = 500;

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
        cursor: 0,
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
        state.cursor = 0;
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
        if (finePointer.matches) elInput.focus();
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

    // ---- 软键盘输入 ----
    // 触屏上输入框永远不获得焦点（避免系统键盘），所以自己维护光标位置：
    // 有焦点（桌面 / 长按唤出系统键盘）时沿用原生 selection，否则用 state.cursor。
    function selection() {
        if (document.activeElement === elInput) {
            const head = elInput.selectionStart ?? elInput.value.length;
            const tail = elInput.selectionEnd ?? head;
            return [Math.min(head, tail), Math.max(head, tail)];
        }
        const pos = Math.min(state.cursor ?? elInput.value.length, elInput.value.length);
        return [pos, pos];
    }

    function writeInput(nextValue, cursor) {
        elInput.value = nextValue;
        state.cursor = cursor;
        // 仅在输入框仍有焦点时回写原生光标；聚焦状态下 setSelectionRange 不会弹出键盘
        if (document.activeElement === elInput) {
            elInput.setSelectionRange(cursor, cursor);
        }
    }

    function insertText(text) {
        const [start, end] = selection();
        const value = elInput.value;
        writeInput(value.slice(0, start) + text + value.slice(end), start + text.length);
    }

    function backspace() {
        let [start, end] = selection();
        if (start === end && start > 0) start -= 1;
        const value = elInput.value;
        writeInput(value.slice(0, start) + value.slice(end), start);
    }

    function clearInput() {
        writeInput("", 0);
    }

    function flashKey(btn) {
        btn.classList.add("is-pressed");
        setTimeout(() => btn.classList.remove("is-pressed"), 80);
    }

    elKeyboard.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn || state.locked || btn.disabled) return;
        flashKey(btn);
        const ins = btn.dataset.ins;
        const act = btn.dataset.act;
        if (act === "clear") {
            clearInput();
        } else if (act === "backspace") {
            backspace();
        } else if (ins) {
            insertText(ins);
        }
    });

    // 手写 / 粘贴 / 长按系统键盘输入时，光标跟随原生位置
    elInput.addEventListener("input", () => {
        state.cursor = elInput.selectionStart ?? elInput.value.length;
    });
    elInput.addEventListener("focus", () => {
        state.cursor = elInput.selectionStart ?? elInput.value.length;
    });

    // 触屏：单击输入框不弹系统键盘，长按（≥500ms）才放行，用原生输入法输入
    if (!finePointer.matches) {
        let pressTimer = 0;
        let longPressing = false;

        const cancelPress = () => {
            clearTimeout(pressTimer);
            pressTimer = 0;
            if (!longPressing) elInput.readOnly = true;
        };

        const beginPress = () => {
            longPressing = false;
            // 只读 + 不聚焦：单击、系统键盘都不会弹出
            elInput.readOnly = true;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => {
                longPressing = true;
                elInput.readOnly = false;
                elInput.focus(); // 长按才唤出系统键盘
            }, LONG_PRESS_MS);
        };

        elInput.addEventListener("touchstart", beginPress, { passive: true });

        // Android 单击也会派发 mousedown：非长按时阻止默认聚焦
        elInput.addEventListener("mousedown", (e) => {
            if (!longPressing) e.preventDefault();
        });

        elInput.addEventListener("touchend", () => {
            clearTimeout(pressTimer);
            // 长按结束后保持可编辑，直到下一次点击前重新置为只读
            longPressing = false;
        });
        elInput.addEventListener("touchcancel", cancelPress);

        elInput.readOnly = true; // 初始即以软键盘为主
    }

    elSubmit.addEventListener("click", handleSubmit);
    elInput.addEventListener("keydown", (e) => {
        // 触屏上没焦点时 Enter 来自输入法「完成」键：提交后可继续做下一题
        if (e.key === "Enter") handleSubmit();
    });

    // 触屏点页面空白处收起系统键盘；
    // 点软键盘按钮时不收起，这样长按唤出的键盘可以继续用于输入
    document.addEventListener("pointerdown", (e) => {
        if (finePointer.matches) return;
        if (!elKeyboard.contains(e.target)) elInput.blur();
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