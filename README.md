# Ciba AI

Gateway privado de IA compartilhada para aplicativos da família Ciba.

## Objetivos

- Um único backend compartilhado por Zupi, GEIVIA e futuros aplicativos Ciba.
- Acesso controlado por convites e tokens individuais de dispositivo.
- Núcleo Ciba Core com roteamento por especialidade e identidade unificada.
- Provider atual Cloudflare Workers AI e adapter preparado para endpoints OpenAI-compatible auto-hospedados.
- Perfis especialistas selecionados sem chamadas adicionais no modo econômico single-pass.
- Memória limitada ao contexto enviado; conversas não são persistidas pelo gateway.
- Primitiva opt-in de ensemble para até três especialistas independentes e uma síntese, ainda desativada sem providers configurados.
- Registro de providers e contratos tipados para futuras ferramentas controladas.
- Sem fallback pago, cobrança automática ou uso de credenciais Google do mantenedor.
- Limites diários por dispositivo, aplicativo e instalação.
- Não persistir o conteúdo das conversas.

## Custo zero: condição obrigatória

A franquia gratuita documentada pela Cloudflare é de 10.000 Neurons por dia. No Workers Free, as chamadas falham ao atingir o limite; no Workers Paid, o excedente é cobrado a US$ 0,011 por 1.000 Neurons. O modelo Gemma 4 está listado a 9.091 Neurons por milhão de tokens de entrada e 27.273 por milhão de tokens de saída. Os tetos internos foram reduzidos para criar margem dentro da franquia, mas não representam garantia matemática de consumo: a contagem real deve ser acompanhada no painel. [Tabela oficial por modelo](https://developers.cloudflare.com/workers-ai/platform/pricing/). Para manter custo zero, use uma conta Workers Free, não habilite Workers Paid nem créditos pré-pagos do AI Gateway e não configure fallback pago. O limite interno de requisições do Ciba AI é uma proteção adicional, não uma conversão exata de Neurons. Confira o painel de consumo da Cloudflare regularmente. [Documentação oficial de preços](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Estado do projeto

A base do Worker, autenticação por dispositivo, cotas, administração, API de configurações e testes locais de integração estão implementados. O CI valida o TypeScript e executa testes unitários e de integração. Ainda exige provisionamento da conta Cloudflare, criação do banco D1, aplicação das migrations, definição dos segredos, confirmação dos package IDs Android e teste real de inferência antes de uso.

## Arquitetura

A camada de inteligência unificada está descrita em [UNIFIED_INTELLIGENCE.md](docs/UNIFIED_INTELLIGENCE.md), e a seleção de projetos open source em [OPEN_SOURCE_SELECTION.md](docs/OPEN_SOURCE_SELECTION.md). O núcleo atual usa um único modelo por chamada e seleciona um perfil especialista; não afirma executar vários modelos independentes. O adapter para providers OpenAI-compatible está preparado, mas ainda não conectado nem configurado.


```
App Ciba
  |-- POST /v1/auth/register  (convite de uso único)
  |-- POST /v1/ai/chat        (Bearer token do dispositivo)
  |-- GET  /v1/usage
  v
Ciba AI Worker
  |-- autenticação e autorização
  |-- cotas atômicas em D1
  |-- Cloudflare Workers AI
  v
Resposta ao app (sem armazenar o histórico)
```

## Desenvolvimento

Requisitos: Node.js 20+ e conta Cloudflare.

```bash
npm install
npm run check
npx wrangler d1 create ciba-ai-db
```

Copie o ID retornado para `wrangler.toml`. Substitua `ALLOWED_APP_IDS` pelos package IDs Android reais dos aplicativos Ciba (a lista está vazia de propósito até essa confirmação), aplique a migration e configure os segredos:

```bash
npx wrangler d1 migrations apply ciba-ai-db --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

O nome do modelo é configurado em `AI_MODEL`. Antes de produção, confirme no catálogo da Cloudflare o identificador e a disponibilidade do modelo escolhido para a sua conta.

## Variáveis

| Variável | Uso |
|---|---|
| `AI_MODEL` | Identificador do modelo Workers AI |
| `ALLOWED_APP_IDS` | IDs de apps Ciba separados por vírgula |
| `DAILY_GLOBAL_LIMIT` | Requisições globais/dia (teto 50) |
| `DAILY_APP_LIMIT` | Requisições por app/dia (teto 25) |
| `DAILY_DEVICE_LIMIT` | Requisições por dispositivo/dia (teto 10) |
| `MAX_OUTPUT_TOKENS` | Limite de saída solicitado ao modelo (teto 512) |
| `ADMIN_TOKEN` | Segredo para operações administrativas |

## Rotas

- `GET /v1/status`
- `GET /v1/config` (configuração pública para os aplicativos)
- `GET /v1/models`
- `GET /v1/ai/capabilities`
- `POST /v1/auth/register`
- `POST /v1/ai/chat`
- `GET /v1/usage`
- `GET /v1/admin/apps`
- `POST /v1/admin/apps`
- `POST /v1/admin/invitations`
- `POST /v1/admin/devices/revoke`
- `GET /v1/admin/ai/overview` (visão protegida para futura tela administrativa)\n- `GET /v1/admin/settings`
- `POST /v1/admin/settings`

Consulte [PROVISIONING.md](docs/PROVISIONING.md) para o roteiro de ativação sem provisionamento automático. Consulte [TESTING.md](docs/TESTING.md) para executar os testes locais sem credenciais Cloudflare. Consulte [APP_INTEGRATION.md](docs/APP_INTEGRATION.md) para o contrato de integração dos clientes. Consulte [SECURITY.md](docs/SECURITY.md) antes de disponibilizar convites ou distribuir os aplicativos. A futura tela Configurações deve usar a API descrita em [SETTINGS.md](docs/SETTINGS.md); segredos de infraestrutura nunca devem ser enviados ao cliente.


## Proteções de uso

- O endpoint `POST /v1/ai/chat` limita cada dispositivo a 12 chamadas por minuto; excedentes recebem HTTP 429 (`rate_limit_exceeded`).
- Tetos rígidos: 50 requisições globais/dia, 25 por app/dia, 10 por dispositivo/dia, 512 tokens de saída, 1.500 caracteres por mensagem e 3.000 caracteres por requisição. A tela administrativa poderá reduzir, mas não elevar esses tetos.
- O modelo efetivo é validado por allowlist no próprio Worker. Atualmente, somente `@cf/google/gemma-4-26b-a4b-it` é aceito; uma configuração de ambiente fora da allowlist não será executada.
- As migrations `0004_minute_rate_limit.sql` e `0005_configurable_rate_limit.sql` criam o contador por minuto. A limpeza agendada remove registros antigos.
