/**
 * Garcia integration example (garcia-app contract 1.0.0).
 *
 * Replace secureStorage with Android Keystore-backed storage, iOS Keychain,
 * or an equivalent secure platform vault. Never log invitation codes/tokens.
 */
import { CibaClient } from "../src/client";

interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface GarciaTaskPayload {
  type: "example.task";
  version: 1;
  data: { text: string };
}

export async function connectGarciaApp(
  baseUrl: string,
  appId: string,
  registrationCode: string,
  pairingCode: string,
  secureStorage: SecureStorage,
) {
  const bootstrap = new CibaClient({ baseUrl });
  const registration = await bootstrap.registerDevice(appId, registrationCode);
  await secureStorage.set("garcia_device_token", registration.access_token);

  const client = new CibaClient({
    baseUrl,
    getAccessToken: () => secureStorage.get("garcia_device_token"),
  });

  await client.pairOwner(pairingCode);
  return client;
}

export async function askGarcia(client: CibaClient, userText: string): Promise<string> {
  const result = await client.chat([{ role: "user", content: userText }]);
  return result.response;
}

export async function sendTaskToAnotherApp(
  client: CibaClient,
  destinationAppId: string,
  taskId: string,
  text: string,
): Promise<void> {
  const payload: GarciaTaskPayload = {
    type: "example.task",
    version: 1,
    data: { text },
  };

  await client.sendMessage({
    destinationAppId,
    clientMessageId: crypto.randomUUID(),
    taskId,
    scope: "task",
    payload,
    ttlHours: 24,
  });
}

export async function processInbox(client: CibaClient): Promise<number> {
  const inbox = await client.getInbox<unknown>(20);
  const processedIds: string[] = [];

  for (const message of inbox.messages) {
    const payload = message.payload as Partial<GarciaTaskPayload> | null;
    if (
      payload?.type !== "example.task" ||
      payload.version !== 1 ||
      !payload.data ||
      typeof payload.data.text !== "string"
    ) continue;

    // Hand validated data to app-owned business logic. Require user approval
    // for sensitive/destructive actions; never execute payloads as commands.
    processedIds.push(message.message_id);
  }

  if (processedIds.length) await client.acknowledgeMessages(processedIds);
  return processedIds.length;
}

export async function disconnectGarciaDevice(secureStorage: SecureStorage): Promise<void> {
  // Local deletion stops this installation from authenticating. For server-side
  // invalidation, revoke this device from the Garcia owner panel.
  await secureStorage.remove("garcia_device_token");
}
