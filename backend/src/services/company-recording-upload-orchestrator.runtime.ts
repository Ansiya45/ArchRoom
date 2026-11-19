import { env } from '../env.js';
import { client } from '../db/index.js';
import { CompanyRecordingJobsService } from './company-recording-jobs.service.js';
import { CompanyRecordingDriveIntentService } from './company-recording-drive-intent.service.js';
import { CompanyRecordingResumableTransport } from './company-recording-resumable-transport.js';
import { CompanyRecordingTransferWorker } from './company-recording-transfer-worker.js';
import { CompanyRecordingDriveVerificationService } from './company-recording-drive-verification.service.js';
import { CompanyRecordingHistoryPublicationService } from './company-recording-history-publication.service.js';
import { CompanyRecordingUploadOrchestrator } from './company-recording-upload-orchestrator.js';
import { companyRecordingDriveAccess } from './company-recording-drive-access.js';
import { CompanyRecordingDriveFileInspector } from './company-recording-drive-file-inspector.js';
import { parseTokenKey } from './drive-security.service.js';
import { LocalRecordingIngestion } from './local-recording-ingestion.service.js';
import { TRPCError } from '@trpc/server';
import { CompanyRecordingPrivateAclService } from './company-recording-private-acl.service.js';
import { CompanyRecordingPrivatePolicyIntentBuilder } from './company-recording-private-policy-intent-builder.js';
import { CompanyRecordingPrivateAclPipelineAdapter } from './company-recording-private-acl-pipeline-adapter.js';
import { CompanyRecordingDriveAclClient } from './company-recording-drive-acl-client.js';
import { CompanyRecordingPrivateAclWorker } from './company-recording-private-acl-worker.js';
import { CompanyRecordingSharingRuntimeService } from './company-recording-sharing-runtime.service.js';
import { companyRecordingSharingReadiness } from './company-recording-sharing-readiness.js';
import { requireLocalStaging } from './local-recording-ingestion.service.js';

let instance:CompanyRecordingUploadOrchestrator|undefined;
export function companyRecordingUploadOrchestrator(){
  if(instance)return instance;
  if(!env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED||!env.LOCAL_RECORDING_STAGING_ENABLED||env.NODE_ENV==='production')
    throw new TRPCError({code:'PRECONDITION_FAILED',message:'Company recording processing is unavailable.'});
  const config={nodeEnv:env.NODE_ENV,jobsEnabled:env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,
    localEnabled:env.LOCAL_RECORDING_STAGING_ENABLED,databaseUrl:env.DATABASE_URL};
  const jobs=new CompanyRecordingJobsService(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED);
  const privacy=(jobId:string,userId:string)=>jobs.validateImmediatelyBeforeFileCreation(jobId,userId);
  const authorize=(jobId:string,userId:string)=>jobs.status(jobId,userId);
  const access=companyRecordingDriveAccess();
  const transport=new CompanyRecordingResumableTransport(fetch);
  const intent=new CompanyRecordingDriveIntentService(client,config,authorize,privacy,access,transport,parseTokenKey(env.GOOGLE_INTEGRATION_TOKEN_KEY));
  const transfer=new CompanyRecordingTransferWorker(client,config,authorize,privacy,access,intent,transport);
  const inspector=new CompanyRecordingDriveFileInspector(fetch);
  const verification=new CompanyRecordingDriveVerificationService(client,config,authorize,privacy,access,inspector);
  const publication=new CompanyRecordingHistoryPublicationService(client,config,authorize,privacy,access,inspector);
  const ingestion=new LocalRecordingIngestion(client,config,authorize);
  instance=new CompanyRecordingUploadOrchestrator(client,config,jobs,intent,transfer,verification,publication,ingestion);
  return instance;
}

// Web-process polling is deliberately limited to explicitly enabled local
// development/test with the existing disposable-database guard. Production
// needs an approved durable worker runtime before this pipeline can run there.
export function startCompanyRecordingUploadOrchestration(){
  if(env.NODE_ENV==='production'||!env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED||!env.LOCAL_RECORDING_STAGING_ENABLED)return;
  companyRecordingUploadOrchestrator().startPolling();
}

export function companyRecordingSharingRuntime() {
  const readiness = companyRecordingSharingReadiness();
  if (!readiness.ready) throw new TRPCError({code:'PRECONDITION_FAILED',message:readiness.reason});
  const config={nodeEnv:env.NODE_ENV,jobsEnabled:env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,localEnabled:env.LOCAL_RECORDING_STAGING_ENABLED,databaseUrl:env.DATABASE_URL};
  requireLocalStaging(config);
  const jobs=new CompanyRecordingJobsService(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED);
  const access=companyRecordingDriveAccess();
  const acl=new CompanyRecordingPrivateAclService(client);
  const drive=new CompanyRecordingDriveAclClient(access);
  const inspector=new CompanyRecordingDriveFileInspector(fetch);
  const builder=new CompanyRecordingPrivatePolicyIntentBuilder(client,acl,{account:access,validateDestination:(jobId,ownerId)=>jobs.validateExistingRecordingDestination(jobId,ownerId)});
  const pipeline=new CompanyRecordingPrivateAclPipelineAdapter(client,acl,access,inspector,drive);
  return new CompanyRecordingSharingRuntimeService(acl,new CompanyRecordingPrivateAclWorker(acl),pipeline,{
    sql:client, assertReady:()=>{if(!companyRecordingSharingReadiness().ready) throw new TRPCError({code:'PRECONDITION_FAILED',message:'Recording sharing changes are unavailable.'}); requireLocalStaging(config);},
    validateDestination:(jobId,ownerId)=>jobs.validateExistingRecordingDestination(jobId,ownerId), access,
    resolveRecipients:(tx,jobId,ownerId,mode)=>builder.resolveReplacementRecipients(tx,jobId,ownerId,mode), drive,
  });
}
