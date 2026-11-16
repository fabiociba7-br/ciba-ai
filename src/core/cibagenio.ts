export type CibaGenioScope = "global" | "app";

export const CIBAGENIO_RESOURCES = [
  { id: "chat", label: "Chat da Garcia", description: "Acesso ao chat principal da Garcia." },
  { id: "persistent_memory", label: "Memória persistente", description: "Leitura e gravação de memória persistente." },
  { id: "app_messaging", label: "Comunicação entre aplicativos", description: "Mensagens e comunicação entre apps conectados." },
  { id: "task_dispatch", label: "Distribuição de tarefas", description: "Envio e acompanhamento de tarefas entre aplicativos." },
  { id: "context_sharing", label: "Compartilhamento de contexto", description: "Compartilhamento autorizado de pacotes de contexto." },
  { id: "multi_model_ensemble", label: "Colaboração entre modelos", description: "Orquestração opcional de múltiplos modelos." },
  { id: "external_tools", label: "Ferramentas externas", description: "Execução futura de ferramentas externas autorizadas." },
] as const;

export type CibaGenioResourceId = typeof CIBAGENIO_RESOURCES[number]["id"];

export interface CibaGenioControl {
  resource_id: string;
  scope: CibaGenioScope;
  scope_id: string;
  enabled: boolean;
}

export interface CibaGenioCommand {
  resource_id: CibaGenioResourceId;
  enabled: boolean;
  scope: CibaGenioScope;
  app_id?: string;
  reason?: string;
}

export const isCibaGenioResourceId = (value: unknown): value is CibaGenioResourceId =>
  typeof value === "string" &&
  CIBAGENIO_RESOURCES.some((resource) => resource.id === value);

export const parseCibaGenioCommand = (
  value: Record<string, unknown>,
  isValidAppId: (appId: string) => boolean,
): { valid: true; command: CibaGenioCommand } | { valid: false; error: string } => {
  if (!isCibaGenioResourceId(value.resource_id)) return { valid: false, error: "unknown_resource" };
  if (typeof value.enabled !== "boolean") return { valid: false, error: "invalid_enabled" };

  const scope = value.scope === undefined ? "global" : value.scope;
  if (scope !== "global" && scope !== "app") return { valid: false, error: "invalid_scope" };

  const appId = value.app_id === undefined ? undefined :
    typeof value.app_id === "string" ? value.app_id.trim() : "";
  if (scope === "app" && (!appId || !isValidAppId(appId))) {
    return { valid: false, error: "invalid_app_id" };
  }
  if (scope === "global" && value.app_id !== undefined) {
    return { valid: false, error: "unexpected_app_id" };
  }

  const reason = value.reason === undefined ? undefined :
    typeof value.reason === "string" ? value.reason.trim() : "";
  if (reason !== undefined && reason.length > 300) return { valid: false, error: "invalid_reason" };

  return {
    valid: true,
    command: {
      resource_id: value.resource_id,
      enabled: value.enabled,
      scope,
      ...(appId ? { app_id: appId } : {}),
      ...(reason ? { reason } : {}),
    },
  };
};

/** App-specific controls override global controls. Unknown/unconfigured resources stay locked. */
export const resolveCibaGenioAccess = (
  resourceId: string,
  appId: string | undefined,
  controls: CibaGenioControl[],
): boolean => {
  if (!isCibaGenioResourceId(resourceId)) return false;
  if (appId) {
    const appControl = controls.find((control) =>
      control.resource_id === resourceId && control.scope === "app" && control.scope_id === appId
    );
    if (appControl) return appControl.enabled;
  }
  const globalControl = controls.find((control) =>
    control.resource_id === resourceId && control.scope === "global"
  );
  return globalControl?.enabled ?? false;
};
