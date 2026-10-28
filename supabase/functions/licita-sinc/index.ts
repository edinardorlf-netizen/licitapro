// =====================================================================
// LicitaPro · puxa os processos do "Acesso Rápido" do Portal de Compras Públicas
//
// Entra com o login de cada empresa (guardado no cofre) e lê a tabela
// "Acesso Rápido - Sessões Públicas/Suas Propostas" do painel: os processos
// em que a empresa ENVIOU PROPOSTA e que o portal ainda não deu como finalizados.
// Também confere a lista "Suas Propostas" (caso o painel mostre só os primeiros).
// Só leitura: não envia proposta, lance nem mensagem.
//
//   ?tarefa=sincronizar (agendador, com chave)   |   { acao: "sincronizar", empresa_id? } (app)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { Sessao, PCP_OP, lerSeusProcessos, lerAcessoRapido, urlSuasPropostas, caminhoPublico, type ProcPortal } from "./pcp.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Fica de fora o que o portal já deu como encerrado para a empresa.
const ENCERRADO = /finalizad|cancelad|revogad|anulad|desert|fracassad/i;
const ORDEM: Record<string, number> = { analise: 0, participar: 1, proposta: 2 };

// Dentro da sala do processo, aba "Itens com proposta enviada pelo fornecedor" (param=10).
// Devolve os números dos itens em que ESTE login enviou proposta (null = não deu para conferir).
let ultimoDiag = "";
async function itensComProposta(s: Sessao, codigo: number, deadline: number): Promise<number[] | null> {
  const salaUrl = `${PCP_OP}/4/SessaoPublica/?ttCD_CHAVE=${codigo}`;
  const sala = await s.texto(salaUrl);
  ultimoDiag = `sala→${sala.url.replace(PCP_OP, "")} (${sala.status}, ${sala.html.length}b)`;
  const itens = new Set<number>();
  let total: number | null = null;
  for (let pg = 1; pg <= 50; pg++) {
    if (pg > 1 && Date.now() > deadline - 20000) return null;
    const { html, status, url } = await s.texto(`${PCP_OP}/4/SessaoPublica/lances/htmlAba.asp?param=10`, {
      method: "POST",
      body: `param=10&ttCD_LICITACAO=${codigo}&ttPagina=${pg}&ttPaginaItemLote=1`,
      extra: { Referer: salaUrl, Origin: PCP_OP, "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01" },
    });
    const t = html.match(/Total de Registros:\s*(\d+)/i);
    if (!t) {
      ultimoDiag += ` · aba→${url.replace(PCP_OP, "")} (${status}): ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`;
      return pg === 1 ? null : [...itens];
    }
    total = Number(t[1]);
    for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
      const td = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      const n = td ? td[1].replace(/<[^>]+>/g, "").trim() : "";
      if (/^\d{1,5}$/.test(n)) itens.add(Number(n));
    }
    if (total === 0 || itens.size >= total) break;
  }
  return [...itens];
}

async function sincronizarAcesso(a: any, deadline: number, quem: string) {
  const r = { portal: a.portal, empresa_id: a.empresa_id, lidos: 0, novos: [] as any[], ja: 0, ignorados: 0, semProposta: [] as string[], naoConferidos: [] as string[], removidos: [] as string[], aviso: "" };
  const { data: senha, error: eS } = await db.rpc("senha_acesso", { p_id: a.id });
  if (eS || !senha) throw new Error("A senha desse acesso não está guardada. Cadastre de novo em Ajustes → Empresas.");

  const s = new Sessao();
  try {
    await s.entrar(a.usuario, String(senha));

    // 1) Acesso Rápido do painel
    const painel = await s.texto(`${PCP_OP}/4/Dashboard/`);
    const mapa = new Map<number, ProcPortal>();
    for (const x of lerAcessoRapido(painel.html)) mapa.set(x.codigo, x);
    if (!/linhasFornecimento/i.test(painel.html)) throw new Error("Não encontrei a tabela “Acesso Rápido” no painel do portal.");

    // 2) "Suas Propostas" com a mesma regra (o painel pode mostrar só os primeiros)
    for (let pg = 1; pg <= 6; pg++) {
      if (Date.now() > deadline - 40000) break;
      const { html } = await s.texto(urlSuasPropostas(pg));
      const linhas = lerSeusProcessos(html);
      for (const x of linhas) if (!mapa.has(x.codigo) && x.situacao && !ENCERRADO.test(x.situacao)) mapa.set(x.codigo, x);
      if (linhas.length < 10) break;
      // Daí para trás é tudo finalizado: para de paginar
      if (linhas.every((x) => ENCERRADO.test(x.situacao))) break;
    }

    const lista = [...mapa.values()];
    r.lidos = lista.length;
    const candidatos = lista.filter((x) => !ENCERRADO.test(x.situacao));
    r.ignorados = lista.length - candidatos.length;

    const codigos = candidatos.map((x) => x.codigo);
    const { data: existentes } = codigos.length
      ? await db.from("processos").select("id,pcp_codigo,etapa,etapa_auto,created_by,favorito,orgao,numero").in("pcp_codigo", codigos)
      : { data: [] as any[] };
    const porCodigo = new Map((existentes || []).map((p: any) => [Number(p.pcp_codigo), p]));

    for (const x of candidatos) {
      const ja = porCodigo.get(x.codigo);
      if (Date.now() > deadline - 12000) { r.aviso = "Ficaram processos para a próxima rodada."; break; }

      // Confere na sala se este login enviou proposta em algum item
      const itens = await itensComProposta(s, x.codigo, deadline);
      const nome = `${(x.orgao || "").slice(0, 60)} ${x.numero ? "Nº " + x.numero.split(" ")[0] : ""}`.trim();
      if (itens === null) {
        // Sala indisponível (ex.: suspenso antes da abertura): não cadastra nem remove; confere de novo na próxima rodada
        r.naoConferidos.push(`${nome} [${ultimoDiag}]`);
        r.ignorados++;
        continue;
      }
      if (!itens.length) {
        r.semProposta.push(nome);
        r.ignorados++;
        // Cadastrado antes pelo robô, sem anotação da equipe e sem estrela: sai do acompanhamento
        if (ja && String(ja.created_by || "").startsWith("robô") && !ja.favorito) {
          const { count } = await db.from("movimentacoes").select("id", { count: "exact", head: true }).eq("processo_id", ja.id).eq("fonte", "equipe");
          if (!count) { await db.from("processos").delete().eq("id", ja.id); r.removidos.push(nome); }
        }
        continue;
      }
      // Marca como "Vamos disputar" os itens com proposta deste login
      const marcar = itens.map((n) => ({ processo_id: "", numero: n, participar: true }));

      if (ja) {
        for (let i = 0; i < marcar.length; i += 300) {
          await db.from("itens").upsert(marcar.slice(i, i + 300).map((m) => ({ ...m, processo_id: ja.id })), { onConflict: "processo_id,numero" });
        }
        r.ja++;
        // Estava como "Em análise" ou "Vamos participar" e a proposta apareceu no portal → "Proposta enviada"
        if (ja.etapa_auto !== false && (ORDEM[ja.etapa] ?? 9) < 2) {
          await db.from("processos").update({ etapa: "proposta", etapa_motivo: "A proposta da empresa aparece em “Suas Propostas” no portal." }).eq("id", ja.id);
          await db.from("movimentacoes").upsert({ processo_id: ja.id, fonte: "sistema", tipo: "etapa", titulo: "Etapa: Proposta enviada (automático)", detalhe: "A proposta da empresa apareceu no portal.", autor: "robô", ocorrido_em: new Date().toISOString(), importante: true, chave: "etapa-proposta" }, { onConflict: "processo_id,chave", ignoreDuplicates: true });
        }
        continue;
      }
      if (r.novos.length >= 25) { r.aviso = "Ficaram processos para a próxima rodada."; break; }

      const dados = await s.texto(`${PCP_OP}/4/Pregoes/DadosPregao/?slA=Edit&ttCD_CHAVE=${x.codigo}`);
      const caminho = caminhoPublico(dados.html);
      const link = caminho ? `https://www.portaldecompraspublicas.com.br/processos/${caminho}` : null;
      let edital: any = null;
      if (caminho) {
        const { data } = await db.from("editais").select("*").ilike("link_origem", `%${caminho}%`).limit(1);
        edital = data && data[0];
      }
      const novo = {
        edital_id: edital?.id || null,
        controle_pncp: edital?.controle_pncp || null,
        cnpj: edital?.cnpj || null, ano: edital?.ano || null, seq: edital?.seq || null,
        pcp_path: caminho, pcp_codigo: x.codigo, portal: "pcp", link_origem: link,
        orgao: edital?.orgao || x.orgao || null, municipio: edital?.municipio || null,
        numero: (x.numero || "").split(" ")[0] || null, objeto: x.objeto || edital?.objeto || null,
        modalidade: edital?.modalidade || null, valor_estimado: edital?.valor_estimado ?? null,
        data_sessao: x.abertura, empresa_id: a.empresa_id, etapa: "proposta",
        etapa_motivo: "A proposta da empresa aparece em “Suas Propostas” no portal.",
        created_by: `robô · Acesso Rápido (${quem})`, proxima_verificacao: new Date().toISOString(),
      };
      const { data: criado, error } = await db.from("processos").insert(novo).select("id,orgao,numero,data_sessao").single();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { r.ja++; continue; }
        throw new Error(`Erro ao cadastrar ${x.numero}: ${error.message}`);
      }
      for (let i = 0; i < marcar.length; i += 300) {
        await db.from("itens").upsert(marcar.slice(i, i + 300).map((m) => ({ ...m, processo_id: criado.id })), { onConflict: "processo_id,numero" });
      }
      if (edital) await db.from("editais").update({ status: "acompanhando" }).eq("id", edital.id);
      await db.from("movimentacoes").insert({ processo_id: criado.id, fonte: "sistema", tipo: "cadastro", titulo: "Processo puxado do “Acesso Rápido” do portal (proposta enviada)", detalhe: `Login ${a.usuario} · proposta em ${itens.length} item(ns)`, autor: "robô", ocorrido_em: new Date().toISOString(), chave: "cadastro" });
      r.novos.push(criado);
    }
  } finally {
    await s.sair();
  }
  return r;
}

async function sincronizar(empresaId: string | undefined, deadline: number, quem: string) {
  let q = db.from("acessos").select("id,empresa_id,portal,usuario,senha_id").not("senha_id", "is", null).eq("portal", "pcp");
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data: acessos } = await q;
  if (!acessos || !acessos.length) throw new Error("Não há login do Portal de Compras Públicas guardado. Cadastre em Ajustes → Empresas e acessos.");
  const resultados: any[] = [];
  for (const a of acessos) {
    if (Date.now() > deadline - 15000) break;
    try {
      const r = await sincronizarAcesso(a, deadline, quem);
      await db.from("acessos").update({ sinc_em: new Date().toISOString(), sinc_ok: true, sinc_msg: `${r.novos.length} novo(s), ${r.ja} já acompanhado(s), ${r.ignorados} sem proposta ou encerrado(s)${r.removidos.length ? `, ${r.removidos.length} removido(s)` : ""}` }).eq("id", a.id);
      resultados.push(r);
    } catch (e) {
      const msg = String((e as Error).message || e);
      await db.from("acessos").update({ sinc_em: new Date().toISOString(), sinc_ok: false, sinc_msg: msg.slice(0, 300) }).eq("id", a.id);
      resultados.push({ portal: a.portal, empresa_id: a.empresa_id, erro: msg });
    }
  }
  return { resultados };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const deadline = Date.now() + 110_000;
  try {
    const tarefa = new URL(req.url).searchParams.get("tarefa");
    if (tarefa) {
      const { data: seg } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
      if (!seg || (req.headers.get("x-cron-key") || "") !== seg.valor) return json({ erro: "não autorizado" }, 401);
      return json(await sincronizar(undefined, deadline, "automático"));
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email) return json({ erro: "Faça login novamente." }, 401);
    const { data: membro } = await db.from("equipe").select("papel,ativo").eq("email", email).maybeSingle();
    if (!membro || !membro.ativo) return json({ erro: "Seu acesso ainda não foi liberado pelo administrador." }, 403);
    if (membro.papel === "acompanha") return json({ erro: "Seu perfil só acompanha disputas." }, 403);
    const body = await req.json().catch(() => ({}));
    const emp = typeof body.empresa_id === "string" && /^[0-9a-f-]{36}$/i.test(body.empresa_id) ? body.empresa_id : undefined;
    return json(await sincronizar(emp, deadline, email.split("@")[0]));
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
