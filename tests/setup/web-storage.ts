// Node >= 25 defines `localStorage` as an own getter on globalThis (built-in
// WebStorage) that evaluates to `undefined` unless node is started with
// --localstorage-file. Vitest's jsdom environment refuses to overwrite an
// existing global, so on those Node versions `window.localStorage` is
// undefined in tests even though jsdom implements it (CI's Node 22 has no
// such global and is unaffected). Install a minimal in-memory Storage shim
// when that happens so component tests behave the same on every Node.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(String(key)) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(String(key)),
    setItem: (key, value) => void store.set(String(key), String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
  });
}

export {};
