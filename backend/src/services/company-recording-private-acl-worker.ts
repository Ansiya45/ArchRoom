import type { CompanyRecordingPrivateAclService, PrivateAclDriveClient } from './company-recording-private-acl.service.js';
import { reconcilePrivateAclPermissions, type ActualPrivatePermission, type DurablePrivateReader } from './company-recording-private-acl-reconciliation.js';
import type { FileInspection } from './company-recording-drive-file-inspector.js';

export type PrivateAclInspection = { file: FileInspection; permissions: readonly ActualPrivatePermission[] };
export type PrivateAclOperation = { operationId: string; userId?: string; obsolete?: boolean; operationKind?: 'direct_reader'|'anyone_reader'; state?: string };
export type PrivateAclInspector = (allowMissingReaders?: boolean) => Promise<PrivateAclInspection>;

// One worker boundary for a transferred recording. It performs no Drive calls
// itself; all mutations go through the existing fenced ACL service/client.
export class CompanyRecordingPrivateAclWorker {
  constructor(private readonly acl: Pick<CompanyRecordingPrivateAclService, 'grantReader' | 'revokeReader' | 'markVerified'>) {}

  async reconcileAnyone(input: { policyId:string; policyVersion:number; operationId:string; drive:PrivateAclDriveClient; companyAccountEmail:string; credentialGeneration:string;
    inspectOwnerOnly:()=>Promise<FileInspection>; inspectPublic:()=>Promise<FileInspection> }) {
    // A retry may find the intended public permission already present. If it
    // is absent, require the independently checked owner-only state first.
    const before = await input.inspectPublic();
    if (before.status !== 'SAFE' && (await input.inspectOwnerOnly()).status !== 'SAFE')
      return { state:'reconciliation_required' as const };
    if (!('grantAnyone' in this.acl) || typeof this.acl.grantAnyone !== 'function') return { state:'reconciliation_required' as const };
    const granted = await this.acl.grantAnyone(input.policyId, input.operationId, input.drive) as { state:string };
    if (granted.state !== 'applied') return { state:granted.state === 'busy' ? 'busy' as const : 'reconciliation_required' as const };
    if ((await input.inspectPublic()).status !== 'SAFE') return { state:'reconciliation_required' as const };
    await this.acl.markVerified(input.policyId, input.policyVersion, { companyAccountEmail:input.companyAccountEmail, credentialGeneration:input.credentialGeneration });
    return { state:'verified' as const };
  }

  async reconcile(input: { policyId: string; policyVersion: number; companyEmail: string; credentialGeneration?: string; readers: readonly DurablePrivateReader[];
    operations: readonly PrivateAclOperation[]; inspect: PrivateAclInspector; drive: PrivateAclDriveClient }) {
    let current = await input.inspect(true);
    if (current.file.status !== 'SAFE') return { state: 'reconciliation_required' as const, reason: 'Drive file integrity or ownership is not verified.' };
    const plan = reconcilePrivateAclPermissions(input.companyEmail, input.readers, current.permissions);
    if (plan.status === 'blocked') return { state: 'blocked' as const, reason: plan.reason };
    const byUser = new Map(input.operations.map(operation => [operation.userId, operation]));
    // Persist provider permission IDs for both newly granted and already
    // present readers; the ACL service makes these operations idempotent.
    for (const reader of input.readers.filter(reader => plan.missing.some(missing => missing.userId === reader.userId) || (byUser.get(reader.userId)?.state !== undefined && byUser.get(reader.userId)?.state !== 'applied'))) {
      const operation = byUser.get(reader.userId);
      if (!operation) return { state: 'reconciliation_required' as const, reason: 'Missing durable grant operation.' };
      const result = operation.operationKind === 'anyone_reader' && 'grantAnyone' in this.acl
        ? await (this.acl as any).grantAnyone(input.policyId, operation.operationId, input.drive)
        : await this.acl.grantReader(input.policyId, operation.operationId, input.drive);
      if (result.state !== 'applied') return { state: result.state === 'busy' ? 'busy' as const : 'reconciliation_required' as const };
    }
    for (const obsolete of plan.obsolete) {
      const operation = input.operations.find(candidate => candidate.obsolete && candidate.operationId &&
        current.permissions.some(permission => permission.id === obsolete.id && permission.email?.toLowerCase() === obsolete.email?.toLowerCase()));
      if (!operation) return { state: 'reconciliation_required' as const, reason: 'Missing durable revocation operation.' };
      const result = operation.operationKind === 'anyone_reader' && 'revokeAnyone' in this.acl
        ? await (this.acl as any).revokeAnyone(input.policyId, operation.operationId, input.drive)
        : await this.acl.revokeReader(input.policyId, operation.operationId, input.drive);
      if (result.state !== 'revoked') return { state: result.state === 'busy' ? 'busy' as const : 'reconciliation_required' as const };
    }
    current = await input.inspect();
    if (current.file.status !== 'SAFE') return { state: 'reconciliation_required' as const, reason: 'Post-mutation Drive verification failed.' };
    const finalPlan = reconcilePrivateAclPermissions(input.companyEmail, input.readers, current.permissions);
    if (finalPlan.status === 'blocked' || finalPlan.missing.length || finalPlan.obsolete.length || finalPlan.duplicates.length)
      return { state: 'reconciliation_required' as const, reason: 'Private ACL remains incomplete.' };
    await this.acl.markVerified(input.policyId, input.policyVersion, input.credentialGeneration ? { companyAccountEmail:input.companyEmail, credentialGeneration:input.credentialGeneration } : undefined);
    return { state: 'verified' as const };
  }

  async revokeSuperseded(input: { operations: readonly { policyId: string; operationId: string; operationKind: 'direct_reader'|'anyone_reader' }[]; drive: PrivateAclDriveClient }) {
    for (const operation of input.operations) {
      if (operation.operationKind === 'anyone_reader' && (!('revokeAnyone' in this.acl) || typeof this.acl.revokeAnyone !== 'function')) return { state:'reconciliation_required' as const };
      const result = operation.operationKind === 'anyone_reader'
        ? await (this.acl as any).revokeAnyone(operation.policyId, operation.operationId, input.drive)
        : await this.acl.revokeReader(operation.policyId, operation.operationId, input.drive);
      if (result.state !== 'revoked') return { state: result.state === 'busy' ? 'busy' as const : 'reconciliation_required' as const };
    }
    return { state: 'revoked' as const };
  }
}
