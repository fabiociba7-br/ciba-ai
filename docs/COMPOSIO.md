# Composio na Garcia

A integração Garcia↔Composio é independente da conexão ChatGPT↔Composio que o proprietário já configurou no ChatGPT. Uma conexão não concede credenciais nem permissões à outra.

## Estado implementado

- Sessão Composio individual por proprietário, com identificador pseudônimo estável derivado do owner ID.
- Criação exige token de dispositivo Garcia, proprietário ativo, controle CibaGênio `external_tools` habilitado e `consent: true`.
- O proprietário informa uma lista explícita de até dez toolkits; lista vazia é válida.
- O backend guarda apenas o session ID e a lista de toolkits. A chave de API fica exclusivamente no secret `COMPOSIO_API_KEY` do Worker.
- Revogação remota e marcação local da sessão como revogada.
- Reanexação à sessão existente antes da descoberta MCP; URL e session ID são validados e nunca enviados ao aplicativo.
- Descoberta de até 32 ferramentas por `GET /v1/owner/composio/tools`.
- Catálogo de permissões individual por proprietário, persistido em D1 pela migração `0023_owner_composio_tool_policies.sql`.
- Classificação local de risco e fingerprint SHA-256 do schema de cada ferramenta.
- Revogar ou substituir uma sessão desativa as permissões locais antigas.

## Política por ferramenta

O endpoint `GET /v1/owner/composio/tools` lista as ferramentas descobertas e informa:

- `toolkit`: toolkit de origem reconhecido pela sessão ativa;
- `risk`: `read`, `write` ou `external`;
- `requires_approval`: exigência de aprovação individual;
- `eligible`: se o namespace da ferramenta corresponde a um toolkit explicitamente habilitado;
- `enabled`: se o proprietário já autorizou localmente aquela ferramenta.

A classificação é conservadora e calculada no servidor:
- Ferramenta só é `read` quando o nome contém uma ação conhecida de leitura e o provedor marca `readOnlyHint: true`, sem `destructiveHint`.
- Verbos de escrita ou destruição são classificados como `write`, mesmo se a anotação remota alegar somente leitura.
- Ação desconhecida, nome não reconhecido ou falta de anotação confiável resulta em `external`.
- `write` e `external` sempre recebem `requires_approval: true`.
- Anotações, nomes, descrições e schemas vindos do provedor são dados não confiáveis; não podem reduzir a classificação nem conceder permissões.

O proprietário seleciona a allowlist individual com:

`POST /v1/owner/composio/policy`

Corpo esperado:

```json
{
  "consent": true,
  "tools": ["GMAIL_LIST_EMAILS", "GMAIL_SEND_EMAIL"]
}
```

A lista substitui a allowlist anterior. Nomes duplicados, desconhecidos ou que não pertençam a um toolkit da sessão são recusados. O servidor recalcula risco e hash do schema; o cliente não pode definir esses valores. Enviar `tools: []` com `consent: true` revoga todas as permissões locais sem depender de disponibilidade da API Composio.

`GET /v1/owner/composio/policy` consulta as permissões gravadas. As rotas exigem dispositivo Garcia autenticado, proprietário ativo e `external_tools` habilitado.

## Execução controlada e aprovações

O endpoint `POST /v1/owner/composio/invoke` conecta a allowlist local ao registro de ferramentas e ao armazenamento de aprovações duráveis. Ele exige dispositivo Garcia autenticado, proprietário ativo, controle `external_tools`, sessão ativa e ferramenta habilitada pelo próprio proprietário.

O fluxo tem três ações explícitas:

1. `propose`: valida argumentos contra o schema atual. Para risco `read`, apenas prepara a chamada; para `write` ou `external`, cria uma aprovação D1 de uso único com validade de cinco minutos.
2. `approve`: registra a decisão explícita do proprietário, vinculada ao mesmo proprietário, app, dispositivo de origem, conversa, invocação, ferramenta, argumentos e fingerprint do schema.
3. `execute`: reanexa à sessão, redescobre a ferramenta, recalcula risco e hash do schema, verifica novamente a permissão local e, para risco `write`/ `external`, consome atomicamente a aprovação antes da chamada MCP. A aprovação não pode ser reutilizada.

Exemplo de proposta:

```json
{
  "action": "propose",
  "tool_name": "GMAIL_SEND_EMAIL",
  "conversation_id": "conversation-123",
  "invocation_id": "invocation-456",
  "input": {
    "to": "destinatario@example.com",
    "subject": "Assunto",
    "body": "Mensagem"
  }
}
```

Para responder à aprovação, envie `action: "approve"`, o mesmo `tool_name`, `conversation_id`, `invocation_id` e `input`, além de `approval_id` e `allow: true` (ou `false`). A execução exige os mesmos campos e `approval_id`. Uma mudança no schema, risco, argumentos, sessão ou permissão invalida o fluxo.

O cliente MCP continua deny-by-default: uma chamada só pode alcançar uma ferramenta incluída na allowlist da invocação; ferramentas de escrita/destruição só passam pela barreira MCP quando o servidor autoriza aquele nome após consumir a aprovação. Limites de payload, schema, resposta, tempo e concorrência são aplicados pelo registro local. A chamada não é feita durante proposta ou aprovação.

**Atenção:** execução remota agora existe apenas através desse endpoint controlado. Ela não foi conectada automaticamente ao fluxo de chat/modelo nem permite que o modelo invoque ferramentas sem uma proposta explícita e os controles do servidor. A chave Composio continua exclusivamente no Worker.

A criação da sessão envia `proxy_execute: false`, `workbench: false`, `execute.enable_multi_execute: false` e desativa tags de escrita/destruição. Nenhuma chave deve ser colocada no aplicativo Android, no repositório ou em memória comum. A chave do projeto precisa das permissões Composio **Session management** para criar/revogar sessões e **Session tool execution** para acessar o endpoint MCP; não habilite Proxy execute ou Workbench nesta etapa. [Documentação oficial: sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp)
