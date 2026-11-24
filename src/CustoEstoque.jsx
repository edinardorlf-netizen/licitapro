// =====================================================================
// LicitaPro · Contratos → "💲 Custo pelo estoque"
// Os itens vencidos estão ligados a produtos "de licitação" (sem custo). O custo está
// nos produtos do estoque (planilha e PDV, aba Orçamentos). Aqui cada produto vencido
// ganha uma sugestão do produto equivalente do estoque, pelas mesmas regras da
// unificação (princípio ativo + dose; nome + medidas), e a equipe confere e liga.
// Depois de ligado, o custo do estoque aparece no markup dos itens vencidos.
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, errMsg, fmtData } from "./util.js";
import { todas } from "./dados.js";
import { caracteristicas, sobreposicao } from "./assinatura.js";
import { conflito } from "./LigarProdutos.jsx";

// Quanto das palavras do produto vencido aparece no nome do estoque (0 a 1)
const cobertura = (a, b) => { if (!a.size) return 0; let n = 0; a.forEach((x) => b.has(x) && n++); return n / a.size; };
// Tipos que não se misturam: se um nome tem uma palavra do grupo e o outro tem outra do mesmo grupo, não é o mesmo produto
const OPOSTOS = [
  ["TOPICO", "DEGERMANTE", "ALCOOLICA", "AQUOSA", "BUCAL"],
  ["GEL", "POMADA", "CREME", "SPRAY", "AMP", "AMPOLA", "INJ", "INJETAVEL", "COMPRIMIDO", "CPR", "XAROPE", "GOTAS", "SUSPENSAO"],
  ["NYLON", "SEDA", "CATGUT", "POLIGLICOLICO", "POLIPROPILENO", "ALGODAO"],
  ["NASAL", "INTRAVENOSO", "VESICAL", "URETRAL", "GASTRICA"],
  ["ESTERIL", "N ESTERIL", "NAO ESTERIL"],
  ["LASER", "CLINICO", "INFRAVERMELHO"],
  ["RETA", "CURVA"],
  ["LATEX", "NITRILICA", "VINIL", "PLASTICA"],
];
const palavras = (s) => ` ${String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
function opostos(a, b) {
  const A = palavras(a), B = palavras(b);
  return OPOSTOS.some((g) => {
    const ta = g.filter((w) => A.includes(` ${w} `)), tb = g.filter((w) => B.includes(` ${w} `));
    return ta.length && tb.length && !ta.some((w) => tb.includes(w));
  });
}
// O estoque é mais específico que o item vencido (tem número, tamanho ou medida que o item não tem): só "conferir"
const maisEspecifico = (c, e) => ((c.tokens || []).length <= 2 && (e.tokens || []).length >= (c.tokens || []).length + 2) || (!c.cal && !!e.cal) || (!c.tam && !!e.tam) || (!(c.dims || []).length && (e.dims || []).length > 0) || (!(c.vols || []).length && (e.vols || []).length > 0);

// A embalagem (caixa, pacote) fica fora da comparação: o estoque mistura unidade e caixa.
const semEmb = (base) => (base.startsWith("M|") ? base.split("|").slice(0, -1).join("|") : base);
const UNID = (u) => {
  const t = String(u || "").toUpperCase();
  if (/^(CX|CAIXA)/.test(t)) return "CX";
  if (/^(PC|PCT|PACOTE|PTC|PTS)/.test(t)) return "PCT";
  if (/^(GL|GALAO)/.test(t)) return "GL";
  return "UN";
};

export default function CustoEstoque({ ctx, onLigou, processoId }) {
  const { notify, email } = ctx;
  const pode = ctx.alt && (ctx.alt("custos") || ctx.alt("catalogo") || ctx.alt("orcamentos"));
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(null); // { lic: [...], est: [...] }
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("certeza");
  const [escolha, setEscolha] = useState({}); // { [licId]: { estId, usar } }
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const carregar = async () => {
    setErro("");
    try {
      const ganhos = await todas(() => { let qq = sb.from("itens_ganhos").select("produto_id,quantidade,valor_unitario,unidade").not("produto_id", "is", null); if (processoId) qq = qq.eq("processo_id", processoId); return qq; });
      const porProd = {};
      ganhos.forEach((g) => { const x = (porProd[g.produto_id] = porProd[g.produto_id] || { itens: 0, total: 0, vu: [], unidade: g.unidade }); x.itens++; x.total += (Number(g.quantidade) || 0) * (Number(g.valor_unitario) || 0); if (g.valor_unitario != null) x.vu.push(Number(g.valor_unitario)); });
      const ids = Object.keys(porProd);
      const lic = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await sb.from("produtos").select("id,nome,unidade,estoque_id").in("id", ids.slice(i, i + 200));
        if (error) throw error;
        (data || []).forEach((p) => lic.push({ ...p, ...porProd[p.id] }));
      }
      const est = await todas(() => sb.from("produtos").select("id,nome,unidade,marca,custo_atual,custo_em,codigo,codigo_planilha,origem").in("origem", ["pdv", "planilha"]).not("custo_atual", "is", null));
      setDados({ lic, est });
    } catch (e) { setErro(errMsg(e)); }
  };
  useEffect(() => { if (aberto && !dados) carregar(); }, [aberto]);

  // Sugestões: mesma "base" (princípio ativo + dose, ou nome + medidas), ordenadas pela semelhança do nome
  const linhas = useMemo(() => {
    if (!dados) return [];
    const idx = new Map();
    const porId = new Map();
    dados.est.forEach((e) => {
      const c = caracteristicas(e.nome, e.unidade);
      const it = { ...e, c, tok: new Set(c.tokens) };
      porId.set(e.id, it);
      const k = semEmb(c.base);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(it);
    });
    return dados.lic.map((p) => {
      const c = caracteristicas(p.nome, p.unidade);
      const tok = new Set(c.tokens);
      // Sem conflito (material, tipo, cor, teor, medida, forma…: as mesmas regras da unificação de produtos)
      const cands = (idx.get(semEmb(c.base)) || [])
        .filter((e) => !conflito({ c }, { c: e.c }).length && !opostos(p.nome, e.nome))
        .map((e) => ({ ...e, sim: sobreposicao(tok, e.tok), cob: cobertura(tok, e.tok) }))
        .filter((e) => e.cob >= 0.5)
        .sort((a, b) => b.cob - a.cob || b.sim - a.sim || Date.parse(b.custo_em || 0) - Date.parse(a.custo_em || 0));
      const ligado = p.estoque_id ? porId.get(p.estoque_id) : null;
      const melhor = cands[0];
      const custos = [...new Set(cands.map((x) => Number(x.custo_atual).toFixed(2)))];
      const vuMedio = p.vu.length ? p.vu.reduce((a, b) => a + b, 0) / p.vu.length : null;
      const custoFora = melhor && vuMedio ? Number(melhor.custo_atual) > vuMedio * 1.5 || Number(melhor.custo_atual) < vuMedio / 6 : false;
      const unidDif = melhor && UNID(p.unidade) !== UNID(melhor.unidade);
      const generico = melhor ? maisEspecifico(c, melhor.c) : false;
      const nivel = ligado ? "ligado" : !melhor ? "sem" : melhor.cob >= 0.8 && !custoFora && !unidDif && !generico ? "certeza" : "provavel";
      return { p, c, cands, ligado, melhor, custos, vuMedio, custoFora, unidDif, generico, nivel };
    });
  }, [dados]);

  const cont = useMemo(() => linhas.reduce((a, l) => ({ ...a, [l.nivel]: (a[l.nivel] || 0) + 1 }), {}), [linhas]);
  const vis = linhas.filter((l) => l.nivel === filtro && (!q || `${l.p.nome} ${l.melhor ? l.melhor.nome : ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.p.total - a.p.total);
  const esc = (l) => escolha[l.p.id] || { estId: l.melhor ? l.melhor.id : "", usar: l.nivel === "certeza" };
  const mudar = (l, patch) => setEscolha((s) => ({ ...s, [l.p.id]: { ...esc(l), ...patch } }));

  const ligar = async () => {
    const sel = vis.filter((l) => esc(l).usar && esc(l).estId);
    if (!sel.length) return notify("Marque ao menos um produto.");
    setBusy(true);
    const agora = new Date().toISOString();
    let ok = 0;
    for (const l of sel) {
      const { error } = await sb.from("produtos").update({ estoque_id: esc(l).estId, estoque_ligado_em: agora, estoque_ligado_por: email || null }).eq("id", l.p.id);
      if (error) { notify(errMsg(error)); break; }
      ok++;
    }
    setBusy(false);
    notify(`💲 ${ok} ${ok === 1 ? "produto ligado" : "produtos ligados"} ao estoque. O custo já aparece nos itens vencidos.`);
    setEscolha({});
    await carregar();
    onLigou && onLigou();
  };
  const desligar = async (l) => {
    const { error } = await sb.from("produtos").update({ estoque_id: null, estoque_ligado_em: null, estoque_ligado_por: null }).eq("id", l.p.id);
    if (error) return notify(errMsg(error));
    notify("Ligação desfeita"); await carregar(); onLigou && onLigou();
  };

  const NIVEIS = [["certeza", "✅ Certeza"], ["provavel", "🟡 Conferir"], ["sem", "⚪ Sem par no estoque"], ["ligado", "💲 Já ligados"]];
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>💲 Custo pelo estoque</h2>
        <button type="button" className="btn ghost sm" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar" : "Abrir"}</button>
      </div>
      <p className="hint" style={{ margin: 0 }}>Liga cada produto vencido ao produto equivalente do estoque (planilha e PDV, aba Orçamentos), de onde vem o <b>custo</b> para o markup dos contratos. O app sugere pelo princípio ativo e dose (remédio) ou pelo nome e medidas (material); você confere e liga.</p>
      {aberto && (dados === null ? (erro ? <div className="alerta-lance ruim">{erro}</div> : <div className="empty">Lendo produtos vencidos e estoque…</div>) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-inline" style={{ gap: 12, flexWrap: "wrap" }}>
            <span>{linhas.length} produtos vencidos · {dados.est.length} produtos do estoque com custo</span>
            <span className="hint">Cobertura: <b>{(((cont.ligado || 0) / Math.max(1, linhas.length)) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</b> ligados</span>
          </div>
          <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="chips">
              {NIVEIS.map(([k, t]) => <button key={k} type="button" className={`chip${filtro === k ? " on" : ""}`} onClick={() => setFiltro(k)}>{t} ({cont[k] || 0})</button>)}
            </div>
            <input className="input" style={{ maxWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar produto" aria-label="Filtrar produtos" />
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {filtro === "certeza" && "Mesmo produto pela regra, sem conflito (material, tipo, teor, medida), com quase todas as palavras do produto vencido no nome do estoque, mesma unidade e custo coerente com o preço vendido. Já vêm marcados; confira mesmo assim."}
            {filtro === "provavel" && "Mesmo produto pela regra, mas com nome diferente, unidade diferente (ex.: caixa × unidade) ou custo fora do esperado. Confira um a um."}
            {filtro === "sem" && "Nenhum produto do estoque com o mesmo princípio ativo/dose ou nome/medidas. Esses ficam sem custo até entrarem no estoque."}
            {filtro === "ligado" && "Já ligados: o custo do estoque é usado nos itens vencidos. Dá para desfazer."}
          </p>
          <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
            <table className="itab">
              <thead><tr>{pode && filtro !== "sem" && filtro !== "ligado" && <th aria-label="Ligar" />}<th>Produto vencido</th><th className="n">Itens · total</th><th className="n">Vendido (média)</th><th>Produto do estoque</th><th className="n">Custo</th><th>Observação</th></tr></thead>
              <tbody>
                {vis.slice(0, 400).map((l) => {
                  const e = esc(l);
                  const est = l.ligado || l.cands.find((x) => x.id === e.estId) || l.melhor;
                  const mk = est && l.vuMedio && Number(est.custo_atual) > 0 ? ((l.vuMedio - Number(est.custo_atual)) / Number(est.custo_atual)) * 100 : null;
                  return (
                    <tr key={l.p.id}>
                      {pode && filtro !== "sem" && filtro !== "ligado" && <td><input type="checkbox" checked={!!e.usar} onChange={(ev) => mudar(l, { usar: ev.target.checked })} aria-label={`Ligar ${l.p.nome}`} /></td>}
                      <td style={{ minWidth: 200 }}><b>{l.p.nome}</b> <span className="hint">{l.p.unidade || ""}</span></td>
                      <td className="n">{l.p.itens} · {brl(l.p.total)}</td>
                      <td className="n">{l.vuMedio != null ? brl(l.vuMedio) : "—"}</td>
                      <td style={{ minWidth: 240 }}>
                        {filtro === "ligado" ? (est ? <>{est.nome} <span className="hint">{est.unidade}{est.marca ? ` · ${est.marca}` : ""}</span></> : "—")
                          : l.cands.length > 1 && pode ? (
                            <select className="input mini" style={{ width: "100%" }} value={e.estId} onChange={(ev) => mudar(l, { estId: ev.target.value })} aria-label={`Produto do estoque para ${l.p.nome}`}>
                              {l.cands.slice(0, 12).map((x) => <option key={x.id} value={x.id}>{x.nome} · {x.unidade} · {brl(x.custo_atual)}</option>)}
                            </select>
                          ) : est ? <>{est.nome} <span className="hint">{est.unidade}{est.marca ? ` · ${est.marca}` : ""}</span></> : <span className="hint">—</span>}
                      </td>
                      <td className="n">{est ? brl(est.custo_atual) : "—"}{est && est.custo_em && <div className="hint">{fmtData(est.custo_em)}</div>}{mk != null && <div className="hint" style={{ color: mk < 0 ? "var(--red)" : undefined }}>markup {mk.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</div>}</td>
                      <td className="hint" style={{ minWidth: 160 }}>
                        {l.unidDif && <div style={{ color: "var(--amber)" }}>Unidade diferente ({l.p.unidade || "?"} × {l.melhor.unidade}): confira se o custo é por unidade.</div>}
                        {l.custoFora && <div style={{ color: "var(--amber)" }}>Custo muito diferente do preço vendido.</div>}
                        {l.generico && filtro !== "ligado" && <div style={{ color: "var(--amber)" }}>O item vencido não diz número/tamanho/medida; o do estoque diz. Confira se é o mesmo.</div>}
                        {l.custos.length > 1 && filtro !== "ligado" && <div>{l.cands.length} opções no estoque ({l.custos.length} custos diferentes)</div>}
                        {filtro === "ligado" && pode && <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => desligar(l)}>Desfazer</button>}
                      </td>
                    </tr>
                  );
                })}
                {!vis.length && <tr><td colSpan={7} className="hint">Nada nesta lista.</td></tr>}
              </tbody>
            </table>
          </div>
          {vis.length > 400 && <p className="hint" style={{ margin: 0 }}>Mostrando 400 de {vis.length}, os de maior valor vencido primeiro. Use o filtro para achar os demais.</p>}
          {pode && filtro !== "sem" && filtro !== "ligado" && vis.length > 0 && (
            <div className="row-inline">
              <button type="button" className="btn sm" onClick={ligar} disabled={busy}>{busy ? <span className="spin" /> : null}💲 Ligar os marcados ({vis.filter((l) => esc(l).usar && esc(l).estId).length})</button>
              <button type="button" className="btn ghost sm" onClick={() => setEscolha(Object.fromEntries(vis.map((l) => [l.p.id, { ...esc(l), usar: !!l.melhor }])))}>Marcar todos</button>
              <button type="button" className="btn ghost sm" onClick={() => setEscolha(Object.fromEntries(vis.map((l) => [l.p.id, { ...esc(l), usar: false }])))}>Desmarcar todos</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
