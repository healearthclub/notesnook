import { by, device, element, expect, waitFor, web } from "detox";
import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { blockedBrowserHost } from "../../app/features/browser/browser-guard";

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

it("recognizes unsafe browser destinations without navigating to them", () => {
  assert.equal(
    blockedBrowserHost("https://PRIVBRSR.com./click"),
    "privbrsr.com"
  );
  assert.equal(
    blockedBrowserHost("https://youtube.com@sub.privbrsr.com/click"),
    "sub.privbrsr.com"
  );
  assert.equal(blockedBrowserHost("https://youtbue.com"), "youtbue.com");
  assert.equal(
    blockedBrowserHost("https://m.youtube.com/watch?v=test"),
    undefined
  );
  assert.equal(blockedBrowserHost("https://x.com/?q=privbrsr.com"), undefined);
});

describe("iOS local notes", () => {
  it("keeps a saved note and a web page open across tab switches", async () => {
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
    await waitFor(element(by.id("auth-google")))
      .toBeVisible()
      .withTimeout(30000);
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

    let browserUserAgent: string | undefined;
    const server = createServer((request, response) => {
      browserUserAgent = request.headers["user-agent"];
      response.writeHead(200, {
        "Content-Type": "text/html",
        Connection: "close"
      });
      if (request.url === "/dialogs") {
        response.end(`<!doctype html>
          <h1 id="title">Waiting for page dialogs</h1>
          <script>
            const firstAlert = alert("Fixture alert");
            const confirmed = confirm("Fixture confirm");
            const answer = prompt("Fixture prompt");
            document.getElementById("title").textContent =
              firstAlert === undefined && confirmed === false && answer === null
                ? "Page dialogs were dismissed"
                : "Unexpected dialog results";
            setInterval(() => alert("Repeated fixture alert"), 300);
          </script>`);
        return;
      }
      const secondPage = request.url === "/second";
      response.end(`<!doctype html>
        <title>${secondPage ? "Second test page" : "First test page"}</title>
        <h1 id="title">${secondPage ? "Second browser tab" : "Browser smoke test"}</h1>
        <input id="draft" aria-label="Draft">
        <a id="popup" href="/second" target="_blank">Open in new tab</a>`);
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      const notesTab = element(by.id("main-tab-notes"));
      const browserTab = element(by.id("main-tab-browser"));
      const address = element(by.id("browser-address"));
      const home = element(by.id("browser-home"));
      const resume = element(by.id("browser-resume-tab"));
      const homeResume = element(by.id("browser-home-resume-tab"));
      const homeAddress = element(by.id("browser-home-address"));
      const pageAddTab = element(by.id("browser-page-add-tab"));
      const minimize = element(by.id("browser-minimize-tab"));
      await tapUntilVisible(browserTab, home);
      await device.takeScreenshot("ios-browser-empty");
      await homeAddress.tap();
      await homeAddress.typeText(`http://localhost:${port}/`);
      await homeAddress.tapReturnKey();
      await waitFor(address).toBeVisible().withTimeout(10000);

      const heading = web(by.id("browser-webview")).element(by.web.id("title"));
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));
      if (!/Mobile\/\S+ Safari\/604\.1/.test(browserUserAgent ?? "")) {
        throw new Error(
          "The browser did not send the Safari compatibility suffix"
        );
      }
      await tapUntilVisible(notesTab, element(by.id("editor.id")));
      await tapUntilVisible(resume, address);
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));
      const draft = web(by.id("browser-webview")).element(by.web.id("draft"));
      await draft.runScript((field: HTMLInputElement) => {
        field.value = "Keep this draft";
      });

      const firstTab = element(by.id("browser-home-tab-1"));
      const secondTab = element(by.id("browser-tab-2"));
      const swipeArea = element(by.id("browser-page-swipe"));

      await pageAddTab.tap();
      await waitFor(secondTab).toBeVisible().withTimeout(10000);
      await waitFor(address).toHaveText("").withTimeout(10000);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await address.tap();
      await address.typeText(`http://localhost:${port}/second`);
      await address.tapReturnKey();
      await waitForWeb(() => expect(heading).toHaveText("Second browser tab"));

      await swipeArea.swipe("right", "fast", 0.55, 0.25, 0.45);
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));
      await draft.runScript((field: HTMLInputElement) => {
        if (field.value !== "Keep this draft") {
          throw new Error("Switching tabs discarded the live page state");
        }
      });
      await swipeArea.swipe("left", "fast", 0.55, 0.75, 0.45);
      await waitForWeb(() => expect(heading).toHaveText("Second browser tab"));
      await device.takeScreenshot("ios-browser-page");

      const sheet = element(by.id("browser-sheet"));
      await minimize.swipe("down", "fast", 0.32, 0.5, 0.5);
      await waitFor(home).toBeVisible().withTimeout(10000);
      await expect(element(by.id("browser-home-tab-2"))).toBeVisible();
      await waitFor(sheet).not.toBeVisible().withTimeout(10000);
      await device.takeScreenshot("ios-notes-browser-tabs");

      const profileTab = element(by.id("main-tab-profile"));
      await tapUntilVisible(profileTab, element(by.id("profile-screen")));
      await expect(resume).toBeVisible();
      await device.takeScreenshot("ios-browser-cross-tab");
      await tapUntilVisible(resume, address);
      await waitForWeb(() => expect(heading).toHaveText("Second browser tab"));

      await device.terminateApp();
      await device.launchApp({
        newInstance: true,
        launchArgs: { detoxEnableSynchronization: 0 }
      });
      await device.disableSynchronization();
      await tapUntilVisible(browserTab, home, 10000);
      await tapUntilVisible(homeResume, address);
      await waitForWeb(() => expect(heading).toHaveText("Second browser tab"));
      await tapUntilVisible(minimize, home);
      await tapUntilVisible(firstTab, address);
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));
      await web(by.id("browser-webview")).element(by.web.id("popup")).tap();
      await waitFor(element(by.id("browser-tab-3")))
        .toBeVisible()
        .withTimeout(10000);
      await waitForWeb(() => expect(heading).toHaveText("Second browser tab"));
      await tapUntilVisible(minimize, home);
      await element(by.id("browser-close-tab-3")).tap();
      await waitFor(element(by.id("browser-home-tab-3")))
        .not.toExist()
        .withTimeout(10000);
      await tapUntilVisible(firstTab, address);
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));

      await pageAddTab.tap();
      await waitFor(address).toHaveText("").withTimeout(10000);
      await address.tap();
      await address.typeText(`http://localhost:${port}/dialogs`);
      await address.tapReturnKey();
      await waitForWeb(() =>
        expect(heading).toHaveText("Page dialogs were dismissed")
      );

      await tapUntilVisible(minimize, home);
      await element(by.id("browser-close-tab-4")).tap();
      await waitFor(element(by.id("browser-home-tab-4")))
        .not.toExist()
        .withTimeout(10000);
      await tapUntilVisible(firstTab, address);
      await waitForWeb(() => expect(heading).toHaveText("Browser smoke test"));
    } finally {
      server.close();
    }
  });
});
