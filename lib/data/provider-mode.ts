export const READ_ONLY_PREVIEW_MESSAGE = "This preview is read-only. Open an interactive demo workspace to save changes.";

/** Read-model selection; mutations require the same DB mode. AI runtime is separate. */
export function resolveDataProviderMode(
  providerMode: string | undefined,
  hasDatabaseUrl: boolean,
): "db" | "mock" {
  // Trimmed and lower-cased: a mistyped "Mock" must not leave a preview writable.
  const normalised = providerMode?.trim().toLowerCase();
  return normalised === "db" || (normalised !== "mock" && hasDatabaseUrl) ? "db" : "mock";
}
