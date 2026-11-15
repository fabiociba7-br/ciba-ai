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

**Estado desta etapa:** foram criados contratos, validação de envelope e testes automatizados. Ainda não existe endpoint de relay, fila, entrega entre apps, persistência de mensagens ou interface para conceder permissões. Não há troca de dados ativa. O gateway atual autentica dispositivos vinculados a um único `app_id`, mas ainda não possui identidade central autenticada do proprietário; por isso, não seria seguro ativar o relay agora. A próxima implementação precisa estabelecer essa identidade e o gerenciamento de concessões antes de habilitar entrega real.


## Identidade privada do proprietário

A migration `0007_private_owner_identity.sql` prepara uma identidade opaca de proprietário, convites de pareamento de uso único armazenados por hash e o vínculo opcional de cada dispositivo a um proprietário. Os dispositivos existentes permanecem sem proprietário associado; a migration não os vincula automaticamente.

As políticas em `src/core/owner.ts` exigem proprietário ativo, convite não consumido, aplicativo correspondente e prazo válido. O acesso do proprietário é derivado do registro do dispositivo autenticado; um `ownerId` enviado pelo cliente não constitui prova de identidade. Dispositivos sem vínculo ou revogados falham por padrão.

**Limite desta etapa:** a migration e as políticas estão no repositório, mas ainda não há endpoints para criar proprietários, emitir/consumir convites ou associar dispositivos. A migration não foi aplicada a banco local ou remoto. Não existe login público nem sessão de proprietário ativa. O pareamento real só deve ser implementado com consumo atômico do convite e autenticação do dispositivo já existente.
