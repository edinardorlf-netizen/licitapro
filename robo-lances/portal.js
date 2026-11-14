// =====================================================================
// LicitaPro · leitura do Portal de Compras Públicas para o robô de lances
//
// 1) Dados públicos da disputa (API pública do portal, a mesma que o app usa):
//    situação e melhor lance de cada item, e o chat da sessão
//    ("O item 0005 tem como novo arrematante EMPRESA com lance de R$ 6,00.").
// 2) Navegador controlado (Playwright) com o login da empresa: mantém a sala
//    aberta, confere se a sessão continua viva e guarda cópias da tela para
//    calibrar a leitura da sala e o botão de lance (que NÃO existe nesta versão).
//
// Nunca resolve captcha nem contorna bloqueio: se aparecer, para e avisa.
// =====================================================================

export const PCP_OP = "https://operacao.portaldecompraspublicas.com.br";
export const PCP_API = "https://compras.api.portaldecompraspublicas.com.br";
const UA = "LicitaPro/1.0 (acompanhamento de processos publicos)"; // o mesmo do app; só ASCII

export const norm = (s) => ` ${String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

export class ErroPortal extends Error {
  constructor(msg, tipo = "portal") { super(msg); this.tipo = tipo; }
}

// Trava dura: em 13/11 uma leitura ficou parada 13 min (o timeout do fetch não cobre tudo,
// p.ex. corpo da resposta lento ou o computador voltando da suspensão).
function getJson(url) {
  let t;
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new ErroPortal("Sem resposta do portal (demorou demais).", "internet")), 15000); });
  return Promise.race([getJsonSemLimite(url), limite]).finally(() => clearTimeout(t));
}

async function getJsonSemLimite(url) {
  let r;
  try {
    r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  } catch (e) {
    throw new ErroPortal(`Sem resposta do portal (${e.name === "TimeoutError" ? "demorou demais" : "sem internet ou portal fora do ar"}).`, "internet");
  }
  if (r.status === 204 || r.status === 404) return null;
  // 405 apareceu quando o robô pediu dezenas de processos de uma vez (14/11): o portal trata como excesso de acesso
  if (r.status === 429 || r.status === 403 || r.status === 405) throw new ErroPortal(`O portal limitou o acesso automático (código ${r.status}). O robô vai ler mais devagar; não contorna bloqueio.`, "bloqueio");
  if (!r.ok) throw new ErroPortal(`O portal respondeu com erro ${r.status}.`, "portal");
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { throw new ErroPortal("O portal devolveu uma resposta inesperada.", "portal"); }
}

/** Itens do processo: número → { situacao, melhor, descricao } (todas as páginas). */
export async function lerItensPublicos(codigo) {
  const out = new Map();
  for (let pg = 1; pg <= 40; pg++) {
    const r = await getJson(`${PCP_API}/v2/licitacao/${codigo}/itens?pagina=${pg}`);
    if (!r) break;
    const lista = r.isLote ? (r.lotes?.result || []).flatMap((l) => l.itens || []) : (r.itens?.result || r.itens || []);
    if (!Array.isArray(lista) || !lista.length) break;
    for (const it of lista) {
      out.set(Number(it.codigo), {
        situacao: it.situacao?.descricao ? String(it.situacao.descricao).trim() : "",
        melhor: it.melhorLance != null ? Number(it.melhorLance) : null,
        descricao: it.descricao || "",
      });
    }
    const tot = r.isLote ? r.lotes?.total : r.itens?.total;
    const lim = r.isLote ? r.lotes?.limit : r.itens?.limit;
    if (!tot || !lim || pg * lim >= tot) break;
  }
  return out;
}

/** Últimas 50 mensagens do chat (mais novas primeiro). */
export async function lerChat(codigo) {
  const r = await getJson(`${PCP_API}/v1/licitacao/${codigo}/chat`);
  return (r && r.frasesChat) || [];
}

/** Hora do chat (Brasília, sem fuso) → segundos desde 1970. */
export function horaChat(s) {
  if (!s) return null;
  const t = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? Date.parse(s) : Date.parse(`${s}-03:00`);
  return Number.isFinite(t) ? t / 1000 : null;
}

/** "O item 0005 tem como novo arrematante EMPRESA com lance de R$ 6,00." */
export function lerArrematante(frase) {
  const m = String(frase || "").match(/item\s+0*(\d+)\s+tem como novo arrematante\s+(.+?)\s+com lance de\s+R\$\s*([\d.,]+)/i);
  if (!m) return null;
  return { numero: Number(m[1]), nome: m[2].trim(), valor: Number(m[3].replace(/\./g, "").replace(",", ".")) };
}

/** Nomes que identificam a empresa (nome, apelidos, CNPJ). */
export function identificacao(empresa) {
  const out = [norm(empresa?.nome).trim(), String(empresa?.cnpj || "").replace(/\D/g, "")];
  for (const a of String(empresa?.apelidos || "").split(/[,;\n]+/)) out.push(norm(a).trim());
  return [...new Set(out.filter((e) => e.length > 3))];
}
export function ehNosso(texto, ident) {
  const t = norm(texto);
  const dig = String(texto || "").replace(/\D/g, "");
  return ident.some((e) => (/^\d{14}$/.test(e) ? dig.includes(e) : t.includes(` ${e} `)));
}

/**
 * Situação do item no portal → fase do cérebro (robo.js).
 * null = situação que o robô ainda não conhece (ele espera e avisa no app).
 */
export function faseDe(situacao) {
  const s = norm(situacao);
  if (!s.trim()) return null;
  if (/ imin| prorrog/.test(s)) return "reta_final";
  if (/ aleatori/.test(s)) return "aleatorio";
  if (/ fechad/.test(s) && / lance/.test(s)) return "fechado";
  // Visto em 13/11/2026: "Fechado" sozinho = processo suspenso/fechado pelo pregoeiro (sem lances).
  if (s === " fechado ") return "aguardando";
  if (/ arremat| encerrad| divulgad| homolog| habilit| document| fracass| desert| cancel| revog| anulad| adjudic| recurso| negocia| julgament| vencedor| aceit| finalizad/.test(s)) return "encerrado";
  if (/ disputa| em lance| lances? abert| aberto para lance| etapa de lance| fase de lance| aberto /.test(s)) return "aberto";
  if (/ recebendo propost| aguardando| analise de propost| propostas? em analise| suspens| agendad| publicad| em analise /.test(s)) return "aguardando";
  return null;
}

// ---------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------
const CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, .cf-turnstile';

export async function temCaptcha(page) {
  try { return (await page.locator(CAPTCHA).count()) > 0; } catch { return false; }
}
const naTelaDeLogin = (page) => { try { return new URL(page.url()).hostname.startsWith("iam."); } catch { return false; } };

/**
 * Garante que o navegador está logado no portal.
 * obterCredenciais() busca usuário/senha no cofre (só quando precisar).
 */
export async function garantirLogin(ctx, obterCredenciais, log) {
  const page = ctx.pages().find((p) => p.url().startsWith(PCP_OP) || p.url() === "about:blank") || (await ctx.newPage());
  await page.goto(`${PCP_OP}/4/Dashboard/`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { throw new ErroPortal(`Não consegui abrir o portal: ${e.message.split("\n")[0]}`, "internet"); });
  if (!naTelaDeLogin(page)) return page; // já está logado (sessão guardada)
  if (await temCaptcha(page)) throw new ErroPortal("O portal pediu verificação de robô (captcha). Resolva na janela do robô; ele não contorna isso.", "captcha");
  const { usuario, senha } = await obterCredenciais();
  log("Entrando no portal com o login da empresa (senha do cofre, não fica gravada).");
  await page.locator('input[name="username"]').fill(usuario);
  await page.locator('input[name="password"]').fill(senha);
  await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), page.locator('input[name="password"]').press("Enter")]);
  await page.waitForTimeout(3000);
  if (naTelaDeLogin(page)) {
    if (await temCaptcha(page)) throw new ErroPortal("O portal pediu verificação de robô (captcha). Resolva na janela do robô; ele não contorna isso.", "captcha");
    const txt = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    if (/otp|c[oó]digo de verifica|autentica[cç][aã]o em dois/i.test(txt)) throw new ErroPortal("O portal pediu código de verificação em duas etapas. Digite na janela do robô.", "login");
    const frase = (txt.match(/[^.]{0,60}(inv[aá]lid|incorret|bloquead|expirad)[^.]{0,60}/i) || [])[0];
    throw new ErroPortal(`O portal recusou o login${frase ? `: ${frase.trim()}` : ""}. Confira usuário e senha em Ajustes → Empresas.`, "login");
  }
  return page;
}

export const urlSala = (codigo) => `${PCP_OP}/4/SessaoPublica/?ttCD_CHAVE=${codigo}`;

/** Confere se a aba da sala continua logada e sem captcha. */
export async function conferirSala(page) {
  if (page.isClosed()) return { ok: false, tipo: "fechada", msg: "A janela da sala foi fechada." };
  if (naTelaDeLogin(page)) return { ok: false, tipo: "sessao", msg: "A sessão no portal caiu (voltou para a tela de login). Pode ter sido o mesmo login aberto em outro lugar." };
  if (await temCaptcha(page)) return { ok: false, tipo: "captcha", msg: "O portal pediu verificação de robô (captcha). Resolva na janela do robô." };
  const txt = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 4000);
  if (/sess[aã]o (expirou|expirada|encerrada por inatividade)|conectado em outro|acesso simult/i.test(txt)) return { ok: false, tipo: "sessao", msg: "O portal encerrou a sessão (expirada ou login usado em outro lugar)." };
  return { ok: true };
}
