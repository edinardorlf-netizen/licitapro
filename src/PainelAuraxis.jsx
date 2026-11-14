// =====================================================================
// LicitaPro · painel do administrador Auraxis (igual ao do LojaPro)
// Cria a conta de cada empresa cliente (código + nome + CNPJ), cadastra as pessoas
// com nome e senha provisória, define o logo, o link/QR code da empresa e a chave do robô.
// Não mostra processos, itens nem preços das contas: isso fica só dentro de cada conta.
// Tudo passa pela função licita-contas (o banco não deixa uma conta ver a outra).
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import { sb, chamarRobo, errMsg, PAPEIS, fmtData } from "./util.js";
import { codigoConta, LinkConta, prenderAparelho, useAparelho } from "./Acesso.jsx";

const contas = (body) => chamarRobo(body, "licita-contas");

// Reduz o logo para caber no banco (no máximo ~300 KB)
async function reduzirLogo(arq) {
  const url = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(arq); });
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
  const esc = Math.min(1, 480 / img.width, 200 / img.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * esc)); c.height = Math.max(1, Math.round(img.height * esc));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL("image/png");
  if (out.length > 280000) out = c.toDataURL("image/jpeg", 0.85);
  if (out.length > 300000) throw new Error("O logo ficou grande demais. Use uma imagem menor.");
  return out;
}

/* Pessoas de uma conta: usado no painel Auraxis e em Ajustes → Equipe (pelo dono da conta) */
export function PessoasConta({ contaId, notify, euEmail, auraxis, onMudou }) {
  const [lista, setLista] = useState(null);
  const [f, setF] = useState({ nome: "", papel: "acompanha", senha: "" });
  const [busy, setBusy] = useState("");
  const carregar = useCallback(() => contas({ acao: "pessoas", conta_id: contaId }).then((r) => setLista(r.pessoas || []), (e) => { notify(errMsg(e)); setLista([]); }), [contaId]);
  useEffect(() => { carregar(); }, [carregar]);
  const fazer = async (chave, body, ok) => {
    setBusy(chave);
    try { await contas(body); notify(ok); await carregar(); onMudou && onMudou(); } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };
  const cadastrar = (e) => {
    e.preventDefault();
    if (!f.nome.trim()) return notify("Informe o nome.");
    if (f.senha.length < 6) return notify("A senha provisória precisa ter pelo menos 6 caracteres.");
    const nome = f.nome.trim();
    fazer("novo", { acao: "pessoa_criar", conta_id: contaId, ...f }, `Acesso de ${nome} criado. Entra com o nome "${nome}" e a senha provisória; no primeiro acesso cria a própria senha.`)
      .then(() => setF({ nome: "", papel: "acompanha", senha: "" }));
  };
  const novaSenha = (p) => {
    const s = prompt(`Nova senha provisória para ${p.nome || p.email} (mínimo 6 caracteres):`);
    if (!s) return;
    fazer(p.email, { acao: "pessoa_senha", email: p.email, senha: s }, `Senha provisória de ${p.nome || p.email} trocada. No próximo acesso essa pessoa cria uma senha nova.`);
  };
  const ordem = { admin: 0, equipe: 1, acompanha: 2 };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {lista === null ? <p className="hint">Carregando…</p> : !lista.length ? <p className="hint">Ninguém cadastrado ainda. Comece pelo administrador (dono) da empresa.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="itab">
            <thead><tr><th>Nome (para entrar)</th><th>Perfil</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {[...lista].sort((a, b) => (ordem[a.papel] ?? 9) - (ordem[b.papel] ?? 9) || String(a.nome).localeCompare(String(b.nome))).map((p) => (
                <tr key={p.email} style={!p.ativo ? { opacity: 0.55 } : null}>
                  <td><b>{p.nome || "—"}</b>{!p.interno && <div className="hint">entra com e-mail: {p.email}</div>}{p.email === euEmail && <span className="hint"> (você)</span>}</td>
                  <td>
                    {p.papel === "admin" ? PAPEIS.admin : (
                      <select className="input" style={{ minWidth: 150 }} value={p.papel} disabled={!!busy} onChange={(e) => fazer(p.email, { acao: "pessoa_alterar", email: p.email, papel: e.target.value }, "Perfil alterado")}>
                        {Object.entries(PAPEIS).filter(([k]) => k !== "admin" || auraxis).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{!p.ativo ? "desligado" : p.trocar_senha ? "aguardando criar a senha" : "ativo"}</td>
                  <td>
                    {p.email !== euEmail && (
                      <div className="row-inline" style={{ gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => novaSenha(p)}>Nova senha provisória</button>
                        {p.papel !== "admin" && <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => fazer(p.email, { acao: "pessoa_alterar", email: p.email, ativo: !p.ativo }, p.ativo ? "Acesso desligado" : "Acesso religado")}>{p.ativo ? "Desligar" : "Religar"}</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="form" onSubmit={cadastrar} noValidate style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        <b style={{ fontSize: 13.5 }}>Cadastrar pessoa</b>
        <div className="fgrid">
          <div className="field"><label htmlFor={`pc-nome-${contaId}`}>Nome (é o que a pessoa digita para entrar)</label><input id={`pc-nome-${contaId}`} className="input" maxLength={60} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Marcio" /></div>
          <div className="field"><label htmlFor={`pc-papel-${contaId}`}>Perfil</label>
            <select id={`pc-papel-${contaId}`} className="input" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value })}>
              {Object.entries(PAPEIS).filter(([k]) => k !== "admin" || (auraxis && lista && !lista.some((p) => p.papel === "admin"))).map(([k, n]) => <option key={k} value={k}>{k === "admin" ? "Administrador (dono da empresa)" : n}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor={`pc-senha-${contaId}`}>Senha provisória</label><input id={`pc-senha-${contaId}`} className="input" autoComplete="off" minLength={6} value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></div>
        </div>
        <p className="hint" style={{ margin: 0 }}>Nomes iguais na mesma empresa não são aceitos: use “Maria” e “Maria S”, por exemplo. A pessoa troca a senha no primeiro acesso. “Equipe” começa podendo ver e alterar tudo; “Acompanha” só vê Processos e Contratos (ajuste em Permissões).</p>
        <button className="btn" style={{ alignSelf: "flex-start" }} disabled={!!busy}>{busy === "novo" ? <span className="spin" /> : null}Cadastrar</button>
      </form>
    </div>
  );
}

function NovaConta({ aoCriar, notify }) {
  const [f, setF] = useState({ nome: "", codigo: "", cnpj: "", empresa_nome: "", cidade: "", uf: "MG" });
  const [busy, setBusy] = useState(false);
  const muda = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enviar = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await contas({ acao: "conta_criar", ...f, codigo: f.codigo || f.nome });
      notify(r.aviso || `Conta "${r.conta.nome}" criada. Agora cadastre o administrador dela.`);
      setF({ nome: "", codigo: "", cnpj: "", empresa_nome: "", cidade: "", uf: "MG" });
      aoCriar(r.conta.id);
    } catch (e2) { notify(errMsg(e2)); }
    setBusy(false);
  };
  return (
    <form className="card form" onSubmit={enviar} noValidate>
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Nova empresa cliente</h2></div>
      <div className="fgrid">
        <div className="field"><label htmlFor="nc-nome">Nome do cliente</label><input id="nc-nome" className="input" maxLength={120} value={f.nome} onChange={muda("nome")} placeholder="Ex.: Mirafarma" /></div>
        <div className="field"><label htmlFor="nc-cod">Código (para os aparelhos)</label><input id="nc-cod" className="input" maxLength={30} value={f.codigo} onChange={muda("codigo")} placeholder={codigoConta(f.nome) || "ex.: mirafarma"} /></div>
        <div className="field"><label htmlFor="nc-cnpj">CNPJ da empresa (opcional)</label><input id="nc-cnpj" className="input" inputMode="numeric" value={f.cnpj} onChange={muda("cnpj")} /></div>
        <div className="field"><label htmlFor="nc-razao">Razão social (opcional)</label><input id="nc-razao" className="input" maxLength={120} value={f.empresa_nome} onChange={muda("empresa_nome")} /></div>
        <div className="field"><label htmlFor="nc-cid">Cidade</label><input id="nc-cid" className="input" maxLength={80} value={f.cidade} onChange={muda("cidade")} /></div>
        <div className="field"><label htmlFor="nc-uf">UF</label><input id="nc-uf" className="input" maxLength={2} value={f.uf} onChange={muda("uf")} /></div>
      </div>
      <p className="hint" style={{ margin: 0 }}>O código é curto, só letras e números, e não muda depois. Fica: <b>{codigoConta(f.codigo || f.nome) || "—"}</b>. Outros CNPJs do mesmo cliente (ex.: uma segunda empresa) são cadastrados depois, dentro da conta, em Ajustes → Empresas.</p>
      <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? <span className="spin" /> : null}Criar conta</button>
    </form>
  );
}

function ContaAdmin({ conta, notify, euEmail, onVoltar, recarregar }) {
  const aparelho = useAparelho();
  const [busy, setBusy] = useState("");
  const [chave, setChave] = useState("");
  const alterar = async (patch, ok) => {
    setBusy("conta");
    try { await contas({ acao: "conta_alterar", conta_id: conta.id, ...patch }); notify(ok); recarregar(); } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };
  const trocarLogo = async (e) => {
    const arq = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!arq) return;
    try { await alterar({ logo: await reduzirLogo(arq) }, "Logo atualizado"); } catch (e2) { notify(errMsg(e2)); }
  };
  const gerarChave = async () => {
    if (conta.tem_robo && !confirm("Gerar uma chave nova desliga a chave atual: o robô de lances que estiver instalado para esta empresa para de funcionar até receber a chave nova. Continuar?")) return;
    setBusy("chave");
    try { const r = await contas({ acao: "robo_chave", conta_id: conta.id }); setChave(r.chave); recarregar(); } catch (e) { notify(errMsg(e)); }
    setBusy("");
  };
  return (
    <div className="stack">
      <div className="top">
        <div><h1>{conta.nome}</h1><p>Código <b>{conta.codigo}</b>{conta.cidade ? ` · ${conta.cidade}` : ""}{conta.uf ? `/${conta.uf}` : ""} · criada em {fmtData(conta.criado_em)}</p></div>
        <button className="btn ghost" onClick={onVoltar}>Voltar</button>
      </div>
      {!conta.ativa && <div className="banner warn"><span>Esta conta está <b>desligada</b>: ninguém dela consegue entrar e os robôs não trabalham para ela.</span></div>}
      <div className="grid2">
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Empresa</h2></div>
          <div className="row-inline" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {conta.logo ? <img src={conta.logo} alt="Logo da empresa" style={{ maxWidth: 180, maxHeight: 80, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, padding: 4, background: "#fff" }} /> : <span className="hint">Sem logo</span>}
            <label className="btn ghost sm">{conta.logo ? "Trocar logo" : "Enviar logo"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={trocarLogo} /></label>
            {conta.logo && <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => alterar({ logo: null }, "Logo removido")}>Remover</button>}
          </div>
          <p className="hint" style={{ margin: 0 }}>O logo aparece na tela de entrada dos aparelhos desta empresa.</p>
          <label className="toggle"><input type="checkbox" checked={conta.ativa} disabled={!!busy} onChange={(e) => { if (!e.target.checked && !confirm(`Desligar a conta "${conta.nome}"? Ninguém dela consegue entrar enquanto estiver desligada. Os dados ficam guardados.`)) return; alterar({ ativa: e.target.checked }, e.target.checked ? "Conta religada" : "Conta desligada"); }} />Conta ativa</label>
        </div>
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Link e QR code da empresa</h2></div>
          <LinkConta codigo={conta.codigo} notify={notify} />
          {!(aparelho && aparelho.codigo === conta.codigo) && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { prenderAparelho(conta); notify("Este aparelho agora abre na tela de entrada desta empresa"); }}>Usar este aparelho nesta empresa</button>}
        </div>
      </div>
      <div className="card form">
        <div className="card-h" style={{ marginBottom: 0 }}><h2>Robô de lances</h2><small>{conta.tem_robo ? "chave cadastrada" : "sem chave"}</small></div>
        <p className="hint" style={{ margin: 0 }}>O robô do computador da empresa usa uma chave para falar com o LicitaPro; a chave diz de qual empresa ele é, e ele só enxerga as disputas dela. No banco fica só uma impressão da chave.</p>
        {chave ? (
          <div className="banner info" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <span>Chave nova (aparece só agora). Coloque no arquivo <b>config.env</b> do robô, na linha <b>CHAVE=</b>, e reinicie o robô:</span>
            <code style={{ wordBreak: "break-all", userSelect: "all" }}>{chave}</code>
            <button type="button" className="btn ghost sm" onClick={() => navigator.clipboard && navigator.clipboard.writeText(chave).then(() => notify("Chave copiada"))}>Copiar chave</button>
          </div>
        ) : (
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={gerarChave}>{busy === "chave" ? <span className="spin" /> : null}{conta.tem_robo ? "Gerar chave nova" : "Gerar chave do robô"}</button>
        )}
      </div>
      <div className="card form">
        <div className="card-h" style={{ marginBottom: 0 }}><h2>Pessoas</h2><small>{conta.pessoas} com acesso</small></div>
        <PessoasConta contaId={conta.id} notify={notify} euEmail={euEmail} auraxis onMudou={recarregar} />
      </div>
    </div>
  );
}

export default function PainelAuraxis({ notify, onVoltar }) {
  const [lista, setLista] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [eu, setEu] = useState("");
  const carregar = useCallback(() => contas({ acao: "contas" }).then((r) => setLista(r.contas || []), (e) => { notify(errMsg(e)); setLista([]); }), []);
  useEffect(() => { carregar(); sb.auth.getUser().then(({ data }) => setEu(((data && data.user && data.user.email) || "").toLowerCase())); }, [carregar]);
  const conta = lista && lista.find((c) => c.id === aberta);
  return (
    <div className="auraxis" style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 16px 60px" }}>
      <div className="top" style={{ marginBottom: 14 }}>
        <div><h1 style={{ margin: 0 }}>Administrador Auraxis</h1><p style={{ margin: 0 }}>LicitaPro · empresas clientes e acessos</p></div>
        <div className="row-inline" style={{ gap: 8 }}>
          {onVoltar && <button className="btn ghost" onClick={onVoltar}>Voltar ao LicitaPro</button>}
          <button className="btn ghost" onClick={() => sb.auth.signOut()}>Sair</button>
        </div>
      </div>
      {conta ? (
        <ContaAdmin key={conta.id} conta={conta} notify={notify} euEmail={eu} onVoltar={() => setAberta(null)} recarregar={carregar} />
      ) : (
        <div className="stack">
          {lista === null ? <div className="card empty">Carregando…</div> : !lista.length ? <div className="card empty">Nenhuma conta ainda.</div> : (
            <div className="stack" style={{ gap: 8 }}>
              {[...lista].sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => (
                <button key={c.id} type="button" className="card" style={{ textAlign: "left", display: "flex", gap: 14, alignItems: "center", padding: "12px 16px", border: "1px solid var(--line)", opacity: c.ativa ? 1 : 0.6 }} onClick={() => setAberta(c.id)}>
                  {c.logo ? <img src={c.logo} alt="" style={{ width: 64, height: 40, objectFit: "contain" }} /> : <span className="brand-mark" style={{ width: 40, height: 40, fontWeight: 700 }}>{c.nome[0]}</span>}
                  <span style={{ minWidth: 0 }}>
                    <b>{c.nome}</b>
                    <span className="hint" style={{ display: "block" }}>Código {c.codigo}{c.cidade ? ` · ${c.cidade}` : ""} · {c.pessoas} {c.pessoas === 1 ? "pessoa" : "pessoas"}{c.tem_robo ? " · robô com chave" : ""}{!c.ativa ? " · desligada" : ""}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <NovaConta aoCriar={(id) => { carregar().then(() => setAberta(id)); }} notify={notify} />
        </div>
      )}
    </div>
  );
}
