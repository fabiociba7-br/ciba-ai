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

/** Validates a client-reported profile. Values are hints, not trusted attestation. */
export function validateDeviceCapabilityProfile(profile: DeviceCapabilityProfile): void {
  const valid = Number.isInteger(profile.totalRamMb) && profile.totalRamMb >= 256 &&
    Number.isInteger(profile.availableRamMb) && profile.availableRamMb >= 0 &&
    profile.availableRamMb <= profile.totalRamMb &&
    Number.isInteger(profile.logicalCpuCores) && profile.logicalCpuCores >= 1 &&
    profile.logicalCpuCores <= 1024 &&
    Number.isFinite(profile.collectedAt) && profile.collectedAt > 0 &&
    profile.source === "client_report" &&
    ["android", "windows", "macos", "linux", "unknown"].includes(profile.platform) &&
    ["arm64", "arm32", "x64", "x86", "unknown"].includes(profile.architecture) &&
    typeof profile.gpuAvailable === "boolean" &&
    (profile.androidApiLevel === undefined ||
      (Number.isInteger(profile.androidApiLevel) && profile.androidApiLevel >= 21 && profile.androidApiLevel <= 100));
  if (!valid || (profile.platform !== "android" && profile.androidApiLevel !== undefined)) {
    throw new Error("invalid_device_capability_profile");
  }
}

/** Conservative compatibility check. It never installs or starts a runtime. */
export function assessDeviceCompatibility(
  profile: DeviceCapabilityProfile,
  requirements: DeviceCapabilityRequirements,
): DeviceCapabilityDecision {
  validateDeviceCapabilityProfile(profile);
  const reasons: string[] = [];
  if (!Number.isInteger(requirements.minimumRamMb) || requirements.minimumRamMb < 256) {
    throw new Error("invalid_device_capability_requirements");
  }
  if (profile.totalRamMb < requirements.minimumRamMb) reasons.push("insufficient_total_ram");
  if (requirements.minimumAvailableRamMb !== undefined &&
      profile.availableRamMb < requirements.minimumAvailableRamMb) reasons.push("insufficient_available_ram");
  if (requirements.minimumCpuCores !== undefined &&
      profile.logicalCpuCores < requirements.minimumCpuCores) reasons.push("insufficient_cpu_cores");
  if (requirements.requiresGpu && !profile.gpuAvailable) reasons.push("gpu_required");
  if (requirements.architectures && !requirements.architectures.includes(profile.architecture)) {
    reasons.push("unsupported_architecture");
  }
  if (requirements.platforms && !requirements.platforms.includes(profile.platform)) {
    reasons.push("unsupported_platform");
  }
  if (requirements.runtime === "android_embedded" && profile.platform !== "android") {
    reasons.push("android_runtime_required");
  }
  if (requirements.runtime === "desktop_local" && !["windows", "macos", "linux"].includes(profile.platform)) {
    reasons.push("desktop_runtime_required");
  }
  if (requirements.runtime === "local_service" && profile.platform === "unknown") {
    reasons.push("known_host_required");
  }
  if (requirements.minimumAndroidApiLevel !== undefined &&
      (profile.platform !== "android" || (profile.androidApiLevel ?? 0) < requirements.minimumAndroidApiLevel)) {
    reasons.push("android_api_too_low");
  }
  return { compatible: reasons.length === 0, reasons };
}
