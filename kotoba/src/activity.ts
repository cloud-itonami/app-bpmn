/**
 * bpmn kotoba — activity tier (getActivityLog).
 *
 *   getActivityLog      — OCEL-style activity event log for instance
 *
 * Activity records track step-by-step execution trace.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  type GetActivityLogInput,
  type GetActivityLogOutput,
  type ActivityLogEntry,
} from "./types.js";

const ACTIVITY_COLLECTION = "com.etzhayyim.bpmn.activityLog";

export async function getActivityLog(
  e: Etzhayyim,
  input: GetActivityLogInput
): Promise<GetActivityLogOutput> {
  if (!input.instanceId) {
    return { error: "missingInstanceId" };
  }

  const limit = Math.min(input.limit ?? 100, 1000);

  const resp = await e
    .read<ActivityLogEntry>({
      collection: ACTIVITY_COLLECTION,
      limit: Math.min(5000, limit * 10),
    })
    .catch(() => ({ records: [] }));

  const events = resp.records
    .filter((r) => r.value?.instanceId === input.instanceId)
    .map((r) => r.value)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    .slice(0, limit);

  return {
    instanceId: input.instanceId,
    events,
  };
}
