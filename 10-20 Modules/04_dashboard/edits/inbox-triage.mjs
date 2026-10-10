const FILE = 'web/src/components/inbox/inbox-triage.tsx';

export const inboxTriageEdits = [
  {
    file: FILE,
    label: 'estado jdOnly',
    // inserts jdOnly state between seniorities and locQ
    rewrite: true,
    anchor: `  const [seniorities, setSeniorities] = useState<Set<Seniority>>(() => new Set());
  const [locQ, setLocQ] = useState("");`,
    replacement: `  const [seniorities, setSeniorities] = useState<Set<Seniority>>(() => new Set());
  // Default FALSE: a inbox abre mostrando tudo. Abrir já filtrada esconderia as
  // 77 do LinkedIn sem o usuário ter pedido, e o problema que ele precisa ver é
  // justamente que elas não têm JD.
  const [jdOnly, setJdOnly] = useState(false);
  const [locQ, setLocQ] = useState("");`,
  },
  {
    file: FILE,
    label: 'chip Intern fora de availSeniorities',
    // drops intern from the CHIP list only
    rewrite: true,
    anchor: '    return SENIORITY_ORDER.filter((s) => set.has(s));',
    replacement: `    // "intern" sai da lista de CHIPS. As vagas de estágio continuam na
    // listagem — o pedido é remover o filtro, não as vagas.
    return SENIORITY_ORDER.filter((s) => s !== "intern" && set.has(s));`,
  },
  {
    file: FILE,
    label: 'filtro jdOnly',
    anchor:
      '        if (seniorities.size && (!e.seniority || !seniorities.has(e.seniority))) return false;',
    replacement: `        if (seniorities.size && (!e.seniority || !seniorities.has(e.seniority))) return false;
        if (jdOnly && e.job.hasJd !== true) return false;`,
  },
  {
    file: FILE,
    label: 'jdOnly nas dependências do filtro',
    // filtered useMemo also depends on jdOnly
    rewrite: true,
    anchor: '    [enriched, hidden, within, sources, seniorities, locQ, kw],',
    replacement:
      '    [enriched, hidden, within, sources, seniorities, jdOnly, locQ, kw],',
  },
  {
    file: FILE,
    label: 'jdOnly conta como faceta ativa',
    // anyFacet is true when the JD chip is on
    rewrite: true,
    anchor:
      '  const anyFacet = within != null || sources.size > 0 || seniorities.size > 0 || locQ.trim() !== "" || kw.trim() !== "";',
    replacement:
      '  const anyFacet = within != null || sources.size > 0 || seniorities.size > 0 || jdOnly || locQ.trim() !== "" || kw.trim() !== "";',
  },
  {
    file: FILE,
    label: 'travas em save e saveSelected',
    // save() returns early when hasJd is not true
    rewrite: true,
    anchor: `  const save = (job: InboxJob) => {
    if (isShortlisted(job.url)) return;
    setShortlist((s) => [...s, { url: job.url, company: job.company, role: job.role }]);
  };`,
    replacement: `  const save = (job: InboxJob) => {
    // A trava, não o filtro. Salvar para a shortlist é o primeiro passo da
    // avaliação por agente ("Score shortlist" abaixo), e avaliar sem JD produz
    // um relatório confiante sobre uma página vazia. O botão já está
    // desabilitado em triage-row.tsx; isto cobre teclado e qualquer chamada
    // futura que não passe pelo botão.
    if (job.hasJd !== true) return;
    if (isShortlisted(job.url)) return;
    setShortlist((s) => [...s, { url: job.url, company: job.company, role: job.role }]);
  };`,
  },
  {
    file: FILE,
    label: 'trava em saveSelected',
    // multi-select save requires hasJd === true
    rewrite: true,
    anchor: `    const add = enriched
      .filter((e) => selected.has(e.job.url) && !isShortlisted(e.job.url))
      .map((e) => ({ url: e.job.url, company: e.job.company, role: e.job.role }));`,
    replacement: `    const add = enriched
      // Mesma trava do save() de uma linha. A seleção múltipla é o caminho que
      // mais facilmente levaria uma vaga sem JD para a shortlist: marcar 20
      // checkboxes não faz ninguém olhar 20 ticks.
      .filter((e) => selected.has(e.job.url) && e.job.hasJd === true && !isShortlisted(e.job.url))
      .map((e) => ({ url: e.job.url, company: e.job.company, role: e.job.role }));`,
  },
  {
    file: FILE,
    label: 'trava em scoreShortlist',
    // o corpo inteiro muda: gate + kept em vez de limpar a bandeja
    rewrite: true,
    anchor: `  const scoreShortlist = () => {
    const batchId = \`shortlist-\${Date.now()}\`;
    for (const it of shortlist) {
      startJob({ title: \`Score · \${it.company}\`, subtitle: it.role, kind: "evaluate", input: it.url, page: "/pipeline", batchId });
    }
    setShortlist([]); // sent — the rows flip to Scoring… → badge via scoreByUrl
  };`,
    replacement: `  const scoreShortlist = () => {
    // Terceira trava, e a que realmente importa: esta é a ÚNICA ação da inbox
    // que gasta token. A shortlist persiste em localStorage ("career-ops:shortlist"),
    // então ela pode conter uma vaga salva antes de o índice existir, ou antes
    // de o gather marcar aquela URL como missing. As duas travas anteriores
    // nunca viram esse item.
    //
    // \`!== true\` e não \`=== false\`: uma URL que saiu da inbox não está em
    // \`enriched\`, devolve undefined, e não deve ser avaliada tampouco.
    //
    // Itens sem JD FICAM na bandeja. Limpar tudo depois do loop descartaria
    // silenciosamente o trabalho de montar a shortlist.
    const jdByUrl = new Map(enriched.map((e) => [e.job.url, e.job.hasJd === true]));
    const batchId = \`shortlist-\${Date.now()}\`;
    const kept: ShortItem[] = [];
    for (const it of shortlist) {
      if (jdByUrl.get(it.url) !== true) {
        kept.push(it);
        continue;
      }
      startJob({ title: \`Score · \${it.company}\`, subtitle: it.role, kind: "evaluate", input: it.url, page: "/pipeline", batchId });
    }
    setShortlist(kept);
  };`,
  },
  {
    file: FILE,
    label: 'passar jdOnly para FacetChips',
    // passes jdOnly/setJdOnly into FacetChips
    rewrite: true,
    anchor: `        toggleSeniority={(s) => setSeniorities((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        locQ={locQ}`,
    replacement: `        toggleSeniority={(s) => setSeniorities((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        jdOnly={jdOnly}
        setJdOnly={setJdOnly}
        locQ={locQ}`,
  },
  {
    file: FILE,
    label: 'limpar jdOnly no Clear',
    // Clear also resets the JD chip
    rewrite: true,
    anchor:
      '        onClear={() => { setWithin(null); setSources(new Set()); setSeniorities(new Set()); setLocQ(""); setKw(""); }}',
    replacement:
      '        onClear={() => { setWithin(null); setSources(new Set()); setSeniorities(new Set()); setJdOnly(false); setLocQ(""); setKw(""); }}',
  },
];
