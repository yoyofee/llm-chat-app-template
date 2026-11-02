/**
 * yoyofeeai frontend
 * Login, account session, theme and persistent AI chat.
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
const typingIndicator = $("typing-indicator");
const welcome = $("welcome");

let currentUser = null;
let chatHistory = [];
let currentConversationId = null;
let isProcessing = false;
let isLoadingHistory = false;

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

// 应用主题颜色
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

// 从数据库读取最近一次对话
async function loadLatestConversation() {
  currentConversationId = null;
  chatHistory = [];
  chatMessages.replaceChildren();
  welcome.classList.remove("hidden");

  const data = await api("/api/conversations");
  const conversations = data.conversations || [];

  if (conversations.length === 0) {
    return;
  }

  const latest = conversations[0];
  currentConversationId = latest.id;

  const messageData = await api(
    "/api/conversations/" +
    encodeURIComponent(currentConversationId) +
    "/messages"
  );

  const messages = messageData.messages || [];

  chatHistory = messages
    .filter((item) =>
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    )
    .map((item) => ({
      role: item.role,
      content: item.content
    }));

  for (const item of chatHistory) {
    addMessageToChat(item.role, item.content);
  }

  if (chatHistory.length > 0) {
    welcome.classList.add("hidden");
  }
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

  showView(chatView);

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

// 检查当前登录状态
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

// 显示管理员初始化表单
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

// 首次创建管理员
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
  chatMessages.replaceChildren();

  showView(loginView);
});

// 选择主题
$("theme-select").addEventListener("change", (event) => {
  applyTheme(event.target.value);
});

// 添加聊天消息
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
    // 创建对话并先保存用户消息
    await ensureConversation(message);
    await saveMessage("user", message);

    addMessageToChat("user", message);

    chatHistory.push({
      role: "user",
      content: message
    });

    // 请求 AI
    const response = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
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

    // 保存 AI 回复
    if (assistantText) {
      chatHistory.push({
        role: "assistant",
        content: assistantText
      });

      await saveMessage("assistant", assistantText);
    }
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

// 页面启动时检查登录状态
checkSession();
