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

    // Chat API
    if (path === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

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

      return handleChatRequest(request, env);
    }

    // Frontend assets
    if (path === "/" || !path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

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
