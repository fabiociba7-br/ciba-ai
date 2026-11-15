# Segurança

## Modelo de acesso

1. O administrador cria um convite vinculado a um `app_id`.
2. O aplicativo apresenta o convite no primeiro cadastro do dispositivo.
3. O convite é consumido uma única vez em uma operação D1 em lote.
4. O Worker gera um token aleatório de dispositivo e guarda somente seu SHA-256.
5. As chamadas seguintes exigem `Authorization: Bearer <token>`.

O identificador de aplicativo é uma declaração do cliente, não uma prova criptográfica de que o APK é genuíno. Um segredo embutido no APK também pode ser extraído. Para produção, adicionar atestação de integridade (por exemplo, Play Integrity, quando aplicável) ou um fluxo de identidade confiável. O gateway não deve tratar `app_id` como atestação.

## Regras obrigatórias

- Nunca colocar `ADMIN_TOKEN` em aplicativos móveis, repositórios ou variáveis públicas.
- Configurar `ADMIN_TOKEN` com pelo menos 32 caracteres aleatórios; sem esse requisito, as rotas administrativas permanecem desativadas e respondem `503 admin_auth_not_configured`.
- A autenticação administrativa compara hashes de tamanho fixo e limita a 10 falhas por minuto por IP de borda Cloudflare (`CF-Connecting-IP`).
- Os registros de falha armazenam somente o hash do IP combinado com o segredo administrativo; a tabela é limpa pelo cron após dois dias.
- O limite por IP é uma camada adicional contra força bruta, não substitui um token forte, proteção de conta Cloudflare nem controles de acesso administrativos.
- Criar convites individuais e com validade curta.
- Revogar dispositivos comprometidos removendo seu registro em D1.
- Configurar limites conservadores e monitorar consumo.
- Não registrar tokens, prompts ou respostas em logs.
- Não habilitar fallback para provedores pagos.
- Não armazenar histórico de conversas neste serviço.
- Configurar alertas e limites na própria conta Cloudflare.

Todas as respostas do Worker recebem `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `X-Frame-Options: DENY`, inclusive respostas de erro.

## Proteção administrativa

As rotas `/v1/admin/*` exigem `ADMIN_TOKEN` no cabeçalho Bearer. Falhas são limitadas por minuto usando o endereço fornecido pela borda Cloudflare; ao atingir o limite, o Worker responde `429 admin_auth_rate_limited` com `retry_after_seconds`. Se o cabeçalho de IP não estiver disponível, as falhas compartilham o bucket `unknown`, o que é intencionalmente conservador. A tabela `admin_auth_usage` guarda um hash com pepper derivado do `ADMIN_TOKEN`, nunca o endereço IP em texto puro.

O CORS não é mecanismo de autenticação. Por padrão, o Worker não libera nenhuma origem de navegador; configure `ALLOWED_ORIGINS` com as origens exatas apenas quando um frontend web confiável existir. Evite `*` em produção. Aplicativos nativos não dependem de CORS; se um painel web administrativo for criado, o token deve permanecer em ambiente seguro, nunca em código público ou APK.

## Limitação importante

As cotas deste Worker são limites internos de aplicação. Elas não substituem os limites e as regras de uso da Cloudflare. O plano gratuito pode ter limites de capacidade; ao esgotá-los, o serviço deve retornar erro e não contratar recursos pagos automaticamente.


## Tetos de consumo e plano gratuito

O código limita o gateway a 50 chamadas globais por dia, 25 por app, 10 por dispositivo, 512 tokens de saída e 3.000 caracteres de entrada por requisição. A configuração administrativa só pode reduzir esses limites. Isso é uma trava operacional, não uma garantia de que o consumo ficará sempre abaixo da franquia de Neurons: a unidade de cobrança depende dos tokens processados pelo modelo. Acompanhar o painel Workers AI é obrigatório.

Para preservar a política de custo zero, manter a conta no Workers Free. A Cloudflare informa uma franquia de 10.000 Neurons por dia; no Workers Free, novas operações falham ao atingir o limite. No Workers Paid, o excedente é cobrado. Não ativar o plano pago ou créditos pré-pagos sem autorização expressa.


## Limite de corpo HTTP

O Worker verifica o `Content-Length` quando disponível e também conta os bytes durante a leitura do stream. Requisições acima do limite são canceladas antes de o corpo inteiro ser acumulado em memória e recebem HTTP 413. Isso protege os endpoints JSON contra payloads grandes enviados sem um `Content-Length` confiável.
