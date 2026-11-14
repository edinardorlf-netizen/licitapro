// =====================================================================
// LicitaPro · Produtos → "Juntar por palavras-chave"
// O usuário digita palavras (ex.: "luva procedimento latex") e, se quiser,
// palavras que NÃO podem aparecer (ex.: "nitrilo vinil"). O app acha todos os
// itens (vencidos e cotados) que batem, separa por tamanho e embalagem e
// compara os preços: item com preço muito fora do padrão do grupo vem
// desmarcado (pode ser outra embalagem ou outro produto). O usuário confere e
// junta; a regra fica gravada e itens novos entram sozinhos.
// =====================================================================
import React, { useState, useMemo } from "react";
import { sb, brl, num, errMsg } from "./util.js";
import { palavrasDe, palavrasBatem, tamanho, embalagemDe, NOME_EMB, chaveRegra } from "./produtos.js";

const ORDEM_TAM = ["PP", "P", "M", "G", "GG", "XG", "EG", "XGG"];
const mediana = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const FORA = 2.5; // preço acima de 2,5× ou abaixo de 1/2,5 da mediana do grupo = fora do padrão
const cap = (s) => s.toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function UnificarProdutos({ dados, podeCat, notify, onFeito }) {
  const [txt, setTxt] = useState("");
  const [semTxt, setSemTxt] = useState("");
  const [busca, setBusca] = useState(null); // { palavras, sem }
  const [tira, setTira] = useState({}); // id → true (desmarcado à mão) / false (marcado à mão)
  const [nomes, setNomes] = useState({});
  const [busy, setBusy] = useState("");

  const prodNome = useMemo(() => new Map((dados.produtos || []).map((p) => [p.id, p])), [dados]);

  const grupos = useMemo(() => {
    if (!busca) return [];
    const { palavras, sem } = busca;
    const ganhosItem = new Set(dados.ganhos.map((g) => g.item_id).filter(Boolean));
    const linhas = [
      ...dados.ganhos.map((g) => ({ id: g.id, tipo: "ganho", desc: g.descricao, unidade: g.unidade, preco: g.valor_unitario != null ? Number(g.valor_unitario) : null, marca: g.marca, prod: g.produto_id, onde: g.processos ? `${g.processos.orgao}${g.processos.numero ? ` · ${g.processos.numero}` : ""}` : "—", numero: g.numero })),
      ...dados.itens.filter((i) => !ganhosItem.has(i.id)).map((i) => ({ id: i.id, tipo: "item", desc: i.descricao, unidade: i.unidade, preco: i.preco_unit != null ? Number(i.preco_unit) : null, marca: i.marca, prod: i.produto_id, onde: "cotado / em disputa", numero: i.numero })),
    ].filter((l) => palavrasBatem(l.desc, palavras, sem));
    const m = new Map();
    linhas.forEach((l) => {
      const tam = tamanho(l.desc), emb = embalagemDe(l.unidade);
      const k = `${tam || "-"}|${emb}`;
      if (!m.has(k)) m.set(k, { k, tam, emb, linhas: [] });
      m.get(k).linhas.push(l);
    });
    return [...m.values()].map((g) => {
      const med = mediana(g.linhas.map((l) => l.preco).filter((v) => v > 0));
      g.linhas.forEach((l) => { l.fora = med != null && l.preco > 0 && (l.preco > med * FORA || l.preco < med / FORA); });
      const custos = [...new Set(g.linhas.map((l) => l.prod).filter(Boolean))].map((id) => prodNome.get(id)).filter((p) => p && p.custo_atual != null);
      const precos = g.linhas.map((l) => l.preco).filter((v) => v > 0);
      return { ...g, med, menor: precos.length ? Math.min(...precos) : null, maior: precos.length ? Math.max(...precos) : null, custos,
        chave: chaveRegra({ palavras, sem, tam: g.tam, emb: g.emb }),
        nomePadrao: [cap(palavras.join(" ")), g.tam && g.tam !== "VÁRIOS" ? (/^\d/.test(g.tam) ? `nº ${g.tam}` : `tamanho ${g.tam}`) : null, g.emb !== "UN" ? `(${NOME_EMB[g.emb]})` : null].filter(Boolean).join(" ") };
    }).sort((a, b) => {
      const ia = a.tam === "VÁRIOS" ? 999 : a.tam == null ? 998 : ORDEM_TAM.includes(a.tam) ? ORDEM_TAM.indexOf(a.tam) : 100 + parseFloat(a.tam.replace(",", "."));
      const ib = b.tam === "VÁRIOS" ? 999 : b.tam == null ? 998 : ORDEM_TAM.includes(b.tam) ? ORDEM_TAM.indexOf(b.tam) : 100 + parseFloat(b.tam.replace(",", "."));
      return ia - ib || a.emb.localeCompare(b.emb);
    });
  }, [busca, dados, prodNome]);

  const marcado = (l) => (tira[l.id] != null ? !tira[l.id] : !l.fora);
  const buscar = () => {
    const palavras = palavrasDe(txt);
    if (!palavras.length) return notify("Digite pelo menos uma palavra (ex.: luva procedimento latex).");
    setBusca({ palavras, sem: palavrasDe(semTxt) }); setTira({}); setNomes({});
  };

  const juntar = async (lista) => {
    setBusy("Juntando…");
    let feitos = 0;
    try {
      for (const g of lista) {
        if (g.tam === "VÁRIOS") continue;
        const ls = g.linhas.filter(marcado);
        if (!ls.length) continue;
        const unid = Object.entries(ls.reduce((a, l) => { const u = (l.unidade || "").toUpperCase(); if (u) a[u] = (a[u] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        const { error } = await sb.rpc("unificar_produto", {
          p_nome: (nomes[g.k] ?? g.nomePadrao).trim(), p_chave: g.chave, p_unidade: unid,
          p_itens: ls.filter((l) => l.tipo === "item").map((l) => l.id), p_ganhos: ls.filter((l) => l.tipo === "ganho").map((l) => l.id),
        });
        if (error) throw error;
        feitos++;
      }
      notify(feitos ? `${feitos} produto(s) unificado(s). Itens novos com essas palavras entram sozinhos.` : "Nada marcado para juntar.");
      setBusca(null); setTxt(""); setSemTxt("");
      onFeito();
    } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };

  const total = grupos.reduce((a, g) => a + g.linhas.length, 0);
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div><b>Juntar por palavras-chave</b><div className="hint">Ex.: “luva procedimento latex” junta todas as luvas de procedimento de látex e separa só por tamanho (PP, P, M, G) e embalagem. Compare os preços antes de juntar: preço muito diferente costuma ser outra embalagem ou outro produto.</div></div>
      <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "2 1 260px" }} value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Palavras que precisam aparecer (ex.: luva procedimento latex)" aria-label="Palavras-chave" />
        <input className="input" style={{ flex: "1 1 200px" }} value={semTxt} onChange={(e) => setSemTxt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Sem as palavras (ex.: nitrilo vinil)" aria-label="Palavras que não podem aparecer" />
        <button type="button" className="btn" onClick={buscar}>Procurar</button>
        {busca && <button type="button" className="btn ghost" onClick={() => setBusca(null)}>Fechar</button>}
      </div>
      {busca && (!grupos.length ? <div className="hint">Nenhum item com essas palavras.</div> : <>
        <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><b>{total}</b> itens em <b>{grupos.length}</b> grupo(s) (tamanho × embalagem). Os itens desmarcados não entram.</span>
          {podeCat && <button type="button" className="btn" disabled={!!busy} onClick={() => juntar(grupos)}>{busy || "Juntar todos os grupos"}</button>}
        </div>
        {grupos.map((g) => {
          const nMarc = g.linhas.filter(marcado).length;
          return (
            <div key={g.k} className="card" style={{ padding: 0, borderColor: g.tam === "VÁRIOS" ? "var(--amber)" : undefined }}>
              <div className="row-inline" style={{ padding: "10px 12px", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div className="row-inline" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className="tag ok">{g.tam === "VÁRIOS" ? "⚠ mais de um tamanho" : g.tam ? `Tamanho ${g.tam}` : "Sem tamanho"}</span>
                  <span className="tag">{NOME_EMB[g.emb]}</span>
                  <span className="tag">{g.linhas.length} itens</span>
                  <span className="tag">Preço: mediana {brl(g.med)} · de {brl(g.menor)} a {brl(g.maior)}</span>
                  {g.custos.map((p) => <span key={p.id} className="tag">Custo {brl(p.custo_atual)}{p.custo_marca ? ` (${p.custo_marca})` : ""}</span>)}
                </div>
                {g.tam === "VÁRIOS" ? <span className="hint" style={{ color: "var(--amber)" }}>A descrição cita mais de um tamanho: confira e use “Separar” no produto.</span>
                  : podeCat && <div className="row-inline" style={{ gap: 6 }}>
                    <input className="input" style={{ width: 280 }} value={nomes[g.k] ?? g.nomePadrao} onChange={(e) => setNomes((x) => ({ ...x, [g.k]: e.target.value }))} aria-label="Nome do produto unificado" />
                    <button type="button" className="btn sm" disabled={!!busy || !nMarc} onClick={() => juntar([g])}>Juntar {nMarc}</button>
                  </div>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="itab">
                  <thead><tr><th aria-label="Incluir" /><th>Descrição</th><th>Onde</th><th>Unid.</th><th className="n">Preço</th><th>Marca</th><th>Produto hoje</th></tr></thead>
                  <tbody>
                    {g.linhas.map((l) => (
                      <tr key={l.id} style={l.fora ? { background: "var(--amber-soft)" } : null}>
                        <td><input type="checkbox" checked={marcado(l)} disabled={g.tam === "VÁRIOS"} onChange={(e) => setTira((x) => ({ ...x, [l.id]: !e.target.checked }))} aria-label="Incluir item" /></td>
                        <td style={{ minWidth: 260 }}><div className="clamp2">{l.desc}</div></td>
                        <td className="hint" style={{ minWidth: 140 }}>{l.tipo === "ganho" ? "🏆 " : ""}{l.onde}{l.numero != null ? ` · item ${l.numero}` : ""}</td>
                        <td>{l.unidade || "—"}</td>
                        <td className="n">{l.preco != null ? brl(l.preco) : "—"}{l.fora && <div className="hint" style={{ color: "var(--red)" }}>preço fora do padrão</div>}</td>
                        <td>{l.marca || "—"}</td>
                        <td className="hint">{l.prod ? prodNome.get(l.prod)?.nome || "—" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );
}
