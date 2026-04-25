var wpDesktopCodeEditor = function(exports) {
  "use strict";
  function showConflictDialog(args) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "wpdc-conflict-overlay";
      const dialog = document.createElement("div");
      dialog.className = "wpdc-conflict-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "wpdc-conflict-title");
      const title = document.createElement("h2");
      title.id = "wpdc-conflict-title";
      title.className = "wpdc-conflict-dialog__title";
      title.textContent = "File changed on disk";
      const body = document.createElement("p");
      body.className = "wpdc-conflict-dialog__body";
      body.textContent = `Someone else (or another tab) modified ${args.path} since you opened it. Choose how to resolve:`;
      const meta = document.createElement("p");
      meta.className = "wpdc-conflict-dialog__meta";
      meta.textContent = `Server version: ${args.serverSize} bytes · ${new Date(
        args.serverMtime * 1e3
      ).toLocaleString()}`;
      const actions = document.createElement("div");
      actions.className = "wpdc-conflict-dialog__actions";
      const finish = (choice) => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(choice);
      };
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "wpdc-conflict-dialog__btn";
      reload.textContent = "Reload from disk";
      reload.title = "Discard your edits and load the server version.";
      reload.addEventListener("click", () => finish("reload"));
      const overwrite = document.createElement("button");
      overwrite.type = "button";
      overwrite.className = "wpdc-conflict-dialog__btn wpdc-conflict-dialog__btn--danger";
      overwrite.textContent = "Overwrite anyway";
      overwrite.title = "Save your edits, replacing the server version.";
      overwrite.addEventListener("click", () => finish("overwrite"));
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "wpdc-conflict-dialog__btn wpdc-conflict-dialog__btn--quiet";
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
    const config2 = window.wpDesktopCodeEditorConfig;
    if (!config2?.monacoVendorUrl) {
      throw new Error(
        "wp-desktop-code-editor: monacoVendorUrl missing from wpDesktopCodeEditorConfig — is window.php enqueued?"
      );
    }
    installWorkerEnvironment(config2.monacoVendorUrl);
    loader.config({
      paths: { vs: config2.monacoVendorUrl }
    });
    pending = loader.init().then((monaco) => {
      cached = monaco;
      configureLanguageServices(cached);
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
    const config2 = window.wpDesktopCodeEditorConfig;
    if (!config2) {
      throw new Error(
        "wp-desktop-code-editor: wpDesktopCodeEditorConfig missing — is the editor enqueued?"
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
        obj.code ?? "wpdc_http_error",
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
        obj.code ?? "wpdc_http_error",
        res.status,
        obj.data ?? null
      );
    }
    return body;
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
    mount.classList.add("wpdc-tree");
    mount.replaceChildren();
    const childrenByPath = /* @__PURE__ */ new Map();
    const expanded = /* @__PURE__ */ new Set();
    const inflight = /* @__PURE__ */ new Map();
    const renderRow = (entry) => {
      const li = document.createElement("li");
      li.className = `wpdc-tree__row wpdc-tree__row--${entry.type}`;
      if (!entry.allowed && entry.type === "file") {
        li.classList.add("wpdc-tree__row--disabled");
      }
      li.dataset.path = entry.path;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wpdc-tree__btn";
      if (!entry.allowed && entry.type === "file") {
        button.disabled = true;
        button.title = "File extension is not in the editor allowlist.";
      }
      const caret = document.createElement("span");
      caret.className = "wpdc-tree__caret";
      caret.textContent = entry.type === "dir" ? "▸" : "";
      const icon = document.createElement("span");
      icon.className = `wpdc-tree__icon dashicons ${iconFor(entry, false)}`;
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "wpdc-tree__label";
      label.textContent = entry.name;
      button.append(caret, icon, label);
      li.append(button);
      if (entry.type === "file") {
        button.addEventListener("click", () => {
          if (!entry.allowed) {
            return;
          }
          mount.querySelectorAll(".wpdc-tree__row--active").forEach(
            (el) => el.classList.remove("wpdc-tree__row--active")
          );
          li.classList.add("wpdc-tree__row--active");
          onOpen(entry.path);
        });
        return li;
      }
      const childUl = document.createElement("ul");
      childUl.className = "wpdc-tree__children";
      childUl.hidden = true;
      li.append(childUl);
      const setExpanded = (open) => {
        caret.textContent = open ? "▾" : "▸";
        icon.className = `wpdc-tree__icon dashicons ${iconFor(entry, open)}`;
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
          placeholder.className = "wpdc-tree__loading";
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
          errorRow.className = "wpdc-tree__error";
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
    rootUl.className = "wpdc-tree__root";
    mount.append(rootUl);
    const loading = document.createElement("li");
    loading.className = "wpdc-tree__loading";
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
        errorRow.className = "wpdc-tree__error";
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
  const ROOT_SELECTOR = "[data-wpdc-editor-root]";
  const MONACO_MOUNT_SELECTOR = "[data-wpdc-editor-monaco]";
  const LOADING_CLASS = "wpdc-editor--loading";
  const ERROR_CLASS = "wpdc-editor--error";
  function buildShell(root, monacoSlot) {
    root.classList.add("wpdc-editor--phase3");
    const split = document.createElement("div");
    split.className = "wpdc-editor__split";
    const treeMount = document.createElement("div");
    treeMount.className = "wpdc-editor__tree";
    const right = document.createElement("div");
    right.className = "wpdc-editor__right";
    const editorMount = document.createElement("div");
    editorMount.className = "wpdc-editor__monaco-host";
    const statusBar = document.createElement("div");
    statusBar.className = "wpdc-editor__statusbar";
    statusBar.textContent = "Select a file from the tree.";
    right.append(editorMount, statusBar);
    split.append(treeMount, right);
    monacoSlot.replaceChildren(split);
    return { treeMount, editorMount, statusBar };
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
        "[wp-desktop-code-editor] Template mount nodes missing; ensure wpdc_render_editor_template ran."
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
    const { treeMount, editorMount, statusBar } = buildShell(root, monacoSlot);
    const placeholder = monaco.editor.createModel(
      "// Click a file in the tree to open it.\n",
      "plaintext"
    );
    const editor = monaco.editor.create(editorMount, {
      model: placeholder,
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      // Phase 3 — editing on. Save shortcut wired below.
      readOnly: false,
      scrollBeyondLastLine: false
    });
    const models = createModelCache();
    let activeFile = null;
    let openController = null;
    let saveController = null;
    const setStatus = (text, kind = "info") => {
      statusBar.textContent = text;
      statusBar.classList.toggle(
        "wpdc-editor__statusbar--error",
        kind === "error"
      );
      statusBar.classList.toggle(
        "wpdc-editor__statusbar--success",
        kind === "success"
      );
    };
    const renderFileStatus = (file, suffix = "") => {
      setStatus(
        `${file.path} · ${languageFor(file.path)} · ${formatBytes(
          file.size
        )} · ${formatMtime(file.mtime)}${suffix}`
      );
    };
    const openFile = async (path) => {
      openController?.abort();
      const ac = new AbortController();
      openController = ac;
      setStatus(`${path} · loading…`);
      try {
        const file = await fetchFile(path, ac.signal);
        if (ac.signal.aborted) {
          return;
        }
        const model = models.open(monaco, path, file.content);
        editor.setModel(model);
        activeFile = {
          path: file.path,
          mtime: file.mtime,
          size: file.size
        };
        renderFileStatus(activeFile);
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        let msg = "Failed to open file.";
        if (err instanceof RestError) {
          msg = `${err.code} — ${err.message}`;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setStatus(msg, "error");
      } finally {
        if (openController === ac) {
          openController = null;
        }
      }
    };
    const saveActiveFile = async () => {
      if (!activeFile) {
        return;
      }
      const file = activeFile;
      const model = editor.getModel();
      if (!model) {
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
        activeFile = {
          path: result.path,
          mtime: result.mtime,
          size: result.size
        };
        renderFileStatus(
          activeFile,
          ` · saved at ${formatTime(Date.now())}`
        );
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        if (err instanceof RestError && err.code === "wpdc_conflict") {
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
            setStatus(
              `${file.path} · save cancelled`,
              "error"
            );
            return;
          }
          if (choice === "reload") {
            model.setValue(data.server_content);
            activeFile = {
              path: file.path,
              mtime: data.server_mtime,
              size: data.server_size
            };
            renderFileStatus(
              activeFile,
              " · reloaded from disk"
            );
            return;
          }
          activeFile = {
            path: file.path,
            mtime: data.server_mtime,
            size: data.server_size
          };
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
      id: "wpdc.saveFile",
      label: "Save File",
      // eslint-disable-next-line no-bitwise
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: "navigation",
      run: () => {
        void saveActiveFile();
      }
    });
    mountFileTree({
      mount: treeMount,
      onOpen: (path) => {
        void openFile(path);
      }
    });
    root.classList.remove(LOADING_CLASS);
  }
  const registry = window.wpDesktopNativeWindows ?? (window.wpDesktopNativeWindows = {});
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
