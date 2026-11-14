// =====================================================================
// LicitaPro · aba "Proposta" do processo
// Grade para lançar, item a item, o valor unitário e a marca da proposta.
// Grava sozinho ao sair do campo (Enter desce para o próximo item).
// Só registra no LicitaPro: nada é enviado ao portal.
// =====================================================================
import React, { useState, useRef } from "react";
import { sb, brl, num, parseNum, fmtIn, errMsg } from "./util.js";

const c2 = (v) => Math.round(v * 100) / 100;

export default function PropostaGrade({ itens, pode, notify, onSaved }) {
  const [soMeus, setSoMeus] = useState(() => itens.some((i) => i.participar));
  const [q, setQ] = useState("");
  const [rasc, setRasc] = useState({}); // { [id]: { preco, marca } } enquanto digita
  const [estado, setEstado] = useState({}); // { [id]: "salvando" | "ok" | "erro" }
  const grade = useRef(null);

  const valor = (it, campo) => {
    const r = rasc[it.id];
    if (r && campo in r) return r[campo];
    return campo === "preco" ? fmtIn(it.preco_unit) : it.marca || "";
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
      const m = r.marca.trim() || null;
      if (m === (it.marca || null)) return limpar(it, campo);
      patch.marca = m;
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
      <p className="hint" style={{ margin: 0 }}>Lance aqui o <b>valor unitário</b> e a <b>marca</b> de cada item da proposta. Grava ao sair do campo; Enter desce para o próximo item. Ao lançar um preço, o item passa a “vamos disputar”. Isto fica só no LicitaPro: o envio da proposta no portal continua sendo feito por vocês.</p>
      <div className="row-inline" style={{ gap: 14, flexWrap: "wrap" }}>
        <span>Itens com preço: <b>{comPreco.length}</b> de {itens.length}</span>
        <span>Total da proposta: <b>{brl(total)}</b></span>
        {semMarca > 0 && <span style={{ color: "var(--red)" }}>⚠ {semMarca} {semMarca === 1 ? "item" : "itens"} com preço e sem marca</span>}
      </div>
      {!lista.length ? <div className="empty">{soMeus ? "Nenhum item marcado para disputa. Desmarque “Só os que vamos disputar” para ver todos." : "Nenhum item encontrado."}</div> : (
        <div style={{ overflowX: "auto" }} ref={grade}>
          <table className="itab">
            <thead><tr><th>Item</th><th>Descrição</th><th className="n">Qtd</th><th className="n">Ref. unit.</th><th className="n">Valor unitário</th><th className="n">Valor total</th><th>Marca</th><th aria-label="Situação" /></tr></thead>
            <tbody>
              {lista.map((it) => {
                const pv = parseNum(valor(it, "preco"));
                const ref = it.valor_ref != null && Number(it.valor_ref) > 0 ? Number(it.valor_ref) : null;
                const acima = pv != null && ref != null && pv > ref;
                const abaixoPiso = pv != null && it.valor_minimo != null && pv < Number(it.valor_minimo);
                const st = estado[it.id];
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
