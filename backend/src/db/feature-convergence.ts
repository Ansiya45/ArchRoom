import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import { disposableSchemaSecurityFingerprint } from './disposable-schema-audit.js';

// This prototype is deliberately restricted to the isolated test cluster.
// Production activation requires independently reviewed schema baselines.
const directory = 'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg';
const baselineHash = '9af12448cc8f97c7429ef2aeddbae23142ea0b14de5d23c896cb216051fdb8b7';
const combinedHash = 'ce31373040547b4a65d037fd007df14ef74c8348ef03a53d907da96d0a09bbc3';
const baselineSecurity = 'd156f86175592b1e5bb6aad42e01588d6efcfb66a42cfed541ae2b46268acad1';
const combinedSecurity = '8ef2ccabe698226fda927cac9befea46860ac222ced7d33ea3c93fb9301cec16';
const identityHash = '96ad8659464aefe694e45f22f975262fe6d1664f71518722949a59db5a8a2b4c';
const expectedMigrationHash = 'bbc9cd4e63bfd1ef8b2e2a34e9e3c6b5b2d97f2d786a8e814c88f782c8c91e18';
const convergenceId = 'feature-to-combined-v1';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export async function lockAndValidateForeignKeys(sql: Sql) {
  const tables = await sql<{schema_name:string;table_name:string}[]>`select n.nspname as schema_name,c.relname as table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','local_recording_staging') and c.relkind in ('r','p') order by n.nspname,c.relname`;
  for (const table of tables) await sql.unsafe(`lock table ${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.table_name)} in access exclusive mode`);
  const foreignKeys = await sql<{source_schema:string;source_table:string;target_schema:string;target_table:string;source_columns:string[];target_columns:string[];match_type:string}[]>`
    select ns.nspname as source_schema,src.relname as source_table,nt.nspname as target_schema,dst.relname as target_table,k.confmatchtype as match_type,
      array_agg(sa.attname order by pairs.ordinality) as source_columns,array_agg(da.attname order by pairs.ordinality) as target_columns
    from pg_constraint k join pg_class src on src.oid=k.conrelid join pg_namespace ns on ns.oid=src.relnamespace
    join pg_class dst on dst.oid=k.confrelid join pg_namespace nt on nt.oid=dst.relnamespace
    join unnest(k.conkey,k.confkey) with ordinality as pairs(source_att,target_att,ordinality) on true
    join pg_attribute sa on sa.attrelid=src.oid and sa.attnum=pairs.source_att
    join pg_attribute da on da.attrelid=dst.oid and da.attnum=pairs.target_att
    where k.contype='f' and ns.nspname in ('public','local_recording_staging')
    group by k.oid,ns.nspname,src.relname,nt.nspname,dst.relname,k.confmatchtype`;
  for (const fk of foreignKeys) {
    if (!fk.source_columns.length || fk.source_columns.length !== fk.target_columns.length) throw new Error('Foreign key metadata is invalid.');
    const source = `${quoteIdentifier(fk.source_schema)}.${quoteIdentifier(fk.source_table)}`;
    const target = `${quoteIdentifier(fk.target_schema)}.${quoteIdentifier(fk.target_table)}`;
    const nonNull = fk.source_columns.map(column => `s.${quoteIdentifier(column)} is not null`).join(' and ');
    const equal = fk.source_columns.map((column, index) => `s.${quoteIdentifier(column)}=d.${quoteIdentifier(fk.target_columns[index])}`).join(' and ');
    const partialNull = fk.match_type === 'f' ? ` or ((${fk.source_columns.map(column => `s.${quoteIdentifier(column)} is null`).join(' or ')}) and (${fk.source_columns.map(column => `s.${quoteIdentifier(column)} is not null`).join(' or ')}))` : '';
    const [violation] = await sql.unsafe(`select exists(select 1 from ${source} s where ((${nonNull}) and not exists(select 1 from ${target} d where ${equal}))${partialNull}) as found`);
    if (violation.found) throw new Error('Historical data violates a foreign key.');
  }
}

// Catalog definitions are sorted and include columns/defaults, table RLS,
// indexes, constraints, triggers, functions, enum labels and policies.
export async function featureSchemaSnapshot(sql: Sql, ignoreColumnOrder = false) {
  const query = `
    select kind, object_name, definition from (
      select 'relation' as kind, n.nspname||'.'||c.relname as object_name,
        concat_ws('|',c.relkind::text,c.relrowsecurity::text,c.relforcerowsecurity::text,coalesce(c.relacl::text,'')) as definition
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','local_recording_staging') and c.relkind in ('r','p','v','m','S')
      union all
      select 'column',n.nspname||'.'||c.relname||'.'||a.attname,
        concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull::text,a.attidentity::text,a.attgenerated::text,
          coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attnum::text)
        from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where n.nspname in ('public','local_recording_staging') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
      union all
      select 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,pg_get_constraintdef(k.oid,true)||'|'||k.convalidated::text
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','local_recording_staging')
      union all
      select 'index',n.nspname||'.'||i.relname,pg_get_indexdef(i.oid)||'|'||x.indisvalid::text
        from pg_index x join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=i.relnamespace
        where n.nspname in ('public','local_recording_staging')
      union all
      select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','local_recording_staging') and not t.tgisinternal
      union all
      select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','local_recording_staging')
        and not exists(select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e')
      union all
      select 'enum',n.nspname||'.'||t.typname,string_agg(e.enumlabel,',' order by e.enumsortorder)
        from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
        where n.nspname='public' group by n.nspname,t.typname
      union all
      select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
        concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
        from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','local_recording_staging')
    ) objects order by kind, object_name, definition`;
  return sql.unsafe(ignoreColumnOrder ? query.replace('a.attnum::text', "''") : query);
}
export async function featureSchemaFingerprint(sql: Sql, ignoreColumnOrder = false): Promise<string> {
  const rows = await featureSchemaSnapshot(sql, ignoreColumnOrder);
  return sha256(JSON.stringify(ignoreColumnOrder ? rows.map(row => ({ ...row, definition: String(row.definition).replace(/\r\n/g, '\n') })) : rows));
}

export async function convergeFeatureForDisposableTest(databaseUrl: string, identitiesPath: string, sqlPath: string,
  afterDdlForTest?: () => Promise<void>) {
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'test' || target.protocol !== 'postgres:' || target.hostname !== '127.0.0.1' || target.port !== '55470' ||
    target.username !== 'ylaam_disposable_admin' || target.password || target.search || !/^\/ylaam_(?:converge|fresh)_disposable_[a-f0-9]{8}$/.test(target.pathname))
    throw new Error('Feature convergence is restricted to the isolated disposable test cluster.');
  const identityFile = (await readFile(identitiesPath, 'utf8')).replace(/\r\n/g, '\n');
  const migration = (await readFile(sqlPath, 'utf8')).replace(/\r\n/g, '\n');
  if (sha256(identityFile) !== identityHash || sha256(migration) !== expectedMigrationHash) throw new Error('Convergence inputs do not match the reviewed test artifacts.');
  const identities = JSON.parse(identityFile) as Array<{timestamp:number; acceptedHashes:string[]}>;
  const migrationHash = sha256(migration);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    return await sql.begin(async tx => {
      const [identity] = await tx`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
      if (identity.name !== target.pathname.slice(1) || identity.role !== target.username || identity.host !== '127.0.0.1/32' || identity.port !== 55470 || identity.directory !== directory)
        throw new Error('Disposable cluster identity mismatch.');
      await tx`select pg_advisory_xact_lock(1790812800)`;
      await lockAndValidateForeignKeys(tx as unknown as Sql);
      const ledger = await tx<{created_at:string;hash:string}[]>`select created_at,hash from drizzle.__drizzle_migrations`;
      if (ledger.length !== identities.length || new Set(ledger.map(row => row.created_at)).size !== ledger.length || ledger.some(row => {
        const expected = identities.find(item => item.timestamp === Number(row.created_at)); return !expected || !expected.acceptedHashes.includes(row.hash);
      })) throw new Error('Feature migration ledger is unknown or inconsistent.');
      const [marker] = await tx`select to_regclass('drizzle.feature_convergence_runs') as relation`;
      if (marker.relation) {
        await tx`lock table drizzle.feature_convergence_runs in access exclusive mode`;
        const records = await tx`select id,migration_hash from drizzle.feature_convergence_runs`;
        if (records.length !== 1 || records[0].id !== convergenceId || records[0].migration_hash !== migrationHash ||
          await featureSchemaFingerprint(tx as unknown as Sql) !== combinedHash || await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== combinedSecurity)
          throw new Error('Converged schema or execution record does not match.');
        return 'already-converged' as const;
      }
      if (await featureSchemaFingerprint(tx as unknown as Sql) !== baselineHash || await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== baselineSecurity) throw new Error('Feature schema differs from the approved baseline.');
      await tx.unsafe(migration);
      if (await featureSchemaFingerprint(tx as unknown as Sql) !== combinedHash || await disposableSchemaSecurityFingerprint(tx as unknown as Sql) !== combinedSecurity) throw new Error('Combined schema differs from the approved baseline.');
      await afterDdlForTest?.();
      await tx`create table drizzle.feature_convergence_runs (id text primary key, migration_hash text not null, applied_at timestamptz not null default now())`;
      await tx`insert into drizzle.feature_convergence_runs(id,migration_hash) values (${convergenceId},${migrationHash})`;
      return 'converged' as const;
    });
  } finally { await sql.end({ timeout: 3 }); }
}
