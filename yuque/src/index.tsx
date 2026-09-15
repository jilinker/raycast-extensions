import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearSession, connectFromBrowser, loadSession, saveSession } from "./session";
import {
  SessionExpiredError,
  buildWebSearchUrl,
  parseSessionInput,
  searchYuque,
  type SearchItem,
  type SearchScope,
  type YuqueSession,
} from "./yuque";

export default function Command() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("related");
  const [session, setSession] = useState<YuqueSession>();
  const [items, setItems] = useState<SearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    loadSession().then(setSession);
    return () => request.current?.abort();
  }, []);

  const runSearch = useCallback(
    async (nextPage: number, append = false) => {
      const text = query.trim();
      if (text.length < 1 || (scope === "related" && !session)) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setIsLoading(true);
      setError(undefined);
      try {
        const result = await searchYuque(
          text,
          scope,
          nextPage,
          scope === "related" ? session : undefined,
          controller.signal,
        );
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setHasMore(result.total === undefined ? result.items.length >= 20 : nextPage * 20 < result.total);
        setPage(nextPage);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof SessionExpiredError) {
          await clearSession();
          setSession(undefined);
          setError("登录状态已失效 请重新连接");
        } else setError(cause instanceof Error ? cause.message : "搜索失败");
        if (!append) setItems([]);
      } finally {
        if (request.current === controller) setIsLoading(false);
      }
    },
    [query, scope, session],
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(false);
    setError(undefined);
    if (query.trim().length < 1 || (scope === "related" && !session)) return;
    const timer = setTimeout(() => runSearch(1), 150);
    return () => clearTimeout(timer);
  }, [query, scope, session, runSearch]);

  const connect = useCallback(async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "等待浏览器连接" });
    try {
      const nextSession = await connectFromBrowser();
      await saveSession(nextSession);
      setSession(nextSession);
      toast.style = Toast.Style.Success;
      toast.title = "语雀已连接";
    } catch (cause) {
      toast.style = Toast.Style.Failure;
      toast.title = "连接失败";
      toast.message = cause instanceof Error ? cause.message : undefined;
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!(await confirmAlert({ title: "断开语雀连接", message: "本地保存的语雀会话将被删除" }))) return;
    await clearSession();
    setSession(undefined);
    setItems([]);
  }, []);

  const webUrl = useMemo(() => buildWebSearchUrl(query.trim(), scope), [query, scope]);
  const commonActions = (
    <>
      {session ? (
        <Action
          title="已连接"
          icon={Icon.CheckCircle}
          onAction={() => showToast({ style: Toast.Style.Success, title: "语雀已连接" })}
        />
      ) : (
        <Action title="连接语雀" icon={Icon.Link} onAction={connect} />
      )}
      <Action.Push title="导入请求" icon={Icon.Download} target={<ImportSession onSaved={setSession} />} />
      {session ? (
        <Action title="断开连接" icon={Icon.XMarkCircle} style={Action.Style.Destructive} onAction={disconnect} />
      ) : null}
    </>
  );

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      onSearchTextChange={setQuery}
      searchBarPlaceholder="搜索语雀文档"
      searchBarAccessory={
        <List.Dropdown tooltip="搜索范围" value={scope} onChange={(value) => setScope(value as SearchScope)}>
          <List.Dropdown.Item title="私人和团队" value="related" icon={Icon.Lock} />
          <List.Dropdown.Item title="公开内容" value="public" icon={Icon.Globe} />
        </List.Dropdown>
      }
      pagination={hasMore ? { hasMore: true, onLoadMore: () => runSearch(page + 1, true), pageSize: 20 } : undefined}
    >
      {items.map((item) => (
        <List.Item
          key={item.id}
          icon={{ source: Icon.Document, tintColor: Color.PrimaryText }}
          title={item.title}
          subtitle={item.subtitle}
          detail={<List.Item.Detail markdown={item.summary ?? "暂无摘要"} />}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="在浏览器打开文档" url={item.url} />
              <Action.OpenInBrowser
                title="在语雀网页搜索"
                url={webUrl}
                shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
              />
              {commonActions}
            </ActionPanel>
          }
        />
      ))}
      {items.length === 0 ? (
        <List.EmptyView
          icon={error ? Icon.Warning : Icon.MagnifyingGlass}
          title={emptyTitle(query, scope, session, error)}
          description={
            error ?? (scope === "related" && !session ? "连接浏览器登录态或导入 DevTools 请求" : "输入关键词")
          }
          actions={
            <ActionPanel>
              {query.trim() ? <Action.OpenInBrowser title="在语雀网页搜索" url={webUrl} /> : null}
              {commonActions}
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

function ImportSession({ onSaved }: { onSaved: (session: YuqueSession) => void }) {
  const { pop } = useNavigation();
  async function submit(values: { request: string }) {
    try {
      const session = parseSessionInput(values.request);
      await saveSession(session);
      onSaved(session);
      await showToast({ style: Toast.Style.Success, title: "语雀会话已导入" });
      pop();
    } catch (cause) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法解析请求",
        message: cause instanceof Error ? cause.message : undefined,
      });
    }
  }
  return (
    <Form
      navigationTitle="导入语雀会话"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="验证并保存" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="request"
        title="Fetch 或 cURL"
        placeholder="粘贴 DevTools Copy as fetch 或 Copy as cURL 的内容"
      />
      <Form.Description text="只保存搜索需要的会话字段 原始文本不会落盘" />
    </Form>
  );
}

function emptyTitle(query: string, scope: SearchScope, session?: YuqueSession, error?: string): string {
  if (error) return "无法搜索语雀";
  if (scope === "related" && !session) return "连接语雀后搜索私人和团队文档";
  if (query.trim().length < 1) return "输入关键词开始搜索";
  return "没有找到文档";
}
