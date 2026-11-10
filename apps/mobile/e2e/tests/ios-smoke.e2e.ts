import { by, device, element, expect, waitFor, web } from "detox";

async function waitForWeb(check: () => Promise<unknown>) {
  const deadline = Date.now() + 15000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

async function tapUntilVisible(
  button: Detox.NativeElement,
  destination: Detox.NativeElement,
  timeout = 4000
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await button.tap();
    } catch (error) {
      lastError = error;
    }
    try {
      await waitFor(destination).toBeVisible().withTimeout(timeout);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

describe("iOS local notes", () => {
  it("creates a note and reopens its saved content after restarting", async () => {
    if (device.getPlatform() !== "ios") return;
    await device.launchApp({
      newInstance: true,
      delete: true,
      launchArgs: { detoxEnableSynchronization: 0 }
    });
    await device.disableSynchronization();
    await waitFor(element(by.text("Get started")))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.text("Get started")).tap();
    await waitFor(element(by.id("auth-use-offline")))
      .toBeVisible()
      .withTimeout(30000);
    // With synchronization disabled, a moving navigation/dialog button may
    // become visible before its transition finishes. Verify each destination.
    await tapUntilVisible(
      element(by.id("auth-use-offline")),
      element(by.id("yes"))
    );
    await tapUntilVisible(element(by.id("yes")), element(by.id("buttons.add")));

    const title = `iOS persistence ${Date.now()}`;
    const body = "A local note saved by the Release iOS fork.";
    await tapUntilVisible(
      element(by.id("buttons.add")),
      element(by.id("editor.id")),
      6000
    );
    // Detox's iOS typeText treats this textarea's contentEditable attribute
    // as a contenteditable div and changes textContent instead of value.
    // Dispatch a normal textarea input (equivalent to pasting the title).
    await web()
      .element(by.web.id("editor-title"))
      .runScript(
        (field: HTMLTextAreaElement, text: string) => {
          if (field.readOnly) throw new Error("Note title is read-only");
          field.focus();
          field.value = text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        },
        [title]
      );
    // Add tag appears once the first save has assigned this draft a note ID.
    await waitForWeb(() =>
      expect(
        web().element(by.web.xpath("//button[contains(., 'Add tag')]"))
      ).toExist()
    );
    await web().element(by.web.className("ProseMirror")).focus();
    await web()
      .element(by.web.className("ProseMirror"))
      .runScript(
        (field: HTMLElement, text: string) => {
          field.focus();
          if (!document.execCommand("insertText", false, text)) {
            throw new Error("Could not enter note content");
          }
        },
        [body]
      );
    await web()
      .element(by.web.cssSelector("#header > button:first-child"))
      .tap();
    await waitFor(element(by.text(body)))
      .toBeVisible()
      .withTimeout(30000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 }
    });
    await device.disableSynchronization();
    await waitFor(element(by.text(title)))
      .toBeVisible()
      .withTimeout(60000);
    await element(by.text(title)).tap();
    await waitFor(element(by.id("editor.id")))
      .toBeVisible()
      .withTimeout(30000);
    await waitForWeb(() =>
      expect(web().element(by.web.className("ProseMirror"))).toHaveText(body)
    );
    await device.takeScreenshot("ios-fork-persisted-note");
  });
});
