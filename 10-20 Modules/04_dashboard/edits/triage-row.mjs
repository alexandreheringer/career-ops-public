const FILE = 'web/src/components/inbox/triage-row.tsx';

export const triageRowEdits = [
  {
    file: FILE,
    label: 'tick azul de job description',
    anchor: '      <CompanyLogo name={job.company} size={20} />',
    replacement: `      {/* Tick de job description.

          NÃO é o checkbox. O checkbox ao lado continua sendo SELEÇÃO; este só
          informa, e é por isso que é um span e não um input: nada aqui é
          clicável, e um segundo controle clicável no mesmo lugar faria o
          usuário achar que desmarcar o tick muda alguma coisa.

          Azul (sky-500)  = jd-ready diz \`ready\`: tem texto em career-ops/jds/
          Vazio (borda)   = \`missing\`, OU o índice não existe. Nos dois casos a
                            vaga não entra em avaliação, e o title diz o porquê. */}
      <span
        role="img"
        aria-label={job.hasJd === true ? "Job description pronta" : "Sem job description"}
        title={job.hasJd === true
          ? "Job description pronta"
          : "Sem job description — não entra na avaliação. Rode: npm run jd:gather -- --browser"}
        className={cn(
          "size-2 shrink-0 rounded-full",
          job.hasJd === true ? "bg-sky-500" : "border border-faint bg-transparent",
        )}
      />

      <CompanyLogo name={job.company} size={20} />`,
  },
  {
    file: FILE,
    label: 'Save desabilitado sem JD',
    // button gains disabled/title/className when hasJd is not true
    rewrite: true,
    anchor: `          <button
            type="button"
            onClick={onSave}
            title={shortlisted ? "In your shortlist" : "Save to shortlist"}
            aria-pressed={shortlisted}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
              shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
            )}
          >`,
    replacement: `          {/* Sem JD, não dá para salvar para a shortlist — e a shortlist é o que
              vira avaliação por agente em "Score shortlist". Desabilitar aqui é
              metade da trava; a outra metade está em save()/saveSelected()/
              scoreShortlist() em inbox-triage.tsx, porque a shortlist persiste
              em localStorage e pode ter sido salva antes de o índice existir. */}
          <button
            type="button"
            onClick={onSave}
            disabled={job.hasJd !== true}
            title={job.hasJd !== true
              ? "Sem job description — colete a JD antes de avaliar"
              : shortlisted ? "In your shortlist" : "Save to shortlist"}
            aria-pressed={shortlisted}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
              job.hasJd !== true
                ? "cursor-not-allowed text-faint opacity-50"
                : shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
            )}
          >`,
  },
];
