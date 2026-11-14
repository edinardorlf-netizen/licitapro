import { createClient } from "@supabase/supabase-js";

const cfg = (typeof window !== "undefined" && window.LICITAPRO_CONFIG) || {};
export const sb = cfg.url && cfg.key
  ? createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "licitapro-auth" } })
  : null;
export const appUrl = () => (typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "");

export const PORTAIS = {
  pcp: { nome: "Portal de Compras Públicas", curto: "Compras Públicas", cor: "#1D4ED8" },
  licitar: { nome: "Licitar Digital", curto: "Licitar Digital", cor: "#7C3AED" },
  comprasgov: { nome: "Compras.gov.br", curto: "Compras.gov", cor: "#0F766E" },
  bll: { nome: "BLL Compras", curto: "BLL", cor: "#B45309" },
  "licitacoes-e": { nome: "Licitações-e (BB)", curto: "Licitações-e", cor: "#A16207" },
  mg: { nome: "Compras MG (Estado)", curto: "Compras MG", cor: "#BE123C" },
  bnc: { nome: "BNC", curto: "BNC", cor: "#475569" },
  licitanet: { nome: "Licitanet", curto: "Licitanet", cor: "#475569" },
  outro: { nome: "Outro sistema", curto: "Outro", cor: "#64748B" },
};
export const portal = (k) => PORTAIS[k] || PORTAIS.outro;

export const ETAPAS = [
  // Antes da sessão
  { id: "analise", nome: "Em análise", cor: "#64748B", grupo: "Antes da sessão" },
  { id: "participar", nome: "Vamos participar", cor: "#0E7490", grupo: "Antes da sessão" },
  { id: "proposta", nome: "Proposta enviada", cor: "#1D4ED8", grupo: "Antes da sessão" },
  { id: "suspenso", nome: "Suspenso / em republicação", cor: "#B45309", grupo: "Antes da sessão" },
  // Sessão pública (Lei 14.133, art. 17: lances, julgamento, habilitação, recurso, homologação)
  { id: "disputa", nome: "Disputa de lances", cor: "#C2410C", grupo: "Sessão" },
  { id: "julgamento", nome: "Julgamento / aceitação", cor: "#9333EA", grupo: "Sessão" },
  { id: "habilitacao", nome: "Habilitação", cor: "#7C3AED", grupo: "Sessão" },
  { id: "recurso", nome: "Recurso", cor: "#BE185D", grupo: "Sessão" },
  { id: "homologacao", nome: "Adjudicação / homologação", cor: "#0F766E", grupo: "Sessão" },
  // Depois da vitória (marcadas pela equipe)
  { id: "ata", nome: "Ata / contrato assinado", cor: "#15803D", grupo: "Depois da vitória" },
  { id: "execucao", nome: "Empenho / entrega", cor: "#166534", grupo: "Depois da vitória" },
  { id: "concluido", nome: "Concluído", cor: "#78716C", grupo: "Fim" },
];
export const etapa = (id) => ETAPAS.find((e) => e.id === id) || ETAPAS[0];
export const RESULTADOS = [
  { id: "ganhamos", nome: "🏆 Ganhamos", cor: "#15803D" },
  { id: "ganhamos_parte", nome: "🏆 Ganhamos parte", cor: "#15803D" },
  { id: "perdemos", nome: "Perdemos", cor: "#B91C1C" },
  { id: "desistimos", nome: "Desistimos", cor: "#94A3B8" },
  { id: "cancelado", nome: "Cancelado / deserto / fracassado", cor: "#78716C" },
];
export const resultado = (id) => RESULTADOS.find((r) => r.id === id) || null;
export const ganhou = (p) => p.resultado === "ganhamos" || p.resultado === "ganhamos_parte";
export const A_LANCAR = ["analise", "participar"]; // ⭐ Vamos participar: proposta ainda não enviada
export const ACOMPANHANDO = ["disputa", "julgamento", "habilitacao", "recurso", "homologacao"]; // sessão já aberta
export const POS_VITORIA = ["ata", "execucao"];
// Processos "vivos" (Início e Agenda)
export const ATIVAS = ["analise", "participar", "proposta", "suspenso", ...ACOMPANHANDO];
// Fim do processo: homologado / finalizado no portal, com o vencedor de cada item declarado.
// Assim que o robô vê isso, o processo sai de "Em finalização" e passa para "Finalizados" sozinho.
const RE_FINAL = /finalizad|homologad|contrato|conclu[ií]d|encerrad/i;
export const finalizado = (p) =>
  POS_VITORIA.includes(p.etapa) || p.etapa === "concluido" ||
  (p.etapa === "homologacao" && !!p.resultado && (p.valor_homologado != null || RE_FINAL.test(`${p.situacao_portal || ""} ${p.situacao_pncp || ""}`)));
// Categorias da aba Processos: cada processo fica em uma só (exceto "Todos").
export const CATEGORIAS = [
  { id: "vamos", nome: "⭐ Vamos participar", desc: "Proposta ainda a lançar", teste: (p) => A_LANCAR.includes(p.etapa) },
  { id: "proposta", nome: "📨 Proposta enviada", desc: "Aguardando a abertura da sessão (ou suspenso antes dela)", teste: (p) => p.etapa === "proposta" || (p.etapa === "suspenso" && !ACOMPANHANDO.includes(p.etapa_antes)) },
  { id: "acompanhando", nome: "👁 Em disputa", desc: "Sessão aberta: lances, julgamento, habilitação e recurso", teste: (p) => ["disputa", "julgamento", "habilitacao", "recurso"].includes(p.etapa) || (p.etapa === "suspenso" && ACOMPANHANDO.includes(p.etapa_antes)) },
  { id: "finalizacao", nome: "⏳ Em finalização", desc: "Encaminhados para adjudicação / homologação, ainda sem o resultado final de todos os itens", teste: (p) => p.etapa === "homologacao" && !finalizado(p) },
  { id: "ganhos", nome: "🏆 Finalizados com vitória", desc: "Homologados, com a empresa vencedora de itens: ata, contrato, empenho e entrega", teste: (p) => finalizado(p) && (ganhou(p) || POS_VITORIA.includes(p.etapa)) },
  { id: "perdidos", nome: "Finalizados sem vitória", desc: "Homologados ou encerrados sem itens para a empresa", teste: (p) => finalizado(p) && !ganhou(p) && !POS_VITORIA.includes(p.etapa) },
  { id: "todos", nome: "Todos", desc: "", teste: () => true },
];

// Áreas que o administrador libera para cada pessoa (equipe.permissoes)
export const PERMISSOES = [
  { id: "radar", nome: "Radar de editais" },
  { id: "processos", nome: "Processos, Início e Agenda" },
  { id: "contratos", nome: "Contratos e itens ganhos" },
  { id: "catalogo", nome: "Catálogo de produtos (preço médio de venda)" },
  { id: "custos", nome: "Ver e lançar custos e markup" },
  { id: "reequilibrio", nome: "Reequilíbrio de preços" },
  { id: "robo", nome: "Robô de lances (simulador)" },
  { id: "editar", nome: "Alterar dados (cadastrar, lançar preços, marcar itens)" },
];

export const PAPEIS = {
  admin: "Administrador",
  equipe: "Equipe (busca, propostas e disputas)",
  acompanha: "Acompanha disputas",
};

const TZ = "America/Sao_Paulo";
export const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
export const fmtDataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "") : "—");
export const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "");
export const fmtDH = (iso) => (iso ? `${fmtData(iso)} às ${fmtHora(iso)}` : "—");
export const diaChave = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
export const hojeChave = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const diaLongo = (chave) => {
  const hoje = hojeChave();
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
  const ontem = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
  if (chave === hoje) return "Hoje";
  if (chave === amanha) return "Amanhã";
  if (chave === ontem) return "Ontem";
  const [y, m, d] = chave.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
};
export const falta = (iso) => {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const min = Math.round(abs / 6e4);
  const h = Math.round(abs / 36e5);
  const d = Math.round(abs / 864e5);
  const txt = min < 60 ? `${min} min` : h < 36 ? `${h} h` : `${d} dias`;
  return ms >= 0 ? `em ${txt}` : `há ${txt}`;
};
export const brl = (v, casas = 2) =>
  v == null || v === "" || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 4) });
export const num = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 }));

export function parseNum(s) {
  if (s == null || s === "") return null;
  if (typeof s === "number") return s;
  let t = String(s).replace(/[^\d.,-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return t !== "" && isFinite(n) ? n : null;
}
export const fmtIn = (v) => (v == null ? "" : String(Number(v)).replace(".", ","));

/* Preço mínimo para o lance: cobre custo + frete e garante impostos e margem sobre o preço. */
export function valorMinimo({ custo, frete, impostos_pct, margem_pct }) {
  const c = (Number(custo) || 0) + (Number(frete) || 0);
  if (!c) return null;
  const p = ((Number(impostos_pct) || 0) + (Number(margem_pct) || 0)) / 100;
  if (p >= 0.95) return null;
  return Math.round((c / (1 - p)) * 10000) / 10000;
}

export function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.erro)) || String(e || "");
  if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/already registered|already exists/i.test(m)) return "Este e-mail já tem conta. Use “Entrar”.";
  if (/Password should be|at least 6/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Aguarde alguns minutos.";
  if (/row-level security|permission denied/i.test(m)) return "Seu perfil não tem permissão para isso.";
  return m || "Algo deu errado. Tente de novo.";
}

export async function chamarRobo(body, funcao = "licita") {
  const { data, error } = await sb.functions.invoke(funcao, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* ignora */ }
    throw new Error(msg);
  }
  if (data && data.erro) throw new Error(data.erro);
  return data;
}

export const iniciais = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
