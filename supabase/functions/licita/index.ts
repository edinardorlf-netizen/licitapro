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

function proxima(p: any): number {
  const agora = Date.now();
  const s = p.data_sessao ? Date.parse(p.data_sessao) : null;
  const sit = `${p.situacao_portal || ""} ${p.situacao_pncp || ""}`.toLowerCase();
  const final = /finalizad|revogad|anulad|desert|fracassad|cancelad/.test(sit) || ["ganhamos", "perdemos", "desistimos"].includes(p.etapa);
  if (final) return 12 * 60;
  // Dia da disputa no Portal de Compras Públicas: chat e itens a cada 2 min (de 30 min antes até 12 h depois do início).
  if (p.pcp_path && s && s - agora < 30 * 60e3 && agora - s < 12 * 3600e3) return 2;
  if (s && s - agora < 90 * 60e3 && agora - s < 3 * 24 * 3600e3) return p.pcp_path ? 10 : 20;
  if (s && s - agora < 2 * 24 * 3600e3) return 60;
  if (s && agora - s < 30 * 24 * 3600e3) return 60;
  return 180;
}

async function verificarProcesso(p: any, opts: { inicial?: boolean } = {}) {
  const { cfg } = await carregarConfig();
  // Vários nomes separados por vírgula (ex.: "Mirafarma, Miramed") + CNPJ só com dígitos.
  const empresa = [
    ...String(cfg.empresa_nome || "").split(/[,;\n]+/).map((n) => norm(n).trim()),
    (cfg.empresa_cnpj || "").replace(/\D/g, ""),
  ].filter((e) => e.length > 3);
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
        const alvo = linhas.filter((l) => l.tem_resultado && porNum.get(l.numero)?.participar && !porNum.get(l.numero)?.resultado_fornecedor);
        for (const l of alvo.slice(0, 15)) {
          const res: any[] = (await pncpGet(`/api/pncp/v1${base}/itens/${l.numero}/resultados`)) || [];
          const r = res.find((x) => x.situacaoCompraItemResultadoId !== 2) || res[0];
          if (!r) continue;
          const nome = r.nomeRazaoSocialFornecedor || r.niFornecedor || "Fornecedor";
          const valor = r.valorUnitarioHomologado ?? r.valorTotalHomologado;
          await db.from("itens").update({ resultado_fornecedor: nome, resultado_valor: valor }).eq("processo_id", p.id).eq("numero", l.numero);
          const nosso = empresa.some((e) => e && (norm(nome).includes(e) || String(r.niFornecedor || "") === e));
          add({ fonte: "pncp", tipo: "resultado", titulo: nosso ? `🏆 Vocês venceram o item ${l.numero}` : `Item ${l.numero}: vencedor ${nome}`, detalhe: valor != null ? `Valor unitário homologado: ${money(valor)}` : null, ocorrido_em: new Date().toISOString(), importante: true, chave: `pncp-res-${l.numero}` });
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
      if (!p.orgao) upd.orgao = proc.razaoSocialComprador;
      if (!p.numero) upd.numero = proc.numeroProcesso;
      if (!p.objeto) upd.objeto = proc.resumo;
      if (!p.municipio && proc.cidadeEstadoComprador) upd.municipio = String(proc.cidadeEstadoComprador).split("/")[0];
      if (!p.pcp_codigo && proc.codigoLicitacao) upd.pcp_codigo = proc.codigoLicitacao;
    }
    if (codigo) {
      // Chat público da sessão
      const chat = await pcpGet(`/v1/licitacao/${codigo}/chat`);
      const frases: any[] = (chat && chat.frasesChat) || [];
      let ult = p.pcp_chat_ult || "";
      for (const f of frases) {
        const quando = f.dataHoraFrase || "";
        if (!inicial && ult && quando <= ult) continue;
        const autor = f.apelido || "Portal";
        const imp = !inicial && importanteChat(f.frase || "", empresa);
        add({ fonte: "portal", tipo: "chat", titulo: autor === "Sistema" ? "Mensagem do sistema" : `Mensagem de ${autor}`, detalhe: f.frase, autor, ocorrido_em: quando || new Date().toISOString(), importante: imp, chave: `pcp-c-${quando}-${hash(f.frase || "")}` });
      }
      for (const f of frases) if ((f.dataHoraFrase || "") > ult) ult = f.dataHoraFrase;
      if (ult) upd.pcp_chat_ult = ult;

      // Documentos publicados no portal
      const docs: any[] = (await pcpGet(`/v2/licitacao/${codigo}/documentos/processo`)) || [];
      for (const d of docs) {
        if (!d.idArquivo) continue;
        add({ fonte: "portal", tipo: "documento", titulo: `Documento no portal: ${d.nome || d.tituloDocumento || "arquivo"}`, detalhe: d.tipo || null, link: d.url || null, ocorrido_em: new Date().toISOString(), importante: !inicial, chave: `pcp-d-${d.idArquivo}` });
      }

      // Melhor lance e situação dos itens (perto da sessão, ou no cadastro)
      const s = upd.data_sessao ? Date.parse(String(upd.data_sessao)) : p.data_sessao ? Date.parse(p.data_sessao) : null;
      const pertoDaSessao = s && Math.abs(Date.now() - s) < 3 * 24 * 3600e3;
      if (inicial || pertoDaSessao) {
        const { data: meus } = await db.from("itens").select("numero,participar,situacao_portal,melhor_lance").eq("processo_id", p.id);
        const mapa = new Map((meus || []).map((i: any) => [i.numero, i]));
        for (let pg = 1; pg <= 8; pg++) {
          const r = await pcpGet(`/v2/licitacao/${codigo}/itens?pagina=${pg}`);
          if (!r) break;
          const lista: any[] = r.isLote ? (r.lotes?.result || []).flatMap((l: any) => l.itens || []) : (r.itens?.result || r.itens || []);
          if (!Array.isArray(lista) || !lista.length) break;
          for (const it of lista) {
            const num = Number(it.codigo);
            const ant: any = mapa.get(num);
            const sit = it.situacao?.descricao || null;
            const lance = it.melhorLance ?? null;
            if (ant) {
              if (!inicial && ant.participar && sit && ant.situacao_portal && sit !== ant.situacao_portal) {
                add({ fonte: "portal", tipo: "item", titulo: `Item ${num} no portal: ${sit}`, detalhe: lance != null ? `Melhor lance: ${money(lance)}` : null, ocorrido_em: new Date().toISOString(), importante: true, chave: `pcp-it-${num}-${hash(sit)}` });
              }
              await db.from("itens").update({ situacao_portal: sit, melhor_lance: lance }).eq("processo_id", p.id).eq("numero", num);
            } else {
              await db.from("itens").upsert({ processo_id: p.id, numero: num, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade, valor_ref: it.valorReferencia ?? null, situacao_portal: sit, melhor_lance: lance }, { onConflict: "processo_id,numero" });
            }
          }
          const tot = r.isLote ? r.lotes?.total : r.itens?.total;
          const lim = r.isLote ? r.lotes?.limit : r.itens?.limit;
          if (!tot || !lim || pg * lim >= tot) break;
        }
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
      await verificarProcesso(p);
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

// ---------- CADASTRAR ----------
async function cadastrar(entrada: string, email: string | null) {
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

  try {
    if (tarefa) {
      const chave = req.headers.get("x-cron-key") || "";
      const { data: seg } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
      if (!seg || chave !== seg.valor) return json({ erro: "não autorizado" }, 401);
      if (tarefa === "radar") return json(await radar(deadline));
      if (tarefa === "acompanhar") return json(await acompanhar(deadline));
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
      return json(await cadastrar(String(body.entrada || ""), email));
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
