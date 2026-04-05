export class DomainError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
