// =====================================================================
// LicitaPro · etapa "Demandas" (controle de ordens de fornecimento)
// Cada ata/contrato (itens vencidos de um processo) recebe ordens de fornecimento.
// Saldo do item = quantidade da ata − soma das ordens (o banco mantém
// itens_ganhos.quantidade_entregue = soma das ordens; o Reequilíbrio usa o mesmo saldo).
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, num, parseNum, fmtData, fmtDH, errMsg, hojeChave } from "./util.js";

const n = (v) => Number(v) || 0;

async function todas(montar) {
  let tudo = [];
  for (let de = 0; de < 30000; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    tudo = tudo.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return tudo;
}

export default function Demandas({ ctx }) {
  const { podeEquipe, notify, abrir, procs } = ctx;
  const [gan, setGan] = useState(null);
  const [ordens, setOrdens] = useState(null);
  const [orgao, setOrgao] = useState("");
  const [procId, setProcId] = useState("");
  const [qtd, setQtd] = useState({});
  const [numero, setNumero] = useState("");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [aberta, setAberta] = useState(null);
  const [q, setQ] = useState("");

  const carregar = async () => {
    try {
      const [g, o] = await Promise.all([
        todas(() => sb.from("itens_ganhos").select("id,processo_id,numero,descricao,unidade,quantidade,valor_unitario,marca,quantidade_entregue,ata_numero,contrato_numero,vigencia_fim,processos(orgao,municipio,numero,objeto,data_sessao)").order("numero")),
        todas(() => sb.from("ordens_fornecimento").select("id,processo_id,numero,data,lancado_em,lancado_por,obs,ordem_itens(id,ganho_id,quantidade)").order("lancado_em", { ascending: false })),
      ]);
      setGan(g.filter((x) => x.processos));
      setOrdens(o);
    } catch (e) { notify(errMsg(e)); setGan([]); setOrdens([]); }
  };
  useEffect(() => { carregar(); }, [procs]);

  const porId = useMemo(() => Object.fromEntries((gan || []).map((g) => [g.id, g])), [gan]);
  const processos = useMemo(() => {
    const m = {};
    (gan || []).forEach((g) => {
      const e = (m[g.processo_id] = m[g.processo_id] || { id: g.processo_id, p: g.processos, itens: [] });
      e.itens.push(g);
    });
    return Object.values(m).map((c) => {
      const un = (k) => [...new Set(c.itens.map((i) => i[k]).filter(Boolean))];
      const datas = c.itens.map((i) => i.vigencia_fim).filter(Boolean).sort();
      const total = c.itens.reduce((a, i) => a + n(i.quantidade) * n(i.valor_unitario), 0);
      const pedido = c.itens.reduce((a, i) => a + n(i.quantidade_entregue) * n(i.valor_unitario), 0);
      return { ...c, ata: un("ata_numero"), contrato: un("contrato_numero"), vigFim: datas[datas.length - 1] || null, total, pedido };
    });
  }, [gan]);
  const orgaos = useMemo(() => [...new Set(processos.map((c) => (c.p.orgao || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [processos]);
  const procsDoOrgao = processos.filter((c) => (c.p.orgao || "").trim() === orgao)
    .sort((a, b) => ((b.p.data_sessao || "") < (a.p.data_sessao || "") ? -1 : 1));
  const proc = processos.find((c) => c.id === procId) || null;

  const escolherOrgao = (o) => {
    setOrgao(o); setQtd({});
    const ps = processos.filter((c) => (c.p.orgao || "").trim() === o);
    setProcId(ps.length === 1 ? ps[0].id : "");
  };
  const escolherProc = (id) => { setProcId(id); setQtd({}); };

  const saldo = (g) => n(g.quantidade) - n(g.quantidade_entregue);
  const linhas = proc ? proc.itens.map((g) => ({ g, s: saldo(g), v: parseNum(qtd[g.id]) })) : [];
  const pedidas = linhas.filter((l) => l.v != null && l.v > 0);
  const acima = pedidas.filter((l) => l.v > l.s);
  const valorOrdem = pedidas.reduce((a, l) => a + l.v * n(l.g.valor_unitario), 0);
  const repetida = proc && numero.trim() && (ordens || []).some((o) => o.processo_id === proc.id && o.numero.trim().toLowerCase() === numero.trim().toLowerCase());

  const salvar = async () => {
    if (!proc) return;
    if (!numero.trim()) return notify("Informe o número da ordem de fornecimento.");
    if (!pedidas.length) return notify("Preencha a quantidade de pelo menos um item.");
    if (linhas.some((l) => qtd[l.g.id] && (l.v == null || l.v < 0))) return notify("Há quantidade inválida. Use só números (ex.: 120 ou 12,5).");
    if (repetida && !window.confirm(`Já existe uma ordem nº ${numero.trim()} neste processo. Lançar outra com o mesmo número?`)) return;
    if (acima.length && !window.confirm(`${acima.length} item(ns) com quantidade acima do saldo da ata (itens ${acima.map((l) => l.g.numero).join(", ")}). O saldo ficará negativo. Lançar mesmo assim? (Só se houver aditivo de quantidade.)`)) return;
    setBusy(true);
    try {
      const { data: o, error } = await sb.from("ordens_fornecimento").insert({ processo_id: proc.id, numero: numero.trim(), obs: obs.trim() || null }).select("id").single();
      if (error) throw error;
      const { error: e2 } = await sb.from("ordem_itens").insert(pedidas.map((l) => ({ ordem_id: o.id, ganho_id: l.g.id, quantidade: l.v })));
      if (e2) { await sb.from("ordens_fornecimento").delete().eq("id", o.id); throw e2; }
      notify(`Ordem nº ${numero.trim()} lançada: ${pedidas.length} item(ns), ${brl(valorOrdem)}.`);
      setQtd({}); setNumero(""); setObs("");
      await carregar();
    } catch (e) { notify(errMsg(e)); }
    setBusy(false);
  };

  const apagar = async (o) => {
    if (!window.confirm(`Apagar a ordem nº ${o.numero}? As quantidades voltam para o saldo da ata.`)) return;
    const { error } = await sb.from("ordens_fornecimento").delete().eq("id", o.id);
    if (error) return notify(errMsg(error));
    notify(`Ordem nº ${o.numero} apagada.`);
    carregar();
  };

  if (gan === null || ordens === null) return <div className="stack"><div className="top"><div><h1>Demandas</h1></div></div><div className="card empty">Carregando…</div></div>;

  const procDe = (id) => processos.find((c) => c.id === id);
  const listaOrdens = ordens.filter((o) => {
    if (proc) return o.processo_id === proc.id;
    if (orgao) return (procDe(o.processo_id)?.p.orgao || "").trim() === orgao;
    if (!q) return true;
    const c = procDe(o.processo_id);
    return `${o.numero} ${c?.p.orgao} ${c?.p.municipio} ${c?.p.numero}`.toLowerCase().includes(q.toLowerCase());
  });
  const valorDe = (o) => (o.ordem_itens || []).reduce((a, i) => a + n(i.quantidade) * n(porId[i.ganho_id]?.valor_unitario), 0);
  const zerados = (gan || []).filter((g) => n(g.quantidade) > 0 && saldo(g) <= 0).length;

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Demandas</h1><p>Ordens de fornecimento e saldo de cada ata ou contrato</p></div>
      </div>
      <div className="grid3">
        <div className="card kpi"><small>Atas e contratos</small><b className="num">{processos.length}</b><small>Processos com itens vencidos</small></div>
        <div className="card kpi"><small>Ordens lançadas</small><b className="num">{ordens.length}</b><small>{brl(ordens.reduce((a, o) => a + valorDe(o), 0))} em pedidos</small></div>
        <div className="card kpi"><small>Itens com saldo zerado</small><b className="num">{zerados}</b><small>Ata toda já pedida</small></div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <b>Lançar ordem de fornecimento</b>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4, flex: "1 1 260px", minWidth: 0 }}>
            <span className="hint">1 · Órgão</span>
            <select className="input" value={orgao} onChange={(e) => escolherOrgao(e.target.value)}>
              <option value="">Escolha o órgão…</option>
              {orgaos.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, flex: "1 1 320px", minWidth: 0 }}>
            <span className="hint">2 · Processo / licitação</span>
            <select className="input" value={procId} disabled={!orgao} onChange={(e) => escolherProc(e.target.value)}>
              <option value="">{orgao ? "Escolha o processo…" : "Escolha primeiro o órgão"}</option>
              {procsDoOrgao.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.p.numero && `Nº ${c.p.numero}`, c.ata.length && `Ata ${c.ata.join(", ")}`, c.contrato.length && `Contrato ${c.contrato.join(", ")}`, `${c.itens.length} itens`].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {proc && <>
          <div className="row-inline" style={{ gap: 6, flexWrap: "wrap" }}>
            {proc.p.municipio && <span className="tag">{proc.p.municipio}</span>}
            <span className="tag">Total da ata {brl(proc.total)}</span>
            <span className="tag">Já pedido {brl(proc.pedido)}</span>
            <span className="tag ok">Saldo {brl(proc.total - proc.pedido)}</span>
            {proc.vigFim && <span className={`tag${proc.vigFim < hojeChave() ? " warn" : ""}`}>Vigência até {fmtData(proc.vigFim + "T12:00:00")}</span>}
            <button type="button" className="btn ghost sm" onClick={() => abrir(proc.id)}>Abrir processo</button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="itab">
                <thead><tr><th>Item</th><th>Descrição</th><th>Marca</th><th>Unid.</th><th className="n">Qtd da ata</th><th className="n">Já pedido</th><th className="n">Saldo</th><th className="n">Valor unit.</th><th className="n">Qtd desta ordem</th></tr></thead>
                <tbody>
                  {linhas.map(({ g, s, v }) => {
                    const passa = v != null && v > s;
                    return (
                      <tr key={g.id} style={s <= 0 ? { opacity: 0.6 } : v > 0 ? { background: "var(--green-soft, #E8F6EE)" } : null}>
                        <td>{g.numero}</td>
                        <td style={{ minWidth: 220 }}><div className="clamp2">{g.descricao}</div></td>
                        <td>{g.marca || "—"}</td>
                        <td>{g.unidade || "—"}</td>
                        <td className="n">{num(g.quantidade)}</td>
                        <td className="n">{num(n(g.quantidade_entregue))}</td>
                        <td className="n" style={{ fontWeight: 700, color: s <= 0 ? "var(--red)" : undefined }}>{num(s)}</td>
                        <td className="n">{brl(g.valor_unitario)}</td>
                        <td className="n">
                          <input className="input" inputMode="decimal" style={{ width: 96, textAlign: "right", borderColor: passa ? "var(--red)" : undefined }}
                            value={qtd[g.id] || ""} disabled={!podeEquipe} placeholder="0"
                            onChange={(e) => setQtd((x) => ({ ...x, [g.id]: e.target.value }))} aria-label={`Quantidade do item ${g.numero} nesta ordem`} />
                          {passa && <div className="hint" style={{ color: "var(--red)" }}>acima do saldo</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 4, flex: "0 1 200px" }}>
              <span className="hint">3 · Nº da ordem de fornecimento</span>
              <input className="input" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="ex.: 125/2026" disabled={!podeEquipe} />
            </label>
            <label className="stack" style={{ gap: 4, flex: "1 1 240px" }}>
              <span className="hint">Observação (opcional)</span>
              <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: entregar na Secretaria de Saúde" disabled={!podeEquipe} />
            </label>
            <div className="stack" style={{ gap: 4 }}>
              <span className="hint">Data do lançamento</span>
              <b style={{ padding: "8px 0" }}>{fmtData(new Date().toISOString())} (automática)</b>
            </div>
          </div>
          {repetida && <div className="hint" style={{ color: "var(--amber)" }}>⚠ Já existe uma ordem com esse número neste processo.</div>}
          <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span><b>{pedidas.length}</b> item(ns) · <b>{brl(valorOrdem)}</b></span>
            {podeEquipe ? <button type="button" className="btn" disabled={busy || !pedidas.length || !numero.trim()} onClick={salvar}>{busy ? "Lançando…" : "Lançar ordem"}</button>
              : <span className="hint">Seu acesso é só de consulta.</span>}
          </div>
        </>}
        {!orgaos.length && <div className="hint">Nenhuma ata ou contrato ainda: os itens vencidos aparecem aqui quando a empresa ganha um processo.</div>}
      </div>

      <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <b>{proc ? "Ordens deste processo" : orgao ? "Ordens deste órgão" : "Todas as ordens"} ({listaOrdens.length})</b>
        {!orgao && <input className="input" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nº da ordem ou órgão" aria-label="Buscar ordens" />}
      </div>
      {!listaOrdens.length ? <div className="card empty">Nenhuma ordem lançada{proc ? " neste processo" : ""}.</div> : (
        <div className="stack" style={{ gap: 8 }}>
          {listaOrdens.map((o) => {
            const c = procDe(o.processo_id);
            const abre = aberta === o.id;
            return (
              <div key={o.id} className="card" style={{ padding: "10px 14px" }}>
                <div className="row-inline" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap", cursor: "pointer" }} onClick={() => setAberta(abre ? null : o.id)}>
                  <div style={{ minWidth: 0 }}>
                    <b>Ordem nº {o.numero}</b> <span className="hint">· {fmtData(o.data + "T12:00:00")}</span>
                    <div className="hint">{c ? [c.p.orgao, c.p.numero && `Nº ${c.p.numero}`].filter(Boolean).join(" · ") : "Processo"}</div>
                  </div>
                  <div className="row-inline" style={{ gap: 6 }}>
                    <span className="tag">{(o.ordem_itens || []).length} item(ns)</span>
                    <span className="tag ok">{brl(valorDe(o))}</span>
                    <span className="hint">{abre ? "▲" : "▼"}</span>
                  </div>
                </div>
                {abre && (
                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                    <div style={{ overflowX: "auto" }}>
                      <table className="itab">
                        <thead><tr><th>Item</th><th>Descrição</th><th>Marca</th><th>Unid.</th><th className="n">Qtd</th><th className="n">Valor</th></tr></thead>
                        <tbody>
                          {(o.ordem_itens || []).map((i) => {
                            const g = porId[i.ganho_id] || {};
                            return <tr key={i.id}><td>{g.numero}</td><td style={{ minWidth: 220 }}><div className="clamp2">{g.descricao}</div></td><td>{g.marca || "—"}</td><td>{g.unidade || "—"}</td><td className="n">{num(i.quantidade)}</td><td className="n">{brl(n(i.quantidade) * n(g.valor_unitario))}</td></tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <span className="hint">Lançada {fmtDH(o.lancado_em)}{o.lancado_por ? ` por ${o.lancado_por.split("@")[0]}` : ""}{o.obs ? ` · ${o.obs}` : ""}</span>
                      {podeEquipe && <button type="button" className="btn ghost sm" style={{ color: "var(--red)" }} onClick={() => apagar(o)}>Apagar ordem</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
