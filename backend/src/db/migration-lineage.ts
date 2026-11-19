// Ledger classification only. A recognized ledger is not proof of schema
// correctness and must never by itself authorize a migration or startup.
export type AppliedMigrationIdentity = { timestamp: number; hash: string };
export type HistoricalMigrationIdentity = { timestamp: number; acceptedHashes: readonly string[] };
export type HistoricalLineage = 'fresh-candidate' | 'feature-candidate' | 'senior-candidate';

export function classifyMigrationLineage(applied: readonly AppliedMigrationIdentity[],
  feature: readonly HistoricalMigrationIdentity[], senior: readonly HistoricalMigrationIdentity[]): HistoricalLineage {
  const digest = /^[a-f0-9]{64}$/;
  const validateCatalog = (catalog: readonly HistoricalMigrationIdentity[]) => {
    const seen = new Set<number>();
    if (!catalog.length) throw new Error('Historical migration catalog is empty.');
    for (const item of catalog) {
      if (!Number.isSafeInteger(item.timestamp) || item.timestamp <= 0 || seen.has(item.timestamp) ||
          !item.acceptedHashes.length || item.acceptedHashes.some(hash => !digest.test(hash)))
        throw new Error('Historical migration catalog is invalid.');
      seen.add(item.timestamp);
    }
  };
  validateCatalog(feature); validateCatalog(senior);
  const seen = new Set<number>();
  for (const item of applied) {
    if (!Number.isSafeInteger(item.timestamp) || item.timestamp <= 0 || seen.has(item.timestamp) || !digest.test(item.hash))
      throw new Error('Migration history is invalid or ambiguous.');
    seen.add(item.timestamp);
  }
  if (!applied.length) return 'fresh-candidate';
  const matches = (catalog: readonly HistoricalMigrationIdentity[]) => {
    if (catalog.length !== applied.length) return false;
    const byTimestamp = new Map(catalog.map(item => [item.timestamp, item]));
    return applied.every(item => byTimestamp.get(item.timestamp)?.acceptedHashes.includes(item.hash));
  };
  const featureMatch = matches(feature), seniorMatch = matches(senior);
  if (featureMatch === seniorMatch) throw new Error('Migration history is unknown or ambiguous.');
  return featureMatch ? 'feature-candidate' : 'senior-candidate';
}
