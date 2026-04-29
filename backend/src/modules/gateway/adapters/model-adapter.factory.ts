import { Injectable } from '@nestjs/common';
import { OpenAIAdapter } from './openai-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { GeminiAdapter } from './gemini-adapter';
import { OpenAIResponsesAdapter } from './openai-responses-adapter';
import { IModelAdapter } from './model-adapter.interface';

@Injectable()
export class ModelAdapterFactory {
  private adapters: Map<string, IModelAdapter> = new Map();

  constructor() {
    this.registerAdapter(new OpenAIAdapter());
    this.registerAdapter(new AnthropicAdapter());
    this.registerAdapter(new GeminiAdapter());
    this.registerAdapter(new OpenAIResponsesAdapter());
  }

  registerAdapter(adapter: IModelAdapter) {
    this.adapters.set(adapter.protocol, adapter);
  }

  getAdapter(protocol: string): IModelAdapter {
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      // Fallback to OpenAI as default
      return this.adapters.get('openai');
    }
    return adapter;
  }
}
