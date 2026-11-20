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


## Importação de modelos de IA e envio ao servidor

A Garcia deve oferecer uma área **Modelos de IA → Importar modelo**, acessível pelo aplicativo, para que o proprietário possa adicionar modelos sem editar código ou recompilar o APK. O fluxo deve aceitar, conforme os formatos e provedores suportados:

- selecionar arquivos do aparelho ou de armazenamento conectado;
- importar de repositórios públicos/privados compatíveis (por exemplo, Hugging Face), usando URL ou identificador do repositório e autenticação cadastrada no gerenciador central;
- receber artefatos produzidos no Kaggle ou Google Colab e encaminhá-los ao servidor;
- selecionar o destino de armazenamento/servidor já configurado, com opção de usar uma área temporária de quarentena antes da publicação no catálogo.

### Fluxo de importação

1. O usuário escolhe o modelo, os arquivos ou o repositório de origem e o destino no servidor.
2. A Garcia coleta metadados: nome, versão, tarefa/modalidade (LLM, ASR, TTS, imagem etc.), arquitetura/família, formato, quantização, tamanho, idioma, origem, licença e requisitos de hardware, quando disponíveis.
3. Antes do envio, apresenta tamanho estimado, destino, permissões, eventuais custos e política de retenção; o usuário confirma a transferência.
4. A transferência ao servidor é autenticada, criptografada em trânsito, retomável após interrupções e acompanhada por progresso. Arquivos grandes não devem ser carregados integralmente na memória do aparelho.
5. O servidor recebe o material em quarentena, verifica integridade/hash, formato, manifesto, licença e origem; executa verificações de segurança e validação estrutural antes de permitir seu uso.
6. Após aprovação, registra o modelo em um catálogo/registro central, com versão, localização do artefato, estado, metadados e permissões. O modelo só fica disponível para seleção depois de passar pelas validações.
7. A Garcia permite testar o modelo em ambiente isolado e, mediante confirmação, disponibilizá-lo para inferência ou encaminhá-lo a um fluxo de treinamento/ajuste fino compatível.

### Importar não é o mesmo que treinar

A interface deve distinguir claramente três operações:
- **Importar/registrar**: enviar e armazenar os pesos e metadados no servidor.
- **Usar**: disponibilizar um modelo já treinado para inferência, respeitando compatibilidade e recursos.
- **Treinar/ajustar**: iniciar um job separado, com base de dados, objetivo, método, ambiente de execução, orçamento/limites e parâmetros explicitamente configurados pelo usuário.

Não afirmar que a Garcia aprendeu ou treinou apenas porque recebeu um arquivo. O treinamento só ocorre quando houver um pipeline de treino compatível e uma execução concluída com métricas/artefatos verificáveis. Importar um modelo não deve substituir automaticamente o modelo principal nem alterar o comportamento da Garcia: ativação, troca de modelo, fine-tuning ou publicação exigem prévia validação e confirmação do proprietário.

### Segurança, licenças e compatibilidade

- Nunca executar código, scripts, extensões ou pesos importados com privilégios administrativos apenas por terem sido enviados.
- Tratar modelos e arquivos como conteúdo não confiável; usar quarentena, limites de tamanho, validação de formato, hashes, verificação de arquivos compactados e ambiente isolado.
- Não carregar modelos com mecanismos de execução remota/código customizado habilitados por padrão (por exemplo, opções equivalentes a `trust_remote_code`); qualquer exceção exige revisão e confirmação explícitas.
- Verificar licença e restrições de uso/comercialização/redistribuição antes de habilitar download, compartilhamento ou publicação.
- Não aceitar arquivos de configuração que executem comandos arbitrários no servidor.
- Armazenar pesos em armazenamento configurado, com controle de acesso, versionamento, integridade, política de retenção e possibilidade de excluir/reverter uma versão.
- Separar credenciais de download, credenciais do servidor e permissões de execução. Nunca devolver segredos do servidor ao aparelho.
- Mostrar incompatibilidades de arquitetura, formato, runtime, memória, GPU/CPU, ABI e idioma; não prometer que qualquer modelo pode rodar em qualquer dispositivo.
- Para modelos privados, restringir o acesso por proprietário/conta e evitar que pesos ou URLs assinadas apareçam em logs e histórico.

### Critérios adicionais de aceite

- Importar um modelo pelo seletor de arquivos do Android e enviá-lo a um servidor configurado.
- Importar por repositório/URL quando o conector correspondente estiver disponível.
- Retomar transferência interrompida e verificar hash após upload.
- Ver o progresso, estado de validação, erros sanitizados, licença, tamanho e destino.
- Encontrar o modelo no catálogo central após aprovação, com versões e metadados.
- Testar em sandbox e ativar para inferência somente após validação e confirmação.
- Iniciar treinamento/ajuste fino apenas como ação separada, com parâmetros e confirmação explícitos.
- Confirmar que arquivos não validados não são executados nem disponibilizados automaticamente.


## Central de capacidades configuráveis — reduzir dependência de alterações no código

Além de conexões e modelos, a Garcia deve concentrar no aplicativo a configuração de todos os recursos que possam ser representados com capacidades, adaptadores e políticas já implementados. A meta é permitir que o proprietário acrescente fontes, destinos, ferramentas, rotinas e comportamentos operacionais por configuração, sem editar código para cada novo uso.

**Limite explícito:** configuração não cria uma capacidade técnica inexistente. Um novo protocolo, integração proprietária, tipo de execução ou componente nativo exige implementação e auditoria do adaptador uma vez. Depois de existir um adaptador seguro e genérico, novas instâncias e provedores compatíveis devem ser cadastráveis pela interface. Nunca resolver essa limitação permitindo execução arbitrária de scripts ou código remoto.

### 1. Catálogo de ferramentas, conectores e extensões declarativas

Criar uma área **Ferramentas e integrações** para:
- ativar/desativar ferramentas que já estejam instaladas e aprovadas;
- cadastrar instâncias, endpoints, parâmetros e credenciais de ferramentas suportadas;
- importar manifestos declarativos assinados ou validados, com nome, versão, fornecedor, permissões, capacidades, configuração e documentação;
- definir quais agentes podem utilizar cada ferramenta e em quais contextos;
- definir limites, timeout, quotas, rate limits, orçamento e necessidade de confirmação;
- visualizar versão, origem, permissões concedidas, última validação e histórico de alterações.

Manifestos não podem conter código executável arbitrário. Ferramentas executáveis ou plugins com código precisam ser distribuídos por canal confiável, passar por revisão de assinatura, permissões, dependências e sandbox, e exigir aprovação explícita antes de serem habilitados. O catálogo deve distinguir integração declarativa de extensão executável.

### 2. Agentes, funções e roteamento de modelos

Permitir configurar, sem editar código quando os recursos já existirem:
- perfis de agentes especializados (por exemplo, pesquisa, programação, voz, documentos, infraestrutura e análise);
- instruções de sistema e objetivos por agente, com histórico de versões;
- modelo principal, reserva e critérios de roteamento por tarefa;
- provedor, temperatura e parâmetros suportados pelo modelo;
- ferramentas autorizadas, fontes de conhecimento e limites de uso por agente;
- regras de delegação entre agentes, níveis de autonomia e condições para pedir aprovação;
- fallback por indisponibilidade, custo, latência, modalidade ou limite de contexto.

Alterações em instruções, modelos e permissões devem ter pré-visualização, validação e opção de reverter. Nenhum agente recebe privilégios administrativos apenas por uma instrução ou por importar um perfil.

### 3. Conhecimento, documentos e memória consultável

Criar **Conhecimento e fontes de dados** para:
- importar documentos e pastas por seletor Android, arquivos do servidor e armazenamento conectado;
- conectar fontes compatíveis, como repositórios Git, bases documentais, páginas e APIs autorizadas;
- escolher o que será indexado, atualizado, excluído ou mantido fora da busca;
- configurar sincronização manual ou periódica, quando suportada;
- acompanhar fila, progresso, erros, origem, data de atualização e versão do índice;
- definir coleções, etiquetas, permissões e quais agentes podem consultar cada coleção;
- habilitar busca semântica/RAG somente quando o pipeline e o armazenamento vetorial estiverem configurados;
- remover uma fonte e propagar a remoção/reindexação dos conteúdos derivados conforme a política de retenção.

Diferenciar claramente memória conversacional, preferências do proprietário, base documental/RAG e dados de treinamento. Adicionar um documento à base de conhecimento não significa treinar os pesos do modelo. Toda fonte deve preservar origem e referência para que respostas possam apontar de onde veio a informação.

### 4. Pipelines de treinamento e avaliação

A área **Treinamento e avaliação** poderá configurar jobs com componentes já implementados:
- escolher modelo base, método (por exemplo, fine-tuning/LoRA quando suportado), dataset, ambiente de execução e destino dos artefatos;
- configurar parâmetros, limites de tempo/custo e recursos de hardware disponíveis;
- validar formato, licença, consentimento e qualidade dos dados;
- separar treino, validação e teste, evitando vazamento entre conjuntos;
- acompanhar logs sanitizados, métricas, checkpoints, falhas e artefatos;
- comparar versões com um conjunto de avaliação e critérios definidos;
- exigir aprovação antes de promover um checkpoint a modelo ativo;
- manter versão anterior para rollback.

Treino nunca começa implicitamente após importação de modelo ou documento. Jobs com custo, dados privados ou publicação externa exigem confirmação clara.

### 5. Workflows, rotinas e automações

Criar um construtor visual de fluxos com blocos de capacidades já disponíveis:
- gatilhos manuais, horários, eventos, webhook e conclusão de outro job;
- etapas de pesquisa, chamada de modelo, transformação, importação/exportação, execução remota e notificação;
- condições, filtros, ramificações, repetição limitada, espera por aprovação e tratamento de erros;
- seleção de agente, conexão, modelo, destino e política de execução por etapa;
- execução sob demanda, agendada ou recorrente, com pausa, cancelamento e histórico;
- limites de frequência, orçamento, concorrência e janela de execução.

Rotinas com efeitos externos, publicação, exclusão, cobrança ou produção devem pausar para confirmação quando a política exigir. Não executar fluxos infinitos nem permitir que uma saída de modelo altere as próprias permissões.

### 6. Fontes, APIs, webhooks e integrações personalizadas

Permitir cadastrar endpoints e APIs documentadas por formulário:
- método HTTP, URL/base URL, parâmetros, cabeçalhos não secretos, esquema de entrada/saída e autenticação referenciada ao cofre;
- limites de domínio/host, timeout, tamanho máximo, rate limit e política de retentativa;
- webhook de entrada com segredo de validação, assinatura, rotação e proteção contra replay;
- webhook de saída com eventos permitidos, destino aprovado e política de retries;
- mapeamento declarativo de campos e transformações simples já suportadas.

Aplicar allowlist de hosts, proteção contra SSRF, bloqueio de endereços internos/metadata endpoints por padrão, validação TLS e limites de resposta. Nunca aceitar URL, webhook ou redirecionamento remoto como autorização para acessar redes internas ou segredos.

### 7. Armazenamento, sincronização, backup e recuperação

Além de escolher provedores, permitir configurar:
- destinos primário e secundário, pastas/buckets e classes de armazenamento;
- políticas de sincronização, retenção, versionamento, deduplicação e expurgo;
- cópias de segurança de configurações não secretas, catálogos, documentos e artefatos;
- criptografia, chaves e permissões de restauração;
- verificação periódica de integridade e testes de restauração;
- migração entre provedores compatíveis e exportação em formatos documentados;
- exclusão de dados por categoria, com confirmação e registro de auditoria.

Credenciais e segredos não devem ser exportados em backups comuns. A recuperação de credenciais deve usar novo cadastro, OAuth ou mecanismo de recuperação seguro, nunca arquivo de backup em texto claro.

### 8. Notificações e canais de comunicação

Permitir configurar canais compatíveis (notificações Android, e-mail, webhook e mensageria quando houver adaptador aprovado), eventos, destinatários, horários silenciosos e nível de severidade. Segredos, conteúdo privado e dados sensíveis não devem ser enviados por notificações sem escolha explícita. Exibir teste de canal e histórico sanitizado de entrega.

### 9. Interface e comportamento configuráveis

Permitir configurar, sem recompilar:
- idioma, tema, densidade e preferências de acessibilidade suportadas;
- tela inicial, atalhos, ordem de módulos e painéis;
- notificações, confirmações, níveis de detalhe e preferências de voz;
- perfis de uso e limites de autonomia;
- feature flags remotas para habilitar recursos já presentes no aplicativo, com versão mínima, compatibilidade, expiração e rollback.

Feature flags não podem instalar código, desativar controles de segurança, conceder privilégios ou habilitar funcionalidades incompatíveis. Atualizações de configuração devem ser assinadas/autenticadas, versionadas e reversíveis.

### 10. Ambientes, recursos e políticas operacionais

Criar painel de recursos com configuração de:
- aparelho local, servidor próprio, VPS, Kaggle, Colab e demais runtimes conectados;
- capacidade de CPU/GPU/RAM/armazenamento informada pelo provedor;
- filas, concorrência, prioridades, timeout, limites de custo e regras de fallback;
- separação de ambientes de laboratório, teste e produção;
- permissões por ambiente e confirmação adicional para produção;
- estado de saúde, quotas, disponibilidade e última verificação.

A Garcia não deve inferir que um recurso está disponível só porque a conexão existe. A capacidade precisa ser consultada/validada no provedor e mostrada com horário da última atualização.

### 11. Auditoria, diagnóstico e observabilidade

Disponibilizar no aplicativo:
- histórico de conexões, alterações de configuração, importações, jobs e aprovações;
- logs técnicos sanitizados, códigos de erro, correlação de execução e exportação de diagnóstico sem segredos;
- estado dos serviços, latência, consumo, quotas e falhas recentes;
- retenção configurável e controles de privacidade;
- trilha de auditoria protegida para ações administrativas e alterações de permissões.

O proprietário pode consultar o que foi executado, por qual agente, usando qual conexão/modelo, com quais permissões e qual resultado. Logs não devem guardar prompts privados por padrão quando isso não for necessário, nem tokens, chaves, cookies, cabeçalhos de autorização ou URLs assinadas.

### 12. Perfis, permissões e aprovações

Criar um centro de políticas para definir:
- ações permitidas sem confirmação, ações que sempre exigem confirmação e ações proibidas;
- escopo de cada agente, ferramenta, conexão, coleção de conhecimento e ambiente;
- permissões de leitura, escrita, execução, publicação, compartilhamento e exclusão;
- limites de gasto, volume, frequência e tamanho;
- modo somente leitura, modo assistido e modo autônomo limitado;
- expiração e revogação de concessões.

A confirmação deve apresentar ação, alvo, dados envolvidos, ambiente, custo estimado e consequência. Respostas de modelos, documentos importados, páginas web e serviços externos são dados não confiáveis e jamais podem sobrepor a política do proprietário.

### 13. Catálogo de formatos e compatibilidade

Manter uma matriz configurável/consultável de formatos e tarefas já suportados:
- texto/LLM, embeddings, reranking, ASR, TTS, clonagem autorizada, áudio, imagem e documentos;
- formatos de pesos e quantizações reconhecidos pelos runtimes instalados;
- conversões que já tenham adaptadores validados;
- idioma, arquitetura, tamanho, memória estimada, backend e dependências;
- licenças, atribuições e restrições de redistribuição.

A interface pode registrar modelos incompatíveis como arquivados/indisponíveis, mas não deve tentar executá-los nem converter formatos sem adaptador validado.

### 14. Importar/exportar configurações e migrar a Garcia

Oferecer exportação/importação de **pacotes de configuração não secretos**, contendo provedores, perfis, workflows, políticas, agentes, coleções (metadados) e preferências. O pacote deve:
- ter esquema versionado, assinatura ou hash de integridade e validação antes da aplicação;
- mostrar diferenças e permissões que serão adicionadas/alteradas;
- permitir pré-visualizar, selecionar categorias e reverter;
- excluir tokens, chaves privadas, cookies e segredos por padrão;
- substituir referências secretas por etapas de reconexão OAuth/cadastro no cofre;
- recusar campos desconhecidos perigosos, comandos e código executável.

Isso permite migrar ou restaurar a configuração em outro aparelho/servidor sem transportar segredos indevidamente.

### 15. Princípios de implementação para evitar retrabalho

- Usar um registro central de capacidades e adaptadores versionados; evitar integrações duplicadas e configurações específicas espalhadas por telas.
- Preferir esquemas declarativos validados para formulários, catálogos, perfis, workflows e endpoints.
- Separar configuração, estado operacional, credenciais e artefatos.
- Manter APIs internas estáveis e versionadas entre app, backend, agentes e workers.
- Configurações devem ter validação, migração de esquema, backup não secreto, histórico e rollback.
- Novos adaptadores precisam de testes automatizados, revisão de segurança, documentação, limites e política de desativação.
- Não permitir que configuração remota altere código nativo, permissões Android, política de segurança ou confiança de certificados.
- Recursos indisponíveis devem aparecer como planejados/não suportados, nunca como funcionais.
- Toda operação deve informar se é configurável agora, depende de adaptador existente ou exige desenvolvimento.

### Critérios gerais de aceite da central configurável

- O proprietário consegue cadastrar múltiplas contas/instâncias por provedor e alterar seus parâmetros pela Garcia.
- Consegue habilitar/desabilitar agentes, modelos, ferramentas, fontes, destinos, rotinas e notificações que já tenham adaptadores aprovados.
- Consegue importar/exportar pacote de configuração sem segredos, visualizar diferenças e reverter.
- Consegue acompanhar jobs e transferências, cancelar quando suportado e consultar logs sanitizados.
- Consegue configurar permissões, limites e confirmações sem alterar código.
- Configurações inválidas, não assinadas quando exigido, incompatíveis ou com capacidades desconhecidas falham de forma segura.
- Não há execução arbitrária de código, elevação de privilégio por prompt/configuração ou exposição de segredos.
- A interface diferencia claramente **configurável sem código**, **requer adaptador novo** e **não suportado**.
