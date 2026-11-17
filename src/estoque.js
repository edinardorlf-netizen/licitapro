// =====================================================================
// LicitaPro · leitura do estoque (PDV) e da planilha de produtos
// Formatos aceitos:
//  - PDF "Relação de Custo dos Itens" (PDV): código, descrição, saldo, custo médio, custo da última compra.
//    A página vem deitada; o texto "copiado" desalinha as colunas, então cada número é lido pela posição.
//  - PDF "Listagem de Produtos para Contagem do Estoque" (PDV): código, unidade, descrição, marca, grupo.
//  - Excel (.xlsx/.xlsm) ou CSV com cabeçalho (código, código planilha, descrição, unidade, custo, marca, categoria, saldo).
// Nunca adivinha: linha que não fecha com o formato vai para "não entendidas"; formato desconhecido = erro.
// =====================================================================

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_SRI = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

let carregandoPdf = null;
function carregarPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (carregandoPdf) return carregandoPdf;
  carregandoPdf = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = PDFJS_URL; s.integrity = PDFJS_SRI; s.crossOrigin = "anonymous";
    s.onload = () => {
      if (!window.pdfjsLib) return falha(new Error("Não foi possível abrir o leitor de PDF."));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      ok(window.pdfjsLib);
    };
    s.onerror = () => { carregandoPdf = null; falha(new Error("Não foi possível baixar o leitor de PDF. Confira a internet e tente de novo.")); };
    document.head.appendChild(s);
  });
  return carregandoPdf;
}

/** Páginas do PDF como listas de textos com posição: [{ itens: [{x, y, a, b, s}] }] */
export async function paginasPdf(buf) {
  const pdfjs = await carregarPdfjs();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();
    out.push({ itens: tc.items.filter((t) => t.str && t.str.trim()).map((t) => ({ x: t.transform[4], y: t.transform[5], a: t.transform[0], b: t.transform[1], s: t.str.trim() })) });
  }
  return out;
}

// ---------- utilidades ----------
export const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
/** Número no formato do PDV: "4.506,00" → 4506; "1.130" → 1130 (ponto é milhar); "-3" → -3 */
export function numBR(s) {
  if (s == null) return null;
  if (typeof s === "number") return isFinite(s) ? s : null;
  const t = String(s).trim().replace(/\s/g, "");
  if (!/^-?[\d.]*\d(,\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
const separarBarra = (m) => {
  const r = String(m || "").trim().match(/^(.*?)\s*(\d{8,14})$/);
  return r ? { marca: r[1].trim(), barra: r[2] } : { marca: String(m || "").trim(), barra: "" };
};

/** Junta textos em linhas: "linha" = eixo que muda de uma linha para outra (x se a página está deitada) */
function linhas(itens, deitada, tol = 2) {
  const L = [];
  const ord = [...itens].sort((p, q) => (deitada ? p.x - q.x : q.y - p.y));
  for (const it of ord) {
    const r = deitada ? it.x : it.y;
    let l = L.find((z) => Math.abs(z.r - r) < tol);
    if (!l) { l = { r, c: [] }; L.push(l); }
    // coluna: posição ao longo da linha (y na página deitada, x na normal)
    l.c.push({ k: deitada ? it.y : it.x, s: it.s });
  }
  L.forEach((l) => l.c.sort((p, q) => p.k - q.k));
  return L;
}

// ---------- PDF "Relação de Custo dos Itens" ----------
function lerRelacaoCusto(paginas) {
  const linhasOk = [], naoEntendidas = [];
  let ignoradas = 0, colunas = null;
  paginas.forEach((pg, ip) => {
    const deitada = pg.itens.filter((i) => i.a === 0 && i.b !== 0).length > pg.itens.length / 2;
    for (const l of linhas(pg.itens, deitada)) {
      const txt = l.c.map((c) => c.s).join(" ");
      // cabeçalho: guarda onde começa cada coluna
      if (/\bItem\b/.test(txt) && /Descri/.test(txt) && /Saldo/.test(txt)) {
        const k = (re) => { const c = l.c.find((x) => re.test(x.s)); return c ? c.k : null; };
        const saldo = k(/^Saldo$/), cm = k(/^Custo$/), cu = k(/^Custo Ult/i), tu = k(/^Total Ult/i), tc = l.c.filter((x) => /^Total$/.test(x.s)).map((x) => x.k).pop();
        if (saldo != null && cm != null && cu != null) colunas = { desc: saldo - 10, saldo: [saldo - 10, cm - 10], cm: [cm - 10, cu - 5], cu: [cu - 5, (tu || cu + 69) - 5], fim: tc };
        continue;
      }
      if (/^Custo\s+Compra|^M[ée]dio|P[áa]gina \d+ de \d+|Rela[çc][ãa]o de Custo|Agrupado por|A sele[çc][ãa]o inclui|Total Empresa/i.test(txt) || /feira,|s[áa]bado,|domingo,/i.test(txt)) { ignoradas++; continue; }
      if (!colunas) continue;
      const primeiro = l.c[0];
      const temCodigo = primeiro && primeiro.k < 40 && /^\d+$/.test(primeiro.s);
      if (!temCodigo) { ignoradas++; continue; } // nome da empresa/grupo e subtotais do grupo
      const em = (a, b) => l.c.filter((c) => c.k >= a && c.k < b);
      const desc = l.c.filter((c) => c.k >= 40 && c.k < colunas.desc).map((c) => c.s).join(" ").replace(/\s+/g, " ").trim();
      const v = (r) => { const c = em(r[0], r[1]); return c.length === 1 ? numBR(c[0].s) : null; };
      const saldo = v(colunas.saldo), cm = v(colunas.cm), cu = v(colunas.cu);
      const codigo = primeiro.s;
      if (!desc || saldo == null || cm == null || cu == null) {
        naoEntendidas.push({ pagina: ip + 1, texto: txt, motivo: !desc ? "sem descrição" : "números fora do lugar" });
        continue;
      }
      const custo = cm > 0 ? cm : cu > 0 ? cu : null; // regra da planilha: custo médio; zerado → última compra
      linhasOk.push({ codigo, nome: desc, saldo, custo, custo_medio: cm, custo_ultima: cu, pagina: ip + 1 });
    }
  });
  if (!colunas) throw new Error("Não achei o cabeçalho do relatório (Item · Descrição · Saldo · Custo). O layout do PDF mudou: nada foi gravado.");
  return { tipo: "custo", nome: "Relação de Custo dos Itens (saldo e custo)", linhas: linhasOk, naoEntendidas, ignoradas, temSaldo: true };
}

// ---------- PDF "Listagem de Produtos" (contagem do estoque, com marca) ----------
function lerListagemMarcas(paginas) {
  const linhasOk = [], naoEntendidas = [];
  let ignoradas = 0, grupo = "", col = null;
  paginas.forEach((pg, ip) => {
    const deitada = pg.itens.filter((i) => i.a === 0 && i.b !== 0).length > pg.itens.length / 2;
    for (const l of linhas(pg.itens, deitada, 3)) {
      const txt = l.c.map((c) => c.s).join(" ");
      const g = txt.match(/Grupo:\s*(.+)/);
      if (g) { grupo = g[1].trim(); continue; }
      if (/^COD\b/.test(txt) && /Descri/.test(txt) && /Marca/.test(txt)) {
        const k = (re) => { const c = l.c.find((x) => re.test(x.s)); return c ? c.k : null; };
        const un = k(/^UN$/), de = k(/^Descri/), ma = k(/^Marca$/), cb = k(/^C[óo]d\.?\s*Barra/i), ru = k(/^Rua$/);
        if (un != null && de != null && ma != null) col = { un: [un - 5, de - 3], de: [de - 3, ma - 5], ma: [ma - 5, (cb || ma + 130) - 8], ru: ru };
        continue;
      }
      const primeiro = l.c[0];
      if (!col || !primeiro || !(primeiro.k < 40 && /^\d+$/.test(primeiro.s))) { ignoradas++; continue; }
      const em = (r) => l.c.filter((c) => c.k >= r[0] && c.k < r[1]).map((c) => c.s).join(" ").replace(/\s+/g, " ").trim();
      const nome = em(col.de);
      if (!nome) { naoEntendidas.push({ pagina: ip + 1, texto: txt, motivo: "sem descrição" }); continue; }
      const { marca } = separarBarra(em(col.ma));
      linhasOk.push({ codigo: primeiro.s, unidade: em(col.un) || null, nome, marca: marca ? marca.toUpperCase() : null, categoria: grupo || null, pagina: ip + 1 });
    }
  });
  if (!col) throw new Error("Não achei o cabeçalho da listagem (COD · UN · Descrição · Marca). O layout do PDF mudou: nada foi gravado.");
  return { tipo: "marcas", nome: "Listagem de Produtos (unidade, marca e grupo)", linhas: linhasOk, naoEntendidas, ignoradas, temSaldo: false };
}

/** Decide o formato pelo texto da 1ª página e lê */
export function lerPaginasPdf(paginas) {
  if (!paginas.length) throw new Error("PDF vazio.");
  const texto = paginas.slice(0, 2).map((p) => p.itens.map((i) => i.s).join(" ")).join(" ");
  if (texto.replace(/\s/g, "").length < 50) throw new Error("Este PDF não tem texto (parece escaneado). Gere o relatório de novo pelo PDV ou exporte em Excel/CSV.");
  if (/Rela[çc][ãa]o de Custo dos Itens/i.test(texto)) return lerRelacaoCusto(paginas);
  if (/Listagem de Produtos/i.test(texto) || /Lista de Produtos para Contagem/i.test(texto)) return lerListagemMarcas(paginas);
  throw new Error("Não reconheci este relatório. Aceito o PDF \"Relação de Custo dos Itens\" ou \"Listagem de Produtos\" do PDV, ou uma planilha Excel/CSV com cabeçalho.");
}

// ---------- Excel / CSV ----------
const CAMPOS = [
  ["codigo_planilha", /^COD(IGO)?\.? ?PLANILHA$/],
  ["codigo", /^(COD|CODIGO|COD\.|COD\. ?ITEM|CODIGO DO (SISTEMA|ITEM|PRODUTO)|CODIGO SISTEMA|ITEM|REFERENCIA)$/],
  ["nome", /DESCRI|^PRODUTO$|^NOME/],
  ["unidade", /^(UN|UND|UNID|UNIDADE)\.?$/],
  ["custo", /CUSTO/],
  ["marca", /^MARCA/],
  ["categoria", /^(CATEGORIA|GRUPO)/],
  ["saldo", /SALDO|^ESTOQUE|^QTD|^QUANTIDADE/],
];
function mapaCabecalho(celulas) {
  const m = {};
  celulas.forEach((c, i) => {
    const t = normalizar(c).replace(/\(R\$\)/g, "").trim();
    if (!t) return;
    for (const [campo, re] of CAMPOS) {
      if (m[campo] != null) continue;
      if (campo === "codigo" && /PLANILHA/.test(t)) continue;
      if (campo === "custo" && /TOTAL/.test(t)) continue;
      if (re.test(t)) { m[campo] = i; break; }
    }
  });
  return m.nome != null && (m.codigo != null || m.codigo_planilha != null) ? m : null;
}
function lerTabela(rows, nomeArq) {
  let cab = -1, m = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) { m = mapaCabecalho(rows[i] || []); if (m) { cab = i; break; } }
  if (!m) throw new Error(`Não achei o cabeçalho em "${nomeArq}". A planilha precisa ter colunas de código e descrição.`);
  const linhasOk = [], naoEntendidas = [];
  let ignoradas = 0;
  const txt = (r, k) => (m[k] == null ? "" : String(r[m[k]] == null ? "" : r[m[k]]).trim());
  for (let i = cab + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const codigo = txt(r, "codigo").replace(/\.0+$/, ""), cp = txt(r, "codigo_planilha").toUpperCase(), nome = txt(r, "nome");
    if (!codigo && !cp && !nome) { ignoradas++; continue; }
    if (!nome || (!codigo && !cp)) { naoEntendidas.push({ pagina: i + 1, texto: r.filter((x) => x !== "" && x != null).join(" · "), motivo: !nome ? "sem descrição" : "sem código" }); continue; }
    const saldo = m.saldo == null ? undefined : numBR(r[m.saldo]);
    const custo = m.custo == null ? undefined : numBR(r[m.custo]);
    if (m.saldo != null && txt(r, "saldo") !== "" && saldo == null) { naoEntendidas.push({ pagina: i + 1, texto: `${codigo || cp} ${nome}`, motivo: `saldo "${txt(r, "saldo")}" não é número` }); continue; }
    linhasOk.push({ codigo: codigo || null, codigo_planilha: cp || null, nome, unidade: txt(r, "unidade") || null, marca: txt(r, "marca").toUpperCase() || null,
      categoria: txt(r, "categoria") || null, saldo: saldo == null ? (m.saldo == null ? undefined : null) : saldo, custo: custo == null || custo <= 0 ? null : custo, pagina: i + 1 });
  }
  const temSaldo = m.saldo != null;
  return { tipo: m.codigo_planilha != null ? "planilha" : "tabela", nome: m.codigo_planilha != null ? "Planilha de produtos (Sistema de Orçamentos)" : "Planilha de estoque", linhas: linhasOk, naoEntendidas, ignoradas, temSaldo };
}
const valorCelula = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if ("result" in v) return v.result == null ? "" : v.result;
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return v.text;
    return "";
  }
  return v;
};
export async function lerExcel(buf, nomeArq, carregarExcel) {
  const ExcelJS = await carregarExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let melhor = null;
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { const a = []; row.eachCell({ includeEmpty: true }, (c, col) => { a[col - 1] = valorCelula(c.value); }); rows[n - 1] = a; });
    try { const r = lerTabela(rows, nomeArq); if (!melhor || r.linhas.length > melhor.linhas.length) melhor = { ...r, aba: ws.name }; } catch (e) { /* aba sem cabeçalho */ }
  });
  if (!melhor) throw new Error(`Nenhuma aba de "${nomeArq}" tem colunas de código e descrição.`);
  return melhor;
}
export function lerCsv(texto, nomeArq) {
  const t = texto.replace(/^﻿/, "");
  const sep = (t.split("\n")[0].match(/;/g) || []).length >= (t.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cel = "", aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"' && t[i + 1] === '"') { cel += '"'; i++; } else if (ch === '"') aspas = false; else cel += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === sep) { row.push(cel); cel = ""; }
    else if (ch === "\n") { row.push(cel.replace(/\r$/, "")); rows.push(row); row = []; cel = ""; }
    else cel += ch;
  }
  if (cel || row.length) { row.push(cel); rows.push(row); }
  return lerTabela(rows, nomeArq);
}

// ---------- casar com os produtos e montar o que gravar ----------
function bigramas(s) { const t = normalizar(s).replace(/[^A-Z0-9]/g, ""); const b = new Set(); for (let i = 0; i < t.length - 1; i++) b.add(t.slice(i, i + 2)); return b; }
export function parecido(a, b) {
  const A = bigramas(a), B = bigramas(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((x) => { if (B.has(x)) n++; });
  return (2 * n) / (A.size + B.size);
}

/**
 * produtos: só os de origem planilha/pdv. Devolve o plano da importação (nada gravado ainda).
 * Ordem do casamento: código do sistema → código planilha → apelidos ("PDV:x" em chaves) → descrição igual
 * (normalizada) de produto que ainda não tem código do sistema. Nunca por semelhança.
 */
export function planejar(lido, produtos) {
  const porCod = new Map(), porCp = new Map(), porApelido = new Map(), porNomeSemCod = new Map();
  for (const p of produtos) {
    if (p.codigo) porCod.set(String(p.codigo), p);
    if (p.codigo_planilha) porCp.set(String(p.codigo_planilha).toUpperCase(), p);
    (p.chaves || []).forEach((k) => { const m = String(k).match(/^PDV:(.+)$/); if (m) porApelido.set(m[1], p); const q = String(k).match(/^P:(.+)$/); if (q && !porCp.has(q[1])) porCp.set(q[1], p); });
    if (!p.codigo) { const k = normalizar(p.nome); if (!porNomeSemCod.has(k)) porNomeSemCod.set(k, p); }
  }
  const usados = new Map(); // produto id → linha que casou
  const somaApelido = new Map();
  const atualizar = [], criar = [], duplicadasNoArquivo = [];
  const codigosNoArquivo = new Set();
  const mudancas = { marca: [], unidade: [], nome: [], custo: 0 };
  for (const l of lido.linhas) {
    if (l.codigo) codigosNoArquivo.add(String(l.codigo));
    let p = null, via = "";
    if (l.codigo && porCod.has(String(l.codigo))) { p = porCod.get(String(l.codigo)); via = "codigo"; }
    else if (l.codigo_planilha && porCp.has(l.codigo_planilha)) { p = porCp.get(l.codigo_planilha); via = "cp"; }
    else if (l.codigo && porApelido.has(String(l.codigo))) { p = porApelido.get(String(l.codigo)); via = "apelido"; }
    else { const k = normalizar(l.nome); if (porNomeSemCod.has(k) && !(l.codigo && porCod.has(String(l.codigo)))) { p = porNomeSemCod.get(k); via = "nome"; } }
    if (p && usados.has(p.id)) {
      if (via === "apelido" && lido.temSaldo) { // dois códigos do PDV juntados no mesmo produto: soma os saldos
        const a = atualizar.find((x) => x.id === p.id);
        if (a && l.saldo != null) a.saldo = (Number(a.saldo) || 0) + l.saldo;
        somaApelido.set(p.id, (somaApelido.get(p.id) || 1) + 1);
        continue;
      }
      if (via === "nome") p = null; // descrição repetida no arquivo: a segunda vira produto novo
      else { duplicadasNoArquivo.push(l); continue; }
    }
    if (!p) {
      if (!l.codigo && !l.codigo_planilha && !l.nome) continue;
      if (l.codigo_planilha && porCp.has(l.codigo_planilha)) { duplicadasNoArquivo.push(l); continue; }
      criar.push({ codigo: l.codigo || null, codigo_planilha: l.codigo_planilha || null, nome: l.nome, unidade: l.unidade || null, marca: l.marca || null,
        categoria: l.categoria || null, ...(l.saldo !== undefined ? { saldo: l.saldo } : {}), custo: l.custo || null, origem: lido.tipo === "planilha" ? "planilha" : "pdv" });
      continue;
    }
    usados.set(p.id, l);
    const a = { id: p.id };
    if (lido.temSaldo && l.saldo !== undefined) a.saldo = l.saldo;
    if (l.custo != null && l.custo > 0 && (p.custo_atual == null || Math.abs(Number(p.custo_atual) - l.custo) >= 0.005)) { a.custo = l.custo; mudancas.custo++; }
    if (l.marca && normalizar(l.marca) !== normalizar(p.marca)) { a.marca = l.marca; mudancas.marca.push({ p, de: p.marca, para: l.marca }); }
    // Unidade: só preenche quando o produto não tem; se for diferente (ex.: PAR × CX) só avisa, porque muda o sentido do preço
    if (l.unidade && !p.unidade) a.unidade = l.unidade;
    else if (l.unidade && normalizar(l.unidade) !== normalizar(p.unidade)) mudancas.unidade.push({ p, de: p.unidade, para: l.unidade });
    if (l.categoria && !p.categoria) a.categoria = l.categoria;
    // descrição cortada na planilha antiga (45 letras): completa com a do PDV
    const nP = String(p.nome || "").trim(), nL = String(l.nome || "").trim();
    if (nL.length > nP.length && normalizar(nL).startsWith(normalizar(nP)) && nP.length >= 10) { a.nome = nL.slice(0, 200); mudancas.nome.push({ p, de: nP, para: nL }); }
    if (via === "nome" && l.codigo && !p.codigo && !porCod.has(String(l.codigo))) a.codigo = String(l.codigo);
    if (Object.keys(a).length > 1) atualizar.push(a);
  }
  // Produtos que não vieram no arquivo (só faz sentido em relatório de saldo)
  const ausentes = lido.temSaldo
    ? produtos.filter((p) => !usados.has(p.id) && (p.codigo || p.codigo_planilha) && Number(p.saldo) > 0 && !(p.codigo && codigosNoArquivo.has(String(p.codigo))))
    : [];
  // Possíveis duplicados: produto novo com descrição muito parecida (não igual) com um que já existe
  const indice = new Map();
  for (const p of produtos) { const k = normalizar(p.nome).split(" ")[0]; if (!indice.has(k)) indice.set(k, []); indice.get(k).push(p); }
  const possiveis = [];
  for (const c of criar) {
    const k = normalizar(c.nome).split(" ")[0];
    let melhor = null, nota = 0;
    for (const p of indice.get(k) || []) {
      if (normalizar(p.nome) === normalizar(c.nome) && p.codigo) { const s = 0.99; if (s > nota) { nota = s; melhor = p; } continue; }
      const s = parecido(c.nome, p.nome);
      if (s > nota) { nota = s; melhor = p; }
    }
    if (melhor && nota >= 0.88) possiveis.push({ novo: c, existente: { id: melhor.id, nome: melhor.nome, codigo: melhor.codigo, codigo_planilha: melhor.codigo_planilha }, nota: Math.round(nota * 100) });
  }
  const semCusto = criar.filter((c) => !c.custo).length;
  return { atualizar, criar, ausentes, possiveis, mudancas, duplicadasNoArquivo, semCusto, somaApelido: somaApelido.size };
}
