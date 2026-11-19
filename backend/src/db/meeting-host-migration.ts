import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { coordinateDisposableMigration } from './disposable-migration-coordinator.js';
import { featureSchemaFingerprint, lockAndValidateForeignKeys } from './feature-convergence.js';
import { disposableSchemaSecurityFingerprint } from './disposable-schema-audit.js';

export const hostAssignmentHash = 'be6ae18e4b03ba21d30e4ec771e790257f7d44de9cbb406c870b6d7ad393ab81';
export const hostAssignmentSecurity = '75b5b1ecc85bea7ebace7193778a78b7023ecc8086c8840bf2dd474bdcaebbaf';
export const hostAssignmentSchemas = {
  feature: 'd5422fb47a418b99206cb403a3759cb1366d3e190bfacb619653666b66322b3b',
  senior: '425c143ead3d6725e6cc8c20fbf576ba711b301a4ab13c5bc2a241552166b6f3',
};

export async function hostAssignmentInstalled(sql: Sql) {
  const [row] = await sql`select to_regclass('drizzle.meeting_host_assignment_runs') as marker`;
  if (!row.marker) return false;
  const records = await sql`select id,migration_hash from drizzle.meeting_host_assignment_runs`;
  if (records.length !== 1 || records[0].id !== 'meeting-host-assignment-v1' || records[0].migration_hash !== hostAssignmentHash)
    throw new Error('Host assignment migration evidence is invalid.');
  return true;
}

export async function migrateMeetingHostAssignment(databaseUrl: string, root: string, interruption?: () => Promise<void>) {
  // This verifies the exact disposable target, authentic historical ledger,
  // convergence evidence and complete schema/security snapshot before writes.
  await coordinateDisposableMigration(databaseUrl, root, undefined, true);
  const ddl = (await readFile(join(root, 'drizzle/convergence/meeting-host-assignment-v1.sql'), 'utf8')).replace(/\r\n/g, '\n');
  if (createHash('sha256').update(ddl).digest('hex') !== hostAssignmentHash) throw new Error('Host assignment SQL identity mismatch.');
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(1790812800)`;
      const connection = tx as unknown as Sql;
      const [lineage] = await tx`select to_regclass('drizzle.feature_convergence_runs') as feature`;
      const installed = await hostAssignmentInstalled(connection);
      const expected = lineage.feature ? hostAssignmentSchemas.feature : hostAssignmentSchemas.senior;
      if (installed) {
        if (await featureSchemaFingerprint(connection) !== expected || await disposableSchemaSecurityFingerprint(connection) !== hostAssignmentSecurity) throw new Error('Host assignment schema drift.');
        return;
      }
      // Recheck after taking the lock: preflight and migration must agree.
      const baseline = lineage.feature ? 'ce31373040547b4a65d037fd007df14ef74c8348ef03a53d907da96d0a09bbc3' : 'e156b4bfa82c28023466fa6d879c84c34eb3252b7f01884cae312e1a48434690';
      if (await featureSchemaFingerprint(connection) !== baseline || await disposableSchemaSecurityFingerprint(connection) !== '8ef2ccabe698226fda927cac9befea46860ac222ced7d33ea3c93fb9301cec16') throw new Error('Host assignment preflight drift.');
      await lockAndValidateForeignKeys(connection);
      await tx.unsafe(ddl);
      await interruption?.();
      await tx`insert into drizzle.meeting_host_assignment_runs(id,migration_hash) values ('meeting-host-assignment-v1',${hostAssignmentHash})`;
      await lockAndValidateForeignKeys(connection);
      if (await featureSchemaFingerprint(connection) !== expected || await disposableSchemaSecurityFingerprint(connection) !== hostAssignmentSecurity) throw new Error('Host assignment postconditions failed.');
    });
  } finally { await sql.end(); }
}
