// =====================================================================
// LicitaPro · texto do edital (Supabase Edge Function "licita-edital")
//
// Devolve o texto completo do edital de um processo, para o app achar os
// documentos exigidos (aba Documentos da planilha de cotação).
//   POST { processo_id }              → baixa o edital do processo (PCP ou PNCP) e devolve o texto
//   POST (corpo = arquivo PDF/.docx)  → devolve o texto do arquivo enviado pelo usuário
// Resposta: { texto, paginas, arquivo, parcial }  (texto com marcas "[[pág N]]")
// Só baixa arquivos dos portais conhecidos. Precisa de login de alguém ativo da equipe.
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
const MAX_PAGINAS = 200;
const TEMPO_MAX = 90_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

async function textoDe(buf: Uint8Array, ini: number) {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    const pdf = await getDocumentProxy(buf);
    const n = Math.min(pdf.numPages, MAX_PAGINAS);
    const partes: string[] = [];
    let parcial = pdf.numPages > MAX_PAGINAS;
    for (let i = 1; i <= n; i++) {
      if (Date.now() - ini > TEMPO_MAX) { parcial = true; break; }
      const pag = await pdf.getPage(i);
      const tc = await pag.getTextContent();
      // quebra de linha onde o PDF muda de linha (ajuda a achar a numeração dos itens)
      let linha = "", ultY: number | null = null;
      const out: string[] = [];
      for (const it of tc.items as any[]) {
        const y = it.transform ? it.transform[5] : null;
        if (ultY != null && y != null && Math.abs(y - ultY) > 2) { out.push(linha); linha = ""; }
        linha += (linha && !linha.endsWith(" ") ? " " : "") + (it.str || "");
        ultY = y;
      }
      out.push(linha);
      partes.push(`[[pág ${i}]]\n` + out.join("\n"));
    }
    const texto = partes.join("\n");
    return { texto, paginas: partes.length, parcial };
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const arqs = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
    const xml = arqs["word/document.xml"];
    if (!xml) throw new Error("arquivo zip sem documento Word");
    const texto = strFromU8(xml).replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return { texto, paginas: null, parcial: false };
  }
  throw new Error("formato não suportado (só PDF ou Word .docx)");
}

/** Links candidatos a edital do processo, do mais provável para o menos (mesma regra do licita-validade). */
async function linksEdital(p: any): Promise<{ url: string; nome: string }[]> {
  const links: { url: string; nome: string }[] = [];
  const { data: docs } = await db.from("movimentacoes").select("titulo,link").eq("processo_id", p.id).not("link", "is", null).order("ocorrido_em", { ascending: true }).limit(200);
  const FORA = /(aviso|extrato|errata|impugna|esclarec|resposta|recurso|contrarraz|julgamento|parecer|decreto|\bata\b|homolog|adjudic|retifica|planilha|cnd|certid|consulta|justificativa|oficio|comparativo|cmed|\.(zip|rar|xls|xlsx)\b)/i;
  const nota = (t: string) => {
    if (FORA.test(t)) return 0;
    if (/edital/i.test(t)) return 3;
    if (/preg[aã]o|\bp\.?\s*el?\b\.?|\bpe\b|processo|\bproc\b|\bp\.?\s*l\b/i.test(t)) return 2;
    return 0;
  };
  (docs || []).map((d) => ({ d, n: nota(d.titulo || "") })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).forEach((x) => links.push({ url: x.d.link, nome: x.d.titulo || "edital" }));
  if (p.cnpj && p.ano && p.seq) {
    try {
      const r = await fetch(`${PNCP}/api/pncp/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.seq}/arquivos`, { headers: { Accept: "application/json", "User-Agent": UA } });
      if (r.ok) {
        const arr = await r.json();
        (Array.isArray(arr) ? arr : []).filter((a: any) => /edital/i.test(`${a.tipoDocumentoNome || ""} ${a.titulo || ""}`))
          .forEach((a: any) => a.url && links.push({ url: a.url, nome: a.titulo || a.tipoDocumentoNome || "edital" }));
      }
    } catch (_) { /* segue sem o PNCP */ }
  }
  const vistos = new Set<string>();
  return links.filter((l) => { try { if (vistos.has(l.url) || !HOSTS.includes(new URL(l.url).hostname)) return false; vistos.add(l.url); return true; } catch (_) { return false; } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const ini = Date.now();
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) return json({ erro: "Faça login novamente." }, 401);
  const { data: membro } = await db.from("equipe").select("papel,ativo").eq("email", email).maybeSingle();
  if (!membro || !membro.ativo) return json({ erro: "Sem acesso." }, 403);

  const tipo = req.headers.get("content-type") || "";
  try {
    if (!tipo.includes("application/json")) {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (!buf.byteLength) return json({ erro: "Arquivo vazio." }, 400);
      if (buf.byteLength > MAX_BYTES) return json({ erro: "Arquivo grande demais (máximo 30 MB)." }, 400);
      const r = await textoDe(buf, ini);
      return json({ ...r, arquivo: "arquivo enviado" });
    }
    const body = await req.json().catch(() => ({}));
    if (!body.processo_id) return json({ erro: "Informe o processo." }, 400);
    const { data: p } = await db.from("processos").select("id,cnpj,ano,seq").eq("id", body.processo_id).maybeSingle();
    if (!p) return json({ erro: "Processo não encontrado." }, 404);
    const links = await linksEdital(p);
    if (!links.length) return json({ erro: "Não achei o edital nos documentos do processo. Envie o PDF do edital." }, 404);
    let ultimo = "";
    for (const l of links.slice(0, 3)) {
      try {
        const r = await textoDe(await baixar(l.url), ini);
        if (r.texto.replace(/\[\[pág \d+\]\]|\s/g, "").length < 2000) { ultimo = `“${l.nome}” não tem texto (PDF escaneado?)`; continue; }
        return json({ ...r, arquivo: l.nome, url: l.url });
      } catch (e) { ultimo = `“${l.nome}”: ${(e as Error).message}`; }
    }
    return json({ erro: `Não consegui ler o edital (${ultimo}). Envie o PDF do edital.` }, 422);
  } catch (e) {
    return json({ erro: `Não consegui ler o arquivo: ${(e as Error).message}` }, 422);
  }
});
