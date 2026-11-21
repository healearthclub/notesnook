import { NativeEventEmitter, NativeModules } from "react-native";
import { create } from "zustand";

export type AudioOutput = {
  id: string;
  name: string;
  kind: "iphone" | "bluetooth" | "airplay" | "wired";
};
type Snapshot = { outputs: AudioOutput[] };
type RoutesModule = {
  currentOutput(): Promise<Snapshot>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};
const routes = NativeModules.OhaiAudioRoutes as RoutesModule | undefined;

export const useAudioOutput = create<{
  outputs: AudioOutput[];
  available: boolean;
}>(() => ({ outputs: [], available: !!routes }));

export function readAudioOutputs(value: unknown): AudioOutput[] | undefined {
  if (!value || typeof value !== "object" || !("outputs" in value)) return;
  if (!Array.isArray(value.outputs) || value.outputs.length > 16) return;
  if (
    value.outputs.some(
      (port) =>
        !port ||
        typeof port.id !== "string" ||
        !port.id ||
        typeof port.name !== "string" ||
        !port.name ||
        !["iphone", "bluetooth", "airplay", "wired"].includes(port.kind)
    )
  )
    return;
  return value.outputs;
}

export function audioOutputName(outputs: AudioOutput[]) {
  return outputs.map((output) => output.name).join(", ") || "System output";
}

// One app-level subscription drives every player and the device sheet.
export function listenForAudioOutput() {
  if (!routes) return;
  let mounted = true;
  let revision = 0;
  const apply = (value: unknown) => {
    const outputs = readAudioOutputs(value);
    if (mounted && outputs) useAudioOutput.setState({ outputs });
  };
  const subscription = new NativeEventEmitter(routes).addListener(
    "OhaiAudioOutputChanged",
    (snapshot: unknown) => {
      revision++;
      apply(snapshot);
    }
  );
  const initialRevision = revision;
  void routes
    .currentOutput()
    .then((snapshot) => {
      if (revision === initialRevision) apply(snapshot);
    })
    .catch(() => {});
  return () => {
    mounted = false;
    subscription.remove();
  };
}
