
/**
 * yoyofeeai - Worker entry
 */
import type { Env, ChatMessage } from "./types";
import { getCurrentUser, handleAuthRequest } from "./auth";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

type Provider = "cloudflare" | "openai" | "deepseek" | "doubao";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/auth/")) {
      return handleAuthRequest(request, env, path);
    }

    if (path.startsWith("/api/")) {
      const user = await getCurrentUser(request, env);

      if (!user) {
        return Response.json(
          { error: "请先登录" },
          { status: 401 },
        );
      }

      if (user.must_change_password) {
        return Response.json(
          { error: "请先修改初始密码" },
          { status: 403 },
        );
      }

      if (path === "/api/chat") {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }

        return handleChatRequest(request, env);
      }

      if (path === "/api/conversations") {
        if (request.method === "GET") {
          return listConversations(env, user.id);
        }

        if (request.method === "POST") {
          return createConversation(request, env, user.id);
        }

        return new Response("Method not allowed", { status: 405 });
      }

      const messagesMatch = path.match(
        /^\/api\/conversations\/([^/]+)\/messages$/,
      );

      if (messagesMatch) {
        const conversationId = messagesMatch[1];

        if (request.method === "GET") {
          return listMessages(env, user.id, conversationId);
        }

        if (request.method === "POST") {
          return saveMessage(request, env, user.id, conversationId);
        }

        return new Response("Method not allowed", { status: 405 });
      }

      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// List conversations belonging to the current user
async function listConversations(
  env: Env,
  userId: string,
): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, title, created_at, updated_at
     FROM conversations
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all();

  return Response.json({
    conversations: result.results,
  });
}

// Create a conversation
async function createConversation(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  const body = await request.json().catch(() => null) as {
    title?: unknown;
  } | null;

  let title = "新对话";

  if (typeof body?.title === "string" && body.title.trim()) {
    title = body.title.trim().slice(0, 80);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO conversations (id, user_id, title)
     VALUES (?, ?, ?)`,
  )
    .bind(id, userId, title)
    .run();

  return Response.json(
    { conversation: { id, title } },
    { status: 201 },
  );
}

// Read messages belonging to the current user
async function listMessages(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<Response> {
  const conversation = await env.DB.prepare(
    `SELECT id FROM conversations
     WHERE id = ? AND user_id = ?`,
  )
    .bind(conversationId, userId)
    .first();

  if (!conversation) {
    return Response.json(
      { error: "对话不存在或无权访问" },
      { status: 404 },
    );
  }

  const result = await env.DB.prepare(
    `SELECT id, role, content, created_at
     FROM messages
     WHERE conversation_id = ? AND user_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(conversationId, userId)
    .all();

  return Response.json({ messages: result.results });
}

// Save a message
async function saveMessage(
  request: Request,
  env: Env,
  userId: string,
  conversationId: string,
): Promise<Response> {
  const conversation = await env.DB.prepare(
    `SELECT id FROM conversations
     WHERE id = ? AND user_id = ?`,
  )
    .bind(conversationId, userId)
    .first();

  if (!conversation) {
    return Response.json(
      { error: "对话不存在或无权访问" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null) as {
    role?: unknown;
    content?: unknown;
  } | null;

  if (
    !body ||
    (body.role !== "user" && body.role !== "assistant") ||
    typeof body.content !== "string" ||
    !body.content.trim() ||
    body.content.length > 20000
  ) {
    return Response.json(
      { error: "消息格式错误或内容超出长度限制" },
      { status: 400 },
    );
  }

  const messageId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO messages
       (id, conversation_id, user_id, role, content)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      messageId,
      conversationId,
      userId,
      body.role,
      body.content,
    )
    .run();

  await env.DB.prepare(
    `UPDATE conversations
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(conversationId, userId)
    .run();

  return Response.json(
    {
      message: {
        id: messageId,
        role: body.role,
        content: body.content,
      },
    },
    { status: 201 },
  );
}

// AI chat request
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const body = await request.json().catch(() => null) as {
      messages?: ChatMessage[];
      provider?: string;
    } | null;

    if (!body || !Array.isArray(body.messages)) {
      return Response.json(
        { error: "消息格式错误" },
        { status: 400 },
      );
    }

    const allowedProviders: Provider[] = [
      "cloudflare",
      "openai",
      "deepseek",
      "doubao",
    ];

    const provider = (
      allowedProviders.includes(body.provider as Provider)
        ? body.provider
        : "cloudflare"
    ) as Provider;

    const messages = body.messages
      .filter((msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string" &&
        msg.content.length <= 20000
      )
      .slice(-40)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    if (messages.length === 0) {
      return Response.json(
        { error: "请先输入聊天内容" },
        { status: 400 },
      );
    }

    messages.unshift({
      role: "system",
      content: SYSTEM_PROMPT,
    });

    if (provider === "cloudflare") {
      return chatWithCloudflare(env, messages);
    }

    if (provider === "openai") {
      if (!env.OPENAI_API_KEY) {
        return missingKey("OpenAI");
      }

      return chatWithCompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        env.OPENAI_API_KEY,
        "gpt-4o-mini",
        messages,
      );
    }

    if (provider === "deepseek") {
      if (!env.DEEPSEEK_API_KEY) {
        return missingKey("DeepSeek");
      }

      return chatWithCompatibleAPI(
        "https://api.deepseek.com/chat/completions",
        env.DEEPSEEK_API_KEY,
        "deepseek-flash",
        messages,
      );
    }

    if (provider === "doubao") {
      if (!env.ARK_API_KEY) {
        return missingKey("豆包");
      }

      if (!env.DOUBAO_MODEL_ID) {
        return Response.json(
          { error: "尚未配置豆包模型 ID 或接入点 ID" },
          { status: 503 },
        );
      }

      return chatWithCompatibleAPI(
        "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        env.ARK_API_KEY,
        env.DOUBAO_MODEL_ID,
        messages,
      );
    }

    return Response.json(
      { error: "不支持的模型服务" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Chat request error:", error);

    return Response.json(
      { error: "AI 请求失败，请检查模型配置" },
      { status: 500 },
    );
  }
}

// Cloudflare Workers AI
async function chatWithCloudflare(
  env: Env,
  messages: ChatMessage[],
): Promise<Response> {
  const inputs = {
    messages,
    max_tokens: 1024,
    stream: true,
  } satisfies AiTextGenerationInput & { stream: true };

  const stream = await env.AI.run<typeof MODEL_ID>(
    MODEL_ID,
    inputs,
  );

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// OpenAI-compatible streaming API
async function chatWithCompatibleAPI(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<Response> {
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 1024,
    }),
  });

  if (!upstream.ok) {
    const errorText = await upstream.text();

    console.error(
      "Model API error:",
      upstream.status,
      errorText.slice(0, 1000),
    );

    return Response.json(
      {
        error: `模型服务请求失败，状态码：${upstream.status}`,
      },
      { status: 502 },
    );
  }

  if (!upstream.body) {
    return Response.json(
      { error: "模型服务没有返回数据流" },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// Missing API key response
function missingKey(provider: string): Response {
  return Response.json(
    {
      error: `${provider} 尚未配置 API Key，请联系管理员`,
    },
    { status: 503 },
  );
}
