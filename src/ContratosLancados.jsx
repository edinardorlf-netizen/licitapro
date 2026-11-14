// =====================================================================
// LicitaPro · contratos, atas, empenhos e aditivos lançados à mão
// (aba Contratos → "Contratos e atas"). Muitas prefeituras pequenas não
// publicam no PNCP, então a equipe lança aqui o que recebe por e-mail.
// Aditivos ficam pendurados no contrato/ata original; a vigência atual
// considera o maior prazo entre o original e os aditivos de prazo.
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, fmtData, parseNum, fmtIn, errMsg } from "./util.js";

export const TIPOS_CONTRATO = { ata: "Ata de registro de preços", contrato: "Contrato", empenho: "Nota de empenho", aditivo: "Termo aditivo", apostilamento: "Apostilamento" };
const TIPOS_ADITIVO = { prazo: "Prazo (prorrogação)", valor: "Valor (acréscimo/supressão)", quantidade: "Quantidade", reequilibrio: "Reequilíbrio de preços", outro: "Outro" };
const DIA = 864e5;
const dataBR = (d) => (d ? fmtData(d + "T12:00:00") : "—");
const hoje = () => new Date().toISOString().slice(0, 10);
const VAZIO = { tipo: "ata", aditivo_tipo: "prazo", numero: "", orgao: "", municipio: "", pregao: "", processo_id: "", pai_id: "", objeto: "", data_assinatura: "", vigencia_inicio: "", vigencia_fim: "", valor: "", link: "", obs: "", aplicar: true };

/** Vigência atual = maior fim entre o original e os aditivos (de prazo ou que trazem nova data). */
function vigenciaAtual(c, aditivos) {
  const fins = [c.vigencia_fim, ...aditivos.map((a) => a.vigencia_fim)].filter(Boolean).sort();
  return fins.length ? fins[fins.length - 1] : null;
}
function situacao(fim) {
  if (!fim) return { k: "sem", txt: "Vigência não informada", cor: "var(--muted)" };
  const dias = Math.ceil((new Date(fim + "T23:59:59").getTime() - Date.now()) / DIA);
  if (dias < 0) return { k: "vencido", txt: `Vencido há ${-dias} dia(s)`, cor: "var(--muted)", dias };
  if (dias <= 60) return { k: "vencendo", txt: `Vence em ${dias} dia(s)`, cor: "var(--red)", dias };
  return { k: "vigente", txt: `Vigente até ${dataBR(fim)}`, cor: "var(--green)", dias };
}

export default function ContratosLancados({ ctx, processoId, processo }) {
  const { pode, notify, abrir, procs, empresas, email } = ctx;
  const [lista, setLista] = useState(null);
  const [form, setForm] = useState(null); // null | { ...campos, id? }
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [aberto, setAberto] = useState(null);

  // Itens vencidos de cada processo (quantidade de itens e valor), para todas as linhas seguirem o mesmo padrão
  const [itensProc, setItensProc] = useState({});
  useEffect(() => {
    (async () => {
      const m = {};
      for (let de = 0; de < 30000; de += 1000) {
        let qb = sb.from("itens_ganhos").select("processo_id,quantidade,valor_unitario,vigencia_inicio,vigencia_fim").range(de, de + 999);
        if (processoId) qb = qb.eq("processo_id", processoId);
        const { data, error } = await qb;
        if (error || !data) break;
        data.forEach((g) => { const x = (m[g.processo_id] = m[g.processo_id] || { n: 0, total: 0, ini: null, fim: null }); x.n++; x.total += (Number(g.quantidade) || 0) * (Number(g.valor_unitario) || 0); if (g.vigencia_inicio && (!x.ini || g.vigencia_inicio < x.ini)) x.ini = g.vigencia_inicio; if (g.vigencia_fim && (!x.fim || g.vigencia_fim > x.fim)) x.fim = g.vigencia_fim; });
        if (data.length < 1000) break;
      }
      setItensProc(m);
    })();
  }, [processoId, lista && lista.length]);

  const carregar = async () => {
    let qb = sb.from("contratos").select("*").order("data_assinatura", { ascending: false, nullsFirst: false }).limit(3000);
    if (processoId) qb = qb.eq("processo_id", processoId);
    const { data, error } = await qb;
    if (error) { notify(errMsg(error)); setLista([]); return; }
    let l = data || [];
    // dentro de um processo: traz também os aditivos dos contratos dele
    if (processoId && l.length) {
      const ids = l.map((c) => c.id);
      const { data: ad } = await sb.from("contratos").select("*").in("pai_id", ids);
      l = [...l, ...(ad || []).filter((a) => !ids.includes(a.id))];
    }
    setLista(l);
  };
  useEffect(() => { carregar(); }, [processoId]);

  const principais = useMemo(() => {
    if (!lista) return [];
    const ad = {};
    lista.filter((c) => c.pai_id).forEach((a) => (ad[a.pai_id] = ad[a.pai_id] || []).push(a));
    const linhas = lista.filter((c) => !c.pai_id).map((c) => {
      const aditivos = (ad[c.id] || []).sort((a, b) => (a.data_assinatura || "").localeCompare(b.data_assinatura || ""));
      const fim = vigenciaAtual(c, aditivos);
      const valorAd = aditivos.reduce((a, x) => a + (Number(x.valor) || 0), 0);
      const ip = c.processo_id ? itensProc[c.processo_id] : null;
      // sem valor no contrato/ata: usa a soma dos itens vencidos do processo
      const base = c.valor != null ? Number(c.valor) : ip ? ip.total : 0;
      return { c, aditivos, fim, sit: situacao(fim), valorTotal: base + valorAd, itens: ip ? ip.n : null, valorDosItens: c.valor == null && !!ip };
    });
    // Processos ganhos que ainda não têm ata/contrato lançado também aparecem (mesmo padrão)
    const comContrato = new Set(lista.filter((c) => c.processo_id).map((c) => c.processo_id));
    const procsGanhos = processoId ? [] : (procs || []).filter((p) => itensProc[p.id] && !comContrato.has(p.id));
    procsGanhos.forEach((p) => {
      const ip = itensProc[p.id];
      const c = { id: "proc-" + p.id, virtual: true, tipo: null, numero: null, orgao: p.orgao, municipio: p.municipio, pregao: p.numero, processo_id: p.id, vigencia_inicio: ip.ini, vigencia_fim: ip.fim, fonte: "processo" };
      linhas.push({ c, aditivos: [], fim: ip.fim, sit: ip.fim ? situacao(ip.fim) : { k: "pendente", txt: "Ata/contrato a lançar", cor: "var(--amber)" }, valorTotal: ip.total, itens: ip.n, valorDosItens: true });
    });
    return linhas;
  }, [lista, itensProc, procs]);

  const filtrados = principais.filter((x) => {
    if (filtro !== "todos" && x.sit.k !== filtro) return false;
    if (!q) return true;
    return `${x.c.numero} ${x.c.orgao} ${x.c.municipio} ${x.c.pregao} ${x.c.objeto} ${x.aditivos.map((a) => a.numero).join(" ")}`.toLowerCase().includes(q.toLowerCase());
  }).sort((a, b) => (a.sit.k === "vencendo" ? -1 : 0) - (b.sit.k === "vencendo" ? -1 : 0) || (b.c.data_assinatura || "").localeCompare(a.c.data_assinatura || ""));

  const procDe = (id) => (procs || []).find((p) => p.id === id);
  const novo = (extra = {}) => {
    const p = processo || (processoId && procDe(processoId));
    setForm({ ...VAZIO, ...(p ? { processo_id: p.id, orgao: p.orgao || "", municipio: p.municipio || "", pregao: p.numero || "", objeto: p.objeto || "" } : {}), ...extra });
  };
  const editar = (c) => setForm({ ...VAZIO, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? "" : v])), valor: fmtIn(c.valor), aplicar: false });
  const aditivoDe = (x) => setForm({ ...VAZIO, tipo: "aditivo", pai_id: x.c.id, orgao: x.c.orgao, municipio: x.c.municipio || "", pregao: x.c.pregao || "", processo_id: x.c.processo_id || "", objeto: "", aplicar: false });

  const escolherProcesso = (id) => {
    const p = procDe(id);
    setForm((f) => ({ ...f, processo_id: id, ...(p ? { orgao: f.orgao || p.orgao || "", municipio: f.municipio || p.municipio || "", pregao: f.pregao || p.numero || "", objeto: f.objeto || p.objeto || "" } : {}) }));
  };

  const salvar = async (e) => {
    e.preventDefault();
    const f = form;
    if (f.tipo === "aditivo" && !f.pai_id) return notify("Escolha o contrato ou ata a que o aditivo pertence.");
    if (!f.orgao.trim()) return notify("Informe o órgão.");
    if (f.vigencia_inicio && f.vigencia_fim && f.vigencia_fim < f.vigencia_inicio) return notify("A vigência termina antes de começar.");
    const valor = f.valor.trim() ? parseNum(f.valor) : null;
    if (f.valor.trim() && valor == null) return notify("Valor inválido.");
    const p = f.processo_id ? procDe(f.processo_id) : null;
    const reg = {
      tipo: f.tipo, aditivo_tipo: f.tipo === "aditivo" ? f.aditivo_tipo : null, numero: f.numero.trim() || null,
      orgao: f.orgao.trim(), municipio: f.municipio.trim() || null, pregao: f.pregao.trim() || null,
      processo_id: f.processo_id || null, pai_id: f.tipo === "aditivo" ? f.pai_id : null, empresa_id: p ? p.empresa_id || null : (empresas && empresas.length === 1 ? empresas[0].id : null),
      objeto: f.objeto.trim() || null, data_assinatura: f.data_assinatura || null, vigencia_inicio: f.vigencia_inicio || null, vigencia_fim: f.vigencia_fim || null,
      valor, link: f.link.trim() || null, obs: f.obs.trim() || null,
    };
    if (reg.link && !/^https?:\/\//i.test(reg.link)) return notify("O link do documento precisa começar com http:// ou https://");
    setBusy(true);
    const r = f.id ? await sb.from("contratos").update(reg).eq("id", f.id) : await sb.from("contratos").insert({ ...reg, fonte: "manual", criado_por: email });
    if (r.error) { setBusy(false); return notify(errMsg(r.error)); }
    // Leva número e vigência para os itens ganhos do processo (base de Contratos e do Reequilíbrio)
    if (f.aplicar && reg.processo_id && ["ata", "contrato"].includes(reg.tipo)) {
      const patch = { [reg.tipo === "ata" ? "ata_numero" : "contrato_numero"]: reg.numero };
      if (reg.vigencia_inicio) patch.vigencia_inicio = reg.vigencia_inicio;
      if (reg.vigencia_fim) patch.vigencia_fim = reg.vigencia_fim;
      const { error } = await sb.from("itens_ganhos").update(patch).eq("processo_id", reg.processo_id);
      if (error) notify(`Contrato salvo, mas não atualizou os itens ganhos: ${errMsg(error)}`);
    }
    // Aditivo de prazo prorroga a vigência dos itens ganhos do processo
    if (reg.tipo === "aditivo" && reg.vigencia_fim && reg.processo_id && ["prazo", "outro", "reequilibrio"].includes(reg.aditivo_tipo)) {
      await sb.from("itens_ganhos").update({ vigencia_fim: reg.vigencia_fim }).eq("processo_id", reg.processo_id).lt("vigencia_fim", reg.vigencia_fim);
    }
    setBusy(false);
    notify(f.id ? "Lançamento atualizado" : `${TIPOS_CONTRATO[reg.tipo]} lançado(a)`);
    setForm(null); carregar();
  };
  const apagar = async (c) => {
    const { error } = await sb.from("contratos").delete().eq("id", c.id);
    if (error) return notify(errMsg(error));
    notify("Lançamento apagado"); carregar();
  };

  const contratosPai = principais.filter((x) => !x.c.virtual).map((x) => x.c);
  const pendentes = principais.filter((x) => x.c.virtual).length;
  const vig = principais.filter((x) => x.sit.k === "vigente" || x.sit.k === "vencendo");
  const valorVig = vig.reduce((a, x) => a + x.valorTotal, 0);

  return (
    <div className="stack" style={{ gap: 12 }}>
      {!processoId && (
        <div className="grid3">
          <div className="card kpi"><small>Contratos e atas</small><b className="num">{contratosPai.length}</b><small>{(lista || []).filter((c) => c.pai_id).length} aditivo(s){pendentes ? ` · ${pendentes} processo(s) com ata a lançar` : ""}</small></div>
          <div className="card kpi"><small>Vigentes</small><b className="num">{vig.length}</b><small style={{ color: principais.some((x) => x.sit.k === "vencendo") ? "var(--red)" : undefined }}>{principais.filter((x) => x.sit.k === "vencendo").length} vencendo em até 60 dias</small></div>
          <div className="card kpi"><small>Valor dos vigentes</small><b className="num">{brl(valorVig)}</b><small>Valor original + aditivos</small></div>
        </div>
      )}
      <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        {!processoId ? (
          <div className="chips">
            {[["todos", "Todos"], ["vencendo", "Vencendo (60 dias)"], ["vigente", "Vigentes"], ["vencido", "Vencidos"], ["sem", "Sem vigência"], ["pendente", "Ata/contrato a lançar"]].map(([k, l]) => <button key={k} className={`chip${filtro === k ? " on" : ""}`} onClick={() => setFiltro(k)}>{l}</button>)}
          </div>
        ) : <b>📄 Contratos, atas e aditivos deste processo</b>}
        <div className="row-inline">
          {!processoId && <input className="input" style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número, órgão ou objeto" aria-label="Buscar contratos" />}
          {pode && <button className="btn" onClick={() => novo()}>+ Lançar contrato / ata</button>}
        </div>
      </div>

      {form && pode && (
        <form className="card form" onSubmit={salvar} noValidate>
          <div className="card-h" style={{ marginBottom: 0 }}><h2>{form.id ? "Editar lançamento" : form.tipo === "aditivo" ? "Lançar aditivo" : "Lançar contrato / ata"}</h2><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancelar</button></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="ct-tipo">Tipo</label>
              <select id="ct-tipo" className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {Object.entries(TIPOS_CONTRATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            {form.tipo === "aditivo" && <>
              <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ct-pai">Contrato / ata original</label>
                <select id="ct-pai" className="input" value={form.pai_id} onChange={(e) => { const c = contratosPai.find((x) => x.id === e.target.value); setForm({ ...form, pai_id: e.target.value, ...(c ? { orgao: c.orgao, municipio: c.municipio || "", pregao: c.pregao || "", processo_id: c.processo_id || "" } : {}) }); }}>
                  <option value="">Escolha…</option>
                  {contratosPai.map((c) => <option key={c.id} value={c.id}>{TIPOS_CONTRATO[c.tipo]} {c.numero || "s/ nº"} · {c.orgao}</option>)}
                </select></div>
              <div className="field"><label htmlFor="ct-adt">O que o aditivo muda</label>
                <select id="ct-adt" className="input" value={form.aditivo_tipo} onChange={(e) => setForm({ ...form, aditivo_tipo: e.target.value })}>
                  {Object.entries(TIPOS_ADITIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
            </>}
            <div className="field"><label htmlFor="ct-num">Número</label><input id="ct-num" className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder={form.tipo === "aditivo" ? "Ex.: 1º Termo Aditivo" : "Ex.: 045/2026"} /></div>
            {form.tipo !== "aditivo" && (
              <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ct-proc">Processo no LicitaPro (opcional)</label>
                <select id="ct-proc" className="input" value={form.processo_id} onChange={(e) => escolherProcesso(e.target.value)}>
                  <option value="">Sem vínculo</option>
                  {(procs || []).slice().sort((a, b) => `${a.orgao}`.localeCompare(`${b.orgao}`)).map((p) => <option key={p.id} value={p.id}>{p.orgao}{p.numero ? ` · ${p.numero}` : ""}{p.municipio ? ` (${p.municipio})` : ""}</option>)}
                </select></div>
            )}
            <div className="field"><label htmlFor="ct-org">Órgão</label><input id="ct-org" className="input" value={form.orgao} onChange={(e) => setForm({ ...form, orgao: e.target.value })} placeholder="Ex.: Prefeitura de Januária" list="ct-orgaos" />
              <datalist id="ct-orgaos">{[...new Set((procs || []).map((p) => p.orgao).filter(Boolean))].map((o) => <option key={o} value={o} />)}</datalist></div>
            <div className="field"><label htmlFor="ct-mun">Município</label><input id="ct-mun" className="input" value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-preg">Pregão / processo nº</label><input id="ct-preg" className="input" value={form.pregao} onChange={(e) => setForm({ ...form, pregao: e.target.value })} placeholder="Ex.: PE 039/2026" /></div>
            <div className="field"><label htmlFor="ct-ass">Data de assinatura</label><input id="ct-ass" type="date" className="input" value={form.data_assinatura} onChange={(e) => setForm({ ...form, data_assinatura: e.target.value, vigencia_inicio: form.vigencia_inicio || e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-vi">Vigência: início</label><input id="ct-vi" type="date" className="input" value={form.vigencia_inicio} onChange={(e) => setForm({ ...form, vigencia_inicio: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-vf">{form.tipo === "aditivo" ? "Nova vigência: fim" : "Vigência: fim"}</label><input id="ct-vf" type="date" className="input" value={form.vigencia_fim} onChange={(e) => setForm({ ...form, vigencia_fim: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-val">{form.tipo === "aditivo" ? "Valor acrescido (negativo se supressão)" : "Valor total"}</label><input id="ct-val" className="input num" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0,00" /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ct-obj">Objeto / resumo</label><input id="ct-obj" className="input" value={form.objeto} onChange={(e) => setForm({ ...form, objeto: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ct-link">Link do documento (Drive, e-mail, portal)</label><input id="ct-link" className="input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ct-obs">Observação</label><input id="ct-obs" className="input" value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></div>
          </div>
          {form.processo_id && ["ata", "contrato"].includes(form.tipo) && (
            <label className="toggle"><input type="checkbox" checked={form.aplicar} onChange={(e) => setForm({ ...form, aplicar: e.target.checked })} />Levar o número e a vigência para os itens ganhos deste processo</label>
          )}
          <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? <span className="spin" /> : null}{form.id ? "Salvar alterações" : "Lançar"}</button>
        </form>
      )}

      {lista === null ? <div className="card empty">Carregando…</div> : !filtrados.length ? (
        <div className="card empty"><b>{principais.length ? "Nada neste filtro" : "Nenhum contrato ou ata lançado ainda"}</b>{pode && !principais.length ? "Clique em “+ Lançar contrato / ata” para lançar o que chegou por e-mail ou foi publicado no diário oficial." : ""}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="itab">
              <thead><tr><th>Tipo / número</th>{!processoId && <th>Órgão</th>}<th>Pregão</th><th>Assinatura</th><th>Vigência atual</th><th className="n">Itens</th><th className="n">Valor</th><th>Aditivos</th><th /></tr></thead>
              <tbody>
                {filtrados.map((x) => (
                  <React.Fragment key={x.c.id}>
                    <tr>
                      <td style={{ minWidth: 150 }}>{x.c.virtual ? <><b>Itens vencidos</b><div className="hint" style={{ color: "var(--amber)" }}>ata/contrato a lançar</div></> : <><b>{TIPOS_CONTRATO[x.c.tipo]}</b><div>{x.c.numero || "s/ nº"}</div>{x.c.fonte !== "manual" && <span className="tag">{x.c.fonte === "pncp" ? "PNCP" : "e-mail"}</span>}</>}</td>
                      {!processoId && <td style={{ minWidth: 180 }}>{x.c.orgao}{x.c.municipio ? <div className="hint">{x.c.municipio}</div> : null}{x.c.processo_id && <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => abrir(x.c.processo_id)}>Abrir processo</button>}</td>}
                      <td>{x.c.pregao || "—"}</td>
                      <td>{dataBR(x.c.data_assinatura)}</td>
                      <td style={{ color: x.sit.cor, fontWeight: 600, whiteSpace: "nowrap" }}>{x.sit.txt}{x.fim !== x.c.vigencia_fim && x.fim && <div className="hint">prorrogada por aditivo</div>}</td>
                      <td className="n">{x.itens != null ? (processoId ? x.itens : <button type="button" className="linkbtn" onClick={() => abrir(x.c.processo_id)} title="Abrir o processo com os itens">{x.itens}</button>) : <span className="hint">—</span>}</td>
                      <td className="n">{x.valorTotal ? brl(x.valorTotal) : "—"}{x.valorDosItens && x.valorTotal ? <div className="hint">soma dos itens</div> : null}{x.aditivos.some((a) => a.valor) && <div className="hint">original {brl(x.c.valor)}</div>}</td>
                      <td>{x.aditivos.length ? <button type="button" className="linkbtn" onClick={() => setAberto(aberto === x.c.id ? null : x.c.id)}>{aberto === x.c.id ? "▾" : "▸"} {x.aditivos.length} aditivo(s)</button> : <span className="hint">—</span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {x.c.link && <a href={x.c.link} target="_blank" rel="noopener noreferrer" className="linkbtn" style={{ fontSize: 12, marginRight: 8 }}>Documento</a>}
                        {pode && x.c.virtual && <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => { const p = procDe(x.c.processo_id); setForm({ ...VAZIO, processo_id: x.c.processo_id, orgao: x.c.orgao || "", municipio: x.c.municipio || "", pregao: x.c.pregao || "", objeto: (p && p.objeto) || "", vigencia_inicio: x.c.vigencia_inicio || "", vigencia_fim: x.c.vigencia_fim || "" }); try { window.scrollTo(0, 0); } catch (e) {} }}>+ Informar ata/contrato</button>}
                        {pode && !x.c.virtual && <>
                          <button type="button" className="linkbtn" style={{ fontSize: 12, marginRight: 8 }} onClick={() => aditivoDe(x)}>+ Aditivo</button>
                          <button type="button" className="linkbtn" style={{ fontSize: 12, marginRight: 8 }} onClick={() => editar(x.c)}>Editar</button>
                          <ConfirmarApagar onConfirm={() => apagar(x.c)} />
                        </>}
                      </td>
                    </tr>
                    {(aberto === x.c.id || processoId) && x.aditivos.map((a) => (
                      <tr key={a.id} style={{ background: "var(--surface-2, #f6f8fa)" }}>
                        <td style={{ paddingLeft: 24 }}>↳ {a.numero || "Aditivo"}<div className="hint">{TIPOS_ADITIVO[a.aditivo_tipo] || "Aditivo"}</div></td>
                        {!processoId && <td className="hint">{a.objeto || a.obs || ""}</td>}
                        <td />
                        <td>{dataBR(a.data_assinatura)}</td>
                        <td>{a.vigencia_fim ? `até ${dataBR(a.vigencia_fim)}` : "—"}</td>
                        <td className="n">{a.valor != null ? brl(a.valor) : "—"}</td>
                        <td />
                        <td style={{ whiteSpace: "nowrap" }}>
                          {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="linkbtn" style={{ fontSize: 12, marginRight: 8 }}>Documento</a>}
                          {pode && <><button type="button" className="linkbtn" style={{ fontSize: 12, marginRight: 8 }} onClick={() => editar(a)}>Editar</button><ConfirmarApagar onConfirm={() => apagar(a)} /></>}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmarApagar({ onConfirm }) {
  const [c, setC] = useState(false);
  useEffect(() => { if (!c) return; const t = setTimeout(() => setC(false), 4000); return () => clearTimeout(t); }, [c]);
  return c ? <button type="button" className="linkbtn" style={{ fontSize: 12, color: "var(--red)" }} onClick={() => { setC(false); onConfirm(); }}>Apagar mesmo?</button>
    : <button type="button" className="linkbtn" style={{ fontSize: 12, color: "var(--red)" }} onClick={() => setC(true)}>Apagar</button>;
}
