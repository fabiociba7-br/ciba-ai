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

## Catálogo extensível de provedores e integrações

A Garcia deve ter um **catálogo central de provedores** e um **sistema de adaptadores por capacidade**, para que novas contas e serviços compatíveis possam ser adicionados pela interface sem alterações no código do aplicativo.

A tela **Configurações → Conexões e credenciais** terá categorias e um fluxo de adicionar conexão:
- **Execução e notebooks em nuvem**: Kaggle e Google Colab desde a primeira versão; permitir cadastrar outros ambientes de notebooks, GPU sob demanda, runners e computação remota.
- **Servidores e infraestrutura**: servidores próprios/VPS, endpoints HTTP(S), SSH/SFTP e serviços compatíveis com APIs documentadas.
- **Armazenamento e sincronização**: provedores de objetos e arquivos, serviços compatíveis com S3, WebDAV, SFTP e armazenamento próprio; permitir configurar destino, pasta/bucket, limites e política de sincronização.
- **IA e modelos**: provedores de LLM, TTS, ASR, geração de imagens e repositórios de modelos.
- **Desenvolvimento e automação**: GitHub, Composio e outros serviços compatíveis.
- **Outros serviços**: opção de conexão personalizada para endpoints e APIs que sigam protocolos já suportados.

### Kaggle e Google Colab

Kaggle e Google Colab devem aparecer como provedores de primeira classe no catálogo, com configurações independentes:
- autenticação/conta e estado da conexão;
- seleção de notebook, projeto ou runtime, quando a API permitir;
- parâmetros de execução, GPU/CPU e limites disponíveis, sempre conforme os recursos reais do provedor;
- iniciar, acompanhar, consultar logs/saídas e interromper execuções, apenas quando suportado pela API e pelas permissões concedidas;
- baixar e encaminhar artefatos para um destino de armazenamento configurado;
- exibir claramente quotas, disponibilidade, expiração de sessão e limitações do plano, sem prometer GPU ou execução contínua.

A integração deve usar APIs oficiais ou interfaces documentadas. Não automatizar cliques, contornar limites, nem presumir que uma sessão interativa do Colab equivale a uma API estável. Se uma operação não for oficialmente suportada, a Garcia deve informar a limitação e oferecer fluxo assistido/manual.

### Como adicionar um novo provedor sem recompilar

O catálogo terá duas camadas:

1. **Definições declarativas de provedores**: nome, categoria, documentação, campos de configuração, método de autenticação, capacidades, endpoints permitidos, validação e ações disponíveis. Para um provedor que use um protocolo e capacidades já implementados, basta adicionar/editar sua definição pela interface ou importar uma configuração validada.
2. **Adaptadores de protocolo/capacidade**: componentes reutilizáveis para OAuth/PKCE, API key, Bearer, REST/HTTP, S3, WebDAV, SFTP/SSH e execução remota. Um protocolo realmente novo, uma API proprietária ou uma capacidade que ainda não exista exigirá implementar e auditar um adaptador uma única vez; depois disso, outros provedores compatíveis poderão ser cadastrados sem nova alteração de código.

Não permitir que uma configuração arbitrária execute código, scripts ou plugins não confiáveis dentro do processo da Garcia. Configurações importadas devem ser validadas, limitadas a capacidades conhecidas e exigir consentimento para permissões sensíveis.

### Configuração por conexão

Cada conexão poderá definir, conforme a capacidade do provedor:
- nome amigável, categoria e provedor;
- URL/base endpoint, região, porta e identificador do recurso;
- autenticação e referência ao segredo no cofre correto;
- limites de uso, timeout, tentativas e política de retentativa;
- preferências de execução, armazenamento, sincronização e retenção;
- prioridade, disponibilidade e regras de fallback;
- permissões concedidas e operações que exigem confirmação.

A interface deve oferecer ações **Adicionar**, **Testar conexão**, **Editar**, **Ativar/Desativar**, **Rotacionar credencial**, **Revogar** e **Remover**, além de mostrar o estado e a data da última validação. Campos e ações devem variar conforme as capacidades efetivamente suportadas pelo adaptador.

### Roteamento entre execução e armazenamento

A Garcia deve permitir selecionar um ambiente de execução (por exemplo, Kaggle ou Colab) e um destino de armazenamento (por exemplo, S3 compatível, WebDAV, SFTP ou servidor próprio) de forma independente. Os resultados de notebooks, modelos, áudio e outros artefatos poderão ser enviados ao destino escolhido, respeitando permissões, limites, retenção e confirmação para compartilhamento externo.

A camada de orquestração deve trabalhar com referências de conexão e capacidades, nunca com segredos em texto claro. Logs e histórico registram identificadores e resultados sanitizados, não tokens nem conteúdo secreto.

### Critérios adicionais de aceite

- Kaggle e Google Colab aparecem no catálogo e podem ser configurados separadamente pela interface.
- É possível cadastrar mais de uma conta ou instância do mesmo provedor, com nomes distintos.
- É possível adicionar conexões de servidores e armazenamento sem recompilar quando usam adaptadores já suportados.
- Um provedor novo baseado em protocolo suportado pode ser definido sem código; capacidades desconhecidas são recusadas com explicação clara.
- Uma conexão pode ser testada, desativada, reativada, atualizada e removida pela Garcia.
- Execuções e transferências mostram estado, progresso quando disponível, logs sanitizados e artefatos.
- Limites de quota, permissões, custos e restrições do fornecedor são apresentados sem inferências ou promessas.
- Configurações importadas não podem executar código arbitrário nem ampliar privilégios.
