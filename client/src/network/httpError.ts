export interface HttpErrorPayload {
  message: string;
  code?: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
