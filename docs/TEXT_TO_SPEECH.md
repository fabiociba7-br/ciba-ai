# Síntese de voz local da Garcia

## Objetivo

Adicionar voz falada à Garcia como capacidade nativa do próprio projeto, sem APIs externas, serviços de terceiros, endpoints remotos ou envio de texto/áudio para fora do dispositivo/ambiente local.

O primeiro motor avaliado é [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox). O código upstream está sob MIT, mas a licença e as condições de distribuição de cada checkpoint/peso precisam ser verificadas separadamente antes de aprovar ou distribuir qualquer modelo. O projeto upstream informa que foi aposentado em agosto de 2026 e não recebe mais manutenção.

## O que foi implementado no núcleo

- `src/core/text-to-speech.ts`: contratos para solicitação, consentimento explícito, adapter local, registro, limites, concorrência e validação do áudio de saída.
- `createChatterboxRegistry`: registro fail-closed; só aceita adapters quando a política de licença estiver aprovada.
- `validateTextToSpeechRequest`: valida texto, idioma, perfil vocal e consentimento para síntese.
- `runChatterboxSynthesis`: executa somente um adapter previamente injetado pelo aplicativo hospedeiro, limita a saída e libera o slot mesmo em falhas.
- `src/core/native-capabilities.ts`: Chatterbox agora aparece na capacidade de síntese de voz, com runtimes somente locais (`desktop_local` e `android_embedded`).
- `src/core/index.ts`: exporta os contratos e funções públicas.

## Limites intencionais

Esta entrega é a fundação TypeScript integrada à Garcia, não a engine Python já executável. O núcleo atual também roda no Cloudflare Workers, que não pode hospedar diretamente o runtime Python/PyTorch do Chatterbox. Por isso, o módulo não tenta executar subprocessos, abrir sockets, chamar URLs, iniciar serviços ou acessar a rede.

O próximo passo de execução real precisa ser um adapter embarcado no aplicativo/ambiente local (desktop ou Android), que invoque o motor sem tráfego de rede. Não se deve implementar um servidor HTTP, endpoint remoto, proxy Cloudflare ou serviço SaaS para contornar essa separação.

Nenhum pacote Python, peso de modelo, checkpoint, binário nativo ou arquivo de voz foi baixado ou incluído. Nenhuma instalação ou ativação automática foi feita.

## Política de privacidade e consentimento

- Cada síntese exige consentimento explícito associado à ação do usuário.
- Texto e áudio não são enviados a provedores externos.
- A geração de voz não grava conversas nem adiciona memórias.
- Clonagem de voz e perfis derivados de amostras pessoais não fazem parte desta etapa.
- Uma futura clonagem exigirá consentimento separado e verificável do titular da voz, além de política específica de armazenamento e exclusão.
- O catálogo permanece com licença `review_required`; adapters não podem ser registrados até a revisão formal da licença do modelo e dos pesos.

## Modelo e idioma

O upstream documenta Chatterbox Multilingual V3 (aproximadamente 500M parâmetros) e suporte a português (`pt`). O catálogo de modelos também inclui variantes especializadas por idioma. A escolha de um checkpoint brasileiro específico só deve ocorrer após confirmar a existência, a licença, a procedência e os requisitos de hardware do artefato exato. Não se presume que um modelo pt-BR dedicado esteja instalado.

## Próxima etapa técnica

1. Escolher o checkpoint exato e revisar a licença dos pesos.
2. Definir os requisitos mínimos de CPU, RAM, armazenamento e aceleração para o hardware-alvo.
3. Implementar o adapter local nativo sem transporte de rede.
4. Integrar reprodução de áudio na interface da Garcia.
5. Manter a síntese desativada até o adapter e o modelo passarem pela revisão de compatibilidade e privacidade.

## Referência

- https://github.com/resemble-ai/chatterbox
