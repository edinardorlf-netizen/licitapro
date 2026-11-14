-- =====================================================================
-- LicitaPro · banco de dados
-- Equipe, radar de editais (PNCP), processos acompanhados, itens,
-- movimentações e configurações. Cada pessoa só acessa se o e-mail
-- estiver liberado na tabela "equipe".
-- =====================================================================

-- ---------- Equipe e papéis ----------
create table if not exists public.equipe (
  email text primary key check (email = lower(email)),
  nome text not null default '',
  papel text not null default 'equipe' check (papel in ('admin', 'equipe', 'acompanha')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.meu_papel()
returns text language sql stable security definer set search_path = public as $$
  select papel from equipe where email = lower(coalesce(auth.jwt()->>'email', '')) and ativo;
$$;
create or replace function public.is_equipe()
returns boolean language sql stable as $$ select public.meu_papel() is not null; $$;
create or replace function public.pode_editar()
returns boolean language sql stable as $$ select coalesce(public.meu_papel() in ('admin', 'equipe'), false); $$;
create or replace function public.is_admin()
returns boolean language sql stable as $$ select coalesce(public.meu_papel() = 'admin', false); $$;

-- ---------- Configuração (uma linha) ----------
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  empresa_nome text not null default '',
  empresa_cnpj text not null default '',
  uf text not null default 'MG',
  modalidades int[] not null default '{6,8}',
  telegram_chat_id text,
  telegram_ativo boolean not null default false,
  atualizado_em timestamptz not null default now()
);
insert into public.config (id) values (1) on conflict do nothing;

-- Segredos (chave dos robôs, token do Telegram): ninguém lê pelo app.
create table if not exists public.segredos (
  chave text primary key,
  valor text not null
);

-- ---------- Palavras-chave do radar ----------
create table if not exists public.palavras (
  id uuid primary key default gen_random_uuid(),
  termo text not null check (char_length(termo) between 2 and 60),
  tipo text not null default 'incluir' check (tipo in ('incluir', 'excluir')),
  created_at timestamptz not null default now(),
  unique (termo, tipo)
);

-- ---------- Radar: editais encontrados no PNCP ----------
create table if not exists public.editais (
  id uuid primary key default gen_random_uuid(),
  controle_pncp text not null unique,
  cnpj text not null,
  ano int not null,
  seq int not null,
  orgao text,
  unidade text,
  municipio text,
  uf text,
  modalidade_id int,
  modalidade text,
  numero text,
  processo_num text,
  objeto text,
  valor_estimado numeric(16,2),
  srp boolean,
  abertura_propostas timestamptz,
  encerramento_propostas timestamptz,
  publicado_em timestamptz,
  atualizado_pncp text,
  link_origem text,
  sistema text,
  portal text,
  situacao text,
  termos text[] not null default '{}',
  relevante boolean not null default false,
  status text not null default 'novo' check (status in ('novo', 'descartado', 'acompanhando')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists editais_radar_idx on public.editais (relevante, status, encerramento_propostas);
create index if not exists editais_pub_idx on public.editais (publicado_em desc);
create index if not exists editais_link_idx on public.editais (link_origem);

-- ---------- Processos acompanhados ----------
create table if not exists public.processos (
  id uuid primary key default gen_random_uuid(),
  edital_id uuid references public.editais(id) on delete set null,
  controle_pncp text unique,
  cnpj text,
  ano int,
  seq int,
  pcp_codigo int unique,
  pcp_path text,
  portal text not null default 'outro',
  link_origem text,
  orgao text,
  municipio text,
  numero text,
  objeto text,
  modalidade text,
  valor_estimado numeric(16,2),
  valor_homologado numeric(16,2),
  data_sessao timestamptz,
  prazo_impugnacao timestamptz,
  prazo_esclarecimento timestamptz,
  situacao_pncp text,
  situacao_portal text,
  etapa text not null default 'analise' check (etapa in ('analise', 'participar', 'proposta', 'disputa', 'habilitacao', 'ganhamos', 'perdemos', 'desistimos')),
  responsavel text references public.equipe(email) on delete set null on update cascade,
  pncp_atualizacao text,
  pcp_chat_ult text,
  lembrete_24h boolean not null default false,
  lembrete_1h boolean not null default false,
  lembrete_prazo boolean not null default false,
  ativo boolean not null default true,
  ultima_verificacao timestamptz,
  proxima_verificacao timestamptz not null default now(),
  erro text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists processos_fila_idx on public.processos (ativo, proxima_verificacao);
create index if not exists processos_sessao_idx on public.processos (data_sessao);

-- ---------- Itens de cada processo ----------
create table if not exists public.itens (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  numero int not null,
  descricao text,
  quantidade numeric(16,4),
  unidade text,
  valor_ref numeric(16,4),
  situacao text,
  situacao_portal text,
  melhor_lance numeric(16,4),
  tem_resultado boolean not null default false,
  resultado_fornecedor text,
  resultado_valor numeric(16,4),
  participar boolean not null default false,
  custo numeric(16,4),
  frete numeric(16,4),
  impostos_pct numeric(6,2),
  margem_pct numeric(6,2),
  valor_minimo numeric(16,4),
  marca text,
  atualizado_em timestamptz not null default now(),
  unique (processo_id, numero)
);

-- ---------- Movimentações (linha do tempo) ----------
create table if not exists public.movimentacoes (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  fonte text not null check (fonte in ('pncp', 'portal', 'equipe', 'lembrete', 'sistema')),
  tipo text not null default 'info',
  titulo text not null,
  detalhe text,
  link text,
  autor text,
  ocorrido_em timestamptz not null default now(),
  importante boolean not null default false,
  historico boolean not null default false,
  chave text,
  created_at timestamptz not null default now(),
  unique (processo_id, chave)
);
create index if not exists mov_proc_idx on public.movimentacoes (processo_id, ocorrido_em desc);
create index if not exists mov_imp_idx on public.movimentacoes (importante, created_at desc);

-- Até quando cada pessoa já viu as movimentações de cada processo
create table if not exists public.vistos (
  email text not null,
  processo_id uuid not null references public.processos(id) on delete cascade,
  visto_em timestamptz not null default now(),
  primary key (email, processo_id)
);

-- ---------- Segurança por linha ----------
alter table public.equipe enable row level security;
alter table public.config enable row level security;
alter table public.segredos enable row level security;
alter table public.palavras enable row level security;
alter table public.editais enable row level security;
alter table public.processos enable row level security;
alter table public.itens enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.vistos enable row level security;

revoke all on public.segredos from anon, authenticated;

drop policy if exists "ver equipe" on public.equipe;
create policy "ver equipe" on public.equipe for select to authenticated using (public.is_equipe());
drop policy if exists "admin gerencia equipe" on public.equipe;
create policy "admin gerencia equipe" on public.equipe for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ver config" on public.config;
create policy "ver config" on public.config for select to authenticated using (public.is_equipe());
drop policy if exists "admin edita config" on public.config;
create policy "admin edita config" on public.config for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ver palavras" on public.palavras;
create policy "ver palavras" on public.palavras for select to authenticated using (public.is_equipe());
drop policy if exists "editar palavras" on public.palavras;
create policy "editar palavras" on public.palavras for all to authenticated using (public.pode_editar()) with check (public.pode_editar());

drop policy if exists "ver editais" on public.editais;
create policy "ver editais" on public.editais for select to authenticated using (public.is_equipe());
drop policy if exists "marcar editais" on public.editais;
create policy "marcar editais" on public.editais for update to authenticated using (public.pode_editar()) with check (public.pode_editar());

drop policy if exists "ver processos" on public.processos;
create policy "ver processos" on public.processos for select to authenticated using (public.is_equipe());
drop policy if exists "editar processos" on public.processos;
create policy "editar processos" on public.processos for update to authenticated using (public.pode_editar()) with check (public.pode_editar());
drop policy if exists "apagar processos" on public.processos;
create policy "apagar processos" on public.processos for delete to authenticated using (public.pode_editar());

drop policy if exists "ver itens" on public.itens;
create policy "ver itens" on public.itens for select to authenticated using (public.is_equipe());
drop policy if exists "editar itens" on public.itens;
create policy "editar itens" on public.itens for update to authenticated using (public.pode_editar()) with check (public.pode_editar());

drop policy if exists "ver movimentacoes" on public.movimentacoes;
create policy "ver movimentacoes" on public.movimentacoes for select to authenticated using (public.is_equipe());
drop policy if exists "anotar" on public.movimentacoes;
create policy "anotar" on public.movimentacoes for insert to authenticated
  with check (public.is_equipe() and fonte = 'equipe' and autor = lower(auth.jwt()->>'email'));
drop policy if exists "apagar anotacao" on public.movimentacoes;
create policy "apagar anotacao" on public.movimentacoes for delete to authenticated
  using (fonte = 'equipe' and (autor = lower(auth.jwt()->>'email') or public.is_admin()));

drop policy if exists "meus vistos" on public.vistos;
create policy "meus vistos" on public.vistos for all to authenticated
  using (email = lower(auth.jwt()->>'email') and public.is_equipe())
  with check (email = lower(auth.jwt()->>'email') and public.is_equipe());

-- ---------- Funções chamadas pelo app ----------

-- Configura o aviso pelo Telegram (só administrador). O token nunca volta para o app.
create or replace function public.definir_telegram(p_token text, p_chat text, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas o administrador pode configurar os avisos'; end if;
  if p_token is not null and length(trim(p_token)) > 0 then
    insert into segredos (chave, valor) values ('telegram_token', trim(p_token))
    on conflict (chave) do update set valor = excluded.valor;
  end if;
  update config set telegram_chat_id = nullif(trim(coalesce(p_chat, '')), ''), telegram_ativo = coalesce(p_ativo, false), atualizado_em = now() where id = 1;
end $$;

create or replace function public.telegram_configurado()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_equipe() and exists (select 1 from segredos where chave = 'telegram_token');
$$;

-- Contagem de movimentações não vistas por processo, para quem está logado.
create or replace function public.nao_vistas()
returns table (processo_id uuid, qtd bigint, importantes bigint)
language sql stable security definer set search_path = public as $$
  select m.processo_id, count(*), count(*) filter (where m.importante)
  from movimentacoes m
  left join vistos v on v.processo_id = m.processo_id and v.email = lower(auth.jwt()->>'email')
  where public.is_equipe() and not m.historico and m.created_at > coalesce(v.visto_em, '-infinity'::timestamptz)
  group by m.processo_id;
$$;

revoke execute on function public.definir_telegram(text, text, boolean) from public, anon;
revoke execute on function public.telegram_configurado() from public, anon;
revoke execute on function public.nao_vistas() from public, anon;
revoke execute on function public.meu_papel() from public, anon;
grant execute on function public.definir_telegram(text, text, boolean) to authenticated;
grant execute on function public.telegram_configurado() to authenticated;
grant execute on function public.nao_vistas() to authenticated;
grant execute on function public.meu_papel() to authenticated;

-- ---------- Tempo real ----------
do $$
begin
  begin alter publication supabase_realtime add table public.movimentacoes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.processos; exception when others then null; end;
end $$;

-- ---------- Palavras-chave iniciais (produtos da empresa) ----------
insert into public.palavras (termo, tipo) values
  ('medicament', 'incluir'), ('farmac', 'incluir'), ('fitoterap', 'incluir'),
  ('odontolog', 'incluir'), ('dentari', 'incluir'), ('dentista', 'incluir'),
  ('hospitalar', 'incluir'), ('hospitalares', 'incluir'), ('medico hospitalar', 'incluir'),
  ('material medico', 'incluir'), ('materiais medicos', 'incluir'), ('insumos medicos', 'incluir'),
  ('equipamento medico', 'incluir'), ('equipamentos medicos', 'incluir'), ('equipamentos hospitalares', 'incluir'),
  ('material de enfermagem', 'incluir'), ('materiais de enfermagem', 'incluir'), ('curativo', 'incluir'),
  ('seringa', 'incluir'), ('agulha', 'incluir'), ('luvas de procedimento', 'incluir'),
  ('soro', 'incluir'), ('insumos de saude', 'incluir'), ('produtos para saude', 'incluir'),
  ('material de laboratorio', 'incluir'), ('reagente', 'incluir'), ('esteriliza', 'incluir'),
  ('fisioterap', 'incluir'), ('ortopedic', 'incluir'),
  ('cosmetic', 'incluir'), ('higiene pessoal', 'incluir'), ('produtos de higiene', 'incluir'),
  ('saneante', 'incluir'), ('material de limpeza', 'incluir'), ('materiais de limpeza', 'incluir'),
  ('produtos de limpeza', 'incluir'), ('descartave', 'incluir'),
  ('servicos de limpeza', 'excluir'), ('servico de limpeza', 'excluir'), ('limpeza urbana', 'excluir'),
  ('coleta de lixo', 'excluir'), ('limpeza de fossa', 'excluir'), ('plano de saude', 'excluir'),
  ('servicos medicos', 'excluir'), ('consultas medicas', 'excluir'), ('obra', 'excluir'),
  ('pavimentacao', 'excluir'), ('transporte escolar', 'excluir')
on conflict do nothing;

-- =====================================================================
-- Empresas (uma por CNPJ) e acessos aos portais
-- A senha de cada portal fica no cofre do Supabase (Vault), criptografada.
-- O app só grava; ninguém lê a senha pelo app.
-- =====================================================================
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 120),
  cnpj text not null unique check (cnpj ~ '^\d{14}$'),
  apelidos text not null default '',
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.acessos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  portal text not null check (portal in ('pcp','licitar','comprasgov','bll','licitacoes-e','mg','bnc','licitanet','outro')),
  usuario text not null check (char_length(trim(usuario)) between 1 and 160),
  senha_id uuid,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (empresa_id, portal)
);
alter table public.processos add column if not exists empresa_id uuid references public.empresas(id) on delete set null;
alter table public.processos add column if not exists pncp_checado_em timestamptz;
create index if not exists processos_empresa_idx on public.processos (empresa_id);

-- ---------- Cotação por item e valor mínimo manual (migração itens_cotacao_piso_manual, 11/11/2026) ----------
-- O valor mínimo (valor_minimo = piso do robô) passa a ser digitado à mão; custo/frete/impostos/margem
-- ficam só como histórico. A planilha de cotação enviada preenche preço, marca, Anvisa e uma sugestão de piso.
alter table public.itens add column if not exists participacao text;
alter table public.itens add column if not exists preco_unit numeric(16,4);
alter table public.itens add column if not exists preco_total numeric(16,4);
alter table public.itens add column if not exists anvisa text;
alter table public.itens add column if not exists obs_exigencia text;
alter table public.itens add column if not exists obs text;
alter table public.itens add column if not exists piso_sugerido numeric(16,4);
alter table public.itens add column if not exists cotacao_em timestamptz;
alter table public.itens add column if not exists piso_por text;
alter table public.itens add column if not exists piso_em timestamptz;

alter table public.empresas enable row level security;
alter table public.acessos enable row level security;
drop policy if exists "ver empresas" on public.empresas;
create policy "ver empresas" on public.empresas for select to authenticated using (public.is_equipe());
drop policy if exists "admin gerencia empresas" on public.empresas;
create policy "admin gerencia empresas" on public.empresas for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.acessos from anon, authenticated;
grant select (id, empresa_id, portal, usuario, observacao, atualizado_em, atualizado_por) on public.acessos to authenticated;
drop policy if exists "ver acessos" on public.acessos;
create policy "ver acessos" on public.acessos for select to authenticated using (public.pode_editar());

create or replace function public.acessos_status()
returns table (id uuid, empresa_id uuid, portal text, usuario text, observacao text, atualizado_em timestamptz, atualizado_por text, tem_senha boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.empresa_id, a.portal, a.usuario, a.observacao, a.atualizado_em, a.atualizado_por, a.senha_id is not null
  from acessos a where public.pode_editar() order by a.portal;
$$;

create or replace function public.salvar_acesso(p_empresa uuid, p_portal text, p_usuario text, p_senha text, p_obs text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  v_id uuid; v_senha uuid; v_email text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.is_admin() then raise exception 'Apenas o administrador pode cadastrar acessos'; end if;
  if not exists (select 1 from empresas where id = p_empresa) then raise exception 'Empresa não encontrada'; end if;
  insert into acessos (empresa_id, portal, usuario, observacao, atualizado_em, atualizado_por)
  values (p_empresa, p_portal, trim(p_usuario), nullif(trim(coalesce(p_obs, '')), ''), now(), v_email)
  on conflict (empresa_id, portal) do update
    set usuario = excluded.usuario, observacao = excluded.observacao, atualizado_em = now(), atualizado_por = v_email
  returning id, senha_id into v_id, v_senha;
  if p_senha is not null and length(p_senha) > 0 then
    if v_senha is null then
      v_senha := vault.create_secret(p_senha, 'licitapro-acesso-' || v_id::text, 'Senha de portal (LicitaPro)');
      update acessos set senha_id = v_senha where id = v_id;
    else
      perform vault.update_secret(v_senha, p_senha);
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.remover_acesso(p_id uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_senha uuid;
begin
  if not public.is_admin() then raise exception 'Apenas o administrador pode remover acessos'; end if;
  select senha_id into v_senha from acessos where id = p_id;
  delete from acessos where id = p_id;
  if v_senha is not null then delete from vault.secrets where id = v_senha; end if;
end $$;

revoke execute on function public.acessos_status() from public, anon;
revoke execute on function public.salvar_acesso(uuid, text, text, text, text) from public, anon;
revoke execute on function public.remover_acesso(uuid) from public, anon;
grant execute on function public.acessos_status() to authenticated;
grant execute on function public.salvar_acesso(uuid, text, text, text, text) to authenticated;
grant execute on function public.remover_acesso(uuid) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.empresas; exception when others then null; end;
end $$;

-- =====================================================================
-- Puxar "Seus Processos" do Portal de Compras Públicas com o login da empresa
-- =====================================================================
alter table public.acessos add column if not exists sinc_em timestamptz;
alter table public.acessos add column if not exists sinc_ok boolean;
alter table public.acessos add column if not exists sinc_msg text;
grant select (sinc_em, sinc_ok, sinc_msg) on public.acessos to authenticated;

-- Senha decifrada: só o robô (service_role) consegue chamar.
create or replace function public.senha_acesso(p_id uuid)
returns text language sql stable security definer set search_path = public, vault as $$
  select ds.decrypted_secret from public.acessos a join vault.decrypted_secrets ds on ds.id = a.senha_id where a.id = p_id;
$$;
revoke execute on function public.senha_acesso(uuid) from public, anon, authenticated;
grant execute on function public.senha_acesso(uuid) to service_role;

drop function if exists public.acessos_status();
create function public.acessos_status()
returns table (id uuid, empresa_id uuid, portal text, usuario text, observacao text, atualizado_em timestamptz, atualizado_por text, tem_senha boolean, sinc_em timestamptz, sinc_ok boolean, sinc_msg text)
language sql stable security definer set search_path = public as $$
  select a.id, a.empresa_id, a.portal, a.usuario, a.observacao, a.atualizado_em, a.atualizado_por, a.senha_id is not null, a.sinc_em, a.sinc_ok, a.sinc_msg
  from acessos a where public.pode_editar() order by a.portal;
$$;
revoke execute on function public.acessos_status() from public, anon;
grant execute on function public.acessos_status() to authenticated;

-- Agendamentos (horário UTC): acompanhar a cada 2 min; radar de hora em hora; puxar processos 6h40 e 19h40 (Brasília).
-- select cron.schedule('licita-acompanhar', '*/2 * * * *', ...);
-- select cron.schedule('licita-radar', '7 * * * *', ...);
-- select cron.schedule('licita-sincronizar', '40 9,22 * * *', ...);

-- =====================================================================
-- Etapas automáticas, arrematante/vencedor por item e "Vamos participar"
-- =====================================================================
alter table public.processos add column if not exists etapa_auto boolean not null default true;
alter table public.processos add column if not exists etapa_motivo text;
alter table public.processos add column if not exists itens_checado_em timestamptz;
alter table public.processos add column if not exists chat_historico_ok boolean not null default false;
alter table public.processos add column if not exists favorito boolean not null default false;
alter table public.processos drop constraint if exists processos_etapa_check;
alter table public.processos add constraint processos_etapa_check
  check (etapa in ('analise','participar','proposta','disputa','habilitacao','ganhamos','perdemos','desistimos','encerrado'));
alter table public.itens add column if not exists arrematante text;
alter table public.itens add column if not exists arrematante_lance numeric(16,4);
alter table public.itens add column if not exists arrematante_em timestamptz;
alter table public.itens add column if not exists vencedor_portal text;
alter table public.itens add column if not exists nosso_arremata boolean not null default false;
alter table public.itens add column if not exists nosso_vence boolean not null default false;
-- O agendamento "licita-sincronizar" chama a função licita-sinc (Acesso Rápido do portal).

-- ===================== 2026-10-28: radar por estado/região/DDD, documentos, notificações =====================
-- (aplicado pela migração radar_regioes_docs_vistos; resumo)
-- municipios(ibge, nome, uf, mesorregiao, microrregiao, regiao_intermediaria, ddd, nome_norm) — IBGE + DDD
-- config.ufs text[]                         — estados lidos pelo radar
-- editais: municipio_ibge, ddd, regiao, documentos, itens, info, detalhe_em (+ trigger editais_local)
-- marcar_visto(uuid[])                      — marca notificações como lidas com o relógio do servidor
-- pedidos_sala(uuid, int) / resumo_acompanhando() — "o que estão pedindo" na sala, por processo
-- regioes_uf(text[])                        — regiões e DDDs dos estados do radar
-- limpar_descartados() + cron 'licita-limpar-descartados' (15 * * * *)
-- cron 'licita-radar' → função licita-radar?tarefa=radar ; 'licita-radar-docs' (27,47) → ?tarefa=documentos

-- ===================== 2026-11-04: etapas Lei 14.133 + pós-vitória, resultado, itens ganhos =====================
-- (migração etapas_lei14133_resultado_itens_ganhos; resumo)
-- processos.etapa: analise, participar, proposta, suspenso, disputa, julgamento, habilitacao, recurso,
--                  homologacao, ata, execucao, concluido   (+ etapa_antes, para voltar da suspensão)
-- processos.resultado: ganhamos, ganhamos_parte, perdemos, desistimos, cancelado (+ resultado_auto, resultado_motivo)
-- itens_ganhos: itens vencidos (base do controle de atas/contratos: qtd, preço, marca, ata, contrato,
--               vigência, empenhado, entregue). Trigger registrar_item_ganho em itens quando nosso_vence.
-- A função "licita" ficou só com acompanhar/cadastrar/verificar (radar → licita-radar; login → licita-sinc).

-- =====================================================================
-- Migração catalogo_markup_reequilibrio_permissoes (11/11/2026)
-- Permissões por usuário (só o dono administra), catálogo de produtos com custos,
-- markup mínimo e validade da proposta para o reequilíbrio.
-- O e-mail do dono NÃO fica aqui (repositório público): é gravado direto no banco,
-- em config.dono, com: update config set dono = '<e-mail do dono>' where id = 1;
-- =====================================================================
alter table public.config add column if not exists dono text;
alter table public.config add column if not exists markup_minimo numeric(6,2) not null default 20;
alter table public.equipe add column if not exists permissoes jsonb not null default '{}'::jsonb;
-- equipe.permissoes: { radar, processos, contratos, catalogo, custos, reequilibrio, robo, editar } (true/false).
-- Administrador (somente o dono) vê e altera tudo; os demais só o que estiver marcado.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipe e, config c
    where c.id = 1 and e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo and e.papel = 'admin'
      and (c.dono is null or e.email = lower(c.dono))
  );
$$;

create or replace function public.tem_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from equipe e
    where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo
      and coalesce((e.permissoes->>p)::boolean, false)
  );
$$;

create or replace function public.pode_editar()
returns boolean language sql stable set search_path = public as $$
  select public.is_admin() or (coalesce(public.meu_papel() = 'equipe', false) and public.tem_perm('editar'));
$$;

create or replace function public.equipe_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text;
begin
  select lower(dono) into d from config where id = 1;
  if new.papel = 'admin' and d is not null and lower(new.email) <> d then
    raise exception 'Somente o dono do sistema pode ser administrador';
  end if;
  if tg_op = 'UPDATE' and d is not null and lower(old.email) = d and (new.papel <> 'admin' or not new.ativo or lower(new.email) <> d) then
    raise exception 'O acesso do dono do sistema não pode ser alterado';
  end if;
  return new;
end $$;
drop trigger if exists equipe_guarda on public.equipe;
create trigger equipe_guarda before insert or update on public.equipe for each row execute function public.equipe_guarda();
revoke execute on function public.tem_perm(text) from public, anon;
grant execute on function public.tem_perm(text) to authenticated;

drop policy if exists "ver editais" on public.editais;
create policy "ver editais" on public.editais for select to authenticated using (public.is_equipe() and public.tem_perm('radar'));
drop policy if exists "ver processos" on public.processos;
create policy "ver processos" on public.processos for select to authenticated
  using (public.is_equipe() and (public.tem_perm('processos') or public.tem_perm('contratos') or public.tem_perm('reequilibrio')));
drop policy if exists "ver itens" on public.itens;
create policy "ver itens" on public.itens for select to authenticated
  using (public.is_equipe() and (public.tem_perm('processos') or public.tem_perm('reequilibrio') or public.tem_perm('catalogo')));
drop policy if exists "ver movimentacoes" on public.movimentacoes;
create policy "ver movimentacoes" on public.movimentacoes for select to authenticated using (public.is_equipe() and public.tem_perm('processos'));
drop policy if exists "ver itens ganhos" on public.itens_ganhos;
create policy "ver itens ganhos" on public.itens_ganhos for select to authenticated
  using (public.is_equipe() and (public.tem_perm('contratos') or public.tem_perm('processos') or public.tem_perm('reequilibrio') or public.tem_perm('catalogo')));
-- pedidos_sala e resumo_acompanhando: o filtro is_equipe() passou a ser (is_equipe() and tem_perm('processos')).

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 1 and 200),
  unidade text,
  chaves text[] not null default '{}',
  custo_atual numeric(16,4), custo_marca text, custo_em timestamptz, custo_por text,
  obs text,
  criado_em timestamptz not null default now()
);
create index if not exists produtos_chaves_idx on public.produtos using gin (chaves);
create table if not exists public.produto_custos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  valor numeric(16,4) not null check (valor > 0),
  marca text, fornecedor text,
  anotado_em timestamptz not null default now(),
  anotado_por text
);
create index if not exists produto_custos_prod_idx on public.produto_custos (produto_id, anotado_em desc);
alter table public.itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;
alter table public.itens_ganhos add column if not exists produto_id uuid references public.produtos(id) on delete set null;
alter table public.itens_ganhos add column if not exists custo_unit numeric(16,4);
create index if not exists itens_produto_idx on public.itens (produto_id);
create index if not exists itens_ganhos_produto_idx on public.itens_ganhos (produto_id);

create or replace function public.produto_custo_atual()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.produto_id, old.produto_id); u record;
begin
  select valor, marca, anotado_em, anotado_por into u from produto_custos where produto_id = pid order by anotado_em desc limit 1;
  update produtos set custo_atual = u.valor, custo_marca = u.marca, custo_em = u.anotado_em, custo_por = u.anotado_por where id = pid;
  return null;
end $$;
drop trigger if exists produto_custo_atual on public.produto_custos;
create trigger produto_custo_atual after insert or delete on public.produto_custos for each row execute function public.produto_custo_atual();

alter table public.produtos enable row level security;
alter table public.produto_custos enable row level security;
drop policy if exists "ver produtos" on public.produtos;
create policy "ver produtos" on public.produtos for select to authenticated
  using (public.is_equipe() and (public.tem_perm('catalogo') or public.tem_perm('reequilibrio') or public.tem_perm('custos')));
drop policy if exists "editar produtos" on public.produtos;
create policy "editar produtos" on public.produtos for all to authenticated
  using (public.pode_editar() and public.tem_perm('catalogo')) with check (public.pode_editar() and public.tem_perm('catalogo'));
drop policy if exists "ver custos" on public.produto_custos;
create policy "ver custos" on public.produto_custos for select to authenticated using (public.is_equipe() and public.tem_perm('custos'));
drop policy if exists "anotar custos" on public.produto_custos;
create policy "anotar custos" on public.produto_custos for insert to authenticated
  with check (public.pode_editar() and public.tem_perm('custos') and anotado_por = lower(auth.jwt()->>'email'));
drop policy if exists "apagar custos" on public.produto_custos;
create policy "apagar custos" on public.produto_custos for delete to authenticated using (public.pode_editar() and public.tem_perm('custos'));

-- Grava o agrupamento automático feito no app (não mexe em itens já agrupados).
-- p_grupos = [{ "chave", "nome", "unidade", "itens": [uuid], "ganhos": [uuid] }]
create or replace function public.aplicar_agrupamento(p_grupos jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare g jsonb; pid uuid; n int := 0;
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  for g in select * from jsonb_array_elements(p_grupos) loop
    select id into pid from produtos where chaves @> array[g->>'chave'] limit 1;
    if pid is null then
      insert into produtos (nome, unidade, chaves) values (left(g->>'nome', 200), g->>'unidade', array[g->>'chave']) returning id into pid;
      n := n + 1;
    end if;
    update itens set produto_id = pid where produto_id is null and id in (select (jsonb_array_elements_text(coalesce(g->'itens', '[]'::jsonb)))::uuid);
    update itens_ganhos set produto_id = pid where produto_id is null and id in (select (jsonb_array_elements_text(coalesce(g->'ganhos', '[]'::jsonb)))::uuid);
  end loop;
  return n;
end $$;

-- Junta produtos: itens, custos e chaves passam para p_para.
create or replace function public.juntar_produtos(p_para uuid, p_de uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  p_de := array_remove(p_de, p_para);
  update itens set produto_id = p_para where produto_id = any(p_de);
  update itens_ganhos set produto_id = p_para where produto_id = any(p_de);
  update produto_custos set produto_id = p_para where produto_id = any(p_de);
  update produtos set chaves = (select array_agg(distinct c) from (select unnest(chaves) c from produtos where id = p_para or id = any(p_de)) s) where id = p_para;
  delete from produtos where id = any(p_de);
end $$;

-- Tira um item (ou item ganho) do produto e cria um produto só com ele.
create or replace function public.separar_item(p_item uuid, p_ganho uuid, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  insert into produtos (nome) values (left(coalesce(nullif(trim(p_nome), ''), 'Produto'), 200)) returning id into pid;
  if p_item is not null then update itens set produto_id = pid where id = p_item; end if;
  if p_ganho is not null then update itens_ganhos set produto_id = pid where id = p_ganho; end if;
  return pid;
end $$;
revoke execute on function public.aplicar_agrupamento(jsonb) from public, anon;
revoke execute on function public.juntar_produtos(uuid, uuid[]) from public, anon;
revoke execute on function public.separar_item(uuid, uuid, text) from public, anon;
grant execute on function public.aplicar_agrupamento(jsonb) to authenticated;
grant execute on function public.juntar_produtos(uuid, uuid[]) to authenticated;
grant execute on function public.separar_item(uuid, uuid, text) to authenticated;

alter table public.processos add column if not exists validade_dias int check (validade_dias between 1 and 730);
alter table public.processos add column if not exists validade_fonte text; -- 'edital' | 'manual' | 'nao_encontrada'
alter table public.processos add column if not exists validade_trecho text;
alter table public.processos add column if not exists validade_checada_em timestamptz;

-- =====================================================================
-- Migração contratos_manuais (11/11/2026)
-- Contratos, atas de registro de preços, empenhos, aditivos e apostilamentos
-- lançados à mão (fonte 'manual') ou trazidos do PNCP / e-mail.
-- =====================================================================
create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  pai_id uuid references public.contratos(id) on delete cascade, -- aditivo → contrato/ata original
  tipo text not null check (tipo in ('ata', 'contrato', 'empenho', 'aditivo', 'apostilamento')),
  aditivo_tipo text check (aditivo_tipo in ('prazo', 'valor', 'quantidade', 'reequilibrio', 'outro')),
  numero text,
  orgao text not null check (char_length(trim(orgao)) between 2 and 200),
  municipio text,
  pregao text,
  objeto text,
  data_assinatura date,
  vigencia_inicio date,
  vigencia_fim date,
  valor numeric(16,2),
  link text,
  fonte text not null default 'manual' check (fonte in ('manual', 'pncp', 'email')),
  pncp_controle text,
  obs text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (tipo <> 'aditivo' or pai_id is not null),
  check (vigencia_fim is null or vigencia_inicio is null or vigencia_fim >= vigencia_inicio)
);
create index if not exists contratos_processo_idx on public.contratos (processo_id);
create index if not exists contratos_pai_idx on public.contratos (pai_id);
create index if not exists contratos_vig_idx on public.contratos (vigencia_fim);
create unique index if not exists contratos_pncp_idx on public.contratos (pncp_controle) where pncp_controle is not null;
alter table public.contratos enable row level security;
drop policy if exists "ver contratos" on public.contratos;
create policy "ver contratos" on public.contratos for select to authenticated
  using (public.is_equipe() and (public.tem_perm('contratos') or public.tem_perm('reequilibrio')));
drop policy if exists "lancar contratos" on public.contratos;
create policy "lancar contratos" on public.contratos for insert to authenticated
  with check (public.pode_editar() and public.tem_perm('contratos'));
drop policy if exists "editar contratos" on public.contratos;
create policy "editar contratos" on public.contratos for update to authenticated
  using (public.pode_editar() and public.tem_perm('contratos')) with check (public.pode_editar() and public.tem_perm('contratos'));
drop policy if exists "apagar contratos" on public.contratos;
create policy "apagar contratos" on public.contratos for delete to authenticated
  using (public.pode_editar() and public.tem_perm('contratos'));
create or replace function public.contratos_tocar() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists contratos_tocar on public.contratos;
create trigger contratos_tocar before update on public.contratos for each row execute function public.contratos_tocar();

-- =====================================================================
-- Migração robo_lances_observar (13/11/2026)
-- Robô de lances local (pasta robo-lances, roda no computador da empresa).
-- Fase 1: SÓ OBSERVAR. robo_disputas.modo tem check (modo = 'observar'):
-- liberar lance real exige nova migração, com autorização do dono.
-- O robô fala com a função licita-robo (chave própria; no banco fica só o hash
-- em segredos.robo_lances_hash). Senha do portal: cofre → senha_acesso().
-- =====================================================================
-- robo_disputas (processo_id pk, ligado, modo='observar', parado, config jsonb, criado_por, ...)
-- robo_itens    (processo_id, numero, ativo, parado, estrategia cobrir|final|observar, lances_dados)
--               piso = itens.valor_minimo (digitado à mão; sem piso o robô não lança)
-- robo_eventos  (processo_id, numero, tipo decisao|erro|aviso|status|proposta|chat, acao, valor, motivo, dados)
-- robo_estado   ('pcp': versao, sinal_em, status, mensagem, maquina, parado_geral)
-- robo_pedidos  (processo_id, tipo 'proposta', status pendente|andamento|feito|erro, mensagem)
-- robo_arquivos (nome, conteudo, versao)  -- atualização automática do programa; só service_role
-- robo_capturas (processo_id, tipo, url, html) -- cópias de tela para calibrar o leitor; só service_role
-- RLS: ver = is_equipe() and tem_perm('robo'); ligar/criar = pode_editar() and tem_perm('robo');
--      parar (update parado/ativo/estrategia/config, parado_geral) = is_equipe() and tem_perm('robo').
--      authenticated não altera robo_disputas.modo (grant por coluna).


-- =====================================================================
-- Migração proposta_word (14/11/2026): proposta em Word (PROPOSTA / PROPOSTA AJUSTADA)
-- =====================================================================
-- Dados da empresa e do representante usados na proposta (dados pessoais: só quem edita vê; só o administrador altera)
create table if not exists public.empresa_proposta (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  dados jsonb not null default '{}'::jsonb,   -- razao, razao_assinatura, cnpj, endereco, cidade, banco, representante, rg, cpf, cargo, email, validade_dias
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.empresa_proposta enable row level security;
create policy "ver dados da proposta" on public.empresa_proposta for select using (pode_editar());
create policy "admin altera dados da proposta" on public.empresa_proposta for all using (is_admin()) with check (is_admin());

-- Modelo Word da proposta (.docx em base64 com marcadores {{...}}); fica no banco, nunca no GitHub
create table if not exists public.modelos_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'proposta',
  nome text,
  arquivo text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (empresa_id, tipo)
);
alter table public.modelos_documentos enable row level security;
create policy "ver modelos" on public.modelos_documentos for select using (pode_editar());
create policy "admin altera modelos" on public.modelos_documentos for all using (is_admin()) with check (is_admin());

-- Por processo: nº do processo licitatório (≠ nº do pregão) e opções da proposta ({"colunas": {"anvisa": bool, "obs": bool}})
alter table public.processos add column if not exists numero_processo text;
alter table public.processos add column if not exists proposta_opcoes jsonb not null default '{}'::jsonb;

-- =====================================================================
-- Migração robo_arquivos_admin_publica (14/11/2026): o administrador publica versões novas do robô de lances
-- (o robô baixa sozinho pelo licita-robo "arquivos" quando versao_publicada > VERSAO dele)
-- =====================================================================
grant select, insert, update, delete on public.robo_arquivos to authenticated;
create policy "admin publica versao do robo" on public.robo_arquivos for all to authenticated using (is_admin()) with check (is_admin());

-- =====================================================================
-- Migração resumo_propostas (14/11/2026): etapas "Proposta" e "Lances" (situação dos itens antes/durante a sessão)
-- =====================================================================
create or replace function public.resumo_propostas()
returns table (processo_id uuid, itens int, marcados int, cotados int, sem_marca int, com_piso int, total numeric)
language sql stable security invoker set search_path = public as $$
  select p.id,
    count(i.id)::int,
    count(i.id) filter (where i.participar)::int,
    count(i.id) filter (where i.participar and i.preco_unit is not null)::int,
    count(i.id) filter (where i.participar and i.preco_unit is not null and coalesce(i.marca, '') = '')::int,
    count(i.id) filter (where i.participar and i.valor_minimo is not null)::int,
    coalesce(sum(coalesce(i.preco_total, i.preco_unit * i.quantidade)) filter (where i.participar and i.preco_unit is not null), 0)
  from processos p
  left join itens i on i.processo_id = p.id
  where p.ativo and p.etapa in ('analise', 'participar', 'proposta', 'suspenso', 'disputa')
  group by p.id;
$$;
grant execute on function public.resumo_propostas() to authenticated;
-- =====================================================================
-- Migração ordens_fornecimento (14/11/2026) · etapa "Demandas"
-- Ordens de fornecimento por ata/contrato (itens vencidos de um processo).
-- itens_ganhos.quantidade_entregue = soma das ordens (trigger ordem_itens_saldo);
-- saldo = quantidade - quantidade_entregue (o Reequilíbrio usa o mesmo saldo).
-- =====================================================================
create table if not exists public.ordens_fornecimento (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete set null,
  numero text not null check (char_length(trim(numero)) between 1 and 60),
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  lancado_em timestamptz not null default now(),
  lancado_por text default lower(auth.jwt()->>'email'),
  obs text
);
create index if not exists ordens_proc_idx on public.ordens_fornecimento (processo_id, lancado_em desc);
create table if not exists public.ordem_itens (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid not null references public.ordens_fornecimento(id) on delete cascade,
  ganho_id uuid not null references public.itens_ganhos(id) on delete cascade,
  quantidade numeric(16,4) not null check (quantidade > 0),
  unique (ordem_id, ganho_id)
);
create index if not exists ordem_itens_ganho_idx on public.ordem_itens (ganho_id);
-- function ordem_itens_saldo() (security definer): recalcula itens_ganhos.quantidade_entregue do item afetado
-- trigger ordem_itens_saldo after insert or update or delete on ordem_itens
-- RLS: ver = is_equipe() and tem_perm('contratos'); lançar/apagar = pode_editar() and tem_perm('contratos')
-- =====================================================================
-- Migração unificar_produto_palavras (14/11/2026) · Produtos por palavras-chave
-- unificar_produto(p_nome, p_chave, p_unidade, p_itens uuid[], p_ganhos uuid[]) returns uuid
--   p_chave = 'REGRA:PALAVRAS|SEM:…|TAM:M|EMB:EMB-CX' (gravada em produtos.chaves; itens novos que
--   batem com a regra entram sozinhos no produto, pelo agrupamento do app em src/produtos.js).
--   Acha/cria o produto da regra, move os itens escolhidos, leva os custos dos produtos que
--   ficaram vazios e apaga esses produtos vazios. Permissão: pode_editar() and tem_perm('catalogo').
-- =====================================================================