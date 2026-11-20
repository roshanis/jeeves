// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHUTDOWN_DEADLINE_MS, installShutdownDeadline, resetShutdownDeadlineForTests } from "./shutdown";

function fakeProcess() {
  const handlers = new Map<string, () => void>();
  return {
    on: vi.fn((signal: string, handler: () => void) => void handlers.set(signal, handler)),
    emit: (signal: string) => handlers.get(signal)?.(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetShutdownDeadlineForTests();
});
afterEach(() => vi.useRealTimers());

describe("installShutdownDeadline", () => {
  it("is 125 seconds, below the 130-second stop timeout documented for Podman and ECS", () => {
    expect(SHUTDOWN_DEADLINE_MS).toBe(125_000);
  });

  it("forces the exit at the deadline and not before", () => {
    const proc = fakeProcess();
    const exit = vi.fn();
    installShutdownDeadline({ proc, exit, log: () => {} });
    proc.emit("SIGTERM");

    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does nothing until a SIGTERM arrives, and a second SIGTERM does not restart the clock", () => {
    const proc = fakeProcess();
    const exit = vi.fn();
    installShutdownDeadline({ proc, exit, log: () => {} });
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS * 2);
    expect(exit).not.toHaveBeenCalled();

    proc.emit("SIGTERM");
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS / 2);
    proc.emit("SIGTERM");
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS / 2);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("uses an unref'd timer, so it never keeps a clean exit waiting", () => {
    const proc = fakeProcess();
    const unref = vi.fn();
    const setTimer = vi.fn(() => ({ unref }) as unknown as NodeJS.Timeout);
    installShutdownDeadline({ proc, exit: vi.fn(), log: () => {}, setTimer });
    proc.emit("SIGTERM");
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), SHUTDOWN_DEADLINE_MS);
    expect(unref).toHaveBeenCalled();
  });

  it("installs its listener once however often it is called", () => {
    const proc = fakeProcess();
    installShutdownDeadline({ proc, exit: vi.fn(), log: () => {} });
    installShutdownDeadline({ proc, exit: vi.fn(), log: () => {} });
    expect(proc.on).toHaveBeenCalledTimes(1);
  });
});
