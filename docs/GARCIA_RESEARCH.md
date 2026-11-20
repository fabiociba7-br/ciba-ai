# Garcia Research

## Runtime de produção

A integração oficial é TypeScript nativo no Cloudflare Worker. O módulo fica em `src/services/research/` e utiliza Workers AI, DuckDuckGo, R2, D1 e KV. A ferramenta é registrada no runtime existente como `garcia.research`, classificada como externa e protegida pela aprovação durável.

O Estúdio Visual oferece criação e refinamento iterativo. O D1 guarda sessões, feedback e histórico de prompts; o R2 guarda cada imagem e os relatórios JSON/Markdown; o KV armazena temporariamente prompts refinados. A resposta HTTP inclui o objeto `visual_studio` para renderização pelo cliente.

GitHub é apenas o repositório do código-fonte. Não há GitHub Publisher, workflow de pesquisa ou commits de relatórios/imagens.

Consulte [RESEARCH_WORKER_GUIDE.md](RESEARCH_WORKER_GUIDE.md) para configuração de recursos Cloudflare, migração, modelos de imagem, URLs assinadas e teste local.

## Pacote Python local

O diretório `garcia_research/` permanece como ferramenta opcional de desenvolvimento/testes, não é importado nem executado pelo Worker. Ele faz pesquisa textual e retorna um relatório em memória/JSON; não publica artefatos e não possui integração Git.

Instalação e testes:

~~~bash
python -m pip install -e ".[test]"
python -m pytest
~~~

Exemplo:

~~~python
from garcia_research import GarciaResearchService, ResearchConfig

with GarciaResearchService(ResearchConfig()) as research:
    report = research.run("Vulnerabilities in OAuth2 flows")
print(report.to_dict())
~~~

O cliente usa atrasos limitados, cache em memória e backoff para 429/503. Não rotaciona identidades nem contorna CAPTCHA ou restrições de acesso. Os testes Python são separados da suíte Vitest do Worker.
