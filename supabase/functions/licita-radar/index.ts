// =====================================================================
// LicitaPro · radar de editais (Supabase Edge Function "licita-radar")
//
//   ?tarefa=radar            → (agendador, com chave) lê os editais publicados no PNCP
//                              nos estados escolhidos e busca documentos e itens dos relevantes
//   ?tarefa=documentos       → (agendador) só busca documentos e itens dos relevantes pendentes
//   { acao: "radar" }        → (app) roda o radar agora
//   { acao: "edital", id }   → (app) busca agora o detalhe completo de um edital:
//                              dados, documentos e itens publicados no PNCP
// Só leitura de dados públicos do PNCP.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const PNCP = "https://pncp.gov.br";
const UA = "LicitaPro/1.0 (acompanhamento de processos publicos)";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Limite extends Error {}

let lastPncp = 0;
let pncpBloqueado = false;
// deno-lint-ignore no-explicit-any
async function pncpGet(path: string): Promise<any> {
  if (pncpBloqueado) throw new Limite("PNCP pediu para esperar");
  // O PNCP aceita poucas consultas por minuto: uma a cada 4,5 s fica dentro do limite.
  const wait = lastPncp + 4500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastPncp = Date.now();
  const r = await fetch(PNCP + path, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (r.status === 429) { pncpBloqueado = true; throw new Limite("PNCP pediu para esperar"); }
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(`PNCP respondeu ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const norm = (s: string) =>
  ` ${(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
// Datas do PNCP vêm no horário de Brasília sem fuso.
const brt = (s?: string | null) => (s ? (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}-03:00`) : null);
const ymd = (d: Date) => {
  const b = new Date(d.getTime() - 3 * 3600e3);
  return `${b.getUTCFullYear()}${String(b.getUTCMonth() + 1).padStart(2, "0")}${String(b.getUTCDate()).padStart(2, "0")}`;
};
const limpaObjeto = (s?: string | null) => (s || "").replace(/^\s*\[[^\]]{2,40}\]\s*-\s*/, "").trim();

function portalDe(link?: string | null, sistema?: string | null): string {
  const l = (link || "").toLowerCase();
  const s = (sistema || "").toLowerCase();
  if (l.includes("portaldecompraspublicas") || s.startsWith("ecustomize")) return "pcp";
  if (l.includes("licitardigital") || l.includes("ammlicita") || s.startsWith("licitar digital")) return "licitar";
  if (l.includes("cnetmobile") || l.includes("compras.gov.br") || s === "compras.gov.br") return "comprasgov";
  if (l.includes("bllcompras") || s.startsWith("bll")) return "bll";
  if (l.includes("licitacoes-e") || s.startsWith("licitações-e")) return "licitacoes-e";
  if (l.includes("compras.mg.gov.br") || s.startsWith("portal de compras do estado de minas")) return "mg";
  if (l.includes("bnccompras") || s.startsWith("bolsa nacional")) return "bnc";
  if (l.includes("licitanet") || s.startsWith("licitanet")) return "licitanet";
  return "outro";
}

async function carregarConfig() {
  const [{ data: cfg }, { data: pal }] = await Promise.all([
    db.from("config").select("*").eq("id", 1).single(),
    db.from("palavras").select("termo,tipo"),
  ]);
  const incluir = (pal || []).filter((p) => p.tipo === "incluir").map((p) => ({ termo: p.termo, n: norm(p.termo).trimEnd() }));
  const excluir = (pal || []).filter((p) => p.tipo === "excluir").map((p) => ({ termo: p.termo, n: norm(p.termo).trimEnd() }));
  return { cfg: cfg || { uf: "MG", ufs: ["MG"], modalidades: [6, 8] }, incluir, excluir };
}

function classificar(objeto: string, incluir: { termo: string; n: string }[], excluir: { termo: string; n: string }[]) {
  const t = norm(objeto);
  const achados = incluir.filter((p) => t.includes(p.n)).map((p) => p.termo);
  const barrado = excluir.some((p) => t.includes(p.n));
  return { termos: achados, relevante: achados.length > 0 && !barrado };
}

// ---------- Detalhe do edital: dados completos, documentos e itens ----------
async function detalharEdital(ed: { id: string; cnpj: string; ano: number; seq: number }) {
  const base = `/api/pncp/v1/orgaos/${ed.cnpj}/compras/${ed.ano}/${ed.seq}`;
  // deno-lint-ignore no-explicit-any
  const det: any = await pncpGet(`/api/consulta/v1/orgaos/${ed.cnpj}/compras/${ed.ano}/${ed.seq}`);
  // deno-lint-ignore no-explicit-any
  const arqs: any[] = (await pncpGet(`${base}/arquivos`)) || [];
  // deno-lint-ignore no-explicit-any
  const brutos: any[] = [];
  for (let pg = 1; pg <= 4; pg++) {
    // deno-lint-ignore no-explicit-any
    const r: any[] = (await pncpGet(`${base}/itens?pagina=${pg}&tamanhoPagina=500`)) || [];
    brutos.push(...r);
    if (r.length < 500) break;
  }
  const documentos = arqs
    .filter((a) => a.statusAtivo !== false)
    .map((a) => ({
      titulo: a.titulo || a.tipoDocumentoNome || "Documento",
      tipo: a.tipoDocumentoNome || null,
      // O PNCP às vezes devolve o link com uma porta interna (pncp.gov.br:57738); monta o link público.
      url: a.sequencialDocumento != null
        ? `${PNCP}/pncp-api/v1/orgaos/${ed.cnpj}/compras/${ed.ano}/${ed.seq}/arquivos/${a.sequencialDocumento}`
        : String(a.url || a.uri || "").replace(/^https?:\/\/pncp\.gov\.br:\d+/i, PNCP),
      publicado: brt(a.dataPublicacaoPncp),
    }));
  const itens = brutos.map((i) => ({
    n: i.numeroItem,
    d: i.descricao,
    q: i.quantidade,
    u: i.unidadeMedida,
    vu: i.orcamentoSigiloso ? null : i.valorUnitarioEstimado,
    vt: i.orcamentoSigiloso ? null : i.valorTotal,
    b: i.tipoBeneficioNome || null,
    s: i.situacaoCompraItemNome || null,
  }));
  const info = det ? {
    complemento: det.informacaoComplementar || null,
    modo_disputa: det.modoDisputaNome || null,
    amparo: det.amparoLegal?.nome || null,
    instrumento: det.tipoInstrumentoConvocatorioNome || null,
    criterio: brutos[0]?.criterioJulgamentoNome || null,
  } : null;
  const patch: Record<string, unknown> = { documentos, itens, info, detalhe_em: new Date().toISOString() };
  if (det) {
    if (det.objetoCompra) patch.objeto = limpaObjeto(det.objetoCompra);
    if (det.situacaoCompraNome) patch.situacao = det.situacaoCompraNome;
    if (det.dataEncerramentoProposta) patch.encerramento_propostas = brt(det.dataEncerramentoProposta);
    if (det.dataAberturaProposta) patch.abertura_propostas = brt(det.dataAberturaProposta);
    if (det.linkSistemaOrigem) patch.link_origem = det.linkSistemaOrigem;
    if (det.valorTotalEstimado != null) patch.valor_estimado = det.valorTotalEstimado;
    if (det.unidadeOrgao?.codigoIbge) patch.municipio_ibge = Number(det.unidadeOrgao.codigoIbge);
  }
  const { data, error } = await db.from("editais").update(patch).eq("id", ed.id).select("*").single();
  if (error) throw new Error(`Erro ao salvar o detalhe: ${error.message}`);
  return data;
}

// ---------- Radar ----------
async function radar(deadline: number) {
  const { cfg, incluir, excluir } = await carregarConfig();
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 3600e3);
  let lidos = 0, relevantes = 0, paginas = 0, detalhados = 0, aviso = "";
  // Vários estados: começa por um diferente a cada hora, para todos serem lidos mesmo se o tempo acabar.
  const ufs: string[] = cfg.ufs && cfg.ufs.length ? cfg.ufs : [cfg.uf || "MG"];
  const ini = new Date().getUTCHours() % ufs.length;
  const ordem = [...ufs.slice(ini), ...ufs.slice(0, ini)];
  const fim = deadline - 30_000; // reserva tempo para os documentos dos relevantes
  let parcial = false;
  varredura:
  for (const uf of ordem) {
    for (const mod of cfg.modalidades || [6, 8]) {
      for (let pagina = 1; pagina <= 40; pagina++) {
        if (Date.now() > fim) { parcial = true; break varredura; }
        // deno-lint-ignore no-explicit-any
        let res: any;
        try {
          res = await pncpGet(
            `/api/consulta/v1/contratacoes/publicacao?dataInicial=${ymd(ontem)}&dataFinal=${ymd(hoje)}&codigoModalidadeContratacao=${mod}&uf=${uf}&pagina=${pagina}&tamanhoPagina=50`,
          );
        } catch (e) {
          if (e instanceof Limite) return { lidos, relevantes, paginas, detalhados, parcial: true, aviso: "O PNCP pediu uma pausa; o restante entra na próxima rodada." };
          throw e;
        }
        paginas++;
        // deno-lint-ignore no-explicit-any
        const lista: any[] = (res && res.data) || [];
        if (!lista.length) break;
        const linhas = lista.map((d) => {
          const { termos, relevante } = classificar(`${d.objetoCompra || ""} ${d.informacaoComplementar || ""}`, incluir, excluir);
          if (relevante) relevantes++;
          return {
            controle_pncp: d.numeroControlePNCP,
            cnpj: d.orgaoEntidade?.cnpj,
            ano: d.anoCompra,
            seq: d.sequencialCompra,
            orgao: d.orgaoEntidade?.razaoSocial,
            unidade: d.unidadeOrgao?.nomeUnidade,
            municipio: d.unidadeOrgao?.municipioNome,
            uf: d.unidadeOrgao?.ufSigla,
            municipio_ibge: d.unidadeOrgao?.codigoIbge ? Number(d.unidadeOrgao.codigoIbge) : null,
            modalidade_id: d.modalidadeId,
            modalidade: d.modalidadeNome,
            numero: d.numeroCompra,
            processo_num: d.processo,
            objeto: limpaObjeto(d.objetoCompra),
            valor_estimado: d.valorTotalEstimado,
            srp: d.srp,
            abertura_propostas: brt(d.dataAberturaProposta),
            encerramento_propostas: brt(d.dataEncerramentoProposta),
            publicado_em: brt(d.dataPublicacaoPncp),
            atualizado_pncp: d.dataAtualizacaoGlobal,
            link_origem: d.linkSistemaOrigem,
            sistema: d.usuarioNome,
            portal: portalDe(d.linkSistemaOrigem, d.usuarioNome),
            situacao: d.situacaoCompraNome,
            termos,
            relevante,
            updated_at: new Date().toISOString(),
          };
        });
        lidos += linhas.length;
        const { error } = await db.from("editais").upsert(linhas, { onConflict: "controle_pncp" });
        if (error) throw new Error(`Erro ao salvar editais: ${error.message}`);
        if (pagina >= (res.totalPaginas || 1)) break;
      }
    }
  }
  const d = await documentos(deadline);
  detalhados = d.detalhados; aviso = d.aviso;
  return { lidos, relevantes, paginas, detalhados, ...(parcial ? { parcial: true } : {}), ...(aviso ? { aviso } : {}) };
}

// Documentos e itens dos relevantes ainda abertos: primeiro os nunca buscados, depois os
// buscados há mais de 24 h (para pegar documentos novos e retificações).
async function documentos(deadline: number) {
  let detalhados = 0, aviso = "";
  const agora = new Date().toISOString();
  const ontem = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pend } = await db.from("editais").select("id,cnpj,ano,seq,detalhe_em")
    .eq("relevante", true).neq("status", "descartado")
    .or(`detalhe_em.is.null,detalhe_em.lt.${ontem}`)
    .gte("encerramento_propostas", agora)
    .order("detalhe_em", { ascending: true, nullsFirst: true })
    .order("encerramento_propostas", { ascending: true }).limit(30);
  for (const ed of pend || []) {
    if (Date.now() > deadline - 15_000) { aviso = "Faltaram documentos de alguns editais; entram na próxima rodada."; break; }
    try { await detalharEdital(ed); detalhados++; } catch (e) { if (e instanceof Limite) { aviso = "O PNCP pediu uma pausa."; break; } }
  }
  return { detalhados, aviso, pendentes: (pend || []).length };
}

// ---------- Entrada ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const tarefa = url.searchParams.get("tarefa");
  const deadline = Date.now() + 120_000;
  try {
    if (tarefa) {
      const chave = req.headers.get("x-cron-key") || "";
      const { data: seg } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
      if (!seg || chave !== seg.valor) return json({ erro: "não autorizado" }, 401);
      if (tarefa === "radar") return json(await radar(deadline));
      if (tarefa === "documentos") return json(await documentos(deadline));
      return json({ erro: "tarefa desconhecida" }, 400);
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email) return json({ erro: "Faça login novamente." }, 401);
    const { data: membro } = await db.from("equipe").select("papel,ativo").eq("email", email).maybeSingle();
    if (!membro || !membro.ativo) return json({ erro: "Seu acesso ainda não foi liberado pelo administrador." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.acao === "edital") {
      const { data: ed } = await db.from("editais").select("id,cnpj,ano,seq").eq("id", String(body.id || "")).maybeSingle();
      if (!ed) return json({ erro: "Edital não encontrado." }, 404);
      return json({ edital: await detalharEdital(ed) });
    }
    if (body.acao === "radar") {
      if (membro.papel === "acompanha") return json({ erro: "Seu perfil não pode rodar o radar." }, 403);
      return json(await radar(deadline));
    }
    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    const msg = e instanceof Limite ? "O PNCP está limitando consultas agora. Tente de novo em alguns minutos." : String((e as Error).message || e);
    return json({ erro: msg }, 500);
  }
});
