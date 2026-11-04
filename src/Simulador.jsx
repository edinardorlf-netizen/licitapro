// =====================================================================
// LicitaPro · sala de disputa simulada
// Imita o fluxo de uma sessão de pregão (modo aberto ou aberto e fechado),
// com concorrentes simulados, para testar o cérebro do robô (robo.js)
// sem entrar em nenhum portal. Nada aqui envia lance de verdade.
// =====================================================================
import React, { useState, useEffect, useRef } from "react";
import { sb, brl, parseNum, fmtIn } from "./util.js";
import { decidir, ESTRATEGIAS, CONFIG_PADRAO } from "./robo.js";

const NOMES_RIVAIS = ["Empresa A", "Empresa B", "Empresa C", "Empresa D"];
const rnd = (a, b) => a + Math.random() * (b - a);
const cent = (v) => Math.round(v * 100) / 100;
const mmss = (s) => { if (s == null || !isFinite(s)) return "—"; s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const NOME_FASE = { aguardando: "Aguardando", aberto: "Aberto para lances", reta_final: "Iminência / prorrogação", aleatorio: "Tempo aleatório", fechado: "Lance fechado", encerrado: "Encerrado" };

const ITENS_EXEMPLO = [
  { numero: 1, descricao: "Seringa descartável 10 ml (un)", ref: 0.62, piso: 0.45, estrategia: "cobrir", ativo: true },
  { numero: 2, descricao: "Equipo macrogotas (un)", ref: 1.1, piso: 0.72, estrategia: "final", ativo: true },
  { numero: 3, descricao: "Soro fisiológico 0,9% 500 ml (un)", ref: 6.4, piso: 4.9, estrategia: "cobrir", ativo: true },
  { numero: 4, descricao: "Luva de procedimento M (cx 100)", ref: 32.0, piso: 0, estrategia: "cobrir", ativo: true },
];

// Monta a sala a partir dos itens e da configuração.
function novaSala(itens, cfg, nRivais) {
  const rivais = NOMES_RIVAIS.slice(0, nRivais).map((nome) => ({ nome }));
  const its = itens.map((x, i) => {
    const ref = Number(x.ref) || 1;
    const props = rivais.map((r) => ({
      quem: r.nome,
      piso: cent(ref * rnd(0.62, 0.97)), // até onde cada concorrente aceita ir (secreto)
      reacao: [rnd(3, 8), rnd(10, 40)], // tempo de reação em segundos
      dec: rnd(0.002, 0.02), // desconto por lance
      proposta: cent(ref * rnd(0.92, 1.08)),
      ultimo: null, proximo: null, desistiu: false, fechadoDado: false,
    }));
    const nossa = cent(ref * 1.0);
    const todas = [...props.map((p) => ({ quem: p.quem, v: p.proposta })), { quem: "Nós", v: nossa }];
    const melhor = todas.reduce((a, b) => (b.v < a.v ? b : a));
    const abre = i * 25;
    return {
      ...x, ref, piso: Number(x.piso) || 0,
      fase: "aguardando", abre,
      fim: cfg.modo === "aberto" ? abre + 600 : abre + 900,
      aleatorioFim: null, fechadoFim: null,
      melhor: melhor.v, autor: melhor.quem, nossaProposta: nossa,
      rivais: props, lancesDados: 0, ultimoNossoEm: null, ultimoOutroEm: null,
      elegivelFechado: false, lanceFechadoDado: false, fechados: [],
      status: "Aguardando abertura", resultado: null,
    };
  });
  return { t: 0, itens: its, log: [], rodando: false, fim: false };
}

export default function Simulador({ ctx }) {
  const [cfg, setCfg] = useState({ ...CONFIG_PADRAO });
  const [itensCfg, setItensCfg] = useState(ITENS_EXEMPLO);
  const [nRivais, setNRivais] = useState(3);
  const [vel, setVel] = useState(10);
  const [, setVersao] = useState(0);
  const sala = useRef(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const velRef = useRef(vel);
  velRef.current = vel;
  const [procSel, setProcSel] = useState("");

  const redesenhar = () => setVersao((v) => v + 1);
  const registrar = (s, item, quem, texto, tipo = "info") => { s.log.unshift({ t: s.t, item, quem, texto, tipo, id: s.log.length + Math.random() }); if (s.log.length > 600) s.log.length = 600; };

  // Aplica um lance na sala simulada, com a mesma validação que um portal faria.
  const aplicarLance = (s, it, quem, valor) => {
    const c = cfgRef.current;
    const difMin = c.difMinima.tipo === "pct" ? it.melhor * c.difMinima.valor / 100 : Number(c.difMinima.valor) || 0;
    if (it.fase === "fechado") {
      it.fechados.push({ quem, v: valor });
      registrar(s, it.numero, quem, `Lance fechado enviado (sigiloso até o fim): ${brl(valor)}`, quem === "Nós" ? "nosso" : "info");
      return true;
    }
    if (valor > cent(it.melhor - difMin) + 1e-9) {
      registrar(s, it.numero, quem, `Lance de ${brl(valor)} recusado pela sala: precisa ser pelo menos ${brl(difMin)} menor que ${brl(it.melhor)}.`, "erro");
      return false;
    }
    it.melhor = valor; it.autor = quem;
    if (quem === "Nós") { it.ultimoNossoEm = s.t; it.lancesDados++; } else it.ultimoOutroEm = s.t;
    // Prorrogação automática no modo aberto: lance nos 2 últimos minutos estende 2 minutos.
    if (c.modo === "aberto" && it.fim - s.t < 120) it.fim = s.t + 120;
    registrar(s, it.numero, quem, `Lance de ${brl(valor)}`, quem === "Nós" ? "nosso" : "info");
    return true;
  };

  const passo = (dt) => {
    const s = sala.current; if (!s || !s.rodando) return;
    const c = cfgRef.current;
    s.t += dt;
    let todosEncerrados = true;
    for (const it of s.itens) {
      // ---- Fases do item ----
      if (it.fase === "aguardando" && s.t >= it.abre) { it.fase = "aberto"; registrar(s, it.numero, "Sala", "Item aberto para lances."); }
      if (c.modo === "aberto") {
        if (["aberto", "reta_final"].includes(it.fase)) {
          if (it.fim - s.t <= 120 && it.fase === "aberto") { it.fase = "reta_final"; registrar(s, it.numero, "Sala", "Iminência de fechamento (2 minutos)."); }
          if (s.t >= it.fim) encerrar(s, it);
        }
      } else {
        if (it.fase === "aberto" && s.t >= it.fim) {
          it.fase = "aleatorio"; it.aleatorioFim = s.t + rnd(0, 600);
          registrar(s, it.numero, "Sala", "Fim da etapa aberta: começou o tempo aleatório (até 10 min).");
        } else if (it.fase === "aleatorio" && s.t >= it.aleatorioFim) {
          it.fase = "fechado"; it.fechadoFim = s.t + 300;
          const teto = it.melhor * 1.10; // autor do melhor lance e quem está até 10% acima
          it.elegivelFechado = it.autor === "Nós" || (it.ultimoNossoValor || it.nossaProposta) <= teto;
          it.rivais.forEach((r) => { r.elegivel = it.autor === r.quem || (r.ultimoValor || r.proposta) <= teto; });
          registrar(s, it.numero, "Sala", `Etapa fechada: quem está até 10% do melhor lance pode enviar um lance final sigiloso (5 min). Nós: ${it.elegivelFechado ? "podemos" : "fora da faixa"}.`);
        } else if (it.fase === "fechado" && s.t >= it.fechadoFim) encerrar(s, it);
      }

      if (it.fase !== "encerrado") todosEncerrados = false;
      const lanceavel = ["aberto", "reta_final", "aleatorio", "fechado"].includes(it.fase);
      if (!lanceavel) continue;

      // ---- Concorrentes simulados ----
      for (const r of it.rivais) {
        if (r.desistiu) continue;
        if (it.fase === "fechado") {
          if (r.elegivel && !r.fechadoDado && Math.random() < dt / 60) {
            r.fechadoDado = true;
            aplicarLance(s, it, r.quem, cent(Math.max(r.piso, it.melhor * rnd(0.97, 1.0))));
          }
          continue;
        }
        if (it.autor === r.quem) { r.proximo = null; continue; }
        if (r.proximo == null) r.proximo = s.t + rnd(it.fase === "aberto" ? r.reacao[1] / 2 : r.reacao[0], r.reacao[1]);
        if (s.t >= r.proximo && (r.ultimo == null || s.t - r.ultimo >= c.intervaloProprio)) {
          const difMin = c.difMinima.tipo === "pct" ? it.melhor * c.difMinima.valor / 100 : Number(c.difMinima.valor) || 0;
          const v = cent(Math.floor((it.melhor - Math.max(it.melhor * r.dec, difMin, 0.01)) * 100) / 100);
          if (v < r.piso) { r.desistiu = true; registrar(s, it.numero, r.quem, "Parou de dar lances (chegou ao limite dela)."); continue; }
          if (aplicarLance(s, it, r.quem, v)) { r.ultimo = s.t; r.ultimoValor = v; }
          r.proximo = null;
        }
      }

      // ---- Nosso robô ----
      const visao = {
        numero: it.numero, piso: it.piso, estrategia: it.estrategia, ativo: it.ativo,
        fase: it.fase, melhor: it.melhor, somosMelhor: it.autor === "Nós",
        elegivelFechado: it.elegivelFechado, lanceFechadoDado: it.lanceFechadoDado,
        lancesDados: it.lancesDados, ultimoNossoEm: it.ultimoNossoEm, ultimoOutroEm: it.ultimoOutroEm,
        restante: c.modo === "aberto" ? it.fim - s.t : it.fase === "aberto" ? it.fim - s.t : null,
      };
      const d = decidir(visao, c, s.t);
      if (d.acao === "lance") {
        if (it.fase === "fechado") { it.lanceFechadoDado = true; it.ultimoNossoValor = d.valor; }
        if (aplicarLance(s, it, "Nós", d.valor)) it.ultimoNossoValor = d.valor;
        it.status = `🤖 ${d.motivo}`;
      } else {
        if (d.acao === "parar" && it.status !== `⛔ ${d.motivo}` && it.fase !== "encerrado") registrar(s, it.numero, "Robô", `Parou: ${d.motivo}`, "parar");
        it.status = d.acao === "parar" ? `⛔ ${d.motivo}` : `⏳ ${d.motivo}`;
      }
    }
    if (todosEncerrados && !s.fim) { s.fim = true; s.rodando = false; registrar(s, null, "Sala", "Sessão encerrada."); }
  };

  const encerrar = (s, it) => {
    if (it.fase === "encerrado") return;
    let venc = { quem: it.autor, v: it.melhor };
    for (const f of it.fechados) if (f.v < venc.v) venc = f;
    it.fase = "encerrado"; it.melhor = venc.v; it.autor = venc.quem;
    it.resultado = venc;
    registrar(s, it.numero, "Sala", `Encerrado. Arrematante: ${venc.quem} com ${brl(venc.v)}.`, venc.quem === "Nós" ? "ganhou" : "info");
  };

  // Relógio: 4 passos por segundo, acelerado pela velocidade.
  useEffect(() => {
    const t = setInterval(() => {
      const s = sala.current;
      if (s && s.rodando) { for (let k = 0; k < velRef.current; k++) passo(0.25); redesenhar(); }
    }, 250);
    return () => clearInterval(t);
  }, []);

  const iniciar = () => {
    if (!sala.current || sala.current.fim) sala.current = novaSala(itensCfg, cfgRef.current, nRivais);
    sala.current.rodando = true; redesenhar();
  };
  const pausar = () => { if (sala.current) { sala.current.rodando = false; redesenhar(); } };
  const reiniciar = () => { sala.current = null; setCfg((c) => ({ ...c, parado: false })); redesenhar(); };
  const emergencia = () => {
    setCfg((c) => ({ ...c, parado: !c.parado }));
    if (sala.current) registrar(sala.current, null, "Robô", cfg.parado ? "Robô religado." : "🛑 Botão de parar acionado: nenhum lance será enviado.", "parar");
  };

  const carregarProcesso = async (id) => {
    setProcSel(id);
    if (!id) return setItensCfg(ITENS_EXEMPLO);
    const { data, error } = await sb.from("itens").select("numero,descricao,valor_ref,valor_minimo,participar,melhor_lance").eq("processo_id", id).order("numero");
    if (error) return ctx.notify(error.message);
    const meus = (data || []).filter((i) => i.participar || i.valor_minimo != null);
    const base = (meus.length ? meus : (data || [])).slice(0, 12);
    if (!base.length) return ctx.notify("Esse processo ainda não tem itens.");
    setItensCfg(base.map((i) => ({
      numero: i.numero, descricao: i.descricao, ref: Number(i.valor_ref) || Number(i.melhor_lance) || 1,
      piso: i.valor_minimo != null ? Number(i.valor_minimo) : 0, estrategia: "cobrir", ativo: true,
    })));
    sala.current = null; redesenhar();
    if (!meus.length) ctx.notify("Nenhum item marcado como “Vamos disputar”: carreguei os 12 primeiros, sem valor mínimo.");
  };

  const s = sala.current;
  const emCurso = !!s;
  const setItem = (i, patch) => setItensCfg((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const regra = (k) => (
    <div className="row-inline" style={{ gap: 6, flexWrap: "nowrap" }}>
      <input className="input num mini" defaultValue={fmtIn(cfg[k].valor)} onBlur={(e) => setCfg({ ...cfg, [k]: { ...cfg[k], valor: parseNum(e.target.value) || 0 } })} aria-label={k} />
      <select className="input mini" style={{ width: 70 }} value={cfg[k].tipo} onChange={(e) => setCfg({ ...cfg, [k]: { ...cfg[k], tipo: e.target.value } })}><option value="valor">R$</option><option value="pct">%</option></select>
    </div>
  );

  const ganhos = s ? s.itens.filter((it) => it.resultado && it.resultado.quem === "Nós") : [];

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Robô de lances · simulação</h1><p>Sala de disputa imitada no próprio LicitaPro, com concorrentes simulados. Nenhum portal é acessado e nenhum lance real é enviado.</p></div>
      </div>

      <div className="banner info"><span>O robô decide sozinho a cada instante: <b>dar lance</b>, <b>esperar</b> ou <b>parar</b>, sempre com o motivo. Ele nunca passa do valor mínimo do item, respeita a diferença mínima entre lances e os intervalos, e para na hora pelo botão vermelho.</span></div>

      <div className="grid2">
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Regras da disputa</h2></div>
          <div className="fgrid">
            <div className="field"><label>Modo de disputa</label>
              <select className="input" value={cfg.modo} disabled={emCurso} onChange={(e) => setCfg({ ...cfg, modo: e.target.value })}>
                <option value="aberto">Aberto (prorrogação de 2 min)</option>
                <option value="aberto_fechado">Aberto e fechado (tempo aleatório + lance final)</option>
              </select></div>
            <div className="field"><label>Diferença mínima entre lances (edital)</label>{regra("difMinima")}</div>
            <div className="field"><label>Desconto a cada lance do robô</label>{regra("decremento")}</div>
            <div className="field"><label>Intervalo entre nossos lances (s)</label><input className="input num" type="number" min="0" value={cfg.intervaloProprio} onChange={(e) => setCfg({ ...cfg, intervaloProprio: Number(e.target.value) || 0 })} /></div>
            <div className="field"><label>Espera após lance de outra empresa (s)</label><input className="input num" type="number" min="0" value={cfg.intervaloAposOutro} onChange={(e) => setCfg({ ...cfg, intervaloAposOutro: Number(e.target.value) || 0 })} /></div>
            <div className="field"><label>Limite de lances por item</label><input className="input num" type="number" min="1" value={cfg.maxLances} onChange={(e) => setCfg({ ...cfg, maxLances: Number(e.target.value) || 1 })} /></div>
            {cfg.modo === "aberto_fechado" && <div className="field"><label>Lance fechado final</label>
              <select className="input" value={cfg.lanceFechado} onChange={(e) => setCfg({ ...cfg, lanceFechado: e.target.value })}>
                <option value="decremento">Melhor lance menos o desconto</option><option value="piso">Direto no valor mínimo</option>
              </select></div>}
            <div className="field"><label>“Reta final” para a estratégia guardar (s)</label><input className="input num" type="number" min="0" value={cfg.retaFinal} onChange={(e) => setCfg({ ...cfg, retaFinal: Number(e.target.value) || 0 })} /></div>
          </div>
        </div>
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Simulação</h2></div>
          <div className="fgrid">
            <div className="field"><label>Itens</label>
              <select className="input" value={procSel} disabled={emCurso} onChange={(e) => carregarProcesso(e.target.value)}>
                <option value="">Itens de exemplo</option>
                {(ctx.procs || []).map((p) => <option key={p.id} value={p.id}>{p.orgao}{p.numero ? ` · ${p.numero}` : ""}</option>)}
              </select></div>
            <div className="field"><label>Concorrentes simulados</label>
              <select className="input" value={nRivais} disabled={emCurso} onChange={(e) => setNRivais(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            <div className="field"><label>Velocidade</label>
              <select className="input" value={vel} onChange={(e) => setVel(Number(e.target.value))}>{[1, 5, 10, 30, 60].map((n) => <option key={n} value={n}>{n}× {n === 1 ? "(tempo real)" : ""}</option>)}</select></div>
          </div>
          <div className="row-inline">
            {(!s || !s.rodando) && <button className="btn" onClick={iniciar}>{s && !s.fim ? "▶ Continuar" : "▶ Iniciar disputa"}</button>}
            {s && s.rodando && <button className="btn ghost" onClick={pausar}>⏸ Pausar</button>}
            {s && <button className="btn ghost" onClick={reiniciar}>↺ Nova simulação</button>}
            <button className={`btn ${cfg.parado ? "" : "danger"}`} onClick={emergencia}>{cfg.parado ? "Religar robô" : "🛑 Parar robô"}</button>
          </div>
          {s && <div className="hint">Relógio da sala: <b>{mmss(s.t)}</b>{s.fim ? " · sessão encerrada" : s.rodando ? " · em andamento" : " · pausada"}</div>}
          <p className="hint" style={{ margin: 0 }}>Os concorrentes têm limites de preço sorteados e secretos, reagem em tempos diferentes e desistem quando chegam ao limite deles, como numa sala real.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Itens e estratégia</h2><small>{s ? "Durante a disputa dá para mudar a estratégia e ligar/desligar itens" : "Defina o valor mínimo (piso) de cada item: sem ele, o robô não lança"}</small></div>
        <div style={{ overflowX: "auto" }}>
          <table className="itab">
            <thead><tr><th>Item</th><th>Descrição</th><th className="n">Valor ref.</th><th className="n">Nosso mínimo</th><th>Estratégia</th><th>Robô</th>
              {s && <><th>Fase</th><th className="n">Tempo</th><th className="n">Melhor lance</th><th>Quem</th><th className="n">Nossos lances</th><th>O robô agora</th></>}
            </tr></thead>
            <tbody>
              {itensCfg.map((x, i) => {
                const it = s ? s.itens[i] : null;
                const restante = it ? (it.fase === "aleatorio" ? null : it.fase === "fechado" ? it.fechadoFim - s.t : it.fase === "aguardando" ? it.abre - s.t : it.fase === "encerrado" ? 0 : it.fim - s.t) : null;
                return (
                  <tr key={x.numero} style={it && it.fase === "encerrado" && it.resultado && it.resultado.quem === "Nós" ? { background: "#DCFCE7" } : undefined}>
                    <td>{x.numero}</td>
                    <td style={{ minWidth: 180 }}><div className="clamp2">{x.descricao}</div></td>
                    <td className="n">{emCurso ? brl(x.ref) : <input className="input num mini" defaultValue={fmtIn(x.ref)} onBlur={(e) => setItem(i, { ref: parseNum(e.target.value) || 0 })} aria-label={`Valor de referência do item ${x.numero}`} />}</td>
                    <td className="n">{emCurso ? (x.piso ? brl(x.piso) : <span className="err-mini">sem mínimo</span>) : <input className="input num mini" defaultValue={x.piso ? fmtIn(x.piso) : ""} placeholder="0,00" onBlur={(e) => setItem(i, { piso: parseNum(e.target.value) || 0 })} aria-label={`Valor mínimo do item ${x.numero}`} />}</td>
                    <td><select className="input mini" style={{ width: 150 }} value={x.estrategia} onChange={(e) => { setItem(i, { estrategia: e.target.value }); if (it) it.estrategia = e.target.value; }} title={ESTRATEGIAS[x.estrategia].desc}>
                      {Object.entries(ESTRATEGIAS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}</select></td>
                    <td><input type="checkbox" checked={x.ativo} onChange={(e) => { setItem(i, { ativo: e.target.checked }); if (it) it.ativo = e.target.checked; }} aria-label={`Robô ligado no item ${x.numero}`} /></td>
                    {it && <>
                      <td>{NOME_FASE[it.fase]}</td>
                      <td className="n">{it.fase === "aleatorio" ? "??:??" : mmss(restante)}</td>
                      <td className="n"><b>{brl(it.melhor)}</b>{it.fase === "fechado" && <div className="hint">antes dos lances fechados</div>}</td>
                      <td>{it.autor === "Nós" ? <span className="tag ok">Nós</span> : it.autor}</td>
                      <td className="n">{it.lancesDados}</td>
                      <td style={{ minWidth: 220, fontSize: 12 }}>{it.status}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {s && s.fim && (
          <div className="banner info" style={{ marginTop: 12 }}><span>
            <b>Resultado:</b> o robô arrematou {ganhos.length} de {s.itens.length} item(ns)
            {ganhos.length ? ` (${ganhos.map((g) => `item ${g.numero} por ${brl(g.resultado.v)}, ${Math.round((1 - g.resultado.v / g.ref) * 100)}% abaixo da referência`).join("; ")})` : ""}.
            {" "}Em nenhum item ele passou do valor mínimo.
          </span></div>
        )}
      </div>

      <div className="card">
        <div className="card-h"><h2>Registro da sessão</h2><small>Tudo o que aconteceu, do mais novo para o mais antigo</small></div>
        {!s ? <div className="empty">Inicie a disputa para ver os lances aparecendo aqui.</div> : (
          <div className="simlog">
            {s.log.slice(0, 250).map((l) => (
              <div key={l.id} className={`simrow ${l.tipo}`}>
                <span className="hint">{mmss(l.t)}</span>
                <span>{l.item != null ? `Item ${l.item}` : ""}</span>
                <b>{l.quem}</b>
                <span>{l.texto}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
