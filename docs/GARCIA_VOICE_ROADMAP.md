# Garcia — roteiro técnico de estabilização e voz

Este roteiro registra a sequência escolhida pelo proprietário em 17/11/2026. Cada etapa é executada e validada antes de iniciar a seguinte. Não repetir componentes já implementados; primeiro inspecionar o estado real do repositório.

## Regras permanentes

- Preservar o plano Workers Free e custo zero: sem APIs pagas, fallback pago, créditos ou serviços externos cobrados.
- Preferir execução local no Android. Processamento remoto gratuito só poderá ser opção complementar, depois de verificar limites e privacidade.
- Não enviar gravações ou transcrições a terceiros sem escolha explícita.
- Modelos e binários não entram no Git; fixar origem, versão, licença, checksum e instruções de atualização.
- Verificar compatibilidade e desempenho no aparelho antes de selecionar automaticamente o modelo.
- Avançar uma etapa por vez; testes automatizados e teste no aparelho são gates distintos.
- Não gerar APK a cada push. Gerar artefato instalável apenas nos marcos de teste/release necessários.

## Sequência escolhida

### Etapa 1 — fazer a conversa por texto funcionar de ponta a ponta (prioridade atual)
Escopo exclusivo: ativação, conexão com o Ciba AI, envio de mensagens em texto, recebimento e exibição das respostas, e diagnóstico por logs. Nenhum recurso de voz entra nesta etapa.
- Já existem logs locais em Configurações, cópia e limpeza; o backend devolve identificador de diagnóstico.
- A janela da Activity usa adjustResize e a barra de composição considera teclado e navegação.
- Verificação automatizada: compilação Kotlin/Gradle.
- Gate pendente: instalar uma versão atualizada e testar em aparelho real: abrir Configurações/Logs, copiar e limpar logs; enviar mensagens com teclado aberto e fechado; validar rolagem, botão Enviar e navegação; provocar uma falha e confirmar que o log contém diagnóstico sem segredos.
- Microfone, permissão de gravação e síntese de voz foram retirados temporariamente da interface de teste. Voz só volta após aprovação da conversa por texto.

### Etapa 2 — preparar Whisper.cpp no Android
**Estado: ponte JNI/NDK adicionada; CI de compilação executado.**
- Revisar upstream, versão, licença e notices; selecionar variante e modelo multilingue apropriado para pt-BR.
- Medir tamanho do APK/modelo, RAM, CPU, ABI, API mínima, latência e consumo de bateria.
- Integrar whisper.cpp por JNI/NDK ou biblioteca Android mantida e verificável; implementar ciclo de vida, cancelamento e liberação de memória.
- Fixar SHA-256 do artefato/modelo e verificar o arquivo realmente carregado.
- Não ativar download automático nem serviço remoto como fallback.
- Gate: build Android reproduzível e testes nativos de carregamento, integridade, cancelamento e incompatibilidade.

### Etapa 3 — reconhecimento de voz local
**Estado: captura local, importação manual de modelo, revisão da transcrição e detecção de fim de fala por silêncio implementadas; aguarda CI e teste real no aparelho.**
- Conectar a interface de gravação ao adapter Whisper.cpp já contratado em TypeScript, sem usar RecognitionService externo como motor final.
- Capturar áudio somente após ação explícita; limitar duração/tamanho; permitir cancelar, revisar e editar a transcrição antes de enviar.
- Português brasileiro como idioma padrão; detecção local de atividade de voz, encerramento após 1,1 s de silêncio, timeout de 10 s sem fala, limite absoluto de 120 s e tratamento de falhas de captura.
- Gate: testes com frases curtas/longas em pt-BR, números, pontuação, ruído e interrupção; confirmar que áudio não sai do aparelho.

### Etapa 4 — preparar motor de síntese
**Estado: TTS nativo do Android preservado; um runtime local Chatterbox.cpp foi integrado em branch de implementação para clonagem zero-shot. CI nativo e teste auditivo em aparelho ainda são gates obrigatórios; a capacidade não está marcada como disponível.**
- Reavaliar Chatterbox para Android: o contrato existente é desktop-local e não equivale a runtime Android.
- Conferir licença do código e dos pesos/checkpoints separadamente, suporte real a pt-BR, tamanho, RAM, CPU/GPU e latência.
- Comparar somente alternativas open source com licença e runtime Android viáveis; escolher automaticamente a melhor opção compatível.
- Se Chatterbox não for viável no celular, selecionar alternativa local apropriada sem alterar o requisito de custo zero.
- Gate: decisão documentada, artefatos com hashes e prova de execução local em aparelho suportado.

### Etapa 5 — voz da Garcia sob demanda
**Estado: reprodução automática opcional das respostas implementada com controle nas Configurações; aguarda validação em aparelho com pacote de voz offline instalado.**
- Integrar TTS local e adicionar botão de reprodução em cada resposta da Garcia.
- Controles: reproduzir, pausar/interromper e retomar quando tecnicamente suportado; voz/idioma configuráveis se houver opções compatíveis.
- Não falar automaticamente todas as respostas por padrão.
- Gate: reprodução pt-BR inteligível, interrupção confiável, sem rede e sem bloquear o chat.

### Etapa 6 — conversação por voz
**Estado: modo contínuo opt-in integrado ao ciclo de resposta — após o TTS local terminar, a captura recomeça; a transcrição fica no campo para revisão e exige envio manual. CI pendente; validação em aparelho ainda necessária.**
- Disponibilizar modo push-to-talk e modo contínuo selecionável nas Configurações; o modo contínuo inicia desligado e exige ativação explícita.
- No modo contínuo, retomar a captura somente no callback de conclusão do TTS local; nunca gravar enquanto a Garcia fala.
- Transcrever após silêncio, preencher o campo editável e aguardar o toque manual em Enviar. Não sobrescrever texto/anexos pendentes nem enviar automaticamente.
- Cancelar retomadas pendentes ao desligar o modo, trocar/iniciar conversa, editar texto ou iniciar captura manual; nova captura interrompe o TTS imediatamente.
- A conversação contínua depende de Whisper instalado, permissão de microfone e TTS offline em português. Sem resposta falada, não há retomada automática.
- Incluir detecção de fim de fala, cancelamento, interrupção por usuário, prevenção de eco/autoescuta e tratamento de chamadas/áudio focado.
- Gate: sessões completas e longas sem loops, envio duplicado, captura da própria voz da Garcia ou perda de controle.

### Etapa 7 — processamento remoto gratuito opcional
- Avaliar apenas se acrescentar benefício real e se preço, franquia, limites, privacidade e disponibilidade forem verificáveis.
- Desativado por padrão; nunca fallback automático para serviço pago.
- Gate: opt-in explícito, teto rígido e teste de bloqueio ao atingir a franquia.

## Estado registrado em 17/11/2026

- O CI Android run 44052335162 compilou as fontes Kotlin com sucesso.
- O deploy Ciba AI run 44052072818 concluiu com sucesso; é uma validação do backend, não teste de inferência de áudio.
- O motor whisper.cpp v1.9.5, JNI/NDK, importação local de modelo, verificação SHA-256 e captura de microfone mono 16 kHz até 120 segundos estão no PR #24.
- A transcrição preenche o campo de texto para revisão antes do envio; não encaminha áudio ao servidor.
- A síntese usa Android TextToSpeech e só seleciona voz em português que não exige rede. A leitura automática pode ser desligada nas Configurações.
- O detector de atividade de voz encerra a captura após 1,1 s de silêncio; sem fala, cancela após 10 s. A transcrição continua editável e exige toque em Enviar.
- O modo contínuo é opt-in e só retoma a escuta após o término da fala TTS; texto/anexos pendentes bloqueiam nova captura. A sessão contínua é encerrada ao abrir novamente o aplicativo e exige nova ativação explícita. Desativar a leitura automática também desativa o modo contínuo.
- O workflow executa testes unitários do detector e compilação nativa/Kotlin; teste de áudio e TTS ainda exige aparelho real.
- Não foi gerado APK.


## Ajuste de saída falada — 20/11/2026

- Respostas automáticas por voz são restritas à sessão de conversa por voz iniciada explicitamente pelo usuário. Perguntas enviadas pelo chat de texto recebem respostas somente escritas.
- Ao abrir o aplicativo, qualquer sessão contínua anterior é encerrada; não há microfone ou fala automática iniciados sem nova ação.
- Antes da síntese, a Garcia remove marcadores Markdown (asteriscos, sublinhados, títulos, listas, links e blocos de código) e os delimitadores de parênteses, preservando o texto legível. A mensagem original exibida no chat não é alterada.
- A taxa de fala do Android TTS foi ajustada para 1,15x, mantendo o pitch natural.
- Testes unitários cobrem limpeza de Markdown, parênteses, links, código e listas. O teste em aparelho real ainda é necessário para avaliar a voz e a velocidade percebida.


## Estado adicional — clonagem de voz Android (20/11/2026)

- Branch de implementação: `feature/garcia-voice-cloning-mainline`; PR #36 aberto em rascunho, sem merge. CI nativo e teste em aparelho ainda pendentes.
- `VoiceProfileStore` mantém gravação, WAV normalizado, metadados e SHA-256 no storage privado do app.
- `VoiceCloneEngine` define contrato local; `ChatterboxVoiceCloneEngine` implementa o adaptador nativo. A prévia não altera a seleção ativa.
- `LocalSpeechOutput` separa os modos `SYSTEM` e `CLONED`. Falha do clone não faz fallback silencioso para TTS do sistema.
- Referência de 5–30 s; recomendação de 10–15 s de fala clara. Normalização para WAV PCM mono, 24 kHz, 16 bits; validação básica rejeita silêncio/volume muito baixo, WAV truncado e clipping extremo.
- Modelos GGUF Q4_0 (aprox. 1,1 GB no total) ficam fora do Git e são verificados por SHA-256 antes do uso.
- O código e os modelos são locais; áudio de referência, condicionamento e PCM sintetizado não são enviados ao Worker.
- A compilação Kotlin isolada não valida inferência. CI CMake/NDK e teste auditivo/performance em aparelho real continuam obrigatórios.
- `src/core/native-capabilities.ts` permanece sem marcar clonagem/TTS como `available` até aprovação dos testes reais.
