
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
   * One-time administrator setup secret.
   * Configure this in Cloudflare as a Worker secret.
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
