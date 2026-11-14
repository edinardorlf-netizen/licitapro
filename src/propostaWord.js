// =====================================================================
// LicitaPro · proposta em Word (.docx)
//
// "PROPOSTA" (todos os itens cotados) e "PROPOSTA AJUSTADA" (só os itens
// vencidos, com o valor final). O layout é o Word da própria empresa,
// guardado no banco (tabela modelos_documentos) com marcadores {{...}}:
// nada de layout nem dado pessoal fica no código, que é público.
// Os dados da empresa e do representante vêm de empresa_proposta.
// =====================================================================
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { sb } from "./util.js";

// Marcadores obrigatórios para um arquivo valer como modelo
export const MARCADORES_OBRIGATORIOS = ["{{TITULO}}", "{{ORGAO}}", "{{PREGAO}}", "{{TOTAL}}", "{{I_NUM}}", "{{I_DESC}}", "{{I_VU}}", "{{I_VT}}"];

// Colunas que podem ser acrescentadas (desligadas por padrão). Item, Descrição,
// Quantidade, Unidade, Valor unitário, Valor total e Marca aparecem sempre.
export const COLUNAS_OPCIONAIS = [
  { k: "anvisa", t: "Registro ANVISA", cab: "Anvisa", marcador: "{{I_ANVISA}}" },
  { k: "obs", t: "Observações", cab: "Observações", marcador: "{{I_OBS}}" },
];

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const dataPorExtenso = (d = new Date()) => `${String(d.getDate()).padStart(2, "0")} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

const fmt = (v, min = 2, max = 2) => (v == null || v === "" || isNaN(Number(v)) ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max }));
export const moeda = (v) => fmt(v, 2, 2);
const moedaUnit = (v) => fmt(v, 2, 4);
const c2 = (v) => Math.round(Number(v) * 100) / 100;

// ---------- valor por extenso (reais e centavos) ----------
const UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(CT[c]);
  if (r) p.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? " e " + UN[r % 10] : ""));
  return p.join(" e ");
}
function inteiroPorExtenso(n) {
  if (n === 0) return "zero";
  const grupos = [];
  let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const nomes = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let t = i === 1 && g === 1 ? "mil" : ate999(g) + (i ? " " + nomes[i][g === 1 ? 0 : 1] : "");
    partes.push({ t, g, i });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e duzentos, dois mil e cinquenta)
  return partes.map((p, k) => {
    if (k === 0) return p.t;
    const ultimo = k === partes.length - 1;
    const usaE = ultimo && (p.g < 100 || p.g % 100 === 0);
    return (usaE ? " e " : " ") + p.t;
  }).join("");
}
export function valorPorExtenso(v) {
  const total = Math.round(Number(v || 0) * 100);
  const reais = Math.floor(total / 100), cent = total % 100;
  const partes = [];
  if (reais) {
    const t = inteiroPorExtenso(reais);
    const de = reais >= 1000000 && reais % 1000000 === 0 ? " de" : "";
    partes.push(`${t}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  const s = partes.join(" e ") || "zero reais";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const diasPorExtenso = (d) => `${d} (${inteiroPorExtenso(Number(d))}) dias`;

// ---------- leitura do modelo e dos dados ----------
const b64ParaBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const bytesParaB64 = (u8) => { let s = ""; const passo = 0x8000; for (let i = 0; i < u8.length; i += passo) s += String.fromCharCode.apply(null, u8.subarray(i, i + passo)); return btoa(s); };

export async function carregarModelo(empresaId) {
  const { data, error } = await sb.from("modelos_documentos").select("arquivo,nome,atualizado_em").eq("empresa_id", empresaId).eq("tipo", "proposta").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("O modelo Word da proposta ainda não foi enviado. Peça ao administrador para enviar em “Modelo da proposta”.");
  return b64ParaBytes(data.arquivo);
}
export async function carregarDadosEmpresa(empresaId) {
  const { data, error } = await sb.from("empresa_proposta").select("dados").eq("empresa_id", empresaId).maybeSingle();
  if (error) throw error;
  return (data && data.dados) || {};
}

// Confere um .docx enviado como modelo: devolve os marcadores que faltam
export function conferirModelo(u8) {
  let doc;
  try { doc = strFromU8(unzipSync(u8)["word/document.xml"]); } catch { return { ok: false, faltam: ["arquivo não é um Word (.docx)"] }; }
  const texto = doc.replace(/<[^>]+>/g, "");
  const faltam = MARCADORES_OBRIGATORIOS.filter((m) => !texto.includes(m));
  return { ok: !faltam.length, faltam };
}

// ---------- montagem ----------
const SEM_PREFIXO = (n) => String(n || "").replace(/^\s*(PE|preg[aã]o( eletr[oô]nico)?)\s*(n[º°o.]*)?\s*/i, "").trim();

export function camposPadrao(p, emp) {
  let orgao = String(p.orgao || "").toUpperCase().trim();
  const mun = String(p.municipio || "").toUpperCase().trim();
  if (mun && !orgao.includes(mun)) orgao = `${orgao} – ${mun}`;
  if (!/\bMG\s*$/.test(orgao)) orgao += " - MG";
  const dias = Number(p.validade_dias) || Number(emp.validade_dias) || 60;
  return {
    orgao,
    pregao: SEM_PREFIXO(p.numero),
    processo: p.numero_processo || "",
    srp: /registro\s+de\s+pre/i.test(p.objeto || "") || /\bRP\b|SRP/.test(p.modalidade || ""),
    validade: diasPorExtenso(dias),
    data: dataPorExtenso(new Date()),
  };
}

// Itens da PROPOSTA (todos os cotados) a partir de "itens"
export const itensDaProposta = (itens) => itens
  .filter((i) => i.participar && i.preco_unit != null)
  .map((i) => ({ numero: i.numero, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, vu: Number(i.preco_unit), vt: i.preco_total != null ? Number(i.preco_total) : c2(Number(i.preco_unit) * Number(i.quantidade || 0)), marca: i.marca, anvisa: i.anvisa, obs: i.obs }));

// Itens da PROPOSTA AJUSTADA (só vencidos, valor final) a partir de itens_ganhos
export const itensDaAjustada = (ganhos, itens) => ganhos.map((g) => {
  const it = itens.find((x) => (g.item_id && x.id === g.item_id) || String(x.numero) === String(g.numero)) || {};
  const vu = Number(g.valor_unitario);
  return { numero: g.numero, descricao: g.descricao || it.descricao, quantidade: g.quantidade, unidade: g.unidade || it.unidade, vu, vt: c2(vu * Number(g.quantidade || 0)), marca: g.marca || it.marca, anvisa: it.anvisa, obs: g.obs || it.obs };
});

const ordenar = (l) => [...l].sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0) || String(a.numero).localeCompare(String(b.numero)));

// Mexe nas colunas da tabela: tira as opcionais desligadas e acrescenta as ligadas que o modelo não tem
function ajustarColunas(tbl, opcoes) {
  const linhas = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
  const cel = (tr) => [...tr.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
  const cab = cel(linhas[0]).map((c) => c.replace(/<[^>]+>/g, "").trim().toLowerCase());
  let grid = [...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  const iDesc = cab.findIndex((t) => t.startsWith("descri"));
  const iMarca = cab.findIndex((t) => t.startsWith("marca"));
  let novasLinhas = linhas.map(cel);
  const largura = (c, w) => c.replace(/<w:tcW w:w="\d+"/, `<w:tcW w:w="${w}"`);

  // tira colunas opcionais desligadas (ou que o modelo tem a mais)
  for (const op of COLUNAS_OPCIONAIS) {
    const idx = cab.findIndex((t) => t.startsWith(op.cab.toLowerCase().slice(0, 5)));
    if (idx >= 0 && !opcoes[op.k]) {
      grid[iDesc] += grid[idx];
      grid.splice(idx, 1); cab.splice(idx, 1);
      novasLinhas = novasLinhas.map((cs) => { const n = [...cs]; n.splice(idx, 1); return n; });
    }
  }
  // acrescenta as ligadas que faltam (copiando a coluna Marca)
  for (const op of COLUNAS_OPCIONAIS) {
    if (!opcoes[op.k] || cab.some((t) => t.startsWith(op.cab.toLowerCase().slice(0, 5)))) continue;
    const base = iMarca >= 0 ? cab.findIndex((t) => t.startsWith("marca")) : cab.length - 1;
    const w = Math.min(1600, Math.max(900, grid[iDesc] - 3000));
    grid[iDesc] -= w;
    const pos = cab.length;
    grid.splice(pos, 0, w); cab.splice(pos, 0, op.cab.toLowerCase());
    novasLinhas = novasLinhas.map((cs, li) => {
      const c0 = cs[base];
      const txt = li === 0 ? op.cab : (c0.includes("{{I_MARCA}}") ? op.marcador : "");
      // o 1º texto da célula copiada vira o novo; os demais ficam vazios
      let primeiro = true;
      const c = c0.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, t, b) => { if (primeiro) { primeiro = false; return a + esc(txt) + b; } return a + b; });
      const n = [...cs]; n.splice(pos, 0, c); return n;
    });
  }
  novasLinhas = novasLinhas.map((cs) => cs.map((c, i) => largura(c, grid[i])));
  let out = tbl.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`);
  linhas.forEach((tr, li) => {
    const antes = cel(tr);
    let novo = tr;
    // troca o bloco de células inteiro
    const ini = novo.indexOf(antes[0]);
    const fimCel = antes[antes.length - 1];
    const fim = novo.lastIndexOf(fimCel) + fimCel.length;
    novo = novo.slice(0, ini) + novasLinhas[li].join("") + novo.slice(fim);
    out = out.replace(tr, () => novo);
  });
  return out;
}

/**
 * Gera o .docx.
 * @param tipo "inicial" | "ajustada"
 * @param campos { orgao, pregao, processo, srp, validade, data }
 * @param itens [{ numero, descricao, quantidade, unidade, vu, vt, marca, anvisa, obs }]
 * @param opcoes { anvisa: bool, obs: bool }
 */
export function montarProposta({ modelo, emp, tipo, campos, itens, opcoes }) {
  const z = unzipSync(modelo);
  let doc = strFromU8(z["word/document.xml"]);
  const lista = ordenar(itens);
  const total = c2(lista.reduce((a, i) => a + (Number(i.vt) || 0), 0));

  // tabela de itens
  const tIni = doc.indexOf("<w:tbl>");
  const tFim = doc.indexOf("</w:tbl>", tIni) + "</w:tbl>".length;
  if (tIni < 0) throw new Error("O modelo não tem a tabela de itens.");
  let tbl = ajustarColunas(doc.slice(tIni, tFim), opcoes || {});
  const molde = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]).find((tr) => tr.includes("{{I_NUM}}"));
  if (!molde) throw new Error("O modelo não tem a linha de item ({{I_NUM}}).");
  const linhasItens = lista.map((i) => {
    const val = {
      I_NUM: i.numero, I_DESC: String(i.descricao || "").replace(/\s+/g, " ").trim(), I_QTD: fmt(i.quantidade, 2, 2), I_UNID: String(i.unidade || "").toUpperCase(),
      I_VU: i.vu != null ? `R$ ${moedaUnit(i.vu)}` : "", I_VT: i.vt != null ? `R$ ${moeda(i.vt)}` : "",
      I_MARCA: i.marca || "", I_ANVISA: i.anvisa || "", I_OBS: i.obs || "",
    };
    return molde.replace(/\{\{(I_[A-Z]+)\}\}/g, (m, k) => esc(val[k] != null ? val[k] : ""));
  }).join("");
  tbl = tbl.replace(molde, () => linhasItens);
  doc = doc.slice(0, tIni) + tbl + doc.slice(tFim);

  const proc = String(campos.processo || "").trim();
  const v = {
    TITULO: tipo === "ajustada" ? "PROPOSTA AJUSTADA" : "PROPOSTA",
    ORGAO: campos.orgao,
    PREGAO: campos.pregao,
    PROCESSO: proc || "____/____",
    SRP: campos.srp ? " - REGISTRO DE PREÇOS" : "",
    EMPRESA: emp.razao || "",
    EMPRESA_ASSINATURA: emp.razao_assinatura || emp.razao || "",
    CNPJ: emp.cnpj || "",
    ENDERECO: emp.endereco || "",
    TOTAL: moeda(total),
    TOTAL_EXTENSO: valorPorExtenso(total),
    BANCO: emp.banco || "",
    REPRESENTANTE: emp.representante || "",
    REPRESENTANTE_MAIUSC: String(emp.representante || "").toUpperCase(),
    RG: emp.rg || "",
    CPF: emp.cpf || "",
    CARGO: emp.cargo || "",
    EMAIL: emp.email || "",
    VALIDADE: campos.validade,
    CIDADE: emp.cidade || "",
    DATA: campos.data,
  };
  doc = doc.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in v ? esc(v[k]) : m.startsWith("{{I_") ? "" : m));
  // linhas copiadas repetiriam os ids de parágrafo (o Word exige ids únicos): os ids são opcionais, então saem
  doc = doc.replace(/ w14:(paraId|textId)="[0-9A-Fa-f]+"/g, "");
  z["word/document.xml"] = strToU8(doc);
  const rels = "word/_rels/document.xml.rels";
  if (z[rels]) z[rels] = strToU8(strFromU8(z[rels]).replace("{{EMAIL}}", esc(emp.email || "")));
  return { bytes: zipSync(z, { level: 6 }), total, qtd: lista.length };
}

export const nomeArquivoProposta = (p, tipo) => {
  const n = SEM_PREFIXO(p.numero).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 40) || "processo";
  const mun = String(p.municipio || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30);
  return `${tipo === "ajustada" ? "Proposta_Ajustada" : "Proposta"}_PE_${n}${mun ? "_" + mun : ""}.docx`;
};

export function baixarDocx(bytes, nome) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
