import { IModelAdapter, ModelRequest, ModelResponse } from './model-adapter.interface';

export class OpenAIAdapter implements IModelAdapter {
  readonly protocol = 'openai';

  buildRequest(payload: ModelRequest, model: string) {
    return {
      method: 'POST',
      path: '/v1/chat/completions',
      body: {
        model,
        messages: payload.messages,
        stream: payload.stream ?? false,
        ...(payload.max_tokens ? { max_tokens: payload.max_tokens } : {}),
        ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
        ...(payload.extraBody || {}),
      },
    };
  }

  normalizeResponse(data: any): ModelResponse {
    return {
      id: data?.id,
      model: data?.model,
      choices: data?.choices || [],
      usage: {
        prompt_tokens: data?.usage?.prompt_tokens || 0,
        completion_tokens: data?.usage?.completion_tokens || 0,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: data?.usage?.total_tokens || 0,
      },
      raw: data,
    };
  }
}
