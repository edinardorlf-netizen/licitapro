-- Categorias do radar (lista para marcar, no lugar das palavras-chave soltas)
create table if not exists radar_categorias (
  id text primary key,
  grupo text not null,
  nome text not null,
  ordem int not null default 0,
  termos text[] not null default '{}',
  ativa boolean not null default false
);
alter table radar_categorias enable row level security;
drop policy if exists "ver categorias" on radar_categorias;
create policy "ver categorias" on radar_categorias for select using (is_equipe());

alter table editais add column if not exists categorias text[] not null default '{}';
create index if not exists editais_categorias_idx on editais using gin (categorias);

create or replace function lp_norm(t text) returns text language sql stable set search_path = public as $$
  select ' ' || trim(regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g')) || ' '
$$;

-- Classifica o edital: categorias marcadas que aparecem no objeto + palavras extras.
-- Palavra de "excluir" não barra quando faz parte de uma categoria marcada que bateu.
create or replace function editais_classificar() returns trigger language plpgsql set search_path = public as $$
declare
  o text := lp_norm(new.objeto);
  bate text[];
begin
  select coalesce(array_agg(distinct c.id), '{}'), coalesce(array_agg(distinct t), '{}')
    into new.categorias, bate
    from radar_categorias c, unnest(c.termos) t
   where c.ativa and position(' ' || t in o) > 0;
  bate := bate || coalesce(array(select p.termo from palavras p where p.tipo = 'incluir' and position(rtrim(lp_norm(p.termo)) in o) > 0), '{}');
  new.termos := array(select distinct x from unnest(bate) x order by 1);
  new.relevante := cardinality(new.termos) > 0 and not exists (
    select 1 from palavras p
     where p.tipo = 'excluir' and position(rtrim(lp_norm(p.termo)) in o) > 0
       and not exists (select 1 from unnest(new.categorias) cid, radar_categorias c, unnest(c.termos) t
                        where c.id = cid and position(' ' || t in o) > 0
                          and (position(trim(lp_norm(p.termo)) in t) > 0 or position(t in trim(lp_norm(p.termo))) > 0))
  );
  return new;
end $$;
drop trigger if exists editais_classificar on editais;
create trigger editais_classificar before insert or update of objeto on editais
  for each row execute function editais_classificar();

-- Refaz a classificação dos editais ainda abertos (depois de mudar categorias ou palavras)
create or replace function reclassificar_editais() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not pode_editar() and current_user not in ('postgres', 'service_role') then raise exception 'sem permissão'; end if;
  update editais set objeto = objeto where encerramento_propostas is null or encerramento_propostas >= now() - interval '1 day';
  select count(*) into n from editais where relevante and status = 'novo' and encerramento_propostas >= now();
  return n;
end $$;

create or replace function salvar_categorias(p_ids text[]) returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar() then raise exception 'Seu perfil não pode mudar as categorias.'; end if;
  update radar_categorias set ativa = (id = any(p_ids));
  return reclassificar_editais();
end $$;
revoke all on function salvar_categorias(text[]) from public, anon;
revoke all on function reclassificar_editais() from public, anon;
grant execute on function salvar_categorias(text[]) to authenticated;
grant execute on function reclassificar_editais() to authenticated;
insert into radar_categorias (id, grupo, nome, ordem, termos, ativa) values
('administrati-assessoria-consultoria-em-geral', 'Administrativo / Finanças', 'Assessoria / Consultoria em Geral', 1, array['assessoria','consultoria']::text[], false),
('administrati-assessoria-administrativa', 'Administrativo / Finanças', 'Assessoria Administrativa', 2, array['assessoria administrativa','apoio administrativo']::text[], false),
('administrati-assessoria-contabil', 'Administrativo / Finanças', 'Assessoria Contábil', 3, array['contabil','contabilidade']::text[], false),
('administrati-servico-de-gerenciamento-de-compras', 'Administrativo / Finanças', 'Serviço de gerenciamento de compras', 4, array['gerenciamento de compras','plataforma de compras','plataforma eletronica de compras']::text[], false),
('administrati-servicos-de-instituicao-financeira', 'Administrativo / Finanças', 'Serviços de Instituição Financeira', 5, array['instituicao financeira','servicos bancarios','processamento da folha','folha de pagamento dos servidores']::text[], false),
('agricola-equipamentos-e-maquinas-agricolas', 'Agrícola', 'Equipamentos e máquinas agrícolas', 6, array['maquinas agricolas','maquina agricola','equipamentos agricolas','trator agricola','tratores agricolas']::text[], false),
('agricola-fertilizantes-e-sementes', 'Agrícola', 'Fertilizantes e Sementes', 7, array['fertilizant','adubo','semente','calcario']::text[], false),
('agricola-fornecimento-de-produtos-aparelhos-veter', 'Agrícola', 'Fornecimento de produtos, Aparelhos Veterinários', 8, array['veterinari']::text[], false),
('agricola-implementos-materiais-de-inseminacao-e-a', 'Agrícola', 'Implementos / Materiais de inseminação e Alimentação Animal', 9, array['inseminacao','racao','racoes','alimentacao animal','sal mineral','implementos agricolas']::text[], false),
('agricola-locacao-de-maquinas-pesadas-com-ou-sem-m', 'Agrícola', 'Locação de Máquinas Pesadas / com ou sem motorista', 10, array['locacao de maquinas pesadas','hora maquina','horas maquina','locacao de maquinas e equipamentos pesados']::text[], false),
('agricola-mata-burro-fosso-escavado-com-travessas', 'Agrícola', 'Mata-Burro (fosso escavado com travessas espaçadas)', 11, array['mata burro','mata burros']::text[], false),
('agricola-mudas-de-especies-arboreas', 'Agrícola', 'Mudas de Espécies Arbóreas', 12, array['mudas','especies arboreas']::text[], false),
('agricola-projetos-e-obras-de-irrigacao-ou-agricol', 'Agrícola', 'Projetos e Obras de Irrigação ou Agrícolas', 13, array['irrigacao']::text[], false),
('agricola-servicos-pecas-de-maquinas-pesadas', 'Agrícola', 'Serviços / Peças de Máquinas Pesadas', 14, array['pecas para maquinas pesadas','pecas de maquinas pesadas','manutencao de maquinas pesadas','retroescavadeira','motoniveladora','pa carregadeira']::text[], false),
('alienacao-bens-imoveis', 'Alienação', 'Bens Imóveis', 15, array['alienacao de imove','venda de imove','alienacao de terreno']::text[], false),
('alienacao-bens-moveis', 'Alienação', 'Bens Móveis', 16, array['alienacao de bens','venda de bens moveis','alienacao de veiculo','venda de sucata']::text[], false),
('alimentacao-alimentacao-especial-dieta-restritiva-su', 'Alimentação', 'Alimentação especial (Dieta restritiva, Suplementos)', 17, array['dieta','dietas','suplemento','formula infantil','formulas infantis','formula lactea','leite especial','leites especiais','enteral','alimentacao especial','nutricionais','nutricao clinica','modulo de proteina']::text[], true),
('alimentacao-demais-itens-da-alimentacao-pereciveis-e', 'Alimentação', 'Demais itens da Alimentação (perecíveis e não perecíveis)', 18, array['generos alimenticios','genero alimenticio','produtos alimenticios','alimentos','alimenticio','pereciveis','nao pereciveis']::text[], true),
('alimentacao-hortifruti', 'Alimentação', 'Hortifruti', 19, array['hortifrut','frutas','verduras','legumes','hortalica']::text[], false),
('alimentacao-ovos-de-pascoa', 'Alimentação', 'Ovos de Páscoa', 20, array['ovos de pascoa','ovo de pascoa']::text[], false),
('aquisicoes-g-acondicionamento-embalagens-descartaveis', 'Aquisições Gerais', 'Acondicionamento / Embalagens / Descartáveis', 21, array['embalage','descartave','saco plastico','sacos plasticos','sacola','acondicionamento']::text[], true),
('aquisicoes-g-aquisicao-de-cama-mesa-e-banho', 'Aquisições Gerais', 'Aquisição de Cama, Mesa e Banho', 22, array['cama mesa e banho','roupa de cama','roupas de cama','enxova','toalha','lencol','lencois','cobertor','colchao','colchoes','travesseiro']::text[], true),
('aquisicoes-g-aquisicao-de-tintas-imobiliarias', 'Aquisições Gerais', 'Aquisição de Tintas Imobiliárias', 23, array['tintas imobiliarias','tinta acrilica','tintas acrilicas','tinta latex','massa corrida']::text[], false),
('aquisicoes-g-aquisicao-de-utensilios-de-copa-e-cozinh', 'Aquisições Gerais', 'Aquisição de utensílios de copa e cozinha', 24, array['utensilio','copa e cozinha','panela','garrafa termica','garrafas termicas','louca','loucas','talher']::text[], true),
('aquisicoes-g-armarinhos-tecidos', 'Aquisições Gerais', 'Armarinhos / Tecidos', 25, array['armarinho','tecido','aviamento']::text[], true),
('aquisicoes-g-artigos-e-equipamentos-esportivos', 'Aquisições Gerais', 'Artigos e Equipamentos Esportivos', 26, array['esportiv','material esportivo','materiais esportivos']::text[], false),
('aquisicoes-g-bandeiras-oficiais-flamulas-e-insignias', 'Aquisições Gerais', 'Bandeiras Oficiais, Flâmulas e Insígnias', 27, array['bandeira','flamula','insignia']::text[], false),
('aquisicoes-g-cursos-palestras-treinamentos', 'Aquisições Gerais', 'Cursos / Palestras / Treinamentos', 28, array['curso','palestra','treinamento','capacitacao']::text[], false),
('aquisicoes-g-decoracao', 'Aquisições Gerais', 'Decoração', 29, array['decoracao','ornamentacao','natalin']::text[], false),
('aquisicoes-g-eletrodomesticos-eletroportateis-eletroe', 'Aquisições Gerais', 'Eletrodomésticos / Eletroportáteis / Eletroeletrônicos', 30, array['eletrodomestic','eletroportat','eletroeletronic','eletronicos','geladeira','refrigerador','freezer','bebedouro','ventilador','micro ondas','microondas','televis','fogao','fogoes','liquidificador']::text[], true),
('aquisicoes-g-equipamento-instrumento-para-pesquisa-ci', 'Aquisições Gerais', 'Equipamento/instrumento para pesquisa científica e tecnológica', 31, array['pesquisa cientifica','pesquisas cientificas','instrumentos cientificos','equipamentos de laboratorio','equipamento de laboratorio']::text[], true),
('aquisicoes-g-equipamentos-instrumentos-musicais', 'Aquisições Gerais', 'Equipamentos / Instrumentos Musicais', 32, array['instrumentos musicais','instrumento musical']::text[], true),
('aquisicoes-g-equipamentos-agroindustriais', 'Aquisições Gerais', 'Equipamentos Agroindustriais', 33, array['agroindustri']::text[], true),
('aquisicoes-g-equipamentos-instrumento-partes-e-pecas', 'Aquisições Gerais', 'Equipamentos/Instrumento/partes e peças e acessórios para pesquisa científica e tecnológica', 34, array['pesquisa e desenvolvimento','desenvolvimento cientifico','pecas e acessorios para pesquisa']::text[], true),
('aquisicoes-g-ferramentas-em-geral', 'Aquisições Gerais', 'Ferramentas em geral', 35, array['ferramenta']::text[], true),
('aquisicoes-g-fogos-de-artificio', 'Aquisições Gerais', 'Fogos de Artifício', 36, array['fogos de artificio','fogos']::text[], true),
('aquisicoes-g-fornecimento-de-agua-gas-gelo', 'Aquisições Gerais', 'Fornecimento de Água/Gás/Gelo', 37, array['agua mineral','galao de agua','galoes de agua','gas liquefeito','glp','botijao','botijoes','gas de cozinha','gelo']::text[], true),
('aquisicoes-g-fornecimento-de-brinquedos-infantis-loca', 'Aquisições Gerais', 'Fornecimento de Brinquedos Infantis / Locação / Instalação', 38, array['brinquedo','playground','parque infantil','parquinho','pula pula','inflave']::text[], true),
('aquisicoes-g-fornecimento-de-materiais-de-limpeza-hig', 'Aquisições Gerais', 'Fornecimento de Materiais de Limpeza / Higiene', 39, array['material de limpeza','materiais de limpeza','produtos de limpeza','produto de limpeza','higiene','higienizacao','saneante','papel higienico','papel toalha','sabonete','detergente','desinfetante','cosmetic','fralda']::text[], true),
('aquisicoes-g-herbicidas-e-inseticidas', 'Aquisições Gerais', 'Herbicidas e Inseticidas', 40, array['herbicid','inseticid','pesticid','agrotox','raticid','larvicid','formicid']::text[], true),
('aquisicoes-g-imovel-urbano-ou-rural', 'Aquisições Gerais', 'Imóvel urbano ou rural', 41, array['aquisicao de imove','compra de imove','imovel urbano','imovel rural']::text[], true),
('aquisicoes-g-madeiras', 'Aquisições Gerais', 'Madeiras', 42, array['madeira']::text[], true),
('aquisicoes-g-materiais-de-expediente', 'Aquisições Gerais', 'Materiais de Expediente', 43, array['material de expediente','materiais de expediente','material de escritorio','materiais de escritorio','papelaria','papel a4','papel sulfite','material escolar','materiais escolares','material didatico','materiais didaticos','material pedagogico','materiais pedagogicos']::text[], true),
('aquisicoes-g-mobilias-em-geral', 'Aquisições Gerais', 'Mobílias em Geral', 44, array['mobilia','mobiliario','moveis de escritorio','moveis escolares','moveis para','cadeiras','armario','armarios','estante','mesas']::text[], true),
('aquisicoes-g-motobombas-peneiras-e-aspirador-para-lim', 'Aquisições Gerais', 'Motobombas, peneiras e aspirador para limpeza de piscinas', 45, array['motobomba','piscina','bomba d agua','bombas d agua']::text[], true),
('aquisicoes-g-pecas-para-gas', 'Aquisições Gerais', 'Peças para gás', 46, array['pecas para gas','regulador de gas','reguladores de gas','mangueira de gas','valvula de gas']::text[], true),
('aquisicoes-g-vestuario-uniformes-calcados', 'Aquisições Gerais', 'Vestuário / Uniformes / Calçados', 47, array['vestuario','uniforme','calcado','camiseta','camisa','jaleco','botina','tenis','fardamento','agasalho']::text[], true),
('aquisicoes-g-vidros-e-ou-espelhos', 'Aquisições Gerais', 'Vidros e/ou Espelhos', 48, array['vidro','espelho','vidraca']::text[], true),
('automotivo-aluguel-de-veiculos-leves-pesados', 'Automotivo', 'Aluguel de Veículos Leves / Pesados', 49, array['locacao de veiculo','aluguel de veiculo','locacao de automove']::text[], false),
('automotivo-ambulancias', 'Automotivo', 'Ambulâncias', 50, array['ambulancia']::text[], false),
('automotivo-aquisicao-de-motocicletas', 'Automotivo', 'Aquisição de Motocicletas', 51, array['motocicleta']::text[], false),
('automotivo-aquisicao-de-veiculos-leves', 'Automotivo', 'Aquisição de Veículos Leves', 52, array['aquisicao de veiculo','veiculo zero','veiculos zero','veiculo novo','veiculos novos','automove']::text[], false),
('automotivo-aquisicao-de-veiculos-pesados', 'Automotivo', 'Aquisição de Veículos Pesados', 53, array['caminhao','caminhoes','veiculo pesado','veiculos pesados']::text[], false),
('automotivo-bicicleta-eletrica', 'Automotivo', 'Bicicleta Elétrica', 54, array['bicicleta']::text[], false),
('automotivo-contratacao-de-servicos-terceirizados-mo', 'Automotivo', 'Contratação de Serviços Terceirizados - Motorista', 55, array['motorista']::text[], false),
('automotivo-fornecimento-de-combustivel', 'Automotivo', 'Fornecimento de Combustível', 56, array['combustive','gasolina','diesel','etanol','arla']::text[], false),
('automotivo-guincho-reboque', 'Automotivo', 'Guincho / Reboque', 57, array['guincho','reboque']::text[], false),
('automotivo-limpeza-de-veiculos', 'Automotivo', 'Limpeza de Veículos', 58, array['lavagem de veiculo','lavagem automotiva','lava jato','lavajato','higienizacao de veiculo']::text[], false),
('automotivo-mecanica-em-geral', 'Automotivo', 'Mecânica em Geral', 59, array['mecanica','manutencao de veiculo','manutencao veicular','manutencao da frota','manutencao de frota']::text[], false),
('automotivo-oleos-filtros-lubrificantes', 'Automotivo', 'Óleos / Filtros / Lubrificantes', 60, array['lubrificant','oleo lubrificante','filtro de oleo','filtros de oleo','filtro de ar','filtros de ar']::text[], false),
('automotivo-onibus-mini-onibus-e-furgao', 'Automotivo', 'Ônibus, mini ônibus e furgão', 61, array['onibus','micro onibus','microonibus','furgao']::text[], false),
('automotivo-passagem-expressa-pedagio-tag-ou-tiv', 'Automotivo', 'Passagem Expressa Pedágio (TAG ou TIV)', 62, array['pedagio']::text[], false),
('automotivo-pecas-de-veiculos-motocicletas', 'Automotivo', 'Peças de Veículos / Motocicletas', 63, array['pecas automotivas','pecas de veiculo','pecas para veiculo','autopeca','pecas e acessorios automotivos','pecas para motocicleta']::text[], false),
('automotivo-placas-mercosul', 'Automotivo', 'Placas Mercosul', 64, array['placa mercosul','placas mercosul','emplacamento']::text[], false),
('automotivo-pneus-e-servicos-de-borracharia', 'Automotivo', 'Pneus e Serviços de Borracharia', 65, array['pneu','borracharia','camara de ar','camaras de ar']::text[], false),
('automotivo-rastreamento-veicular-seguros', 'Automotivo', 'Rastreamento Veicular / Seguros', 66, array['rastreamento veicular','rastreador','seguro de veiculo','seguro veicular','seguro de frota','seguro da frota']::text[], false),
('automotivo-servico-de-pintura-em-veiculos', 'Automotivo', 'Serviço de pintura em veículos', 67, array['pintura automotiva','funilaria','lanternagem']::text[], false),
('automotivo-trailer', 'Automotivo', 'Trailer', 68, array['trailer']::text[], false),
('automotivo-transporte-de-cargas', 'Automotivo', 'Transporte de Cargas', 69, array['transporte de carga','frete']::text[], false),
('automotivo-transporte-de-passageiros-e-ou-escolar', 'Automotivo', 'Transporte de Passageiros e/ou Escolar', 70, array['transporte de passageiro','transporte escolar','transporte de alunos','fretamento']::text[], false),
('automotivo-transportes-escolar', 'Automotivo', 'Transportes Escolar', 71, array['transporte escolar','transporte de estudantes','transporte de alunos']::text[], false),
('automotivo-veiculo-tipo-gaiola-boiadeira', 'Automotivo', 'Veículo tipo Gaiola Boiadeira', 72, array['gaiola boiadeira','boiadeir']::text[], false),
('informatica-cartuchos-e-tonner', 'Informática', 'Cartuchos e Tonner', 73, array['cartucho','toner','tonner']::text[], false),
('informatica-certificacao-digital', 'Informática', 'Certificação digital', 74, array['certificado digital','certificados digitais','certificacao digital']::text[], false),
('informatica-equipamentos-servicos-de-internet', 'Informática', 'Equipamentos / Serviços de Internet', 75, array['internet','link de dados','provedor','fibra optica']::text[], false),
('informatica-equipamentos-servicos-de-telecomunicacao', 'Informática', 'Equipamentos / Serviços de Telecomunicação / Telefonia', 76, array['telefon','telecomunica','celular','pabx']::text[], false),
('informatica-equipamentos-e-material-de-processamento', 'Informática', 'Equipamentos e material de processamento de dados', 77, array['processamento de dados','informatica','computador','notebook','impressora']::text[], false),
('informatica-equipamentos-energeticos-dispositivos-qu', 'Informática', 'Equipamentos energéticos - dispositivos que geram, armazenam, controlam ou consomem energia elétrica', 78, array['nobreak','no break','estabilizador','bateria','painel solar','paineis solares','energia solar','fotovoltaic','grupo gerador']::text[], false),
('informatica-fornecimento-de-hardwares-e-perifericos', 'Informática', 'Fornecimento de Hardwares e Periféricos', 79, array['hardware','periferico','computador','notebook','monitor','teclado','mouse']::text[], false),
('informatica-fornecimento-de-softwares-licenca-de-sof', 'Informática', 'Fornecimento de Softwares / Licença de Softwares / Locação de Aplicativos', 80, array['software','licenca de uso','licencas de uso','licenciamento de uso','sistema de gestao','sistemas de gestao','sistema informatizado','sistemas informatizados','aplicativo']::text[], false),
('informatica-gestao-eletronica-de-documentos-servicos', 'Informática', 'Gestão eletrônica de documentos (Serviços de Gestão)', 81, array['gestao eletronica de documentos','digitalizacao de documentos','digitalizacao do acervo']::text[], false),
('informatica-gps-e-equipamentos-e-material-para-audio', 'Informática', 'GPS e equipamentos e material para áudio, vídeo e foto', 82, array['gps','camera fotografica','cameras fotograficas','filmadora','equipamentos de audio','equipamento de som','caixa de som','caixas de som','microfone','projetor','data show']::text[], false),
('informatica-manutencao-de-equipamentos', 'Informática', 'Manutenção de equipamentos', 83, array['manutencao de equipamento','assistencia tecnica','manutencao de computador','manutencao de impressora']::text[], false),
('informatica-outsourcing-locacao-de-equipamentos-para', 'Informática', 'OUTSOURCING - Locação de equipamentos, para a reprodução ou digitalização de documentos', 84, array['outsourcing','locacao de impressora','locacao de multifuncionais','locacao de copiadora','reprografia','impressao corporativa']::text[], false),
('informatica-ponto-eletronico-bobinas-termicas', 'Informática', 'Ponto eletrônico / Bobinas Térmicas', 85, array['ponto eletronico','relogio de ponto','relogios de ponto','bobina']::text[], false),
('leilao-bens-imoveis', 'Leilão', 'Bens Imóveis', 86, array['leilao de imove']::text[], false),
('leilao-bens-moveis', 'Leilão', 'Bens Móveis', 87, array['leilao','leiloes']::text[], false),
('leilao-concessao-de-uso', 'Leilão', 'Concessão de Uso', 88, array['concessao de uso','permissao de uso','cessao de uso']::text[], false),
('nautico-embarcacao-motorizacao-acessorios', 'Náutico', 'Embarcação Motorização / Acessórios', 89, array['embarcacao','embarcacoes','barco','motor de popa','lancha']::text[], false),
('nautico-frete-de-embarcacao', 'Náutico', 'Frete de embarcação', 90, array['frete de embarcacao','fretamento de embarcacao']::text[], false),
('nautico-transporte-de-cargas', 'Náutico', 'Transporte de cargas.', 91, array['transporte fluvial','transporte hidroviario']::text[], false),
('obras-e-infr-aquisicao-de-maquinas-e-equipamentos-par', 'Obras e Infraestrutura', 'Aquisição de Máquinas e equipamentos para Construção', 92, array['betoneira','maquinas para construcao','equipamentos para construcao','compactador','vibrador de concreto']::text[], false),
('obras-e-infr-aquisicao-de-maquinas-pesadas', 'Obras e Infraestrutura', 'Aquisição de máquinas pesadas', 93, array['maquinas pesadas','retroescavadeira','escavadeira','motoniveladora','pa carregadeira','rolo compactador','trator de esteira']::text[], false),
('obras-e-infr-aquisicao-de-tintas-para-sinalizacao-via', 'Obras e Infraestrutura', 'Aquisição de tintas para sinalização viária', 94, array['sinalizacao viaria','demarcacao viaria','sinalizacao horizontal','tinta para demarcacao']::text[], false),
('obras-e-infr-atividades-geotecnicas', 'Obras e Infraestrutura', 'Atividades Geotécnicas', 95, array['geotecni','sondagem','topografi']::text[], false),
('obras-e-infr-construcao-de-estruturas-pontes-tuneis-v', 'Obras e Infraestrutura', 'Construção de Estruturas (Pontes /Túneis / Viadutos / Marítimos)', 96, array['ponte','viaduto','tunel','passarela']::text[], false),
('obras-e-infr-construcao-de-habitacoes-armazens-estrut', 'Obras e Infraestrutura', 'Construção de Habitações / Armazéns / Estruturas Metálicas', 97, array['unidades habitacionais','habitacao','habitacoes','galpao','armazem','estrutura metalica','estruturas metalicas']::text[], false),
('obras-e-infr-demolicao-e-desmonte-de-estruturas', 'Obras e Infraestrutura', 'Demolição e Desmonte de Estruturas', 98, array['demolicao','desmonte']::text[], false),
('obras-e-infr-equipamentos-geracao-transmissao-de-ener', 'Obras e Infraestrutura', 'Equipamentos / Geração / Transmissão de Energia', 99, array['transformador','subestacao','geracao de energia','rede eletrica','transmissao de energia']::text[], false),
('obras-e-infr-instalacao-manutencao-elevadores', 'Obras e Infraestrutura', 'Instalação / Manutenção Elevadores', 100, array['elevador','plataforma elevatoria']::text[], false),
('obras-e-infr-locacao-de-maquinas-e-equipamentos-para', 'Obras e Infraestrutura', 'Locação de Máquinas e equipamentos para Construção', 101, array['locacao de maquinas','locacao de equipamentos para construcao','andaime']::text[], false),
('obras-e-infr-massa-asfaltica-cbuq-concreto-usinado', 'Obras e Infraestrutura', 'Massa Asfáltica / CBUQ / Concreto usinado', 102, array['asfalt','cbuq','concreto usinado','pavimentacao','recapeamento','tapa buraco']::text[], false),
('obras-e-infr-materiais-para-construcao-materiais-elet', 'Obras e Infraestrutura', 'Materiais para construção / Materiais Elétricos', 103, array['material de construcao','materiais de construcao','material eletrico','materiais eletricos','cimento','areia','brita','tijolo','ferragens']::text[], false),
('obras-e-infr-materiais-pre-moldados', 'Obras e Infraestrutura', 'Materiais pré-moldados', 104, array['pre moldado','premoldado','bloquete','meio fio','manilha','tubo de concreto','tubos de concreto']::text[], false),
('obras-e-infr-pocos-artesianos-aquisicao-de-materiais', 'Obras e Infraestrutura', 'Poços Artesianos / Aquisição de materiais / Manutenção e Peças', 105, array['poco artesiano','pocos artesianos','perfuracao de poco','poco tubular','pocos tubulares','bomba submersa','bombas submersas']::text[], false),
('obras-e-infr-projetos-arquitetura-engenharia-civil-el', 'Obras e Infraestrutura', 'Projetos Arquitetura / Engenharia Civil / Elétrica', 106, array['projeto arquitetonico','projetos arquitetonicos','projeto executivo','projetos executivos','projeto de engenharia','projetos de engenharia','elaboracao de projeto']::text[], false),
('obras-e-infr-servicos-de-obras-construcao', 'Obras e Infraestrutura', 'Serviços de obras / construção', 107, array['obra','construcao','reforma','ampliacao','engenharia']::text[], false),
('obras-e-infr-servicos-e-aquisicao-de-tratamento-de-ag', 'Obras e Infraestrutura', 'Serviços e Aquisição de Tratamento de água', 108, array['tratamento de agua','estacao de tratamento','hipoclorito','sulfato de aluminio','analise de agua','cloro']::text[], false),
('obras-e-infr-servicos-eletricos', 'Obras e Infraestrutura', 'Serviços elétricos', 109, array['servicos eletricos','instalacao eletrica','instalacoes eletricas','iluminacao publica','manutencao eletrica']::text[], false),
('publicidade-eventos-producoes-audiovisuais-estrutura', 'Publicidade', 'Eventos / Produções Audiovisuais / Estrutura de Palco', 110, array['evento','palco','producao audiovisual','producoes audiovisuais']::text[], false),
('publicidade-jornais-revistas', 'Publicidade', 'Jornais / Revistas', 111, array['jornal','jornais','revista']::text[], false),
('publicidade-livros-livraria', 'Publicidade', 'Livros / Livraria', 112, array['livro','livraria','acervo bibliografico','literatur']::text[], false),
('publicidade-pesquisa', 'Publicidade', 'Pesquisa', 113, array['pesquisa de opiniao','pesquisa de satisfacao','pesquisa de mercado','pesquisas de opiniao']::text[], false),
('publicidade-publicidade-propaganda-comunicacao-marke', 'Publicidade', 'Publicidade / Propaganda / Comunicação / Marketing', 114, array['publicidade','propaganda','comunicacao institucional','marketing']::text[], false),
('publicidade-servicos-de-grafica-impressao', 'Publicidade', 'Serviços de Gráfica / Impressão', 115, array['grafic','impressos','banner','panfleto','servicos de impressao']::text[], false),
('publicidade-servicos-de-sonorizacao-trio-eletrico-e', 'Publicidade', 'Serviços de Sonorização, Trio Elétrico e Publicidade Volante', 116, array['sonorizacao','trio eletrico','carro de som','publicidade volante']::text[], false),
('saude-castracao-de-animal-castramovel-servicos', 'Saúde', 'Castração de Animal / Castramóvel / Serviços de PetShop', 117, array['castracao','castramove','pet shop','petshop','zoonose']::text[], false),
('saude-cirurgias-eletivas', 'Saúde', 'Cirurgias Eletivas', 118, array['cirurgia']::text[], false),
('saude-convenio-medico-ou-servicos-medicos', 'Saúde', 'Convênio médico ou serviços médicos', 119, array['servicos medicos','plantao medico','plantoes medicos','consultas medicas','convenio medico','plano de saude','medico plantonista','medicos plantonistas']::text[], false),
('saude-convenios-odontologicos', 'Saúde', 'Convênios Odontológicos.', 120, array['convenio odontologico','plano odontologico','servicos odontologicos']::text[], false),
('saude-equipamentos-hospitalares', 'Saúde', 'Equipamentos Hospitalares', 121, array['equipamento hospitalar','equipamentos hospitalares','cama hospitalar','camas hospitalares','maca','macas','cadeira de rodas','cadeiras de rodas','autoclave','mobiliario hospitalar']::text[], true),
('saude-equipamentos-medicos', 'Saúde', 'Equipamentos Médicos', 122, array['equipamento medico','equipamentos medicos','monitor multiparametrico','desfibrilador','eletrocardiograf','oximetro','esfigmomanometro','estetoscopio','aparelho de pressao']::text[], true),
('saude-exames-equipamentos-laboratoriais', 'Saúde', 'Exames / Equipamentos Laboratoriais', 123, array['exames laboratoriais','exame laboratorial','analises clinicas','material de laboratorio','materiais de laboratorio','reagente','exames de imagem','ultrassonografia','raio x']::text[], true),
('saude-fabricacao-materiais-para-oculos-lentes', 'Saúde', 'Fabricação / Materiais para Óculos / Lentes', 124, array['oculos','lentes','oftalmolog']::text[], false),
('saude-gases-medicinais', 'Saúde', 'Gases Medicinais', 125, array['gases medicinais','gas medicinal','oxigenio']::text[], false),
('saude-insumos-materiais-e-suprimentos-hospital', 'Saúde', 'Insumos, Materiais e Suprimentos Hospitalares', 126, array['material hospitalar','materiais hospitalares','insumos hospitalares','material medico','materiais medicos','medico hospitalar','medicos hospitalares','uso hospitalar','consumo hospitalar','hospitalares','curativo','seringa','agulha','luvas de procedimento','material de enfermagem','materiais de enfermagem','esteriliza','produtos para saude','insumos de saude','insumos medicos','gaze','atadura','sonda','cateter','equipo']::text[], true),
('saude-materiais-suprimentos-equipamentos-odont', 'Saúde', 'Materiais / Suprimentos / Equipamentos Odontológicos', 127, array['odontolog','dentari','dentista']::text[], true),
('saude-materiais-permanentes-fisioterapia-educa', 'Saúde', 'Materiais Permanentes - Fisioterapia, Educação Física, Pilates, Musculação.', 128, array['fisioterap','pilates','musculacao','academia ao ar livre','equipamentos de ginastica']::text[], true),
('saude-medicacao-drogas-animais', 'Saúde', 'Medicação/Drogas Animais', 129, array['medicamentos veterinarios','medicamento veterinario','uso veterinario','vacina antirrabica','vermifugo']::text[], false),
('saude-medicamentos', 'Saúde', 'Medicamentos', 130, array['medicament','farmac','fitoterap','soro','psicotropic','componente basico']::text[], true),
('saude-procedimentos-hospitalares', 'Saúde', 'Procedimentos Hospitalares', 131, array['procedimentos hospitalares','procedimentos cirurgicos','servicos hospitalares','internacao','internacoes']::text[], false),
('saude-proteses-em-geral', 'Saúde', 'Próteses em Geral', 132, array['protese','ortese','ortopedic']::text[], true),
('saude-seguros-de-vida', 'Saúde', 'Seguros de Vida', 133, array['seguro de vida','seguros de vida','acidentes pessoais']::text[], false),
('saude-suprimentos-aparelhos-auditivos', 'Saúde', 'Suprimentos / Aparelhos Auditivos', 134, array['aparelho auditivo','aparelhos auditivos','aasi']::text[], false),
('seguranca-alarmes-videos-cercas-eletricas-sensores', 'Segurança', 'Alarmes / Vídeos / Cercas elétricas / Sensores / Blindagens', 135, array['alarme','videomonitoramento','monitoramento eletronico','cameras de seguranca','cftv','cerca eletrica','cercas eletricas','blindage']::text[], false),
('seguranca-armas-e-municoes', 'Segurança', 'Armas e Munições', 136, array['armamento','arma de fogo','armas de fogo','municao','municoes','pistola']::text[], false),
('seguranca-equipamentos-materiais-e-acessorios-de-s', 'Segurança', 'Equipamentos / materiais e Acessórios de Segurança', 137, array['epi','epis','equipamentos de protecao','equipamento de protecao','materiais de seguranca','colete']::text[], false),
('seguranca-pcmso-pgr-ltcat-ltip-lip-engenharia-de-s', 'Segurança', 'PCMSO, PGR, LTCAT, LTIP, LIP, Engenharia de Segurança do trabalho, SESMT, Higiene Ocupacional, Medicina do trabalho', 138, array['pcmso','pgr','ltcat','ppra','seguranca do trabalho','sesmt','medicina do trabalho','saude ocupacional']::text[], false),
('seguranca-prevencao-combate-a-incendio', 'Segurança', 'Prevenção / Combate a incêndio', 139, array['incendio','extintor','avcb','brigada']::text[], false),
('seguranca-servicos-de-vigilancia-patrimonial-servi', 'Segurança', 'Serviços de Vigilância / Patrimonial / Serviços de Portaria', 140, array['vigilancia patrimonial','vigilancia armada','vigilancia desarmada','seguranca patrimonial','portaria','vigia']::text[], false),
('servicos-de--cestas-basicas-cestas-de-natal', 'Serviços de Alimentação', 'Cestas Básicas / Cestas de Natal', 141, array['cesta basica','cestas basicas','cesta de natal','cestas de natal']::text[], false),
('servicos-de--fornecimento-de-marmitas', 'Serviços de Alimentação', 'Fornecimento de Marmitas', 142, array['marmita','refeicoes prontas','refeicao pronta','quentinha','fornecimento de refeic']::text[], false),
('servicos-de--fornecimento-de-merenda', 'Serviços de Alimentação', 'Fornecimento de Merenda', 143, array['merenda','alimentacao escolar']::text[], false),
('servicos-de--mao-de-obra-copa-cozinha-garcon', 'Serviços de Alimentação', 'Mão de obra copa, cozinha, garçon', 144, array['copeira','copeiro','cozinheir','garcom','garcons','merendeira','servicos de copa']::text[], false),
('servicos-de--servicos-de-buffet-lanches', 'Serviços de Alimentação', 'Serviços de Buffet / Lanches', 145, array['buffet','lanche','coffee break','salgado']::text[], false),
('servicos-de--utensilios-de-cozinha', 'Serviços de Alimentação', 'Utensílios de Cozinha', 146, array['utensilios de cozinha','utensilios domesticos','panela']::text[], false),
('servicos-de--vale-alimentacao-refeicao', 'Serviços de Alimentação', 'Vale alimentação / Refeição', 147, array['vale alimentacao','vale refeicao','cartao alimentacao','auxilio alimentacao']::text[], false),
('servicos-ger-abate-de-animais', 'Serviços Gerais', 'Abate de Animais', 148, array['abate']::text[], false),
('servicos-ger-avaliacao-de-imoveis', 'Serviços Gerais', 'Avaliação de Imóveis', 149, array['avaliacao de imove','avaliacao imobiliaria']::text[], false),
('servicos-ger-chaveiro', 'Serviços Gerais', 'Chaveiro', 150, array['chaveiro','copia de chave','copias de chave']::text[], false),
('servicos-ger-concessoes-exploracao-imovel', 'Serviços Gerais', 'Concessões / Exploração / Imóvel', 151, array['concessao','exploracao de','cessao de espaco','locacao de imove']::text[], false),
('servicos-ger-concursos-publicos-processos-seletivos', 'Serviços Gerais', 'Concursos Públicos / Processos Seletivos', 152, array['concurso publico','concursos publicos','processo seletivo','processos seletivos']::text[], false),
('servicos-ger-contratacao-de-servicos-terceirizados', 'Serviços Gerais', 'Contratação de Serviços Terceirizados', 153, array['terceirizad','mao de obra','cessao de mao de obra']::text[], false),
('servicos-ger-dedetizacao-descupinizacao-e-assemelhado', 'Serviços Gerais', 'Dedetização / Descupinização e assemelhados', 154, array['dedetiza','descupiniza','controle de pragas','sanitizacao']::text[], false),
('servicos-ger-desinfeccao-desinsetizacao-desratizacao', 'Serviços Gerais', 'Desinfecção / Desinsetização / Desratização', 155, array['desinfeccao','desinsetiza','desratiza']::text[], false),
('servicos-ger-fabricacao-e-instalacao-de-coifas-em-ino', 'Serviços Gerais', 'Fabricação e instalação de coifas em inox', 156, array['coifa','inox']::text[], false),
('servicos-ger-filmagem-transmissao-de-evento-corporati', 'Serviços Gerais', 'Filmagem, transmissão de evento corporativo, shows', 157, array['filmagem','transmissao ao vivo','transmissao de evento','cobertura fotografica']::text[], false),
('servicos-ger-fiscalizacao-de-obras', 'Serviços Gerais', 'Fiscalização de Obras', 158, array['fiscalizacao de obra','fiscalizacao das obras']::text[], false),
('servicos-ger-gerenciamento-de-obras', 'Serviços Gerais', 'Gerenciamento de Obras', 159, array['gerenciamento de obra','gerenciamento das obras','supervisao de obra']::text[], false),
('servicos-ger-instalacao-manutencao-de-ar-condicionado', 'Serviços Gerais', 'Instalação / Manutenção de Ar condicionado', 160, array['ar condicionado','ares condicionados','climatizacao','climatizador']::text[], false),
('servicos-ger-leiloes', 'Serviços Gerais', 'Leilões', 161, array['leiloeiro','leilao']::text[], false),
('servicos-ger-limpeza-publica-coleta-de-lixo', 'Serviços Gerais', 'Limpeza publica / Coleta de Lixo', 162, array['coleta de lixo','limpeza urbana','limpeza publica','residuos solidos','varricao','capina']::text[], false),
('servicos-ger-locacao-de-tendas-estruturas', 'Serviços Gerais', 'Locação de tendas/estruturas', 163, array['tenda','locacao de estrutura','estruturas para eventos','banheiro quimico','banheiros quimicos']::text[], false),
('servicos-ger-manutencao-de-equipamentos-odontologicos', 'Serviços Gerais', 'Manutenção de Equipamentos Odontológicos/Hospitalares', 164, array['manutencao de equipamentos odontologicos','manutencao de equipamentos hospitalares','manutencao de equipamentos medicos','manutencao preventiva e corretiva de equipamentos medico','engenharia clinica']::text[], false),
('servicos-ger-manutencao-preventiva-e-corretiva-para-c', 'Serviços Gerais', 'Manutenção preventiva e corretiva para câmaras frias', 165, array['camara fria','camaras frias']::text[], false),
('servicos-ger-medicao-de-gas-agua-energia', 'Serviços Gerais', 'Medição de gás / água / energia', 166, array['hidrometro','medicao de consumo','leitura de medidores']::text[], false),
('servicos-ger-moveis-planejados-em-mdf', 'Serviços Gerais', 'Móveis planejados em MDF', 167, array['planejados','mdf','marcenaria']::text[], false),
('servicos-ger-paisagismo-gramas-flores', 'Serviços Gerais', 'Paisagismo / Gramas / Flores', 168, array['paisagismo','grama','flores','jardinagem','plantas ornamentais','rocada']::text[], false),
('servicos-ger-quimicos-bioquimicos', 'Serviços Gerais', 'Químicos / Bioquímicos', 169, array['produtos quimicos','quimicos','bioquimic']::text[], false),
('servicos-ger-robotica', 'Serviços Gerais', 'Robótica', 170, array['robotica']::text[], false),
('servicos-ger-saneamento-basico-destinacao-de-residuos', 'Serviços Gerais', 'Saneamento Básico / Destinação de Resíduos / Aterro Sanitário', 171, array['saneamento','destinacao de residuos','destinacao final','aterro sanitario','esgoto','residuos de saude','residuos hospitalares','residuos de servicos de saude']::text[], false),
('servicos-ger-servico-de-seguros', 'Serviços Gerais', 'Serviço de Seguros', 172, array['seguro','seguros']::text[], false),
('servicos-ger-servicos-materiais-funerarios-e-translad', 'Serviços Gerais', 'Serviços / Materiais Funerários e Translado', 173, array['funerari','urna funeraria','urnas funerarias','translado','sepultamento']::text[], false),
('servicos-ger-servicos-de-apresentacoes-artisticas-ati', 'Serviços Gerais', 'Serviços de Apresentações Artísticas, Atividades Culturais Educativas e Pedagógicas', 174, array['apresentacao artistica','apresentacoes artisticas','atividades culturais','contratacao de artista','show','oficinas culturais']::text[], false),
('servicos-ger-servicos-de-arqueologia-geologia-escavac', 'Serviços Gerais', 'Serviços de Arqueologia / Geologia / Escavação', 175, array['arqueolog','geologi','escavacao']::text[], false),
('servicos-ger-servicos-de-esporte-e-lazer', 'Serviços Gerais', 'Serviços de Esporte e Lazer', 176, array['esporte','lazer','recreacao','colonia de ferias']::text[], false),
('servicos-ger-servicos-de-instalacao-manutencao-e-adeq', 'Serviços Gerais', 'Serviços de Instalação, Manutenção e Adequação de Superfícies Envidraçadas e Esquadrias', 177, array['esquadria','envidracad','box de vidro','janela']::text[], false),
('servicos-ger-servicos-de-manutencao-usinagem-solda-e', 'Serviços Gerais', 'Serviços de Manutenção, Usinagem, Solda e Recuperação de Equipamentos e Estruturas Metálicas', 178, array['usinagem','solda','caldeiraria','recuperacao de estruturas metalicas']::text[], false),
('servicos-ger-servicos-metalurgicos-e-de-manutencao-me', 'Serviços Gerais', 'Serviços Metalúrgicos e de Manutenção Mecânica', 179, array['metalurgic','manutencao mecanica','serralheria']::text[], false),
('servicos-ger-servicos-musicais-instrumentos-bandas', 'Serviços Gerais', 'Serviços Musicais / Instrumentos / Bandas', 180, array['banda de musica','bandas de musica','banda musical','apresentacao musical','apresentacoes musicais','show musical','shows musicais']::text[], false),
('servicos-ger-servicos-tecnicos-de-patrimonio-publico', 'Serviços Gerais', 'Serviços Técnicos de Patrimônio Público', 181, array['patrimonio publico','inventario patrimonial','plaquetas patrimoniais','tombamento']::text[], false),
('servicos-ger-show-pirotecnico', 'Serviços Gerais', 'Show Pirotécnico', 182, array['show pirotecnico','queima de fogos','pirotecni']::text[], false),
('servicos-ger-sinalizacao-comunicacao-visual-placas', 'Serviços Gerais', 'Sinalização / Comunicação Visual / Placas', 183, array['sinalizacao','comunicacao visual','placas','letreiro','adesivo']::text[], false),
('servicos-ger-traducao-interpretacao-de-libras', 'Serviços Gerais', 'Tradução / interpretação de Libras', 184, array['libras','interprete','traducao']::text[], false),
('turismo-emissao-cancelamento-de-passagem', 'Turismo', 'Emissão / Cancelamento de Passagem', 185, array['passagem aerea','passagens aereas','passagem rodoviaria','passagens rodoviarias','emissao de passagens','agenciamento de viagens','agenciamento de passagens']::text[], false),
('turismo-hospedagem-hotelaria', 'Turismo', 'Hospedagem / Hotelaria', 186, array['hospedagem','hotel','hoteis','hotelaria']::text[], false),
('turismo-translado-e-guia-de-turismo', 'Turismo', 'Translado e Guia de Turismo', 187, array['translado','guia de turismo','turismo']::text[], false)
on conflict (id) do update set grupo = excluded.grupo, nome = excluded.nome, ordem = excluded.ordem, termos = excluded.termos;

-- As palavras de "incluir" agora estão dentro das categorias marcadas
delete from palavras where tipo = 'incluir';
select reclassificar_editais();
