# Operator quickstart

Every command below was walked on 2026-08-23 from a clean checkout of
`main` at `1609b78`; the output pasted here is the output it produced. If a
step does not reproduce, that is a finding — say so rather than adjusting the
doc to match.

One step needs npm and does not work under every `~/.npmrc`; see
[a note on npm](#a-note-on-npm) before you start.

What you can reach from here: the `kotoba/` reference implementation — the
data model, the instance state machine, and its validators — runs entirely
offline against a mock substrate. **Neither Worker is exercised by any of
this**: the appview needs D1/R2/Hyperdrive bindings and the XRPC adapter
cannot even be installed as shipped (§6). The three planes do not expose the
same operations (see `README.md`).

---

## 1. Read the state machine without installing anything

No toolchain needed. The state union and the one guard that enforces it:

```bash
grep -n 'InstanceState =' kotoba/src/types.ts
grep -n 'instanceCancelled' kotoba/src/instance.ts
```

```
19:export type InstanceState = "pending" | "running" | "completed" | "failed" | "cancelled";
184:      error: r.value?.state === "cancelled" ? "instanceCancelled" : "instanceNotRunning",
```

Line 184 is inside `signalInstance`: a signal to anything that is not
`running` is rejected, and a cancelled instance gets its own error name.
`cancelInstance` (same file, from line 214) has no such guard — it reads the
record, sets `state: "cancelled"`, writes, and returns `cancelled` whatever
the prior state was. The suite in §4 exercises the first; nothing exercises
the second.

## 2. Confirm the three planes disagree

This is the fastest way to see the findings recorded in `README.md`, and it
needs no install.

**2a. The adapter routes three commands the appview does not have:**

```bash
comm -3 \
  <(grep -oE 'nsid\("com\.etzhayyim\.apps\.bpmn\.[A-Za-z]+"\)' \
      appview/etzhayyim-wasm-bpmn-bx7qm9p4/src/app.ts \
      | sed -E 's/.*bpmn\.([A-Za-z]+).*/\1/' | sort -u) \
  <(grep -oE 'NSID_BASE}\.[A-Za-z]+' xrpc-adapter/src/index.ts \
      | sed 's/NSID_BASE}\.//' | sort -u)
```

```
	analyzeProcess
	compileBpmn
	executePipeline
```

Left column = appview only (empty), right column = adapter only. The other
ten names are shared.

**2b. …under a different NSID base:**

```bash
grep -ohE '"com\.etzhayyim\.(apps\.)?bpmn' \
  appview/etzhayyim-wasm-bpmn-bx7qm9p4/src/app.ts xrpc-adapter/src/index.ts \
  | sort | uniq -c
```

```
  10 "com.etzhayyim.apps.bpmn
   1 "com.etzhayyim.bpmn
```

The appview registers every command as `com.etzhayyim.apps.bpmn.<name>`;
the adapter builds every route from `NSID_BASE = "com.etzhayyim.bpmn"`. A
client of one gets `MethodNotFound` from the other.

**2c. The three adapter-only commands are the placeholders:**

```bash
grep -n 'Placeholder' kotoba/src/process.ts kotoba/src/instance.ts
```

```
kotoba/src/instance.ts:264:  // Placeholder: in full impl, would invoke actor via MCP or invoke() interface
kotoba/src/process.ts:277:  // Placeholder: in a full impl, this would query audit logs from vertex_repo_commit
kotoba/src/process.ts:313:  // Placeholder: simple hash for demo
```

Line 264 is `executePipeline`, 277 is `analyzeProcess`, 313 is the hash
`compileBpmn` uses for its manifest digest.

**2d. `CLAUDE.md` describes a design that is not in the tree:**

```bash
grep -cE 'publish_bpmn|search_bpmns|generate_bpmn|bpmn_definitions_current' \
  appview/etzhayyim-wasm-bpmn-bx7qm9p4/src/app.ts
ls -d wasm 60-apps
```

```
0
ls: 60-apps: No such file or directory
ls: wasm: No such file or directory
```

Zero hits for any of the operations or the Arrow table `CLAUDE.md` names;
neither of the two directory prefixes its build steps `cd` into exists.

**2e. The Charter rider is a dangling symlink:**

```bash
readlink kotoba/CHARTER-RIDER.md; test -e kotoba/CHARTER-RIDER.md; echo "exit=$?"
```

```
../../../CHARTER-RIDER.md
exit=1
```

Three levels up from `kotoba/` was the root of `etzhayyim/root`, where the
rider lived. From this repo it points outside the checkout.

## 3. Install

```bash
cd kotoba
npm install
```

Expect this to be slow. Both `@etzhayyim/sdk` and `@etzhayyim/sdk-mock` are
git dependencies that ship no `dist/` and compile through a `prepare`
script, so a cold install builds them — and the six `kotoba-lang/*` git
dependencies under `@etzhayyim/sdk` — from source. On this workstation
(node v26.3.0, npm 11.16.0) at load average 39 when it started (47 ten minutes in) it took **27m21s** wall clock
and reported `added 137 packages`. The same install in the sibling repo
`cloud-itonami/app-scheduler` took 12m57s at load ~20 the same day, so most of
that is the machine, not the package. If you wrap it in a timeout, give it
room: a 400 s timeout would have killed it with nothing to show.

If it fails with `EALLOWSCRIPTS`, read [the note below](#a-note-on-npm) —
the fix is a flag, not a different machine.

There are five direct dependencies:

```bash
npm ls --depth=0
```

```
@etzhayyim/bpmn-kotoba@1.0.0 /path/to/app-bpmn/kotoba
+-- @etzhayyim/sdk-mock@0.1.0 (git+ssh://git@github.com/etzhayyim/com-etzhayyim-sdk-mock.git#c857ff9be5310bf433bfe1e8d3c0f677e213d667)
+-- @etzhayyim/sdk@0.1.0-alpha (git+ssh://git@github.com/etzhayyim/com-etzhayyim-sdk.git#12314a0cc5ac2feb49dd9789d5c002398acb6988)
+-- @types/node@20.19.43
+-- typescript@5.9.3
`-- vitest@4.1.11
```

The two `@etzhayyim` commits are the ones pinned in `package.json` and do
not move; the other three are declared with `^` and float. `package.json`
pins the git dependencies over `git+https`; npm reports them back as
`git+ssh`. Which transport is actually used was not tested — this machine
has GitHub SSH configured, so a host without it may behave differently.

The repo has no `.gitignore`, so after this step `git status` shows
`kotoba/node_modules/` and `kotoba/package-lock.json` as untracked. That is
expected; neither is committed here.

## 4. Run the suite

```bash
npx vitest run --reporter=verbose
```

All twelve pass, and the test names are the specification of the instance
tier:

```
 ✓ test/bpmn.test.ts > bpmn kotoba > startInstance state machine > startInstance initializes with running status 49ms
 ✓ test/bpmn.test.ts > bpmn kotoba > startInstance state machine > rejects startInstance without processId 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > startInstance state machine > supports optional variables and correlationKey 1ms
 ✓ test/bpmn.test.ts > bpmn kotoba > cancelInstance transitions to cancelled state > cancelInstance sets state to cancelled 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > cancelInstance transitions to cancelled state > cancelInstance rejects non-existent instance 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > signalInstance requires running state > signalInstance rejects if instance not found 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > signalInstance requires running state > signalInstance requires messageName 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > signalInstance requires running state > signalInstance succeeds on running instance 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > signalInstance requires running state > signalInstance rejects after cancellation 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > listInstances filter by processId and state > lists all instances 1ms
 ✓ test/bpmn.test.ts > bpmn kotoba > listInstances filter by processId and state > filters instances by processId 0ms
 ✓ test/bpmn.test.ts > bpmn kotoba > listInstances filter by processId and state > filters instances by state 0ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Note what is absent: nothing in this list touches `deployProcess`,
`listProcesses`, `validateXml`, `compileJsonToXml`, `compileBpmn`,
`analyzeProcess`, `executePipeline`, or `getActivityLog`. A green run here
says nothing about the process tier or the activity log.

## 5. Typecheck — and why `npm run build` cannot work

`kotoba/package.json` declares `"build": "tsc"` and points `main` at
`./dist/index.js`. There is no `tsconfig.json` in `kotoba/`, so:

```bash
npm run build
```

```
> @etzhayyim/bpmn-kotoba@1.0.0 build
> tsc
Version 5.9.3
tsc: The TypeScript Compiler - Version 5.9.3
COMMON COMMANDS
  …
```

exit 1 — `tsc` with no project and no files prints its help. `dist/` is
never produced, so the package's declared entry point does not exist. The
suite in §4 passes because vitest transforms `src/` directly and never
consults `main`. (`xrpc-adapter/` does have a `tsconfig.json`; `kotoba/`
does not.)

To typecheck anyway, hand `tsc` the entry files and a minimal config on the
command line. These flags are this document's choice, not the repo's:

```bash
npx tsc --noEmit --strict --target es2022 --module nodenext \
  --moduleResolution nodenext --skipLibCheck src/index.ts test/bpmn.test.ts
```

Clean — no output, exit 0. Treat that as "the code typechecks under *a*
strict config", not as the project's contract.

## 6. Watch the state machine hold

The single invariant the instance tier enforces is that a cancelled instance
stops accepting signals. That is one test, and you can run it alone:

```bash
npx vitest run -t "rejects after cancellation"
```

```
 Test Files  1 passed (1)
      Tests  1 passed | 11 skipped (12)
```

The `11 skipped` is what tells you the filter matched exactly one test — a
run reporting `12 passed` here would mean the filter silently did nothing.

What that test actually does (`test/bpmn.test.ts`): it starts an instance,
cancels it, then sends `signalInstance` with `messageName: "late-msg"` and
asserts only `status === "rejected"`. It does **not** assert the error name,
so the `instanceCancelled` / `instanceNotRunning` distinction at
`instance.ts:184` (§1) is implemented but not pinned by any test.

## 7. The XRPC adapter cannot be installed as shipped

`xrpc-adapter/package.json` declares
`"@etzhayyim/bpmn-kotoba": "workspace:*"`. That is the pnpm / yarn workspace
protocol; there is no workspace root (no `pnpm-workspace.yaml`, no root
`package.json` with `workspaces`) in this repo, and npm does not support the
protocol at all. Measured two ways:

With the adapter's `package.json` as-is, `npm install` spent **9m50s**
preparing the two git dependencies that come *before* the `workspace:` one
and was killed by a 590 s timeout having printed nothing — so the protocol
error is not the first thing you hit, and a short timeout tells you nothing.

With a `package.json` containing only the `workspace:*` line, the answer is
immediate:

```bash
mkdir /tmp/ws-probe && cd /tmp/ws-probe
printf '{"name":"ws-probe","version":"0.0.0","private":true,"dependencies":{"@etzhayyim/bpmn-kotoba":"workspace:*"}}\n' > package.json
npm install
```

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

So `xrpc-adapter/README.md`'s `npm install && wrangler deploy` cannot run
from this repo with npm. Whether pnpm would accept it once a workspace root
is added was not tested here. The `wrangler deploy` half was not attempted:
the route it would claim (`bpmn.etzhayyim.com/xrpc/*`) is the host the
appview serves, and nothing in this tree decides which of the two should own
it.

## A note on npm

If `npm install` fails like this:

```
npm error code 1
npm error git dep preparation failed
npm error npm error code EALLOWSCRIPTS
npm error npm error --allow-scripts is not allowed in project-scoped installs.
```

…the cause is an `allow-scripts[]` entry in your **user-level** `~/.npmrc`,
not the npm version and not this repo. npm propagates the entry into the
nested install it runs to prepare a git dependency, and that nested install
rejects it as project-scoped. This machine's `~/.npmrc` has such an entry,
and the install in §3 was run with a user config that does not:

```bash
printf 'strict-ssl=false\n' > /tmp/clean-npmrc
npm install --userconfig /tmp/clean-npmrc
```

The full measurement (three user-config variants, npm 11.16.0) is in
`cloud-itonami/app-scheduler/docs/operator-quickstart.md` § "A note on
npm"; the failure mode is the same package pair (`@etzhayyim/sdk` +
`@etzhayyim/sdk-mock`) and was not re-measured here.

## What is not covered here

Deliberately, because none of it was walked:

- **The appview.** `appview/etzhayyim-wasm-bpmn-bx7qm9p4/src/app.ts` is a
  `@etzhayyim/kotodama-host-sdk` Worker that needs `BPMN_DB` (D1),
  `BPMN_XML_R2` (R2) and `HYPERDRIVE` bindings, and imports
  `@etzhayyim/graph-schema` and `kysely`. It has no `package.json` of its
  own in this tree (the only one under `appview/` is the Svelte
  scaffold's), so there is no documented way to build or typecheck it from
  here. Its engine (`engine.ts`) is the only code in the repo that runs a
  process, and nothing above exercises it.
- **The Svelte UI.** `appview/…/svelte/` depends on
  `@etzhayyim/design-system: "workspace:*"` (same problem as §7) and its
  `App.svelte` is a one-line placeholder.
- **`CLAUDE.md`'s build steps.** They `cd` into `60-apps/…/wasm/…` and
  call `e7m`; neither the paths (§2d) nor the tool exist here.
- **Anything against a real PDS.** Every step above runs against
  `@etzhayyim/sdk-mock`. No network substrate is contacted, and no real DID
  is resolved.
