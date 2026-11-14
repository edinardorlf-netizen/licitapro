// Leituras em lote (o Supabase devolve no máximo 1000 linhas por vez).
import { sb } from "./util.js";

export async function todas(montar, max = 30000) {
  let out = [];
  for (let de = 0; de < max; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const carregarProdutos = () => todas(() => sb.from("produtos").select("*").order("nome"));
export const carregarCustos = () => todas(() => sb.from("produto_custos").select("*").order("anotado_em", { ascending: false }));
export const carregarGanhos = () => todas(() => sb.from("itens_ganhos").select("id,processo_id,item_id,produto_id,numero,descricao,unidade,quantidade,valor_unitario,marca,custo_unit,quantidade_entregue,ata_numero,contrato_numero,vigencia_inicio,vigencia_fim,processos(orgao,municipio,numero,data_sessao,resultado,empresa_id,validade_dias,validade_fonte,validade_trecho,objeto,portal)").order("numero"));
export const carregarItensNossos = () => todas(() => sb.from("itens").select("id,processo_id,produto_id,numero,descricao,unidade,quantidade,custo,preco_unit,marca").eq("participar", true));
