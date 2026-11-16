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
- Memory adapter: contexto da conversa atual e memória persistente curada por proprietário/app, com recuperação lexical contextual e permissões explícitas; o chat injeta automaticamente apenas itens relevantes e autorizados quando a memória está habilitada.
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

**Estado efetivo:** o fluxo de chat usa o contexto limitado da requisição atual e, quando a memória está habilitada para um proprietário pareado ativo, acrescenta até cinco itens curados relevantes e autorizados (máximo de 1.800 caracteres de itens). Memórias do próprio app são elegíveis; memórias centrais ou de outros apps só entram com concessão ativa de leitura. O conteúdo é rotulado como dado não confiável, nunca como instrução. O gateway não persiste prompts nem respostas e não grava memórias automaticamente. A memória persistente curada tem migration, API de leitura/gravação/exclusão e recuperação contextual determinística; seu uso em ambiente real depende das migrations 0007–0011 e do deploy, ainda não realizados. O relay de mensagens também depende da migration 0009 e de deploy; portanto, não está ativo em produção. Nenhum dado de um app é repassado a outro por padrão.

## Consolidação de tarefas entre aplicativos

O fluxo de resultados possui uma camada determinística de consolidação (src/core/task-results.ts). Ao consultar os resultados correlacionados de uma tarefa, Garcia compara as estruturas JSON retornadas pelos apps, contabiliza respostas concluídas/parciais/falhas e identifica concordância exata ou divergência. Se houver divergência, não escolhe um resultado nem inventa uma resposta combinada; mantém a proveniência por aplicativo e deixa o consenso vazio. A comparação ignora apenas a ordem das chaves dos objetos JSON.

A síntese semântica opcional foi adicionada em `POST /v1/apps/tasks/synthesize`, com até 20 resultados, entrada limitada a 12.000 caracteres, saída até 384 tokens e uma única chamada no modelo aprovado para custo zero. Ela não ativa ensemble ou modelos externos e não altera o chat normal. Consome os limites de uso do dispositivo e ainda depende do deploy para ficar disponível em produção.

## Ferramentas e MCP

O protocolo de propostas foi conectado opcionalmente ao orquestrador central. Quando um chamador confiável fornece um registro de ferramentas e contexto de invocação, o modelo recebe somente contratos allowlisted e pode emitir um envelope `CIBA_TOOL_CALL_V1`. O núcleo valida o envelope e o schema via `registry.prepare`, devolvendo apenas uma prévia. Não há execução automática, nem callback de autorização durante a preparação. O Worker público ainda não injeta um registro de ferramentas; a ativação depende de aprovações duráveis de uso único, endpoints autenticados e confirmação em interface confiável. O consentimento atual em memória não é suficiente para esse fluxo em ambiente serverless.

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

A recuperação também é utilizada pelo chat normal de forma contextual, conforme a etapa 25. Não há migration nova nesta etapa.


## Injeção contextual de memória no chat (etapa 25)

No chat normal, a última mensagem do usuário é usada como consulta lexical (até 500 caracteres). Se o dispositivo estiver pareado a um proprietário ativo e `memory_enabled` estiver ligado, o Worker busca até 200 registros não expirados e não excluídos que o app autenticado pode ler. São elegíveis a memória do próprio app e, somente com concessão `memory_read` vigente, a memória de outros apps ou do proprietário.

A classificação é determinística e não faz chamada extra de inferência. Até cinco itens relevantes são acrescentados ao contexto de sistema, com limite de 1.800 caracteres para os itens. O prompt identifica esses registros como dados não confiáveis, não como instruções, e orienta a ignorar comandos contidos neles e considerar possível desatualização. Sem proprietário ativo, com memória desligada ou sem correspondências, o chat segue sem memória adicional. Não há gravação automática, histórico persistido, migration nova ou aumento do limite de tokens de saída.


## Aprendizado curado com confirmação explícita (etapa 26)

O endpoint autenticado `POST /v1/owner/memory/candidates` prepara uma proposta de memória a partir de um trecho fornecido pelo app. O app deve indicar `source_role: "user"`; a API rejeita conteúdo atribuído ao assistente e exige que o valor proposto seja um trecho verificável do texto do usuário (comparação sem distinção de acentos/caixa e com espaços normalizados). Chaves e valores passam pelas mesmas validações da memória curada, incluindo rejeição de padrões óbvios de credenciais.

A proposta é apenas uma prévia: `stored: false`, `persisted: false`, `requires_confirmation: true`. A API não grava o texto de origem, não cria memória, não chama IA e não registra histórico. O app deve mostrar a proposta ao proprietário e, somente após confirmação explícita, chamar a API existente `POST /v1/owner/memory` com `consent: "curated"`. O escopo do proprietário exige concessão ativa `memory_write`; o escopo do app é limitado ao próprio app. A preparação respeita o interruptor de memória e a identidade pareada do dispositivo.


## Gerenciamento de memória curada (etapa 27)

A API autenticada de memória agora oferece busca textual por chave/conteúdo via `GET /v1/owner/memory?scope=app&q=...` e `scope=owner`, com opção `include_expired=true` para revisar registros expirados. O limite continua em 200 registros por escopo. Edição usa `PATCH /v1/owner/memory?scope=...` com `memory_id`, `key`, `value`, `consent: "curated"` e validade opcional. `valid_hours: null` remove a expiração; um inteiro de 1 a 8760 renova/define a validade; omitir mantém a validade atual. Exclusão continua sendo lógica (soft delete), removendo imediatamente o registro das consultas e da recuperação contextual.

O painel privado inclui busca, seleção entre memória do app e memória central, opção para mostrar expiradas, edição e exclusão. Cada escopo mantém a autorização existente: o próprio app pode gerenciar sua memória; memória central ou de outro app exige concessão ativa de leitura/escrita correspondente. O endpoint não oferece acesso cruzado implícito. Nenhuma migration nova foi necessária.


## Aprendizado contínuo com revisão do proprietário (etapa 28)

O endpoint autenticado `POST /v1/owner/memory/reviews?scope=app|owner` recebe uma proposta baseada em trecho literal atribuído pelo aplicativo ao usuário. A API valida a proposta e a compara com a memória ativa de mesma chave: `new` (não existe registro), `unchanged` (mesmo valor após normalização) ou `possible_conflict` (valor diferente). A classificação é determinística e não afirma que uma informação é verdadeira ou falsa.

As propostas ficam em uma fila privada e limitada a 100 itens pendentes por proprietário. `GET /v1/owner/memory/reviews` lista propostas pendentes; `PATCH` com `decision: approve|reject` registra a decisão do proprietário. Somente a aprovação grava ou atualiza a memória curada. Antes de substituir um registro em conflito, o servidor confere se o valor atual ainda corresponde ao valor observado quando a proposta foi criada; caso contrário, marca a proposta como obsoleta e exige nova revisão. Propostas rejeitadas não alteram a memória.

A fila guarda somente a informação proposta e o trecho de evidência correspondente (máximo de 500 caracteres), não a conversa completa nem o texto de origem integral. O app informa `source_role: user`; o servidor não consegue autenticar independentemente esse papel, portanto a interface do aplicativo precisa garantir que a evidência seja realmente uma fala do usuário. A aprovação deve ser uma ação explícita do proprietário.

O fluxo não treina nem ajusta pesos do modelo, não cria histórico de chat e não chama IA: comparação e classificação são determinísticas (`inference_calls: 0`). A migration `0013_memory_review_proposals.sql` precisa ser aplicada e o Worker publicado antes de o recurso ficar disponível em produção.


## Análise de relações entre memórias (etapa 29)

O endpoint autenticado `GET /v1/owner/memory/insights` analisa até 200 registros não excluídos que o aplicativo atual pode ler: memória do próprio app e registros de outros apps ou da memória central somente quando existe uma concessão ativa de `memory_read` no escopo correspondente. Registros expirados também podem aparecer no grupo de revisão para que o proprietário decida o que fazer.

A análise é determinística e não chama IA. Ela apresenta:
- **Possíveis conflitos:** mesma chave normalizada com valores diferentes. Isso é um alerta, não uma conclusão sobre qual valor é correto.
- **Assuntos relacionados:** pares com sobreposição lexical suficiente de termos.
- **Registros para revisão:** itens expirados ou sem atualização há pelo menos 180 dias.

O painel privado mostra os alertas e suas origens. Nada é unido, alterado, renovado ou excluído automaticamente. O endpoint retorna `inference_calls: 0` e `automatic_changes: false`. A análise é limitada a 200 registros, no máximo 30 pares por categoria e 50 itens antigos/expirados. A detecção é lexical: não compreende contradições semânticas complexas, ironia ou contexto temporal; o proprietário deve confirmar qualquer interpretação.


## Histórico de alterações da memória (etapa 30)

A migration `0014_memory_audit_events.sql` cria um histórico de auditoria com metadados para criação, edição, exclusão e decisões de revisão do proprietário. O endpoint autenticado `GET /v1/owner/memory/history?scope=app|owner&limit=50` exige memória habilitada e permissão de leitura para o escopo solicitado; a consulta pode ser filtrada por `memory_id` e retorna no máximo 100 eventos.

O histórico registra identificador da memória/proposta, chave, ação, aplicativo responsável e horário. **Não registra o valor da memória, evidências, prompts nem conversas.** Eventos são mantidos por até 180 dias pelo processo de limpeza programado. A interface privada mostra as ações recentes, sem permitir alterar o histórico. O SDK oferece `getMemoryHistory()`.

O histórico é append-only pela API: não há endpoint para editar ou apagar eventos. A migration ainda não foi aplicada em produção e o Worker não foi publicado; o recurso só estará disponível depois de uma futura ativação autorizada.


## Perfil contextual estruturado do proprietário (etapa 31)

O endpoint autenticado `GET /v1/owner/profile` organiza até 200 memórias já visíveis ao aplicativo em categorias como preferências, comunicação, trabalho/projetos, interesses, rotinas e contexto pessoal. Também identifica termos que aparecem em mais de uma memória distinta e sugere revisão de possíveis conflitos ou registros antigos/expirados.

A classificação e a recorrência são determinísticas e baseadas somente nos registros curados autorizados. O endpoint não infere atributos sensíveis, não consulta conversas, não chama IA e não grava ou altera memórias. Conteúdo expirado é excluído do perfil atual, mas pode aparecer como sugestão de revisão. Sugestões são alertas, não propostas persistidas nem atualizações automáticas; qualquer alteração deve passar pelo fluxo existente de revisão explícita do proprietário. Memórias de outros apps ou do escopo central só são incluídas com concessão ativa de `memory_read` correspondente.


## Uso do perfil contextual no raciocínio do chat (etapa 32)

O chat normal agora aplica parte do perfil estruturado do proprietário ao contexto da resposta, sem uma chamada de inferência adicional. As memórias de comunicação autorizadas (por exemplo, estilo e tom de resposta) podem orientar a forma da resposta mesmo quando não coincidem lexicalmente com a pergunta atual. As demais memórias continuam sendo incluídas apenas quando relevantes para a consulta. O contexto identifica a categoria de cada registro e pode destacar termos de comunicação recorrentes em memórias distintas.

A seleção continua limitada a cinco registros e a 1.800 caracteres de conteúdo, além das instruções fixas de segurança. O conjunto de origem é o mesmo já filtrado no servidor por proprietário ativo, memória habilitada, expiração, exclusão e concessões explícitas de leitura; o perfil nunca amplia permissões. Os valores continuam sendo dados não confiáveis, não instruções. Não há persistência de prompts/respostas, nova chamada de modelo, aumento de tokens de saída ou alteração automática das memórias. A resposta do chat informa `profile_signals_used` junto aos metadados de contexto.


## Compartilhamento contextual sem duplicação (etapa 33)

Na montagem do contexto do chat, o servidor primeiro aplica as permissões existentes e só então remove cópias exatas de memórias autorizadas. A equivalência exige que chave e valor coincidam após normalização de acentos, caixa e pontuação; conteúdos apenas parecidos ou com chaves/valores diferentes continuam separados. A cópia mais recentemente atualizada representa o grupo, e as origens autorizadas são preservadas como proveniência no contexto.

A deduplicação ocorre antes da construção do perfil e da contagem de padrões recorrentes, evitando que a mesma informação replicada em dois aplicativos seja tratada como duas evidências independentes. Ela não concede acesso, não busca dados de outros aplicativos por conta própria, não altera nem apaga registros e não faz chamadas adicionais de IA. O chat informa quantas cópias foram colapsadas em `memory_context.duplicates_collapsed`. Os limites existentes de cinco registros e 1.800 caracteres permanecem.


## Pacotes de contexto compartilhado entre aplicativos (etapa 34)

O endpoint autenticado `POST /v1/apps/context/share` permite que um app envie a outro um pacote estruturado e pequeno de contexto selecionado. O envio exige que o recurso de mensagens esteja ativado e que existam concessões ativas e direcionais de `send` e `receive` no escopo `context`, para o mesmo proprietário, origem e destino. O inbox revalida essas concessões na entrega.

O pacote aceita até 8 itens de tipos controlados (`preference`, `project`, `constraint`, `fact`, `summary`), com chave, valor limitado a 500 caracteres e proveniência (`curated_memory`, `task_state`, `user_confirmed`). O propósito é limitado a 160 caracteres; o pacote inteiro, a 4.000 caracteres. O protocolo não oferece campo para histórico de mensagens e declara `conversation_history_included: false`. Não há coleta automática de conversas nem leitura implícita da memória de outros apps: o app remetente escolhe explicitamente os itens que envia.

Os pacotes usam a fila já existente, escopo `context`, TTL de 1 a 72 horas (24 por padrão), idempotência por `client_message_id` e limite de fila já aplicado aos demais envios. O destino recebe pelo inbox comum e confirma com o endpoint de ack. A expiração e a limpeza da fila existente continuam valendo. O SDK oferece `shareContextPackage()`.

A validação estrutural não prova que a origem declarada de cada item é verdadeira; o aplicativo remetente deve atribuir a proveniência corretamente. O conteúdo recebido continua sendo dado não confiável, nunca instrução executável. Nenhuma inferência de IA ou migration nova é necessária.


## Contexto contextual automático na distribuição de tarefas (etapa 35)

O SDK aceita `dispatchTask({ includeContext: true })`. Quando solicitado, o coordenador seleciona até cinco memórias relevantes para a instrução e o tipo da tarefa, após deduplicação determinística. A seleção usa somente registros que o aplicativo de origem já pode ler: memória própria, memórias de outros apps com concessão ativa `memory_read/app_memory`, e memória do proprietário com concessão ativa `memory_read/owner_memory`.

Além das concessões de tarefa (`send`/`receive`, escopo `task`), o compartilhamento exige concessões direcionais ativas (`send`/`receive`, escopo `context`) entre origem e destino. A memória precisa estar habilitada. Se faltar autorização, o despacho com contexto solicitado é recusado; sem memórias relevantes, a tarefa segue sem pacote. O destino recebe `context_package` dentro do pedido de tarefa. O inbox revalida também as concessões de contexto no momento da entrega, de modo que uma revogação posterior ao despacho impede a exposição do pacote.

O pacote tem até cinco itens, limites do protocolo compartilhado, proveniência `curated_memory` e não contém histórico de conversa. O fluxo é determinístico, sem inferência adicional, sem escrita de memória e sem migration. O campo `includeContext` é opt-in e permanece falso por padrão.


## Execução padronizada no app destinatário (etapa 38)

O SDK oferece um fluxo de execução para o aplicativo destinatário: valida a mensagem e o contexto, confere a correspondência entre o identificador da mensagem da fila e o identificador do payload, chama um processador implementado pelo próprio app, publica resultado correlacionado e só então confirma a mensagem. A falha do processador é reportada como `failed`; falha ao publicar o resultado deixa a mensagem sem confirmação para permitir nova tentativa. O identificador de resultado é determinístico por tarefa e mensagem.

Isso padroniza o transporte e o ciclo de resposta, mas não instala processadores universais nos apps. Cada app precisa implementar e proteger suas próprias funções. Nenhum texto de contexto é tratado como comando, e o SDK não executa shell nem ferramentas externas.

## Acompanhamento do ciclo de vida das tarefas (etapa 37)

O endpoint autenticado `GET /v1/apps/tasks/status?task_id=...` permite ao app de origem acompanhar uma tarefa que ele próprio despachou. A resposta é calculada a partir do pedido existente, da confirmação de recebimento no inbox e dos resultados correlacionados já devolvidos pelo destino. O acesso exige proprietário ativo, mensagens habilitadas e concessões direcionais de tarefa ainda válidas.

Os estados possíveis são `awaiting_delivery`, `processing`, `completed`, `partial`, `failed` e `expired`. A confirmação no inbox apenas demonstra recebimento; não prova que o aplicativo executou o trabalho. O resultado só é considerado quando o destino chama explicitamente o endpoint de envio de resultados. A consulta é somente leitura, não reenvia tarefas nem executa ações, não armazena conversas e não exige migration ou tabela adicional.

## Recepção e consumo seguro de tarefas (etapa 36)

O SDK oferece `consumeTaskMessage(message)` para validar mensagens recebidas no inbox com escopo `task`. O consumidor verifica protocolo, ID, tipo e instrução da tarefa; valida separadamente o pacote contextual opcional usando as regras do protocolo de contexto. Um pacote inválido é descartado sem invalidar uma tarefa válida, e o resultado informa o motivo.

Quando válido, o contexto fica disponível em `context.items`, acompanhado de sua finalidade e de uma orientação explícita para tratá-lo como dado não confiável. Os valores do pacote nunca são promovidos a instruções, políticas ou comandos. A aplicação de destino deve usar esses itens como referências auxiliares no seu próprio processamento, mantendo suas próprias regras de segurança e autorização. Mensagens que não sejam do escopo `task` não são aceitas por esse consumidor.

A validação é local e determinística: não chama IA, não executa ações, não altera memória e não persiste conversas.
