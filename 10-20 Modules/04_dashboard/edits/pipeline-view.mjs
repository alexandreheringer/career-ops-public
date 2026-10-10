const FILE = 'web/src/components/pipeline-view.tsx';

export const pipelineViewEdits = [
  {
    file: FILE,
    label: 'skippedInbox + undoSkip',
    anchor: `  const filtered = useMemo(() => {
    if (tab === "INBOX") return [];`,
    replacement: `  // As linhas da inbox que o usuário dispensou com o X: \`- [x]\` em
  // data/pipeline.md.
  //
  // ── A causa de a aba SKIP parecer vazia ──
  //
  // O X chama POST /api/inbox/skip, que troca \`- [ ]\` por \`- [x]\` em
  // data/pipeline.md. A aba SKIP filtrava \`applications\` — o TRACKER,
  // data/applications.md. Dois arquivos diferentes. A vaga saía da inbox e não
  // aparecia em lugar nenhum. O clique nunca esteve quebrado; a aba olhava o
  // lugar errado.
  //
  // Não há dedupe contra o tracker, e isso é correto: o X NÃO cria linha no
  // tracker, de propósito — a avaliação não aconteceu, e o tracker é o lugar do
  // que foi avaliado. Então não existe sobreposição para resolver.
  const skippedInbox = useMemo(() => {
    const seen = new Set<string>();
    const out: InboxJob[] = [];
    for (const j of inbox) {
      if (!j.done || seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    return out;
  }, [inbox]);

  // Desfazer: o MESMO endpoint do X, com done: false. Uma segunda rota para
  // escrever no mesmo arquivo é uma segunda forma de escrever errado.
  const undoSkip = useCallback(
    async (url: string) => {
      await fetch("/api/inbox/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, done: false }),
      });
      router.refresh();
    },
    [router],
  );

  const filtered = useMemo(() => {
    if (tab === "INBOX") return [];`,
  },
  {
    file: FILE,
    label: 'contagem da aba SKIP',
    // SKIP tab counts inbox skips plus tracker SKIP rows
    rewrite: true,
    anchor: `          const count =
            t === "INBOX"
              ? pendingInbox.length
              : t === "ALL"
                ? applications.length
                : applications.filter((r) => canonStatus(r.status).includes(t)).length;`,
    replacement: `          const count =
            t === "INBOX"
              ? pendingInbox.length
              : t === "ALL"
                ? applications.length
                : t === "SKIP"
                  // As duas fontes, porque a aba mostra as duas.
                  ? skippedInbox.length + applications.filter((r) => canonStatus(r.status).includes("SKIP")).length
                  : applications.filter((r) => canonStatus(r.status).includes(t)).length;`,
  },
  {
    file: FILE,
    label: 'lista de skipped da inbox',
    anchor: `      {tab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */`,
    replacement: `      {/* As dispensadas na inbox. Fica ACIMA da tabela do tracker, que continua
          listando as linhas com status SKIP — a aba mostra as duas fontes. */}
      {tab === "SKIP" && skippedInbox.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <div className="flex items-baseline justify-between gap-3 border-b border-border bg-surface/60 px-4 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">Dispensadas na inbox</p>
            <p className="text-xs text-faint">
              não avaliadas · <span className="tabular-nums">{skippedInbox.length}</span>
            </p>
          </div>
          <ul className="divide-y divide-border">
            {skippedInbox.map((j) => (
              <li key={j.url} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                <CompanyLogo name={j.company} size={20} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{j.company}</span>
                  <span className="text-muted"> · {j.role}</span>
                </span>
                <Badge tone="muted">SKIP</Badge>
                <button
                  type="button"
                  onClick={() => void undoSkip(j.url)}
                  title="Devolver para a inbox"
                  className="shrink-0 text-xs text-faint transition-colors hover:text-foreground max-sm:min-h-[44px]"
                >
                  Desfazer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */`,
  },
  {
    file: FILE,
    label: 'não dizer "No matches" quando a aba SKIP tem linhas',
    // SKIP with inbox skips is not an empty state
    rewrite: true,
    anchor: `      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}`,
    replacement: `      ) : tab === "SKIP" && skippedInbox.length > 0 ? null : (
        /* A aba SKIP com dispensadas da inbox e tracker vazio NÃO é "No matches"
           — a lista acima tem conteúdo. */
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}`,
  },
];
