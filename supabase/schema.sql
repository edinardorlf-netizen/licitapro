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
