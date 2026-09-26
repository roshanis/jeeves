export const READ_ONLY_PREVIEW_MESSAGE = "This preview is read-only. Open an interactive demo workspace to save changes.";

/** Read-model selection; mutations require the same DB mode. AI runtime is separate. */
export function resolveDataProviderMode(
  providerMode: string | undefined,
  hasDatabaseUrl: boolean,
): "db" | "mock" {
  return providerMode === "db" || (providerMode !== "mock" && hasDatabaseUrl) ? "db" : "mock";
}
