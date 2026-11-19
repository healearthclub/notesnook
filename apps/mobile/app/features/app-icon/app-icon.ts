import { NativeModules } from "react-native";

export type AppIconChoice = "original" | "black" | "cream" | "purple";
export type AppIconStatus = { supported: boolean; selected?: AppIconChoice };

const iconNames: Record<string, AppIconChoice> = {
  OhaiIconBlack: "black",
  OhaiIconCream: "cream",
  OhaiIconPurple: "purple"
};
const native = NativeModules.OhaiAppIcon as
  | {
      getStatus(): Promise<unknown>;
      setIcon(choice: AppIconChoice): Promise<unknown>;
    }
  | undefined;

export function readAppIconStatus(value: unknown): AppIconStatus {
  if (
    !value ||
    typeof value !== "object" ||
    !("supported" in value) ||
    typeof value.supported !== "boolean" ||
    !("name" in value) ||
    (value.name !== null && typeof value.name !== "string")
  ) {
    throw new Error("Could not read the selected app icon.");
  }
  return {
    supported: value.supported,
    selected:
      value.name === null
        ? "original"
        : Object.prototype.hasOwnProperty.call(iconNames, value.name)
        ? iconNames[value.name]
        : undefined
  };
}

export async function getAppIconStatus(): Promise<AppIconStatus> {
  if (!native) return { supported: false };
  return readAppIconStatus(await native.getStatus());
}

export async function changeAppIcon(
  choice: AppIconChoice
): Promise<AppIconStatus> {
  if (!native || !["original", "black", "cream", "purple"].includes(choice)) {
    throw new Error("Changing app icons is unavailable.");
  }
  return readAppIconStatus(await native.setIcon(choice));
}
