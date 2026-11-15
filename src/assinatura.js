// =====================================================================
// LicitaPro · leitor de características dos itens (unificação de produtos)
//
// Cada edital escreve o mesmo produto de um jeito. Aqui a descrição vira
// características comparáveis:
//   remédio  → princípio(s) ativo(s) (sem sal: cloridrato, sódica…, com nomes
//              comerciais trocados pelo genérico), concentração convertida
//              (1 g = 1000 mg; 2% = 20 mg/ml; 20 mg/2 ml = 10 mg/ml; 1 g em 2 ml = 500 mg/ml),
//              forma (injetável, oral líquido, oral sólido, uso tópico) e volume;
//   material → nome (1ª palavra), medidas (25x8, 10 ml…), número/calibre (nº 14),
//              tamanho (P/M/G, 6,5) e embalagem (caixa, pacote) com a quantidade.
// Dois itens com a mesma "base" e sem conflito (forma, volume, quantidade na
// embalagem, preço) são candidatos a ser o mesmo produto.
// =====================================================================
import { semAcento, chaveProduto, tamanho, embalagemDe } from "./produtos.js";

const esq = (w) => (/^\d/.test(w) ? w : w[0] + w.slice(1).replace(/[AEIOUY?]/g, ""));

// Nome comercial / grafia → genérico (aplicado ao texto já sem acento e em maiúsculas)
const SINONIMOS = [
  [/\bBUSCOPAN\s+COMPOSTO\b/g, "ESCOPOLAMINA DIPIRONA"], [/\bBUSCOPAN\b/g, "ESCOPOLAMINA"], [/\bESCOPALAMINA\b/g, "ESCOPOLAMINA"],
  [/\bPROFENID\b/g, "CETOPROFENO"], [/\bDOLANTINA\b/g, "PETIDINA"], [/\bMEPERIDINA\b/g, "PETIDINA"],
  [/\bNOVALGINA\b/g, "DIPIRONA"], [/\bDECADRON\b/g, "DEXAMETASONA"], [/\bPLASIL\b/g, "METOCLOPRAMIDA"],
  [/\bFENERGAN\b/g, "PROMETAZINA"], [/\bHALDOL\b/g, "HALOPERIDOL"], [/\bGARDENAL\b/g, "FENOBARBITAL"],
  [/\bXYLOCAINA\b/g, "LIDOCAINA"], [/\bBENZETACIL\b/g, "BENZILPENICILINA"], [/\bVOLTAREN\b/g, "DICLOFENACO"],
  [/\bHIDROCORTIZONA\b/g, "HIDROCORTISONA"], [/\bTENOXICAN\b/g, "TENOXICAM"], [/\bSUCCINIL(COLINA)?\b/g, "SUXAMETONIO"],
  [/\bNORADRENALINA\b/g, "NOREPINEFRINA"], [/\bADRENALINA\b/g, "EPINEFRINA"],
  [/\bVITAMINA\s*C\b/g, "ACIDO ASCORBICO"], [/\bVITAMINA\s*K1?\b/g, "FITOMENADIONA"], [/\bVITAMINA\s*B\s*-?\s*12\b/g, "CIANOCOBALAMINA"],
  [/\bVITAMINA\s*B\s*-?\s*1\b/g, "TIAMINA"], [/\bVITAMINA\s*B\s*-?\s*6\b/g, "PIRIDOXINA"],
  [/\bPVPI\b|\bPOLVIDINE\b|\bPOVIDONA\b|\bIODOPOVIDONA\b/g, "IODOPOLIVIDONA"], [/\bSORO\s+FISIOLOGICO\b/g, "CLORETO SODIO"],
  [/\bSORO\s+GLICOSADO\b/g, "GLICOSE"], [/\bSORO\s+GLICOFISIOLOGICO\b|\bSOLUCAO\s+GLICOFISIOLOGICA\b/g, "GLICOSE CLORETO SODIO"],
  [/\bJELCO\b/g, "CATETER INTRAVENOSO"], [/\bSCALP\b/g, "ESCALP"], [/\bGASE\b/g, "GAZE"], [/\bMICROPORE\b/g, "FITA MICROPOROSA"],
  [/\bAGUA\s+OXIGENADA\b/g, "PEROXIDO HIDROGENIO"], [/\bCREPOM\b/g, "CREPON"],
];

// Sais e complementos que não mudam o produto para a comparação
const SAIS = new Set("CLORIDRATO BROMIDRATO BUTILBROMETO BROMETO MALEATO SODICA SODICO POTASSICA POTASSICO CALCICA CALCICO DISSODICO DISSODICA MONOIDRATADO MONOIDRATADA DIIDRATADO TRIIDRATADO ANIDRO ANIDRA SUCCINATO FOSFATO ACETATO DECANOATO SULFATO HEXACETONIDA TRIFOSFATO LACTATO".split(" "));
// Palavras que não são o princípio ativo (forma, via, embalagem, palavras de formulário)
const NAO_ATIVO = new Set(("DE DA DO DAS DOS E EM NO NA COM SEM PARA POR A O AO AS OS C S " +
  "INJETAVEL INJETAVEIS INJ SOLUCAO SOL SOLUCOES SUSPENSAO SUSP ORAL COMPRIMIDO COMPRIMIDOS COMP CPR CP CAPSULA CAPSULAS CAPS DRAGEA PO LIOFILIZADO LIOFILO " +
  "AMPOLA AMPOLAS AMP FRASCO FRASCOS FR FRASCO-AMPOLA FAM BOLSA BOLSAS CREME POMADA GEL XAROPE GOTAS GOTA ELIXIR EMULSAO TOPICO TOPICA USO USOS " +
  "DOSAGEM CONCENTRACAO COMPOSICAO SAL INDICACAO APRESENTACAO IM EV IV SC VIA ENDOVENOSA ENDOVENOSO INTRAMUSCULAR INTRAVENOSA INTRAVENOSO SUBCUTANEA " +
  "SIMPLES VAGINAL DERMATOLOGICO DERMATOLOGICA BISNAGA TUBO COMPOSTO COMPOSTA INFANTIL ADULTO PEDIATRICO ASSOCIADO ASSOCIADA DILUENTE DILUICAO " +
  "AQUOSA AQUOSO ESTERIL ESTEREIS DESCARTAVEL CAIXA CX UNIDADE UNIDADES UN UND EMBALAGEM EMBALADO EMBALADA INDIVIDUALMENTE MEDICAMENTO GENERICO REFERENCIA SIMILAR " +
  "ANESTESICO ANESTESICOS LOCAL ODONTOLOGICO ODONTOLOGICA TUBETE TUBETES CARPULE " +
  "MG MCG ML UI G L GR").split(" "));

const FORMAS = [
  ["INJ", /\b(INJETAVE(L|IS)|INJ|AMPOLAS?|AMP|FRASCO-AMPOLA|FRASCO AMPOLA|FAM|ENDOVENOS[AO]|INTRAMUSCULAR|INTRAVENOS[AO]|EV|IM|IV|LIOFILIZADO|LIOFILO)\b/],
  ["ORAL-LIQ", /\b(SOLUCAO ORAL|SUSPENSAO ORAL|SUSPENSAO|GOTAS|XAROPE|ELIXIR|SOL ORAL|SUSP ORAL)\b/],
  ["ORAL-SOL", /\b(COMPRIMIDOS?|COMP|CPR|CP|CAPSULAS?|CAPS|DRAGEAS?)\b/],
  ["TOP", /\b(CREME|POMADA|GEL|BISNAGA|DERMATOLOGIC[AO]|VAGINAL|TOPIC[AO]|LOCAO|DEGERMANTE)\b/],
];
const formaDe = (t, unidade) => {
  for (const [f, re] of FORMAS) if (re.test(t)) return f;
  const u = semAcento(unidade).toUpperCase().replace(/[^A-Z]/g, "");
  if (/^(AMP|AMPOLA|FAM|FA)$/.test(u)) return "INJ";
  if (/^(CPR|COMP|CP|CAPS|CAP)$/.test(u)) return "ORAL-SOL";
  if (/^(TUB|BISNAGA|BG)$/.test(u)) return "TOP";
  return null;
};

// "1.200.000" → 1200000; "0,4" → 0.4; "70,52" → 70.52
const numero = (s) => (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(",", ".")));
const fmt = (v) => String(Number(v.toPrecision(4)));
const paraMg = (v, u) => (u === "MCG" ? v / 1000 : u === "G" || u === "GR" ? v * 1000 : v);

/** Texto normalizado e só a parte que descreve o item (sem a repetição do Compras.gov). */
function texto(desc) {
  let t = String(desc || "").replace(/([a-z]{3})(\d)/g, "$1 $2").replace(/([a-z]{2})([A-Z][a-z]{2})/g, "$1 $2");
  t = semAcento(t).toUpperCase().replace(/[\t\r\n]+/g, " ").replace(/\s*\(?\s*POR\s*CENTO\s*\)?/g, "%").replace(/\s+/g, " ").trim();
  t = t.replace(/^\s*([A-Z?]{3,})\s*[-–:]\s*(?=\1\b)/, "");
  const corte = t.slice(20).search(/\.\s|:\s|:$/);
  if (corte >= 0) t = t.slice(0, 20 + corte);
  t = t.slice(0, 240);
  SINONIMOS.forEach(([re, s]) => (t = t.replace(re, s)));
  return t;
}

const RE_DOSE = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(MCG|MG|UI|GR|G|ML|L|%)(?![A-Z])(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ML|G|L)(?![A-Z]))?/g;

/** Doses de um remédio: concentrações (por ml ou por g), quantidades, volume e peso. */
function doses(t, forma, unidade) {
  const conc = new Set(), qtd = [], vols = [];
  let peso = null, m;
  RE_DOSE.lastIndex = 0;
  const achados = [];
  while ((m = RE_DOSE.exec(t))) achados.push({ v: numero(m[1]), u: m[2] === "GR" ? "G" : m[2], por: m[4] || null, porN: m[3] ? numero(m[3]) : 1, i: m.index, fim: RE_DOSE.lastIndex });
  achados.forEach((a, k) => {
    if (!(a.v > 0)) return;
    const prox = achados[k + 1];
    // "4 MG + 500 MG/ML": a barra do último vale para os dois
    const herda = !a.por && prox && prox.por && /^\s*\+\s*$/.test(t.slice(a.fim, prox.i)) ? prox : null;
    const por = a.por || (herda && herda.por);
    if (a.u === "%") { conc.add(`${fmt(a.v * 10)}MG/ML`); return; }
    if (por && a.u !== "ML" && a.u !== "L") {
      const base = a.u === "UI" ? a.v : paraMg(a.v, a.u);
      const div = a.por ? a.porN : 1;
      conc.add(`${fmt(base / div)}${a.u === "UI" ? "UI" : "MG"}/${por === "G" ? "G" : "ML"}`);
      if (a.por === "ML" && a.porN > 1) vols.push(a.porN);
      return;
    }
    if (a.u === "ML" || a.u === "L") {
      if (/DOSADOR\s*(DE\s*)?$/.test(t.slice(Math.max(0, a.i - 14), a.i))) return; // copo dosador não é o volume
      vols.push(a.u === "L" ? a.v * 1000 : a.v);
      return;
    }
    if (a.u === "G" && a.v > 10) { if (peso == null) peso = a.v; return; } // 400 g de pomada = peso da embalagem
    qtd.push({ v: a.u === "UI" ? a.v : paraMg(a.v, a.u), u: a.u === "UI" ? "UI" : "MG" });
  });
  const vol = vols.length ? vols[0] : null;
  // quantidade com volume e sem concentração (ex.: "1 g … 2 ml") → por ml
  if (!conc.size && qtd.length && vol && (forma === "INJ" || forma === "ORAL-LIQ")) {
    qtd.forEach((q) => conc.add(`${fmt(q.v / vol)}${q.u}/ML`));
    qtd.length = 0;
  }
  const lista = conc.size ? [...conc] : [...new Set(qtd.map((q) => `${fmt(q.v)}${q.u}`))];
  return { doses: lista.sort(), vol: vol != null ? fmt(vol) + "ML" : null, peso: peso != null ? fmt(peso) + "G" : null };
}

/** Número/calibre (sonda nº 14, cateter nº 22, fio 3-0). */
function calibre(t) {
  const m = t.match(/\bN\s*[O°º?]?\s*\.?\s*:?\s*(\d{1,2}(?:[.,]\d)?)\s*(G\b|FR\b|F\b)?/);
  if (m) return "N" + String(Number(m[1].replace(",", ".")));
  const f = t.match(/\b(\d)\s*[-.]\s*0\b/); // fio de sutura 3-0 / 6.0
  if (f && /\bFIO\b/.test(t)) return `FIO${f[1]}-0`;
  return null;
}
/** Quantidade dentro da caixa/pacote (C/ 100, COM 24 UNIDADES…). */
function qtdEmbalagem(t) {
  const m = t.match(/\b(?:C\s*\/|COM|CONTENDO|CX\s*C\s*\/?|CAIXA\s*COM|PCT\s*C\s*\/?|PACOTE\s*COM)\s*(\d{1,4})\s*(?:UN|UNID|UNIDADES|UND|PARES|PECAS|FOLHAS|AMPOLAS|ENVELOPES|SACHES)?\b/);
  return m && Number(m[1]) > 1 ? "Q" + Number(m[1]) : null;
}

// Qualificadores que se excluem: se os dois itens citam um do mesmo grupo e são diferentes, não é o mesmo produto
const QUALIF = [
  ["idade", /\b(NEONATAL|NEONATO|RECEM[- ]NASCIDO|INFANTIL|PEDIATRIC[OA]|ADULTO)\b/g],
  ["comprimento", /\b(EXTRA[- ]CURTA|CURTA|CURTO|LONGA|LONGO|MEDIA)\b/g],
  ["cor", /\b(TRANSPARENTE|AMBAR|MARROM|BRANC[OA]|AZUL|VERDE|VERMELH[OA]|PRET[OA]|AMAREL[OA]|ROSA|LILAS|CINZA)\b/g],
  ["material", /\b(LATEX|NITRIL[OA]?|NITRILICA|VINIL|PLASTIC[OA]|SILICONE|PVC|ACO|TNT|ALGODAO|BORRACHA)\b/g],
  ["sexo", /\b(MASCULIN[OA]|FEMININ[OA])\b/g],
  ["apresentacao", /\b(GEL|LIQUID[OA]|SPRAY|ESPUMA|AEROSOL)\b/g],
  ["vaso", /\b(COM VASO(CONSTRITOR)?|SEM VASO(CONSTRITOR)?|C\/ VASO|S\/ VASO)\b/g],
  ["esteril", /\b(NAO ESTERIL|ESTERIL)\b/g],
  ["po", /\b(SEM PO|COM PO|C\/ PO|S\/ PO)\b/g],
];
function qualificadores(t) {
  const out = {};
  QUALIF.forEach(([g, re]) => {
    re.lastIndex = 0;
    let m; const s = new Set();
    while ((m = re.exec(t))) s.add(m[1].replace(/^C\//, "COM ").replace(/^S\//, "SEM ").replace(/O$|A$/, "").replace(/CONSTRITOR$/, "").replace(/^NITRIL.*/, "NITRIL").replace(/[- ]/g, ""));
    if (s.size === 1) out[g] = [...s][0]; // citou mais de um (ex.: "P, M e G", "branco ou azul") = não decide
  });
  if (out.esteril === "NAOESTERIL") out.esteril = "NAO";
  return out;
}
/** Dimensão (25x8, 13x0,45, 10x20 cm) e teor (70%, 92,8 INPM) em qualquer ponto do texto. */
function dimensoes(t) {
  const d = new Set(), teor = new Set();
  let m;
  const re = /(\d+(?:[.,]\d+)?)\s*X\s*(\d+(?:[.,]\d+)?)/g;
  while ((m = re.exec(t))) { const a = numero(m[1]), b = numero(m[2]); d.add(`${fmt(a)}X${fmt(b < 2 && /[.,]/.test(m[2]) ? b * 10 : b)}`); }
  const r2 = /(\d+(?:[.,]\d+)?)\s*(?:%|INPM|°\s*GL|GL\b)/g;
  while ((m = r2.exec(t))) teor.add(fmt(numero(m[1])));
  const al = t.match(/\bALCOOL\s+(?:ETILICO\s+)?(?:HIDRATADO\s+)?(?:LIQUIDO\s+)?(?:COMUM\s+)?(\d{2}(?:[.,]\d)?)\b/);
  if (al) teor.add(fmt(numero(al[1])));
  if (/\bALCOOL\b/.test(t) && /\bABSOLUTO\b/.test(t)) teor.add("99.5"); // álcool absoluto ≠ 70 ≠ 92,8
  return { dims: [...d].slice(0, 2), teor: [...teor] };
}
/** Litragem e gramatura em qualquer ponto do texto (1 L = 1000 ml; 1 kg = 1000 g; 60 g/m² = gramatura). */
function grandezas(t) {
  const vols = new Set(), pesos = new Set();
  const agulha = /\b(AGULHA|CATETER|JELCO|SCALP|ESCALP)\b/.test(t); // "27 G" de agulha é calibre, não peso
  let m;
  const re = /(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(ML|LITROS?|LTS?|L|KG|QUILOS?|GRAMAS|GR|G)(?![A-Z])(\s*\/\s*M\s*2|\s*\/\s*M²)?(?!\s*\/)/g;
  while ((m = re.exec(t))) {
    const v = numero(m[1]);
    if (!(v > 0)) continue;
    const antes = t.slice(Math.max(0, m.index - 14), m.index);
    if (/DOSADOR\s*(DE\s*)?$/.test(antes)) continue;
    const u = m[2];
    if (/^(ML|L|LTS?|LITROS?)$/.test(u)) vols.add(fmt(u === "ML" ? v : v * 1000) + "ML");
    else if (m[3]) pesos.add(fmt(v) + "G/M2");
    else if (!(agulha && /^(G|GR)$/.test(u))) pesos.add(fmt(/^(KG|QUILOS?)$/.test(u) ? v * 1000 : v) + "G");
  }
  return { vols: [...vols], pesos: [...pesos] };
}

/** Tokens do nome (esqueleto, sem acento), para medir o quanto duas descrições se parecem. */
function tokens(t) {
  return new Set(t.replace(RE_DOSE, " ").replace(/[^A-Z0-9? ]+/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d/.test(w) && !NAO_ATIVO.has(w) && !SAIS.has(w)).slice(0, 8).map(esq));
}

/**
 * Características de uma descrição.
 * { tipo, base, forma, vol, qtd, tokens, nome }
 *   base  = o que precisa ser igual para ser o mesmo produto
 *   forma, vol, qtd = se os dois tiverem e forem diferentes, não é o mesmo
 */
export function caracteristicas(desc, unidade) {
  const t = texto(desc);
  const emb = embalagemDe(unidade);
  const formaR = formaDe(t, unidade);
  const remedio = /\d\s*(MG|MCG|UI)(?![A-Z])/.test(t) || (/\d\s*%/.test(t) && (/^(INJ|ORAL)/.test(formaR || "") || /\bANESTESIC/.test(t))) || (/(^|[^\d.,])(\d(?:[.,]\d+)?|10)\s*G(?![A-Z])/.test(t) && /^(INJ|ORAL)/.test(formaR || ""));
  if (remedio) {
    const forma = formaR;
    const primeira = t.search(/\d/);
    const cab = (primeira > 2 ? t.slice(0, primeira) : t).replace(/[^A-Z? ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !NAO_ATIVO.has(w));
    // sais saem ("succinato de sódio", "fosfato dissódico"): o princípio ativo fica
    let ativos = cab.filter((w, i) => !SAIS.has(w) && !(w === "SODIO" && i > 0 && SAIS.has(cab[i - 1])));
    if (!ativos.length) ativos = cab;
    ativos = [...new Set(ativos.slice(0, 3))];
    const d = doses(t, forma, unidade);
    const base = ["R", ativos.map(esq).sort().join("+") || "?", d.doses.join("+") || "-", d.peso || ""].join("|");
    return { tipo: "remedio", base, forma, vol: d.vol, vols: d.vol ? [d.vol] : [], pesos: d.peso ? [d.peso] : [], tam: null, qtd: emb !== "UN" ? qtdEmbalagem(t) : null, emb, tokens: tokens(t), ativos, quals: qualificadores(t), dims: [], teor: [], temMedida: d.doses.length > 0 };
  }
  const k = chaveProduto(desc, unidade).chave.split("|");
  const nucleo = (k[0] || "").split(" ")[0] || "?";
  const tam = tamanho(desc);
  const med = k.slice(1).filter((x) => !/^EMB-/.test(x));
  const cal = calibre(t);
  const tamOk = tam && tam !== "VÁRIOS" ? "T" + tam : "";
  const base = ["M", nucleo, ...med, cal || "", tamOk, emb].join("|");
  const { dims, teor } = dimensoes(t);
  const { vols, pesos } = grandezas(t);
  return { tipo: "material", base, forma: null, vol: null, vols, pesos, cal: cal || null, tam: tamOk || null, qtd: emb !== "UN" ? qtdEmbalagem(t) : null, emb, tokens: tokens(t), tamVarios: tam === "VÁRIOS",
    quals: qualificadores(t), dims, teor, temMedida: !!(med.length || cal || tamOk || dims.length || vols.length || pesos.length) };
}

/** Quanto dois conjuntos de palavras se cobrem (0 a 1): parte comum ÷ o menor. */
export function sobreposicao(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  a.forEach((x) => b.has(x) && n++);
  return n / Math.min(a.size, b.size);
}
