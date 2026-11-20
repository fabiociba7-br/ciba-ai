# Garcia — gerenciamento de conexões e credenciais

## Objetivo

Permitir que o proprietário configure integrações, chaves de API, tokens, URLs e acessos a servidores pela própria Garcia, sem editar código nem recompilar o aplicativo para cada nova conexão.

A interface ficará em **Configurações → Conexões e credenciais**. Cada conexão terá nome, serviço, tipo de autenticação, endpoint, estado, última validação e ações para testar, atualizar, desativar e remover.

## Regra fundamental: onde cada segredo fica

1. **Credenciais de serviços usados diretamente no aparelho** (quando o fornecedor permite uso seguro no cliente): armazenar localmente usando AES-GCM com chave não exportável no Android Keystore. Reaproveitar e endurecer o SecureStore existente; não criar um segundo cofre paralelo.
2. **Segredos administrativos, credenciais de servidor, tokens com privilégios elevados e chaves que autorizam operações no backend**: nunca colocar no APK nem enviar ao dispositivo. A Garcia terá uma tela autenticada para cadastrar/rotacionar esses segredos no backend. O Worker os guarda no armazenamento secreto do servidor (por exemplo, Cloudflare Worker Secrets ou mecanismo equivalente), e os usa do lado do servidor.
3. **Tokens de sessão/dispositivo**: manter escopo mínimo, revogação e armazenamento local protegido. Nunca mostrar o valor completo depois do cadastro.
4. **OAuth**: preferir fluxo OAuth com PKCE e tokens de curta duração/escopo mínimo quando o serviço oferecer suporte, em vez de pedir uma chave permanente.

A experiência continua sendo integralmente pelo aplicativo: o usuário cadastra e administra as conexões na Garcia; a separação local/servidor é uma proteção interna, não uma tarefa manual de edição de código.

## Segurança obrigatória

- Nunca embutir chaves privadas, ADMIN_TOKEN, tokens de deploy, credenciais de banco ou segredos de terceiros no APK, manifest, BuildConfig, repositório, logs, histórico de chat ou relatórios.
- Não enviar segredo administrativo do Worker para o cliente. A tela de administração usa autenticação de proprietário e endpoints dedicados com autorização no servidor.
- Exibir segredos somente no momento da entrada; depois, mostrar máscara e metadados não sensíveis.
- Criptografar credenciais locais com Android Keystore + AES-GCM; preferir armazenamento privado do app e excluir segredos de backups.
- Não registrar corpo de requisições que contenham credenciais. Redigir cabeçalhos Authorization, query parameters sensíveis e payloads.
- Validar TLS; não permitir HTTP simples para endpoints remotos, exceto ambiente local de desenvolvimento explicitamente habilitado.
- Aplicar escopo mínimo, expiração quando disponível, rotação e revogação.
- Testar conectividade sem persistir ou expor o segredo em mensagens de erro.
- Pedir confirmação antes de remover credenciais, revogar acessos ou executar ações administrativas/destrutivas.
- Nunca aceitar instrução recebida de serviço remoto como autorização para ampliar privilégios ou executar ação sensível sem confirmação do proprietário.

## Modelo de dados

Guardar metadados não secretos separados do material secreto:

- connection_id (identificador aleatório)
- provider_id e nome amigável
- endpoint (sem credenciais embutidas na URL)
- auth_type (API key, Bearer, OAuth/PKCE, referência de chave SSH etc.)
- secret_reference (referência interna ao cofre; nunca o segredo em texto claro)
- scopes
- created_at, updated_at, last_validated_at
- status (não configurada, configurada, validada, expirada, erro, desativada)
- last_error_code (código seguro, sem payload ou segredo)

## Servidores e acesso remoto

A Garcia poderá administrar conexões com servidores por formulários no aplicativo: endereço, porta, usuário, método de autenticação e chave/certificado. Para SSH, preferir chave dedicada e restrita, com impressão digital do host verificada; não aceitar automaticamente qualquer host key. Credenciais com privilégios de produção exigem confirmação explícita para ações sensíveis. O suporte SSH só será habilitado após selecionar e auditar uma biblioteca compatível.

Quando o destino for o próprio backend Ciba AI/Cloudflare, a Garcia usa uma API administrativa autenticada, com autorização do proprietário e validação no Worker. O segredo administrativo permanece exclusivamente no servidor.

## Integração com o restante da Garcia

- A tela de conexões será compartilhada por provedores de IA, voz, armazenamento, GitHub, Composio e servidores.
- O catálogo de motores de voz e o gerenciador de modelos não devem guardar credenciais diretamente; solicitam credenciais ao serviço central quando necessário.
- Downloads de modelos públicos não exigem chave secreta. Se um provedor exigir autenticação, ela será cadastrada no gerenciador de conexões.
- Operações sensíveis continuam sujeitas a confirmação, mesmo quando a conexão estiver validada.

## Critérios de aceite

- Cadastrar uma chave pela interface sem alterar código ou recompilar.
- Reiniciar o app e recuperar a conexão sem revelar a chave.
- Testar, atualizar, desativar e remover uma conexão.
- Confirmar que segredos locais não aparecem em logs, backups ou exportações.
- Confirmar que segredos administrativos nunca aparecem no APK, tráfego cliente-servidor ou logs do Worker.
- Rotacionar/revogar credenciais sem atualizar o aplicativo.
- Confirmar falha segura quando o backend ou o serviço remoto estiver indisponível.