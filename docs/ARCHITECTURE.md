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

Consulte UNIFIED_INTELLIGENCE.md e OPEN_SOURCE_SELECTION.md para a estratégia de aproveitamento de projetos open source.

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
