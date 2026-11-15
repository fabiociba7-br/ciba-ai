# Configuração administrativa do Ciba AI

O Ciba AI separa configurações operacionais de segredos. As configurações editáveis ficam na tabela D1 `runtime_settings` e poderão ser controladas por uma futura tela **Configurações** nos aplicativos ou num painel administrativo.

## Visão geral administrativa da IA

- `GET /v1/admin/ai/overview`: visão protegida para uma futura tela administrativa. Retorna o modelo efetivo, estado da IA, perfis especialistas, limites e quais extensões estão apenas preparadas. Exige `Authorization: Bearer ADMIN_TOKEN`. Não retorna credenciais, tokens nem conteúdo de conversas.

Esse endpoint distingue explicitamente o modo `single-pass` das extensões ainda desativadas: ensemble multi-modelo, memória persistente e execução de ferramentas.

## Cadastro de aplicativos pela API

- `GET /v1/admin/apps`: lista os aplicativos registrados.
- `GET /v1/admin/devices`: lista dispositivos, sem expor hashes ou tokens. Aceita `app_id` e `limit` como filtros.
- `GET /v1/admin/invitations`: lista metadados de convites, sem expor códigos. Aceita `app_id` e `limit` como filtros.
- `POST /v1/admin/apps`: cadastra ou atualiza um aplicativo permitido.

Exemplo de cadastro:

```json
{
  "app_id": "com.exemplo.aplicativo",
  "display_name": "Aplicativo Ciba",
  "enabled": true
}
```

O `app_id` deve ser o applicationId real do Android. Aplicativos desativados deixam de poder registrar novos dispositivos e gerar convites. O valor também não substitui atestação de integridade do APK; isso será uma camada adicional antes de produção.

## Configurações editáveis pela API

Autenticação administrativa: `Authorization: Bearer ADMIN_TOKEN`.

- `GET /v1/admin/settings`: lista configurações salvas e chaves permitidas.
- `POST /v1/admin/settings`: salva um objeto `settings`.
- `GET /v1/config`: retorna somente a configuração pública necessária aos clientes.

Exemplo:

```http
POST /v1/admin/settings
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

```json
{
  "settings": {
    "ai_enabled": true,
    "ai_model": "@cf/google/gemma-4-26b-a4b-it",
    "daily_global_limit": 50,
    "daily_app_limit": 25,
    "daily_device_limit": 10,
    "max_output_tokens": 512,
    "maintenance_mode": false
  }
}
```

## Chaves disponíveis

| Chave | Tipo | Finalidade |
|---|---|---|
| `ai_enabled` | boolean | Liga/desliga novas chamadas de IA |
| `ai_model` | string | Modelo Workers AI selecionado |
| `daily_global_limit` | número | Limite diário global de requisições |
| `daily_app_limit` | número | Limite diário por aplicativo |
| `daily_device_limit` | número | Limite diário por dispositivo |
| `max_output_tokens` | número | Limite de tokens de saída (máximo 512) |
| `maintenance_mode` | boolean | Bloqueia temporariamente chamadas de chat |

Os valores salvos no D1 prevalecem sobre os valores padrão em `wrangler.toml`. A API valida os tipos e os limites antes de gravar. Para preservar a meta de custo zero, a seleção de modelo fica restrita à lista de modelos explicitamente liberados no código; atualmente, somente `@cf/google/gemma-4-26b-a4b-it` é aceito. Não cadastrar modelos com cobrança por fora dessa lista. O endpoint público `/v1/config` não revela tokens administrativos, credenciais ou segredos.

## O que continuará sendo segredo ou provisionamento de infraestrutura

Não deve ser colocado na tela de configurações comum nem enviado ao aplicativo cliente:

- `ADMIN_TOKEN`: segredo Cloudflare Worker.
- ID e binding do banco D1.
- Credenciais e tokens da conta Cloudflare.
- Qualquer chave privada ou credencial de provedor.

A lista de IDs Android permitidos (`ALLOWED_APP_IDS`) ainda é provisionada no ambiente até a próxima etapa de cadastro/gestão de aplicativos. Não aceitar um ID enviado livremente pelo cliente como prova de que o APK é oficial.

## Aplicação da migration

Antes de usar os endpoints administrativos, aplicar também a migration `0002_runtime_settings.sql` no D1. A migration ainda não foi aplicada remotamente porque o banco Cloudflare ainda não foi provisionado.


## Retenção e limpeza automática

Um Cron diário às 03:17 UTC remove registros de uso diário com mais de 35 dias e convites expirados e não utilizados com mais de 30 dias. O histórico de dispositivos é preservado para auditoria; tokens nunca são armazenados em texto puro.


## Proteção contra excesso de chamadas

O endpoint de chat aceita até 12 chamadas por dispositivo em cada minuto UTC. O controle é persistido no D1 e aplicado atomicamente por trigger SQL; a resposta para excesso é HTTP 429 com `rate_limit_exceeded`. As migrations `0004_minute_rate_limit.sql` e `0005_configurable_rate_limit.sql` criam o contador e vinculam o limite armazenado à constante usada pelo Worker. Registros antigos são removidos pelo cron diário.

## Validação efetiva do modelo

A allowlist de modelos é verificada novamente no momento da inferência. Atualmente, somente `@cf/google/gemma-4-26b-a4b-it` é aceito. Se a variável de ambiente ou a configuração persistida apontar para outro modelo, a inferência é bloqueada em vez de executar um modelo potencialmente pago.


## Tetos de segurança que não podem ser aumentados pela tela

A administração pode reduzir os limites, mas não ultrapassar os tetos definidos no código:

| Controle | Teto |
|---|---:|
| Requisições globais por dia | 50 |
| Requisições por app por dia | 25 |
| Requisições por dispositivo por dia | 10 |
| Tokens máximos de saída por resposta | 512 |
| Caracteres por mensagem | 1.500 |
| Caracteres somados por requisição | 3.000 |

Esses tetos reduzem o risco de consumo acidental, mas **não garantem** um valor máximo de Neurons nem substituem o painel de consumo e os limites da Cloudflare. A quantidade de Neurons depende do modelo e do conteúdo efetivamente processado.


## Memória privada e comunicação entre aplicativos

O Ciba AI é uma inteligência privada do proprietário e dos aplicativos autorizados por ele; não é uma plataforma de cadastro público. A arquitetura de memória distingue:

- **Memória do proprietário:** contexto central que poderá ser compartilhado com aplicativos somente por concessão explícita.
- **Memória do aplicativo:** dados isolados por `ownerId` e `appId`; outro aplicativo não pode ler ou alterar esses dados por padrão.
- **Comunicação entre aplicativos:** deve passar pelo Ciba AI como intermediário, com identidade do aplicativo de origem e destino, escopo, permissão, validade e registro de auditoria.

Os contratos e a política de autorização já estão definidos em `src/core/memory.ts`. A política exige correspondência do proprietário, concede acesso local ao escopo do próprio aplicativo e exige uma concessão explícita para memória central ou memória de outro aplicativo. Concessões podem limitar leitura/escrita e expirar.

**Estado real:** esta etapa não ativa armazenamento persistente, não cria endpoints de memória e não faz compartilhamento em produção. Ainda falta uma identidade autenticada única do proprietário, uma tela para administrar concessões e um backend com operações de exportação e exclusão. Até isso existir, nenhuma memória é gravada entre requisições e nenhum aplicativo recebe acesso aos dados de outro.

## Controles de capacidades por proprietário

Cada proprietário pode controlar as capacidades privadas por `GET /v1/owner/settings` e `POST /v1/owner/settings`, usando um dispositivo autenticado e pareado. Exemplo:

```json
{
  "settings": {
    "memory_enabled": true,
    "app_messaging_enabled": false
  }
}
```

Ambas as opções começam em `false`. Com memória desligada, as rotas de memória e a criação de concessões de memória retornam HTTP 403. Com comunicação desligada, envio, caixa de entrada, confirmação de mensagens e criação de concessões de comunicação retornam HTTP 403. Desligar não apaga dados nem revoga concessões; apenas bloqueia a capacidade até que seja reativada. A administração não aceita chaves arbitrárias nem segredos nesse endpoint. A migration `0011_owner_feature_settings.sql` precisa ser aplicada antes do uso.
