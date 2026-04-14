import "reflect-metadata";
import axios from "axios";
import dataSource from "./data-source";
import { Channel } from "../modules/channel/channel.entity";

async function main() {
  await dataSource.initialize();
  const channelRepo = dataSource.getRepository(Channel);
  const channel = await channelRepo.findOne({
    where: { name: "opencode-responses" },
  });

  if (!channel?.apiKey) {
    throw new Error("opencode-responses channel or apiKey missing");
  }

  const url = channel.baseUrl;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.apiKey}`,
  };

  const cases = [
    {
      name: "simple_user_only",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hi" }],
          },
        ],
        max_output_tokens: 32,
      },
    },
    {
      name: "with_assistant_output_text",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hi" }],
          },
          {
            role: "assistant",
            content: [{ type: "output_text", text: "Hello! How can I help you?" }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: "What model are you?" }],
          },
        ],
        max_output_tokens: 64,
      },
    },
    {
      name: "with_assistant_input_text",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hi" }],
          },
          {
            role: "assistant",
            content: [{ type: "input_text", text: "Hello! How can I help you?" }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: "What model are you?" }],
          },
        ],
        max_output_tokens: 64,
      },
    },
    {
      name: "with_tools_schema",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Check my balance" }],
          },
        ],
        max_output_tokens: 64,
        tools: [
          {
            type: "function",
            function: {
              name: "get_my_balance",
              description: "Get the current account balance.",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          },
        ],
      },
    },
    {
      name: "with_tools_flattened",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Check my balance" }],
          },
        ],
        max_output_tokens: 64,
        tools: [
          {
            type: "function",
            name: "get_my_balance",
            description: "Get the current account balance.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    },
    {
      name: "with_tools_flattened_and_tool_choice_auto",
      body: {
        model: "gpt-5.4",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Check my balance" }],
          },
        ],
        max_output_tokens: 64,
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "get_my_balance",
            description: "Get the current account balance.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    },
  ];

  const results: Array<Record<string, any>> = [];

  for (const probe of cases) {
    try {
      const response = await axios.post(url, probe.body, {
        headers,
        timeout: 45000,
      });
      results.push({
        name: probe.name,
        ok: true,
        status: response.status,
        data: response.data,
      });
    } catch (error: any) {
      results.push({
        name: probe.name,
        ok: false,
        status: error?.response?.status || null,
        data: error?.response?.data || error?.message || "unknown_error",
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await dataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
