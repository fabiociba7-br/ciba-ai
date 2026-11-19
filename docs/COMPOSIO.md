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

## Execução desativada

**Nenhuma ferramenta Composio é executada pela Garcia nesta etapa.** O adaptador MCP de Composio continua somente com `initialize` e `listTools`; não expõe `callTool`. O endpoint de política apenas grava consentimento, allowlist, risco e hash do schema.

A integração existente de aprovação durável D1 já oferece base para aprovações de uso único, vinculadas à identidade, chamada e parâmetros exatos. A próxima etapa será ligar a execução Composio a essa base, revalidar schema e fingerprint em cada chamada e aplicar limites de tempo, tamanho e concorrência. Nenhuma execução deve ser habilitada antes disso.

A criação da sessão envia `proxy_execute: false`, `workbench: false`, `execute.enable_multi_execute: false` e desativa tags de escrita/destruição. Nenhuma chave deve ser colocada no aplicativo Android, no repositório ou em memória comum. A chave do projeto precisa das permissões Composio **Session management** para criar/revogar sessões e **Session tool execution** para acessar o endpoint MCP; não habilite Proxy execute ou Workbench nesta etapa. [Documentação oficial: sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp)
