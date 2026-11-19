# Arquitetura Ciba AI

## Decisões

- **Shared:** um Worker e um banco D1 atendem vários aplicativos Ciba.
- **Ciba-only:** somente IDs configurados em `ALLOWED_APP_IDS` podem receber convites.
- **Cloud-first:** Workers AI é o primeiro mecanismo de inferência.
- **Fail closed:** indisponibilidade ou cota excedida retorna erro; não há fallback pago.
- **Privacy by default:** prompts e respostas trafegam em memória e não são persistidos pelo gateway.

## Núcleo de inteligência unificada

O núcleo também oferece uma primitiva de ensemble multi-modelo com até três especialistas e uma etapa de síntese, além de um registro de provedores e contratos tipados para ferramentas. Essas capacidades são extensões disponíveis no código, mas não estão ativadas na API pública enquanto não houver providers reais configurados, controles de orçamento e autorização de uso. O endpoint `/v1/ai/capabilities` distingue disponibilidade de código de recursos efetivamente habilitados.



O Worker usa o módulo src/core para identidade Ciba, roteamento determinístico por tarefa, catálogo de perfis especialistas e abstração de provider. O provider ativo permanece Cloudflare Workers AI. O adapter OpenAI-compatible é opcional e não está conectado ao fluxo de produção. O modo atual executa uma inferência por requisição; os perfis especialistas não são modelos independentes.

A memória usa apenas o contexto recebido na requisição e não grava conversas. Fan-out multi-modelo, ferramentas externas e memória persistente ficam desativados até existir infraestrutura, orçamento e controles próprios.

Consulte UNIFIED_INTELLIGENCE.md e OPEN_SOURCE_SELECTION.md para a estratégia de aproveitamento de projetos open source. Para o estado e os requisitos da transcrição local, consulte SPEECH_TO_TEXT.md; para a síntese de voz local da Garcia, consulte TEXT_TO_SPEECH.md. O núcleo possui contratos para Chatterbox, mas ainda não contém o runtime Python/PyTorch nem pesos de modelo. A integração foi desenhada para adapters locais, sem chamadas HTTP, APIs externas ou serviços remotos.

## Isolamento dos agentes especialistas

O módulo `src/core/agents/isolation.ts` aplica políticas determinísticas por perfil antes da inferência:
- orçamento independente de contexto e quantidade máxima de mensagens;
- limite separado para contexto de memória fornecido na requisição;
- descoberta de ferramentas filtrada por nível de risco e quantidade máxima;
- perfis gerais, raciocínio, criatividade e verificação recebem ferramentas de leitura;
- ferramentas Composio de escrita/externas com aprovação obrigatória podem ser apresentadas como propostas em qualquer perfil, sem execução automática;
- pesquisa pode descobrir ferramentas externas, e programação pode descobrir ferramentas de escrita/externas, mas isso não concede execução nem aprovação.

O registro de ferramentas e o servidor continuam responsáveis por autorização, validação de entrada e aprovação explícita. O isolamento reduz contexto e superfície de ferramentas; não é um sandbox de sistema operacional nem execução paralela de agentes. O modelo atual continua sendo uma inferência por requisição, sem custo adicional de chamadas.

## Fila durável de execução dos agentes

A migration `0021_agent_execution_queue.sql` cria uma fila interna separada de `app_messages`. Cada job é vinculado ao proprietário, perfil do agente e chave de idempotência; possui TTL, tentativas limitadas, prioridade, lease, heartbeat e campos de resultado/erro. O armazenamento em `src/core/agent-queue-store.ts` implementa enqueue idempotente, claim condicional, recuperação de leases expirados, heartbeat, conclusão, falha com backoff, cancelamento e consulta owner-scoped.

A política inicial limita a duas execuções globais e uma por proprietário, no máximo três tentativas, lease de 90 segundos, heartbeat a cada 25 segundos, payload de 32 mil caracteres e resultado de 16 mil. O consumidor `src/core/agent-queue-runner.ts` processa no máximo um job por acionamento, usa o orquestrador existente com o perfil solicitado e aceita somente o modelo configurado e aprovado como gratuito. A execução é iniciada em segundo plano após um novo enqueue por `ExecutionContext.waitUntil`. Consultas de status autorizadas também tentam iniciar o próximo job pendente, permitindo que o acompanhamento da interface ajude a drenar a fila sem novo cron ou serviço gerenciado. Envio, consulta e cancelamento exigem a permissão `task_dispatch` do CibaGênio. Payloads aceitos contêm `messages` (mensagens `user`/`assistant`) ou `prompt`.

A interface Android em Configurações → Agentes e tarefas permite escolher o perfil, enviar instruções, consultar e cancelar tarefas, visualizar resultados e retomar o último acompanhamento após reiniciar o aplicativo. O acompanhamento automático consulta o status a cada quatro segundos enquanto a tela permanece aberta. Nenhum APK é produzido pela validação de compilação.

A integração do consumidor foi validada com o banco D1 de teste e provedor de IA simulado. A execução `44514039006` passou no typecheck, em 40 arquivos de teste (316 testes), migration, deploy e health check. A nova verificação do backend e a compilação Android para acompanhamento automático estão em andamento.
 
## Próximas etapas

1. Validar o modelo e o binding AI na conta Cloudflare real.
2. Executar migrations e testes de integração no ambiente de staging.
3. Implementar revogação e painel administrativo protegido.
4. Adicionar atestação de integridade para Android quando disponível.
5. Avaliar inferência local opcional (MLC LLM) como capacidade complementar, nunca como dependência do gateway.


## Comunicação privada entre aplicativos

Os aplicativos Ciba não devem confiar diretamente uns nos outros. O Ciba AI será o intermediário central de tarefas e mensagens, preservando a identidade do proprietário e dos dois aplicativos envolvidos.

O contrato em `src/core/messaging.ts` define envelopes com identificador de mensagem e tarefa, proprietário, aplicativo de origem e destino, escopo (`task` ou `context`), conteúdo e expiração. A autorização exige uma concessão que corresponda exatamente ao proprietário, ao aplicativo solicitante, à origem, ao destino, à permissão (envio/recebimento), ao escopo e à validade. O encaminhamento para o mesmo aplicativo é recusado.

**Estado atual:** existem contratos, validação de envelope, testes automatizados e uma base de identidade central do proprietário por pareamento de dispositivos. Ainda não existe endpoint de relay, fila, entrega entre apps, persistência de mensagens ou interface para conceder permissões. Não há troca de dados ativa. O relay só poderá ser habilitado depois da aplicação da migration, da validação do fluxo de pareamento no ambiente e da implementação de concessões explícitas entre aplicativos.


## Identidade privada do proprietário

A migration `0007_private_owner_identity.sql` prepara uma identidade opaca de proprietário, convites de pareamento de uso único armazenados por hash e o vínculo opcional de cada dispositivo a um proprietário. Os dispositivos existentes permanecem sem proprietário associado; a migration não os vincula automaticamente.

As políticas em `src/core/owner.ts` exigem proprietário ativo, convite não consumido, aplicativo correspondente e prazo válido. O acesso do proprietário é derivado do registro do dispositivo autenticado; um `ownerId` enviado pelo cliente não constitui prova de identidade. Dispositivos sem vínculo ou revogados falham por padrão.

**Estado:** a migration e os endpoints privados de pareamento estão no repositório. O banco ainda não recebeu a migration e nenhum deploy foi feito; portanto, os endpoints não estão operacionais em produção. Não existe cadastro público nem sessão de proprietário independente. O pareamento exige um dispositivo já autenticado e um convite administrativo de uso único.


## Pareamento privado implementado

O gateway agora contém endpoints administrativos para criar um proprietário privado com convite inicial e emitir convites para associar outros aplicativos. Um dispositivo já registrado usa seu token de dispositivo para consumir um convite de uso único em `/v1/owner/pair`. A associação é feita no servidor, com verificações de proprietário ativo, aplicativo correspondente, convite não expirado/não consumido e dispositivo ainda não associado. A listagem administrativa inclui o identificador opaco do proprietário associado.

O fluxo depende da migration `0007_private_owner_identity.sql` e permanece inoperante em ambientes cujo banco ainda não recebeu essa migration. Não há cadastro público, sessão de proprietário separada, interface de pareamento nem grants entre apps nesta etapa. Consulte `OWNER_PAIRING.md` para o protocolo.


## Concessões explícitas entre aplicativos

A migration `0008_explicit_app_access_grants.sql` cria a tabela `app_access_grants`. Cada registro representa uma única permissão e um único escopo: envio ou recebimento de tarefa/contexto entre um par exato de apps, leitura/escrita da memória de um app específico ou leitura/escrita da memória do proprietário. As concessões podem expirar e podem ser revogadas; uma concessão revogada falha imediatamente. A tabela vincula o registro ao proprietário e ao dispositivo que o criou.

O módulo `src/core/access-grants.ts` contém a política pura de validação, com negação por padrão e correspondência exata de proprietário, aplicativo solicitante, origem, destino, permissão e escopo. A identidade do proprietário e do app solicitante deve ser obtida pelo gateway a partir do dispositivo autenticado, nunca do corpo enviado pelo aplicativo.

**Estado atual:** existem endpoints autenticados por dispositivo pareado para criar, listar e revogar concessões. O gateway deriva o proprietário do registro do dispositivo, exige proprietário ativo, valida os aplicativos envolvidos e registra qual dispositivo criou a concessão. A validade padrão é de 720 horas, limitada a 8.760 horas. A API não aceita um ownerId fornecido pelo cliente. Consulte `ACCESS_GRANTS.md` para os payloads.

**Limite desta etapa:** as migrations ainda não foram aplicadas e não houve deploy. As concessões não estão conectadas ao relay de mensagens nem à memória persistente; não há troca de dados ativa nem interface visual de configurações.


## Relay privado de mensagens

A etapa de relay adiciona a fila `app_messages` e os endpoints autenticados `POST /v1/apps/messages`, `GET /v1/apps/messages/inbox` e `POST /v1/apps/messages/ack`. O envio exige concessões ativas `send` e `receive` para o mesmo proprietário, origem, destino e escopo. O recebimento revalida ambas as concessões; revogação ou expiração impede novas entregas. Cada mensagem tem chave de idempotência, payload limitado a 8.000 caracteres, validade máxima de 72 horas e limite de 100 pendentes por app de destino e proprietário. A fila só transporta JSON; não executa comandos nem ferramentas.

**Estado:** código, migration e testes estão no repositório. A migration 0009 não foi aplicada e não houve deploy; portanto, a comunicação não está ativa em produção.


## Cliente comum para aplicativos

O módulo `src/client.ts` fornece uma interface TypeScript independente de framework para diagnóstico, registro de dispositivo, pareamento, chat, relay de mensagens e concessões. O aplicativo hospedeiro fornece o token sob demanda por meio de `getAccessToken`; o cliente não persiste credenciais. URLs remotas exigem HTTPS. O servidor continua sendo a autoridade para identidade, escopos, limites e permissões. O módulo pode ser reutilizado em projetos TypeScript, mas ainda não é um SDK nativo Kotlin/Swift nem foi integrado automaticamente aos binários dos apps. Consulte `docs/CLIENT_SDK.md`.

## Memória privada persistente

A tabela `memory_records` armazena apenas entradas explicitamente curadas, com consentimento por gravação, chave e valor limitados, escopo de app ou proprietário, expiração opcional e exclusão lógica. O app autenticado pode operar na própria memória de app; memória de outro app e memória central exigem concessões `memory_read`/`memory_write` ativas. O chat não grava histórico automaticamente. A migration 0010 ainda não foi aplicada.

## Controles privados do proprietário

A migration `0011_owner_feature_settings.sql` cria preferências por proprietário. Memória persistente e comunicação entre apps ficam desligadas por padrão. Dispositivos pareados podem consultar e alterar somente as opções permitidas em `GET/POST /v1/owner/settings`. O gateway aplica esses interruptores nas rotas de memória, criação de concessões e relay; desligar uma capacidade bloqueia seu uso sem apagar dados nem revogar concessões. Reativar restaura o acesso sujeito às concessões ainda válidas. A migration ainda não foi aplicada e o Worker não foi publicado.


## Identidade e reconhecimento dos aplicativos

A migration `0012_app_identity_profiles.sql` adiciona descrição, tipo, capacidades declarativas, tipos de tarefa e versão do contrato ao cadastro administrativo `app_registry`. Os valores aceitos são validados por `src/core/apps/registry.ts`; IDs desconhecidos, duplicatas e listas excessivas são recusados. O endpoint autenticado `GET /v1/apps/identity` deriva o app e o dispositivo do token e mostra os outros apps habilitados com dispositivos ativos pareados ao mesmo proprietário. Metadados de capacidade e tarefa são apenas descritivos, não concedem acesso e não disparam execução de comandos.


## Coordenador de tarefas

`src/core/task-coordinator.ts` aplica seleção determinística e fail-closed: compara o tipo solicitado com tipos declarados, exige concessões direcionais para o mesmo par de apps e não desempata candidatos múltiplos. `POST /v1/apps/tasks/dispatch` deriva remetente e proprietário do dispositivo autenticado, limita instrução/contexto, aplica TTL e idempotência e grava o pedido na fila de mensagens já existente. Não há execução remota de ferramentas, nem inferência de que o destino completou a tarefa. A resposta deve retornar como mensagem correlacionada pelo mesmo `task_id` e requer concessões inversas.

## Transporte MCP de saída

O módulo `src/core/mcp/client.ts` fornece a base para a Garcia atuar como cliente de servidores MCP remotos por HTTP:
- exige HTTPS e uma allowlist explícita de hosts definida pelo chamador confiável;
- aceita credencial por callback, incluindo Bearer e cabeçalhos de API Composio permitidos, sem persistir tokens ou expô-los em logs;
- negocia inicialização JSON-RPC, descobre ferramentas e só permite chamar ferramentas previamente descobertas;
- limita tamanho de requisição, resposta, catálogo de ferramentas e tempo de chamada;
- exige allowlist local explícita por nome e bloqueia chamadas que não estejam marcadas como somente leitura; a anotação remota é apenas um filtro adicional, nunca substitui a autorização local;
- não repete chamadas automaticamente e não segue redirecionamentos por conta própria;
- aceita respostas JSON e eventos SSE do transporte HTTP MCP;

Esse transporte é uma primitiva interna e ainda não habilita conexões remotas por configuração do usuário, não armazena credenciais e não executa ferramentas externas por padrão. A política de risco, o consentimento e a autorização permanecem sob controle do registro de ferramentas da Garcia. O endpoint de entrada `/v1/mcp` continua separado e oferece somente as ferramentas de leitura autorizadas.

A integração Garcia–Composio continua desacoplada: a conexão Composio disponível no ChatGPT não transfere credenciais para o Worker. Uma integração própria exige configuração explícita de credenciais no ambiente da Garcia, revisão dos limites gratuitos e autorização do proprietário; nenhum segredo ou conexão paga foi habilitado nesta etapa.

### Integração Composio — desenho e limites

A integração própria deverá criar uma sessão Composio por proprietário autenticado, usando o identificador estável do proprietário como `user_id`, e limitar a sessão aos toolkits explicitamente habilitados. O cliente MCP suporta os cabeçalhos de sessão documentados pelo Composio, incluindo `x-api-key`, sem expor a chave ao Android ou ao modelo.

A configuração de produção deverá:
- manter a chave de projeto apenas como Worker secret `COMPOSIO_API_KEY`;
- desabilitar `instant` e ferramentas de cobrança por uso;
- permitir somente toolkits e ações escolhidos pelo proprietário;
- exigir aprovação explícita da Garcia para qualquer ação de escrita;
- manter sessões e conexões isoladas por proprietário;
- parar sem fallback pago quando a cota gratuita for atingida.

A conexão Composio existente no ChatGPT não fornece automaticamente uma chave de projeto nem transfere as contas vinculadas para a Garcia. A criação da integração própria depende da chave de projeto Composio e de autorização OAuth separada para as contas que serão usadas pela Garcia.

## Composio no chat da Garcia

O runtime conversacional pode descobrir ferramentas Composio consentidas individualmente. Ferramentas classificadas localmente como leitura podem ser executadas pelo registro normal de ferramentas. Ferramentas de escrita ou externas aparecem como propostas, com entrada validada e solicitação de aprovação durável vinculada ao proprietário, dispositivo, conversa, invocação e conteúdo exato dos argumentos.

A resposta do chat retorna `tool_proposal` e `tool_approval` em campos JSON próprios para o cliente Android. A aprovação não dispara a execução automaticamente. O cliente deve mostrar a operação e os argumentos para confirmação explícita; a execução continua sendo uma chamada separada. A rota Composio revalida sessão ativa, consentimento, toolkit, classificação e fingerprint do schema antes de aprovar ou executar. A chave de projeto nunca é enviada ao aplicativo.

A execução remota continua bloqueada pelo kill switch `COMPOSIO_EXECUTION_ENABLED` até habilitação operacional explícita. Portanto, a integração conversacional pode preparar e registrar aprovações, mas não executa ações externas enquanto esse controle estiver desligado.

## Sessões Composio por proprietário

O módulo `src/core/composio/sessions.ts` cria e revoga sessões pela API v3.1 oficial do Composio, usando somente a chave de projeto do Worker (`COMPOSIO_API_KEY`). Cada proprietário recebe um `user_id` pseudonimizado e estável derivado por SHA-256 do owner ID; identificadores pessoais não são enviados.

A rota autenticada `/v1/owner/composio/session` oferece:
- `GET`: consulta apenas o estado da sessão do proprietário autenticado;
- `POST`: cria sessão somente com `consent: true` e allowlist explícita de até dez toolkits;
- `DELETE`: revoga a sessão remota e marca o registro como revogado.

O servidor exige o controle CibaGênio `external_tools`, o app Garcia e um proprietário ativo. O ID da sessão fica em D1 com escopo por proprietário; URL MCP e credenciais nunca são devolvidas ao Android. A chave de projeto permanece como Worker secret e não é gravada no banco.

A política enviada ao Composio desabilita uso instantâneo/cobrança, workbench, proxy de execução e execução múltipla, bloqueia ferramentas marcadas como criação, atualização ou destruição e limita conexões a uma allowlist de toolkits. A sessão pode gerenciar a conexão OAuth dos toolkits explicitamente escolhidos, sem habilitar remoção de contas. O cliente MCP da Garcia ainda aplica sua própria allowlist local e aceita apenas ferramentas com anotação de leitura; a anotação remota não substitui a autorização da Garcia.

A integração permanece inativa até a configuração manual do Worker secret `COMPOSIO_API_KEY`. A conexão Composio já existente no ChatGPT não fornece essa chave nem transfere as contas vinculadas. O endpoint autenticado `/v1/owner/composio/tools` reanexa a sessão pela API v3.1 (`POST .../{session_id}/attach`), valida a URL MCP e devolve somente metadados.

O chat da Garcia agora pode descobrir e oferecer ao orquestrador até doze ferramentas Composio por proprietário, mas somente quando todas as condições forem atendidas: sessão ativa, toolkit incluído na allowlist da sessão, controle CibaGênio `external_tools` habilitado, consentimento individual salvo, classificação local `read`, `requires_approval = 0` e fingerprint do schema idêntico ao consentido. A autorização revalida no momento da chamada o proprietário, a sessão ativa, o toolkit, o estado da permissão e o hash do schema. A descrição apresentada ao modelo é gerada localmente; metadados remotos não são usados como instruções.

A ponte conversacional executa exclusivamente consultas de leitura através do registro de ferramentas da Garcia. Resultados externos são tratados como dados não confiáveis na segunda passagem do orquestrador. Ferramentas `write` e `external` não são expostas ao runtime conversacional nem executadas automaticamente; continuam no fluxo explícito `/v1/owner/composio/invoke`, com aprovação durável individual e a trava de execução do servidor. Se descoberta ou conexão falhar, o chat continua sem ferramentas Composio. Nenhum segredo é enviado ao Android e nenhuma configuração paga é ativada.
