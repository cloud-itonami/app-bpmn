import { createAuthedEtzhayyim, extractBearerToken, type Etzhayyim } from "@etzhayyim/sdk-auth";
import * as bpmnRwFree from "@etzhayyim/bpmn-kotoba";
interface Env { ACTOR_DID: string; PDS_URL: string; L2_RPC_URL: string; PDS_ACCESS_JWT?: string; PDS_REFRESH_JWT?: string; }
type Handler = (e: Etzhayyim, input: unknown) => Promise<unknown>;
const NSID_BASE = "com.etzhayyim.bpmn";
interface RouteConfig { method: "POST" | "GET"; handler: Handler; }
const routes: Record<string, RouteConfig> = {
  [`${NSID_BASE}.deployProcess`]: { method: "POST", handler: (e, input) => bpmnRwFree.deployProcess(e, input as any) },
  [`${NSID_BASE}.listProcesses`]: { method: "GET", handler: (e, input) => bpmnRwFree.listProcesses(e, input as any) },
  [`${NSID_BASE}.validateXml`]: { method: "POST", handler: (e, input) => bpmnRwFree.validateXml(e, input as any) },
  [`${NSID_BASE}.compileJsonToXml`]: { method: "POST", handler: (e, input) => bpmnRwFree.compileJsonToXml(e, input as any) },
  [`${NSID_BASE}.compileBpmn`]: { method: "POST", handler: (e, input) => bpmnRwFree.compileBpmn(e, input as any) },
  [`${NSID_BASE}.analyzeProcess`]: { method: "POST", handler: (e, input) => bpmnRwFree.analyzeProcess(e, input as any) },
  [`${NSID_BASE}.startInstance`]: { method: "POST", handler: (e, input) => bpmnRwFree.startInstance(e, input as any) },
  [`${NSID_BASE}.getInstanceState`]: { method: "GET", handler: (e, input) => bpmnRwFree.getInstanceState(e, input as any) },
  [`${NSID_BASE}.listInstances`]: { method: "GET", handler: (e, input) => bpmnRwFree.listInstances(e, input as any) },
  [`${NSID_BASE}.signalInstance`]: { method: "POST", handler: (e, input) => bpmnRwFree.signalInstance(e, input as any) },
  [`${NSID_BASE}.cancelInstance`]: { method: "POST", handler: (e, input) => bpmnRwFree.cancelInstance(e, input as any) },
  [`${NSID_BASE}.executePipeline`]: { method: "POST", handler: (e, input) => bpmnRwFree.executePipeline(e, input as any) },
  [`${NSID_BASE}.getActivityLog`]: { method: "GET", handler: (e, input) => bpmnRwFree.getActivityLog(e, input as any) },
};
function mapStatus(status?: string): number {
  if (status === "rejected") return 400;
  if (status === "notFound" || status === "invalidProcess") return 400;
  if (status === "alreadyExists" || status === "alreadyRunning") return 200;
  return 200;
}
function jsonResponse(body: unknown, status: number = 200, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...init?.headers }, ...init });
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/xrpc/")) return jsonResponse({ error: "NotFound" }, 404);
    const nsid = url.pathname.slice("/xrpc/".length);
    const route = routes[nsid];
    if (!route) return jsonResponse({ error: "MethodNotFound", nsid }, 404);
    if (req.method !== route.method) return jsonResponse({ error: "MethodNotAllowed" }, 405);
    const bearerToken = extractBearerToken(req);
    const e = createAuthedEtzhayyim({ env: { ACTOR_DID: env.ACTOR_DID, PDS_URL: env.PDS_URL, L2_RPC_URL: env.L2_RPC_URL, PDS_ACCESS_JWT: env.PDS_ACCESS_JWT, PDS_REFRESH_JWT: env.PDS_REFRESH_JWT }, bearerToken });
    let input: unknown;
    try {
      if (route.method === "POST") { input = await req.json().catch(() => ({})); }
      else { input = Object.fromEntries(url.searchParams.entries()); const typed = input as Record<string, unknown>; if (typed.limit) typed.limit = Number(typed.limit); if (typed.offset) typed.offset = Number(typed.offset); if (typed.depth) typed.depth = Number(typed.depth); }
    } catch (err) { return jsonResponse({ error: "InvalidInput", message: `Failed to parse ${route.method === "POST" ? "JSON" : "query params"}` }, 400); }
    try { const result = await route.handler(e, input); const status = mapStatus((result as Record<string, unknown>)?.status as string | undefined); return jsonResponse(result, status); }
    catch (err) { const message = err instanceof Error ? err.message : String(err); return jsonResponse({ error: "InternalError", message, nsid }, 500); }
  },
} satisfies ExportedHandler<Env>;
