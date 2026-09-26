interface DatedDeployment {
  id: string;
  deployedAt: Date;
}

/** Latest version of any status, for explicitly requested history/read fallbacks. */
export function latestDeployment<T extends DatedDeployment>(rows: readonly T[]): T | null {
  let latest: T | null = null;
  for (const row of rows) {
    if (
      latest === null ||
      row.deployedAt.getTime() > latest.deployedAt.getTime() ||
      (row.deployedAt.getTime() === latest.deployedAt.getTime() && row.id > latest.id)
    ) {
      latest = row;
    }
  }
  return latest;
}

/**
 * Current operating version, including one paused for review/maintenance.
 * Pending promotion candidates and retired history are never operational.
 * Timestamp ties use the greatest ID so query/input order cannot choose a
 * different version for the read model and a mutation. Input rows are intact.
 */
export function operationalDeployment<T extends DatedDeployment & { status: string }>(
  rows: readonly T[],
): T | null {
  return latestDeployment(rows.filter((row) => row.status === "deployed" || row.status === "paused"));
}
