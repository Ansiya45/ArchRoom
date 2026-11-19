import type { Sql } from 'postgres';

// Read-only building block. Callers must establish the approval's provenance
// independently; this function deliberately does not enable migrations.
export type ApprovedTestTarget = {
  systemIdentifier: string;
  databaseOid: string;
  database: string;
  role: string;
  address: string;
  port: number;
  dataDirectory: string;
};

export async function attestTestTarget(sql: Sql, approval: ApprovedTestTarget): Promise<void> {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test target attestation is disabled outside test mode.');
  const [actual] = await sql`select (select system_identifier::text from pg_control_system()) as system_identifier,
    d.oid::text as database_oid, current_database() as database, current_user as role,
    inet_server_addr()::text as address, inet_server_port() as port,
    current_setting('data_directory') as data_directory,
    r.rolsuper as superuser, has_database_privilege(current_user, d.oid, 'CREATE') as can_create
    from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()`;
  if (!actual || !approval.systemIdentifier || !approval.databaseOid || !approval.database || !approval.role ||
      approval.address !== '127.0.0.1/32' || actual.address !== approval.address ||
      actual.system_identifier !== approval.systemIdentifier || actual.database_oid !== approval.databaseOid ||
      actual.database !== approval.database || actual.role !== approval.role || actual.port !== approval.port ||
      actual.data_directory !== approval.dataDirectory || actual.superuser !== true || actual.can_create !== true)
    throw new Error('Test database identity or privileges do not match the approved target.');
}
