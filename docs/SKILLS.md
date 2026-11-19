# Biblioteca de skills da Garcia

A biblioteca inicial contém skills internas declarativas, versionadas no repositório e selecionadas pelo papel do agente e pelo pedido mais recente do usuário.

## Skills incluídas

| ID | Papel | Finalidade |
|---|---|---|
| `task-planning` | general, reasoning | Planejamento, etapas e critérios de conclusão |
| `research-synthesis` | research, reasoning | Pesquisa, evidências e síntese |
| `software-engineering` | coding | Implementação e correção com testes |
| `repository-audit` | verification, coding | Auditoria técnica e de segurança |
| `technical-writing` | creative, general | Documentação técnica |

## Seleção e limites

- Cada agente recebe no máximo duas skills.
- Papéis general, reasoning, research, coding e verification têm uma skill padrão; creative usa somente skills ativadas por correspondência temática.
- Uma segunda skill só entra quando gatilhos do pedido mais recente correspondem ao catálogo.
- As instruções combinadas têm limite de 4.000 caracteres.
- A seleção é determinística e não faz chamadas adicionais ao modelo.
- O endpoint administrativo `GET /v1/admin/ai/overview` lista metadados, versões e papéis, sem expor os corpos das instruções.

## Segurança

As skills são instruções declarativas embutidas no código. Não são scripts, plugins executáveis ou comandos de terminal. O catálogo é congelado em runtime; o formatador resolve cada ID novamente contra o catálogo confiável e descarta conteúdo externo ou IDs desconhecidos.

Uma skill não:
- concede acesso a ferramentas;
- altera permissões, grants ou aprovações;
- instala modelos ou baixa pesos;
- executa código;
- substitui as regras de identidade, autorização ou segurança do orquestrador.

A execução de ferramentas continua sob o registro, allowlist, isolamento de agente, autorização do servidor e fluxo de aprovação já existentes.

## Evolução planejada

A próxima evolução poderá adicionar importação e atualização controlada de skills externas, com revisão de origem/licença, hash/versionamento, validação de instruções, escopo por agente e aprovação do proprietário. Skills externas não devem ser carregadas diretamente de um repositório ou servidor MCP para o prompt sem essa etapa de revisão.

Composio permanece uma integração separada da conexão ChatGPT↔Composio já existente. A integração Garcia↔Composio será planejada na camada de ferramentas, após esta base de skills.
