import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';

// Additional comparison for the disposable test cluster. This does not
// establish production equivalence or inspect objects in arbitrary schemas.
export async function disposableSchemaSecuritySnapshot(sql:Sql) {
  return sql.unsafe(`select kind,object_name,definition from (
    select 'schema' as kind,n.nspname as object_name,concat_ws('|',pg_get_userbyid(n.nspowner),coalesce(n.nspacl::text,'')) as definition
      from pg_namespace n where n.nspname in ('public','local_recording_staging')
    union all
    select 'relation_owner',n.nspname||'.'||c.relname,concat_ws('|',pg_get_userbyid(c.relowner),coalesce(c.relacl::text,''),c.relpersistence::text)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','local_recording_staging') and c.relkind in ('r','p','v','m','S','f')
    union all
    select 'view',n.nspname||'.'||c.relname,pg_get_viewdef(c.oid,true)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','local_recording_staging') and c.relkind in ('v','m')
    union all
    select 'sequence',n.nspname||'.'||c.relname,concat_ws('|',s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle::text)
      from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','local_recording_staging')
    union all
    select 'function_access',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      concat_ws('|',pg_get_userbyid(p.proowner),coalesce(p.proacl::text,''),p.prosecdef::text,coalesce(p.proconfig::text,''))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','local_recording_staging')
    union all
    select 'trigger_state',n.nspname||'.'||c.relname||'.'||coalesce(k.conname,t.tgname)||'.'||t.tgtype::text,
      concat_ws('|',t.tgenabled::text,t.tgisinternal::text,p.proname,encode(t.tgargs,'hex'),coalesce(pg_get_expr(t.tgqual,t.tgrelid),''))
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_proc p on p.oid=t.tgfoid left join pg_constraint k on k.oid=t.tgconstraint
      where n.nspname in ('public','local_recording_staging')
    union all
    select 'default_acl',coalesce(n.nspname,''),concat_ws('|',pg_get_userbyid(d.defaclrole),d.defaclobjtype::text,d.defaclacl::text)
      from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname in ('public','local_recording_staging')
  ) items order by kind,object_name,definition`);
}
export async function disposableSchemaSecurityFingerprint(sql:Sql) {
  const rows=await disposableSchemaSecuritySnapshot(sql);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
