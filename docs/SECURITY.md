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

## Proteção administrativa

As rotas `/v1/admin/*` exigem `ADMIN_TOKEN` no cabeçalho Bearer. Falhas são limitadas por minuto usando o endereço fornecido pela borda Cloudflare; ao atingir o limite, o Worker responde `429 admin_auth_rate_limited` com `retry_after_seconds`. Se o cabeçalho de IP não estiver disponível, as falhas compartilham o bucket `unknown`, o que é intencionalmente conservador. A tabela `admin_auth_usage` guarda um hash com pepper derivado do `ADMIN_TOKEN`, nunca o endereço IP em texto puro.

O CORS não é mecanismo de autenticação. Aplicativos nativos não dependem de CORS; se um painel web administrativo for criado, sua origem deve ser configurada explicitamente e o token deve permanecer em ambiente seguro, nunca em código público ou APK.

## Limitação importante

As cotas deste Worker são limites internos de aplicação. Elas não substituem os limites e as regras de uso da Cloudflare. O plano gratuito pode ter limites de capacidade; ao esgotá-los, o serviço deve retornar erro e não contratar recursos pagos automaticamente.
