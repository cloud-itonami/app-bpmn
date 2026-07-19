# bpmn XRPC Adapter

CF Worker that exposes the 13 kotoba commands as XRPC endpoints.

## Endpoints

**Process (6):**
- `POST /xrpc/com.etzhayyim.bpmn.deployProcess` — deploy BPMN
- `GET /xrpc/com.etzhayyim.bpmn.listProcesses` — list processes
- `POST /xrpc/com.etzhayyim.bpmn.validateXml` — validate XML
- `POST /xrpc/com.etzhayyim.bpmn.compileJsonToXml` — JSON→XML
- `POST /xrpc/com.etzhayyim.bpmn.compileBpmn` — compile
- `POST /xrpc/com.etzhayyim.bpmn.analyzeProcess` — analyze

**Instance (6):**
- `POST /xrpc/com.etzhayyim.bpmn.startInstance` — start
- `GET /xrpc/com.etzhayyim.bpmn.getInstanceState` — state
- `GET /xrpc/com.etzhayyim.bpmn.listInstances` — list
- `POST /xrpc/com.etzhayyim.bpmn.signalInstance` — signal
- `POST /xrpc/com.etzhayyim.bpmn.cancelInstance` — cancel
- `POST /xrpc/com.etzhayyim.bpmn.executePipeline` — pipeline

**Activity (1):**
- `GET /xrpc/com.etzhayyim.bpmn.getActivityLog` — audit log

## Setup & Deploy

```bash
cd 60-apps/etzhayyim-project-bpmn/xrpc-adapter
npm install && wrangler deploy
```

See ADR-2605210000 for design context.
