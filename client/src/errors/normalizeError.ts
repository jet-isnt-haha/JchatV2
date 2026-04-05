import { DOMAIN_ERROR_MESSAGES } from "@/errors/messages";
import type { AppError } from "@/errors/types";
import { isHttpError } from "@/network/httpError";

export function normalizeError(error: unknown): AppError {
  if (isHttpError(error)) {
    return {
      kind: "http",
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    if (/Failed to fetch|NetworkError|timeout/i.test(error.message)) {
      return {
        kind: "network",
        message: "网络连接异常，请稍后重试",
      };
    }

    if (error.name === "DomainError") {
      const code = (error as Error & { code?: string }).code;
      return {
        kind: "domain",
        code,
        message: (code && DOMAIN_ERROR_MESSAGES[code]) || error.message,
      };
    }

    return {
      kind: "unknown",
      message: error.message || "发生未知错误",
    };
  }

  if (typeof error === "string") {
    return {
      kind: "unknown",
      message: error,
    };
  }

  return {
    kind: "unknown",
    message: "发生未知错误",
  };
}
