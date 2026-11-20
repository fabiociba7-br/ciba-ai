# Garcia Research nativo no Cloudflare Worker

## Arquitetura

A pesquisa agora é executada pelo próprio Worker TypeScript. O pacote Python garcia_research permanece independente e não é importado pelo runtime Edge.

1. O runCibaOrchestrator apresenta a ferramenta garcia.research ao especialista de pesquisa/coding.
2. O modelo devolve uma proposta no protocolo interno CIBA_TOOL_CALL_V1.
3. O registry valida o schema e a aprovação durável D1 é solicitada, porque a operação pode publicar um commit remoto.
4. Após aprovação, GarciaResearchService gera queries com o binding env.AI, consulta DuckDuckGo com fetch, sintetiza evidências com o mesmo binding e publica o Markdown pela GitHub Contents API.
5. O resultado volta ao orquestrador e é sintetizado na resposta da Garcia.

Não há GitHub Actions, subprocess, Python runtime ou webhook no caminho da pesquisa.

## Configuração

O wrangler.toml define:

- GITHUB_REPOSITORY: owner/repo
- GITHUB_BRANCH: branch que recebe os relatórios
- GITHUB_RESEARCH_PUBLISH: true para publicar
- GITHUB_REPORTS_PATH: diretório remoto dos relatórios

O token é sempre um secret, nunca uma variável versionada.

Produção:

~~~bash
npx wrangler secret put GITHUB_TOKEN
~~~

Desenvolvimento local, em .dev.vars (não versionar):

~~~dotenv
GITHUB_TOKEN=github_pat_...
~~~

Use um token fine-grained restrito ao repositório escolhido, com Contents: Read and write. Não conceda Actions, Administration ou permissões desnecessárias.

Para executar sem publicar, configure GITHUB_RESEARCH_PUBLISH=false no ambiente local.

## Segurança e limites

- A ferramenta é risk: external e requiresApproval: true. A pesquisa e o commit só começam depois da aprovação durável já implementada pelo backend.
- O Worker usa env.AI; não existe chave LLM duplicada.
- O cliente DuckDuckGo usa cache em memória por isolate, timeout, backoff exponencial, jitter e Retry-After para 429/503. Uma página de CAPTCHA/challenge é tratada como bloqueio; não há tentativa de contornar CAPTCHA, rotacionar identidades ou mascarar automação.
- Os resultados externos são dados não confiáveis para o prompt de síntese.
- A publicação usa GitHub Contents API, lê o SHA atual quando o arquivo existe e envia sha no update. Não há force push. HTTP 409/422 e proteção de branch resultam em erro explícito.
- O limite da ferramenta no registry é de 45 segundos. Pesquisas profundas podem exceder limites operacionais; reduza depth ou separe a execução se a latência do provider crescer.
- Com GITHUB_RESEARCH_PUBLISH=false, a pesquisa não publica. Quando GITHUB_RESEARCH_PUBLISH=true, GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios; a ausência deles falha explicitamente. Se a publicação estiver habilitada, erros do GitHub não são silenciosamente ignorados.

## Teste local

~~~bash
npm install
npm run check
npx wrangler dev
~~~

No chat da Garcia, solicite por exemplo: “Pesquise as falhas de segurança em OAuth2, com foco em PKCE e redirect_uri”. O modelo pode propor garcia.research; a interface recebe uma proposta de ferramenta para aprovação. Depois da aprovação, a resposta inclui o relatório e, se configurado, o caminho e URL do commit.

Para validar o parser isoladamente, os testes em tests/services/research.test.ts mockam o HTML e a API GitHub. Não disparam tráfego real ao DuckDuckGo nem criam commits reais.
