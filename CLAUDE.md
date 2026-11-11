# LicitaPro · um sistema Auraxis — guia para o Claude Code

Leia isto primeiro. É a passagem de bastão da conversa no claude.ai para o Claude Code no computador do dono do projeto.

## Quem usa e para quê
- Dono: Edinardo (edinardorlf@gmail.com). Equipe: Edinardo e Marcio (buscam editais, montam propostas e acompanham disputas); Larissa só acompanha disputas.
- Empresa: Mirafarma Produtos Farmacêuticos Ltda (CNPJ 53.919.689/0001-19), Minas Gerais. Vende medicamentos, odontológicos, médico-hospitalares, saneantes, limpeza e cosméticos. Também existe a Miramed, mas hoje só a Mirafarma disputa.
- Participa de mais de 30 licitações por mês: Portal de Compras Públicas (PCP) e Licitar Digital são os mais usados (começar por eles), além de Compras.gov.br, BLL e Licitações-e (Banco do Brasil).
- Já usou robô comercial de lances (Effecti, só no PCP). Acesso aos portais é por usuário e senha.
- Objetivo agora: terminar e **testar o robô de lances** em licitação real, mantendo tudo no Claude Code. Depois, vender o LicitaPro (cada empresa cadastrada pelo CNPJ com o login de cada portal).
- Idioma: português do Brasil. App completo no computador; no celular só monitoramento e busca de editais.

## O que já existe (e funciona)
- App React (`src/`, build `npm run build` → `app.js`), publicado no GitHub Pages: https://edinardorlf-netizen.github.io/licitapro/
- Supabase, projeto "licitacoes" (id `ginvqrnyvtpmorgvtcun`, São Paulo). Esquema em `supabase/schema.sql`.
- Funções na nuvem: `supabase/functions/licita` (cadastro/acompanhamento), `licita-radar` (radar de editais no PNCP, a cada hora), `licita-sinc` (acompanhamento + `pcp.ts` para o Portal de Compras Públicas: chat público, situação, prazos, melhor lance por item, documentos).
- Licitar Digital: lido só pelo PNCP (o portal bloqueia acesso automático). Para achar itens vencidos: relatório "Fornecedores habilitados" e Ata da sala de disputa de cada processo.
- Cérebro do robô: `src/robo.js` (função pura: estado do item + configuração → dar lance / esperar / parar, sempre com motivo). Simulador na aba "Robô" (`src/Simulador.jsx`), só no computador.
  Travas que nunca podem ser quebradas: nunca lançar abaixo do piso do item (sem piso, não lança); respeitar diferença mínima do edital; intervalos mínimos; limite de lances por item; botão de parar; não cobrir o próprio lance.

## O que falta (prioridade)
1. **Conector real do Portal de Compras Públicas** (e depois Licitar Digital): programa que roda no computador do dono, entra com o login da empresa, lê a sala de disputa em tempo real e executa as decisões do `robo.js`. A parte de "ler" já existe em `pcp.ts`.
2. **Começar só observando:** modo `observar` (mostra o que faria, sem dar lance) em disputa real. Só liberar lance real depois de testes e com autorização explícita do dono, item a item, com piso definido.
3. **Alerta sonoro de chat:** avisar quando "Mirafarma Produtos Farmacêuticos" for citada no chat do PCP.
4. Pendências antigas: Compras.gov.br, BLL, Licitações-e; resultados do pregão de Taiobeiras 52/2025; itens vencidos nos processos Mirafarma; buscas diárias nos 3 boletins do ConLicitação (3 por dia; foco inicial retroativo 19–28/10/2026 e depois só o dia atual).
5. Padrão para todo edital recebido: resumo de pontos críticos (Lei 14.133/2021, incluindo o site de cadastro da proposta) + planilha de itens no modelo da licitação de Várzea da Palma (PE 039/2026). Nome do arquivo da planilha sem "itens cotados".

## Regras de trabalho
- **Segredos:** logins e senhas dos portais e chaves nunca entram no código, no git nem no chat. Ficam no cofre do Supabase (tabela `segredos`/`acessos`, `senha_id`) ou em variáveis de ambiente no computador. Não repita senhas em respostas.
- Nunca resolver captcha nem contornar bloqueio de portal; se aparecer, o dono resolve. Conferir os termos de uso do portal antes de automatizar lance.
- Lance real é ação irreversível: sempre pedir autorização explícita do dono antes de ativar, e manter o botão de parar visível.
- Antes de mudar o banco, ver `supabase/schema.sql`. Mudanças viram migração e atualizam o arquivo.
- Alterou `src/`? Rode `npm run build` e envie `app.js` junto no commit (o GitHub Pages serve o arquivo compilado).
- Funções do Supabase: o arquivo `index.ts` completo é o que vai ao ar; conferir `verify_jwt` conforme já configurado.
- Resposta final ao dono: curta, em português, dizendo o que ficou pronto e qual o próximo passo.
