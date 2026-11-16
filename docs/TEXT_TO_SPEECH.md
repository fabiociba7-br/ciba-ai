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
- Clonagem de voz e perfis derivados de amostras pessoais não fazem parte desta integração.
- Uma futura clonagem exigirá consentimento separado e verificável do titular da voz, além de política de armazenamento e exclusão.

## Próximas etapas técnicas

1. Revisar e aprovar a licença do checkpoint exato.
2. Escolher o artefato e fixar sua versão e SHA-256.
3. Implementar a ponte local no host desktop da Garcia, sem servidor HTTP ou sockets.
4. Integrar reprodução de áudio à interface real da Garcia.
5. Só então avaliar compatibilidade e alterar o status de capacidade.

## Referência

- https://github.com/resemble-ai/chatterbox
