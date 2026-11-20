// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BootDeadlineError, isConnectionClassError } from "./driver-error";

const withCode = (message: string, code: string, cause?: unknown) => Object.assign(new Error(message, { cause }), { code });

describe("isConnectionClassError", () => {
  it.each([
    ["ECONNREFUSED", withCode("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")],
    ["ENOTFOUND inside an AggregateError in a cause", new Error("Failed query", { cause: Object.assign(new AggregateError([withCode("getaddrinfo", "ENOTFOUND")]), {}) })],
    ["08006", withCode("connection failure", "08006")],
    ["57P03", withCode("the database system is starting up", "57P03")],
    ["53300", withCode("too many connections", "53300")],
    ["08001", withCode("unable to establish connection", "08001")],
    ["08004", withCode("connection rejected", "08004")],
    ["08007", withCode("transaction resolution unknown", "08007")],
    ["57P02", withCode("crash shutdown", "57P02")],
    ["ECONNABORTED", withCode("socket aborted", "ECONNABORTED")],
    ["EPIPE", withCode("write EPIPE", "EPIPE")],
    ["pool connect timeout", new Error("timeout exceeded when trying to connect")],
    ["terminated", new Error("Connection terminated unexpectedly")],
    ["Neon quota", withCode("Your account or project has exceeded the compute time quota", "XX000")],
    ["Neon disabled endpoint", withCode("The endpoint has been disabled", "XX000")],
    ["the boot deadline", new BootDeadlineError(3000)],
  ])("is true for %s", (_name, err) => {
    expect(isConnectionClassError(err)).toBe(true);
  });

  it.each([
    ["28P01", withCode("password authentication failed", "28P01")],
    ["28000", withCode("no pg_hba.conf entry", "28000")],
    ["3D000", withCode("database does not exist", "3D000")],
    ["42501", withCode("permission denied", "42501")],
    ["42P01", withCode("relation does not exist", "42P01")],
    ["XX000 with other text", withCode("internal error", "XX000")],
    ["CERT_HAS_EXPIRED", withCode("certificate has expired", "CERT_HAS_EXPIRED")],
    ["a WebSocket error carrying CERT_HAS_EXPIRED", withCode("WebSocket connection failed: Connection terminated", "CERT_HAS_EXPIRED")],
    ["Connection terminated wrapping a 28P01 cause", new Error("Connection terminated", { cause: withCode("password authentication failed", "28P01") })],
    ["a TypeError", new TypeError("x is not a function")],
    ["an InstallationCheckError", Object.assign(new Error("Connection terminated"), { name: "InstallationCheckError" })],
    ["undefined", undefined],
  ])("is false for %s", (_name, err) => {
    expect(isConnectionClassError(err)).toBe(false);
  });
});
