import type { DataProvider, WorkspaceScopedReadOptions } from "@/lib/data/provider";
import type { InitiativeDetail } from "@/lib/data/dto";

/** Request-local bulk portfolio read; callers resolve the viewer scope once. */
export function loadPortfolioDetails(
  provider: DataProvider,
  viewerWorkspaceId: string | null,
): Promise<InitiativeDetail[]> {
  const scope: WorkspaceScopedReadOptions = { viewerWorkspaceId };
  return provider.listInitiativeDetails(scope);
}
