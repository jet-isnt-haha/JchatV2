import { describe, expect, it } from "vitest";
import { normalizeError } from "../src/errors/normalizeError";
import { HttpError } from "../src/network/httpError";
import { DomainError } from "../src/errors/domainError";

describe("normalizeError", () => {
  it("maps HttpError to http app error", () => {
    const error = normalizeError(new HttpError(400, "bad request", "BAD"));
    expect(error.kind).toBe("http");
    expect(error.status).toBe(400);
    expect(error.code).toBe("BAD");
  });

  it("maps domain error code to predefined message", () => {
    const error = normalizeError(
      new DomainError("internal", "STREAMING_IN_PROGRESS"),
    );
    expect(error.kind).toBe("domain");
    expect(error.message).toBe("请等待当前回复完成后再切换分支");
  });

  it("maps plain error to unknown kind", () => {
    const error = normalizeError(new Error("x"));
    expect(error.kind).toBe("unknown");
    expect(error.message).toBe("x");
  });
});
