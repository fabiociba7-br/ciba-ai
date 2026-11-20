# Garcia — clonagem de voz local no Android

Status: implementação candidata na branch `feature/garcia-voice-cloning-mainline`, PR #36 em rascunho. O código Kotlin, o módulo JNI/CMake e o fluxo de perfis foram portados e endurecidos; a validação CMake/NDK da head atual e a prova auditiva/performance em aparelho real ainda são gates. Não classificar como produção ou capacidade disponível antes desses gates.

## Arquitetura

- `VoiceProfileStore`: CRUD local de perfis, nome, duração, timestamp, caminho relativo, SHA-256 da referência e WAV normalizado. Arquivos em `filesDir/voice-profiles/<id>/`; nenhum caminho arbitrário é aceito.
- `VoiceAudioNormalizer`: decodifica formatos suportados pelo Android e normaliza para WAV PCM mono, 24 kHz, 16 bits.
- `VoiceCloneEngine`: interface local de disponibilidade, ativação, prévia, síntese, cancelamento e liberação.
- `ChatterboxVoiceCloneEngine`: adaptador da implementação nativa Chatterbox.
- `ClonedVoiceRuntime`: serializa carregamento, prévia, síntese e liberação; extrai e reutiliza cinco tensores de condicionamento por perfil.
- `LocalSpeechOutput`: mantém TTS nativo Android no modo `SYSTEM`; usa PCM local no modo `CLONED`. Não há fallback silencioso.
- `VoiceCloningSection`: grava/importa, salva, pré-visualiza sem selecionar, ativa explicitamente e exclui perfis.

## Motor selecionado

**Chatterbox Multilingual V3 via chatterbox.cpp**

- Repositório: https://github.com/gianni-cor/chatterbox.cpp
- Commit fixo: `ddca05fb69c2910b0d7b5eae420d360ed98c067b`
- Código upstream e modelo ResembleAI estão publicados sob MIT; o runtime ggml também é MIT.
- Android module: `:chatterbox-runtime`, CMake/NDK, JNI, ABI `arm64-v8a` e `x86_64`.
- Saída: PCM mono 24 kHz reproduzido por `AudioTrack`.
- CPU-only, até quatro threads, com CFM multilingual ajustado para 7 passos. Não há aceleração GPU ativada; a latência ainda precisa ser medida em aparelho.

### Modelos

Os dois arquivos GGUF Q4_0 ficam como assets de uma release GitHub, nunca no Git ou no APK:

| Arquivo | Tamanho | SHA-256 |
|---|---:|---|
| `chatterbox-t3-mtl-v3-q4_0.gguf` | 344,985,408 bytes | `d886fba27183c3000becb096b1a16526fafb67fe7abd541d7901040931524d16` |
| `chatterbox-s3gen-mtl-v3-q4_0.gguf` | 788,379,872 bytes | `ab3b5339f7305d5c35641a4db5024bea6aab9e2376d7f42d388a49b0b8d4145f` |

Release: https://github.com/fabiociba7-br/ciba-ai/releases/tag/garcia-chatterbox-v3-models

O download é iniciado pelo usuário e armazenado em `filesDir/chatterbox-models`. Também é possível importar os dois GGUFs manualmente. Cada arquivo é validado pelo cabeçalho GGUF e pelo SHA-256 fixado no app; importação dos dois arquivos é transacional para preservar a instalação anterior em caso de falha. Os pesos não são incluídos em commits, APKs ou artefatos de CI.

O modelo utilizado é o multilingual V3 geral, com idioma `pt`. Ele aceita português, mas não é o fine-tune dedicado pt-BR. A versão pt-BR dedicada existe upstream, porém ainda não foi convertida para este formato GGUF e validada com o runtime Android.

## Fluxo e privacidade

1. O usuário grava ou importa áudio de 5–30 s; recomenda-se 10–15 s de fala clara, sozinho e sem música/ruído. A validação rejeita WAV truncado, silêncio/volume muito baixo e clipping extremo; não promete medir SNR nem identificar todo ruído de fundo.
2. O app valida duração/tamanho, normaliza o áudio e salva a referência e os checksums no storage privado.
3. O botão **Ouvir voz clonada** sintetiza uma prévia com o perfil selecionado sem alterar a voz ativa.
4. **Usar esta voz** persiste `voice_mode=cloned` e o ID do perfil. As respostas faladas passam pelo motor local.
5. Excluir o perfil ativo apaga referência/cache e restaura o TTS do sistema.
6. Se motor/modelo/perfil falhar, a UI mostra erro e não substitui silenciosamente a voz.

Áudio original, WAV, cache de condicionamento e PCM sintetizado nunca são enviados ao Worker Ciba AI nem a terceiros. O motor não tem API de rede. Whisper/STT permanece separado e não participa da clonagem.

## Validação pendente

- CI: `:app:testDebugUnitTest`, `:app:compileDebugKotlin`, `:app:externalNativeBuildDebug` e `:chatterbox-runtime:externalNativeBuildDebug`.
- Aparelho real: instalar/importar modelos, gravar/importar referência, validar prévia audível, ativar perfil e ouvir uma resposta real da Garcia, alternar para SYSTEM, excluir perfil, interromper reprodução e verificar ausência de áudio enviado à rede.
- Medir tempo de inicialização, latência por frase, pico de RAM, temperatura e estabilidade em aparelho intermediário. Não prometer tempo real ou qualidade de clonagem antes dessas medições.
- `src/core/native-capabilities.ts` permanece `planned` / `review_required`; não marcar `available` nesta fase.
- A release atual fixa os hashes dos modelos consumidos pelo app; a revisão exata do snapshot Hugging Face usado na conversão original ainda precisa ser registrada para reprodutibilidade integral do rebuild.

## Segurança e compatibilidade

- Consentimento explícito de que a voz é do usuário ou que há autorização da pessoa gravada.
- SHA-256 de referência, WAV e modelos; caminhos relativos e confinados ao storage privado.
- Sem modelos no Git, sem upload de áudio, sem serviços pagos e sem fallback em nuvem.
- TTS nativo permanece intacto para o modo SYSTEM.
- Nenhuma permissão nova de storage foi adicionada; gravação usa a permissão de microfone já existente.
