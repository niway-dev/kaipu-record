/** Presentational types shared by the recording UI components. */

export interface SelectedSource {
  id: string;
  name: string;
  type: "screen" | "window";
}

export interface Microphone {
  deviceId: string;
  label: string;
}
