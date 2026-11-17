#!/usr/bin/env bash
set -euo pipefail

ALIAS="garcia-release"
KEYSTORE="garcia-release.jks"
B64_FILE="garcia-release-keystore.base64"

if ! command -v keytool >/dev/null 2>&1; then
  echo "ERRO: keytool (JDK) não encontrado. Instale um JDK 17 antes de continuar." >&2
  exit 1
fi
if [[ -e "$KEYSTORE" || -e "$B64_FILE" ]]; then
  echo "ERRO: já existe um arquivo de chave. Não sobrescreva uma chave existente." >&2
  echo "Se esta é a chave original, preserve-a e use-a para todas as versões futuras." >&2
  exit 1
fi

read -r -s -p "Crie uma senha forte para o keystore: " STORE_PASS
echo
read -r -s -p "Confirme a senha: " STORE_PASS_CONFIRM
echo
[[ "$STORE_PASS" == "$STORE_PASS_CONFIRM" ]] || { echo "As senhas não conferem." >&2; exit 1; }
[[ ${#STORE_PASS} -ge 16 ]] || { echo "Use pelo menos 16 caracteres." >&2; exit 1; }

read -r -s -p "Crie uma senha forte para a chave: " KEY_PASS
echo
[[ ${#KEY_PASS} -ge 16 ]] || { echo "Use pelo menos 16 caracteres." >&2; exit 1; }

keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -storetype JKS \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Garcia App, OU=Mobile, O=Ciba, L=Navegantes, ST=SC, C=BR" \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS"

base64 -w 0 "$KEYSTORE" > "$B64_FILE"
chmod 600 "$KEYSTORE" "$B64_FILE"

echo
echo "Chave criada. NÃO gere outra para atualizações."
echo "Arquivo original: $KEYSTORE"
echo "Base64 para o secret ANDROID_KEYSTORE_BASE64: $B64_FILE"
echo
echo "Cadastre estes quatro GitHub Actions secrets no repositório:"
echo "  ANDROID_KEYSTORE_BASE64  = conteúdo de $B64_FILE"
echo "  ANDROID_KEYSTORE_PASSWORD = senha do keystore informada"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEY_PASSWORD      = senha da chave informada"
echo
echo "Faça duas cópias offline e criptografadas do arquivo $KEYSTORE."
echo "Não envie a chave, senhas ou arquivo base64 para o GitHub como arquivo do repositório."
