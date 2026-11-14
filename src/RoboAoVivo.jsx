// =====================================================================
// LicitaPro · robô de lances AO VIVO
// Mostra o robô local (pasta robo-lances) acompanhando as disputas reais:
// o que ele faria em cada item, com horário e motivo, e os erros.
// Botões: Parar tudo, Parar por processo, Parar por item, ligar/desligar processos,
// valor mínimo (piso) digitado à mão e "Preencher proposta no portal".
// VERSÃO SÓ OBSERVAR: o banco não aceita outro modo (robo_disputas.modo = 'observar').
// =====================================================================
import React, { useState, useEffect, useRef, useCallback } from "react";
import { sb, brl, parseNum, fmtIn } from "./util.js";
import { ESTRATEGIAS, CONFIG_PADRAO } from "./robo.js";

const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const COR = { erro: "#B91C1C", aviso: "#B45309", chat: "#7C3AED", proposta: "#1D4ED8", status: "#475569" };
const ACAO = { daria_lance: { t: "Daria lance", c: "#15803D" }, esperar: { t: "Esperar", c: "#475569" }, parar: { t: "Parado", c: "#B91C1C" } };

function bip(forte) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.frequency.value = forte ? 880 : 660; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
    o.start(); o.stop(ac.currentTime + 0.5);
  } catch { /* sem som */ }
}

export default function RoboAoVivo({ ctx }) {
  const [estado, setEstado] = useState(null);
  const [disputas, setDisputas] = useState([]);
  const [rItens, setRItens] = useState([]);
  const [itens, setItens] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [novo, setNovo] = useState("");
  const [som, setSom] = useState(true);
  const ultimoId = useRef(0);
  const somRef = useRef(som); somRef.current = som;
  const pode = ctx.pode;

  const carregar = useCallback(async () => {
    const [e, d, ri, pe] = await Promise.all([
      sb.from("robo_estado").select("*").eq("id", "pcp").maybeSingle(),
      sb.from("robo_disputas").select("*").order("criado_em"),
      sb.from("robo_itens").select("*"),
      sb.from("robo_pedidos").select("*").order("criado_em", { ascending: false }).limit(20),
    ]);
    if (e.error) return;
    setEstado(e.data); setDisputas(d.data || []); setRItens(ri.data || []); setPedidos(pe.data || []);
    const ids = (d.data || []).map((x) => x.processo_id);
    if (ids.length) {
      const { data } = await sb.from("itens").select("id,processo_id,numero,descricao,quantidade,unidade,valor_ref,valor_minimo,piso_sugerido,melhor_lance,participar,preco_unit").in("processo_id", ids).order("numero");
      setItens(data || []);
    } else setItens([]);
    // Eventos novos desde o último lido
    let q = sb.from("robo_eventos").select("*").order("id", { ascending: false }).limit(300);
    if (ultimoId.current) q = q.gt("id", ultimoId.current);
    const { data: ev } = await q;
    if (ev && ev.length) {
      if (ultimoId.current && somRef.current && ev.some((x) => x.tipo === "erro" || x.tipo === "chat" || x.acao === "daria_lance")) bip(ev.some((x) => x.tipo === "erro" || x.tipo === "chat"));
      ultimoId.current = ev[0].id;
      setEventos((l) => [...ev, ...l].slice(0, 1500));
    }
  }, []);

  useEffect(() => { carregar(); const t = setInterval(carregar, 3000); return () => clearInterval(t); }, [carregar]);

  const online = estado?.sinal_em && Date.now() - Date.parse(estado.sinal_em) < 20000 && estado.status !== "desligado";
  const quem = ctx.email || null;

  const erroOu = (r) => { if (r.error) ctx.notify(r.error.message); return !r.error; };
  const pararTudo = async () => { if (erroOu(await sb.from("robo_estado").update({ parado_geral: !estado?.parado_geral, atualizado_por: quem }).eq("id", "pcp"))) carregar(); };
  const ligar = async () => {
    if (!novo) return;
    const ja = disputas.find((d) => d.processo_id === novo);
    const r = ja ? await sb.from("robo_disputas").update({ ligado: true, atualizado_em: new Date().toISOString() }).eq("processo_id", novo)
      : await sb.from("robo_disputas").insert({ processo_id: novo, criado_por: quem });
    if (!erroOu(r)) return;
    // Itens "Vamos disputar" entram sozinhos no robô
    const { data: meus } = await sb.from("itens").select("numero").eq("processo_id", novo).eq("participar", true);
    if (meus && meus.length) await sb.from("robo_itens").upsert(meus.map((i) => ({ processo_id: novo, numero: i.numero })), { onConflict: "processo_id,numero", ignoreDuplicates: true });
    setNovo(""); carregar();
    ctx.notify(meus && meus.length ? `Processo ligado no robô (só observar) com ${meus.length} item(ns) “Vamos disputar”.` : "Processo ligado, mas nenhum item está marcado como “Vamos disputar”.");
  };
  const mudarDisputa = async (pid, patch) => { if (erroOu(await sb.from("robo_disputas").update({ ...patch, atualizado_em: new Date().toISOString() }).eq("processo_id", pid))) carregar(); };
  // Desliga (não apaga): assim o robô não liga de novo sozinho um processo que a equipe tirou.
  const tirar = async (pid) => { if (!confirm("Tirar este processo do robô? Ele para de acompanhar até alguém ligar de novo.")) return; mudarDisputa(pid, { ligado: false }); };
  const mudarItem = async (pid, numero, patch) => {
    const r = await sb.from("robo_itens").update({ ...patch, atualizado_em: new Date().toISOString() }).eq("processo_id", pid).eq("numero", numero);
    if (erroOu(r)) carregar();
  };
  const salvarPiso = async (it, texto) => {
    const v = parseNum(texto);
    const novoPiso = v && v > 0 ? v : null;
    if ((novoPiso ?? null) === (it.valor_minimo != null ? Number(it.valor_minimo) : null)) return;
    if (erroOu(await sb.from("itens").update({ valor_minimo: novoPiso, piso_por: quem, piso_em: new Date().toISOString() }).eq("id", it.id))) carregar();
  };
  const todosItens = async (pid) => {
    const { data, error } = await sb.from("itens").select("numero").eq("processo_id", pid);
    if (error) return ctx.notify(error.message);
    if (!data || !data.length) return ctx.notify("Esse processo ainda não tem itens carregados.");
    if (erroOu(await sb.from("robo_itens").upsert(data.map((i) => ({ processo_id: pid, numero: i.numero })), { onConflict: "processo_id,numero", ignoreDuplicates: true }))) { ctx.notify(`${data.length} item(ns) no robô. Sem valor mínimo, ele só observa.`); carregar(); }
  };
  const preencher = async (pid) => {
    if (!confirm("O robô vai digitar preço, marca e Anvisa da cotação na tela de proposta aberta na janela dele.\nEle NÃO salva nem envia: você confere e envia.\n\nA tela de cadastro da proposta já está aberta no Edge do robô?")) return;
    if (erroOu(await sb.from("robo_pedidos").insert({ processo_id: pid, tipo: "proposta", criado_por: quem }))) { ctx.notify("Pedido enviado ao robô."); carregar(); }
  };

  const procs = ctx.procs || [];
  const nomeProc = (pid) => { const p = procs.find((x) => x.id === pid); return p ? `${p.orgao || ""}${p.numero ? ` · ${p.numero}` : ""}` : "Processo"; };
  const ligados = new Set(disputas.filter((d) => d.ligado).map((d) => d.processo_id));
  const VIG = ["participar", "proposta", "suspenso", "disputa", "julgamento", "habilitacao", "recurso", "homologacao"];
  const sessao = (pid) => procs.find((x) => x.id === pid)?.data_sessao || "9999";
  // Na tela: ligados à mão sempre; automáticos só enquanto o processo estiver vigente (igual ao robô)
  const lista = disputas.filter((d) => d.ligado && (d.criado_por !== "automático" || VIG.includes(procs.find((x) => x.id === d.processo_id)?.etapa)))
    .sort((a, b) => String(sessao(a.processo_id)).localeCompare(String(sessao(b.processo_id))));
  const perto = (pid) => { const t = Date.parse(sessao(pid)); return Number.isFinite(t) && t - Date.now() < 36 * 3600e3 && Date.now() - t < 3 * 24 * 3600e3; };
  const candidatos = procs.filter((p) => p.portal === "pcp" && !ligados.has(p.id) && ["participar", "proposta", "disputa", "suspenso", "julgamento"].includes(p.etapa))
    .sort((a, b) => String(a.data_sessao || "9").localeCompare(String(b.data_sessao || "9")));
  const ultimaDecisao = (pid, n) => eventos.find((e) => e.processo_id === pid && e.numero === n && e.tipo === "decisao");

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Robô de lances · ao vivo</h1><p>O robô roda no computador da empresa (pasta robo-lances), lê a sala de disputa do Portal de Compras Públicas e mostra aqui o que faria. <b>Versão só observar: ele não dá lance.</b></p></div>
      </div>

      <div className="card">
        <div className="row-inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <b style={{ color: online ? "#15803D" : "#B91C1C" }}>{online ? "● Robô ligado" : "● Robô desligado ou sem sinal"}</b>
            <div className="hint">
              {estado?.sinal_em ? `Último sinal ${dataHora(estado.sinal_em)}` : "Nunca conectou"}
              {estado?.maquina ? ` · ${estado.maquina}` : ""}{estado?.versao ? ` · v${estado.versao}` : ""}{estado?.mensagem ? ` · ${estado.mensagem}` : ""}
            </div>
            {!online && <div className="hint">Para ligar: no computador da empresa, dois cliques em INICIAR.bat.</div>}
          </div>
          <div className="row-inline" style={{ gap: 8 }}>
            <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={som} onChange={(e) => setSom(e.target.checked)} />Som</label>
            <button className={`btn ${estado?.parado_geral ? "" : "danger"}`} onClick={pararTudo}>{estado?.parado_geral ? "▶ Retomar robô" : "🛑 Parar tudo"}</button>
          </div>
        </div>
        {estado?.parado_geral && <div className="banner info" style={{ marginTop: 10 }}><span>🛑 Robô parado pelo botão geral{estado.atualizado_por ? ` (${estado.atualizado_por})` : ""}. Nenhuma decisão vira lance.</span></div>}
      </div>

      {pode && !ctx.celular && (
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Ligar processo no robô</h2><small>Só Portal de Compras Públicas. Vários processos ao mesmo tempo.</small></div>
          <div className="row-inline">
            <select className="input" value={novo} onChange={(e) => setNovo(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
              <option value="">Escolha o processo…</option>
              {candidatos.map((p) => <option key={p.id} value={p.id}>{dataHora(p.data_sessao)} · {p.orgao}{p.numero ? ` · ${p.numero}` : ""}</option>)}
            </select>
            <button className="btn" disabled={!novo} onClick={ligar}>Ligar</button>
          </div>
        </div>
      )}

      {!lista.length && <div className="card empty">Nenhum processo no robô. Os processos vigentes do Portal de Compras Públicas entram sozinhos quando o robô estiver ligado.</div>}
      {lista.length > 0 && <p className="hint" style={{ margin: 0 }}>{lista.length} processo(s) acompanhado(s). Abertos: sessão nas próximas 36 h ou nos últimos 3 dias; os demais ficam recolhidos (clique para abrir).</p>}

      {lista.map((d) => {
        const p = procs.find((x) => x.id === d.processo_id);
        const its = rItens.filter((r) => r.processo_id === d.processo_id).sort((a, b) => a.numero - b.numero);
        const dados = new Map(itens.filter((i) => i.processo_id === d.processo_id).map((i) => [i.numero, i]));
        const semPiso = its.filter((r) => !(Number(dados.get(r.numero)?.valor_minimo) > 0)).length;
        const conf = { ...CONFIG_PADRAO, ...(d.config || {}) };
        const ped = pedidos.find((x) => x.processo_id === d.processo_id);
        const setConf = (k, v) => mudarDisputa(d.processo_id, { config: { ...(d.config || {}), [k]: v } });
        return (
          <details className="card" key={d.processo_id} open={perto(d.processo_id)}>
            <summary className="card-h" style={{ flexWrap: "wrap", gap: 8, cursor: "pointer" }}>
              <h2 style={{ margin: 0 }}>{nomeProc(d.processo_id)}</h2>
              <small>Sessão {dataHora(p?.data_sessao)} · {its.length} item(ns) no robô{semPiso ? ` · ${semPiso} sem valor mínimo` : ""}{d.criado_por === "automático" ? " · entrou sozinho" : ""} · modo: só observar</small>
            </summary>
            <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className={`btn ${d.parado ? "" : "danger"}`} onClick={() => mudarDisputa(d.processo_id, { parado: !d.parado })}>{d.parado ? "▶ Retomar processo" : "🛑 Parar processo"}</button>
              {pode && !ctx.celular && <button className="btn ghost" onClick={() => preencher(d.processo_id)}>📝 Preencher proposta no portal</button>}
              {pode && !ctx.celular && <button className="btn ghost" onClick={() => todosItens(d.processo_id)}>＋ Incluir todos os itens</button>}
              {pode && !ctx.celular && <button className="btn ghost" onClick={() => tirar(d.processo_id)}>Tirar do robô</button>}
            </div>
            {ped && <div className="hint" style={{ marginTop: 6 }}>Proposta: <b>{ped.status}</b> {dataHora(ped.atualizado_em)}{ped.mensagem ? ` · ${ped.mensagem}` : ""}</div>}
            {d.parado && <div className="banner info" style={{ marginTop: 8 }}><span>🛑 Processo parado: nenhuma decisão vira lance.</span></div>}

            {pode && !ctx.celular && (
              <details style={{ marginTop: 8 }}>
                <summary className="hint">Regras da disputa (do edital)</summary>
                <div className="fgrid" style={{ marginTop: 8 }}>
                  <div className="field"><label>Diferença mínima entre lances</label>
                    <div className="row-inline" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <input className="input num mini" defaultValue={fmtIn(conf.difMinima.valor)} onBlur={(e) => setConf("difMinima", { ...conf.difMinima, valor: parseNum(e.target.value) || 0 })} />
                      <select className="input mini" style={{ width: 70 }} value={conf.difMinima.tipo} onChange={(e) => setConf("difMinima", { ...conf.difMinima, tipo: e.target.value })}><option value="valor">R$</option><option value="pct">%</option></select>
                    </div></div>
                  <div className="field"><label>Desconto a cada lance</label>
                    <div className="row-inline" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <input className="input num mini" defaultValue={fmtIn(conf.decremento.valor)} onBlur={(e) => setConf("decremento", { ...conf.decremento, valor: parseNum(e.target.value) || 0 })} />
                      <select className="input mini" style={{ width: 70 }} value={conf.decremento.tipo} onChange={(e) => setConf("decremento", { ...conf.decremento, tipo: e.target.value })}><option value="valor">R$</option><option value="pct">%</option></select>
                    </div></div>
                  <div className="field"><label>Intervalo entre nossos lances (s)</label><input className="input num" type="number" min="0" defaultValue={conf.intervaloProprio} onBlur={(e) => setConf("intervaloProprio", Number(e.target.value) || 0)} /></div>
                  <div className="field"><label>Espera após lance de outra (s)</label><input className="input num" type="number" min="0" defaultValue={conf.intervaloAposOutro} onBlur={(e) => setConf("intervaloAposOutro", Number(e.target.value) || 0)} /></div>
                  <div className="field"><label>Limite de lances por item</label><input className="input num" type="number" min="1" defaultValue={conf.maxLances} onBlur={(e) => setConf("maxLances", Number(e.target.value) || 1)} /></div>
                </div>
              </details>
            )}

            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="itab">
                <thead><tr><th>Item</th><th>Descrição</th><th className="n">Mínimo (piso)</th><th>Estratégia</th><th>Robô</th><th className="n">Melhor lance</th><th>O robô agora</th></tr></thead>
                <tbody>
                  {its.map((r) => {
                    const it = dados.get(r.numero) || {};
                    const dec = ultimaDecisao(d.processo_id, r.numero);
                    const a = dec ? ACAO[dec.acao] || { t: dec.acao, c: "#475569" } : null;
                    return (
                      <tr key={r.numero} style={r.parado ? { background: "#FEF2F2" } : undefined}>
                        <td>{r.numero}</td>
                        <td style={{ minWidth: 160 }}><div className="clamp2">{it.descricao}</div></td>
                        <td className="n">
                          {pode && !ctx.celular
                            ? <input key={`${it.id}-${it.valor_minimo}`} className="input num mini" defaultValue={it.valor_minimo != null ? fmtIn(it.valor_minimo) : ""} placeholder="sem piso" onBlur={(e) => salvarPiso(it, e.target.value)} aria-label={`Valor mínimo do item ${r.numero}`} />
                            : it.valor_minimo != null ? brl(it.valor_minimo) : <span className="err-mini">sem mínimo</span>}
                          {it.valor_minimo == null && it.piso_sugerido != null && <div className="hint">sugerido {brl(it.piso_sugerido)}</div>}
                        </td>
                        <td>{pode && !ctx.celular
                          ? <select className="input mini" style={{ width: 140 }} value={r.estrategia} onChange={(e) => mudarItem(d.processo_id, r.numero, { estrategia: e.target.value })} title={ESTRATEGIAS[r.estrategia]?.desc}>
                              {Object.entries(ESTRATEGIAS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}</select>
                          : ESTRATEGIAS[r.estrategia]?.nome}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {pode && !ctx.celular && <input type="checkbox" checked={r.ativo} onChange={(e) => mudarItem(d.processo_id, r.numero, { ativo: e.target.checked })} aria-label={`Robô ligado no item ${r.numero}`} />}{" "}
                          <button className={`btn mini ${r.parado ? "" : "danger"}`} style={{ padding: "2px 8px" }} onClick={() => mudarItem(d.processo_id, r.numero, { parado: !r.parado })}>{r.parado ? "Retomar" : "Parar"}</button>
                        </td>
                        <td className="n">{dec?.dados?.melhor != null ? brl(dec.dados.melhor) : brl(it.melhor_lance)}{dec?.dados?.situacao && <div className="hint">{dec.dados.situacao}</div>}</td>
                        <td style={{ minWidth: 220, fontSize: 12 }}>{a ? <><b style={{ color: a.c }}>{a.t}{dec.valor != null ? ` ${brl(dec.valor)}` : ""}</b> · {hora(dec.criado_em)}<div>{dec.motivo}</div></> : <span className="hint">sem leitura ainda</span>}</td>
                      </tr>
                    );
                  })}
                  {!its.length && <tr><td colSpan={7} className="hint">Nenhum item. Marque os itens como “Vamos disputar” no processo: eles entram aqui sozinhos quando o robô estiver ligado.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}

      <div className="card">
        <div className="card-h"><h2>Registro do robô</h2><small>Erros, avisos e decisões, do mais novo para o mais antigo</small></div>
        {!eventos.length ? <div className="empty">Nada registrado ainda.</div> : (
          <div className="simlog">
            {eventos.slice(0, 300).map((e) => (
              <div key={e.id} className="simrow" style={{ borderLeft: `3px solid ${e.tipo === "decisao" ? (ACAO[e.acao]?.c || "#94A3B8") : COR[e.tipo] || "#94A3B8"}`, paddingLeft: 6 }}>
                <span className="hint">{dataHora(e.criado_em)}:{new Date(e.criado_em).getSeconds().toString().padStart(2, "0")}</span>
                <span>{e.processo_id ? nomeProc(e.processo_id).slice(0, 40) : "Robô"}{e.numero != null ? ` · item ${e.numero}` : ""}</span>
                <b style={{ color: e.tipo === "decisao" ? ACAO[e.acao]?.c : COR[e.tipo] }}>{e.tipo === "decisao" ? (ACAO[e.acao]?.t || e.acao) : e.tipo === "erro" ? "ERRO" : e.tipo === "chat" ? "Chat" : e.tipo === "aviso" ? "Aviso" : e.tipo === "proposta" ? "Proposta" : "Status"}</b>
                <span>{e.motivo}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
