/**
 * Infer a microphone's connection type from its label. `enumerateDevices()`
 * doesn't expose a transport, so we heuristically read common macOS naming.
 */
export function getMicrophoneType(label: string): string {
  const l = label.toLowerCase();
  if (
    l.includes("built-in") ||
    l.includes("macbook") ||
    l.includes("imac") ||
    l.includes("internal")
  )
    return "BUILT-IN";
  if (l.includes("airpods") || l.includes("bluetooth") || l.includes("wireless"))
    return "BLUETOOTH";
  if (l.includes("usb")) return "USB";
  return "EXTERNAL";
}
