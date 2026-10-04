import { errorMessageAr } from "../../shared/messages";
import type { ApiErrorBody } from "../../shared/types";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503;

/** An error that is safe to show to the client. */
export class ApiError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? errorMessageAr(code));
    this.name = "ApiError";
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

/** HTTP status for business-rule codes returned by apply_loyalty_action(). */
export function statusForLoyaltyCode(code: string): ErrorStatus {
  switch (code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "INVALID_QUANTITY":
    case "UNKNOWN_ACTION":
      return 400;
    default:
      return 409;
  }
}
