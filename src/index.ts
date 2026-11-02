/**
 * yoyofeeai - Worker entry
 */
import type { Env, ChatMessage } from "./types";
import { getCurrentUser, handleAuthRequest } from "./auth";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Authentication API
    if (path.startsWith("/api/auth/")) {
      return handleAuthRequest(request, env, path);
    }

    // All other API requests require login
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

      // AI chat API
      if (path === "/api/chat") {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }

        return handleChatRequest(request, env);
      }

      // List conversations
      if (path === "/api/conversations") {
        if (request.method === "GET") {
          return listConversations(env, user.id);
        }

        if (request.method === "POST") {
          return createConversation(request, env, user.id);
        }

        return new Response("Method not allowed", { status: 405 });
      }

      // Read or save messages in one conversation
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

    // Frontend assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Get the current user's conversations only
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

// Create a conversation for the logged-in user
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
    {
      conversation: {
        id,
        title,
      },
    },
    { status: 201 },
  );
}

// Get messages only when the conversation belongs to this user
async function listMessages(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<Response> {
  const conversation = await env.DB.prepare(
    `SELECT id
     FROM conversations
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

  return Response.json({
    messages: result.results,
  });
}

// Save a message to a conversation owned by the logged-in user
async function saveMessage(
  request: Request,
  env: Env,
  userId: string,
  conversationId: string,
): Promise<Response> {
  const conversation = await env.DB.prepare(
    `SELECT id
     FROM conversations
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

// Existing Cloudflare AI streaming chat
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const body = await request.json() as {
      messages?: ChatMessage[];
    };

    if (!Array.isArray(body.messages)) {
      return Response.json(
        { error: "消息格式错误" },
        { status: 400 },
      );
    }

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

    messages.unshift({
      role: "system",
      content: SYSTEM_PROMPT,
    });

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
  } catch (error) {
    console.error("Error processing chat request:", error);

    return Response.json(
      { error: "Failed to process request" },
      { status: 500 },
    );
  }
}
