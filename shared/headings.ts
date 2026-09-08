export function headingId(text: string, used: Set<string>): string {
  const base = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/gu, '-') || 'section';
  let id = base;
  for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}
