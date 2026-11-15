# Ciba AI — Inteligência Unificada

## Objetivo

Construir uma experiência de IA única, com identidade, políticas, roteamento, memória controlada e ferramentas comuns, sem amarrar o produto a um único modelo ou fornecedor.

A unificação inicial é feita na camada de software. Não há fusão dos pesos dos modelos nem treinamento de um modelo fundido. Isso exigiria infraestrutura de GPU, dados licenciados, avaliação e orçamento próprios.

## O que existe nesta entrega

- Ciba Core: identidade e orquestrador central.
- Task Router: seleção determinística de um perfil especialista a partir da solicitação.
- Agent Catalog: perfis generalista, raciocínio, pesquisa, programação, criação e verificação.
- Provider interface: contrato comum para diferentes mecanismos de inferência.
- Cloudflare Workers AI adapter: provedor atualmente ativo.
- OpenAI-compatible adapter: base para endpoints auto-hospedados compatíveis, como Ollama, vLLM ou LM Studio.
- Memory adapter: contexto limitado à conversa atual, sem persistência de conteúdo.
- GET /v1/ai/capabilities: informa as capacidades realmente habilitadas.

## Transparência sobre agentes

Os perfis especialistas atuais são instruções especializadas selecionadas pelo roteador e executadas pelo mesmo modelo em uma chamada. Eles não são seis modelos independentes. O endpoint de capacidades deixa explícito que o modo atual é single-pass.

Foi adicionada uma primitiva opt-in de ensemble multi-modelo (`src/core/ensemble.ts`): ela aceita membros com providers/modelos diferentes, limita a três chamadas de especialistas e uma chamada de síntese, reúne resultados bem-sucedidos e retorna os participantes usados. O registro de providers (`src/core/providers/registry.ts`) e os contratos de ferramentas (`src/core/tools`) também estão disponíveis. Essas primitivas ainda não estão ligadas ao endpoint público: não há providers externos configurados, credenciais, orçamento por provider nem autorização para encaminhar dados a terceiros. Portanto, a colaboração real entre modelos permanece desativada. Ativá-la antes de provisionar infraestrutura e medir consumo pode ultrapassar a franquia gratuita.

## Fluxo atual

1. O Worker autentica o dispositivo e valida limites.
2. O roteador seleciona um perfil especialista sem fazer chamada adicional.
3. O orquestrador constrói instruções de identidade e contexto.
4. Um provider habilitado executa uma inferência.
5. A resposta é devolvida com metadados mínimos de agente, provider e estratégia.
6. O gateway não persiste prompts nem respostas.

## Próxima evolução multi-modelo

A ativação deverá ocorrer somente após inventário dos modelos e licenças, medição de latência/qualidade/contexto/consumo, limites por provider, secrets exclusivamente no servidor, avaliação de segurança e custo, fallback desligado por padrão e controle administrativo para ligar/desligar cada provider.

## Memória

A implementação atual usa somente o histórico limitado enviado na requisição e não persiste conteúdo. O contrato de memória futura exige opt-in explícito, separação por usuário e aplicativo, minimização, retenção configurável, exportação e exclusão. Ainda não há armazenamento persistente implementado nem chave de criptografia provisionada.

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
