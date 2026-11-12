import postgres from 'postgres';
const sql = postgres(process.env.TEST_DATABASE_URL);
const [row] = await sql.unsafe('select current_database()');
const expected = new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);
if (row.current_database !== expected) throw new Error('database identity mismatch');
await sql.end();
