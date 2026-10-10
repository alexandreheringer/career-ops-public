// Cópia irmã, sem import: 10-20 Modules/06_scan-indeed/location-allow.mjs
// e 10-20 Modules/07_scan-linkedin/location-allow.mjs.
// Corpo publicado em ADR-004. Local vazio passa.

const BR_UF =
  /\b(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/;

export function isTargetLocation(location) {
  const lower = String(location || '').toLowerCase();
  if (!lower) return true;
  return [
    'remote',
    'anywhere',
    'worldwide',
    'global',
    'brazil',
    'brasil',
    'portugal',
    'spain',
    'españa',
    'espanha',
    'germany',
    'deutschland',
    'alemanha',
    'malta',
    'netherlands',
    'holanda',
    'belgium',
    'bélgica',
    'belgica',
    'switzerland',
    'suíça',
    'suica',
    'finland',
    'finlândia',
    'finlandia',
    'denmark',
    'dinamarca',
    'norway',
    'noruega',
    'estonia',
    'estônia',
    'latvia',
    'letônia',
    'letonia',
    'lithuania',
    'lituânia',
    'lituania',
    'united states',
    'usa',
    'canada',
    'singapore',
    'singapura',
    'china',
    'uae',
    'united arab emirates',
    'dubai',
    'panama',
    'panamá',
  ].some((term) => lower.includes(term));
}

/**
 * A Gupy deste módulo só busca o Brasil (`state: ''`). O item confirmado do
 * actor traz "São Paulo, SP", que não contém a palavra "brasil" e cairia fora
 * da allowlist compartilhada. UF brasileira conta como dentro. Argentina não.
 */
export function acceptGupyLocation(location) {
  if (isTargetLocation(location)) return true;
  return BR_UF.test(String(location || '').toLowerCase());
}
