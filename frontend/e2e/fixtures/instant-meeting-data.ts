import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
const postgres = backendRequire('postgres') as typeof import('../../../backend/node_modules/postgres');

function connection() {
  const backend = parse(readFileSync(new URL('../../../backend/.env', import.meta.url)));
  return postgres(backend.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 1 });
}

export async function inspectInstantMeeting(code: string, email: string) {
  const sql = connection();
  try {
    const rows = await sql.begin('read only', tx => tx`
      select m.id, m.title, m.meeting_code, m.status, m.schedule_type, m.scheduled_at,
        m.time_zone, m.recurrence_rule, p.role, p.admission
      from meetings m
      join users u on u.id = m.host_user_id
      left join meeting_participants p on p.meeting_id = m.id and p.user_id = u.id
      where m.meeting_code = ${code} and u.email = ${email}
    `);
    return rows[0] ?? null;
  } finally { await sql.end({ timeout: 5 }); }
}

export async function removeInstantMeeting(code: string, email: string, title: string) {
  const sql = connection();
  try {
    return await sql.begin(async tx => {
      const rows = await tx`
        delete from meetings m using users u
        where m.host_user_id = u.id and m.meeting_code = ${code}
          and m.title = ${title} and u.email = ${email}
        returning m.id
      `;
      return rows.length;
    });
  } finally { await sql.end({ timeout: 5 }); }
}
