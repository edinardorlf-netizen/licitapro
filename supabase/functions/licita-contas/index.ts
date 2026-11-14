// =====================================================================
// LicitaPro · contas (empresas clientes) e acessos da equipe — no mesmo jeito do LojaPro
//
// O administrador Auraxis (tabela auraxis_admins) cria a conta de cada cliente (código + nome)
// e cadastra as pessoas com NOME + senha provisória. No primeiro acesso a pessoa cria a própria senha.
// O administrador da conta (dono) também cadastra pessoas e dá senha provisória nova na conta dele.
// Por dentro, o login usa um e-mail interno que ninguém vê e para onde nada é enviado:
//   <nome>.<código>@contas.licitapro.invalid   (o app monta o mesmo e-mail na tela de entrada)
// verify_jwt = true. Cada conta só enxerga os próprios dados (regras do banco por conta_id).
//
// POST { acao, ... }:
//   eu · contas · conta_criar · conta_alterar · pessoas · pessoa_criar · pessoa_senha · pessoa_alterar · robo_chave
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class Erro extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export const DOMINIO = "contas.licitapro.invalid";
const normalizar = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (t: string) => normalizar(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const codigoConta = (t: string) => slug(t).replace(/-/g, "");
const emailInterno = (codigo: string, nome: string) => `${slug(nome)}.${codigo}@${DOMINIO}`;
const UUID = /^[0-9a-f-]{36}$/i;
const PAPEIS = ["admin", "equipe", "acompanha"];
// Ponto de partida das permissões (o dono ajusta depois em Ajustes → Equipe)
const PERM: Record<string, Record<string, boolean>> = {
  admin: {},
  equipe: { radar: true, processos: true, contratos: true, catalogo: true, custos: true, reequilibrio: true, robo: true, editar: true },
  acompanha: { processos: true, contratos: true },
};

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function cnpjValido(c: string) {
  const d = String(c || "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

// Quem está chamando: administrador Auraxis e/ou administrador de uma conta
async function quem(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) throw new Erro("Faça login novamente.", 401);
  const [{ data: ax }, { data: m }] = await Promise.all([
    db.from("auraxis_admins").select("email").eq("email", email).maybeSingle(),
    db.from("equipe").select("email,papel,ativo,conta_id").eq("email", email).maybeSingle(),
  ]);
  const auraxis = !!ax;
  const adminDe = m && m.ativo && m.papel === "admin" ? m.conta_id as string : null;
  return { email, auraxis, adminDe, contaId: m && m.ativo ? m.conta_id as string : null };
}
type Quem = Awaited<ReturnType<typeof quem>>;
const podeConta = (q: Quem, contaId: string) => q.auraxis || (!!q.adminDe && q.adminDe === contaId);
function exigir(cond: boolean, msg = "Sem permissão para isso.") { if (!cond) throw new Erro(msg, 403); }

async function contaPorId(id: string) {
  if (!UUID.test(String(id || ""))) throw new Erro("Conta inválida.");
  const { data } = await db.from("contas").select("id,codigo,nome,ativa").eq("id", id).maybeSingle();
  if (!data) throw new Erro("Conta não encontrada.", 404);
  return data;
}

async function uidDe(email: string, uid?: string | null) {
  if (uid) return uid;
  const { data } = await db.rpc("uid_por_email", { p_email: email });
  if (!data) throw new Erro("Não achei o login dessa pessoa.");
  return data as string;
}

async function contas(q: Quem) {
  exigir(q.auraxis);
  const { data: cs } = await db.from("contas").select("id,codigo,nome,cidade,uf,logo,ativa,criado_em,robo_hash").order("nome");
  const { data: eq } = await db.from("equipe").select("conta_id,ativo");
  const n = new Map<string, number>();
  for (const e of eq || []) if (e.ativo) n.set(e.conta_id, (n.get(e.conta_id) || 0) + 1);
  return { contas: (cs || []).map((c: any) => ({ id: c.id, codigo: c.codigo, nome: c.nome, cidade: c.cidade, uf: c.uf, logo: c.logo, ativa: c.ativa, criado_em: c.criado_em, tem_robo: !!c.robo_hash, pessoas: n.get(c.id) || 0 })) };
}

async function contaCriar(q: Quem, b: any) {
  exigir(q.auraxis, "Só o administrador Auraxis cria contas.");
  const nome = String(b.nome || "").trim();
  const codigo = codigoConta(b.codigo || nome);
  if (nome.length < 2) throw new Erro("Informe o nome do cliente.");
  if (codigo.length < 3 || codigo.length > 30) throw new Erro("O código precisa ter de 3 a 30 letras ou números.");
  const { data: ja } = await db.from("contas").select("id").eq("codigo", codigo).maybeSingle();
  if (ja) throw new Erro(`O código "${codigo}" já é usado por outra conta.`);
  const cnpj = String(b.cnpj || "").replace(/\D/g, "");
  if (cnpj && !cnpjValido(cnpj)) throw new Erro("CNPJ inválido. Confira os números.");
  const { data: c, error } = await db.from("contas").insert({ codigo, nome: nome.slice(0, 120), cidade: String(b.cidade || "").trim().slice(0, 80) || null, uf: String(b.uf || "").trim().toUpperCase().slice(0, 2) || null, criado_por: q.email }).select("id,codigo,nome").single();
  if (error) throw new Erro(`Não deu para criar a conta: ${error.message}`, 500);
  const { error: e2 } = await db.rpc("criar_conta_dados", { p_conta: c.id });
  if (e2) { await db.from("contas").delete().eq("id", c.id); throw new Erro(`Não deu para preparar a conta: ${e2.message}`, 500); }
  if (cnpj) {
    const { error: e3 } = await db.from("empresas").insert({ conta_id: c.id, nome: String(b.empresa_nome || nome).trim().slice(0, 120), cnpj });
    if (e3) return { conta: c, aviso: `Conta criada, mas a empresa não foi cadastrada: ${e3.message}` };
  }
  return { conta: c };
}

async function contaAlterar(q: Quem, b: any) {
  const c = await contaPorId(b.conta_id);
  exigir(podeConta(q, c.id));
  const patch: Record<string, unknown> = {};
  if (typeof b.nome === "string" && b.nome.trim().length >= 2) patch.nome = b.nome.trim().slice(0, 120);
  if (typeof b.cidade === "string") patch.cidade = b.cidade.trim().slice(0, 80) || null;
  if (typeof b.uf === "string") patch.uf = b.uf.trim().toUpperCase().slice(0, 2) || null;
  if (b.logo === null) patch.logo = null;
  else if (typeof b.logo === "string") {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(b.logo) || b.logo.length > 300_000) throw new Erro("Logo inválido ou grande demais.");
    patch.logo = b.logo;
  }
  if (typeof b.ativa === "boolean") { exigir(q.auraxis, "Só o administrador Auraxis liga ou desliga contas."); patch.ativa = b.ativa; }
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await db.from("contas").update(patch).eq("id", c.id);
  if (error) throw new Erro(error.message, 500);
  return { ok: true };
}

async function pessoas(q: Quem, b: any) {
  const c = await contaPorId(b.conta_id);
  exigir(podeConta(q, c.id));
  const { data } = await db.from("equipe").select("email,nome,papel,ativo,login,trocar_senha,permissoes,created_at").eq("conta_id", c.id).order("nome");
  return { pessoas: (data || []).map((p: any) => ({ ...p, interno: p.email.endsWith("@" + DOMINIO) })) };
}

async function pessoaCriar(q: Quem, b: any) {
  const c = await contaPorId(b.conta_id);
  exigir(podeConta(q, c.id));
  if (!c.ativa) throw new Erro("Essa conta está desligada.");
  const nome = String(b.nome || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const login = slug(nome);
  if (!login) throw new Erro("Informe o nome.");
  const papel = PAPEIS.includes(b.papel) ? b.papel : "acompanha";
  const senha = String(b.senha || "");
  if (senha.length < 6) throw new Erro("A senha provisória precisa ter pelo menos 6 caracteres.");
  const { data: ja } = await db.from("equipe").select("email").eq("conta_id", c.id).eq("login", login).maybeSingle();
  if (ja) throw new Erro(`Já existe "${nome}" nesta conta. Use um nome diferente (ex.: "${nome} S").`);
  const email = emailInterno(c.codigo, nome);
  const { data: cri, error } = await db.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { name: nome, conta: c.codigo } });
  if (error || !cri?.user) {
    if (/already|registered|exists/i.test(error?.message || "")) throw new Erro(`Já existe um acesso igual a "${nome}". Use um nome diferente.`);
    throw new Erro(`Não deu para criar o acesso: ${error?.message || "erro"}`, 500);
  }
  const { error: e2 } = await db.from("equipe").insert({ email, nome, papel, ativo: true, conta_id: c.id, login, trocar_senha: true, uid: cri.user.id, permissoes: PERM[papel] });
  if (e2) {
    await db.auth.admin.deleteUser(cri.user.id).catch(() => {});
    throw new Erro(/dono do sistema/i.test(e2.message) ? "Esta conta já tem um administrador (o dono). Cadastre como Equipe." : `Não deu para cadastrar: ${e2.message}`, 400);
  }
  // Primeiro administrador da conta vira o dono dela
  if (papel === "admin") await db.from("config").update({ dono: email }).eq("conta_id", c.id).is("dono", null);
  return { ok: true, nome, login };
}

async function pessoaDe(q: Quem, email: string) {
  const em = String(email || "").toLowerCase();
  const { data: p } = await db.from("equipe").select("email,nome,papel,ativo,conta_id,uid").eq("email", em).maybeSingle();
  if (!p) throw new Erro("Pessoa não encontrada.", 404);
  exigir(podeConta(q, p.conta_id));
  return p;
}

async function pessoaSenha(q: Quem, b: any) {
  const p = await pessoaDe(q, b.email);
  const senha = String(b.senha || "");
  if (senha.length < 6) throw new Erro("A senha provisória precisa ter pelo menos 6 caracteres.");
  if (p.email === q.email) throw new Erro("Para trocar a sua própria senha use “Trocar minha senha”.");
  const uid = await uidDe(p.email, p.uid);
  const { error } = await db.auth.admin.updateUserById(uid, { password: senha });
  if (error) throw new Erro(`Não deu para trocar a senha: ${error.message}`, 500);
  await db.from("equipe").update({ trocar_senha: true, uid }).eq("email", p.email);
  return { ok: true };
}

async function pessoaAlterar(q: Quem, b: any) {
  const p = await pessoaDe(q, b.email);
  const patch: Record<string, unknown> = {};
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
  if (typeof b.papel === "string" && PAPEIS.includes(b.papel)) {
    patch.papel = b.papel;
    if (b.papel !== p.papel && b.papel !== "admin") patch.permissoes = PERM[b.papel];
  }
  if (typeof b.nome === "string" && b.nome.trim().length >= 2) patch.nome = b.nome.trim().slice(0, 60);
  if (p.email === q.email && (patch.ativo === false || (patch.papel && patch.papel !== p.papel))) throw new Erro("Você não pode desligar nem mudar o seu próprio acesso.");
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await db.from("equipe").update(patch).eq("email", p.email);
  if (error) throw new Erro(/dono do sistema/i.test(error.message) ? error.message : `Não deu para alterar: ${error.message}`, 400);
  return { ok: true };
}

// Chave nova do robô de lances desta conta (aparece uma vez; no banco fica só o hash)
async function roboChave(q: Quem, b: any) {
  const c = await contaPorId(b.conta_id);
  exigir(podeConta(q, c.id));
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chave = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { error } = await db.from("contas").update({ robo_hash: await sha256(chave) }).eq("id", c.id);
  if (error) throw new Erro(error.message, 500);
  return { chave };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  try {
    const q = await quem(req);
    const b = await req.json().catch(() => ({}));
    switch (b.acao) {
      case "eu": return json({ auraxis: q.auraxis, conta_id: q.contaId, admin_de: q.adminDe });
      case "contas": return json(await contas(q));
      case "conta_criar": return json(await contaCriar(q, b));
      case "conta_alterar": return json(await contaAlterar(q, b));
      case "pessoas": return json(await pessoas(q, b));
      case "pessoa_criar": return json(await pessoaCriar(q, b));
      case "pessoa_senha": return json(await pessoaSenha(q, b));
      case "pessoa_alterar": return json(await pessoaAlterar(q, b));
      case "robo_chave": return json(await roboChave(q, b));
      default: return json({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    const st = e instanceof Erro ? e.status : 500;
    return json({ erro: String((e as Error).message || e) }, st);
  }
});
