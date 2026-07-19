import {
  asAgentTool, createKyselyDb, createWorkerExport, withCapabilityTags,
  type HostSDK, nowISO, str, genID, nsid,
} from "@etzhayyim/kotodama-host-sdk";
import type { Database } from "@etzhayyim/graph-schema";
// CHARTER-VIOLATION §substrate (centralized DB forbidden — migrate to AT MST + IPFS + Base L2)
import { Kysely } from "kysely";
import { runEngine, stopEngine, extractTimerDurations, type EngineResult } from "./engine.js";

const ACTOR_NAME = "bpmn";
const ACTOR_DID = `did:web:${ACTOR_NAME}.etzhayyim.com`;


function decodeParams(payload: any): Record<string, any> {
  if (!payload) return {};
  if (typeof payload === "object" && !(payload instanceof Uint8Array)) return payload as any;
  try {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.length === 0) return {};
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return {}; }
}

/**
 * com.etzhayyim.apps.bpmn — BPMN 2.0 registry + executor.
 *
 * Phase 1 (this file): subset runtime — serviceTask / sequenceFlow /
 * exclusiveGateway / timer / message / user / error. No subprocess, DMN,
 * compensation (Phase 4+).
 *
 * Authoring: JSON subset OR BPMN 2.0 XML. JSON → XML compile on deploy.
 * State: D1 BPMN_DB (process / instance / activity_event / signal_wait).
 * XML blob: R2 BPMN_XML_R2 (deployed XML, deterministic from JSON).
 * OCEL: vertex_bpmn_activity_event (RW, via PDS commit pipeline).
 *
 * serviceTask execution delegates to env.{SERVICE}_{BINDING}.fetch(
 *   `/xrpc/${nsid}`) — a generic XRPC dispatcher. For Phase 1 we stub
 * this with a note; Phase 2 wires env bindings per tenant.
 */

const DEFAULT_INSTANCE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min hard cap

type StepType =
  | "startEvent" | "endEvent" | "errorEndEvent"
  | "serviceTask" | "userTask"
  | "exclusiveGateway" | "parallelGateway"
  | "timerIntermediateCatchEvent" | "messageIntermediateCatchEvent"
  | "sequenceFlow";

interface BpmnJsonStep {
  id: string;
  type: StepType;
  nsid?: string;
  params?: Record<string, unknown>;
  resultAs?: string;
  condition?: string;
  then?: string;
  else?: string;
  messageName?: string;
  timeout?: string;
  onTimeout?: string;
  errorCode?: string;
  next?: string;
}

interface BpmnJson {
  id: string;
  name: string;
  version?: number;
  variables?: Record<string, { type: string; default?: unknown }>;
  flow: BpmnJsonStep[];
}

// Worker-direct Hyperdrive write per ADR-0036. Domain records bypass PDS
// commit pipeline; synchronous SQL INSERT, 1-RTT, typed via @etzhayyim/graph-schema.
// Fire-and-forget (the SDK keeps the promise alive via ctx.waitUntil drain).
async function writeRecord(db: Kysely<Database>, collection: string, rkey: string, value: Record<string, unknown>): Promise<void> {
  const table = `vertex_${ACTOR_NAME}_${camelToSnake(collection)}`;
  const now = new Date();
  const row: Record<string, unknown> = {
    vertex_id: `at://${ACTOR_DID}/com.etzhayyim.apps.${ACTOR_NAME}.${collection}/${rkey}`,
    _seq: null,
    created_date: now.toISOString().slice(0, 10),
    sensitivity_ord: 100,
    owner_did: ACTOR_DID,
    rkey,
    repo: ACTOR_DID,
    created_at: now.toISOString(),
    org_id: "etzhayyim",
    user_id: "system",
    actor_id: `sys.${ACTOR_NAME}`,
  };
  for (const [k, v] of Object.entries(value)) {
    const sc = camelToSnake(k);
    if (sc in row) continue;
    row[sc] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
  }
  try {
    await db.insertInto(table as any).values(row as any).execute();
    console.log(`[writeRecord] ${table} rkey=${rkey} ok cols=${Object.keys(row).length}`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!/duplicate|already exists|pk violation/i.test(msg)) {
      console.error(`[writeRecord] ${table} failed (cols=${Object.keys(row).length}): ${msg.slice(0, 400)}`);
    }
  }
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, m => "_" + m.toLowerCase()).replace(/^_/, "");
}

/**
 * OCEL 2.0-inspired activity event record emitted to PDS → kyber-projector.
 * Collection: com.etzhayyim.apps.bpmn.activityEvent.
 *   ocelEventType  — "start" | "complete" | "error" | "signal" | "timeout"
 *   ocelTime       — ISO-8601 occurrence
 *   instanceId     — process instance (OCEL object ref)
 *   processId      — process definition (OCEL object ref)
 *   activityId     — the flow element that fired
 *   attributes     — arbitrary payload (vars subset, error, etc.)
 */
async function emitOcelEvent(
  db: Kysely<Database>,
  opts: {
    instanceId: string;
    processId?: string;
    activityId: string;
    eventType: string;
    attributes?: Record<string, unknown>;
    occurredAt: string;
  },
): Promise<void> {
  const rkey = `${opts.instanceId}-${opts.activityId}-${opts.eventType}-${opts.occurredAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
  await writeRecord(db, "activityEvent", rkey, {
    ocelEventType: opts.eventType,
    ocelTime: opts.occurredAt,
    instanceId: opts.instanceId,
    processId: opts.processId ?? null,
    activityId: opts.activityId,
    attributes: opts.attributes ?? {},
  });
}

// runEngine + EngineResult imported from ./engine.ts (bpmn-elements).

/**
 * BPMN 2.0 JSON → XML compiler (Phase 5b).
 *
 * Emits a valid, executable BPMN 2.0 XML with sequenceFlows wiring each
 * step's `next` / `then` / `else` transitions. serviceTasks carry an
 * `implementation="${environment.services.xrpc}"` reference so
 * bpmn-elements resolves the `xrpc` service handler at run time. The
 * NSID lives in the `name` attribute — the handler reads it to pick the
 * target actor binding.
 */
function compileJsonToXml(doc: BpmnJson): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const processId = esc(doc.id);
  const processName = esc(doc.name);

  const flows: Array<{ id: string; src: string; dst: string; condition?: string }> = [];
  const incomingByNode = new Map<string, string[]>();
  const outgoingByNode = new Map<string, string[]>();
  const addFlow = (src: string, dst: string, condition?: string) => {
    const fid = `flow_${src}_${dst}`;
    flows.push({ id: fid, src, dst, condition });
    (incomingByNode.get(dst) ?? incomingByNode.set(dst, []).get(dst)!).push(fid);
    (outgoingByNode.get(src) ?? outgoingByNode.set(src, []).get(src)!).push(fid);
  };

  for (const step of doc.flow) {
    if (step.type === "exclusiveGateway") {
      if (step.then) addFlow(step.id, step.then, step.condition);
      if (step.else) addFlow(step.id, step.else);
    } else if (step.type === "messageIntermediateCatchEvent") {
      if (step.next) addFlow(step.id, step.next);
      if (step.onTimeout) addFlow(step.id, step.onTimeout);
    } else if (step.next) {
      addFlow(step.id, step.next);
    }
  }

  const inlineFlows = (id: string) => {
    const inc = (incomingByNode.get(id) ?? []).map(f => `<bpmn:incoming>${esc(f)}</bpmn:incoming>`).join("");
    const out = (outgoingByNode.get(id) ?? []).map(f => `<bpmn:outgoing>${esc(f)}</bpmn:outgoing>`).join("");
    return inc + out;
  };

  const elements: string[] = [];
  for (const step of doc.flow) {
    const id = esc(step.id);
    const flowRefs = inlineFlows(step.id);
    switch (step.type) {
      case "startEvent":
        elements.push(`<bpmn:startEvent id="${id}">${flowRefs}</bpmn:startEvent>`);
        break;
      case "endEvent":
        elements.push(`<bpmn:endEvent id="${id}">${flowRefs}</bpmn:endEvent>`);
        break;
      case "errorEndEvent":
        elements.push(`<bpmn:endEvent id="${id}">${flowRefs}<bpmn:errorEventDefinition errorRef="${esc(step.errorCode ?? "ERROR")}"/></bpmn:endEvent>`);
        break;
      case "serviceTask": {
        const nsidVal = esc(step.nsid ?? "");
        const resultAs = esc(step.resultAs ?? "");
        elements.push(`<bpmn:serviceTask id="${id}" name="${nsidVal}" implementation="\${environment.services.xrpc}">${flowRefs}<bpmn:extensionElements><etzhayyim:xrpc nsid="${nsidVal}" resultAs="${resultAs}"/></bpmn:extensionElements></bpmn:serviceTask>`);
        break;
      }
      case "userTask":
        elements.push(`<bpmn:userTask id="${id}">${flowRefs}</bpmn:userTask>`);
        break;
      case "exclusiveGateway":
        elements.push(`<bpmn:exclusiveGateway id="${id}">${flowRefs}</bpmn:exclusiveGateway>`);
        break;
      case "parallelGateway":
        elements.push(`<bpmn:parallelGateway id="${id}">${flowRefs}</bpmn:parallelGateway>`);
        break;
      case "timerIntermediateCatchEvent":
        elements.push(`<bpmn:intermediateCatchEvent id="${id}">${flowRefs}<bpmn:timerEventDefinition><bpmn:timeDuration>${esc(step.timeout ?? "PT1M")}</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
        break;
      case "messageIntermediateCatchEvent":
        elements.push(`<bpmn:intermediateCatchEvent id="${id}">${flowRefs}<bpmn:messageEventDefinition messageRef="${esc(step.messageName ?? "")}"/></bpmn:intermediateCatchEvent>`);
        break;
      case "sequenceFlow":
        // handled below as standalone sequenceFlow elements
        break;
    }
  }

  // Emit all sequenceFlow elements derived from next/then/else
  for (const f of flows) {
    const body = f.condition
      ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="JavaScript">\${${esc(f.condition)}}</bpmn:conditionExpression>`
      : "";
    elements.push(`<bpmn:sequenceFlow id="${esc(f.id)}" sourceRef="${esc(f.src)}" targetRef="${esc(f.dst)}">${body}</bpmn:sequenceFlow>`);
  }

  // Collect distinct message names (for messageRef resolution in bpmn-elements)
  const messages = new Set<string>();
  for (const step of doc.flow) {
    if (step.type === "messageIntermediateCatchEvent" && step.messageName) {
      messages.add(step.messageName);
    }
  }
  const messageDefs = Array.from(messages)
    .map(m => `<bpmn:message id="${esc(m)}" name="${esc(m)}"/>`).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:etzhayyim="https://etzhayyim.com/bpmn/extension" id="def-${processId}" targetNamespace="https://etzhayyim.com/bpmn">
  ${messageDefs}
  <bpmn:process id="${processId}" name="${processName}" isExecutable="true">
    ${elements.join("\n    ")}
  </bpmn:process>
</bpmn:definitions>`;
}

/**
 * Cron-path write: no sdk context available, take env.HYPERDRIVE directly,
 * build a new Kysely instance, and do the same Worker-direct write.
 * Same semantics as writeRecord() but async (cron can await).
 */
async function writeRecordFromCron(env: any, collection: string, rkey: string, value: Record<string, unknown>): Promise<void> {
  if (!env.HYPERDRIVE) return;
  const db = createKyselyDb(env.HYPERDRIVE) as unknown as Kysely<Database>;
  const table = `vertex_${ACTOR_NAME}_${camelToSnake(collection)}`;
  const now = new Date();
  const row: Record<string, unknown> = {
    vertex_id: `at://${ACTOR_DID}/com.etzhayyim.apps.${ACTOR_NAME}.${collection}/${rkey}`,
    _seq: null,
    created_date: now.toISOString().slice(0, 10),
    sensitivity_ord: 100,
    owner_did: ACTOR_DID,
    rkey,
    repo: ACTOR_DID,
    created_at: now.toISOString(),
    org_id: "etzhayyim",
    user_id: "system",
    actor_id: `sys.${ACTOR_NAME}-cron`,
  };
  for (const [k, v] of Object.entries(value)) {
    const sc = camelToSnake(k);
    if (sc in row) continue;
    row[sc] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
  }
  try {
    await db.insertInto(table as any).values(row as any).execute();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!/duplicate|already exists|pk violation/i.test(msg)) {
      console.error(`[writeRecordFromCron] ${table} failed: ${msg.slice(0, 200)}`);
    }
  }
}

// Cron sweep (exported separately below, since host-sdk's createWorkerExport
// only returns { fetch }).
async function cronSweepExpiredTimers(env: any): Promise<{ fired: number; failed: number }> {
  let fired = 0;
  let failed = 0;
  try {
    const now = nowISO();
    const expired = await env.BPMN_DB.prepare(
      `SELECT t.instance_id, t.activity_id, t.duration_ms, t.fires_at,
              i.process_id, i.current_token_json, i.variables_json
       FROM timer_wait t
       JOIN instance i ON i.instance_id = t.instance_id
       WHERE t.fired = 0 AND t.fires_at <= ? AND i.state = 'active'
       ORDER BY t.fires_at ASC LIMIT 50`
    ).bind(now).all();

    for (const row of (expired.results as any[]) ?? []) {
      try {
        const proc = await env.BPMN_DB.prepare(
          "SELECT xml_r2_key FROM process WHERE process_id = ?"
        ).bind(row.process_id).first() as { xml_r2_key: string } | null;
        const xmlObj = proc ? await env.BPMN_XML_R2?.get(proc.xml_r2_key) : null;
        const xml = xmlObj ? await xmlObj.text() : null;
        if (!xml) { failed++; continue; }

        const variables = row.variables_json ? JSON.parse(row.variables_json) : {};
        const savedState = row.current_token_json ? JSON.parse(row.current_token_json) : null;
        const engineRes = await runEngine(env, xml, variables, savedState, { messageName: row.activity_id });

        const newState = engineRes.completed ? "completed" : engineRes.error ? "error" : "active";
        await env.BPMN_DB.prepare(
          `UPDATE instance SET state = ?, current_token_json = ?, completed_at = ?, error_code = ?
           WHERE instance_id = ?`
        ).bind(
          newState,
          engineRes.state ? JSON.stringify(engineRes.state) : null,
          engineRes.completed ? now : null,
          engineRes.error || null,
          row.instance_id,
        ).run();

        await env.BPMN_DB.prepare(
          "UPDATE timer_wait SET fired = 1 WHERE instance_id = ? AND activity_id = ?"
        ).bind(row.instance_id, row.activity_id).run();

        await env.BPMN_DB.prepare(
          `INSERT INTO activity_event (instance_id, activity_id, event_type, payload_json, occurred_at)
           VALUES (?, ?, 'timeout', ?, ?)`
        ).bind(row.instance_id, row.activity_id, JSON.stringify({ firedAt: now, duration_ms: row.duration_ms, newState, error: engineRes.error ?? null }), now).run();

        // OCEL emit via PDS service binding (no sdk context available in cron)
        await writeRecordFromCron(env, "activityEvent", {
          rkey: `${row.instance_id}-${row.activity_id}-timeout-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
          ocelEventType: "timeout",
          ocelTime: now,
          instanceId: row.instance_id,
          processId: row.process_id,
          activityId: row.activity_id,
          attributes: { firedAt: now, duration_ms: row.duration_ms, newState, error: engineRes.error ?? null },
        });
        fired++;
      } catch (e: any) {
        console.error("[bpmn cron] row failed:", String(e?.message ?? e).slice(0, 300));
        failed++;
      }
    }
  } catch (e: any) {
    console.error("[bpmn cron] sweep error:", String(e?.message ?? e).slice(0, 300));
    failed++;
  }
  return { fired, failed };
}

const worker = createWorkerExport((sdk: HostSDK) => {
  const env = sdk.env as any;
  const db = createKyselyDb(env.HYPERDRIVE) as unknown as Kysely<Database>;

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.compileJsonToXml"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const json = params?.json as BpmnJson | undefined;
        if (!json || !json.id || !Array.isArray(json.flow)) return { error: "invalid BPMN JSON: require {id, name, flow[]}" };
        try {
          const xml = compileJsonToXml(json);
          return { xml, byteSize: xml.length };
        } catch (e: any) {
          return { error: `compile failed: ${String(e?.message ?? e)}` };
        }
      },
      asAgentTool("Compile BPMN JSON subset to BPMN 2.0 XML."),
      withCapabilityTags("bpmn", "compile"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.validateXml"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const xml = str(params?.xml ?? "");
        if (!xml) return { error: "xml required" };
        // Phase 1: cheap well-formedness check; Phase 2 wires a true XSD validator.
        const hasDeclaration = /<\?xml/.test(xml);
        const hasProcess = /<bpmn:process[^>]*>/.test(xml);
        const hasClose = /<\/bpmn:definitions>/.test(xml);
        if (!hasDeclaration || !hasProcess || !hasClose) {
          return { valid: false, errors: ["missing xml declaration / process element / closing tag"] };
        }
        return { valid: true, errors: [] };
      },
      asAgentTool("Validate BPMN 2.0 XML."),
      withCapabilityTags("bpmn", "validate"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.deployProcess"),
      async (ctx, _p: any) => {
        const params = decodeParams(_p);
        const json = params?.json as BpmnJson | undefined;
        const xmlIn = str(params?.xml ?? "");
        if (!json && !xmlIn) return { error: "json or xml required" };

        const xml = json ? compileJsonToXml(json) : xmlIn;
        const name = json?.name ?? str(params?.name ?? "unnamed");
        const processId = `proc-${genID("proc")}`;
        const version = Number(params?.version ?? 1);
        const deployedBy = str((ctx as any)?.did ?? "did:anonymous");
        const deployedAt = nowISO();

        const xmlR2Key = `bpmn/xml/${processId}.bpmn.xml`;
        const jsonR2Key = json ? `bpmn/json/${processId}.bpmn.json` : null;
        await env.BPMN_XML_R2?.put(xmlR2Key, xml).catch(() => {});
        if (json && jsonR2Key) await env.BPMN_XML_R2?.put(jsonR2Key, JSON.stringify(json)).catch(() => {});

        await env.BPMN_DB.prepare(
          `INSERT INTO process (process_id, name, version, xml_r2_key, json_r2_key, xsd_valid, deployed_at, deployed_by)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(processId, name, version, xmlR2Key, jsonR2Key, deployedAt, deployedBy).run();

        await writeRecord(db, "process", processId, {
          processId, name, version, xmlR2Key, jsonR2Key, deployedAt, deployedBy,
        });

        return { processId, name, version, xmlR2Key, jsonR2Key, deployedAt };
      },
      asAgentTool("Deploy a BPMN process (JSON or XML). Returns processId."),
      withCapabilityTags("bpmn", "deploy"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.startInstance"),
      async (ctx, _p: any) => {
        const params = decodeParams(_p);
        const processId = str(params?.processId ?? "");
        if (!processId) return { error: "processId required" };
        const variables = (params?.variables ?? {}) as Record<string, unknown>;
        const correlationKey = str(params?.correlationKey ?? "");

        const proc = await env.BPMN_DB.prepare(
          "SELECT process_id, name, xml_r2_key FROM process WHERE process_id = ? AND deprecated = 0"
        ).bind(processId).first() as { process_id: string; name: string; xml_r2_key: string } | null;
        if (!proc) return { error: `processId "${processId}" not found or deprecated` };

        // Load XML from R2 + drive bpmn-engine
        const xmlObj = await env.BPMN_XML_R2?.get(proc.xml_r2_key);
        if (!xmlObj) return { error: `XML artifact not found at R2 key ${proc.xml_r2_key}` };
        const xml = await xmlObj.text();

        const engineRes = await runEngine(env, xml, variables);

        // Override engine's completion signal if there are timers or message
        // waits pending — these are async resumption points the engine can't
        // see without waiting (timer may fire seconds/minutes later via cron).
        const timerDurations = extractTimerDurations(xml);
        const hasPendingWork = timerDurations.size > 0 || engineRes.waiting.length > 0;
        const effectiveCompleted = engineRes.completed && !hasPendingWork;

        const instanceId = `inst-${genID("inst")}`;
        const startedAt = nowISO();
        const state = effectiveCompleted ? "completed" : engineRes.error ? "error" : "active";

        await env.BPMN_DB.prepare(
          `INSERT INTO instance (instance_id, process_id, state, variables_json, current_token_json, correlation_key, started_at, completed_at, error_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          instanceId, processId, state,
          JSON.stringify(variables),
          engineRes.state ? JSON.stringify(engineRes.state) : null,
          correlationKey || null, startedAt,
          effectiveCompleted ? nowISO() : null,
          engineRes.error || null,
        ).run();

        // Arm signal-wait rows per engine-reported wait activity
        for (const w of engineRes.waiting) {
          await env.BPMN_DB.prepare(
            `INSERT INTO signal_wait (instance_id, activity_id, message_name, correlation_key, armed_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(instanceId, w.activityId, w.messageName, correlationKey || null, startedAt).run();
        }

        // Arm timer_wait rows for timer catch events (already extracted above)
        for (const [activityId, durationMs] of timerDurations) {
          const firesAt = new Date(Date.now() + durationMs).toISOString();
          await env.BPMN_DB.prepare(
            `INSERT OR REPLACE INTO timer_wait (instance_id, activity_id, duration_ms, armed_at, fires_at, fired)
             VALUES (?, ?, ?, ?, ?, 0)`
          ).bind(instanceId, activityId, durationMs, startedAt, firesAt).run();
        }

        await env.BPMN_DB.prepare(
          `INSERT INTO activity_event (instance_id, activity_id, event_type, payload_json, occurred_at)
           VALUES (?, ?, 'start', ?, ?)`
        ).bind(instanceId, "start", JSON.stringify({ variables, correlationKey, waiting: engineRes.waiting, timers: Array.from(timerDurations.keys()) }), startedAt).run();

        await emitOcelEvent(db, {
          instanceId, processId, activityId: "start", eventType: "start",
          attributes: { variables, correlationKey, waiting: engineRes.waiting, timers: Array.from(timerDurations.keys()) },
          occurredAt: startedAt,
        });

        await writeRecord(db, "instance", instanceId, {
          instanceId, processId, state,
          variables, correlationKey: correlationKey || null, startedAt,
          waiting: engineRes.waiting,
        });

        return { instanceId, processId, state, startedAt, waiting: engineRes.waiting, error: engineRes.error };
      },
      asAgentTool("Start a process instance with bpmn-engine. Advances tokens through serviceTasks to first wait state."),
      withCapabilityTags("bpmn", "instance", "start"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.signalInstance"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const instanceId = str(params?.instanceId ?? "");
        const messageName = str(params?.messageName ?? "");
        if (!instanceId || !messageName) return { error: "instanceId and messageName required" };
        const payload = params?.payload ?? null;

        const wait = await env.BPMN_DB.prepare(
          "SELECT activity_id, message_name, correlation_key FROM signal_wait WHERE instance_id = ? AND message_name = ? LIMIT 1"
        ).bind(instanceId, messageName).first() as { activity_id: string } | null;
        if (!wait) return { error: `no armed signal "${messageName}" on instance ${instanceId}` };

        // Load instance + re-run engine with saved state + signal
        const inst = await env.BPMN_DB.prepare(
          "SELECT process_id, current_token_json, variables_json FROM instance WHERE instance_id = ?"
        ).bind(instanceId).first() as { process_id: string; current_token_json: string; variables_json: string } | null;
        if (!inst) return { error: `instance ${instanceId} not found` };

        const proc = await env.BPMN_DB.prepare(
          "SELECT xml_r2_key FROM process WHERE process_id = ?"
        ).bind(inst.process_id).first() as { xml_r2_key: string } | null;
        const xmlObj = proc ? await env.BPMN_XML_R2?.get(proc.xml_r2_key) : null;
        const xml = xmlObj ? await xmlObj.text() : null;
        if (!xml) return { error: `XML artifact unavailable for instance ${instanceId}` };

        const savedState = inst.current_token_json ? JSON.parse(inst.current_token_json) : null;
        const variables = inst.variables_json ? JSON.parse(inst.variables_json) : {};
        const engineRes = await runEngine(env, xml, variables, savedState, { messageName, payload });

        const occurredAt = nowISO();
        const newState = engineRes.completed ? "completed" : engineRes.error ? "error" : "active";

        await env.BPMN_DB.prepare(
          `UPDATE instance SET state = ?, current_token_json = ?, completed_at = ?, error_code = ? WHERE instance_id = ?`
        ).bind(
          newState,
          engineRes.state ? JSON.stringify(engineRes.state) : null,
          engineRes.completed ? occurredAt : null,
          engineRes.error || null,
          instanceId,
        ).run();

        await env.BPMN_DB.prepare(
          "DELETE FROM signal_wait WHERE instance_id = ? AND activity_id = ?"
        ).bind(instanceId, wait.activity_id).run();

        // Arm any new signal waits from this transition
        for (const w of engineRes.waiting) {
          await env.BPMN_DB.prepare(
            `INSERT OR IGNORE INTO signal_wait (instance_id, activity_id, message_name, correlation_key, armed_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(instanceId, w.activityId, w.messageName, null, occurredAt).run();
        }

        await env.BPMN_DB.prepare(
          `INSERT INTO activity_event (instance_id, activity_id, event_type, payload_json, occurred_at)
           VALUES (?, ?, 'signal', ?, ?)`
        ).bind(instanceId, wait.activity_id, JSON.stringify({ messageName, payload, engineResult: { completed: engineRes.completed, waiting: engineRes.waiting, error: engineRes.error } }), occurredAt).run();

        await emitOcelEvent(db, {
          instanceId, processId: inst.process_id, activityId: wait.activity_id, eventType: "signal",
          attributes: { messageName, payload, waiting: engineRes.waiting, error: engineRes.error ?? null },
          occurredAt,
        });

        await writeRecord(db, "signalLog", `${instanceId}-${wait.activity_id}`, {
          instanceId, activityId: wait.activity_id, messageName, payload, occurredAt,
        });

        return { instanceId, activityId: wait.activity_id, messageName, accepted: true, occurredAt, state: newState, waiting: engineRes.waiting, error: engineRes.error };
      },
      asAgentTool("Signal a waiting message event on an instance, advancing the BPMN token."),
      withCapabilityTags("bpmn", "signal"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.getInstanceState"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const instanceId = str(params?.instanceId ?? "");
        if (!instanceId) return { error: "instanceId required" };
        const inst = await env.BPMN_DB.prepare(
          `SELECT instance_id, process_id, state, variables_json, current_token_json, correlation_key,
                  started_at, completed_at, error_code
           FROM instance WHERE instance_id = ?`
        ).bind(instanceId).first();
        if (!inst) return { instanceId, instance: null };

        const events = await env.BPMN_DB.prepare(
          `SELECT activity_id, event_type, payload_json, occurred_at FROM activity_event
           WHERE instance_id = ? ORDER BY event_id ASC LIMIT 200`
        ).bind(instanceId).all();

        return { instanceId, instance: inst, events: events.results };
      },
      asAgentTool("Get full state of a process instance + recent activity events."),
      withCapabilityTags("bpmn", "instance", "status"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.getActivityLog"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const instanceId = str(params?.instanceId ?? "");
        if (!instanceId) return { error: "instanceId required" };
        const limit = Math.min(Number(params?.limit ?? 100), 1000);
        const events = await env.BPMN_DB.prepare(
          `SELECT event_id, activity_id, event_type, payload_json, occurred_at FROM activity_event
           WHERE instance_id = ? ORDER BY event_id ASC LIMIT ?`
        ).bind(instanceId, limit).all();
        return { instanceId, events: events.results };
      },
      asAgentTool("Get OCEL-style activity event log for an instance."),
      withCapabilityTags("bpmn", "ocel", "log"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.cancelInstance"),
      async (ctx, _p: any) => {
        const params = decodeParams(_p);
        const instanceId = str(params?.instanceId ?? "");
        const reason = str(params?.reason ?? "user-cancelled");
        if (!instanceId) return { error: "instanceId required" };

        // Load instance + XML to run engine.stop() for a clean termination.
        const inst = await env.BPMN_DB.prepare(
          "SELECT process_id, current_token_json, variables_json, state FROM instance WHERE instance_id = ?"
        ).bind(instanceId).first() as { process_id: string; current_token_json: string; variables_json: string; state: string } | null;
        if (!inst) return { error: `instance ${instanceId} not found` };
        if (inst.state !== "active" && inst.state !== "suspended") {
          return { error: `instance state=${inst.state}; cannot cancel` };
        }

        let stoppedState: any = null;
        let stopError: string | undefined;
        if (inst.current_token_json) {
          const proc = await env.BPMN_DB.prepare(
            "SELECT xml_r2_key FROM process WHERE process_id = ?"
          ).bind(inst.process_id).first() as { xml_r2_key: string } | null;
          const xmlObj = proc ? await env.BPMN_XML_R2?.get(proc.xml_r2_key) : null;
          const xml = xmlObj ? await xmlObj.text() : null;
          if (xml) {
            const variables = inst.variables_json ? JSON.parse(inst.variables_json) : {};
            const savedState = JSON.parse(inst.current_token_json);
            const res = await stopEngine(env, xml, variables, savedState, reason);
            stoppedState = res.state;
            stopError = res.error;
          }
        }

        const now = nowISO();
        await env.BPMN_DB.prepare(
          `UPDATE instance SET state = 'terminated', completed_at = ?, error_code = ?,
                               current_token_json = COALESCE(?, current_token_json)
           WHERE instance_id = ?`
        ).bind(
          now, reason,
          stoppedState ? JSON.stringify(stoppedState) : null,
          instanceId,
        ).run();

        // Clear any armed signal / timer waits
        await env.BPMN_DB.prepare("DELETE FROM signal_wait WHERE instance_id = ?").bind(instanceId).run();
        await env.BPMN_DB.prepare("DELETE FROM timer_wait WHERE instance_id = ? AND fired = 0").bind(instanceId).run();

        await env.BPMN_DB.prepare(
          `INSERT INTO activity_event (instance_id, activity_id, event_type, payload_json, occurred_at)
           VALUES (?, '__cancel__', 'error', ?, ?)`
        ).bind(instanceId, JSON.stringify({ reason, by: str((ctx as any)?.did ?? ""), stopError: stopError ?? null }), now).run();

        await emitOcelEvent(db, {
          instanceId, processId: inst.process_id, activityId: "__cancel__", eventType: "error",
          attributes: { reason, by: str((ctx as any)?.did ?? ""), stopError: stopError ?? null },
          occurredAt: now,
        });

        await writeRecord(db, "instance", instanceId, {
          instanceId, state: "terminated", cancelledAt: now, reason,
        });

        return { instanceId, state: "terminated", cancelledAt: now, stopError };
      },
      asAgentTool("DESTRUCTIVE. Cancel a running instance via bpmn-elements definition.stop()."),
      withCapabilityTags("bpmn", "instance", "cancel", "destructive"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.listProcesses"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const limit = Math.min(Number(params?.limit ?? 50), 200);
        const includeDeprecated = Boolean(params?.includeDeprecated ?? false);
        const rows = await env.BPMN_DB.prepare(
          `SELECT process_id, name, version, deployed_at, deployed_by, deprecated FROM process
           WHERE deprecated <= ? ORDER BY deployed_at DESC LIMIT ?`
        ).bind(includeDeprecated ? 1 : 0, limit).all();
        return { processes: rows.results, limit };
      },
      asAgentTool("List deployed processes."),
      withCapabilityTags("bpmn", "process", "list"),
    );

    sdk.app.command(nsid("com.etzhayyim.apps.bpmn.listInstances"),
      async (_ctx, _p: any) => {
        const params = decodeParams(_p);
        const processId = str(params?.processId ?? "");
        const state = str(params?.state ?? "");
        const limit = Math.min(Number(params?.limit ?? 50), 500);
        const sql = `SELECT instance_id, process_id, state, correlation_key, started_at, completed_at, error_code FROM instance WHERE 1=1${processId ? " AND process_id = ?" : ""}${state ? " AND state = ?" : ""} ORDER BY started_at DESC LIMIT ?`;
        const stmt = env.BPMN_DB.prepare(sql);
        const args: any[] = [];
        if (processId) args.push(processId);
        if (state) args.push(state);
        args.push(limit);
        const rows = await stmt.bind(...args).all();
        return { instances: rows.results, limit };
      },
      asAgentTool("List process instances, optionally filtered by processId and state."),
      withCapabilityTags("bpmn", "instance", "list"),
    );

});

export default {
  fetch: (worker as any).fetch,
  async scheduled(_event: any, env: any, ctx: any) {
    const task = cronSweepExpiredTimers(env).then(r =>
      console.log(`[bpmn cron] swept: fired=${r.fired} failed=${r.failed}`));
    if (ctx?.waitUntil) ctx.waitUntil(task); else await task;
  },
};
