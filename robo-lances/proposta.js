// =====================================================================
// LicitaPro · preencher a proposta no Portal de Compras Públicas
//
// O dono abre a tela de cadastro da proposta do processo NA JANELA DO ROBÔ e
// clica em "Preencher proposta no portal" no app. O robô digita, item a item,
// o valor unitário, a marca (e fabricante, se o campo estiver vazio) e o
// registro Anvisa que vieram da planilha de cotação.
//
// NUNCA clica em Salvar, Enviar ou qualquer botão: quem confere e envia é o dono.
// Primeira versão: reconhece os campos pelo nome/rótulo/cabeçalho da coluna.
// A cópia da tela vai para o banco para calibrar com a tela real do portal.
// =====================================================================
import { PCP_OP, norm } from "./portal.js";

const fmt = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Lê os campos editáveis da tela (em todos os frames) com o contexto de cada um. */
async function mapearCampos(frame, fi) {
  return frame.evaluate((fi) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
    const campos = [];
    let k = 0;
    for (const el of document.querySelectorAll("input, textarea, select")) {
      const tipo = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (["hidden", "checkbox", "radio", "file", "submit", "button", "image", "reset", "password"].includes(tipo)) continue;
      if (el.disabled || el.readOnly || !vis(el)) continue;
      const tr = el.closest("tr");
      let cab = "";
      if (tr) {
        const td = el.closest("td, th");
        const tabela = el.closest("table");
        if (td && tabela) {
          const idx = [...tr.children].indexOf(td);
          const th = tabela.querySelectorAll("thead tr th, tr:first-child th")[idx];
          cab = th ? th.textContent : "";
        }
      }
      const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
      const bloco = el.closest("tr, li, fieldset, .item, [class*=item], [id*=item]");
      const textoBloco = bloco ? bloco.textContent.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      const primeiraCel = tr && tr.querySelector("td") ? tr.querySelector("td").textContent.trim() : "";
      const id = `${fi}-${k++}`;
      el.setAttribute("data-lp", id);
      campos.push({ id, tipo, nome: el.name || "", idEl: el.id || "", ph: el.placeholder || "", aria: el.getAttribute("aria-label") || "", rotulo: lab ? lab.textContent : "", cab, textoBloco, primeiraCel, valor: el.value || "" });
    }
    return campos;
  }, fi);
}

function itemDoCampo(c) {
  const m = (c.primeiraCel.match(/^\s*0*(\d{1,5})\b/) || c.textoBloco.match(/\bitem\s*:?\s*0*(\d{1,5})\b/i) || c.textoBloco.match(/^\s*0*(\d{1,5})\b/));
  return m ? Number(m[1]) : null;
}
function tipoDoCampo(c) {
  const t = norm(`${c.nome} ${c.idEl} ${c.ph} ${c.aria} ${c.rotulo} ${c.cab}`);
  if (/ total/.test(t)) return null; // total é calculado pelo portal
  if (/ marca/.test(t)) return "marca";
  if (/ fabricante/.test(t)) return "fabricante";
  if (/ anvisa| registro/.test(t)) return "anvisa";
  if (/ valor| preco| unit| vl /.test(t)) return "preco";
  return null;
}

/**
 * Preenche a proposta na aba aberta do processo.
 * Devolve { ok, mensagem, html } (html = cópia da tela antes de preencher, para calibrar).
 */
export async function preencherProposta(ctx, dados, log) {
  const codigo = String(dados.processo?.pcp_codigo || "");
  const paginas = ctx.pages().filter((p) => !p.isClosed() && p.url().startsWith(PCP_OP) && !p.url().includes("/SessaoPublica/") && (!codigo || p.url().includes(codigo)));
  const page = paginas[paginas.length - 1];
  if (!page) {
    return { ok: false, mensagem: `Abra a tela de cadastro da proposta do processo ${dados.processo?.numero || ""} na janela do robô e clique de novo em "Preencher proposta".` };
  }
  if (!dados.itens.length) return { ok: false, mensagem: "Nenhum item com preço na cotação (marque “Vamos disputar” e envie a planilha de cotação)." };

  const html = await page.content().catch(() => "");
  const frames = page.frames();
  const campos = [];
  for (let i = 0; i < frames.length; i++) {
    try { for (const c of await mapearCampos(frames[i], i)) campos.push({ ...c, frame: frames[i] }); } catch { /* frame sem acesso */ }
  }
  const porItem = new Map();
  for (const c of campos) {
    const n = itemDoCampo(c);
    const tipo = tipoDoCampo(c);
    if (n == null || !tipo) continue;
    if (!porItem.has(n)) porItem.set(n, []);
    porItem.get(n).push({ ...c, tipoCampo: tipo });
  }

  let itensFeitos = 0, camposFeitos = 0;
  const naoAchados = [], semCampo = [];
  for (const it of dados.itens) {
    const lista = porItem.get(Number(it.numero));
    if (!lista) { naoAchados.push(it.numero); continue; }
    const valores = { preco: it.preco_unit != null ? fmt(it.preco_unit) : null, marca: it.marca || null, fabricante: it.marca || null, anvisa: it.anvisa || null };
    let algum = false;
    for (const c of lista) {
      const v = valores[c.tipoCampo];
      if (!v) continue;
      if (c.tipoCampo === "fabricante" && c.valor) continue; // não troca fabricante já digitado
      const loc = c.frame.locator(`[data-lp="${c.id}"]`);
      if (c.tipo === "select") {
        const ok = await loc.selectOption({ label: v }).then(() => true).catch(() => false);
        if (!ok) continue;
      } else {
        await loc.fill(String(v));
        await loc.evaluate((el) => { el.dispatchEvent(new Event("change", { bubbles: true })); el.blur(); }).catch(() => {});
      }
      camposFeitos++; algum = true;
    }
    if (algum) itensFeitos++; else semCampo.push(it.numero);
  }
  const partes = [`Preenchi ${itensFeitos} de ${dados.itens.length} item(ns) (${camposFeitos} campo(s)).`];
  if (naoAchados.length) partes.push(`Itens que não estão nesta tela: ${naoAchados.slice(0, 30).join(", ")}${naoAchados.length > 30 ? "…" : ""}.`);
  if (semCampo.length) partes.push(`Itens sem campo reconhecido: ${semCampo.slice(0, 30).join(", ")}.`);
  partes.push("Nada foi salvo nem enviado: confira na janela do robô e clique você em Salvar/Enviar.");
  log(partes.join(" "));
  return { ok: itensFeitos > 0, mensagem: partes.join(" "), html, url: page.url() };
}
