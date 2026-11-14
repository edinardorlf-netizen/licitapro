// =====================================================================
// LicitaPro · etapa "Proposta"
// Processos que vamos disputar, antes da sessão: em que ponto está a proposta de cada um
// (itens marcados → planilha de cotação → preços e marcas → proposta em Word → portal)
// e atalhos para abrir o processo direto na aba certa.
// =====================================================================
import React, { useState, useEffect } from "react";
import { sb, brl, fmtDH, A_LANCAR } from "./util.js";

const ANTES = [...A_LANCAR, "proposta", "suspenso"];

function situacao(p, r) {
  if (p.etapa === "proposta") return { txt: "Proposta enviada · aguardando a sessão", cor: "var(--green)", passo: 5 };
  if (!r || !r.itens) return { txt: "Itens ainda não carregados do portal", cor: "var(--ink-3)", passo: 0 };
  if (!r.marcados) return { txt: "1 · Marcar os itens que vamos disputar", cor: "var(--amber)", passo: 1 };
  if (r.cotados < r.marcados) return { txt: `2–3 · Cotação: faltam preços em ${r.marcados - r.cotados} de ${r.marcados} itens`, cor: "var(--amber)", passo: 2 };
  if (r.sem_marca) return { txt: `3 · Faltam marcas em ${r.sem_marca} ${r.sem_marca === 1 ? "item" : "itens"}`, cor: "var(--amber)", passo: 3 };
  return { txt: "4 · Pronto: gerar a proposta em Word e cadastrar no portal", cor: "var(--green)", passo: 4 };
}

export default function PropostaEtapa({ ctx }) {
  const { procs, abrir } = ctx;
  const [resumo, setResumo] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    sb.rpc("resumo_propostas").then(({ data }) => setResumo(Object.fromEntries((data || []).map((r) => [r.processo_id, r]))));
  }, [procs]);

  const agora = Date.now();
  const lista = (procs || [])
    .filter((p) => ANTES.includes(p.etapa) && (!q || `${p.orgao} ${p.municipio} ${p.numero} ${p.objeto}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      // próximas sessões primeiro; sessões já passadas e sem data no fim
      const ta = a.data_sessao ? Date.parse(a.data_sessao) : Infinity, tb = b.data_sessao ? Date.parse(b.data_sessao) : Infinity;
      const pa = ta < agora ? 1 : 0, pb = tb < agora ? 1 : 0;
      return pa - pb || ta - tb;
    });

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Proposta</h1><p>Licitações que vamos disputar: itens, planilha de cotação e proposta</p></div>
        <input className="input" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar órgão, número ou objeto" aria-label="Buscar processos" />
      </div>
      <div className="card" style={{ padding: "12px 16px" }}>
        <div className="row-inline" style={{ gap: 18, flexWrap: "wrap" }}>
          {["1 · Marcar os itens", "2 · Baixar a planilha de cotação", "3 · Enviar a planilha preenchida (preço e marca)", "4 · Gerar a proposta em Word", "5 · Cadastrar no portal"].map((t) => <span key={t} className="hint" style={{ fontWeight: 600 }}>{t}</span>)}
        </div>
      </div>
      {procs === null || resumo === null ? <div className="card empty">Carregando…</div> : !lista.length ? (
        <div className="card empty"><b>Nenhuma licitação para preparar proposta</b>Marque ⭐ “Vamos participar” num edital da Busca (Radar) ou cadastre o processo em Acompanhamento.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {lista.map((p) => {
            const r = resumo[p.id];
            const s = situacao(p, r);
            const passou = p.data_sessao && Date.parse(p.data_sessao) < agora;
            return (
              <div key={p.id} className="card" style={{ padding: "12px 16px" }}>
                <div className="row-inline" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 340px" }}>
                    <div className="porg">{p.orgao || "Órgão"}</div>
                    <div className="hint">{[p.municipio, p.numero && `Nº ${p.numero}`].filter(Boolean).join(" · ")}</div>
                    <div className="hint clamp2" style={{ color: "var(--ink-2)", marginTop: 2 }}>{p.objeto}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                    <div><b>{p.data_sessao ? fmtDH(p.data_sessao) : "Sessão sem data"}</b></div>
                    {passou && <div className="hint" style={{ color: "var(--red)" }}>sessão já passou: confira a etapa</div>}
                  </div>
                </div>
                <div className="row-inline" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <span className="tag" style={{ color: s.cor, fontWeight: 700 }}>{s.txt}</span>
                  {r && r.itens > 0 && <span className="tag">{r.itens} itens no edital</span>}
                  {r && r.marcados > 0 && <span className="tag">{r.marcados} marcados</span>}
                  {r && r.cotados > 0 && <span className="tag ok">{r.cotados} com preço · {brl(r.total)}</span>}
                  {r && r.marcados > 0 && r.com_piso < r.marcados && <span className="tag warn">{r.marcados - r.com_piso} sem valor mínimo (o robô não lança)</span>}
                </div>
                <div className="row-inline" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn sm" onClick={() => abrir(p.id, "itens")}>☑ Itens e planilha de cotação</button>
                  <button type="button" className="btn ghost sm" onClick={() => abrir(p.id, "proposta")}>📝 Preços, marcas e proposta em Word</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
