import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import { featureSchemaFingerprint, lockAndValidateForeignKeys } from './feature-convergence.js';
import { disposableSchemaSecurityFingerprint } from './disposable-schema-audit.js';

// Test-only proof. No production runtime or normal migration runner calls this.
const directory = 'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg';
const seniorBaseline = '3539e64be39c76223f0a7c3c92f7e111b928a3c5f3d8f68193ad036a7c45ad50';
const combinedStrict = 'e156b4bfa82c28023466fa6d879c84c34eb3252b7f01884cae312e1a48434690';
const combinedLogical = 'b44aac02abd71f7de57715ac37aa952ccbc501ffc9e902a26f3542d6bbc987f6';
const seniorSecurity = '8fc3d90fe549c0e60bfd49b2ed40a85e30fdadfd5064aceb73d4f097697855ce';
const combinedSecurity = '8ef2ccabe698226fda927cac9befea46860ac222ced7d33ea3c93fb9301cec16';
const identityHash = '1d9a118a7a9140e17e6daee4ec34aff4c179f2bc22655a93b21b98a247609fb6';
const migrationHash = '239eeb190b2b31c464dfa875c11a340885adff10861fe7dec6ba1d20b8cc600f';
const id = 'senior-to-combined-v1';
const sha256 = (value:string) => createHash('sha256').update(value).digest('hex');

export async function convergeSeniorForDisposableTest(databaseUrl:string, identitiesPath:string, sqlPath:string,
  afterDdlForTest?:()=>Promise<void>) {
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'test' || target.protocol !== 'postgres:' || target.hostname !== '127.0.0.1' || target.port !== '55470' ||
    target.username !== 'ylaam_disposable_admin' || target.password || target.search || !/^\/ylaam_senior_disposable_[a-f0-9]{8}$/.test(target.pathname))
    throw new Error('Senior convergence is restricted to the isolated disposable test cluster.');
  const identitiesText = (await readFile(identitiesPath,'utf8')).replace(/\r\n/g,'\n');
  const migration = (await readFile(sqlPath,'utf8')).replace(/\r\n/g,'\n');
  if (sha256(identitiesText) !== identityHash || sha256(migration) !== migrationHash) throw new Error('Convergence inputs do not match the reviewed test artifacts.');
  const identities = JSON.parse(identitiesText) as Array<{timestamp:number;acceptedHashes:string[]}>;
  const sql = postgres(databaseUrl,{max:1,connect_timeout:3});
  try {
    return await sql.begin(async tx => {
      const [identity] = await tx`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
      if (identity.name !== target.pathname.slice(1) || identity.role !== target.username || identity.host !== '127.0.0.1/32' || identity.port !== 55470 || identity.directory !== directory)
        throw new Error('Disposable cluster identity mismatch.');
      await tx`select pg_advisory_xact_lock(1790812800)`;
      await lockAndValidateForeignKeys(tx as unknown as Sql);
      const ledger = await tx<{created_at:string;hash:string}[]>`select created_at,hash from drizzle.__drizzle_migrations`;
      if (ledger.length !== identities.length || new Set(ledger.map(row => row.created_at)).size !== ledger.length || ledger.some(row => {
        const expected=identities.find(item => item.timestamp === Number(row.created_at)); return !expected || !expected.acceptedHashes.includes(row.hash);
      })) throw new Error('Senior migration ledger is unknown or inconsistent.');
      const [marker] = await tx`select to_regclass('drizzle.senior_convergence_runs') as relation`;
      if (marker.relation) {
        await tx`lock table drizzle.senior_convergence_runs in access exclusive mode`;
        const records=await tx`select id,migration_hash from drizzle.senior_convergence_runs`;
        if (records.length !== 1 || records[0].id !== id || records[0].migration_hash !== migrationHash ||
            await featureSchemaFingerprint(tx as unknown as Sql) !== combinedStrict || await featureSchemaFingerprint(tx as unknown as Sql,true) !== combinedLogical ||
            await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== combinedSecurity)
          throw new Error('Converged schema or execution record does not match.');
        return 'already-converged' as const;
      }
      if (await featureSchemaFingerprint(tx as unknown as Sql) !== seniorBaseline || await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== seniorSecurity) throw new Error('Senior schema differs from the approved baseline.');
      await tx.unsafe(migration);
      if (await featureSchemaFingerprint(tx as unknown as Sql) !== combinedStrict || await featureSchemaFingerprint(tx as unknown as Sql,true) !== combinedLogical ||
          await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== combinedSecurity)
        throw new Error('Combined schema differs from the approved baseline.');
      await afterDdlForTest?.();
      await tx`create table drizzle.senior_convergence_runs (id text primary key,migration_hash text not null,applied_at timestamptz not null default now())`;
      await tx`insert into drizzle.senior_convergence_runs(id,migration_hash) values (${id},${migrationHash})`;
      return 'converged' as const;
    });
  } finally { await sql.end({timeout:3}); }
}
