import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { permissionsForRole } from '../domain/permissions.ts';
import { SESSION_COOKIE, clearSession, requireUser } from '../http/context.ts';
import { authenticate } from '../services/auth.ts';

const loginSchema = z.object({
  username: z.string().trim().min(1, "L'identifiant est obligatoire."),
  password: z.string().min(1, 'Le mot de passe est obligatoire.'),
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const credentials = loginSchema.parse(request.body);
    const user = await authenticate(dependencies.pool, credentials.username, credentials.password);
    const token = app.jwt.sign(user, { expiresIn: '12h' });

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: dependencies.config.nodeEnv === 'production',
      maxAge: 12 * 60 * 60,
    });

    return { user, permissions: permissionsForRole(user.role) };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply);
    return { status: 'ok' };
  });

  app.get('/api/auth/me', async (request) => {
    const user = requireUser(request);
    return { user, permissions: permissionsForRole(user.role) };
  });
}
