// =====================================================================
// LicitaPro · validade da proposta (Supabase Edge Function "licita-validade")
//
// Lê o edital de cada processo (PDF ou Word, publicado no Portal de Compras
// Públicas ou no PNCP) e procura o prazo de validade da proposta
// ("validade da proposta não será inferior a 60 dias" etc.).
// O resultado alimenta a aba Reequilíbrio: o processo só aparece lá depois
// que a validade da proposta venceu (data da sessão + dias de validade).
//
// Ação do app (com login de alguém da equipe):
//   { ids?: uuid[] } → analisa o próximo processo ganho ainda não analisado (um por chamada;
//                      o app chama em sequência até "faltam" chegar a zero)
// Nunca sobrescreve um prazo digitado à mão (validade_fonte = 'manual').
// Só baixa arquivos dos portais conhecidos (nunca de endereço qualquer).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { getDocumentProxy } from "npm:unpdf@0.12.1";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const PNCP = "https://pncp.gov.br";
const UA = "LicitaPro/1.0 (acompanhamento de processos publicos)";
const HOSTS = ["arquivos.portaldecompraspublicas.com.br", "pncp.gov.br"];
const MAX_BYTES = 30 * 1024 * 1024;
const POR_CHAMADA = 1; // ler PDF gasta muito processamento: um processo por chamada (o app chama em sequência)
const MAX_PAGINAS = 25; // o prazo de validade fica no começo do edital

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** Procura o prazo de validade da proposta no texto do edital. */
export function acharValidade(texto: string) {
  const t = String(texto || "").replace(/\s+/g, " ");
  const num = String.raw`(?:(\d{1,3})\s*(?:\([a-zà-ú\s]{3,30}\))?|[a-zà-ú]{4,20}\s*\((\d{1,3})\))\s*(?:\(?\s*)?dias`;
  const pads = [
    new RegExp(String.raw`validade[^.;:]{0,140}?propostas?[^;]{0,200}?` + num, "gi"),
    new RegExp(String.raw`propostas?[^.;]{0,100}?validade[^;]{0,160}?` + num, "gi"),
    new RegExp(String.raw`prazo de validade[^;]{0,160}?` + num, "gi"),
  ];
  const achados: { dias: number; trecho: string }[] = [];
  for (const re of pads) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const d = Number(m[1] || m[2]);
      if (d >= 30 && d <= 365) achados.push({ dias: d, trecho: m[0].slice(0, 300) });
      if (achados.length > 30) break;
    }
  }
  if (!achados.length) return null;
  const cont: Record<number, number> = {};
  achados.forEach((a) => (cont[a.dias] = (cont[a.dias] || 0) + 1));
  const melhor = Number(Object.entries(cont).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]);
  const a = achados.find((x) => x.dias === melhor)!;
  return { dias: melhor, trecho: a.trecho, outros: Object.keys(cont).map(Number).filter((d) => d !== melhor) };
}

async function baixar(url: string): Promise<Uint8Array> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.includes(u.hostname)) throw new Error("endereço de arquivo não permitido");
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`arquivo respondeu ${r.status}`);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("arquivo grande demais");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("arquivo grande demais");
  return buf;
}

/** Validade lida do arquivo; no PDF, página a página, parando assim que achar. */
async function validadeDe(buf: Uint8Array) {
  // PDF começa com "%PDF"; Word (.docx) é um zip ("PK")
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    const pdf = await getDocumentProxy(buf);
    let acumulado = "";
    const n = Math.min(pdf.numPages, MAX_PAGINAS);
    for (let i = 1; i <= n; i++) {
      const pag = await pdf.getPage(i);
      const tc = await pag.getTextContent();
      acumulado += " " + tc.items.map((it: any) => it.str || "").join(" ");
      if (/validade/i.test(acumulado)) {
        const v = acharValidade(acumulado);
        if (v && i >= 3) return v; // espera umas páginas para comparar repetições do prazo
      }
    }
    return acharValidade(acumulado);
  }
  return acharValidade(await textoDe(buf));
}

async function textoDe(buf: Uint8Array): Promise<string> {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const arqs = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
    const xml = arqs["word/document.xml"];
    if (!xml) throw new Error("arquivo zip sem documento Word");
    return strFromU8(xml).replace(/<w:p[ >]/g, " \n<w:p ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  throw new Error("formato do edital não suportado (só PDF ou Word .docx)");
}

/** Links candidatos a edital do processo, do mais provável para o menos. */
async function linksEdital(p: any): Promise<string[]> {
  const links: string[] = [];
  const { data: docs } = await db.from("movimentacoes").select("titulo,link").eq("processo_id", p.id).not("link", "is", null).order("ocorrido_em", { ascending: true }).limit(200);
  // O arquivo do edital nem sempre tem "edital" no nome ("PREGÃO ELETRÔNICO SRP 20-2026.pdf",
  // "Processo 112 2026 PE 22 2026 …", "PROC. 003-2026 P.EL. 003-2026 …"): dá nota e tenta os melhores.
  const FORA = /(aviso|extrato|errata|impugna|esclarec|resposta|recurso|contrarraz|julgamento|parecer|decreto|\bata\b|homolog|adjudic|retifica|planilha|cnd|certid|consulta|justificativa|oficio|comparativo|cmed|\.(zip|rar|xls|xlsx)\b)/i;
  const nota = (t: string) => {
    if (FORA.test(t)) return 0;
    if (/edital/i.test(t)) return 3;
    if (/preg[aã]o|\bp\.?\s*el?\b\.?|\bpe\b|processo|\bproc\b|\bp\.?\s*l\b/i.test(t)) return 2;
    return 0;
  };
  (docs || []).map((d) => ({ d, n: nota(d.titulo || "") })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).forEach((x) => links.push(x.d.link));
  if (p.cnpj && p.ano && p.seq) {
    try {
      const r = await fetch(`${PNCP}/api/pncp/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.seq}/arquivos`, { headers: { Accept: "application/json", "User-Agent": UA } });
      if (r.ok) {
        const arr = await r.json();
        (Array.isArray(arr) ? arr : []).filter((a: any) => /edital/i.test(`${a.tipoDocumentoNome || ""} ${a.titulo || ""}`)).forEach((a: any) => a.url && links.push(a.url));
      }
    } catch (_) { /* segue sem o PNCP */ }
  }
  return [...new Set(links)].filter((l) => { try { return HOSTS.includes(new URL(l).hostname); } catch (_) { return false; } });
}

async function analisar(p: any) {
  // Marca antes de ler: se o edital for pesado demais e a leitura cair, o processo não trava a fila
  await db.from("processos").update({ validade_fonte: "nao_encontrada", validade_trecho: "Leitura do edital interrompida (arquivo grande ou escaneado). Informe os dias à mão.", validade_checada_em: new Date().toISOString() })
    .eq("id", p.id).or("validade_fonte.is.null,validade_fonte.eq.nao_encontrada");
  const links = await linksEdital(p);
  if (!links.length) {
    await db.from("processos").update({ validade_trecho: "Edital não encontrado nos documentos do processo." }).eq("id", p.id).eq("validade_fonte", "nao_encontrada");
    return { id: p.id, ok: false, motivo: "Edital não encontrado nos documentos do processo." };
  }
  let ultimoErro = "";
  for (const l of links.slice(0, 3)) {
    try {
      const v = await validadeDe(await baixar(l));
      if (v) {
        const trecho = v.outros.length ? `${v.trecho} (o edital também cita ${v.outros.join(", ")} dias)` : v.trecho;
        await db.from("processos").update({ validade_dias: v.dias, validade_fonte: "edital", validade_trecho: trecho.slice(0, 500), validade_checada_em: new Date().toISOString() })
          .eq("id", p.id).or("validade_fonte.is.null,validade_fonte.neq.manual");
        return { id: p.id, ok: true, dias: v.dias };
      }
      ultimoErro = "Prazo de validade não encontrado no texto do edital.";
    } catch (e) { ultimoErro = `Não consegui ler o edital: ${(e as Error).message}`; }
  }
  await db.from("processos").update({ validade_fonte: "nao_encontrada", validade_trecho: ultimoErro, validade_checada_em: new Date().toISOString() }).eq("id", p.id).or("validade_fonte.is.null,validade_fonte.eq.nao_encontrada");
  return { id: p.id, ok: false, motivo: ultimoErro };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) return json({ erro: "Faça login novamente." }, 401);
  const { data: membro } = await db.from("equipe").select("papel,ativo").eq("email", email).maybeSingle();
  if (!membro || !membro.ativo) return json({ erro: "Sem acesso." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* vazio */ }
  let q = db.from("processos").select("id,cnpj,ano,seq,validade_fonte").in("resultado", ["ganhamos", "ganhamos_parte"]);
  if (Array.isArray(body.ids) && body.ids.length) q = q.in("id", body.ids.slice(0, 50));
  q = q.is("validade_checada_em", null);
  const { data: procs, error } = await q.order("data_sessao", { ascending: true }).limit(60);
  if (error) return json({ erro: error.message }, 500);
  const fila = (procs || []).filter((p) => p.validade_fonte !== "manual");
  const res = [];
  const ini = Date.now();
  for (const p of fila.slice(0, POR_CHAMADA)) {
    if (Date.now() - ini > 100_000) break;
    res.push(await analisar(p));
  }
  return json({ analisados: res.length, faltam: Math.max(0, fila.length - res.length), resultados: res });
});
