import { device } from "detox";

beforeAll(async () => {
  await device.launchApp({ launchArgs: { detoxEnableSynchronization: 0 } });
});

export {};
