// Cópia irmã: 06_scan-indeed/indeed-queries.mjs. Não importar.

/**
 * Três localizações, uma keyword só. Sem cargo no perfil, zero corridas.
 */

export const LINKEDIN_ACTOR_ID = 'cryptosignals~linkedin-jobs-scraper';

export const LINKEDIN_LOCATIONS = ['Remote', 'Brazil', 'Portugal'];

const MAX_ROLES = 6;

export const PT_BR_ROLE_VARIANTS = {
  'senior data analyst': [
    'Analista de Dados Sênior',
    'Analista Sênior de Dados',
    'Especialista em Dados',
    'Especialista de Analytics',
  ],
  'senior data engineer': [
    'Engenheiro de Dados Sênior',
    'Engenheiro Sênior de Dados',
    'Especialista em Engenharia de Dados',
  ],
  'analytics lead': [
    'Líder de Analytics',
    'Líder de Dados',
    'Coordenador de Analytics',
  ],
  'data strategy lead': [
    'Líder de Estratégia de Dados',
    'Especialista em Estratégia de Dados',
    'Consultor de Dados',
  ],
  'data architect': ['Arquiteto de Dados', 'Arquiteto Sênior de Dados'],
  'data strategy consultant': [
    'Consultor de Estratégia de Dados',
    'Consultor de Dados',
    'Consultor de Analytics',
  ],
  'head of data': ['Head de Dados', 'Diretor de Dados', 'Gerente de Dados'],
  'head of analytics': [
    'Head de Analytics',
    'Diretor de Analytics',
    'Gerente de Analytics',
  ],
  'data director': ['Diretor de Dados', 'Diretora de Dados'],
  'vp of data': ['VP de Dados', 'Vice-Presidente de Dados'],
  'vp data': ['VP de Dados', 'Vice-Presidente de Dados'],
  'chief data officer': [
    'Chief Data Officer',
    'CDO',
    'Diretor Executivo de Dados',
  ],
  'tech lead': [
    'Tech Lead de Dados',
    'Líder Técnico de Dados',
    'Tech Lead Data',
  ],
  'lead data engineer': [
    'Engenheiro de Dados Líder',
    'Líder de Engenharia de Dados',
    'Tech Lead de Engenharia de Dados',
  ],
  'staff data engineer': [
    'Engenheiro de Dados Staff',
    'Engenheiro de Dados Principal',
  ],
  'principal data engineer': [
    'Engenheiro de Dados Principal',
    'Engenheiro Principal de Dados',
  ],
  'data lead': ['Líder de Dados', 'Líder Técnico de Analytics'],
};

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function roleKey(role) {
  return text(role).toLowerCase().replace(/\s+/g, ' ');
}

function unique(terms) {
  const seen = new Set();
  const out = [];
  for (const term of terms) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

function extraVariants(profile, role) {
  const roles = profile?.target_roles;
  const table = roles?.pt_br ?? roles?.['pt-BR'];
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  const list = table[role] ?? table[text(role)] ?? table[roleKey(role)];
  if (!Array.isArray(list)) return [];
  return list.map((item) => text(item)).filter(Boolean);
}

export function buildLinkedInKeyword(profile = {}, { testMode = false } = {}) {
  const primary = (profile.target_roles?.primary ?? [])
    .map((role) => text(role))
    .filter(Boolean);
  const selected = primary.slice(0, testMode ? 1 : MAX_ROLES);
  const terms = [];
  for (const role of selected) {
    terms.push(role);
    const mapped = PT_BR_ROLE_VARIANTS[roleKey(role)];
    if (mapped) terms.push(...mapped);
    terms.push(...extraVariants(profile, role));
  }
  return unique(terms).join(' OR ');
}

export function buildLinkedInInputs(profile = {}, { testMode = false } = {}) {
  const keyword = buildLinkedInKeyword(profile, { testMode });
  if (!keyword) return [];
  const maxResults = testMode ? 5 : 100;
  return LINKEDIN_LOCATIONS.map((location) => ({
    keyword,
    location,
    maxResults,
  }));
}
