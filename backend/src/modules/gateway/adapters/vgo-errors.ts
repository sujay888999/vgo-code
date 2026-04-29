export abstract class VGOError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;

  constructor(message: string, public readonly rawError?: any) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UpstreamError extends VGOError {
  readonly statusCode: number;
  readonly errorCode = 'UPSTREAM_SERVICE_ERROR';

  constructor(message: string, statusCode: number, rawError?: any) {
    super(message, rawError);
    this.statusCode = statusCode;
  }
}

export class AuthError extends VGOError {
  readonly statusCode = 401;
  readonly errorCode = 'AUTHENTICATION_FAILED';

  constructor(message: string, rawError?: any) {
    super(message, rawError);
  }
}

export class BalanceError extends VGOError {
  readonly statusCode = 402;
  readonly errorCode = 'INSUFFICIENT_BALANCE';

  constructor(message: string, rawError?: any) {
    super(message, rawError);
  }
}

export class ProtocolError extends VGOError {
  readonly statusCode = 400;
  readonly errorCode = 'PROTOCOL_MISMATCH';

  constructor(message: string, rawError?: any) {
    super(message, rawError);
  }
}
