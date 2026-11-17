// =====================================================================
// LicitaPro · regras do orçamento de venda (as mesmas da função salvar_orcamento do banco)
// Valor unitário = custo × (1 + markup), em 2 casas; preço manual manda. Total = qtd × unitário.
// Código aceito: código do sistema → código planilha → apelido de produto juntado → "P" + número.
// =====================================================================
export const arred2 = (v) => Math.round(Number((Number(v) * 100).toPrecision(12))) / 100;

export function precoUnit(custo, markup, manual) {
  if (manual != null && manual !== "" && Number(manual) > 0) return arred2(manual);
  if (custo == null || !(Number(custo) > 0)) return null;
  return arred2(Number(custo) * (1 + Number(markup || 0)));
}

export function indiceProdutos(produtos) {
  const cod = new Map(), cp = new Map(), apel = new Map(), apelP = new Map();
  for (const p of produtos) {
    if (p.codigo) cod.set(String(p.codigo).trim(), p);
    if (p.codigo_planilha) cp.set(String(p.codigo_planilha).toUpperCase(), p);
    (p.chaves || []).forEach((k) => {
      const a = String(k).match(/^PDV:(.+)$/); if (a) apel.set(a[1], p);
      const b = String(k).match(/^P:(.+)$/); if (b) apelP.set(b[1], p);
    });
  }
  return { cod, cp, apel, apelP };
}

export function acharProduto(ind, codigo) {
  const c = String(codigo || "").trim();
  if (!c) return null;
  const u = c.toUpperCase();
  return ind.cod.get(c) || ind.cp.get(u) || ind.apel.get(c) || ind.apelP.get(u)
    || (/^\d+$/.test(c) ? ind.cp.get(`P${c}`) || ind.cp.get(`P${c.padStart(4, "0")}`) : null) || null;
}

/** Linha do orçamento já calculada: { prod, unit, total, erro, aviso } */
export function calcularLinha(ind, markup, l) {
  const codigo = String(l.codigo || "").trim();
  const qtdTxt = String(l.qtd == null ? "" : l.qtd).trim();
  if (!codigo && !qtdTxt) return { vazia: true };
  const prod = acharProduto(ind, codigo);
  const qtd = qtdTxt === "" ? null : Number(qtdTxt.replace(/\./g, "").replace(",", "."));
  const man = String(l.preco_manual == null ? "" : l.preco_manual).trim();
  const manual = man === "" ? null : Number(man.replace(/\./g, "").replace(",", "."));
  const out = { prod, qtd, manual };
  if (!codigo) return { ...out, erro: "Informe o código" };
  if (!prod) return { ...out, erro: `Código ${codigo} não encontrado` };
  if (qtd == null) return { ...out, erro: "Informe a quantidade" };
  if (!isFinite(qtd) || qtd <= 0) return { ...out, erro: "Quantidade inválida" };
  if (manual != null && !(isFinite(manual) && manual > 0)) return { ...out, erro: "Preço manual inválido" };
  if (!(Number(prod.custo_atual) > 0)) return { ...out, erro: "Sem custo cadastrado (bloqueia o salvamento)" };
  const unit = precoUnit(prod.custo_atual, markup, manual);
  const total = arred2(qtd * unit);
  const aviso = prod.saldo != null && qtd > Number(prod.saldo) ? `Pedido maior que o saldo (${Number(prod.saldo).toLocaleString("pt-BR")})` : "";
  return { ...out, unit, total, aviso };
}

/** Parcelas pela condição ("30/60/90 DIAS" = 3 iguais; a última acerta os centavos). Sem números = sem parcelas. */
export function parcelas(condicao, total, dataIso) {
  const limpo = String(condicao || "").toUpperCase().replace(/DIAS?/g, "").trim();
  if (!limpo || !/^\d+(\s*\/\s*\d+)*$/.test(limpo)) return [];
  const prazos = limpo.split("/").map((x) => Number(x.trim()));
  const n = prazos.length;
  const parc = arred2(Number(total) / n);
  const ultima = arred2(Number(total) - parc * (n - 1));
  const [y, m, d] = String(dataIso).slice(0, 10).split("-").map(Number);
  return prazos.map((dias, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + dias, 12));
    return { dias, data: dt.toISOString().slice(0, 10), valor: i === n - 1 ? ultima : parc };
  });
}

export const somaDias = (dataIso, dias) => {
  const [y, m, d] = String(dataIso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(dias || 0), 12)).toISOString().slice(0, 10);
};
export const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
export const nOrc = (n) => String(n).padStart(4, "0");
