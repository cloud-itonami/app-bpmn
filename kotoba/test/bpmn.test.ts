import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  startInstance,
  getInstanceState,
  signalInstance,
  cancelInstance,
  listInstances,
} from "../src/index.js";

describe("bpmn kotoba", () => {
  let e: any;

  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:bpmn.etzhayyim.com" });
  });

  describe("startInstance state machine", () => {
    it("startInstance initializes with running status", async () => {
      const result = await startInstance(e, {
        processId: "process-1",
      });

      expect(result.status).toBe("started");
      expect(result.instanceUri).toBeDefined();
      expect(result.instanceId).toBeDefined();
      expect(result.state).toBe("running");
    });

    it("rejects startInstance without processId", async () => {
      const result = await startInstance(e, {
        processId: "",
      });

      expect(result.status).toBe("rejected");
      expect(result.error).toBe("missingProcessId");
    });

    it("supports optional variables and correlationKey", async () => {
      const result = await startInstance(e, {
        processId: "process-2",
        variables: { key: "value" },
        correlationKey: "corr-123",
      });

      expect(result.status).toBe("started");
      const instance = await getInstanceState(e, {
        instanceId: result.instanceId!,
      });
      expect(instance.instance?.variables).toBeDefined();
    });
  });

  describe("cancelInstance transitions to cancelled state", () => {
    it("cancelInstance sets state to cancelled", async () => {
      const started = await startInstance(e, {
        processId: "cancel-test",
      });

      const result = await cancelInstance(e, {
        instanceId: started.instanceId!,
      });

      expect(result.status).toBe("cancelled");
      expect(result.state).toBe("cancelled");
      expect(result.cancelledAt).toBeDefined();
    });

    it("cancelInstance rejects non-existent instance", async () => {
      const result = await cancelInstance(e, {
        instanceId: "nonexistent",
      });

      expect(result.status).toBe("rejected");
      expect(result.error).toBe("notFound");
    });
  });

  describe("signalInstance requires running state", () => {
    it("signalInstance rejects if instance not found", async () => {
      const result = await signalInstance(e, {
        instanceId: "nonexistent",
        messageName: "msg-1",
      });

      expect(result.status).toBe("rejected");
      expect(result.error).toBe("notFound");
    });

    it("signalInstance requires messageName", async () => {
      const started = await startInstance(e, {
        processId: "signal-test",
      });

      const result = await signalInstance(e, {
        instanceId: started.instanceId!,
        messageName: "",
      });

      expect(result.status).toBe("rejected");
      expect(result.error).toBe("missingMessageName");
    });

    it("signalInstance succeeds on running instance", async () => {
      const started = await startInstance(e, {
        processId: "signal-test-2",
      });

      const result = await signalInstance(e, {
        instanceId: started.instanceId!,
        messageName: "test-msg",
        payload: { data: "test" },
      });

      expect(result.status).toBe("signalled");
      expect(result.accepted).toBe(true);
    });

    it("signalInstance rejects after cancellation", async () => {
      const started = await startInstance(e, {
        processId: "signal-test-3",
      });

      await cancelInstance(e, { instanceId: started.instanceId! });

      const result = await signalInstance(e, {
        instanceId: started.instanceId!,
        messageName: "late-msg",
      });

      expect(result.status).toBe("rejected");
    });
  });

  describe("listInstances filter by processId and state", () => {
    beforeEach(async () => {
      await startInstance(e, { processId: "proc-a" });
      await startInstance(e, { processId: "proc-a" });
      await startInstance(e, { processId: "proc-b" });
    });

    it("lists all instances", async () => {
      const result = await listInstances(e, {});
      expect(result.instances.length).toBeGreaterThanOrEqual(3);
    });

    it("filters instances by processId", async () => {
      const result = await listInstances(e, { processId: "proc-a" });
      expect(result.instances.length).toBe(2);
      expect(result.instances.every((i) => i.processId === "proc-a")).toBe(
        true
      );
    });

    it("filters instances by state", async () => {
      const started = await startInstance(e, { processId: "proc-c" });
      await cancelInstance(e, { instanceId: started.instanceId! });

      const running = await listInstances(e, { state: "running" });
      expect(running.instances.every((i) => i.state === "running")).toBe(true);
    });
  });
});
