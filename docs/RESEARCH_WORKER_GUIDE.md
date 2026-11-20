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

## Modelos de imagem

O wrangler.toml configura openai/gpt-image-1.5 via binding Workers AI. A documentação do Cloudflare descreve geração e edição por prompt, com imagens de referência no parâmetro images[]. Esse é um modelo de provedor terceiro dentro do catálogo Cloudflare e pode gerar cobrança/depender da disponibilidade da conta. A síntese e visão usam o modelo configurado em AI_MODEL/GARCIA_VISION_MODEL.

Fontes oficiais:
- Workers AI GPT Image 1.5: https://developers.cloudflare.com/workers-ai/models/openai/gpt-image-1.5/
- Workers AI FLUX.2 Klein 4B: https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/
- R2 Workers API: https://developers.cloudflare.com/r2/get-started/workers-api/

## Preparar Cloudflare

Crie o bucket:

~~~bash
npx wrangler r2 bucket create garcia-artifacts
~~~

Crie o namespace KV e copie o ID retornado para GARCIA_PROMPT_CACHE.id em wrangler.toml:

~~~bash
npx wrangler kv namespace create GARCIA_PROMPT_CACHE
~~~

O ID zero no arquivo é somente um placeholder para desenvolvimento local. Não faça deploy remoto até substituí-lo pelo ID real.

Configure os secrets:

~~~bash
npx wrangler secret put ARTIFACT_URL_SECRET
~~~

Use um valor aleatório forte com pelo menos 32 bytes. O segredo assina URLs temporárias de leitura de artefatos. Não o coloque no repositório nem no wrangler.toml.

Defina PUBLIC_API_BASE_URL no wrangler.toml para a URL pública do Worker, por exemplo a URL real workers.dev ou domínio de API. As URLs de artefatos são assinadas e expiram; o bucket R2 permanece privado e não precisa de acesso público.

## Migração e teste local

~~~bash
npm install
npx wrangler d1 migrations apply ciba-ai-db --local
npm run check
npx wrangler dev
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
