export class APIClientError extends Error {
  readonly statusCode?: number;
  readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      responseBody?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'APIClientError';
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
  }
}
