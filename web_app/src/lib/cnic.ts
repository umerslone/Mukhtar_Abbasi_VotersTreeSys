export function normalizeCnicKey(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 13 ? digits : null;
}

export function formatCnic(key: string): string {
  return `${key.slice(0, 5)}-${key.slice(5, 12)}-${key.slice(12)}`;
}
