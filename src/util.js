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
  { id: "analise", nome: "Em análise", cor: "#64748B" },
  { id: "participar", nome: "Vamos participar", cor: "#0E7490" },
  { id: "proposta", nome: "Proposta enviada", cor: "#1D4ED8" },
  { id: "disputa", nome: "Em disputa", cor: "#C2410C" },
  { id: "habilitacao", nome: "Habilitação / recurso", cor: "#7C3AED" },
  { id: "ganhamos", nome: "Ganhamos", cor: "#15803D" },
  { id: "perdemos", nome: "Perdemos", cor: "#B91C1C" },
  { id: "desistimos", nome: "Desistimos", cor: "#94A3B8" },
  { id: "encerrado", nome: "Cancelado / encerrado", cor: "#78716C" },
];
export const etapa = (id) => ETAPAS.find((e) => e.id === id) || ETAPAS[0];
export const ATIVAS = ["analise", "participar", "proposta", "disputa", "habilitacao"];
// Categorias da aba Processos
export const A_LANCAR = ["analise", "participar"]; // ⭐ Vamos participar: proposta ainda não enviada
export const ACOMPANHANDO = ["disputa", "habilitacao"]; // sessão já aberta, com proposta nossa
export const CATEGORIAS = [
  { id: "vamos", nome: "⭐ Vamos participar", desc: "Proposta ainda a lançar", teste: (p) => A_LANCAR.includes(p.etapa) },
  { id: "proposta", nome: "📨 Proposta enviada", desc: "Aguardando a abertura da sessão", teste: (p) => p.etapa === "proposta" },
  { id: "acompanhando", nome: "👁 Acompanhando", desc: "Sessão aberta: disputa, habilitação e recursos", teste: (p) => ACOMPANHANDO.includes(p.etapa) },
  { id: "ganhos", nome: "🏆 Ganhos", desc: "", teste: (p) => p.etapa === "ganhamos" },
  { id: "perdidos", nome: "Perdidos / encerrados", desc: "", teste: (p) => ["perdemos", "desistimos", "encerrado"].includes(p.etapa) },
  { id: "todos", nome: "Todos", desc: "", teste: () => true },
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
