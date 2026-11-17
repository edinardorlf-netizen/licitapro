// =====================================================================
// LicitaPro · Orçamentos de venda (clientes particulares) + estoque do PDV
// Sub-abas: Novo · Histórico · Clientes · Painel · Estoque · Ajustes. Via do Cliente = página para imprimir/PDF.
// O preço e as validações são refeitos no banco (salvar_orcamento), tudo ou nada.
// Funciona no celular (itens viram cartões).
// =====================================================================
import React, { useState, useEffect, useMemo, useRef } from "react";
import { sb, brl, num, errMsg, fmtDH } from "./util.js";
import { todas } from "./dados.js";
import { carregarExcel } from "./cotacao.js";
import { paginasPdf, lerPaginasPdf, lerExcel, lerCsv, planejar } from "./estoque.js";
import { indiceProdutos, calcularLinha, parcelas, somaDias, dataBR, nOrc, arred2 } from "./orcamento.js";

const CAMPOS_PROD = "id,codigo,codigo_planilha,nome,unidade,marca,categoria,saldo,saldo_em,custo_atual,custo_em,chaves,origem,importacao_id,importado_em";
const carregarProdutosVenda = () => todas(() => sb.from("produtos").select(CAMPOS_PROD).in("origem", ["planilha", "pdv"]).order("nome"));
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const STATUS = ["Em Aberto", "Aprovado", "Recusado"];
const COR_STATUS = { "Em Aberto": "var(--amber)", Aprovado: "var(--green)", Recusado: "var(--red)" };
const linhaVazia = () => ({ codigo: "", qtd: "", preco_manual: "" });
const PADRAO = { markup: 0.54, validade: 7, dias_estoque: 2, vendedores: [], condicoes: ["A combinar"], cabecalho: {} };

export default function Orcamentos({ ctx }) {
  const pode = ctx.alt("orcamentos");
  const celular = ctx.celular;
  const [sub, setSub] = useState("novo");
  const [prods, setProds] = useState(null);
  const [clientes, setClientes] = useState(null);
  const [orcs, setOrcs] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [editando, setEditando] = useState(null); // orçamento sendo alterado
  const [via, setVia] = useState(null); // orçamento na Via do Cliente
  const [erro, setErro] = useState("");

  const carregar = async (so) => {
    try {
      const tarefas = [];
      if (!so || so.includes("prods")) tarefas.push(carregarProdutosVenda().then(setProds));
      if (!so || so.includes("clientes")) tarefas.push(todas(() => sb.from("clientes").select("*").order("nome")).then(setClientes));
      if (!so || so.includes("orcs")) tarefas.push(todas(() => sb.from("orcamentos").select("*").order("numero", { ascending: false })).then(setOrcs));
      if (!so || so.includes("cfg")) tarefas.push(sb.from("orcamentos_config").select("*").maybeSingle().then(({ data, error }) => { if (error) throw error; setCfg({ ...PADRAO, ...((data && data.dados) || {}) }); }));
      await Promise.all(tarefas);
      setErro("");
    } catch (e) { setErro(errMsg(e)); }
  };
  useEffect(() => { carregar(); }, []);

  const abrirVia = async (o) => {
    const [r1, r2] = await Promise.all([
      sb.from("orcamentos").select("*").eq("id", o.id).single(),
      sb.from("orcamento_itens").select("*").eq("orcamento_id", o.id).order("ordem"),
    ]);
    if (r1.error || r2.error) return ctx.notify(errMsg(r1.error || r2.error));
    setVia({ o: r1.data, itens: r2.data || [] });
  };
  const alterar = async (o) => {
    const { data, error } = await sb.from("orcamento_itens").select("*").eq("orcamento_id", o.id).order("ordem");
    if (error) return ctx.notify(errMsg(error));
    setEditando({ o, itens: data || [] });
    setSub("novo");
  };

  const pronto = prods && clientes && orcs && cfg;
  const SUBS = [["novo", editando ? `Alterar Nº ${nOrc(editando.o.numero)}` : "Novo orçamento"], ["historico", "Histórico"], ["clientes", "Clientes"], ["painel", "Painel"], ["estoque", "Estoque"], ["ajustes", "Ajustes"]];

  if (via) return <ViaCliente via={via} cfg={cfg} cliente={(clientes || []).find((c) => c.id === via.o.cliente_id)} onFechar={() => setVia(null)} />;

  return (
    <div className="stack">
      <div className="top"><div><h1>Orçamentos</h1><p>Vendas para clientes particulares, com preço pelo custo e saldo do estoque</p></div></div>
      <div className="seg cats" role="tablist" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {SUBS.filter(([k]) => pode || !["novo", "ajustes"].includes(k)).map(([k, nome]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{nome}</button>
        ))}
      </div>
      {erro && <div className="alerta-lance ruim" role="alert">{erro} <button className="btn ghost sm" onClick={() => carregar()}>Tentar de novo</button></div>}
      {!pronto && !erro && <div className="card empty">Carregando…</div>}
      {pronto && sub === "novo" && pode && (
        <NovoOrcamento key={editando ? editando.o.id : "novo"} ctx={ctx} prods={prods} clientes={clientes} orcs={orcs} cfg={cfg} celular={celular} editando={editando}
          onSalvo={async (r, eraAlteracao) => { await carregar(["orcs"]); if (eraAlteracao) { setEditando(null); setSub("historico"); } return r; }}
          onCancelar={() => { setEditando(null); setSub("historico"); }} onVia={abrirVia} />
      )}
      {pronto && sub === "historico" && <Historico ctx={ctx} pode={pode} orcs={orcs} celular={celular} onMudou={() => carregar(["orcs"])} onVia={abrirVia} onAlterar={alterar} />}
      {pronto && sub === "clientes" && <Clientes ctx={ctx} pode={pode} clientes={clientes} onMudou={() => carregar(["clientes"])} />}
      {pronto && sub === "painel" && <Painel orcs={orcs} cfg={cfg} />}
      {pronto && sub === "estoque" && <Estoque ctx={ctx} pode={pode} prods={prods} cfg={cfg} onMudou={() => carregar(["prods"])} />}
      {pronto && sub === "ajustes" && pode && <AjustesOrc ctx={ctx} cfg={cfg} onMudou={() => carregar(["cfg"])} />}
    </div>
  );
}

/* ---------------- Estoque atualizado em ---------------- */
function avisoEstoque(prods, cfg) {
  let ult = null;
  for (const p of prods) if (p.saldo_em && (!ult || p.saldo_em > ult)) ult = p.saldo_em;
  if (!ult) return { txt: "Estoque ainda não atualizado pelo PDV", velho: true };
  const dias = Math.floor((Date.now() - new Date(ult).getTime()) / 864e5);
  return { txt: `Estoque atualizado em ${new Date(ult).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, velho: dias > Number(cfg.dias_estoque || 2), dias };
}
const FaixaEstoque = ({ prods, cfg }) => {
  const a = avisoEstoque(prods, cfg);
  return <div className="hint" style={{ padding: "6px 10px", borderRadius: 8, background: a.velho ? "#FEF3C7" : "var(--green-soft)", color: a.velho ? "#92400E" : "var(--green)", fontWeight: 600 }}>{a.velho ? "⚠ " : "✓ "}{a.txt}{a.velho && a.dias != null ? ` (há ${a.dias} dias)` : ""}</div>;
};

/* ---------------- Novo / Alterar orçamento ---------------- */
function NovoOrcamento({ ctx, prods, clientes, orcs, cfg, celular, editando, onSalvo, onCancelar, onVia }) {
  const ind = useMemo(() => indiceProdutos(prods), [prods]);
  const ini = editando ? editando.o : null;
  const [clienteId, setClienteId] = useState(ini ? ini.cliente_id || "" : "");
  const [vendedor, setVendedor] = useState(ini ? ini.vendedor : "");
  const [condicao, setCondicao] = useState(ini ? ini.condicao || "" : (cfg.condicoes || [])[0] || "");
  const [validade, setValidade] = useState(String(ini ? ini.validade_dias : cfg.validade || 7));
  const [obs, setObs] = useState(ini ? ini.obs || "" : "");
  const [linhas, setLinhas] = useState(() => {
    if (editando) {
      const l = editando.itens.map((i) => ({ codigo: i.codigo || "", qtd: String(Number(i.qtd)).replace(".", ","), preco_manual: i.preco_manual ? String(Number(i.valor_unit)).replace(".", ",") : "", antiga: i.codigo ? "" : i.descricao }));
      return [...l, linhaVazia()];
    }
    return [linhaVazia(), linhaVazia(), linhaVazia(), linhaVazia(), linhaVazia()];
  });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(null);
  const [buscar, setBuscar] = useState("");

  const mk = Number(cfg.markup || 0);
  const calc = linhas.map((l) => calcularLinha(ind, mk, l));
  const validas = calc.filter((c) => !c.vazia && !c.erro);
  const total = arred2(validas.reduce((a, c) => a + c.total, 0));
  const cli = clientes.find((c) => c.id === clienteId);
  const proximo = (orcs.reduce((a, o) => Math.max(a, o.numero), 0) || 0) + 1;
  const dataEmissao = ini ? ini.data : hoje();
  const vendedores = [...new Set([...(cfg.vendedores || []).map((v) => v.nome), ...(vendedor ? [vendedor] : [])])];
  const condicoes = [...new Set([...(cfg.condicoes || []), ...(condicao ? [condicao] : [])])];

  const mudar = (i, campo, v) => setLinhas((ls) => {
    const n = ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l));
    const ult = n[n.length - 1];
    if (ult.codigo || ult.qtd) n.push(linhaVazia());
    return n;
  });
  const tirar = (i) => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [linhaVazia()]));

  const salvar = async () => {
    setErro(""); setSalvo(null);
    if (!cli) return setErro("Selecione o cliente antes de salvar.");
    if (!vendedor) return setErro("Selecione o vendedor antes de salvar.");
    const ruim = calc.findIndex((c) => !c.vazia && c.erro);
    if (ruim >= 0) { const c = calc[ruim]; return setErro(`Linha ${ruim + 1}${c.prod ? ` (${c.prod.nome})` : ""}: ${c.erro}.`); }
    if (!validas.length) return setErro("Inclua ao menos um item com quantidade.");
    const numTxt = editando ? `Nº ${nOrc(ini.numero)} (alteração)` : `Nº ${nOrc(proximo)}`;
    if (!window.confirm(`Salvar o orçamento ${numTxt}?\n\nCliente: ${cli.nome}\nItens: ${validas.length}\nTotal: ${brl(total)}`)) return;
    setBusy(true);
    const { data, error } = await sb.rpc("salvar_orcamento", { p: {
      id: editando ? ini.id : null, cliente_id: cli.id, vendedor, condicao, validade_dias: validade, obs,
      itens: linhas.filter((l) => String(l.codigo).trim() || String(l.qtd).trim()).map((l) => ({ codigo: String(l.codigo).trim(), qtd: String(l.qtd).replace(/\./g, "").replace(",", "."), preco_manual: String(l.preco_manual).replace(/\./g, "").replace(",", ".") })),
    } });
    setBusy(false);
    if (error) return setErro(errMsg(error));
    ctx.notify(`Orçamento Nº ${nOrc(data.numero)} ${editando ? "alterado" : "salvo"} · ${brl(data.total)}`);
    if (editando) { onSalvo(data, true); return; }
    // limpa só o que a pessoa digita; validade e condição voltam ao padrão
    setClienteId(""); setVendedor(""); setObs(""); setCondicao((cfg.condicoes || [])[0] || ""); setValidade(String(cfg.validade || 7));
    setLinhas([linhaVazia(), linhaVazia(), linhaVazia(), linhaVazia(), linhaVazia()]);
    setSalvo(data);
    onSalvo(data, false);
  };

  const achados = useMemo(() => {
    const q = buscar.trim().toUpperCase();
    if (q.length < 3) return [];
    const ps = q.split(/\s+/);
    return prods.filter((p) => ps.every((x) => `${p.codigo || ""} ${p.codigo_planilha || ""} ${p.nome} ${p.marca || ""}`.toUpperCase().includes(x))).slice(0, 12);
  }, [buscar, prods]);
  const usarProduto = (p) => {
    const cod = p.codigo || p.codigo_planilha;
    setLinhas((ls) => { const i = ls.findIndex((l) => !l.codigo && !l.qtd); const n = [...ls]; if (i >= 0) n[i] = { ...n[i], codigo: cod }; else n.push({ ...linhaVazia(), codigo: cod }); if (n[n.length - 1].codigo) n.push(linhaVazia()); return n; });
    setBuscar("");
  };

  const campo = (rotulo, el, flex = "1 1 200px") => <label className="stack" style={{ gap: 4, flex, minWidth: 0 }}><span className="hint">{rotulo}</span>{el}</label>;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {salvo && (
        <div className="card row-inline" style={{ gap: 10, flexWrap: "wrap", background: "var(--green-soft)" }}>
          <b>✓ Orçamento Nº {nOrc(salvo.numero)} salvo ({brl(salvo.total)}).</b>
          <button className="btn sm" onClick={() => onVia({ id: salvo.id, ...(orcs.find((o) => o.id === salvo.id) || {}) })}>📄 Via do Cliente</button>
        </div>
      )}
      <div className="card stack" style={{ gap: 12 }}>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
          <b style={{ fontSize: 18 }}>{editando ? `Alterar orçamento Nº ${nOrc(ini.numero)}` : `Orçamento Nº ${nOrc(proximo)}`}</b>
          <span className="hint">Emissão {dataBR(dataEmissao)} · válido até {dataBR(somaDias(dataEmissao, validade))} · markup {Math.round(mk * 10000) / 100}%</span>
        </div>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {campo("Cliente *", <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Escolha…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>, "2 1 260px")}
          {campo("Vendedor *", <select className="input" value={vendedor} onChange={(e) => setVendedor(e.target.value)}><option value="">Escolha…</option>{vendedores.map((v) => <option key={v}>{v}</option>)}</select>)}
          {campo("Condição de pagamento", <select className="input" value={condicao} onChange={(e) => setCondicao(e.target.value)}>{condicoes.map((v) => <option key={v}>{v}</option>)}</select>)}
          {campo("Validade (dias)", <input className="input" inputMode="numeric" value={validade} onChange={(e) => setValidade(e.target.value.replace(/\D/g, ""))} />, "0 1 110px")}
        </div>
        {cli && <div className="hint">{[cli.cnpj_cpf && `CNPJ/CPF ${cli.cnpj_cpf}`, cli.endereco, cli.telefone && `Tel. ${cli.telefone}`, cli.email].filter(Boolean).join(" · ") || "Cliente sem dados de contato"}</div>}
        {campo("Observações", <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />, "1 1 100%")}
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
          <b>Itens</b>
          <FaixaEstoque prods={prods} cfg={cfg} />
        </div>
        <div style={{ position: "relative" }}>
          <input className="input" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="🔎 Procurar produto por nome, marca ou código (opcional)" />
          {achados.length > 0 && (
            <div className="card" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, top: "100%", maxHeight: 300, overflowY: "auto", padding: 4 }}>
              {achados.map((p) => (
                <button key={p.id} type="button" className="btn ghost sm" style={{ display: "flex", width: "100%", justifyContent: "space-between", textAlign: "left", gap: 8 }} onClick={() => usarProduto(p)}>
                  <span><b>{p.codigo || p.codigo_planilha}</b> {p.nome} <span className="hint">{p.marca || ""}</span></span>
                  <span className="hint">saldo {p.saldo == null ? "—" : num(p.saldo)} · {p.custo_atual ? brl(arred2(p.custo_atual * (1 + mk))) : "sem custo"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {celular ? (
          <div className="stack" style={{ gap: 8 }}>
            {linhas.map((l, i) => { const c = calc[i]; return (
              <div key={i} className="stack" style={{ gap: 6, padding: 10, border: "1px solid var(--line-2)", borderRadius: 10, background: c.erro ? "var(--red-soft)" : undefined }}>
                <div className="row-inline" style={{ gap: 6 }}>
                  <input className="input" style={{ flex: "1 1 0" }} placeholder="Código" value={l.codigo} onChange={(e) => mudar(i, "codigo", e.target.value)} />
                  <input className="input" style={{ flex: "1 1 0" }} placeholder="Qtd" inputMode="decimal" value={l.qtd} onChange={(e) => mudar(i, "qtd", e.target.value)} />
                  <input className="input" style={{ flex: "1 1 0" }} placeholder="Preço manual" inputMode="decimal" value={l.preco_manual} onChange={(e) => mudar(i, "preco_manual", e.target.value)} />
                  <button type="button" className="btn ghost sm" aria-label="Tirar linha" onClick={() => tirar(i)}>✕</button>
                </div>
                {c.prod && <div style={{ fontSize: 13 }}><b>{c.prod.nome}</b> <span className="hint">{c.prod.unidade || ""} · {c.prod.marca || "sem marca"} · saldo {c.prod.saldo == null ? "—" : num(c.prod.saldo)}</span></div>}
                {l.antiga && !l.codigo && <div className="hint">Item antigo: {l.antiga} (informe o código)</div>}
                {!c.vazia && (c.erro ? <div style={{ color: "var(--red)", fontSize: 13 }}>{c.erro}</div> : <div className="row-inline" style={{ justifyContent: "space-between" }}><span>{brl(c.unit)} × {num(c.qtd)}</span><b>{brl(c.total)}</b></div>)}
                {c.aviso && <div style={{ color: "var(--amber)", fontSize: 13 }}>⚠ {c.aviso}</div>}
              </div>
            ); })}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="itab">
              <thead><tr><th>#</th><th style={{ width: 100 }}>Código</th><th>Descrição</th><th>Marca</th><th>Unid.</th><th className="n">Saldo</th><th style={{ width: 90 }}>Qtd</th><th style={{ width: 110 }}>Preço manual</th><th className="n">Unitário</th><th className="n">Total</th><th /></tr></thead>
              <tbody>
                {linhas.map((l, i) => { const c = calc[i]; return (
                  <tr key={i} style={c.erro ? { background: "var(--red-soft)" } : null}>
                    <td className="hint">{i + 1}</td>
                    <td><input className="input" style={{ width: 90 }} value={l.codigo} onChange={(e) => mudar(i, "codigo", e.target.value)} aria-label={`Código linha ${i + 1}`} /></td>
                    <td style={{ minWidth: 220 }}>{c.prod ? c.prod.nome : l.antiga && !l.codigo ? <span className="hint">Item antigo: {l.antiga} (informe o código)</span> : ""}{c.erro && <div style={{ color: "var(--red)", fontSize: 12 }}>{c.erro}</div>}{c.aviso && <div style={{ color: "var(--amber)", fontSize: 12 }}>⚠ {c.aviso}</div>}</td>
                    <td>{c.prod ? c.prod.marca || "—" : ""}</td>
                    <td>{c.prod ? c.prod.unidade || "—" : ""}</td>
                    <td className="n">{c.prod ? (c.prod.saldo == null ? "—" : num(c.prod.saldo)) : ""}</td>
                    <td><input className="input" style={{ width: 80 }} inputMode="decimal" value={l.qtd} onChange={(e) => mudar(i, "qtd", e.target.value)} aria-label={`Quantidade linha ${i + 1}`} /></td>
                    <td><input className="input" style={{ width: 100 }} inputMode="decimal" value={l.preco_manual} onChange={(e) => mudar(i, "preco_manual", e.target.value)} aria-label={`Preço manual linha ${i + 1}`} /></td>
                    <td className="n">{c.unit != null ? brl(c.unit) : ""}</td>
                    <td className="n"><b>{c.total != null ? brl(c.total) : ""}</b></td>
                    <td>{(l.codigo || l.qtd) && <button type="button" className="btn ghost sm" aria-label="Tirar linha" onClick={() => tirar(i)}>✕</button>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span className="hint">{validas.length} {validas.length === 1 ? "item" : "itens"} · o código aceita o do sistema ou o da planilha (P0000)</span>
          <b style={{ fontSize: 20 }}>Total {brl(total)}</b>
        </div>
        {parcelas(condicao, total, dataEmissao).length > 1 && <div className="hint">Parcelas: {parcelas(condicao, total, dataEmissao).map((p) => `${dataBR(p.data)} – ${brl(p.valor)}`).join("  |  ")}</div>}
        {erro && <div className="alerta-lance ruim" role="alert">{erro}</div>}
        <div className="row-inline" style={{ gap: 8 }}>
          <button className="btn" onClick={salvar} disabled={busy}>{busy ? <span className="spin" /> : null}{editando ? "Substituir orçamento" : "Salvar orçamento"}</button>
          {editando && <button className="btn ghost" onClick={onCancelar} disabled={busy}>Cancelar alteração</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Histórico ---------------- */
function Historico({ ctx, pode, orcs, celular, onMudou, onVia, onAlterar }) {
  const [filtro, setFiltro] = useState("");
  const [q, setQ] = useState("");
  const lista = orcs.filter((o) => (!filtro || o.status === filtro) && (!q || `${o.numero} ${o.cliente_nome} ${o.vendedor}`.toUpperCase().includes(q.toUpperCase())));
  const mudarStatus = async (o, status) => {
    const { error } = await sb.from("orcamentos").update({ status, data_resposta: status === "Em Aberto" ? null : hoje() }).eq("id", o.id);
    if (error) return ctx.notify(errMsg(error));
    ctx.notify(`Orçamento Nº ${nOrc(o.numero)}: ${status}`); onMudou();
  };
  const mudarObs = async (o) => {
    const v = window.prompt(`Observações do orçamento Nº ${nOrc(o.numero)}`, o.obs || "");
    if (v == null) return;
    const { error } = await sb.from("orcamentos").update({ obs: v.trim() || null }).eq("id", o.id);
    if (error) return ctx.notify(errMsg(error)); onMudou();
  };
  const apagar = async (o) => {
    if (!window.confirm(`Apagar o orçamento Nº ${nOrc(o.numero)} (${o.cliente_nome}, ${brl(o.total)})? Isso não pode ser desfeito.`)) return;
    const { error } = await sb.from("orcamentos").delete().eq("id", o.id);
    if (error) return ctx.notify(errMsg(error)); onMudou();
  };
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "1 1 200px" }} placeholder="Procurar nº, cliente ou vendedor" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ flex: "0 1 160px" }} value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todos os status</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      {!lista.length && <div className="empty">Nenhum orçamento.</div>}
      <div className="stack" style={{ gap: 8 }}>
        {lista.map((o) => (
          <div key={o.id} className="row-inline" style={{ gap: 10, flexWrap: "wrap", padding: "10px 12px", border: "1px solid var(--line-2)", borderRadius: 10 }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <b>Nº {nOrc(o.numero)}</b> · {o.cliente_nome}
              <div className="hint">{dataBR(o.data)} · {o.vendedor} · {o.condicao || "sem condição"} · válido até {dataBR(somaDias(o.data, o.validade_dias))}{o.data_resposta ? ` · resposta ${dataBR(o.data_resposta)}` : ""}</div>
              {o.obs && <div className="hint">📝 {o.obs}</div>}
            </div>
            <b style={{ minWidth: 110, textAlign: "right" }}>{brl(o.total)}</b>
            {pode ? (
              <select className="input" style={{ width: 130, color: COR_STATUS[o.status], fontWeight: 700 }} value={o.status} onChange={(e) => mudarStatus(o, e.target.value)} aria-label="Status">{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
            ) : <span className="tag" style={{ color: COR_STATUS[o.status] }}>{o.status}</span>}
            <div className="row-inline" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className="btn ghost sm" onClick={() => onVia(o)}>📄 Via do Cliente</button>
              {pode && <button className="btn ghost sm" onClick={() => onAlterar(o)}>Alterar</button>}
              {pode && <button className="btn ghost sm" onClick={() => mudarObs(o)}>Obs.</button>}
              {ctx.admin && !celular && <button className="btn ghost sm" style={{ color: "var(--red)" }} onClick={() => apagar(o)}>Apagar</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Clientes ---------------- */
function Clientes({ ctx, pode, clientes, onMudou }) {
  const vazio = { nome: "", cnpj_cpf: "", endereco: "", telefone: "", email: "", obs: "" };
  const [f, setF] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!f.nome.trim()) return ctx.notify("Informe o nome do cliente.");
    setBusy(true);
    const dados = Object.fromEntries(Object.entries(vazio).map(([k]) => [k, String(f[k] || "").trim() || null]));
    const { error } = f.id ? await sb.from("clientes").update(dados).eq("id", f.id) : await sb.from("clientes").insert(dados);
    setBusy(false);
    if (error) return ctx.notify(errMsg(error));
    ctx.notify(f.id ? "Cliente atualizado" : "Cliente cadastrado"); setF(null); onMudou();
  };
  const lista = clientes.filter((c) => !q || `${c.codigo} ${c.nome} ${c.cnpj_cpf || ""}`.toUpperCase().includes(q.toUpperCase()));
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "1 1 200px" }} placeholder="Procurar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        {pode && <button className="btn sm" onClick={() => setF({ ...vazio })}>+ Novo cliente</button>}
      </div>
      {f && (
        <div className="stack" style={{ gap: 8, padding: 12, border: "1px solid var(--line-2)", borderRadius: 10 }}>
          <b>{f.id ? `Cliente ${f.codigo}` : "Novo cliente"}</b>
          {[["nome", "Nome / razão social *"], ["cnpj_cpf", "CNPJ/CPF"], ["endereco", "Endereço"], ["telefone", "Telefone"], ["email", "E-mail"], ["obs", "Observações"]].map(([k, r]) => (
            <label key={k} className="stack" style={{ gap: 4 }}><span className="hint">{r}</span><input className="input" value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
          <div className="row-inline" style={{ gap: 8 }}><button className="btn sm" onClick={salvar} disabled={busy}>Salvar</button><button className="btn ghost sm" onClick={() => setF(null)}>Cancelar</button></div>
        </div>
      )}
      {lista.map((c) => (
        <div key={c.id} className="row-inline" style={{ gap: 10, flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
          <span className="hint" style={{ width: 34 }}>{c.codigo}</span>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}><b>{c.nome}</b><div className="hint">{[c.cnpj_cpf, c.endereco, c.telefone, c.email].filter(Boolean).join(" · ") || "—"}</div></div>
          {pode && <button className="btn ghost sm" onClick={() => setF({ ...c })}>Editar</button>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Painel ---------------- */
function Painel({ orcs, cfg }) {
  const n = orcs.length;
  const cont = (s) => orcs.filter((o) => o.status === s).length;
  const soma = (l) => l.reduce((a, o) => a + Number(o.total || 0), 0);
  const aprov = orcs.filter((o) => o.status === "Aprovado");
  const vends = [...(cfg.vendedores || [])];
  orcs.forEach((o) => { if (!vends.some((v) => v.nome === o.vendedor)) vends.push({ nome: o.vendedor, comissao: null }); });
  return (
    <div className="stack">
      <div className="grid3">
        <div className="card kpi"><small>Orçamentos emitidos</small><b className="num">{n}</b><small>{brl(soma(orcs))} orçados</small></div>
        <div className="card kpi"><small>Aprovados</small><b className="num" style={{ color: "var(--green)" }}>{cont("Aprovado")}</b><small>{brl(soma(aprov))} aprovados</small></div>
        <div className="card kpi"><small>Taxa de conversão</small><b className="num">{n ? `${Math.round((cont("Aprovado") / n) * 1000) / 10}%` : "—"}</b><small>aprovados ÷ total</small></div>
        <div className="card kpi"><small>Em aberto</small><b className="num" style={{ color: "var(--amber)" }}>{cont("Em Aberto")}</b><small>{brl(soma(orcs.filter((o) => o.status === "Em Aberto")))}</small></div>
        <div className="card kpi"><small>Recusados</small><b className="num" style={{ color: "var(--red)" }}>{cont("Recusado")}</b><small>{brl(soma(orcs.filter((o) => o.status === "Recusado")))}</small></div>
      </div>
      <div className="card stack" style={{ gap: 8 }}>
        <b>Comissão por vendedor</b>
        <p className="hint" style={{ margin: 0 }}>Só orçamentos com status Aprovado. A taxa de cada vendedor fica em Orçamentos → Ajustes.</p>
        <div style={{ overflowX: "auto" }}>
          <table className="itab">
            <thead><tr><th>Vendedor</th><th className="n">Aprovados</th><th className="n">Vendas fechadas</th><th className="n">Taxa</th><th className="n">Comissão</th></tr></thead>
            <tbody>
              {vends.map((v) => { const l = aprov.filter((o) => o.vendedor === v.nome); const s = soma(l); return (
                <tr key={v.nome}><td>{v.nome}</td><td className="n">{l.length}</td><td className="n">{brl(s)}</td><td className="n">{v.comissao == null ? "—" : `${Math.round(v.comissao * 10000) / 100}%`}</td><td className="n"><b>{v.comissao == null ? "—" : brl(arred2(s * v.comissao))}</b></td></tr>
              ); })}
              <tr><td><b>Total</b></td><td className="n">{aprov.length}</td><td className="n"><b>{brl(soma(aprov))}</b></td><td /><td className="n"><b>{brl(vends.reduce((a, v) => a + (v.comissao == null ? 0 : arred2(soma(aprov.filter((o) => o.vendedor === v.nome)) * v.comissao)), 0))}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Estoque (importar PDF/Excel/CSV do PDV) ---------------- */
function Estoque({ ctx, pode, prods, cfg, onMudou }) {
  const [lido, setLido] = useState(null); // { arquivo, ...leitura, plano }
  const [ausentes, setAusentes] = useState("manter");
  const [busy, setBusy] = useState("");
  const [erro, setErro] = useState("");
  const [resumo, setResumo] = useState(null);
  const [hist, setHist] = useState([]);
  const [q, setQ] = useState("");
  const inp = useRef(null);

  const carregarHist = async () => {
    const { data } = await sb.from("estoque_importacoes").select("id,em,por,arquivo,tipo,lidas,alteradas,criadas,ignoradas,zeradas,desfeita_em,desfeita_por").order("em", { ascending: false }).limit(30);
    setHist(data || []);
  };
  useEffect(() => { carregarHist(); }, []);

  const ler = async (ev) => {
    const arq = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arq) return;
    setErro(""); setLido(null); setResumo(null); setBusy("ler");
    try {
      const buf = await arq.arrayBuffer();
      const nome = arq.name.toLowerCase();
      let r;
      if (nome.endsWith(".pdf")) r = lerPaginasPdf(await paginasPdf(new Uint8Array(buf)));
      else if (/\.(xlsx|xlsm)$/.test(nome)) r = await lerExcel(buf, arq.name, carregarExcel);
      else if (/\.(csv|txt)$/.test(nome)) r = lerCsv(new TextDecoder(/[À-ÿ]/.test(new TextDecoder("utf-8").decode(buf)) ? "utf-8" : "windows-1252").decode(buf), arq.name);
      else throw new Error("Envie PDF, Excel (.xlsx/.xlsm) ou CSV.");
      if (!r.linhas.length) throw new Error("Não achei nenhum produto no arquivo. Nada foi gravado.");
      if (r.naoEntendidas.length > Math.max(20, r.linhas.length * 0.05)) throw new Error(`O arquivo tem ${r.naoEntendidas.length} linhas que não entendi (de ${r.linhas.length + r.naoEntendidas.length}). O layout parece diferente do esperado; nada foi gravado. Exemplo: “${r.naoEntendidas[0].texto}”.`);
      setLido({ ...r, arquivo: arq.name, plano: planejar(r, prods) });
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };

  const importar = async () => {
    const { plano } = lido;
    setBusy("gravar"); setErro("");
    const resumoBase = {
      formato: lido.nome, aba: lido.aba || null,
      nao_entendidas: lido.naoEntendidas.slice(0, 200),
      marcas: plano.mudancas.marca.filter((m) => m.de).map((m) => ({ codigo: m.p.codigo || m.p.codigo_planilha, nome: m.p.nome, de: m.de, para: m.para })),
      unidades: plano.mudancas.unidade.filter((m) => m.de).map((m) => ({ codigo: m.p.codigo || m.p.codigo_planilha, nome: m.p.nome, de: m.de, para: m.para })),
      possiveis: plano.possiveis.map((x) => ({ codigo: x.novo.codigo, codigo_planilha: x.novo.codigo_planilha, nome: x.novo.nome, existente: x.existente, nota: x.nota })),
      duplicadas_arquivo: plano.duplicadasNoArquivo.slice(0, 100).map((l) => `${l.codigo || l.codigo_planilha} ${l.nome}`),
      ausentes: ausentes, ausentes_qtd: plano.ausentes.length,
    };
    const { data, error } = await sb.rpc("importar_estoque", { p: {
      arquivo: lido.arquivo, tipo: lido.tipo, fonte: lido.tipo === "planilha" ? "Planilha" : "PDV", lidas: lido.linhas.length + lido.naoEntendidas.length,
      ignoradas: lido.naoEntendidas.length + plano.duplicadasNoArquivo.length, resumo: resumoBase,
      atualizar: plano.atualizar, criar: plano.criar, zerar: ausentes === "zerar" ? plano.ausentes.map((p) => p.id) : [],
    } });
    setBusy("");
    if (error) return setErro(`${errMsg(error)} — nada foi gravado.`);
    // liga cada possível duplicado ao produto criado
    const criados = data.criados || [];
    const porCod = new Map(criados.map((c) => [c.codigo || c.codigo_planilha || c.nome, c]));
    const possiveis = resumoBase.possiveis.map((x) => ({ ...x, novoId: (porCod.get(x.codigo || x.codigo_planilha || x.nome) || {}).id, novoCp: (porCod.get(x.codigo || x.codigo_planilha || x.nome) || {}).codigo_planilha }));
    setResumo({ ...data, ...resumoBase, possiveis, lidas: lido.linhas.length, arquivo: lido.arquivo });
    setLido(null);
    ctx.notify("Estoque importado");
    carregarHist(); onMudou();
  };

  const desfazer = async (h) => {
    if (!window.confirm(`Desfazer a importação de ${fmtDH(h.em)} (${h.arquivo})?\n\nVolta saldos, marcas e unidades, apaga os custos lançados por ela e os produtos criados por ela que ainda não foram usados em orçamento.`)) return;
    setBusy("desfazer");
    const { data, error } = await sb.rpc("desfazer_importacao", { imp_id: h.id });
    setBusy("");
    if (error) return ctx.notify(errMsg(error));
    ctx.notify(`Importação desfeita: ${data.restaurados} produtos voltaram, ${data.apagados} criados apagados${data.mantidos ? `, ${data.mantidos} mantidos (já usados em orçamento)` : ""}`);
    setResumo(null); carregarHist(); onMudou();
  };

  const juntar = async (x) => {
    if (!x.novoId) return;
    if (!window.confirm(`Juntar o produto novo\n“${x.nome}” (${x.codigo || x.novoCp})\ncom o que já existia\n“${x.existente.nome}” (${x.existente.codigo || x.existente.codigo_planilha})?\n\nFica um só produto; o código do novo continua valendo no orçamento.`)) return;
    const { error } = await sb.rpc("juntar_produto_estoque", { manter: x.existente.id, apagar: x.novoId });
    if (error) return ctx.notify(errMsg(error));
    setResumo((r) => ({ ...r, possiveis: r.possiveis.map((y) => (y === x ? { ...y, juntado: true } : y)) }));
    onMudou();
  };

  const semCusto = prods.filter((p) => !(Number(p.custo_atual) > 0));
  const lista = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (t.length < 2) return [];
    const ps = t.split(/\s+/);
    return prods.filter((p) => ps.every((x) => `${p.codigo || ""} ${p.codigo_planilha || ""} ${p.nome} ${p.marca || ""}`.toUpperCase().includes(x))).slice(0, 60);
  }, [q, prods]);
  const ultimoAtivo = hist.find((h) => !h.desfeita_em);

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}><b>Atualizar estoque</b><FaixaEstoque prods={prods} cfg={cfg} /></div>
        <p className="hint" style={{ margin: 0 }}>Envie o relatório do PDV: PDF “Relação de Custo dos Itens” (saldo e custo), PDF “Listagem de Produtos” (unidade, marca e grupo), ou Excel/CSV com cabeçalho. A planilha antiga de orçamentos (.xlsm) também serve para a carga inicial. Produto que não existe é cadastrado na hora com o próximo código planilha.</p>
        {pode ? (
          <div className="row-inline" style={{ gap: 8 }}>
            <button className="btn" onClick={() => inp.current && inp.current.click()} disabled={!!busy}>{busy === "ler" ? <span className="spin" /> : null}📤 Enviar relatório (PDF, Excel ou CSV)</button>
            <input ref={inp} type="file" accept=".pdf,.xlsx,.xlsm,.csv,.txt" style={{ display: "none" }} onChange={ler} />
          </div>
        ) : <p className="hint">Seu perfil só consulta o estoque.</p>}
        {busy === "ler" && <p className="hint">Lendo o arquivo… (o PDF do PDV tem mais de 100 páginas; leva alguns segundos)</p>}
        {erro && <div className="alerta-lance ruim" role="alert">{erro}</div>}
        {lido && (
          <div className="stack" style={{ gap: 8, padding: 12, border: "1px solid var(--line-2)", borderRadius: 10 }}>
            <b>{lido.arquivo}</b>
            <span className="hint">Formato: {lido.nome}{lido.aba ? ` · aba ${lido.aba}` : ""} · {lido.linhas.length} produtos lidos{lido.naoEntendidas.length ? ` · ${lido.naoEntendidas.length} linha(s) não entendida(s)` : ""}</span>
            <span>Vai atualizar <b>{lido.plano.atualizar.length}</b> produtos e cadastrar <b>{lido.plano.criar.length}</b> novos{lido.plano.semCusto ? ` (${lido.plano.semCusto} sem custo)` : ""}.</span>
            {lido.plano.ausentes.length > 0 && (
              <div className="stack" style={{ gap: 6, padding: 10, background: "#FEF3C7", borderRadius: 8 }}>
                <b>{lido.plano.ausentes.length} produto(s) com saldo não vieram no arquivo. O que fazer com o saldo deles?</b>
                <span className="hint">{lido.plano.ausentes.slice(0, 8).map((p) => `${p.codigo || p.codigo_planilha} ${p.nome} (${num(p.saldo)})`).join(" · ")}{lido.plano.ausentes.length > 8 ? " …" : ""}</span>
                <label className="toggle"><input type="radio" checked={ausentes === "manter"} onChange={() => setAusentes("manter")} />Manter o saldo que já está no sistema</label>
                <label className="toggle"><input type="radio" checked={ausentes === "zerar"} onChange={() => setAusentes("zerar")} />Zerar o saldo deles</label>
              </div>
            )}
            <div className="row-inline" style={{ gap: 8 }}>
              <button className="btn" onClick={importar} disabled={!!busy}>{busy === "gravar" ? <span className="spin" /> : null}Importar agora</button>
              <button className="btn ghost" onClick={() => setLido(null)} disabled={!!busy}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {resumo && <ResumoImportacao r={resumo} onJuntar={pode ? juntar : null} />}

      <div className="card stack" style={{ gap: 8 }}>
        <b>Consultar produto</b>
        <input className="input" placeholder="Código, código planilha, nome ou marca" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="hint">{prods.length} produtos de venda · {semCusto.length} sem custo (bloqueiam o orçamento)</span>
        {lista.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="itab">
              <thead><tr><th>Código</th><th>Cód. planilha</th><th>Descrição</th><th>Marca</th><th>Unid.</th><th className="n">Saldo</th><th className="n">Custo</th><th className="n">Venda</th></tr></thead>
              <tbody>{lista.map((p) => (
                <tr key={p.id} style={!(Number(p.custo_atual) > 0) ? { background: "#FEF3C7" } : null}>
                  <td>{p.codigo || "—"}</td><td>{p.codigo_planilha || "—"}</td><td>{p.nome}{p.origem === "pdv" && p.importado_em ? <span className="hint"> · cadastrado pela importação {dataBR(String(p.importado_em).slice(0, 10))}</span> : null}</td>
                  <td>{p.marca || "—"}</td><td>{p.unidade || "—"}</td><td className="n">{p.saldo == null ? "—" : num(p.saldo)}</td>
                  <td className="n">{Number(p.custo_atual) > 0 ? brl(p.custo_atual) : <b style={{ color: "var(--red)" }}>sem custo</b>}</td>
                  <td className="n">{Number(p.custo_atual) > 0 ? brl(arred2(p.custo_atual * (1 + Number(cfg.markup || 0)))) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <b>Histórico de importações</b>
        {!hist.length && <span className="hint">Nenhuma importação ainda.</span>}
        {hist.map((h) => (
          <div key={h.id} className="row-inline" style={{ gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid var(--line)", opacity: h.desfeita_em ? 0.55 : 1 }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <b>{fmtDH(h.em)}</b> · {h.arquivo}
              <div className="hint">{h.por} · {h.lidas} lidas · {h.alteradas} saldos mudaram · {h.criadas} criados · {h.ignoradas} ignoradas{h.zeradas ? ` · ${h.zeradas} zerados` : ""}{h.desfeita_em ? ` · desfeita em ${fmtDH(h.desfeita_em)}` : ""}</div>
            </div>
            {pode && ultimoAtivo && ultimoAtivo.id === h.id && <button className="btn ghost sm" onClick={() => desfazer(h)} disabled={!!busy}>Desfazer esta importação</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumoImportacao({ r, onJuntar }) {
  const [ver, setVer] = useState("");
  const criados = r.criados || [];
  const semCusto = criados.filter((c) => c.sem_custo);
  const bloco = (k, titulo, n, conteudo) => n > 0 && (
    <div className="stack" style={{ gap: 6 }}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setVer(ver === k ? "" : k)}>{ver === k ? "▾" : "▸"} {titulo} ({n})</button>
      {ver === k && <div style={{ maxHeight: 360, overflowY: "auto", fontSize: 13 }}>{conteudo}</div>}
    </div>
  );
  return (
    <div className="card stack" style={{ gap: 10, borderColor: "var(--green)" }}>
      <b>✓ Importação concluída · {r.arquivo}</b>
      <div className="grid3">
        <div className="card kpi"><small>Produtos lidos</small><b className="num">{r.lidas}</b></div>
        <div className="card kpi"><small>Saldos que mudaram</small><b className="num">{r.alteradas}</b><small>{r.custos} custo(s) atualizados</small></div>
        <div className="card kpi"><small>Produtos criados</small><b className="num">{criados.length}</b><small>{semCusto.length} sem custo</small></div>
      </div>
      {bloco("criados", "Produtos criados (com o código planilha de cada um)", criados.length, criados.map((c) => <div key={c.id}><b>{c.codigo_planilha}</b>{c.codigo ? ` · cód. ${c.codigo}` : ""} · {c.nome}{c.sem_custo ? <b style={{ color: "var(--red)" }}> · sem custo</b> : ""}</div>))}
      {bloco("semcusto", "⚠ Criados sem custo (orçamento bloqueado até ter custo)", semCusto.length, semCusto.map((c) => <div key={c.id}>{c.codigo_planilha} · {c.nome}</div>))}
      {bloco("possiveis", "Possíveis duplicados (descrição muito parecida)", (r.possiveis || []).length, (r.possiveis || []).map((x, i) => (
        <div key={i} className="row-inline" style={{ gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 300px" }}><b>{x.codigo || x.novoCp}</b> {x.nome} <span className="hint">possível duplicado de</span> <b>{x.existente.codigo || x.existente.codigo_planilha}</b> {x.existente.nome} <span className="hint">({x.nota}%)</span></span>
          {x.juntado ? <span className="tag">Juntados</span> : onJuntar && x.novoId ? <button className="btn ghost sm" onClick={() => onJuntar(x)}>Juntar os dois</button> : null}
        </div>
      )))}
      {bloco("marcas", "Marcas corrigidas", (r.marcas || []).length, r.marcas.map((m, i) => <div key={i}>{m.codigo} · {m.nome}: {m.de} → <b>{m.para}</b></div>))}
      {bloco("unidades", "Unidade diferente no PDV (não alterada: confira)", (r.unidades || []).length, r.unidades.map((m, i) => <div key={i}>{m.codigo} · {m.nome}: no sistema <b>{m.de}</b>, no PDV <b>{m.para}</b></div>))}
      {bloco("nao", "Linhas que o leitor não entendeu (não viraram produto)", (r.nao_entendidas || []).length, r.nao_entendidas.map((l, i) => <div key={i}>pág./linha {l.pagina}: {l.texto} <span className="hint">({l.motivo})</span></div>))}
      {bloco("dup", "Linhas repetidas no arquivo (ignoradas)", (r.duplicadas_arquivo || []).length, r.duplicadas_arquivo.map((l, i) => <div key={i}>{l}</div>))}
      {r.ausentes_qtd > 0 && <span className="hint">{r.ausentes_qtd} produto(s) com saldo não vieram no arquivo: {r.ausentes === "zerar" ? "saldo zerado" : "saldo mantido"}.</span>}
    </div>
  );
}

/* ---------------- Ajustes dos orçamentos ---------------- */
function AjustesOrc({ ctx, cfg, onMudou }) {
  const [f, setF] = useState(() => ({
    markup: String(Math.round(Number(cfg.markup || 0) * 10000) / 100).replace(".", ","),
    validade: String(cfg.validade || 7), dias_estoque: String(cfg.dias_estoque || 2),
    vendedores: (cfg.vendedores || []).map((v) => ({ nome: v.nome, comissao: v.comissao == null ? "" : String(Math.round(v.comissao * 10000) / 100).replace(".", ",") })),
    condicoes: (cfg.condicoes || []).join("\n"),
    cab: { nome: "", cnpj: "", telefone: "", email: "", logo: "", ...(cfg.cabecalho || {}) },
  }));
  const [busy, setBusy] = useState(false);
  const nb = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
  const salvar = async () => {
    const mk = nb(f.markup);
    if (!(mk >= 0 && mk < 1000)) return ctx.notify("Markup inválido.");
    const vend = f.vendedores.filter((v) => v.nome.trim()).map((v) => ({ nome: v.nome.trim(), comissao: v.comissao === "" ? null : nb(v.comissao) / 100 }));
    if (vend.some((v) => v.comissao != null && !(v.comissao >= 0 && v.comissao < 1))) return ctx.notify("Comissão inválida.");
    const dados = { ...cfg, markup: Math.round(mk * 100) / 10000, validade: Number(f.validade) || 7, dias_estoque: Number(f.dias_estoque) || 2, vendedores: vend,
      condicoes: f.condicoes.split("\n").map((x) => x.trim()).filter(Boolean), cabecalho: f.cab };
    setBusy(true);
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from("orcamentos_config").upsert({ dados, alterado_em: new Date().toISOString(), alterado_por: u && u.user ? u.user.email : null });
    setBusy(false);
    if (error) return ctx.notify(errMsg(error));
    ctx.notify("Ajustes dos orçamentos salvos"); onMudou();
  };
  const logo = (ev) => {
    const arq = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arq) return;
    const img = new Image();
    img.onload = () => {
      const w = Math.min(600, img.width), h = Math.round((img.height * w) / img.width);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      setF((x) => ({ ...x, cab: { ...x.cab, logo: cv.toDataURL("image/png") } }));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => ctx.notify("Não consegui abrir essa imagem.");
    img.src = URL.createObjectURL(arq);
  };
  const campo = (r, v, on, flex = "1 1 160px", extra = {}) => <label className="stack" style={{ gap: 4, flex, minWidth: 0 }}><span className="hint">{r}</span><input className="input" value={v} onChange={(e) => on(e.target.value)} {...extra} /></label>;
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <b>Preço e prazos</b>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap" }}>
          {campo("Markup (%) · valor = custo × (1 + markup)", f.markup, (v) => setF({ ...f, markup: v }), "1 1 200px", { inputMode: "decimal" })}
          {campo("Validade padrão (dias)", f.validade, (v) => setF({ ...f, validade: v.replace(/\D/g, "") }), "1 1 140px", { inputMode: "numeric" })}
          {campo("Avisar estoque velho após (dias)", f.dias_estoque, (v) => setF({ ...f, dias_estoque: v.replace(/\D/g, "") }), "1 1 160px", { inputMode: "numeric" })}
        </div>
      </div>
      <div className="card stack" style={{ gap: 8 }}>
        <b>Vendedores e comissão</b>
        {f.vendedores.map((v, i) => (
          <div key={i} className="row-inline" style={{ gap: 8 }}>
            <input className="input" style={{ flex: "2 1 0" }} placeholder="Nome" value={v.nome} onChange={(e) => setF({ ...f, vendedores: f.vendedores.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
            <input className="input" style={{ flex: "1 1 0" }} placeholder="Comissão %" inputMode="decimal" value={v.comissao} onChange={(e) => setF({ ...f, vendedores: f.vendedores.map((x, j) => (j === i ? { ...x, comissao: e.target.value } : x)) })} />
            <button className="btn ghost sm" onClick={() => setF({ ...f, vendedores: f.vendedores.filter((_, j) => j !== i) })} aria-label="Tirar vendedor">✕</button>
          </div>
        ))}
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setF({ ...f, vendedores: [...f.vendedores, { nome: "", comissao: "4" }] })}>+ Vendedor</button>
      </div>
      <div className="card stack" style={{ gap: 8 }}>
        <b>Condições de pagamento</b>
        <span className="hint">Uma por linha. Com números (ex.: 30/60/90 DIAS) a Via do Cliente mostra as parcelas e as datas.</span>
        <textarea className="input" rows={8} value={f.condicoes} onChange={(e) => setF({ ...f, condicoes: e.target.value })} />
      </div>
      <div className="card stack" style={{ gap: 8 }}>
        <b>Cabeçalho da Via do Cliente</b>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap" }}>
          {campo("Nome", f.cab.nome, (v) => setF({ ...f, cab: { ...f.cab, nome: v } }), "2 1 240px")}
          {campo("CNPJ", f.cab.cnpj, (v) => setF({ ...f, cab: { ...f.cab, cnpj: v } }))}
          {campo("Telefone", f.cab.telefone, (v) => setF({ ...f, cab: { ...f.cab, telefone: v } }))}
          {campo("E-mail", f.cab.email, (v) => setF({ ...f, cab: { ...f.cab, email: v } }), "2 1 240px")}
        </div>
        <div className="row-inline" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {f.cab.logo ? <img src={f.cab.logo} alt="Logo" style={{ height: 60, borderRadius: 6 }} /> : <span className="hint">Sem logo</span>}
          <label className="btn ghost sm">Escolher logo<input type="file" accept="image/*" style={{ display: "none" }} onChange={logo} /></label>
          {f.cab.logo && <button className="btn ghost sm" onClick={() => setF({ ...f, cab: { ...f.cab, logo: "" } })}>Tirar logo</button>}
        </div>
      </div>
      <button className="btn" style={{ alignSelf: "flex-start" }} onClick={salvar} disabled={busy}>{busy ? <span className="spin" /> : null}Salvar ajustes</button>
    </div>
  );
}

/* ---------------- Via do Cliente (imprimir / salvar em PDF) ---------------- */
function ViaCliente({ via, cfg, cliente, onFechar }) {
  const { o, itens } = via;
  const cab = cfg.cabecalho || {};
  const ate = somaDias(o.data, o.validade_dias);
  const parc = parcelas(o.condicao, o.total, o.data);
  const AZUL = "#1B3A4B";
  return (
    <div className="stack">
      <style>{`@media print { body * { visibility: hidden !important; } .via-cliente, .via-cliente * { visibility: visible !important; } .via-cliente { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: 0 !important; } .nao-imprimir { display: none !important; } @page { size: A4; margin: 12mm; } }`}</style>
      <div className="row-inline nao-imprimir" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost" onClick={onFechar}>← Voltar</button>
        <button className="btn" onClick={() => window.print()}>🖨 Imprimir / salvar em PDF</button>
        <span className="hint">No celular: Compartilhar → Imprimir → Salvar como PDF.</span>
      </div>
      <div className="via-cliente" style={{ background: "#fff", color: "#111", padding: 20, borderRadius: 12, border: "1px solid var(--line)", fontFamily: "Calibri, Arial, sans-serif", fontSize: 13, maxWidth: 820 }}>
        <div style={{ background: AZUL, color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          {cab.logo && <img src={cab.logo} alt="" style={{ height: 54, borderRadius: 4 }} />}
          <b style={{ fontSize: 24 }}>{cab.nome || "ORÇAMENTO"}</b>
        </div>
        <div style={{ padding: "6px 0" }}>{[cab.cnpj && `CNPJ: ${cab.cnpj}`, cab.telefone && `Tel: ${cab.telefone}`].filter(Boolean).join(" | ")}</div>
        {cab.email && <div>{cab.email}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <tbody>
            <tr><td style={{ padding: 3 }}>ORÇAMENTO Nº</td><td colSpan={3}><b style={{ background: "#FDF1C7", padding: "2px 10px" }}>{nOrc(o.numero)}</b></td></tr>
            <tr><td style={{ padding: 3 }}><b>Cliente</b></td><td colSpan={3}>{o.cliente_nome}</td></tr>
            <tr><td style={{ padding: 3 }}><b>Data de emissão</b></td><td>{dataBR(o.data)}</td><td>Validade (dias) {o.validade_dias}</td><td /></tr>
            <tr><td style={{ padding: 3 }}><b>Vendedor</b></td><td>{o.vendedor}</td><td>Válido até</td><td style={{ textAlign: "right" }}>{dataBR(ate)}</td></tr>
            <tr><td style={{ padding: 3 }}><b>CNPJ/CPF</b></td><td colSpan={3}>{o.cliente_doc || (cliente && cliente.cnpj_cpf) || "—"}</td></tr>
            {cliente && cliente.endereco && <tr><td style={{ padding: 3 }}><b>Endereço</b></td><td colSpan={3}>{cliente.endereco}</td></tr>}
          </tbody>
        </table>
        <div style={{ background: AZUL, color: "#fff", padding: "8px 10px", display: "flex", justifyContent: "space-between", marginTop: 10 }}><span>VALOR TOTAL DO ORÇAMENTO</span><b>{brl(o.total)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 2px" }}><b>Condição de pagamento</b><b>{o.condicao || "—"}</b></div>
        {parc.length > 0 && <div style={{ border: "1px solid #999", padding: "4px 6px", fontWeight: 700 }}>{parc.map((p) => `${dataBR(p.data)} - ${brl(p.valor)}`).join("  |  ")}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead><tr style={{ background: "#DCE6EE" }}>{["Descrição do produto", "Marca", "Qtd", "Unid.", "Unitário (R$)", "Total (R$)"].map((h, i) => <th key={h} style={{ textAlign: i >= 2 && i !== 3 ? "right" : "left", padding: "4px 6px" }}>{h}</th>)}</tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>{i.descricao}</td><td style={{ padding: "3px 6px" }}>{i.marca || ""}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{num(i.qtd)}</td><td style={{ padding: "3px 6px" }}>{i.unidade || ""}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{Number(i.valor_unit).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{Number(i.total).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.obs && <div style={{ marginTop: 10 }}><b>Observações:</b> {o.obs}</div>}
      </div>
    </div>
  );
}
export { NovoOrcamento, Historico, Clientes, Painel, Estoque, AjustesOrc, ViaCliente, ResumoImportacao };
