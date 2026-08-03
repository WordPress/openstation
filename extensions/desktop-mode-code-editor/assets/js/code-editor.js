var openStationCodeEditor = function(exports) {
  "use strict";
  function showConflictDialog(args) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "osc-conflict-overlay";
      const dialog = document.createElement("div");
      dialog.className = "osc-conflict-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "osc-conflict-title");
      const title = document.createElement("h2");
      title.id = "osc-conflict-title";
      title.className = "osc-conflict-dialog__title";
      title.textContent = "File changed on disk";
      const body = document.createElement("p");
      body.className = "osc-conflict-dialog__body";
      body.textContent = `Someone else (or another tab) modified ${args.path} since you opened it. Choose how to resolve:`;
      const meta = document.createElement("p");
      meta.className = "osc-conflict-dialog__meta";
      meta.textContent = `Server version: ${args.serverSize} bytes · ${new Date(
        args.serverMtime * 1e3
      ).toLocaleString()}`;
      const actions = document.createElement("div");
      actions.className = "osc-conflict-dialog__actions";
      const finish = (choice) => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(choice);
      };
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "osc-conflict-dialog__btn";
      reload.textContent = "Reload from disk";
      reload.title = "Discard your edits and load the server version.";
      reload.addEventListener("click", () => finish("reload"));
      const overwrite = document.createElement("button");
      overwrite.type = "button";
      overwrite.className = "osc-conflict-dialog__btn osc-conflict-dialog__btn--danger";
      overwrite.textContent = "Overwrite anyway";
      overwrite.title = "Save your edits, replacing the server version.";
      overwrite.addEventListener("click", () => finish("overwrite"));
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "osc-conflict-dialog__btn osc-conflict-dialog__btn--quiet";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => finish("cancel"));
      actions.append(cancel, reload, overwrite);
      dialog.append(title, body, meta, actions);
      overlay.append(dialog);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish("cancel");
        }
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          finish("cancel");
        }
      });
      document.addEventListener("keydown", onKey);
      document.body.append(overlay);
      cancel.focus();
    });
  }
  function languageFor(path) {
    const lower = path.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const ext = dot >= 0 ? lower.slice(dot + 1) : "";
    switch (ext) {
      case "php":
        return "php";
      case "js":
      case "mjs":
      case "cjs":
        return "javascript";
      case "jsx":
        return "javascript";
      case "ts":
        return "typescript";
      case "tsx":
        return "typescript";
      case "css":
        return "css";
      case "scss":
        return "scss";
      case "sass":
        return "scss";
      case "less":
        return "less";
      case "html":
      case "htm":
        return "html";
      case "json":
        return "json";
      case "md":
      case "mdx":
        return "markdown";
      case "xml":
      case "svg":
        return "xml";
      case "yml":
      case "yaml":
        return "yaml";
      default:
        return "plaintext";
    }
  }
  function createModelCache() {
    const cache = /* @__PURE__ */ new Map();
    const monacoUriFor = (monaco, path) => {
      return monaco.Uri.parse(`file:///workspace/${path}`);
    };
    return {
      get(path) {
        const cached2 = cache.get(path);
        if (cached2 && !cached2.isDisposed()) {
          return cached2;
        }
        cache.delete(path);
        return null;
      },
      open(monaco, path, content) {
        const cached2 = cache.get(path);
        if (cached2 && !cached2.isDisposed()) {
          if (cached2.getValue() !== content) {
            cached2.setValue(content);
          }
          return cached2;
        }
        const uri = monacoUriFor(monaco, path);
        const existing = monaco.editor.getModel(uri);
        if (existing) {
          cache.set(path, existing);
          return existing;
        }
        const model = monaco.editor.createModel(
          content,
          languageFor(path),
          uri
        );
        cache.set(path, model);
        return model;
      },
      disposeAll() {
        for (const model of cache.values()) {
          if (!model.isDisposed()) {
            model.dispose();
          }
        }
        cache.clear();
      }
    };
  }
  const FLAG = "__wpdcEditorListenersInstalled";
  function getDesktop() {
    const w = window;
    return w.wp?.os ?? null;
  }
  function openEditorWindow() {
    const desktop = getDesktop();
    if (!desktop) {
      return false;
    }
    const existing = desktop.windowManager.getById("wpdc-editor");
    if (existing) {
      existing.focus?.();
      return true;
    }
    return desktop.openWindow("wpdc-editor");
  }
  function openEditorAtPath(path, line = 1) {
    openEditorWindow();
    const fire = () => window.postMessage(
      { type: "os-code-open", path, line },
      window.location.origin
    );
    requestAnimationFrame(fire);
  }
  function isOpenEditorMessage(data) {
    if (!data || typeof data !== "object") {
      return false;
    }
    const msg = data;
    return msg.type === "os-code-open" && typeof msg.path === "string" && (msg.line === void 0 || typeof msg.line === "number");
  }
  function installPostMessageListener() {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!isOpenEditorMessage(event.data)) {
        return;
      }
      const desktop = getDesktop();
      const existing = desktop?.windowManager.getById("wpdc-editor");
      if (!existing) {
        openEditorAtPath(event.data.path, event.data.line ?? 1);
      }
    });
  }
  function installKeyboardShortcut() {
    window.addEventListener(
      "keydown",
      (e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
          const target = e.target;
          if (target?.isContentEditable && !target.closest("[data-osc-editor-root]")) {
            return;
          }
          e.preventDefault();
          openEditorWindow();
        }
      },
      // Capture so wp-admin's own keydown handlers don't swallow
      // the shortcut before we see it.
      { capture: true }
    );
  }
  function installEditorGlobalListeners() {
    const w = window;
    if (w[FLAG]) {
      return;
    }
    w[FLAG] = true;
    installKeyboardShortcut();
    installPostMessageListener();
  }
  function _arrayLikeToArray(r, a) {
    (null == a || a > r.length) && (a = r.length);
    for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
    return n;
  }
  function _arrayWithHoles(r) {
    if (Array.isArray(r)) return r;
  }
  function _defineProperty$1(e, r, t) {
    return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
      value: t,
      enumerable: true,
      configurable: true,
      writable: true
    }) : e[r] = t, e;
  }
  function _iterableToArrayLimit(r, l) {
    var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
    if (null != t) {
      var e, n, i, u, a = [], f = true, o = false;
      try {
        if (i = (t = t.call(r)).next, 0 === l) ;
        else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
      } catch (r2) {
        o = true, n = r2;
      } finally {
        try {
          if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
        } finally {
          if (o) throw n;
        }
      }
      return a;
    }
  }
  function _nonIterableRest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  function ownKeys$1(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r2) {
        return Object.getOwnPropertyDescriptor(e, r2).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread2$1(e) {
    for (var r = 1; r < arguments.length; r++) {
      var t = null != arguments[r] ? arguments[r] : {};
      r % 2 ? ownKeys$1(Object(t), true).forEach(function(r2) {
        _defineProperty$1(e, r2, t[r2]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$1(Object(t)).forEach(function(r2) {
        Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
      });
    }
    return e;
  }
  function _objectWithoutProperties(e, t) {
    if (null == e) return {};
    var o, r, i = _objectWithoutPropertiesLoose(e, t);
    if (Object.getOwnPropertySymbols) {
      var n = Object.getOwnPropertySymbols(e);
      for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
    }
    return i;
  }
  function _objectWithoutPropertiesLoose(r, e) {
    if (null == r) return {};
    var t = {};
    for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
      if (-1 !== e.indexOf(n)) continue;
      t[n] = r[n];
    }
    return t;
  }
  function _slicedToArray(r, e) {
    return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
  }
  function _toPrimitive(t, r) {
    if ("object" != typeof t || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r);
      if ("object" != typeof i) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === r ? String : Number)(t);
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return "symbol" == typeof i ? i : i + "";
  }
  function _unsupportedIterableToArray(r, a) {
    if (r) {
      if ("string" == typeof r) return _arrayLikeToArray(r, a);
      var t = {}.toString.call(r).slice(8, -1);
      return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
    }
  }
  function _defineProperty(obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      if (enumerableOnly) symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
      keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread2(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      if (i % 2) {
        ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        });
      } else if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
      } else {
        ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
    }
    return target;
  }
  function compose$1() {
    for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
      fns[_key] = arguments[_key];
    }
    return function(x) {
      return fns.reduceRight(function(y, f) {
        return f(y);
      }, x);
    };
  }
  function curry$1(fn) {
    return function curried() {
      var _this = this;
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }
      return args.length >= fn.length ? fn.apply(this, args) : function() {
        for (var _len3 = arguments.length, nextArgs = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
          nextArgs[_key3] = arguments[_key3];
        }
        return curried.apply(_this, [].concat(args, nextArgs));
      };
    };
  }
  function isObject$1(value) {
    return {}.toString.call(value).includes("Object");
  }
  function isEmpty(obj) {
    return !Object.keys(obj).length;
  }
  function isFunction(value) {
    return typeof value === "function";
  }
  function hasOwnProperty(object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  }
  function validateChanges(initial, changes) {
    if (!isObject$1(changes)) errorHandler$1("changeType");
    if (Object.keys(changes).some(function(field) {
      return !hasOwnProperty(initial, field);
    })) errorHandler$1("changeField");
    return changes;
  }
  function validateSelector(selector) {
    if (!isFunction(selector)) errorHandler$1("selectorType");
  }
  function validateHandler(handler) {
    if (!(isFunction(handler) || isObject$1(handler))) errorHandler$1("handlerType");
    if (isObject$1(handler) && Object.values(handler).some(function(_handler) {
      return !isFunction(_handler);
    })) errorHandler$1("handlersType");
  }
  function validateInitial(initial) {
    if (!initial) errorHandler$1("initialIsRequired");
    if (!isObject$1(initial)) errorHandler$1("initialType");
    if (isEmpty(initial)) errorHandler$1("initialContent");
  }
  function throwError$1(errorMessages2, type) {
    throw new Error(errorMessages2[type] || errorMessages2["default"]);
  }
  var errorMessages$1 = {
    initialIsRequired: "initial state is required",
    initialType: "initial state should be an object",
    initialContent: "initial state shouldn't be an empty object",
    handlerType: "handler should be an object or a function",
    handlersType: "all handlers should be a functions",
    selectorType: "selector should be a function",
    changeType: "provided value of changes should be an object",
    changeField: 'it seams you want to change a field in the state which is not specified in the "initial" state',
    "default": "an unknown error accured in `state-local` package"
  };
  var errorHandler$1 = curry$1(throwError$1)(errorMessages$1);
  var validators$1 = {
    changes: validateChanges,
    selector: validateSelector,
    handler: validateHandler,
    initial: validateInitial
  };
  function create(initial) {
    var handler = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    validators$1.initial(initial);
    validators$1.handler(handler);
    var state = {
      current: initial
    };
    var didUpdate = curry$1(didStateUpdate)(state, handler);
    var update = curry$1(updateState)(state);
    var validate = curry$1(validators$1.changes)(initial);
    var getChanges = curry$1(extractChanges)(state);
    function getState2() {
      var selector = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : function(state2) {
        return state2;
      };
      validators$1.selector(selector);
      return selector(state.current);
    }
    function setState2(causedChanges) {
      compose$1(didUpdate, update, validate, getChanges)(causedChanges);
    }
    return [getState2, setState2];
  }
  function extractChanges(state, causedChanges) {
    return isFunction(causedChanges) ? causedChanges(state.current) : causedChanges;
  }
  function updateState(state, changes) {
    state.current = _objectSpread2(_objectSpread2({}, state.current), changes);
    return changes;
  }
  function didStateUpdate(state, handler, changes) {
    isFunction(handler) ? handler(state.current) : Object.keys(changes).forEach(function(field) {
      var _handler$field;
      return (_handler$field = handler[field]) === null || _handler$field === void 0 ? void 0 : _handler$field.call(handler, state.current[field]);
    });
    return changes;
  }
  var index = {
    create
  };
  var config$1 = {
    paths: {
      vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs"
    }
  };
  function curry(fn) {
    return function curried() {
      var _this = this;
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return args.length >= fn.length ? fn.apply(this, args) : function() {
        for (var _len2 = arguments.length, nextArgs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
          nextArgs[_key2] = arguments[_key2];
        }
        return curried.apply(_this, [].concat(args, nextArgs));
      };
    };
  }
  function isObject(value) {
    return {}.toString.call(value).includes("Object");
  }
  function validateConfig(config2) {
    if (!config2) errorHandler("configIsRequired");
    if (!isObject(config2)) errorHandler("configType");
    if (config2.urls) {
      informAboutDeprecation();
      return {
        paths: {
          vs: config2.urls.monacoBase
        }
      };
    }
    return config2;
  }
  function informAboutDeprecation() {
    console.warn(errorMessages.deprecation);
  }
  function throwError(errorMessages2, type) {
    throw new Error(errorMessages2[type] || errorMessages2["default"]);
  }
  var errorMessages = {
    configIsRequired: "the configuration object is required",
    configType: "the configuration object should be an object",
    "default": "an unknown error accured in `@monaco-editor/loader` package",
    deprecation: "Deprecation warning!\n    You are using deprecated way of configuration.\n\n    Instead of using\n      monaco.config({ urls: { monacoBase: '...' } })\n    use\n      monaco.config({ paths: { vs: '...' } })\n\n    For more please check the link https://github.com/suren-atoyan/monaco-loader#config\n  "
  };
  var errorHandler = curry(throwError)(errorMessages);
  var validators = {
    config: validateConfig
  };
  var compose = function compose2() {
    for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
      fns[_key] = arguments[_key];
    }
    return function(x) {
      return fns.reduceRight(function(y, f) {
        return f(y);
      }, x);
    };
  };
  function merge(target, source) {
    Object.keys(source).forEach(function(key) {
      if (source[key] instanceof Object) {
        if (target[key]) {
          Object.assign(source[key], merge(target[key], source[key]));
        }
      }
    });
    return _objectSpread2$1(_objectSpread2$1({}, target), source);
  }
  var CANCELATION_MESSAGE = {
    type: "cancelation",
    msg: "operation is manually canceled"
  };
  function makeCancelable(promise) {
    var hasCanceled_ = false;
    var wrappedPromise = new Promise(function(resolve, reject) {
      promise.then(function(val) {
        return hasCanceled_ ? reject(CANCELATION_MESSAGE) : resolve(val);
      });
      promise["catch"](reject);
    });
    return wrappedPromise.cancel = function() {
      return hasCanceled_ = true;
    }, wrappedPromise;
  }
  var _excluded = ["monaco"];
  var _state$create = index.create({
    config: config$1,
    isInitialized: false,
    resolve: null,
    reject: null,
    monaco: null
  }), _state$create2 = _slicedToArray(_state$create, 2), getState = _state$create2[0], setState = _state$create2[1];
  function config(globalConfig) {
    var _validators$config = validators.config(globalConfig), monaco = _validators$config.monaco, config2 = _objectWithoutProperties(_validators$config, _excluded);
    setState(function(state) {
      return {
        config: merge(state.config, config2),
        monaco
      };
    });
  }
  function init() {
    var state = getState(function(_ref) {
      var monaco = _ref.monaco, isInitialized = _ref.isInitialized, resolve = _ref.resolve;
      return {
        monaco,
        isInitialized,
        resolve
      };
    });
    if (!state.isInitialized) {
      setState({
        isInitialized: true
      });
      if (state.monaco) {
        state.resolve(state.monaco);
        return makeCancelable(wrapperPromise);
      }
      if (window.monaco && window.monaco.editor) {
        storeMonacoInstance(window.monaco);
        state.resolve(window.monaco);
        return makeCancelable(wrapperPromise);
      }
      compose(injectScripts, getMonacoLoaderScript)(configureLoader);
    }
    return makeCancelable(wrapperPromise);
  }
  function injectScripts(script) {
    return document.body.appendChild(script);
  }
  function createScript(src) {
    var script = document.createElement("script");
    return src && (script.src = src), script;
  }
  function getMonacoLoaderScript(configureLoader2) {
    var state = getState(function(_ref2) {
      var config2 = _ref2.config, reject = _ref2.reject;
      return {
        config: config2,
        reject
      };
    });
    var loaderScript = createScript("".concat(state.config.paths.vs, "/loader.js"));
    loaderScript.onload = function() {
      return configureLoader2();
    };
    loaderScript.onerror = state.reject;
    return loaderScript;
  }
  function configureLoader() {
    var state = getState(function(_ref3) {
      var config2 = _ref3.config, resolve = _ref3.resolve, reject = _ref3.reject;
      return {
        config: config2,
        resolve,
        reject
      };
    });
    var require = window.require;
    require.config(state.config);
    require(["vs/editor/editor.main"], function(loaded) {
      var monaco = loaded.m || loaded;
      storeMonacoInstance(monaco);
      state.resolve(monaco);
    }, function(error) {
      state.reject(error);
    });
  }
  function storeMonacoInstance(monaco) {
    if (!getState().monaco) {
      setState({
        monaco
      });
    }
  }
  function __getMonacoInstance() {
    return getState(function(_ref4) {
      var monaco = _ref4.monaco;
      return monaco;
    });
  }
  var wrapperPromise = new Promise(function(resolve, reject) {
    return setState({
      resolve,
      reject
    });
  });
  var loader = {
    config,
    init,
    __getMonacoInstance
  };
  class RestError extends Error {
    constructor(message, code, status, data) {
      super(message);
      this.name = "RestError";
      this.code = code;
      this.status = status;
      this.data = data;
    }
  }
  function getConfig() {
    const config2 = window.openStationCodeEditorConfig;
    if (!config2) {
      throw new Error(
        "os-code-editor: openStationCodeEditorConfig missing — is the editor enqueued?"
      );
    }
    return config2;
  }
  async function getJson(url, params, signal) {
    const config2 = getConfig();
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    const res = await fetch(u.toString(), {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-WP-Nonce": config2.restNonce
      },
      signal
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const obj = body ?? {};
      throw new RestError(
        obj.message ?? `HTTP ${res.status}`,
        obj.code ?? "osc_http_error",
        res.status,
        obj.data ?? null
      );
    }
    return body;
  }
  function fetchTree(path, signal) {
    return getJson(
      getConfig().treeUrl,
      { path },
      signal
    );
  }
  function fetchFile(path, signal) {
    return getJson(
      getConfig().fileUrl,
      { path },
      signal
    );
  }
  function fetchPhpSymbols(prefix, kinds, signal) {
    const params = { prefix };
    if (kinds.length > 0) {
      params.kinds = kinds.join(",");
    }
    return getJson(
      getConfig().phpSymbolsUrl,
      params,
      signal
    );
  }
  async function fetchPhpSymbolDetail(name, signal) {
    const config2 = getConfig();
    const url = config2.phpSymbolUrl + encodeURIComponent(name);
    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-WP-Nonce": config2.restNonce
      },
      signal
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const obj = body ?? {};
      throw new RestError(
        obj.message ?? `HTTP ${res.status}`,
        obj.code ?? "osc_http_error",
        res.status,
        null
      );
    }
    return body;
  }
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }
  async function saveFile(path, content, mtime, signal) {
    const config2 = getConfig();
    const res = await fetch(config2.fileUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-WP-Nonce": config2.restNonce
      },
      body: JSON.stringify({
        path,
        content_b64: utf8ToBase64(content),
        mtime
      }),
      signal
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const obj = body ?? {};
      throw new RestError(
        obj.message ?? `HTTP ${res.status}`,
        obj.code ?? "osc_http_error",
        res.status,
        obj.data ?? null
      );
    }
    return body;
  }
  function detectHookContext(textBefore) {
    const action = textBefore.match(
      /(add_action|do_action|do_action_ref_array)\s*\(\s*(['"])([^'"]*)$/
    );
    if (action) {
      return { kind: "hook", hookKind: "action", prefix: action[3] };
    }
    const filter = textBefore.match(
      /(add_filter|apply_filters|apply_filters_ref_array)\s*\(\s*(['"])([^'"]*)$/
    );
    if (filter) {
      return { kind: "hook", hookKind: "filter", prefix: filter[3] };
    }
    return null;
  }
  function detectIdentifierPrefix(textBefore) {
    const m = textBefore.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    return m ? m[1] : "";
  }
  function detectContext(textBefore) {
    const hook = detectHookContext(textBefore);
    if (hook) {
      return hook;
    }
    const prefix = detectIdentifierPrefix(textBefore);
    if (!prefix) {
      return null;
    }
    return { kind: "general", prefix };
  }
  function entryToCompletionItem(monaco, entry, range, context) {
    const isHook = entry.kind === "action" || entry.kind === "filter";
    let detail = entry.signature;
    if (entry.kind !== "function") {
      const label = entry.kind === "action" ? "Action" : "Filter";
      detail = entry.since ? `${label} · since ${entry.since}` : label;
    }
    const insertText = isHook ? entry.name : `${entry.name}($0)`;
    const insertTextRules = isHook ? monaco.languages.CompletionItemInsertTextRule.None : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    const kind = entry.kind === "function" ? monaco.languages.CompletionItemKind.Function : monaco.languages.CompletionItemKind.Event;
    return {
      label: entry.name,
      kind,
      detail,
      insertText,
      insertTextRules,
      range,
      // Defer doc fetch to resolution time so the dropdown isn't
      // blocked on N hover-doc roundtrips. Monaco calls
      // `resolveCompletionItem` only when the user actually
      // selects/hovers a row.
      documentation: void 0,
      // Sort hooks above functions when in a hook context so the
      // list reflects what the user is actually typing toward.
      sortText: context.kind === "hook" && isHook ? `0_${entry.name}` : `1_${entry.name}`
    };
  }
  class CancellableLatest {
    constructor() {
      this.active = null;
    }
    async run(fn) {
      this.active?.abort();
      const ac = new AbortController();
      this.active = ac;
      try {
        const result = await fn(ac.signal);
        if (ac.signal.aborted) {
          return null;
        }
        return result;
      } catch (err) {
        if (err.name === "AbortError") {
          return null;
        }
        throw err;
      } finally {
        if (this.active === ac) {
          this.active = null;
        }
      }
    }
  }
  let activeHost = null;
  function setPhpProviderHost(host) {
    activeHost = host;
  }
  function registerPhpProviders(monaco) {
    const w = window;
    if (w.__wpdcPhpProvidersRegistered) {
      return;
    }
    w.__wpdcPhpProvidersRegistered = true;
    registerStatelessProviders(monaco);
    registerDefinitionProvider(monaco);
  }
  function registerStatelessProviders(monaco) {
    const completionLatest = new CancellableLatest();
    const detailLatest = new CancellableLatest();
    monaco.languages.registerCompletionItemProvider("php", {
      // Trigger after every keystroke that could continue an
      // identifier, plus the quote characters that open hook names.
      triggerCharacters: [
        "_",
        "'",
        '"',
        ..."abcdefghijklmnopqrstuvwxyz".split("")
      ],
      async provideCompletionItems(model, position) {
        const textBefore = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const ctx = detectContext(textBefore);
        if (!ctx) {
          return { suggestions: [] };
        }
        const minLen = ctx.kind === "hook" ? 0 : 2;
        if (ctx.prefix.length < minLen) {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };
        let kinds = [];
        if (ctx.kind === "hook") {
          kinds = ctx.hookKind === "action" ? ["action"] : ["filter"];
        }
        const matches = await completionLatest.run(
          (signal) => fetchPhpSymbols(ctx.prefix, kinds, signal).then(
            (r) => r.matches
          )
        );
        if (!matches) {
          return { suggestions: [] };
        }
        return {
          suggestions: matches.map(
            (entry) => entryToCompletionItem(monaco, entry, range, ctx)
          ),
          incomplete: matches.length >= 50
        };
      },
      async resolveCompletionItem(item) {
        try {
          const label = typeof item.label === "string" ? item.label : item.label.label;
          const detail = await fetchPhpSymbolDetail(label);
          let documentation = item.documentation;
          if (detail.doc) {
            const sincePrefix = detail.since ? `_Since ${detail.since}._

` : "";
            const sourceSuffix = detail.source ? `

— \`${detail.source}\`` : "";
            documentation = {
              value: sincePrefix + detail.doc + sourceSuffix
            };
          }
          return {
            ...item,
            detail: detail.signature || item.detail,
            documentation
          };
        } catch {
          return item;
        }
      }
    });
    monaco.languages.registerHoverProvider("php", {
      async provideHover(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word || !word.word) {
          return null;
        }
        const detail = await detailLatest.run(
          (signal) => fetchPhpSymbolDetail(word.word, signal).then((d) => ({
            doc: d.doc,
            signature: d.signature,
            since: d.since
          })).catch((err) => {
            if (err instanceof RestError && err.status === 404) {
              return null;
            }
            throw err;
          })
        );
        if (!detail) {
          return null;
        }
        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          },
          contents: [
            { value: "```php\n" + detail.signature + "\n```" },
            ...detail.since ? [{ value: `_Since ${detail.since}._` }] : [],
            ...detail.doc ? [{ value: detail.doc }] : []
          ]
        };
      }
    });
  }
  function registerDefinitionProvider(monaco) {
    monaco.languages.registerDefinitionProvider("php", {
      async provideDefinition(model, position) {
        const host = activeHost;
        if (!host) {
          return null;
        }
        const word = model.getWordAtPosition(position);
        if (!word || !word.word) {
          return null;
        }
        let detail;
        try {
          detail = await fetchPhpSymbolDetail(word.word);
        } catch (err) {
          if (err instanceof RestError && err.status === 404) {
            return null;
          }
          throw err;
        }
        const file = detail.file;
        const line = detail.line;
        if (typeof file !== "string" || !file || typeof line !== "number") {
          return null;
        }
        const target = await host.openFileAtLine(file, line);
        if (!target) {
          return null;
        }
        return [
          {
            uri: target.uri,
            range: {
              startLineNumber: Math.max(1, line),
              endLineNumber: Math.max(1, line),
              startColumn: 1,
              endColumn: 1
            }
          }
        ];
      }
    });
  }
  let cached = null;
  let pending = null;
  function installWorkerEnvironment(monacoVendorUrl) {
    const workerMainUrl = `${monacoVendorUrl}/base/worker/workerMain.js`;
    const baseUrl = monacoVendorUrl.replace(/\/vs$/, "");
    const proxy = `
		self.MonacoEnvironment = { baseUrl: '${baseUrl}' };
		importScripts('${workerMainUrl}');
	`;
    self.MonacoEnvironment = {
      getWorkerUrl: () => URL.createObjectURL(
        new Blob([proxy], { type: "text/javascript" })
      )
    };
  }
  async function loadMonaco() {
    if (cached) {
      return cached;
    }
    if (pending) {
      return pending;
    }
    const config2 = window.openStationCodeEditorConfig;
    if (!config2?.monacoVendorUrl) {
      throw new Error(
        "os-code-editor: monacoVendorUrl missing from openStationCodeEditorConfig — is window.php enqueued?"
      );
    }
    installWorkerEnvironment(config2.monacoVendorUrl);
    loader.config({
      paths: { vs: config2.monacoVendorUrl }
    });
    pending = loader.init().then((monaco) => {
      cached = monaco;
      configureLanguageServices(cached);
      registerPhpProviders(cached);
      return cached;
    });
    return pending;
  }
  function configureLanguageServices(monaco) {
    const ts = monaco.languages.typescript;
    const compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      jsxFactory: "React.createElement",
      jsxFragmentFactory: "React.Fragment",
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true,
      allowNonTsExtensions: true,
      esModuleInterop: true,
      isolatedModules: true,
      resolveJsonModule: true,
      strict: false
    };
    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    ts.javascriptDefaults.setCompilerOptions(compilerOptions);
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      // 2307 — "Cannot find module 'X'": single-file context, almost
      // always noise. Re-enable once Phase 2's file tree gives the
      // worker a project to resolve against.
      // 2304 — "Cannot find name 'X'": same.
      diagnosticCodesToIgnore: [2307, 2304]
    });
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2307, 2304]
    });
  }
  function showConfirm(args) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "osc-conflict-overlay";
      const dialog = document.createElement("div");
      dialog.className = "osc-conflict-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "osc-confirm-title");
      const title = document.createElement("h2");
      title.id = "osc-confirm-title";
      title.className = "osc-conflict-dialog__title";
      title.textContent = args.title;
      const body = document.createElement("p");
      body.className = "osc-conflict-dialog__body";
      body.textContent = args.body;
      const actions = document.createElement("div");
      actions.className = "osc-conflict-dialog__actions";
      const finish = (ok) => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(ok);
      };
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "osc-conflict-dialog__btn osc-conflict-dialog__btn--quiet";
      cancel.textContent = args.cancelLabel ?? "Cancel";
      cancel.addEventListener("click", () => finish(false));
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "osc-conflict-dialog__btn";
      {
        confirm.classList.add("osc-conflict-dialog__btn--danger");
      }
      confirm.textContent = args.confirmLabel ?? "Confirm";
      confirm.addEventListener("click", () => finish(true));
      actions.append(cancel, confirm);
      dialog.append(title, body, actions);
      overlay.append(dialog);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          finish(false);
        }
      });
      document.addEventListener("keydown", onKey);
      document.body.append(overlay);
      cancel.focus();
    });
  }
  function mountTabsStrip(opts) {
    const { mount, onActivate, onClose } = opts;
    mount.classList.add("osc-tabs");
    const ul = document.createElement("ul");
    ul.className = "osc-tabs__list";
    mount.replaceChildren(ul);
    const tabs = /* @__PURE__ */ new Map();
    const order = [];
    let active = null;
    const updateActiveClass = () => {
      for (const [path, tab] of tabs) {
        tab.li.classList.toggle("osc-tabs__tab--active", path === active);
      }
    };
    const indexOf = (path) => order.indexOf(path);
    const pickNeighbour = (path) => {
      const idx = indexOf(path);
      if (idx === -1) {
        return null;
      }
      if (order[idx + 1]) {
        return order[idx + 1];
      }
      if (order[idx - 1]) {
        return order[idx - 1];
      }
      return null;
    };
    const removeTab = (path) => {
      const tab = tabs.get(path);
      if (!tab) {
        return;
      }
      const wasActive = active === path;
      const successor = wasActive ? pickNeighbour(path) : null;
      tab.li.remove();
      tabs.delete(path);
      const idx = indexOf(path);
      if (idx !== -1) {
        order.splice(idx, 1);
      }
      if (wasActive) {
        active = successor;
        updateActiveClass();
        if (active) {
          onActivate(active);
        }
      }
      onClose(path);
    };
    const closeWithGuard = async (path) => {
      const tab = tabs.get(path);
      if (!tab) {
        return;
      }
      if (tab.dirty) {
        const ok = await showConfirm({
          title: "Close without saving?",
          body: `${tab.path} has unsaved changes. Close anyway?`,
          confirmLabel: "Close without saving",
          cancelLabel: "Keep open"
        });
        if (!ok) {
          return;
        }
      }
      removeTab(path);
    };
    const buildTab = (file) => {
      const li = document.createElement("li");
      li.className = "osc-tabs__tab";
      li.dataset.path = file.path;
      li.title = file.path;
      const body = document.createElement("button");
      body.type = "button";
      body.className = "osc-tabs__body";
      body.addEventListener("click", () => {
        if (active !== file.path) {
          active = file.path;
          updateActiveClass();
          onActivate(file.path);
        }
      });
      const icon = document.createElement("span");
      icon.className = `osc-tabs__icon dashicons ${file.icon}`;
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "osc-tabs__label";
      label.textContent = file.label;
      body.append(icon, label);
      const trailing = document.createElement("span");
      trailing.className = "osc-tabs__trailing";
      const dirtyEl = document.createElement("span");
      dirtyEl.className = "osc-tabs__dirty";
      dirtyEl.textContent = "●";
      dirtyEl.setAttribute("aria-label", "Unsaved changes");
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "osc-tabs__close";
      closeBtn.setAttribute("aria-label", "Close tab");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void closeWithGuard(file.path);
      });
      trailing.append(dirtyEl, closeBtn);
      li.append(body, trailing);
      li.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeWithGuard(file.path);
        }
      });
      return { ...file, dirty: false, li, dirtyEl };
    };
    const setDirty = (path, dirty) => {
      const tab = tabs.get(path);
      if (!tab || tab.dirty === dirty) {
        return;
      }
      tab.dirty = dirty;
      tab.li.classList.toggle("osc-tabs__tab--dirty", dirty);
    };
    return {
      open(file) {
        let tab = tabs.get(file.path);
        if (!tab) {
          tab = buildTab(file);
          tabs.set(file.path, tab);
          order.push(file.path);
          ul.append(tab.li);
        }
        active = file.path;
        updateActiveClass();
        tab.li.scrollIntoView({
          inline: "nearest",
          block: "nearest",
          behavior: "smooth"
        });
        return active;
      },
      closeQuiet(path) {
        removeTab(path);
      },
      setActive(path) {
        if (!tabs.has(path)) {
          return;
        }
        active = path;
        updateActiveClass();
      },
      getActive() {
        return active;
      },
      setDirty,
      has(path) {
        return tabs.has(path);
      },
      dispose() {
        tabs.clear();
        order.length = 0;
        active = null;
        mount.replaceChildren();
      }
    };
  }
  function tabMetaForPath(path) {
    const slash = path.lastIndexOf("/");
    const label = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = label.lastIndexOf(".");
    const ext = dot >= 0 ? label.slice(dot + 1).toLowerCase() : "";
    const ICON_BY_EXT = {
      php: "dashicons-editor-code",
      js: "dashicons-editor-code",
      mjs: "dashicons-editor-code",
      cjs: "dashicons-editor-code",
      jsx: "dashicons-editor-code",
      ts: "dashicons-editor-code",
      tsx: "dashicons-editor-code",
      css: "dashicons-art",
      scss: "dashicons-art",
      sass: "dashicons-art",
      less: "dashicons-art",
      html: "dashicons-html",
      htm: "dashicons-html",
      json: "dashicons-media-text",
      md: "dashicons-media-document",
      mdx: "dashicons-media-document",
      svg: "dashicons-format-image",
      xml: "dashicons-media-text",
      yml: "dashicons-media-text",
      yaml: "dashicons-media-text",
      txt: "dashicons-media-default"
    };
    return {
      path,
      label,
      icon: ICON_BY_EXT[ext] ?? "dashicons-media-default"
    };
  }
  const DARK_SCHEMES = /* @__PURE__ */ new Set([
    "midnight",
    "ectoplasm",
    "coffee",
    "ocean"
  ]);
  function monacoThemeForScheme(scheme) {
    if (!scheme) {
      return "vs-dark";
    }
    return DARK_SCHEMES.has(scheme) ? "vs-dark" : "vs";
  }
  function currentColorScheme() {
    const cfg = window.openStationConfig;
    return cfg?.colorScheme ?? "";
  }
  const FOLDER_ICON_CLOSED = "dashicons-category";
  const FOLDER_ICON_OPEN = "dashicons-portfolio";
  const FILE_ICON = "dashicons-media-default";
  const FILE_ICONS_BY_EXT = {
    php: "dashicons-editor-code",
    js: "dashicons-editor-code",
    mjs: "dashicons-editor-code",
    cjs: "dashicons-editor-code",
    jsx: "dashicons-editor-code",
    ts: "dashicons-editor-code",
    tsx: "dashicons-editor-code",
    css: "dashicons-art",
    scss: "dashicons-art",
    sass: "dashicons-art",
    less: "dashicons-art",
    html: "dashicons-html",
    htm: "dashicons-html",
    json: "dashicons-media-text",
    md: "dashicons-media-document",
    mdx: "dashicons-media-document",
    svg: "dashicons-format-image",
    xml: "dashicons-media-text",
    yml: "dashicons-media-text",
    yaml: "dashicons-media-text",
    txt: "dashicons-media-default"
  };
  function iconFor(entry, expanded) {
    if (entry.type === "dir") {
      return expanded ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED;
    }
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
    return FILE_ICONS_BY_EXT[ext] ?? FILE_ICON;
  }
  function mountFileTree(opts) {
    const { mount, onOpen } = opts;
    mount.classList.add("osc-tree");
    mount.replaceChildren();
    const childrenByPath = /* @__PURE__ */ new Map();
    const expanded = /* @__PURE__ */ new Set();
    const inflight = /* @__PURE__ */ new Map();
    const renderRow = (entry) => {
      const li = document.createElement("li");
      li.className = `osc-tree__row osc-tree__row--${entry.type}`;
      if (!entry.allowed && entry.type === "file") {
        li.classList.add("osc-tree__row--disabled");
      }
      li.dataset.path = entry.path;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "osc-tree__btn";
      if (!entry.allowed && entry.type === "file") {
        button.disabled = true;
        button.title = "File extension is not in the editor allowlist.";
      }
      const caret = document.createElement("span");
      caret.className = "osc-tree__caret";
      caret.textContent = entry.type === "dir" ? "▸" : "";
      const icon = document.createElement("span");
      icon.className = `osc-tree__icon dashicons ${iconFor(entry, false)}`;
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "osc-tree__label";
      label.textContent = entry.name;
      button.append(caret, icon, label);
      li.append(button);
      if (entry.type === "file") {
        button.addEventListener("click", () => {
          if (!entry.allowed) {
            return;
          }
          mount.querySelectorAll(".osc-tree__row--active").forEach(
            (el) => el.classList.remove("osc-tree__row--active")
          );
          li.classList.add("osc-tree__row--active");
          onOpen(entry.path);
        });
        return li;
      }
      const childUl = document.createElement("ul");
      childUl.className = "osc-tree__children";
      childUl.hidden = true;
      li.append(childUl);
      const setExpanded = (open) => {
        caret.textContent = open ? "▾" : "▸";
        icon.className = `osc-tree__icon dashicons ${iconFor(entry, open)}`;
        childUl.hidden = !open;
        button.setAttribute("aria-expanded", open ? "true" : "false");
      };
      button.addEventListener("click", async () => {
        if (expanded.has(entry.path)) {
          expanded.delete(entry.path);
          setExpanded(false);
          inflight.get(entry.path)?.abort();
          inflight.delete(entry.path);
          return;
        }
        expanded.add(entry.path);
        setExpanded(true);
        if (childrenByPath.has(entry.path)) {
          return;
        }
        const ac = new AbortController();
        inflight.set(entry.path, ac);
        try {
          const placeholder = document.createElement("li");
          placeholder.className = "osc-tree__loading";
          placeholder.textContent = "Loading…";
          childUl.append(placeholder);
          const resp = await fetchTree(entry.path, ac.signal);
          childUl.replaceChildren();
          for (const child of resp.entries) {
            childUl.append(renderRow(child));
          }
          childrenByPath.set(entry.path, childUl);
        } catch (err) {
          if (err.name === "AbortError") {
            return;
          }
          childUl.replaceChildren();
          const errorRow = document.createElement("li");
          errorRow.className = "osc-tree__error";
          errorRow.textContent = err instanceof Error ? err.message : "Failed to load";
          childUl.append(errorRow);
        } finally {
          inflight.delete(entry.path);
        }
      });
      setExpanded(false);
      return li;
    };
    const rootUl = document.createElement("ul");
    rootUl.className = "osc-tree__root";
    mount.append(rootUl);
    const loading = document.createElement("li");
    loading.className = "osc-tree__loading";
    loading.textContent = "Loading workspace…";
    rootUl.append(loading);
    const rootController = new AbortController();
    void (async () => {
      try {
        const resp = await fetchTree("", rootController.signal);
        rootUl.replaceChildren();
        for (const entry of resp.entries) {
          rootUl.append(renderRow(entry));
        }
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        rootUl.replaceChildren();
        const errorRow = document.createElement("li");
        errorRow.className = "osc-tree__error";
        errorRow.textContent = err instanceof Error ? err.message : "Failed to load workspace";
        rootUl.append(errorRow);
      }
    })();
    return {
      dispose() {
        rootController.abort();
        for (const ac of inflight.values()) {
          ac.abort();
        }
        inflight.clear();
        childrenByPath.clear();
        expanded.clear();
        mount.replaceChildren();
      }
    };
  }
  const ROOT_SELECTOR = "[data-osc-editor-root]";
  const MONACO_MOUNT_SELECTOR = "[data-osc-editor-monaco]";
  const LOADING_CLASS = "osc-editor--loading";
  const ERROR_CLASS = "osc-editor--error";
  function buildShell(root, monacoSlot) {
    root.classList.add("osc-editor--phase3");
    const split = document.createElement("div");
    split.className = "osc-editor__split";
    const treeMount = document.createElement("div");
    treeMount.className = "osc-editor__tree";
    const right = document.createElement("div");
    right.className = "osc-editor__right";
    const tabsMount = document.createElement("div");
    tabsMount.className = "osc-editor__tabs-host";
    const editorMount = document.createElement("div");
    editorMount.className = "osc-editor__monaco-host";
    const statusBar = document.createElement("div");
    statusBar.className = "osc-editor__statusbar";
    const statusLeft = document.createElement("span");
    statusLeft.className = "osc-editor__statusbar-left";
    statusLeft.textContent = "Select a file from the tree.";
    const statusRight = document.createElement("span");
    statusRight.className = "osc-editor__statusbar-right";
    statusBar.append(statusLeft, statusRight);
    right.append(tabsMount, editorMount, statusBar);
    split.append(treeMount, right);
    monacoSlot.replaceChildren(split);
    return { treeMount, tabsMount, editorMount, statusBar, statusLeft, statusRight };
  }
  function formatBytes(n) {
    if (n < 1024) {
      return `${n} B`;
    }
    if (n < 1024 * 1024) {
      return `${(n / 1024).toFixed(1)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  function formatMtime(mtime) {
    if (!mtime) {
      return "";
    }
    return new Date(mtime * 1e3).toLocaleString();
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString();
  }
  async function renderEditor(body) {
    const root = body.querySelector(ROOT_SELECTOR);
    const monacoSlot = body.querySelector(MONACO_MOUNT_SELECTOR);
    if (!root || !monacoSlot) {
      console.error(
        "[os-code-editor] Template mount nodes missing; ensure openstation_code_editor_render_template ran."
      );
      return;
    }
    let monaco;
    try {
      monaco = await loadMonaco();
    } catch (err) {
      root.classList.remove(LOADING_CLASS);
      root.classList.add(ERROR_CLASS);
      monacoSlot.textContent = err instanceof Error ? err.message : "Failed to load Monaco.";
      return;
    }
    const {
      treeMount,
      tabsMount,
      editorMount,
      statusBar,
      statusLeft,
      statusRight
    } = buildShell(
      root,
      monacoSlot
    );
    const placeholder = monaco.editor.createModel(
      "// Click a file in the tree to open it.\n",
      "plaintext"
    );
    const editor = monaco.editor.create(editorMount, {
      model: placeholder,
      theme: monacoThemeForScheme(currentColorScheme()),
      // `automaticLayout: true` polls + relayouts synchronously
      // every tick during a drag-resize, which makes the minimap
      // canvas flicker. We drive layout via a rAF-throttled
      // ResizeObserver below — one layout per frame, no flicker.
      automaticLayout: false,
      minimap: {
        enabled: true,
        // Render the minimap as colour blocks rather than
        // individual character glyphs — same level of detail
        // at a fraction of the per-frame cost. Cheaper redraws
        // = less visible churn during resize.
        renderCharacters: false
      },
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      readOnly: false,
      scrollBeyondLastLine: false
    });
    let layoutScheduled = false;
    const scheduleLayout = () => {
      if (layoutScheduled) {
        return;
      }
      layoutScheduled = true;
      requestAnimationFrame(() => {
        layoutScheduled = false;
        editor.layout();
      });
    };
    const layoutObserver = new ResizeObserver(() => {
      scheduleLayout();
    });
    layoutObserver.observe(editorMount);
    const models = createModelCache();
    const openFiles = /* @__PURE__ */ new Map();
    const modelChangeDisposers = /* @__PURE__ */ new Map();
    const openControllers = /* @__PURE__ */ new Map();
    let saveController = null;
    const setWindowTitle = (title) => {
      const win = window.wp?.os?.windowManager?.getById("wpdc-editor");
      win?.setTitle?.(title);
    };
    const baseTitle = "Code";
    const refreshWindowTitle = () => {
      const activePath = tabs.getActive();
      if (!activePath) {
        setWindowTitle(baseTitle);
        return;
      }
      const file = openFiles.get(activePath);
      const editorModel = editor.getModel();
      const isDirty = !!file && !!editorModel && editorModel.getVersionId() !== file.savedVersionId;
      const basename = activePath.split("/").pop() ?? activePath;
      setWindowTitle(
        `${isDirty ? "● " : ""}${basename} — ${baseTitle}`
      );
    };
    const setStatus = (text, kind = "info") => {
      statusLeft.textContent = text;
      statusBar.classList.toggle(
        "osc-editor__statusbar--error",
        kind === "error"
      );
      statusBar.classList.toggle(
        "osc-editor__statusbar--success",
        kind === "success"
      );
    };
    const setCursorStatus = (line, column) => {
      statusRight.textContent = `Ln ${line}, Col ${column}`;
    };
    const renderFileStatus = (file, suffix = "") => {
      setStatus(
        `${file.path} · ${languageFor(file.path)} · ${formatBytes(
          file.size
        )} · ${formatMtime(file.mtime)}${suffix}`
      );
    };
    const recomputeDirty = (path) => {
      const file = openFiles.get(path);
      const model = models.get(path);
      if (!file || !model) {
        return;
      }
      const dirty = model.getVersionId() !== file.savedVersionId;
      tabs.setDirty(path, dirty);
      if (tabs.getActive() === path) {
        refreshWindowTitle();
      }
    };
    const showFile = (path) => {
      const model = models.get(path);
      if (!model) {
        return;
      }
      editor.setModel(model);
      const file = openFiles.get(path);
      if (file) {
        renderFileStatus(file);
      }
      refreshWindowTitle();
    };
    const onTabActivate = (path) => {
      showFile(path);
    };
    const onTabClose = (path) => {
      openControllers.get(path)?.abort();
      openControllers.delete(path);
      modelChangeDisposers.get(path)?.();
      modelChangeDisposers.delete(path);
      const model = models.get(path);
      if (model && !model.isDisposed()) {
        model.dispose();
      }
      openFiles.delete(path);
      if (!tabs.getActive()) {
        editor.setModel(placeholder);
        setStatus("Select a file from the tree.");
        refreshWindowTitle();
      }
    };
    const tabs = mountTabsStrip({
      mount: tabsMount,
      onActivate: onTabActivate,
      onClose: onTabClose
    });
    const trackModelChanges = (path) => {
      const model = models.get(path);
      if (!model) {
        return;
      }
      modelChangeDisposers.get(path)?.();
      const sub = model.onDidChangeContent(() => {
        recomputeDirty(path);
      });
      modelChangeDisposers.set(path, () => sub.dispose());
    };
    const openFile = async (path) => {
      if (tabs.has(path)) {
        tabs.open(tabMetaForPath(path));
        showFile(path);
        return models.get(path);
      }
      openControllers.get(path)?.abort();
      const ac = new AbortController();
      openControllers.set(path, ac);
      setStatus(`${path} · loading…`);
      try {
        const file = await fetchFile(path, ac.signal);
        if (ac.signal.aborted) {
          return null;
        }
        const model = models.open(monaco, path, file.content);
        openFiles.set(path, {
          path: file.path,
          mtime: file.mtime,
          size: file.size,
          savedVersionId: model.getVersionId()
        });
        trackModelChanges(path);
        tabs.open(tabMetaForPath(file.path));
        showFile(file.path);
        return model;
      } catch (err) {
        if (err.name === "AbortError") {
          return null;
        }
        let msg = "Failed to open file.";
        if (err instanceof RestError) {
          msg = `${err.code} — ${err.message}`;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setStatus(msg, "error");
        return null;
      } finally {
        if (openControllers.get(path) === ac) {
          openControllers.delete(path);
        }
      }
    };
    const openFileAtLine = async (path, line) => {
      const model = await openFile(path);
      if (!model) {
        return null;
      }
      requestAnimationFrame(() => {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      });
      return model;
    };
    const saveActiveFile = async () => {
      const activePath = tabs.getActive();
      if (!activePath) {
        return;
      }
      const file = openFiles.get(activePath);
      const model = models.get(activePath);
      if (!file || !model) {
        return;
      }
      const content = model.getValue();
      saveController?.abort();
      const ac = new AbortController();
      saveController = ac;
      setStatus(`${file.path} · saving…`);
      try {
        const result = await saveFile(file.path, content, file.mtime, ac.signal);
        if (ac.signal.aborted) {
          return;
        }
        const updated = {
          path: result.path,
          mtime: result.mtime,
          size: result.size,
          // Snapshot the model's versionId at save time. Any
          // subsequent edit advances the versionId, which
          // `recomputeDirty` reads to set the tab marker.
          savedVersionId: model.getVersionId()
        };
        openFiles.set(file.path, updated);
        tabs.setDirty(file.path, false);
        renderFileStatus(
          updated,
          ` · saved at ${formatTime(Date.now())}`
        );
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        if (err instanceof RestError && err.code === "openstation_code_editor_conflict") {
          const data = err.data ?? null;
          if (!data) {
            setStatus(
              `${file.path} · conflict but no server data; reload manually.`,
              "error"
            );
            return;
          }
          const choice = await showConflictDialog({
            path: file.path,
            serverMtime: data.server_mtime,
            serverSize: data.server_size
          });
          if (choice === "cancel") {
            setStatus(`${file.path} · save cancelled`, "error");
            return;
          }
          if (choice === "reload") {
            model.setValue(data.server_content);
            const reloaded = {
              path: file.path,
              mtime: data.server_mtime,
              size: data.server_size,
              savedVersionId: model.getVersionId()
            };
            openFiles.set(file.path, reloaded);
            tabs.setDirty(file.path, false);
            renderFileStatus(reloaded, " · reloaded from disk");
            return;
          }
          openFiles.set(file.path, {
            ...file,
            mtime: data.server_mtime,
            size: data.server_size
          });
          await saveActiveFile();
          return;
        }
        let msg = "Failed to save.";
        if (err instanceof RestError) {
          msg = `${err.code} — ${err.message}`;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setStatus(`${file.path} · ${msg}`, "error");
      } finally {
        if (saveController === ac) {
          saveController = null;
        }
      }
    };
    editor.addCommand(
      // eslint-disable-next-line no-bitwise
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        void saveActiveFile();
      }
    );
    editor.addAction({
      id: "osc.saveFile",
      label: "Save File",
      // eslint-disable-next-line no-bitwise
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: "navigation",
      run: () => {
        void saveActiveFile();
      }
    });
    editor.onDidChangeCursorPosition((e) => {
      setCursorStatus(e.position.lineNumber, e.position.column);
    });
    const initial = editor.getPosition();
    if (initial) {
      setCursorStatus(initial.lineNumber, initial.column);
    }
    setPhpProviderHost({ openFileAtLine });
    const onPostOpen = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== "os-code-open" || typeof data.path !== "string") {
        return;
      }
      void openFileAtLine(data.path, data.line ?? 1);
    };
    window.addEventListener("message", onPostOpen);
    mountFileTree({
      mount: treeMount,
      onOpen: (path) => {
        void openFile(path);
      }
    });
    root.classList.remove(LOADING_CLASS);
  }
  installEditorGlobalListeners();
  const registry = window.openStationNativeWindows ?? (window.openStationNativeWindows = {});
  registry["wpdc-editor"] = (body) => {
    void renderEditor(body);
  };
  exports.ERROR_CLASS = ERROR_CLASS;
  exports.LOADING_CLASS = LOADING_CLASS;
  exports.MONACO_MOUNT_SELECTOR = MONACO_MOUNT_SELECTOR;
  exports.ROOT_SELECTOR = ROOT_SELECTOR;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
