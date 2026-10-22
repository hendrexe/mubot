import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: string | undefined) => (value ? value : undefined);

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'is required'),
  DEV_GUILD_ID: z.string().optional().transform(emptyToUndefined),
  DATABASE_PATH: z.string().default('./data/bot.sqlite'),
  CHALLENGERMODE_REFRESH_KEY: z.string().min(1, 'is required'),
  CHALLENGERMODE_POLL_INTERVAL_MINUTES: z.coerce.number().positive().default(360),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
  process.exit(1);
}

export const env = parsed.data;
