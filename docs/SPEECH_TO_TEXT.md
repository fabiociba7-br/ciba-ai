# Transcrição e resposta por voz na Garcia

## Reconhecimento incremental no Android

Na conversação contínua, a Garcia prioriza `SpeechRecognizer.createOnDeviceSpeechRecognizer` (Android 12/API 31 ou superior), quando o serviço offline do aparelho está disponível. O reconhecimento fornece resultados parciais enquanto a pessoa fala e um resultado final ao detectar o encerramento do trecho. A interface mostra o texto parcial; somente o resultado final é enviado à conversa, respeitando a opção de conversação contínua ativada pelo proprietário.

- O app consulta a disponibilidade do reconhecedor estritamente on-device; não usa o reconhecedor remoto como fallback.
- A intenção solicita português do Brasil, resultados parciais e preferência offline.
- Se o reconhecedor on-device não estiver disponível, a conversação contínua pode usar o fluxo local do Whisper, desde que o modelo esteja instalado.
- Se nenhum dos dois mecanismos locais estiver disponível, a conversação por voz não inicia.
- O reconhecimento incremental depende do serviço e do pacote de idioma offline fornecidos pelo Android/fabricante; disponibilidade e precisão devem ser confirmadas no aparelho.

## Transcrição local (Whisper.cpp)

A Garcia integra `whisper.cpp` no Android por JNI/NDK. A captura e inferência são locais; não há fallback para reconhecimento remoto.

### Implementado nesta etapa
- Origem upstream fixada no commit `d1be6fde11ac6e0407606b4e42fe72d34add8037` (v1.9.5).
- Ponte JNI para carregar modelo, transcrever PCM mono 16 kHz, devolver segmentos com timestamps, cancelar e liberar o contexto.
- Importação manual de arquivo de modelo para diretório privado do app; sem download automático.
- Validação de tamanho e cabeçalho GGML, cálculo SHA-256 e nova verificação do hash ao reabrir.
- Captura pelo microfone somente após ação do usuário e permissão `RECORD_AUDIO`.
- Limite absoluto de gravação de 120 segundos. O áudio permanece em memória e é apagado após uso.
- Detector local de atividade de voz: encerra após 700 ms de silêncio depois da fala (`SILENCE`); cancela após 10 s sem detectar fala (`NO_SPEECH`) e encerra no limite de 120 s (`MAX_DURATION`). O motivo aparece no status do Whisper e no log local.
- No modo de ditado, a pausa final inicia a transcrição Whisper; o texto aparece no campo para revisão/edição e só é enviado após o usuário tocar em Enviar.
- Na conversação contínua, o resultado parcial aparece durante a fala e o resultado final é enviado automaticamente à Garcia, pois esse comportamento faz parte do modo contínuo explicitamente ativado.
- Iniciar nova captura interrompe imediatamente a reprodução TTS em andamento.

### Ainda depende de teste no aparelho
- Escolher e importar um modelo multilíngue compatível com whisper.cpp, com origem/licença conferidas.
- Medir consumo de memória, tempo de carregamento, latência e precisão em português brasileiro.
- Confirmar comportamento em gravações longas, silêncio, ruído, permissão negada, cancelamento e interrupção do TTS.
- Medir os limiares do detector em diferentes microfones e ambientes; os valores atuais são conservadores e precisam de validação no aparelho.

O aplicativo não inclui pesos no Git nem baixa modelos automaticamente. Nesta etapa, o app aceita somente o modelo multilíngue `ggml-tiny-q5_1.bin` do repositório oficial `ggerganov/whisper.cpp`, com SHA-256 fixado em `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` (32,2 MB). O repositório Hugging Face declara licença MIT. A verificação do hash é obrigatória na importação e em cada inicialização; modelos diferentes são rejeitados. A variante tiny quantizada é o ponto de partida leve, não uma garantia de precisão máxima.

## Resposta falada local

- `LocalSpeechOutput.kt` mantém dois modos explícitos: `SYSTEM` usa Android TextToSpeech com voz em português instalada e offline; `CLONED` usa Chatterbox local, `ClonedVoiceRuntime` e reprodução PCM 24 kHz por `AudioTrack`.
- O modo `CLONED` não faz fallback silencioso para `SYSTEM`. Se runtime, perfil ou modelos falharem, a Garcia informa o motivo; o usuário pode selecionar uma voz Android nas Configurações com um toque.
- `voiceReplies` habilita leitura automática tanto no chat de texto quanto na conversa por voz. `continuousVoice` continua opt-in e controla somente o ciclo de escuta automática após a fala.
- A conversação contínua é inicializada desligada a cada novo processo do app; o usuário precisa ativá-la explicitamente em cada sessão.
- Na reinicialização, a disponibilidade dos modelos Chatterbox é revalidada no disco por `ChatterboxModelManager.installed()` e SHA-256; não depende apenas de um mapa em RAM.
- A interface apresenta diagnóstico de entrada (on-device/Whisper/nenhum) e saída (SYSTEM/CLONED), incluindo o perfil e o motivo de indisponibilidade.
- Nenhum áudio ou modelo é enviado ao Worker ou a serviços externos. Não há fallback de rede para STT ou TTS.

## Privacidade e limites
1. A gravação só começa após toque explícito e permissão do microfone.
2. Nenhum áudio é enviado ao servidor pela função de transcrição.
3. A transcrição só vai para a Garcia depois que o usuário revisa e toca em Enviar.
4. O arquivo de modelo é importado manualmente, guardado no armazenamento privado e validado por SHA-256.
5. Sem biblioteca/modelo/voz offline, a função fica indisponível; não há fallback remoto ou pago.
6. O limite de captura é 120 segundos por gravação; silêncio encerra a fala e silêncio sem voz cancela a sessão.
7. A detecção de fim de fala é local e não envia automaticamente a transcrição: a revisão e o toque em Enviar continuam obrigatórios.

## Referências
- Modelo tiny-q5_1 (arquivo e SHA-256): https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny-q5_1.bin
- Repositório de modelos e licença declarada: https://huggingface.co/ggerganov/whisper.cpp
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- versão fixada: https://github.com/ggml-org/whisper.cpp/tree/v1.9.5
- exemplo Android upstream: https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.android
