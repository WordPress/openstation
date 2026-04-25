var wpDesktopCodeEditor = function(exports) {
  "use strict";
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
  const SAMPLES = [
    {
      id: "php",
      label: "PHP",
      language: "php",
      uri: "inmemory://samples/sample.php",
      content: `<?php
/**
 * Welcome to the WP Desktop Code editor.
 *
 * Phase 1b: TypeScript / JavaScript / CSS / SCSS / HTML / JSON
 * IntelliSense is online (try the language picker above this editor).
 *
 * PHP IntelliSense — including WordPress-aware completion for
 * \`add_action\`, \`wp_get_current_user\`, etc. — lands in Phase 5.
 * For now PHP gets syntax highlighting only.
 */

function wpdc_say_hello( $name = 'world' ) {
    return sprintf( 'Hello, %s!', sanitize_text_field( $name ) );
}

add_action( 'init', function () {
    error_log( wpdc_say_hello( 'WP Desktop Mode' ) );
} );
`
    },
    {
      id: "ts",
      label: "TypeScript",
      language: "typescript",
      uri: "inmemory://samples/sample.ts",
      content: `/**
 * Try typing on a fresh line:
 *
 *   const arr = [1, 2, 3];
 *   arr.|     ← should autocomplete to .map / .filter / .reduce / .length
 *
 * Hover over an identifier to see its inferred type.
 */

interface Plugin {
	id: string;
	render: ( body: HTMLElement ) => void;
}

const plugins: Plugin[] = [
	{ id: 'jorvy', render: ( body ) => body.append( 'I am Iron Man.' ) },
];

const ids = plugins.map( ( p ) => p.id ).join( ', ' );
`
    },
    {
      id: "tsx",
      label: "TSX (React)",
      language: "typescript",
      uri: "inmemory://samples/sample.tsx",
      content: `/**
 * Try typing inside the JSX:
 *
 *   <div onCl|     ← autocompletes to onClick / onClickCapture
 *   <input ty|     ← autocompletes to type=
 *
 * Hover \`useState\` to see its generic signature.
 */

import * as React from 'react';

interface CounterProps {
	initial?: number;
	onChange?: ( value: number ) => void;
}

export function Counter( { initial = 0, onChange }: CounterProps ) {
	const [ value, setValue ] = React.useState( initial );
	return (
		<div className="counter">
			<button onClick={ () => {
				setValue( value + 1 );
				onChange?.( value + 1 );
			} }>
				{ value }
			</button>
		</div>
	);
}
`
    },
    {
      id: "js",
      label: "JavaScript",
      language: "javascript",
      uri: "inmemory://samples/sample.js",
      content: `/**
 * Vanilla JS — JSDoc drives inference even without TS.
 *
 *   const ev = doc.|   ← autocompletes off the inferred Document type.
 */

/** @type {Document} */
const doc = document;

const links = doc.querySelectorAll( 'a[href^="#"]' );
links.forEach( ( link ) => {
	link.addEventListener( 'click', ( e ) => e.preventDefault() );
} );
`
    },
    {
      id: "jsx",
      label: "JSX",
      language: "javascript",
      uri: "inmemory://samples/sample.jsx",
      content: `/**
 * Vanilla JSX (no types, no imports declared in this in-memory
 * file). JSX intrinsics still autocomplete because the TS worker
 * is configured with \`jsx: 'react'\`.
 */

function Greeting( { name } ) {
	return <h1 className="greet">Hello, { name }!</h1>;
}

const root = document.getElementById( 'app' );
// Pretend ReactDOM.render(<Greeting name="World" />, root)
`
    },
    {
      id: "css",
      label: "CSS",
      language: "css",
      uri: "inmemory://samples/sample.css",
      content: `/**
 * Try:
 *   - Hover \`#2271b1\` — color preview pops.
 *   - Type \`background-\` on a fresh line — completion lists
 *     background-color, background-image, etc.
 *   - Misspell a property — squiggle.
 */

.wp-desktop-window {
	box-sizing: border-box;
	background-color: #2271b1;
	color: white;
	padding: 12px;
	border-radius: 8px;
}

.wp-desktop-window:hover {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
`
    },
    {
      id: "scss",
      label: "SCSS",
      language: "scss",
      uri: "inmemory://samples/sample.scss",
      content: `/**
 * SCSS-specific features the worker validates:
 *   - \`@include\` / \`@mixin\` completion.
 *   - Variable references — type \`$\` to see options.
 *   - Nested selectors collapse + linting.
 */

$accent: #2271b1;
$radius: 8px;

@mixin elevate( $depth: 2 ) {
	box-shadow: 0 #{ $depth * 2 }px #{ $depth * 6 }px rgba(0, 0, 0, 0.15);
}

.wp-desktop-window {
	background: $accent;
	border-radius: $radius;

	&:hover {
		@include elevate( 3 );
	}

	&__title {
		font-weight: 600;
	}
}
`
    },
    {
      id: "html",
      label: "HTML",
      language: "html",
      uri: "inmemory://samples/sample.html",
      content: `<!--
  Try:
    - Type < on a fresh line — tag completion.
    - Inside <style>…</style> the CSS worker takes over.
    - Inside <script>…<\/script> the JS worker takes over.
-->
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>WP Desktop Mode</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; }
		h1 { color: #2271b1; }
	</style>
</head>
<body>
	<h1>Hello, world.</h1>
	<script>
		console.log( 'Embedded JS — completion still works here.' );
	<\/script>
</body>
</html>
`
    },
    {
      id: "json",
      label: "JSON",
      language: "json",
      uri: "inmemory://samples/sample.json",
      content: `{
	"name": "wp-desktop-mode",
	"version": "0.18.0",
	"description": "Renders the WordPress admin as a desktop OS.",
	"keywords": [ "wordpress", "admin", "desktop" ],
	"comment": "Try removing a comma above — the worker will squiggle it."
}
`
    },
    {
      id: "md",
      label: "Markdown",
      language: "markdown",
      uri: "inmemory://samples/sample.md",
      content: `# WP Desktop Code editor

This sample exercises **markdown tokenization**. Monaco doesn't ship
a markdown language service, so there's no IntelliSense here — just
paint.

## What's online in Phase 1b

- TypeScript / JavaScript IntelliSense (with JSX/TSX).
- CSS / SCSS / LESS validation.
- HTML completion + embedded-language switching.
- JSON schema-flavored validation.

## What's coming

- Phase 2 — file tree backed by REST.
- Phase 3 — save flow with WP_Filesystem.
- Phase 5 — WordPress-aware PHP IntelliSense.

\`\`\`ts
// Code blocks tokenize with the right language even here.
const ok: boolean = true;
\`\`\`
`
    }
  ];
  const ROOT_SELECTOR = "[data-wpdc-editor-root]";
  const MONACO_MOUNT_SELECTOR = "[data-wpdc-editor-monaco]";
  const LOADING_CLASS = "wpdc-editor--loading";
  const ERROR_CLASS = "wpdc-editor--error";
  const modelCache = /* @__PURE__ */ new Map();
  function getOrCreateModel(monaco, sample) {
    const cached2 = modelCache.get(sample.id);
    if (cached2 && !cached2.isDisposed()) {
      return cached2;
    }
    const uri = monaco.Uri.parse(sample.uri);
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      modelCache.set(sample.id, existing);
      return existing;
    }
    const model = monaco.editor.createModel(sample.content, sample.language, uri);
    modelCache.set(sample.id, model);
    return model;
  }
  function buildLanguagePicker(current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "wpdc-editor__picker";
    const label = document.createElement("label");
    label.className = "wpdc-editor__picker-label";
    label.textContent = "Sample";
    const select = document.createElement("select");
    select.className = "wpdc-editor__picker-select";
    for (const sample of SAMPLES) {
      const opt = document.createElement("option");
      opt.value = sample.id;
      opt.textContent = sample.label;
      if (sample.id === current.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const next = SAMPLES.find((s) => s.id === select.value);
      if (next) {
        onPick(next);
      }
    });
    const id = `wpdc-editor-picker-${Math.random().toString(36).slice(2, 8)}`;
    select.id = id;
    label.htmlFor = id;
    wrap.append(label, select);
    return wrap;
  }
  async function renderEditor(body) {
    const root = body.querySelector(ROOT_SELECTOR);
    const mount = body.querySelector(MONACO_MOUNT_SELECTOR);
    if (!root || !mount) {
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
      mount.textContent = err instanceof Error ? err.message : "Failed to load Monaco.";
      return;
    }
    let active = SAMPLES.find((s) => s.id === "php") ?? SAMPLES[0];
    const editor = monaco.editor.create(mount, {
      model: getOrCreateModel(monaco, active),
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      readOnly: false,
      scrollBeyondLastLine: false
    });
    const picker = buildLanguagePicker(active, (next) => {
      active = next;
      editor.setModel(getOrCreateModel(monaco, next));
    });
    root.insertBefore(picker, mount);
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
