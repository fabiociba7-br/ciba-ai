export type DevicePlatform = "android" | "windows" | "macos" | "linux" | "unknown";
export type DeviceArchitecture = "arm64" | "arm32" | "x64" | "x86" | "unknown";
export type DeviceRuntime = "android_embedded" | "desktop_local" | "local_service";

export interface DeviceCapabilityProfile {
  platform: DevicePlatform;
  architecture: DeviceArchitecture;
  totalRamMb: number;
  availableRamMb: number;
  logicalCpuCores: number;
  gpuAvailable: boolean;
  androidApiLevel?: number;
  collectedAt: number;
  source: "client_report";
}

export interface DeviceCapabilityRequirements {
  runtime: DeviceRuntime;
  minimumRamMb: number;
  minimumAvailableRamMb?: number;
  minimumCpuCores?: number;
  requiresGpu?: boolean;
  architectures?: DeviceArchitecture[];
  platforms?: DevicePlatform[];
  minimumAndroidApiLevel?: number;
}

export interface DeviceCapabilityDecision {
  compatible: boolean;
  reasons: string[];
}

function readOwnDataRecord(
  value: unknown,
  allowedKeys: string[],
  requiredKeys: string[],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
        requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function snapshotStringArray(value: unknown, allowed: string[]): string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length === 0 || value.length > allowed.length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = descriptors[String(i)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
          typeof descriptor.value !== "string" || !allowed.includes(descriptor.value)) return null;
      result.push(descriptor.value);
    }
    return new Set(result).size === result.length ? result : null;
  } catch {
    return null;
  }
}

/** Validates a client-reported profile. Values are hints, not trusted attestation. */
export function validateDeviceCapabilityProfile(profile: DeviceCapabilityProfile): void {
  const value = readOwnDataRecord(
    profile,
    ["platform", "architecture", "totalRamMb", "availableRamMb", "logicalCpuCores",
      "gpuAvailable", "androidApiLevel", "collectedAt", "source"],
    ["platform", "architecture", "totalRamMb", "availableRamMb", "logicalCpuCores",
      "gpuAvailable", "collectedAt", "source"]
  );
  const validPlatforms: DevicePlatform[] = ["android", "windows", "macos", "linux", "unknown"];
  const validArchitectures: DeviceArchitecture[] = ["arm64", "arm32", "x64", "x86", "unknown"];
  if (!value || !validPlatforms.includes(value.platform as DevicePlatform) ||
      !validArchitectures.includes(value.architecture as DeviceArchitecture) ||
      !Number.isInteger(value.totalRamMb) || (value.totalRamMb as number) < 256 ||
      !Number.isInteger(value.availableRamMb) || (value.availableRamMb as number) < 0 ||
      (value.availableRamMb as number) > (value.totalRamMb as number) ||
      !Number.isInteger(value.logicalCpuCores) || (value.logicalCpuCores as number) < 1 ||
      (value.logicalCpuCores as number) > 1024 ||
      !Number.isFinite(value.collectedAt) || (value.collectedAt as number) <= 0 ||
      value.source !== "client_report" || typeof value.gpuAvailable !== "boolean" ||
      (value.androidApiLevel !== undefined &&
        (!Number.isInteger(value.androidApiLevel) || (value.androidApiLevel as number) < 21 ||
          (value.androidApiLevel as number) > 100)) ||
      (value.platform !== "android" && value.androidApiLevel !== undefined)) {
    throw new Error("invalid_device_capability_profile");
  }
}

/** Validates model/runtime resource requirements before they can influence selection. */
export function validateDeviceCapabilityRequirements(
  requirements: DeviceCapabilityRequirements,
): void {
  const value = readOwnDataRecord(
    requirements,
    ["runtime", "minimumRamMb", "minimumAvailableRamMb", "minimumCpuCores",
      "requiresGpu", "architectures", "platforms", "minimumAndroidApiLevel"],
    ["runtime", "minimumRamMb"]
  );
  const validPlatforms: DevicePlatform[] = ["android", "windows", "macos", "linux", "unknown"];
  const validArchitectures: DeviceArchitecture[] = ["arm64", "arm32", "x64", "x86", "unknown"];
  const architectures = value?.architectures === undefined ? undefined
    : snapshotStringArray(value.architectures, validArchitectures);
  const platforms = value?.platforms === undefined ? undefined
    : snapshotStringArray(value.platforms, validPlatforms);
  if (!value || !["android_embedded", "desktop_local", "local_service"].includes(value.runtime as string) ||
      !Number.isInteger(value.minimumRamMb) || (value.minimumRamMb as number) < 256 ||
      (value.minimumAvailableRamMb !== undefined &&
        (!Number.isInteger(value.minimumAvailableRamMb) || (value.minimumAvailableRamMb as number) < 0)) ||
      (value.minimumCpuCores !== undefined &&
        (!Number.isInteger(value.minimumCpuCores) || (value.minimumCpuCores as number) < 1 ||
          (value.minimumCpuCores as number) > 1024)) ||
      (value.requiresGpu !== undefined && typeof value.requiresGpu !== "boolean") ||
      (value.architectures !== undefined && !architectures) ||
      (value.platforms !== undefined && !platforms) ||
      (value.minimumAndroidApiLevel !== undefined &&
        (!Number.isInteger(value.minimumAndroidApiLevel) ||
          (value.minimumAndroidApiLevel as number) < 21 ||
          (value.minimumAndroidApiLevel as number) > 100))) {
    throw new Error("invalid_device_capability_requirements");
  }
}

/** Conservative compatibility check. It never installs or starts a runtime. */
export function assessDeviceCompatibility(
  profile: DeviceCapabilityProfile,
  requirements: DeviceCapabilityRequirements,
): DeviceCapabilityDecision {
  validateDeviceCapabilityProfile(profile);
  validateDeviceCapabilityRequirements(requirements);
  const profileData = readOwnDataRecord(
    profile,
    ["platform", "architecture", "totalRamMb", "availableRamMb", "logicalCpuCores",
      "gpuAvailable", "androidApiLevel", "collectedAt", "source"],
    ["platform", "architecture", "totalRamMb", "availableRamMb", "logicalCpuCores",
      "gpuAvailable", "collectedAt", "source"]
  ) as unknown as DeviceCapabilityProfile;
  const requirementData = readOwnDataRecord(
    requirements,
    ["runtime", "minimumRamMb", "minimumAvailableRamMb", "minimumCpuCores",
      "requiresGpu", "architectures", "platforms", "minimumAndroidApiLevel"],
    ["runtime", "minimumRamMb"]
  ) as unknown as DeviceCapabilityRequirements;
  const architectureList = requirementData.architectures === undefined ? undefined
    : snapshotStringArray(requirementData.architectures, ["arm64", "arm32", "x64", "x86", "unknown"]);
  const platformList = requirementData.platforms === undefined ? undefined
    : snapshotStringArray(requirementData.platforms, ["android", "windows", "macos", "linux", "unknown"]);
  const reasons: string[] = [];
  if (profileData.totalRamMb < requirementData.minimumRamMb) reasons.push("insufficient_total_ram");
  if (requirementData.minimumAvailableRamMb !== undefined &&
      profileData.availableRamMb < requirementData.minimumAvailableRamMb) reasons.push("insufficient_available_ram");
  if (requirementData.minimumCpuCores !== undefined &&
      profileData.logicalCpuCores < requirementData.minimumCpuCores) reasons.push("insufficient_cpu_cores");
  if (requirementData.requiresGpu && !profileData.gpuAvailable) reasons.push("gpu_required");
  if (architectureList && !architectureList.includes(profileData.architecture as DeviceArchitecture)) {
    reasons.push("unsupported_architecture");
  }
  if (platformList && !platformList.includes(profileData.platform as DevicePlatform)) {
    reasons.push("unsupported_platform");
  }
  if (requirementData.runtime === "android_embedded" && profileData.platform !== "android") {
    reasons.push("android_runtime_required");
  }
  if (requirementData.runtime === "desktop_local" && !["windows", "macos", "linux"].includes(profileData.platform)) {
    reasons.push("desktop_runtime_required");
  }
  if (requirementData.runtime === "local_service" && profileData.platform === "unknown") {
    reasons.push("known_host_required");
  }
  if (requirementData.minimumAndroidApiLevel !== undefined &&
      (profileData.platform !== "android" || (profileData.androidApiLevel ?? 0) < requirementData.minimumAndroidApiLevel)) {
    reasons.push("android_api_too_low");
  }
  return { compatible: reasons.length === 0, reasons };
}
