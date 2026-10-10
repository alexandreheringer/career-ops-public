/**
 * A busca pública da Gupy devolve zero linhas quando a query é longa ou usa OR.
 * Um termo curto por corrida. state vazio = Brasil inteiro.
 */

export const GUPY_ACTOR_ID = 'zen-studio~gupy-jobs-scraper';

export const GUPY_CURATED_TERMS = [
  'analista de dados',
  'engenheiro de dados',
  'cientista de dados',
  'líder de analytics',
  'gerente de dados',
  'analytics engineer',
  'head de dados',
  'especialista de dados',
  'arquitetura de dados',
  'governança de dados',
  'estratégia de dados',
];

export function buildGupyInputs(profile = {}, { testMode = false } = {}) {
  const fromProfile = [];
  for (const role of profile.target_roles?.primary || []) {
    const term = String(role).trim();
    if (term && term.length <= 40 && !term.includes(' OR '))
      fromProfile.push(term);
  }
  const terms = [
    ...new Set(
      [...GUPY_CURATED_TERMS, ...fromProfile]
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ];
  const maxRuns = testMode ? 3 : Math.min(terms.length, 15);
  const maxResults = testMode ? 15 : 50;
  return terms.slice(0, maxRuns).map((searchTerm) => ({
    searchTerm,
    state: '',
    sortBy: 'newest',
    maxResults,
  }));
}
