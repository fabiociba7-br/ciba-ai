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

O perfil é um relato do cliente, não uma atestação de hardware confiável. As declarações de requisitos de cada runtime/modelo também são validadas antes da comparação: memória mínima, núcleos, GPU, arquiteturas, plataformas e nível mínimo de API precisam respeitar os domínios permitidos. Configurações inválidas são rejeitadas, em vez de produzir uma seleção permissiva ou silenciosa. Após o registro, o núcleo mantém uma cópia congelada dos metadados e requisitos do adapter, incluindo listas de plataformas/arquiteturas; alterações posteriores no objeto fornecido pelo integrador não podem enfraquecer ou mudar a decisão de compatibilidade. A avaliação não coleta dados sozinha, não concede permissões, não instala nem inicia processos, não baixa modelos e não envia telemetria. A decisão de executar um motor continua dependendo de adapter registrado, revisão de licença aprovada e autorização explícita.


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



### Identidade e integridade do modelo Android Whisper

A configuração do adapter exige um SHA-256 em hexadecimal minúsculo, com exatamente 64 caracteres. Configurações ausentes ou malformadas são rejeitadas antes de qualquer chamada à ponte. Em execução, o núcleo compara o digest configurado com o digest informado pelo status nativo e falha de forma fechada quando há ausência ou divergência.

Essa comparação não calcula o hash do arquivo no TypeScript e não prova, por si só, que a implementação nativa informou a verdade. O futuro módulo JNI/NDK deverá calcular SHA-256 sobre os bytes do arquivo de modelo efetivamente carregado, antes de disponibilizá-lo ao motor, e retornar esse valor no status. Até existir essa implementação e testes Android reais, o pin é apenas uma verificação contratual entre o núcleo e a ponte, não uma atestação criptográfica do modelo em execução.


A criação do adaptador valida também os objetos de configuração e a presença dos dois métodos da ponte nativa. Cada chamada de transcrição rejeita requests nulos ou sem buffer de áudio válido com erro controlado, antes de consultar a ponte.

O status da ponte é lido uma única vez para um snapshot isolado e congelado. Cada campo, inclusive propriedades implementadas como getters, é lido exatamente uma vez antes da validação para evitar resultados inconsistentes causados por efeitos colaterais. Valores nulos, primitivos, arrays, propriedades com tipos inválidos ou getters que lançam exceção são rejeitados antes da transcrição. Isso evita leituras inconsistentes de objetos mutáveis ou malformados.

Antes de enviar áudio, o adapter também valida o status retornado pela ponte: flags booleanas, identificador e digest do modelo, versão do motor e consistência entre biblioteca pronta e modelo carregado. Status malformado é rejeitado e a transcrição não é chamada. Isso valida a estrutura do relato, não atesta a veracidade do estado interno do processo nativo.

O resultado devolvido pelo motor nativo também é tratado como entrada não confiável: cada campo do resultado e de cada segmento é lido uma única vez para um snapshot destacado e congelado. Objetos nulos, arrays inesperados, valores fora dos limites, segmentos inconsistentes e getters que lançam exceções são rejeitados com `invalid_android_whisper_result`. A validação e a cópia acontecem na fronteira do adapter antes de o resultado ser disponibilizado ao restante do núcleo.\n\nNa fronteira JNI, o adapter cria uma cópia isolada do buffer de áudio para a chamada nativa e zera essa cópia em `finally`, tanto em sucesso quanto em falha. O buffer recebido do chamador não é alterado. A limpeza ocorre quando a promessa da ponte termina; a implementação nativa não deve reter ponteiros ou referências ao buffer depois de resolver/rejeitar a chamada.


O adapter Android também é congelado após a criação: seus metadados, requisitos e referência à função de transcrição não podem ser substituídos por mutação do objeto retornado. Isso protege a configuração local do adapter; não substitui validações de segurança no módulo nativo nem torna confiável um relato de status produzido pelo próprio cliente.


Android Whisper native result snapshots capture the segment count once and read entries by bounded numeric index. They do not invoke a caller-provided array iterator; malformed collections fail closed.
