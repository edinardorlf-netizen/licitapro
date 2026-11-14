// =====================================================================
// LicitaPro · aba "Produtos" (catálogo)
// Todos os itens que a empresa trabalha, com os itens parecidos de órgãos
// diferentes juntados num produto só. Para cada produto:
//   quantidade vencida, preço médio de venda (licitações ganhas),
//   custo atual (digitado), maior e menor custo já anotados (com marca),
//   markup e aviso de custo desatualizado (mais de 10 dias).
// O custo daqui alimenta a planilha de cotação dos próximos processos.
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { sb, brl, num, parseNum, fmtIn, fmtData, errMsg } from "./util.js";
import { agrupar, diasDesde, DIAS_CUSTO_VELHO, markup } from "./produtos.js";
import { carregarProdutos, carregarCustos, carregarGanhos, carregarItensNossos } from "./dados.js";

const pct = (v) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

export function MarkupMinimo({ ctx }) {
  const { config, setConfig, admin, notify } = ctx;
  const [v, setV] = useState(config ? fmtIn(config.markup_minimo) : "");
  useEffect(() => { if (config) setV(fmtIn(config.markup_minimo)); }, [config && config.markup_minimo]);
  if (!config) return null;
  const salvar = async () => {
    const n = parseNum(v);
    if (n == null || n < 0 || n > 1000) { notify("Markup mínimo inválido"); setV(fmtIn(config.markup_minimo)); return; }
    if (n === Number(config.markup_minimo)) return;
    const { error } = await sb.from("config").update({ markup_minimo: n }).eq("id", 1);
    if (error) return notify(errMsg(error));
    setConfig({ ...config, markup_minimo: n }); notify(`Markup mínimo aceitável: ${pct(n)}`);
  };
  return (
    <label className="row-inline" style={{ gap: 6 }}>
      <span className="hint">Markup mínimo aceitável:</span>
      {admin ? <input className="input num mini" style={{ width: 70 }} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={salvar} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} aria-label="Markup mínimo aceitável (%)" />
        : <b>{pct(Number(config.markup_minimo))}</b>}
      {admin && <span className="hint">%</span>}
    </label>
  );
}

export default function Catalogo({ ctx }) {
  const { pode, perm, notify, config } = ctx;
  const verCusto = perm("custos");
  const podeCusto = pode && verCusto;
  const podeCat = pode && perm("catalogo");
  const minimo = config ? Number(config.markup_minimo) : 20;
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [agrupando, setAgrupando] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("vencidos");
  const [ordem, setOrdem] = useState("qtd");
  const [limite, setLimite] = useState(100);
  const [aberto, setAberto] = useState(null);
  const [sel, setSel] = useState([]);
  const [rasc, setRasc] = useState({});

  const carregar = async () => {
    try {
      const [produtos, ganhos, itens, custos] = await Promise.all([carregarProdutos(), carregarGanhos(), carregarItensNossos(), verCusto ? carregarCustos() : Promise.resolve([])]);
      setDados({ produtos, ganhos, itens, custos });
      return { produtos, ganhos, itens };
    } catch (e) { setErro(errMsg(e)); return null; }
  };

  // Agrupa sozinho o que ainda não tem produto (itens novos de processos novos)
  const agruparNovos = async (d) => {
    if (!d || !podeCat) return;
    const soltosI = d.itens.filter((i) => !i.produto_id);
    const soltosG = d.ganhos.filter((i) => !i.produto_id);
    if (!soltosI.length && !soltosG.length) return;
    const grupos = agrupar(soltosI, soltosG);
    try {
      for (let i = 0; i < grupos.length; i += 150) {
        setAgrupando(`Agrupando itens parecidos… ${Math.min(i + 150, grupos.length)} de ${grupos.length} grupos`);
        const { error } = await sb.rpc("aplicar_agrupamento", { p_grupos: grupos.slice(i, i + 150) });
        if (error) throw error;
      }
      setAgrupando("");
      await carregar();
    } catch (e) { setAgrupando(""); setErro(errMsg(e)); }
  };
  useEffect(() => { carregar().then(agruparNovos); }, []);

  const linhas = useMemo(() => {
    if (!dados) return [];
    const m = new Map(dados.produtos.map((p) => [p.id, { p, ganhos: [], itens: [], custos: [] }]));
    dados.ganhos.forEach((g) => g.produto_id && m.has(g.produto_id) && m.get(g.produto_id).ganhos.push(g));
    dados.itens.forEach((i) => i.produto_id && m.has(i.produto_id) && m.get(i.produto_id).itens.push(i));
    dados.custos.forEach((c) => m.has(c.produto_id) && m.get(c.produto_id).custos.push(c));
    return [...m.values()].map((x) => {
      const comValor = x.ganhos.filter((g) => g.valor_unitario != null && Number(g.valor_unitario) > 0);
      const vendas = comValor.map((g) => Number(g.valor_unitario));
      const media = vendas.length ? vendas.reduce((a, b) => a + b, 0) / vendas.length : null;
      const qtd = x.ganhos.reduce((a, g) => a + (Number(g.quantidade) || 0), 0);
      const procs = new Set(x.ganhos.map((g) => g.processo_id)).size;
      const ordC = [...x.custos].sort((a, b) => Number(a.valor) - Number(b.valor));
      const menorV = comValor.length ? comValor.reduce((a, b) => (Number(b.valor_unitario) < Number(a.valor_unitario) ? b : a)) : null;
      const maiorV = comValor.length ? comValor.reduce((a, b) => (Number(b.valor_unitario) > Number(a.valor_unitario) ? b : a)) : null;
      const custo = x.p.custo_atual != null ? Number(x.p.custo_atual) : null;
      const idade = diasDesde(x.p.custo_em);
      return {
        ...x, media, qtd, procs, nVendas: vendas.length, menorV, maiorV,
        menorC: ordC[0] || null, maiorC: ordC[ordC.length - 1] || null,
        custo, idade, velho: custo != null && idade != null && idade > DIAS_CUSTO_VELHO,
        mk: markup(media, custo), marcas: [...new Set(x.ganhos.map((g) => g.marca).filter(Boolean))],
      };
    });
  }, [dados]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    let l = linhas.filter((x) => {
      if (filtro === "vencidos" && !x.ganhos.length) return false;
      if (filtro === "sem_custo" && x.custo != null) return false;
      if (filtro === "velho" && !x.velho) return false;
      if (filtro === "abaixo" && !(x.mk != null && x.mk < minimo)) return false;
      if (!t) return true;
      return `${x.p.nome} ${x.marcas.join(" ")} ${x.ganhos.slice(0, 5).map((g) => g.descricao).join(" ")}`.toLowerCase().includes(t);
    });
    const por = { qtd: (a, b) => b.qtd - a.qtd || b.procs - a.procs, nome: (a, b) => a.p.nome.localeCompare(b.p.nome), procs: (a, b) => b.procs - a.procs || b.qtd - a.qtd, idade: (a, b) => (b.idade ?? 9999) - (a.idade ?? 9999) }[ordem];
    return l.sort(por);
  }, [linhas, q, filtro, ordem, minimo]);

  const salvarCusto = async (x) => {
    const r = rasc[x.p.id] || {};
    const valor = parseNum(r.custo != null ? r.custo : "");
    const marca = (r.marca != null ? r.marca : x.p.custo_marca || "").trim() || null;
    if (r.custo == null && r.marca == null) return;
    if (valor == null || valor <= 0) { if (r.custo != null && r.custo.trim() !== "") notify("Custo inválido"); return; }
    if (valor === x.custo && marca === (x.p.custo_marca || null)) { setRasc((o) => { const n = { ...o }; delete n[x.p.id]; return n; }); return; }
    const { error } = await sb.from("produto_custos").insert({ produto_id: x.p.id, valor, marca, anotado_por: ctx.email });
    if (error) return notify(errMsg(error));
    setRasc((o) => { const n = { ...o }; delete n[x.p.id]; return n; });
    notify(`Custo de “${x.p.nome}” atualizado: ${brl(valor)}`);
    carregar();
  };
  const renomear = async (x, nome) => {
    nome = nome.trim();
    if (!nome || nome === x.p.nome) return;
    const { error } = await sb.from("produtos").update({ nome }).eq("id", x.p.id);
    if (error) return notify(errMsg(error));
    carregar();
  };
  const juntar = async () => {
    if (sel.length < 2) return;
    const alvo = [...linhas.filter((x) => sel.includes(x.p.id))].sort((a, b) => b.ganhos.length + b.itens.length - (a.ganhos.length + a.itens.length))[0];
    const { error } = await sb.rpc("juntar_produtos", { p_para: alvo.p.id, p_de: sel });
    if (error) return notify(errMsg(error));
    notify(`${sel.length} produtos juntados em “${alvo.p.nome}”`); setSel([]); setAberto(alvo.p.id); carregar();
  };
  const separar = async (tipo, i) => {
    const { error } = await sb.rpc("separar_item", { p_item: tipo === "item" ? i.id : null, p_ganho: tipo === "ganho" ? i.id : null, p_nome: String(i.descricao || "").slice(0, 80) });
    if (error) return notify(errMsg(error));
    notify("Item separado em um produto próprio"); carregar();
  };

  if (erro) return <div className="stack"><div className="top"><div><h1>Produtos</h1></div></div><div className="banner err" role="alert">{erro}</div></div>;
  const comCusto = linhas.filter((x) => x.custo != null).length;
  const velhos = linhas.filter((x) => x.velho).length;
  const mks = linhas.filter((x) => x.mk != null && x.ganhos.length).map((x) => x.mk);
  const mkMedio = mks.length ? mks.reduce((a, b) => a + b, 0) / mks.length : null;

  return (
    <div className="stack">
      <div className="top"><div><h1>Produtos</h1><p>Itens parecidos de todos os processos juntados num produto: preço médio de venda, custo atual e markup</p></div></div>
      {agrupando && <div className="banner info"><span className="spin" /> {agrupando}</div>}
      {!dados ? <div className="card empty">Carregando…</div> : (
        <>
          <div className="grid3">
            <div className="card kpi"><small>Produtos</small><b className="num">{linhas.length}</b><small>{linhas.filter((x) => x.ganhos.length).length} com itens vencidos</small></div>
            {verCusto && <div className="card kpi"><small>Com custo</small><b className="num">{comCusto}</b><small style={{ color: velhos ? "var(--red)" : undefined }}>{velhos ? `${velhos} com custo desatualizado (mais de ${DIAS_CUSTO_VELHO} dias)` : "Custos em dia"}</small></div>}
            {verCusto && <div className="card kpi"><small>Markup médio (venda média × custo atual)</small><b className="num" style={{ color: mkMedio != null && mkMedio < minimo ? "var(--red)" : undefined }}>{pct(mkMedio)}</b><small><MarkupMinimo ctx={ctx} /></small></div>}
          </div>
          <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="chips">
              {[["vencidos", "Com itens vencidos"], ["todos", "Todos"], ...(verCusto ? [["sem_custo", "Sem custo"], ["velho", "Custo desatualizado"], ["abaixo", "Markup abaixo do mínimo"]] : [])].map(([k, l]) => (
                <button key={k} className={`chip${filtro === k ? " on" : ""}`} onClick={() => { setFiltro(k); setLimite(100); }}>{l}</button>
              ))}
            </div>
            <div className="row-inline">
              <select className="input" style={{ width: "auto", height: 36 }} value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
                <option value="qtd">Mais vendidos (quantidade)</option><option value="procs">Mais processos</option><option value="nome">Nome</option>{verCusto && <option value="idade">Custo mais antigo</option>}
              </select>
              <input className="input" style={{ maxWidth: 260 }} value={q} onChange={(e) => { setQ(e.target.value); setLimite(100); }} placeholder="Buscar produto ou marca" aria-label="Buscar produto" />
            </div>
          </div>
          {podeCat && sel.length > 0 && (
            <div className="banner info" style={{ justifyContent: "space-between" }}>
              <span>{sel.length} produto(s) selecionado(s). Juntar quando forem a mesma coisa com descrições diferentes.</span>
              <span className="row-inline"><button className="btn sm" disabled={sel.length < 2} onClick={juntar}>Juntar selecionados</button><button className="btn ghost sm" onClick={() => setSel([])}>Limpar</button></span>
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="itab">
                <thead><tr>
                  {podeCat && <th aria-label="Selecionar" />}
                  <th>Produto</th><th className="n">Qtd vencida</th><th className="n">Processos</th><th className="n">Venda média unit.</th>
                  {verCusto && <><th className="n">Custo atual</th><th>Marca do custo</th><th>Atualizado</th><th className="n">Menor custo</th><th className="n">Maior custo</th><th className="n">Markup</th></>}
                </tr></thead>
                <tbody>
                  {filtradas.slice(0, limite).map((x) => {
                    const r = rasc[x.p.id] || {};
                    const abaixo = x.mk != null && x.mk < minimo;
                    return (
                      <React.Fragment key={x.p.id}>
                        <tr>
                          {podeCat && <td><input type="checkbox" checked={sel.includes(x.p.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, x.p.id] : s.filter((y) => y !== x.p.id)))} aria-label={`Selecionar ${x.p.nome}`} /></td>}
                          <td style={{ minWidth: 220 }}>
                            <button type="button" className="linkbtn" style={{ textAlign: "left", fontWeight: 600 }} onClick={() => setAberto(aberto === x.p.id ? null : x.p.id)}>{aberto === x.p.id ? "▾ " : "▸ "}{x.p.nome}</button>
                            <div className="hint">{x.p.unidade || ""}{x.ganhos.length + x.itens.length > 1 ? ` · ${x.ganhos.length + x.itens.length} descrições juntadas` : ""}{x.marcas.length ? ` · ${x.marcas.slice(0, 3).join(", ")}` : ""}</div>
                          </td>
                          <td className="n">{x.qtd ? num(x.qtd) : "—"}</td>
                          <td className="n">{x.procs || "—"}</td>
                          <td className="n">{x.media != null ? brl(x.media) : "—"}{x.nVendas > 1 && <div className="hint">{x.nVendas} vendas</div>}</td>
                          {verCusto && <>
                            <td className="n">{podeCusto ? <input className="input num mini" inputMode="decimal" style={{ width: 92, borderColor: x.velho ? "var(--red)" : undefined }} value={r.custo != null ? r.custo : fmtIn(x.custo)}
                              onChange={(e) => setRasc((o) => ({ ...o, [x.p.id]: { ...(o[x.p.id] || {}), custo: e.target.value } }))} onBlur={() => salvarCusto(x)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} placeholder="0,00" aria-label={`Custo atual de ${x.p.nome}`} /> : brl(x.custo)}</td>
                            <td>{podeCusto ? <input className="input mini" style={{ width: 110 }} value={r.marca != null ? r.marca : x.p.custo_marca || ""}
                              onChange={(e) => setRasc((o) => ({ ...o, [x.p.id]: { ...(o[x.p.id] || {}), marca: e.target.value } }))} onBlur={() => salvarCusto(x)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} aria-label={`Marca do custo de ${x.p.nome}`} /> : x.p.custo_marca || "—"}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{x.custo == null ? <span className="hint">sem custo</span> : x.velho ? <span style={{ color: "var(--red)", fontWeight: 600 }}>⚠ desatualizado ({x.idade} dias)</span> : <span className="hint">{x.idade === 0 ? "hoje" : `há ${x.idade} dia(s)`}</span>}</td>
                            <td className="n">{x.menorC ? <>{brl(x.menorC.valor)}<div className="hint">{x.menorC.marca || "sem marca"} · {fmtData(x.menorC.anotado_em)}</div></> : "—"}</td>
                            <td className="n">{x.maiorC ? <>{brl(x.maiorC.valor)}<div className="hint">{x.maiorC.marca || "sem marca"} · {fmtData(x.maiorC.anotado_em)}</div></> : "—"}</td>
                            <td className="n" style={{ color: abaixo ? "var(--red)" : x.mk != null ? "var(--green)" : undefined, fontWeight: 600 }}>{pct(x.mk)}{abaixo && <div className="hint" style={{ color: "var(--red)" }}>abaixo do mínimo</div>}</td>
                          </>}
                        </tr>
                        {aberto === x.p.id && (
                          <tr><td colSpan={podeCat ? (verCusto ? 11 : 5) : (verCusto ? 10 : 4)} style={{ background: "var(--surface-2, #f6f8fa)" }}>
                            <Detalhe x={x} podeCat={podeCat} renomear={renomear} separar={separar} verCusto={verCusto} />
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filtradas.length && <div className="empty">Nenhum produto neste filtro.</div>}
            {filtradas.length > limite && <div style={{ padding: 12 }}><button className="btn ghost sm" onClick={() => setLimite((l) => l + 200)}>Mostrar mais ({filtradas.length - limite} restantes)</button></div>}
          </div>
          <p className="hint">Como os itens são juntados: pelo nome do produto (as primeiras palavras da descrição, sem tamanho P/M/G) e pelas medidas e dosagens (10 ml, 500 mg, 25x7…). Se dois produtos forem a mesma coisa, marque e clique em “Juntar”; se um item caiu no produto errado, abra o produto e use “Separar”. O que for ajustado à mão não é desfeito. O preço médio usa só as licitações vencidas.</p>
        </>
      )}
    </div>
  );
}

function Detalhe({ x, podeCat, renomear, separar, verCusto }) {
  const [nome, setNome] = useState(x.p.nome);
  return (
    <div className="stack" style={{ gap: 10, padding: "6px 2px" }}>
      {podeCat && (
        <div className="row-inline">
          <input className="input" style={{ maxWidth: 420 }} value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do produto" />
          <button className="btn ghost sm" onClick={() => renomear(x, nome)} disabled={!nome.trim() || nome.trim() === x.p.nome}>Renomear</button>
        </div>
      )}
      {x.ganhos.length > 0 && (
        <div className="row-inline" style={{ gap: 14 }}>
          <span className="hint">Menor venda: <b>{x.menorV ? `${brl(x.menorV.valor_unitario)} (${x.menorV.marca || "sem marca"}, ${x.menorV.processos ? x.menorV.processos.orgao : ""})` : "—"}</b></span>
          <span className="hint">Maior venda: <b>{x.maiorV ? `${brl(x.maiorV.valor_unitario)} (${x.maiorV.marca || "sem marca"}, ${x.maiorV.processos ? x.maiorV.processos.orgao : ""})` : "—"}</b></span>
        </div>
      )}
      <table className="itab">
        <thead><tr><th>Situação</th><th>Processo</th><th>Item</th><th>Descrição no edital</th><th className="n">Qtd</th><th className="n">Valor unit.</th><th>Marca</th>{podeCat && <th />}</tr></thead>
        <tbody>
          {x.ganhos.map((g) => (
            <tr key={"g" + g.id}>
              <td><span className="tag ok">🏆 vencido</span></td>
              <td style={{ minWidth: 150 }}>{g.processos ? `${g.processos.orgao}${g.processos.numero ? ` · ${g.processos.numero}` : ""}` : "—"}</td>
              <td>{g.numero}</td>
              <td style={{ minWidth: 240 }}><div className="clamp3">{g.descricao}</div></td>
              <td className="n">{num(g.quantidade)} <span className="hint">{g.unidade || ""}</span></td>
              <td className="n">{brl(g.valor_unitario)}</td>
              <td>{g.marca || "—"}</td>
              {podeCat && <td><button className="linkbtn" style={{ fontSize: 12 }} onClick={() => separar("ganho", g)}>Separar</button></td>}
            </tr>
          ))}
          {x.itens.filter((i) => !x.ganhos.some((g) => g.item_id === i.id)).map((i) => (
            <tr key={"i" + i.id}>
              <td><span className="tag">em disputa / cotado</span></td>
              <td className="hint">—</td>
              <td>{i.numero}</td>
              <td style={{ minWidth: 240 }}><div className="clamp3">{i.descricao}</div></td>
              <td className="n">{num(i.quantidade)} <span className="hint">{i.unidade || ""}</span></td>
              <td className="n">{i.preco_unit != null ? brl(i.preco_unit) : "—"}</td>
              <td>{i.marca || "—"}</td>
              {podeCat && <td><button className="linkbtn" style={{ fontSize: 12 }} onClick={() => separar("item", i)}>Separar</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {verCusto && x.custos.length > 0 && (
        <div className="hint">Custos anotados: {x.custos.slice(0, 8).map((c) => `${brl(c.valor)} ${c.marca ? `(${c.marca})` : ""} em ${fmtData(c.anotado_em)}`).join(" · ")}{x.custos.length > 8 ? " …" : ""}</div>
      )}
    </div>
  );
}
