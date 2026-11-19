# Composio na Garcia

A integração Garcia↔Composio é independente da conexão ChatGPT↔Composio que o proprietário já configurou no ChatGPT. Uma conexão não concede credenciais nem permissões à outra.

## Estado implementado

- Sessão Composio individual por proprietário, com identificador pseudônimo estável derivado do owner ID.
- Criação exige token de dispositivo Garcia, proprietário ativo, controle CibaGênio `external_tools` habilitado e `consent: true`.
- O proprietário informa uma lista explícita de até dez toolkits; lista vazia é válida.
- O backend guarda apenas o session ID e a lista de toolkits. A chave de API fica exclusivamente no secret `COMPOSIO_API_KEY` do Worker.
- Revogação remota e marcação local da sessão como revogada.
- Descoberta de ferramentas por `GET /v1/owner/composio/tools`, autenticada e limitada à sessão ativa do proprietário.
- A descoberta retorna no máximo 32 descrições e schemas, sem expor chave, URL MCP ou session ID.

## Execução desativada

Nesta etapa, a integração é somente de gerenciamento de sessão e descoberta. O adaptador Composio não expõe `callTool`. A criação de sessão envia `proxy_execute: false`, `workbench: false`, `execute.enable_multi_execute: false` e desativa tags de escrita/destruição. Nenhuma ferramenta remota é executada pela Garcia.

A descoberta de ferramentas externas é dado não confiável. Antes de qualquer execução futura, cada ferramenta deverá passar por allowlist local explícita, classificação de risco, autorização do proprietário, aprovação quando necessária, validação de schema e limites de execução.

## Endpoints

- `GET /v1/owner/composio/session`: consulta o estado da sessão do proprietário.
- `POST /v1/owner/composio/session`: cria sessão; exige `consent: true` e `toolkits: string[]`.
- `DELETE /v1/owner/composio/session`: revoga a sessão ativa.
- `GET /v1/owner/composio/tools`: inicializa a sessão MCP e lista ferramentas; não executa chamadas.

Todos exigem dispositivo Garcia autenticado, proprietário ativo e `external_tools` habilitado. Se `COMPOSIO_API_KEY` não estiver configurada como secret do Worker, as operações remotas retornam `composio_server_not_configured`. Nenhuma chave deve ser colocada no aplicativo Android, no repositório ou em memória comum. A chave do projeto também precisa das permissões Composio **Session management** para criar/revogar sessões e **Session tool execution** para acessar o endpoint MCP; não habilite Proxy execute ou Workbench para esta etapa. <Link url="https://docs.composio.dev/docs/sessions-via-mcp" title="Documentação oficial: sessions via MCP" />

## Próxima fronteira

A próxima etapa é desenhar a política local de ferramentas: seleção individual por nome, classificação read/write/destructive, consentimento por toolkit e aprovação por chamada. Só depois dessa revisão será possível habilitar execução de ferramentas, sem ativá-la por padrão.
