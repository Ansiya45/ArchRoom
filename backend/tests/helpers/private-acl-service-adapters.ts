import type { Sql } from 'postgres';
import { CompanyRecordingPrivateAclService } from '../../src/services/company-recording-private-acl.service.js';
import { CompanyRecordingPrivatePolicyIntentBuilder } from '../../src/services/company-recording-private-policy-intent-builder.js';
import { CompanyRecordingPrivateAclPipelineAdapter } from '../../src/services/company-recording-private-acl-pipeline-adapter.js';
import type { CompanyRecordingDriveAclClient } from '../../src/services/company-recording-drive-acl-client.js';
import type { CompanyRecordingDriveFileInspector } from '../../src/services/company-recording-drive-file-inspector.js';

export type PrivateAclServiceAdapters = {
  acl: CompanyRecordingPrivateAclService;
  intentBuilder: CompanyRecordingPrivatePolicyIntentBuilder;
  pipeline: CompanyRecordingPrivateAclPipelineAdapter;
};

/**
 * Test-only composition of the real ACL services. Callers must supply real
 * transition callbacks for authentication, staging, and History; this module
 * never inserts verified or published state directly.
 */
export function createPrivateAclServiceAdapters(input: {
  sql: Sql;
  access: () => Promise<{ accountEmail: string; credentialGeneration: string; accessToken: string }>;
  validateDestination: (jobId: string, ownerId: string) => Promise<unknown>;
  inspector: CompanyRecordingDriveFileInspector;
  drive: CompanyRecordingDriveAclClient;
}): PrivateAclServiceAdapters {
  const acl = new CompanyRecordingPrivateAclService(input.sql);
  const intentBuilder = new CompanyRecordingPrivatePolicyIntentBuilder(input.sql, acl, {
    account: async () => {
      const value = await input.access();
      return { accountEmail: value.accountEmail, credentialGeneration: value.credentialGeneration };
    },
    validateDestination: input.validateDestination,
  });
  const pipeline = new CompanyRecordingPrivateAclPipelineAdapter(input.sql, acl, input.access, input.inspector, input.drive);
  return { acl, intentBuilder, pipeline };
}

export type ServiceTransitionAdapters = {
  createUser: (input: { email: string; password: string; emailVerified: boolean }) => Promise<{ id: string; sessionId: string }>;
  createMeeting: (input: { creatorId: string; hostId: string; folderId: string | null; accessPolicy: 'private' }) => Promise<{ id: string }>;
  createRecordingJob: (input: { ownerId: string; meetingId: string; recordingId: string; mimeType: string; byteLength: number; sha256: string; destinationFolderId: string }) => Promise<{ id: string }>;
  ingestAndVerifyRecording: (input: { jobId: string; ownerId: string; recordingId: string; bytes: Uint8Array }) => Promise<void>;
  publishHistory: (input: { jobId: string; ownerId: string }) => Promise<void>;
};

export function requireServiceTransition<T extends keyof ServiceTransitionAdapters>(adapters: Partial<ServiceTransitionAdapters>, name: T): ServiceTransitionAdapters[T] {
  const transition = adapters[name];
  if (!transition) throw new Error(`Test transition is unavailable: ${String(name)}`);
  return transition as ServiceTransitionAdapters[T];
}
