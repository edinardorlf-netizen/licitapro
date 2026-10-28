// =====================================================================
// LicitaPro · área do fornecedor do Portal de Compras Públicas
// Entra com o login da empresa (guardado no cofre), lê "Seus Processos"
// e devolve os processos em que a empresa está participando.
// Só leitura: não envia proposta, lance nem mensagem.
// =====================================================================

export const PCP_OP = "https://operacao.portaldecompraspublicas.com.br";
const UA_NAV = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 LicitaPro/1.0";

// Guarda os cookies por domínio, como um navegador.
class Cookies {
  private m = new Map<string, Map<string, string>>();
  guardar(url: string, res: Response) {
    const host = new URL(url).hostname;
    // deno-lint-ignore no-explicit-any
    const lista: string[] = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [];
    for (const c of lista) {
      const partes = c.split(";").map((s) => s.trim());
      const [kv, ...attrs] = partes;
      const i = kv.indexOf("=");
      if (i < 1) continue;
      const nome = kv.slice(0, i).trim();
      const valor = kv.slice(i + 1).trim();
      const dom = (attrs.find((a) => /^domain=/i.test(a)) || "").replace(/^domain=\.?/i, "").toLowerCase() || host;
      const expirado = attrs.some((a) => /^max-age=0$/i.test(a) || /^expires=.*1970/i.test(a));
      if (!this.m.has(dom)) this.m.set(dom, new Map());
      if (expirado || valor === "") this.m.get(dom)!.delete(nome);
      else this.m.get(dom)!.set(nome, valor);
    }
  }
  cabecalho(url: string) {
    const host = new URL(url).hostname;
    const out: string[] = [];
    for (const [dom, mm] of this.m) if (host === dom || host.endsWith("." + dom)) for (const [k, v] of mm) out.push(`${k}=${v}`);
    return out.join("; ");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Sessao {
  private jar = new Cookies();
  private ultimo = 0;
  debug = false;

  // Faz a requisição seguindo os redirecionamentos e guardando os cookies.
  async ir(url: string, init: { method?: string; body?: string; tipo?: string } = {}) {
    let atual = url;
    let method = init.method || "GET";
    let body: string | undefined = init.body;
    for (let i = 0; i < 15; i++) {
      const espera = this.ultimo + 600 - Date.now();
      if (espera > 0) await sleep(espera);
      this.ultimo = Date.now();
      const headers: Record<string, string> = { "User-Agent": UA_NAV, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "pt-BR,pt;q=0.9" };
      const ck = this.jar.cabecalho(atual);
      if (ck) headers.Cookie = ck;
      if (body) headers["Content-Type"] = init.tipo || "application/x-www-form-urlencoded";
      const r = await fetch(atual, { method, body, headers, redirect: "manual" });
      this.jar.guardar(atual, r);
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        await r.body?.cancel();
        atual = new URL(loc, atual).toString();
        if (r.status !== 307 && r.status !== 308) { method = "GET"; body = undefined; }
        continue;
      }
      return { url: atual, status: r.status, res: r };
    }
    throw new Error("O portal redirecionou demais (login em loop).");
  }

  async texto(url: string, init: { method?: string; body?: string } = {}) {
    const { url: final, status, res } = await this.ir(url, init);
    const buf = await res.arrayBuffer();
    const host = new URL(final).hostname;
    // As páginas antigas do portal são em windows-1252; o login (Keycloak) é UTF-8.
    const ct = res.headers.get("content-type") || "";
    const enc = /utf-8/i.test(ct) || host.startsWith("iam.") ? "utf-8" : "windows-1252";
    return { url: final, status, html: new TextDecoder(enc).decode(buf) };
  }

  async entrar(usuario: string, senha: string) {
    const ini = await this.texto(`${PCP_OP}/18/`);
    const m = ini.html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/i);
    if (!m) throw new Error("A tela de login do portal mudou; não encontrei o formulário.");
    if (/recaptcha|hcaptcha|turnstile/i.test(ini.html)) throw new Error("O portal pediu verificação de robô (captcha). O LicitaPro não contorna isso.");
    const action = m[1].replace(/&amp;/g, "&");
    const fim = await this.texto(action, { method: "POST", body: new URLSearchParams({ username: usuario, password: senha, credentialId: "" }).toString() });
    const host = new URL(fim.url).hostname;
    if (host.startsWith("iam.")) {
      if (/otp|totp|c[oó]digo de verifica/i.test(fim.html)) throw new Error("O portal pediu um código de verificação em duas etapas para esse login.");
      if (/recaptcha|hcaptcha|turnstile/i.test(fim.html)) throw new Error("O portal pediu verificação de robô (captcha). O LicitaPro não contorna isso.");
      // Tira o aviso escondido "preencha usuário e senha", que vem sempre na página.
      const pagina = fim.html.replace(/<div id="form-error-empty"[\s\S]*?<\/span>\s*<\/div>\s*<\/div>/i, "");
      const achados = [
        ...pagina.matchAll(/id="input-error[^"]*"[^>]*>([\s\S]*?)<\/span>/gi),
        ...pagina.matchAll(/class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi),
        ...pagina.matchAll(/class="[^"]*(?:alert-error|pf-m-danger)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
      ].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 200);
      // Texto visível da página, para achar a frase do erro (ex.: "usuário ou senha inválidos").
      const visivel = pagina.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      // Ex.: "Nome de usuário ou senha inválida."
      const frase = (visivel.match(/(?:Nome de usu[aá]rio|usu[aá]rio|login|senha)[^.!|]{0,60}(?:inv[aá]lid|incorret|bloquead|desativad|desabilitad|suspens|expirad|tentativas|n[aã]o encontrad)[^.!|]{0,60}[.!]?|conta[^.!|]{0,40}(?:bloquead|desativad|desabilitad|suspens)[^.!|]{0,60}[.!]?|(?:atualizar|alterar|redefinir) (?:a |sua )?senha[^.!|]{0,60}[.!]?/i) || [])[0];
      const msg = (frase || "").trim() || [...new Set(achados)].filter((t) => t.split(" ").length > 2)[0];
      const titulo = (pagina.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
      const trecho = visivel.slice(Math.max(0, visivel.search(/Login/i)), Math.max(0, visivel.search(/Login/i)) + 220).trim();
      throw new Error(`O portal recusou o login${msg ? `: ${msg}` : ` (${titulo.trim() || "página de login"}: ${trecho}). Confira usuário e senha em Ajustes → Empresas.`}${this.debug ? ` || ${visivel.slice(0, 1500)}` : ""}`);
    }
    if (!fim.url.startsWith(PCP_OP)) throw new Error("Depois do login o portal foi para uma página inesperada.");
  }

  async sair() {
    try { await this.ir(`${PCP_OP}/18/Logout/`); } catch (_) { /* tanto faz */ }
  }
}

export type ProcPortal = { codigo: number; numero: string; orgao: string; objeto: string; abertura: string | null; situacao: string };

const limpa = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// "21/10/2026 08:30" (horário de Brasília) → ISO
function dataBR(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00` : null;
}

export function lerSeusProcessos(html: string): ProcPortal[] {
  const out: ProcPortal[] = [];
  for (const linha of html.split(/<tr[\s>]/i).slice(1)) {
    const cod = linha.match(/DadosPregao\/\?slA=Edit&(?:amp;)?ttCD_CHAVE=(\d+)/i);
    if (!cod) continue;
    const numero = limpa((linha.match(/<td class="td80">([\s\S]*?)<\/td>/i) || [])[1] || "");
    const orgao = limpa((linha.match(/id="unidadeTexto\d+"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
    const objeto = limpa((linha.match(/id="objetoTexto\d+"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || (linha.match(/<td class="td190">\s*<a[^>]*title="([^"]*)"/i) || [])[1] || "");
    const abertura = dataBR((linha.match(/<td class="td110"><span>([^<]+)<\/span>/i) || [])[1] || "");
    const situacao = (linha.match(/class="td70 alignCenter">\s*<a href="#" title="([^"]+)"/i) || [])[1] || "";
    out.push({ codigo: Number(cod[1]), numero, orgao, objeto, abertura, situacao });
  }
  return out;
}

export const urlSeusProcessos = (pg: number) =>
  `${PCP_OP}/4/SeusPregoes/?rdCampoPesquisado=&btBuscar=Buscar&ttBusca=&ttOrderBy=&ttPagina=${pg}&ttOrgao=&ttAbertura=&ttObjeto=&slCD_UF=&slCD_GRUPO_MATERIAL=0&slCD_CLASSE_MATERIAL=0&slPLANO_AVULSO=0&slCD_MODALIDADE_LICITACAO=&slCD_TIPO_REALIZACAO_LICITACAO=&slCD_TIPO_JULGAMENTO_LICITACAO=`;

// Caminho público do processo (usado na API pública do portal).
export function caminhoPublico(htmlDados: string): string | null {
  const m = htmlDados.match(/portaldecompraspublicas\.com\.br\/processos\/([A-Z]{2}\/[^"'\s<>?#]+)/i);
  return m ? m[1].replace(/\/+$/, "") : null;
}
