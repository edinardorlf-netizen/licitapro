# LicitaPro

App interno da equipe para acompanhar licitações em Minas Gerais.

**Endereço:** https://edinardorlf-netizen.github.io/licitapro/

## O que faz

- **Radar de editais:** a cada hora busca no PNCP os pregões e dispensas publicados em MG e marca como relevantes os que batem com as palavras-chave da empresa (medicamentos, odontológicos, médico-hospitalares, saneantes, limpeza, cosméticos…).
- **Acompanhamento de processos:** cada processo cadastrado é conferido sozinho (a cada 10 min perto da sessão, de hora em hora nos dias próximos, a cada 3 h no resto do tempo) e as mudanças viram uma linha do tempo:
  - PNCP (todos os portais): situação, retificações, itens, documentos e resultados;
  - Portal de Compras Públicas: chat público da sessão, situação, prazos, melhor lance dos itens e documentos;
  - Licitar Digital: pelo PNCP (o portal bloqueia acesso automático).
- **Lembretes:** sessão no dia seguinte, sessão em menos de 1 hora e fim do prazo de impugnação.
- **Itens e valor mínimo:** marque os itens que a empresa disputa, informe custo, frete, impostos e margem; o app calcula o valor mínimo do lance e compara com o melhor lance do portal.
- **Equipe e perfis:** administrador, equipe (busca, propostas e disputas) e acompanha disputas (vê tudo e anota, sem alterar valores).
- **Avisos no Telegram** (opcional).

## Estrutura

- `src/`: app (React), compilado em `app.js` com `npm run build`.
- `supabase/schema.sql`: tabelas, regras de segurança e funções (projeto Supabase "licitacoes", região São Paulo).
- `supabase/functions/licita/index.ts`: robô na nuvem (radar, acompanhamento e cadastro), chamado pelo agendador do banco.
