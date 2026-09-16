export const cleanPartnerName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ');
export const partnerKey = (name: string) => cleanPartnerName(name).toLowerCase();
export function uniquePartnerNames(names: string[]) {
  const unique = new Map<string, string>();
  for (const name of names) {
    const clean = cleanPartnerName(name);
    if (clean && !unique.has(partnerKey(clean))) unique.set(partnerKey(clean), clean);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'ko'));
}
