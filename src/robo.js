// =====================================================================
// LicitaPro · cérebro do robô de lances
//
// Função pura: recebe o estado de um item na sala de disputa e a configuração
// da empresa, e devolve a decisão ("dar lance de X", "esperar" ou "parar"),
// sempre com o motivo. Não fala com nenhum portal: quem executa a decisão é
// um "conector" (hoje, só a sala simulada; num portal real, só com autorização).
//
// Travas que nunca são quebradas:
//  1. Nunca lança abaixo do valor mínimo do item (piso). Sem piso, não lança.
//  2. Respeita a diferença mínima entre lances exigida no edital.
//  3. Respeita o intervalo mínimo entre os próprios lances e após o lance de outro.
//  4. Limite de lances por item.
//  5. Botão de parar: com ele acionado, nenhuma decisão vira lance.
//  6. Não cobre o próprio lance (se já estamos à frente, espera).
// =====================================================================

export const ESTRATEGIAS = {
  cobrir: { nome: "Cobrir sempre", desc: "Sempre que outra empresa passar à frente, cobre com o menor desconto possível, até o mínimo." },
  final: { nome: "Guardar para o fim", desc: "Só disputa quando o item entra na reta final (iminência, prorrogação ou tempo aleatório). Evita derrubar o preço cedo." },
  observar: { nome: "Só observar", desc: "Não dá lances; mostra o que faria. Bom para conferir a estratégia." },
};

export const CONFIG_PADRAO = {
  modo: "aberto", // "aberto" (lances até acabar, com prorrogação) ou "aberto_fechado" (fase aberta + tempo aleatório + lance fechado)
  difMinima: { tipo: "valor", valor: 0.01 }, // diferença mínima entre lances (edital)
  decremento: { tipo: "valor", valor: 0.01 }, // quanto o robô baixa a cada lance (nunca menos que a diferença mínima)
  intervaloProprio: 20, // segundos entre dois lances nossos no mesmo item
  intervaloAposOutro: 3, // segundos depois de um lance de outra empresa
  maxLances: 60, // por item
  retaFinal: 120, // segundos: "reta final" para a estratégia "guardar para o fim"
  lanceFechado: "decremento", // no modo aberto e fechado: "decremento" (melhor lance menos o decremento) ou "piso"
  parado: false, // botão de parar
};

const cent = (v) => Math.round(v * 100) / 100;
const rs = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const desconto = (base, regra) => (regra.tipo === "pct" ? base * (Number(regra.valor) || 0) / 100 : Number(regra.valor) || 0);

/** Valor do próximo lance para cobrir `melhor`, ou null se não existir lance válido acima do piso. */
export function proximoLance(melhor, piso, cfg) {
  const difMin = desconto(melhor, cfg.difMinima);
  const dec = Math.max(desconto(melhor, cfg.decremento), difMin, 0.01);
  const limite = cent(Math.floor((melhor - difMin) * 100 + 1e-6) / 100); // o maior valor aceito pelo portal
  let alvo = cent(Math.floor((melhor - dec) * 100 + 1e-6) / 100);
  if (alvo < piso) alvo = cent(Math.ceil(piso * 100 - 1e-6) / 100); // encosta no piso
  if (alvo > limite || alvo < piso) return null;
  return alvo;
}

/**
 * item: {
 *   numero, piso, estrategia, ativo,
 *   fase: "aguardando" | "aberto" | "reta_final" | "aleatorio" | "fechado" | "encerrado",
 *   melhor (melhor lance atual, unitário), somosMelhor (bool),
 *   elegivelFechado (bool, modo aberto e fechado), lanceFechadoDado (bool),
 *   lancesDados, ultimoNossoEm (s), ultimoOutroEm (s), restante (s até o fim previsto, se conhecido)
 * }
 * agora: segundos (relógio da sala)
 */
export function decidir(item, cfg, agora) {
  const esperar = (motivo) => ({ acao: "esperar", motivo });
  const parar = (motivo) => ({ acao: "parar", motivo });
  if (cfg.parado) return parar("Robô parado pelo botão de emergência.");
  if (!item.ativo) return parar("Item desligado para o robô.");
  if (!(Number(item.piso) > 0)) return parar("Sem valor mínimo definido: o robô não lança.");
  if (item.fase === "encerrado") return parar("Disputa do item encerrada.");
  if (item.fase === "aguardando") return esperar("Item ainda não abriu para lances.");
  if (item.lancesDados >= cfg.maxLances) return parar(`Limite de ${cfg.maxLances} lances no item atingido.`);

  // Lance fechado (modo aberto e fechado): uma única oferta, se a empresa puder dar.
  if (item.fase === "fechado") {
    if (!item.elegivelFechado) return parar("Fora da faixa de quem pode dar o lance fechado.");
    if (item.lanceFechadoDado) return parar("Lance fechado já enviado.");
    if (item.estrategia === "observar") return esperar("Só observando: daria o lance fechado agora.");
    const valor = cfg.lanceFechado === "piso" ? cent(Math.ceil(item.piso * 100 - 1e-6) / 100) : proximoLance(item.melhor, item.piso, cfg);
    if (valor == null) return parar("Lance fechado abaixo do mínimo: não envia.");
    return { acao: "lance", valor, motivo: cfg.lanceFechado === "piso" ? "Lance fechado no valor mínimo." : "Lance fechado: melhor lance menos o decremento." };
  }

  if (item.somosMelhor) return esperar("Já estamos com o melhor lance.");
  if (item.melhor == null) return esperar("Sem lance de referência ainda.");

  const valor = proximoLance(item.melhor, item.piso, cfg);
  if (valor == null) return parar(`Cobrir o lance de ${rs(item.melhor)} passaria do mínimo (${rs(item.piso)}).`);

  if (item.estrategia === "final") {
    const naReta = item.fase === "reta_final" || item.fase === "aleatorio" || (item.restante != null && item.restante <= cfg.retaFinal);
    if (!naReta) return esperar("Guardando para a reta final.");
  }
  if (item.ultimoNossoEm != null && agora - item.ultimoNossoEm < cfg.intervaloProprio) {
    return esperar(`Intervalo mínimo entre nossos lances (faltam ${Math.ceil(cfg.intervaloProprio - (agora - item.ultimoNossoEm))} s).`);
  }
  if (item.ultimoOutroEm != null && agora - item.ultimoOutroEm < cfg.intervaloAposOutro) {
    return esperar("Aguardando o intervalo após o lance de outra empresa.");
  }
  if (item.estrategia === "observar") return esperar(`Só observando: daria lance de ${rs(valor)}.`);
  return { acao: "lance", valor, motivo: valor <= item.piso + 0.0001 ? "Lance no valor mínimo (último possível)." : "Outra empresa passou à frente; cobrindo com o menor desconto." };
}
