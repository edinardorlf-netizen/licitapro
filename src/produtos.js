// =====================================================================
// LicitaPro · agrupamento de itens parecidos (catálogo de produtos)
//
// Órgãos diferentes descrevem o mesmo produto de jeitos diferentes
// ("LUVA DE PROCEDIMENTO TAMANHO M, LÁTEX…", "Luva de procedimento tamanho P,
// não estéril…"). Aqui cada descrição vira uma "chave" curta:
//   - nome do produto: as 2 primeiras palavras que importam (sem "de", "para",
//     tamanhos P/M/G etc.), escritas só com consoantes e números, para que
//     acentos quebrados ("L?TEX", "ESP?CULO") não separem o que é igual;
//   - medidas e dosagens (500MG, 10ML, 0,9%, 25X7, 1L…), que separam o que
//     é diferente (dipirona 500 mg ≠ dipirona 1 g).
// Itens com a mesma chave caem no mesmo produto. É uma regra simples: o app
// deixa juntar e separar à mão, e o que foi ajustado à mão nunca é desfeito.
// =====================================================================

const PARADAS = new Set(("DE DA DO DAS DOS E EM NO NA NOS NAS PARA P POR COM C S SEM A O AS OS AO UM UMA TIPO TAM TAMANHO N NO NR NUMERO " +
  "UND UN UNID UNIDADE UNIDADES CX CAIXA CAIXAS PCT PACOTE PACOTES PC PECA FR FRASCO AMP AMPOLA KIT REF MARCA REFERENCIA " +
  "ITEM LOTE COR MEDINDO MEDIDA APROXIMADAMENTE APROX CONFECCIONADO CONFECCIONADA CONFECCIONADOS EMBALAGEM EMBALADO EMBALADA " +
  "DESCARTAVEL DESCARTAVEIS ESTERIL ESTEREIS NAO USO UNICO ADULTO INFANTIL PEDIATRICO DOSAGEM CONCENTRACAO APRESENTACAO " +
  "PP GG XG XGG EG EXG ML MG MCG GR KG LT CM MM MT UI").split(" "));
// Unidades que, junto do número, formam uma medida ou dosagem
const UNIDADES = "MG|MCG|G|GR|KG|ML|L|LT|LITRO|LITROS|CM|MM|M|MT|MTS|UI|VOLUMES|VOL|FIOS|FR|%";
const RE_MEDIDA = new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(?:(${UNIDADES})(?:\s*\/\s*(ML|G|L|DOSE|GOTA))?\b|%|\s*X\s*(\d+(?:[.,]\d+)?))`, "g");

const SINONIMOS = [
  [/\bGASE\b/g, "GAZE"], [/\bPVPI\b|\bPOLVIDINE\b|\bPOVIDONA\b|\bIODOPOVIDONA\b/g, "IODOPOLIVIDONA"],
  [/\bSORO FISIOLOGICO\b/g, "CLORETO SODIO"], [/\bJELCO\b/g, "CATETER INTRAVENOSO"], [/\bSCALP\b/g, "ESCALP"],
  [/\bCREPOM\b/g, "CREPON"], [/\bMICROPORE\b/g, "FITA MICROPOROSA"], [/\bESPARADRAPO\b/g, "ESPARADRAPO"],
];

export const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const esqueleto = (w) => (/^\d/.test(w) ? w : w[0] + w.slice(1).replace(/[AEIOUY?]/g, "")); // mantém a 1ª letra
const PARADAS_ESQ = new Set([...PARADAS].map(esqueleto));
const parada = (w) => PARADAS.has(w) || (w.includes("?") && PARADAS_ESQ.has(esqueleto(w))); // "DESCART?VEL" = "DESCARTAVEL"

/** Parte inicial da descrição (o nome do produto), sem a repetição "LUVA - LUVA …". */
function cabeca(desc) {
  let t = semAcento(desc).toUpperCase().replace(/[\t\r\n]+/g, " ").replace(/\s*\(?\s*POR\s*CENTO\s*\)?/g, "%");
  t = t.replace(/^\s*([A-Z?]{3,})\s*[-–:]\s*(?=\1\b)/, ""); // "LUVA - LUVA CIRURGICA" → "LUVA CIRURGICA"
  const corte = t.search(/\.\s|[;:]|\s[-–]\s|,\s|\(/);
  const h = corte > 6 ? t.slice(0, Math.min(corte, 90)) : t.slice(0, 80);
  return { h, resto: t.slice(0, 220) };
}
// Embalagem: preço de caixa/pacote não pode entrar na média junto com preço de unidade
function embalagem(unidade) {
  const u = semAcento(unidade).toUpperCase().replace(/[^A-Z]/g, "");
  if (/^(CX|CXA|CAIXA|CAIXAS)$/.test(u)) return "EMB-CX";
  if (/^(PCT|PC|PAC|PACOTE|PACOTES|FARDO|FD)$/.test(u)) return "EMB-PCT";
  if (/^(GL|GALAO|BB|BOMBONA)$/.test(u)) return "EMB-GL";
  return null;
}
const numX = (s) => { let v = Number(s.replace(",", ".")); if (/[.,]/.test(s) && v < 2) v = Math.round(v * 10); return String(v); }; // 25X0,7 = 25X7

function medidas(txt) {
  const out = new Set();
  let m;
  RE_MEDIDA.lastIndex = 0;
  while ((m = RE_MEDIDA.exec(txt))) {
    let n = m[1].replace(",", ".").replace(/\.0+$/, "").replace(/^0+(\d)/, "$1");
    if (m[4]) out.add(`${numX(m[1])}X${numX(m[4])}`);
    else {
      let u = (m[2] || "%").replace(/^(GR)$/, "G").replace(/^(LT|LITRO|LITROS)$/, "L").replace(/^(MT|MTS)$/, "M").replace(/^VOL$/, "VOLUMES");
      if (u === "ML" && !m[3] && Number(n) >= 1000 && Number(n) % 1000 === 0) { n = String(Number(n) / 1000); u = "L"; }
      if (u === "G" && !m[3] && Number(n) >= 1000 && Number(n) % 1000 === 0) { n = String(Number(n) / 1000); u = "KG"; }
      if (m[3]) u += "/" + m[3];
      out.add(n + u);
    }
  }
  return [...out].sort();
}

/** { chave, nome } de uma descrição de item. */
export function chaveProduto(desc, unidade) {
  const { h, resto } = cabeca(desc);
  let base = h;
  SINONIMOS.forEach(([re, s]) => (base = base.replace(re, s)));
  // "com agulha" / "sem agulha" separa produtos (ex.: seringas)
  const marcas = [];
  base = base.replace(/\b(COM|C\/|SEM|S\/)\s*AGULHA\b/g, (_, c) => { marcas.push(/^S/.test(c) ? "SEMAGULHA" : "COMAGULHA"); return " "; });
  const palavras = base.replace(RE_MEDIDA, " ").replace(/[^A-Z0-9? ]+/g, " ").split(/\s+/)
    .filter((w) => w && !parada(w) && !/^\d/.test(w) && w.replace(/\?/g, "").length > 1);
  const med = medidas(h);
  // volume que aparece mais adiante ("…sistema fechado, contendo 250 ml") separa soros, frascos etc.
  // volume e concentração que aparecem mais adiante ("soro fisiológico, (cloreto de sódio 0,9%), … 250 ml")
  [/^\d+(\.\d+)?(ML|L)$/, /^\d+(\.\d+)?%$/].forEach((re) => {
    if (med.some((d) => re.test(d))) return;
    const achados = medidas(resto).filter((d) => re.test(d));
    if (achados.length === 1) med.push(achados[0]);
  });
  med.sort();
  const emb = embalagem(unidade);
  if (emb) marcas.push(emb);
  // medicamento (tem concentração: mg, mcg, UI, mg/ml…): o nome do princípio ativo basta
  const remedio = med.some((d) => /\/|MG$|MCG$|UI$/.test(d));
  const nucleo = palavras.slice(0, remedio ? 1 : 2).map(esqueleto);
  const doses = [...med, ...new Set(marcas)];
  const chave = [nucleo.join(" ") || "SEM NOME", ...doses].join("|");
  const nomeBase = [...new Set(palavras.slice(0, 4))].join(" ").replace(/\?/g, "");
  const NOMES = { COMAGULHA: "com agulha", SEMAGULHA: "sem agulha", "EMB-CX": "(caixa)", "EMB-PCT": "(pacote)", "EMB-GL": "(galão)" };
  const extra = doses.map((d) => NOMES[d] || d.toLowerCase()).join(" ");
  const nome = [nomeBase.charAt(0) + nomeBase.slice(1).toLowerCase(), extra].filter(Boolean).join(" ");
  return { chave, nome: nome || String(desc || "Produto").slice(0, 60) };
}

/** Agrupa listas de itens e itens ganhos pela chave. Devolve [{ chave, nome, unidade, itens:[ids], ganhos:[ids] }]. */
export function agrupar(itens = [], ganhos = []) {
  const g = new Map();
  const pega = (desc, unidade) => {
    const k = chaveProduto(desc, unidade);
    if (!g.has(k.chave)) g.set(k.chave, { chave: k.chave, nome: k.nome, unidades: {}, itens: [], ganhos: [] });
    return g.get(k.chave);
  };
  itens.forEach((i) => { const x = pega(i.descricao, i.unidade); x.itens.push(i.id); if (i.unidade) x.unidades[i.unidade.toUpperCase()] = (x.unidades[i.unidade.toUpperCase()] || 0) + 1; });
  ganhos.forEach((i) => { const x = pega(i.descricao, i.unidade); x.ganhos.push(i.id); if (i.unidade) x.unidades[i.unidade.toUpperCase()] = (x.unidades[i.unidade.toUpperCase()] || 0) + 1; });
  return [...g.values()].map((x) => ({ chave: x.chave, nome: x.nome, unidade: Object.entries(x.unidades).sort((a, b) => b[1] - a[1])[0]?.[0] || null, itens: x.itens, ganhos: x.ganhos }));
}

/** Acha o produto de uma descrição num mapa chave → produto. */
export function produtoDe(desc, porChave, unidade) {
  return porChave.get(chaveProduto(desc, unidade).chave) || null;
}

/** Dias desde uma data (para avisar custo desatualizado). */
export const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
export const DIAS_CUSTO_VELHO = 10;

/** Markup = (preço de venda − custo) ÷ custo, em %. */
export const markup = (venda, custo) => (venda != null && custo != null && Number(custo) > 0 ? ((Number(venda) - Number(custo)) / Number(custo)) * 100 : null);
