// =====================================================================
// LicitaPro · gerar a proposta em Word ("PROPOSTA" e "PROPOSTA AJUSTADA")
// Fica no topo da aba "Proposta" do processo.
// - PROPOSTA: todos os itens cotados (valor unitário da aba Proposta / planilha).
// - PROPOSTA AJUSTADA: só os itens vencidos, com o valor final.
// - Colunas extras (Anvisa, Observações) são opção por processo, desligadas por padrão.
// - O administrador troca o modelo Word e os dados da empresa por aqui.
// =====================================================================
import React, { useState, useEffect, useRef } from "react";
import { sb, brl, errMsg, fmtData } from "./util.js";
import {
  COLUNAS_OPCIONAIS, MARCADORES_OBRIGATORIOS, carregarModelo, carregarDadosEmpresa, conferirModelo, bytesParaB64,
  camposPadrao, itensDaProposta, itensDaAjustada, montarProposta, nomeArquivoProposta, baixarDocx,
} from "./propostaWord.js";

const CAMPOS_EMPRESA = [
  ["razao", "Razão social (no texto da proposta)"],
  ["razao_assinatura", "Razão social (na assinatura)"],
  ["cnpj", "CNPJ"],
  ["endereco", "Endereço (ex.: rua X, n° 1, Bairro Y – Cidade-MG)"],
  ["cidade", "Cidade da data (ex.: Mirabela-MG)"],
  ["banco", "Dados bancários"],
  ["representante", "Representante legal"],
  ["rg", "RG do representante"],
  ["cpf", "CPF do representante"],
  ["cargo", "Cargo (ex.: SÓCIO ADMINISTRADOR)"],
  ["email", "E-mail"],
  ["validade_dias", "Validade padrão da proposta (dias)"],
];

export default function PropostaWord({ p, itens, ganhos, ctx, salvar }) {
  const { notify, pode } = ctx;
  const admin = ctx.papel === "admin";
  const [modeloInfo, setModeloInfo] = useState(undefined); // undefined = carregando; null = não tem
  const [emp, setEmp] = useState(null);
  const [busy, setBusy] = useState("");
  const [erro, setErro] = useState("");
  const [proc, setProc] = useState(p.numero_processo || "");
  const [cfgAberta, setCfgAberta] = useState(false);
  const [rascEmp, setRascEmp] = useState(null);
  const inp = useRef(null);
  const opcoes = (p.proposta_opcoes && p.proposta_opcoes.colunas) || {};

  const recarregar = async () => {
    if (!p.empresa_id) { setModeloInfo(null); setEmp({}); return; }
    const [m, d] = await Promise.all([
      sb.from("modelos_documentos").select("nome,atualizado_em,atualizado_por").eq("empresa_id", p.empresa_id).eq("tipo", "proposta").maybeSingle(),
      carregarDadosEmpresa(p.empresa_id).catch(() => ({})),
    ]);
    setModeloInfo(m.data || null);
    setEmp(d);
  };
  useEffect(() => { recarregar(); }, [p.empresa_id]);
  useEffect(() => { setProc(p.numero_processo || ""); }, [p.numero_processo]);

  const cotados = itensDaProposta(itens);
  const vencidos = itensDaAjustada(ganhos, itens);
  const totCot = cotados.reduce((a, i) => a + (Number(i.vt) || 0), 0);
  const totVenc = vencidos.reduce((a, i) => a + (Number(i.vt) || 0), 0);
  const semMarca = (l) => l.filter((i) => !i.marca).length;
  const semValor = vencidos.filter((i) => !(Number(i.vu) > 0)).length;
  const faltaEmp = ["razao", "cnpj", "representante", "cpf"].filter((k) => !emp || !emp[k]);

  const gerar = async (tipo) => {
    setErro("");
    if (!p.empresa_id) return setErro("Escolha a empresa do processo antes de gerar a proposta.");
    const lista = tipo === "ajustada" ? vencidos : cotados;
    if (!lista.length) return setErro(tipo === "ajustada" ? "Nenhum item vencido neste processo." : "Nenhum item com valor unitário: lance os preços abaixo ou envie a planilha de cotação.");
    setBusy(tipo);
    try {
      const modelo = await carregarModelo(p.empresa_id);
      const campos = { ...camposPadrao({ ...p, numero_processo: proc }, emp || {}) };
      const r = montarProposta({ modelo, emp: emp || {}, tipo, campos, itens: lista, opcoes });
      baixarDocx(r.bytes, nomeArquivoProposta(p, tipo));
      notify(`${tipo === "ajustada" ? "Proposta ajustada" : "Proposta"} gerada: ${r.qtd} ${r.qtd === 1 ? "item" : "itens"}, total ${brl(r.total)}. Confira no Word antes de enviar.`);
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };

  const gravarProc = () => { const v = proc.trim() || null; if (v !== (p.numero_processo || null)) salvar({ numero_processo: v }, "Nº do processo gravado"); };
  const mudarColuna = (k, on) => salvar({ proposta_opcoes: { ...(p.proposta_opcoes || {}), colunas: { ...opcoes, [k]: on } } }, on ? "Coluna incluída na proposta" : "Coluna retirada da proposta");

  // ----- administrador: modelo e dados da empresa -----
  const enviarModelo = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    setErro("");
    setBusy("modelo");
    try {
      const u8 = new Uint8Array(await f.arrayBuffer());
      const c = conferirModelo(u8);
      if (!c.ok) throw new Error(`Este arquivo não serve como modelo: faltam os marcadores ${c.faltam.join(", ")}. Use o modelo atual baixado aqui e só ajuste o texto fixo.`);
      const { error } = await sb.from("modelos_documentos").upsert({ empresa_id: p.empresa_id, tipo: "proposta", nome: f.name, arquivo: bytesParaB64(u8), atualizado_em: new Date().toISOString(), atualizado_por: ctx.email }, { onConflict: "empresa_id,tipo" });
      if (error) throw error;
      notify("Modelo da proposta atualizado");
      await recarregar();
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };
  const baixarModelo = async () => {
    try { baixarDocx(await carregarModelo(p.empresa_id), "Modelo_proposta_LicitaPro.docx"); } catch (e) { setErro(errMsg(e)); }
  };
  const gravarEmp = async () => {
    const dados = { ...(emp || {}), ...rascEmp };
    if (dados.validade_dias != null && dados.validade_dias !== "") dados.validade_dias = Number(dados.validade_dias) || 60;
    setBusy("emp");
    const { error } = await sb.from("empresa_proposta").upsert({ empresa_id: p.empresa_id, dados, atualizado_em: new Date().toISOString(), atualizado_por: ctx.email }, { onConflict: "empresa_id" });
    setBusy("");
    if (error) return setErro(errMsg(error));
    setEmp(dados); setRascEmp(null); notify("Dados da empresa na proposta gravados");
  };

  if (!pode) return null;
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>📄 Proposta em Word</h2>
        {modeloInfo && <span className="hint">Modelo: {modeloInfo.nome || "proposta"} · {fmtData(modeloInfo.atualizado_em)}</span>}
      </div>
      {modeloInfo === null && <div className="alerta-lance ruim" role="alert">O modelo Word da proposta ainda não foi enviado para esta empresa.{admin ? " Envie em “Modelo e dados da empresa”, abaixo." : " Peça ao administrador."}</div>}
      {emp && faltaEmp.length > 0 && modeloInfo && <div className="alerta-lance ruim" role="alert">Faltam dados da empresa na proposta ({faltaEmp.join(", ")}).{admin ? " Preencha em “Modelo e dados da empresa”." : " Peça ao administrador."}</div>}

      <div className="row-inline" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pw-proc">Nº do processo licitatório</label>
          <input id="pw-proc" className="input" style={{ width: 170 }} value={proc} onChange={(e) => setProc(e.target.value)} onBlur={gravarProc} placeholder="Ex.: 177/2026" />
        </div>
        <div className="hint" style={{ paddingBottom: 8 }}>Pregão nº <b>{camposPadrao(p, emp || {}).pregao || "—"}</b> · Validade: <b>{camposPadrao(p, emp || {}).validade}</b>{p.validade_dias ? " (do edital)" : ""}</div>
      </div>

      <div className="row-inline" style={{ gap: 14, flexWrap: "wrap" }}>
        <span className="hint">Colunas: Item, Descrição, Qtde, Unid, Valor unitário, Valor total e Marca sempre aparecem. Acrescentar:</span>
        {COLUNAS_OPCIONAIS.map((c) => (
          <label key={c.k} className="toggle"><input type="checkbox" checked={!!opcoes[c.k]} onChange={(e) => mudarColuna(c.k, e.target.checked)} />{c.t}</label>
        ))}
      </div>

      <div className="row-inline" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => gerar("inicial")} disabled={!!busy || !modeloInfo || !cotados.length}>
          {busy === "inicial" ? <span className="spin" /> : null}📄 Gerar PROPOSTA ({cotados.length} {cotados.length === 1 ? "item" : "itens"} · {brl(totCot)})
        </button>
        <button type="button" className="btn" onClick={() => gerar("ajustada")} disabled={!!busy || !modeloInfo || !vencidos.length}>
          {busy === "ajustada" ? <span className="spin" /> : null}🏆 Gerar PROPOSTA AJUSTADA ({vencidos.length} {vencidos.length === 1 ? "vencido" : "vencidos"} · {brl(totVenc)})
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        A <b>PROPOSTA</b> leva todos os itens com valor unitário lançado (aba abaixo ou planilha de cotação). A <b>PROPOSTA AJUSTADA</b> leva só os itens vencidos, com o valor final da disputa.
        O arquivo sai em Word, editável: confira antes de assinar e enviar no portal.
      </p>
      {(semMarca(cotados) > 0 || semMarca(vencidos) > 0 || semValor > 0) && (
        <div className="hint" style={{ color: "var(--red)" }}>
          {semMarca(cotados) > 0 && <div>⚠ {semMarca(cotados)} {semMarca(cotados) === 1 ? "item cotado está" : "itens cotados estão"} sem marca.</div>}
          {semMarca(vencidos) > 0 && <div>⚠ {semMarca(vencidos)} {semMarca(vencidos) === 1 ? "item vencido está" : "itens vencidos estão"} sem marca (lance a marca na aba abaixo ou em Itens ganhos).</div>}
          {semValor > 0 && <div>⚠ {semValor} {semValor === 1 ? "item vencido está" : "itens vencidos estão"} sem valor.</div>}
        </div>
      )}
      {erro && <div className="alerta-lance ruim" role="alert">{erro}</div>}

      {admin && p.empresa_id && (
        <details open={cfgAberta} onToggle={(e) => setCfgAberta(e.currentTarget.open)}>
          <summary style={{ cursor: "pointer" }}><b>⚙ Modelo e dados da empresa</b> <span className="hint">(só o administrador)</span></summary>
          <div className="stack" style={{ gap: 10, marginTop: 10 }}>
            <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
              {modeloInfo && <button type="button" className="btn ghost sm" onClick={baixarModelo}>📥 Baixar modelo atual</button>}
              <button type="button" className="btn ghost sm" onClick={() => inp.current && inp.current.click()} disabled={!!busy}>{busy === "modelo" ? <span className="spin" /> : null}📤 {modeloInfo ? "Trocar modelo" : "Enviar modelo"} (.docx)</button>
              <input ref={inp} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={enviarModelo} />
            </div>
            <p className="hint" style={{ margin: 0 }}>O modelo é o Word da empresa com marcadores no lugar do que muda ({MARCADORES_OBRIGATORIOS.slice(0, 4).join(", ")}…). Para mudar o texto fixo, baixe o modelo atual, edite no Word sem apagar os marcadores e envie de volta. O modelo e os dados abaixo ficam só no banco do LicitaPro.</p>
            <div className="grid2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
              {CAMPOS_EMPRESA.map(([k, t]) => (
                <div key={k} className="field" style={{ margin: 0 }}>
                  <label htmlFor={`pw-emp-${k}`}>{t}</label>
                  <input id={`pw-emp-${k}`} className="input" value={rascEmp && k in rascEmp ? rascEmp[k] : (emp && emp[k] != null ? String(emp[k]) : "")} onChange={(e) => setRascEmp((r) => ({ ...(r || {}), [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div><button type="button" className="btn sm" onClick={gravarEmp} disabled={!rascEmp || !!busy}>{busy === "emp" ? <span className="spin" /> : null}Gravar dados da empresa</button></div>
          </div>
        </details>
      )}
    </div>
  );
}
