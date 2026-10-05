const apiBase = () =>
  (process.env.VITE_API_URL ?? '').replace(/\/api$/, '');

export function uploadImageUrl(
  storedValue: string | null | undefined,
  fallback: 'receipts' | 'invoices' = 'receipts',
): string {
  if (!storedValue) return '';
  if (storedValue.startsWith('http')) return storedValue;

  // لو في الـ path اسم الـ folder، استخدمه
  const folderMatch = storedValue.match(/uploads[\\/](\w+)[\\/]/);
  const folder = folderMatch?.[1] ?? fallback;
  const filename = storedValue.split(/[\\/]/).pop() ?? '';

  return `${apiBase()}/uploads/${folder}/${filename}`;
}

export const receiptImageUrl = (p?: string | null) =>
  uploadImageUrl(p, 'receipts');

export const invoiceImageUrl = (p?: string | null) =>
  uploadImageUrl(p, 'invoices');