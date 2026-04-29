import { IModelAdapter, ModelRequest, ModelResponse } from './model-adapter.interface';

export class GeminiAdapter implements IModelAdapter {
  readonly protocol = 'gemini';

  buildRequest(payload: ModelRequest, model: string) {
    const extraBody = payload.extraBody || {};
    const systemInstruction = payload.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\\n\\n');

    const tools = Array.isArray(extraBody.tools)
      ? [
          {
            functionDeclarations: extraBody.tools
              .map((tool: any) => {
                if (tool?.type !== 'function' || !tool.function?.name) return null;
                return {
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters || { type: 'object', properties: {} },
                };
              })
              .filter(Boolean),
          },
        ].filter((item) => item.functionDeclarations.length)
      : undefined;

    return {
      method: 'POST',
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`, // Default path
      body: {
        ...(systemInstruction ? {
          systemInstruction: { parts: [{ text: systemInstruction }] },
        } : {}),
        contents: this.toGeminiContents(payload.messages),
        generationConfig: {
          ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
          ...(payload.max_tokens ? { maxOutputTokens: payload.max_tokens } : {}),
        },
        ...(tools?.length ? { tools } : {}),
        ...(extraBody.tool_choice === 'auto' ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      },
    };
  }

  normalizeResponse(data: any): ModelResponse {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const textContent = parts
      .filter((part: any) => typeof part?.text === 'string')
      .map((part: any) => part.text)
      .join('\\n\\n')
      .trim();

    const toolCalls = parts
      .filter((part: any) => part?.functionCall?.name)
      .map((part: any, index: number) => ({
        id: `gemini-tool-${index + 1}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      }));

    return {
      id: candidate?.index !== undefined ? `gemini-${candidate.index}` : undefined,
      model: data?.modelVersion,
      choices: [
        {
          message: {
            role: 'assistant',
            content: textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: candidate?.finishReason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: Number(data?.usageMetadata?.promptTokenCount || 0),
        completion_tokens: Number(data?.usageMetadata?.candidatesTokenCount || 0),
        cache_write_tokens: 0,
        cache_read_tokens: Number(data?.usageMetadata?.cachedContentTokenCount || 0),
        total_tokens: Number(data?.usageMetadata?.promptTokenCount || 0) + Number(data?.usageMetadata?.candidatesTokenCount || 0),
      },
      raw: data,
    };
  }

  private toGeminiContents(messages: any[]) {
    return messages
      .filter((message) => message.role !== 'system' && message.role !== 'tool')
      .map((message) => {
        const parts: Array<Record<string, any>> = [];
        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
          if (message.content) parts.push({ text: message.content });
          for (const toolCall of message.tool_calls) {
            parts.push({
              functionCall: {
                name: toolCall.function?.name,
                args: this.safeParseJson(toolCall.function?.arguments),
              },
            });
          }
        } else if (message.content) {
          parts.push({ text: message.content });
        }
        return {
          role: message.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });
  }

  private safeParseJson(value: string | undefined) {
    if (!value) return {};
    try { return JSON.parse(value); } catch { return {}; }
  }
}
