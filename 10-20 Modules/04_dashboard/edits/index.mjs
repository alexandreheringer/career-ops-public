/**
 * O conjunto de edições que o dashboard aplica ao career-ops/web.
 *
 * Cada edição é `{ file, label, anchor, replacement }`:
 *
 *   file         caminho relativo a `career-ops/`
 *   label        o que aparece no log e na mensagem de erro
 *   anchor       o texto EXATO que tem que existir no arquivo, uma única vez
 *   replacement  o que toma o lugar dele (normalmente contém a âncora)
 *
 * `anchor` tem que ser único no arquivo. Duas ocorrências e o apply recusa, em
 * vez de escolher uma — escolher seria editar o lugar errado em silêncio.
 */

import { careerOpsTsEdits } from './career-ops-ts.mjs';
import { facetChipsEdits } from './facet-chips.mjs';
import { inboxTriageEdits } from './inbox-triage.mjs';
import { pipelineViewEdits } from './pipeline-view.mjs';
import { triageRowEdits } from './triage-row.mjs';

export const edits = [
  ...careerOpsTsEdits,
  ...triageRowEdits,
  ...facetChipsEdits,
  ...inboxTriageEdits,
  ...pipelineViewEdits,
];
