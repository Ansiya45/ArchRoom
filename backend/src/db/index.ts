import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

const dbUrl = env.DATABASE_URL;

const client = postgres(dbUrl, { max: 1 });

export const db = drizzle(client, { schema });
export type Database = typeof db;
