// =====================================================================
// LicitaPro · documentos exigidos no edital (aba "Documentos" da planilha)
//
// Lê o texto INTEIRO do edital (objeto, proposta, habilitação, termo de
// referência, anexos…) e procura, por um catálogo de documentos comuns em
// licitação de medicamentos e materiais (Lei 14.133/2021), tudo o que o
// edital pede para apresentar. Para cada documento guarda:
//   nome, categoria, item do edital (ex.: 7.3.1), página, validade/prazo
//   citado perto, e o TRECHO de onde veio.
// Nunca inventa: só entra o que tem trecho no edital. Exigência condicional
// ("quando for o caso", "se houver", "facultativo"…) ou citada só uma vez
// fora de contexto de exigência vem marcada "confirmar". O usuário revisa a
// lista antes de gravar.
// =====================================================================

export const CATEGORIAS_DOC = ["PROPOSTA", "HABILITAÇÃO JURÍDICA", "REGULARIDADE FISCAL E TRABALHISTA", "QUALIFICAÇÃO ECONÔMICO-FINANCEIRA", "QUALIFICAÇÃO TÉCNICA", "DECLARAÇÕES", "OUTROS"];
const [PROP, JUR, FIS, ECO, TEC, DEC, OUT] = CATEGORIAS_DOC;

// [nome, categoria, regex (sobre texto sem acento, minúsculo)]
const CATALOGO = [
  ["Proposta de preços (proposta comercial)", PROP, /proposta (de precos|comercial|readequada|ajustada|final)/],
  ["Catálogo / folder / prospecto dos produtos", PROP, /\b(catalogos?|folders?|folhetos?|prospectos?)\b/],
  ["Registro dos produtos na ANVISA / Ministério da Saúde", PROP, /registro (do produto |dos produtos |valido )?(na|no|junto a|junto ao) (anvisa|agencia nacional de vigilancia sanitaria|ministerio da saude)|registros? (na |da )?anvisa|notificac\w+ (na|da) anvisa|isencao de registro/],
  ["Amostras dos produtos", PROP, /\bamostras?\b/],
  ["Bula / ficha técnica dos produtos", PROP, /\bbulas?\b|ficha tecnica|fichas tecnicas/],
  ["Marca e fabricante dos produtos na proposta", PROP, /(indica|informa|constar|conter)\w* (a |as )?(marca|fabricante)/],

  ["Ato constitutivo / contrato social / estatuto", JUR, /ato constitutivo|contrato social|estatuto social|\bestatuto\b/],
  ["Registro comercial (empresário individual)", JUR, /registro comercial|inscricao no registro publico de empresas mercantis|empresario individual/],
  ["Certificado da Condição de MEI (CCMEI)", JUR, /\bccmei\b|microempreendedor individual/],
  ["Documento de identidade dos sócios / representante", JUR, /(documento|cedula|carteira) de identidade|documento oficial (de identificacao|com foto)|\bcpf\b dos? (socios|representante)/],
  ["Procuração / credenciamento do representante", JUR, /\bprocuracao\b|instrumento de mandato|credenciamento do representante/],
  ["Decreto de autorização (empresa estrangeira)", JUR, /decreto de autorizacao/],

  ["Inscrição no CNPJ", FIS, /cadastro nacional (de|da) pessoa juridica|\bcnpj\b.{0,40}(comprovante|inscricao|cartao)|(comprovante|prova) de inscricao no cnpj/],
  ["Inscrição estadual ou municipal (cadastro de contribuintes)", FIS, /cadastro de contribuintes? (estadual|municipal|distrital)|inscricao (estadual|municipal)/],
  ["Certidão de débitos federais e Dívida Ativa da União (Receita / PGFN)", FIS, /(tributos|debitos|creditos tributarios) federais|divida ativa da uniao|fazenda (publica )?federal|receita federal.{0,80}(certidao|regularidade)|\bpgfn\b/],
  ["Certidão de regularidade com a Fazenda Estadual", FIS, /fazenda (publica )?estadual|(certidao|regularidade|prova)[^.]{0,80}estadual|fazenda (publica )?do estado/],
  ["Certidão de regularidade com a Fazenda Municipal", FIS, /fazenda (publica )?municipal|(certidao|regularidade|prova)[^.]{0,80}municipal (do domicilio|da sede)|tributos municipais/],
  ["Certificado de Regularidade do FGTS (CRF)", FIS, /\bfgts\b|fundo de garantia (do|por) tempo de servico/],
  ["Certidão Negativa de Débitos Trabalhistas (CNDT)", FIS, /\bcndt\b|debitos trabalhistas|justica do trabalho/],

  ["Certidão negativa de falência e recuperação judicial", ECO, /falencia|recuperacao judicial|concordata|insolvencia civil/],
  ["Balanço patrimonial e demonstrações contábeis", ECO, /balanco patrimonial|demonstracoes contabeis|demonstracao (do resultado|contabil)/],
  ["Índices contábeis (LG, SG, LC)", ECO, /liquidez geral|solvencia geral|liquidez corrente|\b(lg|sg|lc)\s*[=>≥]/],
  ["Capital social ou patrimônio líquido mínimo", ECO, /patrimonio liquido (minimo|de no minimo|nao inferior)|capital (social )?minimo/],

  ["Atestado de capacidade técnica", TEC, /atestados? de capacidade tecnica|atestados? (de|que comprove) (desempenho|fornecimento)|capacidade tecnica.{0,60}(atestado|declaracao)/],
  ["Autorização de Funcionamento (AFE) da ANVISA", TEC, /autorizacao de funcionamento|\bafe\b/],
  ["Autorização Especial (AE) da ANVISA – produtos controlados", TEC, /autorizacao especial|\bae\b.{0,30}anvisa|portaria (svs\/ms )?n?.? ?344/],
  ["Licença / alvará sanitário (Vigilância Sanitária)", TEC, /(licenca|alvara) (sanitari|de funcionamento sanitario|da vigilancia)|vigilancia sanitaria (estadual|municipal|local|competente)/],
  ["Certidão de Regularidade Técnica (CRF) e responsável técnico", TEC, /conselho regional de farmacia|certidao de regularidade tecnica|responsavel tecnico|farmaceutico responsavel/],
  ["Certificado de Boas Práticas (CBPF / CBPDA)", TEC, /boas praticas de (fabricacao|distribuicao|armazenagem)|\bcbp[fda]+\b/],
  ["Alvará / licença de funcionamento (localização)", TEC, /alvara de (localizacao|funcionamento)(?! sanitario)/],
  ["Licença ambiental", TEC, /licenca ambiental|licenca de operacao/],

  ["Declaração de enquadramento como ME/EPP", DEC, /declara\w*[^.]{0,120}(microempresa|empresa de pequeno porte|\bme\b|\bepp\b)|enquadramento como (microempresa|me\b)/],
  ["Declaração de que não emprega menor (art. 7º, XXXIII, CF)", DEC, /menores? de (dezoito|18)|xxxiii do art\.? 7|art\.? 7.{0,6}xxxiii|trabalho noturno, perigoso ou insalubre/],
  ["Declaração de cumprimento dos requisitos de habilitação", DEC, /cumpre (plenamente )?os requisitos de habilitacao|declaracao de (pleno )?atendimento aos requisitos/],
  ["Declaração de inexistência de fato impeditivo", DEC, /fato(s)? (superveniente|impeditivo)|inexistencia de fatos? impeditivos?/],
  ["Declaração de reserva de cargos (PCD e reabilitados)", DEC, /reserva de cargos|pessoa(s)? com deficiencia|reabilitado(s)? da previdencia/],
  ["Declaração de que a proposta inclui todos os custos (art. 63, §1º)", DEC, /(proposta|precos?) (economica )?(compreende|contempla|inclu\w+) (a integralidade dos|todos os) custos|direitos trabalhistas assegurados na constituicao/],
  ["Declaração de não utilizar trabalho degradante ou forçado", DEC, /trabalho (degradante|forcado|escravo)|condicao analoga/],
  ["Declaração de elaboração independente de proposta", DEC, /elaboracao independente/],
  ["Declaração de inexistência de vínculo / nepotismo", DEC, /nepotismo|vinculo (de parentesco|com servidor)|parente(s)? (ate|em linha reta)/],
  ["Declaração de ciência / concordância com o edital", DEC, /declaracao de (ciencia|concordancia)|(tem|tomou) conhecimento de todas as (informacoes|condicoes)/],

  ["Cadastro no SICAF", OUT, /\bsicaf\b/],
  ["Certificado de Registro Cadastral (CRC) do órgão", OUT, /certificado de registro cadastral|\bcrc\b/],
  ["Garantia da proposta / contratual", OUT, /garantia (da proposta|de proposta|contratual|de execucao)/],
  ["Visita técnica / declaração de vistoria", OUT, /visita tecnica|vistoria/],
];

const EXIGE = /(apresent|anex|junt|encaminh|exig|devera|deverao|deve |devem |obrigatori|sob pena|habilitac|documenta|comprova|prova de|certidao|declarac|acompanhad|enviar|inserir|cadastrar)/;
const CONDICIONAL = /(quando (for o caso|couber|aplicavel|exigid)|se (for o caso|houver|aplicavel)|caso (a|o) (licitante|empresa)|facultativ|opcional|podera|poderao|dispensad|apenas para|somente para|nao sera exigid|para fins de|em caso de|na hipotese)/;
const VALIDADE = /(emitid[ao]s? (ha|a) (no maximo|menos de|nao mais (de|que))\s*\d+\s*(\(\w+\)\s*)?dias|validade (minima )?de\s*\d+\s*(\(\w+\)\s*)?(dias|meses)|ultimos?\s*\d+\s*(\(\w+\)\s*)?(dias|meses)|exercicio social (ja exigivel|anterior)|ultimos dois exercicios|dentro do prazo de validade|em vigor|vigente)/;

const plano = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Item do edital (ex.: "7.3.1") mais próximo antes da posição. */
function itemAntes(t, pos) {
  const ini = Math.max(0, pos - 1500);
  const trecho = t.slice(ini, pos);
  const re = /(?:^|\n)\s*(?:item\s+)?(\d{1,2}(?:\.\d{1,3}){1,4})\.?(?:\s*[-–)]|\s+[a-z(])/g;
  let m, ult = null;
  while ((m = re.exec(trecho))) ult = m[1];
  return ult;
}
function paginaAntes(t, pos) {
  const ini = t.lastIndexOf("[[pag ", pos);
  if (ini < 0) return null;
  const m = /\[\[pag (\d+)\]\]/.exec(t.slice(ini, ini + 14));
  return m ? Number(m[1]) : null;
}
/** Seção grande em que está (para saber se é Termo de Referência, anexo, minuta etc.). */
function secaoDe(t, pos) {
  const antes = t.slice(Math.max(0, pos - 60000), pos);
  const re = /\n\s*(anexo\s+[ivxlc\d]+[^\n]{0,60}|termo de referencia|minuta d[oa] (contrato|ata)[^\n]{0,30}|modelo de (proposta|declarac)[^\n]{0,40})/g;
  let m, ult = null;
  while ((m = re.exec(antes))) ult = m[1].trim();
  return ult;
}

// ---------------------------------------------------------------------
// Pontos de atenção (o que a equipe precisa saber antes de cotar e disputar)
// [grupo, título, regex, importante (avisa se não achar)]
// O "valor" é o pedaço que casou; o trecho em volta vai junto para conferir.
// ---------------------------------------------------------------------
const N = String.raw`\d{1,3}\s*(?:\([a-z\s-]{2,30}\)\s*)?`;
export const GRUPOS_PONTOS = ["Sessão e prazos", "Proposta", "Disputa", "Entrega e contrato"];
const PONTOS = [
  ["Sessão e prazos", "Data e hora da sessão / abertura", new RegExp(String.raw`(sessao publica|abertura d[ao]s? (sessao|propostas)|inicio da (sessao|disputa)|data da (sessao|disputa|abertura))[^.]{0,140}?\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}[^.]{0,50}?\d{1,2}\s*(:|h)\s*\d{0,2}`), true],
  ["Sessão e prazos", "Prazo para cadastrar a proposta", /(recebimento|envio|cadastr\w+|encaminhamento) d[ao]s? propostas?[^.]{0,180}?\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}[^.]{0,40}/, false],
  ["Sessão e prazos", "Site / plataforma da disputa", /portaldecompraspublicas[\w./-]*|licitardigital[\w./-]*|licitar digital|comprasnet[\w./-]*|compras\.gov\.br[\w./-]*|bll\.org\.br[\w./-]*|bolsa de licitacoes e leiloes|licitacoes-e[\w./-]*|bnc\.org\.br[\w./-]*|bbmnet[\w./-]*|ammlicita[\w./-]*|licitanet[\w./-]*|portal de compras publicas|plataforma[^.]{0,80}?www\.[a-z0-9.-]+/, true],
  ["Sessão e prazos", "Prazo para impugnação / esclarecimento", new RegExp(String.raw`(impugna\w+|pedidos? de esclarecimento)[^.]{0,160}?${N}dias uteis`), false],
  ["Sessão e prazos", "Prazo para enviar documentos/proposta após convocação", new RegExp(String.raw`(no prazo de|prazo (minimo |maximo )?de|em)\s*(ate )?${N}horas`), true],
  ["Proposta", "Validade da proposta", new RegExp(String.raw`validade[^.;:]{0,120}?propostas?[^;]{0,160}?${N}dias|propostas?[^.;]{0,80}?validade[^;]{0,140}?${N}dias`), true],
  ["Proposta", "Casas decimais do preço", /(duas|2|tres|3|quatro|4) \(?\w*\)?\s*casas decimais/, false],
  ["Proposta", "Marca / fabricante obrigatórios", /(indicar|informar|constar|conter)\w* (obrigatoriamente )?(a |as )?(marca|fabricante)/, false],
  ["Proposta", "Amostras (prazo e condições)", new RegExp(String.raw`amostras?[^.]{0,200}?(${N}(dias|horas)|apos convocac|quando solicitad)`), false],
  ["Proposta", "Orçamento sigiloso", /orcamento (estimado )?(tera carater |e |sera )?sigiloso|valor estimado (sera |e )?sigiloso|carater sigiloso/, false],
  ["Proposta", "Validade mínima dos produtos na entrega", new RegExp(String.raw`(prazo de )?validade (minima |remanescente )?(dos? (produtos?|medicamentos?|materia\w*|itens?|bens)|minima|remanescente)[^.]{0,120}?(${N}(meses|dias|anos?)|\d{1,3}\s*%|metade|dois tercos)`), true],
  ["Disputa", "Critério de julgamento", /menor preco (por item|por lote|global|unitario|por grupo)|maior desconto|menor preco/, true],
  ["Disputa", "Modo de disputa", /modo de disputa[^.]{0,80}?(aberto e fechado|fechado e aberto|aberto|fechado)|disputa (no modo )?(aberto e fechado|fechado e aberto|aberta)/, true],
  ["Disputa", "Intervalo mínimo entre lances", /intervalo (minimo )?(de diferenca )?(de valores )?entre (os )?lances[^.]{0,200}/, true],
  ["Disputa", "Exclusividade ME/EPP / cota reservada", /(exclusiv\w+|cota reservada|cota principal)[^.]{0,120}?(microempresa|me\/epp|me e epp|me\/epp\/mei|pequeno porte|micro e pequenas|microempreendedor)/, true],
  ["Disputa", "Margem / benefício local ou regional", /(margem de preferencia|prioridade de contratacao|sediad\w+ local|regionalmente)[^.]{0,120}/, false],
  ["Entrega e contrato", "Prazo de entrega", new RegExp(String.raw`prazo (maximo )?(de|para) (a )?entrega[^.]{0,160}?${N}(dias|horas)|entreg\w+ (em|no prazo de|em ate) (ate )?${N}(dias|horas)`), true],
  ["Entrega e contrato", "Local de entrega", /(local|endereco) (de|da|para) entrega[^.]{0,200}|entregues? (no|na|em) (endereco|local|sede|almoxarifado|farmacia|secretaria|unidade|deposito|central)[^.]{0,160}/, true],
  ["Entrega e contrato", "Forma de fornecimento (parcelado / imediato)", /(entrega|fornecimento) (sera |de forma )?(parcelad\w+|integral|imediat\w+|conforme demanda|mediante (ordem|autorizacao) de fornecimento)/, false],
  ["Entrega e contrato", "Prazo de pagamento", new RegExp(String.raw`pagamento[^.]{0,140}?(em ate|prazo (maximo )?de|ate o)\s*(ate )?${N}dias`), true],
  ["Entrega e contrato", "Vigência da ata / contrato", new RegExp(String.raw`((vigencia|prazo de validade) d[ao] (ata|contrato|registro de precos)|(ata de registro de precos|contrato) tera (prazo de )?(vigencia|validade))[^.]{0,120}?${N}(meses|dias|anos?)`), true],
  ["Entrega e contrato", "Multas e penalidades", /\bmultas?\b[^.]{0,120}?\d{1,2}([.,]\d{1,2})?\s*%/, true],
  ["Entrega e contrato", "Garantia contratual", /garantia (contratual|de execucao)[^.]{0,120}?\d{1,2}\s*%/, false],
  ["Entrega e contrato", "Reajuste / reequilíbrio", /(reajuste|repactuacao|reequilibrio economico)[^.]{0,160}/, false],
  ["Entrega e contrato", "Troca / substituição de produtos", new RegExp(String.raw`(substitui\w+|troca)[^.]{0,120}?(${N}(dias|horas))`), false],
];

/** Pontos de atenção do edital. Devolve { pontos:[{grupo,titulo,valor,item,pagina,trecho}], faltou:[títulos importantes não achados] }. */
export function pontosAtencao(textoOriginal) {
  const orig = String(textoOriginal || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const o = orig.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const t = o.toLowerCase();
  const pontos = [], faltou = [];
  for (const [grupo, titulo, re, importante] of PONTOS) {
    const g = new RegExp(re.source, "g");
    let m, melhor = null;
    while ((m = g.exec(t))) {
      // evita o sumário/índice do edital: prefere ocorrência com número/data e fora das primeiras linhas
      const pos = m.index;
      const ok = !/\.{5,}/.test(t.slice(pos, pos + 120));
      if (ok) { melhor = m; break; }
      if (!melhor) melhor = m;
    }
    if (!melhor) { if (importante) faltou.push(titulo); continue; }
    const pos = melhor.index;
    let a = Math.max(t.lastIndexOf(". ", pos), t.lastIndexOf(";", pos), t.lastIndexOf("\n\n", pos), pos - 240);
    let b = t.indexOf(". ", pos + melhor[0].length); if (b < 0 || b - pos > 420) b = Math.min(t.length, pos + 420);
    pontos.push({
      grupo, titulo,
      valor: o.slice(pos, pos + melhor[0].length).replace(/\[\[pag \d+\]\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
      item: itemAntes(t, pos), pagina: paginaAntes(t, pos),
      trecho: o.slice(a + 1, b + 1).replace(/\[\[pag \d+\]\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 700),
    });
  }
  return { pontos, faltou };
}

/**
 * Acha os documentos exigidos no texto do edital.
 * Devolve [{ nome, categoria, item, pagina, secao, validade, status:"Pendente", obs, trecho, confirmar, vezes }].
 */
export function acharDocumentos(textoOriginal) {
  const orig = String(textoOriginal || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const t = plano(orig); // mesmo comprimento (só tira acentos combinados após NFD) → ajusta abaixo
  // NFD muda o tamanho do texto; refaz o original "achatado" com o mesmo índice
  const o = orig.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const out = [];
  for (const [nome, categoria, re] of CATALOGO) {
    const g = new RegExp(re.source, "g");
    const achados = [];
    let m;
    while ((m = g.exec(t)) && achados.length < 40) {
      const pos = m.index;
      const ctx = t.slice(Math.max(0, pos - 220), Math.min(t.length, pos + 260));
      // trecho = frase em volta (do ponto/linha anterior até o próximo ponto final)
      let a = Math.max(t.lastIndexOf(". ", pos), t.lastIndexOf(";", pos), t.lastIndexOf("\n\n", pos), pos - 280);
      let b = t.indexOf(". ", pos + m[0].length); if (b < 0 || b - pos > 360) b = Math.min(t.length, pos + 360);
      const trecho = o.slice(a + 1, b + 1).replace(/\[\[pag \d+\]\]/g, " ").replace(/\s+/g, " ").trim();
      achados.push({ pos, exige: EXIGE.test(ctx), cond: CONDICIONAL.test(t.slice(Math.max(0, pos - 160), pos + 160)), validade: (VALIDADE.exec(t.slice(pos, pos + 400)) || [])[0] || null, trecho });
    }
    if (!achados.length) continue;
    const exigidos = achados.filter((x) => x.exige);
    const base = (exigidos.find((x) => !x.cond) || exigidos[0] || achados[0]);
    const firmes = exigidos.filter((x) => !x.cond).length;
    const confirmar = !firmes;
    const item = itemAntes(t, base.pos);
    const pagina = paginaAntes(t, base.pos);
    const secao = secaoDe(t, base.pos);
    const motivo = confirmar ? (exigidos.length ? "confirmar: exigência condicional" : "confirmar: citado sem pedir apresentação") : null;
    out.push({
      nome, categoria, item: item || (pagina ? `pág. ${pagina}` : null), pagina, secao,
      validade: base.validade ? base.validade.replace(/\s+/g, " ") : null,
      status: "Pendente",
      obs: [motivo, secao && !/^\d/.test(secao) ? `em ${secao}` : null, achados.length > 1 ? `citado ${achados.length}×` : null].filter(Boolean).join(" · ") || null,
      trecho: base.trecho.slice(0, 600), confirmar, vezes: achados.length,
    });
  }
  return out.sort((x, y) => CATEGORIAS_DOC.indexOf(x.categoria) - CATEGORIAS_DOC.indexOf(y.categoria));
}
