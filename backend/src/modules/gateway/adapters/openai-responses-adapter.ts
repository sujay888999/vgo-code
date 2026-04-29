import { IModelAdapter, ModelRequest, ModelResponse } from './model-adapter.interface';

export class OpenAIResponsesAdapter implements IModelAdapter {
  readonly protocol = 'openai-responses';

  buildRequest(payload: ModelRequest, model: string) {
    const instructions = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\\n\\n');

    const extraBody = payload.extraBody || {};
    const normalizedTools = Array.isArray(extraBody.tools)
      ? extraBody.tools
          .map((tool: any) => {
            if (!tool) return null;
            if (tool.type === 'function' && tool.function?.name) {
              return {
                type: 'function',
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters || { type: 'object', properties: {} },
              };
            }
            if (tool.type === 'function' && tool.name) {
              return {
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters || { type: 'object', properties: {} },
              };
            }
            return tool;
          })
          .filter(Boolean)
      : undefined;

    return {
      method: 'POST',
      path: '/v1/responses',
      body: {
        model,
        input: this.toOpenAIResponsesInput(payload.messages),
        ...(instructions ? { instructions } : {}),
        ...(payload.max_tokens ? { max_output_tokens: payload.max_tokens } : {}),
        ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
        ...(payload.stream !== undefined ? { stream: payload.stream } : {}),
        ...extraBody,
        ...(normalizedTools ? { tools: normalizedTools } : {}),
      },
    };
  }

  normalizeResponse(data: any): ModelResponse {
    const outputItems = Array.isArray(data?.output) ? data.output : [];
    const assistantMessages = outputItems.filter(
      (item: any) => item?.type === 'message',
    );
    const textContent = assistantMessages
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .filter((part: any) => typeof part?.text === 'string')
      .map((part: any) => part.text)
      .join('\\n\\n')
      .trim();

    const toolCalls = outputItems
      .filter((item: any) => item?.type === 'function_call' && item?.name)
      .map((item: any) => ({
        id: item.call_id || item.id || `resp-tool-${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: {
          name: item.name,
          arguments: typeof item.arguments === 'string'
              ? item.arguments
              : JSON.stringify(item.arguments || {}),
        },
      }));

    return {
      id: data?.id,
      model: data?.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: data?.output_text || textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: data?.status || 'stop',
        },
      ],
      usage: {
        prompt_tokens: Number(data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0),
        completion_tokens: Number(data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0),
        cache_write_tokens: 0,
        cache_read_tokens: Number(data?.usage?.input_cached_tokens ?? 0),
        total_tokens: Number(data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0) +
                      Number(data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0),
      },
      raw: data,
    };
  }

  private toOpenAIResponsesInput(messages: any[]) {
    return messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        if (message.role === 'tool') {
          return {
            type: 'function_call_output',
            call_id: message.tool_call_id,
            output: message.content || '',
          };
        }
        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
          return [
            ...(message.content ? [{
              role: 'assistant',
              content: [{ type: 'output_text', text: message.content }],
            }] : []),
            ...message.tool_calls.map((toolCall: any) => ({
              type: 'function_call',
              call_id: toolCall.id,
              name: toolCall.function?.name,
              arguments: toolCall.function?.arguments || '{}',
            })),
          ];
        }
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: [{
            type: message.role === 'assistant' ? 'output_text' : 'input_text',
            text: message.content || '',
          }],
        };
      })
      .flat();
  }
}
