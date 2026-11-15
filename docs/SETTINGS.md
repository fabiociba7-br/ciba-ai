# Configuração administrativa do Ciba AI

O Ciba AI separa configurações operacionais de segredos. As configurações editáveis ficam na tabela D1 `runtime_settings` e poderão ser controladas por uma futura tela **Configurações** nos aplicativos ou num painel administrativo.

## Cadastro de aplicativos pela API

- `GET /v1/admin/apps`: lista os aplicativos registrados.
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
    "daily_global_limit": 500,
    "daily_app_limit": 200,
    "daily_device_limit": 40,
    "max_output_tokens": 700,
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
| `max_output_tokens` | número | Limite de tokens de saída (máximo efetivo 2.000) |
| `maintenance_mode` | boolean | Bloqueia temporariamente chamadas de chat |

Os valores salvos no D1 prevalecem sobre os valores padrão em `wrangler.toml`. A API valida os tipos e os limites antes de gravar. O endpoint público `/v1/config` não revela tokens administrativos, credenciais ou segredos.

## O que continuará sendo segredo ou provisionamento de infraestrutura

Não deve ser colocado na tela de configurações comum nem enviado ao aplicativo cliente:

- `ADMIN_TOKEN`: segredo Cloudflare Worker.
- ID e binding do banco D1.
- Credenciais e tokens da conta Cloudflare.
- Qualquer chave privada ou credencial de provedor.

A lista de IDs Android permitidos (`ALLOWED_APP_IDS`) ainda é provisionada no ambiente até a próxima etapa de cadastro/gestão de aplicativos. Não aceitar um ID enviado livremente pelo cliente como prova de que o APK é oficial.

## Aplicação da migration

Antes de usar os endpoints administrativos, aplicar também a migration `0002_runtime_settings.sql` no D1. A migration ainda não foi aplicada remotamente porque o banco Cloudflare ainda não foi provisionado.
