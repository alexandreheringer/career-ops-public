const FILE = 'web/src/lib/career-ops.ts';

export const careerOpsTsEdits = [
  {
    file: FILE,
    label: 'importar o leitor do índice',
    anchor:
      'import { parseInbox, splitLines } from "@/lib/pipeline-table.mjs";',
    replacement:
      'import { parseInbox, splitLines } from "@/lib/pipeline-table.mjs";\n' +
      '// Cópia gerada por `npm run dashboard:apply`; a fonte é 04_dashboard/read-jd-index.mjs.\n' +
      '// Fica dentro de web/ porque o grafo de build do Next não alcança fora.\n' +
      'import { jdIndexPath, readJdReadyUrls } from "@/lib/read-jd-index.mjs";',
  },
  {
    file: FILE,
    label: 'InboxJob.hasJd',
    // type line gains optional hasJd; the original type is not a substring
    rewrite: true,
    anchor:
      'export type InboxJob = { url: string; company: string; role: string; location?: string; compensation?: string; done: boolean; postedAt?: string };',
    replacement:
      '/** `hasJd` é OPCIONAL de propósito: `readInbox()` delega para `parseInbox`,\n' +
      ' *  que não sabe nada de JD, e `undefined` quer dizer algo de verdade —\n' +
      ' *  jd-ready/jd-ready.tsv não existe, ninguém rodou o gather. Quem desenha\n' +
      ' *  testa `hasJd === true`, nunca a veracidade do valor. */\n' +
      'export type InboxJob = { url: string; company: string; role: string; location?: string; compensation?: string; done: boolean; postedAt?: string; hasJd?: boolean };',
  },
  {
    file: FILE,
    label: 'join de hasJd em pipelineSummary',
    // inbox map also sets hasJd from the JD index
    rewrite: true,
    anchor: `export function pipelineSummary(): PipelineSummary {
  const root = careerOpsRoot();
  const scanDates = readScanDates();
  return {
    root,
    rootExists: fs.existsSync(root),
    // join the freshness date (first_seen) onto each raw posting — the inbox's
    // triage view orders/faceted-filters on it entirely client-side.
    inbox: readInbox().map((j) => ({ ...j, postedAt: j.postedAt ?? scanDates.get(j.url) })),
    applications: readApplications(),
  };
}`,
    replacement: `export function pipelineSummary(): PipelineSummary {
  const root = careerOpsRoot();
  const scanDates = readScanDates();
  // Quais URLs têm job description. Mesmo padrão do scanDates logo acima: um
  // arquivo lateral lido uma vez por render e juntado a cada vaga. Índice
  // ausente devolve conjunto vazio, então a página renderiza com todo tick
  // vazio — que é a verdade quando o gather não rodou.
  const jdReady = readJdReadyUrls(jdIndexPath(root));
  return {
    root,
    rootExists: fs.existsSync(root),
    // join the freshness date (first_seen) onto each raw posting — the inbox's
    // triage view orders/faceted-filters on it entirely client-side.
    inbox: readInbox().map((j) => ({
      ...j,
      postedAt: j.postedAt ?? scanDates.get(j.url),
      hasJd: jdReady.has(j.url),
    })),
    applications: readApplications(),
  };
}`,
  },
];
