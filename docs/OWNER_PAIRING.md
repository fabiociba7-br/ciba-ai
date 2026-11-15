# Pareamento privado de aplicativos

O pareamento associa dispositivos já autenticados a uma identidade opaca de proprietário. Não existe cadastro público nem o cliente pode escolher ou declarar o próprio `owner_id`.

## Fluxo administrativo inicial

1. O administrador chama `POST /v1/admin/owners` com `{"app_id":"<app-id>" }`.
2. O gateway cria um proprietário ativo e um convite de pareamento para aquele aplicativo.
3. O administrador entrega o código ao dispositivo que já foi registrado pelo fluxo normal de convite de aplicativo.
4. O dispositivo chama `POST /v1/owner/pair` com seu token de dispositivo no cabeçalho Bearer e `{"pairing_invitation_code":"<code>" }`.
5. O convite é consumido e o dispositivo é associado ao proprietário. O código não pode ser reutilizado.

## Adicionar outro aplicativo ao mesmo proprietário

1. O administrador chama `POST /v1/admin/owner-invitations` com `{"owner_id":"<owner-id>","app_id":"<app-id>" }`.
2. Um dispositivo já registrado para esse app usa `POST /v1/owner/pair` com o novo código.
3. O gateway só aceita convites para proprietários ativos, para o mesmo app do dispositivo, dentro do prazo e ainda não consumidos.

Os dois endpoints administrativos exigem o token administrativo existente. Os convites expiram em 24 horas e o código completo só é retornado na criação. Apenas o hash SHA-256 é armazenado.

## Garantias e limites

- O endpoint de pareamento exige token de dispositivo válido; tokens revogados não autenticam.
- Dispositivos já associados não podem trocar de proprietário por esse fluxo.
- O convite só é consumido se o dispositivo autenticado estiver sem proprietário e pertencer ao app indicado.
- A associação é feita no servidor; o cliente não envia um `owner_id` para determinar a identidade.
- A listagem administrativa de dispositivos mostra o vínculo `owner_id`, sem expor tokens.
- Convites expirados e não consumidos são removidos pela limpeza agendada.
- A revogação de dispositivo continua válida e impede autenticação.

## Endereços

| Método | Endpoint | Finalidade |
|---|---|---|
| POST | `/v1/admin/owners` | Criar proprietário e convite inicial |
| POST | `/v1/admin/owner-invitations` | Emitir convite para outro app |
| POST | `/v1/owner/pair` | Associar o dispositivo autenticado |
| GET | `/v1/admin/devices` | Consultar dispositivos e seus vínculos |

**Não ativado nesta etapa:** a migration `0007_private_owner_identity.sql` precisa estar aplicada no banco antes de usar os endpoints. Nenhuma migration foi executada, nenhum segredo foi alterado e nenhum deploy foi feito. O primeiro vínculo exige uma ação administrativa; o usuário final não recebe um cadastro público.
