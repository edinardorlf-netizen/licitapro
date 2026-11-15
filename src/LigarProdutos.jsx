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

/** Monta os produtos com as características das suas descrições e as ligações entre eles. */
export function analisar(dados) {
  const anvisaItem = new Map((dados.itens || []).map((i) => [i.id, i.anvisa]));
  const ganhosItem = new Set(dados.ganhos.map((g) => g.item_id).filter(Boolean));
  const linhas = [
    ...dados.ganhos.map((g) => ({ id: g.id, tipo: "ganho", desc: g.descricao, unidade: g.unidade, preco: Number(g.valor_unitario) || null, marca: g.marca, anvisa: g.item_id ? anvisaItem.get(g.item_id) : null, prod: g.produto_id, qtd: Number(g.quantidade) || 0, entregue: Number(g.quantidade_entregue) || 0 })),
    ...dados.itens.filter((i) => !ganhosItem.has(i.id)).map((i) => ({ id: i.id, tipo: "item", desc: i.descricao, unidade: i.unidade, preco: Number(i.preco_unit) || null, marca: i.marca, anvisa: i.anvisa, prod: i.produto_id })),
  ];
  const porProd = new Map();
  (dados.produtos || []).forEach((p) => porProd.set(p.id, { p, id: p.id, linhas: [], bases: new Map(), formas: new Set(), vols: new Set(), qtds: new Set(), tokens: new Set(), marcas: new Set(), anvisas: new Set(), precos: [], nGanhos: 0, quals: {}, dims: new Set(), teor: new Set(), temMedida: false }));
  linhas.forEach((l) => {
    const P = l.prod && porProd.get(l.prod);
    if (!P) return;
    const c = caracteristicas(l.desc, l.unidade);
    l.c = c;
    P.linhas.push(l);
    P.bases.set(c.base, (P.bases.get(c.base) || 0) + 1);
    if (c.forma) P.formas.add(c.forma);
    if (c.vol) P.vols.add(c.vol);
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

  // Ligações entre produtos com a mesma base
  const balde = new Map();
  prods.forEach((P) => { if (!balde.has(P.base)) balde.set(P.base, []); balde.get(P.base).push(P); });
  const arestas = [];
  const nivel = (A, B) => {
    if (disj(A.formas, B.formas) || disj(A.vols, B.vols) || disj(A.qtds, B.qtds) || disj(A.dims, B.dims) || disj(A.teor, B.teor)) return null;
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
  return { certos, provaveis, sozinhos, sugestoes, cobertura: { ganhos: ganhosL.length, comCusto, emGrupo, comSaldo: comSaldo.length, saldoSemCusto, produtos: prods.filter((P) => P.nGanhos).length } };
}

const resumo = (P) => {
  const l = P.linhas[0];
  return { nome: P.p.nome, desc: l ? l.desc : "", marcas: [...P.marcas].slice(0, 3).join(", "), n: P.linhas.length, ganhos: P.nGanhos, med: P.med, custo: P.p.custo_atual };
};
// Para onde juntar: o produto com custo, senão o que tem mais descrições
const alvoDe = (lista) => [...lista].sort((a, b) => (b.p.custo_atual != null) - (a.p.custo_atual != null) || b.linhas.length - a.linhas.length)[0];

function LinhaProd({ P, marcado, onMarca, verCusto }) {
  const r = resumo(P);
  return (
    <tr>
      {onMarca && <td><input type="checkbox" checked={marcado} onChange={(e) => onMarca(e.target.checked)} aria-label={`Incluir ${r.nome}`} /></td>}
      <td style={{ minWidth: 200 }}><b>{r.nome}</b><div className="hint clamp2">{r.desc}</div></td>
      <td className="n">{r.n}{r.ganhos ? <div className="hint">{r.ganhos} 🏆</div> : null}</td>
      <td className="n">{r.med != null ? brl(r.med) : "—"}</td>
      <td>{r.marcas || "—"}</td>
      {verCusto && <td className="n">{r.custo != null ? brl(r.custo) : <span className="hint">sem custo</span>}</td>}
    </tr>
  );
}

export default function LigarProdutos({ dados, podeCat, verCusto, notify, onFeito }) {
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
      notify(feitos ? `${feitos} grupo(s) juntado(s).` : "Nada marcado para juntar.");
      setTira({});
      onFeito();
    } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };
  const ligar = async (P, Q) => {
    const { error } = await sb.rpc("juntar_produtos", { p_para: Q.id, p_de: [P.id] });
    if (error) return notify(errMsg(error));
    notify(`“${P.p.nome}” ligado a “${Q.p.nome}”.`);
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
        {[["certeza", `✅ Certeza (${a.certos.length})`], ["provavel", `🟡 Provável (${a.provaveis.length})`], ["sozinhos", `⚪ Sem par (${a.sozinhos.length})`]].map(([k, l]) => (
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
      {aba && (aba === "certeza" ? a.certos : aba === "provavel" ? a.provaveis : a.sozinhos).length > lim && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setLim((l) => l + 50)}>Mostrar mais</button>
      )}
    </div>
  );
}
