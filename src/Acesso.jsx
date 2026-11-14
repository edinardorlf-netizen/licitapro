// =====================================================================
// LicitaPro · entrada no sistema, no mesmo jeito do LojaPro
// A equipe entra com NOME + senha. O aparelho guarda a empresa (conta) depois da
// primeira vez (código digitado, link ou QR code), então nas próximas basta nome e senha.
// Por dentro o login usa um e-mail interno que ninguém vê e para onde nada é enviado
// (<nome>.<código>@contas.licitapro.invalid), montado igual na função licita-contas.
// O administrador Auraxis e quem já entrava por e-mail continuam com "Entrar com e-mail".
// =====================================================================
import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import { sb, appUrl, errMsg } from "./util.js";

export const DOMINIO = "contas.licitapro.invalid";
const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const slug = (t) => normalizar(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export const codigoConta = (t) => slug(t).replace(/-/g, "");
export const emailInterno = (codigo, nome) => `${slug(nome)}.${codigo}@${DOMINIO}`;
export const ehInterno = (email) => String(email || "").endsWith("@" + DOMINIO);
export const linkDaConta = (codigo) => `${appUrl()}#entrar/${codigo}`;

// ---------- aparelho preso a uma conta (só neste navegador) ----------
const CHAVE = "licitapro.aparelho";
export function aparelhoLido() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch (e) { return null; }
}
export function prenderAparelho({ codigo, nome, logo }) {
  try { localStorage.setItem(CHAVE, JSON.stringify({ codigo, nome, logo: logo || null })); } catch (e) { /* navegador sem armazenamento: só não lembra */ }
  window.dispatchEvent(new Event("licitapro-aparelho"));
}
export function soltarAparelho() {
  try { localStorage.removeItem(CHAVE); } catch (e) { /* ignora */ }
  window.dispatchEvent(new Event("licitapro-aparelho"));
}
export function useAparelho() {
  const [a, setA] = useState(aparelhoLido);
  useEffect(() => {
    const f = () => setA(aparelhoLido());
    window.addEventListener("licitapro-aparelho", f);
    return () => window.removeEventListener("licitapro-aparelho", f);
  }, []);
  return a;
}

export async function contaPublica(codigo) {
  const cod = codigoConta(codigo);
  if (cod.length < 3) return null;
  const { data, error } = await sb.rpc("conta_publica", { p_codigo: cod });
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

/* Campo de senha com o botão de olho para mostrar/esconder o que foi digitado */
export function CampoSenha({ id, value, onChange, autoComplete }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input id={id} className="input" type={ver ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 46 }} spellCheck={false} autoCapitalize="none" />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Esconder a senha" : "Mostrar a senha"} aria-pressed={ver} title={ver ? "Esconder a senha" : "Mostrar a senha"}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 38, height: 34, border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", borderRadius: 8, display: "grid", placeItems: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {ver && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </div>
  );
}

function Marca({ aparelho }) {
  return (
    <div className="auth-hero">
      {aparelho && aparelho.logo
        ? <img src={aparelho.logo} alt="" style={{ maxWidth: 160, maxHeight: 72, objectFit: "contain" }} />
        : <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6-6" /></svg></span>}
      <h1>{aparelho ? aparelho.nome : "LicitaPro"}</h1>
      <div className="por-marca">{aparelho ? <>LicitaPro · um sistema <b>Auraxis</b></> : <>um sistema <b>Auraxis</b></>}</div>
      {!aparelho && <p>Editais, processos e disputas da equipe num lugar só.</p>}
    </div>
  );
}

const ERROS = (e) => {
  const m = String((e && e.message) || e || "");
  if (/Invalid login|invalid_credentials/i.test(m)) return "Nome ou senha incorretos.";
  return errMsg(e);
};

/* Tela de entrada: código da empresa (só na 1ª vez no aparelho) + nome + senha */
export function Entrar() {
  const aparelho = useAparelho();
  const [modo, setModo] = useState("nome"); // nome | email | esqueci
  const [f, setF] = useState({ codigo: "", nome: "", email: "", senha: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const muda = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === "string" ? v : v.target.value }));

  const porNome = async (e) => {
    e.preventDefault(); setErr(""); setInfo("");
    if (!f.nome.trim()) return setErr("Digite o seu nome.");
    if (f.senha.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    setBusy(true);
    try {
      const ficha = aparelho || (await contaPublica(f.codigo));
      if (!ficha) throw new Error("Código da empresa não encontrado. Confira com quem instalou o sistema.");
      const { error } = await sb.auth.signInWithPassword({ email: emailInterno(ficha.codigo, f.nome), password: f.senha });
      if (error) throw error;
      if (!aparelho) prenderAparelho(ficha);
    } catch (e2) { setErr(ERROS(e2)); }
    setBusy(false);
  };

  const porEmail = async (e) => {
    e.preventDefault(); setErr(""); setInfo("");
    const email = f.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Digite um e-mail válido.");
    setBusy(true);
    try {
      if (modo === "esqueci") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() }); if (error) throw error;
        setInfo(`Se existir um acesso com ${email}, você vai receber um link para criar uma nova senha.`);
      } else {
        if (f.senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        const { error } = await sb.auth.signInWithPassword({ email, password: f.senha }); if (error) throw error;
      }
    } catch (e2) { setErr(/Invalid login/i.test(String(e2.message)) ? "E-mail ou senha incorretos." : errMsg(e2)); }
    setBusy(false);
  };

  if (modo !== "nome") {
    return (
      <div className="auth" style={{ paddingInline: 16 }}>
        <Marca />
        <form className="card form" onSubmit={porEmail} noValidate>
          <b>{modo === "esqueci" ? "Criar nova senha" : "Entrar com e-mail"}</b>
          <p className="hint" style={{ margin: 0 }}>Para o administrador Auraxis e acessos antigos por e-mail. A equipe entra com o nome, na tela anterior.</p>
          <div className="field"><label htmlFor="a-email">E-mail</label><input id="a-email" className="input" type="email" autoComplete="username" value={f.email} onChange={muda("email")} /></div>
          {modo !== "esqueci" && <div className="field"><label htmlFor="a-senha">Senha</label><CampoSenha id="a-senha" autoComplete="current-password" value={f.senha} onChange={muda("senha")} /></div>}
          {err && <p className="err">{err}</p>}
          {info && <div className="banner info">{info}</div>}
          <button className="btn block" disabled={busy}>{busy ? "Aguarde…" : modo === "esqueci" ? "Enviar link" : "Entrar"}</button>
          {modo === "email" && <button type="button" className="linkbtn" onClick={() => { setModo("esqueci"); setErr(""); }}>Esqueci minha senha</button>}
          <button type="button" className="linkbtn" onClick={() => { setModo("nome"); setErr(""); setInfo(""); }}>Voltar</button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth" style={{ paddingInline: 16 }}>
      <Marca aparelho={aparelho} />
      <form className="card form" onSubmit={porNome} noValidate>
        <b>Entrar</b>
        {!aparelho && (
          <>
            <p className="hint" style={{ margin: 0 }}>Primeira vez neste aparelho: informe o código da empresa (só é pedido uma vez).</p>
            <div className="field"><label htmlFor="a-cod">Código da empresa</label><input id="a-cod" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.codigo} onChange={muda("codigo")} /></div>
          </>
        )}
        <div className="field"><label htmlFor="a-nome">Seu nome</label><input id="a-nome" className="input" autoComplete="username" autoCapitalize="words" value={f.nome} onChange={muda("nome")} /></div>
        <div className="field"><label htmlFor="a-senha2">Senha</label><CampoSenha id="a-senha2" autoComplete="current-password" value={f.senha} onChange={muda("senha")} /></div>
        {err && <p className="err">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? "Aguarde…" : "Entrar"}</button>
        <p className="hint" style={{ margin: 0, textAlign: "center" }}>Esqueceu a senha? Peça uma senha provisória nova ao administrador da empresa.</p>
        {aparelho && <button type="button" className="linkbtn" onClick={() => { if (confirm(`Este aparelho está configurado para "${aparelho.nome}". Usar com outra empresa?`)) soltarAparelho(); }}>Não é da {aparelho.nome}?</button>}
      </form>
      <button type="button" className="linkbtn" style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }} onClick={() => { setModo("email"); setErr(""); }}>Entrar com e-mail (administrador)</button>
    </div>
  );
}

/* Aberto pelo link da empresa (…#entrar/codigo) ou pelo QR code: prende este aparelho à empresa */
export function VincularAparelho({ codigo }) {
  const aparelho = useAparelho();
  const [ficha, setFicha] = useState(undefined);
  const [feito, setFeito] = useState(false);
  useEffect(() => { contaPublica(codigo).then(setFicha, () => setFicha(null)); }, [codigo]);
  const prender = () => { prenderAparelho(ficha); setFeito(true); };
  useEffect(() => { if (ficha && !feito && (!aparelho || aparelho.codigo === ficha.codigo)) prender(); }, [ficha]); // eslint-disable-line
  const continuar = () => { location.hash = ""; location.reload(); };
  const outra = ficha && aparelho && aparelho.codigo !== ficha.codigo && !feito;
  if (ficha === undefined || (ficha && !feito && !outra)) return <div className="auth"><div className="empty">Carregando…</div></div>;
  return (
    <div className="auth" style={{ paddingInline: 16 }}>
      <div className="card form">
        {!ficha ? (
          <>
            <b style={{ fontSize: 17 }}>Empresa não encontrada</b>
            <p style={{ margin: 0 }}>O link <b>{codigo}</b> não corresponde a nenhuma empresa ativa. Confira com quem instalou o sistema.</p>
            <button className="btn" onClick={continuar}>Ir para a entrada</button>
          </>
        ) : outra ? (
          <>
            <b style={{ fontSize: 17 }}>Trocar a empresa deste aparelho?</b>
            <p style={{ margin: 0 }}>Este aparelho está configurado para <b>{aparelho.nome}</b>. Quer passar a usá-lo na <b>{ficha.nome}</b>?</p>
            <div className="row-inline"><button className="btn" onClick={prender}>Sim, usar na {ficha.nome}</button><button className="btn ghost" onClick={continuar}>Não, manter</button></div>
          </>
        ) : (
          <>
            <Marca aparelho={ficha} />
            <p style={{ margin: 0, color: "var(--green)", fontWeight: 600 }}>Este aparelho agora é da {ficha.nome}.</p>
            <p className="hint" style={{ margin: 0 }}>A equipe entra só com o nome e a senha.</p>
            <button className="btn block" onClick={continuar}>Ir para a entrada</button>
          </>
        )}
      </div>
    </div>
  );
}

/* Primeiro acesso (ou depois de uma senha provisória): a pessoa cria a senha dela */
export function TrocarSenha({ nome, conta, onFeito }) {
  const [s, setS] = useState(""); const [r, setR] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const salvar = async (e) => {
    e.preventDefault(); setErr("");
    if (s.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    if (s !== r) return setErr("As duas senhas não são iguais.");
    setBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password: s });
      if (error && !/should be different/i.test(error.message)) throw error;
      const { error: e2 } = await sb.rpc("senha_criada");
      if (e2) throw e2;
      onFeito();
    } catch (e2) { setErr(/reauthentication|recent/i.test(String(e2.message)) ? "Por segurança, saia e entre de novo com a senha provisória." : errMsg(e2)); setBusy(false); }
  };
  return (
    <form className="auth card form" onSubmit={salvar} noValidate style={{ marginInline: 16 }}>
      <b style={{ fontSize: 17 }}>Olá{nome ? `, ${nome.split(" ")[0]}` : ""}!</b>
      <p className="hint" style={{ margin: 0 }}>Boas-vindas ao LicitaPro{conta && conta.nome ? ` da ${conta.nome}` : ""}. Crie agora a <b>sua senha</b> — só você vai saber. Use pelo menos 6 letras ou números.</p>
      <div className="field"><label htmlFor="ts1">Nova senha</label><CampoSenha id="ts1" value={s} onChange={setS} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="ts2">Repita a senha</label><CampoSenha id="ts2" value={r} onChange={setR} autoComplete="new-password" /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn block" disabled={busy}>{busy ? "Salvando…" : "Criar minha senha"}</button>
      <button type="button" className="linkbtn" onClick={() => sb.auth.signOut()}>Sair</button>
    </form>
  );
}

/* QR code do link da empresa: aponta a câmera e o aparelho já fica preso à empresa */
export function QrConta({ codigo }) {
  const [img, setImg] = useState(null);
  const link = linkDaConta(codigo);
  useEffect(() => { let vivo = true; QRCode.toDataURL(link, { width: 200, margin: 1 }).then((u) => vivo && setImg(u)).catch(() => {}); return () => { vivo = false; }; }, [link]);
  return img ? <img src={img} alt={`QR code do link ${link}`} width="160" height="160" style={{ borderRadius: 8, border: "1px solid var(--line)" }} /> : null;
}

export function LinkConta({ codigo, notify }) {
  const link = linkDaConta(codigo);
  const aparelho = useAparelho();
  return (
    <div className="row-inline" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
      <QrConta codigo={codigo} />
      <div className="stack" style={{ gap: 6, minWidth: 0, flex: "1 1 220px" }}>
        <code style={{ wordBreak: "break-all", fontSize: 12.5 }}>{link}</code>
        <div className="row-inline" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn ghost sm" onClick={() => navigator.clipboard && navigator.clipboard.writeText(link).then(() => notify && notify("Link copiado"), () => notify && notify("Não deu para copiar"))}>Copiar link</button>
        </div>
        <p className="hint" style={{ margin: 0 }}>Quem abre este link (ou aponta a câmera para o QR code) fica com o aparelho preso a esta empresa e entra só com nome e senha.{aparelho && aparelho.codigo === codigo ? " Este aparelho já está configurado." : ""}</p>
      </div>
    </div>
  );
}
