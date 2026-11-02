
/**
 * Type definitions for the yoyofeeai application.
 */

export interface Env {
  /**
   * Cloudflare Workers AI binding.
   */
  AI: Ai;

  /**
   * Cloudflare D1 database binding.
   */
  DB: D1Database;

  /**
   * OpenAI API key - configure as a Cloudflare Worker secret.
   */
  OPENAI_API_KEY?: string;

  /**
   * DeepSeek API key - configure as a Cloudflare Worker secret.
   */
  DEEPSEEK_API_KEY?: string;

  /**
   * Doubao / Volcengine Ark API key - configure as a Cloudflare Worker secret.
   */
  ARK_API_KEY?: string;

  /**
   * Doubao model ID or endpoint ID.
   */
  DOUBAO_MODEL_ID?: string;

  /**
   * One-time administrator setup secret.
   */
  ADMIN_SETUP_SECRET?: string;

  /**
   * Binding for static assets.
   */
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
