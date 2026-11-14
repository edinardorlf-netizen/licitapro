// =====================================================================
// LicitaPro · planilha de cotação (Excel)
//
// Gera e lê a planilha padrão da empresa (modelo PE 039/2026), com 3 abas:
//   Planilha de Lançamento · Proposta Ajustada · Documentos
// Nenhum dado pessoal sai daqui: o layout está no código, os dados vêm do banco.
// A biblioteca de Excel (ExcelJS) só é baixada quando alguém usa a planilha,
// para não pesar o app no celular.
// =====================================================================
import { parseNum } from "./util.js";

const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const EXCELJS_SRI = "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";

let carregando = null;
export function carregarExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (carregando) return carregando;
  carregando = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = EXCELJS_URL;
    s.integrity = EXCELJS_SRI;
    s.crossOrigin = "anonymous";
    s.onload = () => (window.ExcelJS ? ok(window.ExcelJS) : falha(new Error("Não foi possível abrir o leitor de Excel.")));
    s.onerror = () => { carregando = null; falha(new Error("Não foi possível baixar o leitor de Excel. Confira a internet e tente de novo.")); };
    document.head.appendChild(s);
  });
  return carregando;
}

const ABA_LANC = "Planilha de Lançamento";
const L = `'${ABA_LANC}'`;
const LIN_CAB = 5; // linha do cabeçalho
const LIN_1 = 6; // primeiro item
const AMARELO = "FFFFF2CC";
const AZUL = "FF1F4E78";
const AZUL2 = "FF17365D";
const CINZA = "FFEDEDED";
const MOEDA = '"R$" #,##0.00';
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const borda = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };

// Colunas da aba de lançamento (mesma ordem do modelo da empresa)
export const COLS = [
  { k: "numero", t: "Item", w: 8.5 },
  { k: "participacao", t: "Participação", w: 24 },
  { k: "descricao", t: "Descrição (resumo do TR)", w: 70 },
  { k: "quantidade", t: "Qtd", w: 9 },
  { k: "unidade", t: "Unid.", w: 10.5 },
  { k: "preco_unit", t: "Valor Unitário (R$)", w: 18, preencher: true },
  { k: "preco_total", t: "Valor total (R$)", w: 20 },
  { k: "marca", t: "Marca", w: 19, preencher: true },
  { k: "custo", t: "Custo unit. (R$)", w: 16, preencher: true },
  { k: "valor_minimo", t: "Lance mínimo (R$)", w: 17, preencher: true },
  { k: "vencido", t: "Vencido? (S/N)", w: 15, preencher: true },
  { k: "valor_vencido", t: "Valor vencido (R$)", w: 17, preencher: true },
  { k: "anvisa", t: "Reg. ANVISA", w: 20, preencher: true },
  { k: "obs_exigencia", t: "Obs. / exigência especial", w: 26 },
  { k: "obs", t: "Observações", w: 26, preencher: true },
];
const letra = (k) => String.fromCharCode(65 + COLS.findIndex((c) => c.k === k));

export const nomeArquivo = (p) => {
  const n = String((p && p.numero) || "processo").replace(/^\s*(PE|preg[aã]o( eletr[oô]nico)?)\s*(n[º°o.]*)?\s*/i, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 60);
  return `Pregão_${n || "processo"}.xlsx`;
};

const tituloProc = (p) => [p.numero ? `PE ${String(p.numero).replace(/^PE\s*/i, "")}` : null, [p.orgao, p.municipio].filter(Boolean).join(" – "), p.objeto ? String(p.objeto).slice(0, 120) : null].filter(Boolean).join(" – ");

function cabecalho(ws, linha, titulos, cor) {
  const r = ws.getRow(linha);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill(cor);
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = borda;
  });
  r.height = 30;
}

/** Gera o .xlsx do processo. `itens` = os que a empresa vai disputar (ou todos). Devolve um Blob. */
export async function gerarPlanilha(p, itens, docs = []) {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "LicitaPro";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const ult = Math.max(LIN_1 + itens.length - 1, LIN_1 + 2);
  const faixa = (k) => `${letra(k)}${LIN_1}:${letra(k)}${ult}`;

  // ---------- Aba 1: Planilha de Lançamento ----------
  const ws = wb.addWorksheet(ABA_LANC, { views: [{ state: "frozen", ySplit: LIN_CAB }] });
  ws.columns = COLS.map((c) => ({ width: c.w }));
  ws.getCell("A1").value = tituloProc(p);
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = "AMARELO = preencher. Valor unitário e lance mínimo são digitados à mão. O lance mínimo aqui é só sugestão: o valor mínimo do robô é confirmado no LicitaPro.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };
  ws.getCell("A3").value = "Não altere as colunas Item e Qtd. Depois de preencher, envie esta planilha no LicitaPro (aba Itens → Enviar planilha preenchida).";
  ws.getCell("A3").font = { italic: true, color: { argb: "FF595959" } };
  ws.getCell("I2").value = "Total vencido";
  ws.getCell("J2").value = { formula: `SUMPRODUCT((${faixa("vencido")}="S")*${faixa("quantidade")}*${faixa("valor_vencido")})` };
  ws.getCell("J2").numFmt = MOEDA;
  ws.getCell("I3").value = "Qtd. itens vencidos:";
  ws.getCell("J3").value = { formula: `COUNTIF(${faixa("vencido")},"S")` };
  ws.getCell("L2").value = "Total cotado";
  ws.getCell("M2").value = { formula: `SUM(${faixa("preco_total")})` };
  ws.getCell("M2").numFmt = MOEDA;
  ["I2", "I3", "L2"].forEach((a) => (ws.getCell(a).font = { bold: true }));
  // linha de exemplo (igual ao modelo)
  const ex = ["EX.", "Exemplo", "(linha de exemplo – não é item do edital)", 10, "UN", 15, 150, "MarcaX", 12.5, 13.8, "", "", "80000000000", "", "cotação fornecedor Z"];
  const rEx = ws.getRow(4);
  ex.forEach((v, i) => { const c = rEx.getCell(i + 1); c.value = v === "" ? null : v; c.fill = fill(CINZA); c.font = { color: { argb: "FF7F7F7F" } }; if ([5, 6, 8, 9].includes(i)) c.numFmt = MOEDA; });
  cabecalho(ws, LIN_CAB, COLS.map((c) => c.t), AZUL);

  itens.forEach((it, i) => {
    const n = LIN_1 + i;
    const r = ws.getRow(n);
    const v = {
      numero: it.numero, participacao: it.participacao || null, descricao: it.descricao || "", quantidade: it.quantidade != null ? Number(it.quantidade) : null,
      unidade: it.unidade || "", preco_unit: it.preco_unit != null ? Number(it.preco_unit) : null,
      preco_total: { formula: `IF(${letra("preco_unit")}${n}="","",ROUND(${letra("quantidade")}${n}*${letra("preco_unit")}${n},2))` },
      marca: it.marca || null, custo: it.custo != null ? Number(it.custo) : null, valor_minimo: it.valor_minimo != null ? Number(it.valor_minimo) : (it.piso_sugerido != null ? Number(it.piso_sugerido) : null),
      vencido: null, valor_vencido: null, anvisa: it.anvisa || null, obs_exigencia: it.obs_exigencia || null, obs: it.obs || null,
    };
    COLS.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      cell.value = v[c.k] === "" ? null : v[c.k];
      cell.border = borda;
      cell.alignment = { vertical: "top", wrapText: c.k === "descricao" || c.k.startsWith("obs") };
      if (c.preencher) cell.fill = fill(AMARELO);
      if (["preco_unit", "preco_total", "custo", "valor_minimo", "valor_vencido"].includes(c.k)) cell.numFmt = MOEDA;
      if (c.k === "quantidade") cell.numFmt = Number.isInteger(v.quantidade) ? "#,##0" : "#,##0.00##";
      if (c.k === "anvisa") cell.numFmt = "@";
    });
    r.getCell(COLS.findIndex((c) => c.k === "vencido") + 1).dataValidation = { type: "list", allowBlank: true, formulae: ['"S,N"'] };
    // coluna auxiliar oculta: ordem do item entre os vencidos (usada pela aba Proposta Ajustada)
    r.getCell(COLS.length + 1).value = { formula: `IF(UPPER(LEFT(${letra("vencido")}${n},1))="S",COUNTIF($${letra("vencido")}$${LIN_1}:${letra("vencido")}${n},"S*"),"")` };
    r.height = Math.min(90, Math.max(30, Math.ceil(String(it.descricao || "").length / 80) * 15));
  });
  ws.autoFilter = { from: { row: LIN_CAB, column: 1 }, to: { row: LIN_CAB, column: COLS.length } };
  ws.getColumn(COLS.length + 1).hidden = true;

  // ---------- Aba 2: Proposta Ajustada (só os itens com Vencido = S) ----------
  const pa = wb.addWorksheet("Proposta Ajustada");
  pa.columns = [8, 64, 15, 12, 20, 20, 22, 22, 6, 30, 12].map((w) => ({ width: w }));
  pa.mergeCells("A1:H1"); pa.mergeCells("A2:H2"); pa.mergeCells("J1:K1");
  pa.getCell("A1").value = "PROPOSTA AJUSTADA — ITENS VENCIDOS";
  pa.getCell("A1").font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  pa.getCell("A1").fill = fill(AZUL2);
  pa.getCell("A2").value = tituloProc(p);
  pa.getCell("J1").value = "CONFIGURAÇÃO DA PROPOSTA";
  pa.getCell("J1").font = { bold: true, color: { argb: "FFFFFFFF" } };
  pa.getCell("J1").fill = fill(AZUL2);
  pa.getCell("J2").value = "Incluir registro ANVISA?";
  pa.getCell("K2").value = "Não";
  pa.getCell("K2").fill = fill(AMARELO);
  pa.getCell("K2").dataValidation = { type: "list", allowBlank: false, formulae: ['"Sim,Não"'], showErrorMessage: true, errorTitle: "Escolha Sim ou Não", error: "Selecione uma opção da lista." };
  pa.getCell("J4").value = "Marque S na coluna “Vencido?” da Planilha de Lançamento e o valor final em “Valor vencido”. Os itens aparecem aqui sozinhos.";
  pa.getCell("J4").alignment = { wrapText: true, vertical: "top" };
  pa.mergeCells("J4:K8");
  pa.getCell("A3").value = "Itens vencidos";
  pa.getCell("C3").value = { formula: `COUNTIF(${L}!${faixa("vencido")},"S")` };
  pa.getCell("E3").value = "Total (R$)";
  pa.getCell("F3").numFmt = MOEDA;
  ["A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3"].forEach((a) => { pa.getCell(a).fill = fill("FFE7EEF5"); pa.getCell(a).font = { bold: true }; });
  cabecalho(pa, LIN_CAB, ["Item", "Descrição do produto", "Quantidade", "Unidade", "Valor unitário (R$)", "Valor total (R$)", "Marca", ""], AZUL2);
  pa.getCell("H5").value = { formula: 'IF($K$2="Sim","Reg. ANVISA","")' };
  const nItens = Math.max(itens.length, 1);
  const ultPa = LIN_1 + nItens - 1;
  pa.getCell("F3").value = { formula: `SUM(F${LIN_1}:F${ultPa})` };
  const col = (k) => `${L}!$${letra(k)}$${LIN_1}:$${letra(k)}$${ult}`;
  for (let i = 0; i < nItens; i++) {
    const n = LIN_1 + i;
    const idx = `$I${n}`;
    const pega = (k) => `IF(${idx}="","",INDEX(${col(k)},${idx})&"")`;
    // I = posição do k-ésimo item vencido (coluna auxiliar oculta)
    const aux = String.fromCharCode(65 + COLS.length);
    pa.getCell(`I${n}`).value = { formula: `IFERROR(MATCH(ROWS($I$${LIN_1}:I${n}),${L}!$${aux}$${LIN_1}:$${aux}$${ult},0),"")` };
    pa.getCell(`A${n}`).value = { formula: `IF(${idx}="","",INDEX(${col("numero")},${idx}))` };
    pa.getCell(`B${n}`).value = { formula: pega("descricao") };
    pa.getCell(`C${n}`).value = { formula: `IF(${idx}="","",INDEX(${col("quantidade")},${idx}))` };
    pa.getCell(`D${n}`).value = { formula: pega("unidade") };
    pa.getCell(`E${n}`).value = { formula: `IF(${idx}="","",IF(INDEX(${col("valor_vencido")},${idx})>0,INDEX(${col("valor_vencido")},${idx}),INDEX(${col("preco_unit")},${idx})))` };
    pa.getCell(`F${n}`).value = { formula: `IF(${idx}="","",ROUND(C${n}*E${n},2))` };
    pa.getCell(`G${n}`).value = { formula: pega("marca") };
    pa.getCell(`H${n}`).value = { formula: `IF(OR(${idx}="",$K$2<>"Sim"),"",INDEX(${col("anvisa")},${idx})&"")` };
    ["E", "F"].forEach((c) => (pa.getCell(`${c}${n}`).numFmt = MOEDA));
    pa.getCell(`C${n}`).numFmt = "General";
    pa.getCell(`B${n}`).alignment = { wrapText: true, vertical: "top" };
  }
  pa.getColumn(9).hidden = true;

  // ---------- Aba 3: Documentos ----------
  const dc = wb.addWorksheet("Documentos", { views: [{ state: "frozen", ySplit: 1 }] });
  dc.columns = [96, 14, 22, 12, 30].map((w) => ({ width: w }));
  cabecalho(dc, 1, ["Documento", "Item do edital", "Status (OK / Pendente / Vencido)", "Validade", "Observação"], AZUL);
  const grupos = ["PROPOSTA", "HABILITAÇÃO JURÍDICA", "REGULARIDADE FISCAL E TRABALHISTA", "QUALIFICAÇÃO ECONÔMICO-FINANCEIRA", "QUALIFICAÇÃO TÉCNICA", "DECLARAÇÕES", "OUTROS"];
  let lin = 2;
  grupos.forEach((g) => {
    const cg = dc.getCell(`A${lin}`);
    cg.value = g; cg.font = { bold: true, color: { argb: "FFFFFFFF" } };
    ["A", "B", "C", "D", "E"].forEach((c) => (dc.getCell(`${c}${lin}`).fill = fill("FF5B9BD5")));
    lin++;
    const doGrupo = docs.filter((d) => (d.categoria || "OUTROS").toUpperCase() === g);
    const linhas = doGrupo.length ? doGrupo : [{}, {}];
    linhas.forEach((d) => {
      dc.getCell(`A${lin}`).value = d.nome || null;
      dc.getCell(`B${lin}`).value = d.item || null;
      dc.getCell(`C${lin}`).value = d.status || (d.nome ? "Pendente" : null);
      dc.getCell(`D${lin}`).value = d.validade || null;
      dc.getCell(`E${lin}`).value = d.obs || null;
      dc.getCell(`C${lin}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"OK,Pendente,Vencido,N/A"'] };
      dc.getCell(`A${lin}`).alignment = { wrapText: true, vertical: "top" };
      lin++;
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------
// Leitura da planilha preenchida
// ---------------------------------------------------------------------
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Ordem importa: "valor vencido" antes de "vencido"; "valor total" antes de "valor unit".
const CAB = [
  ["valor_vencido", (h) => h.startsWith("valor vencido")],
  ["vencido", (h) => h.startsWith("vencido")],
  ["preco_total", (h) => h.startsWith("valor total") || h === "total" || h.startsWith("total (r$)")],
  ["preco_unit", (h) => h.startsWith("valor unt") || h.startsWith("valor unit") || h.startsWith("preco unit")],
  ["valor_minimo", (h) => /lance minimo|valor minimo|^piso/.test(h)],
  ["numero", (h) => h === "item" || h === "item nº" || h === "nº item"],
  ["participacao", (h) => h.startsWith("participa")],
  ["descricao", (h) => h.startsWith("descri")],
  ["quantidade", (h) => h === "qtd" || h.startsWith("qtd") || h.startsWith("quantidade")],
  ["unidade", (h) => h.startsWith("unid")],
  ["marca", (h) => h.startsWith("marca")],
  ["custo", (h) => h.startsWith("custo")],
  ["anvisa", (h) => h.includes("anvisa")],
  ["obs_exigencia", (h) => h.includes("exigencia")],
  ["obs", (h) => h.startsWith("observa")],
];

function valorCel(cell) {
  let v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v || "formula" in v || "sharedFormula" in v) v = v.result;
    else if (v.richText) v = v.richText.map((t) => t.text).join("");
    else if ("text" in v) v = v.text;
    else if (v.error) return null;
  }
  if (v == null || (typeof v === "object" && v.error)) return null;
  return v;
}
const texto = (v) => (v == null ? null : String(v).trim() || null);
const numero = (v) => (v == null || v === "" ? null : typeof v === "number" ? v : parseNum(String(v)));
const c2 = (v) => Math.round(v * 100) / 100;
const rs = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Lê a planilha preenchida e confere com os itens do processo.
 * Devolve { linhas: [{ numero, item, dados, avisos[] }], avisos[] }.
 */
export async function lerPlanilha(arquivo, itensProc) {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await arquivo.arrayBuffer()); } catch (e) { throw new Error("Não consegui abrir o arquivo. Envie a planilha em Excel (.xlsx)."); }
  const ws = wb.getWorksheet(ABA_LANC) || wb.worksheets.find((w) => /lan[cç]amento/i.test(w.name)) || wb.worksheets[0];
  if (!ws) throw new Error("A planilha está vazia.");

  // acha o cabeçalho nas primeiras 15 linhas
  let linCab = 0; let mapa = {};
  for (let r = 1; r <= Math.min(15, ws.rowCount) && !linCab; r++) {
    const m = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const h = norm(valorCel(cell));
      const achado = CAB.find(([k, teste]) => !(k in m) && teste(h));
      if (achado) m[achado[0]] = c;
    });
    if (m.numero && (m.preco_unit || m.preco_total)) { linCab = r; mapa = m; }
  }
  if (!linCab) throw new Error("Não achei o cabeçalho (Item, Descrição, Qtd, Valor unitário…). Use a planilha gerada pelo LicitaPro.");

  const porNumero = new Map(itensProc.map((i) => [Number(i.numero), i]));
  const linhas = []; const avisos = []; const vistos = new Set();
  for (let r = linCab + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const pega = (k) => (mapa[k] ? valorCel(row.getCell(mapa[k])) : null);
    const n = numero(pega("numero"));
    if (n == null || !Number.isInteger(n)) continue; // linha de exemplo, total ou vazia
    const d = {
      participacao: texto(pega("participacao")), quantidade: numero(pega("quantidade")),
      preco_unit: numero(pega("preco_unit")), preco_total: numero(pega("preco_total")),
      marca: texto(pega("marca")), custo: numero(pega("custo")), piso_sugerido: numero(pega("valor_minimo")),
      vencido: (texto(pega("vencido")) || "").toUpperCase().startsWith("S"), valor_vencido: numero(pega("valor_vencido")),
      anvisa: texto(pega("anvisa")), obs_exigencia: texto(pega("obs_exigencia")), obs: texto(pega("obs")),
    };
    const c4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
    d.preco_unit = c4(d.preco_unit); d.custo = c4(d.custo); d.piso_sugerido = c4(d.piso_sugerido); d.valor_vencido = c4(d.valor_vencido);
    if (d.preco_total != null) d.preco_total = c2(d.preco_total);
    const av = [];
    const item = porNumero.get(n);
    if (!item) { avisos.push(`Linha ${r}: item ${n} não existe neste processo (ignorado).`); continue; }
    if (vistos.has(n)) { avisos.push(`Linha ${r}: item ${n} repetido (ignorado).`); continue; }
    vistos.add(n);
    const qtd = item.quantidade != null ? Number(item.quantidade) : d.quantidade;
    if (d.quantidade != null && item.quantidade != null && Math.abs(d.quantidade - Number(item.quantidade)) > 1e-6) av.push(`Quantidade na planilha (${d.quantidade}) diferente do edital (${Number(item.quantidade)}).`);
    if (d.preco_unit != null && qtd != null) {
      const esperado = c2(d.preco_unit * qtd);
      if (d.preco_total == null) d.preco_total = esperado;
      else if (Math.abs(d.preco_total - esperado) > 0.01) av.push(`Total ${rs(d.preco_total)} ≠ unitário × quantidade = ${rs(esperado)}.`);
    }
    if (d.preco_unit == null && d.preco_total != null) av.push("Tem total mas falta o valor unitário.");
    if (d.preco_unit != null && !d.marca) av.push("Sem marca.");
    if (d.piso_sugerido != null && d.preco_unit != null && d.piso_sugerido > d.preco_unit) av.push(`Lance mínimo (${rs(d.piso_sugerido)}) maior que o valor unitário.`);
    if (d.preco_unit != null && item.valor_ref != null && Number(item.valor_ref) > 0 && d.preco_unit > Number(item.valor_ref)) av.push(`Valor unitário acima da referência (${rs(item.valor_ref)}).`);
    linhas.push({ numero: n, item, dados: d, avisos: av, cotado: d.preco_unit != null });
  }
  if (!linhas.length) throw new Error("Nenhum item do processo foi encontrado na planilha.");
  return { linhas, avisos, aba: ws.name };
}
