import { LocalStorage, open } from "@raycast/api";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sessionFromCookies, type YuqueSession } from "./yuque";

const STORAGE_KEY = "yuque-session";

export async function loadSession(): Promise<YuqueSession | undefined> {
  const value = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as YuqueSession;
  } catch {
    await LocalStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

export async function saveSession(session: YuqueSession): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}

export async function connectFromBrowser(): Promise<YuqueSession> {
  const nonce = randomBytes(32).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Connection timed out")), 90_000);
    const server = createServer(async (request, response) => {
      if (!isLocal(request)) return reply(response, 403, "Forbidden");
      if (request.method === "GET" && request.url === "/connect") return replyHtml(response);
      if (request.method !== "POST" || request.url !== "/session") return reply(response, 404, "Not found");
      if (request.headers.origin && !isExtensionOrigin(request.headers.origin))
        return reply(response, 403, "Forbidden");
      try {
        const payload = JSON.parse(await readBody(request)) as {
          nonce?: string;
          cookies?: Array<{ name: string; value: string }>;
          error?: string;
          cookieNames?: string[];
        };
        if (payload.nonce !== nonce) return reply(response, 403, "Forbidden");
        if (payload.error) {
          const error = new Error(
            payload.error === "NO_SESSION_COOKIE"
              ? `浏览器中未找到语雀会话 已识别 ${payload.cookieNames?.join(" ") || "无"}`
              : "浏览器连接失败",
          );
          reply(response, 200, "Received", request.headers.origin);
          return finish(error);
        }
        if (!Array.isArray(payload.cookies)) return reply(response, 400, "Invalid request");
        const session = sessionFromCookies(payload.cookies);
        reply(response, 200, "Connected", request.headers.origin);
        finish(undefined, session);
      } catch (error) {
        reply(response, 400, error instanceof Error ? error.message : "Invalid request", request.headers.origin);
      }
    });

    function finish(error?: Error, session?: YuqueSession) {
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else if (session) resolve(session);
    }

    server.once("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") return finish(new Error("Could not start local connection"));
      try {
        await open(`http://127.0.0.1:${address.port}/connect#${nonce}`);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Could not open browser"));
      }
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 32_768) request.destroy(new Error("Request too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function isLocal(request: IncomingMessage): boolean {
  return request.socket.remoteAddress === "127.0.0.1" || request.socket.remoteAddress === "::ffff:127.0.0.1";
}

function isExtensionOrigin(origin?: string): origin is string {
  return Boolean(origin?.startsWith("chrome-extension://"));
}

function reply(response: ServerResponse, status: number, body: string, origin?: string) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "close",
    ...(origin && isExtensionOrigin(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  });
  response.end(body);
}

function replyHtml(response: ServerResponse) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>连接语雀</title><style>body{font:16px system-ui;max-width:560px;margin:15vh auto;padding:24px;line-height:1.6}h1{font-size:24px}</style><h1>连接语雀到 Raycast</h1><p>请点击浏览器工具栏中的 Yuque Local Bridge 图标</p><p>如果仍然等待 请在扩展管理页重新加载伴侣扩展后再试</p>`,
  );
}
