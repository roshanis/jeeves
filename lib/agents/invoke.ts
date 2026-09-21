import type { InvokeOptions, PortFailure, PortResult } from "./ports";

/**
 * One terminal result for a provider call, even when it ignores cancellation.
 * Abort stops waiting immediately; the provider still receives the signal so
 * it can stop its own work. Its eventual settlement is consumed and ignored.
 */
export function invokeWithDeadline<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  mapError: (error: unknown) => PortFailure,
  options?: InvokeOptions,
): Promise<PortResult<T>> {
  if (options?.signal?.aborted) {
    return Promise.resolve({ ok: false, error: { kind: "cancelled" } });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: PortResult<T>) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", cancel);
      resolve(result);
    };
    const cancel = () => {
      finish({ ok: false, error: { kind: "cancelled" } });
      controller.abort();
    };
    options?.signal?.addEventListener("abort", cancel, { once: true });

    if (options?.timeoutMs !== undefined) {
      const timeoutMs = options.timeoutMs;
      timer = setTimeout(() => {
        finish({
          ok: false,
          error: {
            kind: "timeout",
            message: `Invocation exceeded its ${timeoutMs}ms deadline.`,
            elapsedMs: Date.now() - startedAt,
          },
        });
        controller.abort();
      }, timeoutMs);
    }

    try {
      invoke(controller.signal).then(
        (value) => finish({ ok: true, value }),
        (error: unknown) => {
          if (!settled) finish({ ok: false, error: mapError(error) });
        },
      );
    } catch (error) {
      finish({ ok: false, error: mapError(error) });
    }
  });
}
