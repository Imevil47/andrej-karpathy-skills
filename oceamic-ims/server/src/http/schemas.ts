import { z } from 'zod';
import { isValidQuantity } from '../domain/quantity.ts';

// Quantities travel as strings so no inventory figure is ever parsed as a
// JavaScript floating point number.
export const quantityKgSchema = z
  .string()
  .refine(isValidQuantity, 'Quantité invalide (format attendu : 1234.567)')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

export const uuidSchema = z.uuid('Identifiant invalide.');

export const requiredTextSchema = z.string().trim().min(1, 'Ce champ est obligatoire.');

export const decimalSchema = z
  .string()
  .regex(/^-?\d{1,8}(\.\d{1,2})?$/, 'Valeur numérique invalide.')
  .nullable();

export const limitSchema = z.coerce.number().int().min(1).max(500);
