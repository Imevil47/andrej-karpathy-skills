import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import type { AppConfig } from './config.ts';
import { AppError } from './errors.ts';
import { loadSessionUser } from './http/context.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHomeRoutes } from './routes/home.ts';
import { registerLotRoutes } from './routes/lots.ts';
import { registerMasterDataRoutes } from './routes/masterdata.ts';
import { registerQualityRoutes } from './routes/quality.ts';
import { registerReceptionRoutes } from './routes/receptions.ts';
import { registerStockRoutes } from './routes/stock.ts';
import { registerSubcontractingRoutes } from './routes/subcontracting.ts';
import { registerTraceabilityRoutes } from './routes/traceability.ts';

export type AppDependencies = Readonly<{ pool: pg.Pool; config: AppConfig }>;

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.config.nodeEnv === 'test' ? false : { level: 'info' },
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: dependencies.config.jwtSecret,
    cookie: { cookieName: 'oceamic_session', signed: false },
  });

  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = await loadSessionUser(request);
  });

  // Single error translation point: business errors keep their French message,
  // unexpected errors are logged and never leak internals to the operator.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        { code: error.code, details: error.details, route: request.url },
        error.message,
      );
      return reply.status(error.httpStatus).send({ code: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.join('.') || 'champ'} : ${issue.message}`)
        .join(' ; ');
      request.log.warn({ issues: error.issues, route: request.url }, 'Validation échouée');
      return reply.status(400).send({ code: 'VALIDATION', message: `Données invalides. ${message}` });
    }
    request.log.error({ err: error, route: request.url }, 'Erreur inattendue');
    return reply.status(500).send({
      code: 'ERREUR_INTERNE',
      message: "Une erreur technique est survenue. L'opération n'a pas été enregistrée.",
    });
  });

  app.get('/api/health', async () => {
    await dependencies.pool.query('SELECT 1');
    return { status: 'ok' };
  });

  await registerAuthRoutes(app, dependencies);
  await registerHomeRoutes(app, dependencies);
  await registerMasterDataRoutes(app, dependencies);
  await registerReceptionRoutes(app, dependencies);
  await registerStockRoutes(app, dependencies);
  await registerLotRoutes(app, dependencies);
  await registerSubcontractingRoutes(app, dependencies);
  await registerQualityRoutes(app, dependencies);
  await registerTraceabilityRoutes(app, dependencies);

  return app;
}
