import test from "node:test";
import assert from "node:assert/strict";

import { AgentState, RecoveryStrategy, runAgent } from "./agent-runtime.mjs";

test("returns missing tool error to model as recoverable observation", async () => {
  const traces = [];

  const result = await runAgent({
    llm: async ({ messages }) => {
      const toolMessage = messages.find((message) => message.role === "tool");

      if (toolMessage) {
        const observation = JSON.parse(toolMessage.content);

        assert.equal(observation.error, true);
        assert.equal(
          observation.recovery_strategy,
          RecoveryStrategy.RETURN_ERROR_TO_MODEL,
        );

        return {
          type: "final",
          content: "recovered from missing tool",
        };
      }

      return {
        type: "tool_call",
        toolCall: {
          id: "call_missing_tool",
          name: "missing_tool",
          args: {},
        },
      };
    },
    tools: [],
    messages: [
      {
        role: "user",
        content: "Use a missing tool",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.content, "recovered from missing tool");
  assert.equal(
    traces.some((event) => event.type === "recovery_decision"),
    true,
  );
});

test("can fail fast on missing tool error", async () => {
  assert.equal(RecoveryStrategy.FAIL_FAST, "fail_fast");

  const traces = [];

  const result = await runAgent({
    llm: async () => ({
      type: "tool_call",
      toolCall: {
        id: "call_missing_tool",
        name: "missing_tool",
        args: {},
      },
    }),
    tools: [],
    messages: [
      {
        role: "user",
        content: "Use a missing tool with fail-fast recovery",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
      toolErrorStrategy: RecoveryStrategy.FAIL_FAST,
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  const recoveryEvent = traces.find(
    (event) => event.type === "recovery_decision",
  );
  const errorTransition = traces.find(
    (event) =>
      event.type === "state_transition" && event.data.to === "error",
  );

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "tool_not_found: missing_tool");
  assert.equal(recoveryEvent.data.strategy, RecoveryStrategy.FAIL_FAST);
  assert.equal(recoveryEvent.data.action, "fail_agent");
  assert.equal(errorTransition.data.reason, "tool_not_found: missing_tool");
});

test("retries a failing tool before returning result to model", async () => {
  const traces = [];
  let toolRunCount = 0;

  const result = await runAgent({
    llm: async ({ messages }) => {
      const toolMessage = messages.find((message) => message.role === "tool");

      if (toolMessage) {
        const observation = JSON.parse(toolMessage.content);

        assert.equal(observation.ok, true);
        assert.equal(observation.attempts, 2);

        return {
          type: "final",
          content: "tool succeeded after retry",
        };
      }

      return {
        type: "tool_call",
        toolCall: {
          id: "call_unstable_tool",
          name: "unstable_tool",
          args: {},
        },
      };
    },
    tools: [
      {
        name: "unstable_tool",
        description: "Fails once, then succeeds.",
        async run() {
          toolRunCount += 1;

          if (toolRunCount === 1) {
            throw new Error("temporary tool failure");
          }

          return {
            ok: true,
            attempts: toolRunCount,
          };
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Run unstable tool",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 1,
      toolTimeoutMs: 1000,
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  const retryTransition = traces.find(
    (event) =>
      event.type === "state_transition" &&
      event.data.to === AgentState.RETRYING,
  );

  assert.equal(result.status, "completed");
  assert.equal(result.content, "tool succeeded after retry");
  assert.equal(toolRunCount, 2);
  assert.equal(retryTransition.data.error, "temporary tool failure");
  assert.equal(
    traces.some(
      (event) =>
        event.type === "tool_result" && event.data.tool === "unstable_tool",
    ),
    true,
  );
});

test("returns a workflow execution report", async () => {
  const result = await runAgent({
    llm: async ({ messages }) => {
      const toolMessage = messages.find((message) => message.role === "tool");

      if (toolMessage) {
        return {
          type: "final",
          content: "weather checked",
        };
      }

      return {
        type: "tool_call",
        toolCall: {
          id: "call_get_weather",
          name: "get_weather",
          args: {
            city: "Shanghai",
          },
        },
      };
    },
    tools: [
      {
        name: "get_weather",
        description: "Get weather by city.",
        async run(args) {
          return {
            city: args.city,
            temperature: 26,
          };
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Check Shanghai weather",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.report.status, "completed");
  assert.equal(result.report.finalState, AgentState.DONE);
  assert.equal(result.report.totalSteps, 2);
  assert.deepEqual(result.report.statePath, [
    AgentState.PLANNING,
    AgentState.ACTING,
    AgentState.OBSERVING,
    AgentState.PLANNING,
    AgentState.DONE,
  ]);
  assert.deepEqual(result.report.toolCalls, [
    {
      name: "get_weather",
      status: "success",
    },
  ]);
  assert.equal(result.report.retryCount, 0);
  assert.equal(result.report.errorCount, 0);
  assert.equal(result.report.approvalRequiredCount, 0);
});


test("pauses before running a tool that requires human approval", async () => {
  const traces = [];
  let toolRunCount = 0;

  const result = await runAgent({
    llm: async () => ({
      type: "tool_call",
      toolCall: {
        id: "call_delete_file",
        name: "delete_file",
        args: {
          path: "important-notes.txt",
        },
      },
    }),
    tools: [
      {
        name: "delete_file",
        description: "Delete a file from disk.",
        requiresApproval: true,
        async run() {
          toolRunCount += 1;
          return {
            deleted: true,
          };
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Delete important-notes.txt",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  const approvalEvent = traces.find(
    (event) => event.type === "approval_required",
  );
  const waitingTransition = traces.find(
    (event) =>
      event.type === "state_transition" &&
      event.data.to === AgentState.WAITING_FOR_APPROVAL,
  );

  assert.equal(result.status, "waiting_for_approval");
  assert.equal(result.report.status, "waiting_for_approval");
  assert.equal(result.report.finalState, AgentState.WAITING_FOR_APPROVAL);
  assert.equal(result.report.approvalRequiredCount, 1);
  assert.equal(toolRunCount, 0);
  assert.equal(result.approvalRequest.toolCall.name, "delete_file");
  assert.deepEqual(result.approvalRequest.toolCall.args, {
    path: "important-notes.txt",
  });
  assert.equal(approvalEvent.data.tool, "delete_file");
  assert.equal(waitingTransition.data.reason, "tool requires approval");
});

test("runs an approval-required tool after it has been approved", async () => {
  const traces = [];
  let toolRunCount = 0;

  const result = await runAgent({
    llm: async ({ messages }) => {
      const toolMessage = messages.find((message) => message.role === "tool");

      if (toolMessage) {
        const observation = JSON.parse(toolMessage.content);

        assert.equal(observation.deleted, true);

        return {
          type: "final",
          content: "approved tool executed",
        };
      }

      return {
        type: "tool_call",
        toolCall: {
          id: "call_delete_file",
          name: "delete_file",
          args: {
            path: "important-notes.txt",
          },
        },
      };
    },
    tools: [
      {
        name: "delete_file",
        description: "Delete a file from disk.",
        requiresApproval: true,
        async run(args) {
          toolRunCount += 1;

          return {
            deleted: true,
            path: args.path,
          };
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Delete important-notes.txt",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
      approvedToolCallIds: ["call_delete_file"],
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.content, "approved tool executed");
  assert.equal(toolRunCount, 1);
  assert.equal(
    traces.some(
      (event) =>
        event.type === "tool_result" && event.data.tool === "delete_file",
    ),
    true,
  );
});

test("returns rejected approval to model without running the tool", async () => {
  const traces = [];
  let toolRunCount = 0;

  const result = await runAgent({
    llm: async ({ messages }) => {
      const toolMessage = messages.find((message) => message.role === "tool");

      if (toolMessage) {
        const observation = JSON.parse(toolMessage.content);

        assert.equal(observation.error, true);
        assert.equal(observation.approval_rejected, true);

        return {
          type: "final",
          content: "delete was cancelled",
        };
      }

      return {
        type: "tool_call",
        toolCall: {
          id: "call_delete_file",
          name: "delete_file",
          args: {
            path: "important-notes.txt",
          },
        },
      };
    },
    tools: [
      {
        name: "delete_file",
        description: "Delete a file from disk.",
        requiresApproval: true,
        async run() {
          toolRunCount += 1;

          return {
            deleted: true,
          };
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Delete important-notes.txt",
      },
    ],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 1000,
      rejectedToolCallIds: ["call_delete_file"],
    },
    onTrace(event) {
      traces.push(event);
    },
  });

  const rejectedEvent = traces.find(
    (event) => event.type === "approval_rejected",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.content, "delete was cancelled");
  assert.equal(toolRunCount, 0);
  assert.equal(rejectedEvent.data.tool, "delete_file");
});
