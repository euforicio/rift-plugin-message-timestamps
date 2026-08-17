// bb-plugin-runtime-shim:@bb/plugin-sdk/app
var runtime = globalThis.__bbPluginRuntime;
if (runtime == null || runtime.pluginSdkApp == null) {
  throw new Error('Cannot load "@bb/plugin-sdk/app": this bundle must be loaded by the BB app, which provides the shared plugin runtime (globalThis.__bbPluginRuntime).');
}
var mod = runtime.pluginSdkApp;
var {
  Markdown,
  ThreadChat,
  definePluginApp,
  experimental_NewThreadComposer,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings
} = mod;

// app.tsx
var SENT_AT_ATTR = "data-bb-sent-at";
var POLL_MS = 400;
var REFRESH_MS = 1500;
var HEADER_TITLE_SELECTOR = "p.relative.min-w-0.truncate.text-sm.font-normal.transition-colors";
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
function formatTime(date) {
  return date.toLocaleTimeString(void 0, {
    hour: "numeric",
    minute: "2-digit"
  });
}
function formatSentAt(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = /* @__PURE__ */ new Date();
  const time = formatTime(date);
  const day = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const dayMs = 864e5;
  if (day === today) return time;
  if (day === today - dayMs) return `Yesterday ${time}`;
  const datePart = date.toLocaleDateString(void 0, {
    month: "short",
    day: "numeric",
    ...date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }
  });
  return `${datePart}, ${time}`;
}
function formatFull(timestamp) {
  return new Date(timestamp).toLocaleString(void 0, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
function threadIdFromPath(pathname = window.location.pathname) {
  const match = decodeURIComponent(pathname).match(/\/threads\/([^/?#]+)/);
  return match?.[1] ?? null;
}
function findHeaderTitle(actionsEl) {
  let scope = actionsEl.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1) {
    const title = scope.querySelector(HEADER_TITLE_SELECTOR);
    if (title) return title;
    scope = scope.parentElement;
  }
  return null;
}
function visibleThreadIds() {
  const ids = /* @__PURE__ */ new Set();
  const urlId = threadIdFromPath();
  if (urlId) ids.add(urlId);
  document.querySelectorAll(
    '[data-sidebar-thread-id][aria-current="page"]'
  ).forEach((anchor) => {
    const threadId = anchor.dataset.sidebarThreadId;
    if (threadId) ids.add(threadId);
  });
  const titleToThread = /* @__PURE__ */ new Map();
  document.querySelectorAll("[data-sidebar-thread-id]").forEach((anchor) => {
    const threadId = anchor.dataset.sidebarThreadId;
    const label = anchor.parentElement?.querySelector("span.truncate");
    const text = label?.textContent?.trim();
    if (!threadId || !text) return;
    const existing = titleToThread.get(text);
    titleToThread.set(
      text,
      existing === void 0 || existing === threadId ? threadId : null
    );
  });
  document.querySelectorAll("[data-thread-header-workflow-actions]").forEach((actionsEl) => {
    const title = findHeaderTitle(actionsEl);
    const text = title?.textContent?.trim();
    const matched = text ? titleToThread.get(text) : null;
    if (matched) ids.add(matched);
  });
  return Array.from(ids).slice(0, 8);
}
function findTimeHost(row) {
  const group = row.querySelector(".group\\/message");
  if (!group) return null;
  return group.querySelector(":scope > .mt-1.flex.justify-end") ?? group;
}
function unknownUserRowIds(times) {
  const unknown = [];
  document.querySelectorAll("[data-timeline-row-id]").forEach((row) => {
    const id = row.dataset.timelineRowId;
    if (!id || times.has(id)) return;
    if (row.querySelector(".group\\/message")) unknown.push(id);
  });
  return unknown;
}
function decorate(times) {
  const keep = /* @__PURE__ */ new Set();
  document.querySelectorAll("[data-timeline-row-id]").forEach((row) => {
    const id = row.dataset.timelineRowId;
    const createdAt = id ? times.get(id) : void 0;
    const host = findTimeHost(row);
    if (!host) return;
    if (createdAt == null) {
      host.removeAttribute(SENT_AT_ATTR);
      if (host.title.startsWith("Sent ")) host.removeAttribute("title");
      return;
    }
    const label = formatSentAt(createdAt);
    if (!label) return;
    if (host.getAttribute(SENT_AT_ATTR) !== label) {
      host.setAttribute(SENT_AT_ATTR, label);
      host.title = `Sent ${formatFull(createdAt)}`;
    }
    keep.add(host);
  });
  document.querySelectorAll(`[${SENT_AT_ATTR}]`).forEach((element) => {
    if (keep.has(element)) return;
    element.removeAttribute(SENT_AT_ATTR);
    if (element.title.startsWith("Sent ")) element.removeAttribute("title");
  });
}
function clearDecorations() {
  document.querySelectorAll(`[${SENT_AT_ATTR}]`).forEach((element) => {
    element.removeAttribute(SENT_AT_ATTR);
    if (element.title.startsWith("Sent ")) element.removeAttribute("title");
  });
}
var app_default = definePluginApp((app) => {
  app.contentScripts.register({
    id: "sent-message-times",
    mount({ pluginId, signal }) {
      const times = /* @__PURE__ */ new Map();
      let inFlight = null;
      let lastRefreshAt = 0;
      let lastThreadKey = "";
      const load = async (threadIds) => {
        const response = await fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/userMessageTimes`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ threadIds }),
            signal
          }
        );
        const envelope = await response.json();
        if (!response.ok || !envelope.ok) return;
        for (const message of envelope.result.messages) {
          times.set(message.id, message.createdAt);
        }
      };
      const refresh = (force) => {
        const threadIds = visibleThreadIds();
        if (threadIds.length === 0) {
          if (times.size > 0) {
            times.clear();
            clearDecorations();
          }
          return;
        }
        const threadKey = threadIds.slice().sort().join(",");
        const missing = unknownUserRowIds(times);
        const stale = force || threadKey !== lastThreadKey || missing.length > 0 || Date.now() - lastRefreshAt >= REFRESH_MS;
        if (!stale) {
          decorate(times);
          return;
        }
        if (inFlight) {
          decorate(times);
          return;
        }
        lastThreadKey = threadKey;
        lastRefreshAt = Date.now();
        inFlight = load(threadIds).catch(() => void 0).finally(() => {
          inFlight = null;
          if (!signal.aborted) decorate(times);
        });
      };
      refresh(true);
      const timer = window.setInterval(() => refresh(false), POLL_MS);
      const observer = new MutationObserver(() => refresh(false));
      observer.observe(document.body, { childList: true, subtree: true });
      return () => {
        window.clearInterval(timer);
        observer.disconnect();
        clearDecorations();
      };
    }
  });
});
export {
  app_default as default
};
