// =====================================================================
// LicitaPro · aba "📑 Edital" do processo
// Lê o edital inteiro (baixado do portal/PNCP pela função licita-edital, ou
// PDF/Word enviado) e entrega três partes, cada item com o trecho de origem:
//   ⚠ Pontos de atenção (sessão, prazos, disputa, entrega, pagamento, multas…)
//   📝 Proposta (o que a proposta precisa ter)
//   📂 Documentação (habilitação, declarações…) → vai para a aba Documentos da planilha
// O usuário revisa (marca/desmarca, corrige nome) e só então grava no processo.
// =====================================================================
import React, { useState, useRef } from "react";
import { sb, errMsg, fmtDH, chamarRobo } from "./util.js";
import { acharDocumentos, pontosAtencao, CATEGORIAS_DOC, GRUPOS_PONTOS } from "./documentosEdital.js";

function Trecho({ texto, item, pagina }) {
  const [ver, setVer] = useState(false);
  if (!texto) return null;
  return (
    <div>
      <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => setVer(!ver)}>{ver ? "▾ esconder trecho" : "▸ ver trecho do edital"}{item ? ` (item ${item})` : pagina ? ` (pág. ${pagina})` : ""}</button>
      {ver && <div className="hint" style={{ background: "var(--surface-2, #f6f8fa)", padding: "6px 8px", borderRadius: 8, marginTop: 4, whiteSpace: "pre-wrap" }}>“{texto}”</div>}
    </div>
  );
}

export default function LeituraEdital({ p, pode, notify, salvar }) {
  const [busy, setBusy] = useState("");
  const [erro, setErro] = useState("");
  const [lido, setLido] = useState(null); // { arquivo, paginas, parcial, docs, pontos, faltou }
  const [parte, setParte] = useState("atencao");
  const inp = useRef(null);

  const montar = (r) => {
    const docs = acharDocumentos(r.texto).map((d, i) => ({ ...d, id: i, usar: !d.confirmar || d.vezes > 1 }));
    const { pontos, faltou } = pontosAtencao(r.texto);
    setLido({ arquivo: r.arquivo, paginas: r.paginas, parcial: r.parcial, docs, pontos, faltou, tamanho: r.texto.length });
    setParte("atencao");
  };
  const lerDoPortal = async () => {
    setBusy("portal"); setErro("");
    try { montar(await chamarRobo({ processo_id: p.id }, "licita-edital")); } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };
  const lerArquivo = async (ev) => {
    const arq = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arq) return;
    if (arq.size > 30 * 1024 * 1024) return setErro("Arquivo grande demais (máximo 30 MB).");
    setBusy("arquivo"); setErro("");
    try {
      const buf = new Blob([await arq.arrayBuffer()], { type: "application/octet-stream" });
      const { data, error } = await sb.functions.invoke("licita-edital", { body: buf, headers: { "Content-Type": "application/octet-stream" } });
      if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.erro) msg = j.erro; } catch (e2) { /* ignora */ } throw new Error(msg); }
      if (data && data.erro) throw new Error(data.erro);
      montar({ ...data, arquivo: arq.name });
    } catch (e) { setErro(errMsg(e)); }
    setBusy("");
  };
  const gravar = async () => {
    const docs = lido.docs.filter((d) => d.usar).map(({ id, usar, vezes, ...d }) => d);
    await salvar({
      documentos_edital: docs,
      edital_resumo: { arquivo: lido.arquivo, paginas: lido.paginas, parcial: !!lido.parcial, pontos: lido.pontos, faltou: lido.faltou },
      documentos_lidos_em: new Date().toISOString(),
    }, `Leitura do edital gravada: ${lido.pontos.length} pontos de atenção e ${docs.length} documentos (vão para a aba Documentos da planilha)`);
    setLido(null);
  };
  const mudaDoc = (id, patch) => setLido((l) => ({ ...l, docs: l.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));

  // O que mostrar: a leitura nova (em revisão) ou a gravada
  const gravado = p.edital_resumo || p.documentos_edital ? { pontos: (p.edital_resumo || {}).pontos || [], faltou: (p.edital_resumo || {}).faltou || [], docs: (p.documentos_edital || []).map((d, i) => ({ ...d, id: i, usar: true })), arquivo: (p.edital_resumo || {}).arquivo, paginas: (p.edital_resumo || {}).paginas } : null;
  const v = lido || gravado;
  const revisando = !!lido;
  const docsProposta = v ? v.docs.filter((d) => d.categoria === "PROPOSTA") : [];
  const docsHab = v ? v.docs.filter((d) => d.categoria !== "PROPOSTA") : [];
  const pontosProposta = v ? v.pontos.filter((x) => x.grupo === "Proposta") : [];

  const Pontos = ({ lista }) => (
    <div className="stack" style={{ gap: 8 }}>
      {lista.map((x) => (
        <div key={x.titulo} style={{ borderLeft: "3px solid var(--amber)", paddingLeft: 10 }}>
          <div><b>{x.titulo}</b>{x.item && <span className="hint"> · item {x.item}</span>}{x.pagina && <span className="hint"> · pág. {x.pagina}</span>}</div>
          <div style={{ color: "var(--ink-2)" }}>{x.valor}</div>
          <Trecho texto={x.trecho} />
        </div>
      ))}
    </div>
  );
  const Docs = ({ lista }) => (
    <div style={{ overflowX: "auto" }}>
      <table className="itab">
        <thead><tr>{revisando && <th aria-label="Incluir" />}<th>Documento</th><th>Categoria</th><th>Item do edital</th><th>Validade / prazo</th><th>Observação</th></tr></thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id} style={d.confirmar ? { background: "var(--amber-soft)" } : null}>
              {revisando && <td><input type="checkbox" checked={d.usar} onChange={(e) => mudaDoc(d.id, { usar: e.target.checked })} aria-label={`Incluir ${d.nome}`} /></td>}
              <td style={{ minWidth: 240 }}>
                {revisando ? <input className="input mini" style={{ width: "100%" }} value={d.nome} onChange={(e) => mudaDoc(d.id, { nome: e.target.value })} aria-label="Nome do documento" /> : <b>{d.nome}</b>}
                <Trecho texto={d.trecho} item={d.item} pagina={d.pagina} />
              </td>
              <td>{revisando ? <select className="input mini" value={d.categoria} onChange={(e) => mudaDoc(d.id, { categoria: e.target.value })} aria-label="Categoria">{CATEGORIAS_DOC.map((c) => <option key={c}>{c}</option>)}</select> : <span className="hint">{d.categoria}</span>}</td>
              <td>{d.item || "—"}</td>
              <td className="hint" style={{ minWidth: 120 }}>{d.validade || "—"}</td>
              <td className="hint" style={{ minWidth: 160, color: d.confirmar ? "var(--amber)" : undefined }}>{d.obs || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>📑 Leitura do edital</h2>
        {p.documentos_lidos_em && !revisando && <small>Lido {fmtDH(p.documentos_lidos_em)}{v && v.arquivo ? ` · ${v.arquivo}` : ""}</small>}
      </div>
      <p className="hint" style={{ margin: 0 }}>O app lê o edital inteiro e mostra os pontos de atenção, o que a proposta precisa ter e a documentação exigida, sempre com o trecho de onde tirou. Confira no edital tudo o que estiver em amarelo (“confirmar”). Os documentos gravados vão para a aba Documentos da planilha de cotação.</p>
      {pode && (
        <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" onClick={lerDoPortal} disabled={!!busy}>{busy === "portal" ? <span className="spin" /> : null}{busy === "portal" ? "Lendo o edital… (até 1 min)" : gravado ? "Ler o edital de novo" : "Ler o edital do portal"}</button>
          <button type="button" className="btn ghost sm" onClick={() => inp.current && inp.current.click()} disabled={!!busy}>{busy === "arquivo" ? <span className="spin" /> : null}📤 Enviar o PDF / Word do edital</button>
          <input ref={inp} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={lerArquivo} />
        </div>
      )}
      {erro && <div className="alerta-lance ruim" role="alert">{erro}</div>}
      {!v ? <div className="empty">Edital ainda não lido.</div> : <>
        {revisando && <div className="banner info">Leitura de <b>{v.arquivo}</b>{v.paginas ? ` (${v.paginas} páginas)` : ""}{lido.parcial ? " · ⚠ o arquivo é grande e foi lido só em parte" : ""}. Confira e clique em <b>Gravar</b>.</div>}
        {lido && lido.tamanho < 5000 && <div className="alerta-lance ruim">Pouco texto lido: o PDF pode ser escaneado (imagem). Confira o edital à mão.</div>}
        <div className="seg" role="tablist" style={{ alignSelf: "flex-start" }}>
          <button role="tab" aria-selected={parte === "atencao"} className={parte === "atencao" ? "on" : ""} onClick={() => setParte("atencao")}>⚠ Pontos de atenção ({v.pontos.length})</button>
          <button role="tab" aria-selected={parte === "proposta"} className={parte === "proposta" ? "on" : ""} onClick={() => setParte("proposta")}>📝 Proposta ({pontosProposta.length + docsProposta.length})</button>
          <button role="tab" aria-selected={parte === "docs"} className={parte === "docs" ? "on" : ""} onClick={() => setParte("docs")}>📂 Documentação ({docsHab.length})</button>
        </div>
        {parte === "atencao" && <div className="stack" style={{ gap: 14 }}>
          {v.faltou.length > 0 && <div className="alerta-lance ruim">Não achei no edital, confira à mão: {v.faltou.join(" · ")}</div>}
          {GRUPOS_PONTOS.filter((g) => g !== "Proposta").map((g) => {
            const l = v.pontos.filter((x) => x.grupo === g);
            return l.length ? <div key={g}><h3 style={{ margin: "0 0 6px" }}>{g}</h3><Pontos lista={l} /></div> : null;
          })}
        </div>}
        {parte === "proposta" && <div className="stack" style={{ gap: 14 }}>
          {pontosProposta.length > 0 ? <Pontos lista={pontosProposta} /> : <div className="hint">Nenhuma regra da proposta encontrada.</div>}
          {docsProposta.length > 0 && <><h3 style={{ margin: 0 }}>Documentos que vão com a proposta</h3><Docs lista={docsProposta} /></>}
        </div>}
        {parte === "docs" && (docsHab.length ? <Docs lista={docsHab} /> : <div className="hint">Nenhum documento de habilitação encontrado.</div>)}
        {revisando && (
          <div className="row-inline" style={{ gap: 8 }}>
            <button type="button" className="btn sm" onClick={gravar}>Gravar ({lido.docs.filter((d) => d.usar).length} documentos, {lido.pontos.length} pontos)</button>
            <button type="button" className="btn ghost sm" onClick={() => setLido(null)}>Cancelar</button>
          </div>
        )}
      </>}
    </div>
  );
}
