import type { ExpectedPrivateReader } from './company-recording-drive-file-inspector.js';

export type ActualPrivatePermission = { id: string; type: string; email?: string; role: string; inherited?: boolean };
export type DurablePrivateReader = ExpectedPrivateReader & { permissionId?: string | null };
export type PrivateAclReconciliation =
  | { status: 'blocked'; reason: string }
  | { status: 'incomplete'; missing: DurablePrivateReader[]; obsolete: ActualPrivatePermission[]; duplicates: ActualPrivatePermission[] };

// Planning is deliberately provider-independent. Mutations must use the
// existing fenced ACL service, followed by a fresh independent inspection.
export function reconcilePrivateAclPermissions(companyEmail: string, readers: readonly DurablePrivateReader[], actual: readonly ActualPrivatePermission[]): PrivateAclReconciliation {
  const expected = new Map(readers.map(reader => [reader.email.toLowerCase(), reader]));
  const seen = new Set<string>(); const missing: DurablePrivateReader[] = []; const obsolete: ActualPrivatePermission[] = []; const duplicates: ActualPrivatePermission[] = [];
  let ownerCount = 0;
  for (const permission of actual) {
    if (!permission.id || permission.type !== 'user' || permission.inherited === true || !permission.email || !['owner', 'reader'].includes(permission.role))
      return { status: 'blocked', reason: 'Drive permission metadata is unsupported or unverifiable.' };
    const address = permission.email.toLowerCase();
    if (address === companyEmail.toLowerCase()) { if (permission.role !== 'owner' || ++ownerCount > 1) return { status: 'blocked', reason: 'Company ownership is invalid.' }; continue; }
    const intended = expected.get(address);
    if (!intended || permission.role !== 'reader') { obsolete.push(permission); continue; }
    if (seen.has(address)) duplicates.push(permission); else seen.add(address);
  }
  if (ownerCount !== 1) return { status: 'blocked', reason: 'Company ownership is unavailable.' };
  for (const reader of readers) if (!seen.has(reader.email.toLowerCase())) missing.push(reader);
  return { status: 'incomplete', missing, obsolete, duplicates };
}
