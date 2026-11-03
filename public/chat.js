/**
 * yoyofeeai
 * 登录、聊天、历史记录、新建聊天和数据库持久化
 */

const $ = (id) => document.getElementById(id);

const loginView = $("login-view");
const passwordView = $("password-view");
const chatView = $("chat-view");

const loginForm = $("login-form");
const bootstrapForm = $("bootstrap-form");
const passwordForm = $("password-form");

const chatMessages = $("chat-messages");
const userInput = $("user-input");
const sendButton = $("send-button");
const modelSelect = $("model-select");
const typingIndicator = $("typing-indicator");
const welcome = $("welcome");
const historyList = $("history-list");

let currentUser = null;
let chatHistory = [];
let currentConversationId = null;
let isProcessing = false;
let isLoadingHistory = false;
let conversations = [];

// 页面切换
function showView(view) {
  loginView.classList.add("hidden");
  passwordView.classList.add("hidden");
  chatView.classList.add("hidden");
  view.classList.remove("hidden");
}

// API 请求
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "请求失败，请稍后重试");
  }

  return data;
}

// 界面模式：浅色 / 深色
function applyColorMode(mode) {
  const selectedMode = mode === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = selectedMode;
  $("mode-select").value = selectedMode;

  try {
    localStorage.setItem("yoyofeeai-mode", selectedMode);
  } catch (error) {
    console.warn("无法保存界面模式", error);
  }
}
// 强调颜色
function applyTheme(color) {
  const allowed = [
    "#10a37f",
    "#3b82f6",
    "#8b5cf6",
    "#f59e0b",
    "#ec4899"
  ];

  const selected = allowed.includes(color) ? color : "#10a37f";

  document.documentElement.style.setProperty("--accent", selected);
  $("theme-select").value = selected;

  try {
    localStorage.setItem("yoyofeeai-theme", selected);
  } catch (error) {
    console.warn("无法保存主题设置", error);
  }
}

// 清空聊天窗口
function clearChatWindow() {
  chatMessages.replaceChildren();
  chatHistory = [];
  welcome.classList.remove("hidden");
}

// 显示聊天消息
function addMessageToChat(role, content) {
  const message = document.createElement("div");
  message.className = `message ${role}-message`;

  const paragraph = document.createElement("p");
  paragraph.textContent = content;

  message.appendChild(paragraph);
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  welcome.classList.add("hidden");

  return paragraph;
}

// 加载左侧历史记录
async function loadConversationList() {
  const data = await api("/api/conversations");

  conversations = data.conversations || [];

  renderConversationList();
}

// 绘制左侧历史记录
function renderConversationList() {
  historyList.replaceChildren();

  if (conversations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebar-footer";
    empty.textContent = "暂无聊天记录";
    historyList.appendChild(empty);
    return;
  }

  conversations.forEach((conversation) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "history-item";

    if (conversation.id === currentConversationId) {
      button.classList.add("active");
    }

    button.textContent = conversation.title || "新对话";
    button.title = conversation.title || "新对话";

    button.addEventListener("click", () => {
      switchConversation(conversation.id);
    });

    historyList.appendChild(button);
  });
}

// 加载指定对话
async function loadConversation(conversationId) {
  const data = await api(
    "/api/conversations/" +
    encodeURIComponent(conversationId) +
    "/messages"
  );

  const messages = data.messages || [];

  clearChatWindow();

  currentConversationId = conversationId;

  chatHistory = messages
    .filter((item) =>
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    )
    .map((item) => ({
      role: item.role,
      content: item.content
    }));

  chatHistory.forEach((item) => {
    addMessageToChat(item.role, item.content);
  });

  renderConversationList();
}

// 切换历史对话
async function switchConversation(conversationId) {
  if (isProcessing || isLoadingHistory) {
    return;
  }

  isLoadingHistory = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  try {
    await loadConversation(conversationId);
  } catch (error) {
    alert("读取聊天记录失败：" + error.message);
  } finally {
    isLoadingHistory = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

// 新建聊天
function newChat() {
  if (isProcessing || isLoadingHistory) {
    return;
  }

  currentConversationId = null;
  clearChatWindow();
  renderConversationList();
  userInput.focus();
}

// 加载最近一次对话
async function loadLatestConversation() {
  await loadConversationList();

  if (conversations.length === 0) {
    newChat();
    return;
  }

  await loadConversation(conversations[0].id);
}

// 进入聊天页面
async function enterChat(user) {
  currentUser = user;
  $("account-label").textContent = user.username || "";

  const savedTheme = (() => {
    try {
      return localStorage.getItem("yoyofeeai-theme");
    } catch {
      return null;
    }
  })();

  applyTheme(user.theme_color || savedTheme || "#10a37f");
  let savedMode = "dark";
  try {
    savedMode = localStorage.getItem("yoyofeeai-mode") || "dark";
  } catch (error) {
    console.warn("无法读取界面模式", error);
  }
  applyColorMode(savedMode);
  showView(chatView);
  updateMoneyAnimation();
  isLoadingHistory = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  try {
    await loadLatestConversation();
  } catch (error) {
    console.error("读取聊天记录失败", error);
    addMessageToChat(
      "assistant",
      "暂时无法读取历史聊天记录：" + error.message
    );
  } finally {
    isLoadingHistory = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

// 检查登录状态
async function checkSession() {
  try {
    const data = await api("/api/auth/me");
    const user = data.user;

    if (!user) {
      showView(loginView);
      return;
    }

    if (user.must_change_password) {
      currentUser = user;
      showView(passwordView);
      return;
    }

    await enterChat(user);
  } catch (error) {
    showView(loginView);
  }
}

// 登录
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = $("login-error");
  const button = $("login-button");

  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "正在登录……";

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("login-username").value.trim(),
        password: $("login-password").value
      })
    });

    $("login-password").value = "";

    if (data.user.must_change_password) {
      currentUser = data.user;
      showView(passwordView);
    } else {
      await enterChat(data.user);
    }
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "登录 yoyofeeai";
  }
});

// 管理员初始化
$("show-bootstrap").addEventListener("click", () => {
  loginForm.classList.add("hidden");
  $("show-bootstrap").classList.add("hidden");
  bootstrapForm.classList.remove("hidden");
});

// 返回登录
$("back-to-login").addEventListener("click", () => {
  bootstrapForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  $("show-bootstrap").classList.remove("hidden");
});

// 创建管理员
bootstrapForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = $("bootstrap-error");
  const button = bootstrapForm.querySelector("button[type='submit']");

  errorBox.textContent = "";
  button.disabled = true;

  try {
    await api("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: $("setup-secret").value,
        username: $("admin-username").value.trim(),
        password: $("admin-password").value
      })
    });

    $("setup-secret").value = "";
    $("admin-password").value = "";

    await checkSession();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// 修改初始密码
passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = $("password-error");
  const button = passwordForm.querySelector("button[type='submit']");

  errorBox.textContent = "";
  button.disabled = true;

  try {
    await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        password: $("new-password").value
      })
    });

    $("new-password").value = "";

    await checkSession();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// 退出登录
$("logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    console.error(error);
  }

  currentUser = null;
  currentConversationId = null;
  chatHistory = [];
  conversations = [];

  clearChatWindow();
  historyList.replaceChildren();

  showView(loginView);
});

// 选择主题
$("theme-select").addEventListener("change", (event) => {
  applyTheme(event.target.value);
});
$("mode-select").addEventListener("change", (event) => {
  applyColorMode(event.target.value);
});
// 新建聊天按钮
$("new-chat-button").addEventListener("click", newChat);

// 输入框自动调整高度
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height =
    Math.min(userInput.scrollHeight, 180) + "px";
});

// Enter 发送，Shift+Enter 换行
userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

// 确保当前有一个数据库对话
async function ensureConversation(firstMessage) {
  if (currentConversationId) {
    return currentConversationId;
  }

  const data = await api("/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      title: firstMessage.slice(0, 80) || "新对话"
    })
  });

  currentConversationId = data.conversation.id;

  await loadConversationList();

  return currentConversationId;
}

// 保存消息到数据库
async function saveMessage(role, content) {
  if (!currentConversationId) {
    throw new Error("当前对话尚未创建");
  }

  return api(
    "/api/conversations/" +
    encodeURIComponent(currentConversationId) +
    "/messages",
    {
      method: "POST",
      body: JSON.stringify({
        role,
        content
      })
    }
  );
}

// 发送聊天消息
async function sendMessage() {
  const message = userInput.value.trim();

  if (
    !message ||
    isProcessing ||
    isLoadingHistory ||
    !currentUser
  ) {
    return;
  }

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  userInput.value = "";
  userInput.style.height = "auto";

  typingIndicator.classList.add("visible");

  let assistantText = "";

  try {
    await ensureConversation(message);
    await saveMessage("user", message);

    addMessageToChat("user", message);

    chatHistory.push({
      role: "user",
      content: message
    });

    const response = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: modelSelect.value,
        messages: chatHistory
      })
    });

    if (response.status === 401) {
      currentUser = null;
      showView(loginView);
      throw new Error("登录状态已失效，请重新登录");
    }

    if (response.status === 403) {
      await checkSession();
      throw new Error("请先完成密码修改");
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "AI 请求失败");
    }

    if (!response.body) {
      throw new Error("服务器没有返回内容");
    }

    const assistantElement = addMessageToChat(
      "assistant",
      ""
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function processEvent(eventText) {
      const lines = eventText.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        if (!data || data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          let content = "";

          if (typeof json.response === "string") {
            content = json.response;
          } else if (
            json.choices &&
            json.choices[0] &&
            json.choices[0].delta
          ) {
            content = json.choices[0].delta.content || "";
          }

          if (content) {
            assistantText += content;
            assistantElement.textContent = assistantText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch (error) {
          console.warn("解析 AI 回复失败", error);
        }
      }
    }

    while (true) {
      const result = await reader.read();

      if (result.done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(result.value, {
        stream: true
      });

      buffer = buffer.replace(/\r\n/g, "\n");

      let index;

      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const eventText = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        processEvent(eventText);
      }
    }

    if (buffer.trim()) {
      processEvent(buffer);
    }

    if (assistantText) {
      chatHistory.push({
        role: "assistant",
        content: assistantText
      });

      await saveMessage("assistant", assistantText);
    }

    await loadConversationList();

  } catch (error) {
    console.error(error);

    addMessageToChat(
      "assistant",
      "请求遇到问题：" + error.message
    );
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

// 页面启动

// ================================
// 手机端历史记录抽屉
// ================================

const mobileMenuButton = $("mobile-menu-button");
const sidebarOverlay = $("sidebar-overlay");
const sidebar = document.querySelector(".sidebar");

function openHistoryDrawer() {
  if (!sidebar || !sidebarOverlay) return;

  sidebar.classList.add("open");
  sidebarOverlay.classList.add("visible");
}

function closeHistoryDrawer() {
  if (!sidebar || !sidebarOverlay) return;

  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("visible");
}

if (mobileMenuButton) {
  mobileMenuButton.addEventListener("click", openHistoryDrawer);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeHistoryDrawer);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeHistoryDrawer();
  }
});

// 选择历史对话后关闭手机抽屉
const originalSwitchConversation = switchConversation;

switchConversation = async function (conversationId) {
  closeHistoryDrawer();
  return originalSwitchConversation(conversationId);
};

// 新建聊天后关闭手机抽屉
const originalNewChat = newChat;

newChat = function () {
  originalNewChat();
  closeHistoryDrawer();
};

// ================================
// 电脑端人民币动画
// ================================

const moneyStage = $("money-stage");
const moneyToggle = $("money-toggle");
const moneyDensity = $("money-density");

let moneyPaused = false;
let moneyTimer = null;
let moneyItems = [];

const moneyLimits = {
  low: 3,
  normal: 7,
  high: 12
};

function getMoneyDensity() {
  try {
    return localStorage.getItem("yoyofeeai-money-density") || "normal";
  } catch {
    return "normal";
  }
}

function saveMoneyDensity(value) {
  try {
    localStorage.setItem("yoyofeeai-money-density", value);
  } catch (error) {
    console.warn("无法保存动画设置", error);
  }
}

function createMoneyItem() {
  if (!moneyStage || moneyPaused) return;

  const limit = moneyLimits[moneyDensity?.value] || 7;

  if (moneyItems.length >= limit) return;

  const item = document.createElement("div");
  const isCoin = Math.random() > 0.5;

  item.className = "money-item";

  if (isCoin) {
    item.classList.add("money-coin");
    item.textContent = "🪙";
  } else {
    item.classList.add("money-bill");
    item.textContent = "¥";
  }

  item.style.left = Math.random() * 85 + "%";
  item.style.animationDuration = (5 + Math.random() * 5) + "s";

  moneyStage.appendChild(item);
  moneyItems.push(item);

  item.addEventListener("animationend", () => {
    item.remove();
    moneyItems = moneyItems.filter((entry) => entry !== item);
  }, { once: true });
}

function startMoneyAnimation() {
  if (!moneyStage || moneyTimer || moneyPaused) return;

  moneyTimer = setInterval(() => {
    if (document.hidden) return;
    if (window.matchMedia("(max-width: 700px)").matches) return;
    createMoneyItem();
  }, 850);
}

function stopMoneyAnimation() {
  if (moneyTimer) {
    clearInterval(moneyTimer);
    moneyTimer = null;
  }
}

function updateMoneyAnimation() {
  if (!moneyStage) return;

  if (moneyPaused || document.hidden ||
      window.matchMedia("(max-width: 700px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    stopMoneyAnimation();
    return;
  }

  startMoneyAnimation();
}

if (moneyDensity) {
  moneyDensity.value = getMoneyDensity();

  moneyDensity.addEventListener("change", () => {
    saveMoneyDensity(moneyDensity.value);
    moneyItems.forEach((item) => item.remove());
    moneyItems = [];
  });
}

if (moneyToggle) {
  moneyToggle.addEventListener("click", () => {
    moneyPaused = !moneyPaused;

    moneyToggle.textContent = moneyPaused ? "继续动画" : "暂停动画";

    if (moneyPaused) {
      stopMoneyAnimation();
      moneyItems.forEach((item) => item.remove());
      moneyItems = [];
    } else {
      updateMoneyAnimation();
    }
  });
}

document.addEventListener("visibilitychange", updateMoneyAnimation);
window.addEventListener("resize", updateMoneyAnimation);
checkSession();
