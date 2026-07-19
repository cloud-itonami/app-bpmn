// ─────────────────────────────────────────────────────────────────────────
// bpmn-elements glue (Phase 5b, Option A)
//
// Directly uses bpmn-elements (CF-Worker-compatible) instead of bpmn-engine
// (which imports createRequire + fileURLToPath at module init, rejected by
// the CF bundler).
//
// Surface matches prior runEngine() stub:
//   runEngine(env, xml, variables, savedState?, signal?) → { state, completed, waiting, error }
//
// serviceTask dispatch: activity.name attr holds the NSID
// (e.g. "com.etzhayyim.apps.playwright.goto"). We intercept via broker subscribe
// on 'activity.execute' and call the target actor's service binding with
// the merged variables + step params.
// ─────────────────────────────────────────────────────────────────────────

import * as Elements from "bpmn-elements";
import { BpmnModdle } from "bpmn-moddle";
import Serializer, { TypeResolver } from "moddle-context-serializer";

export interface EngineResult {
  state: any;
  completed: boolean;
  waiting: Array<{ activityId: string; messageName: string }>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Minimal expression parser + evaluator (CF Workers disallow `new Function`)
// ─────────────────────────────────────────────────────────────────────────
type Ast =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "path"; parts: string[] }
  | { t: "unop"; op: string; a: Ast }
  | { t: "binop"; op: string; a: Ast; b: Ast };

function parseExpression(src: string): Ast {
  let i = 0;
  const peek = () => src[i];
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const match = (s: string) => {
    skipWs();
    if (src.slice(i, i + s.length) === s) { i += s.length; return true; }
    return false;
  };

  const parsePrimary = (): Ast => {
    skipWs();
    if (peek() === "(") { i++; const e = parseOr(); skipWs(); if (src[i] !== ")") throw new Error(") expected"); i++; return e; }
    if (peek() === "!") { i++; return { t: "unop", op: "!", a: parsePrimary() }; }
    if (peek() === "-") { i++; return { t: "unop", op: "-", a: parsePrimary() }; }
    // string
    if (peek() === "'" || peek() === '"') {
      const q = src[i++]; let s = "";
      while (i < src.length && src[i] !== q) { s += src[i++]; }
      if (src[i] !== q) throw new Error("unterminated string");
      i++;
      return { t: "str", v: s };
    }
    // number
    const numMatch = src.slice(i).match(/^[0-9]+(?:\.[0-9]+)?/);
    if (numMatch) { i += numMatch[0].length; return { t: "num", v: Number(numMatch[0]) }; }
    // identifier / path
    const idMatch = src.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/);
    if (idMatch) {
      i += idMatch[0].length;
      const parts = idMatch[0].split(".");
      if (parts.length === 1) {
        if (parts[0] === "true") return { t: "bool", v: true };
        if (parts[0] === "false") return { t: "bool", v: false };
        if (parts[0] === "null") return { t: "null" };
      }
      return { t: "path", parts };
    }
    throw new Error(`unexpected char "${src[i]}" at ${i}`);
  };

  const parseMul = (): Ast => {
    let left = parsePrimary();
    while (true) {
      skipWs();
      if (match("*")) left = { t: "binop", op: "*", a: left, b: parsePrimary() };
      else if (match("/")) left = { t: "binop", op: "/", a: left, b: parsePrimary() };
      else if (match("%")) left = { t: "binop", op: "%", a: left, b: parsePrimary() };
      else break;
    }
    return left;
  };
  const parseAdd = (): Ast => {
    let left = parseMul();
    while (true) {
      skipWs();
      if (match("+")) left = { t: "binop", op: "+", a: left, b: parseMul() };
      else if (match("-")) left = { t: "binop", op: "-", a: left, b: parseMul() };
      else break;
    }
    return left;
  };
  const parseCmp = (): Ast => {
    let left = parseAdd();
    skipWs();
    if (match(">=")) return { t: "binop", op: ">=", a: left, b: parseAdd() };
    if (match("<=")) return { t: "binop", op: "<=", a: left, b: parseAdd() };
    if (match(">")) return { t: "binop", op: ">", a: left, b: parseAdd() };
    if (match("<")) return { t: "binop", op: "<", a: left, b: parseAdd() };
    return left;
  };
  const parseEq = (): Ast => {
    let left = parseCmp();
    skipWs();
    if (match("===")) return { t: "binop", op: "===", a: left, b: parseCmp() };
    if (match("!==")) return { t: "binop", op: "!==", a: left, b: parseCmp() };
    if (match("==")) return { t: "binop", op: "==", a: left, b: parseCmp() };
    if (match("!=")) return { t: "binop", op: "!=", a: left, b: parseCmp() };
    return left;
  };
  const parseAnd = (): Ast => {
    let left = parseEq();
    while (match("&&")) left = { t: "binop", op: "&&", a: left, b: parseEq() };
    return left;
  };
  const parseOr = (): Ast => {
    let left = parseAnd();
    while (match("||")) left = { t: "binop", op: "||", a: left, b: parseAnd() };
    return left;
  };

  const ast = parseOr();
  skipWs();
  if (i < src.length) throw new Error(`unexpected trailing "${src.slice(i)}"`);
  return ast;
}

function evalAst(ast: Ast, scope: any): any {
  switch (ast.t) {
    case "num": case "str": case "bool": return ast.v;
    case "null": return null;
    case "path": {
      let v: any = scope;
      for (const p of ast.parts) {
        if (v == null) return undefined;
        v = v[p];
      }
      return v;
    }
    case "unop": {
      const a = evalAst(ast.a, scope);
      if (ast.op === "!") return !a;
      if (ast.op === "-") return -a;
      return undefined;
    }
    case "binop": {
      const a = evalAst(ast.a, scope);
      const b = evalAst(ast.b, scope);
      switch (ast.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case ">": return a > b;
        case "<": return a < b;
        case ">=": return a >= b;
        case "<=": return a <= b;
        case "==": return a == b;
        case "!=": return a != b;
        case "===": return a === b;
        case "!==": return a !== b;
        case "&&": return a && b;
        case "||": return a || b;
      }
      return undefined;
    }
  }
}

async function buildContext(xml: string): Promise<any> {
  const moddle = new (BpmnModdle as any)();
  const moddleContext = await moddle.fromXML(xml);
  const types = (TypeResolver as any)(Elements);
  return (Serializer as any)(moddleContext, types);
}

/**
 * CF-Worker-compatible Scripts implementation for bpmn-elements.
 * bpmn-engine's default JavaScripts.js uses `node:vm.Script` which is
 * unavailable in Workers runtime — we use `new Function()` instead.
 * Supports sequenceFlow conditionExpression + scriptTask script eval,
 * JS-only (the only BPMN language anyone uses in practice).
 */
function createCFScripts(): any {
  const scripts = new Map<string, any>();
  // CF Workers disallow `new Function()` ("Code generation from strings
  // disallowed"), so compile expressions to an AST + interpreter. Supports
  // the subset needed by BPMN conditionExpression / simple scripts:
  //   - literals: numbers, strings, true/false/null
  //   - property paths: environment.variables.x, variables.x, content.y
  //   - comparisons: == != === !== < <= > >=
  //   - logical: && || !
  //   - arithmetic: + - * / %
  //   - parentheses
  const compileFn = (body: string) => {
    let source = body.trim();
    const exprMatch = source.match(/^\$\{([\s\S]*)\}$/);
    if (exprMatch) source = exprMatch[1];
    try {
      const ast = parseExpression(source);
      return (environment: any, variables: any, content: any) =>
        evalAst(ast, { environment, variables, content });
    } catch {
      return null;
    }
  };

  const buildScriptForActivity = (activity: any) => {
    const behaviour = activity?.behaviour ?? {};
    let scriptBody: string | undefined;
    let language: string | undefined;
    if (activity?.type === "bpmn:SequenceFlow") {
      if (!behaviour.conditionExpression) return null;
      language = behaviour.conditionExpression.language ?? "JavaScript";
      scriptBody = behaviour.conditionExpression.body;
    } else {
      language = behaviour.scriptFormat;
      scriptBody = behaviour.script;
    }
    if (!scriptBody) return null;
    if (language && !/^(javascript|js)$/i.test(language)) return null;
    const fn = compileFn(scriptBody);
    if (!fn) return null;
    return {
      script: fn,
      execute(scope: any, callback?: any) {
        try {
          const env = scope.environment ?? scope;
          const result = fn(env, env?.variables ?? {}, scope.content ?? {});
          if (callback) callback(null, result);
          return result;
        } catch (e: any) {
          if (callback) callback(e);
          else throw e;
        }
      },
    };
  };

  return {
    register(activity: any) {
      const script = buildScriptForActivity(activity);
      if (script && activity?.id) scripts.set(activity.id, script);
    },
    // Lazy: compile on demand if not pre-registered. bpmn-elements calls
    // getScript(language, flowActivity) at gateway evaluation time.
    getScript(_language: string, activity: any) {
      if (!activity?.id) return null;
      let s = scripts.get(activity.id);
      if (!s) {
        s = buildScriptForActivity(activity);
        if (s) scripts.set(activity.id, s);
      }
      return s ?? null;
    },
  };
}

/** Route serviceTask 'activity.execute' to the correct XRPC actor. */
function registerServiceDispatcher(definition: any, env: any) {
  const broker = definition.broker;
  broker.subscribeTmp("event", "activity.execute", async (_rk: string, msg: any) => {
    const content = msg?.content ?? {};
    if (content.type !== "bpmn:ServiceTask") return;
    const nsidStr: string = content.name ?? content.id ?? "";
    if (!nsidStr.startsWith("com.etzhayyim.apps.")) return;

    const parts = nsidStr.split(".");
    const actor = parts[3];
    const bindingKey = actor === "playwright" ? "PLAYWRIGHT_SERVICE"
      : actor === "cloudflareBrowserRender" ? "CF_BROWSER_RENDER"
      : actor === "shiharai" ? "SHIHARAI_SERVICE"
      : null;

    try {
      let result: any;
      if (!bindingKey || !env[bindingKey]) {
        result = { error: `no service binding for actor="${actor}" (nsid=${nsidStr})` };
      } else {
        const variables = definition.environment?.variables ?? {};
        const res = await env[bindingKey].fetch(new Request(`https://${actor}.etzhayyim.com/xrpc/${nsidStr}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(variables),
        }));
        result = await res.json();
      }
      // Fan the result back into the activity so the token advances.
      definition.signal({ id: content.id, result });
    } catch (e: any) {
      definition.signal({ id: content.id, result: { error: String(e?.message ?? e).slice(0, 300) } });
    }
  });
}

export async function runEngine(
  env: any,
  xml: string,
  variables: Record<string, unknown>,
  savedState?: unknown,
  signal?: { messageName: string; payload?: unknown },
): Promise<EngineResult> {
  const waiting: Array<{ activityId: string; messageName: string }> = [];

  try {
    const serializedContext = await buildContext(xml);
    // bpmn-elements expected setup: Environment + Context wrapping + Definition.
    const environment = new (Elements as any).Environment({
      scripts: createCFScripts(),
      variables,
      services: {
        xrpc: (_scope: any, next: any) => next(null, {}), // real dispatch via broker subscribe below
      },
    });
    const context = new (Elements as any).Context(serializedContext, environment);
    const definition: any = new (Elements as any).Definition(context);

    const endWaiter = new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };
      // Terminal events settle immediately
      definition.broker.subscribeTmp("event", "definition.end", () => settle());
      definition.broker.subscribeTmp("event", "definition.error", () => settle());
      definition.broker.subscribeTmp("event", "definition.stop", () => settle());
      // Wait states: give the broker 200ms to fully propagate state
      definition.broker.subscribeTmp("event", "activity.wait", () => setTimeout(settle, 200));
      definition.broker.subscribeTmp("event", "activity.timer", () => setTimeout(settle, 200));
      // Hard ceiling so the Worker never blocks indefinitely.
      // 2 seconds is enough for bpmn-elements to traverse a small process
      // and reach a stable wait/end state.
      setTimeout(settle, 2_000);
    });

    registerServiceDispatcher(definition, env);

    if (savedState) {
      definition.recover(savedState);
      definition.resume();
    } else {
      definition.run();
    }

    if (signal) {
      definition.signal({ id: signal.messageName });
    }

    await endWaiter;

    const state = definition.getState();
    // Extract waiting activities from state tree. Both message and timer
    // IntermediateCatchEvents in "executing" status are armed waits.
    let hasExecutingWait = false;
    try {
      const procs = state?.execution?.processes ?? [];
      const msgByActivity = extractMessageRefs(xml);
      const timersByActivity = extractTimerDurations(xml);
      for (const proc of procs) {
        const children = proc.execution?.children ?? [];
        for (const ch of children) {
          if (ch.status === "executing" && ch.type === "bpmn:IntermediateCatchEvent") {
            hasExecutingWait = true;
            const msgName = msgByActivity.get(ch.id);
            if (msgName) waiting.push({ activityId: ch.id, messageName: msgName });
            else if (timersByActivity.has(ch.id)) {
              waiting.push({ activityId: ch.id, messageName: `__timer__:${ch.id}` });
            }
          }
        }
      }
    } catch { /* ignore */ }

    // Completion check: derive from activity state tree rather than from
    // definition.status (which may not have been updated yet in the event
    // loop — broker events can settle after getState() snapshot).
    let completed = false;
    try {
      const procs = state?.execution?.processes ?? [];
      for (const proc of procs) {
        const children = proc.execution?.children ?? [];
        const endEvents = children.filter((c: any) => c.type === "bpmn:EndEvent");
        if (endEvents.length > 0 && endEvents.every((c: any) => (c.counters?.taken ?? 0) > 0)) {
          completed = true;
          break;
        }
      }
      // Fallback: no executing waits + no pending broker messages → completed
      if (!completed && !hasExecutingWait && !definition.broker.queueMessageCount) {
        completed = true;
      }
    } catch { /* ignore */ }
    return { state, completed, waiting };
  } catch (e: any) {
    return { state: null, completed: false, waiting: [], error: String(e?.message ?? e).slice(0, 500) };
  }
}

function extractMessageRefs(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const catchRe = /<bpmn:intermediateCatchEvent\s+id="([^"]+)"[^>]*>[\s\S]*?<bpmn:messageEventDefinition[^>]*messageRef="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = catchRe.exec(xml)) !== null) {
    out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Parse ISO 8601 duration (PT10M / PT1H / PT30S) → milliseconds.
 * Minimal subset: hours (H), minutes (M), seconds (S). No weeks/days/years.
 */
export function parseIso8601Duration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const hours = Number(m[1] ?? 0);
  const mins = Number(m[2] ?? 0);
  const secs = Number(m[3] ?? 0);
  return ((hours * 60 + mins) * 60 + secs) * 1000;
}

/** Extract timer durations per catchEvent activity (for timer_wait arming). */
export function extractTimerDurations(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  const rx = /<bpmn:intermediateCatchEvent\s+id="([^"]+)"[^>]*>[\s\S]*?<bpmn:timerEventDefinition>[\s\S]*?<bpmn:timeDuration>([^<]+)<\/bpmn:timeDuration>/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) {
    const ms = parseIso8601Duration(m[2].trim());
    if (ms > 0) out.set(m[1], ms);
  }
  return out;
}

/**
 * Stop a running/waiting instance cleanly: recover saved state, call
 * definition.stop() to emit proper cancellation events, then snapshot state.
 * Returns the final state snapshot + any broker-observed errors.
 */
export async function stopEngine(
  env: any,
  xml: string,
  variables: Record<string, unknown>,
  savedState: unknown,
  reason: string,
): Promise<{ state: any; error?: string }> {
  try {
    const serializedContext = await buildContext(xml);
    const environment = new (Elements as any).Environment({
      scripts: createCFScripts(),
      variables,
      services: {
        xrpc: (_scope: any, next: any) => next(null, {}),
      },
    });
    const context = new (Elements as any).Context(serializedContext, environment);
    const definition: any = new (Elements as any).Definition(context);

    definition.recover(savedState);
    definition.resume();
    // Emit stop — terminates all active scopes, publishes definition.stop event.
    definition.stop({ reason });
    // Allow broker to drain
    await new Promise(r => setTimeout(r, 50));

    return { state: definition.getState() };
  } catch (e: any) {
    return { state: null, error: String(e?.message ?? e).slice(0, 500) };
  }
}
