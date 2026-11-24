// =====================================================================
// LicitaPro · aba "Compras" (id interno: demandas)
// Monta uma cotação de compra com itens de vários contratos (itens vencidos):
// a equipe escolhe os itens, digita a quantidade das demandas que chegam do
// outro sistema e baixa a planilha para os fornecedores preencherem.
// A cotação em montagem fica só neste aparelho (rascunho); nada é gravado no banco.
// (O controle de saldo / ordens de fornecimento saiu da tela a pedido do dono, 24/11/2026;
//  as tabelas ordens_fornecimento / ordem_itens continuam no banco.)
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, num, parseNum, errMsg } from "./util.js";
import { carregarExcel, baixar } from "./cotacao.js";

const n = (v) => Number(v) || 0;
const CHAVE = "lp-compras-cotacao";
const lerRascunho = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}") || {}; } catch (e) { return {}; } };
const gravarRascunho = (v) => { try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem rascunho */ } };
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
// data "AAAA-MM-DD" sem passar pelo fuso (new Date() desloca um dia)
const dataBR = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

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

const rotuloProc = (c) => [c.p.orgao || "Órgão", c.p.numero && `Nº ${c.p.numero}`].filter(Boolean).join(" · ");

// ---------------------------------------------------------------------
// Planilhas
// ---------------------------------------------------------------------
const AMARELO = "FFFFF2CC";
const AZUL = "FF1F4E78";
const MOEDA = '"R$" #,##0.00';
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const borda = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };
function cabecalho(ws, linha, titulos) {
  const r = ws.getRow(linha);
  titulos.forEach((t, i) => { const c = r.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(AZUL); c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = borda; });
  r.height = 30;
}
const nomeArq = (pre, nome) => `${pre}_${String(nome || hojeISO()).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 60)}.xlsx`;

/** Planilha para o fornecedor: só descrição, unidade e quantidade (nada de órgão nem preço vendido). */
async function planilhaFornecedor(nome, cot) {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "LicitaPro"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
  const LC = 11; const L1 = LC + 1; const ult = L1 + cot.length - 1;
  const ws = wb.addWorksheet("Cotação", { views: [{ state: "frozen", ySplit: LC }] });
  ws.columns = [{ width: 7 }, { width: 70 }, { width: 10 }, { width: 10 }, { width: 20 }, { width: 17 }, { width: 18 }, { width: 30 }];
  ws.getCell("A1").value = `COTAÇÃO DE PREÇOS${nome ? ` · ${nome}` : ""}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Data: ${dataBR(hojeISO())}`;
  ["Fornecedor:", "CNPJ:", "Contato / telefone:", "Prazo de entrega:", "Validade da proposta:", "Condição de pagamento:"].forEach((t, i) => {
    const r = 3 + i;
    ws.getCell(`A${r}`).value = t; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).fill = fill(AMARELO); ws.getCell(`C${r}`).border = borda;
  });
  ws.getCell("A10").value = "Preencha as células em amarelo (marca, valor unitário e observações). Não altere o item, a descrição nem a quantidade.";
  ws.getCell("A10").font = { italic: true, color: { argb: "FF595959" } };
  cabecalho(ws, LC, ["Item", "Descrição", "Qtd", "Unid.", "Marca", "Valor unit. (R$)", "Valor total (R$)", "Observações"]);
  cot.forEach((x, i) => {
    const r = ws.getRow(L1 + i);
    r.values = [i + 1, x.descricao, x.qtd, x.unidade || "", null, null, { formula: `IF(F${L1 + i}="","",C${L1 + i}*F${L1 + i})` }, null];
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    [5, 6, 8].forEach((k) => (r.getCell(k).fill = fill(AMARELO)));
    [6, 7].forEach((k) => (r.getCell(k).numFmt = MOEDA));
    for (let k = 1; k <= 8; k++) r.getCell(k).border = borda;
  });
  const rt = ws.getRow(ult + 1);
  rt.getCell(6).value = "TOTAL"; rt.getCell(6).font = { bold: true };
  rt.getCell(7).value = { formula: `SUM(G${L1}:G${ult})` }; rt.getCell(7).numFmt = MOEDA; rt.getCell(7).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Planilha interna: de qual contrato vem cada quantidade e por quanto foi vendido. Não mandar ao fornecedor. */
async function planilhaInterna(nome, cot) {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "LicitaPro"; wb.created = new Date();
  const ws = wb.addWorksheet("Cotação interna", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 7 }, { width: 60 }, { width: 10 }, { width: 10 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 9 }, { width: 18 }, { width: 18 }, { width: 14 }];
  ws.getCell("A1").value = `COTAÇÃO INTERNA${nome ? ` · ${nome}` : ""} · ${dataBR(hojeISO())} · uso interno, não enviar ao fornecedor`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  cabecalho(ws, 3, ["Item", "Descrição", "Qtd", "Unid.", "Órgão", "Processo", "Ata / contrato", "Item no contrato", "Vendido (R$ unit.)", "Marca vendida", "Vigência até"]);
  let r = 4;
  cot.forEach((x, i) => {
    x.origens.forEach((o) => {
      const g = o.g; const p = g.processos || {};
      const row = ws.getRow(r++);
      row.values = [i + 1, g.descricao, o.q, g.unidade || "", [p.orgao, p.municipio].filter(Boolean).join(" – "), p.numero || "", [g.ata_numero && `Ata ${g.ata_numero}`, g.contrato_numero && `Contrato ${g.contrato_numero}`].filter(Boolean).join(" · "), g.numero, g.valor_unitario != null ? Number(g.valor_unitario) : null, g.marca || "", g.vigencia_fim ? dataBR(g.vigencia_fim) : ""];
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.getCell(9).numFmt = MOEDA;
      for (let k = 1; k <= 11; k++) row.getCell(k).border = borda;
    });
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------
export default function Demandas({ ctx }) {
  const { notify, abrir } = ctx;
  const [gan, setGan] = useState(null);
  const [erro, setErro] = useState("");
  const rascunho = useMemo(lerRascunho, []);
  const [sel, setSel] = useState(rascunho.sel && typeof rascunho.sel === "object" ? rascunho.sel : {}); // { ganhoId: "qtd digitada" }
  const [nome, setNome] = useState(rascunho.nome || "");
  const [juntar, setJuntar] = useState(rascunho.juntar !== false);
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState({});
  const [esconderVencidos, setEsconderVencidos] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { gravarRascunho({ sel, nome, juntar }); }, [sel, nome, juntar]);
  useEffect(() => {
    (async () => {
      try {
        setGan(await todas(() => sb.from("itens_ganhos").select("id,processo_id,produto_id,numero,descricao,unidade,quantidade,valor_unitario,marca,ata_numero,contrato_numero,vigencia_fim,processos(orgao,municipio,numero,data_sessao)").order("numero")));
      } catch (e) { setErro(errMsg(e)); setGan([]); }
    })();
  }, []);

  const hoje = hojeISO();
  const procs = useMemo(() => {
    const m = {};
    (gan || []).forEach((g) => {
      const c = (m[g.processo_id] = m[g.processo_id] || { id: g.processo_id, p: g.processos || {}, itens: [], vig: null, ata: new Set(), contrato: new Set() });
      c.itens.push(g);
      if (g.vigencia_fim && (!c.vig || g.vigencia_fim > c.vig)) c.vig = g.vigencia_fim;
      if (g.ata_numero) c.ata.add(g.ata_numero);
      if (g.contrato_numero) c.contrato.add(g.contrato_numero);
    });
    return Object.values(m).sort((a, b) => String(b.p.data_sessao || "").localeCompare(String(a.p.data_sessao || "")));
  }, [gan]);
  const porId = useMemo(() => Object.fromEntries((gan || []).map((g) => [g.id, g])), [gan]);

  const termos = semAcento(q).split(" ").filter(Boolean);
  const bate = (txt) => termos.every((t) => txt.includes(t));
  const visiveis = procs
    .filter((c) => !(esconderVencidos && c.vig && c.vig < hoje))
    .map((c) => {
      if (!termos.length) return { c, itens: c.itens, porItem: false };
      if (bate(semAcento(`${c.p.orgao} ${c.p.municipio} ${c.p.numero} ${[...c.ata].join(" ")} ${[...c.contrato].join(" ")}`))) return { c, itens: c.itens, porItem: false };
      const its = c.itens.filter((g) => bate(semAcento(`${g.descricao} ${g.marca || ""}`)));
      return its.length ? { c, itens: its, porItem: true } : null;
    })
    .filter(Boolean);

  const linhas = Object.entries(sel).map(([id, v]) => ({ g: porId[id], v })).filter((l) => l.g);
  const cot = useMemo(() => {
    const m = new Map();
    linhas.forEach(({ g, v }) => {
      const un = semAcento(g.unidade);
      const k = !juntar ? g.id : g.produto_id ? `p:${g.produto_id}|${un}` : `d:${semAcento(g.descricao)}|${un}`;
      const x = m.get(k) || { k, descricao: g.descricao, unidade: g.unidade, qtd: 0, origens: [] };
      const qv = n(parseNum(v));
      x.qtd += qv;
      x.origens.push({ g, v, q: qv });
      m.set(k, x);
    });
    return [...m.values()];
  }, [linhas, juntar]);
  const semQtd = linhas.filter((l) => !(n(parseNum(l.v)) > 0)).length;

  const marcar = (g, on) => setSel((s) => { const t = { ...s }; if (on) t[g.id] = t[g.id] ?? ""; else delete t[g.id]; return t; });
  const digitar = (g, v) => setSel((s) => ({ ...s, [g.id]: v }));
  const tirar = (ids) => setSel((s) => { const t = { ...s }; ids.forEach((id) => delete t[id]); return t; });
  const limpar = () => { if (window.confirm("Limpar a cotação em montagem?")) { setSel({}); setNome(""); } };

  const gerar = async (tipo) => {
    if (!cot.length) return notify("Escolha pelo menos um item.");
    if (semQtd) return notify(`Faltam as quantidades de ${semQtd} item(ns).`);
    setBusy(true);
    try {
      const blob = tipo === "interna" ? await planilhaInterna(nome.trim(), cot) : await planilhaFornecedor(nome.trim(), cot);
      baixar(blob, nomeArq(tipo === "interna" ? "Cotacao_interna" : "Cotacao", nome.trim()));
    } catch (e) { notify(errMsg(e)); }
    setBusy(false);
  };

  if (gan === null) return <div className="stack"><div className="top"><div><h1>Compras</h1></div></div><div className="card empty">Carregando…</div></div>;

  const LIMITE = termos.length ? 200 : 60;
  return (
    <div className="stack">
      <div className="top">
        <div><h1>Compras</h1><p>Junte itens de vários contratos, digite as quantidades das demandas e baixe a planilha de cotação para os fornecedores</p></div>
      </div>
      {erro && <div className="alerta-lance ruim">{erro}</div>}

      <div className="card stack" style={{ gap: 10 }}>
        <div className="card-h" style={{ marginBottom: 0 }}>
          <h2>🛒 Cotação em montagem</h2>
          {linhas.length > 0 && <button type="button" className="btn ghost sm" onClick={limpar}>Limpar</button>}
        </div>
        {!linhas.length ? (
          <p className="hint" style={{ margin: 0 }}>Nenhum item ainda. Abra os contratos abaixo (ou busque o item, ex.: “dipirona”), marque os itens e digite a quantidade de cada demanda.</p>
        ) : <>
          <div className="row-inline" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 4, flex: "1 1 260px", minWidth: 0 }}>
              <span className="hint">Nome da cotação (opcional)</span>
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Compras semana 25/11" />
            </label>
            <label className="row-inline" style={{ gap: 6 }}>
              <input type="checkbox" checked={juntar} onChange={(e) => setJuntar(e.target.checked)} />
              <span>Juntar itens iguais de contratos diferentes (soma as quantidades)</span>
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="itab">
              <thead><tr><th className="n">#</th><th>Descrição</th><th>Unid.</th><th className="n">Qtd total</th><th>De onde vem</th><th aria-label="Tirar" /></tr></thead>
              <tbody>
                {cot.map((x, i) => (
                  <tr key={x.k}>
                    <td className="n">{i + 1}</td>
                    <td style={{ minWidth: 240 }}><div className="clamp2">{x.descricao}</div></td>
                    <td>{x.unidade || "—"}</td>
                    <td className="n"><b>{x.qtd ? num(x.qtd) : "—"}</b></td>
                    <td style={{ minWidth: 260 }}>
                      {x.origens.map((o) => (
                        <div key={o.g.id} className="row-inline" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <input className="input mini" style={{ width: 80 }} inputMode="decimal" value={o.v} onChange={(e) => digitar(o.g, e.target.value)} placeholder="qtd" aria-label={`Quantidade do item ${o.g.numero} de ${o.g.processos?.orgao || "contrato"}`} />
                          <span className="hint">{rotuloProc({ p: o.g.processos || {} })} · item {o.g.numero}</span>
                          <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => tirar([o.g.id])} aria-label="Tirar este contrato">✕</button>
                        </div>
                      ))}
                    </td>
                    <td><button type="button" className="btn ghost sm" onClick={() => tirar(x.origens.map((o) => o.g.id))}>Tirar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {semQtd > 0 && <p className="hint" style={{ margin: 0, color: "var(--amber)" }}>Falta digitar a quantidade de {semQtd} item(ns).</p>}
          <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn sm" disabled={busy} onClick={() => gerar("fornecedor")}>{busy ? <span className="spin" /> : null}📥 Planilha para os fornecedores</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => gerar("interna")}>📥 Planilha interna (com os contratos)</button>
            <span className="hint">{cot.length} item(ns) na cotação · {linhas.length} linha(s) de contratos</span>
          </div>
          <p className="hint" style={{ margin: 0 }}>A planilha dos fornecedores leva só item, descrição, unidade e quantidade, com marca e preço em amarelo para preencher. A interna mostra de qual contrato vem cada quantidade e o preço vendido: é só para a equipe. A cotação fica guardada neste computador até você limpar.</p>
        </>}
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div className="card-h" style={{ marginBottom: 0 }}><h2>Contratos e itens vencidos</h2></div>
        <div className="row-inline" style={{ gap: 12, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 280px", minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar órgão, nº do processo ou item (ex.: luva procedimento)" aria-label="Buscar contratos ou itens" />
          <label className="row-inline" style={{ gap: 6 }}><input type="checkbox" checked={esconderVencidos} onChange={(e) => setEsconderVencidos(e.target.checked)} /><span>Esconder contratos com vigência vencida</span></label>
        </div>
        <span className="hint">{visiveis.length} contrato(s){termos.length ? " encontrados" : ""}</span>
        {visiveis.slice(0, LIMITE).map(({ c, itens, porItem }) => {
          const open = porItem || !!aberto[c.id];
          const naCot = c.itens.filter((g) => g.id in sel).length;
          return (
            <div key={c.id} className="card" style={{ padding: 10 }}>
              <button type="button" className="row-inline" style={{ width: "100%", justifyContent: "space-between", background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit", gap: 8 }} onClick={() => setAberto((a) => ({ ...a, [c.id]: !open }))} aria-expanded={open}>
                <span><b>{rotuloProc(c)}</b> <span className="hint">{[c.p.municipio, c.ata.size && `Ata ${[...c.ata].join(", ")}`, c.contrato.size && `Contrato ${[...c.contrato].join(", ")}`, c.vig && `vigência até ${dataBR(c.vig)}`].filter(Boolean).join(" · ")}</span></span>
                <span className="row-inline" style={{ gap: 6 }}>
                  {naCot > 0 && <span className="tag ok">{naCot} na cotação</span>}
                  {c.vig && c.vig < hoje && <span className="tag">vencido</span>}
                  <span className="tag">{porItem ? `${itens.length} de ${c.itens.length}` : c.itens.length} itens</span>
                  <span aria-hidden>{open ? "▲" : "▼"}</span>
                </span>
              </button>
              {open && (
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table className="itab">
                    <thead><tr><th aria-label="Marcar" /><th className="n">Item</th><th>Descrição</th><th>Unid.</th><th className="n">Qtd da ata</th><th>Marca</th><th className="n">Vendido</th><th className="n">Qtd para cotar</th></tr></thead>
                    <tbody>
                      {itens.map((g) => {
                        const on = g.id in sel;
                        return (
                          <tr key={g.id}>
                            <td><input type="checkbox" checked={on} onChange={(e) => marcar(g, e.target.checked)} aria-label={`Pôr o item ${g.numero} na cotação`} /></td>
                            <td className="n">{g.numero}</td>
                            <td style={{ minWidth: 240 }}><div className="clamp2">{g.descricao}</div></td>
                            <td>{g.unidade || "—"}</td>
                            <td className="n">{g.quantidade != null ? num(g.quantidade) : "—"}</td>
                            <td>{g.marca || "—"}</td>
                            <td className="n">{brl(g.valor_unitario)}</td>
                            <td className="n"><input className="input mini" style={{ width: 90 }} inputMode="decimal" value={on ? sel[g.id] : ""} onChange={(e) => digitar(g, e.target.value)} placeholder="0" aria-label={`Quantidade para cotar do item ${g.numero}`} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="row-inline" style={{ marginTop: 6 }}><button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => abrir(c.id)}>Abrir processo</button></div>
                </div>
              )}
            </div>
          );
        })}
        {visiveis.length > LIMITE && <p className="hint" style={{ margin: 0 }}>Mostrando {LIMITE} de {visiveis.length}. Use a busca para achar os demais.</p>}
        {!visiveis.length && <div className="empty">Nada encontrado.</div>}
      </div>
    </div>
  );
}
