// =====================================================================
// LicitaPro · ponte entre o robô de lances local (pasta robo-lances) e o banco
//
// O robô roda no computador da empresa e chama esta função com a chave dele
// (cabeçalho x-robo-key). No banco fica só o hash SHA-256 da chave, na conta da empresa
// (contas.robo_hash): a chave diz de qual conta é o robô e ele só vê os dados dela.
// verify_jwt = false: a autenticação é a chave.
//
// Ações (POST JSON { acao, ... }):
//   pulso    → sinal de vida; devolve disputas ligadas, itens, pisos, botões Parar e pedidos
//   login    → usuário e senha do portal da empresa (cofre); só em memória no robô
//   eventos  → grava decisões, avisos e erros
//   pedido   → atualiza o andamento de um pedido (ex.: preencher proposta)
//   proposta → itens cotados do processo (preço, marca, Anvisa) para preencher no portal
//   arquivos → arquivos da versão publicada (atualização automática)
//   captura  → guarda cópia de uma tela do portal para calibrar o leitor
//   verificar→ o robô viu mudança: a nuvem atualiza o processo na próxima rodada (≤ 2 min)
//
// Fase 1: SÓ OBSERVAR. Nada aqui libera lance real (robo_disputas.modo = 'observar' no banco).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const UUID = /^[0-9a-f-]{36}$/i;
// Etapas em que o processo ainda pode mudar no portal (fora "Em análise" e o pós-vitória).
const VIGENTES = ["participar", "proposta", "suspenso", "disputa", "julgamento", "habilitacao", "recurso", "homologacao"];

// O robô viu mudança no portal (chat, situação, lance): pede ao acompanhamento da nuvem
// (função licita, a cada 2 min) para olhar este processo já na próxima rodada.
// Assim movimentações, etapas e avisos continuam saindo de um lugar só, sem duplicar.
async function verificar(C: string, body: any) {
  const ids = (Array.isArray(body.processos) ? body.processos : [body.processo_id]).filter((x: any) => typeof x === "string" && UUID.test(x)).slice(0, 50);
  if (!ids.length) return { ok: false };
  const agora = new Date().toISOString();
  await db.from("processos").update({ proxima_verificacao: agora }).eq("conta_id", C).in("id", ids).gt("proxima_verificacao", agora);
  return { ok: true, processos: ids.length };
}

async function pulso(C: string, body: any) {
  const agora = new Date().toISOString();
  const est = { conta_id: C, id: "pcp", versao: Number(body.versao) || null, sinal_em: agora, status: String(body.status || "").slice(0, 40), mensagem: String(body.mensagem || "").slice(0, 300), maquina: String(body.maquina || "").slice(0, 60) };
  await db.from("robo_estado").upsert(est, { onConflict: "conta_id,id" });
  const { data: estado } = await db.from("robo_estado").select("parado_geral").eq("conta_id", C).eq("id", "pcp").maybeSingle();
  const { data: ver } = await db.from("robo_arquivos").select("versao").order("versao", { ascending: false }).limit(1);

  // Etapa de lances (14/11/2026): entra sozinho no robô (criado_por = 'automático') só o processo do Portal de
  // Compras Públicas com sessão HOJE (ou sessão ainda aberta, etapa "disputa") e com item cotado (com preço).
  // O acompanhamento dos demais continua pela nuvem (função licita, a cada 2 min).
  // Se a equipe tirar (ligado = false), ele não volta; os ligados à mão ficam.
  const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const { data: cand } = await db.from("processos").select("id,data_sessao,etapa").eq("conta_id", C).eq("portal", "pcp").eq("ativo", true).not("pcp_codigo", "is", null).in("etapa", VIGENTES)
    .or(`and(data_sessao.gte.${hojeSP}T00:00:00-03:00,data_sessao.lte.${hojeSP}T23:59:59-03:00),etapa.eq.disputa`);
  const candIds = (cand || []).map((p: any) => p.id);
  const { data: cotados } = candIds.length
    ? await db.from("itens").select("processo_id").in("processo_id", candIds).eq("participar", true).not("preco_unit", "is", null)
    : { data: [] as any[] };
  const doDia = new Set((cotados || []).map((i: any) => i.processo_id));
  const { data: todas } = await db.from("robo_disputas").select("processo_id").eq("conta_id", C);
  const jaTem = new Set((todas || []).map((d: any) => d.processo_id));
  const novos = [...doDia].filter((id) => !jaTem.has(id)).map((id) => ({ processo_id: id, ligado: true, criado_por: "automático" }));
  if (novos.length) await db.from("robo_disputas").upsert(novos, { onConflict: "processo_id", ignoreDuplicates: true });

  const { data: dispTodas } = await db.from("robo_disputas").select("processo_id,ligado,modo,parado,config,criado_por").eq("conta_id", C).eq("ligado", true);
  const disp = (dispTodas || []).filter((d: any) => d.criado_por !== "automático" || doDia.has(d.processo_id));
  const ids = disp.map((d: any) => d.processo_id);
  const disputas: any[] = [];
  if (ids.length) {
    const { data: procs } = await db.from("processos").select("id,pcp_codigo,pcp_path,portal,orgao,numero,data_sessao,empresa_id,situacao_portal,etapa").eq("conta_id", C).in("id", ids);
    const { data: itens } = await db.from("itens").select("processo_id,numero,descricao,quantidade,unidade,valor_ref,valor_minimo,participar").in("processo_id", ids);
    let { data: rItens } = await db.from("robo_itens").select("processo_id,numero,ativo,parado,estrategia,lances_dados").in("processo_id", ids);
    // Itens da disputa preenchidos sozinhos: todo item marcado "Vamos disputar" entra no robô.
    const tem = new Set((rItens || []).map((r: any) => `${r.processo_id}:${r.numero}`));
    const faltam = (itens || []).filter((i: any) => i.participar && !tem.has(`${i.processo_id}:${i.numero}`)).map((i: any) => ({ processo_id: i.processo_id, numero: i.numero }));
    if (faltam.length) {
      await db.from("robo_itens").upsert(faltam, { onConflict: "processo_id,numero", ignoreDuplicates: true });
      ({ data: rItens } = await db.from("robo_itens").select("processo_id,numero,ativo,parado,estrategia,lances_dados").in("processo_id", ids));
    }
    const empIds = [...new Set((procs || []).map((p: any) => p.empresa_id).filter(Boolean))];
    const { data: emps } = empIds.length ? await db.from("empresas").select("id,nome,apelidos,cnpj").eq("conta_id", C).in("id", empIds) : { data: [] as any[] };
    const { data: cfgG } = await db.from("config").select("empresa_nome").eq("conta_id", C).maybeSingle();
    const porEmp = new Map((emps || []).map((e: any) => [e.id, e]));
    const porItem = new Map((itens || []).map((i: any) => [`${i.processo_id}:${i.numero}`, i]));
    for (const d of disp || []) {
      const p: any = (procs || []).find((x: any) => x.id === d.processo_id);
      if (!p) continue;
      const e: any = porEmp.get(p.empresa_id);
      disputas.push({
        processo_id: p.id, pcp_codigo: p.pcp_codigo, pcp_path: p.pcp_path, portal: p.portal, orgao: p.orgao, numero: p.numero,
        data_sessao: p.data_sessao, etapa: p.etapa, empresa_id: p.empresa_id, modo: d.modo, parado: d.parado, config: d.config || {},
        empresa: { nome: e?.nome || cfgG?.empresa_nome || "", apelidos: e?.apelidos || "", cnpj: e?.cnpj || "" },
        itens: (rItens || []).filter((r: any) => r.processo_id === p.id).map((r: any) => {
          const i: any = porItem.get(`${p.id}:${r.numero}`) || {};
          return { numero: r.numero, descricao: i.descricao || "", quantidade: i.quantidade, unidade: i.unidade, valor_ref: i.valor_ref, piso: i.valor_minimo != null ? Number(i.valor_minimo) : null, ativo: r.ativo, parado: r.parado, estrategia: r.estrategia, lances_dados: r.lances_dados };
        }).sort((a: any, b: any) => a.numero - b.numero),
      });
    }
  }
  const { data: pedidos } = await db.from("robo_pedidos").select("id,processo_id,tipo,criado_em").eq("conta_id", C).eq("status", "pendente").order("criado_em").limit(5);
  return { agora, parado_geral: !!estado?.parado_geral, versao_publicada: ver && ver[0] ? ver[0].versao : null, disputas, pedidos: pedidos || [] };
}

async function login(C: string, body: any) {
  const emp = typeof body.empresa_id === "string" && UUID.test(body.empresa_id) ? body.empresa_id : null;
  let q = db.from("acessos").select("id,usuario,senha_id,empresa_id").eq("conta_id", C).eq("portal", "pcp").not("senha_id", "is", null);
  if (emp) q = q.eq("empresa_id", emp);
  const { data: a } = await q.limit(1).maybeSingle();
  if (!a) throw new Error("Não há login do Portal de Compras Públicas guardado para essa empresa. Cadastre em Ajustes → Empresas e acessos.");
  const { data: senha, error } = await db.rpc("senha_acesso", { p_id: a.id });
  if (error || !senha) throw new Error("A senha desse acesso não está guardada. Cadastre de novo em Ajustes → Empresas.");
  return { usuario: a.usuario, senha: String(senha) };
}

const TIPOS = new Set(["decisao", "erro", "aviso", "status", "proposta", "chat"]);
async function eventos(C: string, body: any) {
  const lista = (Array.isArray(body.lista) ? body.lista : []).slice(0, 200).filter((e: any) => TIPOS.has(e.tipo) && e.motivo).map((e: any) => ({
    conta_id: C,
    processo_id: typeof e.processo_id === "string" && UUID.test(e.processo_id) ? e.processo_id : null,
    numero: Number.isInteger(e.numero) ? e.numero : null,
    tipo: e.tipo, acao: e.acao ? String(e.acao).slice(0, 30) : null,
    valor: Number.isFinite(Number(e.valor)) && e.valor !== null && e.valor !== "" ? Number(e.valor) : null,
    motivo: String(e.motivo).slice(0, 500), dados: e.dados ?? null,
    criado_em: e.criado_em && !isNaN(Date.parse(e.criado_em)) ? e.criado_em : new Date().toISOString(),
  }));
  if (lista.length) {
    const { error } = await db.from("robo_eventos").insert(lista);
    if (error) throw new Error(error.message);
  }
  return { gravados: lista.length };
}

async function pedido(C: string, body: any) {
  if (!UUID.test(String(body.id || ""))) throw new Error("pedido inválido");
  const st = ["andamento", "feito", "erro"].includes(body.status) ? body.status : "erro";
  await db.from("robo_pedidos").update({ status: st, mensagem: String(body.mensagem || "").slice(0, 1000), atualizado_em: new Date().toISOString() }).eq("conta_id", C).eq("id", body.id);
  return { ok: true };
}

async function proposta(C: string, body: any) {
  if (!UUID.test(String(body.processo_id || ""))) throw new Error("processo inválido");
  const { data: p } = await db.from("processos").select("id,pcp_codigo,orgao,numero,empresa_id").eq("conta_id", C).eq("id", body.processo_id).maybeSingle();
  if (!p) throw new Error("processo não encontrado");
  const { data: itens } = await db.from("itens").select("numero,descricao,quantidade,unidade,preco_unit,preco_total,marca,anvisa,participar").eq("processo_id", body.processo_id).order("numero");
  return { processo: p, itens: (itens || []).filter((i: any) => i.participar && i.preco_unit != null) };
}

async function arquivos() {
  const { data } = await db.from("robo_arquivos").select("nome,conteudo,versao");
  return { arquivos: data || [] };
}

async function captura(C: string, body: any) {
  const pid = typeof body.processo_id === "string" && UUID.test(body.processo_id) ? body.processo_id : null;
  // Guarda no máximo 40 cópias por processo
  if (pid) {
    const { count } = await db.from("robo_capturas").select("id", { count: "exact", head: true }).eq("conta_id", C).eq("processo_id", pid);
    if ((count || 0) >= 40) return { ok: false, motivo: "limite de cópias" };
  }
  await db.from("robo_capturas").insert({ conta_id: C, processo_id: pid, tipo: String(body.tipo || "tela").slice(0, 40), url: String(body.url || "").slice(0, 500), html: String(body.html || "").slice(0, 1_500_000) });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  try {
    const chave = req.headers.get("x-robo-key") || "";
    if (!chave) return json({ erro: "chave do robô inválida" }, 401);
    const hash = await sha256(chave);
    const { data: contas } = await db.from("contas").select("id,robo_hash").eq("ativa", true).not("robo_hash", "is", null);
    const conta = (contas || []).find((c: any) => iguais(hash, String(c.robo_hash)));
    if (!conta) return json({ erro: "chave do robô inválida" }, 401);
    const C: string = conta.id;
    const body = await req.json().catch(() => ({}));
    switch (body.acao) {
      case "pulso": return json(await pulso(C, body));
      case "login": return json(await login(C, body));
      case "eventos": return json(await eventos(C, body));
      case "pedido": return json(await pedido(C, body));
      case "proposta": return json(await proposta(C, body));
      case "arquivos": return json(await arquivos());
      case "captura": return json(await captura(C, body));
      case "verificar": return json(await verificar(C, body));
      default: return json({ erro: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
