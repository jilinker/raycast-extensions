const COOKIE_NAMES = new Set(["_yuque_session", "yuque_ctoken", "_c_WBKFRo", "acw_tc", "aliyungf_tc"]);

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const callback = new URL(tab.url ?? "");
    if (callback.hostname !== "127.0.0.1" || callback.pathname !== "/connect" || callback.hash.length !== 65) {
      throw new Error("Open Connect Yuque in Raycast first");
    }
    const cookies = (await chrome.cookies.getAll({ domain: "yuque.com" })).filter((cookie) =>
      COOKIE_NAMES.has(cookie.name),
    );
    if (!cookies.some((cookie) => cookie.name === "_yuque_session")) {
      await send(callback, { error: "NO_SESSION_COOKIE", cookieNames: cookies.map(({ name }) => name) });
      await chrome.tabs.create({ url: "https://www.yuque.com/login" });
      throw new Error("Sign in to Yuque then return and click again");
    }
    await send(callback, {
      cookies: cookies.map(({ name, value }) => ({ name, value })),
    });
    await badge("OK", "#2da44e");
    if (tab.id) await chrome.tabs.remove(tab.id);
  } catch (error) {
    await badge("!", "#cf222e");
    console.error(error instanceof Error ? error.message : "Connection failed");
  }
});

async function send(callback, payload) {
  const response = await fetch(`${callback.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ nonce: callback.hash.slice(1), ...payload }),
  });
  if (!response.ok) throw new Error(await response.text());
}

async function badge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}
