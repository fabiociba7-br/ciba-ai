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
- Criar convites individuais e com validade curta.
- Revogar dispositivos comprometidos removendo seu registro em D1.
- Configurar limites conservadores e monitorar consumo.
- Não registrar tokens, prompts ou respostas em logs.
- Não habilitar fallback para provedores pagos.
- Não armazenar histórico de conversas neste serviço.
- Configurar alertas e limites na própria conta Cloudflare.

## Limitação importante

As cotas deste Worker são limites internos de aplicação. Elas não substituem os limites e as regras de uso da Cloudflare. O plano gratuito pode ter limites de capacidade; ao esgotá-los, o serviço deve retornar erro e não contratar recursos pagos automaticamente.
