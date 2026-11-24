// =====================================================================
// LicitaPro · aba "Proposta" do processo
// Grade para lançar, item a item, o valor unitário, a marca e o registro Anvisa da proposta,
// e (depois da disputa) marcar os itens que vencemos com o valor final → PROPOSTA AJUSTADA.
// Grava sozinho ao sair do campo (Enter desce para o próximo item).
// Só registra no LicitaPro: nada é enviado ao portal.
// =====================================================================
import React, { useState, useRef } from "react";
import { sb, brl, num, parseNum, fmtIn, errMsg } from "./util.js";
import { gerarEBaixar, itensDaAjustada } from "./propostaWord.js";

const c2 = (v) => Math.round(v * 100) / 100;

export default function PropostaGrade({ p, itens, pode, notify, onSaved, ganhos = [], podeGanhos, onGanho, onMudouGanhos }) {
  const [baixando, setBaixando] = useState(false);
  const [soMeus, setSoMeus] = useState(() => itens.some((i) => i.participar));
  const [q, setQ] = useState("");
  const [rasc, setRasc] = useState({}); // { [id]: { preco, marca } } enquanto digita
  const [estado, setEstado] = useState({}); // { [id]: "salvando" | "ok" | "erro" }
  const grade = useRef(null);

  const valor = (it, campo) => {
    const r = rasc[it.id];
    if (r && campo in r) return r[campo];
    return campo === "preco" ? fmtIn(it.preco_unit) : (it[campo] || "");
  };
  const digitar = (it, campo, v) => setRasc((r) => ({ ...r, [it.id]: { ...(r[it.id] || {}), [campo]: v } }));

  const salvar = async (it, campo) => {
    const r = rasc[it.id];
    if (!r || !(campo in r)) return;
    const patch = {};
    if (campo === "preco") {
      const v = parseNum(r.preco);
      if (r.preco.trim() !== "" && (v == null || v < 0)) { setEstado((e) => ({ ...e, [it.id]: "erro" })); return notify(`Item ${it.numero}: valor inválido`); }
      if (v === (it.preco_unit != null ? Number(it.preco_unit) : null)) return limpar(it, campo);
      patch.preco_unit = v;
      patch.preco_total = v != null && it.quantidade != null ? c2(v * Number(it.quantidade)) : null;
      if (v != null && !it.participar) patch.participar = true; // lançou preço = vamos disputar
    } else {
      const m = String(r[campo]).trim() || null;
      if (m === (it[campo] || null)) return limpar(it, campo);
      patch[campo] = m;
    }
    setEstado((e) => ({ ...e, [it.id]: "salvando" }));
    const { data, error } = await sb.from("itens").update(patch).eq("id", it.id).select("*").single();
    if (error) { setEstado((e) => ({ ...e, [it.id]: "erro" })); return notify(`Item ${it.numero}: ${errMsg(error)}`); }
    setEstado((e) => ({ ...e, [it.id]: "ok" }));
    limpar(it, campo);
    onSaved(data);
  };
  const limpar = (it, campo) => setRasc((r) => {
    const n = { ...(r[it.id] || {}) }; delete n[campo];
    const o = { ...r };
    if (Object.keys(n).length) o[it.id] = n; else delete o[it.id];
    return o;
  });

  // Itens que vencemos (base da PROPOSTA AJUSTADA): marcados sozinhos pelo robô ou aqui, à mão
  const ganhoDe = (it) => ganhos.find((g) => (g.item_id && g.item_id === it.id) || String(g.numero) === String(it.numero));
  const mostrarGanhos = podeGanhos || ganhos.length > 0;
  const salvarValorFinal = async (g, txt) => {
    const v = parseNum(txt);
    if (txt.trim() !== "" && (v == null || v < 0)) return notify(`Item ${g.numero}: valor inválido`);
    if (v === (g.valor_unitario != null ? Number(g.valor_unitario) : null)) return;
    const { error } = await sb.from("itens_ganhos").update({ valor_unitario: v }).eq("id", g.id);
    if (error) return notify(errMsg(error));
    notify(`Item ${g.numero}: valor final ${v != null ? brl(v) : "apagado"}`);
    onMudouGanhos && onMudouGanhos();
  };

  // PROPOSTA AJUSTADA: só os itens marcados em "🏆 Vencemos", com o valor final
  const baixarAjustada = async () => {
    const lista = itensDaAjustada(ganhos, itens);
    if (lista.some((i) => !(Number(i.vu) > 0))) return notify("Há item vencido sem valor final: preencha antes de baixar.");
    setBaixando(true);
    try {
      const r = await gerarEBaixar({ p, tipo: "ajustada", lista });
      notify(`Proposta ajustada gerada: ${r.qtd} ${r.qtd === 1 ? "item" : "itens"}, total ${brl(r.total)}. Confira no Word antes de enviar.`);
    } catch (e) { notify(errMsg(e)); }
    setBaixando(false);
  };

  // Enter / setas: desce ou sobe na mesma coluna
  const teclas = (e, campo) => {
    if (!["Enter", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const todos = Array.from(grade.current.querySelectorAll(`input[data-campo="${campo}"]`));
    const i = todos.indexOf(e.target);
    const prox = todos[i + (e.key === "ArrowUp" ? -1 : 1)];
    if (prox) { prox.focus(); prox.select(); } else e.target.blur();
  };

  const lista = itens.filter((i) => (!soMeus || i.participar) && (!q || `${i.numero} ${i.descricao || ""} ${i.marca || ""}`.toLowerCase().includes(q.toLowerCase())));
  const comPreco = itens.filter((i) => i.preco_unit != null);
  const semMarca = comPreco.filter((i) => !i.marca).length;
  const totalGanho = ganhos.reduce((a, g) => a + (Number(g.valor_unitario) || 0) * (Number(g.quantidade) || 0), 0);
  const total = comPreco.reduce((a, i) => a + (i.preco_total != null ? Number(i.preco_total) : c2(Number(i.preco_unit) * (Number(i.quantidade) || 0))), 0);

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>📝 Proposta</h2>
        <div className="row-inline" style={{ gap: 10 }}>
          <label className="toggle"><input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} />Só os que vamos disputar</label>
          {itens.length > 10 && <input className="input" style={{ maxWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar item ou marca" aria-label="Filtrar itens" />}
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>Lance aqui o <b>valor unitário</b>, a <b>marca</b> e o <b>registro Anvisa</b> de cada item da proposta (ou envie a planilha de cotação preenchida, acima). Grava ao sair do campo; Enter desce para o próximo item. Ao lançar um preço, o item passa a “vamos disputar”. Isto fica só no LicitaPro: o envio da proposta no portal continua sendo feito por vocês.</p>
      {mostrarGanhos && <p className="hint" style={{ margin: 0 }}><b>Depois da disputa:</b> marque <b>🏆 Vencemos</b> nos itens que a empresa ganhou e confira o <b>valor final</b> (o do último lance ou o negociado). Depois clique em <b>📥 Proposta ajustada</b> (no alto da coluna): o Word sai só com esses itens. Itens marcados sozinhos pelo portal ou pelo PNCP já vêm marcados.</p>}
      <div className="row-inline" style={{ gap: 14, flexWrap: "wrap" }}>
        <span>Itens com preço: <b>{comPreco.length}</b> de {itens.length}</span>
        <span>Total da proposta: <b>{brl(total)}</b></span>
        {ganhos.length > 0 && <span>🏆 Vencidos: <b>{ganhos.length}</b> · total final <b>{brl(totalGanho)}</b></span>}
        {p && ganhos.length > 0 && <button type="button" className="btn sm" onClick={baixarAjustada} disabled={baixando}>{baixando ? <span className="spin" /> : null}📥 Baixar PROPOSTA AJUSTADA ({ganhos.length} {ganhos.length === 1 ? "item" : "itens"})</button>}
        {semMarca > 0 && <span style={{ color: "var(--red)" }}>⚠ {semMarca} {semMarca === 1 ? "item" : "itens"} com preço e sem marca</span>}
      </div>
      {!lista.length ? <div className="empty">{soMeus ? "Nenhum item marcado para disputa. Desmarque “Só os que vamos disputar” para ver todos." : "Nenhum item encontrado."}</div> : (
        <div style={{ overflowX: "auto" }} ref={grade}>
          <table className="itab">
            <thead><tr><th>Item</th><th>Descrição</th><th className="n">Qtd</th><th className="n">Ref. unit.</th><th className="n">Valor unitário</th><th className="n">Valor total</th><th>Marca</th><th>Reg. Anvisa</th>{mostrarGanhos && <th style={{ minWidth: 150 }}>🏆 Vencemos
                {p && ganhos.length > 0 && <div><button type="button" className="btn sm" style={{ marginTop: 4 }} onClick={baixarAjustada} disabled={baixando} title="Baixar a PROPOSTA AJUSTADA em Word com os itens marcados">{baixando ? <span className="spin" /> : "📥"} Proposta ajustada ({ganhos.length})</button></div>}</th>}{mostrarGanhos && <th className="n">Valor final unit.</th>}<th aria-label="Situação" /></tr></thead>
            <tbody>
              {lista.map((it) => {
                const pv = parseNum(valor(it, "preco"));
                const ref = it.valor_ref != null && Number(it.valor_ref) > 0 ? Number(it.valor_ref) : null;
                const acima = pv != null && ref != null && pv > ref;
                const abaixoPiso = pv != null && it.valor_minimo != null && pv < Number(it.valor_minimo);
                const st = estado[it.id];
                const g = ganhoDe(it);
                const sugFinal = it.resultado_valor ?? (it.nosso_arremata ? it.arrematante_lance : null) ?? it.nosso_lance ?? null;
                return (
                  <tr key={it.id} style={it.participar ? null : { opacity: 0.7 }}>
                    <td>{it.numero}</td>
                    <td style={{ minWidth: 240 }}><div className="clamp3">{it.descricao || "—"}</div></td>
                    <td className="n">{num(it.quantidade)} <span className="hint">{it.unidade || ""}</span></td>
                    <td className="n">{ref != null ? brl(ref) : "—"}</td>
                    <td className="n">
                      {pode ? <input className="input num mini" style={{ width: 110, borderColor: acima || abaixoPiso ? "var(--red)" : undefined }} inputMode="decimal" data-campo="preco"
                        value={valor(it, "preco")} onChange={(e) => digitar(it, "preco", e.target.value)} onBlur={() => salvar(it, "preco")} onKeyDown={(e) => teclas(e, "preco")}
                        placeholder="0,00" aria-label={`Valor unitário do item ${it.numero}`} /> : brl(it.preco_unit)}
                      {acima && <div className="hint" style={{ color: "var(--red)" }}>acima da referência</div>}
                      {abaixoPiso && <div className="hint" style={{ color: "var(--red)" }}>abaixo do mínimo ({brl(it.valor_minimo)})</div>}
                    </td>
                    <td className="n">{pv != null && it.quantidade != null ? brl(c2(pv * Number(it.quantidade))) : "—"}</td>
                    <td>{pode ? <input className="input mini" style={{ width: 150 }} data-campo="marca" value={valor(it, "marca")} onChange={(e) => digitar(it, "marca", e.target.value)}
                      onBlur={() => salvar(it, "marca")} onKeyDown={(e) => teclas(e, "marca")} aria-label={`Marca do item ${it.numero}`} /> : it.marca || "—"}</td>
                    <td>{pode ? <input className="input mini" style={{ width: 130 }} data-campo="anvisa" value={valor(it, "anvisa")} onChange={(e) => digitar(it, "anvisa", e.target.value)}
                      onBlur={() => salvar(it, "anvisa")} onKeyDown={(e) => teclas(e, "anvisa")} aria-label={`Registro Anvisa do item ${it.numero}`} /> : it.anvisa || "—"}</td>
                    {mostrarGanhos && (
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={!!g} disabled={!podeGanhos || (g && g.origem !== "manual")}
                          title={g && g.origem !== "manual" ? "Marcado pelo portal/PNCP" : "Vencemos este item"}
                          onChange={(e) => onGanho && onGanho(it, e.target.checked)} aria-label={`Vencemos o item ${it.numero}`} />
                      </td>
                    )}
                    {mostrarGanhos && (
                      <td className="n">
                        {g ? (podeGanhos
                          ? <input key={`${g.id}-${g.valor_unitario}`} className="input num mini" style={{ width: 110, borderColor: g.valor_unitario == null ? "var(--red)" : undefined }} inputMode="decimal" data-campo="final"
                              defaultValue={fmtIn(g.valor_unitario)} placeholder="valor final" onBlur={(e) => salvarValorFinal(g, e.target.value)} onKeyDown={(e) => teclas(e, "final")} aria-label={`Valor final do item ${it.numero}`} />
                          : brl(g.valor_unitario))
                          : sugFinal != null ? <span className="hint">lance {brl(sugFinal)}</span> : null}
                      </td>
                    )}
                    <td style={{ width: 22 }} aria-live="polite">{st === "salvando" ? <span className="spin" /> : st === "ok" ? <span title="Gravado" style={{ color: "var(--green)" }}>✓</span> : st === "erro" ? <span title="Não gravou" style={{ color: "var(--red)" }}>!</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
