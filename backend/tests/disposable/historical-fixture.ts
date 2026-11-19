import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rebuild the historical journal from pinned identities, never from a live database.
export async function historicalFixture(lineage: 'feature' | 'senior'): Promise<string> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const identities = JSON.parse(await readFile(join(root, 'src/db', `${lineage}-ledger-identities.json`), 'utf8')) as
    { timestamp: number; tag: string; acceptedHashes: string[] }[];
  const folder = await mkdtemp(join(tmpdir(), `ylaam-${lineage}-migrations-`));
  await mkdir(join(folder, 'meta'));
  for (const item of identities) {
    if (!/^[a-z0-9_]+$/.test(item.tag)) throw new Error('Invalid historical migration tag');
    const sql = await readFile(join(root, 'drizzle', `${item.tag}.sql`));
    if (!item.acceptedHashes.includes(createHash('sha256').update(sql).digest('hex'))) throw new Error(`Historical migration hash mismatch: ${item.tag}`);
    await writeFile(join(folder, `${item.tag}.sql`), sql);
  }
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries: identities.map((item, idx) => ({ idx, version: '7', when: item.timestamp, tag: item.tag, breakpoints: true })) }));
  return folder;
}
