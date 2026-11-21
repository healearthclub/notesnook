const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const local = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const React = local("react");
const Renderer = local("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
function compile(file, mocks) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + js + "})", {
    filename: file
  })(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) {
        const relative = path.join(path.dirname(file), id);
        for (const extension of ["", ".ts", ".tsx"]) {
          if (fs.existsSync(path.join(root, relative + extension)))
            return compile(relative + extension, mocks);
        }
      }
      return local(id);
    },
    mod,
    mod.exports
  );
  return mod.exports;
}
const model = compile("apps/mobile/app/features/notes/books-model.ts", {});
const summary = {
  id: "private-book",
  title: "Account reading copy",
  author: "Writer",
  description: "A private PDF",
  kind: "reader",
  pageCount: 2
};
const document = {
  ...summary,
  pages: [
    { label: "Chapter one", pdfPage: 1, paragraphs: ["First passage."] },
    { label: "Chapter two", pdfPage: 2, paragraphs: ["Second passage."] }
  ]
};

test("book payloads reject duplicates, wrong accounts IDs and unsafe external links", () => {
  assert.equal(
    model.decodeBookLibrary({ schemaVersion: 1, books: [summary] })[0].id,
    summary.id
  );
  assert.throws(() =>
    model.decodeBookLibrary({ schemaVersion: 1, books: [summary, summary] })
  );
  assert.throws(() =>
    model.decodeBookLibrary({
      schemaVersion: 1,
      books: [{ ...summary, kind: "external", url: "javascript:alert(1)" }]
    })
  );
  assert.equal(
    model.safeBookURL("https://user:password@example.com"),
    undefined
  );
  assert.throws(() => model.decodeReadingBook(document, "someone-elses-book"));
});
test("reader validates nonempty text, page bounds and account-scoped progress keys", () => {
  assert.equal(model.decodeReadingBook(document, summary.id).pages.length, 2);
  assert.throws(() =>
    model.decodeReadingBook({ ...document, pages: [] }, summary.id)
  );
  assert.throws(() =>
    model.decodeReadingBook(
      { ...document, pages: [{ label: "bad", pdfPage: 3, paragraphs: ["x"] }] },
      summary.id
    )
  );
  assert.equal(model.readingPage(99, 2), 1);
  assert.equal(model.readingPage(NaN, 2, 0), 0);
  assert.notEqual(
    model.bookPlaceKey("account-a", summary.id),
    model.bookPlaceKey("account-b", summary.id)
  );
});
function ui(account = "google:a") {
  const state = { account, copies: [summary], opened: [], data: new Map() };
  const colors = {
    primary: {
      background: "#fff",
      border: "#ddd",
      heading: "#111",
      paragraph: "#333",
      accent: "#008a40",
      accentForeground: "#fff",
      icon: "#222"
    },
    secondary: { background: "#eee", paragraph: "#666" }
  };
  const native = {
    Platform: { OS: "ios" },
    StyleSheet: { create: (v) => v, hairlineWidth: 1 },
    Linking: { openURL: async (url) => state.opened.push(url) }
  };
  for (const name of [
    "ActivityIndicator",
    "Image",
    "Modal",
    "Pressable",
    "Text",
    "View"
  ])
    native[name] = name;
  native.ScrollView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollTo() {} }));
    return React.createElement("ScrollView", props, props.children);
  });
  native.FlatList = (props) =>
    React.createElement(
      "FlatList",
      props,
      props.ListHeaderComponent,
      props.data.length
        ? props.data.map((item) =>
            React.createElement(
              React.Fragment,
              { key: item.id },
              props.renderItem({ item })
            )
          )
        : props.ListEmptyComponent
    );
  const mocks = {
    "../scripture/scripture-card": { ScriptureCard: () => React.createElement("ScriptureCard") },
    "@notesnook/theme": { useThemeColors: () => ({ colors }) },
    "react-native": native,
    "../../common/database/mmkv": {
      MMKV: {
        getInt: (key) => state.data.get(key),
        setInt: (key, n) => state.data.set(key, n),
        getString: (key) => state.data.get(key),
        setString: (key, v) => state.data.set(key, v)
      }
    },
    "../../components/auth/common": { AuthMode: { login: "login" } },
    "../../components/ui/AppIcon": (props) =>
      React.createElement("Icon", props),
    "../../hooks/use-global-safe-area-insets": () => ({
      top: 59,
      bottom: 34,
      left: 0,
      right: 0
    }),
    "../../services/navigation": { navigate() {} },
    "../login/google-session": {
      useOhaiAccount: (selector) => selector({ userId: state.account }),
      loadOhaiAccount: async () => {}
    },
    "./books-library": {
      loadAccountBooks: async () => state.copies,
      loadReadingCopy: async () => document
    },
    "./books-model": model
  };
  return {
    state,
    BooksHome: compile("apps/mobile/app/features/notes/books-home.tsx", mocks)
      .BooksHome
  };
}
const press = async (renderer, label) =>
  Renderer.act(async () => {
    renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
  });
test("library opens details, reads real text, navigates pages and stores bookmarks", async () => {
  const { state, BooksHome } = ui();
  let view;
  await Renderer.act(async () => {
    view = Renderer.create(React.createElement(BooksHome, { active: true }));
  });
  await press(view, "View " + summary.title + " by " + summary.author);
  await Renderer.act(async () => {
    view.root.findByProps({ testID: "book-read" }).props.onPress();
  });
  assert.equal(
    view.root.findAllByProps({ children: "First passage." }).length > 0,
    true
  );
  assert.equal(
    view.root.findByProps({ accessibilityLabel: "Previous page" }).props
      .disabled,
    true
  );
  await press(view, "Increase text size");
  assert.equal(
    view.root.findAllByProps({ children: "First passage." })[0].props.style
      .fontSize,
    22
  );
  await press(view, "Toggle cream paper");
  assert.equal(
    view.root.findAllByProps({ children: "First passage." })[0].props.style
      .color,
    "#29251f"
  );
  await press(view, "Next page");
  assert.equal(state.data.get(model.bookPlaceKey("google:a", summary.id)), 1);
  assert.equal(
    view.root.findAllByProps({ children: "Second passage." }).length > 0,
    true
  );
  await press(view, "Bookmark this page");
  assert.equal(
    state.data.get(model.bookPlaceKey("google:a", summary.id) + ":marks"),
    "[1]"
  );
  assert.equal(
    view.root.findByProps({ accessibilityLabel: "Next page" }).props.disabled,
    true
  );
  await press(view, "Contents and bookmarks");
  assert.equal(
    view.root.findAllByProps({ children: "Your bookmarks" }).length > 0,
    true
  );
  await press(view, "Close book");
  assert.equal(view.root.findAllByProps({ testID: "book-window" }).length, 0);
  await Renderer.act(async () => view.unmount());
});
test("account switching closes the previous account reader", async () => {
  const { state, BooksHome } = ui();
  let view;
  await Renderer.act(async () => {
    view = Renderer.create(React.createElement(BooksHome, { active: true }));
  });
  await press(view, "View " + summary.title + " by " + summary.author);
  state.account = "google:b";
  state.copies = [];
  await Renderer.act(async () =>
    view.update(React.createElement(BooksHome, { active: true }))
  );
  assert.equal(view.root.findAllByProps({ testID: "book-window" }).length, 0);
  assert.equal(
    view.root.findAllByProps({ children: "First passage." }).length,
    0
  );
  await Renderer.act(async () => view.unmount());
});

function bookSession() {
  const { createStore } = local("zustand/vanilla");
  const state = {
    session: {
      userId: "google:a",
      email: "a@example.com",
      expiresAt: Date.now() + 60000,
      token: "a".repeat(43)
    }
  };
  const keychain = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked" },
    getGenericPassword: async () =>
      state.session ? { password: JSON.stringify(state.session) } : false,
    resetGenericPassword: async () => true
  };
  const api = compile("apps/mobile/app/features/login/google-session.ts", {
    "react-native": { Platform: { OS: "ios" }, NativeModules: {} },
    "react-native-keychain": keychain,
    zustand: { create: (fn) => createStore(fn) }
  });
  api.useOhaiAccount.setState({ userId: "google:a", email: "a@example.com" });
  return { state, api };
}

test("book requests use only the fixed first-party endpoint and account credential", async () => {
  const { api } = bookSession();
  const previous = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(
      url,
      "https://healearth.club/ohai/auth/native/books?id=private-book"
    );
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers["X-Books-Account"], "google:a");
    assert.equal(init.headers.Authorization.startsWith("Bearer "), true);
    return Response.json({ schemaVersion: 1, book: document });
  };
  try {
    assert.equal(
      (await api.requestOhaiBooks("google:a", "private-book")).book.id,
      "private-book"
    );
  } finally {
    global.fetch = previous;
  }
});

test("a delayed book response cannot cross a changed account session", async () => {
  const { api, state } = bookSession();
  const previous = global.fetch;
  global.fetch = async () => {
    state.session = {
      ...state.session,
      userId: "google:b",
      token: "b".repeat(43)
    };
    api.useOhaiAccount.setState({ userId: "google:b" });
    return Response.json({ schemaVersion: 1, books: [summary] });
  };
  try {
    assert.equal(await api.requestOhaiBooks("google:a"), null);
  } finally {
    global.fetch = previous;
  }
});
