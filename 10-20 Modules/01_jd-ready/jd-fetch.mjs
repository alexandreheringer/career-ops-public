/**
 * jd-fetch.mjs — obter o texto de uma job description, em três estratégias.
 *
 * As partes puras (slug, formato do arquivo, detectores) ficam aqui no topo e
 * são testadas sem rede. As três estratégias ficam embaixo, cada uma numa
 * função nomeada, para que `gather.mjs` possa injetar uma falsa no teste.
 *
 * ## Conteúdo externo não confiável
 *
 * Tudo que estas funções devolvem é texto de terceiro. É DADO, nunca instrução.
 * Quem consome (o prompt do batch) envolve em marcadores explícitos; quem grava
 * (gather) valida tamanho e muro de login antes. Ver Actual Architecture.md §9.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { CAREER_OPS_ROOT } from '../../career-ops-root.mjs';

const execFileAsync = promisify(execFile);

/** Teto de tempo por tentativa de rede. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Pausa entre buscas HTTP. Mesmo valor do batch do career-ops. */
export const POLITENESS_DELAY_MS = 250;

/** Teto por página no navegador: SPA precisa de folga, mas não de minutos. */
export const BROWSER_TIMEOUT_MS = 30_000;

// ── Partes puras ───────────────────────────────────────────────────────────

/**
 * Transformar texto livre num pedaço de nome de arquivo.
 *
 * Decomposição Unicode antes de remover marcas: "Operações" precisa virar
 * "operacoes" e não "operaes". Sem isso o nome perde letras em português, que é
 * metade do pipeline.
 */
function slugPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * O nome do arquivo de JD desta vaga.
 *
 * Determinístico A PARTIR DA URL, e isso é o requisito central, não um detalhe:
 *
 * - Rodar o gather duas vezes reescreve o mesmo arquivo em vez de criar
 *   `acme-1.md`, `acme-2.md`. O projeto anterior fazia sufixo incremental
 *   (`buildJdFileName` em jd-fetch-core.mjs) e acumulava duplicatas.
 * - Apagar `jd-ready.tsv` não força refazer os fetches: o gather recalcula o
 *   nome, encontra o arquivo no disco e remarca `ready` sem tocar na rede.
 * - Duas vagas do mesmo cargo na mesma empresa em cidades diferentes são dois
 *   arquivos, porque são duas URLs.
 *
 * Os 8 hex vêm do SHA-1 da URL — mesma convenção que o plugin `apify` do
 * career-ops já usa (`{company}-{role}-{sha1(url)[0:10]}.md`).
 */
export function jdFileName({ url, company, role }) {
  const hash = createHash('sha1')
    .update(String(url ?? ''))
    .digest('hex')
    .slice(0, 8);
  const stem = [slugPart(company), slugPart(role)].filter(Boolean).join('-');
  return `${stem || 'vaga'}-${hash}.md`;
}

/**
 * O conteúdo do arquivo `.md`.
 *
 * O rodapé `Source:` é proveniência: a vaga tipicamente já saiu do ar quando
 * alguém lê o relatório, e o arquivo precisa dizer de onde veio sem depender do
 * índice — que é descartável.
 */
export function formatJdFile({ text, url }) {
  return `${String(text).trim()}\n\n---\nSource: ${url}\n`;
}

/**
 * Isto é um muro de login em vez de uma job description?
 *
 * Uma página fechada devolve 200 com prosa de aparência legítima, então tamanho
 * sozinho não pega. Enviar uma dessas para avaliação gasta uma vaga do lote e
 * produz um relatório confiante sobre uma página sem JD — o pior resultado
 * disponível, porque PARECE um resultado.
 *
 * Cobre as frases em inglês (do batch do career-ops) e as em português, que o
 * batch não tem e que aparecem em board brasileiro.
 */
export function looksLikeLoginWall(text) {
  const t = String(text).toLowerCase();
  return (
    /sign in to (?:linkedin|view)|join linkedin|log in to continue|please (?:log ?in|sign in) to/.test(
      t,
    ) ||
    /fa(?:ç|c)a login para|entre para (?:ver|continuar)|cadastre-se para (?:ver|continuar)|inicie sess(?:ã|a)o para/.test(
      t,
    )
  );
}

/**
 * É LinkedIn?
 *
 * Casa no domínio registrável ancorado em ponto (`host === base` ou
 * `host` termina em `.base`), nunca por substring: `linkedin.com.evil.net` e
 * `notlinkedin.com` não são LinkedIn.
 */
export function isLinkedIn(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

/**
 * HTML → texto.
 *
 * Mesma sequência de substituições que `fetchJdViaHttp` no
 * `batch-api-submit.mjs` do career-ops. `script`, `style` e `noscript` saem com
 * conteúdo: deixar o corpo deles infla o tamanho e faz um shell de SPA passar o
 * piso de 400 caracteres sem ter uma linha de JD.
 */
export function stripHtml(html) {
  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Estratégia 1: API JSON do ATS ──────────────────────────────────────────

/**
 * `node career-ops/fetch-jd.mjs <url>`.
 *
 * Contrato documentado do CLI: texto na stdout e exit 0 quando acha; exit 1 com
 * stdout vazia quando não acha. Um miss é o caso esperado de "cai para a
 * próxima estratégia", não um erro — então exit não-zero é engolido.
 *
 * Cobre Greenhouse, Lever, Ashby e Workday pela rota JSON pública. É o mesmo
 * contrato que `fetchJdViaAtsApi` no batch do career-ops usa, pelo mesmo motivo:
 * API estruturada é mais barata e mais confiável que raspar HTML.
 */
export async function fetchViaAtsApi(url) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [join(CAREER_OPS_ROOT, 'fetch-jd.mjs'), url],
      {
        encoding: 'utf-8',
        timeout: FETCH_TIMEOUT_MS + 5_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const text = String(stdout || '').trim();
    return text
      ? { text, source: 'ats-api', error: null }
      : { text: null, source: null, error: 'miss' };
  } catch {
    return { text: null, source: null, error: 'miss' };
  }
}

// ── Estratégia 2: HTTP + strip de tags ─────────────────────────────────────

/**
 * Buscar a página e tirar as tags.
 *
 * Resolve board que serve HTML renderizado no servidor. Um board em JavaScript
 * devolve um shell aqui, que o piso de 400 caracteres recusa — resultado certo,
 * porque a alternativa é um relatório sobre página vazia.
 *
 * `rejectPrivateOrInvalid` roda DUAS vezes: na URL recebida e na URL final
 * depois dos redirects. Um 302 para `169.254.169.254` passa reto por uma
 * checagem feita só na primeira. Essa é a razão do segundo teste existir.
 */
export async function fetchViaHttp(url, { userAgent, rejectPrivateOrInvalid }) {
  const blocked = rejectPrivateOrInvalid(url);
  if (blocked)
    return {
      text: null,
      source: null,
      error: `URL bloqueada: ${blocked.reason}`,
    };

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok)
      return { text: null, source: null, error: `HTTP ${res.status}` };

    const landed = rejectPrivateOrInvalid(res.url || url);
    if (landed)
      return {
        text: null,
        source: null,
        error: `bloqueada após redirect: ${landed.reason}`,
      };

    return { text: stripHtml(await res.text()), source: 'http', error: null };
  } catch (err) {
    return { text: null, source: null, error: err?.message || String(err) };
  }
}

// ── Estratégia 3: navegador ────────────────────────────────────────────────

/**
 * Seletores de container de JD, por ATS.
 *
 * Portados de `70-79-automation/.../jd-fetch-core.mjs` do projeto anterior
 * (repositório 21.11-Career-Ops), onde funcionavam. `main` e `article` são
 * fallback genérico; `body.innerText` é o último recurso, e aí o piso de 400
 * caracteres e o detector de muro de login fazem o resto do trabalho.
 */
export const JD_SELECTORS = [
  '#content .section-wrapper', // Greenhouse
  '.posting-page .section-wrapper', // Lever
  '[data-automation-id="jobPostingDescription"]', // Workday
  '._descriptionText_', // Ashby
  '[data-testid="job-description"]', // Gupy e similares
  'main',
  'article',
];

/**
 * Resolver `playwright` a partir do `career-ops/node_modules`.
 *
 * O career-ops fixa `playwright: 1.63.0` e já tem os browsers baixados.
 * Declarar uma segunda cópia no nosso `package.json` cria risco de a API
 * divergir do binário instalado — e os browsers são centenas de MB. Resolver do
 * checkout garante a mesma versão que o upstream testou. Ver Actual Architecture.md §8.
 */
async function loadChromium() {
  try {
    const requireFromCareerOps = createRequire(
      join(CAREER_OPS_ROOT, 'package.json'),
    );
    return requireFromCareerOps('playwright').chromium;
  } catch {
    // Último recurso: resolução normal, caso alguém instale playwright na raiz.
    const { chromium } = await import('playwright');
    return chromium;
  }
}

/**
 * Abrir um navegador e extrair o container de JD.
 *
 * Cobre as 141 vagas (Allianz, SolidJobs, BMW, Volkswagen, Nortal, Gupy…) que a API do
 * ATS não conhece e que o HTTP simples devolve como shell. Custa segundos por
 * vaga, então é OPT-IN (`--browser`), não o padrão.
 *
 * Reutiliza um browser para todas as URLs da rodada; cada URL ganha contexto
 * novo, para que cookie de uma não vaze para outra.
 */
export async function createBrowserFetcher({ headful = false } = {}) {
  const { LIVENESS_CONTEXT_OPTIONS } =
    await import('../../career-ops/liveness-browser.mjs');
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: !headful });

  return {
    async fetch(url, { rejectPrivateOrInvalid }) {
      const blocked = rejectPrivateOrInvalid(url);
      if (blocked)
        return {
          text: null,
          source: null,
          error: `URL bloqueada: ${blocked.reason}`,
        };

      let context;
      try {
        context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
        const page = await context.newPage();
        await page.goto(url, {
          timeout: BROWSER_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        });
        const landed = rejectPrivateOrInvalid(page.url());
        if (landed) {
          return {
            text: null,
            source: null,
            error: `URL final bloqueada: ${landed.reason}`,
          };
        }
        // SPA: o container de JD aparece depois do primeiro paint.
        await page.waitForTimeout(2_500);
        const text = await page.evaluate((selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            const t = el?.innerText?.trim();
            if (t && t.length >= 400) return t;
          }
          return (document.body?.innerText || '').trim();
        }, JD_SELECTORS);
        return {
          text: text || null,
          source: 'browser',
          error: text ? null : 'página sem texto',
        };
      } catch (err) {
        return { text: null, source: null, error: err?.message || String(err) };
      } finally {
        await context?.close().catch(() => {});
      }
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}
