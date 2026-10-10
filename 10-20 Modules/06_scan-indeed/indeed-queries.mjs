// Cópia irmã: 07_scan-linkedin/linkedin-queries.mjs. Não importar.

/**
 * Três corridas fixas. A query é uma string só, compartilhada.
 * O actor antigo já provou que país e localização vão juntos num input.
 */

export const INDEED_ACTOR_ID = 'MXLpngmVpE8WTESQr';

export const INDEED_RUNS = [
  {
    scanLocation: 'Remote',
    location: 'remote',
    country: 'us',
    remote: 'remote',
  },
  { scanLocation: 'Brazil', location: 'Brazil', country: 'br' },
  { scanLocation: 'Portugal', location: 'Portugal', country: 'pt' },
];

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

export function buildIndeedQuery(profile = {}, { testMode = false } = {}) {
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

export function buildIndeedInputs(profile = {}, { testMode = false } = {}) {
  const query = buildIndeedQuery(profile, { testMode });
  const maxRows = testMode ? 6 : 120;
  return INDEED_RUNS.map((run) => ({
    scanLocation: run.scanLocation,
    query,
    country: run.country,
    location: run.location,
    sort: 'date',
    maxRows,
    includeCompanyDetails: false,
    enableUniqueJobs: true,
    ...(run.remote ? { remote: run.remote } : {}),
  }));
}
