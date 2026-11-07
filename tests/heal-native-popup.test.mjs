import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url)
);
const { build } = require("esbuild");
async function loadPosition(shadow) {
  class ShadowRoot {
    constructor() {
      this.host = { getBoundingClientRect: () => ({ x: 200, y: 80 }) };
    }
  }
  class HTMLElement {
    constructor(rect = { x: 0, y: 0, width: 240, height: 320 }) {
      Object.assign(this, {
        offsetLeft: rect.x,
        offsetTop: rect.y,
        offsetWidth: rect.width,
        offsetHeight: rect.height,
        style: {},
        rect
      });
    }
    getBoundingClientRect() {
      return this.rect;
    }
  }
  const parent = {
    clientWidth: shadow ? 800 : 1200,
    clientHeight: shadow ? 600 : 900,
    getRootNode: () => (shadow ? new ShadowRoot() : {})
  };
  const scope = {
    module: { exports: {} },
    exports: {},
    HTMLElement,
    ShadowRoot,
    document: { body: parent },
    window: { addEventListener() {} }
  };
  scope.exports = scope.module.exports;
  scope.globalThis = scope;
  const { outputFiles } = await build({
    entryPoints: [
      new URL("../packages/ui/src/utils/position.ts", import.meta.url).pathname
    ],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node"
  });
  vm.runInNewContext(outputFiles[0].text, scope);
  return { ...scope.module.exports, HTMLElement };
}
test("popup anchors use the containing workspace coordinates, with viewport edge clamping", async () => {
  const { getPosition, HTMLElement } = await loadPosition(true);
  const popup = new HTMLElement();
  const target = new HTMLElement({ x: 500, y: 150, width: 28, height: 24 });
  const result = getPosition(popup, {
    target,
    isTargetAbsolute: true,
    location: "below",
    yOffset: 5
  });
  assert.equal(result.left, 300);
  assert.equal(result.top, 99);
  const edge = getPosition(popup, {
    target: new HTMLElement({ x: 900, y: 150, width: 28, height: 24 }),
    isTargetAbsolute: true,
    location: "below"
  });
  assert.equal(edge.left, 560);
});
test("standalone popup viewport coordinates stay unchanged", async () => {
  const { getPosition, HTMLElement } = await loadPosition(false);
  const result = getPosition(new HTMLElement(), {
    target: new HTMLElement({ x: 500, y: 150, width: 28, height: 24 }),
    isTargetAbsolute: true,
    location: "below",
    yOffset: 5
  });
  assert.equal(result.left, 500);
  assert.equal(result.top, 179);
});
