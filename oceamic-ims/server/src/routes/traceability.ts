import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, uuidSchema } from '../http/schemas.ts';
import { lotSituation, search } from '../services/traceability.ts';

type AuditRow = Readonly<{
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  newValues: Record<string, unknown> | null;
  oldValues: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  userName: string | null;
}>;

export async function registerTraceabilityRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/lots/:id/situation', async (request) => {
    requirePermission(request, 'traceability:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return lotSituation(pool, id);
  });

  app.get('/api/search', async (request) => {
    requirePermission(request, 'traceability:read');
    const { q } = z.object({ q: z.string().trim().min(2) }).parse(request.query);
    return search(pool, q);
  });

  app.get('/api/audit', async (request) => {
    requirePermission(request, 'audit:read');
    const query = z
      .object({ entite: uuidSchema.nullish(), limite: limitSchema.nullish() })
      .parse(request.query);
    const result = await pool.query<AuditRow>(
      `SELECT a.id          AS "id",
              a.occurred_at AS "occurredAt",
              a.action      AS "action",
              a.entity_type AS "entityType",
              a.entity_id   AS "entityId",
              a.new_values  AS "newValues",
              a.old_values  AS "oldValues",
              a.context     AS "context",
              u.full_name   AS "userName"
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE ($1::uuid IS NULL OR a.entity_id = $1)
        ORDER BY a.occurred_at DESC
        LIMIT $2`,
      [query.entite ?? null, query.limite ?? 100],
    );
    return result.rows;
  });
}
