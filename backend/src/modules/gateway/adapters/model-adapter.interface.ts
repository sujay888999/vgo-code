import { ModelRequest, ModelResponse } from './gateway-protocol';

export interface IModelAdapter {
  readonly protocol: string;

  /**
   * 将通用请求格式转换为模型特定请求
   */
  buildRequest(payload: ModelRequest, model: string): {
    method: string;
    path: string;
    body: any;
  };

  /**
   * 将模型特定响应转换为 VGO 标准响应格式
   */
  normalizeResponse(data: any): ModelResponse;
}
