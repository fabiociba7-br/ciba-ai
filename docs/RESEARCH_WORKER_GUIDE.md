# Garcia Research + Visual Studio no Cloudflare Worker

## Arquitetura

A Garcia executa pesquisa e criação visual dentro do mesmo Worker TypeScript. O pacote Python continua independente e não participa do runtime Edge.

- Workers AI: planejamento de queries/prompts, síntese e análise visual.
- DuckDuckGo HTML/Images: descoberta de fontes e referências visuais; bloqueios e CAPTCHA encerram a busca sem evasão.
- R2 (GARCIA_ARTIFACTS): imagens, relatórios JSON/Markdown e versões.
- D1: sessões visuais, iterações, feedback, análise, assets e isolamento por owner/app/device.
- KV (GARCIA_PROMPT_CACHE): cache temporário de prompts refinados com TTL.
- GitHub: somente código-fonte; não recebe relatórios, imagens ou commits gerados pela pesquisa.

A ferramenta continua registrada como garcia.research para preservar compatibilidade. O modo visual é acionado por visual_mode=true. mode=generate cria/edita imagens; mode=search pesquisa referências e aplica curadoria por Vision AI.

## Iteração visual

Primeira solicitação:

~~~json
{
  "topic": "Diagrama visual da arquitetura OAuth2",
  "visual_mode": true,
  "mode": "generate",
  "focus": ["backend", "PKCE", "fluxo de tokens"]
}
~~~

A resposta inclui session_id, iteration, image_url, visual_analysis e prompt_used. Para refinar, o modelo reutiliza session_id e envia feedback:

~~~json
{
  "session_id": "UUID retornado pela primeira execução",
  "feedback": "Deixe o fundo mais escuro e dê mais destaque ao componente backend"
}
~~~

O D1 conserva o histórico e cada iteração grava uma nova imagem no R2; a versão anterior permanece disponível.

## Modelo de imagem e custo

O modelo padrão é `@cf/black-forest-labs/flux-2-klein-4b`, hospedado no catálogo Workers AI. Ele unifica geração e edição com referências. O Worker envia multipart pelo binding `env.AI`, e as iterações usam a imagem anterior como `input_image_0`; a geração é limitada a 480×480 para cumprir o limite documentado de imagem de referência inferior a 512×512. O modelo aceita até quatro referências, mas o fluxo atual usa uma.

A tabela de preços atual do Cloudflare informa 26,05 Neurons por tile 512×512 gerado e 5,37 Neurons por tile de entrada. Workers AI inclui 10.000 Neurons por dia sem custo; acima da franquia, o Workers Free bloqueia novas chamadas e o Workers Paid cobra excedentes. A geração visual consome essa mesma franquia compartilhada com LLM e visão. Acompanhe o painel de consumo; não existe garantia de uso ilimitado gratuito.

O modelo é parceiro da Black Forest Labs e está marcado no catálogo como Cloudflare-hosted e zero data retention. Verifique também os termos/licença do provedor antes de usar comercialmente.

Fontes oficiais:
- [FLUX.2 Klein 4B — parâmetros e edição multipart](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/)
- [Anúncio técnico — multipart e imagens de referência](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/)
- [Preços Workers AI e Neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI Gemma 4 — visão multimodal](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)

## Aprovação e execução no chat

A proposta externa é apresentada no chat com os argumentos validados. O usuário aprova ou rejeita; depois, a ação explícita “Executar ação aprovada” chama `POST /v1/owner/tool-approvals/{approval_id}/execute`. Esse endpoint reconstrói o runtime a partir da identidade autenticada, consome a aprovação D1 de uso único, executa somente `garcia.research` e persiste o resultado em `tool_approval_results`. Repetições retornam o resultado salvo em vez de gerar uma segunda imagem. Se a aprovação for consumida e a execução falhar antes de salvar o resultado, ela não pode ser reutilizada; uma nova proposta deve ser criada.

## Preparar Cloudflare

Crie o bucket:

~~~bash
npx wrangler r2 bucket create garcia-artifacts
~~~

Crie o namespace KV e copie o ID retornado para GARCIA_PROMPT_CACHE.id em wrangler.toml:

~~~bash
npx wrangler kv namespace create GARCIA_PROMPT_CACHE
~~~

O ID zero no arquivo é somente um placeholder para desenvolvimento local. Não faça deploy remoto até substituí-lo pelo ID real. O binding R2 usa simulação local no wrangler dev; crie o bucket remoto antes do deploy.

Configure os secrets:

~~~bash
npx wrangler secret put ARTIFACT_URL_SECRET
~~~

Use um valor aleatório forte com pelo menos 32 bytes. O segredo assina URLs temporárias de leitura de artefatos. Não o coloque no repositório nem no wrangler.toml.

Para desenvolvimento local, crie `.dev.vars` (arquivo ignorado pelo Git) com o mesmo segredo:

~~~dotenv
ARTIFACT_URL_SECRET=cole_um_valor_aleatorio_hex_com_64_caracteres
~~~

O Worker usa automaticamente a origem da requisição atual para assinar URLs, inclusive em wrangler dev. As URLs de artefatos são assinadas e expiram em 30 dias; quem possuir o link pode acessá-lo até o vencimento. O bucket R2 permanece privado e não precisa de acesso público.

## Migração e teste local

~~~bash
npm install
npx wrangler d1 migrations apply ciba-ai-db --local
npm run check
npx wrangler dev
~~~

Antes de qualquer deploy remoto, crie os recursos e aplique também a migração remota:

~~~bash
npx wrangler d1 migrations apply ciba-ai-db --remote
npx wrangler secret put ARTIFACT_URL_SECRET
~~~


~~~

O Wrangler simula R2 e KV localmente. Os objetos locais ficam no estado local do Wrangler e não alteram o bucket de produção. Para testar com recursos remotos, configure explicitamente os bindings remotos e entenda que as gravações afetarão a conta Cloudflare.

No chat, peça uma imagem e depois responda com um ajuste. A ferramenta deve reutilizar o session_id que retornou. A busca de imagens pode ser bloqueada pelo provedor; nesse caso, a Garcia informa a falha e não tenta contornar o bloqueio.

## Segurança e limites

- A ferramenta é risk=external e requiresApproval=true. A aprovação durável D1 existente continua obrigatória antes de pesquisa externa, geração de imagem ou armazenamento.
- Todas as sessões e chaves R2 são prefixadas pelo owner_id e validadas também por app_id/device_id.
- URLs de artefatos são HMAC assinadas e temporárias; não habilite public access no bucket.
- O Worker valida tipo e tamanho das imagens e limita redirecionamentos de download.
- Resultados e imagens externas são conteúdo não confiável. A análise visual é avaliação de aderência, não certificação de direitos autorais nem de precisão técnica.
- O limite do registry é de 45 segundos. Geração de imagem e curadoria de várias referências podem exceder esse limite; nesse caso, a execução falha em vez de afirmar que concluiu.
