// =====================================================================
// LicitaPro · aba "Reequilíbrio"
// Processos ganhos cuja validade da proposta já venceu (data da sessão +
// dias de validade lidos no edital). Para cada um: os itens vencidos com o
// preço registrado, o custo na época da proposta, o custo atual (aba Produtos),
// a variação e o preço que mantém a margem original — tudo o que é preciso
// para montar o pedido de reequilíbrio econômico-financeiro.
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, num, fmtData, errMsg, chamarRobo, parseNum } from "./util.js";
import { diasDesde, DIAS_CUSTO_VELHO } from "./produtos.js";
import { carregarProdutos, carregarGanhos, carregarItensNossos } from "./dados.js";
import { carregarExcel, baixar } from "./cotacao.js";

const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const c2 = (v) => Math.round(v * 100) / 100;
const DIA = 864e5;

export default function Reequilibrio({ ctx }) {
  const { pode, notify, config, empresas, abrir, perm } = ctx;
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [lendo, setLendo] = useState("");
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");

  const carregar = async () => {
    try {
      const [ganhos, produtos, itens] = await Promise.all([carregarGanhos(), carregarProdutos(), carregarItensNossos()]);
      setD({ ganhos, produtos: new Map(produtos.map((p) => [p.id, p])), itens: new Map(itens.map((i) => [i.id, i])) });
      return ganhos;
    } catch (e) { setErro(errMsg(e)); return null; }
  };

  // Lê no edital a validade da proposta dos processos ganhos que ainda não foram analisados
  const lerValidades = async (ganhos, forcar) => {
    if (forcar) {
      // tenta de novo os editais em que o prazo não foi encontrado
      const ids = [...new Set((ganhos || []).filter((g) => g.processos && g.processos.validade_fonte === "nao_encontrada").map((g) => g.processo_id))];
      if (!ids.length) return notify("Todos os editais já foram lidos.");
      const { error } = await sb.from("processos").update({ validade_checada_em: null }).in("id", ids);
      if (error) return notify(errMsg(error));
      ganhos = ganhos.map((g) => (ids.includes(g.processo_id) ? { ...g, processos: { ...g.processos, validade_fonte: null } } : g));
    }
    const faltam = new Set((ganhos || []).filter((g) => g.processos && !g.processos.validade_fonte).map((g) => g.processo_id));
    if (!faltam.size) return;
    // Um edital por chamada; se um arquivo pesado derrubar a leitura, ele já fica marcado e a fila segue
    let rodadas = 0, feitos = 0, falhas = 0;
    const total = Math.max(faltam.size, 1);
    while (rodadas++ < 80 && falhas < 5) {
      setLendo(`Lendo a validade da proposta nos editais… ${Math.min(feitos, total)} de ${total}`);
      try {
        const r = await chamarRobo({}, "licita-validade");
        feitos += r.analisados || 0;
        if (!r.faltam) break;
      } catch (e) { falhas++; feitos++; }
    }
    if (falhas >= 5) notify("Alguns editais não puderam ser lidos agora; informe a validade deles à mão.");
    setLendo("");
    await carregar();
  };
  useEffect(() => { carregar().then((g) => lerValidades(g, false)); }, []);

  const procs = useMemo(() => {
    if (!d) return [];
    const m = new Map();
    d.ganhos.forEach((g) => {
      if (!g.processos) return;
      const x = m.get(g.processo_id) || { id: g.processo_id, p: g.processos, itens: [] };
      x.itens.push(g); m.set(g.processo_id, x);
    });
    const agora = Date.now();
    return [...m.values()].map((x) => {
      const ini = x.p.data_sessao ? new Date(x.p.data_sessao).getTime() : null;
      const dias = x.p.validade_dias || null;
      const vence = ini && dias ? ini + dias * DIA : null;
      const linhas = x.itens.map((g) => {
        const it = g.item_id ? d.itens.get(g.item_id) : null;
        const prod = g.produto_id ? d.produtos.get(g.produto_id) : null;
        const venda = g.valor_unitario != null ? Number(g.valor_unitario) : null;
        const cProp = g.custo_unit != null ? Number(g.custo_unit) : it && it.custo != null ? Number(it.custo) : null;
        const cAtual = prod && prod.custo_atual != null ? Number(prod.custo_atual) : null;
        const idade = prod ? diasDesde(prod.custo_em) : null;
        const varC = cProp && cAtual ? ((cAtual - cProp) / cProp) * 100 : null;
        const mkOrig = cProp && venda ? (venda - cProp) / cProp : null;
        const novo = cAtual != null && mkOrig != null ? c2(cAtual * (1 + mkOrig)) : null;
        const mkAtual = cAtual && venda ? ((venda - cAtual) / cAtual) * 100 : null;
        const saldo = Math.max(0, (Number(g.quantidade) || 0) - (Number(g.quantidade_entregue) || 0));
        const impacto = novo != null && venda != null && novo > venda ? c2((novo - venda) * saldo) : 0;
        return { g, prod, venda, cProp, cAtual, idade, velho: idade != null && idade > DIAS_CUSTO_VELHO, varC, mkOrig, novo, mkAtual, saldo, impacto };
      });
      const subiu = linhas.filter((l) => l.varC != null && l.varC > 0);
      return { ...x, ini, dias, vence, vencida: vence != null && vence < agora, linhas, subiu, impacto: linhas.reduce((a, l) => a + l.impacto, 0), semCusto: linhas.filter((l) => l.cAtual == null).length };
    });
  }, [d]);

  const vencidos = procs.filter((x) => x.vencida && (!q || `${x.p.orgao} ${x.p.municipio} ${x.p.numero}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.impacto - a.impacto || a.vence - b.vence);
  const semValidade = procs.filter((x) => !x.dias);
  const aindaValidos = procs.filter((x) => x.dias && !x.vencida);

  const definirValidade = async (x, dias) => {
    const n = parseNum(dias);
    if (!n || n < 1 || n > 730) return notify("Informe os dias de validade (1 a 730)");
    const { error } = await sb.from("processos").update({ validade_dias: Math.round(n), validade_fonte: "manual", validade_trecho: "Informado à mão", validade_checada_em: new Date().toISOString() }).eq("id", x.id);
    if (error) return notify(errMsg(error));
    notify("Validade da proposta salva"); carregar();
  };

  if (erro) return <div className="stack"><div className="top"><div><h1>Reequilíbrio</h1></div></div><div className="banner err" role="alert">{erro}</div></div>;
  if (sel) {
    const x = procs.find((y) => y.id === sel);
    if (x) return <Detalhe x={x} ctx={ctx} voltar={() => setSel(null)} definirValidade={definirValidade} />;
  }

  return (
    <div className="stack">
      <div className="top"><div><h1>Reequilíbrio de preços</h1><p>Processos ganhos com a validade da proposta já vencida, comparando o custo da proposta com o custo atual dos produtos</p></div>
        {pode && <button className="btn ghost" disabled={!!lendo} onClick={() => lerValidades(d && d.ganhos, true)}>Tentar ler de novo os não encontrados</button>}
      </div>
      {lendo && <div className="banner info"><span className="spin" /> {lendo}</div>}
      {!d ? <div className="card empty">Carregando…</div> : (
        <>
          <div className="grid3">
            <div className="card kpi"><small>Proposta vencida</small><b className="num">{procs.filter((x) => x.vencida).length}</b><small>Podem pedir reequilíbrio</small></div>
            <div className="card kpi"><small>Proposta ainda válida</small><b className="num">{aindaValidos.length}</b><small>Aparecem aqui quando vencer</small></div>
            <div className="card kpi"><small>Impacto possível</small><b className="num">{brl(procs.filter((x) => x.vencida).reduce((a, x) => a + x.impacto, 0))}</b><small>No saldo a entregar, mantendo a margem</small></div>
          </div>
          <div className="row-inline" style={{ justifyContent: "space-between" }}>
            <span className="hint">O custo atual vem da aba Produtos; o custo da proposta, da cotação do item ou do custo digitado no item ganho.</span>
            <input className="input" style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar órgão ou número" aria-label="Buscar" />
          </div>
          {!vencidos.length ? <div className="card empty"><b>Nenhum processo com a proposta vencida</b>Quando a validade da proposta de um processo ganho vencer, ele aparece aqui sozinho.</div> : (
            <div className="pgrid">
              {vencidos.map((x) => (
                <div key={x.id} className="pcard" role="button" tabIndex={0} onClick={() => setSel(x.id)} onKeyDown={(e) => e.key === "Enter" && setSel(x.id)}>
                  <div className="ptop"><div style={{ minWidth: 0 }}><div className="porg">{x.p.orgao || "Órgão"}</div><div className="hint">{[x.p.municipio, x.p.numero && `Nº ${x.p.numero}`].filter(Boolean).join(" · ")}</div></div></div>
                  <div className="hint clamp2" style={{ color: "var(--ink-2)" }}>{x.p.objeto}</div>
                  <div className="row-inline">
                    <span className="tag ok">🏆 {x.linhas.length} item(ns)</span>
                    {x.subiu.length > 0 && <span className="tag warn">📈 {x.subiu.length} com custo maior</span>}
                    {x.semCusto > 0 && <span className="tag">{x.semCusto} sem custo atual</span>}
                  </div>
                  <div className="estado">
                    Proposta de {fmtData(x.p.data_sessao)} · validade {x.dias} dias{x.p.validade_fonte === "manual" ? " (informada)" : ""}
                    <div className="hint" style={{ color: "var(--red)" }}>Venceu em {fmtData(new Date(x.vence).toISOString())} (há {Math.floor((Date.now() - x.vence) / DIA)} dias)</div>
                  </div>
                  <div className="row-inline"><span className="hint">Impacto no saldo: <b>{brl(x.impacto)}</b></span></div>
                </div>
              ))}
            </div>
          )}
          {semValidade.length > 0 && (
            <div className="card stack" style={{ gap: 8 }}>
              <h2 style={{ margin: 0 }}>Validade da proposta não encontrada ({semValidade.length})</h2>
              <p className="hint" style={{ margin: 0 }}>O app não achou o prazo de validade no edital destes processos (edital não publicado no portal, arquivo escaneado ou texto diferente). Informe os dias para eles entrarem na conta.</p>
              {semValidade.map((x) => <SemValidade key={x.id} x={x} pode={pode} definir={definirValidade} abrir={abrir} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SemValidade({ x, pode, definir, abrir }) {
  const [v, setV] = useState("");
  return (
    <div className="lrow" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div className="lmain" style={{ minWidth: 220 }}><span className="lt">{x.p.orgao}{x.p.numero ? ` · ${x.p.numero}` : ""}</span><span className="ls">Sessão {fmtData(x.p.data_sessao)} · {x.p.validade_trecho || "ainda não analisado"}</span></div>
      {pode && <span className="row-inline"><input className="input num mini" style={{ width: 70 }} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder="60" aria-label="Dias de validade" /><span className="hint">dias</span><button className="btn ghost sm" onClick={() => definir(x, v)} disabled={!v}>Salvar</button></span>}
      <button className="linkbtn" style={{ fontSize: 12.5 }} onClick={() => abrir(x.id)}>Abrir processo</button>
    </div>
  );
}

function Detalhe({ x, ctx, voltar, definirValidade }) {
  const { config, empresas, pode, notify, abrir } = ctx;
  const [dias, setDias] = useState(String(x.dias || ""));
  const emp = (empresas || []).find((e) => e.id === x.p.empresa_id) || null;
  const empNome = emp ? emp.nome : (config && config.empresa_nome) || "";
  const empCnpj = emp ? emp.cnpj : (config && config.empresa_cnpj) || "";
  const atas = [...new Set(x.linhas.map((l) => l.g.ata_numero).filter(Boolean))];
  const ctrs = [...new Set(x.linhas.map((l) => l.g.contrato_numero).filter(Boolean))];
  const vigFim = x.linhas.map((l) => l.g.vigencia_fim).filter(Boolean).sort().pop();
  const pedir = x.linhas.filter((l) => l.novo != null && l.venda != null && l.novo > l.venda);
  const minimo = config ? Number(config.markup_minimo) : 20;

  const texto = () => {
    const linhas = pedir.map((l) => `Item ${l.g.numero} – ${String(l.g.descricao || "").slice(0, 90)} – marca ${l.g.marca || "—"}: preço registrado ${brl(l.venda)}; custo na proposta ${brl(l.cProp)}; custo atual ${brl(l.cAtual)} (${pct(l.varC)}); preço solicitado ${brl(l.novo)}.`);
    return [
      `Ao ${x.p.orgao}${x.p.municipio ? ` – ${x.p.municipio}` : ""}`,
      `Ref.: ${x.p.numero ? `Pregão Eletrônico nº ${x.p.numero}` : "Pregão Eletrônico"}${atas.length ? ` – Ata de Registro de Preços nº ${atas.join(", ")}` : ""}${ctrs.length ? ` – Contrato nº ${ctrs.join(", ")}` : ""}`,
      "Assunto: Pedido de reequilíbrio econômico-financeiro",
      "",
      `${empNome || "A empresa"}${empCnpj ? `, CNPJ ${String(empCnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : ""}, detentora dos itens abaixo, vem requerer o restabelecimento do equilíbrio econômico-financeiro, com base no art. 124, II, "d", da Lei nº 14.133/2021.`,
      `A proposta foi apresentada em ${fmtData(x.p.data_sessao)}, com validade de ${x.dias} dias (encerrada em ${fmtData(new Date(x.vence).toISOString())}). Após esse prazo, o custo de aquisição dos produtos aumentou, conforme quadro abaixo, tornando inviável o fornecimento pelos preços registrados.`,
      "",
      ...linhas,
      "",
      "Solicitamos a revisão dos preços para os valores indicados, que mantêm a mesma margem da proposta original.",
      "Anexos: notas fiscais de compra da época da proposta e atuais e/ou cotações de fornecedores (e tabela CMED, para medicamentos).",
    ].join("\n");
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(texto()); notify("Texto do pedido copiado"); } catch (e) { notify("Não consegui copiar; selecione o texto abaixo"); } };

  const planilha = async () => {
    try {
      const ExcelJS = await carregarExcel();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Reequilíbrio");
      ws.columns = [8, 60, 18, 8, 10, 10, 16, 16, 16, 12, 16, 16].map((w) => ({ width: w }));
      ws.addRow([`Pedido de reequilíbrio – ${x.p.orgao}${x.p.numero ? ` – Pregão ${x.p.numero}` : ""}`]).font = { bold: true, size: 13 };
      ws.addRow([`Proposta de ${fmtData(x.p.data_sessao)} · validade ${x.dias} dias · vencida em ${fmtData(new Date(x.vence).toISOString())}${atas.length ? ` · Ata ${atas.join(", ")}` : ""}`]);
      ws.addRow([]);
      const cab = ws.addRow(["Item", "Descrição", "Marca", "Unid.", "Qtd", "Saldo", "Preço registrado", "Custo na proposta", "Custo atual", "Variação", "Preço solicitado", "Impacto no saldo"]);
      cab.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
      x.linhas.forEach((l) => {
        const r = ws.addRow([l.g.numero, l.g.descricao, l.g.marca || "", l.g.unidade || "", Number(l.g.quantidade) || 0, l.saldo, l.venda, l.cProp, l.cAtual, l.varC != null ? l.varC / 100 : null, l.novo, l.impacto || null]);
        r.getCell(2).alignment = { wrapText: true, vertical: "top" };
        [7, 8, 9, 11, 12].forEach((i) => (r.getCell(i).numFmt = '"R$" #,##0.00'));
        r.getCell(10).numFmt = "0.0%";
      });
      const tot = ws.addRow(["", "TOTAL", "", "", "", "", "", "", "", "", "", x.impacto]);
      tot.font = { bold: true }; tot.getCell(12).numFmt = '"R$" #,##0.00';
      const buf = await wb.xlsx.writeBuffer();
      baixar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Reequilibrio_${String(x.p.numero || "processo").replace(/[\\/:*?"<>|\s]+/g, "-")}.xlsx`);
    } catch (e) { notify(errMsg(e)); }
  };

  return (
    <div className="stack">
      <div className="top">
        <div>
          <button className="btn ghost sm" style={{ marginBottom: 8 }} onClick={voltar}>← Reequilíbrio</button>
          <h1>{x.p.orgao || "Processo"}</h1>
          <p>{[x.p.municipio, x.p.numero && `Nº ${x.p.numero}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="row-inline">
          <button className="btn ghost" onClick={() => abrir(x.id)}>Abrir processo</button>
          <button className="btn ghost" onClick={planilha}>📥 Planilha do pedido</button>
          <button className="btn" onClick={copiar} disabled={!pedir.length}>📋 Copiar texto do pedido</button>
        </div>
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="hint clamp2" style={{ color: "var(--ink-2)" }}>{x.p.objeto}</div>
        <div className="fgrid">
          <div><small className="hint">Empresa</small><div><b>{empNome || "—"}</b>{empCnpj ? ` · ${empCnpj}` : ""}</div></div>
          <div><small className="hint">Data da proposta (sessão)</small><div><b>{fmtData(x.p.data_sessao)}</b></div></div>
          <div><small className="hint">Validade da proposta</small><div><b>{x.dias} dias</b> · venceu em <b>{fmtData(new Date(x.vence).toISOString())}</b></div></div>
          <div><small className="hint">Ata / contrato</small><div><b>{[atas.length && `Ata ${atas.join(", ")}`, ctrs.length && `Contrato ${ctrs.join(", ")}`].filter(Boolean).join(" · ") || "não informado"}</b></div></div>
          <div><small className="hint">Vigência até</small><div><b>{vigFim ? fmtData(vigFim + "T12:00:00") : "não informada"}</b></div></div>
          <div><small className="hint">Impacto no saldo a entregar</small><div><b>{brl(x.impacto)}</b></div></div>
        </div>
        <div className="hint">Prazo de validade: {x.p.validade_fonte === "edital" ? <>lido no edital: “{x.p.validade_trecho}”</> : x.p.validade_fonte === "manual" ? "informado à mão" : "—"}</div>
        {pode && (
          <div className="row-inline"><span className="hint">Corrigir validade:</span><input className="input num mini" style={{ width: 70 }} value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Dias de validade" /><span className="hint">dias</span>
            <button className="btn ghost sm" disabled={!dias || Number(dias) === x.dias} onClick={() => definirValidade(x, dias)}>Salvar</button></div>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="itab">
            <thead><tr><th>Item</th><th>Descrição</th><th>Marca</th><th className="n">Qtd / saldo</th><th className="n">Preço registrado</th><th className="n">Custo na proposta</th><th className="n">Custo atual</th><th className="n">Variação do custo</th><th className="n">Markup hoje</th><th className="n">Preço p/ manter a margem</th><th className="n">Impacto</th></tr></thead>
            <tbody>
              {x.linhas.map((l) => (
                <tr key={l.g.id} style={l.novo != null && l.venda != null && l.novo > l.venda ? { background: "var(--amber-soft)" } : null}>
                  <td>{l.g.numero}</td>
                  <td style={{ minWidth: 240 }}><div className="clamp3">{l.g.descricao}</div>{l.prod && <div className="hint">Produto: {l.prod.nome}</div>}</td>
                  <td>{l.g.marca || "—"}</td>
                  <td className="n">{num(l.g.quantidade)}<div className="hint">saldo {num(l.saldo)}</div></td>
                  <td className="n">{brl(l.venda)}</td>
                  <td className="n">{l.cProp != null ? brl(l.cProp) : <span className="hint">sem custo da proposta</span>}</td>
                  <td className="n">{l.cAtual != null ? brl(l.cAtual) : <span className="hint">sem custo atual</span>}{l.velho && <div className="hint" style={{ color: "var(--red)" }}>⚠ custo de {l.idade} dias</div>}</td>
                  <td className="n" style={{ color: l.varC > 0 ? "var(--red)" : undefined, fontWeight: 600 }}>{pct(l.varC)}</td>
                  <td className="n" style={{ color: l.mkAtual != null && l.mkAtual < minimo ? "var(--red)" : undefined }}>{l.mkAtual != null ? `${l.mkAtual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</td>
                  <td className="n"><b>{l.novo != null ? brl(l.novo) : "—"}</b></td>
                  <td className="n">{l.impacto ? brl(l.impacto) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">“Preço p/ manter a margem” = custo atual × (preço registrado ÷ custo na proposta). Itens em amarelo têm o custo atual acima do custo da proposta. Para itens sem custo, preencha o custo na aba Produtos (custo atual) ou no item ganho, aba Contratos (custo da proposta).</p>
      {pedir.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <b>Texto do pedido (rascunho)</b>
          <textarea className="input" readOnly rows={14} value={texto()} style={{ fontFamily: "inherit", fontSize: 13 }} aria-label="Texto do pedido de reequilíbrio" />
        </div>
      )}
    </div>
  );
}
