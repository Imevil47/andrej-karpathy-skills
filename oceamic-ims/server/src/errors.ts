import { formatQuantity, type QuantityKg } from './domain/quantity.ts';

export type AppErrorCode =
  | 'VALIDATION'
  | 'NON_AUTHENTIFIE'
  | 'DROITS_INSUFFISANTS'
  | 'INTROUVABLE'
  | 'CONFLIT'
  | 'STOCK_INSUFFISANT'
  | 'LOT_BLOQUE'
  | 'CONFIRMATION_REQUISE';

/**
 * Business error carrying a user-facing French message and the technical
 * context needed to understand the failure in the logs.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AppErrorCode,
    httpStatus: number,
    message: string,
    details: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function validationError(message: string, details: Readonly<Record<string, unknown>>): AppError {
  return new AppError('VALIDATION', 400, message, details);
}

export function notFoundError(what: string, identifier: string): AppError {
  return new AppError('INTROUVABLE', 404, `${what} introuvable.`, { identifier });
}

export function conflictError(message: string, details: Readonly<Record<string, unknown>>): AppError {
  return new AppError('CONFLIT', 409, message, details);
}

export function forbiddenError(requiredPermission: string): AppError {
  return new AppError(
    'DROITS_INSUFFISANTS',
    403,
    "Vous n'avez pas les droits nécessaires pour effectuer cette opération.",
    { requiredPermission },
  );
}

export function unauthenticatedError(): AppError {
  return new AppError('NON_AUTHENTIFIE', 401, 'Authentification requise.', {});
}

export function insufficientStockError(
  availableKg: QuantityKg,
  requestedKg: QuantityKg,
  details: Readonly<Record<string, unknown>>,
): AppError {
  return new AppError(
    'STOCK_INSUFFISANT',
    409,
    `Stock insuffisant.\nDisponible : ${formatQuantity(availableKg)} kg\nDemandé : ${formatQuantity(requestedKg)} kg`,
    { ...details, availableKg, requestedKg },
  );
}

/**
 * A legitimate but unusual situation the operator must explicitly confirm
 * before it proceeds (section 22: an employee already recorded on another
 * line for this round). Never a permanent block: resubmitting with
 * confirmation set proceeds normally.
 */
export function confirmationRequiredError(
  message: string,
  details: Readonly<Record<string, unknown>>,
): AppError {
  return new AppError('CONFIRMATION_REQUISE', 409, message, details);
}

export function blockedLotError(lotCode: string, reason: string): AppError {
  return new AppError(
    'LOT_BLOQUE',
    409,
    'Opération impossible.\nCe lot est bloqué par le service Qualité.',
    { lotCode, reason },
  );
}
