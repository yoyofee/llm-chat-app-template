
import type { Env } from "./types";

const COOKIE = "yoyofeeai_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ITERATIONS = 100000;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64(s: string) {
  const v = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(v + "=".repeat((4 - v.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function sha256(value: string) {
  return b64(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value)
  )));
}

async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key, 256
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, count, saltText, expectedText] = stored.split("$");
  const iterations = Number(count);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) ||
      iterations < 100000 || iterations > 1000000 || !saltText || !expectedText) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltText), iterations },
    key, 256
  );
  const actual = new Uint8Array(bits);
  const expected = unb64(expectedText);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function getToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const item = cookie.split(";").map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="));
  return item ? decodeURIComponent(item.slice(COOKIE.length + 1)) : null;
}

function cookie(token: string, age = SESSION_SECONDS) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
}

async function createSession(env: Env, userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, await sha256(token), now + SESSION_SECONDS).run();
  return token;
}

export async function getCurrentUser(request: Request, env: Env) {
  const token = getToken(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.username, users.role,
     users.must_change_password, users.theme_color
     FROM sessions JOIN users ON users.id=sessions.user_id
     WHERE sessions.token_hash=? AND sessions.expires_at>?
     LIMIT 1`
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first<{
    id: string;
    username: string;
    role: "admin" | "member";
    must_change_password: number;
    theme_color: string;
  }>();
}

export async function handleAuthRequest(
  request: Request, env: Env, path: string
): Promise<Response> {
  if (request.method === "POST" && path === "/api/auth/bootstrap") {
    if (!env.ADMIN_SETUP_SECRET) return json({ error: "管理员初始化尚未配置" }, 503);
    let body: any;
    try { body = await request.json(); }
    catch { return json({ error: "请求格式错误" }, 400); }

    if (typeof body.setupSecret !== "string" ||
        body.setupSecret !== env.ADMIN_SETUP_SECRET) {
      return json({ error: "初始化密钥错误" }, 403);
    }
    if (typeof body.username !== "string" ||
        !/^[a-zA-Z0-9_-]{3,32}$/.test(body.username)) {
      return json({ error: "账号需为3-32位字母、数字、下划线或短横线" }, 400);
    }
    if (typeof body.password !== "string" ||
        body.password.length < 12 || body.password.length > 128) {
      return json({ error: "管理员密码需为12-128位" }, 400);
    }

    const hash = await passwordHash(body.password);
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT INTO users (id,username,password_hash,role,must_change_password)
       SELECT ?,?,?, 'admin',0 WHERE NOT EXISTS (SELECT 1 FROM users)`
    ).bind(id, body.username, hash).run();

    if ((result.meta.changes ?? 0) !== 1) {
      return json({ error: "管理员已经初始化，不能重复创建" }, 409);
    }
    const token = await createSession(env, id);
    return json({ ok: true }, 201, { "set-cookie": cookie(token) });
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    let body: any;
    try { body = await request.json(); }
    catch { return json({ error: "请求格式错误" }, 400); }

    if (typeof body.username !== "string" ||
        typeof body.password !== "string") {
      return json({ error: "请输入账号和密码" }, 400);
    }

    const user = await env.DB.prepare(
      `SELECT id,username,password_hash,role,
       must_change_password,theme_color FROM users
       WHERE username=? LIMIT 1`
    ).bind(body.username).first<{
      id: string;
      username: string;
      password_hash: string;
      role: "admin" | "member";
      must_change_password: number;
      theme_color: string;
    }>();

    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return json({ error: "账号或密码错误" }, 401);
    }

    const token = await createSession(env, user.id);
    return json({
      ok: true,
      user: {
        username: user.username,
        role: user.role,
        must_change_password: user.must_change_password,
        theme_color: user.theme_color
      }
    }, 200, { "set-cookie": cookie(token) });
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = getToken(request);
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await sha256(token)).run();
    }
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ user: null }, 401);
    return json({ user });
  }

  if (request.method === "POST" && path === "/api/auth/password") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "请先登录" }, 401);

    let body: any;
    try { body = await request.json(); }
    catch { return json({ error: "请求格式错误" }, 400); }

    if (typeof body.password !== "string" ||
        body.password.length < 10 || body.password.length > 128) {
      return json({ error: "新密码需为10-128位" }, 400);
    }

    await env.DB.prepare(
      "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?"
    ).bind(await passwordHash(body.password), user.id).run();

    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}
