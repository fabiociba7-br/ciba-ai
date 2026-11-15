# Arquitetura Ciba AI

## Decisões

- **Shared:** um Worker e um banco D1 atendem vários aplicativos Ciba.
- **Ciba-only:** somente IDs configurados em `ALLOWED_APP_IDS` podem receber convites.
- **Cloud-first:** Workers AI é o primeiro mecanismo de inferência.
- **Fail closed:** indisponibilidade ou cota excedida retorna erro; não há fallback pago.
- **Privacy by default:** prompts e respostas trafegam em memória e não são persistidos pelo gateway.

## Núcleo de inteligência unificada

O Worker usa o módulo src/core para identidade Ciba, roteamento determinístico por tarefa, catálogo de perfis especialistas e abstração de provider. O provider ativo permanece Cloudflare Workers AI. O adapter OpenAI-compatible é opcional e não está conectado ao fluxo de produção. O modo atual executa uma inferência por requisição; os perfis especialistas não são modelos independentes.

A memória usa apenas o contexto recebido na requisição e não grava conversas. Fan-out multi-modelo, ferramentas externas e memória persistente ficam desativados até existir infraestrutura, orçamento e controles próprios.

Consulte UNIFIED_INTELLIGENCE.md e OPEN_SOURCE_SELECTION.md para a estratégia de aproveitamento de projetos open source.

## Próximas etapas

1. Validar o modelo e o binding AI na conta Cloudflare real.
2. Executar migrations e testes de integração no ambiente de staging.
3. Implementar revogação e painel administrativo protegido.
4. Adicionar atestação de integridade para Android quando disponível.
5. Avaliar inferência local opcional (MLC LLM) como capacidade complementar, nunca como dependência do gateway.
