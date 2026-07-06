/** i18n key (under the `record` namespace) for a microphone's inferred type. */
export type MicrophoneTypeKey = "micBuiltIn" | "micBluetooth" | "micUsb" | "micExternal";

/**
 * Infer a microphone's connection type from its label. `enumerateDevices()`
 * doesn't expose a transport, so we heuristically read common macOS naming.
 * Returns an i18n key — the picker resolves it under the `record` namespace.
 */
export function getMicrophoneType(label: string): MicrophoneTypeKey {
  const l = label.toLowerCase();
  if (
    l.includes("built-in") ||
    l.includes("macbook") ||
    l.includes("imac") ||
    l.includes("internal")
  )
    return "micBuiltIn";
  if (l.includes("airpods") || l.includes("bluetooth") || l.includes("wireless"))
    return "micBluetooth";
  if (l.includes("usb")) return "micUsb";
  return "micExternal";
}
