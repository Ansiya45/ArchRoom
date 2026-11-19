import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { classifyMigrationLineage } from './migration-lineage.js';
import { convergeFeatureForDisposableTest, featureSchemaFingerprint, lockAndValidateForeignKeys } from './feature-convergence.js';
import { convergeSeniorForDisposableTest } from './senior-convergence.js';
import { disposableSchemaSecurityFingerprint } from './disposable-schema-audit.js';
import { hostAssignmentInstalled, hostAssignmentSchemas, hostAssignmentSecurity } from './meeting-host-migration.js';

// Experimental coordinator: never use against non-disposable databases.
const directory = 'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg';
const featureIdentitiesHash = '96ad8659464aefe694e45f22f975262fe6d1664f71518722949a59db5a8a2b4c';
const seniorIdentitiesHash = '1d9a118a7a9140e17e6daee4ec34aff4c179f2bc22655a93b21b98a247609fb6';
const featureDeltaHash = 'bbc9cd4e63bfd1ef8b2e2a34e9e3c6b5b2d97f2d786a8e814c88f782c8c91e18';
const featureBaseline = '9af12448cc8f97c7429ef2aeddbae23142ea0b14de5d23c896cb216051fdb8b7';
const featureCombined = 'ce31373040547b4a65d037fd007df14ef74c8348ef03a53d907da96d0a09bbc3';
const featureBaselineSecurity = 'd156f86175592b1e5bb6aad42e01588d6efcfb66a42cfed541ae2b46268acad1';
const combinedSecurity = '8ef2ccabe698226fda927cac9befea46860ac222ced7d33ea3c93fb9301cec16';
const seniorCombined = 'e156b4bfa82c28023466fa6d879c84c34eb3252b7f01884cae312e1a48434690';
const seniorDeltaHash = '239eeb190b2b31c464dfa875c11a340885adff10861fe7dec6ba1d20b8cc600f';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Identity = { timestamp:number; tag:string; acceptedHashes:string[] };

export function isDisposableCoordinatorTarget(target: URL) {
  return target.protocol === 'postgres:' && target.hostname === '127.0.0.1' && target.port === '55470' &&
    target.username === 'ylaam_disposable_admin' && !target.password && !target.search &&
    /^\/ylaam_(?:(?:converge|senior|fresh)_disposable_[a-f0-9]{8}|staging_disposable_[a-z0-9_]+)$/.test(target.pathname);
}

export async function coordinateDisposableMigration(databaseUrl:string, root:string, afterDdlForTest?:()=>Promise<void>, verifyOnly=false) {
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'test' || !isDisposableCoordinatorTarget(target)) throw new Error('Disposable coordinator target is invalid.');
  const readPinned = async (path:string, expected:string) => {
    const text=(await readFile(path,'utf8')).replace(/\r\n/g,'\n');
    if(hash(text)!==expected)throw new Error('Migration artifact differs from its pinned identity.');
    return text;
  };
  const featurePath=join(root,'src/db/feature-ledger-identities.json'), seniorPath=join(root,'src/db/senior-ledger-identities.json');
  const feature=JSON.parse(await readPinned(featurePath,featureIdentitiesHash)) as Identity[];
  const senior=JSON.parse(await readPinned(seniorPath,seniorIdentitiesHash)) as Identity[];
  const deltaPath=join(root,'drizzle/convergence/feature-to-combined-v1.sql');
  const delta=await readPinned(deltaPath,featureDeltaHash);
  const sql=postgres(databaseUrl,{max:1,connect_timeout:3});
  let lineage:'fresh-candidate'|'feature-candidate'|'senior-candidate'|'already-converged';
  try {
    lineage=await sql.begin(async tx=>{
      const [identity]=await tx`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
      if(identity.name!==target.pathname.slice(1)||identity.role!==target.username||identity.host!=='127.0.0.1/32'||identity.port!==55470||identity.directory!==directory)
        throw new Error('Disposable cluster identity mismatch.');
      await tx`select pg_advisory_xact_lock(1790812800)`;
      const [tables]=await tx`select to_regclass('drizzle.__drizzle_migrations') as ledger,to_regclass('drizzle.feature_convergence_runs') as feature_marker,to_regclass('drizzle.senior_convergence_runs') as senior_marker`;
      if(tables.feature_marker && tables.senior_marker)throw new Error('Multiple convergence records are ambiguous.');
      const applied=tables.ledger ? await tx<{created_at:string;hash:string}[]>`select created_at,hash from drizzle.__drizzle_migrations` : [];
      const candidate=classifyMigrationLineage(applied.map(row=>({timestamp:Number(row.created_at),hash:row.hash})),feature,senior);
      if(candidate!=='fresh-candidate') {
        if((candidate==='feature-candidate' && tables.senior_marker)||(candidate==='senior-candidate' && tables.feature_marker))throw new Error('Convergence marker does not match history.');
        const hostExtension = await hostAssignmentInstalled(tx as unknown as Sql);
        if(verifyOnly || hostExtension || tables.feature_marker || tables.senior_marker) {
          const isFeature=candidate==='feature-candidate';
          if(isFeature ? !tables.feature_marker : !tables.senior_marker)throw new Error('Convergence record is missing.');
          await lockAndValidateForeignKeys(tx as unknown as Sql);
          const records=isFeature ? await tx`select id,migration_hash from drizzle.feature_convergence_runs`
            : await tx`select id,migration_hash from drizzle.senior_convergence_runs`;
          if(records.length!==1 || records[0].id!==(isFeature?'feature-to-combined-v1':'senior-to-combined-v1') ||
            records[0].migration_hash!==(isFeature?featureDeltaHash:seniorDeltaHash) ||
            await featureSchemaFingerprint(tx as unknown as Sql)!==(hostExtension ? (isFeature ? hostAssignmentSchemas.feature : hostAssignmentSchemas.senior) : (isFeature?featureCombined:seniorCombined)) ||
            await disposableSchemaSecurityFingerprint(tx as unknown as Sql)!==(hostExtension ? hostAssignmentSecurity : combinedSecurity))throw new Error('Converged database is not ready.');
          return 'already-converged' as const;
        }
        return candidate;
      }
      if(verifyOnly)throw new Error('Fresh database is not ready.');
      if(tables.feature_marker||tables.senior_marker)throw new Error('A fresh database cannot contain a convergence marker.');
      const [objects]=await tx`select
        (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle','local_recording_staging') and c.relkind in ('r','p','v','m','S','f')) as relations,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','drizzle','local_recording_staging')) as functions,
        (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','drizzle','local_recording_staging') and t.typtype in ('e','d','c')) as types,
        (select count(*)::int from pg_namespace where nspname not in ('pg_catalog','information_schema','public','drizzle') and nspname not like 'pg_toast%' and nspname not like 'pg_temp_%') as extra_schemas`;
      if(objects.relations||objects.functions||objects.types||objects.extra_schemas)throw new Error('Fresh database contains unexpected schema objects.');
      await tx`create schema if not exists drizzle`;
      await tx`create table drizzle.__drizzle_migrations (id serial primary key,hash text not null,created_at bigint)`;
      for(const item of feature){
        if(!/^[a-z0-9_]+$/.test(item.tag))throw new Error('Migration filename is invalid.');
        const text=await readFile(join(root,'drizzle',`${item.tag}.sql`),'utf8');
        const actual=hash(text);
        if(!item.acceptedHashes.includes(actual))throw new Error('Historical migration does not match its identity.');
        await tx.unsafe(text);
        await tx`insert into drizzle.__drizzle_migrations(hash,created_at) values (${actual},${item.timestamp})`;
      }
      if(await featureSchemaFingerprint(tx as unknown as Sql)!==featureBaseline || await disposableSchemaSecurityFingerprint(tx as unknown as Sql)!==featureBaselineSecurity)throw new Error('Fresh feature baseline is inconsistent.');
      await tx.unsafe(delta);
      if(await featureSchemaFingerprint(tx as unknown as Sql)!==featureCombined || await disposableSchemaSecurityFingerprint(tx as unknown as Sql)!==combinedSecurity)throw new Error('Fresh combined schema is inconsistent.');
      await afterDdlForTest?.();
      await tx`create table drizzle.feature_convergence_runs (id text primary key,migration_hash text not null,applied_at timestamptz not null default now())`;
      await tx`insert into drizzle.feature_convergence_runs(id,migration_hash) values ('feature-to-combined-v1',${featureDeltaHash})`;
      return candidate;
    });
  } finally {await sql.end({timeout:3});}
  if(lineage==='feature-candidate')return convergeFeatureForDisposableTest(databaseUrl,featurePath,deltaPath,afterDdlForTest);
  if(lineage==='senior-candidate')return convergeSeniorForDisposableTest(databaseUrl,seniorPath,join(root,'drizzle/convergence/senior-to-combined-v1.sql'),afterDdlForTest);
  if(lineage==='already-converged')return lineage;
  return 'fresh-converged' as const;
}
