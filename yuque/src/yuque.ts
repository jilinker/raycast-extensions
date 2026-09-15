export const YUQUE_ORIGIN = "https://www.yuque.com";

export type SearchScope = "related" | "public";

export type YuqueSession = {
  cookie: string;
  csrfToken?: string;
  login?: string;
  savedAt: number;
};

export type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  summary?: string;
  url: string;
};

export type SearchPage = {
  items: SearchItem[];
  total?: number;
};

type UnknownRecord = Record<string, unknown>;

export class SessionExpiredError extends Error {}

export function buildWebSearchUrl(query: string, scope: SearchScope): string {
  const url = new URL("/search", YUQUE_ORIGIN);
  url.search = new URLSearchParams({
    q: query,
    type: "content",
    scope: "/",
    tab: scope,
    p: "1",
    sence: "searchPage",
  }).toString();
  return url.toString();
}

export async function searchYuque(
  query: string,
  scope: SearchScope,
  page: number,
  session?: YuqueSession,
  signal?: AbortSignal,
): Promise<SearchPage> {
  const url = new URL("/api/zsearch", YUQUE_ORIGIN);
  url.search = new URLSearchParams({
    q: query,
    type: "content",
    scope: "/",
    tab: scope,
    p: String(page),
    sence: "searchPage",
  }).toString();

  const headers: Record<string, string> = {
    accept: "application/json",
    "x-requested-with": "XMLHttpRequest",
    referer: buildWebSearchUrl(query, scope),
  };
  if (session) {
    headers.cookie = session.cookie;
    if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;
    if (session.login) headers["x-login"] = session.login;
  }

  const response = await fetch(url, { headers, signal });
  if (response.status === 401 || response.status === 403) throw new SessionExpiredError("Yuque session expired");
  if (!response.ok) throw new Error(`Yuque search failed with ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new SessionExpiredError("Yuque returned an unexpected response");
  }

  return parseSearchResponse(await response.json());
}

export function parseSearchResponse(value: unknown): SearchPage {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  const items = hits.map(toSearchItem).filter((item): item is SearchItem => item !== undefined);
  const total = asNumber(data?.totalHits) ?? asNumber(data?.total);
  return { items, total };
}

export function parseSessionInput(input: string): YuqueSession {
  const headers = parseHeaders(input);
  const rawCookie = headers.cookie;
  if (!rawCookie) throw new Error("No Cookie header found");

  const cookies = Object.fromEntries(
    rawCookie
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s))
      .filter(([name, value]) => name && value !== undefined),
  );
  const allowed = ["_yuque_session", "yuque_ctoken", "_c_WBKFRo", "acw_tc", "aliyungf_tc"];
  const cookie = allowed
    .filter((name) => cookies[name])
    .map((name) => `${name}=${cookies[name]}`)
    .join("; ");
  if (!cookies._yuque_session) throw new Error("No Yuque session cookie found");

  return {
    cookie,
    csrfToken: headers["x-csrf-token"] || cookies.yuque_ctoken,
    login: headers["x-login"],
    savedAt: Date.now(),
  };
}

export function sessionFromCookies(cookies: Array<{ name: string; value: string }>): YuqueSession {
  const allowed = new Set(["_yuque_session", "yuque_ctoken", "_c_WBKFRo", "acw_tc", "aliyungf_tc"]);
  const selected = cookies.filter((cookie) => allowed.has(cookie.name));
  if (!selected.some((cookie) => cookie.name === "_yuque_session")) throw new Error("No Yuque session cookie found");
  return {
    cookie: selected.map(({ name, value }) => `${name}=${value}`).join("; "),
    csrfToken: selected.find((cookie) => cookie.name === "yuque_ctoken")?.value,
    savedAt: Date.now(),
  };
}

function parseHeaders(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const object = extractHeadersObject(input);
  if (object) {
    for (const [name, value] of Object.entries(object)) headers[name.toLowerCase()] = String(value);
  }

  for (const match of input.matchAll(/(?:-H|--header)\s+(["'])(.*?)\1/gs)) {
    const separator = match[2].indexOf(":");
    if (separator > 0)
      headers[match[2].slice(0, separator).trim().toLowerCase()] = match[2].slice(separator + 1).trim();
  }
  return headers;
}

function extractHeadersObject(input: string): UnknownRecord | undefined {
  const match = /["']headers["']\s*:\s*\{/.exec(input);
  if (!match) return undefined;
  const start = input.indexOf("{", match.index);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < input.length; index++) {
    const character = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(input.slice(start, index + 1)) as UnknownRecord;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function toSearchItem(value: unknown, index: number): SearchItem | undefined {
  const hit = asRecord(value);
  if (!hit) return undefined;
  const target = asRecord(hit.target) ?? hit;
  const book = asRecord(target.book) ?? asRecord(hit.book);
  const user = asRecord(target.user) ?? asRecord(hit.user) ?? asRecord(book?.user);
  const title = cleanText(asString(hit.title) ?? asString(target.title));
  const summary = formatSummary(findSummary(hit, target));
  const url = resolveUrl(hit, target, book);
  if (!title || !url) return undefined;
  const bookTitle = cleanText(asString(book?.title));
  const author = cleanText(asString(user?.name) ?? asString(user?.login));
  return {
    id: String(hit.id ?? target.id ?? url ?? index),
    title,
    subtitle: [bookTitle, author].filter(Boolean).join(" · ") || undefined,
    summary: summary || undefined,
    url,
  };
}

function resolveUrl(hit: UnknownRecord, target: UnknownRecord, book?: UnknownRecord): string | undefined {
  const direct = asString(hit.url) ?? asString(target.url);
  if (direct) {
    try {
      const url = new URL(direct, YUQUE_ORIGIN);
      return url.origin === YUQUE_ORIGIN ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  const namespace = asString(book?.namespace) ?? asString(target.namespace) ?? asString(hit.namespace);
  const slug = asString(target.slug) ?? asString(hit.slug);
  return namespace && slug
    ? `${YUQUE_ORIGIN}/${namespace.replace(/^\/+|\/+$/g, "")}/${slug.replace(/^\//, "")}`
    : undefined;
}

function cleanText(value?: string): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSummary(value?: string): string {
  return cleanText(value?.replace(/<em[^>]*>/gi, "\u0000").replace(/<\/em>/gi, "\u0001"))
    .replace(/[\\`*_[\]{}()#+\-.!>|]/g, "\\$&")
    .replaceAll("\u0000", "**")
    .replaceAll("\u0001", "**");
}

function findSummary(hit: UnknownRecord, target: UnknownRecord): string | undefined {
  const fields = [
    "summary",
    "snippet",
    "content",
    "highlight",
    "highlights",
    "highlight_body",
    "abstract",
    "description",
  ];
  for (const source of [hit, target]) {
    for (const field of fields) {
      const value = firstString(source[field]);
      if (value) return value;
    }
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstString(item);
      if (result) return result;
    }
  }
  const record = asRecord(value);
  if (record) {
    for (const item of Object.values(record)) {
      const result = firstString(item);
      if (result) return result;
    }
  }
  return undefined;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
