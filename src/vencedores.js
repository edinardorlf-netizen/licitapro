// =====================================================================
// LicitaPro · leitor do relatório "Vencedores" do Portal de Compras Públicas
// (PDF baixado no PCP: Sessão Pública → Atas → Vencedores).
// O texto vem da função licita-edital (uma linha do PDF por linha de texto).
// Cada fornecedor abre com "NOME | Tipo: … Documento 00.000.000/0000-00 …",
// lista os itens (código, produto, modelo, marca, qtde, unidade, R$ unitário, R$ total)
// e fecha em "TOTAL DO VENCEDOR".
// =====================================================================

const LIXO = /^(\[\[p[áa]g \d+\]\]|A autenticidade do documento|Documento gerado eletronicamente|C[óo]digo verificador|P[áa]gina \d+ de \d+|PDF disponibilizado em|C[óo]digo Produto Modelo)/i;
const num = (s) => { const v = Number(String(s || "").replace(/\./g, "").replace(",", ".")); return isFinite(v) ? v : null; };
const so = (s) => String(s || "").replace(/\D/g, "");
const norm = (s) => ` ${String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
// quantidade + unidade + R$ unitário + R$ total (em qualquer ponto da linha)
const VALORES = /([\d.]+(?:,\d+)?)\s+([A-Za-zÀ-ú]{1,8})\s+R\$\s*([\d.]+,\d+)\s+R\$\s*([\d.]+,\d+)/;

/** Lê o texto do relatório e devolve { fornecedores: [{ nome, cnpj, itens: [...] }] } */
export function lerVencedores(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !LIXO.test(l));
  const fornecedores = [];
  let atual = null, item = null;
  const fecharItem = () => {
    if (!item || !atual) { item = null; return; }
    const t = item.partes.join(" ").replace(/\s+/g, " ");
    const m = t.match(VALORES);
    if (m) {
      const antes = t.slice(0, m.index).replace(/^\d{3,5}\s+/, "").trim();
      const depois = t.slice(m.index + m[0].length).trim();
      atual.itens.push({ numero: Number(item.codigo), texto: `${antes}${depois ? " " + depois : ""}`.trim(), antes, quantidade: num(m[1]), unidade: m[2], vu: num(m[3]), vt: num(m[4]) });
    }
    item = null;
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/\|\s*Tipo:/i.test(l)) {
      fecharItem();
      const cab = `${l} ${linhas[i + 1] || ""}`;
      const doc = (cab.match(/Documento\s*:?\s*([\d./-]{11,20})/i) || [])[1] || "";
      atual = { nome: l.split("|")[0].trim(), cnpj: so(doc), itens: [] };
      fornecedores.push(atual);
      continue;
    }
    if (/^TOTAL DO VENCEDOR/i.test(l) || /^Valor Total:/i.test(l)) { fecharItem(); continue; }
    if (!atual) continue;
    const c = l.match(/^(\d{3,5})\s+\S/);
    if (c && !/^\d{3,5}\s+(?:-|CEP|UF)/i.test(l)) { fecharItem(); item = { codigo: c[1], partes: [l] }; continue; }
    if (item) item.partes.push(l);
  }
  fecharItem();
  return { fornecedores };
}

/** O fornecedor do relatório é uma das empresas da conta? (CNPJ ou nome) */
export function ehNossa(f, empresas) {
  return (empresas || []).some((e) => {
    const c = so(e.cnpj);
    if (c && f.cnpj && c === f.cnpj) return true;
    const n = norm(e.nome).trim();
    return n.length > 3 && norm(f.nome).includes(` ${n} `);
  });
}

/** Marca: a do item já lançado na proposta; senão, a última palavra antes da quantidade (o relatório traz "Modelo Marca"). */
export function marcaProvavel(achado, item) {
  if (item && item.marca) return item.marca;
  const partes = achado.antes.split(/\s+/);
  return partes.length ? partes[partes.length - 1].replace(/[:;,]$/, "") : null;
}
