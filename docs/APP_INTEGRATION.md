# Integração dos aplicativos Ciba

Este documento define o contrato que Zupi, GEIVIA e outros aplicativos Ciba devem seguir para consumir o gateway compartilhado. O endereço base só deve ser definido nos aplicativos depois do deploy aprovado do Worker.

## Princípios

- Cada aplicativo usa seu próprio identificador Android (applicationId/package ID).
- Cada instalação recebe seu próprio token de dispositivo.
- O token de dispositivo deve ser guardado no Android Keystore ou em armazenamento seguro equivalente; nunca em logs, analytics ou código-fonte.
- O código de administração e o segredo ADMIN_TOKEN nunca entram no APK.
- Convites são de uso único e devem ser entregues por um canal administrativo confiável.
- O app não deve criar projetos Cloudflare, Firebase ou Google para tentar corrigir falhas de conexão com o Ciba AI.
- Conversas não são persistidas pelo gateway. O histórico enviado deve ser controlado pelo próprio aplicativo e limitado ao contexto necessário.

## 1. Descobrir a configuração

~~~http
GET /v1/config
~~~

Resposta ilustrativa:

~~~json
{
  "service": "ciba-ai",
  "ai_enabled": true,
  "model": "@cf/google/gemma-4-26b-a4b-it",
  "maintenance_mode": false,
  "limits": {
    "global_daily": 50,
    "app_daily": 25,
    "device_daily": 10,
    "max_output_tokens": 512
  }
}
~~~

Se ai_enabled for falso ou maintenance_mode verdadeiro, o app deve apresentar indisponibilidade de forma clara e não iniciar tentativas repetidas.

## 1.1 Descobrir capacidades da inteligência

~~~http
GET /v1/ai/capabilities
~~~

O endpoint informa o provider efetivamente configurado, o modo de execução, os perfis especialistas disponíveis e se memória persistente, ferramentas externas ou fan-out multi-modelo estão habilitados. Nesta versão, o modo é single-pass e usa uma única inferência por chamada.

## 2. Registrar uma instalação

O app recebe um convite de uso único emitido pelo administrador e chama:

~~~http
POST /v1/auth/register
Content-Type: application/json

{
  "app_id": "com.exemplo.app",
  "invitation_code": "CONVITE_RECEBIDO"
}
~~~

Resposta HTTP 201:

~~~json
{
  "device_id": "uuid",
  "access_token": "TOKEN_SECRETO",
  "token_type": "Bearer"
}
~~~

O token é mostrado apenas nessa resposta. O cliente deve armazená-lo imediatamente em armazenamento seguro. Não deve ser exibido em telas, copiado para clipboard ou enviado em relatórios de erro. Se a resposta for perdida depois do consumo do convite, o administrador deve revogar o dispositivo se necessário e emitir um novo convite; não reutilize o convite consumido.

## 3. Enviar uma mensagem

~~~http
POST /v1/ai/chat
Authorization: Bearer TOKEN_DO_DISPOSITIVO
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Olá!" }
  ]
}
~~~

Resposta de sucesso contém model, response e intelligence (agent, strategy, provider e inference_calls). O cliente pode ignorar intelligence se não precisar exibir diagnóstico. O campo response é texto consolidado pelo núcleo Ciba AI.

Regras atuais:
- até 20 mensagens por requisição;
- até 1.500 caracteres por mensagem;
- até 3.000 caracteres somados;
- até 12 chamadas por minuto por dispositivo;
- cotas diárias globais, por aplicativo e por dispositivo.

## 4. Consultar consumo

~~~http
GET /v1/usage
Authorization: Bearer TOKEN_DO_DISPOSITIVO
~~~

A resposta informa o dia UTC e os contadores disponíveis para os escopos global, aplicativo e dispositivo. Não presuma que o limite diário seja uma franquia individual de neurônios; é um controle interno de requisições.

## 5. Tratamento de erros

| HTTP | Código | Comportamento esperado |
|---|---|---|
| 400 | invalid_json, invalid_message | Corrigir o payload; não repetir sem alteração |
| 401 | unauthorized, invalid_or_used_invitation | Revalidar cadastro; solicitar novo convite se necessário |
| 403 | app_not_allowed | Interromper e solicitar habilitação administrativa do app |
| 413 | body_too_large, prompt_too_large | Reduzir o conteúdo enviado |
| 429 | daily_quota_exceeded, rate_limit_exceeded | Respeitar a janela de renovação; aplicar espera e evitar repetição agressiva |
| 503 | maintenance_mode, ai_disabled, ai_model_not_available | Informar indisponibilidade e permitir nova tentativa manual |
| 500 | internal_error | Exibir mensagem genérica; registrar apenas código HTTP e identificador de correlação local, nunca conteúdo/token |

## 6. Regras para repetição e conexão

- Não repetir automaticamente uma chamada de chat após timeout sem avaliar o risco de duplicar a resposta e consumir outra cota.
- Para HTTP 429, respeitar o cabeçalho HTTP `Retry-After` e o campo `retry_after_seconds` quando presentes; para cota diária, aguardar a virada do próximo dia UTC.
- Para HTTP 401, não entrar em loop de cadastro.
- Para falhas de rede, usar backoff exponencial limitado e oferecer nova tentativa manual.
- Nunca criar outro projeto ou outro vínculo OAuth como tentativa automática de corrigir erro do gateway.

## 7. Pendências antes de liberar os clientes

- Confirmar o package ID real de cada aplicativo.
- Provisionar Worker e D1, aplicar todas as migrations e configurar ADMIN_TOKEN como secret do Worker.
- Restringir origens CORS caso exista cliente web.
- Definir a política de distribuição dos convites.
- Testar cadastro, armazenamento seguro, revogação, cotas e inferência em ambiente real.
- Avaliar atestação de integridade do app; o campo app_id sozinho não comprova que o APK é oficial.


O Worker aplica também tetos globais de segurança: 50 requisições/dia, 25 por app/dia, 10 por dispositivo/dia e até 512 tokens de saída. Esses valores podem ser reduzidos pela administração, mas não aumentados pela API de configurações.
