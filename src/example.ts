import { runAgent, type LLM, type Message, type Tool } from "./agent-loop";

const tools: Tool[] = [
  {
    name: "get_weather",
    description: "Get weather by city name",
    async run(args) {
      const city = args.city;

      if (typeof city !== "string") {
        throw new Error("city must be a string");
      }

      return {
        city,
        weather: "sunny",
        temperature: 26,
      };
    },
  },
];

const fakeLLM: LLM = async ({ messages }) => {
  const hasToolResult = messages.some((message) => message.role === "tool");

  if (!hasToolResult) {
    return {
      type: "tool_call",
      toolCall: {
        id: "call_1",
        name: "get_weather",
        args: {
          city: "Shanghai",
        },
      },
    };
  }

  const lastToolMessage = [...messages]
    .reverse()
    .find((message) => message.role === "tool");

  return {
    type: "final",
    content: `Weather result: ${lastToolMessage?.content}`,
  };
};

async function main() {
  const messages: Message[] = [
    {
      role: "user",
      content: "What is the weather in Shanghai?",
    },
  ];

  const result = await runAgent({
    llm: fakeLLM,
    tools,
    messages,
    options: {
      maxSteps: 5,
      maxToolRetries: 1,
      toolTimeoutMs: 3000,
    },
    onTrace(event) {
      console.log("[trace]", event);
    },
  });

  console.log("Result:", result);
}

main();