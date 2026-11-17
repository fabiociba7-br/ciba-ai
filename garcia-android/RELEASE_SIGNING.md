# Assinatura e versões do aplicativo Garcia

## Objetivo

Todas as versões instaláveis da Garcia devem ser assinadas com **a mesma chave privada**. O Android só aceita uma atualização instalada sobre a versão anterior quando o certificado de assinatura é compatível. Perder ou substituir a chave pode impedir atualizações diretas para quem já instalou o aplicativo.

O identificador também permanece fixo: `com.ciba.garcia`. Não altere o `applicationId` depois da primeira distribuição.

## 1. Gerar a chave uma única vez

Em um computador com JDK 17 ou superior, clone/abra o repositório e execute:

```bash
cd garcia-android
bash scripts/create-signing-key.sh
```

O script cria:
- `garcia-release.jks`: chave privada original;
- `garcia-release-keystore.base64`: conteúdo codificado para o secret do GitHub.

Escolha senhas fortes e guarde-as em um gerenciador de senhas. **Não gere uma segunda chave para uma atualização.** Faça pelo menos duas cópias de segurança offline, criptografadas e em locais separados, do arquivo JKS original. O arquivo JKS e o arquivo base64 são ignorados pelo Git e nunca devem ser commitados.

## 2. Cadastrar os GitHub Actions secrets

No repositório `fabiociba7-br/ciba-ai`, acesse:

Settings → Secrets and variables → Actions → New repository secret.

Cadastre exatamente estes quatro secrets:

| Nome | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Conteúdo integral do arquivo `garcia-release-keystore.base64` |
| `ANDROID_KEYSTORE_PASSWORD` | Senha do keystore escolhida no script |
| `ANDROID_KEY_ALIAS` | `garcia-release` |
| `ANDROID_KEY_PASSWORD` | Senha da chave escolhida no script |

Os secrets não são arquivos do repositório e não entram no APK. O workflow restaura a chave apenas no ambiente temporário do runner e remove-se ao final da execução.

## 3. Gerar uma versão

Depois de cadastrar os quatro secrets:

1. Abra Actions no GitHub.
2. Selecione **Garcia Android Release**.
3. Clique em **Run workflow**.
4. Informe a versão, por exemplo `1.0.1`.
5. Baixe o APK assinado na seção Artifacts da execução.

A geração é manual e deliberada; commits e deploys do servidor não geram APK. O `versionCode` é atribuído automaticamente pelo número sequencial da execução do workflow, e o `versionName` é o valor informado. Reexecuções da mesma execução mantêm o mesmo código; uma nova execução gera um código maior.

## Regras que evitam conflitos

- Nunca mudar `applicationId = "com.ciba.garcia"`.
- Nunca gerar outra chave para publicar uma atualização.
- Nunca apagar ou substituir os quatro secrets por valores de outra chave.
- Manter backup offline do JKS e das senhas.
- Usar uma nova execução do workflow para cada nova versão publicada.
- Não publicar uma versão manualmente com outra chave.

## Limite desta configuração

O workflow e a configuração Gradle estão prontos para assinatura, mas a assinatura de produção só poderá ser usada depois que a chave for gerada e os quatro secrets forem cadastrados. O conector GitHub disponível nesta sessão não permite criar ou escrever secrets diretamente; por segurança, nenhum valor fictício foi cadastrado.
