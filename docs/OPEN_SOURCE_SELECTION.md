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


### Compatibilidade do dispositivo antes da instalação

O contrato puro de avaliação está em `src/core/device-capabilities.ts`. O cliente pode informar plataforma, arquitetura, memória total/disponível, núcleos lógicos, presença de GPU e nível de API Android. O núcleo valida limites e compara o perfil com os requisitos declarados por cada runtime, devolvendo motivos explícitos de incompatibilidade.

O perfil é um relato do cliente, não uma atestação de hardware confiável. As declarações de requisitos de cada runtime/modelo também são validadas antes da comparação: memória mínima, núcleos, GPU, arquiteturas, plataformas e nível mínimo de API precisam respeitar os domínios permitidos. Configurações inválidas são rejeitadas, em vez de produzir uma seleção permissiva ou silenciosa. A avaliação não coleta dados sozinha, não concede permissões, não instala nem inicia processos, não baixa modelos e não envia telemetria. A decisão de executar um motor continua dependendo de adapter registrado, revisão de licença aprovada e autorização explícita.


### Contrato da ponte nativa Android para whisper.cpp

O módulo TypeScript agora define a interface que uma implementação Android/JNI deverá cumprir em `src/core/android-whisper-bridge.ts`. Antes de encaminhar áudio, a ponte precisa informar que a biblioteca nativa está pronta e que o modelo solicitado está carregado. A resposta é validada quanto ao motor, identificador do modelo e segmentos/timestamps.

A ponte não carrega bibliotecas, não instala APKs, não baixa pesos e não escolhe arquivos no dispositivo. O app Android ainda precisa implementar o lado JNI/NDK e fornecer um modelo compatível. Sem biblioteca e modelo prontos, a chamada falha de forma explícita; não há fallback remoto automático.


### Consentimento explícito para transcrição

Toda solicitação de transcrição deve carregar um consentimento explícito, associado à ação do usuário e limitado à finalidade de transcrição. O núcleo rejeita solicitações sem a declaração `granted: true`, finalidade `transcription` e origem `explicit_user_action` antes de consultar ou executar o adapter. Essa declaração é um contrato de fluxo, não uma prova criptográfica de identidade nem substitui a interface de permissões do aplicativo. O áudio não é persistido pelo núcleo e não existe encaminhamento remoto automático.


### Fluxo único e protegido de transcrição

A função `runWhisperCppTranscription` centraliza a validação do áudio, a avaliação do perfil do dispositivo, a resolução de um adapter já registrado e a validação do resultado. Se o hardware não for compatível ou não houver adapter, retorna motivos explícitos sem executar transcrição. Erros do adapter não provocam fallback remoto. O limite de bytes é aplicado antes da chamada ao motor.

Esse fluxo é uma integração de núcleo, não uma prova de execução nativa: continua dependendo de um adapter Android real, biblioteca JNI/NDK e modelo instalado e carregado. Cada adapter declara também os requisitos mínimos do modelo específico que carrega (memória total/disponível, CPU, plataforma, arquitetura e API Android, quando aplicável). A resolução exige compatibilidade tanto com os requisitos gerais do runtime quanto com os requisitos do modelo escolhido; um modelo que exceda os recursos disponíveis é recusado antes de chamar o motor. Os valores são declarados pelo adapter e devem ser medidos/documentados para cada artefato real; não representam benchmarks já realizados pela Garcia.


O registry limita a concorrência de transcrições a uma execução por padrão, configurável entre 1 e 8. Cada execução reserva uma vaga antes de copiar o áudio e libera essa vaga em `finally`, inclusive quando o adapter falha ou retorna dados inválidos. Quando a capacidade está ocupada, a nova solicitação recebe `transcription_capacity_reached` sem chamar o motor.

O limite de bytes definido em `SpeechToTextEnginePolicy.maxAudioBytes` é exposto pelo registry e aplicado automaticamente por `runWhisperCppTranscription` antes de reservar capacidade ou chamar o adapter. Uma chamada pode fornecer um limite ainda menor, mas não precisa repetir a configuração do registry.

As requisições de transcrição aceitam um `AbortSignal` opcional. Se já estiver cancelado, a execução é recusada antes de reservar capacidade. Durante o processamento, o sinal é encaminhado ao adapter, que deve cooperar com o cancelamento. A vaga e a cópia temporária do áudio só são liberadas quando a promessa do adapter termina; adapters que ignoram o sinal continuam ocupando a vaga até terminar, evitando concorrência acima do limite.

Se um adapter não conseguir interromper o trabalho e retornar depois do cancelamento, o núcleo descarta o resultado tardio e responde `transcription_cancelled`. A vaga continua ocupada e o buffer temporário permanece sob limpeza até a promessa do adapter terminar. Se o adapter rejeitar a promessa em resposta ao cancelamento, o núcleo também normaliza essa rejeição para `transcription_cancelled`. Rejeições sem cancelamento continuam sendo propagadas como falhas reais do motor.
