import 'dotenv/config';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default(
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'
  ),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Each backend or worker process has its own pool; keep the shared DB budget bounded.
  DB_POOL_MAX: z.string().regex(/^[1-5]$/, 'DB_POOL_MAX must be an integer from 1 to 5').default('3').transform(Number),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  COMPANY_DRIVE_UPLOAD_JOBS_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  LOCAL_RECORDING_STAGING_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  // Stage A only: no OAuth endpoint or Drive client is enabled by these values.
  GOOGLE_INTEGRATION_ADMIN_USER_ID: z.string().uuid().optional(),
  GOOGLE_INTEGRATION_TOKEN_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_CALLBACK_URL: z.string().url().optional(),
  STUDENT_GOOGLE_CLIENT_ID: z.string().optional(),
  STUDENT_GOOGLE_CLIENT_SECRET: z.string().optional(),
  STUDENT_GOOGLE_OAUTH_CALLBACK_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('meeting-recordings'),
  SUPABASE_CHAT_FILES_BUCKET: z.string().default('meeting-chat-files'),
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  APP_PUBLIC_URL: z.string().url().optional(),
  MEETING_EMAIL_FROM: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-transcribe'),
  OPENAI_SUMMARY_MODEL: z.string().default('gpt-4.1-mini'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('YLAAM-MEET <onboarding@resend.dev>'),
  TRANSCRIPT_EMAIL_FROM: z.string().default('YLAAM-MEET <onboarding@resend.dev>'),
});

export const env = envSchema.parse(process.env);
