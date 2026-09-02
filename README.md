# app-bpmn

**`bpmn.etzhayyim.com` — the BPMN process plane: a registry of BPMN 2.0
process definitions, the instances started from them, and the per-activity
event log each instance leaves behind.**

Three things live here, and the most important fact about this repo is that
they do not agree with each other. Read the next section before trusting any
one of them.

| plane | path | what it is | substrate |
|---|---|---|---|
| **kotoba slice** | `kotoba/` | Reference implementation of the data model as 13 TypeScript functions over `@etzhayyim/sdk` (`e.write` / `e.read` against a PDS). Tested offline against `@etzhayyim/sdk-mock` | AT Protocol records, collections `com.etzhayyim.bpmn.{process,instance,activityLog}` |
| **XRPC adapter** | `xrpc-adapter/` | A Cloudflare Worker that maps `/xrpc/com.etzhayyim.bpmn.*` onto those 13 functions, one route per function | whatever the kotoba slice uses |
| **appview** | `appview/etzhayyim-wasm-bpmn-bx7qm9p4/` | The *pre-migration* actor: a `@etzhayyim/kotodama-host-sdk` Worker with its own BPMN subset **engine** (`engine.ts`, ~18 KB — serviceTask / gateways / timer / message events) | D1 (`BPMN_DB`, via Kysely) + R2 (`BPMN_XML_R2`) + Hyperdrive — the direct-DB pattern `MIGRATION-TODO.md` flags as a Charter §substrate violation |

The kotoba slice and the adapter are the *migrated* shape (Option B, PDS
writes). The appview is the thing that was actually running an engine, and it
is the only one of the three that executes a process rather than recording
that one was started. Nothing in this tree connects the engine to the PDS
model; that wiring is the "next operator task" `kotoba/README.md` names, and
it has not happened.

The instance state machine the kotoba slice enforces is
`pending → running → completed | failed | cancelled`
(`kotoba/src/types.ts:19`). What is actually guarded in code, as of this
tree: `signalInstance` refuses anything not `running` (and distinguishes
`instanceCancelled` from `instanceNotRunning`); `startInstance` refuses to
overwrite an existing record under its *generated* `instanceId` (the id is not
an input); `cancelInstance` **does not check the current state**
— cancelling an already-cancelled instance rewrites the record and answers
`cancelled` again. That last one is observed behaviour, not a claim that it is
correct.

## Layout

Thirty-four tracked files (`git ls-files | wc -l`, re-counted 2026-09-03 —
the Svelte-to-ClojureScript migration in `c4e2244` changed the count, and the
rows marked below were re-measured with it):

```
kotoba/                          13 functions, 12 tests (see docs/operator-quickstart.md)
  src/types.ts                   records, DIDs, rkeys, the state unions
  src/process.ts                 deployProcess listProcesses validateXml
                                 compileJsonToXml compileBpmn analyzeProcess
  src/instance.ts                startInstance getInstanceState listInstances
                                 signalInstance cancelInstance executePipeline
  src/activity.ts                getActivityLog
  test/bpmn.test.ts              instance tier only — see below
  package.json                   build = tsc, but there is no tsconfig.json (see below)
  CHARTER-RIDER.md               a symlink; dangling in this repo (see below)
xrpc-adapter/                    Cloudflare Worker, 13 routes, route = bpmn.etzhayyim.com/xrpc/*
appview/etzhayyim-wasm-bpmn-bx7qm9p4/
  src/app.ts                     kotodama-host-sdk actor, 10 commands, D1/R2
  src/engine.ts                  expression evaluator + the `bpmn-elements`
                                 driver (`runEngine`). The JSON authoring
                                 subset's ten step types are in `app.ts`
  cljs/                          reagent + re-frame + jp-go-dds shell; replaced
                                 the Svelte scaffold in `c4e2244`
  kotodama.jsonld                actor manifest (did:web:bpmn.etzhayyim.com)
CLAUDE.md                        describes a different, earlier design (see below)
MIGRATION-TODO.md                names app.ts as the substrate-boundary violation
migration.edn                    provenance: etzhayyim/root 60-apps/etzhayyim-project-bpmn @ 7a08afb
test/cross_plane_test.cljs       the disagreements below, checked instead of
                                 narrated (`nbb test/cross_plane_test.cljs`)
```

The prose in this README is the only place several of these facts are
written down, and prose does not notice when it stops being true — the file
count and the `svelte/` row above were both stale within nine days. The
cross-plane facts (routes against exports, the two NSID bases, the two JSON
vocabularies, the manifest against the tree) are checked by
`test/cross_plane_test.cljs`, which exits 0, 1, or **2 when it cannot see
what it reads** — a checker blind to its input must not report "clean".

## Read this before trusting the rest of the tree

This repo was extracted from `etzhayyim/root` (`60-apps/etzhayyim-project-bpmn`,
see `migration.edn`) and **most of the prose in it describes either the
pre-extraction layout or a design that this tree never contained.** Every
row below was measured on 2026-08-23 against commit `1609b78`; the commands are
in `docs/operator-quickstart.md` §2.

| What a reader would conclude | What the tree actually contains |
|---|---|
| `CLAUDE.md`: bpmn.etzhayyim.com is a BPMN *repository* — `publish_bpmn` / `search_bpmns` / `generate_bpmn` over an Arrow table `bpmn_definitions_current`, with source domains `resources` / `tsukuru` / `isco` / `apqc` | **None of those identifiers appear anywhere in the source** (`grep -c` = 0 in `app.ts`). The actor here is a registry **+ executor** (`deployProcess` / `startInstance` / `signalInstance` …) over D1 and R2. `CLAUDE.md` describes a design this tree does not implement |
| `CLAUDE.md` component table: `wasm/etzhayyim-wasm-bpmn-bx7qm9p4/`; build steps `cd 60-apps/…/wasm/…/svelte && pnpm build && e7m actor build .` | There is **no `wasm/` and no `60-apps/`**. The component is under `appview/`. No `e7m` tool is referenced anywhere else in the tree |
| `kotoba/README.md`: 13 XRPC commands, "All 13 canonical bpmn lexicons now have kotoba reference impl", `validateXml` = "XSD + Schematron validation", `analyzeProcess` = "OCEL process mining (KPIs + LLM)" | 13 functions exist and are exported. `validateXml` is four substring checks (`<bpmn:process` present, starts with `<`, open/close tag counts match) — no XSD, no Schematron. `analyzeProcess` returns `eventCount: 0, caseCount: 0` unconditionally and says so in a comment (`// Placeholder`). `executePipeline` is likewise a placeholder. `compileBpmn` hashes with a comment "simple hash for demo" |
| `kotoba/README.md` links `../../../90-docs/adr/2605203000-…` and sibling `../../etzhayyim-project-anime/kotoba/` | Neither path exists from this repo. They resolved inside `etzhayyim/root` |
| `kotoba/CHARTER-RIDER.md` is a file | It is a symlink to `../../../CHARTER-RIDER.md`, which resolved to the root of `etzhayyim/root` and **dangles here** (`test -e` fails). `NOTICE` still says "see CHARTER-RIDER.md" |
| The three planes expose the same XRPC surface | They do not — see the next section |
| `xrpc-adapter/package.json` can be installed with `npm install` | It declares `"@etzhayyim/bpmn-kotoba": "workspace:*"`, a pnpm/yarn workspace protocol; there is no workspace root in this repo and npm rejects the protocol outright (`EUNSUPPORTEDPROTOCOL`) — `docs/operator-quickstart.md` §7 |
| `kotoba/package.json`: `"build": "tsc"`, `"main": "./dist/index.js"` | There is **no `tsconfig.json` in `kotoba/`**, so `npm run build` prints `tsc`'s help and exits 1; `dist/` is never produced and the declared entry point does not exist. The suite passes because vitest reads `src/` directly (`docs/operator-quickstart.md` §5) |
| `migration.edn`: `:tracked-files 31` | 33 before this README and quickstart were added; the two extra are the `:allowed-additions` (`README.edn`, `migration.edn`), so the number is consistent — it counts the *source* tree |

### The three planes expose three different surfaces

| | NSID base | count | only here |
|---|---|---|---|
| appview `src/app.ts` | `com.etzhayyim.apps.bpmn.*` | 10 | — |
| xrpc-adapter `src/index.ts` | `com.etzhayyim.bpmn.*` | 13 | `analyzeProcess`, `compileBpmn`, `executePipeline` |
| kotoba `src/index.ts` | (functions; collections under `com.etzhayyim.bpmn.*`) | 13 | same three |

Two consequences an operator should know:

- **The NSID base differs.** A client written against the deployed appview
  (`com.etzhayyim.apps.bpmn.startInstance`) gets `MethodNotFound` from the
  adapter, and vice-versa. The route pattern in `wrangler.jsonc`
  (`bpmn.etzhayyim.com/xrpc/*`) is the same host the appview serves, so the
  two cannot both be live on it.
- **The three commands the adapter adds are the three that do nothing yet.**
  `analyzeProcess`, `compileBpmn`, `executePipeline` are the placeholder
  functions described above. The adapter's "13 endpoints" is 10 real + 3
  stubs.

**None of these are fixed here, on purpose.** Each requires deciding which
plane is canonical — whether the engine-bearing appview or the PDS-model
kotoba slice is the product — and that is a decision this tree does not
settle. They are recorded so the next reader does not have to rediscover
them, and so that a green test suite is not mistaken for agreement between
the planes.

### What the test suite does and does not cover

`kotoba/test/bpmn.test.ts` has 12 tests, all on the **instance tier**
(`startInstance`, `getInstanceState`, `listInstances`, `signalInstance`,
`cancelInstance`). `deployProcess`, `listProcesses`, `validateXml`,
`compileJsonToXml`, `compileBpmn`, `analyzeProcess`, `executePipeline`, and
`getActivityLog` have no test. Eight of thirteen functions are untested, and
the three placeholders are among them.

## Getting started

`docs/operator-quickstart.md` — every command there was walked, and the output
pasted into it is the output it produced.
