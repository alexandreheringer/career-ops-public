/**
 * Estado de uma edição do dashboard sobre o texto de um arquivo, sem I/O.
 *
 * Extraído de apply.mjs para o teste não precisar carregar o CLI (que chama
 * process.exit) e para a regra de "já aplicado" viver num lugar só.
 */

const COMMENT_LINE = /^(?:\/\/|\/\*|\*|{\/\*)/;

/**
 * Linhas do que a edição acrescenta, sem a âncora e sem comentário.
 *
 * Usadas como impressão digital: se uma delas já está no arquivo, a edição
 * já rodou — mesmo que o comentário ao redor tenha mudado. Sem isso, um
 * `apply` depois de reescrever só o texto de ajuda insere o import/o tick
 * de novo e o Next recusa o arquivo (`defined multiple times`).
 *
 * @param {{anchor: string, replacement: string, rewrite?: boolean}} edit
 * @returns {string[]}
 */
export function payloadFingerprints(edit) {
  if (edit.rewrite) return [];
  if (!edit.replacement.includes(edit.anchor)) return [];
  const payload = edit.replacement.replace(edit.anchor, '');
  return payload
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 40 && !COMMENT_LINE.test(line));
}

/**
 * @param {string} content
 * @param {{anchor: string, replacement: string, rewrite?: boolean}} edit
 * @returns {'applied'|'ready'|'anchor-not-found'|'anchor-ambiguous'}
 */
export function editStateFromContent(content, edit) {
  if (content.includes(edit.replacement)) return 'applied';
  const fingerprints = payloadFingerprints(edit);
  if (fingerprints.some((line) => content.includes(line))) return 'applied';
  const occurrences = content.split(edit.anchor).length - 1;
  if (occurrences === 0) return 'anchor-not-found';
  if (occurrences > 1) return 'anchor-ambiguous';
  return 'ready';
}
