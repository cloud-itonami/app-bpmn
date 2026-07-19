/**
 * bpmn kotoba — instance tier (start, get, signal, cancel, list, executePipeline).
 *
 *   startInstance       — begin process instance (rkey=instance-{instanceId})
 *   getInstanceState    — rkey-direct read + activity log
 *   signalInstance      — send message to waiting event
 *   cancelInstance      — DESTRUCTIVE: terminate instance
 *   listInstances       — cursor + processId/state filter
 *   executePipeline     — invoke T1/T2 actor pipeline
 *
 * State machine: pending → running → completed | failed | cancelled
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  instanceDid,
  instanceRkey,
  type CancelInstanceInput,
  type CancelInstanceOutput,
  type ExecutePipelineInput,
  type ExecutePipelineOutput,
  type GetInstanceStateInput,
  type GetInstanceStateOutput,
  type InstanceRecord,
  type InstanceState,
  type InstanceView,
  type ListInstancesInput,
  type ListInstancesOutput,
  type SignalInstanceInput,
  type SignalInstanceOutput,
  type StartInstanceInput,
  type StartInstanceOutput,
} from "./types.js";

const INSTANCE_COLLECTION = "com.etzhayyim.bpmn.instance";
const ACTIVITY_COLLECTION = "com.etzhayyim.bpmn.activityLog";

function isInstanceId(id: string): boolean {
  return /^[a-z0-9._-]{1,64}$/i.test(id);
}

export async function startInstance(
  e: Etzhayyim,
  input: StartInstanceInput
): Promise<StartInstanceOutput> {
  if (!input.processId) {
    return { status: "rejected", error: "missingProcessId" };
  }

  // Generate instance ID
  const instanceId = generateInstanceId();
  if (!isInstanceId(instanceId)) {
    return { status: "rejected", error: "failedToGenerateInstanceId" };
  }

  const rkey = instanceRkey(instanceId);
  const existing = await e
    .read<InstanceRecord>({ collection: INSTANCE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "rejected",
      error: "alreadyExists",
    };
  }

  const did = instanceDid(instanceId);
  const now = new Date().toISOString();
  const record: InstanceRecord = {
    did,
    instanceId,
    processId: input.processId,
    state: "running",
    variables: input.variables,
    correlationKey: input.correlationKey,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const receipt = await e.write({
    collection: INSTANCE_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });

  return {
    status: "started",
    instanceUri: receipt.uri,
    instanceId,
    state: "running",
    startedAt: now,
  };
}

export async function getInstanceState(
  e: Etzhayyim,
  input: GetInstanceStateInput
): Promise<GetInstanceStateOutput> {
  if (!input.instanceId) {
    return { error: "missingInstanceId" };
  }

  const resp = await e
    .read<InstanceRecord>({
      collection: INSTANCE_COLLECTION,
      rkey: instanceRkey(input.instanceId),
    })
    .catch(() => ({ records: [] }));

  const r = resp.records[0];
  if (!r) {
    return { error: "notFound" };
  }

  const instance: InstanceView = { ...r.value, instanceUri: r.uri };

  // Fetch activity log for this instance
  const logResp = await e
    .read<any>({
      collection: ACTIVITY_COLLECTION,
    })
    .catch(() => ({ records: [] }));

  const events = logResp.records
    .filter((s: any) => s.value?.instanceId === input.instanceId)
    .map((s: any) => s.value);

  return { instanceId: input.instanceId, instance, events };
}

export async function listInstances(
  e: Etzhayyim,
  input: ListInstancesInput = {}
): Promise<ListInstancesOutput> {
  const limit = Math.min(input.limit ?? 50, 500);
  const resp = await e.read<InstanceRecord>({
    collection: INSTANCE_COLLECTION,
    limit: Math.min(1000, limit * 10),
  });

  const items: InstanceView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.processId && v.processId !== input.processId) return false;
      if (input.state && v.state !== input.state) return false;
      return true;
    })
    .map((r) => ({ ...r.value, instanceUri: r.uri }))
    .slice(input.offset ?? 0, (input.offset ?? 0) + limit);

  return {
    instances: items,
    offset: input.offset ?? 0,
    limit,
    total: items.length,
  };
}

export async function signalInstance(
  e: Etzhayyim,
  input: SignalInstanceInput
): Promise<SignalInstanceOutput> {
  if (!input.instanceId) {
    return { status: "rejected", error: "missingInstanceId" };
  }
  if (!input.messageName) {
    return { status: "rejected", error: "missingMessageName" };
  }

  const rkey = instanceRkey(input.instanceId);
  const existing = await e
    .read<InstanceRecord>({ collection: INSTANCE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));

  const r = existing.records[0];
  if (!r) {
    return { status: "rejected", error: "notFound" };
  }

  if (!r.value || r.value.state !== "running") {
    return {
      status: "rejected",
      error: r.value?.state === "cancelled" ? "instanceCancelled" : "instanceNotRunning",
    };
  }

  // Update instance state with signal payload
  const updated: InstanceRecord = {
    ...r.value,
    variables: {
      ...(r.value.variables as any),
      [`_signal_${input.messageName}`]: input.payload,
    },
    updatedAt: new Date().toISOString(),
  };

  await e.write({
    collection: INSTANCE_COLLECTION,
    record: updated as unknown as Record<string, unknown>,
    rkey,
  });

  return {
    status: "signalled",
    instanceId: input.instanceId,
    activityId: `activity-${input.messageName}`,
    messageName: input.messageName,
    accepted: true,
    occurredAt: new Date().toISOString(),
  };
}

export async function cancelInstance(
  e: Etzhayyim,
  input: CancelInstanceInput
): Promise<CancelInstanceOutput> {
  if (!input.instanceId) {
    return { status: "rejected", error: "missingInstanceId" };
  }

  const rkey = instanceRkey(input.instanceId);
  const existing = await e
    .read<InstanceRecord>({ collection: INSTANCE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));

  const r = existing.records[0];
  if (!r) {
    return { status: "rejected", error: "notFound" };
  }

  const now = new Date().toISOString();
  const updated: InstanceRecord = {
    ...r.value,
    state: "cancelled",
    cancelledAt: now,
    updatedAt: now,
  };

  await e.write({
    collection: INSTANCE_COLLECTION,
    record: updated as unknown as Record<string, unknown>,
    rkey,
  });

  return {
    status: "cancelled",
    instanceId: input.instanceId,
    state: "cancelled",
    cancelledAt: now,
  };
}

export async function executePipeline(
  _e: Etzhayyim,
  input: ExecutePipelineInput
): Promise<ExecutePipelineOutput> {
  if (!input.did) {
    return { success: false, error: "missingDid" };
  }

  const pipelineIndex = input.pipelineIndex ?? 0;

  // Placeholder: in full impl, would invoke actor via MCP or invoke() interface
  const outputs: unknown[] = [
    {
      pipelineIndex,
      did: input.did,
      timestamp: new Date().toISOString(),
      result: input.input,
    },
  ];

  return {
    success: true,
    outputs,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function generateInstanceId(): string {
  // Simple ID generation: timestamp + random suffix
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `inst-${timestamp}-${random}`;
}
