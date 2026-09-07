export function headingId(text, used) {
  const base = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/gu, '-') || 'section';
  let id = base;
  for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}
