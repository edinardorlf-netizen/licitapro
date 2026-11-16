// =====================================================================
// LicitaPro · Produtos → "Unificar produtos" (ligação em 3 níveis)
//
// Lê as características de cada descrição (src/assinatura.js) e compara os
// produtos que têm a mesma base (mesmo princípio ativo e dose, ou mesmo
// material com as mesmas medidas, nº e tamanho):
//   ✅ Certeza  → mesma base, sem conflito, e (mesma marca/registro Anvisa ou,
//                 no remédio, a mesma forma) → junta tudo num clique;
//   🟡 Provável → mesma base, sem conflito, nomes parecidos → a pessoa confere;
//   ⚪ Sem par  → item ganho sozinho no produto → sugestões para ligar à mão.
// Conflito = forma, volume, quantidade na embalagem diferentes, ou preço mais
// de 2,5× diferente. Nada é juntado sem alguém clicar.
// =====================================================================
import React, { useState, useMemo } from "react";
import { sb, brl, errMsg } from "./util.js";
import { caracteristicas, sobreposicao } from "./assinatura.js";

const FORA = 2.5;
const mediana = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const disj = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));
const comum = (a, b) => [...a].some((x) => b.has(x));
const limpa = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Por que duas descrições não podem ser o mesmo produto ([] = podem). */
export function conflito(a, b) {
  const x = a.c, y = b.c, m = [];
  if (!x || !y) return m;
  const d = (p, q) => p && q && p.length && q.length && !p.some((v) => q.includes(v));
  if (x.tipo === "remedio" && y.tipo === "remedio" && x.base !== y.base) m.push("dose diferente");
  if (x.forma && y.forma && x.forma !== y.forma) m.push("forma diferente");
  if (d(x.vols, y.vols)) m.push("litragem diferente");
  if (d(x.pesos, y.pesos)) m.push("gramatura/peso diferente");
  if (d(x.teor, y.teor)) m.push("teor diferente (ex.: álcool 70 × 92,8 × absoluto)");
  if (d(x.dims, y.dims)) m.push("medida diferente");
  if (x.tam && y.tam && x.tam !== y.tam) m.push("tamanho diferente");
  if (x.cal && y.cal && x.cal !== y.cal) m.push("número diferente");
  if (x.qtd && y.qtd && x.qtd !== y.qtd) m.push("quantidade na embalagem diferente");
  Object.keys(x.quals || {}).forEach((g) => { if (y.quals && y.quals[g] && y.quals[g] !== x.quals[g]) m.push(`${g} diferente`); });
  return m;
}

// Características que distinguem uma descrição (para o nome de cada grupo da separação)
function marcas(l) {
  const c = l.c || {}, r = [];
  (c.teor || []).forEach((t) => r.push(t === "99.5" ? "absoluto" : `teor ${t.replace(".", ",")}`));
  (c.vols || []).forEach((v) => r.push(v.toLowerCase()));
  (c.pesos || []).forEach((v) => r.push(v.toLowerCase()));
  (c.dims || []).forEach((v) => r.push(v.toLowerCase()));
  if (c.tam) r.push(`tam ${String(c.tam).replace(/^T/, "")}`);
  if (c.cal) r.push(`nº ${c.cal}`);
  if (c.qtd) r.push(`c/ ${String(c.qtd).replace(/^Q/, "")}`);
  if (c.forma) r.push(c.forma.toLowerCase());
  const BONITO = { COMVAS: "com vaso", SEMVAS: "sem vaso", NAO: "não estéril", SIM: "estéril", ESTERIL: "estéril", ADULT: "adulto", PEDIATRIC: "pediátrico", MASCULIN: "masculino", FEMININ: "feminino", ALGODA: "algodão", PLASTIC: "plástico", BRANC: "branco", PRET: "preto", ESPUM: "espuma", AC: "aço", LONG: "longa", CURT: "curta", TRANSPARENTE: "transparente" };
  Object.values(c.quals || {}).forEach((v) => r.push(BONITO[v] || String(v).toLowerCase()));
  if (c.tipo === "remedio") { const d = String(c.base || "").split("|")[2]; if (d && d !== "-") r.push(d.toLowerCase()); }
  return r;
}

/** Divide as descrições de um produto misturado em grupos que não se contradizem.
 *  O 1º grupo (o que tem mais itens ganhos) fica no produto; os outros viram produtos novos. */
export function partir(P) {
  const ls = [...P.linhas].sort((a, b) => marcas(b).length - marcas(a).length);
  const gs = [];
  ls.forEach((l) => {
    const ok = gs.filter((g) => g.linhas.every((o) => !conflito(l, o).length));
    if (!ok.length) { gs.push({ linhas: [l], tokens: new Set(l.c ? l.c.tokens : []) }); return; }
    const g = ok.map((g) => [g, sobreposicao(new Set(l.c ? l.c.tokens : []), g.tokens)]).sort((a, b) => b[1] - a[1])[0][0];
    g.linhas.push(l);
    (l.c ? l.c.tokens : []).forEach((t) => g.tokens.add(t));
    if (ok.length > 1) l.duvida = true; // serviria em mais de um grupo
  });
  gs.forEach((g) => {
    g.ganhos = g.linhas.filter((l) => l.tipo === "ganho").length;
    const ms = g.linhas.map(marcas).filter((m) => m.length);
    g.rotulo = ms.length ? ms[0].filter((x) => ms.every((m) => m.includes(x))).join(" · ") : "";
    g.nome = String(g.linhas.find((l) => marcas(l).length)?.desc || g.linhas[0].desc || "").slice(0, 80);
  });
  gs.sort((a, b) => b.ganhos - a.ganhos || b.linhas.length - a.linhas.length);
  return gs;
}

/** Monta os produtos com as características das suas descrições e as ligações entre eles. */
export function analisar(dados) {
  const anvisaItem = new Map((dados.itens || []).map((i) => [i.id, i.anvisa]));
  const ganhosItem = new Set(dados.ganhos.map((g) => g.item_id).filter(Boolean));
  const linhas = [
    ...dados.ganhos.map((g) => ({ id: g.id, tipo: "ganho", desc: g.descricao, unidade: g.unidade, preco: Number(g.valor_unitario) || null, marca: g.marca, anvisa: g.item_id ? anvisaItem.get(g.item_id) : null, prod: g.produto_id, qtd: Number(g.quantidade) || 0, entregue: Number(g.quantidade_entregue) || 0, numero: g.numero, onde: g.processos ? `${g.processos.orgao || ""}${g.processos.numero ? ` · ${g.processos.numero}` : ""}` : "" })),
    ...dados.itens.filter((i) => !ganhosItem.has(i.id)).map((i) => ({ id: i.id, tipo: "item", desc: i.descricao, unidade: i.unidade, preco: Number(i.preco_unit) || null, marca: i.marca, anvisa: i.anvisa, prod: i.produto_id, numero: i.numero, onde: "cotado / em disputa" })),
  ];
  const porProd = new Map();
  (dados.produtos || []).forEach((p) => porProd.set(p.id, { p, id: p.id, linhas: [], bases: new Map(), formas: new Set(), vols: new Set(), qtds: new Set(), tokens: new Set(), marcas: new Set(), anvisas: new Set(), precos: [], nGanhos: 0, quals: {}, dims: new Set(), teor: new Set(), pesos: new Set(), temMedida: false }));
  linhas.forEach((l) => {
    const P = l.prod && porProd.get(l.prod);
    if (!P) return;
    const c = caracteristicas(l.desc, l.unidade);
    l.c = c;
    P.linhas.push(l);
    P.bases.set(c.base, (P.bases.get(c.base) || 0) + 1);
    if (c.forma) P.formas.add(c.forma);
    (c.vols || []).forEach((x) => P.vols.add(x));
    (c.pesos || []).forEach((x) => P.pesos.add(x));
    if (c.qtd) P.qtds.add(c.qtd);
    Object.entries(c.quals || {}).forEach(([g, v]) => { (P.quals[g] = P.quals[g] || new Set()).add(v); });
    (c.dims || []).forEach((x) => P.dims.add(x));
    (c.teor || []).forEach((x) => P.teor.add(x));
    if (c.temMedida) P.temMedida = true;
    c.tokens.forEach((t) => P.tokens.add(t));
    if (l.marca && limpa(l.marca).length > 1) P.marcas.add(limpa(l.marca));
    const an = String(l.anvisa || "").replace(/\D/g, "");
    if (an.length >= 9) P.anvisas.add(an);
    if (l.preco > 0) P.precos.push(l.preco);
    if (l.tipo === "ganho") P.nGanhos++;
  });
  const prods = [...porProd.values()].filter((P) => P.linhas.length);
  prods.forEach((P) => {
    P.base = [...P.bases.entries()].sort((a, b) => b[1] - a[1])[0][0];
    P.tipo = P.base.startsWith("R|") ? "remedio" : "material";
    P.med = mediana(P.precos);
  });

  // Produtos misturados (litragem, gramatura, tamanho, teor, dose… diferentes dentro do mesmo produto):
  // não entram nas sugestões; vão para a lista "Misturados" para separar
  prods.forEach((P) => {
    const ls = P.linhas.slice(0, 60), m = new Set();
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) conflito(ls[i], ls[j]).forEach((x) => m.add(x));
    P.mistura = [...m];
  });
  const misturados = prods.filter((P) => P.mistura.length && P.nGanhos > 0 && !P.p.conferido_em);

  // Ligações entre produtos com a mesma base
  const balde = new Map();
  prods.filter((P) => !P.mistura.length).forEach((P) => { if (!balde.has(P.base)) balde.set(P.base, []); balde.get(P.base).push(P); });
  const arestas = [];
  const nivel = (A, B) => {
    if (disj(A.formas, B.formas) || disj(A.vols, B.vols) || disj(A.qtds, B.qtds) || disj(A.dims, B.dims) || disj(A.teor, B.teor) || disj(A.pesos, B.pesos)) return null;
    if (Object.keys(A.quals).some((g) => B.quals[g] && disj(A.quals[g], B.quals[g]))) return null; // infantil x adulto, âmbar x transparente…
    if (A.med && B.med && (A.med / B.med > FORA || B.med / A.med > FORA)) return null;
    const sim = sobreposicao(A.tokens, B.tokens);
    const mesmaMarca = comum(A.marcas, B.marcas) || comum(A.anvisas, B.anvisas);
    if (A.tipo === "remedio") return (mesmaMarca || comum(A.formas, B.formas)) ? "certeza" : "provavel";
    if (mesmaMarca && sim >= 0.6 && A.temMedida && B.temMedida) return "certeza"; // material só tem certeza com medida/nº/tamanho
    if (sim >= 0.5 || (mesmaMarca && sim >= 0.34)) return "provavel";
    return null;
  };
  balde.forEach((lista) => {
    if (lista.length < 2 || lista.length > 150) return;
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const n = nivel(lista[i], lista[j]);
      if (n) arestas.push([lista[i].id, lista[j].id, n]);
    }
  });
  const grupos = (filtro) => {
    const pai = new Map();
    const raiz = (x) => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
    arestas.filter(filtro).forEach(([a, b]) => { if (!pai.has(a)) pai.set(a, a); if (!pai.has(b)) pai.set(b, b); pai.set(raiz(a), raiz(b)); });
    const g = new Map();
    [...pai.keys()].forEach((x) => { const r = raiz(x); if (!g.has(r)) g.set(r, []); g.get(r).push(x); });
    return [...g.values()].filter((l) => l.length > 1);
  };
  const ix = new Map(prods.map((P) => [P.id, P]));
  const certos = grupos((e) => e[2] === "certeza").map((ids) => ids.map((id) => ix.get(id)));
  const grupoCerto = new Map();
  certos.forEach((g, k) => g.forEach((P) => grupoCerto.set(P.id, k)));
  const provaveis = grupos(() => true)
    .filter((ids) => new Set(ids.map((id) => (grupoCerto.has(id) ? "c" + grupoCerto.get(id) : id))).size > 1)
    .map((ids) => ids.map((id) => ix.get(id)));
  const ligados = new Set(arestas.flatMap(([a, b]) => [a, b]));

  // Sem par: produto com um item ganho só, sem nenhuma ligação → sugestões pelo nome
  const porNucleo = new Map();
  prods.forEach((P) => P.base.split("|")[1].split("+").forEach((k) => { if (!porNucleo.has(k)) porNucleo.set(k, []); porNucleo.get(k).push(P); }));
  const sozinhos = prods.filter((P) => P.nGanhos > 0 && P.linhas.length === 1 && !ligados.has(P.id));
  const sugestoes = (P) => {
    const vistos = new Set([P.id]);
    const cand = [];
    P.base.split("|")[1].split("+").forEach((k) => (porNucleo.get(k) || []).forEach((Q) => {
      if (vistos.has(Q.id)) return; vistos.add(Q.id);
      if (Q.p.conta_id && P.p.conta_id && Q.p.conta_id !== P.p.conta_id) return;
      const s = sobreposicao(P.tokens, Q.tokens) + (Q.base === P.base ? 0.5 : 0) + (comum(P.marcas, Q.marcas) ? 0.2 : 0);
      const precoFora = P.med && Q.med && (P.med / Q.med > FORA || Q.med / P.med > FORA);
      if (s >= 0.34) cand.push({ Q, s, precoFora });
    }));
    return cand.sort((a, b) => b.s - a.s).slice(0, 3);
  };

  // Cobertura: itens ganhos ligados a um produto com custo
  const ganhosL = linhas.filter((l) => l.tipo === "ganho");
  const comCusto = ganhosL.filter((l) => l.prod && porProd.get(l.prod) && porProd.get(l.prod).p.custo_atual != null).length;
  const comSaldo = ganhosL.filter((l) => l.qtd - l.entregue > 0);
  const saldoSemCusto = comSaldo.filter((l) => !(l.prod && porProd.get(l.prod) && porProd.get(l.prod).p.custo_atual != null)).length;
  const emGrupo = ganhosL.filter((l) => l.prod && porProd.get(l.prod) && porProd.get(l.prod).linhas.length > 1).length;
  // Juntados e ainda não conferidos (o banco marca juntado_em ao juntar; conferido_em quando alguém confirma)
  const aConferir = prods.filter((P) => P.p.juntado_em && !P.p.conferido_em && P.linhas.length > 1)
    .sort((a, b) => String(b.p.juntado_em).localeCompare(String(a.p.juntado_em)));
  return { certos, provaveis, sozinhos, sugestoes, aConferir, misturados, cobertura: { ganhos: ganhosL.length, comCusto, emGrupo, comSaldo: comSaldo.length, saldoSemCusto, produtos: prods.filter((P) => P.nGanhos).length } };
}

const resumo = (P) => {
  const l = P.linhas[0];
  return { nome: P.p.nome, desc: l ? l.desc : "", marcas: [...P.marcas].slice(0, 3).join(", "), n: P.linhas.length, ganhos: P.nGanhos, med: P.med, custo: P.p.custo_atual };
};
// Para onde juntar: o produto com custo, senão o que tem mais descrições
const alvoDe = (lista) => [...lista].sort((a, b) => (b.p.custo_atual != null) - (a.p.custo_atual != null) || b.linhas.length - a.linhas.length)[0];

// Por que uma descrição destoa do produto (para a conferência)
function destoa(l, P) {
  const motivos = [];
  const outras = new Set();
  P.linhas.forEach((o) => { if (o !== l) conflito(l, o).forEach((x) => outras.add(x)); });
  outras.forEach((x) => motivos.push(x));
  if (!outras.size && l.c && l.c.base !== P.base) motivos.push("descrição diferente das outras");
  if (l.preco > 0 && P.med && (l.preco / P.med > FORA || P.med / l.preco > FORA)) motivos.push("preço fora do padrão");
  return motivos;
}

function LinhaProd({ P, marcado, onMarca, verCusto }) {
  const r = resumo(P);
  return (
    <tr>
      {onMarca && <td><input type="checkbox" checked={marcado} onChange={(e) => onMarca(e.target.checked)} aria-label={`Incluir ${r.nome}`} /></td>}
      <td style={{ minWidth: 200 }}><b>{r.nome}</b>
        {P.linhas.length === 1 ? <div className="hint clamp2">{r.desc}</div> : (
          <details><summary className="hint" style={{ cursor: "pointer" }}>ver as {P.linhas.length} descrições</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{P.linhas.map((l) => <li key={l.id} className="hint">{String(l.desc || "").slice(0, 220)}{l.marca ? ` — ${l.marca}` : ""}{l.preco ? ` — ${brl(l.preco)}` : ""}</li>)}</ul>
          </details>
        )}
      </td>
      <td className="n">{r.n}{r.ganhos ? <div className="hint">{r.ganhos} 🏆</div> : null}</td>
      <td className="n">{r.med != null ? brl(r.med) : "—"}</td>
      <td>{r.marcas || "—"}</td>
      {verCusto && <td className="n">{r.custo != null ? brl(r.custo) : <span className="hint">sem custo</span>}</td>}
    </tr>
  );
}

export default function LigarProdutos({ dados, podeCat, verCusto, notify, onFeito, email }) {
  const [aba, setAba] = useState(null); // certeza | provavel | sozinhos
  const [tira, setTira] = useState({}); // produto id → true (fora)
  const [busy, setBusy] = useState("");
  const [lim, setLim] = useState(30);
  const a = useMemo(() => (dados ? analisar(dados) : null), [dados]);
  if (!a) return null;
  const cob = a.cobertura;
  const pctTxt = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  const juntarGrupos = async (lista, rotulo) => {
    setBusy(`${rotulo}… 0 de ${lista.length}`);
    let feitos = 0;
    try {
      for (const g of lista) {
        const ps = g.filter((P) => !tira[P.id]);
        if (ps.length < 2) continue;
        const alvo = alvoDe(ps);
        const { error } = await sb.rpc("juntar_produtos", { p_para: alvo.id, p_de: ps.map((P) => P.id) });
        if (error) throw error;
        feitos++;
        if (feitos % 10 === 0) setBusy(`${rotulo}… ${feitos} de ${lista.length}`);
      }
      notify(feitos ? `${feitos} grupo(s) juntado(s). Confira as descrições em “Conferir juntados”.` : "Nada marcado para juntar.");
      setTira({});
      if (feitos) { setAba("conferir"); setLim(30); }
      onFeito();
    } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };
  const ligar = async (P, Q) => {
    const { error } = await sb.rpc("juntar_produtos", { p_para: Q.id, p_de: [P.id] });
    if (error) return notify(errMsg(error));
    notify(`“${P.p.nome}” ligado a “${Q.p.nome}”. Ele aparece em “Conferir juntados”.`);
    onFeito();
  };
  const separar = async (l) => {
    const { error } = await sb.rpc("separar_item", { p_item: l.tipo === "item" ? l.id : null, p_ganho: l.tipo === "ganho" ? l.id : null, p_nome: String(l.desc || "").slice(0, 80) });
    if (error) return notify(errMsg(error));
    notify("Descrição separada: voltou a ser um produto próprio.");
    onFeito();
  };
  // Separa os grupos 2, 3… de cada produto misturado em produtos novos (o 1º fica no produto)
  const separarGrupos = async (lista) => {
    let feitos = 0, novos = 0;
    setBusy(`Separando… 0 de ${lista.length}`);
    try {
      for (const P of lista) {
        const gs = partir(P);
        if (gs.length < 2) continue;
        for (const g of gs.slice(1)) {
          const { error } = await sb.rpc("separar_grupo", { p_itens: g.linhas.filter((l) => l.tipo === "item").map((l) => l.id), p_ganhos: g.linhas.filter((l) => l.tipo === "ganho").map((l) => l.id), p_nome: g.nome });
          if (error) throw error;
          novos++;
        }
        feitos++;
        if (feitos % 5 === 0) setBusy(`Separando… ${feitos} de ${lista.length}`);
      }
      notify(feitos ? `${feitos} produto(s) separado(s) em ${novos} produto(s) novo(s).` : "Nada para separar.");
      onFeito();
    } catch (e) { notify(errMsg(e)); onFeito(); }
    setBusy("");
  };
  const conferido = async (P) => {
    const { error } = await sb.from("produtos").update({ conferido_em: new Date().toISOString(), conferido_por: email || null }).eq("id", P.id);
    if (error) return notify(errMsg(error));
    notify(`“${P.p.nome}” conferido.`);
    onFeito();
  };

  const tabela = (P, extra) => (
    <table className="itab">
      <thead><tr>{extra && <th aria-label="Incluir" />}<th>Produto</th><th className="n">Descrições</th><th className="n">Venda média</th><th>Marcas</th>{verCusto && <th className="n">Custo</th>}</tr></thead>
      <tbody>{P}</tbody>
    </table>
  );

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div><b>Unificar produtos</b><div className="hint">O app lê cada descrição (princípio ativo e dose convertida, ou nome, medidas, nº, tamanho e embalagem) e acha o que é o mesmo produto escrito de outro jeito. Nada é juntado sem você confirmar; o que for juntado errado se desfaz com “Separar”.</div></div>
      <div className="grid3">
        <div className="card kpi"><small>Itens ganhos com produto com custo</small><b className="num">{pctTxt(cob.comCusto, cob.ganhos)}</b><small>{cob.comCusto} de {cob.ganhos} · com saldo e sem custo: <b>{cob.saldoSemCusto}</b></small></div>
        <div className="card kpi"><small>Itens ganhos juntados com outras descrições</small><b className="num">{pctTxt(cob.emGrupo, cob.ganhos)}</b><small>{cob.produtos} produtos com itens ganhos</small></div>
        <div className="card kpi"><small>Para conferir</small><b className="num">{a.certos.length + a.provaveis.length}</b><small>{a.certos.length} certeza · {a.provaveis.length} provável · {a.sozinhos.length} sem par</small></div>
      </div>
      <div className="chips">
        {[["certeza", `✅ Certeza (${a.certos.length})`], ["provavel", `🟡 Provável (${a.provaveis.length})`], ["sozinhos", `⚪ Sem par (${a.sozinhos.length})`], ["conferir", `🔍 Conferir juntados (${a.aConferir.length})`], ["misturados", `⚠ Misturados (${a.misturados.length})`]].map(([k, l]) => (
          <button key={k} type="button" className={`chip${aba === k ? " on" : ""}`} onClick={() => { setAba(aba === k ? null : k); setLim(30); setTira({}); }}>{l}</button>
        ))}
      </div>
      {busy && <div className="banner info"><span className="spin" /> {busy}</div>}

      {aba === "certeza" && (!a.certos.length ? <div className="hint">Nenhum grupo com certeza agora.</div> : <>
        <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="hint">Mesmo princípio ativo e dose (ou mesmas medidas) e a mesma marca, registro Anvisa ou forma. Desmarque o que não for igual.</span>
          {podeCat && <button type="button" className="btn" disabled={!!busy} onClick={() => juntarGrupos(a.certos, "Juntando")}>Juntar os {a.certos.length} grupos</button>}
        </div>
        {a.certos.slice(0, lim).map((g, k) => (
          <div key={k} className="card" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>{tabela(g.map((P) => <LinhaProd key={P.id} P={P} verCusto={verCusto} marcado={!tira[P.id]} onMarca={podeCat ? (v) => setTira((x) => ({ ...x, [P.id]: !v })) : null} />), podeCat)}</div>
          </div>
        ))}
      </>)}

      {aba === "provavel" && (!a.provaveis.length ? <div className="hint">Nenhum grupo provável agora.</div> : <>
        <span className="hint">Mesma base com nomes parecidos, mas sem marca em comum. Confira a descrição e o preço; junte grupo a grupo.</span>
        {a.provaveis.slice(0, lim).map((g, k) => {
          const n = g.filter((P) => !tira[P.id]).length;
          return (
            <div key={k} className="card" style={{ padding: 0 }}>
              <div style={{ overflowX: "auto" }}>{tabela(g.map((P) => <LinhaProd key={P.id} P={P} verCusto={verCusto} marcado={!tira[P.id]} onMarca={podeCat ? (v) => setTira((x) => ({ ...x, [P.id]: !v })) : null} />), podeCat)}</div>
              {podeCat && <div style={{ padding: "8px 12px" }}><button type="button" className="btn sm" disabled={!!busy || n < 2} onClick={() => juntarGrupos([g], "Juntando")}>Juntar {n}</button></div>}
            </div>
          );
        })}
      </>)}

      {aba === "sozinhos" && (!a.sozinhos.length ? <div className="hint">Nenhum item ganho sozinho.</div> : <>
        <span className="hint">Itens ganhos que ficaram sozinhos num produto. Se uma sugestão for o mesmo produto, clique em “Ligar”. Se não houver, cadastre o custo dele direto na lista abaixo.</span>
        <div style={{ overflowX: "auto" }}>
          <table className="itab">
            <thead><tr><th>Item ganho</th><th className="n">Venda</th><th>Sugestões</th></tr></thead>
            <tbody>
              {a.sozinhos.slice(0, lim).map((P) => {
                const sug = a.sugestoes(P);
                return (
                  <tr key={P.id}>
                    <td style={{ minWidth: 240 }}><b>{P.p.nome}</b><div className="hint clamp2">{P.linhas[0].desc}</div>{P.linhas[0].marca && <div className="hint">Marca: {P.linhas[0].marca}</div>}</td>
                    <td className="n">{P.med != null ? brl(P.med) : "—"}</td>
                    <td style={{ minWidth: 260 }}>
                      {!sug.length ? <span className="hint">Nenhum parecido</span> : sug.map(({ Q, precoFora }) => (
                        <div key={Q.id} className="row-inline" style={{ gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                          <span>{Q.p.nome} <span className="hint">({Q.linhas.length} desc. · {Q.med != null ? brl(Q.med) : "—"}{precoFora ? " · ⚠ preço diferente" : ""})</span></span>
                          {podeCat && <button type="button" className="linkbtn" onClick={() => ligar(P, Q)}>Ligar</button>}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
      {(aba === "conferir" || aba === "misturados") && (!(aba === "conferir" ? a.aConferir : a.misturados).length ? <div className="hint">{aba === "conferir" ? "Nada juntado esperando conferência." : "Nenhum produto com descrições que se contradizem."}</div> : <>
        <span className="hint">{aba === "conferir"
          ? "Produtos que acabaram de ser juntados, com todas as descrições. Leia cada uma: se alguma não for o mesmo produto, clique em “Separar”. As linhas em amarelo destoam das outras (litragem, gramatura, tamanho, teor, dose ou preço). Quando estiver tudo certo, clique em “Está certo”."
          : "Produtos que já estavam juntos, mas com descrições que se contradizem (ex.: álcool 70 junto com 92,8; 500 ml junto com 1 L; tamanho P junto com G). O app já dividiu as descrições em grupos: o 1º fica no produto e cada um dos outros vira um produto novo. Confira e clique em “Separar em N produtos”; se uma linha estiver no grupo errado, use “Separar” nela; se estiver certo juntos, clique em “Está certo”."}</span>
        {aba === "misturados" && podeCat && (
          <div className="row-inline" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" disabled={!!busy} onClick={() => { if (window.confirm(`Separar os ${a.misturados.length} produtos misturados nos grupos mostrados? Dá para juntar de novo depois.`)) separarGrupos(a.misturados); }}>Separar todos os {a.misturados.length}</button>
          </div>
        )}
        {(aba === "conferir" ? a.aConferir : a.misturados).slice(0, lim).map((P) => {
          const gs = aba === "misturados" ? partir(P) : null;
          return (
          <div key={P.id} className="card" style={{ padding: 0 }}>
            <div className="row-inline" style={{ padding: "10px 12px", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div><b>{P.p.nome}</b>{P.mistura && P.mistura.length > 0 && <span className="tag warn" style={{ marginLeft: 6 }}>{P.mistura.slice(0, 3).join(" · ")}</span>}<span className="hint"> · {P.linhas.length} descrições · venda mediana {P.med != null ? brl(P.med) : "—"}{verCusto && P.p.custo_atual != null ? ` · custo ${brl(P.p.custo_atual)}` : ""}</span></div>
              {podeCat && <div className="row-inline" style={{ gap: 6 }}>
                {gs && gs.length > 1 && <button type="button" className="btn sm" disabled={!!busy} onClick={() => separarGrupos([P])}>Separar em {gs.length} produtos</button>}
                <button type="button" className="btn ghost sm" onClick={() => conferido(P)}>✓ Está certo</button>
              </div>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="itab">
                <thead><tr><th>Descrição no edital</th><th>Onde</th><th>Unid.</th><th className="n">Preço</th><th>Marca</th>{podeCat && <th />}</tr></thead>
                <tbody>
                  {(gs || [{ linhas: P.linhas }]).flatMap((g, gi) => [
                    gs ? <tr key={`g${gi}`}><td colSpan={podeCat ? 6 : 5} style={{ background: "var(--soft, #f3f4f6)" }}><b>{gi === 0 ? "Fica no produto" : `Produto novo ${gi}`}</b><span className="hint"> · {g.linhas.length} descrição(ões){g.ganhos ? ` · ${g.ganhos} 🏆` : ""}{g.rotulo ? ` · ${g.rotulo}` : ""}</span></td></tr> : null,
                    ...g.linhas.map((l) => {
                    const m = gs ? (l.duvida ? ["sem litragem/tamanho/teor na descrição: confira em qual grupo fica"] : []) : destoa(l, P);
                    return (
                      <tr key={l.id} style={m.length ? { background: "var(--amber-soft)" } : null}>
                        <td style={{ minWidth: 280 }}>{l.desc}{m.length > 0 && <div className="hint" style={{ color: "var(--red)" }}>⚠ {m.join(" · ")}</div>}</td>
                        <td className="hint" style={{ minWidth: 140 }}>{l.tipo === "ganho" ? "🏆 " : ""}{l.onde}{l.numero != null ? ` · item ${l.numero}` : ""}</td>
                        <td>{l.unidade || "—"}</td>
                        <td className="n">{l.preco ? brl(l.preco) : "—"}</td>
                        <td>{l.marca || "—"}</td>
                        {podeCat && <td><button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => separar(l)}>Separar</button></td>}
                      </tr>
                    );
                  })])}
                </tbody>
              </table>
            </div>
          </div>
          );
        })}
      </>)}
      {aba && (aba === "certeza" ? a.certos : aba === "provavel" ? a.provaveis : aba === "conferir" ? a.aConferir : aba === "misturados" ? a.misturados : a.sozinhos).length > lim && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setLim((l) => l + 50)}>Mostrar mais</button>
      )}
    </div>
  );
}
