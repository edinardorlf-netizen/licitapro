// =====================================================================
// LicitaPro · planilha de cotação dentro do processo (aba Itens)
// Baixar: gera o Excel no modelo da empresa com os itens que vamos disputar.
// Enviar: lê a planilha preenchida, confere os totais e mostra antes de gravar.
// O lance mínimo da planilha é só sugestão: o valor mínimo do robô é confirmado aqui.
// =====================================================================
import React, { useState, useRef } from "react";
import { sb, brl, num, errMsg, fmtData } from "./util.js";
import { gerarPlanilha, lerPlanilha, baixar, nomeArquivo } from "./cotacao.js";
import { produtoDe, diasDesde, DIAS_CUSTO_VELHO } from "./produtos.js";
import { carregarProdutos } from "./dados.js";

export default function CotacaoPainel({ p, itens, pode, notify, onMudou, onProposta }) {
  const [busy, setBusy] = useState("");
  const [todos, setTodos] = useState(false);
  const [lido, setLido] = useState(null); // { linhas, avisos, nome }
  const [marcarDisputa, setMarcarDisputa] = useState(true);
  const [confirmarPiso, setConfirmarPiso] = useState(false);
  const [erro, setErro] = useState("");
  const [avisoCusto, setAvisoCusto] = useState("");
  const inp = useRef(null);

  const marcados = itens.filter((i) => i.participar);
  const paraGerar = todos || !marcados.length ? itens : marcados;

  // Custo e marca vêm do catálogo (aba Produtos) quando o item ainda não tem os seus
  const doCatalogo = async (lista) => {
    let produtos = [];
    try { produtos = await carregarProdutos(); } catch (e) { return { lista, usados: 0, velhos: 0 }; } // sem permissão: segue sem custos
    if (!produtos.length) return { lista, usados: 0, velhos: 0 };
    const porId = new Map(produtos.map((x) => [x.id, x]));
    const porChave = new Map();
    produtos.forEach((x) => (x.chaves || []).forEach((k) => porChave.set(k, x)));
    let usados = 0, velhos = 0;
    const out = lista.map((it) => {
      const prod = (it.produto_id && porId.get(it.produto_id)) || produtoDe(it.descricao, porChave, it.unidade);
      if (!prod || prod.custo_atual == null || it.custo != null) return it;
      const idade = diasDesde(prod.custo_em);
      const velho = idade != null && idade > DIAS_CUSTO_VELHO;
      usados++; if (velho) velhos++;
      const nota = `Custo do banco: R$ ${Number(prod.custo_atual).toFixed(2).replace(".", ",")} de ${fmtData(prod.custo_em)}${velho ? ` – DESATUALIZADO (${idade} dias)` : ""}`;
      return { ...it, custo: prod.custo_atual, marca: it.marca || prod.custo_marca || null, obs: it.obs ? `${it.obs} · ${nota}` : nota };
    });
    return { lista: out, usados, velhos };
  };

  const gerar = async () => {
    setBusy("gerar"); setErro("");
    try {
      const { lista, usados, velhos } = await doCatalogo(paraGerar);
      const blob = await gerarPlanilha(p, lista);
      baixar(blob, nomeArquivo(p));
      notify(`Planilha gerada com ${paraGerar.length} ${paraGerar.length === 1 ? "item" : "itens"}${usados ? ` · ${usados} com custo do banco` : ""}`);
      setAvisoCusto(velhos ? `${velhos} item(ns) saíram com custo desatualizado (mais de ${DIAS_CUSTO_VELHO} dias). Confira e atualize na aba Produtos.` : "");
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };

  const ler = async (ev) => {
    const arq = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arq) return;
    setBusy("ler"); setErro(""); setLido(null); setConfirmarPiso(false);
    try {
      const r = await lerPlanilha(arq, itens);
      setLido({ ...r, nome: arq.name });
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };

  const gravar = async () => {
    if (!lido) return;
    setBusy("gravar"); setErro("");
    const { data: u } = await sb.auth.getUser();
    const quem = u && u.user ? u.user.email : null;
    const agora = new Date().toISOString();
    const falhas = [];
    const linhas = lido.linhas;
    for (let i = 0; i < linhas.length; i += 8) {
      await Promise.all(linhas.slice(i, i + 8).map(async ({ item, dados: d, cotado }) => {
        const patch = {
          preco_unit: d.preco_unit, preco_total: d.preco_total, custo: d.custo, piso_sugerido: d.piso_sugerido,
          anvisa: d.anvisa, obs: d.obs, cotacao_em: agora,
        };
        if (d.marca) patch.marca = d.marca;
        if (d.participacao) patch.participacao = d.participacao;
        if (d.obs_exigencia) patch.obs_exigencia = d.obs_exigencia;
        if (cotado && marcarDisputa) patch.participar = true;
        if (confirmarPiso && d.piso_sugerido != null && d.piso_sugerido > 0) { patch.valor_minimo = d.piso_sugerido; patch.piso_por = quem; patch.piso_em = agora; }
        const { error } = await sb.from("itens").update(patch).eq("id", item.id);
        if (error) falhas.push(`Item ${item.numero}: ${errMsg(error)}`);
      }));
    }
    setBusy("");
    if (falhas.length) { setErro(`Não gravou ${falhas.length} item(ns). ${falhas.slice(0, 3).join(" · ")}`); onMudou && onMudou(); return; }
    const cot = linhas.filter((l) => l.cotado).length;
    notify(`Cotação gravada: ${cot} ${cot === 1 ? "item cotado" : "itens cotados"}${confirmarPiso ? " e valores mínimos confirmados" : ""}`);
    setLido(null);
    onMudou && onMudou();
  };

  if (!pode) return null;
  const linhas = lido ? lido.linhas : [];
  const cotados = linhas.filter((l) => l.cotado);
  const comAviso = linhas.filter((l) => l.avisos.length);
  const total = cotados.reduce((a, l) => a + (Number(l.dados.preco_total) || 0), 0);
  const comSug = cotados.filter((l) => l.dados.piso_sugerido != null);
  const vencidos = linhas.filter((l) => l.dados.vencido);

  return (
    <div className="stack" style={{ gap: 10, marginBottom: 14, padding: 12, border: "1px solid var(--line-2)", borderRadius: 12 }}>
      <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
        <b style={{ marginRight: 6 }}>📊 Planilha de cotação</b>
        <button type="button" className="btn sm" onClick={gerar} disabled={!!busy}>{busy === "gerar" ? <span className="spin" /> : null}📥 Baixar planilha ({paraGerar.length} {paraGerar.length === 1 ? "item" : "itens"})</button>
        <button type="button" className="btn ghost sm" onClick={() => inp.current && inp.current.click()} disabled={!!busy}>{busy === "ler" ? <span className="spin" /> : null}📤 Enviar planilha preenchida</button>
        <input ref={inp} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={ler} />
        {onProposta && itens.some((i) => i.participar && i.preco_unit != null) && <button type="button" className="btn ghost sm" onClick={onProposta}>📄 Gerar proposta (Word)</button>}
        {marcados.length > 0 && marcados.length < itens.length && <label className="toggle"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />Incluir todos os itens do edital</label>}
      </div>
      <p className="hint" style={{ margin: 0 }}>{marcados.length ? `A planilha sai com os ${marcados.length} itens marcados para disputa${todos ? " (agora: todos os itens)" : ""}.` : "Nenhum item marcado ainda: a planilha sai com todos os itens do edital."} Preencha valor unitário, marca e, se quiser, o lance mínimo; depois envie de volta.</p>
      {erro && <div className="alerta-lance ruim" role="alert">{erro}</div>}
      {avisoCusto && <div className="alerta-lance ruim" role="alert">⚠ {avisoCusto}</div>}

      {lido && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-inline" style={{ gap: 12, flexWrap: "wrap" }}>
            <span>Arquivo: <b>{lido.nome}</b></span>
            <span>Itens lidos: <b>{linhas.length}</b></span>
            <span>Cotados: <b>{cotados.length}</b></span>
            <span>Total cotado: <b>{brl(total)}</b></span>
            <span style={{ color: comAviso.length ? "var(--red)" : "var(--green)" }}>{comAviso.length ? `⚠ ${comAviso.length} com divergência` : "✓ Totais conferem"}</span>
          </div>
          {lido.avisos.length > 0 && <div className="alerta-lance ruim">{lido.avisos.slice(0, 6).join(" · ")}{lido.avisos.length > 6 ? ` · e mais ${lido.avisos.length - 6}` : ""}</div>}
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table className="itab">
              <thead><tr><th>Item</th><th>Descrição</th><th className="n">Qtd</th><th className="n">Valor unit.</th><th className="n">Total</th><th>Marca</th><th>ANVISA</th><th className="n">Lance mín. (sugestão)</th><th>Conferência</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.numero} style={l.avisos.length ? { background: "var(--red-soft)" } : !l.cotado ? { opacity: 0.55 } : null}>
                    <td>{l.numero}</td>
                    <td style={{ minWidth: 200 }}><div className="clamp3">{l.item.descricao}</div></td>
                    <td className="n">{num(l.item.quantidade)} <span className="hint">{l.item.unidade || ""}</span></td>
                    <td className="n">{l.dados.preco_unit != null ? brl(l.dados.preco_unit) : "—"}</td>
                    <td className="n">{l.dados.preco_total != null ? brl(l.dados.preco_total) : "—"}</td>
                    <td>{l.dados.marca || "—"}</td>
                    <td>{l.dados.anvisa || "—"}</td>
                    <td className="n">{l.dados.piso_sugerido != null ? brl(l.dados.piso_sugerido) : "—"}</td>
                    <td style={{ minWidth: 180 }}>{l.avisos.length ? l.avisos.join(" ") : l.cotado ? "OK" : "Sem preço (não cotado)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vencidos.length > 0 && <p className="hint" style={{ margin: 0 }}>{vencidos.length} item(ns) marcados como vencidos na planilha. A marcação de vencidos será usada na proposta ajustada (próxima etapa); por enquanto use “🏆 Ganhamos este item”.</p>}
          <label className="toggle"><input type="checkbox" checked={marcarDisputa} onChange={(e) => setMarcarDisputa(e.target.checked)} />Marcar os itens cotados como “vamos disputar”</label>
          {comSug.length > 0 && (
            <label className="toggle"><input type="checkbox" checked={confirmarPiso} onChange={(e) => setConfirmarPiso(e.target.checked)} />Confirmo os {comSug.length} lances mínimos da planilha como valor mínimo do robô (sem marcar, ficam só como sugestão em cada item)</label>
          )}
          <div className="row-inline">
            <button type="button" className="btn sm" onClick={gravar} disabled={!!busy || !linhas.length}>{busy === "gravar" ? <span className="spin" /> : null}Gravar cotação ({linhas.length} {linhas.length === 1 ? "item" : "itens"})</button>
            <button type="button" className="btn ghost sm" onClick={() => setLido(null)} disabled={!!busy}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
