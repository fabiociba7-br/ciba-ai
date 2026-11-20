# Garcia Research — Operation Guide

## Runtime oficial

O runtime de produção é o Cloudflare Worker TypeScript. A pesquisa e o Estúdio Visual usam Workers AI, DuckDuckGo, R2, D1 e KV. GitHub é exclusivamente o repositório do código-fonte: não há workflow de pesquisa, GitHub Publisher, commit de relatório ou webhook assíncrono.

Consulte [RESEARCH_WORKER_GUIDE.md](RESEARCH_WORKER_GUIDE.md) para bindings, migrações, sessões visuais, URLs assinadas e teste local com Wrangler.

## Ferramenta no chat

A ferramenta existente garcia.research oferece dois caminhos:

- Pesquisa textual: planeja queries, consulta DuckDuckGo, sintetiza evidências e salva JSON/Markdown em R2.
- Estúdio Visual: visual_mode=true com mode=generate ou mode=search. A primeira execução cria uma sessão D1; iterações seguintes reutilizam session_id e enviam feedback. Imagens e versões são armazenadas no R2.

Toda execução continua classificada como external e exige aprovação durável. A saída visual inclui session_id, iteration, image_url, visual_analysis, prompt_used e suggested_next_steps. O Worker também expõe o objeto em visual_studio na resposta HTTP para o cliente renderizar.

## Pacote Python opcional

O diretório garcia_research permanece como ferramenta local de desenvolvimento/testes, não como runtime do Worker. Ele não publica arquivos, não faz commits e não despacha GitHub Actions.

Instalação e testes:

~~~bash
python -m pip install -e ".[test]"
python -m pytest
~~~

Execução local sem publicação:

~~~bash
python -m garcia_research "JWT Security" --no-publish --json-output
python -m garcia_research --topic "OAuth2 security" --depth standard --focus PKCE --focus mitigation
~~~

O flag --no-publish é mantido apenas por compatibilidade com comandos antigos; não existe opção de publicação remota. O resultado JSON vai para stdout e os diagnósticos para stderr.

## Adapters de LLM do pacote local

- LocalPromptAdapter: determinístico, sem chave ou chamada externa.
- OpenAIAdapter: opcional; configure OPENAI_API_KEY e OPENAI_MODEL no ambiente local.
- GarciaLLMAdapter: adaptador HTTP genérico para testes de integração futuros; não é usado pelo Worker.

Nenhum segredo deve ser armazenado no repositório, no APK ou em argumentos de ferramentas.
