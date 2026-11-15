# Ciba AI

Gateway privado de IA compartilhada para aplicativos da família Ciba.

## Objetivos

- Um único backend compartilhado por Zupi, GEIVIA e futuros aplicativos Ciba.
- Acesso controlado por convites e tokens individuais de dispositivo.
- Inferência inicial pela Cloudflare Workers AI.
- Sem fallback pago, cobrança automática ou uso de credenciais Google do mantenedor.
- Limites diários por dispositivo, aplicativo e instalação.
- Não persistir o conteúdo das conversas.

## Custo zero: condição obrigatória

A franquia gratuita documentada pela Cloudflare é de 10.000 Neurons por dia, compartilhada entre os modelos elegíveis. No plano Free, as chamadas falham ao atingir o limite; no plano Paid, o excedente pode ser cobrado. Para manter custo zero, use uma conta Workers Free, não habilite Workers Paid nem créditos pré-pagos do AI Gateway e não configure fallback pago. O limite interno de requisições do Ciba AI é uma proteção adicional, não uma conversão exata de Neurons. Confira o painel de consumo da Cloudflare regularmente. [Documentação oficial de preços](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Estado do projeto

Esta é a primeira implementação no repositório. O CI de TypeScript passou. Ainda exige configuração da conta Cloudflare, criação do banco D1, definição dos segredos, confirmação dos package IDs Android e teste real de inferência antes de uso.

## Arquitetura

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
npm run typecheck
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
| `DAILY_GLOBAL_LIMIT` | Requisições globais/dia |
| `DAILY_APP_LIMIT` | Requisições por app/dia |
| `DAILY_DEVICE_LIMIT` | Requisições por dispositivo/dia |
| `MAX_OUTPUT_TOKENS` | Limite de saída solicitado ao modelo |
| `ADMIN_TOKEN` | Segredo para operações administrativas |

## Rotas

- `GET /v1/status`
- `GET /v1/models`
- `POST /v1/auth/register`
- `POST /v1/ai/chat`
- `GET /v1/usage`
- `POST /v1/admin/invitations`

Consulte [SECURITY.md](docs/SECURITY.md) antes de disponibilizar convites ou distribuir os aplicativos.
