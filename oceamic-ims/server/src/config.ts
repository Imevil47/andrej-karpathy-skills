import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit contenir au moins 16 caracteres'),
  PORT: z.coerce.number().int().positive(),
  HOST: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  WEB_ORIGIN: z.string().min(1),
});

export type AppConfig = Readonly<{
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  host: string;
  nodeEnv: 'development' | 'test' | 'production';
  webOrigin: string;
}>;

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.safeParse({
    DATABASE_URL: environment.DATABASE_URL,
    JWT_SECRET: environment.JWT_SECRET,
    PORT: environment.PORT ?? '3000',
    HOST: environment.HOST ?? '0.0.0.0',
    NODE_ENV: environment.NODE_ENV ?? 'development',
    WEB_ORIGIN: environment.WEB_ORIGIN ?? 'http://localhost:5173',
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration d'environnement invalide: ${details}`);
  }

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    nodeEnv: parsed.data.NODE_ENV,
    webOrigin: parsed.data.WEB_ORIGIN,
  };
}
