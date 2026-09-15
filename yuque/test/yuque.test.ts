import assert from "node:assert/strict";
import test from "node:test";
import { buildWebSearchUrl, parseSearchResponse, parseSessionInput, sessionFromCookies } from "../src/yuque.ts";

test("parses a copied fetch without retaining unrelated cookies", () => {
  const session = parseSessionInput(`fetch("https://www.yuque.com/api/zsearch", {
    "headers": {
      "cookie": "lang=zh-cn; _yuque_session=session-value; yuque_ctoken=csrf-value; tracking=ignored",
      "x-csrf-token": "csrf-value",
      "x-login": "u123"
    },
    "method": "GET"
  })`);
  assert.equal(session.cookie, "_yuque_session=session-value; yuque_ctoken=csrf-value");
  assert.equal(session.csrfToken, "csrf-value");
  assert.equal(session.login, "u123");
});

test("maps direct and nested search results", () => {
  const page = parseSearchResponse({
    data: {
      totalHits: 2,
      hits: [
        {
          id: 1,
          title: "<em>First</em>",
          highlight: { content: ["A &amp; <em>B</em> [draft]"] },
          url: "/team/book/first",
        },
        { target: { id: 2, title: "Second", slug: "second", book: { namespace: "team/book", title: "Book" } } },
      ],
    },
  });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].summary, "A & **B** \\[draft\\]");
  assert.deepEqual(
    page.items.map(({ title, url }) => ({ title, url })),
    [
      { title: "First", url: "https://www.yuque.com/team/book/first" },
      { title: "Second", url: "https://www.yuque.com/team/book/second" },
    ],
  );
});

test("builds the browser fallback", () => {
  const url = new URL(buildWebSearchUrl("影石", "related"));
  assert.equal(url.searchParams.get("q"), "影石");
  assert.equal(url.searchParams.get("tab"), "related");
});

test("keeps only allowlisted browser cookies", () => {
  const session = sessionFromCookies([
    { name: "_yuque_session", value: "session-value" },
    { name: "yuque_ctoken", value: "csrf-value" },
    { name: "tracking", value: "ignored" },
  ]);
  assert.equal(session.cookie, "_yuque_session=session-value; yuque_ctoken=csrf-value");
  assert.equal(session.csrfToken, "csrf-value");
});
