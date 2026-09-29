# etzhayyim-project-bpmn

BPMN repository for bpmn.etzhayyim.com — publish, search, and generate BPMN diagrams from resources, tsukuru, isco, and apqc domains.

## Architecture

```
Browser → bpmn.etzhayyim.com (static delivery)
       → API → /etzhayyim.bpmn.v1.BpmnCommandService/... + /etzhayyim.bpmn.v1.BpmnQueryService/...
                  ↓
           App: etzhayyim-wasm-bpmn-bx7qm9p4
             ├─ publish_bpmn / update_bpmn / archive_bpmn
             ├─ generate_bpmn (murakumo.etzhayyim.com LLM)
             ├─ list_bpmns / search_bpmns / get_bpmn
             └─ SQL graph → bpmn_definitions_current
```

## Component

| Component | Folder | Role |
|---|---|---|
| bpmn-api | `wasm/etzhayyim-wasm-bpmn-bx7qm9p4/` | XRPC API + static SPA |

## Source Domains

| Domain | 意味 |
|---|---|
| `resources` | resources.etzhayyim.com の entity/resource BPMN |
| `tsukuru` | tsukuru.etzhayyim.com の製造・RFQ プロセス BPMN |
| `isco` | isco の職業・業務フロー BPMN |
| `apqc` | APQC Process Classification Framework BPMN |

## Arrow Tables

| Table | 用途 |
|---|---|
| `bpmn_definitions_current` | BPMN ドキュメント (xml, source_domain, category, status, tags_json) |

## Build & Deploy

```bash
cd 60-apps/etzhayyim-project-bpmn/wasm/etzhayyim-wasm-bpmn-bx7qm9p4/svelte
pnpm install && pnpm build
cd ..
e7m actor build .
e7m actor deploy .
```
