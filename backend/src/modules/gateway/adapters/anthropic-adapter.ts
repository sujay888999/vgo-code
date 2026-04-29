import { IModelAdapter, ModelRequest, ModelResponse } from './model-adapter.interface';

export class AnthropicAdapter implements IModelAdapter {
  readonly protocol = 'anthropic';

  buildRequest(payload: ModelRequest, model: string) {
    const system = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\\n\\n');

    const extraBody = payload.extraBody || {};
    const anthropicTools = Array.isArray(extraBody.tools)
      ? extraBody.tools
          .map((tool: any) => {
            if (tool?.type !== 'function' || !tool.function?.name) return null;
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters || { type: 'object', properties: {} },
            };
          })
          .filter(Boolean)
      : undefined;

    const body: Record<string, any> = {
      model,
      max_tokens: payload.max_tokens || 1024,
      messages: this.toAnthropicMessages(payload.messages),
      stream: payload.stream ?? false,
      ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
    };

    if (system) body.system = system;
    if (anthropicTools?.length) body.tools = anthropicTools;
    if (extraBody.tool_choice === 'auto') body.tool_choice = { type: 'auto' };

    return {
      method: 'POST',
      path: '/v1/messages',
      body,
    };
  }

  normalizeResponse(data: any): ModelResponse {
    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const textContent = contentBlocks
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block?.text || '')
      .join('\\n\\n')
      .trim();

    const toolCalls = contentBlocks
      .filter((block: any) => block?.type === 'tool_use')
      .map((block: any) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      }));

    return {
      id: data?.id,
      model: data?.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: data?.stop_reason === 'tool_use' ? 'tool_calls' : (data?.stop_reason || 'stop'),
        },
      ],
      usage: {
        prompt_tokens: Number(data?.usage?.input_tokens || 0),
        completion_tokens: Number(data?.usage?.output_tokens || 0),
        cache_write_tokens: Number(data?.usage?.cache_creation_input_tokens || 0),
        cache_read_tokens: Number(data?.usage?.cache_read_input_tokens || 0),
        total_tokens: Number(data?.usage?.input_tokens || 0) + Number(data?.usage?.output_tokens || 0),
      },
      raw: data,
    };
  }

  private toAnthropicMessages(messages: any[]) {
    return messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content || '' }],
          };
        }
        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
          return {
            role: 'assistant',
            content: [
              ...(message.content ? [{ type: 'text', text: message.content }] : []),
              ...message.tool_calls.map((toolCall: any) => ({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function?.name,
                input: this.safeParseJson(toolCall.function?.arguments),
              })),
            ],
          };
        }
        return {
          role: message.role,
          content: message.content ? [{ type: 'text', text: message.content }] : [],
        };
      });
  }

  private safeParseJson(value: string | undefined) {
    if (!value) return {};
    try { return JSON.parse(value); } catch { return {}; }
  }
}
