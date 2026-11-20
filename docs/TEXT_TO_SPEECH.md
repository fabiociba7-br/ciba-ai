# Síntese de voz local da Garcia

## Objetivo

Adicionar voz falada à Garcia como capacidade nativa, sem APIs externas, endpoints remotos ou envio de texto/áudio para fora do ambiente local.

O primeiro motor avaliado é [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox). O código upstream está sob MIT, mas a licença e as condições de distribuição de cada checkpoint/peso precisam ser verificadas separadamente. O upstream documenta suporte multilíngue, incluindo português, mas não se presume um checkpoint pt-BR dedicado.

## Componentes implementados

- `src/core/text-to-speech.ts`: contratos de solicitação, consentimento explícito, adapter, registro, limites de concorrência e validação do áudio.
- `src/core/desktop-chatterbox-bridge.ts`: contrato entre o núcleo TypeScript e o host desktop local, com verificação de runtime, modelo e SHA-256 dos pesos.
- `createDesktopChatterboxAdapter`: adapter desktop fail-closed. Só pode ser criado quando a licença do checkpoint estiver aprovada e o host fornecer uma implementação local.
- `createChatterboxRegistry`: registro que rejeita adapters enquanto a política de licença não estiver aprovada.
- `runChatterboxSynthesis`: valida consentimento, requisição, concorrência e resultado antes de devolver áudio.
- `src/core/native-capabilities.ts`: Chatterbox permanece planejado, com runtime somente `desktop_local`, 4 GB de RAM mínima indicativa e sem pesos incluídos.
- `src/core/index.ts`: exporta o contrato e o adapter.

## Limite arquitetural

O adapter TypeScript está implementado; o runtime Python/PyTorch e a ponte concreta do aplicativo desktop ainda não estão. O Cloudflare Workers não pode executar diretamente Python/PyTorch nem processos locais. Portanto, o Worker não inicia subprocessos, abre sockets, chama URLs ou tenta alcançar o desktop.

O host desktop deverá implementar `DesktopChatterboxBridge` usando uma integração local incorporada (por exemplo, binding nativo ou processo filho estritamente local com protocolo stdio). Essa implementação deverá impor limites de tamanho/tempo, encerrar o processo em cancelamento e nunca abrir uma porta de rede. O contrato atual não cria esse processo nem implementa transporte.

O adapter confere o SHA-256 esperado e o estado do runtime antes de cada síntese. A saída é copiada ao atravessar a fronteira do host. A validação superior em `runChatterboxSynthesis` continua obrigatória.

## Licença e ativação

A licença dos pesos/checkpoints ainda está `review_required`. Por isso, `createDesktopChatterboxAdapter` exige explicitamente `licenseStatus: "approved"` e falha antes de construir o adapter se a aprovação não existir. Não se deve contornar essa barreira usando uma licença presumida do código-fonte.

Nenhum pacote Python, peso de modelo, checkpoint, binário nativo ou arquivo de voz foi baixado ou incluído. Nenhum runtime foi instalado ou ativado. A capacidade continua `planned`, não `available`.

## Privacidade e consentimento

- Cada síntese exige consentimento explícito associado à ação do usuário.
- Texto e áudio não são enviados a provedores externos.
- A geração de voz não grava conversas nem adiciona memórias.
- Clonagem de voz e perfis derivados de amostras pessoais não fazem parte do bridge desktop descrito nesta seção. O runtime Android local é separado e está documentado abaixo.
- Uma futura clonagem exigirá consentimento separado e verificável do titular da voz, além de política de armazenamento e exclusão.

## Próximas etapas técnicas

1. Revisar e aprovar a licença do checkpoint exato.
2. Escolher o artefato e fixar sua versão e SHA-256.
3. Implementar a ponte local no host desktop da Garcia, sem servidor HTTP ou sockets.
4. Integrar reprodução de áudio à interface real da Garcia.
5. Só então avaliar compatibilidade e alterar o status de capacidade.

## Referência

- https://github.com/resemble-ai/chatterbox


## Runtime Android incorporado — separado do bridge desktop

A branch candidata `feature/garcia-voice-cloning-mainline` adiciona um runtime Android independente:

- `android_embedded`: módulo C++/GGML via JNI, sem Python/PyTorch, sem Worker e sem serviço TTS externo.
- Engine escolhida para validação: `gianni-cor/chatterbox.cpp`, commit `ddca05fb69c2910b0d7b5eae420d360ed98c067b`, com patch local para o caminho multilingual.
- Os modelos GGUF Q4_0 são obtidos sob ação explícita do usuário ou importados manualmente; hashes são fixados no app e verificados antes de aceitar os arquivos. Os pesos não são incluídos no Git nem no APK.
- Referências, WAV normalizado, cache de condicionamento e áudio sintetizado permanecem no armazenamento privado do Android. O app não envia áudio ou texto para clonagem ao Worker.
- `LocalSpeechOutput` preserva o TTS nativo em modo `SYSTEM` e roteia para o motor local em modo `CLONED`. Falhas no modo clonado são explícitas; não existe fallback silencioso.
- O contrato `desktop-chatterbox-bridge` continua exclusivo do desktop e não é usado pelo Android.

### Limites ainda não validados

- O GGUF atualmente distribuído é o Chatterbox Multilingual V3 geral: aceita português, mas não é o fine-tune dedicado brasileiro. O pacote pt-BR dedicado existe upstream, porém ainda não foi convertido e validado neste pipeline.
- A implementação Android atual é CPU-only, com até quatro threads. Latência, pico de RAM, aquecimento e qualidade de similaridade ainda precisam ser medidos em aparelho físico.
- Até o teste de dispositivo e o CI nativo passarem, o status de `text_to_speech`/`voice_conversion` em `native-capabilities.ts` permanece `planned` / `review_required`. Não anunciar como capacidade disponível.
