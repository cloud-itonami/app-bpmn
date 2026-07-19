# bpmn kotoba

Phase E Option B reference implementation of bpmn (BPMN engine actor — workflow XML + process instance + activity log) on the etzhayyim substrate.

Per [ADR-2605203000](../../../90-docs/adr/2605203000-kotoba-write-target-options.md), bpmn migrates from vendor's `createKyselyDb` pattern (RW direct write) to **Option B** — PDS XRPC writes via `@etzhayyim/sdk e.write()`.

Coverage: **13 of 13 (100%)** bpmn canonical XRPC commands ported.

| Tier | Commands | Slice |
|---|---|---|
| Process | deployProcess, listProcesses, validateXml, compileJsonToXml, compileBpmn, analyzeProcess | 1 |
| Instance | startInstance, getInstanceState, listInstances, signalInstance, cancelInstance, executePipeline | 2 |
| Activity | getActivityLog | 3 |

All 13 canonical bpmn lexicons now have kotoba reference impl. Wire-up to a Worker / LangServer pod XRPC handler is the next operator task per ADR-2605203000.

## Authority-chain DIDs (per bpmn design)

```
did:web:bpmn.etzhayyim.com                          — controller
did:web:bpmn.etzhayyim.com:process:{processId}      — Process definition
did:web:bpmn.etzhayyim.com:instance:{instanceId}    — Process instance
did:web:bpmn.etzhayyim.com:activity:{activityId}    — Activity log entry
```

## Storage

BPMN metadata is stored on PDS. Process XML may be archived to B2. Instance state machine: pending → running → completed | failed | cancelled.

## Pattern translation (Option B)

| Vendor (`bpmn.etzhayyim.com`) | etzhayyim (this PR) |
|---|---|
| `const db = createKyselyDb();` | `import type { Etzhayyim } from "@etzhayyim/sdk"` |
| `db.insertInto("vertex_bpmn_process").values({...}).execute()` | `e.write({ collection: "com.etzhayyim.bpmn.process", record, rkey })` |
| `db.selectFrom("vertex_bpmn_instance").where("instance_id","=",id).execute()` | `e.read({ collection, rkey: \`instance-${instanceSlug(id)}\` })` |

## Usage

```ts
import { Etzhayyim } from "@etzhayyim/sdk";
import {
  deployProcess,
  startInstance,
  getInstanceState,
  listInstances,
  cancelInstance,
} from "@etzhayyim/bpmn-kotoba";

const e = new Etzhayyim({
  did: "did:web:bpmn.etzhayyim.com",
  pdsUrl: "https://pds.etzhayyim.com",
  l2RpcUrl: "https://mainnet.base.org",
});

// Deploy process
const deployResp = await deployProcess(e, {
  processId: "onboard-vendor",
  name: "Vendor Onboarding",
  version: 1,
  xml: `<?xml version="1.0"?>...`,
  description: "Multi-step vendor intake and KYC",
});
// → { status: "deployed", processUri: "at://...", processId: "onboard-vendor" }

// Start instance
const startResp = await startInstance(e, {
  processId: "onboard-vendor",
  variables: { vendorName: "Acme Corp", email: "vendor@acme.com" },
  correlationKey: "vendor-acme-001",
});
// → { status: "started", instanceUri: "at://...", instanceId: "inst-...", state: "running" }

// Get instance state
const stateResp = await getInstanceState(e, { instanceId: "inst-..." });
// → { instanceId: "...", instance: {...}, events: [...] }

// List instances by process
const listResp = await listInstances(e, {
  processId: "onboard-vendor",
  state: "running",
  limit: 50,
});
// → { instances: [...], offset: 0, limit: 50, total: 12 }

// Cancel instance
const cancelResp = await cancelInstance(e, {
  instanceId: "inst-...",
  reason: "vendor-rejected-tos",
});
// → { status: "cancelled", instanceId: "...", state: "cancelled", cancelledAt: "..." }
```

## Lexicons (13)

1. **com.etzhayyim.bpmn.deployProcess** — register BPMN process (JSON/XML)
2. **com.etzhayyim.bpmn.listProcesses** — cursor-paginated process list
3. **com.etzhayyim.bpmn.validateXml** — XSD + Schematron validation
4. **com.etzhayyim.bpmn.compileJsonToXml** — BPMN JSON subset → BPMN 2.0 XML
5. **com.etzhayyim.bpmn.compileBpmn** — XML → ActorManifest pipeline
6. **com.etzhayyim.bpmn.analyzeProcess** — OCEL process mining (KPIs + LLM)
7. **com.etzhayyim.bpmn.startInstance** — begin instance with variables
8. **com.etzhayyim.bpmn.getInstanceState** — full state + event log
9. **com.etzhayyim.bpmn.listInstances** — cursor + processId/state filter
10. **com.etzhayyim.bpmn.signalInstance** — send message to waiting event
11. **com.etzhayyim.bpmn.cancelInstance** — terminate instance (DESTRUCTIVE)
12. **com.etzhayyim.bpmn.executePipeline** — invoke T1/T2 actor pipeline
13. **com.etzhayyim.bpmn.getActivityLog** — instance activity event log

## What this package IS / ISN'T

**IS**:
- Reference impl of 13 bpmn commands on Option B (PDS XRPC).
- Documentation of the createKyselyDb → e.write() translation.
- Instance state machine (pending → running → completed | failed | cancelled).

**ISN'T**:
- A deployed Worker (scaffold-only).
- BPMN execution engine — only metadata + audit; actual flow execution on LangServer pod.
- Process mining optimization — placeholder KPI aggregation.

## Related

- [ADR-2605203000](../../../90-docs/adr/2605203000-kotoba-write-target-options.md) — Phase E write-target options
- [anime kotoba](../../etzhayyim-project-anime/kotoba/) — sibling Option B reference (10/10 ✓)
- [kiyo kotoba](../../etzhayyim-project-kiyo/kotoba/) — Option B reference (12/12 ✓)
- [sbom kotoba](../../etzhayyim-project-sbom/kotoba/) — Option B reference (17/N)
- [hanrei kotoba](../../etzhayyim-project-hanrei/kotoba/) — Option B reference (31/31 ✓)
