// =====================================================================
// LicitaPro · robô de lances (conector local do Portal de Compras Públicas)
//
// Roda no computador da empresa, sem o Claude Code aberto.
//   node main.js              → fica ligado: acompanha as disputas ligadas no app
//   node main.js login        → só testa o login no portal e sai
//   node main.js teste 518940 → lê uma vez os dados públicos de um processo e mostra
//                                o que o robô faria (não precisa de login nem do app)
//
// VERSÃO SÓ OBSERVAR: lê a disputa, roda o cérebro (cerebro.js) e mostra no app o
// que faria, com horário e motivo. Não existe código de clique em lance.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { decidir, CONFIG_PADRAO } from "./cerebro.js";
import * as portal from "./portal.js";
import { preencherProposta } from "./proposta.js";

export const VERSAO = 4;
// v4 (14/11): o sinal ao LicitaPro sai sozinho a cada 5 s (antes saía entre rodadas de leitura; rodadas longas
// atrasavam o sinal > 30 s e a trava "sem contato" disparava à toa) e as leituras rodam em segundo plano:
// processos fora de sessão ocupam no máximo LEITURAS_JUNTAS vagas e sessão em andamento nunca espera na fila.
// v3 (14/11): lê no máximo LEITURAS_JUNTAS processos ao mesmo tempo, espalha as leituras de 5 em 5 min
// (antes, ao ligar com 69 disputas, saíam ~140 pedidos no mesmo segundo e o portal respondia 405)
// e, se o portal limitar o acesso, segura as leituras fora de sessão por 2 minutos.
const LEITURAS_JUNTAS = 3;
let pausaGeralAte = 0;
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(AQUI, "PARAR.flag");
const cfg = Object.fromEntries(
  fs.readFileSync(path.join(AQUI, "config.env"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const modo = process.argv[2] || "ligado";
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const rs = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

// ---------- Log (tela + arquivo do dia) ----------
fs.mkdirSync(path.join(AQUI, "logs"), { recursive: true });
function log(...a) {
  const linha = `${new Date().toLocaleString("pt-BR")} · ${a.join(" ")}`;
  console.log(linha);
  try { fs.appendFileSync(path.join(AQUI, "logs", `${new Date().toISOString().slice(0, 10)}.txt`), linha + os.EOL); } catch { /* disco cheio? segue */ }
}

// ---------- Conversa com o LicitaPro ----------
async function api(acao, corpo = {}) {
  let r;
  try {
    r = await fetch(cfg.URL, { method: "POST", headers: { "Content-Type": "application/json", "x-robo-key": cfg.CHAVE }, body: JSON.stringify({ acao, ...corpo }), signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new Error(`Sem contato com o LicitaPro (${e.name === "TimeoutError" ? "demorou demais" : "internet"}).`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `LicitaPro respondeu ${r.status}`);
  return j;
}

// Eventos vão em lotes; se a internet cair, ficam guardados e vão depois.
const fila = [];
function evento(e) {
  fila.push({ ...e, criado_em: new Date().toISOString() });
  if (fila.length > 3000) fila.splice(0, fila.length - 3000);
}
async function enviarEventos() {
  if (!fila.length) return;
  const lote = fila.slice(0, 150);
  try { await api("eventos", { lista: lote }); fila.splice(0, lote.length); }
  catch (e) { if (!/internet|demorou/.test(e.message)) { log("Eventos recusados:", e.message); fila.splice(0, lote.length); } }
}
// Erro repetido aparece uma vez por minuto (por tipo), para não encher o app.
const ultimoErro = new Map();
function erro(chave, msg, extra = {}) {
  const ant = ultimoErro.get(chave);
  if (ant && ant.msg === msg && Date.now() - ant.em < 60000) return;
  ultimoErro.set(chave, { msg, em: Date.now() });
  log("ERRO:", msg);
  evento({ tipo: "erro", motivo: msg, ...extra });
}

// ---------- Estado ----------
let ultimoPulso = null;      // resposta do último pulso
let pulsoOkEm = 0;
const salas = new Map();     // processo_id → estado da leitura
let ctxNav = null;           // navegador (Playwright)
let statusTxt = "iniciando";

function sala(pid) {
  // lidoEm inicial sorteado: as primeiras leituras dos processos fora de sessão se espalham pelos 5 minutos
  if (!salas.has(pid)) salas.set(pid, { lidoEm: Date.now() - Math.random() * 300000, okEm: 0, itens: new Map(), arrem: new Map(), chatVisto: new Set(), decisoes: new Map(), situacoesNovas: new Set(), aba: null, conferidaEm: 0, capturas: 0, capturaEm: 0, problema: null, citadas: new Set() });
  return salas.get(pid);
}

// A disputa está "quente" (ler a cada 3 s) perto da hora da sessão ou com item em disputa.
function quente(d, s) {
  const ini = d.data_sessao ? Date.parse(d.data_sessao) : null;
  const perto = ini && Date.now() > ini - 20 * 60e3 && Date.now() < ini + 12 * 3600e3;
  const emDisputa = [...s.itens.values()].some((i) => ["aberto", "reta_final", "aleatorio", "fechado"].includes(portal.faseDe(i.situacao)));
  return !!(perto || emDisputa);
}

// ---------- Mudança no portal → a nuvem atualiza o processo no LicitaPro ----------
// (movimentações, etapa, arrematante, avisos: tudo pelo acompanhamento que já existe)
const verificarEm = new Map();
const aVerificar = new Set();
function pedirVerificacao(pid) {
  if (Date.now() - (verificarEm.get(pid) || 0) < 60000) return; // no máximo 1 vez por minuto por processo
  verificarEm.set(pid, Date.now());
  aVerificar.add(pid);
}
async function enviarVerificacoes() {
  if (!aVerificar.size) return;
  const lista = [...aVerificar];
  try { await api("verificar", { processos: lista }); lista.forEach((p) => aVerificar.delete(p)); }
  catch (e) { erro("verificar", `Não consegui pedir a atualização dos processos: ${e.message}`); }
}

// ---------- Leitura de uma disputa + decisões ----------
// Está na hora de ler? Fora da sessão: a cada 5 min (a nuvem também acompanha a cada 2 min). Na sessão: a cada 3 s.
function devido(d, s) {
  if (!d.pcp_codigo) return true; // lerDisputa avisa (uma vez por minuto) que falta o código
  const intervalo = s.bloqueioAte && Date.now() < s.bloqueioAte ? 30000 : quente(d, s) ? 3000 : 300000;
  if (Date.now() - s.lidoEm < intervalo) return false;
  if (!quente(d, s) && Date.now() < pausaGeralAte) return false; // portal pediu calma: só a sessão em andamento continua
  return true;
}

async function lerDisputa(d) {
  const s = sala(d.processo_id);
  if (!d.pcp_codigo) { erro(`cod-${d.processo_id}`, `Processo ${d.numero || ""} sem código do Portal de Compras Públicas: o robô não sabe qual sala ler.`, { processo_id: d.processo_id }); return; }
  if (!devido(d, s)) return;
  s.lidoEm = Date.now();
  const ident = portal.identificacao(d.empresa);
  try {
    const [itens, chat] = await Promise.all([portal.lerItensPublicos(d.pcp_codigo), portal.lerChat(d.pcp_codigo)]);
    s.okEm = Date.now();
    if (s.problema) { evento({ tipo: "aviso", processo_id: d.processo_id, motivo: "Leitura do portal voltou ao normal." }); s.problema = null; }
    let mudou = false;
    for (const [n, it] of itens) {
      const a = s.itens.get(n);
      if (a && (a.situacao !== it.situacao || a.melhor !== it.melhor)) mudou = true;
      s.itens.set(n, it);
    }
    if (s.chatIniciado && chat.some((f) => !s.chatVisto.has(`${f.dataHoraFrase}|${f.frase}`))) mudou = true;
    if (mudou) pedirVerificacao(d.processo_id);
    // Chat: do mais antigo para o mais novo
    for (const f of [...chat].reverse()) {
      const chave = `${f.dataHoraFrase}|${f.frase}`;
      if (s.chatVisto.has(chave)) continue;
      s.chatVisto.add(chave);
      const a = portal.lerArrematante(f.frase);
      const quando = portal.horaChat(f.dataHoraFrase);
      if (a) {
        const nosso = portal.ehNosso(a.nome, ident);
        s.arrem.set(a.numero, { ...a, nosso, quando, outroEm: nosso ? s.arrem.get(a.numero)?.outroEm ?? null : quando });
      } else if (s.chatIniciado && f.apelido !== "Sistema" && portal.ehNosso(f.frase, ident) && !s.citadas.has(chave)) {
        // Empresa citada no chat (pregoeiro): aviso com som no app
        s.citadas.add(chave);
        evento({ tipo: "chat", processo_id: d.processo_id, motivo: `${f.apelido || "Pregoeiro"} citou a empresa no chat: ${String(f.frase).slice(0, 400)}` });
      }
    }
    s.chatIniciado = true; // mensagens antigas (de antes do robô ligar) não tocam alerta
  } catch (e) {
    if (e.tipo === "bloqueio") { s.bloqueioAte = Date.now() + 5 * 60e3; pausaGeralAte = Date.now() + 2 * 60e3; }
    s.problema = e.message;
    erro(`ler-${d.processo_id}`, `${d.orgao || ""} ${d.numero || ""}: ${e.message}`.trim(), { processo_id: d.processo_id });
  }
  decidirItens(d, s);
}

function decidirItens(d, s) {
  const pulsoVelho = Date.now() - pulsoOkEm > 30000;
  const dadosVelhos = s.okEm && Date.now() - s.okEm > (quente(d, s) ? 15000 : 180000);
  const conf = { ...CONFIG_PADRAO, ...(d.config || {}), parado: !!(ultimoPulso?.parado_geral || d.parado) };
  const agora = Date.now() / 1000;
  for (const it of d.itens) {
    const p = s.itens.get(Number(it.numero));
    let dec;
    if (!s.okEm) dec = { acao: "esperar", motivo: "Ainda não consegui ler o portal." };
    else if (pulsoVelho) dec = { acao: "parar", motivo: "Sem contato com o LicitaPro há mais de 30 s: por segurança, nada de lance." };
    else if (dadosVelhos) dec = { acao: "parar", motivo: `Sem dados novos do portal há ${Math.round((Date.now() - s.okEm) / 1000)} s: por segurança, nada de lance.` };
    else if (!p) dec = { acao: "esperar", motivo: "Item não aparece na lista do portal." };
    else if (it.parado) dec = { acao: "parar", motivo: "Item parado pelo botão Parar do item." };
    else {
      const fase = portal.faseDe(p.situacao);
      if (!fase) {
        if (p.situacao && !s.situacoesNovas.has(p.situacao)) {
          s.situacoesNovas.add(p.situacao);
          evento({ tipo: "aviso", processo_id: d.processo_id, numero: it.numero, motivo: `Situação nova no portal: “${p.situacao}”. O robô espera até aprendermos o que ela significa.` });
        }
        dec = { acao: "esperar", motivo: `Situação no portal: “${p.situacao || "sem situação"}” (o robô ainda não conhece).` };
      } else {
        const a = s.arrem.get(Number(it.numero));
        // Só sabemos se somos o melhor quando o chat confirma o mesmo valor do melhor lance.
        let somosMelhor = null;
        if (a && p.melhor != null && Math.abs(a.valor - p.melhor) < 0.005) somosMelhor = a.nosso;
        const estado = {
          numero: it.numero, piso: it.piso, estrategia: it.estrategia, ativo: it.ativo, fase,
          melhor: p.melhor, somosMelhor: !!somosMelhor, elegivelFechado: false, lanceFechadoDado: false,
          lancesDados: it.lances_dados || 0, ultimoNossoEm: null, ultimoOutroEm: a?.outroEm ?? null, restante: null,
        };
        dec = decidir(estado, conf, agora);
        if (somosMelhor === null && p.melhor != null && dec.acao === "lance" && fase !== "fechado") {
          dec = { acao: "esperar", motivo: "Não consegui confirmar quem está com o melhor lance: no modo aberto o chat público não mostra o arrematante (visto em 13/11), só a sala logada. Não cobre às cegas." };
        }
      }
    }
    // Modo observar: "lance" vira "daria lance" (nunca clica).
    const obs = dec.acao === "lance";
    const registro = { tipo: "decisao", processo_id: d.processo_id, numero: it.numero, acao: obs ? "daria_lance" : dec.acao, valor: dec.valor ?? null, motivo: obs ? `[Só observando] Daria lance de ${rs(dec.valor)}: ${dec.motivo}` : dec.motivo, dados: { melhor: p?.melhor ?? null, situacao: p?.situacao ?? null, piso: it.piso } };
    const chave = `${registro.acao}|${registro.valor}|${registro.motivo.replace(/\d+ s\b/g, "")}|${p?.melhor}`;
    if (s.decisoes.get(it.numero) !== chave) {
      s.decisoes.set(it.numero, chave);
      evento(registro);
      if (obs || dec.acao === "parar") log(`Item ${it.numero}: ${registro.motivo}`);
    }
  }
}

// ---------- Navegador ----------
async function credenciais(empresaId) {
  // A senha vem do cofre a cada login, vai direto para o campo do portal e não é guardada.
  return api("login", { empresa_id: empresaId });
}
let loginBloqueadoAte = 0;
let loginTentativas = [];
async function navegador() {
  if (ctxNav) return ctxNav;
  const { chromium } = await import("playwright-core");
  const canal = cfg.NAVEGADOR || "msedge";
  ctxNav = await chromium.launchPersistentContext(path.join(AQUI, "perfil"), { headless: false, channel: canal, viewport: null, args: ["--start-maximized"] });
  ctxNav.on("close", () => { ctxNav = null; for (const s of salas.values()) s.aba = null; });
  return ctxNav;
}

// O regulamento do portal (itens 5.3.1 e 6.7) proíbe robôs sem permissão expressa.
// Por isso a parte que entra com o login fica desligada até o dono decidir (USAR_LOGIN=sim no config.env).
const usarLogin = () => String(cfg.USAR_LOGIN || "").toLowerCase() === "sim";
let avisouLogin = false;

async function cuidarDoNavegador(disputas) {
  if (!usarLogin()) {
    if (!avisouLogin && disputas.length) { avisouLogin = true; evento({ tipo: "aviso", motivo: "Login no portal desligado (USAR_LOGIN=nao no config.env): o robô acompanha só pelos dados públicos do portal, sem abrir a sala." }); }
    return;
  }
  // Sala aberta com o login só onde a empresa tem proposta (etapa proposta/disputa) e na hora da sessão.
  const precisam = disputas.filter((d) => d.pcp_codigo && ["proposta", "disputa"].includes(d.etapa) && quente(d, sala(d.processo_id)));
  if (!precisam.length || Date.now() < loginBloqueadoAte) return;
  let ctx;
  try { ctx = await navegador(); }
  catch (e) { erro("nav", `Não consegui abrir o navegador (${e.message.split("\n")[0]}). Rode INSTALAR.bat de novo.`); loginBloqueadoAte = Date.now() + 60000; return; }
  for (const d of precisam) {
    const s = sala(d.processo_id);
    if (s.aba && Date.now() - s.conferidaEm < 15000) continue;
    try {
      if (!s.aba || s.aba.isClosed()) {
        loginTentativas = loginTentativas.filter((t) => Date.now() - t < 3600e3);
        if (loginTentativas.length >= 4) { erro("login-max", "Muitas tentativas de login na última hora. O robô parou de tentar: confira o portal e reinicie."); loginBloqueadoAte = Date.now() + 30 * 60e3; return; }
        loginTentativas.push(Date.now());
        await portal.garantirLogin(ctx, () => credenciais(d.empresa_id), log);
        s.aba = await ctx.newPage();
        await s.aba.goto(portal.urlSala(d.pcp_codigo), { waitUntil: "domcontentloaded", timeout: 45000 });
        evento({ tipo: "status", processo_id: d.processo_id, motivo: `Sala de disputa aberta no navegador do robô (${d.orgao || ""} ${d.numero || ""}).` });
        log(`Sala aberta: ${d.orgao} ${d.numero}`);
      }
      s.conferidaEm = Date.now();
      const c = await portal.conferirSala(s.aba);
      if (!c.ok) {
        erro(`sala-${d.processo_id}-${c.tipo}`, `${d.orgao || ""} ${d.numero || ""}: ${c.msg}`, { processo_id: d.processo_id });
        if (c.tipo === "captcha") { loginBloqueadoAte = Date.now() + 20000; return; } // espera o dono resolver
        if (c.tipo === "sessao") { try { await s.aba.close(); } catch { /* já fechada */ } s.aba = null; loginBloqueadoAte = Date.now() + 60000; }
        if (c.tipo === "fechada") s.aba = null;
        continue;
      }
      // Cópia da sala para calibrar a leitura e o botão de lance (até 12 por execução, a cada 2 min)
      if (s.capturas < 12 && Date.now() - s.capturaEm > 120000) {
        s.capturaEm = Date.now(); s.capturas++;
        const html = await s.aba.content().catch(() => "");
        if (html) api("captura", { processo_id: d.processo_id, tipo: "sala", url: s.aba.url(), html }).catch(() => {});
      }
    } catch (e) {
      const tipo = e.tipo || "nav";
      erro(`nav-${d.processo_id}-${tipo}`, `${d.orgao || ""} ${d.numero || ""}: ${e.message.split("\n")[0]}`, { processo_id: d.processo_id });
      if (tipo === "captcha" || tipo === "login") loginBloqueadoAte = Date.now() + (tipo === "login" ? 15 * 60e3 : 20000);
      else loginBloqueadoAte = Date.now() + 60000;
      return;
    }
  }
}

// ---------- Pedidos do app (preencher proposta) ----------
const pedidosFeitos = new Set();
async function atenderPedidos(pedidos) {
  for (const p of pedidos || []) {
    if (pedidosFeitos.has(p.id)) continue;
    pedidosFeitos.add(p.id);
    if (!usarLogin()) { await api("pedido", { id: p.id, status: "erro", mensagem: "Login no portal desligado no robô (USAR_LOGIN=nao no config.env). Ligue só depois de decidir sobre o regulamento do portal." }).catch(() => {}); continue; }
    await api("pedido", { id: p.id, status: "andamento", mensagem: "O robô está preenchendo…" }).catch(() => {});
    try {
      const dados = await api("proposta", { processo_id: p.processo_id });
      const ctx = await navegador();
      await portal.garantirLogin(ctx, () => credenciais(dados.processo?.empresa_id), log);
      const r = await preencherProposta(ctx, dados, log);
      if (r.html) api("captura", { processo_id: p.processo_id, tipo: "proposta", url: r.url, html: r.html }).catch(() => {});
      await api("pedido", { id: p.id, status: r.ok ? "feito" : "erro", mensagem: r.mensagem });
      evento({ tipo: "proposta", processo_id: p.processo_id, motivo: r.mensagem });
    } catch (e) {
      const msg = e.message.split("\n")[0];
      await api("pedido", { id: p.id, status: "erro", mensagem: msg }).catch(() => {});
      erro(`prop-${p.id}`, `Preencher proposta: ${msg}`, { processo_id: p.processo_id });
    }
  }
}

// ---------- Atualização automática ----------
async function atualizarSePrecisar(versaoPublicada) {
  if (!versaoPublicada || versaoPublicada <= VERSAO) return;
  log(`Versão nova publicada (${versaoPublicada}). Atualizando…`);
  try {
    const { arquivos } = await api("arquivos");
    const pkgAntes = fs.existsSync(path.join(AQUI, "package.json")) ? fs.readFileSync(path.join(AQUI, "package.json"), "utf8") : "";
    for (const a of arquivos) {
      if (!/^[\w.-]+\.(js|json|bat|txt)$/.test(a.nome) || a.nome === "config.env") continue; // só arquivos do programa
      fs.writeFileSync(path.join(AQUI, a.nome), a.conteudo, "utf8");
    }
    const pkgDepois = fs.readFileSync(path.join(AQUI, "package.json"), "utf8");
    evento({ tipo: "status", motivo: `Robô atualizado para a versão ${versaoPublicada}.` });
    await enviarEventos();
    await sair(pkgAntes !== pkgDepois ? 3 : 0); // 3 = INICIAR.bat roda npm install antes de religar
  } catch (e) { erro("atualizar", `Não consegui atualizar: ${e.message}`); }
}

// ---------- Ciclo principal ----------
async function pulso() {
  const ativas = [...salas.values()].filter((s) => s.okEm && Date.now() - s.okEm < 60000).length;
  try {
    const r = await api("pulso", { versao: VERSAO, status: statusTxt, maquina: cfg.MAQUINA || os.hostname(), mensagem: `${ativas} disputa(s) sendo lida(s) · ${fila.length} evento(s) na fila` });
    if (!pulsoOkEm || Date.now() - pulsoOkEm > 30000) log(`Conectado ao LicitaPro. ${r.disputas.length} disputa(s) ligada(s).`);
    ultimoPulso = r; pulsoOkEm = Date.now();
    await atualizarSePrecisar(r.versao_publicada);
  } catch (e) {
    erro("pulso", e.message);
    if (/chave do robô/.test(e.message)) erro("chave", "A chave do config.env não confere com o LicitaPro (rode cadastrar-chave.sql no Supabase).");
  }
}

let saindo = false;
async function sair(codigo) {
  if (saindo) return; saindo = true;
  statusTxt = "desligado";
  try { await api("pulso", { versao: VERSAO, status: "desligado", maquina: cfg.MAQUINA || os.hostname(), mensagem: "Robô desligado." }); } catch { /* sem internet */ }
  await enviarEventos().catch(() => {});
  try { if (ctxNav) await ctxNav.close(); } catch { /* já fechado */ }
  try { fs.unlinkSync(path.join(AQUI, "robo.pid")); } catch { /* tanto faz */ }
  process.exit(codigo);
}

function jaRodando() {
  // O robô ligado regrava robo.pid a cada 10 s; arquivo velho = sobra de um desligamento.
  try {
    const arq = path.join(AQUI, "robo.pid");
    const pid = Number(fs.readFileSync(arq, "utf8"));
    if (!pid || pid === process.pid || Date.now() - fs.statSync(arq).mtimeMs > 30000) return false;
    process.kill(pid, 0); // e o processo ainda existe
    return true;
  } catch { return false; }
}

async function ligado() {
  if (jaRodando()) { log("O robô já está rodando neste computador. Nada a fazer."); process.exit(2); }
  fs.writeFileSync(path.join(AQUI, "robo.pid"), String(process.pid));
  log(`Robô de lances v${VERSAO} ligado (SÓ OBSERVAR: não dá lance). Para desligar use PARAR.bat.`);
  statusTxt = "observando";
  evento({ tipo: "status", motivo: `Robô ligado (v${VERSAO}, só observar) em ${cfg.MAQUINA || os.hostname()}.` });
  // Sinal ao LicitaPro a cada 5 s, independente das leituras (uma por vez)
  let pulsando = false;
  const darPulso = () => { if (pulsando) return; pulsando = true; pulso().finally(() => { pulsando = false; }); };
  await pulso();
  setInterval(darPulso, 5000);
  const emLeitura = new Map(); // processo_id → quente?
  let n = 0;
  while (true) {
    if (fs.existsSync(FLAG)) { log("PARAR.bat acionado. Desligando…"); await sair(2); }
    if (n % 10 === 0) try { fs.writeFileSync(path.join(AQUI, "robo.pid"), String(process.pid)); } catch { /* */ }
    const disputas = ultimoPulso?.disputas || [];
    // Disputas desligadas no app saem da memória
    for (const pid of [...salas.keys()]) if (!disputas.some((d) => d.processo_id === pid)) {
      const s = salas.get(pid); try { if (s.aba) await s.aba.close(); } catch { /* */ } salas.delete(pid);
    }
    // Leituras em segundo plano: sessões em andamento sempre começam; fora de sessão, no máximo LEITURAS_JUNTAS juntas
    for (const d of disputas) {
      if (emLeitura.has(d.processo_id) || !devido(d, sala(d.processo_id))) continue;
      const q = quente(d, sala(d.processo_id));
      const frias = [...emLeitura.values()].filter((x) => !x).length;
      if (!q && frias >= LEITURAS_JUNTAS) continue;
      emLeitura.set(d.processo_id, q);
      lerDisputa(d).catch((e) => erro(`ler-${d.processo_id}`, e.message, { processo_id: d.processo_id }))
        .finally(() => emLeitura.delete(d.processo_id));
    }
    await cuidarDoNavegador(disputas).catch((e) => erro("nav", e.message));
    if (ultimoPulso?.pedidos?.length) await atenderPedidos(ultimoPulso.pedidos);
    if (n % 2 === 0) { await enviarEventos(); await enviarVerificacoes(); }
    n++;
    await dorme(1000);
  }
}

// ---------- Modos de teste ----------
async function testeLogin() {
  if (!usarLogin()) { log("Login no portal desligado: coloque USAR_LOGIN=sim no config.env (leia antes o aviso sobre o regulamento do portal no LEIA-ME)."); return; }
  log("Teste de login: busca a senha no cofre e entra no portal.");
  const { disputas } = await api("pulso", { versao: VERSAO, status: "teste de login", maquina: cfg.MAQUINA || os.hostname() });
  const ctx = await navegador();
  try {
    await portal.garantirLogin(ctx, () => credenciais(disputas[0]?.empresa_id), log);
    log("Login OK. A janela fica aberta 20 s para você ver.");
    evento({ tipo: "status", motivo: "Teste de login no portal: OK." });
  } catch (e) {
    log("Login falhou:", e.message);
    evento({ tipo: "erro", motivo: `Teste de login: ${e.message}` });
  }
  await enviarEventos().catch(() => {});
  await dorme(20000);
  await ctx.close().catch(() => {});
}

async function testePublico(codigo) {
  if (!codigo) { console.log("Use: node main.js teste <código do processo no portal>"); return; }
  const itens = await portal.lerItensPublicos(codigo);
  const chat = await portal.lerChat(codigo);
  const arrem = new Map();
  for (const f of [...chat].reverse()) { const a = portal.lerArrematante(f.frase); if (a) arrem.set(a.numero, a); }
  log(`Processo ${codigo}: ${itens.size} item(ns), ${chat.length} mensagem(ns) recentes no chat.`);
  for (const [n, it] of [...itens].slice(0, 15)) {
    const fase = portal.faseDe(it.situacao);
    const dec = fase ? decidir({ numero: n, piso: null, estrategia: "cobrir", ativo: true, fase, melhor: it.melhor, somosMelhor: false, lancesDados: 0 }, { ...CONFIG_PADRAO }, Date.now() / 1000) : { acao: "esperar", motivo: "situação desconhecida" };
    log(`  item ${n}: “${it.situacao}” → fase ${fase || "?"} · melhor ${rs(it.melhor)}${arrem.get(n) ? ` (${arrem.get(n).nome})` : ""} · robô: ${dec.acao} — ${dec.motivo}`);
  }
}

// Calibrar: acompanha processos de QUALQUER empresa (dados públicos) e anota cada mudança de
// situação, de melhor lance e de arrematante, para aprender como o portal mostra a disputa.
//   node main.js calibrar 522130 522430   (para com Ctrl+C; grava em logs\calibrar-AAAA-MM-DD.txt)
async function calibrar(codigos) {
  if (!codigos.length) { console.log("Use: node main.js calibrar <código> [<código>...]"); return; }
  const arq = path.join(AQUI, "logs", `calibrar-${new Date().toISOString().slice(0, 10)}.txt`);
  const anota = (t) => { const l = `${new Date().toLocaleString("pt-BR")} · ${t}`; console.log(l); fs.appendFileSync(arq, l + os.EOL); };
  const ant = new Map(); const vistos = new Set();
  anota(`Calibrando ${codigos.join(", ")} (só dados públicos, a cada 5 s por processo).`);
  while (true) { // para com Ctrl+C (não usa o PARAR.bat, que é do robô)
    for (const c of codigos) {
      try {
        const itens = await portal.lerItensPublicos(c);
        for (const [n, it] of itens) {
          const k = `${c}:${n}`; const a = ant.get(k);
          if (!a || a.situacao !== it.situacao) anota(`${c} item ${n}: situação “${a ? a.situacao : "—"}” → “${it.situacao}” (fase do robô: ${portal.faseDe(it.situacao) || "DESCONHECIDA"})`);
          else if (a.melhor !== it.melhor) anota(`${c} item ${n}: melhor lance ${rs(a.melhor)} → ${rs(it.melhor)} (“${it.situacao}”)`);
          ant.set(k, it);
        }
        for (const f of [...(await portal.lerChat(c))].reverse()) {
          const k = `${c}|${f.dataHoraFrase}|${f.frase}`;
          if (vistos.has(k)) continue; vistos.add(k);
          anota(`${c} CHAT ${f.dataHoraFrase} ${f.apelido || ""}: ${String(f.frase).slice(0, 300)}`);
        }
      } catch (e) { anota(`${c} ERRO: ${e.message}`); }
      await dorme(2500);
    }
    await dorme(2500);
  }
}

process.on("SIGINT", () => (modo === "ligado" ? sair(2) : process.exit(0)));
process.on("unhandledRejection", (e) => log("Erro inesperado:", e?.message || e));
if (modo === "ligado") await ligado();
else if (modo === "login") await testeLogin();
else if (modo === "teste") await testePublico(Number(process.argv[3]));
else if (modo === "calibrar") await calibrar(process.argv.slice(3).map(Number).filter(Boolean));
else console.log("Modos: (nada) | login | teste <código> | calibrar <código>...");
