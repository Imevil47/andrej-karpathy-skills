import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type pg from 'pg';
import type { RoleCode } from '../domain/types.ts';
import { AppError } from '../errors.ts';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export type AuthenticatedUser = Readonly<{
  id: string;
  username: string;
  fullName: string;
  role: RoleCode;
}>;

/** Password hash format: scrypt$<salt hex>$<key hex>. */
export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plainPassword, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) {
    throw new Error('Format de mot de passe stocké invalide.');
  }
  const derived = (await scryptAsync(
    plainPassword,
    Buffer.from(saltHex, 'hex'),
    KEY_LENGTH,
  )) as Buffer;
  const expected = Buffer.from(keyHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function authenticate(
  pool: pg.Pool,
  username: string,
  password: string,
): Promise<AuthenticatedUser> {
  const result = await pool.query<{
    id: string;
    username: string;
    full_name: string;
    password_hash: string;
    is_active: boolean;
    role_code: RoleCode;
  }>(
    `SELECT u.id, u.username, u.full_name, u.password_hash, u.is_active, r.code AS role_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE lower(u.username) = lower($1)`,
    [username],
  );

  const invalidCredentials = new AppError(
    'NON_AUTHENTIFIE',
    401,
    'Identifiant ou mot de passe incorrect.',
    { username },
  );

  const user = result.rows[0];
  if (!user) {
    throw invalidCredentials;
  }
  if (!user.is_active) {
    throw new AppError('NON_AUTHENTIFIE', 401, 'Ce compte est désactivé.', { username });
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    throw invalidCredentials;
  }

  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role_code,
  };
}

export type UserRow = Readonly<{
  id: string;
  username: string;
  fullName: string;
  role: RoleCode;
  isActive: boolean;
}>;

export async function listUsers(pool: pg.Pool): Promise<readonly UserRow[]> {
  const result = await pool.query<UserRow>(
    `SELECT u.id        AS "id",
            u.username  AS "username",
            u.full_name AS "fullName",
            r.code      AS "role",
            u.is_active AS "isActive"
       FROM users u
       JOIN roles r ON r.id = u.role_id
      ORDER BY u.username`,
  );
  return result.rows;
}
