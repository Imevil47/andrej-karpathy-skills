// Raw material quantities are decimal kilograms with 3 decimals. They are
// carried as strings and compared as integer grams, so no inventory figure ever
// passes through a floating point number.

const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;

export type QuantityKg = string;

export function isValidQuantity(value: string): boolean {
  return QUANTITY_PATTERN.test(value);
}

export function toGrams(quantityKg: QuantityKg): bigint {
  if (!isValidQuantity(quantityKg)) {
    throw new Error(`Quantite invalide: "${quantityKg}" (format attendu: 1234.567)`);
  }
  const [whole, decimals] = quantityKg.split('.');
  return BigInt(whole ?? '0') * 1000n + BigInt((decimals ?? '').padEnd(3, '0'));
}

export function fromGrams(grams: bigint): QuantityKg {
  const negative = grams < 0n;
  const absolute = negative ? -grams : grams;
  const whole = absolute / 1000n;
  const decimals = (absolute % 1000n).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${whole}.${decimals}`;
}

export function subtract(left: QuantityKg, right: QuantityKg): QuantityKg {
  return fromGrams(toGrams(left) - toGrams(right));
}

/** Formats a quantity the French way: 3 000,500 kg */
export function formatQuantity(quantityKg: QuantityKg): string {
  const [whole, decimals] = quantityKg.replace('-', '').split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = quantityKg.startsWith('-') ? '-' : '';
  return `${sign}${grouped},${(decimals ?? '').padEnd(3, '0')}`;
}
