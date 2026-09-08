import { definePluginApp } from "@riftlabs/plugin-sdk/app";
import "./app.css";

const SENT_AT_ATTR = "data-rift-sent-at";
const POLL_MS = 400;
const REFRESH_MS = 1500;
const HEADER_TITLE_SELECTOR =
  "p.relative.min-w-0.truncate.text-sm.font-normal.transition-colors";

type MessageTime = { id: string; createdAt: number };
type RpcEnvelope =
  | { ok: true; result: { messages: MessageTime[] } }
  | { ok: false; error?: { message?: string } };

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSentAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const time = formatTime(date);
  const day = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const dayMs = 86_400_000;

  if (day === today) return time;
  if (day === today - dayMs) return `Yesterday ${time}`;

  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${datePart}, ${time}`;
}

function formatFull(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function threadIdFromPath(pathname = window.location.pathname): string | null {
  const match = decodeURIComponent(pathname).match(/\/threads\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function findHeaderTitle(actionsEl: HTMLElement): HTMLElement | null {
  let scope: HTMLElement | null = actionsEl.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1) {
    const title = scope.querySelector<HTMLElement>(HEADER_TITLE_SELECTOR);
    if (title) return title;
    scope = scope.parentElement;
  }
  return null;
}

function visibleThreadIds(): string[] {
  const ids = new Set<string>();
  const urlId = threadIdFromPath();
  if (urlId) ids.add(urlId);

  document
    .querySelectorAll<HTMLElement>(
      '[data-sidebar-thread-id][aria-current="page"]',
    )
    .forEach((anchor) => {
      const threadId = anchor.dataset.sidebarThreadId;
      if (threadId) ids.add(threadId);
    });

  const titleToThread = new Map<string, string | null>();
  document
    .querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")
    .forEach((anchor) => {
      const threadId = anchor.dataset.sidebarThreadId;
      const label =
        anchor.parentElement?.querySelector<HTMLElement>("span.truncate");
      const text = label?.textContent?.trim();
      if (!threadId || !text) return;
      const existing = titleToThread.get(text);
      titleToThread.set(
        text,
        existing === undefined || existing === threadId ? threadId : null,
      );
    });

  document
    .querySelectorAll<HTMLElement>("[data-thread-header-workflow-actions]")
    .forEach((actionsEl) => {
      const title = findHeaderTitle(actionsEl);
      const text = title?.textContent?.trim();
      const matched = text ? titleToThread.get(text) : null;
      if (matched) ids.add(matched);
    });

  return Array.from(ids).slice(0, 8);
}

function findTimeHost(row: HTMLElement): HTMLElement | null {
  const group = row.querySelector<HTMLElement>(".group\\/message");
  if (!group) return null;
  return (
    group.querySelector<HTMLElement>(":scope > .mt-1.flex.justify-end") ?? group
  );
}

function unknownUserRowIds(times: Map<string, number>): string[] {
  const unknown: string[] = [];
  document
    .querySelectorAll<HTMLElement>("[data-timeline-row-id]")
    .forEach((row) => {
      const id = row.dataset.timelineRowId;
      if (!id || times.has(id)) return;
      if (row.querySelector(".group\\/message")) unknown.push(id);
    });
  return unknown;
}

function decorate(times: Map<string, number>): void {
  const keep = new Set<HTMLElement>();

  document
    .querySelectorAll<HTMLElement>("[data-timeline-row-id]")
    .forEach((row) => {
      const id = row.dataset.timelineRowId;
      const createdAt = id ? times.get(id) : undefined;
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

  document
    .querySelectorAll<HTMLElement>(`[${SENT_AT_ATTR}]`)
    .forEach((element) => {
      if (keep.has(element)) return;
      element.removeAttribute(SENT_AT_ATTR);
      if (element.title.startsWith("Sent ")) element.removeAttribute("title");
    });
}

function clearDecorations(): void {
  document
    .querySelectorAll<HTMLElement>(`[${SENT_AT_ATTR}]`)
    .forEach((element) => {
      element.removeAttribute(SENT_AT_ATTR);
      if (element.title.startsWith("Sent ")) element.removeAttribute("title");
    });
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "sent-message-times",
    mount({ pluginId, signal }) {
      const times = new Map<string, number>();
      let inFlight: Promise<void> | null = null;
      let lastRefreshAt = 0;
      let lastThreadKey = "";

      const load = async (threadIds: string[]) => {
        const response = await fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/userMessageTimes`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ threadIds }),
            signal,
          },
        );
        const envelope = (await response.json()) as RpcEnvelope;
        if (!response.ok || !envelope.ok) return;
        for (const message of envelope.result.messages) {
          times.set(message.id, message.createdAt);
        }
      };

      const refresh = (force: boolean) => {
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
        const stale =
          force ||
          threadKey !== lastThreadKey ||
          missing.length > 0 ||
          Date.now() - lastRefreshAt >= REFRESH_MS;
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
        inFlight = load(threadIds)
          .catch(() => undefined)
          .finally(() => {
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
    },
  });
});
