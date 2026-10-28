// =====================================================================
// LicitaPro · robô na nuvem (Supabase Edge Function "licita")
//
// Tarefas automáticas (chamadas pelo agendador do banco, com chave):
//   ?tarefa=radar       → busca editais publicados no PNCP na UF configurada
//   ?tarefa=acompanhar  → confere os processos cadastrados e registra movimentações
// Ações do app (com login de alguém da equipe):
//   { acao: "cadastrar", entrada }  → cadastra um processo a partir de um link/número
//   { acao: "verificar", id }       → confere um processo agora
//   { acao: "radar" }               → roda o radar agora
//
// Fontes: PNCP (dados públicos de todos os portais) e as páginas públicas do
// Portal de Compras Públicas (chat da sessão, situação, itens e documentos).
// O Licitar Digital bloqueia acesso automático, então ele é acompanhado pelo PNCP.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { Sessao, PCP_OP, lerSeusProcessos, urlSeusProcessos, caminhoPublico, type ProcPortal } from "./pcp.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const PNCP = "https://pncp.gov.br";
const PCP_API = "https://compras.api.portaldecompraspublicas.com.br";
const APP_URL = "https://edinardorlf-netizen.github.io/licitapro/";
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
let limiteExec = Infinity; // horário-limite da execução atual (as funções têm ~150 s)

// ---------- Acesso às fontes, com ritmo controlado ----------
let lastPncp = 0;
let pncpBloqueado = false;
let lastPcp = 0;

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

async function pcpGet(path: string): Promise<any> {
  const wait = lastPcp + 700 - Date.now();
  if (wait > 0) await sleep(wait);
  lastPcp = Date.now();
  const r = await fetch(PCP_API + path, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(`Portal de Compras Públicas respondeu ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- Utilidades ----------
const norm = (s: string) =>
  ` ${(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// Datas do PNCP vêm no horário de Brasília sem fuso.
const brt = (s?: string | null) => (s ? (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}-03:00`) : null);
const ymd = (d: Date) => {
  const b = new Date(d.getTime() - 3 * 3600e3);
  return `${b.getUTCFullYear()}${String(b.getUTCMonth() + 1).padStart(2, "0")}${String(b.getUTCDate()).padStart(2, "0")}`;
};
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const money = (v: number | null | undefined) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDT = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} às ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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
const pcpPathDe = (link?: string | null) => {
  const m = (link || "").match(/portaldecompraspublicas\.com\.br\/processos\/([^?#]+)/i);
  return m ? m[1].replace(/\/+$/, "") : null;
};
const pcpCodigoDe = (path?: string | null) => {
  const m = (path || "").match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
};

// ---------- Configuração e palavras-chave ----------
async function carregarConfig() {
  const [{ data: cfg }, { data: pal }] = await Promise.all([
    db.from("config").select("*").eq("id", 1).single(),
    db.from("palavras").select("termo,tipo"),
  ]);
  const incluir = (pal || []).filter((p) => p.tipo === "incluir").map((p) => ({ termo: p.termo, n: norm(p.termo).trimEnd() }));
  const excluir = (pal || []).filter((p) => p.tipo === "excluir").map((p) => ({ termo: p.termo, n: norm(p.termo).trimEnd() }));
  return { cfg: cfg || { uf: "MG", modalidades: [6, 8], empresa_nome: "", empresa_cnpj: "" }, incluir, excluir };
}

function classificar(objeto: string, incluir: { termo: string; n: string }[], excluir: { termo: string; n: string }[]) {
  const t = norm(objeto);
  const achados = incluir.filter((p) => t.includes(p.n)).map((p) => p.termo);
  const barrado = excluir.some((p) => t.includes(p.n));
  return { termos: achados, relevante: achados.length > 0 && !barrado };
}

// ---------- RADAR ----------
async function radar(deadline: number) {
  const { cfg, incluir, excluir } = await carregarConfig();
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 3600e3);
  let lidos = 0, relevantes = 0, paginas = 0;
  for (const mod of cfg.modalidades || [6, 8]) {
    for (let pagina = 1; pagina <= 40; pagina++) {
      if (Date.now() > deadline) return { lidos, relevantes, paginas, parcial: true };
      let res: any;
      try {
        res = await pncpGet(
          `/api/consulta/v1/contratacoes/publicacao?dataInicial=${ymd(ontem)}&dataFinal=${ymd(hoje)}&codigoModalidadeContratacao=${mod}&uf=${cfg.uf}&pagina=${pagina}&tamanhoPagina=50`,
        );
      } catch (e) {
        if (e instanceof Limite) return { lidos, relevantes, paginas, parcial: true, aviso: "O PNCP pediu uma pausa; o restante entra na próxima rodada." };
        throw e;
      }
      paginas++;
      const lista = (res && res.data) || [];
      if (!lista.length) break;
      const linhas = lista.map((d: any) => {
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
  return { lidos, relevantes, paginas };
}

// ---------- Movimentações ----------
type Mov = {
  processo_id: string; fonte: string; tipo: string; titulo: string; detalhe?: string | null; link?: string | null;
  autor?: string | null; ocorrido_em: string; importante: boolean; historico: boolean; chave: string;
};

const ALERTA_CHAT = [
  "vencedor", "vencedora", "habilitad", "inabilitad", "desclassific", "recurso", "convoc", "diligenc", "suspens",
  "suspend", "reabert", "retomad", "negocia", "contraproposta", "adjudic", "homolog", "cancelad", "revogad", "anulad",
  "fracassad", "desert", "iniciad", "encerrad", "prazo", "anexo", "documentos complementares", "proposta ajustada",
];

function importanteChat(frase: string, empresa: string[]) {
  const t = norm(frase);
  const digitos = (frase || "").replace(/\D/g, "");
  if (empresa.some((e) => e.length > 3 && (/^\d{14}$/.test(e) ? digitos.includes(e) : t.includes(` ${e} `)))) return true;
  return ALERTA_CHAT.some((k) => t.includes(` ${k}`));
}

// O nome (ou CNPJ) que aparece no portal é de uma das nossas empresas?
function ehNosso(texto: string, empresa: string[]) {
  const t = norm(texto);
  const dig = (texto || "").replace(/\D/g, "");
  return empresa.some((e) => (/^\d{14}$/.test(e) ? dig.includes(e) : t.includes(` ${e} `)));
}

// ---------- Etapa automática ----------
const NOME_ETAPA: Record<string, string> = {
  analise: "Em análise", participar: "Vamos participar", proposta: "Proposta enviada", disputa: "Em disputa",
  habilitacao: "Habilitação / recurso", ganhamos: "Ganhamos", perdemos: "Perdemos", desistimos: "Desistimos", encerrado: "Cancelado / encerrado",
};
const ORDEM_ETAPA: Record<string, number> = { analise: 0, participar: 1, proposta: 2, disputa: 3, habilitacao: 4, perdemos: 5, encerrado: 5, ganhamos: 6, desistimos: 9 };
// A etapa só anda para frente (e "Desistimos", marcado pela equipe, nunca é trocado).
const podeAvancar = (de: string, para: string) => de !== "desistimos" && (ORDEM_ETAPA[para] ?? 0) > (ORDEM_ETAPA[de] ?? 0);

// Situações oficiais do Portal de Compras Públicas (tabela do próprio site do portal).
// Processo: Aguardando início de recebimento de propostas, Recebendo Propostas, Aguardando Início de Sessão,
//   Suspenso antes da abertura, Em republicação, Sessão Pública Iniciada, Em Andamento, Suspenso,
//   Encaminhado p/ Adjudicação-Homologação, Adjudicado, Homologado, Finalizado, Cancelado, Revogado, Anulado, Fracassado, Deserto.
// Item: Fechado, Aberto, Suspenso, Em processo de desempate, Empate Lei 123, Agendamento da Lei 123, Aguardando Encerramento,
//   Tempo Aleatório, Iminência de Fechamento, Encerrado, Em Negociação, Recebendo Documentos, Analisando documentação, Aceito,
//   Fornecedor divulgado, Fornecedor Habilitado, Empate Lei 123 na Habilitação/Adjudicação/Homologação, Adjudicado, Homologado,
//   Finalizado, Cancelado (na Adjudicação/Homologação), Anulado, Revogado, Deserto, Fracassado, Recebendo Propostas, Em Republicação.
const IT_SEM = /cancelad|anulad|revogad|desert|fracassad/i;
const IT_FINAL = /adjudicad|homologad|empate lei 123 na (adjudica|homologa)|finalizad/i;
const IT_HAB = /^encerrado|negocia|recebendo documentos|analis|an[aá]lise de doc|aceito|habilitad|fornecedor divulgado|empate lei 123 na habilita/i;
const IT_LANCES = /^aberto$|desempate|^empate lei 123$|agendamento da lei 123|aguardando encerramento|tempo aleat|imin[eê]ncia de fechamento/i;
const PR_SEM = /cancelad|revogad|anulad|fracassad|desert/i;
const PR_FINAL = /encaminhado|adjudica|homolog|finalizad/i;
const PR_SUSP = /suspens|republica/i;
const PR_SESSAO = /sess[aã]o p[uú]blica iniciada|em andamento/i;
const PR_ANTES = /aguardando in[ií]cio|recebendo propostas|^aberto|publicad|divulgad/i;

async function calcularEtapa(p: any, empresa: string[]): Promise<{ etapa: string; motivo: string } | null> {
  const { data: itens } = await db.from("itens").select("numero,situacao,situacao_portal,nosso_arremata,nosso_vence,resultado_fornecedor").eq("processo_id", p.id);
  const lista: any[] = itens || [];
  const sitItem = (i: any) => String(i.situacao_portal || i.situacao || "").trim();
  const sit = String(p.situacao_portal || p.situacao_pncp || "").trim();
  const nums = (arr: any[]) => arr.map((i) => i.numero).sort((a, b) => a - b);
  const resumo = (n: number[]) => (n.length > 6 ? `${n.slice(0, 6).join(", ")} e mais ${n.length - 6}` : n.join(", "));

  // 1) Vencemos algum item (declarado vencedor no chat do portal ou resultado no PNCP)
  const vencidos = nums(lista.filter((i) => i.nosso_vence || (i.resultado_fornecedor && ehNosso(i.resultado_fornecedor, empresa))));
  if (vencidos.length) return { etapa: "ganhamos", motivo: `A empresa foi declarada vencedora do(s) item(ns) ${resumo(vencidos)}.` };

  // 2) Processo cancelado, revogado, anulado, fracassado ou deserto
  if (PR_SEM.test(sit)) return { etapa: "encerrado", motivo: `Processo ${sit.toLowerCase()} no portal.` };
  const ativos = lista.filter((i) => !IT_SEM.test(sitItem(i)));
  if (lista.length && !ativos.length) return { etapa: "encerrado", motivo: "Todos os itens foram cancelados, desertos ou fracassados." };

  // 3) Suspenso ou em republicação: espera, sem mudar a etapa
  if (PR_SUSP.test(sit)) return null;

  const emLances = ativos.filter((i) => IT_LANCES.test(sitItem(i)));
  const emHab = ativos.filter((i) => IT_HAB.test(sitItem(i)));
  const emFinal = ativos.filter((i) => IT_FINAL.test(sitItem(i)));
  const arrematando = nums(lista.filter((i) => i.nosso_arremata));
  const participou = (ORDEM_ETAPA[p.etapa] ?? 0) >= 2;

  // 4) Encaminhado para adjudicação/homologação, adjudicado, homologado ou finalizado
  if (PR_FINAL.test(sit) || (ativos.length > 0 && emFinal.length === ativos.length)) {
    // "Perdemos" só com o histórico do chat lido por inteiro (senão poderia faltar um "declarado vencedor").
    if (participou && (p.chat_historico_ok || !p.pcp_path)) return { etapa: "perdemos", motivo: `Processo ${sit ? sit.toLowerCase() : "concluído"} e a empresa não aparece como vencedora de nenhum item.` };
    return { etapa: "habilitacao", motivo: `Processo ${sit ? sit.toLowerCase() : "na fase final"}; aguardando o resultado dos itens.` };
  }

  // 5) Sessão pública em andamento
  const sess = p.data_sessao ? Date.parse(p.data_sessao) : null;
  const sessaoPassou = !!sess && Date.now() > sess;
  if (PR_SESSAO.test(sit) || (sessaoPassou && !PR_ANTES.test(sit))) {
    if (emLances.length) return { etapa: "disputa", motivo: `${emLances.length} item(ns) em disputa de lances${arrematando.length ? `; a empresa está arrematando o(s) item(ns) ${resumo(arrematando)}` : ""}.` };
    if (emHab.length || emFinal.length) {
      return { etapa: "habilitacao", motivo: arrematando.length ? `Lances encerrados; fase de aceitação/habilitação. A empresa arrematou o(s) item(ns) ${resumo(arrematando)}.` : "Lances encerrados; itens em aceitação, negociação ou análise de documentos." };
    }
    return { etapa: "disputa", motivo: PR_SESSAO.test(sit) ? "A sessão pública começou no portal." : "Passou a data da sessão." };
  }
  return null;
}

function proxima(p: any): number {
  const agora = Date.now();
  const s = p.data_sessao ? Date.parse(p.data_sessao) : null;
  const sit = `${p.situacao_portal || ""} ${p.situacao_pncp || ""}`.toLowerCase();
  const final = /finalizad|revogad|anulad|desert|fracassad|cancelad/.test(sit) || ["desistimos"].includes(p.etapa);
  if (final) return 12 * 60;
  // Dia da disputa no Portal de Compras Públicas: chat e itens a cada 2 min (de 30 min antes até 12 h depois do início).
  if (p.pcp_path && s && s - agora < 30 * 60e3 && agora - s < 12 * 3600e3) return 2;
  if (s && s - agora < 90 * 60e3 && agora - s < 3 * 24 * 3600e3) return p.pcp_path ? 10 : 20;
  if (s && s - agora < 2 * 24 * 3600e3) return 60;
  if (s && agora - s < 30 * 24 * 3600e3) return 60;
  return 180;
}

// Nomes e CNPJs que identificam "nós" num processo: a empresa do processo,
// ou todas as empresas ativas se o processo não tiver empresa marcada.
async function identificacao(p: any): Promise<string[]> {
  let q = db.from("empresas").select("nome,cnpj,apelidos").eq("ativa", true);
  if (p.empresa_id) q = db.from("empresas").select("nome,cnpj,apelidos").eq("id", p.empresa_id);
  const { data } = await q;
  const out: string[] = [];
  for (const e of data || []) {
    out.push(norm(e.nome).trim(), String(e.cnpj || "").replace(/\D/g, ""));
    for (const a of String(e.apelidos || "").split(/[,;\n]+/)) out.push(norm(a).trim());
  }
  return [...new Set(out.filter((e) => e.length > 3))];
}

async function verificarProcesso(p: any, opts: { inicial?: boolean } = {}) {
  const empresa = await identificacao(p);
  const inicial = !!opts.inicial;
  const movs: Mov[] = [];
  const upd: Record<string, unknown> = {};
  const add = (m: Omit<Mov, "processo_id" | "historico"> & { historico?: boolean }) =>
    movs.push({ processo_id: p.id, historico: inicial, ...m });

  // ---- PNCP ---- (no máximo a cada ~10 min, mesmo quando o portal é conferido a cada 2 min)
  const pncpDevido = inicial || !p.pncp_checado_em || Date.now() - Date.parse(p.pncp_checado_em) > 9 * 60e3;
  if (p.cnpj && p.ano && p.seq && pncpDevido) {
    upd.pncp_checado_em = new Date().toISOString();
    const base = `/orgaos/${p.cnpj}/compras/${p.ano}/${p.seq}`;
    const det = await pncpGet(`/api/consulta/v1${base}`);
    if (det) {
      upd.situacao_pncp = det.situacaoCompraNome;
      upd.valor_homologado = det.valorTotalHomologado;
      upd.valor_estimado = det.valorTotalEstimado;
      if (!p.objeto) upd.objeto = limpaObjeto(det.objetoCompra);
      if (!p.link_origem && det.linkSistemaOrigem) upd.link_origem = det.linkSistemaOrigem;
      if (!p.pcp_path) {
        const path = pcpPathDe(det.linkSistemaOrigem);
        if (path) { upd.pcp_path = path; upd.pcp_codigo = pcpCodigoDe(path); p.pcp_path = path; p.pcp_codigo = upd.pcp_codigo; }
      }
      if (!p.pcp_path && det.dataEncerramentoProposta) upd.data_sessao = brt(det.dataEncerramentoProposta);
      if (!inicial && p.situacao_pncp && det.situacaoCompraNome && p.situacao_pncp !== det.situacaoCompraNome) {
        add({ fonte: "pncp", tipo: "situacao", titulo: `Situação no PNCP: ${det.situacaoCompraNome}`, ocorrido_em: new Date().toISOString(), importante: true, chave: `pncp-sit-${hash(det.situacaoCompraNome + det.dataAtualizacaoGlobal)}` });
      }

      if (inicial || det.dataAtualizacaoGlobal !== p.pncp_atualizacao) {
        // Histórico de alterações, agrupado por momento e tipo
        const hist: any[] = (await pncpGet(`/api/pncp/v1${base}/historico`)) || [];
        const grupos = new Map<string, any[]>();
        for (const h of hist) {
          const k = `${(h.logManutencaoDataInclusao || "").slice(0, 16)}|${h.categoriaLogManutencao}|${h.tipoLogManutencao}`;
          if (!grupos.has(k)) grupos.set(k, []);
          grupos.get(k)!.push(h);
        }
        for (const [k, hs] of grupos) {
          const h = hs[0];
          const acao = (h.tipoLogManutencaoNome || "Alteração").toLowerCase();
          const cat = Number(h.categoriaLogManutencao);
          let titulo = `${h.categoriaLogManutencaoNome || "Registro"}: ${acao}`;
          let detalhe: string | null = h.justificativa || null;
          let importante = false;
          let link: string | null = null;
          if (cat === 1) {
            titulo = h.tipoLogManutencao === 0 ? "Processo publicado no PNCP" : `Dados do processo ${acao === "retificação" ? "retificados" : acao} no PNCP`;
            importante = h.tipoLogManutencao !== 0;
          } else if (cat === 4) {
            const nums = hs.map((x) => x.itemNumero).filter((n) => n != null);
            titulo = `${nums.length} ${nums.length === 1 ? "item" : "itens"} ${acao === "inclusão" ? "incluídos" : acao === "exclusão" ? "excluídos" : "retificados"}`;
            detalhe = (detalhe ? detalhe + " · " : "") + `Itens: ${nums.slice(0, 20).join(", ")}${nums.length > 20 ? "…" : ""}`;
            importante = h.tipoLogManutencao !== 0;
          } else if (cat === 5) {
            const nums = hs.map((x) => x.itemResultadoNumero ?? x.itemNumero).filter((n) => n != null);
            titulo = `Resultado publicado para ${nums.length === 1 ? "o item " + nums[0] : nums.length + " itens"}`;
            detalhe = nums.length > 1 ? `Itens: ${nums.slice(0, 30).join(", ")}${nums.length > 30 ? "…" : ""}` : detalhe;
            importante = true;
          } else if (cat === 6) {
            const titulos = hs.map((x) => x.documentoTitulo).filter(Boolean);
            titulo = `Documento ${acao === "inclusão" ? "publicado" : acao === "exclusão" ? "removido" : "retificado"}: ${titulos[0] || "sem título"}${titulos.length > 1 ? ` e mais ${titulos.length - 1}` : ""}`;
            importante = true;
            if (h.documentoSequencial) link = `${PNCP}/pncp-api/v1${base}/arquivos/${h.documentoSequencial}`;
          }
          add({ fonte: "pncp", tipo: cat === 5 ? "resultado" : cat === 6 ? "documento" : "pncp", titulo, detalhe, link, ocorrido_em: brt(h.logManutencaoDataInclusao) || new Date().toISOString(), importante, chave: `pncp-h-${hash(k)}-${hs.length}` });
        }

        // Itens
        const { data: atuais } = await db.from("itens").select("numero,situacao,tem_resultado,participar,resultado_fornecedor").eq("processo_id", p.id);
        const porNum = new Map((atuais || []).map((i: any) => [i.numero, i]));
        const linhas: any[] = [];
        for (let pg = 1; pg <= 20; pg++) {
          const itens: any[] = (await pncpGet(`/api/pncp/v1${base}/itens?pagina=${pg}&tamanhoPagina=500`)) || [];
          for (const it of itens) {
            const ant: any = porNum.get(it.numeroItem);
            linhas.push({
              processo_id: p.id, numero: it.numeroItem, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidadeMedida,
              valor_ref: it.orcamentoSigiloso ? null : it.valorUnitarioEstimado, situacao: it.situacaoCompraItemNome,
              tem_resultado: !!it.temResultado, atualizado_em: new Date().toISOString(),
            });
            if (!inicial && ant && ant.participar && ant.situacao && it.situacaoCompraItemNome && ant.situacao !== it.situacaoCompraItemNome) {
              add({ fonte: "pncp", tipo: "item", titulo: `Item ${it.numeroItem}: ${it.situacaoCompraItemNome}`, detalhe: (it.descricao || "").slice(0, 160), ocorrido_em: new Date().toISOString(), importante: true, chave: `pncp-it-${it.numeroItem}-${hash(it.situacaoCompraItemNome)}` });
            }
          }
          if (itens.length < 500) break;
        }
        if (linhas.length) {
          const { error } = await db.from("itens").upsert(linhas, { onConflict: "processo_id,numero" });
          if (error) throw new Error(`Erro ao salvar itens: ${error.message}`);
        }

        // Resultados dos itens que a empresa disputa
        const alvo = linhas.filter((l) => l.tem_resultado && !porNum.get(l.numero)?.resultado_fornecedor)
          .sort((a, b) => Number(!!porNum.get(b.numero)?.participar) - Number(!!porNum.get(a.numero)?.participar));
        for (const l of alvo.slice(0, 6)) {
          if (Date.now() > limiteExec - 20000) break;
          const res: any[] = (await pncpGet(`/api/pncp/v1${base}/itens/${l.numero}/resultados`)) || [];
          const r = res.find((x) => x.situacaoCompraItemResultadoId !== 2) || res[0];
          if (!r) continue;
          const nome = r.nomeRazaoSocialFornecedor || r.niFornecedor || "Fornecedor";
          const valor = r.valorUnitarioHomologado ?? r.valorTotalHomologado;
          const nosso = ehNosso(`${nome} ${r.niFornecedor || ""}`, empresa);
          await db.from("itens").update({ resultado_fornecedor: nome, resultado_valor: valor, ...(nosso ? { nosso_vence: true } : {}) }).eq("processo_id", p.id).eq("numero", l.numero);
          const marcado = !!porNum.get(l.numero)?.participar;
          if (nosso || marcado) add({ fonte: "pncp", tipo: "resultado", titulo: nosso ? `🏆 Vocês venceram o item ${l.numero}` : `Item ${l.numero}: vencedor ${nome}`, detalhe: valor != null ? `Valor unitário homologado: ${money(valor)}` : null, ocorrido_em: new Date().toISOString(), importante: true, chave: `pncp-res-${l.numero}` });
        }
        upd.pncp_atualizacao = det.dataAtualizacaoGlobal;
      }
    }
  }

  // ---- Portal de Compras Públicas (páginas públicas) ----
  if (p.pcp_path) {
    const codigo = p.pcp_codigo || pcpCodigoDe(p.pcp_path);
    const proc = await pcpGet(`/v2/licitacao/${p.pcp_path}`);
    if (proc) {
      const status = proc.statusProcesso?.descricao || null;
      if (!inicial && status && p.situacao_portal && status !== p.situacao_portal) {
        add({ fonte: "portal", tipo: "situacao", titulo: `Situação no portal: ${status}`, ocorrido_em: new Date().toISOString(), importante: true, chave: `pcp-sit-${hash(status)}-${Date.now()}` });
      }
      upd.situacao_portal = status;
      if (proc.dataHoraAbertura) upd.data_sessao = proc.dataHoraAbertura;
      upd.prazo_impugnacao = proc.dataHoraLimiteImpugnacoes || null;
      upd.prazo_esclarecimento = proc.dataHoraLimiteEsclarecimentos || proc.dataHoraLimiteEsclarecimento || null;
      if ((!p.orgao || inicial) && proc.razaoSocialComprador) upd.orgao = proc.razaoSocialComprador;
      if ((!p.numero || inicial) && proc.numeroProcesso) upd.numero = proc.numeroProcesso;
      if (!p.objeto) upd.objeto = proc.resumo;
      if (!p.municipio && proc.cidadeEstadoComprador) upd.municipio = String(proc.cidadeEstadoComprador).split("/")[0];
      if (!p.pcp_codigo && proc.codigoLicitacao) upd.pcp_codigo = proc.codigoLicitacao;
    }
    if (codigo) {
      // ---- Chat da sessão ----
      // O portal entrega 50 mensagens por página, das mais novas para as mais antigas.
      // Na primeira vez lê o histórico inteiro (para saber arrematantes e vencedores de cada item).
      const ult = p.pcp_chat_ult || "";
      const lerHistorico = !p.chat_historico_ok;
      const frases: any[] = [];
      let chegouAoFim = false;
      for (let pg = 1; pg <= (lerHistorico ? 60 : 12); pg++) {
        if (pg > 1 && Date.now() > limiteExec - 25000) break;
        const chat = await pcpGet(`/v1/licitacao/${codigo}/chat${pg > 1 ? `?pagina=${pg}` : ""}`);
        const lote: any[] = (chat && chat.frasesChat) || [];
        frases.push(...lote);
        if (lote.length < 50) { chegouAoFim = true; break; }
        const maisAntiga = lote[lote.length - 1]?.dataHoraFrase || "";
        if (!lerHistorico && ult && maisAntiga < ult) break;
      }
      if (lerHistorico && chegouAoFim) upd.chat_historico_ok = true;

      // Estado atual dos itens (arrematante, vencedor) para comparar com o que o chat anuncia
      const { data: itAtuais } = await db.from("itens").select("numero,arrematante,arrematante_em,nosso_arremata,vencedor_portal,nosso_vence,participar").eq("processo_id", p.id);
      const estado = new Map<number, any>((itAtuais || []).map((i: any) => [Number(i.numero), { ...i }]));
      const mudou = new Set<number>();
      const pegar = (n: number) => { if (!estado.has(n)) estado.set(n, { numero: n }); return estado.get(n); };

      let novoUlt = ult;
      for (const f of [...frases].reverse()) { // do mais antigo para o mais novo
        const quando: string = f.dataHoraFrase || "";
        const texto: string = f.frase || "";
        const autor = f.apelido || "Portal";
        const antiga = inicial || (!!ult && quando < ult);
        if (quando > novoUlt) novoUlt = quando;
        const imp = !antiga && importanteChat(texto, empresa);
        add({ fonte: "portal", tipo: "chat", titulo: autor === "Sistema" ? "Mensagem do sistema" : `Mensagem de ${autor}`, detalhe: texto, autor, ocorrido_em: quando || new Date().toISOString(), importante: imp, historico: antiga, chave: `pcp-c-${quando}-${hash(texto)}` });

        // "O item 0005 tem como novo arrematante EMPRESA com lance de R$ 6,00."
        const mA = texto.match(/item\s+0*(\d+)\s+tem como novo arrematante\s+(.+?)\s+com lance de\s+R\$\s*([\d.,]+)/i);
        if (mA) {
          const n = Number(mA[1]); const it = pegar(n);
          if (!it.arrematante_em || quando >= String(it.arrematante_em)) {
            const nosso = ehNosso(mA[2], empresa);
            const valor = Number(mA[3].replace(/\./g, "").replace(",", "."));
            if (!antiga && nosso && !it.nosso_arremata) add({ fonte: "portal", tipo: "item", titulo: `🟢 Item ${n}: vocês estão arrematando`, detalhe: `Lance de ${money(valor)}`, ocorrido_em: quando, importante: true, chave: `arr-${n}-${quando}` });
            if (!antiga && !nosso && it.nosso_arremata) add({ fonte: "portal", tipo: "item", titulo: `🔴 Item ${n}: outra empresa passou à frente`, detalhe: `${mA[2]} com ${money(valor)}`, ocorrido_em: quando, importante: true, chave: `perdeu-${n}-${quando}` });
            Object.assign(it, { arrematante: mA[2].trim(), arrematante_lance: valor, arrematante_em: quando, nosso_arremata: nosso });
            mudou.add(n);
          }
          continue;
        }
        // "Para o item 0153 foi habilitado e declarado vencedor o fornecedor EMPRESA."
        const mV = texto.match(/item\s+0*(\d+)\s+foi habilitado e declarado vencedor o fornecedor\s+(.+?)\.?\s*$/i);
        if (mV) {
          const n = Number(mV[1]); const it = pegar(n);
          const nosso = ehNosso(mV[2], empresa);
          if (!antiga && nosso && !it.nosso_vence) add({ fonte: "portal", tipo: "resultado", titulo: `🏆 Item ${n}: vocês foram declarados vencedores`, detalhe: mV[2], ocorrido_em: quando, importante: true, chave: `venc-${n}` });
          Object.assign(it, { vencedor_portal: mV[2].trim(), nosso_vence: nosso || !!it.nosso_vence });
          mudou.add(n);
          continue;
        }
        // Inabilitação / desclassificação citando a empresa
        if (!antiga && /inabilitad|desclassificad|recusad/i.test(texto) && ehNosso(texto, empresa)) {
          const n = Number((texto.match(/item\s+0*(\d+)/i) || [])[1] || 0);
          add({ fonte: "portal", tipo: "item", titulo: `⚠ ${n ? `Item ${n}: ` : ""}a empresa foi citada em inabilitação/desclassificação`, detalhe: texto, ocorrido_em: quando, importante: true, chave: `inab-${hash(texto)}-${quando}` });
        }
      }
      if (novoUlt) upd.pcp_chat_ult = novoUlt;
      if (mudou.size) {
        const linhasIt = [...mudou].map((n) => {
          const it = estado.get(n);
          return { processo_id: p.id, numero: n, arrematante: it.arrematante ?? null, arrematante_lance: it.arrematante_lance ?? null, arrematante_em: it.arrematante_em ?? null, nosso_arremata: !!it.nosso_arremata, vencedor_portal: it.vencedor_portal ?? null, nosso_vence: !!it.nosso_vence };
        });
        for (let i = 0; i < linhasIt.length; i += 300) {
          const { error } = await db.from("itens").upsert(linhasIt.slice(i, i + 300), { onConflict: "processo_id,numero" });
          if (error) throw new Error(`Erro ao salvar itens do chat: ${error.message}`);
        }
      }

      // Documentos publicados no portal
      const docs: any[] = (await pcpGet(`/v2/licitacao/${codigo}/documentos/processo`)) || [];
      for (const d of docs) {
        if (!d.idArquivo) continue;
        add({ fonte: "portal", tipo: "documento", titulo: `Documento no portal: ${d.nome || d.tituloDocumento || "arquivo"}`, detalhe: d.tipo || null, link: d.url || null, ocorrido_em: new Date().toISOString(), importante: !inicial, chave: `pcp-d-${d.idArquivo}` });
      }

      // ---- Itens: situação e melhor lance ----
      // No cadastro; perto da sessão a cada ~8 min; depois da sessão, de hora em hora.
      const s = upd.data_sessao ? Date.parse(String(upd.data_sessao)) : p.data_sessao ? Date.parse(p.data_sessao) : null;
      const desdeItens = p.itens_checado_em ? Date.now() - Date.parse(p.itens_checado_em) : Infinity;
      const pertoDaSessao = !!s && Math.abs(Date.now() - s) < 3 * 24 * 3600e3;
      const depoisDaSessao = !!s && Date.now() > s;
      if (inicial || desdeItens === Infinity || (pertoDaSessao && desdeItens > 8 * 60e3) || (depoisDaSessao && desdeItens > 60 * 60e3)) {
        const { data: meus } = await db.from("itens").select("numero,participar,situacao_portal").eq("processo_id", p.id);
        const mapa = new Map((meus || []).map((i: any) => [Number(i.numero), i]));
        let completo = false;
        for (let pg = 1; pg <= 45; pg++) {
          if (pg > 1 && Date.now() > limiteExec - 20000) break;
          const r = await pcpGet(`/v2/licitacao/${codigo}/itens?pagina=${pg}`);
          if (!r) { completo = true; break; }
          const lista: any[] = r.isLote ? (r.lotes?.result || []).flatMap((l: any) => l.itens || []) : (r.itens?.result || r.itens || []);
          if (!Array.isArray(lista) || !lista.length) { completo = true; break; }
          const linhasIt: any[] = [];
          for (const it of lista) {
            const num = Number(it.codigo);
            const ant: any = mapa.get(num);
            const sit = it.situacao?.descricao ? String(it.situacao.descricao).trim() : null;
            const lance = it.melhorLance ?? null;
            if (!inicial && ant && ant.participar && sit && ant.situacao_portal && sit !== String(ant.situacao_portal).trim()) {
              add({ fonte: "portal", tipo: "item", titulo: `Item ${num} no portal: ${sit}`, detalhe: lance != null ? `Melhor lance: ${money(lance)}` : null, ocorrido_em: new Date().toISOString(), importante: true, chave: `pcp-it-${num}-${hash(sit)}` });
            }
            linhasIt.push({ processo_id: p.id, numero: num, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade, valor_ref: it.valorReferencia ?? null, situacao_portal: sit, melhor_lance: lance });
          }
          const { error } = await db.from("itens").upsert(linhasIt, { onConflict: "processo_id,numero" });
          if (error) throw new Error(`Erro ao salvar itens: ${error.message}`);
          const tot = r.isLote ? r.lotes?.total : r.itens?.total;
          const lim = r.isLote ? r.lotes?.limit : r.itens?.limit;
          if (!tot || !lim || pg * lim >= tot) { completo = true; break; }
        }
        if (completo) upd.itens_checado_em = new Date().toISOString();
      }
    }
  }

  // ---- Lembretes de sessão e prazos ----
  const agora = Date.now();
  const sess = upd.data_sessao ? Date.parse(String(upd.data_sessao)) : p.data_sessao ? Date.parse(p.data_sessao) : null;
  if (!inicial && sess && sess > agora) {
    if (!p.lembrete_24h && sess - agora < 24 * 3600e3 && sess - agora > 2 * 3600e3) {
      add({ fonte: "lembrete", tipo: "lembrete", titulo: `Sessão amanhã: ${fmtDT(new Date(sess).toISOString())}`, ocorrido_em: new Date().toISOString(), importante: true, chave: `lemb-24-${sess}` });
      upd.lembrete_24h = true;
    }
    if (!p.lembrete_1h && sess - agora <= 75 * 60e3) {
      add({ fonte: "lembrete", tipo: "lembrete", titulo: `A sessão começa em menos de 1 hora (${fmtDT(new Date(sess).toISOString())})`, ocorrido_em: new Date().toISOString(), importante: true, chave: `lemb-1h-${sess}` });
      upd.lembrete_1h = true;
    }
  }
  const prazo = (upd.prazo_impugnacao as string) || p.prazo_impugnacao;
  if (!inicial && prazo && !p.lembrete_prazo) {
    const pz = Date.parse(prazo);
    if (pz > agora && pz - agora < 24 * 3600e3) {
      add({ fonte: "lembrete", tipo: "lembrete", titulo: `Prazo de impugnação e esclarecimento termina ${fmtDT(prazo)}`, ocorrido_em: new Date().toISOString(), importante: true, chave: `lemb-prazo-${pz}` });
      upd.lembrete_prazo = true;
    }
  }

  // ---- Etapa automática ----
  if (p.etapa_auto !== false) {
    const nova = await calcularEtapa({ ...p, ...upd }, empresa);
    if (nova && nova.etapa !== p.etapa && podeAvancar(p.etapa, nova.etapa)) {
      upd.etapa = nova.etapa;
      upd.etapa_motivo = nova.motivo;
      add({ fonte: "sistema", tipo: "etapa", titulo: `Etapa: ${NOME_ETAPA[nova.etapa]} (automático)`, detalhe: nova.motivo, ocorrido_em: new Date().toISOString(), importante: !inicial && ["ganhamos", "perdemos", "habilitacao"].includes(nova.etapa), historico: false, chave: `etapa-${nova.etapa}` });
    }
  }

  // ---- Grava ----
  if (movs.length) {
    const unicos = [...new Map(movs.map((m) => [m.chave, m])).values()];
    for (let i = 0; i < unicos.length; i += 200) {
      const { error } = await db.from("movimentacoes").upsert(unicos.slice(i, i + 200), { onConflict: "processo_id,chave", ignoreDuplicates: true });
      if (error) throw new Error(`Erro ao salvar movimentações: ${error.message}`);
    }
  }
  const novo = { ...p, ...upd };
  upd.ultima_verificacao = new Date().toISOString();
  upd.proxima_verificacao = new Date(Date.now() + proxima(novo) * 60e3).toISOString();
  upd.erro = null;
  await db.from("processos").update(upd).eq("id", p.id);

  const importantes = movs.filter((m) => m.importante && !m.historico);
  if (importantes.length) await avisar(novo, importantes);
  return { novas: movs.length, importantes: importantes.length };
}

// ---------- Aviso pelo Telegram (opcional) ----------
async function avisar(p: any, movs: Mov[]) {
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    db.from("config").select("telegram_chat_id,telegram_ativo").eq("id", 1).single(),
    db.from("segredos").select("valor").eq("chave", "telegram_token").maybeSingle(),
  ]);
  if (!cfg?.telegram_ativo || !cfg.telegram_chat_id || !seg?.valor) return;
  const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linhas = movs.slice(0, 8).map((m) => `• <b>${esc(m.titulo)}</b>${m.detalhe ? `\n   ${esc(m.detalhe.slice(0, 300))}` : ""}`);
  const texto = `🔔 <b>${esc(p.orgao || "Processo")}</b>${p.numero ? ` · ${esc(p.numero)}` : ""}\n${linhas.join("\n")}${movs.length > 8 ? `\n…e mais ${movs.length - 8}` : ""}\n\n<a href="${APP_URL}#p=${p.id}">Abrir no LicitaPro</a>`;
  try {
    await fetch(`https://api.telegram.org/bot${seg.valor}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: texto, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (_) { /* aviso é opcional */ }
}

// ---------- ACOMPANHAR (fila) ----------
async function acompanhar(deadline: number) {
  const { data: fila } = await db.from("processos").select("*").eq("ativo", true).lte("proxima_verificacao", new Date().toISOString()).order("proxima_verificacao").limit(25);
  let ok = 0, erros = 0;
  for (const p of fila || []) {
    if (Date.now() > deadline) break;
    try {
      // Processo puxado do portal e ainda não verificado: a primeira leitura vira histórico (sem alarme).
      await verificarProcesso(p, { inicial: !p.ultima_verificacao });
      ok++;
    } catch (e) {
      erros++;
      const msg = e instanceof Limite ? "O PNCP pediu uma pausa; tentaremos de novo em alguns minutos." : String((e as Error).message || e);
      await db.from("processos").update({ erro: msg, ultima_verificacao: new Date().toISOString(), proxima_verificacao: new Date(Date.now() + (e instanceof Limite ? 15 : 30) * 60e3).toISOString() }).eq("id", p.id);
      if (e instanceof Limite) break;
    }
  }
  return { verificados: ok, erros, fila: (fila || []).length };
}

// ---------- SINCRONIZAR: puxa "Seus Processos" do portal com o login da empresa ----------
const SIT_ENCERRADA = /cancelad|finalizad|revogad|anulad|desert|fracassad|suspens.*definitiv/i;
const JANELA_DIAS = 60;

async function sincronizarAcesso(a: any, deadline: number, quem: string) {
  const resumo = { portal: a.portal, empresa_id: a.empresa_id, lidos: 0, novos: [] as any[], ja: 0, ignorados: 0, aviso: "" };
  if (a.portal !== "pcp") throw new Error("Por enquanto o robô só entra sozinho no Portal de Compras Públicas.");
  const { data: senha, error: eS } = await db.rpc("senha_acesso", { p_id: a.id });
  if (eS || !senha) throw new Error("A senha desse acesso não está guardada. Cadastre de novo em Ajustes → Empresas.");

  const s = new Sessao();
  try {
    await s.entrar(a.usuario, String(senha));
    const corte = Date.now() - JANELA_DIAS * 864e5;
    const lista: ProcPortal[] = [];
    for (let pg = 1; pg <= 5; pg++) {
      const { html, url } = await s.texto(urlSeusProcessos(pg));
      if (!url.startsWith(PCP_OP)) throw new Error("O portal saiu da área do fornecedor ao abrir 'Seus Processos'.");
      const linhas = lerSeusProcessos(html);
      if (pg === 1 && !linhas.length && !/Seus Processos/i.test(html)) throw new Error("Não consegui ler 'Seus Processos' depois do login.");
      lista.push(...linhas);
      const ultima = linhas[linhas.length - 1];
      if (linhas.length < 10 || !ultima || !ultima.abertura || Date.parse(ultima.abertura) < corte) break;
    }
    resumo.lidos = lista.length;

    const candidatos = lista.filter((x) => !SIT_ENCERRADA.test(x.situacao) && (!x.abertura || Date.parse(x.abertura) >= corte));
    resumo.ignorados = lista.length - candidatos.length;
    const codigos = candidatos.map((x) => x.codigo);
    const { data: existentes } = codigos.length ? await db.from("processos").select("pcp_codigo").in("pcp_codigo", codigos) : { data: [] };
    const jaTem = new Set((existentes || []).map((r: any) => Number(r.pcp_codigo)));

    for (const x of candidatos) {
      if (jaTem.has(x.codigo)) { resumo.ja++; continue; }
      if (Date.now() > deadline - 8000 || resumo.novos.length >= 25) { resumo.aviso = "Ficaram processos para a próxima rodada."; break; }
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
        created_by: `robô · Seus Processos (${quem})`, proxima_verificacao: new Date().toISOString(),
      };
      const { data: criado, error } = await db.from("processos").insert(novo).select("id,orgao,numero,data_sessao").single();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { resumo.ja++; continue; }
        throw new Error(`Erro ao cadastrar ${x.numero}: ${error.message}`);
      }
      if (edital) await db.from("editais").update({ status: "acompanhando" }).eq("id", edital.id);
      await db.from("movimentacoes").insert({ processo_id: criado.id, fonte: "sistema", tipo: "cadastro", titulo: "Processo puxado automaticamente de “Seus Processos” no portal", detalhe: `Login ${a.usuario}`, autor: "robô", ocorrido_em: new Date().toISOString(), chave: "cadastro" });
      resumo.novos.push(criado);
    }
  } finally {
    await s.sair();
  }
  return resumo;
}

async function registrarSinc(id: string, ok: boolean, msg: string) {
  await db.from("acessos").update({ sinc_em: new Date().toISOString(), sinc_ok: ok, sinc_msg: msg.slice(0, 300) }).eq("id", id);
}

async function sincronizar(filtro: { empresa_id?: string; portal?: string }, deadline: number, quem: string) {
  let q = db.from("acessos").select("id,empresa_id,portal,usuario,senha_id").not("senha_id", "is", null).eq("portal", filtro.portal || "pcp");
  if (filtro.empresa_id) q = q.eq("empresa_id", filtro.empresa_id);
  const { data: acessos } = await q;
  if (!acessos || !acessos.length) throw new Error("Não há login guardado para esse portal. Cadastre em Ajustes → Empresas e acessos.");
  const resultados: any[] = [];
  for (const a of acessos) {
    if (Date.now() > deadline - 15000) break;
    try {
      const r = await sincronizarAcesso(a, deadline, quem);
      await registrarSinc(a.id, true, `${r.novos.length} novo(s), ${r.ja} já acompanhado(s), ${r.ignorados} encerrado(s) ou antigo(s)`);
      resultados.push(r);
    } catch (e) {
      const msg = String((e as Error).message || e);
      await registrarSinc(a.id, false, msg);
      resultados.push({ portal: a.portal, empresa_id: a.empresa_id, erro: msg });
    }
  }
  return { resultados };
}

// ---------- CADASTRAR ----------
async function cadastrar(entrada: string, email: string | null, empresaId: string | null = null) {
  if (!empresaId) {
    const { data: ativas } = await db.from("empresas").select("id").eq("ativa", true).limit(2);
    if (ativas && ativas.length === 1) empresaId = ativas[0].id;
  }
  const txt = (entrada || "").trim();
  if (!txt) throw new Error("Cole o link do processo ou o número de controle do PNCP.");
  let cnpj: string | null = null, ano: number | null = null, seq: number | null = null;
  let pcpPath: string | null = null;
  let edital: any = null;

  const mApp = txt.match(/pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)/i);
  const mCtrl = txt.match(/(\d{14})-\d-(\d{1,7})\/(\d{4})/);
  const mLic = txt.match(/(?:licitardigital|ammlicita)[^\s]*\/pesquisa\/(\d+)/i);
  pcpPath = pcpPathDe(txt);
  if (mApp) { cnpj = mApp[1]; ano = Number(mApp[2]); seq = Number(mApp[3]); }
  else if (mCtrl) { cnpj = mCtrl[1]; seq = Number(mCtrl[2]); ano = Number(mCtrl[3]); }
  else if (pcpPath) {
    const { data } = await db.from("editais").select("*").ilike("link_origem", `%${pcpPath}%`).limit(1);
    edital = data && data[0];
  } else if (mLic) {
    const { data } = await db.from("editais").select("*").like("link_origem", `%/pesquisa/${mLic[1]}`).limit(1);
    edital = data && data[0];
    if (!edital) throw new Error("Não encontrei esse processo do Licitar Digital no radar. Cole o link dele no PNCP (pncp.gov.br/app/editais/…), que aparece na página do processo no portal.");
  } else {
    throw new Error("Não reconheci esse link. Use o link do PNCP, o número de controle do PNCP (ex.: 18192898000102-1-000167/2026) ou o link do Portal de Compras Públicas.");
  }
  if (edital) { cnpj = edital.cnpj; ano = edital.ano; seq = edital.seq; }
  if (cnpj && !edital) {
    const { data } = await db.from("editais").select("*").eq("cnpj", cnpj).eq("ano", ano).eq("seq", seq).limit(1);
    edital = data && data[0];
  }

  let det: any = null;
  if (cnpj) {
    det = await pncpGet(`/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`);
    if (!det && !pcpPath) throw new Error("Não encontrei esse processo no PNCP. Confira o link ou o número.");
    if (det && !pcpPath) pcpPath = pcpPathDe(det.linkSistemaOrigem);
  }
  const controle = det?.numeroControlePNCP || edital?.controle_pncp || null;
  const pcpCodigo = pcpCodigoDe(pcpPath);

  // Já cadastrado?
  if (controle) {
    const { data } = await db.from("processos").select("id").eq("controle_pncp", controle).maybeSingle();
    if (data) return { id: data.id, existente: true };
  }
  if (pcpCodigo) {
    const { data } = await db.from("processos").select("id").eq("pcp_codigo", pcpCodigo).maybeSingle();
    if (data) return { id: data.id, existente: true };
  }

  const link = det?.linkSistemaOrigem || edital?.link_origem || (pcpPath ? `https://www.portaldecompraspublicas.com.br/processos/${pcpPath}` : null);
  const novo = {
    edital_id: edital?.id || null,
    controle_pncp: controle,
    cnpj, ano, seq,
    pcp_path: pcpPath,
    pcp_codigo: pcpCodigo,
    portal: portalDe(link, det?.usuarioNome || edital?.sistema),
    link_origem: link,
    orgao: det?.orgaoEntidade?.razaoSocial || edital?.orgao || null,
    municipio: det?.unidadeOrgao?.municipioNome || edital?.municipio || null,
    numero: det?.numeroCompra || edital?.numero || null,
    objeto: limpaObjeto(det?.objetoCompra || edital?.objeto || ""),
    modalidade: det?.modalidadeNome || edital?.modalidade || null,
    valor_estimado: det?.valorTotalEstimado ?? edital?.valor_estimado ?? null,
    data_sessao: brt(det?.dataEncerramentoProposta) || edital?.encerramento_propostas || null,
    situacao_pncp: det?.situacaoCompraNome || null,
    empresa_id: empresaId,
    responsavel: email,
    created_by: email || "robô",
  };
  const { data: criado, error } = await db.from("processos").insert(novo).select("*").single();
  if (error) throw new Error(`Não foi possível cadastrar: ${error.message}`);
  if (edital) await db.from("editais").update({ status: "acompanhando" }).eq("id", edital.id);
  await db.from("movimentacoes").insert({ processo_id: criado.id, fonte: "sistema", tipo: "cadastro", titulo: "Processo cadastrado para acompanhamento", autor: email || "robô", ocorrido_em: new Date().toISOString(), chave: "cadastro" });
  try {
    await verificarProcesso(criado, { inicial: true });
  } catch (e) {
    await db.from("processos").update({ erro: String((e as Error).message || e), proxima_verificacao: new Date(Date.now() + 10 * 60e3).toISOString() }).eq("id", criado.id);
  }
  return { id: criado.id, existente: false };
}

// ---------- Entrada ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const tarefa = url.searchParams.get("tarefa");
  const deadline = Date.now() + 110_000;
  limiteExec = deadline;

  try {
    if (tarefa) {
      const chave = req.headers.get("x-cron-key") || "";
      const { data: seg } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
      if (!seg || chave !== seg.valor) return json({ erro: "não autorizado" }, 401);
      if (tarefa === "radar") return json(await radar(deadline));
      if (tarefa === "acompanhar") return json(await acompanhar(deadline));
      if (tarefa === "sincronizar") return json(await sincronizar({}, deadline, "automático"));
      if (tarefa === "cadastrar") {
        const body = await req.json().catch(() => ({}));
        return json(await cadastrar(String(body.entrada || ""), null));
      }
      return json({ erro: "tarefa desconhecida" }, 400);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email) return json({ erro: "Faça login novamente." }, 401);
    const { data: membro } = await db.from("equipe").select("papel,ativo").eq("email", email).maybeSingle();
    if (!membro || !membro.ativo) return json({ erro: "Seu acesso ainda não foi liberado pelo administrador." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.acao === "cadastrar") {
      if (membro.papel === "acompanha") return json({ erro: "Seu perfil só acompanha disputas. Peça a alguém da equipe para cadastrar." }, 403);
      const emp = typeof body.empresa_id === "string" && /^[0-9a-f-]{36}$/i.test(body.empresa_id) ? body.empresa_id : null;
      return json(await cadastrar(String(body.entrada || ""), email, emp));
    }
    if (body.acao === "sincronizar") {
      if (membro.papel === "acompanha") return json({ erro: "Seu perfil só acompanha disputas." }, 403);
      const emp = typeof body.empresa_id === "string" && /^[0-9a-f-]{36}$/i.test(body.empresa_id) ? body.empresa_id : undefined;
      const portalSinc = typeof body.portal === "string" ? body.portal : "pcp";
      return json(await sincronizar({ empresa_id: emp, portal: portalSinc }, deadline, email.split("@")[0]));
    }
    if (body.acao === "verificar") {
      const { data: p } = await db.from("processos").select("*").eq("id", body.id).single();
      if (!p) return json({ erro: "Processo não encontrado." }, 404);
      return json(await verificarProcesso(p));
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
