import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { by, device, element, expect, waitFor, web } from "detox";

describe("iOS playback devices", () => {
  it("exposes native AirPlay routing for inline, expanded and minimized video without replacing media", async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 }
    });
    await device.disableSynchronization();
    // Preserve existing simulator app data; onboarding may already be complete.
    try {
      await waitFor(element(by.text("Get started")))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.text("Get started")).tap();
    } catch {}
    try {
      await waitFor(element(by.id("auth-use-offline")))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id("auth-use-offline")).tap();
    } catch {}
    await waitFor(element(by.id("main-tab-browser")))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id("main-tab-browser")).tap();
    const address = element(by.id("browser-home-address"));
    await waitFor(address).toBeVisible().withTimeout(15000);
    await address.tap();
    await address.clearText();
    await address.typeText("https://example.com");
    await address.tapReturnKey();
    const browser = web(by.id("browser-webview"));
    const body = browser.element(by.web.cssSelector("body"));
    const fixture = readFileSync(
      resolve(__dirname, "../fixtures/playback-routing.mp4")
    ).toString("base64");
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        await body.runScript(
          (_body, data) => {
            if (location.hostname !== "example.com")
              throw new Error("Still navigating");
            document.title = "Playback routing test";
            document.body.replaceChildren();
            const video = document.createElement("video");
            video.id = "route-fixture";
            video.src = "data:video/mp4;base64," + data;
            video.muted = false;
            video.loop = true;
            video.controls = false;
            video.addEventListener("click", () => {
              void video.play();
            });
            video.playsInline = true;
            video.style.width = "100%";
            document.body.appendChild(video);
            (window as any).__ohaiRouteFixture = video;
            void video.play();
          },
          [fixture]
        );
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    await browser.element(by.web.id("route-fixture")).tap();
    await body.runScript(() => {
      const video = document.getElementById(
        "route-fixture"
      ) as HTMLVideoElement;
      const marker = document.createElement("p");
      marker.id = "route-check";
      marker.textContent = video.paused ? "paused" : "playing";
      document.body.appendChild(marker);
    });
    await expect(browser.element(by.web.id("route-check"))).toHaveText(
      "playing"
    );
    const trigger = element(by.id("play-on-device")).atIndex(0);
    await waitFor(trigger).toBeVisible().withTimeout(15000);
    // Native receiver discovery/selection requires physical AirPlay hardware.
    // The simulator verifies the public native picker is present on each surface.
    await expect(element(by.id("system-audio-route-picker")).atIndex(0)).toExist();
    await expect(element(by.text("Coming soon"))).not.toExist();
    await device.takeScreenshot("native-airplay-inline-video");
    await body.runScript(() => {
      const video = document.getElementById(
        "route-fixture"
      ) as HTMLVideoElement;
      const same = video === (window as any).__ohaiRouteFixture;
      document.getElementById("route-check")!.textContent =
        same && !video.paused && video.playsInline
          ? "preserved"
          : "replaced or paused";
    });
    await expect(browser.element(by.web.id("route-check"))).toHaveText(
      "preserved"
    );
    await body.runScript(() => {
      (document.getElementById("route-fixture") as any).webkitEnterFullscreen();
    });
    await expect(element(by.id("system-audio-route-picker")).atIndex(0)).toExist();
    await device.takeScreenshot("native-airplay-expanded-video");
    await body.runScript(() => {
      (
        document.querySelector(
          "[data-ohai-collapse-video]"
        ) as HTMLButtonElement
      )?.click();
    });
    await element(by.id("browser-minimize-tab")).tap();
    await waitFor(trigger).toBeVisible().withTimeout(10000);
    await expect(element(by.id("system-audio-route-picker")).atIndex(0)).toExist();
    await device.takeScreenshot("native-airplay-mini-video");
  });
});
