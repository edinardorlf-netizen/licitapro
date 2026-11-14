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
-- =====================================================================
-- Migrações documentos_edital + edital_resumo (14/11/2026) · aba "📑 Edital" do processo
-- Função licita-edital (verify_jwt true): devolve o texto do edital (baixado do PCP/PNCP ou arquivo enviado).
-- O app (src/documentosEdital.js) acha pontos de atenção e documentos exigidos, com trecho de origem;
-- o usuário revisa e grava.
-- =====================================================================
alter table public.processos add column if not exists documentos_edital jsonb;   -- [{nome,categoria,item,validade,status,obs,trecho,confirmar}] → aba Documentos da planilha
alter table public.processos add column if not exists documentos_lidos_em timestamptz;
alter table public.processos add column if not exists edital_resumo jsonb;       -- {arquivo,paginas,parcial,pontos:[{grupo,titulo,valor,item,pagina,trecho}],faltou:[]}
-- =====================================================================
-- CONTAS (14/11/2026): cada empresa cliente isolada, login por NOME + senha (igual ao LojaPro)
-- Migrações: contas_1_tabelas_e_conta_id, contas_2_funcoes, contas_3_regras (texto completo abaixo).
-- - contas (codigo único, nome, logo, ativa, robo_hash) e auraxis_admins (quem cria contas; o dono atual foi
--   copiado de config.dono, sem e-mail neste arquivo).
-- - conta_id em todas as tabelas da conta; dados que já existiam foram para a conta 'mirafarma'.
-- - Regra restritiva "so a minha conta" em todas elas: conta_id = minha_conta().
-- - Filhos herdam a conta do pai (gatilho a_conta / conta_do_pai); processos pela empresa ou edital (processos_conta).
-- - config, robo_estado e radar_categorias passaram a ter uma linha (ou cópia) por conta.
-- - Login por nome: e-mail interno <nome>.<codigo>@contas.licitapro.invalid, criado pela função licita-contas
--   (equipe.login, equipe.trocar_senha, equipe.uid). RPCs: conta_publica, meu_acesso, senha_criada,
--   criar_conta_dados e uid_por_email (só serviço). Telegram: segredos 'telegram_token:<conta_id>'.
-- =====================================================================
-- =====================================================================
-- Contas (empresas clientes) — cada cliente isolado, como as lojas do LojaPro
-- Parte 1: tabelas novas, conta_id em tudo (dados atuais → conta "mirafarma"), chaves únicas por conta
-- =====================================================================
create table if not exists public.contas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9]{3,30}$'),
  nome text not null check (char_length(trim(nome)) between 2 and 120),
  cidade text,
  uf text,
  logo text,
  ativa boolean not null default true,
  robo_hash text,
  criado_em timestamptz not null default now(),
  criado_por text
);
alter table public.contas enable row level security;

-- Administradores Auraxis (quem instala e cria as contas). Só a função licita-contas lê.
create table if not exists public.auraxis_admins (
  email text primary key check (email = lower(email)),
  criado_em timestamptz not null default now()
);
alter table public.auraxis_admins enable row level security;

insert into public.contas (codigo, nome, uf, criado_por) values ('mirafarma', 'Mirafarma', 'MG', 'migração')
on conflict (codigo) do nothing;
-- o dono atual vira administrador Auraxis (e-mail vem do banco, não do código)
insert into public.auraxis_admins (email) select lower(dono) from public.config where dono is not null on conflict do nothing;
-- chave do robô de lances passa para a conta
update public.contas set robo_hash = (select valor from public.segredos where chave = 'robo_lances_hash') where codigo = 'mirafarma';

-- equipe: login por nome dentro da conta
alter table public.equipe add column if not exists login text;
alter table public.equipe add column if not exists trocar_senha boolean not null default false;
alter table public.equipe add column if not exists uid uuid;

do $$
declare
  c uuid := (select id from public.contas where codigo = 'mirafarma');
  t text;
begin
  foreach t in array array[
    'equipe','config','empresas','acessos','empresa_proposta','modelos_documentos','palavras','radar_categorias','editais',
    'processos','itens','movimentacoes','itens_ganhos','contratos','ordens_fornecimento','ordem_itens','produtos','produto_custos',
    'robo_estado','robo_disputas','robo_itens','robo_eventos','robo_pedidos','robo_capturas']
  loop
    execute format('alter table public.%I add column if not exists conta_id uuid references public.contas(id) on delete cascade', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set conta_id = %L where conta_id is null', t, c);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column conta_id set not null', t);
    execute format('create index if not exists %I on public.%I (conta_id)', t || '_conta_idx', t);
  end loop;
end $$;

-- chaves únicas passam a valer dentro de cada conta
alter table public.config drop constraint if exists config_pkey;
alter table public.config drop constraint if exists config_id_check;
alter table public.config add primary key (conta_id);

alter table public.robo_estado drop constraint if exists robo_estado_pkey;
alter table public.robo_estado add primary key (conta_id, id);

alter table public.radar_categorias drop constraint if exists radar_categorias_pkey;
alter table public.radar_categorias add primary key (conta_id, id);

alter table public.editais drop constraint if exists editais_controle_pncp_key;
alter table public.editais add constraint editais_conta_controle_key unique (conta_id, controle_pncp);

alter table public.processos drop constraint if exists processos_controle_pncp_key;
alter table public.processos drop constraint if exists processos_pcp_codigo_key;
alter table public.processos add constraint processos_conta_controle_key unique (conta_id, controle_pncp);
alter table public.processos add constraint processos_conta_pcp_key unique (conta_id, pcp_codigo);

alter table public.palavras drop constraint if exists palavras_termo_tipo_key;
alter table public.palavras add constraint palavras_conta_termo_tipo_key unique (conta_id, termo, tipo);

alter table public.empresas drop constraint if exists empresas_cnpj_key;
alter table public.empresas add constraint empresas_conta_cnpj_key unique (conta_id, cnpj);

drop index if exists public.contratos_pncp_idx;
create unique index if not exists contratos_pncp_idx on public.contratos (conta_id, pncp_controle) where pncp_controle is not null;

create unique index if not exists equipe_conta_login_idx on public.equipe (conta_id, login) where login is not null;

-- telegram passa a ser por conta (hoje não há token gravado; se houver, vai para a Mirafarma)
update public.segredos set chave = 'telegram_token:' || (select id from public.contas where codigo = 'mirafarma') where chave = 'telegram_token';

-- =====================================================================
-- Contas · Parte 2: quem sou eu (conta), permissões dentro da conta, preenchimento automático da conta
-- =====================================================================
create or replace function public.minha_conta()
returns uuid language sql stable security definer set search_path = public as $$
  select e.conta_id from equipe e join contas c on c.id = e.conta_id and c.ativa
  where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo;
$$;

create or replace function public.meu_papel()
returns text language sql stable security definer set search_path = public as $$
  select e.papel from equipe e join contas c on c.id = e.conta_id and c.ativa
  where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipe e join contas k on k.id = e.conta_id and k.ativa
    left join config c on c.conta_id = e.conta_id
    where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo and e.papel = 'admin'
      and (c.dono is null or e.email = lower(c.dono))
  );
$$;

create or replace function public.tem_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from equipe e join contas k on k.id = e.conta_id and k.ativa
    where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo
      and coalesce((e.permissoes->>p)::boolean, false)
  );
$$;

create or replace function public.is_auraxis()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auraxis_admins where email = lower(coalesce(auth.jwt()->>'email', '')));
$$;

-- o dono de cada conta (config.dono) é o único administrador dela
create or replace function public.equipe_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text;
begin
  select lower(dono) into d from config where conta_id = new.conta_id;
  if new.papel = 'admin' and d is not null and lower(new.email) <> d then
    raise exception 'Somente o dono do sistema pode ser administrador';
  end if;
  if tg_op = 'UPDATE' and d is not null and lower(old.email) = d and (new.papel <> 'admin' or not new.ativo or lower(new.email) <> d) then
    raise exception 'O acesso do dono do sistema não pode ser alterado';
  end if;
  if tg_op = 'UPDATE' and new.conta_id is distinct from old.conta_id then
    raise exception 'Não é possível mudar a pessoa de conta';
  end if;
  return new;
end $$;

-- Filhos herdam a conta do pai (processo, empresa, produto, ordem). Assim as funções na nuvem
-- não precisam informar a conta, e ninguém pendura um item no processo de outra conta.
create or replace function public.conta_do_pai()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid; pid text := to_jsonb(new)->>tg_argv[1];
begin
  if pid is not null then
    execute format('select conta_id from public.%I where id = $1', tg_argv[0]) into v using pid::uuid;
    if v is not null then new.conta_id := v; end if;
  end if;
  if new.conta_id is null then new.conta_id := public.minha_conta(); end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('itens','processos','processo_id'), ('movimentacoes','processos','processo_id'), ('itens_ganhos','processos','processo_id'),
    ('contratos','processos','processo_id'), ('ordens_fornecimento','processos','processo_id'),
    ('robo_disputas','processos','processo_id'), ('robo_itens','processos','processo_id'), ('robo_eventos','processos','processo_id'),
    ('robo_pedidos','processos','processo_id'), ('robo_capturas','processos','processo_id'),
    ('ordem_itens','ordens_fornecimento','ordem_id'), ('produto_custos','produtos','produto_id'),
    ('acessos','empresas','empresa_id'), ('empresa_proposta','empresas','empresa_id'), ('modelos_documentos','empresas','empresa_id')
  ) v(t, pai, col) loop
    execute format('drop trigger if exists a_conta on public.%I', r.t);
    execute format('create trigger a_conta before insert or update of %I on public.%I for each row execute function public.conta_do_pai(%L, %L)', r.col, r.t, r.pai, r.col);
  end loop;
end $$;

-- Processo: conta de quem cadastra; pela função na nuvem, a da empresa ou a do edital
create or replace function public.processos_conta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if new.conta_id is null and new.empresa_id is not null then select conta_id into new.conta_id from empresas where id = new.empresa_id; end if;
  if new.conta_id is null and new.edital_id is not null then select conta_id into new.conta_id from editais where id = new.edital_id; end if;
  if new.empresa_id is not null then
    select conta_id into v from empresas where id = new.empresa_id;
    if v is distinct from new.conta_id then raise exception 'Empresa de outra conta'; end if;
  end if;
  if new.edital_id is not null then
    select conta_id into v from editais where id = new.edital_id;
    if v is distinct from new.conta_id then raise exception 'Edital de outra conta'; end if;
  end if;
  return new;
end $$;
drop trigger if exists a_conta on public.processos;
create trigger a_conta before insert or update of conta_id, empresa_id, edital_id on public.processos for each row execute function public.processos_conta();

-- Raízes: a conta de quem grava (no app); as funções na nuvem informam a conta
do $$
declare t text;
begin
  foreach t in array array['equipe','config','empresas','palavras','radar_categorias','editais','processos','produtos','robo_estado',
    'itens','movimentacoes','itens_ganhos','contratos','ordens_fornecimento','ordem_itens','produto_custos','robo_disputas','robo_itens',
    'robo_eventos','robo_pedidos','robo_capturas','acessos','empresa_proposta','modelos_documentos']
  loop
    execute format('alter table public.%I alter column conta_id set default public.minha_conta()', t);
  end loop;
end $$;

-- Classificação do radar: categorias e palavras da conta do edital
create or replace function public.editais_classificar()
returns trigger language plpgsql set search_path = public as $$
declare
  o text := lp_norm(new.objeto);
  bate text[];
begin
  select coalesce(array_agg(distinct c.id), '{}'), coalesce(array_agg(distinct t), '{}')
    into new.categorias, bate
    from radar_categorias c, unnest(c.termos) t
   where c.conta_id = new.conta_id and c.ativa and position(' ' || t in o) > 0;
  bate := bate || coalesce(array(select p.termo from palavras p where p.conta_id = new.conta_id and p.tipo = 'incluir' and position(rtrim(lp_norm(p.termo)) in o) > 0), '{}');
  new.termos := array(select distinct x from unnest(bate) x order by 1);
  new.relevante := cardinality(new.termos) > 0 and not exists (
    select 1 from palavras p
     where p.conta_id = new.conta_id and p.tipo = 'excluir' and position(rtrim(lp_norm(p.termo)) in o) > 0
       and not exists (select 1 from unnest(new.categorias) cid, radar_categorias c, unnest(c.termos) t
                        where c.conta_id = new.conta_id and c.id = cid and position(' ' || t in o) > 0
                          and (position(trim(lp_norm(p.termo)) in t) > 0 or position(t in trim(lp_norm(p.termo))) > 0))
  );
  return new;
end $$;

-- ---------- RPCs que passam por cima das regras: agora limitadas à conta ----------
create or replace function public.acessos_status()
returns table(id uuid, empresa_id uuid, portal text, usuario text, observacao text, atualizado_em timestamptz, atualizado_por text, tem_senha boolean, sinc_em timestamptz, sinc_ok boolean, sinc_msg text, hist_em timestamptz, hist_msg text)
language sql stable security definer set search_path = public as $$
  select a.id, a.empresa_id, a.portal, a.usuario, a.observacao, a.atualizado_em, a.atualizado_por, a.senha_id is not null, a.sinc_em, a.sinc_ok, a.sinc_msg, a.hist_em, a.hist_msg
  from acessos a where public.pode_editar() and a.conta_id = public.minha_conta() order by a.portal;
$$;

create or replace function public.aplicar_agrupamento(p_grupos jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare g jsonb; pid uuid; n int := 0; c uuid := public.minha_conta();
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  for g in select * from jsonb_array_elements(p_grupos) loop
    select id into pid from produtos where conta_id = c and chaves @> array[g->>'chave'] limit 1;
    if pid is null then
      insert into produtos (conta_id, nome, unidade, chaves) values (c, left(g->>'nome', 200), g->>'unidade', array[g->>'chave']) returning id into pid;
      n := n + 1;
    end if;
    update itens set produto_id = pid where conta_id = c and produto_id is null and id in (select (jsonb_array_elements_text(coalesce(g->'itens', '[]'::jsonb)))::uuid);
    update itens_ganhos set produto_id = pid where conta_id = c and produto_id is null and id in (select (jsonb_array_elements_text(coalesce(g->'ganhos', '[]'::jsonb)))::uuid);
  end loop;
  return n;
end $$;

create or replace function public.definir_telegram(p_token text, p_chat text, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.minha_conta();
begin
  if not public.is_admin() or c is null then raise exception 'Apenas o administrador pode configurar os avisos'; end if;
  if p_token is not null and length(trim(p_token)) > 0 then
    insert into segredos (chave, valor) values ('telegram_token:' || c, trim(p_token))
    on conflict (chave) do update set valor = excluded.valor;
  end if;
  update config set telegram_chat_id = nullif(trim(coalesce(p_chat, '')), ''), telegram_ativo = coalesce(p_ativo, false), atualizado_em = now() where conta_id = c;
end $$;

create or replace function public.telegram_configurado()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_equipe() and exists (select 1 from segredos where chave = 'telegram_token:' || public.minha_conta());
$$;

create or replace function public.juntar_produtos(p_para uuid, p_de uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.minha_conta();
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  p_de := array_remove(p_de, p_para);
  if exists (select 1 from produtos where (id = p_para or id = any(p_de)) and conta_id is distinct from c) then raise exception 'Produto de outra conta'; end if;
  update itens set produto_id = p_para where conta_id = c and produto_id = any(p_de);
  update itens_ganhos set produto_id = p_para where conta_id = c and produto_id = any(p_de);
  update produto_custos set produto_id = p_para where conta_id = c and produto_id = any(p_de);
  update produtos set chaves = (select array_agg(distinct x) from (select unnest(chaves) x from produtos where conta_id = c and (id = p_para or id = any(p_de))) s) where id = p_para and conta_id = c;
  delete from produtos where conta_id = c and id = any(p_de);
end $$;

create or replace function public.marcar_visto(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  insert into vistos (email, processo_id, visto_em)
  select lower(auth.jwt()->>'email'), p.id, now()
  from processos p
  where public.is_equipe() and p.conta_id = public.minha_conta() and (p_ids is null or p.id = any(p_ids))
  on conflict (email, processo_id) do update set visto_em = now();
$$;

create or replace function public.nao_vistas()
returns table(processo_id uuid, qtd bigint, importantes bigint)
language sql stable security definer set search_path = public as $$
  select m.processo_id, count(*), count(*) filter (where m.importante)
  from movimentacoes m
  left join vistos v on v.processo_id = m.processo_id and v.email = lower(auth.jwt()->>'email')
  where public.is_equipe() and m.conta_id = public.minha_conta() and not m.historico and m.created_at > coalesce(v.visto_em, '-infinity'::timestamptz)
  group by m.processo_id;
$$;

create or replace function public.pedidos_sala(p_id uuid default null, p_dias integer default 30)
returns table(processo_id uuid, mov_id uuid, ocorrido_em timestamptz, autor text, texto text, para_nos boolean, itens_citados integer[])
language sql stable security definer set search_path = public as $$
  with nossos as (
    select pr.id, coalesce(array_agg(i.numero) filter (where i.participar or i.nosso_arremata or i.nosso_vence), '{}') nums,
      array_remove(array[upper(unaccent(e.nome))] || coalesce(string_to_array(upper(unaccent(e.apelidos)), ','), '{}')
        || (select coalesce(array_agg(upper(unaccent(x.nome))), '{}') from empresas x where pr.empresa_id is null and x.conta_id = pr.conta_id), null) nomes
    from processos pr left join itens i on i.processo_id = pr.id left join empresas e on e.id = pr.empresa_id
    where (public.is_equipe() and public.tem_perm('processos')) and pr.conta_id = public.minha_conta() and (p_id is null or pr.id = p_id)
    group by pr.id, pr.conta_id, pr.empresa_id, e.nome, e.apelidos
  ), msgs as (
    select m.processo_id, m.id, m.ocorrido_em, m.autor, m.detalhe,
      array(select distinct (x[1])::int from regexp_matches(m.detalhe, 'ite(?:m|ns)\s*(?:n[º°o.]*\s*)?0*(\d{1,4})', 'gi') x) cit
    from movimentacoes m
    where m.tipo = 'chat' and m.conta_id = public.minha_conta() and m.ocorrido_em > now() - make_interval(days => p_dias)
      and (p_id is null or m.processo_id = p_id)
      and coalesce(m.autor,'') !~* '^F\.'
      and m.detalhe !~* '(tem como novo arrematante|foi habilitado e declarado vencedor|foi aberto para lances|foi encerrado|proposta readequada do item .* foi anexada)'
      and m.detalhe ~* '(solicit|envi[ae]|anex|convoc|dilig|apresent|readequ|prazo|regulariz|esclarec|amostra|cat[aá]logo|ficha t[eé]cnica|laudo|registro|declara|habilita|inabilit|desclassific|recus|documenta|negocia|contraproposta|melhor oferta|valor de refer)'
  )
  select ms.processo_id, ms.id, ms.ocorrido_em, ms.autor, ms.detalhe,
    (ms.cit && n.nums) or exists (select 1 from unnest(n.nomes) nm where length(trim(nm)) > 3 and upper(unaccent(ms.detalhe)) like '%' || trim(nm) || '%'),
    ms.cit
  from msgs ms join nossos n on n.id = ms.processo_id
  order by ms.ocorrido_em desc;
$$;

create or replace function public.reclassificar_editais()
returns integer language plpgsql security definer set search_path = public as $$
declare n int; c uuid := public.minha_conta();
begin
  update editais set objeto = objeto where (c is null or conta_id = c) and (encerramento_propostas is null or encerramento_propostas >= now() - interval '1 day');
  select count(*) into n from editais where (c is null or conta_id = c) and relevante and status = 'novo' and encerramento_propostas >= now();
  return n;
end $$;

create or replace function public.remover_acesso(p_id uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_senha uuid;
begin
  if not public.is_admin() then raise exception 'Apenas o administrador pode remover acessos'; end if;
  select senha_id into v_senha from acessos where id = p_id and conta_id = public.minha_conta();
  if not found then raise exception 'Acesso não encontrado'; end if;
  delete from acessos where id = p_id;
  if v_senha is not null then delete from vault.secrets where id = v_senha; end if;
end $$;

create or replace function public.resumo_acompanhando()
returns table(processo_id uuid, itens_nossos integer, arrematando integer, vencendo integer, pedidos_nossos integer, ultimo_pedido text, ultimo_pedido_em timestamptz)
language sql stable security definer set search_path = public as $$
  with it as (
    select i.processo_id,
      count(*) filter (where i.participar or i.nosso_arremata or i.nosso_vence)::int a,
      count(*) filter (where i.nosso_arremata)::int b,
      count(*) filter (where i.nosso_vence)::int c
    from itens i where (public.is_equipe() and public.tem_perm('processos')) and i.conta_id = public.minha_conta() group by 1
  ), pd as (
    select distinct on (s.processo_id) s.processo_id, s.texto, s.ocorrido_em,
      count(*) over (partition by s.processo_id)::int n
    from public.pedidos_sala(null, 30) s where s.para_nos
    order by s.processo_id, s.ocorrido_em desc
  )
  select p.id, coalesce(it.a,0), coalesce(it.b,0), coalesce(it.c,0), coalesce(pd.n,0), pd.texto, pd.ocorrido_em
  from processos p left join it on it.processo_id = p.id left join pd on pd.processo_id = p.id
  where (public.is_equipe() and public.tem_perm('processos')) and p.conta_id = public.minha_conta();
$$;

create or replace function public.salvar_acesso(p_empresa uuid, p_portal text, p_usuario text, p_senha text, p_obs text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  v_id uuid; v_senha uuid; v_email text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.is_admin() then raise exception 'Apenas o administrador pode cadastrar acessos'; end if;
  if not exists (select 1 from empresas where id = p_empresa and conta_id = public.minha_conta()) then raise exception 'Empresa não encontrada'; end if;
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

create or replace function public.salvar_categorias(p_ids text[])
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar() then raise exception 'Seu perfil não pode mudar as categorias.'; end if;
  update radar_categorias set ativa = (id = any(p_ids)) where conta_id = public.minha_conta();
  return reclassificar_editais();
end $$;

create or replace function public.separar_item(p_item uuid, p_ganho uuid, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; c uuid := public.minha_conta();
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  insert into produtos (conta_id, nome) values (c, left(coalesce(nullif(trim(p_nome), ''), 'Produto'), 200)) returning id into pid;
  if p_item is not null then update itens set produto_id = pid where id = p_item and conta_id = c; end if;
  if p_ganho is not null then update itens_ganhos set produto_id = pid where id = p_ganho and conta_id = c; end if;
  return pid;
end $$;

create or replace function public.unificar_produto(p_nome text, p_chave text, p_unidade text, p_itens uuid[], p_ganhos uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; velhos uuid[]; u record; c uuid := public.minha_conta();
begin
  if not (public.pode_editar() and public.tem_perm('catalogo')) then raise exception 'Sem permissão para o catálogo'; end if;
  if p_chave is null or p_chave not like 'REGRA:%' then raise exception 'Regra inválida'; end if;
  p_itens := coalesce(p_itens, '{}'); p_ganhos := coalesce(p_ganhos, '{}');
  if cardinality(p_itens) + cardinality(p_ganhos) = 0 then raise exception 'Nenhum item escolhido'; end if;
  select id into pid from produtos where conta_id = c and chaves @> array[p_chave] limit 1;
  if pid is null then
    insert into produtos (conta_id, nome, unidade, chaves) values (c, left(coalesce(nullif(trim(p_nome), ''), 'Produto'), 200), p_unidade, array[p_chave]) returning id into pid;
  else
    update produtos set nome = left(coalesce(nullif(trim(p_nome), ''), nome), 200) where id = pid;
  end if;
  select array_agg(distinct x) into velhos from (
    select produto_id x from itens where conta_id = c and id = any(p_itens) and produto_id is not null and produto_id <> pid
    union select produto_id from itens_ganhos where conta_id = c and id = any(p_ganhos) and produto_id is not null and produto_id <> pid) s;
  update itens set produto_id = pid where conta_id = c and id = any(p_itens);
  update itens_ganhos set produto_id = pid where conta_id = c and id = any(p_ganhos);
  if velhos is not null then
    update produto_custos set produto_id = pid where conta_id = c and produto_id = any(velhos)
      and not exists (select 1 from itens where produto_id = produto_custos.produto_id)
      and not exists (select 1 from itens_ganhos where produto_id = produto_custos.produto_id);
    delete from produtos p where p.conta_id = c and p.id = any(velhos)
      and not exists (select 1 from itens where produto_id = p.id)
      and not exists (select 1 from itens_ganhos where produto_id = p.id)
      and not exists (select 1 from produtos q where q.id = p.id and exists (select 1 from unnest(q.chaves) x where x like 'REGRA:%'));
  end if;
  select valor, marca, anotado_em, anotado_por into u from produto_custos where produto_id = pid order by anotado_em desc limit 1;
  if found then update produtos set custo_atual = u.valor, custo_marca = u.marca, custo_em = u.anotado_em, custo_por = u.anotado_por where id = pid; end if;
  return pid;
end $$;

-- ---------- Novas: entrada por nome, primeiro acesso e criação de conta ----------
-- Tela de entrada: nome e logo da conta pelo código (sem login)
create or replace function public.conta_publica(p_codigo text)
returns table(codigo text, nome text, logo text)
language sql stable security definer set search_path = public as $$
  select c.codigo, c.nome, c.logo from contas c where c.codigo = lower(trim(p_codigo)) and c.ativa;
$$;

-- Quem sou eu: perfil, conta, se precisa criar a senha, se é administrador Auraxis
create or replace function public.meu_acesso()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'papel', public.meu_papel(),
    'auraxis', public.is_auraxis(),
    'trocar_senha', coalesce((select e.trocar_senha from equipe e where e.email = lower(coalesce(auth.jwt()->>'email', '')) and e.ativo), false),
    'nome', (select e.nome from equipe e where e.email = lower(coalesce(auth.jwt()->>'email', ''))),
    'conta', (select jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'logo', c.logo) from contas c where c.id = public.minha_conta())
  );
$$;

-- A pessoa criou a própria senha (primeiro acesso ou depois de senha provisória)
create or replace function public.senha_criada()
returns void language sql security definer set search_path = public as $$
  update equipe set trocar_senha = false where email = lower(coalesce(auth.jwt()->>'email', ''));
$$;

-- Conta nova: configuração e categorias do radar (todas desmarcadas), copiadas da primeira conta
create or replace function public.criar_conta_dados(p_conta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare modelo uuid := (select id from contas where id <> p_conta order by criado_em limit 1);
begin
  insert into config (conta_id, id) values (p_conta, 1) on conflict (conta_id) do nothing;
  insert into radar_categorias (conta_id, id, grupo, nome, ordem, termos, ativa)
  select p_conta, id, grupo, nome, ordem, termos, false from radar_categorias where conta_id = modelo
  on conflict do nothing;
end $$;

create or replace function public.uid_por_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Quem pode chamar cada função
revoke execute on function public.conta_do_pai() from public, anon, authenticated;
revoke execute on function public.processos_conta() from public, anon, authenticated;
revoke execute on function public.criar_conta_dados(uuid) from public, anon, authenticated;
revoke execute on function public.uid_por_email(text) from public, anon, authenticated;
grant execute on function public.criar_conta_dados(uuid) to service_role;
grant execute on function public.uid_por_email(text) to service_role;
revoke execute on function public.minha_conta() from public, anon;
grant execute on function public.minha_conta() to authenticated;
revoke execute on function public.is_auraxis() from public, anon;
grant execute on function public.is_auraxis() to authenticated;
revoke execute on function public.meu_acesso() from public, anon;
grant execute on function public.meu_acesso() to authenticated;
revoke execute on function public.senha_criada() from public, anon;
grant execute on function public.senha_criada() to authenticated;
grant execute on function public.conta_publica(text) to anon, authenticated;
grant execute on function public.minha_conta() to service_role;

-- =====================================================================
-- Contas · Parte 3: regra de isolamento (restritiva) em todas as tabelas da conta
-- As regras antigas continuam dizendo QUEM pode o quê; esta acrescenta "só na sua conta".
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['equipe','config','empresas','acessos','empresa_proposta','modelos_documentos','palavras','radar_categorias','editais',
    'processos','itens','movimentacoes','itens_ganhos','contratos','ordens_fornecimento','ordem_itens','produtos','produto_custos',
    'robo_estado','robo_disputas','robo_itens','robo_eventos','robo_pedidos','robo_capturas']
  loop
    execute format('drop policy if exists "so a minha conta" on public.%I', t);
    execute format('create policy "so a minha conta" on public.%I as restrictive for all to authenticated using (conta_id = (select public.minha_conta())) with check (conta_id = (select public.minha_conta()))', t);
  end loop;
end $$;

-- contas: cada um vê só a sua (o robo_hash nunca sai do banco)
drop policy if exists "ver minha conta" on public.contas;
create policy "ver minha conta" on public.contas for select to authenticated using (id = (select public.minha_conta()));
revoke all on public.contas from anon, authenticated;
grant select (id, codigo, nome, cidade, uf, logo, ativa, criado_em) on public.contas to authenticated;
revoke all on public.auraxis_admins from anon, authenticated;

-- vistos e notificações: só de processos da própria conta
drop policy if exists "meus vistos" on public.vistos;
create policy "meus vistos" on public.vistos for all to authenticated
  using (email = lower(auth.jwt()->>'email') and public.is_equipe())
  with check (email = lower(auth.jwt()->>'email') and public.is_equipe() and exists (select 1 from public.processos p where p.id = processo_id));
