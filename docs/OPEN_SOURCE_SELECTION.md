# Seleção e incorporação de projetos open source

## Critérios obrigatórios

1. Licença compatível com uso e distribuição pretendidos.
2. Atividade e manutenção verificáveis.
3. Dependências e superfície de ataque aceitáveis.
4. Execução compatível com Cloudflare Workers ou serviço separado.
5. Benefício concreto frente a uma implementação menor.
6. Custos e requisitos de memória/GPU conhecidos.
7. Possibilidade de desligar ou substituir cada componente.

## Estratégia

Não importar repositórios completos indiscriminadamente. O Ciba AI mantém um núcleo próprio e integra componentes por adapters. Frameworks Python de agentes podem ser úteis em um serviço futuro, mas não devem ser empacotados no Worker TypeScript.

## Matriz inicial

| Projeto | Uso potencial | Compatibilidade com Worker | Situação |
|---|---|---|---|
| LangGraph | Orquestração com estado e checkpoints | Baixa como runtime direto; conceitos portáveis | Referência arquitetural |
| CrewAI | Times de agentes Python | Baixa como runtime direto | Referência arquitetural |
| Ollama | Servir modelos locais | Não roda dentro do Worker | Adapter compatível preparado; endpoint ainda não configurado |
| LiteLLM | Gateway multi-provider | Serviço separado; adiciona operação | Contrato interno mais leve adotado |
| Hugging Face | Descoberta de modelos, tokenizers e datasets | Catálogo externo; modelos exigem runtime compatível | Fonte de avaliação, não dependência runtime |

## Regras de incorporação

- Não copiar código sem registrar origem, versão, licença e modificações.
- Preferir dependências pequenas e APIs estáveis.
- Fixar versões e revisar avisos de segurança.
- Não incorporar pesos de modelos ao repositório Git.
- Não presumir que open source significa licença permissiva ou uso comercial irrestrito.
- Não executar código de terceiros sem sandbox e revisão.
- Não habilitar provider que possa cobrar sem configuração e autorização explícitas.

## Catálogo nativo de capacidades da Garcia

O catálogo executável de metadados está em `src/core/native-capabilities.ts` e é exposto em `GET /v1/ai/capabilities`. Ele organiza as capacidades que a Garcia pretende incorporar:

- Geração e edição de imagens.
- Geração e edição de vídeos.
- Transcrição e reconhecimento de fala.
- Síntese, conversão e personalização de voz.
- Visão computacional.
- OCR e compreensão de documentos.
- Programação e manutenção de projetos.
- Geração e processamento de áudio.
- Orquestração de agentes especialistas.

Cada capacidade declara projetos de origem, estado da revisão de licença, runtimes compatíveis, runtime preferido, política de instalação, exigência de GPU, memória mínima estimada e política de custo zero. O catálogo começa com estado `planned` e revisão de licença `review_required`; isso evita anunciar como disponível algo que ainda não foi incorporado e validado.

### Regra de incorporação

A incorporação será feita por etapas, com adapters tipados e isolados. O catálogo não instala dependências, não baixa pesos, não executa código de terceiros e não habilita serviços externos. Pesos de modelos ficam fora do Git e serão obtidos sob demanda somente depois da revisão de licença, compatibilidade, segurança, tamanho e custo. Capacidades que exigem GPU ou infraestrutura remota não serão instaladas automaticamente em celulares.

O endpoint público informa explicitamente que o catálogo é apenas metadado: modelos ainda não estão instalados e adapters ainda não são executáveis. A disponibilidade real só poderá mudar depois da implementação e validação do adapter correspondente.


### Primeiro motor: transcrição local com whisper.cpp

A primeira integração concreta começa pelo contrato TypeScript de `whisper.cpp` em `src/core/speech-to-text.ts`. O contrato padroniza entrada de áudio, idioma opcional, segmentos com timestamps e resultado identificado pelo motor/modelo. A validação limita formatos aceitos e tamanho do áudio.

O registry é fail-closed: não disponibiliza runtime sem adapter explicitamente registrado e bloqueia registro enquanto a revisão de licença não estiver aprovada. Android embarcado, desktop local e serviço local são os runtimes previstos; não existe fallback remoto automático. Esta etapa não inclui binários nativos, NDK/JNI, downloads de modelos ou execução de transcrição.
