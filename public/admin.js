(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  };

  const style = document.createElement("style");
  style.textContent = `
    #family-admin-button { display:none; }
    #family-admin-layer { position:fixed; inset:0; z-index:1000; background:var(--bg); color:var(--text); overflow:auto; padding:24px; }
    .fa-wrap { max-width:1000px; margin:0 auto; }
    .fa-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:22px; }
    .fa-card { background:var(--panel2); border:1px solid var(--border); border-radius:14px; padding:18px; margin:14px 0; }
    .fa-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; }
    .fa-field label { display:block; color:var(--muted); font-size:13px; margin-bottom:6px; }
    .fa-field input { width:100%; padding:11px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); }
    .fa-btn { border:1px solid var(--border); border-radius:8px; padding:9px 13px; background:var(--panel); color:var(--text); margin:3px; }
    .fa-primary { background:var(--accent); color:white; border-color:var(--accent); }
    .fa-table { width:100%; border-collapse:collapse; }
    .fa-table th,.fa-table td { text-align:left; padding:11px 8px; border-bottom:1px solid var(--border); font-size:14px; }
    .fa-muted { color:var(--muted); font-size:13px; }
    .fa-status-off { color:#e28b8b; }
    .fa-error { color:#e28b8b; min-height:20px; margin-top:8px; }
    @media(max-width:600px) { #family-admin-layer { padding:14px; } .fa-table th:nth-child(3),.fa-table td:nth-child(3) { display:none; } }
  `;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.id = "family-admin-button";
  button.type = "button";
  button.className = "small-button";
  button.textContent = "家庭管理";
  const topActions = document.querySelector(".top-actions");
  if (topActions) topActions.insertBefore(button, topActions.firstChild);

  const layer = document.createElement("section");
  layer.id = "family-admin-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="fa-wrap">
      <div class="fa-head">
        <div><h1 style="margin:0 0 6px">家庭成员管理</h1><div class="fa-muted">仅管理员可见。成员账号由管理员创建。</div></div>
        <button class="fa-btn" id="fa-close" type="button">返回聊天</button>
      </div>
      <div class="fa-card">
        <h2 style="margin-top:0">创建家庭成员账号</h2>
        <form id="fa-create-form">
          <div class="fa-grid">
            <div class="fa-field"><label for="fa-username">成员账号（3-32位）</label><input id="fa-username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" autocomplete="off"></div>
            <div class="fa-field"><label for="fa-password">初始密码（至少10位）</label><input id="fa-password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></div>
          </div>
          <button class="fa-btn fa-primary" type="submit">创建账号</button>
          <div class="fa-error" id="fa-create-error" role="status"></div>
        </form>
        <p class="fa-muted">成员首次登录后必须修改初始密码。请通过安全方式把账号和初始密码告知成员。</p>
      </div>
      <div class="fa-card">
        <div class="fa-head"><h2 style="margin:0">账号列表</h2><button class="fa-btn" id="fa-refresh" type="button">刷新列表</button></div>
        <div id="fa-list"><p class="fa-muted">正在加载……</p></div>
        <div class="fa-error" id="fa-list-error" role="status"></div>
      </div>
    </div>`;
  document.body.appendChild(layer);

  const showError = (id, message) => { $(id).textContent = message || ""; };

  async function loadUsers() {
    showError("fa-list-error", "");
    $("fa-list").textContent = "正在加载……";
    try {
      const data = await api("/api/auth/admin/users");
      renderUsers(data.users || []);
    } catch (error) {
      $("fa-list").textContent = "";
      showError("fa-list-error", error.message);
    }
  }

  function renderUsers(users) {
    const host = $("fa-list");
    host.replaceChildren();
    if (!users.length) {
      host.textContent = "暂无账号";
      return;
    }

    const table = document.createElement("table");
    table.className = "fa-table";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>账号</th><th>角色</th><th>创建时间</th><th>状态</th><th>操作</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    users.forEach((user) => {
      const tr = document.createElement("tr");
      const username = document.createElement("td");
      username.textContent = user.username;
      const role = document.createElement("td");
      role.textContent = user.role === "admin" ? "管理员" : "家庭成员";
      const created = document.createElement("td");
      created.textContent = user.created_at || "-";
      const status = document.createElement("td");
      status.textContent = user.disabled_at ? "已停用" : (user.must_change_password ? "待修改初始密码" : "正常");
      if (user.disabled_at) status.className = "fa-status-off";
      const actions = document.createElement("td");

      if (user.role === "member") {
        const passwordBtn = document.createElement("button");
        passwordBtn.className = "fa-btn";
        passwordBtn.type = "button";
        passwordBtn.textContent = "重置密码";
        passwordBtn.addEventListener("click", () => resetPassword(user));
        actions.appendChild(passwordBtn);

        const statusBtn = document.createElement("button");
        statusBtn.className = "fa-btn";
        statusBtn.type = "button";
        statusBtn.textContent = user.disabled_at ? "恢复账号" : "停用账号";
        statusBtn.addEventListener("click", () => changeStatus(user));
        actions.appendChild(statusBtn);
      } else {
        actions.textContent = "当前管理员";
      }

      [username, role, created, status, actions].forEach((cell) => tr.appendChild(cell));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    host.appendChild(table);
  }

  async function resetPassword(user) {
    const password = window.prompt(`请输入「${user.username}」的新初始密码（至少10位）：`);
    if (password === null) return;
    if (password.length < 10 || password.length > 128) {
      window.alert("密码长度必须为10-128位。");
      return;
    }
    try {
      await api(`/api/auth/admin/users/${encodeURIComponent(user.id)}/password`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      window.alert("密码已重置。该成员下次登录时必须修改密码。");
      await loadUsers();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function changeStatus(user) {
    const disabling = !user.disabled_at;
    const message = disabling
      ? `确定停用成员「${user.username}」吗？停用后将无法登录，当前登录会话也会失效。`
      : `确定恢复成员「${user.username}」的账号吗？`;
    if (!window.confirm(message)) return;
    try {
      await api(`/api/auth/admin/users/${encodeURIComponent(user.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: disabling })
      });
      await loadUsers();
    } catch (error) {
      window.alert(error.message);
    }
  }

  button.addEventListener("click", async () => {
    if (!window.yoyofeeaiCurrentUser || window.yoyofeeaiCurrentUser.role !== "admin") return;
    layer.hidden = false;
    await loadUsers();
  });
  $("fa-close").addEventListener("click", () => { layer.hidden = true; });
  $("fa-refresh").addEventListener("click", loadUsers);

  $("fa-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("fa-create-error", "");
    const submit = $("fa-create-form").querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await api("/api/auth/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("fa-username").value.trim(),
          password: $("fa-password").value
        })
      });
      $("fa-create-form").reset();
      showError("fa-create-error", "账号创建成功。请安全保存初始密码并交给成员。");
      await loadUsers();
    } catch (error) {
      showError("fa-create-error", error.message);
    } finally {
      submit.disabled = false;
    }
  });

  function syncSession() {
    api("/api/auth/me").then((data) => {
      const user = data.user || null;
      window.yoyofeeaiCurrentUser = user;
      button.style.display = user && user.role === "admin" && !user.must_change_password ? "" : "none";
      if (!user || user.role !== "admin") layer.hidden = true;
    }).catch(() => {
      window.yoyofeeaiCurrentUser = null;
      button.style.display = "none";
      layer.hidden = true;
    });
  }

  // 登录/退出会改变聊天主界面的 hidden class；监听它以同步管理员入口。
  const chatView = document.getElementById("chat-view");
  if (chatView && window.MutationObserver) {
    new MutationObserver(syncSession).observe(chatView, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }
  syncSession();
})();
