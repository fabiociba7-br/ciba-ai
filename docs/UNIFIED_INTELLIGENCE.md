# Ciba AI — Inteligência Unificada

## Objetivo

Construir uma experiência de IA única, com identidade, políticas, roteamento, memória controlada e ferramentas comuns, sem amarrar o produto a um único modelo ou fornecedor.

A unificação inicial é feita na camada de software. Não há fusão dos pesos dos modelos nem treinamento de um modelo fundido. Isso exigiria infraestrutura de GPU, dados licenciados, avaliação e orçamento próprios.

## O que existe nesta entrega

- Ciba Core: identidade e orquestrador central.
- Task Router: seleção determinística de um perfil especialista a partir da solicitação.
- Agent Catalog: perfis generalista, raciocínio, pesquisa, programação, criação e verificação.
- Provider interface: contrato comum para diferentes mecanismos de inferência.
- Provider registry: catálogo em memória de providers e modelos, com seleção por especialidade, verificação de provider habilitado e aprovação explícita para uso no caminho de custo zero.
- Cloudflare Workers AI adapter: provedor atualmente ativo.
- OpenAI-compatible adapter: base para endpoints auto-hospedados compatíveis, como Ollama, vLLM ou LM Studio.
- Memory adapter: contexto limitado à conversa atual, sem persistência de conteúdo.
- GET /v1/ai/capabilities: informa as capacidades realmente habilitadas.

## Transparência sobre agentes

Os perfis especialistas atuais são instruções especializadas selecionadas pelo roteador e executadas pelo mesmo modelo em uma chamada. Eles não são seis modelos independentes. O endpoint de capacidades deixa explícito que o modo atual é single-pass.

Foi adicionada uma primitiva opt-in de ensemble multi-modelo (`src/core/ensemble.ts`): ela exige ao menos duas combinações distintas de provider/modelo, aprovação explícita de custo zero para cada modelo, limita a três chamadas de especialistas e uma chamada de síntese, valida o tamanho da entrada e dos relatórios, e aplica um orçamento agregado máximo de 2.048 tokens de saída solicitados por execução. Falhas individuais de especialistas podem ser isoladas, mas a síntese só ocorre se ao menos um relatório for concluído. Ela permanece fora do fluxo público. O registro de providers (`src/core/providers/registry.ts`) agora cataloga modelos, valida papéis e limites, e só seleciona modelos marcados como aprovados para custo zero. O fluxo de chat usa esse registro para resolver o provider Cloudflare e o modelo atualmente permitido; o overview administrativo mostra o catálogo efetivamente configurado. O adapter OpenAI-compatible continua preparado, mas não conectado nem configurado. Não há providers externos configurados, credenciais, orçamento por provider nem autorização para encaminhar dados a terceiros. Portanto, a colaboração real entre modelos permanece desativada.

## Fluxo atual

1. O Worker autentica o dispositivo e valida limites.
2. O roteador seleciona um perfil especialista sem fazer chamada adicional.
3. O orquestrador constrói instruções de identidade e contexto.
4. Um provider habilitado executa uma inferência.
5. A resposta é devolvida com metadados mínimos de agente, provider e estratégia.
6. O gateway não persiste prompts nem respostas.

## Próxima evolução multi-modelo

A primitiva de ensemble possui testes automatizados para modo desligado, diversidade de modelos, aprovação de custo zero, limites de entrada e orçamento agregado. A CI executa esses testes; não foi feita execução manual nesta etapa. A ativação no produto deverá ocorrer somente após inventário dos modelos e licenças, medição de latência/qualidade/contexto/consumo, limites por provider, secrets exclusivamente no servidor, avaliação de custo e controle administrativo explícito. O fluxo público continua em `single-pass`: não há ainda dois modelos distintos configurados, e o modo de colaboração não foi ativado.

## Memória privada e comunicação entre apps

O Ciba AI é uma inteligência privada do proprietário e dos aplicativos autorizados por ele. A arquitetura de memória separa três níveis:

1. **Memória do proprietário:** contexto central, disponível a um aplicativo somente quando houver uma concessão explícita do proprietário.
2. **Memória do aplicativo:** dados isolados por proprietário e `appId`; o aplicativo dono pode acessar seu próprio escopo, mas outros aplicativos não recebem acesso automaticamente.
3. **Memória compartilhada entre apps:** um aplicativo pode receber acesso de leitura ou escrita ao escopo de outro aplicativo somente por uma concessão específica, que pode expirar.

A base de política em `src/core/memory.ts` define escopos, concessões, permissões, validade, contrato de armazenamento e validação de itens curados. A validação rejeita alguns padrões óbvios de credenciais, mas não é um detector geral de dados sensíveis. O conteúdo precisa ser curado explicitamente; conversas brutas não são transformadas em memória automaticamente.

**Estado efetivo:** o fluxo de chat ainda usa apenas o contexto limitado da requisição atual e não persiste prompts nem respostas. A identidade privada do proprietário, o pareamento e a API de concessões estão implementados no código, mas dependem das migrations e do deploy para funcionar no ambiente real. O relay de mensagens agora tem fila D1, endpoints de envio/caixa de entrada/confirmação e exige concessões ativas de envio e recebimento para o mesmo proprietário, origem, destino e escopo. O relay também depende da migration 0009 e de deploy; portanto, ainda não está ativo em produção. Não existe memória persistente. Nenhum dado de um app é repassado a outro por padrão.

## Consolidação de tarefas entre aplicativos

O fluxo de resultados possui uma camada determinística de consolidação (src/core/task-results.ts). Ao consultar os resultados correlacionados de uma tarefa, Garcia compara as estruturas JSON retornadas pelos apps, contabiliza respostas concluídas/parciais/falhas e identifica concordância exata ou divergência. Se houver divergência, não escolhe um resultado nem inventa uma resposta combinada; mantém a proveniência por aplicativo e deixa o consenso vazio. A comparação ignora apenas a ordem das chaves dos objetos JSON.

Essa etapa não adiciona chamadas de IA, não ativa ensemble ou modelos externos e não altera o modo de inferência atual (single-pass). Portanto, ela não acrescenta custo de inferência. Uma futura síntese semântica exigirá uma etapa separada, orçamento explícito, modelo aprovado para custo zero e testes específicos; não está ativada aqui.

## Ferramentas e MCP

O núcleo foi organizado para receber ferramentas através de uma interface controlada. Nenhuma ferramenta externa é executada automaticamente nesta versão. Os contratos tipados de ferramentas foram criados em `src/core/tools`, mas não existe ferramenta registrada. A futura camada deverá usar allowlist, schemas validados, escopos mínimos, timeouts e aprovação explícita para ações irreversíveis.

## Segurança de provedores

- Não colocar API keys nos aplicativos.
- Não permitir que usuário final escolha URL arbitrária de provider.
- Usar somente endpoints HTTPS confiáveis e previamente cadastrados.
- Definir timeout, limite de resposta e rate limit por provider.
- Não encaminhar dados pessoais para provedores externos sem política e consentimento adequados.

## Projetos open source avaliados como referências

Os projetos abaixo são referências de arquitetura, não código incorporado nesta entrega. Não copiamos nem vendorizamos seus repositórios. Isso evita adicionar dependências pesadas e preserva a possibilidade de auditar licenças e compatibilidade antes de incorporar código.

| Projeto | Papel que inspira | Decisão |
|---|---|---|
| LangGraph | Fluxos com estado, checkpoints e orquestração | Adotar conceitos; implementação leve própria no Worker |
| CrewAI | Perfis especialistas e delegação | Adotar catálogo de especialistas; sem runtime Python no Worker |
| Ollama | Inferência local e gestão de modelos | Suportar futuramente via adapter OpenAI-compatible em rede privada |
| LiteLLM | Interface uniforme entre provedores | Adotar contrato interno ModelProvider; sem instalar gateway extra |
| Hugging Face | Catálogo de modelos e artefatos | Usar como fonte de avaliação; verificar licença/model card por modelo |

A licença de cada modelo é independente da licença do framework. Antes de distribuir ou hospedar pesos, conferir model card, licença, restrições comerciais e requisitos de atribuição.

## Limitações atuais

- Somente Cloudflare Workers AI está conectado ao fluxo de produção.
- O adapter OpenAI-compatible é uma base técnica e não está ativado.
- O Worker não executa modelos grandes localmente.
- Ollama em localhost do usuário não é acessível pelo Worker Cloudflare; seria necessário endpoint privado/rede segura ou agente local.
- Não existe treinamento, fine-tuning ou fusão de pesos nesta entrega.
- Nenhum deploy Cloudflare foi realizado.


## Concessões de acesso entre apps — fundação

A migration `0008_explicit_app_access_grants.sql` prepara concessões persistentes com uma linha por permissão e escopo. O contrato em `src/core/access-grants.ts` exige correspondência exata de proprietário, app solicitante, par de apps quando aplicável, permissão e escopo; expiração e revogação são verificadas com negação por padrão. As permissões são separadas para envio, recebimento, leitura e escrita de memória. A memória de um app e a memória do proprietário são escopos distintos.

A fundação de esquema e política foi seguida pela API autenticada do proprietário para criar, consultar e revogar concessões. A migration 0008 ainda precisa ser aplicada no D1 antes do uso em ambiente real.


## API privada de gerenciamento de concessões

Dispositivos pareados a um proprietário ativo agora podem administrar as concessões por `GET/POST /v1/owner/access-grants` e revogar por `POST /v1/owner/access-grants/revoke`. O gateway deriva a identidade do proprietário do token autenticado e limita a validade de cada concessão a no máximo 8.760 horas (padrão de 720). O controle é por permissão e aplicativo, não por acesso irrestrito. Os endpoints foram documentados em `docs/ACCESS_GRANTS.md`.

A API não ativa o relay nem a memória persistente. A migration 0008 ainda precisa ser aplicada e o Worker publicado antes que os endpoints possam ser usados em um ambiente real. Não há tela visual de gerenciamento nesta etapa.


## Relay de mensagens entre aplicativos

A fila privada foi implementada em `migrations/0009_private_app_message_queue.sql`. Os endpoints são `POST /v1/apps/messages`, `GET /v1/apps/messages/inbox` e `POST /v1/apps/messages/ack`. O envio exige permissões `send` e `receive` ativas para o mesmo proprietário, origem, destino e escopo. A caixa de entrada deriva o app e o proprietário do dispositivo autenticado e revalida as concessões em cada leitura. Mensagens têm chave de idempotência, payload JSON limitado, validade máxima de 72 horas e limite de 100 pendentes por app de destino. A fila transporta dados; não executa instruções nem ferramentas.

**Estado de ativação:** código e testes estão no GitHub, mas a migration 0009 não foi aplicada e não houve deploy. O relay ainda não está ativo em produção. Consulte `docs/APP_MESSAGE_RELAY.md`.


## Cliente comum para os aplicativos

O SDK TypeScript em `src/client.ts` padroniza chamadas ao status, configuração, capacidades, chat, pareamento do proprietário, mensagens entre apps e concessões de acesso. Cada app fornece seu token sob demanda por uma função de callback, mantendo o armazenamento seguro sob responsabilidade da plataforma. O cliente não aceita `owner_id` fornecido pelo app e não substitui as verificações do Worker. A biblioteca está pronta para reutilização em projetos TypeScript; integrações nativas Kotlin/Swift e integração automática nos apps ainda não foram feitas. Consulte `docs/CLIENT_SDK.md`.

## Memória privada persistente (etapa 12)

A migration `0010_private_memory_records.sql` e a API `/v1/owner/memory` adicionam armazenamento curado separado por aplicativo e por proprietário. Leitura e gravação de memória de outro app ou da memória central exigem concessões ativas e específicas. A identidade do proprietário e do app vem do dispositivo autenticado; o cliente não escolhe o proprietário. Conversas completas não são armazenadas automaticamente. A migration ainda não foi aplicada e o Worker não foi publicado.

## Controles do proprietário

As capacidades de memória persistente e comunicação entre aplicativos agora têm interruptores independentes por proprietário. Ambos começam desativados e só podem ser alterados por dispositivos pareados. As verificações são feitas no servidor em cada rota; não dependem da interface do aplicativo. Desativar uma capacidade bloqueia seu uso sem apagar registros ou revogar concessões existentes. Consulte `docs/SETTINGS.md`.


## Recuperação contextual da memória (etapa 24)

O endpoint autenticado `POST /v1/owner/memory/retrieve` recupera itens curados relevantes para uma consulta. A classificação é lexical e determinística, com pontuação maior para termos presentes na chave e na informação armazenada. Não usa embeddings, não chama modelo e não gera custo de inferência.

A consulta considera a memória do próprio app e inclui memória central ou de outros apps somente quando existe concessão ativa de leitura para o dispositivo/app solicitante. O proprietário ativo, o interruptor `memory_enabled`, a expiração e a exclusão são verificados no servidor. A busca limita a leitura a 200 registros e devolve até 20 resultados. Não persiste a consulta nem altera dados.

A recuperação é uma API explícita do SDK (`retrieveMemory`); nesta etapa, o chat normal não injeta memórias automaticamente. Isso evita enviar contexto privado a uma inferência sem uma integração explícita e testada em etapa posterior. Não há migration nova.
