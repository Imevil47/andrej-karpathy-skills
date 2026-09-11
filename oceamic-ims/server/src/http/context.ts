import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RoleCode } from '../domain/types.ts';
import { roleHasPermission, type Permission } from '../domain/permissions.ts';
import { forbiddenError, unauthenticatedError } from '../errors.ts';

export type SessionUser = Readonly<{
  id: string;
  username: string;
  fullName: string;
  role: RoleCode;
}>;

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: SessionUser | null;
  }
}

export const SESSION_COOKIE = 'oceamic_session';

/**
 * Reads the signed session token. Routes never trust the client for identity or
 * for permissions: both come from the token and the role table.
 */
export async function loadSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  try {
    return await request.jwtVerify<SessionUser>({ onlyCookie: true });
  } catch {
    return null;
  }
}

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.currentUser) {
    throw unauthenticatedError();
  }
  return request.currentUser;
}

export function requirePermission(request: FastifyRequest, permission: Permission): SessionUser {
  const user = requireUser(request);
  if (!roleHasPermission(user.role, permission)) {
    throw forbiddenError(permission);
  }
  return user;
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
