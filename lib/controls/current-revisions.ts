interface VersionedControl {
  id: string;
  deploymentId: string;
  controlId: string;
  version: number;
}

/**
 * Select the current revision per (deployment, control), leaving history intact.
 * Equal versions use the greatest ID as a deterministic defensive tie break;
 * persisted rows normally cannot tie because the DB constrains that tuple.
 * Output is ordered by deployment ID then control ID, independent of query order.
 */
export function currentControlRevisions<T extends VersionedControl>(rows: readonly T[]): T[] {
  const byDeployment = new Map<string, Map<string, T>>();
  for (const row of rows) {
    let controls = byDeployment.get(row.deploymentId);
    if (!controls) {
      controls = new Map<string, T>();
      byDeployment.set(row.deploymentId, controls);
    }
    const current = controls.get(row.controlId);
    if (!current || row.version > current.version || (row.version === current.version && row.id > current.id)) {
      controls.set(row.controlId, row);
    }
  }
  return [...byDeployment.values()].flatMap((controls) => [...controls.values()]).sort((left, right) => {
    if (left.deploymentId !== right.deploymentId) return left.deploymentId < right.deploymentId ? -1 : 1;
    if (left.controlId !== right.controlId) return left.controlId < right.controlId ? -1 : 1;
    return 0;
  });
}
