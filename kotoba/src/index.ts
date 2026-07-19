/**
 * bpmn kotoba — main exports.
 *
 * Phase E Option B reference implementation (PDS XRPC via @etzhayyim/sdk).
 */

// Types
export type {
  ProcessRecord,
  ProcessView,
  DeployProcessInput,
  DeployProcessOutput,
  ListProcessesInput,
  ListProcessesOutput,
  ValidateXmlInput,
  ValidateXmlOutput,
  CompileJsonToXmlInput,
  CompileJsonToXmlOutput,
  CompileBpmnInput,
  CompileBpmnOutput,
  InstanceRecord,
  InstanceView,
  InstanceState,
  StartInstanceInput,
  StartInstanceOutput,
  GetInstanceStateInput,
  GetInstanceStateOutput,
  ListInstancesInput,
  ListInstancesOutput,
  SignalInstanceInput,
  SignalInstanceOutput,
  CancelInstanceInput,
  CancelInstanceOutput,
  ExecutePipelineInput,
  ExecutePipelineOutput,
  ActivityLogEntry,
  GetActivityLogInput,
  GetActivityLogOutput,
  AnalyzeProcessInput,
  AnalyzeProcessOutput,
} from "./types.js";

export {
  BPMN_DID_PREFIX,
  processDid,
  processRkey,
  instanceDid,
  instanceRkey,
  activityDid,
  activityRkey,
} from "./types.js";

// Process operations
export { deployProcess, listProcesses, validateXml, compileJsonToXml, compileBpmn, analyzeProcess } from "./process.js";

// Instance operations
export {
  startInstance,
  getInstanceState,
  listInstances,
  signalInstance,
  cancelInstance,
  executePipeline,
} from "./instance.js";

// Activity operations
export { getActivityLog } from "./activity.js";
