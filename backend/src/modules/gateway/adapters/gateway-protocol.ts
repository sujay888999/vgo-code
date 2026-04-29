export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ModelRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  extraBody?: Record<string, any>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ModelResponse {
  id: string | undefined;
  model: string | undefined;
  choices: Array<{
    message: {
      role: string;
      content: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    cache_write_tokens: number;
    cache_read_tokens: number;
    total_tokens: number;
  };
  raw: any;
}

export type GatewayProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'gemini';

export interface GatewayUpstreamRequest {
  method: string;
  path: string;
  body: Record<string, any>;
  protocol?: GatewayProtocol;
}
