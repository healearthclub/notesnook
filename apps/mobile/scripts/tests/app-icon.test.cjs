const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const ts = createRequire(path.join(root, "package.json"))("typescript");

function setup(native) {
  const source = fs.readFileSync(
    path.join(root, "apps/mobile/app/features/app-icon/app-icon.ts"),
    "utf8"
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext("(function(require,module,exports){" + js + "})", {})(
    (id) => {
      assert.equal(id, "react-native");
      return { NativeModules: { OhaiAppIcon: native } };
    },
    mod,
    mod.exports
  );
  return mod.exports;
}

test("app icon state comes from iOS including the primary icon", () => {
  const api = setup();
  assert.equal(
    api.readAppIconStatus({ supported: true, name: null }).selected,
    "original"
  );
  for (const [name, choice] of [
    ["OhaiIconBlack", "black"],
    ["OhaiIconCream", "cream"],
    ["OhaiIconPurple", "purple"]
  ]) {
    assert.equal(
      api.readAppIconStatus({ supported: true, name }).selected,
      choice
    );
  }
  assert.equal(
    api.readAppIconStatus({ supported: true, name: "__proto__" }).selected,
    undefined
  );
  assert.equal(
    api.readAppIconStatus({ supported: true, name: "Unknown" }).selected,
    undefined
  );
  for (const invalid of [
    null,
    {},
    { supported: true },
    { supported: true, name: 123 },
    { supported: "yes", name: null }
  ]) {
    assert.throws(() => api.readAppIconStatus(invalid));
  }
});

test("all three free choices and restoring original call the real native operation", async () => {
  const calls = [];
  const names = {
    original: null,
    black: "OhaiIconBlack",
    cream: "OhaiIconCream",
    purple: "OhaiIconPurple"
  };
  let selected = "cream";
  const api = setup({
    getStatus: async () => ({ supported: true, name: names[selected] }),
    setIcon: async (choice) => {
      calls.push(choice);
      selected = choice;
      return { supported: true, name: names[choice] };
    }
  });
  assert.equal((await api.getAppIconStatus()).selected, "cream");
  for (const choice of ["black", "cream", "purple", "original"]) {
    assert.equal((await api.changeAppIcon(choice)).selected, choice);
  }
  assert.deepEqual(calls, ["black", "cream", "purple", "original"]);
  await assert.rejects(api.changeAppIcon("not-an-icon"));
  assert.equal(calls.length, 4);
});

test("unsupported builds and native failures never report a successful selection", async () => {
  assert.equal((await setup().getAppIconStatus()).supported, false);
  await assert.rejects(setup().changeAppIcon("black"));
  const api = setup({
    getStatus: async () => ({ supported: true, name: null }),
    setIcon: async () => {
      throw new Error("iOS refused");
    }
  });
  await assert.rejects(api.changeAppIcon("purple"), /iOS refused/);
  assert.equal((await api.getAppIconStatus()).selected, "original");
});

test("alternate icon masters are complete opaque 1024px iOS assets", () => {
  const catalog = path.join(root, "apps/mobile/ios/Notesnook/Images.xcassets");
  for (const name of ["OhaiIconBlack", "OhaiIconCream", "OhaiIconPurple"]) {
    const folder = path.join(catalog, name + ".appiconset");
    const contents = JSON.parse(
      fs.readFileSync(path.join(folder, "Contents.json"), "utf8")
    );
    const image = contents.images.find(
      (image) => image.idiom === "universal" && image.platform === "ios"
    );
    assert.ok(image, name + " must have an iOS master");
    const png = fs.readFileSync(path.join(folder, image.filename));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 1024);
    assert.equal(png[25], 2, "App icons must be opaque RGB");
  }
});
