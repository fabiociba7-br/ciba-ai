import { describe, expect, it } from "vitest";
import { assessDeviceCompatibility, validateDeviceCapabilityProfile, type DeviceCapabilityProfile } from "../src/core/device-capabilities";

const android: DeviceCapabilityProfile = {
  platform: "android", architecture: "arm64", totalRamMb: 8192, availableRamMb: 4096,
  logicalCpuCores: 8, gpuAvailable: true, androidApiLevel: 35,
  collectedAt: 1794800000000, source: "client_report",
};

describe("device capability assessment", () => {
  it("accepts a valid Android profile", () => expect(() => validateDeviceCapabilityProfile(android)).not.toThrow());
  it("rejects impossible memory and platform combinations", () => {
    expect(() => validateDeviceCapabilityProfile({ ...android, availableRamMb: 9000 })).toThrow("invalid_device_capability_profile");
    expect(() => validateDeviceCapabilityProfile({ ...android, platform: "linux" })).toThrow("invalid_device_capability_profile");
  });
  it("approves a compatible local Android runtime without starting it", () => {
    expect(assessDeviceCompatibility(android, {
      runtime: "android_embedded", minimumRamMb: 1024, minimumAvailableRamMb: 512,
      minimumCpuCores: 4, requiresGpu: false, architectures: ["arm64"], minimumAndroidApiLevel: 26,
    })).toEqual({ compatible: true, reasons: [] });
  });
  it("returns explicit reasons when device is underpowered or incompatible", () => {
    expect(assessDeviceCompatibility({ ...android, totalRamMb: 1024, availableRamMb: 128, logicalCpuCores: 2, gpuAvailable: false }, {
      runtime: "android_embedded", minimumRamMb: 2048, minimumAvailableRamMb: 512,
      minimumCpuCores: 4, requiresGpu: true,
    })).toEqual({ compatible: false, reasons: [
      "insufficient_total_ram", "insufficient_available_ram", "insufficient_cpu_cores", "gpu_required",
    ] });
  });
  it("rejects a desktop profile for Android embedded runtime", () => {
    expect(assessDeviceCompatibility({ ...android, platform: "windows", androidApiLevel: undefined }, {
      runtime: "android_embedded", minimumRamMb: 512,
    }).reasons).toContain("android_runtime_required");
  });
});
