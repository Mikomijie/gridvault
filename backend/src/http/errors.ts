// GridVault HTTP error contract (AGENTS.md section 5).
//
// One AppError class with code, httpStatus, reasonCode and details; one
// error middleware. Handlers never `res.status(500).json({error:
// e.message})` — that leaks internals and possibly PHI. Rejections carry
// stable machine codes; human messages stay generic.

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly reasonCode: string | null;
  readonly details: Record<string, string | number | boolean | null>;

  constructor(input: {
    code: string;
    httpStatus: number;
    message: string;
    reasonCode?: string;
    details?: Record<string, string | number | boolean | null>;
  }) {
    super(input.message);
    this.name = 'AppError';
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.reasonCode = input.reasonCode ?? null;
    this.details = input.details ?? {};
  }
}

export function toErrorBody(error: AppError, requestId: string): {
  error: {
    code: string;
    message: string;
    reason_code: string | null;
    details: Record<string, string | number | boolean | null>;
    request_id: string;
  };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      reason_code: error.reasonCode,
      details: error.details,
      request_id: requestId
    }
  };
}
