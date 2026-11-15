/**
 * Test helper: records every table a select reads ("from:<table>") and every
 * FOR UPDATE ("lock:<table>") issued through the transaction a service opens
 * on `db`. PGlite cannot interleave two transactions, so tests assert the lock
 * itself (taken or not) instead of observing contention. Call `spy.mockRestore()`
 * when done.
 */
import { vi } from "vitest";
import { getTableName } from "drizzle-orm";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function recordLocks(db: unknown) {
  const events: string[] = [];
  const dbAny = db as any;
  const realTransaction = dbAny.transaction.bind(dbAny);
  const spy = vi.spyOn(dbAny, "transaction").mockImplementation((cb: any) =>
    realTransaction(async (tx: any) => {
      const realSelect = tx.select.bind(tx);
      tx.select = (...a: unknown[]) => {
        const wrap = (b: any, table: string | null): any =>
          new Proxy(b, {
            get(t, k) {
              const v = t[k];
              if (typeof v !== "function") return v;
              return (...args: unknown[]) => {
                if (k === "from") {
                  const name = getTableName(args[0] as any);
                  events.push(`from:${name}`);
                  return wrap(v.apply(t, args), name);
                }
                if (k === "for") events.push(`lock:${table}`);
                const r = v.apply(t, args);
                return r && typeof r === "object" && k !== "then" ? wrap(r, table) : r;
              };
            },
          });
        return wrap(realSelect(...a), null);
      };
      return cb(tx);
    }),
  );
  return { events, spy };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
