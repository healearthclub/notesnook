const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../.."),
  req = createRequire(path.join(root, "package.json")),
  ts = req("typescript");
function load(file, mocks) {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  const m = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "})", {
    filename: file
  })(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id === "../login/account-identity")
        return load(
          "apps/mobile/app/features/login/account-identity.ts",
          mocks
        );
      throw Error("Unmocked " + id);
    },
    m,
    m.exports
  );
  return m.exports;
}
function setup() {
  let postFailure,
    changeOnPost = false;
  let selected = "google:a",
    page = "notes",
    fail,
    changeOnResponse = false,
    revision = 0;
  const records = new Map(),
    server = new Map(),
    calls = [];
  const account = { getState: () => ({ userId: selected }) };
  const note = {
      id: "source-note",
      contentId: "source-content",
      dateModified: 10
    },
    content = {
      type: "tiptap",
      data: "<p>Saved fixture</p>",
      dateModified: 10
    };
  const viewer = "https://pinterest-google-clone.trubucla.workers.dev";
  const transport = async (owner, url, method = "GET", payload) => {
    calls.push({ owner, url, method, payload });
    if (fail) throw fail;
    if (changeOnResponse) selected = "google:b";
    if (url === "capabilities")
      return {
        accountId: owner,
        contractVersion: 1,
        publishingEnabled: true,
        brandedLinksEnabled: false,
        archiveEnabled: false,
        viewerOrigin: viewer
      };
    if (url.endsWith("/metadata")) {
      if (!server.has(owner)) {
        const e = Error("missing");
        e.status = 404;
        throw e;
      }
      return server.get(owner);
    }
    if (method === "POST" && postFailure) throw postFailure;
    if (method === "POST" && changeOnPost) selected = "google:b";
    if (method === "DELETE") {
      const v = {
        id: "source-note",
        publicationState: "unpublish_pending",
        aliasState: "disabled",
        retryable: true
      };
      server.set(owner, v);
      return v;
    }
    const v = {
      id: "source-note",
      title: payload.title,
      publicationId: "11111111-1111-4111-8111-111111111111",
      publicationState: "published",
      aliasState: "ready",
      shareUrlState: "ready",
      publishUrl: viewer + "/monograph/11111111-1111-4111-8111-111111111111",
      shareUrl: "https://healearth.club/@alice/p/fixture",
      listedPreference: payload.listed,
      revision: ++revision,
      brandedLinksEnabled: false,
      passwordProtected: false,
      hasFragment: false,
      selfDestruct: false
    };
    server.set(owner, v);
    return v;
  };
  const api = load(
    "apps/mobile/app/features/publishing/owned-publications.ts",
    {
      "@notesnook/core": { isDeleted: (v) => !!v.deleted },
      "react-native-keychain": {
        ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only" },
        getGenericPassword: async (o) =>
          records.has(o.service) ? { password: records.get(o.service) } : false,
        setGenericPassword: async (u, p, o) => {
          records.set(o.service, p);
          return true;
        }
      },
      "../../common/database": {
        db: {
          notes: { note: async () => ({ ...note }) },
          vaults: { itemExists: async () => false },
          content: {
            get: async () => ({ ...content }),
            downloadMedia: async () => ({ ...content })
          }
        }
      },
      "../login/google-session": {
        useOhaiAccount: account,
        requestOhaiPublishing: transport
      },
      "../../utils/global-refs": {
        fluidTabsRef: { current: { page: () => page } }
      }
    }
  );
  return {
    api,
    records,
    server,
    calls,
    setAccount: (v) => (selected = v),
    setPage: (v) => (page = v),
    setFailure: (v) => (fail = v),
    changeAfterResponse: () => (changeOnResponse = true),
    setPostFailure: (v) => (postFailure = v),
    switchOnPost: () => (changeOnPost = true),
    note,
    content,
    viewer
  };
}
test("owned publication state is scoped by account, reads current local source and leaves legacy records alone", async () => {
  const f = setup();
  const p = await f.api.publishOwnedNote(
    "google:a",
    "source-note",
    "Fixture",
    false
  );
  assert.equal(p.publicationState, "published");
  assert.equal(
    f.calls.find((c) => c.method === "POST").payload.retention,
    "revocable"
  );
  assert.equal(
    f.calls.find((c) => c.method === "POST").payload.hasFragment,
    false
  );
  assert.match(
    f.calls.find((c) => c.method === "POST").payload.content,
    /Saved fixture/
  );
  f.setAccount("google:b");
  assert.equal(
    await f.api.readOwnedPublication("google:b", "source-note"),
    undefined
  );
  assert.equal(f.records.size, 1);
});
test("202 cleanup remains pending and a late response after account change cannot be saved under another account", async () => {
  const f = setup();
  await f.api.publishOwnedNote("google:a", "source-note", "Fixture", true);
  const p = await f.api.unpublishOwnedNote("google:a", "source-note");
  assert.equal(p.publicationState, "unpublish_pending");
  assert.equal(
    (await f.api.readOwnedPublication("google:a", "source-note")).retryable,
    true
  );
  const count = f.records.size;
  f.changeAfterResponse();
  await assert.rejects(f.api.ownedCapabilities("google:a"), /changed/);
  assert.equal(f.records.size, count);
});
test("readiness gates, restricted editions and invalid destinations never become native share links", () => {
  const f = setup();
  const p = f.api.parseOwnedPublication(
    {
      id: "source-note",
      publicationState: "published",
      aliasState: "ready",
      publishUrl: f.viewer + "/monograph/11111111-1111-4111-8111-111111111111",
      shareUrl: "https://healearth.club/@alice/p/fixture",
      shareUrlState: "ready",
      brandedLinksEnabled: true,
      passwordProtected: false,
      hasFragment: false,
      selfDestruct: false
    },
    "google:a",
    "source-note"
  );
  assert.equal(
    f.api.ownedShareLink(p, { brandedLinksEnabled: false }),
    p.publishUrl
  );
  assert.equal(
    f.api.ownedShareLink(p, {
      brandedLinksEnabled: true,
      accountId: "google:a",
      contractVersion: 1,
      publishingEnabled: true
    }),
    p.shareUrl
  );
  assert.equal(f.api.ownedShareLink(p, {
    brandedLinksEnabled: true, accountId: "google:b", contractVersion: 1,
    publishingEnabled: true
  }), p.publishUrl);
  assert.equal(f.api.ownedShareLink(p, {
    brandedLinksEnabled: true, accountId: "google:a", contractVersion: 2,
    publishingEnabled: true
  }), p.publishUrl);
  assert.equal(
    f.api.ownedShareLink({ ...p, publicationState: "unpublish_pending" }, {}),
    ""
  );
  assert.equal(f.api.ownedShareLink({ ...p, restricted: true }, {}), "");
  assert.equal(
    f.api.validOwnedLink(
      "https://evil.test/monograph/11111111-1111-4111-8111-111111111111"
    ),
    false
  );
  assert.throws(() =>
    f.api.parseOwnedPublication({ id: "other-note" }, "google:a", "source-note")
  );
});
test("retryable failures keep the same pending source identity; open-editor, restricted and oversized notes are rejected before upload", async () => {
  const f = setup();
  f.setPage("editor");
  await assert.rejects(
    f.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /return to Notes/
  );
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
  f.setPage("notes");
  f.server.set("google:a", {
    id: "source-note",
    publicationState: "published",
    aliasState: "ready",
    passwordProtected: true
  });
  await assert.rejects(
    f.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /access controls/
  );
  const g = setup();
  g.content.data = "x".repeat(4 * 1024 * 1024);
  await assert.rejects(
    g.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /4 MiB/
  );
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
});

function transportFixture() {
  const { createStore } = createRequire(
    path.join(root, "apps/mobile/package.json")
  )("zustand/vanilla");
  let session = {
      userId: "google:a",
      email: "a@example.com",
      expiresAt: Date.now() + 3600000,
      token: "x".repeat(43)
    },
    reply = {
      id: "source-note",
      publicationState: "unpublish_pending",
      aliasState: "disabled",
      ok: false,
      retryable: true
    },
    status = 202,
    change = false;
  const calls = [];
  const source = fs.readFileSync(
    path.join(root, "apps/mobile/app/features/login/google-session.ts"),
    "utf8"
  );
  const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText,
    m = { exports: {} };
  vm.runInNewContext("(function(require,module,exports){" + js + "})", {
    URL,
    Date,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (change) session = { ...session, token: "y".repeat(43) };
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(reply)
      };
    }
  })(
    (id) =>
      id === "./account-identity"
        ? load("apps/mobile/app/features/login/account-identity.ts", {})
        : id === "react-native"
        ? { Platform: { OS: "ios" }, NativeModules: {} }
        : id === "react-native-keychain"
        ? {
            ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "local" },
            getGenericPassword: async () => ({
              password: JSON.stringify(session)
            }),
            resetGenericPassword: async () => true
          }
        : id === "zustand"
        ? { create: (fn) => createStore(fn) }
        : undefined,
    m,
    m.exports
  );
  m.exports.useOhaiAccount.setState({
    userId: "google:a",
    email: "a@example.com"
  });
  return {
    api: m.exports,
    calls,
    setError: () => {
      status = 503;
      reply = { error: "Try again", code: "alias_pending", retryable: true };
    },
    switchDuringRequest: () => (change = true)
  };
}
test("native transport keeps the bearer on first-party requests, retains typed failures and rejects late account responses", async () => {
  const f = transportFixture();
  const p = await f.api.requestOhaiPublishing(
    "google:a",
    "source-note",
    "DELETE"
  );
  assert.equal(p.publicationState, "unpublish_pending");
  assert.equal(
    f.calls[0].url,
    "https://healearth.club/ohai/auth/native/monographs/source-note"
  );
  assert.equal(f.calls[0].init.credentials, "omit");
  assert.equal(f.calls[0].init.redirect, "error");
  assert.equal(f.calls[0].init.headers["X-Heal-Earth-Account"], "google:a");
  assert.equal(
    f.calls[0].init.headers.Authorization,
    "Bearer " + "x".repeat(43)
  );
  assert.equal("token" in p, false);
  await assert.rejects(
    f.api.requestOhaiPublishing("google:a", "../../other"),
    /Invalid/
  );
  f.setError();
  await assert.rejects(
    f.api.requestOhaiPublishing("google:a", "v2", "POST", {}),
    (e) => e.status === 503 && e.code === "alias_pending" && e.retryable
  );
  f.switchDuringRequest();
  await assert.rejects(
    f.api.requestOhaiPublishing("google:a", "capabilities"),
    /changed/
  );
});

test("a timed-out publish retains its account/source identity for retry and never falls back upstream", async () => {
  const f = setup();
  f.setPostFailure(
    Object.assign(Error("Retry"), { status: 503, retryable: true })
  );
  await assert.rejects(
    f.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /Retry/
  );
  const pending = await f.api.readOwnedPublication("google:a", "source-note");
  assert.equal(pending.publicationState, "publishing");
  assert.equal(pending.id, "source-note");
  f.setPostFailure(undefined);
  await f.api.publishOwnedNote("google:a", "source-note", "Fixture", false);
  assert.ok(
    f.calls
      .filter((c) => c.method === "POST")
      .every((c) => c.url === "v2" && c.payload.id === "source-note")
  );
});
test("an account switch while publishing quarantines the late response under the original account", async () => {
  const f = setup();
  f.switchOnPost();
  await assert.rejects(
    f.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /changed/
  );
  assert.equal(
    await f.api.readOwnedPublication("google:b", "source-note"),
    undefined
  );
  assert.ok(
    [...f.records.values()].every(
      (raw) => JSON.parse(raw).accountId === "google:a"
    )
  );
  f.setAccount("google:a");
  const recovered = await f.api.refreshOwnedPublication(
    "google:a",
    "source-note"
  );
  assert.equal(recovered.publicationState, "published");
});

async function sheetFixture(stored = true, legacy = false, offline = false) {
  const local = createRequire(path.join(root, "apps/mobile/package.json")),
    React = local("react"),
    Renderer = local("react-test-renderer"),
    { createStore } = local("zustand/vanilla");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const store = createStore(() => ({ userId: null, email: null }));
  const hook = (selector) =>
    React.useSyncExternalStore(store.subscribe, () =>
      selector(store.getState())
    );
  hook.getState = store.getState;
  let restored = 0;
  const publication = {
    id: "source-note",
    accountId: "google:a",
    title: "Restored publication title",
    publicationState: "published",
    aliasState: "ready",
    listedPreference: true,
    retryable: false,
    brandedLinksEnabled: false
  };
  const mocks = {
    react: React,
    "react/jsx-runtime": local("react/jsx-runtime"),
    "react-native": {
      View: "View",
      TextInput: "TextInput",
      Switch: "Switch",
      ActivityIndicator: "ActivityIndicator"
    },
    "@notesnook/theme": {
      useThemeColors: () => ({
        colors: {
          primary: { accent: "#080", paragraph: "#111" },
          secondary: { border: "#333" }
        }
      })
    },
    "@react-native-clipboard/clipboard": { setString() {} },
    "../../../features/login/google-session": {
      useOhaiAccount: hook,
      loadOhaiAccount: async () => {
        restored++;
        if (stored)
          store.setState({ userId: "google:a", email: "a@example.com" });
      },
      continueWithGoogle: async () => {}
    },
    "../../../features/publishing/owned-publications": {
      ownedCapabilities: async (owner) => {
        if (offline) throw Error("Capabilities unavailable");
        return {
          accountId: owner,
          contractVersion: 1,
          publishingEnabled: true,
          brandedLinksEnabled: false
        };
      },
      refreshOwnedPublication: async () => publication,
      ownedShareLink: () => "",
      readOwnedPublication: async () => publication
    },
    "../../../common/database": {
      db: { monographs: { isPublished: () => legacy } }
    },
    "../../../utils/functions": { openLinkInBrowser() {} },
    "../../ui/typography/paragraph": { __esModule: true, default: "Paragraph" },
    "../../ui/typography/heading": { __esModule: true, default: "Heading" },
    "../../ui/button": { Button: "Button" }
  };
  const Sheet = load(
    "apps/mobile/app/components/sheets/publish-note/owned.tsx",
    mocks
  ).default;
  let view;
  await Renderer.act(async () => {
    view = Renderer.create(
      React.createElement(Sheet, {
        note: { id: "source-note", title: "Local title" },
        onLegacy() {}
      })
    );
  });
  return { view, Renderer, restored };
}
test("opening the sheet after a restart restores the existing session before offering sign-in", async () => {
  const f = await sheetFixture();
  assert.equal(f.restored, 1);
  assert.equal(
    f.view.root.findAllByType("TextInput")[0].props.value,
    "Restored publication title"
  );
  const titles = f.view.root.findAllByType("Button").map((b) => b.props.title);
  assert.ok(titles.includes("Update published edition"));
  assert.ok(titles.includes("Unpublish edition"));
  assert.ok(!titles.includes("Continue with Google"));
  await f.Renderer.act(async () => f.view.unmount());
});
test("older publication management stays reachable without a Heal Earth login", async () => {
  const f = await sheetFixture(false, true);
  const titles = f.view.root.findAllByType("Button").map((b) => b.props.title);
  assert.ok(titles.includes("Manage previous publication"));
  assert.ok(titles.includes("Continue with Google"));
  await f.Renderer.act(async () => f.view.unmount());
});

test("unknown published access metadata cannot downgrade an edition", async () => {
  const f = setup();
  f.server.set("google:a", {
    id: "source-note",
    publicationState: "published",
    aliasState: "ready"
  });
  await assert.rejects(
    f.api.publishOwnedNote("google:a", "source-note", "Fixture", false),
    /access controls/
  );
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
});
test("capability errors retain cached unpublish controls", async () => {
  const f = await sheetFixture(true, false, true);
  const buttons = f.view.root.findAllByType("Button");
  assert.ok(
    buttons.some(
      (b) => b.props.title === "Unpublish edition" && !b.props.disabled
    )
  );
  assert.ok(
    buttons.some(
      (b) => b.props.title === "Update published edition" && b.props.disabled
    )
  );
  await f.Renderer.act(async () => f.view.unmount());
});
