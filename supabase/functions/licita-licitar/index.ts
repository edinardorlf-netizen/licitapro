// =====================================================================
// LicitaPro · teste da API de parceiros do Licitar Digital (só consulta)
//
//   GET ?id=<processo>&uf=MG   (cabeçalho x-cron-key = segredos.cron)
//   → confere as credenciais (Secrets LICITAR_CLIENT_ID, LICITAR_CLIENT_SECRET, LICITAR_API_BASE)
//     e mostra o formato das respostas, sem devolver as chaves.
// O acompanhamento de verdade fica na função "licita" (verificarProcesso).
// O Licitar não permite robô de lances (resposta da plataforma em 26/11/2026).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LIC_ID = Deno.env.get("LICITAR_CLIENT_ID") || "";
const LIC_SECRET = Deno.env.get("LICITAR_CLIENT_SECRET") || "";
const LIC_BASE = (Deno.env.get("LICITAR_API_BASE") || "https://app-qa.licitardigital.com.br/api/v1").replace(/\/+$/, "");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { "Content-Type": "application/json" } });

async function get(path: string) {
  await new Promise((r) => setTimeout(r, 1500));
  const r = await fetch(`${LIC_BASE}/${path}`, { headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${LIC_ID}:${LIC_SECRET}`)}` } });
  const t = await r.text();
  let corpo: any = null;
  try { corpo = t ? JSON.parse(t) : null; } catch { corpo = t.slice(0, 300); }
  return { status: r.status, corpo };
}

Deno.serve(async (req) => {
  const { data: seg } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
  if (!seg || (req.headers.get("x-cron-key") || "") !== seg.valor) return json({ erro: "não autorizado" }, 401);
  if (!LIC_ID || !LIC_SECRET) return json({ ok: false, erro: "Faltam os Secrets LICITAR_CLIENT_ID e LICITAR_CLIENT_SECRET." });
  const u = new URL(req.url);
  const lista = await get(`partner/process?state=${u.searchParams.get("uf") || "MG"}&limit=5&orderBy=updatedAt&order=desc`);
  if (lista.status !== 200) return json({ ok: false, base: LIC_BASE, status: lista.status, resposta: lista.corpo });
  const id = Number(u.searchParams.get("id") || 0) || lista.corpo?.data?.[0]?.id;
  const proc = await get(`partner/process?id=${id}`);
  const chat = await get(`partner/chats?processId=${id}&limit=5`);
  const avisos = await get(`partner/process-notice?id=${id}`);
  const pedidos = await get(`partner/process-requests?id=${id}`);
  const docs = await get(`partner/processDocuments?processId=${id}`);
  const d = proc.corpo?.data || {};
  return json({
    ok: true, base: LIC_BASE, total_uf: lista.corpo?.pagination?.total ?? null,
    exemplos: (lista.corpo?.data || []).map((x: any) => ({ id: x.id, numero: x.processNumber, etapa: x.stage, disputa: x.startDateTimeToDispute, cancelado: x.isItCanceled, finalizado: x.isItFinished })),
    processo: { id, status: proc.status, numero: d.processNumber, etapa: d.stage, disputa: d.startDateTimeToDispute, lotes: (d.lotsItems || []).slice(0, 5).map((l: any) => ({ lote: l.lotNumber, status: l.lotStatus, deserto: l.isItDeserted, itens: (l.items || []).map((i: any) => i.itemNumber) })) },
    chat: { status: chat.status, total: chat.corpo?.pagination?.total ?? null, amostra: (chat.corpo?.data || []).slice(0, 5) },
    avisos: { status: avisos.status, qtd: (avisos.corpo?.data || []).length },
    pedidos: { status: pedidos.status, chaves: Object.keys(pedidos.corpo?.data || {}) },
    documentos: { status: docs.status, amostra: (docs.corpo?.data || []).slice(0, 3) },
  });
});
