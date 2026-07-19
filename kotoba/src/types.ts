/**
 * bpmn kotoba — record types.
 *
 * Per ADR-2605203000 Option B (PDS XRPC). bpmn = BPMN engine actor.
 * Collections: com.etzhayyim.bpmn.{process|instance|activityLog}
 *
 * Identity hierarchy (per bpmn design):
 *   did:web:bpmn.etzhayyim.com                          — controller
 *   did:web:bpmn.etzhayyim.com:process:{processId}      — Process definition
 *   did:web:bpmn.etzhayyim.com:instance:{instanceId}    — Process instance
 *   did:web:bpmn.etzhayyim.com:activity:{activityId}    — Activity log entry
 */

export const BPMN_DID_PREFIX = "did:web:bpmn.etzhayyim.com:" as const;

// ─── Instance State Machine ─────────────────────────────────────────────
// pending → running → completed | failed | cancelled

export type InstanceState = "pending" | "running" | "completed" | "failed" | "cancelled";

// ─── Process tier ───────────────────────────────────────────────────────

export interface ProcessRecord {
  did: string;
  processId: string;
  name: string;
  version: number;
  description?: string;
  xmlHash?: string;
  jsonHash?: string;
  status: "active" | "deprecated" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ProcessView extends ProcessRecord {
  processUri: string;
}

export interface DeployProcessInput {
  processId: string;
  name: string;
  version: number;
  xml?: string;
  json?: unknown;
  description?: string;
}

export interface DeployProcessOutput {
  status: "deployed" | "alreadyExists" | "rejected";
  processUri?: string;
  processId?: string;
  error?: string;
}

export interface ListProcessesInput {
  includeDeprecated?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListProcessesOutput {
  processes: ProcessView[];
  offset: number;
  limit: number;
  total?: number;
}

export interface ValidateXmlInput {
  xml: string;
}

export interface ValidateXmlOutput {
  valid: boolean;
  errors?: string[];
}

export interface CompileJsonToXmlInput {
  json: unknown;
}

export interface CompileJsonToXmlOutput {
  status: "compiled" | "rejected";
  xml?: string;
  byteSize?: number;
  error?: string;
}

export interface CompileBpmnInput {
  did: string;
  bpmnXml: string;
  name?: string;
  nanoid?: string;
  dmnXml?: string;
  formSchemas?: string;
}

export interface CompileBpmnOutput {
  success: boolean;
  manifest?: unknown;
  errors: string[];
  warnings: string[];
}

function processSlug(processId: string): string {
  return processId.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

export function processDid(processId: string): string {
  return `${BPMN_DID_PREFIX}process:${processSlug(processId)}`;
}

export function processRkey(processId: string): string {
  return `process-${processSlug(processId)}`;
}

// ─── Instance tier ──────────────────────────────────────────────────────

export interface InstanceRecord {
  did: string;
  instanceId: string;
  processId: string;
  state: InstanceState;
  variables?: unknown;
  correlationKey?: string;
  startedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  failedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceView extends InstanceRecord {
  instanceUri: string;
}

export interface StartInstanceInput {
  processId: string;
  variables?: unknown;
  correlationKey?: string;
}

export interface StartInstanceOutput {
  status: "started" | "rejected";
  instanceUri?: string;
  instanceId?: string;
  state?: InstanceState;
  startedAt?: string;
  error?: string;
}

export interface GetInstanceStateInput {
  instanceId: string;
}

export interface GetInstanceStateOutput {
  instanceId?: string;
  instance?: InstanceView;
  events?: ActivityLogEntry[];
  error?: string;
}

export interface ListInstancesInput {
  processId?: string;
  state?: InstanceState;
  limit?: number;
  offset?: number;
}

export interface ListInstancesOutput {
  instances: InstanceView[];
  offset: number;
  limit: number;
  total?: number;
}

export interface SignalInstanceInput {
  instanceId: string;
  messageName: string;
  payload?: unknown;
}

export interface SignalInstanceOutput {
  status: "signalled" | "rejected";
  instanceId?: string;
  activityId?: string;
  messageName?: string;
  accepted?: boolean;
  occurredAt?: string;
  error?: string;
}

export interface CancelInstanceInput {
  instanceId: string;
  reason?: string;
}

export interface CancelInstanceOutput {
  status: "cancelled" | "rejected";
  instanceId?: string;
  state?: InstanceState;
  cancelledAt?: string;
  error?: string;
}

export interface ExecutePipelineInput {
  did: string;
  pipelineIndex?: number;
  input?: unknown;
}

export interface ExecutePipelineOutput {
  success: boolean;
  outputs?: unknown[];
  error?: string;
}

function instanceSlug(instanceId: string): string {
  return instanceId.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

export function instanceDid(instanceId: string): string {
  return `${BPMN_DID_PREFIX}instance:${instanceSlug(instanceId)}`;
}

export function instanceRkey(instanceId: string): string {
  return `instance-${instanceSlug(instanceId)}`;
}

// ─── Activity Log tier ──────────────────────────────────────────────────

export interface ActivityLogEntry {
  activityId: string;
  instanceId: string;
  activityName: string;
  activityType: string;
  state: "pending" | "active" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  outputVariables?: unknown;
  createdAt: string;
}

export interface GetActivityLogInput {
  instanceId: string;
  limit?: number;
}

export interface GetActivityLogOutput {
  instanceId?: string;
  events?: ActivityLogEntry[];
  error?: string;
}

export interface AnalyzeProcessInput {
  processId?: string;
  caseId?: string;
  actionPrefix?: string;
  since?: string;
  until?: string;
  limit?: number;
  includeLlm?: boolean;
}

export interface AnalyzeProcessOutput {
  ok: boolean;
  source?: string;
  filters?: unknown;
  eventCount?: number;
  caseCount?: number;
  activityCount?: number;
  window?: unknown;
  activities?: unknown[];
  bottlenecks?: unknown[];
  variants?: unknown[];
  cases?: unknown[];
  anomalies?: unknown;
  llm?: unknown;
  llmError?: string;
  error?: string;
}

function activitySlug(activityId: string): string {
  return activityId.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

export function activityDid(activityId: string): string {
  return `${BPMN_DID_PREFIX}activity:${activitySlug(activityId)}`;
}

export function activityRkey(activityId: string): string {
  return `activity-${activitySlug(activityId)}`;
}
