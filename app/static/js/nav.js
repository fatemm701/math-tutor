(function () {
    const sidebar = document.getElementById("sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle");
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const backdrop = document.getElementById("nav-backdrop");
    const practiceGroup = document.getElementById("nav-group-practice");
    const practiceToggle = document.getElementById("practice-group-toggle");
    const themeBtn = document.getElementById("theme-toggle");
    const logoutBtn = document.getElementById("logout-btn");

    const isNarrow = () => window.matchMedia("(max-width: 768px)").matches;
    const storeGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { } };

    // 恢复宽屏收起状态与分组状态
    if (sidebar && storeGet("pd_nav_collapsed") === "1") {
        sidebar.classList.add("is-collapsed");
    }
    if (practiceGroup && storeGet("pd_nav_group_practice") === "0") {
        practiceGroup.classList.add("is-closed");
        practiceToggle?.setAttribute("aria-expanded", "false");
    }

    function closeDrawer() {
        sidebar?.classList.remove("is-drawer-open");
        backdrop?.classList.remove("is-open");
    }

    toggleBtn?.addEventListener("click", () => {
        if (isNarrow()) {
            closeDrawer();
            return;
        }
        const collapsed = sidebar.classList.toggle("is-collapsed");
        storeSet("pd_nav_collapsed", collapsed ? "1" : "0");
    });

    mobileBtn?.addEventListener("click", () => {
        sidebar?.classList.add("is-drawer-open");
        backdrop?.classList.add("is-open");
    });

    backdrop?.addEventListener("click", closeDrawer);
    sidebar?.querySelectorAll("a.nav-item").forEach((a) => {
        a.addEventListener("click", () => { if (isNarrow()) closeDrawer(); });
    });

    practiceToggle?.addEventListener("click", () => {
        const closed = practiceGroup.classList.toggle("is-closed");
        practiceToggle.setAttribute("aria-expanded", closed ? "false" : "true");
        storeSet("pd_nav_group_practice", closed ? "0" : "1");
    });

    themeBtn?.addEventListener("click", () => {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) {
            document.documentElement.removeAttribute("data-theme");
            storeSet("pd_theme", "light");
        } else {
            document.documentElement.setAttribute("data-theme", "dark");
            storeSet("pd_theme", "dark");
        }
    });

    logoutBtn?.addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
    });
})();