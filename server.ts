import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

const MAX_THREAD_IDS = 8;
const MAX_TIMELINE_PAGES = 12;

type TimelineNode = {
  id?: string;
  kind?: string;
  role?: string;
  initiator?: string;
  createdAt?: number;
  children?: TimelineNode[] | null;
};

export const rpcContract = defineRpcContract({
  userMessageTimes: {
    input: z
      .object({
        threadIds: z.array(z.string().min(1)).min(1).max(MAX_THREAD_IDS),
      })
      .strict(),
    output: z.object({
      messages: z.array(
        z.object({
          id: z.string(),
          createdAt: z.number(),
        }),
      ),
    }),
  },
});

function collectUserSentTimes(
  rows: TimelineNode[] | undefined,
  into: Map<string, number>,
): void {
  if (!rows) return;
  for (const row of rows) {
    if (
      row.kind === "conversation" &&
      row.role === "user" &&
      row.initiator === "user" &&
      typeof row.id === "string" &&
      typeof row.createdAt === "number"
    ) {
      into.set(row.id, row.createdAt);
    }
    if (row.kind === "turn" && Array.isArray(row.children)) {
      collectUserSentTimes(row.children, into);
    }
  }
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async userMessageTimes({ threadIds }) {
      const times = new Map<string, number>();

      for (const threadId of threadIds) {
        let beforeAnchorSeq: string | undefined;
        let beforeAnchorId: string | undefined;

        for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
          const timeline = await bb.sdk.threads.timeline({
            threadId,
            includeNestedRows: "true",
            ...(beforeAnchorSeq && beforeAnchorId
              ? { beforeAnchorSeq, beforeAnchorId }
              : {}),
          });

          collectUserSentTimes(timeline.rows as TimelineNode[], times);

          const older = timeline.timelinePage.olderCursor;
          if (!timeline.timelinePage.hasOlderRows || !older) break;
          beforeAnchorSeq = String(older.anchorSeq);
          beforeAnchorId = older.anchorId;
        }
      }

      return {
        messages: Array.from(times, ([id, createdAt]) => ({ id, createdAt })),
      };
    },
  });
}
