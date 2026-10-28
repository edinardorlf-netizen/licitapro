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
