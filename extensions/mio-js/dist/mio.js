var MioBundle = function() {
  "use strict";
  var ExtensionType =                 ((ExtensionType2) => {
    ExtensionType2["Application"] = "application";
    ExtensionType2["WebGLPipes"] = "webgl-pipes";
    ExtensionType2["WebGLPipesAdaptor"] = "webgl-pipes-adaptor";
    ExtensionType2["WebGLSystem"] = "webgl-system";
    ExtensionType2["WebGPUPipes"] = "webgpu-pipes";
    ExtensionType2["WebGPUPipesAdaptor"] = "webgpu-pipes-adaptor";
    ExtensionType2["WebGPUSystem"] = "webgpu-system";
    ExtensionType2["CanvasSystem"] = "canvas-system";
    ExtensionType2["CanvasPipesAdaptor"] = "canvas-pipes-adaptor";
    ExtensionType2["CanvasPipes"] = "canvas-pipes";
    ExtensionType2["Asset"] = "asset";
    ExtensionType2["LoadParser"] = "load-parser";
    ExtensionType2["ResolveParser"] = "resolve-parser";
    ExtensionType2["CacheParser"] = "cache-parser";
    ExtensionType2["DetectionParser"] = "detection-parser";
    ExtensionType2["MaskEffect"] = "mask-effect";
    ExtensionType2["BlendMode"] = "blend-mode";
    ExtensionType2["TextureSource"] = "texture-source";
    ExtensionType2["Environment"] = "environment";
    ExtensionType2["ShapeBuilder"] = "shape-builder";
    ExtensionType2["Batcher"] = "batcher";
    return ExtensionType2;
  })(ExtensionType || {});
  const normalizeExtension = (ext) => {
    if (typeof ext === "function" || typeof ext === "object" && ext.extension) {
      if (!ext.extension) {
        throw new Error("Extension class must have an extension object");
      }
      const metadata = typeof ext.extension !== "object" ? { type: ext.extension } : ext.extension;
      ext = { ...metadata, ref: ext };
    }
    if (typeof ext === "object") {
      ext = { ...ext };
    } else {
      throw new Error("Invalid extension type");
    }
    if (typeof ext.type === "string") {
      ext.type = [ext.type];
    }
    return ext;
  };
  const normalizeExtensionPriority = (ext, defaultPriority) => normalizeExtension(ext).priority ?? defaultPriority;
  const extensions = {

    _addHandlers: {},

    _removeHandlers: {},

    _queue: {},

    remove(...extensions2) {
      extensions2.map(normalizeExtension).forEach((ext) => {
        ext.type.forEach((type) => this._removeHandlers[type]?.(ext));
      });
      return this;
    },

    add(...extensions2) {
      extensions2.map(normalizeExtension).forEach((ext) => {
        ext.type.forEach((type) => {
          const handlers = this._addHandlers;
          const queue = this._queue;
          if (!handlers[type]) {
            queue[type] = queue[type] || [];
            queue[type]?.push(ext);
          } else {
            handlers[type]?.(ext);
          }
        });
      });
      return this;
    },

    handle(type, onAdd, onRemove) {
      const addHandlers = this._addHandlers;
      const removeHandlers = this._removeHandlers;
      if (addHandlers[type] || removeHandlers[type]) {
        throw new Error(`Extension type ${type} already has a handler`);
      }
      addHandlers[type] = onAdd;
      removeHandlers[type] = onRemove;
      const queue = this._queue;
      if (queue[type]) {
        queue[type]?.forEach((ext) => onAdd(ext));
        delete queue[type];
      }
      return this;
    },

    handleByMap(type, map) {
      return this.handle(
        type,
        (extension) => {
          if (extension.name) {
            map[extension.name] = extension.ref;
          }
        },
        (extension) => {
          if (extension.name) {
            delete map[extension.name];
          }
        }
      );
    },

    handleByNamedList(type, map, defaultPriority = -1) {
      return this.handle(
        type,
        (extension) => {
          const index = map.findIndex((item) => item.name === extension.name);
          if (index >= 0) return;
          map.push({ name: extension.name, value: extension.ref });
          map.sort((a2, b2) => normalizeExtensionPriority(b2.value, defaultPriority) - normalizeExtensionPriority(a2.value, defaultPriority));
        },
        (extension) => {
          const index = map.findIndex((item) => item.name === extension.name);
          if (index !== -1) {
            map.splice(index, 1);
          }
        }
      );
    },

    handleByList(type, list, defaultPriority = -1) {
      return this.handle(
        type,
        (extension) => {
          if (list.includes(extension.ref)) {
            return;
          }
          list.push(extension.ref);
          list.sort((a2, b2) => normalizeExtensionPriority(b2, defaultPriority) - normalizeExtensionPriority(a2, defaultPriority));
        },
        (extension) => {
          const index = list.indexOf(extension.ref);
          if (index !== -1) {
            list.splice(index, 1);
          }
        }
      );
    },

    mixin(Target, ...sources2) {
      for (const source2 of sources2) {
        Object.defineProperties(Target.prototype, Object.getOwnPropertyDescriptors(source2));
      }
    }
  };
  const browserExt = {
    extension: {
      type: ExtensionType.Environment,
      name: "browser",
      priority: -1
    },
    test: () => true,
    load: async () => {
      await Promise.resolve().then(() => browserAll);
    }
  };
  const webworkerExt = {
    extension: {
      type: ExtensionType.Environment,
      name: "webworker",
      priority: 0
    },
    test: () => typeof self !== "undefined" && self.WorkerGlobalScope !== void 0,
    load: async () => {
      await Promise.resolve().then(() => webworkerAll);
    }
  };
  class ObservablePoint {

    constructor(observer, x2, y2) {
      this._x = x2 || 0;
      this._y = y2 || 0;
      this._observer = observer;
    }

    clone(observer) {
      return new ObservablePoint(observer ?? this._observer, this._x, this._y);
    }

    set(x2 = 0, y2 = x2) {
      if (this._x !== x2 || this._y !== y2) {
        this._x = x2;
        this._y = y2;
        this._observer._onUpdate(this);
      }
      return this;
    }

    copyFrom(p2) {
      if (this._x !== p2.x || this._y !== p2.y) {
        this._x = p2.x;
        this._y = p2.y;
        this._observer._onUpdate(this);
      }
      return this;
    }

    copyTo(p2) {
      p2.set(this._x, this._y);
      return p2;
    }

    equals(p2) {
      return p2.x === this._x && p2.y === this._y;
    }
    toString() {
      return `[pixi.js/math:ObservablePoint x=${this._x} y=${this._y} scope=${this._observer}]`;
    }

    get x() {
      return this._x;
    }
    set x(value) {
      if (this._x !== value) {
        this._x = value;
        this._observer._onUpdate(this);
      }
    }

    get y() {
      return this._y;
    }
    set y(value) {
      if (this._y !== value) {
        this._y = value;
        this._observer._onUpdate(this);
      }
    }
  }
  function getDefaultExportFromCjs(x2) {
    return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
  }
  var eventemitter3 = { exports: {} };
  (function(module) {
    var has = Object.prototype.hasOwnProperty, prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype =                 Object.create(null);
      if (!new Events().__proto__) prefix = false;
    }
    function EE(fn, context2, once) {
      this.fn = fn;
      this.context = context2;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context2, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context2 || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
      else emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0) emitter._events = new Events();
      else delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0) return names;
      for (name in events = this._events) {
        if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i2 = 0, l2 = handlers.length, ee = new Array(l2); i2 < l2; i2++) {
        ee[i2] = handlers[i2].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return false;
      var listeners = this._events[evt], len = arguments.length, args, i2;
      if (listeners.fn) {
        if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i2 = 1, args = new Array(len - 1); i2 < len; i2++) {
          args[i2 - 1] = arguments[i2];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length2 = listeners.length, j2;
        for (i2 = 0; i2 < length2; i2++) {
          if (listeners[i2].once) this.removeListener(event, listeners[i2].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i2].fn.call(listeners[i2].context);
              break;
            case 2:
              listeners[i2].fn.call(listeners[i2].context, a1);
              break;
            case 3:
              listeners[i2].fn.call(listeners[i2].context, a1, a2);
              break;
            case 4:
              listeners[i2].fn.call(listeners[i2].context, a1, a2, a3);
              break;
            default:
              if (!args) for (j2 = 1, args = new Array(len - 1); j2 < len; j2++) {
                args[j2 - 1] = arguments[j2];
              }
              listeners[i2].fn.apply(listeners[i2].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context2) {
      return addListener(this, event, fn, context2, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context2) {
      return addListener(this, event, fn, context2, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context2, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context2 || listeners.context === context2)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i2 = 0, events = [], length2 = listeners.length; i2 < length2; i2++) {
          if (listeners[i2].fn !== fn || once && !listeners[i2].once || context2 && listeners[i2].context !== context2) {
            events.push(listeners[i2]);
          }
        }
        if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
        else clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt]) clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    {
      module.exports = EventEmitter2;
    }
  })(eventemitter3);
  var eventemitter3Exports = eventemitter3.exports;
  const EventEmitter =                 getDefaultExportFromCjs(eventemitter3Exports);
  const PI_2 = Math.PI * 2;
  const RAD_TO_DEG = 180 / Math.PI;
  const DEG_TO_RAD = Math.PI / 180;
  class Point {

    constructor(x2 = 0, y2 = 0) {
      this.x = 0;
      this.y = 0;
      this.x = x2;
      this.y = y2;
    }

    clone() {
      return new Point(this.x, this.y);
    }

    copyFrom(p2) {
      this.set(p2.x, p2.y);
      return this;
    }

    copyTo(p2) {
      p2.set(this.x, this.y);
      return p2;
    }

    equals(p2) {
      return p2.x === this.x && p2.y === this.y;
    }

    set(x2 = 0, y2 = x2) {
      this.x = x2;
      this.y = y2;
      return this;
    }
    toString() {
      return `[pixi.js/math:Point x=${this.x} y=${this.y}]`;
    }

    static get shared() {
      tempPoint.x = 0;
      tempPoint.y = 0;
      return tempPoint;
    }
  }
  const tempPoint = new Point();
  class Matrix {

    constructor(a2 = 1, b2 = 0, c2 = 0, d2 = 1, tx = 0, ty = 0) {
      this.array = null;
      this.a = a2;
      this.b = b2;
      this.c = c2;
      this.d = d2;
      this.tx = tx;
      this.ty = ty;
    }

    fromArray(array) {
      this.a = array[0];
      this.b = array[1];
      this.c = array[3];
      this.d = array[4];
      this.tx = array[2];
      this.ty = array[5];
    }

    set(a2, b2, c2, d2, tx, ty) {
      this.a = a2;
      this.b = b2;
      this.c = c2;
      this.d = d2;
      this.tx = tx;
      this.ty = ty;
      return this;
    }

    toArray(transpose, out2) {
      if (!this.array) {
        this.array = new Float32Array(9);
      }
      const array = out2 || this.array;
      if (transpose) {
        array[0] = this.a;
        array[1] = this.b;
        array[2] = 0;
        array[3] = this.c;
        array[4] = this.d;
        array[5] = 0;
        array[6] = this.tx;
        array[7] = this.ty;
        array[8] = 1;
      } else {
        array[0] = this.a;
        array[1] = this.c;
        array[2] = this.tx;
        array[3] = this.b;
        array[4] = this.d;
        array[5] = this.ty;
        array[6] = 0;
        array[7] = 0;
        array[8] = 1;
      }
      return array;
    }

    apply(pos, newPos) {
      newPos = newPos || new Point();
      const x2 = pos.x;
      const y2 = pos.y;
      newPos.x = this.a * x2 + this.c * y2 + this.tx;
      newPos.y = this.b * x2 + this.d * y2 + this.ty;
      return newPos;
    }

    applyInverse(pos, newPos) {
      newPos = newPos || new Point();
      const a2 = this.a;
      const b2 = this.b;
      const c2 = this.c;
      const d2 = this.d;
      const tx = this.tx;
      const ty = this.ty;
      const id = 1 / (a2 * d2 + c2 * -b2);
      const x2 = pos.x;
      const y2 = pos.y;
      newPos.x = d2 * id * x2 + -c2 * id * y2 + (ty * c2 - tx * d2) * id;
      newPos.y = a2 * id * y2 + -b2 * id * x2 + (-ty * a2 + tx * b2) * id;
      return newPos;
    }

    translate(x2, y2) {
      this.tx += x2;
      this.ty += y2;
      return this;
    }

    scale(x2, y2) {
      this.a *= x2;
      this.d *= y2;
      this.c *= x2;
      this.b *= y2;
      this.tx *= x2;
      this.ty *= y2;
      return this;
    }

    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const a1 = this.a;
      const c1 = this.c;
      const tx1 = this.tx;
      this.a = a1 * cos - this.b * sin;
      this.b = a1 * sin + this.b * cos;
      this.c = c1 * cos - this.d * sin;
      this.d = c1 * sin + this.d * cos;
      this.tx = tx1 * cos - this.ty * sin;
      this.ty = tx1 * sin + this.ty * cos;
      return this;
    }

    append(matrix) {
      const a1 = this.a;
      const b1 = this.b;
      const c1 = this.c;
      const d1 = this.d;
      this.a = matrix.a * a1 + matrix.b * c1;
      this.b = matrix.a * b1 + matrix.b * d1;
      this.c = matrix.c * a1 + matrix.d * c1;
      this.d = matrix.c * b1 + matrix.d * d1;
      this.tx = matrix.tx * a1 + matrix.ty * c1 + this.tx;
      this.ty = matrix.tx * b1 + matrix.ty * d1 + this.ty;
      return this;
    }

    appendFrom(a2, b2) {
      const a1 = a2.a;
      const b1 = a2.b;
      const c1 = a2.c;
      const d1 = a2.d;
      const tx = a2.tx;
      const ty = a2.ty;
      const a22 = b2.a;
      const b22 = b2.b;
      const c2 = b2.c;
      const d2 = b2.d;
      this.a = a1 * a22 + b1 * c2;
      this.b = a1 * b22 + b1 * d2;
      this.c = c1 * a22 + d1 * c2;
      this.d = c1 * b22 + d1 * d2;
      this.tx = tx * a22 + ty * c2 + b2.tx;
      this.ty = tx * b22 + ty * d2 + b2.ty;
      return this;
    }

    setTransform(x2, y2, pivotX, pivotY, scaleX, scaleY, rotation, skewX, skewY) {
      this.a = Math.cos(rotation + skewY) * scaleX;
      this.b = Math.sin(rotation + skewY) * scaleX;
      this.c = -Math.sin(rotation - skewX) * scaleY;
      this.d = Math.cos(rotation - skewX) * scaleY;
      this.tx = x2 - (pivotX * this.a + pivotY * this.c);
      this.ty = y2 - (pivotX * this.b + pivotY * this.d);
      return this;
    }

    prepend(matrix) {
      const tx1 = this.tx;
      if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) {
        const a1 = this.a;
        const c1 = this.c;
        this.a = a1 * matrix.a + this.b * matrix.c;
        this.b = a1 * matrix.b + this.b * matrix.d;
        this.c = c1 * matrix.a + this.d * matrix.c;
        this.d = c1 * matrix.b + this.d * matrix.d;
      }
      this.tx = tx1 * matrix.a + this.ty * matrix.c + matrix.tx;
      this.ty = tx1 * matrix.b + this.ty * matrix.d + matrix.ty;
      return this;
    }

    decompose(transform) {
      const a2 = this.a;
      const b2 = this.b;
      const c2 = this.c;
      const d2 = this.d;
      const pivot = transform.pivot;
      const skewX = -Math.atan2(-c2, d2);
      const skewY = Math.atan2(b2, a2);
      const delta = Math.abs(skewX + skewY);
      if (delta < 1e-5 || Math.abs(PI_2 - delta) < 1e-5) {
        transform.rotation = skewY;
        transform.skew.x = transform.skew.y = 0;
      } else {
        transform.rotation = 0;
        transform.skew.x = skewX;
        transform.skew.y = skewY;
      }
      transform.scale.x = Math.sqrt(a2 * a2 + b2 * b2);
      transform.scale.y = Math.sqrt(c2 * c2 + d2 * d2);
      transform.position.x = this.tx + (pivot.x * a2 + pivot.y * c2);
      transform.position.y = this.ty + (pivot.x * b2 + pivot.y * d2);
      return transform;
    }

    invert() {
      const a1 = this.a;
      const b1 = this.b;
      const c1 = this.c;
      const d1 = this.d;
      const tx1 = this.tx;
      const n2 = a1 * d1 - b1 * c1;
      this.a = d1 / n2;
      this.b = -b1 / n2;
      this.c = -c1 / n2;
      this.d = a1 / n2;
      this.tx = (c1 * this.ty - d1 * tx1) / n2;
      this.ty = -(a1 * this.ty - b1 * tx1) / n2;
      return this;
    }

    isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.tx === 0 && this.ty === 0;
    }

    identity() {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.tx = 0;
      this.ty = 0;
      return this;
    }

    clone() {
      const matrix = new Matrix();
      matrix.a = this.a;
      matrix.b = this.b;
      matrix.c = this.c;
      matrix.d = this.d;
      matrix.tx = this.tx;
      matrix.ty = this.ty;
      return matrix;
    }

    copyTo(matrix) {
      matrix.a = this.a;
      matrix.b = this.b;
      matrix.c = this.c;
      matrix.d = this.d;
      matrix.tx = this.tx;
      matrix.ty = this.ty;
      return matrix;
    }

    copyFrom(matrix) {
      this.a = matrix.a;
      this.b = matrix.b;
      this.c = matrix.c;
      this.d = matrix.d;
      this.tx = matrix.tx;
      this.ty = matrix.ty;
      return this;
    }

    equals(matrix) {
      return matrix.a === this.a && matrix.b === this.b && matrix.c === this.c && matrix.d === this.d && matrix.tx === this.tx && matrix.ty === this.ty;
    }
    toString() {
      return `[pixi.js:Matrix a=${this.a} b=${this.b} c=${this.c} d=${this.d} tx=${this.tx} ty=${this.ty}]`;
    }

    static get IDENTITY() {
      return identityMatrix$1.identity();
    }

    static get shared() {
      return tempMatrix$6.identity();
    }
  }
  const tempMatrix$6 = new Matrix();
  const identityMatrix$1 = new Matrix();
  const ux = [1, 1, 0, -1, -1, -1, 0, 1, 1, 1, 0, -1, -1, -1, 0, 1];
  const uy = [0, 1, 1, 1, 0, -1, -1, -1, 0, 1, 1, 1, 0, -1, -1, -1];
  const vx = [0, -1, -1, -1, 0, 1, 1, 1, 0, 1, 1, 1, 0, -1, -1, -1];
  const vy = [1, 1, 0, -1, -1, -1, 0, 1, -1, -1, 0, 1, 1, 1, 0, -1];
  const rotationCayley = [];
  const rotationMatrices = [];
  const signum = Math.sign;
  function init() {
    for (let i2 = 0; i2 < 16; i2++) {
      const row = [];
      rotationCayley.push(row);
      for (let j2 = 0; j2 < 16; j2++) {
        const _ux = signum(ux[i2] * ux[j2] + vx[i2] * uy[j2]);
        const _uy = signum(uy[i2] * ux[j2] + vy[i2] * uy[j2]);
        const _vx = signum(ux[i2] * vx[j2] + vx[i2] * vy[j2]);
        const _vy = signum(uy[i2] * vx[j2] + vy[i2] * vy[j2]);
        for (let k2 = 0; k2 < 16; k2++) {
          if (ux[k2] === _ux && uy[k2] === _uy && vx[k2] === _vx && vy[k2] === _vy) {
            row.push(k2);
            break;
          }
        }
      }
    }
    for (let i2 = 0; i2 < 16; i2++) {
      const mat = new Matrix();
      mat.set(ux[i2], uy[i2], vx[i2], vy[i2], 0, 0);
      rotationMatrices.push(mat);
    }
  }
  init();
  const groupD8 = {

    E: 0,

    SE: 1,

    S: 2,

    SW: 3,

    W: 4,

    NW: 5,

    N: 6,

    NE: 7,

    MIRROR_VERTICAL: 8,

    MAIN_DIAGONAL: 10,

    MIRROR_HORIZONTAL: 12,

    REVERSE_DIAGONAL: 14,

    uX: (ind) => ux[ind],

    uY: (ind) => uy[ind],

    vX: (ind) => vx[ind],

    vY: (ind) => vy[ind],

    inv: (rotation) => {
      if (rotation & 8) {
        return rotation & 15;
      }
      return -rotation & 7;
    },

    add: (rotationSecond, rotationFirst) => rotationCayley[rotationSecond][rotationFirst],

    sub: (rotationSecond, rotationFirst) => rotationCayley[rotationSecond][groupD8.inv(rotationFirst)],

    rotate180: (rotation) => rotation ^ 4,

    isVertical: (rotation) => (rotation & 3) === 2,

    byDirection: (dx, dy) => {
      if (Math.abs(dx) * 2 <= Math.abs(dy)) {
        if (dy >= 0) {
          return groupD8.S;
        }
        return groupD8.N;
      } else if (Math.abs(dy) * 2 <= Math.abs(dx)) {
        if (dx > 0) {
          return groupD8.E;
        }
        return groupD8.W;
      } else if (dy > 0) {
        if (dx > 0) {
          return groupD8.SE;
        }
        return groupD8.SW;
      } else if (dx > 0) {
        return groupD8.NE;
      }
      return groupD8.NW;
    },

    matrixAppendRotationInv: (matrix, rotation, tx = 0, ty = 0, dw = 0, dh = 0) => {
      const mat = rotationMatrices[groupD8.inv(rotation)];
      const a2 = mat.a;
      const b2 = mat.b;
      const c2 = mat.c;
      const d2 = mat.d;
      const finalTx = tx - Math.min(0, a2 * dw, c2 * dh, a2 * dw + c2 * dh);
      const finalTy = ty - Math.min(0, b2 * dw, d2 * dh, b2 * dw + d2 * dh);
      const a1 = matrix.a;
      const b1 = matrix.b;
      const c1 = matrix.c;
      const d1 = matrix.d;
      matrix.a = a2 * a1 + b2 * c1;
      matrix.b = a2 * b1 + b2 * d1;
      matrix.c = c2 * a1 + d2 * c1;
      matrix.d = c2 * b1 + d2 * d1;
      matrix.tx = finalTx * a1 + finalTy * c1 + matrix.tx;
      matrix.ty = finalTx * b1 + finalTy * d1 + matrix.ty;
    },

    transformRectCoords: (rect, sourceFrame, rotation, out2) => {
      const { x: x2, y: y2, width, height } = rect;
      const { x: frameX, y: frameY, width: frameWidth, height: frameHeight } = sourceFrame;
      if (rotation === groupD8.E) {
        out2.set(x2 + frameX, y2 + frameY, width, height);
        return out2;
      } else if (rotation === groupD8.S) {
        return out2.set(
          frameWidth - y2 - height + frameX,
          x2 + frameY,
          height,
          width
        );
      } else if (rotation === groupD8.W) {
        return out2.set(
          frameWidth - x2 - width + frameX,
          frameHeight - y2 - height + frameY,
          width,
          height
        );
      } else if (rotation === groupD8.N) {
        return out2.set(
          y2 + frameX,
          frameHeight - x2 - width + frameY,
          height,
          width
        );
      }
      return out2.set(x2 + frameX, y2 + frameY, width, height);
    }
  };
  const tempPoints = [new Point(), new Point(), new Point(), new Point()];
  class Rectangle {

    constructor(x2 = 0, y2 = 0, width = 0, height = 0) {
      this.type = "rectangle";
      this.x = Number(x2);
      this.y = Number(y2);
      this.width = Number(width);
      this.height = Number(height);
    }

    get left() {
      return this.x;
    }

    get right() {
      return this.x + this.width;
    }

    get top() {
      return this.y;
    }

    get bottom() {
      return this.y + this.height;
    }

    isEmpty() {
      return this.left === this.right || this.top === this.bottom;
    }

    static get EMPTY() {
      return new Rectangle(0, 0, 0, 0);
    }

    clone() {
      return new Rectangle(this.x, this.y, this.width, this.height);
    }

    copyFromBounds(bounds) {
      this.x = bounds.minX;
      this.y = bounds.minY;
      this.width = bounds.maxX - bounds.minX;
      this.height = bounds.maxY - bounds.minY;
      return this;
    }

    copyFrom(rectangle) {
      this.x = rectangle.x;
      this.y = rectangle.y;
      this.width = rectangle.width;
      this.height = rectangle.height;
      return this;
    }

    copyTo(rectangle) {
      rectangle.copyFrom(this);
      return rectangle;
    }

    contains(x2, y2) {
      if (this.width <= 0 || this.height <= 0) {
        return false;
      }
      if (x2 >= this.x && x2 < this.x + this.width) {
        if (y2 >= this.y && y2 < this.y + this.height) {
          return true;
        }
      }
      return false;
    }

    strokeContains(x2, y2, strokeWidth, alignment = 0.5) {
      const { width, height } = this;
      if (width <= 0 || height <= 0) return false;
      const _x = this.x;
      const _y = this.y;
      const strokeWidthOuter = strokeWidth * (1 - alignment);
      const strokeWidthInner = strokeWidth - strokeWidthOuter;
      const outerLeft = _x - strokeWidthOuter;
      const outerRight = _x + width + strokeWidthOuter;
      const outerTop = _y - strokeWidthOuter;
      const outerBottom = _y + height + strokeWidthOuter;
      const innerLeft = _x + strokeWidthInner;
      const innerRight = _x + width - strokeWidthInner;
      const innerTop = _y + strokeWidthInner;
      const innerBottom = _y + height - strokeWidthInner;
      return x2 >= outerLeft && x2 <= outerRight && y2 >= outerTop && y2 <= outerBottom && !(x2 > innerLeft && x2 < innerRight && y2 > innerTop && y2 < innerBottom);
    }

    intersects(other, transform) {
      if (!transform) {
        const x02 = this.x < other.x ? other.x : this.x;
        const x12 = this.right > other.right ? other.right : this.right;
        if (x12 <= x02) {
          return false;
        }
        const y02 = this.y < other.y ? other.y : this.y;
        const y12 = this.bottom > other.bottom ? other.bottom : this.bottom;
        return y12 > y02;
      }
      const x0 = this.left;
      const x1 = this.right;
      const y0 = this.top;
      const y1 = this.bottom;
      if (x1 <= x0 || y1 <= y0) {
        return false;
      }
      const lt = tempPoints[0].set(other.left, other.top);
      const lb = tempPoints[1].set(other.left, other.bottom);
      const rt = tempPoints[2].set(other.right, other.top);
      const rb = tempPoints[3].set(other.right, other.bottom);
      if (rt.x <= lt.x || lb.y <= lt.y) {
        return false;
      }
      const s2 = Math.sign(transform.a * transform.d - transform.b * transform.c);
      if (s2 === 0) {
        return false;
      }
      transform.apply(lt, lt);
      transform.apply(lb, lb);
      transform.apply(rt, rt);
      transform.apply(rb, rb);
      if (Math.max(lt.x, lb.x, rt.x, rb.x) <= x0 || Math.min(lt.x, lb.x, rt.x, rb.x) >= x1 || Math.max(lt.y, lb.y, rt.y, rb.y) <= y0 || Math.min(lt.y, lb.y, rt.y, rb.y) >= y1) {
        return false;
      }
      const nx = s2 * (lb.y - lt.y);
      const ny = s2 * (lt.x - lb.x);
      const n00 = nx * x0 + ny * y0;
      const n10 = nx * x1 + ny * y0;
      const n01 = nx * x0 + ny * y1;
      const n11 = nx * x1 + ny * y1;
      if (Math.max(n00, n10, n01, n11) <= nx * lt.x + ny * lt.y || Math.min(n00, n10, n01, n11) >= nx * rb.x + ny * rb.y) {
        return false;
      }
      const mx = s2 * (lt.y - rt.y);
      const my = s2 * (rt.x - lt.x);
      const m00 = mx * x0 + my * y0;
      const m10 = mx * x1 + my * y0;
      const m01 = mx * x0 + my * y1;
      const m11 = mx * x1 + my * y1;
      if (Math.max(m00, m10, m01, m11) <= mx * lt.x + my * lt.y || Math.min(m00, m10, m01, m11) >= mx * rb.x + my * rb.y) {
        return false;
      }
      return true;
    }

    pad(paddingX = 0, paddingY = paddingX) {
      this.x -= paddingX;
      this.y -= paddingY;
      this.width += paddingX * 2;
      this.height += paddingY * 2;
      return this;
    }

    fit(rectangle) {
      const x1 = Math.max(this.x, rectangle.x);
      const x2 = Math.min(this.x + this.width, rectangle.x + rectangle.width);
      const y1 = Math.max(this.y, rectangle.y);
      const y2 = Math.min(this.y + this.height, rectangle.y + rectangle.height);
      this.x = x1;
      this.width = Math.max(x2 - x1, 0);
      this.y = y1;
      this.height = Math.max(y2 - y1, 0);
      return this;
    }

    ceil(resolution = 1, eps = 1e-3) {
      const x2 = Math.ceil((this.x + this.width - eps) * resolution) / resolution;
      const y2 = Math.ceil((this.y + this.height - eps) * resolution) / resolution;
      this.x = Math.floor((this.x + eps) * resolution) / resolution;
      this.y = Math.floor((this.y + eps) * resolution) / resolution;
      this.width = x2 - this.x;
      this.height = y2 - this.y;
      return this;
    }

    scale(x2, y2 = x2) {
      this.x *= x2;
      this.y *= y2;
      this.width *= x2;
      this.height *= y2;
      return this;
    }

    enlarge(rectangle) {
      const x1 = Math.min(this.x, rectangle.x);
      const x2 = Math.max(this.x + this.width, rectangle.x + rectangle.width);
      const y1 = Math.min(this.y, rectangle.y);
      const y2 = Math.max(this.y + this.height, rectangle.y + rectangle.height);
      this.x = x1;
      this.width = x2 - x1;
      this.y = y1;
      this.height = y2 - y1;
      return this;
    }

    getBounds(out2) {
      out2 || (out2 = new Rectangle());
      out2.copyFrom(this);
      return out2;
    }

    containsRect(other) {
      if (this.width <= 0 || this.height <= 0) return false;
      const x1 = other.x;
      const y1 = other.y;
      const x2 = other.x + other.width;
      const y2 = other.y + other.height;
      return x1 >= this.x && x1 < this.x + this.width && y1 >= this.y && y1 < this.y + this.height && x2 >= this.x && x2 < this.x + this.width && y2 >= this.y && y2 < this.y + this.height;
    }

    set(x2, y2, width, height) {
      this.x = x2;
      this.y = y2;
      this.width = width;
      this.height = height;
      return this;
    }
    toString() {
      return `[pixi.js/math:Rectangle x=${this.x} y=${this.y} width=${this.width} height=${this.height}]`;
    }
  }
  const uidCache = {
    default: -1
  };
  function uid$1(name = "default") {
    if (uidCache[name] === void 0) {
      uidCache[name] = -1;
    }
    return ++uidCache[name];
  }
  const warnings =                 new Set();
  const v8_0_0 = "8.0.0";
  const v8_3_4 = "8.3.4";
  const deprecationState = {
    quiet: false,
    noColor: false
  };
  const deprecation = (version, message, ignoreDepth = 3) => {
    if (deprecationState.quiet || warnings.has(message)) return;
    let stack = new Error().stack;
    const deprecationMessage = `${message}
Deprecated since v${version}`;
    const useGroup = typeof console.groupCollapsed === "function" && !deprecationState.noColor;
    if (typeof stack === "undefined") {
      console.warn("PixiJS Deprecation Warning: ", deprecationMessage);
    } else {
      stack = stack.split("\n").splice(ignoreDepth).join("\n");
      if (useGroup) {
        console.groupCollapsed(
          "%cPixiJS Deprecation Warning: %c%s",
          "color:#614108;background:#fffbe6",
          "font-weight:normal;color:#614108;background:#fffbe6",
          deprecationMessage
        );
        console.warn(stack);
        console.groupEnd();
      } else {
        console.warn("PixiJS Deprecation Warning: ", deprecationMessage);
        console.warn(stack);
      }
    }
    warnings.add(message);
  };
  Object.defineProperties(deprecation, {
    quiet: {
      get: () => deprecationState.quiet,
      set: (value) => {
        deprecationState.quiet = value;
      },
      enumerable: true,
      configurable: false
    },
    noColor: {
      get: () => deprecationState.noColor,
      set: (value) => {
        deprecationState.noColor = value;
      },
      enumerable: true,
      configurable: false
    }
  });
  const NOOP = () => {
  };
  function nextPow2(v2) {
    v2 += v2 === 0 ? 1 : 0;
    --v2;
    v2 |= v2 >>> 1;
    v2 |= v2 >>> 2;
    v2 |= v2 >>> 4;
    v2 |= v2 >>> 8;
    v2 |= v2 >>> 16;
    return v2 + 1;
  }
  function isPow2(v2) {
    return !(v2 & v2 - 1) && !!v2;
  }
  function definedProps(obj) {
    const result = {};
    for (const key in obj) {
      if (obj[key] !== void 0) {
        result[key] = obj[key];
      }
    }
    return result;
  }
  const idHash$1 =                 Object.create(null);
  function createResourceIdFromString(value) {
    const id = idHash$1[value];
    if (id === void 0) {
      idHash$1[value] = uid$1("resource");
    }
    return id;
  }
  const _TextureStyle = class _TextureStyle2 extends EventEmitter {

    constructor(options = {}) {
      super();
      this._resourceType = "textureSampler";
      this._touched = 0;
      this._maxAnisotropy = 1;
      this.destroyed = false;
      options = { ..._TextureStyle2.defaultOptions, ...options };
      this.addressMode = options.addressMode;
      this.addressModeU = options.addressModeU ?? this.addressModeU;
      this.addressModeV = options.addressModeV ?? this.addressModeV;
      this.addressModeW = options.addressModeW ?? this.addressModeW;
      this.scaleMode = options.scaleMode;
      this.magFilter = options.magFilter ?? this.magFilter;
      this.minFilter = options.minFilter ?? this.minFilter;
      this.mipmapFilter = options.mipmapFilter ?? this.mipmapFilter;
      this.lodMinClamp = options.lodMinClamp;
      this.lodMaxClamp = options.lodMaxClamp;
      this.compare = options.compare;
      this.maxAnisotropy = options.maxAnisotropy ?? 1;
    }
    set addressMode(value) {
      this.addressModeU = value;
      this.addressModeV = value;
      this.addressModeW = value;
    }

    get addressMode() {
      return this.addressModeU;
    }
    set wrapMode(value) {
      deprecation(v8_0_0, "TextureStyle.wrapMode is now TextureStyle.addressMode");
      this.addressMode = value;
    }
    get wrapMode() {
      return this.addressMode;
    }
    set scaleMode(value) {
      this.magFilter = value;
      this.minFilter = value;
      this.mipmapFilter = value;
    }

    get scaleMode() {
      return this.magFilter;
    }

    set maxAnisotropy(value) {
      this._maxAnisotropy = Math.min(value, 16);
      if (this._maxAnisotropy > 1) {
        this.scaleMode = "linear";
      }
    }
    get maxAnisotropy() {
      return this._maxAnisotropy;
    }

    get _resourceId() {
      return this._sharedResourceId || this._generateResourceId();
    }
    update() {
      this._sharedResourceId = null;
      this.emit("change", this);
    }
    _generateResourceId() {
      const bigKey = `${this.addressModeU}-${this.addressModeV}-${this.addressModeW}-${this.magFilter}-${this.minFilter}-${this.mipmapFilter}-${this.lodMinClamp}-${this.lodMaxClamp}-${this.compare}-${this._maxAnisotropy}`;
      this._sharedResourceId = createResourceIdFromString(bigKey);
      return this._resourceId;
    }

    destroy() {
      this.destroyed = true;
      this.emit("destroy", this);
      this.emit("change", this);
      this.removeAllListeners();
    }
  };
  _TextureStyle.defaultOptions = {
    addressMode: "clamp-to-edge",
    scaleMode: "linear"
  };
  let TextureStyle = _TextureStyle;
  const _TextureSource = class _TextureSource2 extends EventEmitter {

    constructor(options = {}) {
      super();
      this.options = options;
      this._gpuData =                 Object.create(null);
      this._gcLastUsed = -1;
      this.uid = uid$1("textureSource");
      this._resourceType = "textureSource";
      this._resourceId = uid$1("resource");
      this.uploadMethodId = "unknown";
      this._resolution = 1;
      this.pixelWidth = 1;
      this.pixelHeight = 1;
      this.width = 1;
      this.height = 1;
      this.sampleCount = 1;
      this.mipLevelCount = 1;
      this.autoGenerateMipmaps = false;
      this.format = "rgba8unorm";
      this.dimension = "2d";
      this.viewDimension = "2d";
      this.arrayLayerCount = 1;
      this.antialias = false;
      this._touched = 0;
      this._batchTick = -1;
      this._textureBindLocation = -1;
      options = { ..._TextureSource2.defaultOptions, ...options };
      this.label = options.label ?? "";
      this.resource = options.resource;
      this.autoGarbageCollect = options.autoGarbageCollect;
      this._resolution = options.resolution;
      if (options.width) {
        this.pixelWidth = options.width * this._resolution;
      } else {
        this.pixelWidth = this.resource ? this.resourceWidth ?? 1 : 1;
      }
      if (options.height) {
        this.pixelHeight = options.height * this._resolution;
      } else {
        this.pixelHeight = this.resource ? this.resourceHeight ?? 1 : 1;
      }
      this.width = this.pixelWidth / this._resolution;
      this.height = this.pixelHeight / this._resolution;
      this.format = options.format;
      this.dimension = options.dimensions;
      this.viewDimension = options.viewDimension ?? options.dimensions;
      this.arrayLayerCount = options.arrayLayerCount;
      this.mipLevelCount = options.mipLevelCount;
      this.autoGenerateMipmaps = options.autoGenerateMipmaps;
      this.sampleCount = options.sampleCount;
      this.antialias = options.antialias;
      this.alphaMode = options.alphaMode;
      this.style = new TextureStyle(definedProps(options));
      this.destroyed = false;
      this._refreshPOT();
    }

    get source() {
      return this;
    }

    get style() {
      return this._style;
    }
    set style(value) {
      if (this.style === value) return;
      this._style?.off("change", this._onStyleChange, this);
      this._style = value;
      this._style?.on("change", this._onStyleChange, this);
      this._onStyleChange();
    }

    set maxAnisotropy(value) {
      this._style.maxAnisotropy = value;
    }
    get maxAnisotropy() {
      return this._style.maxAnisotropy;
    }

    get addressMode() {
      return this._style.addressMode;
    }
    set addressMode(value) {
      this._style.addressMode = value;
    }

    get repeatMode() {
      return this._style.addressMode;
    }
    set repeatMode(value) {
      this._style.addressMode = value;
    }

    get magFilter() {
      return this._style.magFilter;
    }
    set magFilter(value) {
      this._style.magFilter = value;
    }

    get minFilter() {
      return this._style.minFilter;
    }
    set minFilter(value) {
      this._style.minFilter = value;
    }

    get mipmapFilter() {
      return this._style.mipmapFilter;
    }
    set mipmapFilter(value) {
      this._style.mipmapFilter = value;
    }

    get lodMinClamp() {
      return this._style.lodMinClamp;
    }
    set lodMinClamp(value) {
      this._style.lodMinClamp = value;
    }

    get lodMaxClamp() {
      return this._style.lodMaxClamp;
    }
    set lodMaxClamp(value) {
      this._style.lodMaxClamp = value;
    }
    _onStyleChange() {
      this.emit("styleChange", this);
    }

    update() {
      if (this.resource) {
        const resolution = this._resolution;
        const didResize = this.resize(this.resourceWidth / resolution, this.resourceHeight / resolution);
        if (didResize) return;
      }
      this.emit("update", this);
    }

    destroy() {
      this.destroyed = true;
      this.unload();
      this.emit("destroy", this);
      if (this._style) {
        this._style.destroy();
        this._style = null;
      }
      this.uploadMethodId = null;
      this.resource = null;
      this.removeAllListeners();
    }

    unload() {
      this._resourceId = uid$1("resource");
      this.emit("change", this);
      this.emit("unload", this);
      for (const key in this._gpuData) {
        this._gpuData[key]?.destroy?.();
      }
      this._gpuData =                 Object.create(null);
    }

    get resourceWidth() {
      const { resource } = this;
      return resource.naturalWidth || resource.videoWidth || resource.displayWidth || resource.width;
    }

    get resourceHeight() {
      const { resource } = this;
      return resource.naturalHeight || resource.videoHeight || resource.displayHeight || resource.height;
    }

    get resolution() {
      return this._resolution;
    }
    set resolution(resolution) {
      if (this._resolution === resolution) return;
      this._resolution = resolution;
      this.width = this.pixelWidth / resolution;
      this.height = this.pixelHeight / resolution;
    }

    resize(width, height, resolution) {
      resolution || (resolution = this._resolution);
      width || (width = this.width);
      height || (height = this.height);
      const newPixelWidth = Math.round(width * resolution);
      const newPixelHeight = Math.round(height * resolution);
      this.width = newPixelWidth / resolution;
      this.height = newPixelHeight / resolution;
      this._resolution = resolution;
      if (this.pixelWidth === newPixelWidth && this.pixelHeight === newPixelHeight) {
        return false;
      }
      this._refreshPOT();
      this.pixelWidth = newPixelWidth;
      this.pixelHeight = newPixelHeight;
      this.emit("resize", this);
      this._resourceId = uid$1("resource");
      this.emit("change", this);
      return true;
    }

    updateMipmaps() {
      if (this.autoGenerateMipmaps && this.mipLevelCount > 1) {
        this.emit("updateMipmaps", this);
      }
    }
    set wrapMode(value) {
      this._style.wrapMode = value;
    }
    get wrapMode() {
      return this._style.wrapMode;
    }
    set scaleMode(value) {
      this._style.scaleMode = value;
    }

    get scaleMode() {
      return this._style.scaleMode;
    }

    _refreshPOT() {
      this.isPowerOfTwo = isPow2(this.pixelWidth) && isPow2(this.pixelHeight);
    }
    static test(_resource) {
      throw new Error("Unimplemented");
    }
  };
  _TextureSource.defaultOptions = {
    resolution: 1,
    format: "bgra8unorm",
    alphaMode: "premultiply-alpha-on-upload",
    dimensions: "2d",
    viewDimension: "2d",
    arrayLayerCount: 1,
    mipLevelCount: 1,
    autoGenerateMipmaps: false,
    sampleCount: 1,
    antialias: false,
    autoGarbageCollect: false
  };
  let TextureSource = _TextureSource;
  class BufferImageSource extends TextureSource {
    constructor(options) {
      const buffer = options.resource || new Float32Array(options.width * options.height * 4);
      let format = options.format;
      if (!format) {
        if (buffer instanceof Float32Array) {
          format = "rgba32float";
        } else if (buffer instanceof Int32Array) {
          format = "rgba32uint";
        } else if (buffer instanceof Uint32Array) {
          format = "rgba32uint";
        } else if (buffer instanceof Int16Array) {
          format = "rgba16uint";
        } else if (buffer instanceof Uint16Array) {
          format = "rgba16uint";
        } else if (buffer instanceof Int8Array) {
          format = "bgra8unorm";
        } else {
          format = "bgra8unorm";
        }
      }
      super({
        ...options,
        resource: buffer,
        format
      });
      this.uploadMethodId = "buffer";
    }
    static test(resource) {
      return resource instanceof Int8Array || resource instanceof Uint8Array || resource instanceof Uint8ClampedArray || resource instanceof Int16Array || resource instanceof Uint16Array || resource instanceof Int32Array || resource instanceof Uint32Array || resource instanceof Float32Array;
    }
  }
  BufferImageSource.extension = ExtensionType.TextureSource;
  const tempMat = new Matrix();
  class TextureMatrix {

    constructor(texture, clampMargin) {
      this.mapCoord = new Matrix();
      this.uClampFrame = new Float32Array(4);
      this.uClampOffset = new Float32Array(2);
      this._updateID = 0;
      this.clampOffset = 0;
      if (typeof clampMargin === "undefined") {
        this.clampMargin = texture.width < 10 ? 0 : 0.5;
      } else {
        this.clampMargin = clampMargin;
      }
      this.isSimple = false;
      this.texture = texture;
    }

    get texture() {
      return this._texture;
    }
    set texture(value) {
      if (this._texture !== value) {
        this._texture?.removeListener("update", this.update, this);
        this._texture = value;
        this._texture.addListener("update", this.update, this);
      }
      this.update();
    }

    multiplyUvs(uvs, out2) {
      if (out2 === void 0) {
        out2 = uvs;
      }
      const mat = this.mapCoord;
      for (let i2 = 0; i2 < uvs.length; i2 += 2) {
        const x2 = uvs[i2];
        const y2 = uvs[i2 + 1];
        out2[i2] = x2 * mat.a + y2 * mat.c + mat.tx;
        out2[i2 + 1] = x2 * mat.b + y2 * mat.d + mat.ty;
      }
      return out2;
    }

    update() {
      const tex = this._texture;
      this._updateID++;
      const uvs = tex.uvs;
      this.mapCoord.set(uvs.x1 - uvs.x0, uvs.y1 - uvs.y0, uvs.x3 - uvs.x0, uvs.y3 - uvs.y0, uvs.x0, uvs.y0);
      const orig = tex.orig;
      const trim = tex.trim;
      if (trim) {
        tempMat.set(
          orig.width / trim.width,
          0,
          0,
          orig.height / trim.height,
          -trim.x / trim.width,
          -trim.y / trim.height
        );
        this.mapCoord.append(tempMat);
      }
      const texBase = tex.source;
      const frame = this.uClampFrame;
      const margin = this.clampMargin / texBase._resolution;
      const offset2 = this.clampOffset / texBase._resolution;
      frame[0] = (tex.frame.x + margin + offset2) / texBase.width;
      frame[1] = (tex.frame.y + margin + offset2) / texBase.height;
      frame[2] = (tex.frame.x + tex.frame.width - margin + offset2) / texBase.width;
      frame[3] = (tex.frame.y + tex.frame.height - margin + offset2) / texBase.height;
      this.uClampOffset[0] = this.clampOffset / texBase.pixelWidth;
      this.uClampOffset[1] = this.clampOffset / texBase.pixelHeight;
      this.isSimple = tex.frame.width === texBase.width && tex.frame.height === texBase.height && tex.rotate === 0;
      return true;
    }
  }
  class Texture extends EventEmitter {

    constructor({
      source: source2,
      label,
      frame,
      orig,
      trim,
      defaultAnchor,
      defaultBorders,
      rotate,
      dynamic
    } = {}) {
      super();
      this.uid = uid$1("texture");
      this.uvs = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0 };
      this.frame = new Rectangle();
      this.noFrame = false;
      this.dynamic = false;
      this.isTexture = true;
      this.label = label;
      this.source = source2?.source ?? new TextureSource();
      this.noFrame = !frame;
      if (frame) {
        this.frame.copyFrom(frame);
      } else {
        const { width, height } = this._source;
        this.frame.width = width;
        this.frame.height = height;
      }
      this.orig = orig || this.frame;
      this.trim = trim;
      this.rotate = rotate ?? 0;
      this.defaultAnchor = defaultAnchor;
      this.defaultBorders = defaultBorders;
      this.destroyed = false;
      this.dynamic = dynamic || false;
      this.updateUvs();
    }
    set source(value) {
      if (this._source) {
        this._source.off("resize", this.update, this);
      }
      this._source = value;
      value.on("resize", this.update, this);
      this.emit("update", this);
    }

    get source() {
      return this._source;
    }

    get textureMatrix() {
      if (!this._textureMatrix) {
        this._textureMatrix = new TextureMatrix(this);
      }
      return this._textureMatrix;
    }

    get width() {
      return this.orig.width;
    }

    get height() {
      return this.orig.height;
    }

    updateUvs() {
      const { uvs, frame } = this;
      const { width, height } = this._source;
      const nX = frame.x / width;
      const nY = frame.y / height;
      const nW = frame.width / width;
      const nH = frame.height / height;
      let rotate = this.rotate;
      if (rotate) {
        const w2 = nW / 2;
        const h2 = nH / 2;
        const cX = nX + w2;
        const cY = nY + h2;
        rotate = groupD8.add(rotate, groupD8.NW);
        uvs.x0 = cX + w2 * groupD8.uX(rotate);
        uvs.y0 = cY + h2 * groupD8.uY(rotate);
        rotate = groupD8.add(rotate, 2);
        uvs.x1 = cX + w2 * groupD8.uX(rotate);
        uvs.y1 = cY + h2 * groupD8.uY(rotate);
        rotate = groupD8.add(rotate, 2);
        uvs.x2 = cX + w2 * groupD8.uX(rotate);
        uvs.y2 = cY + h2 * groupD8.uY(rotate);
        rotate = groupD8.add(rotate, 2);
        uvs.x3 = cX + w2 * groupD8.uX(rotate);
        uvs.y3 = cY + h2 * groupD8.uY(rotate);
      } else {
        uvs.x0 = nX;
        uvs.y0 = nY;
        uvs.x1 = nX + nW;
        uvs.y1 = nY;
        uvs.x2 = nX + nW;
        uvs.y2 = nY + nH;
        uvs.x3 = nX;
        uvs.y3 = nY + nH;
      }
    }

    destroy(destroySource = false) {
      if (this._source) {
        this._source.off("resize", this.update, this);
        if (destroySource) {
          this._source.destroy();
          this._source = null;
        }
      }
      this._textureMatrix = null;
      this.destroyed = true;
      this.emit("destroy", this);
      this.removeAllListeners();
    }

    update() {
      if (this.noFrame) {
        this.frame.width = this._source.width;
        this.frame.height = this._source.height;
      }
      this.updateUvs();
      this.emit("update", this);
    }

    get baseTexture() {
      deprecation(v8_0_0, "Texture.baseTexture is now Texture.source");
      return this._source;
    }
  }
  Texture.EMPTY = new Texture({
    label: "EMPTY",
    source: new TextureSource({
      label: "EMPTY"
    })
  });
  Texture.EMPTY.destroy = NOOP;
  Texture.WHITE = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([255, 255, 255, 255]),
      width: 1,
      height: 1,
      alphaMode: "premultiply-alpha-on-upload",
      label: "WHITE"
    }),
    label: "WHITE"
  });
  Texture.WHITE.destroy = NOOP;
  function updateQuadBounds(bounds, anchor, texture) {
    const { width, height } = texture.orig;
    const trim = texture.trim;
    if (trim) {
      const sourceWidth = trim.width;
      const sourceHeight = trim.height;
      bounds.minX = trim.x - anchor._x * width;
      bounds.maxX = bounds.minX + sourceWidth;
      bounds.minY = trim.y - anchor._y * height;
      bounds.maxY = bounds.minY + sourceHeight;
    } else {
      bounds.minX = -anchor._x * width;
      bounds.maxX = bounds.minX + width;
      bounds.minY = -anchor._y * height;
      bounds.maxY = bounds.minY + height;
    }
  }
  const defaultMatrix = new Matrix();
  class Bounds {

    constructor(minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity) {
      this.minX = Infinity;
      this.minY = Infinity;
      this.maxX = -Infinity;
      this.maxY = -Infinity;
      this.matrix = defaultMatrix;
      this.minX = minX;
      this.minY = minY;
      this.maxX = maxX;
      this.maxY = maxY;
    }

    isEmpty() {
      return this.minX > this.maxX || this.minY > this.maxY;
    }

    get rectangle() {
      if (!this._rectangle) {
        this._rectangle = new Rectangle();
      }
      const rectangle = this._rectangle;
      if (this.minX > this.maxX || this.minY > this.maxY) {
        rectangle.x = 0;
        rectangle.y = 0;
        rectangle.width = 0;
        rectangle.height = 0;
      } else {
        rectangle.copyFromBounds(this);
      }
      return rectangle;
    }

    clear() {
      this.minX = Infinity;
      this.minY = Infinity;
      this.maxX = -Infinity;
      this.maxY = -Infinity;
      this.matrix = defaultMatrix;
      return this;
    }

    set(x0, y0, x1, y1) {
      this.minX = x0;
      this.minY = y0;
      this.maxX = x1;
      this.maxY = y1;
    }

    addFrame(x0, y0, x1, y1, matrix) {
      matrix || (matrix = this.matrix);
      const a2 = matrix.a;
      const b2 = matrix.b;
      const c2 = matrix.c;
      const d2 = matrix.d;
      const tx = matrix.tx;
      const ty = matrix.ty;
      let minX = this.minX;
      let minY = this.minY;
      let maxX = this.maxX;
      let maxY = this.maxY;
      let x2 = a2 * x0 + c2 * y0 + tx;
      let y2 = b2 * x0 + d2 * y0 + ty;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      x2 = a2 * x1 + c2 * y0 + tx;
      y2 = b2 * x1 + d2 * y0 + ty;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      x2 = a2 * x0 + c2 * y1 + tx;
      y2 = b2 * x0 + d2 * y1 + ty;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      x2 = a2 * x1 + c2 * y1 + tx;
      y2 = b2 * x1 + d2 * y1 + ty;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      this.minX = minX;
      this.minY = minY;
      this.maxX = maxX;
      this.maxY = maxY;
    }

    addRect(rect, matrix) {
      this.addFrame(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, matrix);
    }

    addBounds(bounds, matrix) {
      this.addFrame(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, matrix);
    }

    addBoundsMask(mask) {
      this.minX = this.minX > mask.minX ? this.minX : mask.minX;
      this.minY = this.minY > mask.minY ? this.minY : mask.minY;
      this.maxX = this.maxX < mask.maxX ? this.maxX : mask.maxX;
      this.maxY = this.maxY < mask.maxY ? this.maxY : mask.maxY;
    }

    applyMatrix(matrix) {
      const minX = this.minX;
      const minY = this.minY;
      const maxX = this.maxX;
      const maxY = this.maxY;
      const { a: a2, b: b2, c: c2, d: d2, tx, ty } = matrix;
      let x2 = a2 * minX + c2 * minY + tx;
      let y2 = b2 * minX + d2 * minY + ty;
      this.minX = x2;
      this.minY = y2;
      this.maxX = x2;
      this.maxY = y2;
      x2 = a2 * maxX + c2 * minY + tx;
      y2 = b2 * maxX + d2 * minY + ty;
      this.minX = x2 < this.minX ? x2 : this.minX;
      this.minY = y2 < this.minY ? y2 : this.minY;
      this.maxX = x2 > this.maxX ? x2 : this.maxX;
      this.maxY = y2 > this.maxY ? y2 : this.maxY;
      x2 = a2 * minX + c2 * maxY + tx;
      y2 = b2 * minX + d2 * maxY + ty;
      this.minX = x2 < this.minX ? x2 : this.minX;
      this.minY = y2 < this.minY ? y2 : this.minY;
      this.maxX = x2 > this.maxX ? x2 : this.maxX;
      this.maxY = y2 > this.maxY ? y2 : this.maxY;
      x2 = a2 * maxX + c2 * maxY + tx;
      y2 = b2 * maxX + d2 * maxY + ty;
      this.minX = x2 < this.minX ? x2 : this.minX;
      this.minY = y2 < this.minY ? y2 : this.minY;
      this.maxX = x2 > this.maxX ? x2 : this.maxX;
      this.maxY = y2 > this.maxY ? y2 : this.maxY;
    }

    fit(rect) {
      if (this.minX < rect.left) this.minX = rect.left;
      if (this.maxX > rect.right) this.maxX = rect.right;
      if (this.minY < rect.top) this.minY = rect.top;
      if (this.maxY > rect.bottom) this.maxY = rect.bottom;
      return this;
    }

    fitBounds(left, right, top, bottom) {
      if (this.minX < left) this.minX = left;
      if (this.maxX > right) this.maxX = right;
      if (this.minY < top) this.minY = top;
      if (this.maxY > bottom) this.maxY = bottom;
      return this;
    }

    pad(paddingX, paddingY = paddingX) {
      this.minX -= paddingX;
      this.maxX += paddingX;
      this.minY -= paddingY;
      this.maxY += paddingY;
      return this;
    }

    ceil() {
      this.minX = Math.floor(this.minX);
      this.minY = Math.floor(this.minY);
      this.maxX = Math.ceil(this.maxX);
      this.maxY = Math.ceil(this.maxY);
      return this;
    }

    clone() {
      return new Bounds(this.minX, this.minY, this.maxX, this.maxY);
    }

    scale(x2, y2 = x2) {
      this.minX *= x2;
      this.minY *= y2;
      this.maxX *= x2;
      this.maxY *= y2;
      return this;
    }

    get x() {
      return this.minX;
    }
    set x(value) {
      const width = this.maxX - this.minX;
      this.minX = value;
      this.maxX = value + width;
    }

    get y() {
      return this.minY;
    }
    set y(value) {
      const height = this.maxY - this.minY;
      this.minY = value;
      this.maxY = value + height;
    }

    get width() {
      return this.maxX - this.minX;
    }
    set width(value) {
      this.maxX = this.minX + value;
    }

    get height() {
      return this.maxY - this.minY;
    }
    set height(value) {
      this.maxY = this.minY + value;
    }

    get left() {
      return this.minX;
    }

    get right() {
      return this.maxX;
    }

    get top() {
      return this.minY;
    }

    get bottom() {
      return this.maxY;
    }

    get isPositive() {
      return this.maxX - this.minX > 0 && this.maxY - this.minY > 0;
    }

    get isValid() {
      return this.minX + this.minY !== Infinity;
    }

    addVertexData(vertexData, beginOffset, endOffset, matrix) {
      let minX = this.minX;
      let minY = this.minY;
      let maxX = this.maxX;
      let maxY = this.maxY;
      matrix || (matrix = this.matrix);
      const a2 = matrix.a;
      const b2 = matrix.b;
      const c2 = matrix.c;
      const d2 = matrix.d;
      const tx = matrix.tx;
      const ty = matrix.ty;
      for (let i2 = beginOffset; i2 < endOffset; i2 += 2) {
        const localX = vertexData[i2];
        const localY = vertexData[i2 + 1];
        const x2 = a2 * localX + c2 * localY + tx;
        const y2 = b2 * localX + d2 * localY + ty;
        minX = x2 < minX ? x2 : minX;
        minY = y2 < minY ? y2 : minY;
        maxX = x2 > maxX ? x2 : maxX;
        maxY = y2 > maxY ? y2 : maxY;
      }
      this.minX = minX;
      this.minY = minY;
      this.maxX = maxX;
      this.maxY = maxY;
    }

    containsPoint(x2, y2) {
      if (this.minX <= x2 && this.minY <= y2 && this.maxX >= x2 && this.maxY >= y2) {
        return true;
      }
      return false;
    }

    toString() {
      return `[pixi.js:Bounds minX=${this.minX} minY=${this.minY} maxX=${this.maxX} maxY=${this.maxY} width=${this.width} height=${this.height}]`;
    }

    copyFrom(bounds) {
      this.minX = bounds.minX;
      this.minY = bounds.minY;
      this.maxX = bounds.maxX;
      this.maxY = bounds.maxY;
      return this;
    }
  }
  var r = { grad: 0.9, turn: 360, rad: 360 / (2 * Math.PI) }, t = function(r2) {
    return "string" == typeof r2 ? r2.length > 0 : "number" == typeof r2;
  }, n = function(r2, t2, n2) {
    return void 0 === t2 && (t2 = 0), void 0 === n2 && (n2 = Math.pow(10, t2)), Math.round(n2 * r2) / n2 + 0;
  }, e = function(r2, t2, n2) {
    return void 0 === t2 && (t2 = 0), void 0 === n2 && (n2 = 1), r2 > n2 ? n2 : r2 > t2 ? r2 : t2;
  }, u = function(r2) {
    return (r2 = isFinite(r2) ? r2 % 360 : 0) > 0 ? r2 : r2 + 360;
  }, a = function(r2) {
    return { r: e(r2.r, 0, 255), g: e(r2.g, 0, 255), b: e(r2.b, 0, 255), a: e(r2.a) };
  }, o = function(r2) {
    return { r: n(r2.r), g: n(r2.g), b: n(r2.b), a: n(r2.a, 3) };
  }, i = /^#([0-9a-f]{3,8})$/i, s = function(r2) {
    var t2 = r2.toString(16);
    return t2.length < 2 ? "0" + t2 : t2;
  }, h = function(r2) {
    var t2 = r2.r, n2 = r2.g, e2 = r2.b, u2 = r2.a, a2 = Math.max(t2, n2, e2), o2 = a2 - Math.min(t2, n2, e2), i2 = o2 ? a2 === t2 ? (n2 - e2) / o2 : a2 === n2 ? 2 + (e2 - t2) / o2 : 4 + (t2 - n2) / o2 : 0;
    return { h: 60 * (i2 < 0 ? i2 + 6 : i2), s: a2 ? o2 / a2 * 100 : 0, v: a2 / 255 * 100, a: u2 };
  }, b = function(r2) {
    var t2 = r2.h, n2 = r2.s, e2 = r2.v, u2 = r2.a;
    t2 = t2 / 360 * 6, n2 /= 100, e2 /= 100;
    var a2 = Math.floor(t2), o2 = e2 * (1 - n2), i2 = e2 * (1 - (t2 - a2) * n2), s2 = e2 * (1 - (1 - t2 + a2) * n2), h2 = a2 % 6;
    return { r: 255 * [e2, i2, o2, o2, s2, e2][h2], g: 255 * [s2, e2, e2, i2, o2, o2][h2], b: 255 * [o2, o2, s2, e2, e2, i2][h2], a: u2 };
  }, g = function(r2) {
    return { h: u(r2.h), s: e(r2.s, 0, 100), l: e(r2.l, 0, 100), a: e(r2.a) };
  }, d = function(r2) {
    return { h: n(r2.h), s: n(r2.s), l: n(r2.l), a: n(r2.a, 3) };
  }, f = function(r2) {
    return b((n2 = (t2 = r2).s, { h: t2.h, s: (n2 *= ((e2 = t2.l) < 50 ? e2 : 100 - e2) / 100) > 0 ? 2 * n2 / (e2 + n2) * 100 : 0, v: e2 + n2, a: t2.a }));
    var t2, n2, e2;
  }, c = function(r2) {
    return { h: (t2 = h(r2)).h, s: (u2 = (200 - (n2 = t2.s)) * (e2 = t2.v) / 100) > 0 && u2 < 200 ? n2 * e2 / 100 / (u2 <= 100 ? u2 : 200 - u2) * 100 : 0, l: u2 / 2, a: t2.a };
    var t2, n2, e2, u2;
  }, l = /^hsla?\(\s*([+-]?\d*\.?\d+)(deg|rad|grad|turn)?\s*,\s*([+-]?\d*\.?\d+)%\s*,\s*([+-]?\d*\.?\d+)%\s*(?:,\s*([+-]?\d*\.?\d+)(%)?\s*)?\)$/i, p = /^hsla?\(\s*([+-]?\d*\.?\d+)(deg|rad|grad|turn)?\s+([+-]?\d*\.?\d+)%\s+([+-]?\d*\.?\d+)%\s*(?:\/\s*([+-]?\d*\.?\d+)(%)?\s*)?\)$/i, v = /^rgba?\(\s*([+-]?\d*\.?\d+)(%)?\s*,\s*([+-]?\d*\.?\d+)(%)?\s*,\s*([+-]?\d*\.?\d+)(%)?\s*(?:,\s*([+-]?\d*\.?\d+)(%)?\s*)?\)$/i, m = /^rgba?\(\s*([+-]?\d*\.?\d+)(%)?\s+([+-]?\d*\.?\d+)(%)?\s+([+-]?\d*\.?\d+)(%)?\s*(?:\/\s*([+-]?\d*\.?\d+)(%)?\s*)?\)$/i, y = { string: [[function(r2) {
    var t2 = i.exec(r2);
    return t2 ? (r2 = t2[1]).length <= 4 ? { r: parseInt(r2[0] + r2[0], 16), g: parseInt(r2[1] + r2[1], 16), b: parseInt(r2[2] + r2[2], 16), a: 4 === r2.length ? n(parseInt(r2[3] + r2[3], 16) / 255, 2) : 1 } : 6 === r2.length || 8 === r2.length ? { r: parseInt(r2.substr(0, 2), 16), g: parseInt(r2.substr(2, 2), 16), b: parseInt(r2.substr(4, 2), 16), a: 8 === r2.length ? n(parseInt(r2.substr(6, 2), 16) / 255, 2) : 1 } : null : null;
  }, "hex"], [function(r2) {
    var t2 = v.exec(r2) || m.exec(r2);
    return t2 ? t2[2] !== t2[4] || t2[4] !== t2[6] ? null : a({ r: Number(t2[1]) / (t2[2] ? 100 / 255 : 1), g: Number(t2[3]) / (t2[4] ? 100 / 255 : 1), b: Number(t2[5]) / (t2[6] ? 100 / 255 : 1), a: void 0 === t2[7] ? 1 : Number(t2[7]) / (t2[8] ? 100 : 1) }) : null;
  }, "rgb"], [function(t2) {
    var n2 = l.exec(t2) || p.exec(t2);
    if (!n2) return null;
    var e2, u2, a2 = g({ h: (e2 = n2[1], u2 = n2[2], void 0 === u2 && (u2 = "deg"), Number(e2) * (r[u2] || 1)), s: Number(n2[3]), l: Number(n2[4]), a: void 0 === n2[5] ? 1 : Number(n2[5]) / (n2[6] ? 100 : 1) });
    return f(a2);
  }, "hsl"]], object: [[function(r2) {
    var n2 = r2.r, e2 = r2.g, u2 = r2.b, o2 = r2.a, i2 = void 0 === o2 ? 1 : o2;
    return t(n2) && t(e2) && t(u2) ? a({ r: Number(n2), g: Number(e2), b: Number(u2), a: Number(i2) }) : null;
  }, "rgb"], [function(r2) {
    var n2 = r2.h, e2 = r2.s, u2 = r2.l, a2 = r2.a, o2 = void 0 === a2 ? 1 : a2;
    if (!t(n2) || !t(e2) || !t(u2)) return null;
    var i2 = g({ h: Number(n2), s: Number(e2), l: Number(u2), a: Number(o2) });
    return f(i2);
  }, "hsl"], [function(r2) {
    var n2 = r2.h, a2 = r2.s, o2 = r2.v, i2 = r2.a, s2 = void 0 === i2 ? 1 : i2;
    if (!t(n2) || !t(a2) || !t(o2)) return null;
    var h2 = function(r3) {
      return { h: u(r3.h), s: e(r3.s, 0, 100), v: e(r3.v, 0, 100), a: e(r3.a) };
    }({ h: Number(n2), s: Number(a2), v: Number(o2), a: Number(s2) });
    return b(h2);
  }, "hsv"]] }, N = function(r2, t2) {
    for (var n2 = 0; n2 < t2.length; n2++) {
      var e2 = t2[n2][0](r2);
      if (e2) return [e2, t2[n2][1]];
    }
    return [null, void 0];
  }, x = function(r2) {
    return "string" == typeof r2 ? N(r2.trim(), y.string) : "object" == typeof r2 && null !== r2 ? N(r2, y.object) : [null, void 0];
  }, M = function(r2, t2) {
    var n2 = c(r2);
    return { h: n2.h, s: e(n2.s + 100 * t2, 0, 100), l: n2.l, a: n2.a };
  }, H = function(r2) {
    return (299 * r2.r + 587 * r2.g + 114 * r2.b) / 1e3 / 255;
  }, $ = function(r2, t2) {
    var n2 = c(r2);
    return { h: n2.h, s: n2.s, l: e(n2.l + 100 * t2, 0, 100), a: n2.a };
  }, j = function() {
    function r2(r3) {
      this.parsed = x(r3)[0], this.rgba = this.parsed || { r: 0, g: 0, b: 0, a: 1 };
    }
    return r2.prototype.isValid = function() {
      return null !== this.parsed;
    }, r2.prototype.brightness = function() {
      return n(H(this.rgba), 2);
    }, r2.prototype.isDark = function() {
      return H(this.rgba) < 0.5;
    }, r2.prototype.isLight = function() {
      return H(this.rgba) >= 0.5;
    }, r2.prototype.toHex = function() {
      return r3 = o(this.rgba), t2 = r3.r, e2 = r3.g, u2 = r3.b, i2 = (a2 = r3.a) < 1 ? s(n(255 * a2)) : "", "#" + s(t2) + s(e2) + s(u2) + i2;
      var r3, t2, e2, u2, a2, i2;
    }, r2.prototype.toRgb = function() {
      return o(this.rgba);
    }, r2.prototype.toRgbString = function() {
      return r3 = o(this.rgba), t2 = r3.r, n2 = r3.g, e2 = r3.b, (u2 = r3.a) < 1 ? "rgba(" + t2 + ", " + n2 + ", " + e2 + ", " + u2 + ")" : "rgb(" + t2 + ", " + n2 + ", " + e2 + ")";
      var r3, t2, n2, e2, u2;
    }, r2.prototype.toHsl = function() {
      return d(c(this.rgba));
    }, r2.prototype.toHslString = function() {
      return r3 = d(c(this.rgba)), t2 = r3.h, n2 = r3.s, e2 = r3.l, (u2 = r3.a) < 1 ? "hsla(" + t2 + ", " + n2 + "%, " + e2 + "%, " + u2 + ")" : "hsl(" + t2 + ", " + n2 + "%, " + e2 + "%)";
      var r3, t2, n2, e2, u2;
    }, r2.prototype.toHsv = function() {
      return r3 = h(this.rgba), { h: n(r3.h), s: n(r3.s), v: n(r3.v), a: n(r3.a, 3) };
      var r3;
    }, r2.prototype.invert = function() {
      return w({ r: 255 - (r3 = this.rgba).r, g: 255 - r3.g, b: 255 - r3.b, a: r3.a });
      var r3;
    }, r2.prototype.saturate = function(r3) {
      return void 0 === r3 && (r3 = 0.1), w(M(this.rgba, r3));
    }, r2.prototype.desaturate = function(r3) {
      return void 0 === r3 && (r3 = 0.1), w(M(this.rgba, -r3));
    }, r2.prototype.grayscale = function() {
      return w(M(this.rgba, -1));
    }, r2.prototype.lighten = function(r3) {
      return void 0 === r3 && (r3 = 0.1), w($(this.rgba, r3));
    }, r2.prototype.darken = function(r3) {
      return void 0 === r3 && (r3 = 0.1), w($(this.rgba, -r3));
    }, r2.prototype.rotate = function(r3) {
      return void 0 === r3 && (r3 = 15), this.hue(this.hue() + r3);
    }, r2.prototype.alpha = function(r3) {
      return "number" == typeof r3 ? w({ r: (t2 = this.rgba).r, g: t2.g, b: t2.b, a: r3 }) : n(this.rgba.a, 3);
      var t2;
    }, r2.prototype.hue = function(r3) {
      var t2 = c(this.rgba);
      return "number" == typeof r3 ? w({ h: r3, s: t2.s, l: t2.l, a: t2.a }) : n(t2.h);
    }, r2.prototype.isEqual = function(r3) {
      return this.toHex() === w(r3).toHex();
    }, r2;
  }(), w = function(r2) {
    return r2 instanceof j ? r2 : new j(r2);
  }, S = [], k = function(r2) {
    r2.forEach(function(r3) {
      S.indexOf(r3) < 0 && (r3(j, y), S.push(r3));
    });
  };
  function namesPlugin(e2, f2) {
    var a2 = { white: "#ffffff", bisque: "#ffe4c4", blue: "#0000ff", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e", coral: "#ff7f50", antiquewhite: "#faebd7", aqua: "#00ffff", azure: "#f0ffff", whitesmoke: "#f5f5f5", papayawhip: "#ffefd5", plum: "#dda0dd", blanchedalmond: "#ffebcd", black: "#000000", gold: "#ffd700", goldenrod: "#daa520", gainsboro: "#dcdcdc", cornsilk: "#fff8dc", cornflowerblue: "#6495ed", burlywood: "#deb887", aquamarine: "#7fffd4", beige: "#f5f5dc", crimson: "#dc143c", cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b", darkkhaki: "#bdb76b", darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", peachpuff: "#ffdab9", darkmagenta: "#8b008b", darkred: "#8b0000", darkorchid: "#9932cc", darkorange: "#ff8c00", darkslateblue: "#483d8b", gray: "#808080", darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", deeppink: "#ff1493", deepskyblue: "#00bfff", wheat: "#f5deb3", firebrick: "#b22222", floralwhite: "#fffaf0", ghostwhite: "#f8f8ff", darkviolet: "#9400d3", magenta: "#ff00ff", green: "#008000", dodgerblue: "#1e90ff", grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", blueviolet: "#8a2be2", forestgreen: "#228b22", lawngreen: "#7cfc00", indianred: "#cd5c5c", indigo: "#4b0082", fuchsia: "#ff00ff", brown: "#a52a2a", maroon: "#800000", mediumblue: "#0000cd", lightcoral: "#f08080", darkturquoise: "#00ced1", lightcyan: "#e0ffff", ivory: "#fffff0", lightyellow: "#ffffe0", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa", linen: "#faf0e6", mediumaquamarine: "#66cdaa", lemonchiffon: "#fffacd", lime: "#00ff00", khaki: "#f0e68c", mediumseagreen: "#3cb371", limegreen: "#32cd32", mediumspringgreen: "#00fa9a", lightskyblue: "#87cefa", lightblue: "#add8e6", midnightblue: "#191970", lightpink: "#ffb6c1", mistyrose: "#ffe4e1", moccasin: "#ffe4b5", mintcream: "#f5fffa", lightslategray: "#778899", lightslategrey: "#778899", navajowhite: "#ffdead", navy: "#000080", mediumvioletred: "#c71585", powderblue: "#b0e0e6", palegoldenrod: "#eee8aa", oldlace: "#fdf5e6", paleturquoise: "#afeeee", mediumturquoise: "#48d1cc", mediumorchid: "#ba55d3", rebeccapurple: "#663399", lightsteelblue: "#b0c4de", mediumslateblue: "#7b68ee", thistle: "#d8bfd8", tan: "#d2b48c", orchid: "#da70d6", mediumpurple: "#9370db", purple: "#800080", pink: "#ffc0cb", skyblue: "#87ceeb", springgreen: "#00ff7f", palegreen: "#98fb98", red: "#ff0000", yellow: "#ffff00", slateblue: "#6a5acd", lavenderblush: "#fff0f5", peru: "#cd853f", palevioletred: "#db7093", violet: "#ee82ee", teal: "#008080", slategray: "#708090", slategrey: "#708090", aliceblue: "#f0f8ff", darkseagreen: "#8fbc8f", darkolivegreen: "#556b2f", greenyellow: "#adff2f", seagreen: "#2e8b57", seashell: "#fff5ee", tomato: "#ff6347", silver: "#c0c0c0", sienna: "#a0522d", lavender: "#e6e6fa", lightgreen: "#90ee90", orange: "#ffa500", orangered: "#ff4500", steelblue: "#4682b4", royalblue: "#4169e1", turquoise: "#40e0d0", yellowgreen: "#9acd32", salmon: "#fa8072", saddlebrown: "#8b4513", sandybrown: "#f4a460", rosybrown: "#bc8f8f", darksalmon: "#e9967a", lightgoldenrodyellow: "#fafad2", snow: "#fffafa", lightgrey: "#d3d3d3", lightgray: "#d3d3d3", dimgray: "#696969", dimgrey: "#696969", olivedrab: "#6b8e23", olive: "#808000" }, r2 = {};
    for (var d2 in a2) r2[a2[d2]] = d2;
    var l2 = {};
    e2.prototype.toName = function(f3) {
      if (!(this.rgba.a || this.rgba.r || this.rgba.g || this.rgba.b)) return "transparent";
      var d3, i2, n2 = r2[this.toHex()];
      if (n2) return n2;
      if (null == f3 ? void 0 : f3.closest) {
        var o2 = this.toRgb(), t2 = 1 / 0, b2 = "black";
        if (!l2.length) for (var c2 in a2) l2[c2] = new e2(a2[c2]).toRgb();
        for (var g2 in a2) {
          var u2 = (d3 = o2, i2 = l2[g2], Math.pow(d3.r - i2.r, 2) + Math.pow(d3.g - i2.g, 2) + Math.pow(d3.b - i2.b, 2));
          u2 < t2 && (t2 = u2, b2 = g2);
        }
        return b2;
      }
    };
    f2.string.push([function(f3) {
      var r3 = f3.toLowerCase(), d3 = "transparent" === r3 ? "#0000" : a2[r3];
      return d3 ? new e2(d3).toRgb() : null;
    }, "name"]);
  }
  k([namesPlugin]);
  const _Color = class _Color2 {

    constructor(value = 16777215) {
      this._value = null;
      this._components = new Float32Array(4);
      this._components.fill(1);
      this._int = 16777215;
      this.value = value;
    }

    get red() {
      return this._components[0];
    }

    get green() {
      return this._components[1];
    }

    get blue() {
      return this._components[2];
    }

    get alpha() {
      return this._components[3];
    }

    setValue(value) {
      this.value = value;
      return this;
    }

    set value(value) {
      if (value instanceof _Color2) {
        this._value = this._cloneSource(value._value);
        this._int = value._int;
        this._components.set(value._components);
      } else if (value === null) {
        throw new Error("Cannot set Color#value to null");
      } else if (this._value === null || !this._isSourceEqual(this._value, value)) {
        this._value = this._cloneSource(value);
        this._normalize(this._value);
      }
    }
    get value() {
      return this._value;
    }

    _cloneSource(value) {
      if (typeof value === "string" || typeof value === "number" || value instanceof Number || value === null) {
        return value;
      } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        return value.slice(0);
      } else if (typeof value === "object" && value !== null) {
        return { ...value };
      }
      return value;
    }

    _isSourceEqual(value1, value2) {
      const type1 = typeof value1;
      const type2 = typeof value2;
      if (type1 !== type2) {
        return false;
      } else if (type1 === "number" || type1 === "string" || value1 instanceof Number) {
        return value1 === value2;
      } else if (Array.isArray(value1) && Array.isArray(value2) || ArrayBuffer.isView(value1) && ArrayBuffer.isView(value2)) {
        if (value1.length !== value2.length) {
          return false;
        }
        return value1.every((v2, i2) => v2 === value2[i2]);
      } else if (value1 !== null && value2 !== null) {
        const keys1 = Object.keys(value1);
        const keys2 = Object.keys(value2);
        if (keys1.length !== keys2.length) {
          return false;
        }
        return keys1.every((key) => value1[key] === value2[key]);
      }
      return value1 === value2;
    }

    toRgba() {
      const [r2, g2, b2, a2] = this._components;
      return { r: r2, g: g2, b: b2, a: a2 };
    }

    toRgb() {
      const [r2, g2, b2] = this._components;
      return { r: r2, g: g2, b: b2 };
    }

    toRgbaString() {
      const [r2, g2, b2] = this.toUint8RgbArray();
      return `rgba(${r2},${g2},${b2},${this.alpha})`;
    }

    toUint8RgbArray(out2) {
      const [r2, g2, b2] = this._components;
      if (!this._arrayRgb) {
        this._arrayRgb = [];
      }
      out2 || (out2 = this._arrayRgb);
      out2[0] = Math.round(r2 * 255);
      out2[1] = Math.round(g2 * 255);
      out2[2] = Math.round(b2 * 255);
      return out2;
    }

    toArray(out2) {
      if (!this._arrayRgba) {
        this._arrayRgba = [];
      }
      out2 || (out2 = this._arrayRgba);
      const [r2, g2, b2, a2] = this._components;
      out2[0] = r2;
      out2[1] = g2;
      out2[2] = b2;
      out2[3] = a2;
      return out2;
    }

    toRgbArray(out2) {
      if (!this._arrayRgb) {
        this._arrayRgb = [];
      }
      out2 || (out2 = this._arrayRgb);
      const [r2, g2, b2] = this._components;
      out2[0] = r2;
      out2[1] = g2;
      out2[2] = b2;
      return out2;
    }

    toNumber() {
      return this._int;
    }

    toBgrNumber() {
      const [r2, g2, b2] = this.toUint8RgbArray();
      return (b2 << 16) + (g2 << 8) + r2;
    }

    toLittleEndianNumber() {
      const value = this._int;
      return (value >> 16) + (value & 65280) + ((value & 255) << 16);
    }

    multiply(value) {
      const [r2, g2, b2, a2] = _Color2._temp.setValue(value)._components;
      this._components[0] *= r2;
      this._components[1] *= g2;
      this._components[2] *= b2;
      this._components[3] *= a2;
      this._refreshInt();
      this._value = null;
      return this;
    }

    premultiply(alpha, applyToRGB = true) {
      if (applyToRGB) {
        this._components[0] *= alpha;
        this._components[1] *= alpha;
        this._components[2] *= alpha;
      }
      this._components[3] = alpha;
      this._refreshInt();
      this._value = null;
      return this;
    }

    toPremultiplied(alpha, applyToRGB = true) {
      if (alpha === 1) {
        return (255 << 24) + this._int;
      }
      if (alpha === 0) {
        return applyToRGB ? 0 : this._int;
      }
      let r2 = this._int >> 16 & 255;
      let g2 = this._int >> 8 & 255;
      let b2 = this._int & 255;
      if (applyToRGB) {
        r2 = r2 * alpha + 0.5 | 0;
        g2 = g2 * alpha + 0.5 | 0;
        b2 = b2 * alpha + 0.5 | 0;
      }
      return (alpha * 255 << 24) + (r2 << 16) + (g2 << 8) + b2;
    }

    toHex() {
      const hexString = this._int.toString(16);
      return `#${"000000".substring(0, 6 - hexString.length) + hexString}`;
    }

    toHexa() {
      const alphaValue = Math.round(this._components[3] * 255);
      const alphaString = alphaValue.toString(16);
      return this.toHex() + "00".substring(0, 2 - alphaString.length) + alphaString;
    }

    setAlpha(alpha) {
      this._components[3] = this._clamp(alpha);
      this._value = null;
      return this;
    }

    _normalize(value) {
      let r2;
      let g2;
      let b2;
      let a2;
      if ((typeof value === "number" || value instanceof Number) && value >= 0 && value <= 16777215) {
        const int = value;
        r2 = (int >> 16 & 255) / 255;
        g2 = (int >> 8 & 255) / 255;
        b2 = (int & 255) / 255;
        a2 = 1;
      } else if ((Array.isArray(value) || value instanceof Float32Array) && value.length >= 3 && value.length <= 4) {
        value = this._clamp(value);
        [r2, g2, b2, a2 = 1] = value;
      } else if ((value instanceof Uint8Array || value instanceof Uint8ClampedArray) && value.length >= 3 && value.length <= 4) {
        value = this._clamp(value, 0, 255);
        [r2, g2, b2, a2 = 255] = value;
        r2 /= 255;
        g2 /= 255;
        b2 /= 255;
        a2 /= 255;
      } else if (typeof value === "string" || typeof value === "object") {
        if (typeof value === "string") {
          const match = _Color2.HEX_PATTERN.exec(value);
          if (match) {
            value = `#${match[2]}`;
          }
        }
        const color = w(value);
        if (color.isValid()) {
          ({ r: r2, g: g2, b: b2, a: a2 } = color.rgba);
          r2 /= 255;
          g2 /= 255;
          b2 /= 255;
        }
      }
      if (r2 !== void 0) {
        this._components[0] = r2;
        this._components[1] = g2;
        this._components[2] = b2;
        this._components[3] = a2;
        this._refreshInt();
      } else {
        throw new Error(`Unable to convert color ${value}`);
      }
    }

    _refreshInt() {
      this._clamp(this._components);
      const [r2, g2, b2] = this._components;
      this._int = (r2 * 255 << 16) + (g2 * 255 << 8) + (b2 * 255 | 0);
    }

    _clamp(value, min = 0, max = 1) {
      if (typeof value === "number") {
        return Math.min(Math.max(value, min), max);
      }
      value.forEach((v2, i2) => {
        value[i2] = Math.min(Math.max(v2, min), max);
      });
      return value;
    }

    static isColorLike(value) {
      return typeof value === "number" || typeof value === "string" || value instanceof Number || value instanceof _Color2 || Array.isArray(value) || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Float32Array || value.r !== void 0 && value.g !== void 0 && value.b !== void 0 || value.r !== void 0 && value.g !== void 0 && value.b !== void 0 && value.a !== void 0 || value.h !== void 0 && value.s !== void 0 && value.l !== void 0 || value.h !== void 0 && value.s !== void 0 && value.l !== void 0 && value.a !== void 0 || value.h !== void 0 && value.s !== void 0 && value.v !== void 0 || value.h !== void 0 && value.s !== void 0 && value.v !== void 0 && value.a !== void 0;
    }
  };
  _Color.shared = new _Color();
  _Color._temp = new _Color();
  _Color.HEX_PATTERN = /^(#|0x)?(([a-f0-9]{3}){1,2}([a-f0-9]{2})?)$/i;
  let Color = _Color;
  const cullingMixin = {
    cullArea: null,
    cullable: false,
    cullableChildren: true
  };
  let warnCount = 0;
  const maxWarnings = 500;
  function warn(...args) {
    if (warnCount === maxWarnings) return;
    warnCount++;
    if (warnCount === maxWarnings) {
      console.warn("PixiJS Warning: too many warnings, no more warnings will be reported to the console by PixiJS.");
    } else {
      console.warn("PixiJS Warning: ", ...args);
    }
  }
  const GlobalResourceRegistry = {

    _registeredResources:                 new Set(),

    register(pool) {
      this._registeredResources.add(pool);
    },

    unregister(pool) {
      this._registeredResources.delete(pool);
    },

    release() {
      this._registeredResources.forEach((pool) => pool.clear());
    },

    get registeredCount() {
      return this._registeredResources.size;
    },

    isRegistered(pool) {
      return this._registeredResources.has(pool);
    },

    reset() {
      this._registeredResources.clear();
    }
  };
  class Pool {

    constructor(ClassType, initialSize) {
      this._pool = [];
      this._count = 0;
      this._index = 0;
      this._classType = ClassType;
      if (initialSize) {
        this.prepopulate(initialSize);
      }
    }

    prepopulate(total) {
      for (let i2 = 0; i2 < total; i2++) {
        this._pool[this._index++] = new this._classType();
      }
      this._count += total;
    }

    get(data) {
      let item;
      if (this._index > 0) {
        item = this._pool[--this._index];
      } else {
        item = new this._classType();
        this._count++;
      }
      item.init?.(data);
      return item;
    }

    return(item) {
      item.reset?.();
      this._pool[this._index++] = item;
    }

    get totalSize() {
      return this._count;
    }

    get totalFree() {
      return this._index;
    }

    get totalUsed() {
      return this._count - this._index;
    }

    clear() {
      if (this._pool.length > 0 && this._pool[0].destroy) {
        for (let i2 = 0; i2 < this._index; i2++) {
          this._pool[i2].destroy();
        }
      }
      this._pool.length = 0;
      this._count = 0;
      this._index = 0;
    }
  }
  class PoolGroupClass {
    constructor() {
      this._poolsByClass =                 new Map();
    }

    prepopulate(Class, total) {
      const classPool = this.getPool(Class);
      classPool.prepopulate(total);
    }

    get(Class, data) {
      const pool = this.getPool(Class);
      return pool.get(data);
    }

    return(item) {
      const pool = this.getPool(item.constructor);
      pool.return(item);
    }

    getPool(ClassType) {
      if (!this._poolsByClass.has(ClassType)) {
        this._poolsByClass.set(ClassType, new Pool(ClassType));
      }
      return this._poolsByClass.get(ClassType);
    }

    stats() {
      const stats = {};
      this._poolsByClass.forEach((pool) => {
        const name = stats[pool._classType.name] ? pool._classType.name + pool._classType.ID : pool._classType.name;
        stats[name] = {
          free: pool.totalFree,
          used: pool.totalUsed,
          size: pool.totalSize
        };
      });
      return stats;
    }

    clear() {
      this._poolsByClass.forEach((pool) => pool.clear());
      this._poolsByClass.clear();
    }
  }
  const BigPool = new PoolGroupClass();
  GlobalResourceRegistry.register(BigPool);
  const cacheAsTextureMixin = {
    get isCachedAsTexture() {
      return !!this.renderGroup?.isCachedAsTexture;
    },
    cacheAsTexture(val) {
      if (typeof val === "boolean" && val === false) {
        this.disableRenderGroup();
      } else {
        this.enableRenderGroup();
        this.renderGroup.enableCacheAsTexture(val === true ? {} : val);
      }
    },
    updateCacheTexture() {
      this.renderGroup?.updateCacheTexture();
    },
    get cacheAsBitmap() {
      return this.isCachedAsTexture;
    },
    set cacheAsBitmap(val) {
      deprecation("v8.6.0", "cacheAsBitmap is deprecated, use cacheAsTexture instead.");
      this.cacheAsTexture(val);
    }
  };
  function removeItems(arr, startIdx, removeCount) {
    const length2 = arr.length;
    let i2;
    if (startIdx >= length2 || removeCount === 0) {
      return;
    }
    removeCount = startIdx + removeCount > length2 ? length2 - startIdx : removeCount;
    const len = length2 - removeCount;
    for (i2 = startIdx; i2 < len; ++i2) {
      arr[i2] = arr[i2 + removeCount];
    }
    arr.length = len;
  }
  const childrenHelperMixin = {
    allowChildren: true,
    removeChildren(beginIndex = 0, endIndex) {
      const end = endIndex ?? this.children.length;
      const range = end - beginIndex;
      const removed = [];
      if (range > 0 && range <= end) {
        for (let i2 = end - 1; i2 >= beginIndex; i2--) {
          const child = this.children[i2];
          if (!child) continue;
          removed.push(child);
          child.parent = null;
        }
        removeItems(this.children, beginIndex, end);
        const renderGroup = this.renderGroup || this.parentRenderGroup;
        if (renderGroup) {
          renderGroup.removeChildren(removed);
        }
        for (let i2 = 0; i2 < removed.length; ++i2) {
          const child = removed[i2];
          child.parentRenderLayer?.detach(child);
          this.emit("childRemoved", child, this, i2);
          removed[i2].emit("removed", this);
        }
        if (removed.length > 0) {
          this._didViewChangeTick++;
        }
        return removed;
      } else if (range === 0 && this.children.length === 0) {
        return removed;
      }
      throw new RangeError("removeChildren: numeric values are outside the acceptable range.");
    },
    removeChildAt(index) {
      const child = this.getChildAt(index);
      return this.removeChild(child);
    },
    getChildAt(index) {
      if (index < 0 || index >= this.children.length) {
        throw new Error(`getChildAt: Index (${index}) does not exist.`);
      }
      return this.children[index];
    },
    setChildIndex(child, index) {
      if (index < 0 || index >= this.children.length) {
        throw new Error(`The index ${index} supplied is out of bounds ${this.children.length}`);
      }
      this.getChildIndex(child);
      this.addChildAt(child, index);
    },
    getChildIndex(child) {
      const index = this.children.indexOf(child);
      if (index === -1) {
        throw new Error("The supplied Container must be a child of the caller");
      }
      return index;
    },
    addChildAt(child, index) {
      if (!this.allowChildren) {
        deprecation(v8_0_0, "addChildAt: Only Containers will be allowed to add children in v8.0.0");
      }
      const { children } = this;
      if (index < 0 || index > children.length) {
        throw new Error(`${child}addChildAt: The index ${index} supplied is out of bounds ${children.length}`);
      }
      const sameParent = child.parent === this;
      if (child.parent) {
        const currentIndex = child.parent.children.indexOf(child);
        if (sameParent) {
          if (currentIndex === index) {
            return child;
          }
          child.parent.children.splice(currentIndex, 1);
        } else {
          child.removeFromParent();
        }
      }
      if (index === children.length) {
        children.push(child);
      } else {
        children.splice(index, 0, child);
      }
      child.parent = this;
      child.didChange = true;
      child._updateFlags = 15;
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (renderGroup) {
        renderGroup.addChild(child);
      }
      if (this.sortableChildren) this.sortDirty = true;
      if (sameParent) {
        return child;
      }
      this.emit("childAdded", child, this, index);
      child.emit("added", this);
      return child;
    },
    swapChildren(child, child2) {
      if (child === child2) {
        return;
      }
      const index1 = this.getChildIndex(child);
      const index2 = this.getChildIndex(child2);
      this.children[index1] = child2;
      this.children[index2] = child;
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (renderGroup) {
        renderGroup.structureDidChange = true;
      }
      this._didContainerChangeTick++;
    },
    removeFromParent() {
      this.parent?.removeChild(this);
    },
    reparentChild(...child) {
      if (child.length === 1) {
        return this.reparentChildAt(child[0], this.children.length);
      }
      child.forEach((c2) => this.reparentChildAt(c2, this.children.length));
      return child[0];
    },
    reparentChildAt(child, index) {
      if (child.parent === this) {
        this.setChildIndex(child, index);
        return child;
      }
      const childMat = child.worldTransform.clone();
      child.removeFromParent();
      this.addChildAt(child, index);
      const newMatrix = this.worldTransform.clone();
      newMatrix.invert();
      childMat.prepend(newMatrix);
      child.setFromMatrix(childMat);
      return child;
    },
    replaceChild(oldChild, newChild) {
      oldChild.updateLocalTransform();
      this.addChildAt(newChild, this.getChildIndex(oldChild));
      newChild.setFromMatrix(oldChild.localTransform);
      newChild.updateLocalTransform();
      this.removeChild(oldChild);
    }
  };
  const collectRenderablesMixin = {
    collectRenderables(instructionSet, renderer, currentLayer) {
      if (this.parentRenderLayer && this.parentRenderLayer !== currentLayer || this.globalDisplayStatus < 7 || !this.includeInBuild) return;
      if (this.sortableChildren) {
        this.sortChildren();
      }
      if (this.isSimple) {
        this.collectRenderablesSimple(instructionSet, renderer, currentLayer);
      } else if (this.renderGroup) {
        renderer.renderPipes.renderGroup.addRenderGroup(this.renderGroup, instructionSet);
      } else {
        this.collectRenderablesWithEffects(instructionSet, renderer, currentLayer);
      }
    },
    collectRenderablesSimple(instructionSet, renderer, currentLayer) {
      const children = this.children;
      const length2 = children.length;
      for (let i2 = 0; i2 < length2; i2++) {
        children[i2].collectRenderables(instructionSet, renderer, currentLayer);
      }
    },
    collectRenderablesWithEffects(instructionSet, renderer, currentLayer) {
      const { renderPipes: renderPipes2 } = renderer;
      for (let i2 = 0; i2 < this.effects.length; i2++) {
        const effect = this.effects[i2];
        const pipe = renderPipes2[effect.pipe];
        pipe.push(effect, this, instructionSet);
      }
      this.collectRenderablesSimple(instructionSet, renderer, currentLayer);
      for (let i2 = this.effects.length - 1; i2 >= 0; i2--) {
        const effect = this.effects[i2];
        const pipe = renderPipes2[effect.pipe];
        pipe.pop(effect, this, instructionSet);
      }
    }
  };
  class FilterEffect {
    constructor() {
      this.pipe = "filter";
      this.priority = 1;
    }
    destroy() {
      for (let i2 = 0; i2 < this.filters.length; i2++) {
        this.filters[i2].destroy();
      }
      this.filters = null;
      this.filterArea = null;
    }
  }
  class MaskEffectManagerClass {
    constructor() {
      this._effectClasses = [];
      this._tests = [];
      this._initialized = false;
    }
    init() {
      if (this._initialized) return;
      this._initialized = true;
      this._effectClasses.forEach((test) => {
        this.add({
          test: test.test,
          maskClass: test
        });
      });
    }
    add(test) {
      this._tests.push(test);
    }
    getMaskEffect(item) {
      if (!this._initialized) this.init();
      for (let i2 = 0; i2 < this._tests.length; i2++) {
        const test = this._tests[i2];
        if (test.test(item)) {
          return BigPool.get(test.maskClass, item);
        }
      }
      return item;
    }
    returnMaskEffect(effect) {
      BigPool.return(effect);
    }
  }
  const MaskEffectManager = new MaskEffectManagerClass();
  extensions.handleByList(ExtensionType.MaskEffect, MaskEffectManager._effectClasses);
  const effectsMixin = {
    _maskEffect: null,
    _maskOptions: {
      inverse: false,
      channel: "red"
    },
    _filterEffect: null,
    effects: [],
    _markStructureAsChanged() {
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (renderGroup) {
        renderGroup.structureDidChange = true;
      }
    },
    addEffect(effect) {
      const index = this.effects.indexOf(effect);
      if (index !== -1) return;
      this.effects.push(effect);
      this.effects.sort((a2, b2) => a2.priority - b2.priority);
      this._markStructureAsChanged();
      this._updateIsSimple();
    },
    removeEffect(effect) {
      const index = this.effects.indexOf(effect);
      if (index === -1) return;
      this.effects.splice(index, 1);
      this._markStructureAsChanged();
      this._updateIsSimple();
    },
    set mask(value) {
      const effect = this._maskEffect;
      if (effect?.mask === value) return;
      if (effect) {
        this.removeEffect(effect);
        MaskEffectManager.returnMaskEffect(effect);
        this._maskEffect = null;
      }
      if (value === null || value === void 0) return;
      this._maskEffect = MaskEffectManager.getMaskEffect(value);
      this.addEffect(this._maskEffect);
    },
    get mask() {
      return this._maskEffect?.mask;
    },
    setMask(options) {
      this._maskOptions = {
        ...this._maskOptions,
        ...options
      };
      if (options.mask) {
        this.mask = options.mask;
      }
      this._markStructureAsChanged();
    },
    set filters(value) {
      if (!Array.isArray(value) && value) value = [value];
      const effect = this._filterEffect || (this._filterEffect = new FilterEffect());
      value = value;
      const hasFilters = value?.length > 0;
      const hadFilters = effect.filters?.length > 0;
      const didChange = hasFilters !== hadFilters;
      value = Array.isArray(value) ? value.slice(0) : value;
      effect.filters = Object.freeze(value);
      if (didChange) {
        if (hasFilters) {
          this.addEffect(effect);
        } else {
          this.removeEffect(effect);
          effect.filters = value ?? null;
        }
      }
    },
    get filters() {
      return this._filterEffect?.filters;
    },
    set filterArea(value) {
      this._filterEffect || (this._filterEffect = new FilterEffect());
      this._filterEffect.filterArea = value;
    },
    get filterArea() {
      return this._filterEffect?.filterArea;
    }
  };
  const findMixin = {
    label: null,
    get name() {
      deprecation(v8_0_0, "Container.name property has been removed, use Container.label instead");
      return this.label;
    },
    set name(value) {
      deprecation(v8_0_0, "Container.name property has been removed, use Container.label instead");
      this.label = value;
    },
    getChildByName(name, deep = false) {
      return this.getChildByLabel(name, deep);
    },
    getChildByLabel(label, deep = false) {
      const children = this.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        const child = children[i2];
        if (child.label === label || label instanceof RegExp && label.test(child.label)) return child;
      }
      if (deep) {
        for (let i2 = 0; i2 < children.length; i2++) {
          const child = children[i2];
          const found = child.getChildByLabel(label, true);
          if (found) {
            return found;
          }
        }
      }
      return null;
    },
    getChildrenByLabel(label, deep = false, out2 = []) {
      const children = this.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        const child = children[i2];
        if (child.label === label || label instanceof RegExp && label.test(child.label)) {
          out2.push(child);
        }
      }
      if (deep) {
        for (let i2 = 0; i2 < children.length; i2++) {
          children[i2].getChildrenByLabel(label, true, out2);
        }
      }
      return out2;
    }
  };
  const matrixPool = BigPool.getPool(Matrix);
  const boundsPool = BigPool.getPool(Bounds);
  const tempMatrix$5 = new Matrix();
  const getFastGlobalBoundsMixin = {
    getFastGlobalBounds(factorRenderLayers, bounds) {
      bounds || (bounds = new Bounds());
      bounds.clear();
      this._getGlobalBoundsRecursive(!!factorRenderLayers, bounds, this.parentRenderLayer);
      if (!bounds.isValid) {
        bounds.set(0, 0, 0, 0);
      }
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      bounds.applyMatrix(renderGroup.worldTransform);
      return bounds;
    },
    _getGlobalBoundsRecursive(factorRenderLayers, bounds, currentLayer) {
      let localBounds = bounds;
      if (factorRenderLayers && this.parentRenderLayer && this.parentRenderLayer !== currentLayer) return;
      if (this.localDisplayStatus !== 7 || !this.measurable) {
        return;
      }
      const manageEffects = !!this.effects.length;
      if (this.renderGroup || manageEffects) {
        localBounds = boundsPool.get().clear();
      }
      if (this.boundsArea) {
        bounds.addRect(this.boundsArea, this.worldTransform);
      } else {
        if (this.renderPipeId) {
          const viewBounds = this.bounds;
          localBounds.addFrame(
            viewBounds.minX,
            viewBounds.minY,
            viewBounds.maxX,
            viewBounds.maxY,
            this.groupTransform
          );
        }
        const children = this.children;
        for (let i2 = 0; i2 < children.length; i2++) {
          children[i2]._getGlobalBoundsRecursive(factorRenderLayers, localBounds, currentLayer);
        }
      }
      if (manageEffects) {
        let advanced = false;
        const renderGroup = this.renderGroup || this.parentRenderGroup;
        for (let i2 = 0; i2 < this.effects.length; i2++) {
          if (this.effects[i2].addBounds) {
            if (!advanced) {
              advanced = true;
              localBounds.applyMatrix(renderGroup.worldTransform);
            }
            this.effects[i2].addBounds(localBounds, true);
          }
        }
        if (advanced) {
          localBounds.applyMatrix(renderGroup.worldTransform.copyTo(tempMatrix$5).invert());
        }
        bounds.addBounds(localBounds);
        boundsPool.return(localBounds);
      } else if (this.renderGroup) {
        bounds.addBounds(localBounds, this.relativeGroupTransform);
        boundsPool.return(localBounds);
      }
    }
  };
  function getGlobalBounds(target, skipUpdateTransform, bounds) {
    bounds.clear();
    let parentTransform;
    let pooledMatrix;
    if (target.parent) {
      if (!skipUpdateTransform) {
        pooledMatrix = matrixPool.get().identity();
        parentTransform = updateTransformBackwards(target, pooledMatrix);
      } else {
        parentTransform = target.parent.worldTransform;
      }
    } else {
      parentTransform = Matrix.IDENTITY;
    }
    _getGlobalBounds(target, bounds, parentTransform, skipUpdateTransform);
    if (pooledMatrix) {
      matrixPool.return(pooledMatrix);
    }
    if (!bounds.isValid) {
      bounds.set(0, 0, 0, 0);
    }
    return bounds;
  }
  function _getGlobalBounds(target, bounds, parentTransform, skipUpdateTransform) {
    if (!target.visible || !target.measurable) return;
    let worldTransform;
    if (!skipUpdateTransform) {
      target.updateLocalTransform();
      worldTransform = matrixPool.get();
      worldTransform.appendFrom(target.localTransform, parentTransform);
    } else {
      worldTransform = target.worldTransform;
    }
    const parentBounds = bounds;
    const preserveBounds = !!target.effects.length;
    if (preserveBounds) {
      bounds = boundsPool.get().clear();
    }
    if (target.boundsArea) {
      bounds.addRect(target.boundsArea, worldTransform);
    } else {
      const renderableBounds = target.bounds;
      if (renderableBounds && !renderableBounds.isEmpty()) {
        bounds.matrix = worldTransform;
        bounds.addBounds(renderableBounds);
      }
      for (let i2 = 0; i2 < target.children.length; i2++) {
        _getGlobalBounds(target.children[i2], bounds, worldTransform, skipUpdateTransform);
      }
    }
    if (preserveBounds) {
      for (let i2 = 0; i2 < target.effects.length; i2++) {
        target.effects[i2].addBounds?.(bounds);
      }
      parentBounds.addBounds(bounds, Matrix.IDENTITY);
      boundsPool.return(bounds);
    }
    if (!skipUpdateTransform) {
      matrixPool.return(worldTransform);
    }
  }
  function updateTransformBackwards(target, parentTransform) {
    const parent = target.parent;
    if (parent) {
      updateTransformBackwards(parent, parentTransform);
      parent.updateLocalTransform();
      parentTransform.append(parent.localTransform);
    }
    return parentTransform;
  }
  function multiplyHexColors(color1, color2) {
    if (color1 === 16777215 || !color2) return color2;
    if (color2 === 16777215 || !color1) return color1;
    const r1 = color1 >> 16 & 255;
    const g1 = color1 >> 8 & 255;
    const b1 = color1 & 255;
    const r2 = color2 >> 16 & 255;
    const g2 = color2 >> 8 & 255;
    const b2 = color2 & 255;
    const r3 = r1 * r2 / 255 | 0;
    const g3 = g1 * g2 / 255 | 0;
    const b3 = b1 * b2 / 255 | 0;
    return (r3 << 16) + (g3 << 8) + b3;
  }
  const WHITE_BGR = 16777215;
  function multiplyColors(localBGRColor, parentBGRColor) {
    if (localBGRColor === WHITE_BGR) {
      return parentBGRColor;
    }
    if (parentBGRColor === WHITE_BGR) {
      return localBGRColor;
    }
    return multiplyHexColors(localBGRColor, parentBGRColor);
  }
  function bgr2rgb(color) {
    return ((color & 255) << 16) + (color & 65280) + (color >> 16 & 255);
  }
  const getGlobalMixin = {
    getGlobalAlpha(skipUpdate) {
      if (skipUpdate) {
        if (this.renderGroup) {
          return this.renderGroup.worldAlpha;
        }
        if (this.parentRenderGroup) {
          return this.parentRenderGroup.worldAlpha * this.alpha;
        }
        return this.alpha;
      }
      let alpha = this.alpha;
      let current = this.parent;
      while (current) {
        alpha *= current.alpha;
        current = current.parent;
      }
      return alpha;
    },
    getGlobalTransform(matrix = new Matrix(), skipUpdate) {
      if (skipUpdate) {
        return matrix.copyFrom(this.worldTransform);
      }
      this.updateLocalTransform();
      const parentTransform = updateTransformBackwards(this, matrixPool.get().identity());
      matrix.appendFrom(this.localTransform, parentTransform);
      matrixPool.return(parentTransform);
      return matrix;
    },
    getGlobalTint(skipUpdate) {
      if (skipUpdate) {
        if (this.renderGroup) {
          return bgr2rgb(this.renderGroup.worldColor);
        }
        if (this.parentRenderGroup) {
          return bgr2rgb(
            multiplyColors(this.localColor, this.parentRenderGroup.worldColor)
          );
        }
        return this.tint;
      }
      let color = this.localColor;
      let parent = this.parent;
      while (parent) {
        color = multiplyColors(color, parent.localColor);
        parent = parent.parent;
      }
      return bgr2rgb(color);
    }
  };
  function getLocalBounds(target, bounds, relativeMatrix) {
    bounds.clear();
    relativeMatrix || (relativeMatrix = Matrix.IDENTITY);
    _getLocalBounds(target, bounds, relativeMatrix, target, true);
    if (!bounds.isValid) {
      bounds.set(0, 0, 0, 0);
    }
    return bounds;
  }
  function _getLocalBounds(target, bounds, parentTransform, rootContainer, isRoot) {
    let relativeTransform;
    if (!isRoot) {
      if (!target.visible || !target.measurable) return;
      target.updateLocalTransform();
      const localTransform = target.localTransform;
      relativeTransform = matrixPool.get();
      relativeTransform.appendFrom(localTransform, parentTransform);
    } else {
      relativeTransform = matrixPool.get();
      relativeTransform = parentTransform.copyTo(relativeTransform);
    }
    const parentBounds = bounds;
    const preserveBounds = !!target.effects.length;
    if (preserveBounds) {
      bounds = boundsPool.get().clear();
    }
    if (target.boundsArea) {
      bounds.addRect(target.boundsArea, relativeTransform);
    } else {
      if (target.renderPipeId) {
        bounds.matrix = relativeTransform;
        bounds.addBounds(target.bounds);
      }
      const children = target.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        _getLocalBounds(children[i2], bounds, relativeTransform, rootContainer, false);
      }
    }
    if (preserveBounds) {
      for (let i2 = 0; i2 < target.effects.length; i2++) {
        target.effects[i2].addLocalBounds?.(bounds, rootContainer);
      }
      parentBounds.addBounds(bounds, Matrix.IDENTITY);
      boundsPool.return(bounds);
    }
    matrixPool.return(relativeTransform);
  }
  function checkChildrenDidChange(container, previousData) {
    const children = container.children;
    for (let i2 = 0; i2 < children.length; i2++) {
      const child = children[i2];
      const uid2 = child.uid;
      const didChange = (child._didViewChangeTick & 65535) << 16 | child._didContainerChangeTick & 65535;
      const index = previousData.index;
      if (previousData.data[index] !== uid2 || previousData.data[index + 1] !== didChange) {
        previousData.data[previousData.index] = uid2;
        previousData.data[previousData.index + 1] = didChange;
        previousData.didChange = true;
      }
      previousData.index = index + 2;
      if (child.children.length) {
        checkChildrenDidChange(child, previousData);
      }
    }
    return previousData.didChange;
  }
  const tempMatrix$4 = new Matrix();
  const measureMixin = {
    _localBoundsCacheId: -1,
    _localBoundsCacheData: null,
    _setWidth(value, localWidth) {
      const sign2 = Math.sign(this.scale.x) || 1;
      if (localWidth !== 0) {
        this.scale.x = value / localWidth * sign2;
      } else {
        this.scale.x = sign2;
      }
    },
    _setHeight(value, localHeight) {
      const sign2 = Math.sign(this.scale.y) || 1;
      if (localHeight !== 0) {
        this.scale.y = value / localHeight * sign2;
      } else {
        this.scale.y = sign2;
      }
    },
    getLocalBounds() {
      if (!this._localBoundsCacheData) {
        this._localBoundsCacheData = {
          data: [],
          index: 1,
          didChange: false,
          localBounds: new Bounds()
        };
      }
      const localBoundsCacheData = this._localBoundsCacheData;
      localBoundsCacheData.index = 1;
      localBoundsCacheData.didChange = false;
      if (localBoundsCacheData.data[0] !== this._didViewChangeTick) {
        localBoundsCacheData.didChange = true;
        localBoundsCacheData.data[0] = this._didViewChangeTick;
      }
      checkChildrenDidChange(this, localBoundsCacheData);
      if (localBoundsCacheData.didChange) {
        getLocalBounds(this, localBoundsCacheData.localBounds, tempMatrix$4);
      }
      return localBoundsCacheData.localBounds;
    },
    getBounds(skipUpdate, bounds) {
      return getGlobalBounds(this, skipUpdate, bounds || new Bounds());
    }
  };
  const onRenderMixin = {
    _onRender: null,
    set onRender(func) {
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (!func) {
        if (this._onRender) {
          renderGroup?.removeOnRender(this);
        }
        this._onRender = null;
        return;
      }
      if (!this._onRender) {
        renderGroup?.addOnRender(this);
      }
      this._onRender = func;
    },
    get onRender() {
      return this._onRender;
    }
  };
  const sortMixin = {
    _zIndex: 0,
    sortDirty: false,
    sortableChildren: false,
    get zIndex() {
      return this._zIndex;
    },
    set zIndex(value) {
      if (this._zIndex === value) return;
      this._zIndex = value;
      this.depthOfChildModified();
    },
    depthOfChildModified() {
      if (this.parent) {
        this.parent.sortableChildren = true;
        this.parent.sortDirty = true;
      }
      if (this.parentRenderGroup) {
        this.parentRenderGroup.structureDidChange = true;
      }
    },
    sortChildren() {
      if (!this.sortDirty) return;
      this.sortDirty = false;
      this.children.sort(sortChildren);
    }
  };
  function sortChildren(a2, b2) {
    return a2._zIndex - b2._zIndex;
  }
  const toLocalGlobalMixin = {
    getGlobalPosition(point = new Point(), skipUpdate = false) {
      if (this.parent) {
        this.parent.toGlobal(this._position, point, skipUpdate);
      } else {
        point.x = this._position.x;
        point.y = this._position.y;
      }
      return point;
    },
    toGlobal(position, point, skipUpdate = false) {
      const globalMatrix = this.getGlobalTransform(matrixPool.get(), skipUpdate);
      point = globalMatrix.apply(position, point);
      matrixPool.return(globalMatrix);
      return point;
    },
    toLocal(position, from, point, skipUpdate) {
      if (from) {
        position = from.toGlobal(position, point, skipUpdate);
      }
      const globalMatrix = this.getGlobalTransform(matrixPool.get(), skipUpdate);
      point = globalMatrix.applyInverse(position, point);
      matrixPool.return(globalMatrix);
      return point;
    }
  };
  class InstructionSet {
    constructor() {
      this.uid = uid$1("instructionSet");
      this.instructions = [];
      this.instructionSize = 0;
      this.renderables = [];
      this.gcTick = 0;
    }

    reset() {
      this.instructionSize = 0;
    }

    destroy() {
      this.instructions.length = 0;
      this.renderables.length = 0;
      this.renderPipes = null;
      this.gcTick = 0;
    }

    add(instruction) {
      this.instructions[this.instructionSize++] = instruction;
    }

    log() {
      this.instructions.length = this.instructionSize;
      console.table(this.instructions, ["type", "action"]);
    }
  }
  let count = 0;
  class TexturePoolClass {

    constructor(textureOptions) {
      this._poolKeyHash =                 Object.create(null);
      this._texturePool = {};
      this.textureOptions = textureOptions || {};
      this.enableFullScreen = false;
      this.textureStyle = new TextureStyle(this.textureOptions);
    }

    createTexture(pixelWidth, pixelHeight, antialias, autoGenerateMipmaps) {
      const textureSource = new TextureSource({
        ...this.textureOptions,
        width: pixelWidth,
        height: pixelHeight,
        resolution: 1,
        antialias,
        autoGarbageCollect: false,
        autoGenerateMipmaps
      });
      return new Texture({
        source: textureSource,
        label: `texturePool_${count++}`
      });
    }

    getOptimalTexture(frameWidth, frameHeight, resolution = 1, antialias, autoGenerateMipmaps = false) {
      let po2Width = Math.ceil(frameWidth * resolution - 1e-6);
      let po2Height = Math.ceil(frameHeight * resolution - 1e-6);
      po2Width = nextPow2(po2Width);
      po2Height = nextPow2(po2Height);
      const antialiasFlag = antialias ? 1 : 0;
      const mipmapFlag = autoGenerateMipmaps ? 1 : 0;
      const key = (po2Width << 17) + (po2Height << 2) + (mipmapFlag << 1) + antialiasFlag;
      if (!this._texturePool[key]) {
        this._texturePool[key] = [];
      }
      let texture = this._texturePool[key].pop();
      if (!texture) {
        texture = this.createTexture(po2Width, po2Height, antialias, autoGenerateMipmaps);
      }
      texture.source._resolution = resolution;
      texture.source.width = po2Width / resolution;
      texture.source.height = po2Height / resolution;
      texture.source.pixelWidth = po2Width;
      texture.source.pixelHeight = po2Height;
      texture.frame.x = 0;
      texture.frame.y = 0;
      texture.frame.width = frameWidth;
      texture.frame.height = frameHeight;
      texture.updateUvs();
      this._poolKeyHash[texture.uid] = key;
      return texture;
    }

    getSameSizeTexture(texture, antialias = false) {
      const source2 = texture.source;
      return this.getOptimalTexture(texture.width, texture.height, source2._resolution, antialias);
    }

    returnTexture(renderTexture, resetStyle = false) {
      const key = this._poolKeyHash[renderTexture.uid];
      if (resetStyle) {
        renderTexture.source.style = this.textureStyle;
      }
      this._texturePool[key].push(renderTexture);
    }

    clear(destroyTextures) {
      destroyTextures = destroyTextures !== false;
      if (destroyTextures) {
        for (const i2 in this._texturePool) {
          const textures = this._texturePool[i2];
          if (textures) {
            for (let j2 = 0; j2 < textures.length; j2++) {
              textures[j2].destroy(true);
            }
          }
        }
      }
      this._texturePool = {};
    }
  }
  const TexturePool = new TexturePoolClass();
  GlobalResourceRegistry.register(TexturePool);
  class RenderGroup {
    constructor() {
      this.renderPipeId = "renderGroup";
      this.root = null;
      this.canBundle = false;
      this.renderGroupParent = null;
      this.renderGroupChildren = [];
      this.worldTransform = new Matrix();
      this.worldColorAlpha = 4294967295;
      this.worldColor = 16777215;
      this.worldAlpha = 1;
      this.childrenToUpdate =                 Object.create(null);
      this.updateTick = 0;
      this.gcTick = 0;
      this.childrenRenderablesToUpdate = { list: [], index: 0 };
      this.structureDidChange = true;
      this.instructionSet = new InstructionSet();
      this._onRenderContainers = [];
      this.textureNeedsUpdate = true;
      this.isCachedAsTexture = false;
      this._matrixDirty = 7;
    }
    init(root) {
      this.root = root;
      if (root._onRender) this.addOnRender(root);
      root.didChange = true;
      const children = root.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        const child = children[i2];
        child._updateFlags = 15;
        this.addChild(child);
      }
    }
    enableCacheAsTexture(options = {}) {
      this.textureOptions = options;
      this.isCachedAsTexture = true;
      this.textureNeedsUpdate = true;
    }
    disableCacheAsTexture() {
      this.isCachedAsTexture = false;
      if (this.texture) {
        TexturePool.returnTexture(this.texture, true);
        this.texture = null;
      }
    }
    updateCacheTexture() {
      this.textureNeedsUpdate = true;
      const cachedParent = this._parentCacheAsTextureRenderGroup;
      if (cachedParent && !cachedParent.textureNeedsUpdate) {
        cachedParent.updateCacheTexture();
      }
    }
    reset() {
      this.renderGroupChildren.length = 0;
      for (const i2 in this.childrenToUpdate) {
        const childrenAtDepth = this.childrenToUpdate[i2];
        childrenAtDepth.list.fill(null);
        childrenAtDepth.index = 0;
      }
      this.childrenRenderablesToUpdate.index = 0;
      this.childrenRenderablesToUpdate.list.fill(null);
      this.root = null;
      this.updateTick = 0;
      this.structureDidChange = true;
      this._onRenderContainers.length = 0;
      this.renderGroupParent = null;
      this.disableCacheAsTexture();
    }
    get localTransform() {
      return this.root.localTransform;
    }
    addRenderGroupChild(renderGroupChild) {
      if (renderGroupChild.renderGroupParent) {
        renderGroupChild.renderGroupParent._removeRenderGroupChild(renderGroupChild);
      }
      renderGroupChild.renderGroupParent = this;
      this.renderGroupChildren.push(renderGroupChild);
    }
    _removeRenderGroupChild(renderGroupChild) {
      const index = this.renderGroupChildren.indexOf(renderGroupChild);
      if (index > -1) {
        this.renderGroupChildren.splice(index, 1);
      }
      renderGroupChild.renderGroupParent = null;
    }
    addChild(child) {
      this.structureDidChange = true;
      child.parentRenderGroup = this;
      child.updateTick = -1;
      if (child.parent === this.root) {
        child.relativeRenderGroupDepth = 1;
      } else {
        child.relativeRenderGroupDepth = child.parent.relativeRenderGroupDepth + 1;
      }
      child.didChange = true;
      this.onChildUpdate(child);
      if (child.renderGroup) {
        this.addRenderGroupChild(child.renderGroup);
        return;
      }
      if (child._onRender) this.addOnRender(child);
      const children = child.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        this.addChild(children[i2]);
      }
    }
    removeChild(child) {
      this.structureDidChange = true;
      if (child._onRender) {
        if (!child.renderGroup) {
          this.removeOnRender(child);
        }
      }
      child.parentRenderGroup = null;
      if (child.renderGroup) {
        this._removeRenderGroupChild(child.renderGroup);
        return;
      }
      const children = child.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        this.removeChild(children[i2]);
      }
    }
    removeChildren(children) {
      for (let i2 = 0; i2 < children.length; i2++) {
        this.removeChild(children[i2]);
      }
    }
    onChildUpdate(child) {
      let childrenToUpdate = this.childrenToUpdate[child.relativeRenderGroupDepth];
      if (!childrenToUpdate) {
        childrenToUpdate = this.childrenToUpdate[child.relativeRenderGroupDepth] = {
          index: 0,
          list: []
        };
      }
      childrenToUpdate.list[childrenToUpdate.index++] = child;
    }
    updateRenderable(renderable) {
      if (renderable.globalDisplayStatus < 7) return;
      this.instructionSet.renderPipes[renderable.renderPipeId].updateRenderable(renderable);
      renderable.didViewUpdate = false;
    }
    onChildViewUpdate(child) {
      this.childrenRenderablesToUpdate.list[this.childrenRenderablesToUpdate.index++] = child;
    }
    get isRenderable() {
      return this.root.localDisplayStatus === 7 && this.worldAlpha > 0;
    }

    addOnRender(container) {
      this._onRenderContainers.push(container);
    }
    removeOnRender(container) {
      this._onRenderContainers.splice(this._onRenderContainers.indexOf(container), 1);
    }
    runOnRender(renderer) {
      for (let i2 = 0; i2 < this._onRenderContainers.length; i2++) {
        this._onRenderContainers[i2]._onRender(renderer);
      }
    }
    destroy() {
      this.disableCacheAsTexture();
      this.renderGroupParent = null;
      this.root = null;
      this.childrenRenderablesToUpdate = null;
      this.childrenToUpdate = null;
      this.renderGroupChildren = null;
      this._onRenderContainers = null;
      this.instructionSet = null;
    }
    getChildren(out2 = []) {
      const children = this.root.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        this._getChildren(children[i2], out2);
      }
      return out2;
    }
    _getChildren(container, out2 = []) {
      out2.push(container);
      if (container.renderGroup) return out2;
      const children = container.children;
      for (let i2 = 0; i2 < children.length; i2++) {
        this._getChildren(children[i2], out2);
      }
      return out2;
    }
    invalidateMatrices() {
      this._matrixDirty = 7;
    }

    get inverseWorldTransform() {
      if ((this._matrixDirty & 1) === 0) return this._inverseWorldTransform;
      this._matrixDirty &= -2;
      this._inverseWorldTransform || (this._inverseWorldTransform = new Matrix());
      return this._inverseWorldTransform.copyFrom(this.worldTransform).invert();
    }

    get textureOffsetInverseTransform() {
      if ((this._matrixDirty & 2) === 0) return this._textureOffsetInverseTransform;
      this._matrixDirty &= -3;
      this._textureOffsetInverseTransform || (this._textureOffsetInverseTransform = new Matrix());
      return this._textureOffsetInverseTransform.copyFrom(this.inverseWorldTransform).translate(
        -this._textureBounds.x,
        -this._textureBounds.y
      );
    }

    get inverseParentTextureTransform() {
      if ((this._matrixDirty & 4) === 0) return this._inverseParentTextureTransform;
      this._matrixDirty &= -5;
      const parentCacheAsTexture = this._parentCacheAsTextureRenderGroup;
      if (parentCacheAsTexture) {
        this._inverseParentTextureTransform || (this._inverseParentTextureTransform = new Matrix());
        return this._inverseParentTextureTransform.copyFrom(this.worldTransform).prepend(parentCacheAsTexture.inverseWorldTransform).translate(
          -parentCacheAsTexture._textureBounds.x,
          -parentCacheAsTexture._textureBounds.y
        );
      }
      return this.worldTransform;
    }

    get cacheToLocalTransform() {
      if (this.isCachedAsTexture) {
        return this.textureOffsetInverseTransform;
      }
      if (!this._parentCacheAsTextureRenderGroup) return null;
      return this._parentCacheAsTextureRenderGroup.textureOffsetInverseTransform;
    }
  }
  function assignWithIgnore(target, options, ignore = {}) {
    for (const key in options) {
      if (!ignore[key] && options[key] !== void 0) {
        target[key] = options[key];
      }
    }
  }
  const defaultSkew = new ObservablePoint(null);
  const defaultPivot = new ObservablePoint(null);
  const defaultScale = new ObservablePoint(null, 1, 1);
  const defaultOrigin = new ObservablePoint(null);
  const UPDATE_COLOR = 1;
  const UPDATE_BLEND = 2;
  const UPDATE_VISIBLE = 4;
  class Container extends EventEmitter {
    constructor(options = {}) {
      super();
      this.uid = uid$1("renderable");
      this._updateFlags = 15;
      this.renderGroup = null;
      this.parentRenderGroup = null;
      this.parentRenderGroupIndex = 0;
      this.didChange = false;
      this.didViewUpdate = false;
      this.relativeRenderGroupDepth = 0;
      this.children = [];
      this.parent = null;
      this.includeInBuild = true;
      this.measurable = true;
      this.isSimple = true;
      this.parentRenderLayer = null;
      this.updateTick = -1;
      this.localTransform = new Matrix();
      this.relativeGroupTransform = new Matrix();
      this.groupTransform = this.relativeGroupTransform;
      this.destroyed = false;
      this._position = new ObservablePoint(this, 0, 0);
      this._scale = defaultScale;
      this._pivot = defaultPivot;
      this._origin = defaultOrigin;
      this._skew = defaultSkew;
      this._cx = 1;
      this._sx = 0;
      this._cy = 0;
      this._sy = 1;
      this._rotation = 0;
      this.localColor = 16777215;
      this.localAlpha = 1;
      this.groupAlpha = 1;
      this.groupColor = 16777215;
      this.groupColorAlpha = 4294967295;
      this.localBlendMode = "inherit";
      this.groupBlendMode = "normal";
      this.localDisplayStatus = 7;
      this.globalDisplayStatus = 7;
      this._didContainerChangeTick = 0;
      this._didViewChangeTick = 0;
      this._didLocalTransformChangeId = -1;
      this.effects = [];
      assignWithIgnore(this, options, {
        children: true,
        parent: true,
        effects: true
      });
      options.children?.forEach((child) => this.addChild(child));
      options.parent?.addChild(this);
    }

    static mixin(source2) {
      deprecation("8.8.0", "Container.mixin is deprecated, please use extensions.mixin instead.");
      extensions.mixin(Container, source2);
    }

    set _didChangeId(value) {
      this._didViewChangeTick = value >> 12 & 4095;
      this._didContainerChangeTick = value & 4095;
    }

    get _didChangeId() {
      return this._didContainerChangeTick & 4095 | (this._didViewChangeTick & 4095) << 12;
    }

    addChild(...children) {
      if (!this.allowChildren) {
        deprecation(v8_0_0, "addChild: Only Containers will be allowed to add children in v8.0.0");
      }
      if (children.length > 1) {
        for (let i2 = 0; i2 < children.length; i2++) {
          this.addChild(children[i2]);
        }
        return children[0];
      }
      const child = children[0];
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (child.parent === this) {
        this.children.splice(this.children.indexOf(child), 1);
        this.children.push(child);
        if (renderGroup) {
          renderGroup.structureDidChange = true;
        }
        return child;
      }
      if (child.parent) {
        child.parent.removeChild(child);
      }
      this.children.push(child);
      if (this.sortableChildren) this.sortDirty = true;
      child.parent = this;
      child.didChange = true;
      child._updateFlags = 15;
      if (renderGroup) {
        renderGroup.addChild(child);
      }
      this.emit("childAdded", child, this, this.children.length - 1);
      child.emit("added", this);
      this._didViewChangeTick++;
      if (child._zIndex !== 0) {
        child.depthOfChildModified();
      }
      return child;
    }

    removeChild(...children) {
      if (children.length > 1) {
        for (let i2 = 0; i2 < children.length; i2++) {
          this.removeChild(children[i2]);
        }
        return children[0];
      }
      const child = children[0];
      const index = this.children.indexOf(child);
      if (index > -1) {
        this._didViewChangeTick++;
        this.children.splice(index, 1);
        if (this.renderGroup) {
          this.renderGroup.removeChild(child);
        } else if (this.parentRenderGroup) {
          this.parentRenderGroup.removeChild(child);
        }
        if (child.parentRenderLayer) {
          child.parentRenderLayer.detach(child);
        }
        child.parent = null;
        this.emit("childRemoved", child, this, index);
        child.emit("removed", this);
      }
      return child;
    }

    _onUpdate(point) {
      if (point) {
        if (point === this._skew) {
          this._updateSkew();
        }
      }
      this._didContainerChangeTick++;
      if (this.didChange) return;
      this.didChange = true;
      if (this.parentRenderGroup) {
        this.parentRenderGroup.onChildUpdate(this);
      }
    }
    set isRenderGroup(value) {
      if (!!this.renderGroup === value) return;
      if (value) {
        this.enableRenderGroup();
      } else {
        this.disableRenderGroup();
      }
    }

    get isRenderGroup() {
      return !!this.renderGroup;
    }

    enableRenderGroup() {
      if (this.renderGroup) return;
      const parentRenderGroup = this.parentRenderGroup;
      parentRenderGroup?.removeChild(this);
      this.renderGroup = BigPool.get(RenderGroup, this);
      this.groupTransform = Matrix.IDENTITY;
      parentRenderGroup?.addChild(this);
      this._updateIsSimple();
    }

    disableRenderGroup() {
      if (!this.renderGroup) return;
      const parentRenderGroup = this.parentRenderGroup;
      parentRenderGroup?.removeChild(this);
      BigPool.return(this.renderGroup);
      this.renderGroup = null;
      this.groupTransform = this.relativeGroupTransform;
      parentRenderGroup?.addChild(this);
      this._updateIsSimple();
    }

    _updateIsSimple() {
      this.isSimple = !this.renderGroup && this.effects.length === 0;
    }

    get worldTransform() {
      this._worldTransform || (this._worldTransform = new Matrix());
      if (this.renderGroup) {
        this._worldTransform.copyFrom(this.renderGroup.worldTransform);
      } else if (this.parentRenderGroup) {
        this._worldTransform.appendFrom(this.relativeGroupTransform, this.parentRenderGroup.worldTransform);
      }
      return this._worldTransform;
    }

    get x() {
      return this._position.x;
    }
    set x(value) {
      this._position.x = value;
    }

    get y() {
      return this._position.y;
    }
    set y(value) {
      this._position.y = value;
    }

    get position() {
      return this._position;
    }
    set position(value) {
      this._position.copyFrom(value);
    }

    get rotation() {
      return this._rotation;
    }
    set rotation(value) {
      if (this._rotation !== value) {
        this._rotation = value;
        this._onUpdate(this._skew);
      }
    }

    get angle() {
      return this.rotation * RAD_TO_DEG;
    }
    set angle(value) {
      this.rotation = value * DEG_TO_RAD;
    }

    get pivot() {
      if (this._pivot === defaultPivot) {
        this._pivot = new ObservablePoint(this, 0, 0);
      }
      return this._pivot;
    }
    set pivot(value) {
      if (this._pivot === defaultPivot) {
        this._pivot = new ObservablePoint(this, 0, 0);
        if (this._origin !== defaultOrigin) {
          warn(`Setting both a pivot and origin on a Container is not recommended. This can lead to unexpected behavior if not handled carefully.`);
        }
      }
      typeof value === "number" ? this._pivot.set(value) : this._pivot.copyFrom(value);
    }

    get skew() {
      if (this._skew === defaultSkew) {
        this._skew = new ObservablePoint(this, 0, 0);
      }
      return this._skew;
    }
    set skew(value) {
      if (this._skew === defaultSkew) {
        this._skew = new ObservablePoint(this, 0, 0);
      }
      this._skew.copyFrom(value);
    }

    get scale() {
      if (this._scale === defaultScale) {
        this._scale = new ObservablePoint(this, 1, 1);
      }
      return this._scale;
    }
    set scale(value) {
      if (this._scale === defaultScale) {
        this._scale = new ObservablePoint(this, 0, 0);
      }
      if (typeof value === "string") {
        value = parseFloat(value);
      }
      typeof value === "number" ? this._scale.set(value) : this._scale.copyFrom(value);
    }

    get origin() {
      if (this._origin === defaultOrigin) {
        this._origin = new ObservablePoint(this, 0, 0);
      }
      return this._origin;
    }
    set origin(value) {
      if (this._origin === defaultOrigin) {
        this._origin = new ObservablePoint(this, 0, 0);
        if (this._pivot !== defaultPivot) {
          warn(`Setting both a pivot and origin on a Container is not recommended. This can lead to unexpected behavior if not handled carefully.`);
        }
      }
      typeof value === "number" ? this._origin.set(value) : this._origin.copyFrom(value);
    }

    get width() {
      return Math.abs(this.scale.x * this.getLocalBounds().width);
    }
    set width(value) {
      const localWidth = this.getLocalBounds().width;
      this._setWidth(value, localWidth);
    }

    get height() {
      return Math.abs(this.scale.y * this.getLocalBounds().height);
    }
    set height(value) {
      const localHeight = this.getLocalBounds().height;
      this._setHeight(value, localHeight);
    }

    getSize(out2) {
      if (!out2) {
        out2 = {};
      }
      const bounds = this.getLocalBounds();
      out2.width = Math.abs(this.scale.x * bounds.width);
      out2.height = Math.abs(this.scale.y * bounds.height);
      return out2;
    }

    setSize(value, height) {
      const size = this.getLocalBounds();
      if (typeof value === "object") {
        height = value.height ?? value.width;
        value = value.width;
      } else {
        height ?? (height = value);
      }
      value !== void 0 && this._setWidth(value, size.width);
      height !== void 0 && this._setHeight(height, size.height);
    }

    _updateSkew() {
      const rotation = this._rotation;
      const skew = this._skew;
      this._cx = Math.cos(rotation + skew._y);
      this._sx = Math.sin(rotation + skew._y);
      this._cy = -Math.sin(rotation - skew._x);
      this._sy = Math.cos(rotation - skew._x);
    }

    updateTransform(opts) {
      this.position.set(
        typeof opts.x === "number" ? opts.x : this.position.x,
        typeof opts.y === "number" ? opts.y : this.position.y
      );
      this.scale.set(
        typeof opts.scaleX === "number" ? opts.scaleX || 1 : this.scale.x,
        typeof opts.scaleY === "number" ? opts.scaleY || 1 : this.scale.y
      );
      this.rotation = typeof opts.rotation === "number" ? opts.rotation : this.rotation;
      this.skew.set(
        typeof opts.skewX === "number" ? opts.skewX : this.skew.x,
        typeof opts.skewY === "number" ? opts.skewY : this.skew.y
      );
      this.pivot.set(
        typeof opts.pivotX === "number" ? opts.pivotX : this.pivot.x,
        typeof opts.pivotY === "number" ? opts.pivotY : this.pivot.y
      );
      this.origin.set(
        typeof opts.originX === "number" ? opts.originX : this.origin.x,
        typeof opts.originY === "number" ? opts.originY : this.origin.y
      );
      return this;
    }

    setFromMatrix(matrix) {
      matrix.decompose(this);
    }

    updateLocalTransform() {
      const localTransformChangeId = this._didContainerChangeTick;
      if (this._didLocalTransformChangeId === localTransformChangeId) return;
      this._didLocalTransformChangeId = localTransformChangeId;
      const lt = this.localTransform;
      const scale = this._scale;
      const pivot = this._pivot;
      const origin = this._origin;
      const position = this._position;
      const sx = scale._x;
      const sy = scale._y;
      const px = pivot._x;
      const py = pivot._y;
      const ox = -origin._x;
      const oy = -origin._y;
      lt.a = this._cx * sx;
      lt.b = this._sx * sx;
      lt.c = this._cy * sy;
      lt.d = this._sy * sy;
      lt.tx = position._x - (px * lt.a + py * lt.c) + (ox * lt.a + oy * lt.c) - ox;
      lt.ty = position._y - (px * lt.b + py * lt.d) + (ox * lt.b + oy * lt.d) - oy;
    }

    set alpha(value) {
      if (value === this.localAlpha) return;
      this.localAlpha = value;
      this._updateFlags |= UPDATE_COLOR;
      this._onUpdate();
    }

    get alpha() {
      return this.localAlpha;
    }
    set tint(value) {
      const tempColor = Color.shared.setValue(value ?? 16777215);
      const bgr = tempColor.toBgrNumber();
      if (bgr === this.localColor) return;
      this.localColor = bgr;
      this._updateFlags |= UPDATE_COLOR;
      this._onUpdate();
    }

    get tint() {
      return bgr2rgb(this.localColor);
    }

    set blendMode(value) {
      if (this.localBlendMode === value) return;
      if (this.parentRenderGroup) {
        this.parentRenderGroup.structureDidChange = true;
      }
      this._updateFlags |= UPDATE_BLEND;
      this.localBlendMode = value;
      this._onUpdate();
    }

    get blendMode() {
      return this.localBlendMode;
    }

    get visible() {
      return !!(this.localDisplayStatus & 2);
    }
    set visible(value) {
      const valueNumber = value ? 2 : 0;
      if ((this.localDisplayStatus & 2) === valueNumber) return;
      if (this.parentRenderGroup) {
        this.parentRenderGroup.structureDidChange = true;
      }
      this._updateFlags |= UPDATE_VISIBLE;
      this.localDisplayStatus ^= 2;
      this._onUpdate();
      this.emit("visibleChanged", value);
    }

    get culled() {
      return !(this.localDisplayStatus & 4);
    }

    set culled(value) {
      const valueNumber = value ? 0 : 4;
      if ((this.localDisplayStatus & 4) === valueNumber) return;
      if (this.parentRenderGroup) {
        this.parentRenderGroup.structureDidChange = true;
      }
      this._updateFlags |= UPDATE_VISIBLE;
      this.localDisplayStatus ^= 4;
      this._onUpdate();
    }

    get renderable() {
      return !!(this.localDisplayStatus & 1);
    }
    set renderable(value) {
      const valueNumber = value ? 1 : 0;
      if ((this.localDisplayStatus & 1) === valueNumber) return;
      this._updateFlags |= UPDATE_VISIBLE;
      this.localDisplayStatus ^= 1;
      if (this.parentRenderGroup) {
        this.parentRenderGroup.structureDidChange = true;
      }
      this._onUpdate();
    }

    get isRenderable() {
      return this.localDisplayStatus === 7 && this.groupAlpha > 0;
    }

    destroy(options = false) {
      if (this.destroyed) return;
      this.destroyed = true;
      let oldChildren;
      if (this.children.length) {
        oldChildren = this.removeChildren(0, this.children.length);
      }
      this.removeFromParent();
      this.parent = null;
      this._maskEffect = null;
      this._filterEffect = null;
      this.effects = null;
      this._position = null;
      this._scale = null;
      this._pivot = null;
      this._origin = null;
      this._skew = null;
      this.emit("destroyed", this);
      this.removeAllListeners();
      const destroyChildren = typeof options === "boolean" ? options : options?.children;
      if (destroyChildren && oldChildren) {
        for (let i2 = 0; i2 < oldChildren.length; ++i2) {
          oldChildren[i2].destroy(options);
        }
      }
      this.renderGroup?.destroy();
      this.renderGroup = null;
    }
  }
  extensions.mixin(
    Container,
    childrenHelperMixin,
    getFastGlobalBoundsMixin,
    toLocalGlobalMixin,
    onRenderMixin,
    measureMixin,
    effectsMixin,
    findMixin,
    sortMixin,
    cullingMixin,
    cacheAsTextureMixin,
    getGlobalMixin,
    collectRenderablesMixin
  );
  class ViewContainer extends Container {
    constructor(options) {
      super(options);
      this.canBundle = true;
      this.allowChildren = false;
      this._roundPixels = 0;
      this._lastUsed = -1;
      this._gpuData =                 Object.create(null);
      this.autoGarbageCollect = true;
      this._gcLastUsed = -1;
      this._bounds = new Bounds(0, 1, 0, 0);
      this._boundsDirty = true;
      this.autoGarbageCollect = options.autoGarbageCollect ?? true;
    }

    get bounds() {
      if (!this._boundsDirty) return this._bounds;
      this.updateBounds();
      this._boundsDirty = false;
      return this._bounds;
    }

    get roundPixels() {
      return !!this._roundPixels;
    }
    set roundPixels(value) {
      this._roundPixels = value ? 1 : 0;
    }

    containsPoint(point) {
      const bounds = this.bounds;
      const { x: x2, y: y2 } = point;
      return x2 >= bounds.minX && x2 <= bounds.maxX && y2 >= bounds.minY && y2 <= bounds.maxY;
    }

    onViewUpdate() {
      this._didViewChangeTick++;
      this._boundsDirty = true;
      if (this.didViewUpdate) return;
      this.didViewUpdate = true;
      const renderGroup = this.renderGroup || this.parentRenderGroup;
      if (renderGroup) {
        renderGroup.onChildViewUpdate(this);
      }
    }

    unload() {
      this.emit("unload", this);
      for (const key in this._gpuData) {
        this._gpuData[key]?.destroy();
      }
      this._gpuData =                 Object.create(null);
      this.onViewUpdate();
    }
    destroy(options) {
      this.unload();
      super.destroy(options);
      this._bounds = null;
    }

    collectRenderablesSimple(instructionSet, renderer, currentLayer) {
      const { renderPipes: renderPipes2 } = renderer;
      renderPipes2.blendMode.pushBlendMode(this, this.groupBlendMode, instructionSet);
      const rp = renderPipes2;
      const pipe = rp[this.renderPipeId];
      if (pipe?.addRenderable) {
        pipe.addRenderable(this, instructionSet);
      }
      this.didViewUpdate = false;
      const children = this.children;
      const length2 = children.length;
      for (let i2 = 0; i2 < length2; i2++) {
        children[i2].collectRenderables(instructionSet, renderer, currentLayer);
      }
      renderPipes2.blendMode.popBlendMode(instructionSet);
    }
  }
  class Sprite extends ViewContainer {

    constructor(options = Texture.EMPTY) {
      if (options instanceof Texture) {
        options = { texture: options };
      }
      const { texture = Texture.EMPTY, anchor, roundPixels, width, height, ...rest } = options;
      super({
        label: "Sprite",
        ...rest
      });
      this.renderPipeId = "sprite";
      this.batched = true;
      this._visualBounds = { minX: 0, maxX: 1, minY: 0, maxY: 0 };
      this._anchor = new ObservablePoint(
        {
          _onUpdate: () => {
            this.onViewUpdate();
          }
        }
      );
      if (anchor) {
        this.anchor = anchor;
      } else if (texture.defaultAnchor) {
        this.anchor = texture.defaultAnchor;
      }
      this.texture = texture;
      this.allowChildren = false;
      this.roundPixels = roundPixels ?? false;
      if (width !== void 0) this.width = width;
      if (height !== void 0) this.height = height;
    }

    static from(source2, skipCache = false) {
      if (source2 instanceof Texture) {
        return new Sprite(source2);
      }
      return new Sprite(Texture.from(source2, skipCache));
    }
    set texture(value) {
      value || (value = Texture.EMPTY);
      const currentTexture = this._texture;
      if (currentTexture === value) return;
      if (currentTexture && currentTexture.dynamic) currentTexture.off("update", this.onViewUpdate, this);
      if (value.dynamic) value.on("update", this.onViewUpdate, this);
      this._texture = value;
      if (this._width) {
        this._setWidth(this._width, this._texture.orig.width);
      }
      if (this._height) {
        this._setHeight(this._height, this._texture.orig.height);
      }
      this.onViewUpdate();
    }

    get texture() {
      return this._texture;
    }

    get visualBounds() {
      updateQuadBounds(this._visualBounds, this._anchor, this._texture);
      return this._visualBounds;
    }

    get sourceBounds() {
      deprecation("8.6.1", "Sprite.sourceBounds is deprecated, use visualBounds instead.");
      return this.visualBounds;
    }

    updateBounds() {
      const anchor = this._anchor;
      const texture = this._texture;
      const bounds = this._bounds;
      const { width, height } = texture.orig;
      bounds.minX = -anchor._x * width;
      bounds.maxX = bounds.minX + width;
      bounds.minY = -anchor._y * height;
      bounds.maxY = bounds.minY + height;
    }

    destroy(options = false) {
      super.destroy(options);
      const destroyTexture = typeof options === "boolean" ? options : options?.texture;
      if (destroyTexture) {
        const destroyTextureSource = typeof options === "boolean" ? options : options?.textureSource;
        this._texture.destroy(destroyTextureSource);
      }
      this._texture = null;
      this._visualBounds = null;
      this._bounds = null;
      this._anchor = null;
    }

    get anchor() {
      return this._anchor;
    }
    set anchor(value) {
      typeof value === "number" ? this._anchor.set(value) : this._anchor.copyFrom(value);
    }

    get width() {
      return Math.abs(this.scale.x) * this._texture.orig.width;
    }
    set width(value) {
      this._setWidth(value, this._texture.orig.width);
      this._width = value;
    }

    get height() {
      return Math.abs(this.scale.y) * this._texture.orig.height;
    }
    set height(value) {
      this._setHeight(value, this._texture.orig.height);
      this._height = value;
    }

    getSize(out2) {
      out2 || (out2 = {});
      out2.width = Math.abs(this.scale.x) * this._texture.orig.width;
      out2.height = Math.abs(this.scale.y) * this._texture.orig.height;
      return out2;
    }

    setSize(value, height) {
      if (typeof value === "object") {
        height = value.height ?? value.width;
        value = value.width;
      } else {
        height ?? (height = value);
      }
      value !== void 0 && this._setWidth(value, this._texture.orig.width);
      height !== void 0 && this._setHeight(height, this._texture.orig.height);
    }
  }
  const tempBounds$3 = new Bounds();
  function addMaskBounds(mask, bounds, skipUpdateTransform) {
    const boundsToMask = tempBounds$3;
    mask.measurable = true;
    getGlobalBounds(mask, skipUpdateTransform, boundsToMask);
    bounds.addBoundsMask(boundsToMask);
    mask.measurable = false;
  }
  function addMaskLocalBounds(mask, bounds, localRoot) {
    const boundsToMask = boundsPool.get();
    mask.measurable = true;
    const tempMatrix2 = matrixPool.get().identity();
    const relativeMask = getMatrixRelativeToParent(mask, localRoot, tempMatrix2);
    getLocalBounds(mask, boundsToMask, relativeMask);
    mask.measurable = false;
    bounds.addBoundsMask(boundsToMask);
    matrixPool.return(tempMatrix2);
    boundsPool.return(boundsToMask);
  }
  function getMatrixRelativeToParent(target, root, matrix) {
    if (!target) {
      warn("Mask bounds, renderable is not inside the root container");
      return matrix;
    }
    if (target !== root) {
      getMatrixRelativeToParent(target.parent, root, matrix);
      target.updateLocalTransform();
      matrix.append(target.localTransform);
    }
    return matrix;
  }
  class AlphaMask {
    constructor(options) {
      this.priority = 0;
      this.inverse = false;
      this.channel = "red";
      this.pipe = "alphaMask";
      if (options?.mask) {
        this.init(options.mask);
      }
    }
    init(mask) {
      this.mask = mask;
      this.renderMaskToTexture = !(mask instanceof Sprite);
      this.mask.renderable = this.renderMaskToTexture;
      this.mask.includeInBuild = !this.renderMaskToTexture;
      this.mask.measurable = false;
    }
    reset() {
      if (this.mask === null) return;
      this.mask.measurable = true;
      this.mask = null;
    }
    addBounds(bounds, skipUpdateTransform) {
      if (!this.inverse) {
        addMaskBounds(this.mask, bounds, skipUpdateTransform);
      }
    }
    addLocalBounds(bounds, localRoot) {
      addMaskLocalBounds(this.mask, bounds, localRoot);
    }
    containsPoint(point, hitTestFn) {
      const mask = this.mask;
      return hitTestFn(mask, point);
    }
    destroy() {
      this.reset();
    }
    static test(mask) {
      return mask instanceof Sprite;
    }
  }
  AlphaMask.extension = ExtensionType.MaskEffect;
  class ColorMask {
    constructor(options) {
      this.priority = 0;
      this.pipe = "colorMask";
      if (options?.mask) {
        this.init(options.mask);
      }
    }
    init(mask) {
      this.mask = mask;
    }
    destroy() {
    }
    static test(mask) {
      return typeof mask === "number";
    }
  }
  ColorMask.extension = ExtensionType.MaskEffect;
  class StencilMask {
    constructor(options) {
      this.priority = 0;
      this.pipe = "stencilMask";
      if (options?.mask) {
        this.init(options.mask);
      }
    }
    init(mask) {
      this.mask = mask;
      this.mask.includeInBuild = false;
      this.mask.measurable = false;
    }
    reset() {
      if (this.mask === null) return;
      this.mask.measurable = true;
      this.mask.includeInBuild = true;
      this.mask = null;
    }
    addBounds(bounds, skipUpdateTransform) {
      addMaskBounds(this.mask, bounds, skipUpdateTransform);
    }
    addLocalBounds(bounds, localRoot) {
      addMaskLocalBounds(this.mask, bounds, localRoot);
    }
    containsPoint(point, hitTestFn) {
      const mask = this.mask;
      return hitTestFn(mask, point);
    }
    destroy() {
      this.reset();
    }
    static test(mask) {
      return mask instanceof Container;
    }
  }
  StencilMask.extension = ExtensionType.MaskEffect;
  const BrowserAdapter = {
    createCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    createImage: () => new Image(),
    getCanvasRenderingContext2D: () => CanvasRenderingContext2D,
    getWebGLRenderingContext: () => WebGLRenderingContext,
    getNavigator: () => navigator,
    getBaseUrl: () => document.baseURI ?? window.location.href,
    getFontFaceSet: () => document.fonts,
    fetch: (url, options) => fetch(url, options),
    parseXML: (xml) => {
      const parser = new DOMParser();
      return parser.parseFromString(xml, "text/xml");
    }
  };
  let currentAdapter = BrowserAdapter;
  const DOMAdapter = {

    get() {
      return currentAdapter;
    },

    set(adapter) {
      currentAdapter = adapter;
    }
  };
  class CanvasSource extends TextureSource {
    constructor(options) {
      if (!options.resource) {
        options.resource = DOMAdapter.get().createCanvas();
      }
      if (!options.width) {
        options.width = options.resource.width;
        if (!options.autoDensity) {
          options.width /= options.resolution;
        }
      }
      if (!options.height) {
        options.height = options.resource.height;
        if (!options.autoDensity) {
          options.height /= options.resolution;
        }
      }
      super(options);
      this.uploadMethodId = "image";
      this.autoDensity = options.autoDensity;
      this.resizeCanvas();
      this.transparent = !!options.transparent;
    }
    resizeCanvas() {
      if (this.autoDensity && "style" in this.resource) {
        this.resource.style.width = `${this.width}px`;
        this.resource.style.height = `${this.height}px`;
      }
      if (this.resource.width !== this.pixelWidth || this.resource.height !== this.pixelHeight) {
        this.resource.width = this.pixelWidth;
        this.resource.height = this.pixelHeight;
      }
    }
    resize(width = this.width, height = this.height, resolution = this._resolution) {
      const didResize = super.resize(width, height, resolution);
      if (didResize) {
        this.resizeCanvas();
      }
      return didResize;
    }
    static test(resource) {
      return globalThis.HTMLCanvasElement && resource instanceof HTMLCanvasElement || globalThis.OffscreenCanvas && resource instanceof OffscreenCanvas;
    }

    get context2D() {
      return this._context2D || (this._context2D = this.resource.getContext("2d"));
    }
  }
  CanvasSource.extension = ExtensionType.TextureSource;
  class ImageSource extends TextureSource {
    constructor(options) {
      super(options);
      this.uploadMethodId = "image";
      this.autoGarbageCollect = true;
    }
    static test(resource) {
      return globalThis.HTMLImageElement && resource instanceof HTMLImageElement || typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap || globalThis.VideoFrame && resource instanceof VideoFrame;
    }
  }
  ImageSource.extension = ExtensionType.TextureSource;
  var UPDATE_PRIORITY =                 ((UPDATE_PRIORITY2) => {
    UPDATE_PRIORITY2[UPDATE_PRIORITY2["INTERACTION"] = 50] = "INTERACTION";
    UPDATE_PRIORITY2[UPDATE_PRIORITY2["HIGH"] = 25] = "HIGH";
    UPDATE_PRIORITY2[UPDATE_PRIORITY2["NORMAL"] = 0] = "NORMAL";
    UPDATE_PRIORITY2[UPDATE_PRIORITY2["LOW"] = -25] = "LOW";
    UPDATE_PRIORITY2[UPDATE_PRIORITY2["UTILITY"] = -50] = "UTILITY";
    return UPDATE_PRIORITY2;
  })(UPDATE_PRIORITY || {});
  class TickerListener {

    constructor(fn, context2 = null, priority = 0, once = false) {
      this.next = null;
      this.previous = null;
      this._destroyed = false;
      this._fn = fn;
      this._context = context2;
      this.priority = priority;
      this._once = once;
    }

    match(fn, context2 = null) {
      return this._fn === fn && this._context === context2;
    }

    emit(ticker) {
      if (this._fn) {
        if (this._context) {
          this._fn.call(this._context, ticker);
        } else {
          this._fn(ticker);
        }
      }
      const redirect = this.next;
      if (this._once) {
        this.destroy(true);
      }
      if (this._destroyed) {
        this.next = null;
      }
      return redirect;
    }

    connect(previous) {
      this.previous = previous;
      if (previous.next) {
        previous.next.previous = this;
      }
      this.next = previous.next;
      previous.next = this;
    }

    destroy(hard = false) {
      this._destroyed = true;
      this._fn = null;
      this._context = null;
      if (this.previous) {
        this.previous.next = this.next;
      }
      if (this.next) {
        this.next.previous = this.previous;
      }
      const redirect = this.next;
      this.next = hard ? null : redirect;
      this.previous = null;
      return redirect;
    }
  }
  const _Ticker = class _Ticker2 {
    constructor() {
      this.autoStart = false;
      this.deltaTime = 1;
      this.lastTime = -1;
      this.speed = 1;
      this.started = false;
      this._requestId = null;
      this._maxElapsedMS = 100;
      this._minElapsedMS = 0;
      this._protected = false;
      this._lastFrame = -1;
      this._head = new TickerListener(null, null, Infinity);
      this.deltaMS = 1 / _Ticker2.targetFPMS;
      this.elapsedMS = 1 / _Ticker2.targetFPMS;
      this._tick = (time) => {
        this._requestId = null;
        if (this.started) {
          this.update(time);
          if (this.started && this._requestId === null && this._head.next) {
            this._requestId = requestAnimationFrame(this._tick);
          }
        }
      };
    }

    _requestIfNeeded() {
      if (this._requestId === null && this._head.next) {
        this.lastTime = performance.now();
        this._lastFrame = this.lastTime;
        this._requestId = requestAnimationFrame(this._tick);
      }
    }

    _cancelIfNeeded() {
      if (this._requestId !== null) {
        cancelAnimationFrame(this._requestId);
        this._requestId = null;
      }
    }

    _startIfPossible() {
      if (this.started) {
        this._requestIfNeeded();
      } else if (this.autoStart) {
        this.start();
      }
    }

    add(fn, context2, priority = UPDATE_PRIORITY.NORMAL) {
      return this._addListener(new TickerListener(fn, context2, priority));
    }

    addOnce(fn, context2, priority = UPDATE_PRIORITY.NORMAL) {
      return this._addListener(new TickerListener(fn, context2, priority, true));
    }

    _addListener(listener) {
      let current = this._head.next;
      let previous = this._head;
      if (!current) {
        listener.connect(previous);
      } else {
        while (current) {
          if (listener.priority > current.priority) {
            listener.connect(previous);
            break;
          }
          previous = current;
          current = current.next;
        }
        if (!listener.previous) {
          listener.connect(previous);
        }
      }
      this._startIfPossible();
      return this;
    }

    remove(fn, context2) {
      let listener = this._head.next;
      while (listener) {
        if (listener.match(fn, context2)) {
          listener = listener.destroy();
        } else {
          listener = listener.next;
        }
      }
      if (!this._head.next) {
        this._cancelIfNeeded();
      }
      return this;
    }

    get count() {
      if (!this._head) {
        return 0;
      }
      let count2 = 0;
      let current = this._head;
      while (current = current.next) {
        count2++;
      }
      return count2;
    }

    start() {
      if (!this.started) {
        this.started = true;
        this._requestIfNeeded();
      }
    }

    stop() {
      if (this.started) {
        this.started = false;
        this._cancelIfNeeded();
      }
    }

    destroy() {
      if (!this._protected) {
        this.stop();
        let listener = this._head.next;
        while (listener) {
          listener = listener.destroy(true);
        }
        this._head.destroy();
        this._head = null;
      }
    }

    update(currentTime = performance.now()) {
      let elapsedMS;
      if (currentTime > this.lastTime) {
        elapsedMS = this.elapsedMS = currentTime - this.lastTime;
        if (elapsedMS > this._maxElapsedMS) {
          elapsedMS = this._maxElapsedMS;
        }
        elapsedMS *= this.speed;
        if (this._minElapsedMS) {
          const delta = currentTime - this._lastFrame | 0;
          if (delta < this._minElapsedMS) {
            return;
          }
          this._lastFrame = currentTime - delta % this._minElapsedMS;
        }
        this.deltaMS = elapsedMS;
        this.deltaTime = this.deltaMS * _Ticker2.targetFPMS;
        const head = this._head;
        let listener = head.next;
        while (listener) {
          listener = listener.emit(this);
        }
        if (!head.next) {
          this._cancelIfNeeded();
        }
      } else {
        this.deltaTime = this.deltaMS = this.elapsedMS = 0;
      }
      this.lastTime = currentTime;
    }

    get FPS() {
      return 1e3 / this.elapsedMS;
    }

    get minFPS() {
      return 1e3 / this._maxElapsedMS;
    }
    set minFPS(fps) {
      const minFPMS = Math.min(Math.max(0, fps) / 1e3, _Ticker2.targetFPMS);
      this._maxElapsedMS = 1 / minFPMS;
      if (this._minElapsedMS && fps > this.maxFPS) {
        this.maxFPS = fps;
      }
    }

    get maxFPS() {
      if (this._minElapsedMS) {
        return Math.round(1e3 / this._minElapsedMS);
      }
      return 0;
    }
    set maxFPS(fps) {
      if (fps === 0) {
        this._minElapsedMS = 0;
      } else {
        if (fps < this.minFPS) {
          this.minFPS = fps;
        }
        this._minElapsedMS = 1 / (fps / 1e3);
      }
    }

    static get shared() {
      if (!_Ticker2._shared) {
        const shared = _Ticker2._shared = new _Ticker2();
        shared.autoStart = true;
        shared._protected = true;
      }
      return _Ticker2._shared;
    }

    static get system() {
      if (!_Ticker2._system) {
        const system = _Ticker2._system = new _Ticker2();
        system.autoStart = true;
        system._protected = true;
      }
      return _Ticker2._system;
    }
  };
  _Ticker.targetFPMS = 0.06;
  let Ticker = _Ticker;
  let promise;
  async function detectVideoAlphaMode() {
    promise ?? (promise = (async () => {
      const canvas = DOMAdapter.get().createCanvas(1, 1);
      const gl = canvas.getContext("webgl");
      if (!gl) {
        return "premultiply-alpha-on-upload";
      }
      const video = await new Promise((resolve) => {
        const video2 = document.createElement("video");
        video2.onloadeddata = () => resolve(video2);
        video2.onerror = () => resolve(null);
        video2.autoplay = false;
        video2.crossOrigin = "anonymous";
        video2.preload = "auto";
        video2.src = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHTEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEXTbuMU6uEHFO7a1OsggG97AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBEAAAAAAAAFlSua8yuAQAAAAAAAEPXgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDglLCBArqBApqBAlPAgQFVsIRVuYEBElTDZ9Vzc9JjwItjxYgAAAAAAAAAAWfInEWjh0VOQ09ERVJEh49MYXZjIGxpYnZweC12cDlnyKJFo4hEVVJBVElPTkSHlDAwOjAwOjAwLjA0MDAwMDAwMAAAH0O2dcfngQCgwqGggQAAAIJJg0IAABAAFgA4JBwYSgAAICAAEb///4r+AAB1oZ2mm+6BAaWWgkmDQgAAEAAWADgkHBhKAAAgIABIQBxTu2uRu4+zgQC3iveBAfGCAXHwgQM=";
        video2.load();
      });
      if (!video) {
        return "premultiply-alpha-on-upload";
      }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return pixel[0] <= pixel[3] ? "premultiplied-alpha" : "premultiply-alpha-on-upload";
    })());
    return promise;
  }
  const _VideoSource = class _VideoSource2 extends TextureSource {
    constructor(options) {
      super(options);
      this.isReady = false;
      this.uploadMethodId = "video";
      options = {
        ..._VideoSource2.defaultOptions,
        ...options
      };
      this._autoUpdate = true;
      this._isConnectedToTicker = false;
      this._updateFPS = options.updateFPS || 0;
      this._msToNextUpdate = 0;
      this.autoPlay = options.autoPlay !== false;
      this.alphaMode = options.alphaMode ?? "premultiply-alpha-on-upload";
      this._videoFrameRequestCallback = this._videoFrameRequestCallback.bind(this);
      this._videoFrameRequestCallbackHandle = null;
      this._load = null;
      this._resolve = null;
      this._reject = null;
      this._onCanPlay = this._onCanPlay.bind(this);
      this._onCanPlayThrough = this._onCanPlayThrough.bind(this);
      this._onError = this._onError.bind(this);
      this._onPlayStart = this._onPlayStart.bind(this);
      this._onPlayStop = this._onPlayStop.bind(this);
      this._onSeeked = this._onSeeked.bind(this);
      this._onLoadedMetadata = this._onLoadedMetadata.bind(this);
      if (options.autoLoad !== false) {
        void this.load();
      }
    }

    updateFrame() {
      if (this.destroyed) {
        return;
      }
      if (this._updateFPS) {
        const elapsedMS = Ticker.shared.elapsedMS * this.resource.playbackRate;
        this._msToNextUpdate = Math.floor(this._msToNextUpdate - elapsedMS);
      }
      if (!this._updateFPS || this._msToNextUpdate <= 0) {
        this._msToNextUpdate = this._updateFPS ? Math.floor(1e3 / this._updateFPS) : 0;
      }
      if (this.isValid) {
        this.update();
      }
    }

    _videoFrameRequestCallback() {
      this.updateFrame();
      if (this.destroyed) {
        this._videoFrameRequestCallbackHandle = null;
      } else {
        this._videoFrameRequestCallbackHandle = this.resource.requestVideoFrameCallback(
          this._videoFrameRequestCallback
        );
      }
    }

    get isValid() {
      return !!this.resource.videoWidth && !!this.resource.videoHeight;
    }

    async load() {
      if (this._load) {
        return this._load;
      }
      const source2 = this.resource;
      const options = this.options;
      if ((source2.readyState === source2.HAVE_ENOUGH_DATA || source2.readyState === source2.HAVE_FUTURE_DATA) && source2.width && source2.height) {
        source2.complete = true;
      }
      source2.addEventListener("play", this._onPlayStart);
      source2.addEventListener("pause", this._onPlayStop);
      source2.addEventListener("seeked", this._onSeeked);
      if (!this._isSourceReady()) {
        if (!options.preload) {
          source2.addEventListener("canplay", this._onCanPlay);
        }
        source2.addEventListener("canplaythrough", this._onCanPlayThrough);
        source2.addEventListener("error", this._onError, true);
      } else {
        this._mediaReady();
      }
      if (!this.isValid) {
        source2.addEventListener("loadedmetadata", this._onLoadedMetadata);
      }
      this.alphaMode = await detectVideoAlphaMode();
      this._load = new Promise((resolve, reject) => {
        if (this.isValid) {
          resolve(this);
        } else {
          this._resolve = resolve;
          this._reject = reject;
          if (options.preloadTimeoutMs !== void 0) {
            this._preloadTimeout = setTimeout(() => {
              this._onError(new ErrorEvent(`Preload exceeded timeout of ${options.preloadTimeoutMs}ms`));
            });
          }
          source2.load();
        }
      });
      return this._load;
    }

    _onError(event) {
      this.resource.removeEventListener("error", this._onError, true);
      this.emit("error", event);
      if (this._reject) {
        this._reject(event);
        this._reject = null;
        this._resolve = null;
      }
    }

    _isSourcePlaying() {
      const source2 = this.resource;
      return !source2.paused && !source2.ended;
    }

    _isSourceReady() {
      const source2 = this.resource;
      return source2.readyState > 2;
    }

    _onPlayStart() {
      this._configureAutoUpdate();
    }

    _onPlayStop() {
      this._configureAutoUpdate();
    }

    _onSeeked() {
      if (this._autoUpdate && !this._isSourcePlaying()) {
        this._msToNextUpdate = 0;
        this.updateFrame();
        this._msToNextUpdate = 0;
      }
    }

    _onLoadedMetadata() {
      if (!this.isValid) {
        return;
      }
      this._mediaReady();
    }
    _onCanPlay() {
      const source2 = this.resource;
      source2.removeEventListener("canplay", this._onCanPlay);
      this._mediaReady();
    }
    _onCanPlayThrough() {
      const source2 = this.resource;
      source2.removeEventListener("canplaythrough", this._onCanPlayThrough);
      if (this._preloadTimeout) {
        clearTimeout(this._preloadTimeout);
        this._preloadTimeout = void 0;
      }
      this._mediaReady();
    }

    _mediaReady() {
      const source2 = this.resource;
      if (this.isValid) {
        this.isReady = true;
        this.resize(source2.videoWidth, source2.videoHeight);
      }
      this._msToNextUpdate = 0;
      this.updateFrame();
      this._msToNextUpdate = 0;
      if (this._resolve && this.isValid) {
        this._resolve(this);
        this._resolve = null;
        this._reject = null;
      }
      if (this._isSourcePlaying()) {
        this._onPlayStart();
      } else if (this.autoPlay) {
        void this.resource.play();
      }
    }

    destroy() {
      this._configureAutoUpdate();
      const source2 = this.resource;
      if (source2) {
        source2.removeEventListener("play", this._onPlayStart);
        source2.removeEventListener("pause", this._onPlayStop);
        source2.removeEventListener("seeked", this._onSeeked);
        source2.removeEventListener("canplay", this._onCanPlay);
        source2.removeEventListener("canplaythrough", this._onCanPlayThrough);
        source2.removeEventListener("loadedmetadata", this._onLoadedMetadata);
        source2.removeEventListener("error", this._onError, true);
        source2.pause();
        source2.src = "";
        source2.load();
      }
      super.destroy();
    }

    get autoUpdate() {
      return this._autoUpdate;
    }
    set autoUpdate(value) {
      if (value !== this._autoUpdate) {
        this._autoUpdate = value;
        this._configureAutoUpdate();
      }
    }

    get updateFPS() {
      return this._updateFPS;
    }
    set updateFPS(value) {
      if (value !== this._updateFPS) {
        this._updateFPS = value;
        this._configureAutoUpdate();
      }
    }

    _configureAutoUpdate() {
      if (this._autoUpdate && this._isSourcePlaying()) {
        if (!this._updateFPS && this.resource.requestVideoFrameCallback) {
          if (this._isConnectedToTicker) {
            Ticker.shared.remove(this.updateFrame, this);
            this._isConnectedToTicker = false;
            this._msToNextUpdate = 0;
          }
          if (this._videoFrameRequestCallbackHandle === null) {
            this._videoFrameRequestCallbackHandle = this.resource.requestVideoFrameCallback(
              this._videoFrameRequestCallback
            );
          }
        } else {
          if (this._videoFrameRequestCallbackHandle !== null) {
            this.resource.cancelVideoFrameCallback(this._videoFrameRequestCallbackHandle);
            this._videoFrameRequestCallbackHandle = null;
          }
          if (!this._isConnectedToTicker) {
            Ticker.shared.add(this.updateFrame, this);
            this._isConnectedToTicker = true;
            this._msToNextUpdate = 0;
          }
        }
      } else {
        if (this._videoFrameRequestCallbackHandle !== null) {
          this.resource.cancelVideoFrameCallback(this._videoFrameRequestCallbackHandle);
          this._videoFrameRequestCallbackHandle = null;
        }
        if (this._isConnectedToTicker) {
          Ticker.shared.remove(this.updateFrame, this);
          this._isConnectedToTicker = false;
          this._msToNextUpdate = 0;
        }
      }
    }
    static test(resource) {
      return globalThis.HTMLVideoElement && resource instanceof HTMLVideoElement;
    }
  };
  _VideoSource.extension = ExtensionType.TextureSource;
  _VideoSource.defaultOptions = {
    ...TextureSource.defaultOptions,

    autoLoad: true,

    autoPlay: true,

    updateFPS: 0,

    crossorigin: true,

    loop: false,

    muted: true,

    playsinline: true,

    preload: false
  };
  _VideoSource.MIME_TYPES = {
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/mp4"
  };
  let VideoSource = _VideoSource;
  const convertToList = (input, transform, forceTransform = false) => {
    if (!Array.isArray(input)) {
      input = [input];
    }
    {
      return input;
    }
  };
  class CacheClass {
    constructor() {
      this._parsers = [];
      this._cache =                 new Map();
      this._cacheMap =                 new Map();
    }

    reset() {
      this._cacheMap.clear();
      this._cache.clear();
    }

    has(key) {
      return this._cache.has(key);
    }

    get(key) {
      const result = this._cache.get(key);
      if (!result) {
        warn(`[Assets] Asset id ${key} was not found in the Cache`);
      }
      return result;
    }

    set(key, value) {
      const keys = convertToList(key);
      let cacheableAssets;
      for (let i2 = 0; i2 < this.parsers.length; i2++) {
        const parser = this.parsers[i2];
        if (parser.test(value)) {
          cacheableAssets = parser.getCacheableAssets(keys, value);
          break;
        }
      }
      const cacheableMap = new Map(Object.entries(cacheableAssets || {}));
      if (!cacheableAssets) {
        keys.forEach((key2) => {
          cacheableMap.set(key2, value);
        });
      }
      const cacheKeys = [...cacheableMap.keys()];
      const cachedAssets = {
        cacheKeys,
        keys
      };
      keys.forEach((key2) => {
        this._cacheMap.set(key2, cachedAssets);
      });
      cacheKeys.forEach((key2) => {
        const val = cacheableAssets ? cacheableAssets[key2] : value;
        if (this._cache.has(key2) && this._cache.get(key2) !== val) {
          warn("[Cache] already has key:", key2);
        }
        this._cache.set(key2, cacheableMap.get(key2));
      });
    }

    remove(key) {
      if (!this._cacheMap.has(key)) {
        warn(`[Assets] Asset id ${key} was not found in the Cache`);
        return;
      }
      const cacheMap2 = this._cacheMap.get(key);
      const cacheKeys = cacheMap2.cacheKeys;
      cacheKeys.forEach((key2) => {
        this._cache.delete(key2);
      });
      cacheMap2.keys.forEach((key2) => {
        this._cacheMap.delete(key2);
      });
    }

    get parsers() {
      return this._parsers;
    }
  }
  const Cache = new CacheClass();
  const sources = [];
  extensions.handleByList(ExtensionType.TextureSource, sources);
  function textureSourceFrom(options = {}) {
    const hasResource = options && options.resource;
    const res = hasResource ? options.resource : options;
    const opts = hasResource ? options : { resource: options };
    for (let i2 = 0; i2 < sources.length; i2++) {
      const Source = sources[i2];
      if (Source.test(res)) {
        return new Source(opts);
      }
    }
    throw new Error(`Could not find a source type for resource: ${opts.resource}`);
  }
  function resourceToTexture(options = {}, skipCache = false) {
    const hasResource = options && options.resource;
    const resource = hasResource ? options.resource : options;
    const opts = hasResource ? options : { resource: options };
    if (!skipCache && Cache.has(resource)) {
      return Cache.get(resource);
    }
    const texture = new Texture({ source: textureSourceFrom(opts) });
    texture.on("destroy", () => {
      if (Cache.has(resource)) {
        Cache.remove(resource);
      }
    });
    if (!skipCache) {
      Cache.set(resource, texture);
    }
    return texture;
  }
  function textureFrom(id, skipCache = false) {
    if (typeof id === "string") {
      return Cache.get(id);
    } else if (id instanceof TextureSource) {
      return new Texture({ source: id });
    }
    return resourceToTexture(id, skipCache);
  }
  Texture.from = textureFrom;
  TextureSource.from = textureSourceFrom;
  extensions.add(AlphaMask, ColorMask, StencilMask, VideoSource, ImageSource, CanvasSource, BufferImageSource);
  const pixiUnused =                 Object.freeze(                Object.defineProperty({
    __proto__: null
  }, Symbol.toStringTag, { value: "Module" }));
  const idCounts =                 Object.create(null);
  const idHash =                 Object.create(null);
  function createIdFromString(value, groupId) {
    let id = idHash[value];
    if (id === void 0) {
      if (idCounts[groupId] === void 0) {
        idCounts[groupId] = 1;
      }
      idHash[value] = id = idCounts[groupId]++;
    }
    return id;
  }
  let context;
  function getTestContext() {
    if (!context || context?.isContextLost()) {
      const canvas = DOMAdapter.get().createCanvas();
      context = canvas.getContext("webgl", {});
    }
    return context;
  }
  let maxFragmentPrecision;
  function getMaxFragmentPrecision() {
    if (!maxFragmentPrecision) {
      maxFragmentPrecision = "mediump";
      const gl = getTestContext();
      if (gl) {
        if (gl.getShaderPrecisionFormat) {
          const shaderFragment = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
          maxFragmentPrecision = shaderFragment.precision ? "highp" : "mediump";
        }
      }
    }
    return maxFragmentPrecision;
  }
  function addProgramDefines(src, isES300, isFragment) {
    if (isES300) return src;
    if (isFragment) {
      src = src.replace("out vec4 finalColor;", "");
      return `

        #ifdef GL_ES // This checks if it is WebGL1
        #define in varying
        #define finalColor gl_FragColor
        #define texture texture2D
        #endif
        ${src}
        `;
    }
    return `

        #ifdef GL_ES // This checks if it is WebGL1
        #define in attribute
        #define out varying
        #endif
        ${src}
        `;
  }
  function ensurePrecision(src, options, isFragment) {
    const maxSupportedPrecision = isFragment ? options.maxSupportedFragmentPrecision : options.maxSupportedVertexPrecision;
    if (src.substring(0, 9) !== "precision") {
      let precision = isFragment ? options.requestedFragmentPrecision : options.requestedVertexPrecision;
      if (precision === "highp" && maxSupportedPrecision !== "highp") {
        precision = "mediump";
      }
      return `precision ${precision} float;
${src}`;
    } else if (maxSupportedPrecision !== "highp" && src.substring(0, 15) === "precision highp") {
      return src.replace("precision highp", "precision mediump");
    }
    return src;
  }
  function insertVersion(src, isES300) {
    if (!isES300) return src;
    return `#version 300 es
${src}`;
  }
  const fragmentNameCache = {};
  const VertexNameCache = {};
  function setProgramName(src, { name = `pixi-program` }, isFragment = true) {
    name = name.replace(/\s+/g, "-");
    name += isFragment ? "-fragment" : "-vertex";
    const nameCache = isFragment ? fragmentNameCache : VertexNameCache;
    if (nameCache[name]) {
      nameCache[name]++;
      name += `-${nameCache[name]}`;
    } else {
      nameCache[name] = 1;
    }
    if (src.indexOf("#define SHADER_NAME") !== -1) return src;
    const shaderName = `#define SHADER_NAME ${name}`;
    return `${shaderName}
${src}`;
  }
  function stripVersion(src, isES300) {
    if (!isES300) return src;
    return src.replace("#version 300 es", "");
  }
  const processes = {

    stripVersion,

    ensurePrecision,

    addProgramDefines,

    setProgramName,

    insertVersion
  };
  const programCache$1 =                 Object.create(null);
  const _GlProgram = class _GlProgram2 {

    constructor(options) {
      options = { ..._GlProgram2.defaultOptions, ...options };
      const isES300 = options.fragment.indexOf("#version 300 es") !== -1;
      const preprocessorOptions = {
        stripVersion: isES300,
        ensurePrecision: {
          requestedFragmentPrecision: options.preferredFragmentPrecision,
          requestedVertexPrecision: options.preferredVertexPrecision,
          maxSupportedVertexPrecision: "highp",
          maxSupportedFragmentPrecision: getMaxFragmentPrecision()
        },
        setProgramName: {
          name: options.name
        },
        addProgramDefines: isES300,
        insertVersion: isES300
      };
      let fragment2 = options.fragment;
      let vertex2 = options.vertex;
      Object.keys(processes).forEach((processKey) => {
        const processOptions = preprocessorOptions[processKey];
        fragment2 = processes[processKey](fragment2, processOptions, true);
        vertex2 = processes[processKey](vertex2, processOptions, false);
      });
      this.fragment = fragment2;
      this.vertex = vertex2;
      this.transformFeedbackVaryings = options.transformFeedbackVaryings;
      this._key = createIdFromString(`${this.vertex}:${this.fragment}`, "gl-program");
    }

    destroy() {
      this.fragment = null;
      this.vertex = null;
      this._attributeData = null;
      this._uniformData = null;
      this._uniformBlockData = null;
      this.transformFeedbackVaryings = null;
      programCache$1[this._cacheKey] = null;
    }

    static from(options) {
      const key = `${options.vertex}:${options.fragment}`;
      if (!programCache$1[key]) {
        programCache$1[key] = new _GlProgram2(options);
        programCache$1[key]._cacheKey = key;
      }
      return programCache$1[key];
    }
  };
  _GlProgram.defaultOptions = {
    preferredVertexPrecision: "highp",
    preferredFragmentPrecision: "mediump"
  };
  let GlProgram = _GlProgram;
  const attributeFormatData = {
    uint8x2: { size: 2, stride: 2, normalised: false },
    uint8x4: { size: 4, stride: 4, normalised: false },
    sint8x2: { size: 2, stride: 2, normalised: false },
    sint8x4: { size: 4, stride: 4, normalised: false },
    unorm8x2: { size: 2, stride: 2, normalised: true },
    unorm8x4: { size: 4, stride: 4, normalised: true },
    snorm8x2: { size: 2, stride: 2, normalised: true },
    snorm8x4: { size: 4, stride: 4, normalised: true },
    uint16x2: { size: 2, stride: 4, normalised: false },
    uint16x4: { size: 4, stride: 8, normalised: false },
    sint16x2: { size: 2, stride: 4, normalised: false },
    sint16x4: { size: 4, stride: 8, normalised: false },
    unorm16x2: { size: 2, stride: 4, normalised: true },
    unorm16x4: { size: 4, stride: 8, normalised: true },
    snorm16x2: { size: 2, stride: 4, normalised: true },
    snorm16x4: { size: 4, stride: 8, normalised: true },
    float16x2: { size: 2, stride: 4, normalised: false },
    float16x4: { size: 4, stride: 8, normalised: false },
    float32: { size: 1, stride: 4, normalised: false },
    float32x2: { size: 2, stride: 8, normalised: false },
    float32x3: { size: 3, stride: 12, normalised: false },
    float32x4: { size: 4, stride: 16, normalised: false },
    uint32: { size: 1, stride: 4, normalised: false },
    uint32x2: { size: 2, stride: 8, normalised: false },
    uint32x3: { size: 3, stride: 12, normalised: false },
    uint32x4: { size: 4, stride: 16, normalised: false },
    sint32: { size: 1, stride: 4, normalised: false },
    sint32x2: { size: 2, stride: 8, normalised: false },
    sint32x3: { size: 3, stride: 12, normalised: false },
    sint32x4: { size: 4, stride: 16, normalised: false }
  };
  function getAttributeInfoFromFormat(format) {
    return attributeFormatData[format] ?? attributeFormatData.float32;
  }
  const WGSL_TO_VERTEX_TYPES = {
    f32: "float32",
    "vec2<f32>": "float32x2",
    "vec3<f32>": "float32x3",
    "vec4<f32>": "float32x4",
    vec2f: "float32x2",
    vec3f: "float32x3",
    vec4f: "float32x4",
    i32: "sint32",
    "vec2<i32>": "sint32x2",
    "vec3<i32>": "sint32x3",
    "vec4<i32>": "sint32x4",
    vec2i: "sint32x2",
    vec3i: "sint32x3",
    vec4i: "sint32x4",
    u32: "uint32",
    "vec2<u32>": "uint32x2",
    "vec3<u32>": "uint32x3",
    "vec4<u32>": "uint32x4",
    vec2u: "uint32x2",
    vec3u: "uint32x3",
    vec4u: "uint32x4",
    bool: "uint32",
    "vec2<bool>": "uint32x2",
    "vec3<bool>": "uint32x3",
    "vec4<bool>": "uint32x4"
  };
  const LOCATION_REGEX = /@location\((\d+)\)\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_<>]+)(?:,|\s|\)|$)/g;
  function parseLocations(str, results) {
    let match;
    while ((match = LOCATION_REGEX.exec(str)) !== null) {
      const format = WGSL_TO_VERTEX_TYPES[match[3]] ?? "float32";
      results[match[2]] = {
        location: parseInt(match[1], 10),
        format,
        stride: getAttributeInfoFromFormat(format).stride,
        offset: 0,
        instance: false,
        start: 0
      };
    }
    LOCATION_REGEX.lastIndex = 0;
  }
  function stripComments(source2) {
    return source2.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  }
  function extractAttributesFromGpuProgram({ source: source2, entryPoint }) {
    const results = {};
    const cleanSource = stripComments(source2);
    const mainVertStart = cleanSource.indexOf(`fn ${entryPoint}(`);
    if (mainVertStart === -1) {
      return results;
    }
    const arrowFunctionStart = cleanSource.indexOf("->", mainVertStart);
    if (arrowFunctionStart === -1) {
      return results;
    }
    const functionArgsSubstring = cleanSource.substring(mainVertStart, arrowFunctionStart);
    parseLocations(functionArgsSubstring, results);
    if (Object.keys(results).length === 0) {
      const structMatch = functionArgsSubstring.match(/\(\s*\w+\s*:\s*(\w+)/);
      if (structMatch) {
        const structName = structMatch[1];
        const structRegex = new RegExp(`struct\\s+${structName}\\s*\\{([^}]+)\\}`, "s");
        const structBody = cleanSource.match(structRegex);
        if (structBody) {
          parseLocations(structBody[1], results);
        }
      }
    }
    return results;
  }
  function extractStructAndGroups(wgsl) {
    const linePattern = /(^|[^/])@(group|binding)\(\d+\)[^;]+;/g;
    const groupPattern = /@group\((\d+)\)/;
    const bindingPattern = /@binding\((\d+)\)/;
    const namePattern = /var(<[^>]+>)? (\w+)/;
    const typePattern = /:\s*([\w<>]+)/;
    const structPattern = /struct\s+(\w+)\s*{([^}]+)}/g;
    const structMemberPattern = /(\w+)\s*:\s*([\w\<\>]+)/g;
    const structName = /struct\s+(\w+)/;
    const groups = wgsl.match(linePattern)?.map((item) => ({
      group: parseInt(item.match(groupPattern)[1], 10),
      binding: parseInt(item.match(bindingPattern)[1], 10),
      name: item.match(namePattern)[2],
      isUniform: item.match(namePattern)[1] === "<uniform>",
      type: item.match(typePattern)[1]
    }));
    if (!groups) {
      return {
        groups: [],
        structs: []
      };
    }
    const structs = wgsl.match(structPattern)?.map((struct) => {
      const name = struct.match(structName)[1];
      const members = struct.match(structMemberPattern).reduce((acc, member) => {
        const [name2, type] = member.split(":");
        acc[name2.trim()] = type.trim();
        return acc;
      }, {});
      if (!members) {
        return null;
      }
      return { name, members };
    }).filter(({ name }) => groups.some(
      (group) => (

        group.type === name || group.type.includes(`<${name}>`)
      )
    )) ?? [];
    return {
      groups,
      structs
    };
  }
  var ShaderStage =                 ((ShaderStage2) => {
    ShaderStage2[ShaderStage2["VERTEX"] = 1] = "VERTEX";
    ShaderStage2[ShaderStage2["FRAGMENT"] = 2] = "FRAGMENT";
    ShaderStage2[ShaderStage2["COMPUTE"] = 4] = "COMPUTE";
    return ShaderStage2;
  })(ShaderStage || {});
  function generateGpuLayoutGroups({ groups }) {
    const layout = [];
    for (let i2 = 0; i2 < groups.length; i2++) {
      const group = groups[i2];
      if (!layout[group.group]) {
        layout[group.group] = [];
      }
      if (group.isUniform) {
        layout[group.group].push({
          binding: group.binding,
          visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT,
          buffer: {
            type: "uniform"
          }
        });
      } else if (group.type === "sampler") {
        layout[group.group].push({
          binding: group.binding,
          visibility: ShaderStage.FRAGMENT,
          sampler: {
            type: "filtering"
          }
        });
      } else if (group.type === "texture_2d" || group.type.startsWith("texture_2d<")) {
        layout[group.group].push({
          binding: group.binding,
          visibility: ShaderStage.FRAGMENT,
          texture: {
            sampleType: "float",
            viewDimension: "2d",
            multisampled: false
          }
        });
      } else if (group.type === "texture_2d_array" || group.type.startsWith("texture_2d_array<")) {
        layout[group.group].push({
          binding: group.binding,
          visibility: ShaderStage.FRAGMENT,
          texture: {
            sampleType: "float",
            viewDimension: "2d-array",
            multisampled: false
          }
        });
      } else if (group.type === "texture_cube" || group.type.startsWith("texture_cube<")) {
        layout[group.group].push({
          binding: group.binding,
          visibility: ShaderStage.FRAGMENT,
          texture: {
            sampleType: "float",
            viewDimension: "cube",
            multisampled: false
          }
        });
      }
    }
    for (let i2 = 0; i2 < layout.length; i2++) {
      layout[i2] || (layout[i2] = []);
    }
    return layout;
  }
  function generateLayoutHash({ groups }) {
    const layout = [];
    for (let i2 = 0; i2 < groups.length; i2++) {
      const group = groups[i2];
      if (!layout[group.group]) {
        layout[group.group] = {};
      }
      layout[group.group][group.name] = group.binding;
    }
    return layout;
  }
  function removeStructAndGroupDuplicates(vertexStructsAndGroups, fragmentStructsAndGroups) {
    const structNameSet =                 new Set();
    const dupeGroupKeySet =                 new Set();
    const structs = [...vertexStructsAndGroups.structs, ...fragmentStructsAndGroups.structs].filter((struct) => {
      if (structNameSet.has(struct.name)) {
        return false;
      }
      structNameSet.add(struct.name);
      return true;
    });
    const groups = [...vertexStructsAndGroups.groups, ...fragmentStructsAndGroups.groups].filter((group) => {
      const key = `${group.name}-${group.binding}`;
      if (dupeGroupKeySet.has(key)) {
        return false;
      }
      dupeGroupKeySet.add(key);
      return true;
    });
    return { structs, groups };
  }
  const programCache =                 Object.create(null);
  class GpuProgram {

    constructor(options) {
      this._layoutKey = 0;
      this._attributeLocationsKey = 0;
      const { fragment: fragment2, vertex: vertex2, layout, gpuLayout, name } = options;
      this.name = name;
      this.fragment = fragment2;
      this.vertex = vertex2;
      if (fragment2.source === vertex2.source) {
        const structsAndGroups = extractStructAndGroups(fragment2.source);
        this.structsAndGroups = structsAndGroups;
      } else {
        const vertexStructsAndGroups = extractStructAndGroups(vertex2.source);
        const fragmentStructsAndGroups = extractStructAndGroups(fragment2.source);
        this.structsAndGroups = removeStructAndGroupDuplicates(vertexStructsAndGroups, fragmentStructsAndGroups);
      }
      this.layout = layout ?? generateLayoutHash(this.structsAndGroups);
      this.gpuLayout = gpuLayout ?? generateGpuLayoutGroups(this.structsAndGroups);
      this.autoAssignGlobalUniforms = !!(this.layout[0]?.globalUniforms !== void 0);
      this.autoAssignLocalUniforms = !!(this.layout[1]?.localUniforms !== void 0);
      this._generateProgramKey();
    }

    _generateProgramKey() {
      const { vertex: vertex2, fragment: fragment2 } = this;
      const bigKey = vertex2.source + fragment2.source + vertex2.entryPoint + fragment2.entryPoint;
      this._layoutKey = createIdFromString(bigKey, "program");
    }
    get attributeData() {
      this._attributeData ?? (this._attributeData = extractAttributesFromGpuProgram(this.vertex));
      return this._attributeData;
    }

    destroy() {
      this.gpuLayout = null;
      this.layout = null;
      this.structsAndGroups = null;
      this.fragment = null;
      this.vertex = null;
      programCache[this._cacheKey] = null;
    }

    static from(options) {
      const key = `${options.vertex.source}:${options.fragment.source}:${options.fragment.entryPoint}:${options.vertex.entryPoint}`;
      if (!programCache[key]) {
        programCache[key] = new GpuProgram(options);
        programCache[key]._cacheKey = key;
      }
      return programCache[key];
    }
  }
  const UNIFORM_TYPES_VALUES = [
    "f32",
    "i32",
    "vec2<f32>",
    "vec3<f32>",
    "vec4<f32>",
    "mat2x2<f32>",
    "mat3x3<f32>",
    "mat4x4<f32>",
    "mat3x2<f32>",
    "mat4x2<f32>",
    "mat2x3<f32>",
    "mat4x3<f32>",
    "mat2x4<f32>",
    "mat3x4<f32>",
    "vec2<i32>",
    "vec3<i32>",
    "vec4<i32>"
  ];
  const UNIFORM_TYPES_MAP = UNIFORM_TYPES_VALUES.reduce((acc, type) => {
    acc[type] = true;
    return acc;
  }, {});
  function getDefaultUniformValue(type, size) {
    switch (type) {
      case "f32":
        return 0;
      case "vec2<f32>":
        return new Float32Array(2 * size);
      case "vec3<f32>":
        return new Float32Array(3 * size);
      case "vec4<f32>":
        return new Float32Array(4 * size);
      case "mat2x2<f32>":
        return new Float32Array([
          1,
          0,
          0,
          1
        ]);
      case "mat3x3<f32>":
        return new Float32Array([
          1,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          1
        ]);
      case "mat4x4<f32>":
        return new Float32Array([
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ]);
    }
    return null;
  }
  const _UniformGroup = class _UniformGroup2 {

    constructor(uniformStructures, options) {
      this._touched = 0;
      this.uid = uid$1("uniform");
      this._resourceType = "uniformGroup";
      this._resourceId = uid$1("resource");
      this.isUniformGroup = true;
      this._dirtyId = 0;
      this.destroyed = false;
      options = { ..._UniformGroup2.defaultOptions, ...options };
      this.uniformStructures = uniformStructures;
      const uniforms = {};
      for (const i2 in uniformStructures) {
        const uniformData = uniformStructures[i2];
        uniformData.name = i2;
        uniformData.size = uniformData.size ?? 1;
        if (!UNIFORM_TYPES_MAP[uniformData.type]) {
          const arrayMatch = uniformData.type.match(/^array<(\w+(?:<\w+>)?),\s*(\d+)>$/);
          if (arrayMatch) {
            const [, innerType, size] = arrayMatch;
            throw new Error(
              `Uniform type ${uniformData.type} is not supported. Use type: '${innerType}', size: ${size} instead.`
            );
          }
          throw new Error(`Uniform type ${uniformData.type} is not supported. Supported uniform types are: ${UNIFORM_TYPES_VALUES.join(", ")}`);
        }
        uniformData.value ?? (uniformData.value = getDefaultUniformValue(uniformData.type, uniformData.size));
        uniforms[i2] = uniformData.value;
      }
      this.uniforms = uniforms;
      this._dirtyId = 1;
      this.ubo = options.ubo;
      this.isStatic = options.isStatic;
      this._signature = createIdFromString(Object.keys(uniforms).map(
        (i2) => `${i2}-${uniformStructures[i2].type}`
      ).join("-"), "uniform-group");
    }

    update() {
      this._dirtyId++;
    }
  };
  _UniformGroup.defaultOptions = {

    ubo: false,

    isStatic: false
  };
  let UniformGroup = _UniformGroup;
  class BindGroup {

    constructor(resources) {
      this.resources =                 Object.create(null);
      this._dirty = true;
      let index = 0;
      for (const i2 in resources) {
        const resource = resources[i2];
        this.setResource(resource, index++);
      }
      this._updateKey();
    }

    _updateKey() {
      if (!this._dirty) return;
      this._dirty = false;
      const keyParts = [];
      let index = 0;
      for (const i2 in this.resources) {
        keyParts[index++] = this.resources[i2]._resourceId;
      }
      this._key = keyParts.join("|");
    }

    setResource(resource, index) {
      const currentResource = this.resources[index];
      if (resource === currentResource) return;
      currentResource?.off?.("change", this.onResourceChange, this);
      resource.on?.("change", this.onResourceChange, this);
      this.resources[index] = resource;
      this._dirty = true;
    }

    getResource(index) {
      return this.resources[index];
    }

    _touch(now, tick) {
      const resources = this.resources;
      for (const i2 in resources) {
        resources[i2]._gcLastUsed = now;
        resources[i2]._touched = tick;
      }
    }

    destroy() {
      const resources = this.resources;
      for (const i2 in resources) {
        const resource = resources[i2];
        resource?.off?.("change", this.onResourceChange, this);
      }
      this.resources = null;
    }
    onResourceChange(resource) {
      this._dirty = true;
      if (resource.destroyed) {
        this.destroy();
      } else {
        this._updateKey();
      }
    }
  }
  var RendererType =                 ((RendererType2) => {
    RendererType2[RendererType2["WEBGL"] = 1] = "WEBGL";
    RendererType2[RendererType2["WEBGPU"] = 2] = "WEBGPU";
    RendererType2[RendererType2["CANVAS"] = 4] = "CANVAS";
    RendererType2[RendererType2["BOTH"] = 3] = "BOTH";
    return RendererType2;
  })(RendererType || {});
  class Shader extends EventEmitter {
    constructor(options) {
      super();
      this.uid = uid$1("shader");
      this._uniformBindMap =                 Object.create(null);
      this._ownedBindGroups = [];
      this._destroyed = false;
      let {
        gpuProgram,
        glProgram,
        groups,
        resources,
        compatibleRenderers,
        groupMap
      } = options;
      this.gpuProgram = gpuProgram;
      this.glProgram = glProgram;
      if (compatibleRenderers === void 0) {
        compatibleRenderers = 0;
        if (gpuProgram) compatibleRenderers |= RendererType.WEBGPU;
        if (glProgram) compatibleRenderers |= RendererType.WEBGL;
      }
      this.compatibleRenderers = compatibleRenderers;
      const nameHash = {};
      if (!resources && !groups) {
        resources = {};
      }
      if (resources && groups) {
        throw new Error("[Shader] Cannot have both resources and groups");
      } else if (!gpuProgram && groups && !groupMap) {
        throw new Error("[Shader] No group map or WebGPU shader provided - consider using resources instead.");
      } else if (!gpuProgram && groups && groupMap) {
        for (const i2 in groupMap) {
          for (const j2 in groupMap[i2]) {
            const uniformName = groupMap[i2][j2];
            nameHash[uniformName] = {
              group: i2,
              binding: j2,
              name: uniformName
            };
          }
        }
      } else if (gpuProgram && groups && !groupMap) {
        const groupData = gpuProgram.structsAndGroups.groups;
        groupMap = {};
        groupData.forEach((data) => {
          groupMap[data.group] = groupMap[data.group] || {};
          groupMap[data.group][data.binding] = data.name;
          nameHash[data.name] = data;
        });
      } else if (resources) {
        groups = {};
        groupMap = {};
        if (gpuProgram) {
          const groupData = gpuProgram.structsAndGroups.groups;
          groupData.forEach((data) => {
            groupMap[data.group] = groupMap[data.group] || {};
            groupMap[data.group][data.binding] = data.name;
            nameHash[data.name] = data;
          });
        }
        let bindTick = 0;
        for (const i2 in resources) {
          if (nameHash[i2]) continue;
          if (!groups[99]) {
            groups[99] = new BindGroup();
            this._ownedBindGroups.push(groups[99]);
          }
          nameHash[i2] = { group: 99, binding: bindTick, name: i2 };
          groupMap[99] = groupMap[99] || {};
          groupMap[99][bindTick] = i2;
          bindTick++;
        }
        for (const i2 in resources) {
          const name = i2;
          let value = resources[i2];
          if (!value.source && !value._resourceType) {
            value = new UniformGroup(value);
          }
          const data = nameHash[name];
          if (data) {
            if (!groups[data.group]) {
              groups[data.group] = new BindGroup();
              this._ownedBindGroups.push(groups[data.group]);
            }
            groups[data.group].setResource(value, data.binding);
          }
        }
      }
      this.groups = groups;
      this._uniformBindMap = groupMap;
      this.resources = this._buildResourceAccessor(groups, nameHash);
    }

    addResource(name, groupIndex, bindIndex) {
      var _a, _b;
      (_a = this._uniformBindMap)[groupIndex] || (_a[groupIndex] = {});
      (_b = this._uniformBindMap[groupIndex])[bindIndex] || (_b[bindIndex] = name);
      if (!this.groups[groupIndex]) {
        this.groups[groupIndex] = new BindGroup();
        this._ownedBindGroups.push(this.groups[groupIndex]);
      }
    }
    _buildResourceAccessor(groups, nameHash) {
      const uniformsOut = {};
      for (const i2 in nameHash) {
        const data = nameHash[i2];
        Object.defineProperty(uniformsOut, data.name, {
          get() {
            return groups[data.group].getResource(data.binding);
          },
          set(value) {
            groups[data.group].setResource(value, data.binding);
          }
        });
      }
      return uniformsOut;
    }

    destroy(destroyPrograms = false) {
      if (this._destroyed) return;
      this._destroyed = true;
      this.emit("destroy", this);
      if (destroyPrograms) {
        this.gpuProgram?.destroy();
        this.glProgram?.destroy();
      }
      this.gpuProgram = null;
      this.glProgram = null;
      this.removeAllListeners();
      this._uniformBindMap = null;
      this._ownedBindGroups.forEach((bindGroup) => {
        bindGroup.destroy();
      });
      this._ownedBindGroups = null;
      this.resources = null;
      this.groups = null;
    }
    static from(options) {
      const { gpu, gl, ...rest } = options;
      let gpuProgram;
      let glProgram;
      if (gpu) {
        gpuProgram = GpuProgram.from(gpu);
      }
      if (gl) {
        glProgram = GlProgram.from(gl);
      }
      return new Shader({
        gpuProgram,
        glProgram,
        ...rest
      });
    }
  }
  const blendModeIds = {
    normal: 0,
    add: 1,
    multiply: 2,
    screen: 3,
    overlay: 4,
    erase: 5,
    "normal-npm": 6,
    "add-npm": 7,
    "screen-npm": 8,
    min: 9,
    max: 10
  };
  const BLEND$1 = 0;
  const OFFSET$1 = 1;
  const CULLING$1 = 2;
  const DEPTH_TEST$1 = 3;
  const WINDING$1 = 4;
  const DEPTH_MASK$1 = 5;
  const _State = class _State2 {
    constructor() {
      this.data = 0;
      this.blendMode = "normal";
      this.polygonOffset = 0;
      this.blend = true;
      this.depthMask = true;
    }

    get blend() {
      return !!(this.data & 1 << BLEND$1);
    }
    set blend(value) {
      if (!!(this.data & 1 << BLEND$1) !== value) {
        this.data ^= 1 << BLEND$1;
      }
    }

    get offsets() {
      return !!(this.data & 1 << OFFSET$1);
    }
    set offsets(value) {
      if (!!(this.data & 1 << OFFSET$1) !== value) {
        this.data ^= 1 << OFFSET$1;
      }
    }

    set cullMode(value) {
      if (value === "none") {
        this.culling = false;
        return;
      }
      this.culling = true;
      this.clockwiseFrontFace = value === "front";
    }
    get cullMode() {
      if (!this.culling) {
        return "none";
      }
      return this.clockwiseFrontFace ? "front" : "back";
    }

    get culling() {
      return !!(this.data & 1 << CULLING$1);
    }
    set culling(value) {
      if (!!(this.data & 1 << CULLING$1) !== value) {
        this.data ^= 1 << CULLING$1;
      }
    }

    get depthTest() {
      return !!(this.data & 1 << DEPTH_TEST$1);
    }
    set depthTest(value) {
      if (!!(this.data & 1 << DEPTH_TEST$1) !== value) {
        this.data ^= 1 << DEPTH_TEST$1;
      }
    }

    get depthMask() {
      return !!(this.data & 1 << DEPTH_MASK$1);
    }
    set depthMask(value) {
      if (!!(this.data & 1 << DEPTH_MASK$1) !== value) {
        this.data ^= 1 << DEPTH_MASK$1;
      }
    }

    get clockwiseFrontFace() {
      return !!(this.data & 1 << WINDING$1);
    }
    set clockwiseFrontFace(value) {
      if (!!(this.data & 1 << WINDING$1) !== value) {
        this.data ^= 1 << WINDING$1;
      }
    }

    get blendMode() {
      return this._blendMode;
    }
    set blendMode(value) {
      this.blend = value !== "none";
      this._blendMode = value;
      this._blendModeId = blendModeIds[value] || 0;
    }

    get polygonOffset() {
      return this._polygonOffset;
    }
    set polygonOffset(value) {
      this.offsets = !!value;
      this._polygonOffset = value;
    }
    toString() {
      return `[pixi.js/core:State blendMode=${this.blendMode} clockwiseFrontFace=${this.clockwiseFrontFace} culling=${this.culling} depthMask=${this.depthMask} polygonOffset=${this.polygonOffset}]`;
    }

    static for2d() {
      const state = new _State2();
      state.depthTest = false;
      state.blend = true;
      return state;
    }
  };
  _State.default2d = _State.for2d();
  let State = _State;
  const _Filter = class _Filter2 extends Shader {

    constructor(options) {
      options = { ..._Filter2.defaultOptions, ...options };
      super(options);
      this.enabled = true;
      this._state = State.for2d();
      this.blendMode = options.blendMode;
      this.padding = options.padding;
      if (typeof options.antialias === "boolean") {
        this.antialias = options.antialias ? "on" : "off";
      } else {
        this.antialias = options.antialias;
      }
      this.resolution = options.resolution;
      this.blendRequired = options.blendRequired;
      this.clipToViewport = options.clipToViewport;
      this.addResource("uTexture", 0, 1);
      if (options.blendRequired) {
        this.addResource("uBackTexture", 0, 3);
      }
    }

    apply(filterManager, input, output, clearMode) {
      filterManager.applyFilter(this, input, output, clearMode);
    }

    get blendMode() {
      return this._state.blendMode;
    }

    set blendMode(value) {
      this._state.blendMode = value;
    }

    static from(options) {
      const { gpu, gl, ...rest } = options;
      let gpuProgram;
      let glProgram;
      if (gpu) {
        gpuProgram = GpuProgram.from(gpu);
      }
      if (gl) {
        glProgram = GlProgram.from(gl);
      }
      return new _Filter2({
        gpuProgram,
        glProgram,
        ...rest
      });
    }
  };
  _Filter.defaultOptions = {
    blendMode: "normal",
    resolution: 1,
    padding: 0,
    antialias: "off",
    blendRequired: false,
    clipToViewport: true
  };
  let Filter = _Filter;
  const environments = [];
  extensions.handleByNamedList(ExtensionType.Environment, environments);
  async function loadEnvironmentExtensions(skip) {
    if (skip) return;
    for (let i2 = 0; i2 < environments.length; i2++) {
      const env = environments[i2];
      if (env.value.test()) {
        await env.value.load();
        return;
      }
    }
  }
  let unsafeEval;
  function unsafeEvalSupported() {
    if (typeof unsafeEval === "boolean") {
      return unsafeEval;
    }
    try {
      const func = new Function("param1", "param2", "param3", "return param1[param2] === param3;");
      unsafeEval = func({ a: "b" }, "a", "b") === true;
    } catch (_e) {
      unsafeEval = false;
    }
    return unsafeEval;
  }
  function earcut$1(data, holeIndices, dim = 2) {
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    let outerNode = linkedList(data, 0, outerLen, dim, true);
    const triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    let minX, minY, invSize;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = data[0];
      minY = data[1];
      let maxX = minX;
      let maxY = minY;
      for (let i2 = dim; i2 < outerLen; i2 += dim) {
        const x2 = data[i2];
        const y2 = data[i2 + 1];
        if (x2 < minX) minX = x2;
        if (y2 < minY) minY = y2;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
      invSize = Math.max(maxX - minX, maxY - minY);
      invSize = invSize !== 0 ? 32767 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
    return triangles;
  }
  function linkedList(data, start2, end, dim, clockwise) {
    let last;
    if (clockwise === signedArea(data, start2, end, dim) > 0) {
      for (let i2 = start2; i2 < end; i2 += dim) last = insertNode(i2 / dim | 0, data[i2], data[i2 + 1], last);
    } else {
      for (let i2 = end - dim; i2 >= start2; i2 -= dim) last = insertNode(i2 / dim | 0, data[i2], data[i2 + 1], last);
    }
    if (last && equals(last, last.next)) {
      removeNode(last);
      last = last.next;
    }
    return last;
  }
  function filterPoints(start2, end) {
    if (!start2) return start2;
    if (!end) end = start2;
    let p2 = start2, again;
    do {
      again = false;
      if (!p2.steiner && (equals(p2, p2.next) || area(p2.prev, p2, p2.next) === 0)) {
        removeNode(p2);
        p2 = end = p2.prev;
        if (p2 === p2.next) break;
        again = true;
      } else {
        p2 = p2.next;
      }
    } while (again || p2 !== end);
    return end;
  }
  function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    let stop2 = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev;
      const next = ear.next;
      if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
        triangles.push(prev.i, ear.i, next.i);
        removeNode(ear);
        ear = next.next;
        stop2 = next.next;
        continue;
      }
      ear = next;
      if (ear === stop2) {
        if (!pass) {
          earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
        } else if (pass === 1) {
          ear = cureLocalIntersections(filterPoints(ear), triangles);
          earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
        } else if (pass === 2) {
          splitEarcut(ear, triangles, dim, minX, minY, invSize);
        }
        break;
      }
    }
  }
  function isEar(ear) {
    const a2 = ear.prev, b2 = ear, c2 = ear.next;
    if (area(a2, b2, c2) >= 0) return false;
    const ax = a2.x, bx = b2.x, cx = c2.x, ay = a2.y, by = b2.y, cy = c2.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    let p2 = c2.next;
    while (p2 !== a2) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.next;
    }
    return true;
  }
  function isEarHashed(ear, minX, minY, invSize) {
    const a2 = ear.prev, b2 = ear, c2 = ear.next;
    if (area(a2, b2, c2) >= 0) return false;
    const ax = a2.x, bx = b2.x, cx = c2.x, ay = a2.y, by = b2.y, cy = c2.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
    let p2 = ear.prevZ, n2 = ear.nextZ;
    while (p2 && p2.z >= minZ && n2 && n2.z <= maxZ) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && p2 !== a2 && p2 !== c2 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.prevZ;
      if (n2.x >= x0 && n2.x <= x1 && n2.y >= y0 && n2.y <= y1 && n2 !== a2 && n2 !== c2 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n2.x, n2.y) && area(n2.prev, n2, n2.next) >= 0) return false;
      n2 = n2.nextZ;
    }
    while (p2 && p2.z >= minZ) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && p2 !== a2 && p2 !== c2 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.prevZ;
    }
    while (n2 && n2.z <= maxZ) {
      if (n2.x >= x0 && n2.x <= x1 && n2.y >= y0 && n2.y <= y1 && n2 !== a2 && n2 !== c2 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n2.x, n2.y) && area(n2.prev, n2, n2.next) >= 0) return false;
      n2 = n2.nextZ;
    }
    return true;
  }
  function cureLocalIntersections(start2, triangles) {
    let p2 = start2;
    do {
      const a2 = p2.prev, b2 = p2.next.next;
      if (!equals(a2, b2) && intersects(a2, p2, p2.next, b2) && locallyInside(a2, b2) && locallyInside(b2, a2)) {
        triangles.push(a2.i, p2.i, b2.i);
        removeNode(p2);
        removeNode(p2.next);
        p2 = start2 = b2;
      }
      p2 = p2.next;
    } while (p2 !== start2);
    return filterPoints(p2);
  }
  function splitEarcut(start2, triangles, dim, minX, minY, invSize) {
    let a2 = start2;
    do {
      let b2 = a2.next.next;
      while (b2 !== a2.prev) {
        if (a2.i !== b2.i && isValidDiagonal(a2, b2)) {
          let c2 = splitPolygon(a2, b2);
          a2 = filterPoints(a2, a2.next);
          c2 = filterPoints(c2, c2.next);
          earcutLinked(a2, triangles, dim, minX, minY, invSize, 0);
          earcutLinked(c2, triangles, dim, minX, minY, invSize, 0);
          return;
        }
        b2 = b2.next;
      }
      a2 = a2.next;
    } while (a2 !== start2);
  }
  function eliminateHoles(data, holeIndices, outerNode, dim) {
    const queue = [];
    for (let i2 = 0, len = holeIndices.length; i2 < len; i2++) {
      const start2 = holeIndices[i2] * dim;
      const end = i2 < len - 1 ? holeIndices[i2 + 1] * dim : data.length;
      const list = linkedList(data, start2, end, dim, false);
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort(compareXYSlope);
    for (let i2 = 0; i2 < queue.length; i2++) {
      outerNode = eliminateHole(queue[i2], outerNode);
    }
    return outerNode;
  }
  function compareXYSlope(a2, b2) {
    let result = a2.x - b2.x;
    if (result === 0) {
      result = a2.y - b2.y;
      if (result === 0) {
        const aSlope = (a2.next.y - a2.y) / (a2.next.x - a2.x);
        const bSlope = (b2.next.y - b2.y) / (b2.next.x - b2.x);
        result = aSlope - bSlope;
      }
    }
    return result;
  }
  function eliminateHole(hole, outerNode) {
    const bridge = findHoleBridge(hole, outerNode);
    if (!bridge) {
      return outerNode;
    }
    const bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    let p2 = outerNode;
    const hx = hole.x;
    const hy = hole.y;
    let qx = -Infinity;
    let m2;
    if (equals(hole, p2)) return p2;
    do {
      if (equals(hole, p2.next)) return p2.next;
      else if (hy <= p2.y && hy >= p2.next.y && p2.next.y !== p2.y) {
        const x2 = p2.x + (hy - p2.y) * (p2.next.x - p2.x) / (p2.next.y - p2.y);
        if (x2 <= hx && x2 > qx) {
          qx = x2;
          m2 = p2.x < p2.next.x ? p2 : p2.next;
          if (x2 === hx) return m2;
        }
      }
      p2 = p2.next;
    } while (p2 !== outerNode);
    if (!m2) return null;
    const stop2 = m2;
    const mx = m2.x;
    const my = m2.y;
    let tanMin = Infinity;
    p2 = m2;
    do {
      if (hx >= p2.x && p2.x >= mx && hx !== p2.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p2.x, p2.y)) {
        const tan = Math.abs(hy - p2.y) / (hx - p2.x);
        if (locallyInside(p2, hole) && (tan < tanMin || tan === tanMin && (p2.x > m2.x || p2.x === m2.x && sectorContainsSector(m2, p2)))) {
          m2 = p2;
          tanMin = tan;
        }
      }
      p2 = p2.next;
    } while (p2 !== stop2);
    return m2;
  }
  function sectorContainsSector(m2, p2) {
    return area(m2.prev, m2, p2.prev) < 0 && area(p2.next, m2, m2.next) < 0;
  }
  function indexCurve(start2, minX, minY, invSize) {
    let p2 = start2;
    do {
      if (p2.z === 0) p2.z = zOrder(p2.x, p2.y, minX, minY, invSize);
      p2.prevZ = p2.prev;
      p2.nextZ = p2.next;
      p2 = p2.next;
    } while (p2 !== start2);
    p2.prevZ.nextZ = null;
    p2.prevZ = null;
    sortLinked(p2);
  }
  function sortLinked(list) {
    let numMerges;
    let inSize = 1;
    do {
      let p2 = list;
      let e2;
      list = null;
      let tail = null;
      numMerges = 0;
      while (p2) {
        numMerges++;
        let q = p2;
        let pSize = 0;
        for (let i2 = 0; i2 < inSize; i2++) {
          pSize++;
          q = q.nextZ;
          if (!q) break;
        }
        let qSize = inSize;
        while (pSize > 0 || qSize > 0 && q) {
          if (pSize !== 0 && (qSize === 0 || !q || p2.z <= q.z)) {
            e2 = p2;
            p2 = p2.nextZ;
            pSize--;
          } else {
            e2 = q;
            q = q.nextZ;
            qSize--;
          }
          if (tail) tail.nextZ = e2;
          else list = e2;
          e2.prevZ = tail;
          tail = e2;
        }
        p2 = q;
      }
      tail.nextZ = null;
      inSize *= 2;
    } while (numMerges > 1);
    return list;
  }
  function zOrder(x2, y2, minX, minY, invSize) {
    x2 = (x2 - minX) * invSize | 0;
    y2 = (y2 - minY) * invSize | 0;
    x2 = (x2 | x2 << 8) & 16711935;
    x2 = (x2 | x2 << 4) & 252645135;
    x2 = (x2 | x2 << 2) & 858993459;
    x2 = (x2 | x2 << 1) & 1431655765;
    y2 = (y2 | y2 << 8) & 16711935;
    y2 = (y2 | y2 << 4) & 252645135;
    y2 = (y2 | y2 << 2) & 858993459;
    y2 = (y2 | y2 << 1) & 1431655765;
    return x2 | y2 << 1;
  }
  function getLeftmost(start2) {
    let p2 = start2, leftmost = start2;
    do {
      if (p2.x < leftmost.x || p2.x === leftmost.x && p2.y < leftmost.y) leftmost = p2;
      p2 = p2.next;
    } while (p2 !== start2);
    return leftmost;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, px, py) {
    return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
  }
  function isValidDiagonal(a2, b2) {
    return a2.next.i !== b2.i && a2.prev.i !== b2.i && !intersectsPolygon(a2, b2) &&
    (locallyInside(a2, b2) && locallyInside(b2, a2) && middleInside(a2, b2) &&
    (area(a2.prev, a2, b2.prev) || area(a2, b2.prev, b2)) ||
    equals(a2, b2) && area(a2.prev, a2, a2.next) > 0 && area(b2.prev, b2, b2.next) > 0);
  }
  function area(p2, q, r2) {
    return (q.y - p2.y) * (r2.x - q.x) - (q.x - p2.x) * (r2.y - q.y);
  }
  function equals(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
  }
  function intersects(p1, q1, p2, q2) {
    const o1 = sign(area(p1, q1, p2));
    const o2 = sign(area(p1, q1, q2));
    const o3 = sign(area(p2, q2, p1));
    const o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function onSegment(p2, q, r2) {
    return q.x <= Math.max(p2.x, r2.x) && q.x >= Math.min(p2.x, r2.x) && q.y <= Math.max(p2.y, r2.y) && q.y >= Math.min(p2.y, r2.y);
  }
  function sign(num) {
    return num > 0 ? 1 : num < 0 ? -1 : 0;
  }
  function intersectsPolygon(a2, b2) {
    let p2 = a2;
    do {
      if (p2.i !== a2.i && p2.next.i !== a2.i && p2.i !== b2.i && p2.next.i !== b2.i && intersects(p2, p2.next, a2, b2)) return true;
      p2 = p2.next;
    } while (p2 !== a2);
    return false;
  }
  function locallyInside(a2, b2) {
    return area(a2.prev, a2, a2.next) < 0 ? area(a2, b2, a2.next) >= 0 && area(a2, a2.prev, b2) >= 0 : area(a2, b2, a2.prev) < 0 || area(a2, a2.next, b2) < 0;
  }
  function middleInside(a2, b2) {
    let p2 = a2;
    let inside = false;
    const px = (a2.x + b2.x) / 2;
    const py = (a2.y + b2.y) / 2;
    do {
      if (p2.y > py !== p2.next.y > py && p2.next.y !== p2.y && px < (p2.next.x - p2.x) * (py - p2.y) / (p2.next.y - p2.y) + p2.x)
        inside = !inside;
      p2 = p2.next;
    } while (p2 !== a2);
    return inside;
  }
  function splitPolygon(a2, b2) {
    const a22 = createNode(a2.i, a2.x, a2.y), b22 = createNode(b2.i, b2.x, b2.y), an = a2.next, bp = b2.prev;
    a2.next = b2;
    b2.prev = a2;
    a22.next = an;
    an.prev = a22;
    b22.next = a22;
    a22.prev = b22;
    bp.next = b22;
    b22.prev = bp;
    return b22;
  }
  function insertNode(i2, x2, y2, last) {
    const p2 = createNode(i2, x2, y2);
    if (!last) {
      p2.prev = p2;
      p2.next = p2;
    } else {
      p2.next = last.next;
      p2.prev = last;
      last.next.prev = p2;
      last.next = p2;
    }
    return p2;
  }
  function removeNode(p2) {
    p2.next.prev = p2.prev;
    p2.prev.next = p2.next;
    if (p2.prevZ) p2.prevZ.nextZ = p2.nextZ;
    if (p2.nextZ) p2.nextZ.prevZ = p2.prevZ;
  }
  function createNode(i2, x2, y2) {
    return {
      i: i2,

      x: x2,
      y: y2,

      prev: null,

      next: null,
      z: 0,

      prevZ: null,

      nextZ: null,
      steiner: false

    };
  }
  function signedArea(data, start2, end, dim) {
    let sum = 0;
    for (let i2 = start2, j2 = end - dim; i2 < end; i2 += dim) {
      sum += (data[j2] - data[i2]) * (data[i2 + 1] + data[j2 + 1]);
      j2 = i2;
    }
    return sum;
  }
  const earcut = earcut$1.default || earcut$1;
  var CLEAR =                 ((CLEAR2) => {
    CLEAR2[CLEAR2["NONE"] = 0] = "NONE";
    CLEAR2[CLEAR2["COLOR"] = 16384] = "COLOR";
    CLEAR2[CLEAR2["STENCIL"] = 1024] = "STENCIL";
    CLEAR2[CLEAR2["DEPTH"] = 256] = "DEPTH";
    CLEAR2[CLEAR2["COLOR_DEPTH"] = 16640] = "COLOR_DEPTH";
    CLEAR2[CLEAR2["COLOR_STENCIL"] = 17408] = "COLOR_STENCIL";
    CLEAR2[CLEAR2["DEPTH_STENCIL"] = 1280] = "DEPTH_STENCIL";
    CLEAR2[CLEAR2["ALL"] = 17664] = "ALL";
    return CLEAR2;
  })(CLEAR || {});
  class SystemRunner {

    constructor(name) {
      this.items = [];
      this._name = name;
    }

    emit(a0, a1, a2, a3, a4, a5, a6, a7) {
      const { name, items } = this;
      for (let i2 = 0, len = items.length; i2 < len; i2++) {
        items[i2][name](a0, a1, a2, a3, a4, a5, a6, a7);
      }
      return this;
    }

    add(item) {
      if (item[this._name]) {
        this.remove(item);
        this.items.push(item);
      }
      return this;
    }

    remove(item) {
      const index = this.items.indexOf(item);
      if (index !== -1) {
        this.items.splice(index, 1);
      }
      return this;
    }

    contains(item) {
      return this.items.indexOf(item) !== -1;
    }

    removeAll() {
      this.items.length = 0;
      return this;
    }

    destroy() {
      this.removeAll();
      this.items = null;
      this._name = null;
    }

    get empty() {
      return this.items.length === 0;
    }

    get name() {
      return this._name;
    }
  }
  const defaultRunners = [
    "init",
    "destroy",
    "contextChange",
    "resolutionChange",
    "resetState",
    "renderEnd",
    "renderStart",
    "render",
    "update",
    "postrender",
    "prerender"
  ];
  const _AbstractRenderer = class _AbstractRenderer2 extends EventEmitter {

    constructor(config) {
      super();
      this.tick = 0;
      this.uid = uid$1("renderer");
      this.runners =                 Object.create(null);
      this.renderPipes =                 Object.create(null);
      this._initOptions = {};
      this._systemsHash =                 Object.create(null);
      this.type = config.type;
      this.name = config.name;
      this.config = config;
      const combinedRunners = [...defaultRunners, ...this.config.runners ?? []];
      this._addRunners(...combinedRunners);
      this._unsafeEvalCheck();
    }

    async init(options = {}) {
      const skip = options.skipExtensionImports === true ? true : options.manageImports === false;
      await loadEnvironmentExtensions(skip);
      this._addSystems(this.config.systems);
      this._addPipes(this.config.renderPipes, this.config.renderPipeAdaptors);
      for (const systemName in this._systemsHash) {
        const system = this._systemsHash[systemName];
        const defaultSystemOptions = system.constructor.defaultOptions;
        options = { ...defaultSystemOptions, ...options };
      }
      options = { ..._AbstractRenderer2.defaultOptions, ...options };
      this._roundPixels = options.roundPixels ? 1 : 0;
      for (let i2 = 0; i2 < this.runners.init.items.length; i2++) {
        await this.runners.init.items[i2].init(options);
      }
      this._initOptions = options;
    }
    render(args, deprecated) {
      this.tick++;
      let options = args;
      if (options instanceof Container) {
        options = { container: options };
        if (deprecated) {
          deprecation(v8_0_0, "passing a second argument is deprecated, please use render options instead");
          options.target = deprecated.renderTexture;
        }
      }
      options.target || (options.target = this.view.renderTarget);
      if (options.target === this.view.renderTarget) {
        this._lastObjectRendered = options.container;
        options.clearColor ?? (options.clearColor = this.background.colorRgba);
        options.clear ?? (options.clear = this.background.clearBeforeRender);
      }
      if (options.clearColor) {
        const isRGBAArray = Array.isArray(options.clearColor) && options.clearColor.length === 4;
        options.clearColor = isRGBAArray ? options.clearColor : Color.shared.setValue(options.clearColor).toArray();
      }
      if (!options.transform) {
        options.container.updateLocalTransform();
        options.transform = options.container.localTransform;
      }
      if (!options.container.visible) {
        return;
      }
      options.container.enableRenderGroup();
      this.runners.prerender.emit(options);
      this.runners.renderStart.emit(options);
      this.runners.render.emit(options);
      this.runners.renderEnd.emit(options);
      this.runners.postrender.emit(options);
    }

    resize(desiredScreenWidth, desiredScreenHeight, resolution) {
      const previousResolution = this.view.resolution;
      this.view.resize(desiredScreenWidth, desiredScreenHeight, resolution);
      this.emit("resize", this.view.screen.width, this.view.screen.height, this.view.resolution);
      if (resolution !== void 0 && resolution !== previousResolution) {
        this.runners.resolutionChange.emit(resolution);
      }
    }

    clear(options = {}) {
      const renderer = this;
      options.target || (options.target = renderer.renderTarget.renderTarget);
      options.clearColor || (options.clearColor = this.background.colorRgba);
      options.clear ?? (options.clear = CLEAR.ALL);
      const { clear, clearColor, target, mipLevel, layer: layer2 } = options;
      Color.shared.setValue(clearColor ?? this.background.colorRgba);
      renderer.renderTarget.clear(target, clear, Color.shared.toArray(), mipLevel ?? 0, layer2 ?? 0);
    }

    get resolution() {
      return this.view.resolution;
    }
    set resolution(value) {
      this.view.resolution = value;
      this.runners.resolutionChange.emit(value);
    }

    get width() {
      return this.view.texture.frame.width;
    }

    get height() {
      return this.view.texture.frame.height;
    }

    get canvas() {
      return this.view.canvas;
    }

    get lastObjectRendered() {
      return this._lastObjectRendered;
    }

    get renderingToScreen() {
      const renderer = this;
      return renderer.renderTarget.renderingToScreen;
    }

    get screen() {
      return this.view.screen;
    }

    _addRunners(...runnerIds) {
      runnerIds.forEach((runnerId) => {
        this.runners[runnerId] = new SystemRunner(runnerId);
      });
    }
    _addSystems(systems2) {
      let i2;
      for (i2 in systems2) {
        const val = systems2[i2];
        this._addSystem(val.value, val.name);
      }
    }

    _addSystem(ClassRef, name) {
      const system = new ClassRef(this);
      if (this[name]) {
        throw new Error(`Whoops! The name "${name}" is already in use`);
      }
      this[name] = system;
      this._systemsHash[name] = system;
      for (const i2 in this.runners) {
        this.runners[i2].add(system);
      }
      return this;
    }
    _addPipes(pipes, pipeAdaptors) {
      const adaptors = pipeAdaptors.reduce((acc, adaptor) => {
        acc[adaptor.name] = adaptor.value;
        return acc;
      }, {});
      pipes.forEach((pipe) => {
        const PipeClass = pipe.value;
        const name = pipe.name;
        const Adaptor = adaptors[name];
        this.renderPipes[name] = new PipeClass(
          this,
          Adaptor ? new Adaptor() : null
        );
        this.runners.destroy.add(this.renderPipes[name]);
      });
    }
    destroy(options = false) {
      this.runners.destroy.items.reverse();
      this.runners.destroy.emit(options);
      if (options === true || typeof options === "object" && options.releaseGlobalResources) {
        GlobalResourceRegistry.release();
      }
      Object.values(this.runners).forEach((runner) => {
        runner.destroy();
      });
      this._systemsHash = null;
      this.renderPipes = null;
      this.removeAllListeners();
    }

    generateTexture(options) {
      return this.textureGenerator.generateTexture(options);
    }

    get roundPixels() {
      return !!this._roundPixels;
    }

    _unsafeEvalCheck() {
      if (!unsafeEvalSupported()) {
        throw new Error("Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module to enable support.");
      }
    }

    resetState() {
      this.runners.resetState.emit();
    }
  };
  _AbstractRenderer.defaultOptions = {

    resolution: 1,

    failIfMajorPerformanceCaveat: false,

    roundPixels: false
  };
  let AbstractRenderer = _AbstractRenderer;
  let _isWebGLSupported;
  function isWebGLSupported(failIfMajorPerformanceCaveat) {
    if (_isWebGLSupported !== void 0) return _isWebGLSupported;
    _isWebGLSupported = (() => {
      const contextOptions = {
        stencil: true,
        failIfMajorPerformanceCaveat: failIfMajorPerformanceCaveat ?? AbstractRenderer.defaultOptions.failIfMajorPerformanceCaveat
      };
      try {
        if (!DOMAdapter.get().getWebGLRenderingContext()) {
          return false;
        }
        const canvas = DOMAdapter.get().createCanvas();
        let gl = canvas.getContext("webgl", contextOptions);
        const success = !!gl?.getContextAttributes()?.stencil;
        if (gl) {
          const loseContext = gl.getExtension("WEBGL_lose_context");
          if (loseContext) {
            loseContext.loseContext();
          }
        }
        gl = null;
        return success;
      } catch (_e) {
        return false;
      }
    })();
    return _isWebGLSupported;
  }
  let _isWebGPUSupported;
  async function isWebGPUSupported(options = {}) {
    if (_isWebGPUSupported !== void 0) return _isWebGPUSupported;
    _isWebGPUSupported = await (async () => {
      const gpu = DOMAdapter.get().getNavigator().gpu;
      if (!gpu) {
        return false;
      }
      try {
        const adapter = await gpu.requestAdapter(options);
        await adapter.requestDevice();
        return true;
      } catch (_e) {
        return false;
      }
    })();
    return _isWebGPUSupported;
  }
  const renderPriority = ["webgl", "webgpu", "canvas"];
  async function autoDetectRenderer(options) {
    let preferredOrder = [];
    if (options.preference) {
      if (Array.isArray(options.preference)) {
        preferredOrder = options.preference.slice();
      } else {
        preferredOrder.push(options.preference);
        renderPriority.forEach((item) => {
          if (item !== options.preference) {
            preferredOrder.push(item);
          }
        });
      }
    } else {
      preferredOrder = renderPriority.slice();
    }
    let RendererClass;
    let finalOptions = {};
    for (let i2 = 0; i2 < preferredOrder.length; i2++) {
      const rendererType = preferredOrder[i2];
      if (rendererType === "webgpu" && await isWebGPUSupported()) {
        const { WebGPURenderer } = await Promise.resolve().then(() => pixiUnused);
        RendererClass = WebGPURenderer;
        finalOptions = { ...options, ...options.webgpu };
        break;
      } else if (rendererType === "webgl" && isWebGLSupported(
        options.failIfMajorPerformanceCaveat ?? AbstractRenderer.defaultOptions.failIfMajorPerformanceCaveat
      )) {
        const { WebGLRenderer: WebGLRenderer2 } = await Promise.resolve().then(() => WebGLRenderer$1);
        RendererClass = WebGLRenderer2;
        finalOptions = { ...options, ...options.webgl };
        break;
      } else if (rendererType === "canvas") {
        const { CanvasRenderer: CanvasRenderer2 } = await Promise.resolve().then(() => CanvasRenderer$1);
        RendererClass = CanvasRenderer2;
        finalOptions = { ...options, ...options.canvasOptions };
        break;
      }
    }
    delete finalOptions.webgpu;
    delete finalOptions.webgl;
    delete finalOptions.canvasOptions;
    if (!RendererClass) {
      throw new Error("No available renderer for the current environment");
    }
    const renderer = new RendererClass();
    await renderer.init(finalOptions);
    return renderer;
  }
  const VERSION = "8.18.1";
  class ApplicationInitHook {
    static init() {
      globalThis.__PIXI_APP_INIT__?.(this, VERSION);
    }
    static destroy() {
    }
  }
  ApplicationInitHook.extension = ExtensionType.Application;
  class RendererInitHook {
    constructor(renderer) {
      this._renderer = renderer;
    }
    init() {
      globalThis.__PIXI_RENDERER_INIT__?.(this._renderer, VERSION);
    }
    destroy() {
      this._renderer = null;
    }
  }
  RendererInitHook.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem
    ],
    name: "initHook",
    priority: -10
  };
  class ResizePlugin {

    static init(options) {
      Object.defineProperty(
        this,
        "resizeTo",
        {
          configurable: true,
          set(dom) {
            globalThis.removeEventListener("resize", this.queueResize);
            this._resizeTo = dom;
            if (dom) {
              globalThis.addEventListener("resize", this.queueResize);
              this.resize();
            }
          },
          get() {
            return this._resizeTo;
          }
        }
      );
      this.queueResize = () => {
        if (!this._resizeTo) {
          return;
        }
        this._cancelResize();
        this._resizeId = requestAnimationFrame(() => this.resize());
      };
      this._cancelResize = () => {
        if (this._resizeId) {
          cancelAnimationFrame(this._resizeId);
          this._resizeId = null;
        }
      };
      this.resize = () => {
        if (!this._resizeTo) {
          return;
        }
        this._cancelResize();
        let width;
        let height;
        if (this._resizeTo === globalThis.window) {
          width = globalThis.innerWidth;
          height = globalThis.innerHeight;
        } else {
          const { clientWidth, clientHeight } = this._resizeTo;
          width = clientWidth;
          height = clientHeight;
        }
        this.renderer.resize(width, height);
        this.render();
      };
      this._resizeId = null;
      this._resizeTo = null;
      this.resizeTo = options.resizeTo || null;
    }

    static destroy() {
      globalThis.removeEventListener("resize", this.queueResize);
      this._cancelResize();
      this._cancelResize = null;
      this.queueResize = null;
      this.resizeTo = null;
      this.resize = null;
    }
  }
  ResizePlugin.extension = ExtensionType.Application;
  class TickerPlugin {

    static init(options) {
      options = Object.assign({
        autoStart: true,
        sharedTicker: false
      }, options);
      Object.defineProperty(
        this,
        "ticker",
        {
          configurable: true,
          set(ticker) {
            if (this._ticker) {
              this._ticker.remove(this.render, this);
            }
            this._ticker = ticker;
            if (ticker) {
              ticker.add(this.render, this, UPDATE_PRIORITY.LOW);
            }
          },
          get() {
            return this._ticker;
          }
        }
      );
      this.stop = () => {
        this._ticker.stop();
      };
      this.start = () => {
        this._ticker.start();
      };
      this._ticker = null;
      this.ticker = options.sharedTicker ? Ticker.shared : new Ticker();
      if (options.autoStart) {
        this.start();
      }
    }

    static destroy() {
      if (this._ticker) {
        const oldTicker = this._ticker;
        this.ticker = null;
        oldTicker.destroy();
      }
    }
  }
  TickerPlugin.extension = ExtensionType.Application;
  extensions.add(ResizePlugin);
  extensions.add(TickerPlugin);
  const _Application = class _Application2 {
    constructor(...args) {
      this.stage = new Container();
      if (args[0] !== void 0) {
        deprecation(v8_0_0, "Application constructor options are deprecated, please use Application.init() instead.");
      }
    }

    async init(options) {
      options = { ...options };
      this.stage || (this.stage = new Container());
      this.renderer = await autoDetectRenderer(options);
      _Application2._plugins.forEach((plugin) => {
        plugin.init.call(this, options);
      });
    }

    render() {
      this.renderer.render({ container: this.stage });
    }

    get canvas() {
      return this.renderer.canvas;
    }

    get view() {
      deprecation(v8_0_0, "Application.view is deprecated, please use Application.canvas instead.");
      return this.renderer.canvas;
    }

    get screen() {
      return this.renderer.screen;
    }

    get domContainerRoot() {
      return this.renderer.renderPipes.dom?._domElement;
    }

    destroy(rendererDestroyOptions = false, options = false) {
      const plugins = _Application2._plugins.slice(0);
      plugins.reverse();
      plugins.forEach((plugin) => {
        plugin.destroy.call(this);
      });
      this.stage.destroy(options);
      this.stage = null;
      this.renderer.destroy(rendererDestroyOptions);
      this.renderer = null;
    }
  };
  _Application._plugins = [];
  let Application = _Application;
  extensions.handleByList(ExtensionType.Application, Application._plugins);
  extensions.add(ApplicationInitHook);
  var parseSvgPath = parse;
  var length = { a: 7, c: 6, h: 1, l: 2, m: 2, q: 4, s: 4, t: 2, v: 1, z: 0 };
  var segment = /([astvzqmhlc])([^astvzqmhlc]*)/ig;
  function parse(path) {
    var data = [];
    path.replace(segment, function(_, command, args) {
      var type = command.toLowerCase();
      args = parseValues(args);
      if (type == "m" && args.length > 2) {
        data.push([command].concat(args.splice(0, 2)));
        type = "l";
        command = command == "m" ? "l" : "L";
      }
      while (true) {
        if (args.length == length[type]) {
          args.unshift(command);
          return data.push(args);
        }
        if (args.length < length[type]) throw new Error("malformed path data");
        data.push([command].concat(args.splice(0, length[type])));
      }
    });
    return data;
  }
  var number = /-?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?/ig;
  function parseValues(args) {
    var numbers = args.match(number);
    return numbers ? numbers.map(Number) : [];
  }
  const parse$1 =                 getDefaultExportFromCjs(parseSvgPath);
  function parseSVGPath(svgPath, path) {
    const commands = parse$1(svgPath);
    const subpaths = [];
    let currentSubPath = null;
    let lastX = 0;
    let lastY = 0;
    for (let i2 = 0; i2 < commands.length; i2++) {
      const command = commands[i2];
      const type = command[0];
      const data = command;
      switch (type) {
        case "M":
          lastX = data[1];
          lastY = data[2];
          path.moveTo(lastX, lastY);
          break;
        case "m":
          lastX += data[1];
          lastY += data[2];
          path.moveTo(lastX, lastY);
          break;
        case "H":
          lastX = data[1];
          path.lineTo(lastX, lastY);
          break;
        case "h":
          lastX += data[1];
          path.lineTo(lastX, lastY);
          break;
        case "V":
          lastY = data[1];
          path.lineTo(lastX, lastY);
          break;
        case "v":
          lastY += data[1];
          path.lineTo(lastX, lastY);
          break;
        case "L":
          lastX = data[1];
          lastY = data[2];
          path.lineTo(lastX, lastY);
          break;
        case "l":
          lastX += data[1];
          lastY += data[2];
          path.lineTo(lastX, lastY);
          break;
        case "C":
          lastX = data[5];
          lastY = data[6];
          path.bezierCurveTo(
            data[1],
            data[2],

            data[3],
            data[4],

            lastX,
            lastY

          );
          break;
        case "c":
          path.bezierCurveTo(
            lastX + data[1],
            lastY + data[2],

            lastX + data[3],
            lastY + data[4],

            lastX + data[5],
            lastY + data[6]

          );
          lastX += data[5];
          lastY += data[6];
          break;
        case "S":
          lastX = data[3];
          lastY = data[4];
          path.bezierCurveToShort(
            data[1],
            data[2],

            lastX,
            lastY

          );
          break;
        case "s":
          path.bezierCurveToShort(
            lastX + data[1],
            lastY + data[2],

            lastX + data[3],
            lastY + data[4]

          );
          lastX += data[3];
          lastY += data[4];
          break;
        case "Q":
          lastX = data[3];
          lastY = data[4];
          path.quadraticCurveTo(
            data[1],
            data[2],

            lastX,
            lastY

          );
          break;
        case "q":
          path.quadraticCurveTo(
            lastX + data[1],
            lastY + data[2],

            lastX + data[3],
            lastY + data[4]

          );
          lastX += data[3];
          lastY += data[4];
          break;
        case "T":
          lastX = data[1];
          lastY = data[2];
          path.quadraticCurveToShort(
            lastX,
            lastY

          );
          break;
        case "t":
          lastX += data[1];
          lastY += data[2];
          path.quadraticCurveToShort(
            lastX,
            lastY

          );
          break;
        case "A":
          lastX = data[6];
          lastY = data[7];
          path.arcToSvg(
            data[1],

            data[2],

            data[3],

            data[4],

            data[5],

            lastX,
            lastY

          );
          break;
        case "a":
          lastX += data[6];
          lastY += data[7];
          path.arcToSvg(
            data[1],

            data[2],

            data[3],

            data[4],

            data[5],

            lastX,
            lastY

          );
          break;
        case "Z":
        case "z":
          path.closePath();
          if (subpaths.length > 0) {
            currentSubPath = subpaths.pop();
            if (currentSubPath) {
              lastX = currentSubPath.startX;
              lastY = currentSubPath.startY;
            } else {
              lastX = 0;
              lastY = 0;
            }
          }
          currentSubPath = null;
          break;
        default:
          warn(`Unknown SVG path command: ${type}`);
      }
      if (type !== "Z" && type !== "z") {
        if (currentSubPath === null) {
          currentSubPath = { startX: lastX, startY: lastY };
          subpaths.push(currentSubPath);
        }
      }
    }
    return path;
  }
  class Circle {

    constructor(x2 = 0, y2 = 0, radius = 0) {
      this.type = "circle";
      this.x = x2;
      this.y = y2;
      this.radius = radius;
    }

    clone() {
      return new Circle(this.x, this.y, this.radius);
    }

    contains(x2, y2) {
      if (this.radius <= 0) return false;
      const r2 = this.radius * this.radius;
      let dx = this.x - x2;
      let dy = this.y - y2;
      dx *= dx;
      dy *= dy;
      return dx + dy <= r2;
    }

    strokeContains(x2, y2, width, alignment = 0.5) {
      if (this.radius === 0) return false;
      const dx = this.x - x2;
      const dy = this.y - y2;
      const radius = this.radius;
      const outerWidth = (1 - alignment) * width;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= radius + outerWidth && distance > radius - (width - outerWidth);
    }

    getBounds(out2) {
      out2 || (out2 = new Rectangle());
      out2.x = this.x - this.radius;
      out2.y = this.y - this.radius;
      out2.width = this.radius * 2;
      out2.height = this.radius * 2;
      return out2;
    }

    copyFrom(circle) {
      this.x = circle.x;
      this.y = circle.y;
      this.radius = circle.radius;
      return this;
    }

    copyTo(circle) {
      circle.copyFrom(this);
      return circle;
    }
    toString() {
      return `[pixi.js/math:Circle x=${this.x} y=${this.y} radius=${this.radius}]`;
    }
  }
  class Ellipse {

    constructor(x2 = 0, y2 = 0, halfWidth = 0, halfHeight = 0) {
      this.type = "ellipse";
      this.x = x2;
      this.y = y2;
      this.halfWidth = halfWidth;
      this.halfHeight = halfHeight;
    }

    clone() {
      return new Ellipse(this.x, this.y, this.halfWidth, this.halfHeight);
    }

    contains(x2, y2) {
      if (this.halfWidth <= 0 || this.halfHeight <= 0) {
        return false;
      }
      let normx = (x2 - this.x) / this.halfWidth;
      let normy = (y2 - this.y) / this.halfHeight;
      normx *= normx;
      normy *= normy;
      return normx + normy <= 1;
    }

    strokeContains(x2, y2, strokeWidth, alignment = 0.5) {
      const { halfWidth, halfHeight } = this;
      if (halfWidth <= 0 || halfHeight <= 0) {
        return false;
      }
      const strokeOuterWidth = strokeWidth * (1 - alignment);
      const strokeInnerWidth = strokeWidth - strokeOuterWidth;
      const innerHorizontal = halfWidth - strokeInnerWidth;
      const innerVertical = halfHeight - strokeInnerWidth;
      const outerHorizontal = halfWidth + strokeOuterWidth;
      const outerVertical = halfHeight + strokeOuterWidth;
      const normalizedX = x2 - this.x;
      const normalizedY = y2 - this.y;
      const innerEllipse = normalizedX * normalizedX / (innerHorizontal * innerHorizontal) + normalizedY * normalizedY / (innerVertical * innerVertical);
      const outerEllipse = normalizedX * normalizedX / (outerHorizontal * outerHorizontal) + normalizedY * normalizedY / (outerVertical * outerVertical);
      return innerEllipse > 1 && outerEllipse <= 1;
    }

    getBounds(out2) {
      out2 || (out2 = new Rectangle());
      out2.x = this.x - this.halfWidth;
      out2.y = this.y - this.halfHeight;
      out2.width = this.halfWidth * 2;
      out2.height = this.halfHeight * 2;
      return out2;
    }

    copyFrom(ellipse) {
      this.x = ellipse.x;
      this.y = ellipse.y;
      this.halfWidth = ellipse.halfWidth;
      this.halfHeight = ellipse.halfHeight;
      return this;
    }

    copyTo(ellipse) {
      ellipse.copyFrom(this);
      return ellipse;
    }
    toString() {
      return `[pixi.js/math:Ellipse x=${this.x} y=${this.y} halfWidth=${this.halfWidth} halfHeight=${this.halfHeight}]`;
    }
  }
  function squaredDistanceToLineSegment(x2, y2, x1, y1, x22, y22) {
    const a2 = x2 - x1;
    const b2 = y2 - y1;
    const c2 = x22 - x1;
    const d2 = y22 - y1;
    const dot = a2 * c2 + b2 * d2;
    const lenSq = c2 * c2 + d2 * d2;
    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }
    let xx;
    let yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x22;
      yy = y22;
    } else {
      xx = x1 + param * c2;
      yy = y1 + param * d2;
    }
    const dx = x2 - xx;
    const dy = y2 - yy;
    return dx * dx + dy * dy;
  }
  let tempRect$3;
  let tempRect2;
  class Polygon {

    constructor(...points) {
      this.type = "polygon";
      let flat = Array.isArray(points[0]) ? points[0] : points;
      if (typeof flat[0] !== "number") {
        const p2 = [];
        for (let i2 = 0, il = flat.length; i2 < il; i2++) {
          p2.push(flat[i2].x, flat[i2].y);
        }
        flat = p2;
      }
      this.points = flat;
      this.closePath = true;
    }

    isClockwise() {
      let area2 = 0;
      const points = this.points;
      const length2 = points.length;
      for (let i2 = 0; i2 < length2; i2 += 2) {
        const x1 = points[i2];
        const y1 = points[i2 + 1];
        const x2 = points[(i2 + 2) % length2];
        const y2 = points[(i2 + 3) % length2];
        area2 += (x2 - x1) * (y2 + y1);
      }
      return area2 < 0;
    }

    containsPolygon(polygon) {
      const thisBounds = this.getBounds(tempRect$3);
      const otherBounds = polygon.getBounds(tempRect2);
      if (!thisBounds.containsRect(otherBounds)) {
        return false;
      }
      const points = polygon.points;
      for (let i2 = 0; i2 < points.length; i2 += 2) {
        const x2 = points[i2];
        const y2 = points[i2 + 1];
        if (!this.contains(x2, y2)) {
          return false;
        }
      }
      return true;
    }

    clone() {
      const points = this.points.slice();
      const polygon = new Polygon(points);
      polygon.closePath = this.closePath;
      return polygon;
    }

    contains(x2, y2) {
      let inside = false;
      const length2 = this.points.length / 2;
      for (let i2 = 0, j2 = length2 - 1; i2 < length2; j2 = i2++) {
        const xi = this.points[i2 * 2];
        const yi = this.points[i2 * 2 + 1];
        const xj = this.points[j2 * 2];
        const yj = this.points[j2 * 2 + 1];
        const intersect = yi > y2 !== yj > y2 && x2 < (xj - xi) * ((y2 - yi) / (yj - yi)) + xi;
        if (intersect) {
          inside = !inside;
        }
      }
      return inside;
    }

    strokeContains(x2, y2, strokeWidth, alignment = 0.5) {
      const strokeWidthSquared = strokeWidth * strokeWidth;
      const rightWidthSquared = strokeWidthSquared * (1 - alignment);
      const leftWidthSquared = strokeWidthSquared - rightWidthSquared;
      const { points } = this;
      const iterationLength = points.length - (this.closePath ? 0 : 2);
      for (let i2 = 0; i2 < iterationLength; i2 += 2) {
        const x1 = points[i2];
        const y1 = points[i2 + 1];
        const x22 = points[(i2 + 2) % points.length];
        const y22 = points[(i2 + 3) % points.length];
        const distanceSquared = squaredDistanceToLineSegment(x2, y2, x1, y1, x22, y22);
        const sign2 = Math.sign((x22 - x1) * (y2 - y1) - (y22 - y1) * (x2 - x1));
        if (distanceSquared <= (sign2 < 0 ? leftWidthSquared : rightWidthSquared)) {
          return true;
        }
      }
      return false;
    }

    getBounds(out2) {
      out2 || (out2 = new Rectangle());
      const points = this.points;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i2 = 0, n2 = points.length; i2 < n2; i2 += 2) {
        const x2 = points[i2];
        const y2 = points[i2 + 1];
        minX = x2 < minX ? x2 : minX;
        maxX = x2 > maxX ? x2 : maxX;
        minY = y2 < minY ? y2 : minY;
        maxY = y2 > maxY ? y2 : maxY;
      }
      out2.x = minX;
      out2.width = maxX - minX;
      out2.y = minY;
      out2.height = maxY - minY;
      return out2;
    }

    copyFrom(polygon) {
      this.points = polygon.points.slice();
      this.closePath = polygon.closePath;
      return this;
    }

    copyTo(polygon) {
      polygon.copyFrom(this);
      return polygon;
    }
    toString() {
      return `[pixi.js/math:PolygoncloseStroke=${this.closePath}points=${this.points.reduce((pointsDesc, currentPoint) => `${pointsDesc}, ${currentPoint}`, "")}]`;
    }

    get lastX() {
      return this.points[this.points.length - 2];
    }

    get lastY() {
      return this.points[this.points.length - 1];
    }

    get x() {
      deprecation("8.11.0", "Polygon.lastX is deprecated, please use Polygon.lastX instead.");
      return this.points[this.points.length - 2];
    }

    get y() {
      deprecation("8.11.0", "Polygon.y is deprecated, please use Polygon.lastY instead.");
      return this.points[this.points.length - 1];
    }

    get startX() {
      return this.points[0];
    }

    get startY() {
      return this.points[1];
    }
  }
  const isCornerWithinStroke = (pX, pY, cornerX, cornerY, radius, strokeWidthInner, strokeWidthOuter) => {
    const dx = pX - cornerX;
    const dy = pY - cornerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance >= radius - strokeWidthInner && distance <= radius + strokeWidthOuter;
  };
  class RoundedRectangle {

    constructor(x2 = 0, y2 = 0, width = 0, height = 0, radius = 20) {
      this.type = "roundedRectangle";
      this.x = x2;
      this.y = y2;
      this.width = width;
      this.height = height;
      this.radius = radius;
    }

    getBounds(out2) {
      out2 || (out2 = new Rectangle());
      out2.x = this.x;
      out2.y = this.y;
      out2.width = this.width;
      out2.height = this.height;
      return out2;
    }

    clone() {
      return new RoundedRectangle(this.x, this.y, this.width, this.height, this.radius);
    }

    copyFrom(rectangle) {
      this.x = rectangle.x;
      this.y = rectangle.y;
      this.width = rectangle.width;
      this.height = rectangle.height;
      return this;
    }

    copyTo(rectangle) {
      rectangle.copyFrom(this);
      return rectangle;
    }

    contains(x2, y2) {
      if (this.width <= 0 || this.height <= 0) {
        return false;
      }
      if (x2 >= this.x && x2 <= this.x + this.width) {
        if (y2 >= this.y && y2 <= this.y + this.height) {
          const radius = Math.max(0, Math.min(this.radius, Math.min(this.width, this.height) / 2));
          if (y2 >= this.y + radius && y2 <= this.y + this.height - radius || x2 >= this.x + radius && x2 <= this.x + this.width - radius) {
            return true;
          }
          let dx = x2 - (this.x + radius);
          let dy = y2 - (this.y + radius);
          const radius2 = radius * radius;
          if (dx * dx + dy * dy <= radius2) {
            return true;
          }
          dx = x2 - (this.x + this.width - radius);
          if (dx * dx + dy * dy <= radius2) {
            return true;
          }
          dy = y2 - (this.y + this.height - radius);
          if (dx * dx + dy * dy <= radius2) {
            return true;
          }
          dx = x2 - (this.x + radius);
          if (dx * dx + dy * dy <= radius2) {
            return true;
          }
        }
      }
      return false;
    }

    strokeContains(pX, pY, strokeWidth, alignment = 0.5) {
      const { x: x2, y: y2, width, height, radius } = this;
      const strokeWidthOuter = strokeWidth * (1 - alignment);
      const strokeWidthInner = strokeWidth - strokeWidthOuter;
      const innerX = x2 + radius;
      const innerY = y2 + radius;
      const innerWidth = width - radius * 2;
      const innerHeight = height - radius * 2;
      const rightBound = x2 + width;
      const bottomBound = y2 + height;
      if ((pX >= x2 - strokeWidthOuter && pX <= x2 + strokeWidthInner || pX >= rightBound - strokeWidthInner && pX <= rightBound + strokeWidthOuter) && pY >= innerY && pY <= innerY + innerHeight) {
        return true;
      }
      if ((pY >= y2 - strokeWidthOuter && pY <= y2 + strokeWidthInner || pY >= bottomBound - strokeWidthInner && pY <= bottomBound + strokeWidthOuter) && pX >= innerX && pX <= innerX + innerWidth) {
        return true;
      }
      return (

        pX < innerX && pY < innerY && isCornerWithinStroke(
          pX,
          pY,
          innerX,
          innerY,
          radius,
          strokeWidthInner,
          strokeWidthOuter
        ) || pX > rightBound - radius && pY < innerY && isCornerWithinStroke(
          pX,
          pY,
          rightBound - radius,
          innerY,
          radius,
          strokeWidthInner,
          strokeWidthOuter
        ) || pX > rightBound - radius && pY > bottomBound - radius && isCornerWithinStroke(
          pX,
          pY,
          rightBound - radius,
          bottomBound - radius,
          radius,
          strokeWidthInner,
          strokeWidthOuter
        ) || pX < innerX && pY > bottomBound - radius && isCornerWithinStroke(
          pX,
          pY,
          innerX,
          bottomBound - radius,
          radius,
          strokeWidthInner,
          strokeWidthOuter
        )
      );
    }
    toString() {
      return `[pixi.js/math:RoundedRectangle x=${this.x} y=${this.y}width=${this.width} height=${this.height} radius=${this.radius}]`;
    }
  }
  const cachedGroups = {};
  function getTextureBatchBindGroup(textures, size, maxTextures) {
    let uid2 = 2166136261;
    for (let i2 = 0; i2 < size; i2++) {
      uid2 ^= textures[i2].uid;
      uid2 = Math.imul(uid2, 16777619);
      uid2 >>>= 0;
    }
    return cachedGroups[uid2] || generateTextureBatchBindGroup(textures, size, uid2, maxTextures);
  }
  function generateTextureBatchBindGroup(textures, size, key, maxTextures) {
    const bindGroupResources = {};
    let bindIndex = 0;
    for (let i2 = 0; i2 < maxTextures; i2++) {
      const texture = i2 < size ? textures[i2] : Texture.EMPTY.source;
      bindGroupResources[bindIndex++] = texture.source;
      bindGroupResources[bindIndex++] = texture.style;
    }
    const bindGroup = new BindGroup(bindGroupResources);
    cachedGroups[key] = bindGroup;
    return bindGroup;
  }
  class ViewableBuffer {
    constructor(sizeOrBuffer) {
      if (typeof sizeOrBuffer === "number") {
        this.rawBinaryData = new ArrayBuffer(sizeOrBuffer);
      } else if (sizeOrBuffer instanceof Uint8Array) {
        this.rawBinaryData = sizeOrBuffer.buffer;
      } else {
        this.rawBinaryData = sizeOrBuffer;
      }
      this.uint32View = new Uint32Array(this.rawBinaryData);
      this.float32View = new Float32Array(this.rawBinaryData);
      this.size = this.rawBinaryData.byteLength;
    }

    get int8View() {
      if (!this._int8View) {
        this._int8View = new Int8Array(this.rawBinaryData);
      }
      return this._int8View;
    }

    get uint8View() {
      if (!this._uint8View) {
        this._uint8View = new Uint8Array(this.rawBinaryData);
      }
      return this._uint8View;
    }

    get int16View() {
      if (!this._int16View) {
        this._int16View = new Int16Array(this.rawBinaryData);
      }
      return this._int16View;
    }

    get int32View() {
      if (!this._int32View) {
        this._int32View = new Int32Array(this.rawBinaryData);
      }
      return this._int32View;
    }

    get float64View() {
      if (!this._float64Array) {
        this._float64Array = new Float64Array(this.rawBinaryData);
      }
      return this._float64Array;
    }

    get bigUint64View() {
      if (!this._bigUint64Array) {
        this._bigUint64Array = new BigUint64Array(this.rawBinaryData);
      }
      return this._bigUint64Array;
    }

    view(type) {
      return this[`${type}View`];
    }

    destroy() {
      this.rawBinaryData = null;
      this.uint32View = null;
      this.float32View = null;
      this.uint16View = null;
      this._int8View = null;
      this._uint8View = null;
      this._int16View = null;
      this._int32View = null;
      this._float64Array = null;
      this._bigUint64Array = null;
    }

    static sizeOf(type) {
      switch (type) {
        case "int8":
        case "uint8":
          return 1;
        case "int16":
        case "uint16":
          return 2;
        case "int32":
        case "uint32":
        case "float32":
          return 4;
        default:
          throw new Error(`${type} isn't a valid view type`);
      }
    }
  }
  function fastCopy(sourceBuffer, destinationBuffer, sourceOffset, byteLength) {
    sourceOffset ?? (sourceOffset = 0);
    byteLength ?? (byteLength = Math.min(sourceBuffer.byteLength - sourceOffset, destinationBuffer.byteLength));
    if (!(sourceOffset & 7) && !(byteLength & 7)) {
      const len = byteLength / 8;
      new Float64Array(destinationBuffer, 0, len).set(new Float64Array(sourceBuffer, sourceOffset, len));
    } else if (!(sourceOffset & 3) && !(byteLength & 3)) {
      const len = byteLength / 4;
      new Float32Array(destinationBuffer, 0, len).set(new Float32Array(sourceBuffer, sourceOffset, len));
    } else {
      new Uint8Array(destinationBuffer).set(new Uint8Array(sourceBuffer, sourceOffset, byteLength));
    }
  }
  const BLEND_TO_NPM = {
    normal: "normal-npm",
    add: "add-npm",
    screen: "screen-npm"
  };
  var STENCIL_MODES =                 ((STENCIL_MODES2) => {
    STENCIL_MODES2[STENCIL_MODES2["DISABLED"] = 0] = "DISABLED";
    STENCIL_MODES2[STENCIL_MODES2["RENDERING_MASK_ADD"] = 1] = "RENDERING_MASK_ADD";
    STENCIL_MODES2[STENCIL_MODES2["MASK_ACTIVE"] = 2] = "MASK_ACTIVE";
    STENCIL_MODES2[STENCIL_MODES2["INVERSE_MASK_ACTIVE"] = 3] = "INVERSE_MASK_ACTIVE";
    STENCIL_MODES2[STENCIL_MODES2["RENDERING_MASK_REMOVE"] = 4] = "RENDERING_MASK_REMOVE";
    STENCIL_MODES2[STENCIL_MODES2["NONE"] = 5] = "NONE";
    return STENCIL_MODES2;
  })(STENCIL_MODES || {});
  function getAdjustedBlendModeBlend(blendMode, textureSource) {
    if (textureSource.alphaMode === "no-premultiply-alpha") {
      return BLEND_TO_NPM[blendMode] || blendMode;
    }
    return blendMode;
  }
  const fragTemplate$1 = [
    "precision mediump float;",
    "void main(void){",
    "float test = 0.1;",
    "%forloop%",
    "gl_FragColor = vec4(0.0);",
    "}"
  ].join("\n");
  function generateIfTestSrc(maxIfs) {
    let src = "";
    for (let i2 = 0; i2 < maxIfs; ++i2) {
      if (i2 > 0) {
        src += "\nelse ";
      }
      if (i2 < maxIfs - 1) {
        src += `if(test == ${i2}.0){}`;
      }
    }
    return src;
  }
  function checkMaxIfStatementsInShader(maxIfs, gl) {
    if (maxIfs === 0) {
      throw new Error("Invalid value of `0` passed to `checkMaxIfStatementsInShader`");
    }
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    try {
      while (true) {
        const fragmentSrc = fragTemplate$1.replace(/%forloop%/gi, generateIfTestSrc(maxIfs));
        gl.shaderSource(shader, fragmentSrc);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          maxIfs = maxIfs / 2 | 0;
        } else {
          break;
        }
      }
    } finally {
      gl.deleteShader(shader);
    }
    return maxIfs;
  }
  let maxTexturesPerBatchCache = null;
  function getMaxTexturesPerBatch() {
    if (maxTexturesPerBatchCache) return maxTexturesPerBatchCache;
    const gl = getTestContext();
    maxTexturesPerBatchCache = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    maxTexturesPerBatchCache = checkMaxIfStatementsInShader(
      maxTexturesPerBatchCache,
      gl
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return maxTexturesPerBatchCache;
  }
  class BatchTextureArray {
    constructor() {
      this.ids =                 Object.create(null);
      this.textures = [];
      this.count = 0;
    }

    clear() {
      for (let i2 = 0; i2 < this.count; i2++) {
        const t2 = this.textures[i2];
        this.textures[i2] = null;
        this.ids[t2.uid] = null;
      }
      this.count = 0;
    }
  }
  class Batch {
    constructor() {
      this.renderPipeId = "batch";
      this.action = "startBatch";
      this.start = 0;
      this.size = 0;
      this.textures = new BatchTextureArray();
      this.blendMode = "normal";
      this.topology = "triangle-strip";
      this.canBundle = true;
    }
    destroy() {
      this.textures = null;
      this.gpuBindGroup = null;
      this.bindGroup = null;
      this.batcher = null;
      this.elements = null;
    }
  }
  const batchPool = [];
  let batchPoolIndex = 0;
  GlobalResourceRegistry.register({
    clear: () => {
      if (batchPool.length > 0) {
        for (const item of batchPool) {
          if (item) item.destroy();
        }
      }
      batchPool.length = 0;
      batchPoolIndex = 0;
    }
  });
  function getBatchFromPool() {
    return batchPoolIndex > 0 ? batchPool[--batchPoolIndex] : new Batch();
  }
  function returnBatchToPool(batch) {
    batch.elements = null;
    batchPool[batchPoolIndex++] = batch;
  }
  let BATCH_TICK = 0;
  const _Batcher = class _Batcher2 {
    constructor(options) {
      this.uid = uid$1("batcher");
      this.dirty = true;
      this.batchIndex = 0;
      this.batches = [];
      this._elements = [];
      options = { ..._Batcher2.defaultOptions, ...options };
      if (!options.maxTextures) {
        deprecation("v8.8.0", "maxTextures is a required option for Batcher now, please pass it in the options");
        options.maxTextures = getMaxTexturesPerBatch();
      }
      const { maxTextures, attributesInitialSize, indicesInitialSize } = options;
      this.attributeBuffer = new ViewableBuffer(attributesInitialSize * 4);
      this.indexBuffer = new Uint16Array(indicesInitialSize);
      this.maxTextures = maxTextures;
    }
    begin() {
      this.elementSize = 0;
      this.elementStart = 0;
      this.indexSize = 0;
      this.attributeSize = 0;
      for (let i2 = 0; i2 < this.batchIndex; i2++) {
        returnBatchToPool(this.batches[i2]);
      }
      this.batchIndex = 0;
      this._batchIndexStart = 0;
      this._batchIndexSize = 0;
      this.dirty = true;
    }
    add(batchableObject) {
      this._elements[this.elementSize++] = batchableObject;
      batchableObject._indexStart = this.indexSize;
      batchableObject._attributeStart = this.attributeSize;
      batchableObject._batcher = this;
      this.indexSize += batchableObject.indexSize;
      this.attributeSize += batchableObject.attributeSize * this.vertexSize;
    }
    checkAndUpdateTexture(batchableObject, texture) {
      const textureId = batchableObject._batch.textures.ids[texture._source.uid];
      if (!textureId && textureId !== 0) return false;
      batchableObject._textureId = textureId;
      batchableObject.texture = texture;
      return true;
    }
    updateElement(batchableObject) {
      this.dirty = true;
      const attributeBuffer = this.attributeBuffer;
      if (batchableObject.packAsQuad) {
        this.packQuadAttributes(
          batchableObject,
          attributeBuffer.float32View,
          attributeBuffer.uint32View,
          batchableObject._attributeStart,
          batchableObject._textureId
        );
      } else {
        this.packAttributes(
          batchableObject,
          attributeBuffer.float32View,
          attributeBuffer.uint32View,
          batchableObject._attributeStart,
          batchableObject._textureId
        );
      }
    }

    break(instructionSet) {
      const elements = this._elements;
      if (!elements[this.elementStart]) return;
      let batch = getBatchFromPool();
      let textureBatch = batch.textures;
      textureBatch.clear();
      const firstElement = elements[this.elementStart];
      let blendMode = getAdjustedBlendModeBlend(firstElement.blendMode, firstElement.texture._source);
      let topology = firstElement.topology;
      if (this.attributeSize * 4 > this.attributeBuffer.size) {
        this._resizeAttributeBuffer(this.attributeSize * 4);
      }
      if (this.indexSize > this.indexBuffer.length) {
        this._resizeIndexBuffer(this.indexSize);
      }
      const f32 = this.attributeBuffer.float32View;
      const u32 = this.attributeBuffer.uint32View;
      const indexBuffer = this.indexBuffer;
      let size = this._batchIndexSize;
      let start2 = this._batchIndexStart;
      let action = "startBatch";
      let batchElements = [];
      const maxTextures = this.maxTextures;
      for (let i2 = this.elementStart; i2 < this.elementSize; ++i2) {
        const element = elements[i2];
        elements[i2] = null;
        const texture = element.texture;
        const source2 = texture._source;
        const adjustedBlendMode = getAdjustedBlendModeBlend(element.blendMode, source2);
        const breakRequired = blendMode !== adjustedBlendMode || topology !== element.topology;
        if (source2._batchTick === BATCH_TICK && !breakRequired) {
          element._textureId = source2._textureBindLocation;
          size += element.indexSize;
          if (element.packAsQuad) {
            this.packQuadAttributes(
              element,
              f32,
              u32,
              element._attributeStart,
              element._textureId
            );
            this.packQuadIndex(
              indexBuffer,
              element._indexStart,
              element._attributeStart / this.vertexSize
            );
          } else {
            this.packAttributes(
              element,
              f32,
              u32,
              element._attributeStart,
              element._textureId
            );
            this.packIndex(
              element,
              indexBuffer,
              element._indexStart,
              element._attributeStart / this.vertexSize
            );
          }
          element._batch = batch;
          batchElements.push(element);
          continue;
        }
        source2._batchTick = BATCH_TICK;
        if (textureBatch.count >= maxTextures || breakRequired) {
          this._finishBatch(
            batch,
            start2,
            size - start2,
            textureBatch,
            blendMode,
            topology,
            instructionSet,
            action,
            batchElements
          );
          action = "renderBatch";
          start2 = size;
          blendMode = adjustedBlendMode;
          topology = element.topology;
          batch = getBatchFromPool();
          textureBatch = batch.textures;
          textureBatch.clear();
          batchElements = [];
          ++BATCH_TICK;
        }
        element._textureId = source2._textureBindLocation = textureBatch.count;
        textureBatch.ids[source2.uid] = textureBatch.count;
        textureBatch.textures[textureBatch.count++] = source2;
        element._batch = batch;
        batchElements.push(element);
        size += element.indexSize;
        if (element.packAsQuad) {
          this.packQuadAttributes(
            element,
            f32,
            u32,
            element._attributeStart,
            element._textureId
          );
          this.packQuadIndex(
            indexBuffer,
            element._indexStart,
            element._attributeStart / this.vertexSize
          );
        } else {
          this.packAttributes(
            element,
            f32,
            u32,
            element._attributeStart,
            element._textureId
          );
          this.packIndex(
            element,
            indexBuffer,
            element._indexStart,
            element._attributeStart / this.vertexSize
          );
        }
      }
      if (textureBatch.count > 0) {
        this._finishBatch(
          batch,
          start2,
          size - start2,
          textureBatch,
          blendMode,
          topology,
          instructionSet,
          action,
          batchElements
        );
        start2 = size;
        ++BATCH_TICK;
      }
      this.elementStart = this.elementSize;
      this._batchIndexStart = start2;
      this._batchIndexSize = size;
    }
    _finishBatch(batch, indexStart, indexSize, textureBatch, blendMode, topology, instructionSet, action, elements) {
      batch.gpuBindGroup = null;
      batch.bindGroup = null;
      batch.action = action;
      batch.batcher = this;
      batch.textures = textureBatch;
      batch.blendMode = blendMode;
      batch.topology = topology;
      batch.start = indexStart;
      batch.size = indexSize;
      batch.elements = elements;
      ++BATCH_TICK;
      this.batches[this.batchIndex++] = batch;
      instructionSet.add(batch);
    }
    finish(instructionSet) {
      this.break(instructionSet);
    }

    ensureAttributeBuffer(size) {
      if (size * 4 <= this.attributeBuffer.size) return;
      this._resizeAttributeBuffer(size * 4);
    }

    ensureIndexBuffer(size) {
      if (size <= this.indexBuffer.length) return;
      this._resizeIndexBuffer(size);
    }
    _resizeAttributeBuffer(size) {
      const newSize = Math.max(size, this.attributeBuffer.size * 2);
      const newArrayBuffer = new ViewableBuffer(newSize);
      fastCopy(this.attributeBuffer.rawBinaryData, newArrayBuffer.rawBinaryData);
      this.attributeBuffer = newArrayBuffer;
    }
    _resizeIndexBuffer(size) {
      const indexBuffer = this.indexBuffer;
      let newSize = Math.max(size, indexBuffer.length * 1.5);
      newSize += newSize % 2;
      const newIndexBuffer = newSize > 65535 ? new Uint32Array(newSize) : new Uint16Array(newSize);
      if (newIndexBuffer.BYTES_PER_ELEMENT !== indexBuffer.BYTES_PER_ELEMENT) {
        for (let i2 = 0; i2 < indexBuffer.length; i2++) {
          newIndexBuffer[i2] = indexBuffer[i2];
        }
      } else {
        fastCopy(indexBuffer.buffer, newIndexBuffer.buffer);
      }
      this.indexBuffer = newIndexBuffer;
    }
    packQuadIndex(indexBuffer, index, indicesOffset) {
      indexBuffer[index] = indicesOffset + 0;
      indexBuffer[index + 1] = indicesOffset + 1;
      indexBuffer[index + 2] = indicesOffset + 2;
      indexBuffer[index + 3] = indicesOffset + 0;
      indexBuffer[index + 4] = indicesOffset + 2;
      indexBuffer[index + 5] = indicesOffset + 3;
    }
    packIndex(element, indexBuffer, index, indicesOffset) {
      const indices = element.indices;
      const size = element.indexSize;
      const indexOffset = element.indexOffset;
      const attributeOffset = element.attributeOffset;
      for (let i2 = 0; i2 < size; i2++) {
        indexBuffer[index++] = indicesOffset + indices[i2 + indexOffset] - attributeOffset;
      }
    }

    destroy(options = {}) {
      if (this.batches === null) return;
      for (let i2 = 0; i2 < this.batchIndex; i2++) {
        returnBatchToPool(this.batches[i2]);
      }
      this.batches = null;
      this.geometry.destroy(true);
      this.geometry = null;
      if (options.shader) {
        this.shader?.destroy();
        this.shader = null;
      }
      for (let i2 = 0; i2 < this._elements.length; i2++) {
        if (this._elements[i2]) this._elements[i2]._batch = null;
      }
      this._elements = null;
      this.indexBuffer = null;
      this.attributeBuffer.destroy();
      this.attributeBuffer = null;
    }
  };
  _Batcher.defaultOptions = {
    maxTextures: null,
    attributesInitialSize: 4,
    indicesInitialSize: 6
  };
  let Batcher = _Batcher;
  var BufferUsage =                 ((BufferUsage2) => {
    BufferUsage2[BufferUsage2["MAP_READ"] = 1] = "MAP_READ";
    BufferUsage2[BufferUsage2["MAP_WRITE"] = 2] = "MAP_WRITE";
    BufferUsage2[BufferUsage2["COPY_SRC"] = 4] = "COPY_SRC";
    BufferUsage2[BufferUsage2["COPY_DST"] = 8] = "COPY_DST";
    BufferUsage2[BufferUsage2["INDEX"] = 16] = "INDEX";
    BufferUsage2[BufferUsage2["VERTEX"] = 32] = "VERTEX";
    BufferUsage2[BufferUsage2["UNIFORM"] = 64] = "UNIFORM";
    BufferUsage2[BufferUsage2["STORAGE"] = 128] = "STORAGE";
    BufferUsage2[BufferUsage2["INDIRECT"] = 256] = "INDIRECT";
    BufferUsage2[BufferUsage2["QUERY_RESOLVE"] = 512] = "QUERY_RESOLVE";
    BufferUsage2[BufferUsage2["STATIC"] = 1024] = "STATIC";
    return BufferUsage2;
  })(BufferUsage || {});
  class Buffer extends EventEmitter {

    constructor(options) {
      let { data, size } = options;
      const { usage, label, shrinkToFit } = options;
      super();
      this._gpuData =                 Object.create(null);
      this._gcLastUsed = -1;
      this.autoGarbageCollect = true;
      this.uid = uid$1("buffer");
      this._resourceType = "buffer";
      this._resourceId = uid$1("resource");
      this._touched = 0;
      this._updateID = 1;
      this._dataInt32 = null;
      this.shrinkToFit = true;
      this.destroyed = false;
      if (data instanceof Array) {
        data = new Float32Array(data);
      }
      this._data = data;
      size ?? (size = data?.byteLength);
      const mappedAtCreation = !!data;
      this.descriptor = {
        size,
        usage,
        mappedAtCreation,
        label
      };
      this.shrinkToFit = shrinkToFit ?? true;
    }

    get data() {
      return this._data;
    }
    set data(value) {
      this.setDataWithSize(value, value.length, true);
    }
    get dataInt32() {
      if (!this._dataInt32) {
        this._dataInt32 = new Int32Array(this.data.buffer);
      }
      return this._dataInt32;
    }

    get static() {
      return !!(this.descriptor.usage & BufferUsage.STATIC);
    }
    set static(value) {
      if (value) {
        this.descriptor.usage |= BufferUsage.STATIC;
      } else {
        this.descriptor.usage &= ~BufferUsage.STATIC;
      }
    }

    setDataWithSize(value, size, syncGPU) {
      this._updateID++;
      this._updateSize = size * value.BYTES_PER_ELEMENT;
      if (this._data === value) {
        if (syncGPU) this.emit("update", this);
        return;
      }
      const oldData = this._data;
      this._data = value;
      this._dataInt32 = null;
      if (!oldData || oldData.length !== value.length) {
        if (!this.shrinkToFit && oldData && value.byteLength < oldData.byteLength) {
          if (syncGPU) this.emit("update", this);
        } else {
          this.descriptor.size = value.byteLength;
          this._resourceId = uid$1("resource");
          this.emit("change", this);
        }
        return;
      }
      if (syncGPU) this.emit("update", this);
    }

    update(sizeInBytes) {
      this._updateSize = sizeInBytes ?? this._updateSize;
      this._updateID++;
      this.emit("update", this);
    }

    unload() {
      this.emit("unload", this);
      for (const key in this._gpuData) {
        this._gpuData[key]?.destroy();
      }
      this._gpuData =                 Object.create(null);
    }

    destroy() {
      this.destroyed = true;
      this.unload();
      this.emit("destroy", this);
      this.emit("change", this);
      this._data = null;
      this.descriptor = null;
      this.removeAllListeners();
    }
  }
  function ensureIsBuffer(buffer, index) {
    if (!(buffer instanceof Buffer)) {
      let usage = index ? BufferUsage.INDEX : BufferUsage.VERTEX;
      if (buffer instanceof Array) {
        if (index) {
          buffer = new Uint32Array(buffer);
          usage = BufferUsage.INDEX | BufferUsage.COPY_DST;
        } else {
          buffer = new Float32Array(buffer);
          usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
        }
      }
      buffer = new Buffer({
        data: buffer,
        label: index ? "index-mesh-buffer" : "vertex-mesh-buffer",
        usage
      });
    }
    return buffer;
  }
  function getGeometryBounds(geometry, attributeId, bounds) {
    const attribute = geometry.getAttribute(attributeId);
    if (!attribute) {
      bounds.minX = 0;
      bounds.minY = 0;
      bounds.maxX = 0;
      bounds.maxY = 0;
      return bounds;
    }
    const data = attribute.buffer.data;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const byteSize = data.BYTES_PER_ELEMENT;
    const offset2 = (attribute.offset || 0) / byteSize;
    const stride = (attribute.stride || 2 * 4) / byteSize;
    for (let i2 = offset2; i2 < data.length; i2 += stride) {
      const x2 = data[i2];
      const y2 = data[i2 + 1];
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      if (x2 < minX) minX = x2;
      if (y2 < minY) minY = y2;
    }
    bounds.minX = minX;
    bounds.minY = minY;
    bounds.maxX = maxX;
    bounds.maxY = maxY;
    return bounds;
  }
  function ensureIsAttribute(attribute) {
    if (attribute instanceof Buffer || Array.isArray(attribute) || attribute.BYTES_PER_ELEMENT) {
      attribute = {
        buffer: attribute
      };
    }
    attribute.buffer = ensureIsBuffer(attribute.buffer, false);
    return attribute;
  }
  class Geometry extends EventEmitter {

    constructor(options = {}) {
      super();
      this._gpuData =                 Object.create(null);
      this.autoGarbageCollect = true;
      this._gcLastUsed = -1;
      this.uid = uid$1("geometry");
      this._layoutKey = 0;
      this.instanceCount = 1;
      this._bounds = new Bounds();
      this._boundsDirty = true;
      const { attributes, indexBuffer, topology } = options;
      this.buffers = [];
      this.attributes = {};
      if (attributes) {
        for (const i2 in attributes) {
          this.addAttribute(i2, attributes[i2]);
        }
      }
      this.instanceCount = options.instanceCount ?? 1;
      if (indexBuffer) {
        this.addIndex(indexBuffer);
      }
      this.topology = topology || "triangle-list";
    }
    onBufferUpdate() {
      this._boundsDirty = true;
      this.emit("update", this);
    }

    getAttribute(id) {
      return this.attributes[id];
    }

    getIndex() {
      return this.indexBuffer;
    }

    getBuffer(id) {
      return this.getAttribute(id).buffer;
    }

    getSize() {
      for (const i2 in this.attributes) {
        const attribute = this.attributes[i2];
        const buffer = attribute.buffer;
        return buffer.data.length / (attribute.stride / 4 || attribute.size);
      }
      return 0;
    }

    addAttribute(name, attributeOption) {
      const attribute = ensureIsAttribute(attributeOption);
      const bufferIndex = this.buffers.indexOf(attribute.buffer);
      if (bufferIndex === -1) {
        this.buffers.push(attribute.buffer);
        attribute.buffer.on("update", this.onBufferUpdate, this);
        attribute.buffer.on("change", this.onBufferUpdate, this);
      }
      this.attributes[name] = attribute;
    }

    addIndex(indexBuffer) {
      this.indexBuffer = ensureIsBuffer(indexBuffer, true);
      this.buffers.push(this.indexBuffer);
    }

    get bounds() {
      if (!this._boundsDirty) return this._bounds;
      this._boundsDirty = false;
      return getGeometryBounds(this, "aPosition", this._bounds);
    }

    unload() {
      this.emit("unload", this);
      for (const key in this._gpuData) {
        this._gpuData[key]?.destroy();
      }
      this._gpuData =                 Object.create(null);
    }

    destroy(destroyBuffers = false) {
      this.emit("destroy", this);
      this.removeAllListeners();
      if (destroyBuffers) {
        this.buffers.forEach((buffer) => buffer.destroy());
      }
      this.unload();
      this.indexBuffer?.destroy();
      this.attributes = null;
      this.buffers = null;
      this.indexBuffer = null;
      this._bounds = null;
    }
  }
  const placeHolderBufferData = new Float32Array(1);
  const placeHolderIndexData = new Uint32Array(1);
  class BatchGeometry extends Geometry {
    constructor() {
      const vertexSize = 6;
      const attributeBuffer = new Buffer({
        data: placeHolderBufferData,
        label: "attribute-batch-buffer",
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        shrinkToFit: false
      });
      const indexBuffer = new Buffer({
        data: placeHolderIndexData,
        label: "index-batch-buffer",
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,

        shrinkToFit: false
      });
      const stride = vertexSize * 4;
      super({
        attributes: {
          aPosition: {
            buffer: attributeBuffer,
            format: "float32x2",
            stride,
            offset: 0
          },
          aUV: {
            buffer: attributeBuffer,
            format: "float32x2",
            stride,
            offset: 2 * 4
          },
          aColor: {
            buffer: attributeBuffer,
            format: "unorm8x4",
            stride,
            offset: 4 * 4
          },
          aTextureIdAndRound: {
            buffer: attributeBuffer,
            format: "uint16x2",
            stride,
            offset: 5 * 4
          }
        },
        indexBuffer
      });
    }
  }
  function addBits(srcParts, parts, name) {
    if (srcParts) {
      for (const i2 in srcParts) {
        const id = i2.toLocaleLowerCase();
        const part = parts[id];
        if (part) {
          let sanitisedPart = srcParts[i2];
          if (i2 === "header") {
            sanitisedPart = sanitisedPart.replace(/@in\s+[^;]+;\s*/g, "").replace(/@out\s+[^;]+;\s*/g, "");
          }
          if (name) {
            part.push(`//----${name}----//`);
          }
          part.push(sanitisedPart);
        } else {
          warn(`${i2} placement hook does not exist in shader`);
        }
      }
    }
  }
  const findHooksRx = /\{\{(.*?)\}\}/g;
  function compileHooks(programSrc) {
    const parts = {};
    const partMatches = programSrc.match(findHooksRx)?.map((hook) => hook.replace(/[{()}]/g, "")) ?? [];
    partMatches.forEach((hook) => {
      parts[hook] = [];
    });
    return parts;
  }
  function extractInputs(fragmentSource, out2) {
    let match;
    const regex = /@in\s+([^;]+);/g;
    while ((match = regex.exec(fragmentSource)) !== null) {
      out2.push(match[1]);
    }
  }
  function compileInputs(fragments, template, sort = false) {
    const results = [];
    extractInputs(template, results);
    fragments.forEach((fragment2) => {
      if (fragment2.header) {
        extractInputs(fragment2.header, results);
      }
    });
    const mainInput = results;
    if (sort) {
      mainInput.sort();
    }
    const finalString = mainInput.map((inValue, i2) => `       @location(${i2}) ${inValue},`).join("\n");
    let cleanedString = template.replace(/@in\s+[^;]+;\s*/g, "");
    cleanedString = cleanedString.replace("{{in}}", `
${finalString}
`);
    return cleanedString;
  }
  function extractOutputs(fragmentSource, out2) {
    let match;
    const regex = /@out\s+([^;]+);/g;
    while ((match = regex.exec(fragmentSource)) !== null) {
      out2.push(match[1]);
    }
  }
  function extractVariableName(value) {
    const regex = /\b(\w+)\s*:/g;
    const match = regex.exec(value);
    return match ? match[1] : "";
  }
  function stripVariable(value) {
    const regex = /@.*?\s+/g;
    return value.replace(regex, "");
  }
  function compileOutputs(fragments, template) {
    const results = [];
    extractOutputs(template, results);
    fragments.forEach((fragment2) => {
      if (fragment2.header) {
        extractOutputs(fragment2.header, results);
      }
    });
    let index = 0;
    const mainStruct = results.sort().map((inValue) => {
      if (inValue.indexOf("builtin") > -1) {
        return inValue;
      }
      return `@location(${index++}) ${inValue}`;
    }).join(",\n");
    const mainStart = results.sort().map((inValue) => `       var ${stripVariable(inValue)};`).join("\n");
    const mainEnd = `return VSOutput(
            ${results.sort().map((inValue) => ` ${extractVariableName(inValue)}`).join(",\n")});`;
    let compiledCode = template.replace(/@out\s+[^;]+;\s*/g, "");
    compiledCode = compiledCode.replace("{{struct}}", `
${mainStruct}
`);
    compiledCode = compiledCode.replace("{{start}}", `
${mainStart}
`);
    compiledCode = compiledCode.replace("{{return}}", `
${mainEnd}
`);
    return compiledCode;
  }
  function injectBits(templateSrc, fragmentParts) {
    let out2 = templateSrc;
    for (const i2 in fragmentParts) {
      const parts = fragmentParts[i2];
      const toInject = parts.join("\n");
      if (toInject.length) {
        out2 = out2.replace(`{{${i2}}}`, `//-----${i2} START-----//
${parts.join("\n")}
//----${i2} FINISH----//`);
      } else {
        out2 = out2.replace(`{{${i2}}}`, "");
      }
    }
    return out2;
  }
  const cacheMap =                 Object.create(null);
  const bitCacheMap =                 new Map();
  let CACHE_UID = 0;
  function compileHighShader({
    template,
    bits
  }) {
    const cacheId = generateCacheId(template, bits);
    if (cacheMap[cacheId]) return cacheMap[cacheId];
    const { vertex: vertex2, fragment: fragment2 } = compileInputsAndOutputs(template, bits);
    cacheMap[cacheId] = compileBits(vertex2, fragment2, bits);
    return cacheMap[cacheId];
  }
  function compileHighShaderGl({
    template,
    bits
  }) {
    const cacheId = generateCacheId(template, bits);
    if (cacheMap[cacheId]) return cacheMap[cacheId];
    cacheMap[cacheId] = compileBits(template.vertex, template.fragment, bits);
    return cacheMap[cacheId];
  }
  function compileInputsAndOutputs(template, bits) {
    const vertexFragments = bits.map((shaderBit) => shaderBit.vertex).filter((v2) => !!v2);
    const fragmentFragments = bits.map((shaderBit) => shaderBit.fragment).filter((v2) => !!v2);
    let compiledVertex = compileInputs(vertexFragments, template.vertex, true);
    compiledVertex = compileOutputs(vertexFragments, compiledVertex);
    const compiledFragment = compileInputs(fragmentFragments, template.fragment, true);
    return {
      vertex: compiledVertex,
      fragment: compiledFragment
    };
  }
  function generateCacheId(template, bits) {
    return bits.map((highFragment) => {
      if (!bitCacheMap.has(highFragment)) {
        bitCacheMap.set(highFragment, CACHE_UID++);
      }
      return bitCacheMap.get(highFragment);
    }).sort((a2, b2) => a2 - b2).join("-") + template.vertex + template.fragment;
  }
  function compileBits(vertex2, fragment2, bits) {
    const vertexParts = compileHooks(vertex2);
    const fragmentParts = compileHooks(fragment2);
    bits.forEach((shaderBit) => {
      addBits(shaderBit.vertex, vertexParts, shaderBit.name);
      addBits(shaderBit.fragment, fragmentParts, shaderBit.name);
    });
    return {
      vertex: injectBits(vertex2, vertexParts),
      fragment: injectBits(fragment2, fragmentParts)
    };
  }
  const vertexGPUTemplate = (

    `
    @in aPosition: vec2<f32>;
    @in aUV: vec2<f32>;

    @out @builtin(position) vPosition: vec4<f32>;
    @out vUV : vec2<f32>;
    @out vColor : vec4<f32>;

    {{header}}

    struct VSOutput {
        {{struct}}
    };

    @vertex
    fn main( {{in}} ) -> VSOutput {

        var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
        var modelMatrix = mat3x3<f32>(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        var position = aPosition;
        var uv = aUV;

        {{start}}

        vColor = vec4<f32>(1., 1., 1., 1.);

        {{main}}

        vUV = uv;

        var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;

        vPosition =  vec4<f32>((modelViewProjectionMatrix *  vec3<f32>(position, 1.0)).xy, 0.0, 1.0);

        vColor *= globalUniforms.uWorldColorAlpha;

        {{end}}

        {{return}}
    };
`
  );
  const fragmentGPUTemplate = (

    `
    @in vUV : vec2<f32>;
    @in vColor : vec4<f32>;

    {{header}}

    @fragment
    fn main(
        {{in}}
      ) -> @location(0) vec4<f32> {

        {{start}}

        var outColor:vec4<f32>;

        {{main}}

        var finalColor:vec4<f32> = outColor * vColor;

        {{end}}

        return finalColor;
      };
`
  );
  const vertexGlTemplate = (

    `
    in vec2 aPosition;
    in vec2 aUV;

    out vec4 vColor;
    out vec2 vUV;

    {{header}}

    void main(void){

        mat3 worldTransformMatrix = uWorldTransformMatrix;
        mat3 modelMatrix = mat3(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        vec2 position = aPosition;
        vec2 uv = aUV;

        {{start}}

        vColor = vec4(1.);

        {{main}}

        vUV = uv;

        mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;

        gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);

        vColor *= uWorldColorAlpha;

        {{end}}
    }
`
  );
  const fragmentGlTemplate = (

    `

    in vec4 vColor;
    in vec2 vUV;

    out vec4 finalColor;

    {{header}}

    void main(void) {

        {{start}}

        vec4 outColor;

        {{main}}

        finalColor = outColor * vColor;

        {{end}}
    }
`
  );
  const globalUniformsBit = {
    name: "global-uniforms-bit",
    vertex: {
      header: (

        `
        struct GlobalUniforms {
            uProjectionMatrix:mat3x3<f32>,
            uWorldTransformMatrix:mat3x3<f32>,
            uWorldColorAlpha: vec4<f32>,
            uResolution: vec2<f32>,
        }

        @group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
        `
      )
    }
  };
  const globalUniformsBitGl = {
    name: "global-uniforms-bit",
    vertex: {
      header: (

        `
          uniform mat3 uProjectionMatrix;
          uniform mat3 uWorldTransformMatrix;
          uniform vec4 uWorldColorAlpha;
          uniform vec2 uResolution;
        `
      )
    }
  };
  function compileHighShaderGpuProgram({ bits, name }) {
    const source2 = compileHighShader({
      template: {
        fragment: fragmentGPUTemplate,
        vertex: vertexGPUTemplate
      },
      bits: [
        globalUniformsBit,
        ...bits
      ]
    });
    return GpuProgram.from({
      name,
      vertex: {
        source: source2.vertex,
        entryPoint: "main"
      },
      fragment: {
        source: source2.fragment,
        entryPoint: "main"
      }
    });
  }
  function compileHighShaderGlProgram({ bits, name }) {
    return new GlProgram({
      name,
      ...compileHighShaderGl({
        template: {
          vertex: vertexGlTemplate,
          fragment: fragmentGlTemplate
        },
        bits: [
          globalUniformsBitGl,
          ...bits
        ]
      })
    });
  }
  const colorBit = {
    name: "color-bit",
    vertex: {
      header: (

        `
            @in aColor: vec4<f32>;
        `
      ),
      main: (

        `
            vColor *= vec4<f32>(aColor.rgb * aColor.a, aColor.a);
        `
      )
    }
  };
  const colorBitGl = {
    name: "color-bit",
    vertex: {
      header: (

        `
            in vec4 aColor;
        `
      ),
      main: (

        `
            vColor *= vec4(aColor.rgb * aColor.a, aColor.a);
        `
      )
    }
  };
  const textureBatchBitGpuCache = {};
  function generateBindingSrc(maxTextures) {
    const src = [];
    if (maxTextures === 1) {
      src.push("@group(1) @binding(0) var textureSource1: texture_2d<f32>;");
      src.push("@group(1) @binding(1) var textureSampler1: sampler;");
    } else {
      let bindingIndex = 0;
      for (let i2 = 0; i2 < maxTextures; i2++) {
        src.push(`@group(1) @binding(${bindingIndex++}) var textureSource${i2 + 1}: texture_2d<f32>;`);
        src.push(`@group(1) @binding(${bindingIndex++}) var textureSampler${i2 + 1}: sampler;`);
      }
    }
    return src.join("\n");
  }
  function generateSampleSrc(maxTextures) {
    const src = [];
    if (maxTextures === 1) {
      src.push("outColor = textureSampleGrad(textureSource1, textureSampler1, vUV, uvDx, uvDy);");
    } else {
      src.push("switch vTextureId {");
      for (let i2 = 0; i2 < maxTextures; i2++) {
        if (i2 === maxTextures - 1) {
          src.push(`  default:{`);
        } else {
          src.push(`  case ${i2}:{`);
        }
        src.push(`      outColor = textureSampleGrad(textureSource${i2 + 1}, textureSampler${i2 + 1}, vUV, uvDx, uvDy);`);
        src.push(`      break;}`);
      }
      src.push(`}`);
    }
    return src.join("\n");
  }
  function generateTextureBatchBit(maxTextures) {
    if (!textureBatchBitGpuCache[maxTextures]) {
      textureBatchBitGpuCache[maxTextures] = {
        name: "texture-batch-bit",
        vertex: {
          header: `
                @in aTextureIdAndRound: vec2<u32>;
                @out @interpolate(flat) vTextureId : u32;
            `,
          main: `
                vTextureId = aTextureIdAndRound.y;
            `,
          end: `
                if(aTextureIdAndRound.x == 1)
                {
                    vPosition = vec4<f32>(roundPixels(vPosition.xy, globalUniforms.uResolution), vPosition.zw);
                }
            `
        },
        fragment: {
          header: `
                @in @interpolate(flat) vTextureId: u32;

                ${generateBindingSrc(maxTextures)}
            `,
          main: `
                var uvDx = dpdx(vUV);
                var uvDy = dpdy(vUV);

                ${generateSampleSrc(maxTextures)}
            `
        }
      };
    }
    return textureBatchBitGpuCache[maxTextures];
  }
  const textureBatchBitGlCache = {};
  function generateSampleGlSrc(maxTextures) {
    const src = [];
    for (let i2 = 0; i2 < maxTextures; i2++) {
      if (i2 > 0) {
        src.push("else");
      }
      if (i2 < maxTextures - 1) {
        src.push(`if(vTextureId < ${i2}.5)`);
      }
      src.push("{");
      src.push(`	outColor = texture(uTextures[${i2}], vUV);`);
      src.push("}");
    }
    return src.join("\n");
  }
  function generateTextureBatchBitGl(maxTextures) {
    if (!textureBatchBitGlCache[maxTextures]) {
      textureBatchBitGlCache[maxTextures] = {
        name: "texture-batch-bit",
        vertex: {
          header: `
                in vec2 aTextureIdAndRound;
                out float vTextureId;

            `,
          main: `
                vTextureId = aTextureIdAndRound.y;
            `,
          end: `
                if(aTextureIdAndRound.x == 1.)
                {
                    gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
                }
            `
        },
        fragment: {
          header: `
                in float vTextureId;

                uniform sampler2D uTextures[${maxTextures}];

            `,
          main: `

                ${generateSampleGlSrc(maxTextures)}
            `
        }
      };
    }
    return textureBatchBitGlCache[maxTextures];
  }
  const roundPixelsBit = {
    name: "round-pixels-bit",
    vertex: {
      header: (

        `
            fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32>
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `
      )
    }
  };
  const roundPixelsBitGl = {
    name: "round-pixels-bit",
    vertex: {
      header: (

        `
            vec2 roundPixels(vec2 position, vec2 targetSize)
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `
      )
    }
  };
  const batchSamplersUniformGroupHash = {};
  function getBatchSamplersUniformGroup(maxTextures) {
    let batchSamplersUniformGroup = batchSamplersUniformGroupHash[maxTextures];
    if (batchSamplersUniformGroup) return batchSamplersUniformGroup;
    const sampleValues = new Int32Array(maxTextures);
    for (let i2 = 0; i2 < maxTextures; i2++) {
      sampleValues[i2] = i2;
    }
    batchSamplersUniformGroup = batchSamplersUniformGroupHash[maxTextures] = new UniformGroup({
      uTextures: { value: sampleValues, type: `i32`, size: maxTextures }
    }, { isStatic: true });
    return batchSamplersUniformGroup;
  }
  class DefaultShader extends Shader {
    constructor(maxTextures) {
      const glProgram = compileHighShaderGlProgram({
        name: "batch",
        bits: [
          colorBitGl,
          generateTextureBatchBitGl(maxTextures),
          roundPixelsBitGl
        ]
      });
      const gpuProgram = compileHighShaderGpuProgram({
        name: "batch",
        bits: [
          colorBit,
          generateTextureBatchBit(maxTextures),
          roundPixelsBit
        ]
      });
      super({
        glProgram,
        gpuProgram,
        resources: {
          batchSamplers: getBatchSamplersUniformGroup(maxTextures)
        }
      });
      this.maxTextures = maxTextures;
    }
  }
  let defaultShader = null;
  const _DefaultBatcher = class _DefaultBatcher2 extends Batcher {
    constructor(options) {
      super(options);
      this.geometry = new BatchGeometry();
      this.name = _DefaultBatcher2.extension.name;
      this.vertexSize = 6;
      defaultShader ?? (defaultShader = new DefaultShader(options.maxTextures));
      this.shader = defaultShader;
    }

    packAttributes(element, float32View, uint32View, index, textureId) {
      const textureIdAndRound = textureId << 16 | element.roundPixels & 65535;
      const wt = element.transform;
      const a2 = wt.a;
      const b2 = wt.b;
      const c2 = wt.c;
      const d2 = wt.d;
      const tx = wt.tx;
      const ty = wt.ty;
      const { positions, uvs } = element;
      const argb = element.color;
      const offset2 = element.attributeOffset;
      const end = offset2 + element.attributeSize;
      for (let i2 = offset2; i2 < end; i2++) {
        const i22 = i2 * 2;
        const x2 = positions[i22];
        const y2 = positions[i22 + 1];
        float32View[index++] = a2 * x2 + c2 * y2 + tx;
        float32View[index++] = d2 * y2 + b2 * x2 + ty;
        float32View[index++] = uvs[i22];
        float32View[index++] = uvs[i22 + 1];
        uint32View[index++] = argb;
        uint32View[index++] = textureIdAndRound;
      }
    }

    packQuadAttributes(element, float32View, uint32View, index, textureId) {
      const texture = element.texture;
      const wt = element.transform;
      const a2 = wt.a;
      const b2 = wt.b;
      const c2 = wt.c;
      const d2 = wt.d;
      const tx = wt.tx;
      const ty = wt.ty;
      const bounds = element.bounds;
      const w0 = bounds.maxX;
      const w1 = bounds.minX;
      const h0 = bounds.maxY;
      const h1 = bounds.minY;
      const uvs = texture.uvs;
      const argb = element.color;
      const textureIdAndRound = textureId << 16 | element.roundPixels & 65535;
      float32View[index + 0] = a2 * w1 + c2 * h1 + tx;
      float32View[index + 1] = d2 * h1 + b2 * w1 + ty;
      float32View[index + 2] = uvs.x0;
      float32View[index + 3] = uvs.y0;
      uint32View[index + 4] = argb;
      uint32View[index + 5] = textureIdAndRound;
      float32View[index + 6] = a2 * w0 + c2 * h1 + tx;
      float32View[index + 7] = d2 * h1 + b2 * w0 + ty;
      float32View[index + 8] = uvs.x1;
      float32View[index + 9] = uvs.y1;
      uint32View[index + 10] = argb;
      uint32View[index + 11] = textureIdAndRound;
      float32View[index + 12] = a2 * w0 + c2 * h0 + tx;
      float32View[index + 13] = d2 * h0 + b2 * w0 + ty;
      float32View[index + 14] = uvs.x2;
      float32View[index + 15] = uvs.y2;
      uint32View[index + 16] = argb;
      uint32View[index + 17] = textureIdAndRound;
      float32View[index + 18] = a2 * w1 + c2 * h0 + tx;
      float32View[index + 19] = d2 * h0 + b2 * w1 + ty;
      float32View[index + 20] = uvs.x3;
      float32View[index + 21] = uvs.y3;
      uint32View[index + 22] = argb;
      uint32View[index + 23] = textureIdAndRound;
    }

    _updateMaxTextures(maxTextures) {
      if (this.shader.maxTextures === maxTextures) return;
      defaultShader = new DefaultShader(maxTextures);
      this.shader = defaultShader;
    }
    destroy() {
      this.shader = null;
      super.destroy();
    }
  };
  _DefaultBatcher.extension = {
    type: [
      ExtensionType.Batcher
    ],
    name: "default"
  };
  let DefaultBatcher = _DefaultBatcher;
  class GCManagedHash {
    constructor(options) {
      this.items =                 Object.create(null);
      const { renderer, type, onUnload, priority, name } = options;
      this._renderer = renderer;
      renderer.gc.addResourceHash(this, "items", type, priority ?? 0);
      this._onUnload = onUnload;
      this.name = name;
    }

    add(item) {
      if (this.items[item.uid]) return false;
      this.items[item.uid] = item;
      item.once("unload", this.remove, this);
      item._gcLastUsed = this._renderer.gc.now;
      return true;
    }
    remove(item, ...args) {
      if (!this.items[item.uid]) return;
      const gpuData = item._gpuData[this._renderer.uid];
      if (!gpuData) return;
      this._onUnload?.(item, ...args);
      gpuData.destroy();
      item._gpuData[this._renderer.uid] = null;
      this.items[item.uid] = null;
    }
    removeAll(...args) {
      Object.values(this.items).forEach((item) => item && this.remove(item, ...args));
    }
    destroy(...args) {
      this.removeAll(...args);
      this.items =                 Object.create(null);
      this._renderer = null;
      this._onUnload = null;
    }
  }
  function buildUvs(vertices, verticesStride, verticesOffset, uvs, uvsOffset, uvsStride, size, matrix = null) {
    let index = 0;
    verticesOffset *= verticesStride;
    uvsOffset *= uvsStride;
    const a2 = matrix.a;
    const b2 = matrix.b;
    const c2 = matrix.c;
    const d2 = matrix.d;
    const tx = matrix.tx;
    const ty = matrix.ty;
    while (index < size) {
      const x2 = vertices[verticesOffset];
      const y2 = vertices[verticesOffset + 1];
      uvs[uvsOffset] = a2 * x2 + c2 * y2 + tx;
      uvs[uvsOffset + 1] = b2 * x2 + d2 * y2 + ty;
      uvsOffset += uvsStride;
      verticesOffset += verticesStride;
      index++;
    }
  }
  function buildSimpleUvs(uvs, uvsOffset, uvsStride, size) {
    let index = 0;
    uvsOffset *= uvsStride;
    while (index < size) {
      uvs[uvsOffset] = 0;
      uvs[uvsOffset + 1] = 0;
      uvsOffset += uvsStride;
      index++;
    }
  }
  function transformVertices(vertices, m2, offset2, stride, size) {
    const a2 = m2.a;
    const b2 = m2.b;
    const c2 = m2.c;
    const d2 = m2.d;
    const tx = m2.tx;
    const ty = m2.ty;
    offset2 || (offset2 = 0);
    stride || (stride = 2);
    size || (size = vertices.length / stride - offset2);
    let index = offset2 * stride;
    for (let i2 = 0; i2 < size; i2++) {
      const x2 = vertices[index];
      const y2 = vertices[index + 1];
      vertices[index] = a2 * x2 + c2 * y2 + tx;
      vertices[index + 1] = b2 * x2 + d2 * y2 + ty;
      index += stride;
    }
  }
  const identityMatrix = new Matrix();
  class BatchableGraphics {
    constructor() {
      this.packAsQuad = false;
      this.batcherName = "default";
      this.topology = "triangle-list";
      this.applyTransform = true;
      this.roundPixels = 0;
      this._batcher = null;
      this._batch = null;
    }
    get uvs() {
      return this.geometryData.uvs;
    }
    get positions() {
      return this.geometryData.vertices;
    }
    get indices() {
      return this.geometryData.indices;
    }
    get blendMode() {
      if (this.renderable && this.applyTransform) {
        return this.renderable.groupBlendMode;
      }
      return "normal";
    }
    get color() {
      const rgb = this.baseColor;
      const bgr = rgb >> 16 | rgb & 65280 | (rgb & 255) << 16;
      const renderable = this.renderable;
      if (renderable) {
        return multiplyHexColors(bgr, renderable.groupColor) + (this.alpha * renderable.groupAlpha * 255 << 24);
      }
      return bgr + (this.alpha * 255 << 24);
    }
    get transform() {
      return this.renderable?.groupTransform || identityMatrix;
    }
    copyTo(gpuBuffer) {
      gpuBuffer.indexOffset = this.indexOffset;
      gpuBuffer.indexSize = this.indexSize;
      gpuBuffer.attributeOffset = this.attributeOffset;
      gpuBuffer.attributeSize = this.attributeSize;
      gpuBuffer.baseColor = this.baseColor;
      gpuBuffer.alpha = this.alpha;
      gpuBuffer.texture = this.texture;
      gpuBuffer.geometryData = this.geometryData;
      gpuBuffer.topology = this.topology;
    }
    reset() {
      this.applyTransform = true;
      this.renderable = null;
      this.topology = "triangle-list";
    }
    destroy() {
      this.renderable = null;
      this.texture = null;
      this.geometryData = null;
      this._batcher = null;
      this._batch = null;
    }
  }
  const buildCircle = {
    extension: {
      type: ExtensionType.ShapeBuilder,
      name: "circle"
    },
    build(shape, points) {
      let x2;
      let y2;
      let dx;
      let dy;
      let rx;
      let ry;
      if (shape.type === "circle") {
        const circle = shape;
        rx = ry = circle.radius;
        if (rx <= 0) {
          return false;
        }
        x2 = circle.x;
        y2 = circle.y;
        dx = dy = 0;
      } else if (shape.type === "ellipse") {
        const ellipse = shape;
        rx = ellipse.halfWidth;
        ry = ellipse.halfHeight;
        if (rx <= 0 || ry <= 0) {
          return false;
        }
        x2 = ellipse.x;
        y2 = ellipse.y;
        dx = dy = 0;
      } else {
        const roundedRect = shape;
        const halfWidth = roundedRect.width / 2;
        const halfHeight = roundedRect.height / 2;
        x2 = roundedRect.x + halfWidth;
        y2 = roundedRect.y + halfHeight;
        rx = ry = Math.max(0, Math.min(roundedRect.radius, Math.min(halfWidth, halfHeight)));
        dx = halfWidth - rx;
        dy = halfHeight - ry;
      }
      if (dx < 0 || dy < 0) {
        return false;
      }
      const n2 = Math.ceil(2.3 * Math.sqrt(rx + ry));
      const m2 = n2 * 8 + (dx ? 4 : 0) + (dy ? 4 : 0);
      if (m2 === 0) {
        return false;
      }
      if (n2 === 0) {
        points[0] = points[6] = x2 + dx;
        points[1] = points[3] = y2 + dy;
        points[2] = points[4] = x2 - dx;
        points[5] = points[7] = y2 - dy;
        return true;
      }
      let j1 = 0;
      let j2 = n2 * 4 + (dx ? 2 : 0) + 2;
      let j3 = j2;
      let j4 = m2;
      let x0 = dx + rx;
      let y0 = dy;
      let x1 = x2 + x0;
      let x22 = x2 - x0;
      let y1 = y2 + y0;
      points[j1++] = x1;
      points[j1++] = y1;
      points[--j2] = y1;
      points[--j2] = x22;
      if (dy) {
        const y222 = y2 - y0;
        points[j3++] = x22;
        points[j3++] = y222;
        points[--j4] = y222;
        points[--j4] = x1;
      }
      for (let i2 = 1; i2 < n2; i2++) {
        const a2 = Math.PI / 2 * (i2 / n2);
        const x02 = dx + Math.cos(a2) * rx;
        const y02 = dy + Math.sin(a2) * ry;
        const x12 = x2 + x02;
        const x222 = x2 - x02;
        const y12 = y2 + y02;
        const y222 = y2 - y02;
        points[j1++] = x12;
        points[j1++] = y12;
        points[--j2] = y12;
        points[--j2] = x222;
        points[j3++] = x222;
        points[j3++] = y222;
        points[--j4] = y222;
        points[--j4] = x12;
      }
      x0 = dx;
      y0 = dy + ry;
      x1 = x2 + x0;
      x22 = x2 - x0;
      y1 = y2 + y0;
      const y22 = y2 - y0;
      points[j1++] = x1;
      points[j1++] = y1;
      points[--j4] = y22;
      points[--j4] = x1;
      if (dx) {
        points[j1++] = x22;
        points[j1++] = y1;
        points[--j4] = y22;
        points[--j4] = x22;
      }
      return true;
    },
    triangulate(points, vertices, verticesStride, verticesOffset, indices, indicesOffset) {
      if (points.length === 0) {
        return;
      }
      let centerX = 0;
      let centerY = 0;
      for (let i2 = 0; i2 < points.length; i2 += 2) {
        centerX += points[i2];
        centerY += points[i2 + 1];
      }
      centerX /= points.length / 2;
      centerY /= points.length / 2;
      let count2 = verticesOffset;
      vertices[count2 * verticesStride] = centerX;
      vertices[count2 * verticesStride + 1] = centerY;
      const centerIndex = count2++;
      for (let i2 = 0; i2 < points.length; i2 += 2) {
        vertices[count2 * verticesStride] = points[i2];
        vertices[count2 * verticesStride + 1] = points[i2 + 1];
        if (i2 > 0) {
          indices[indicesOffset++] = count2;
          indices[indicesOffset++] = centerIndex;
          indices[indicesOffset++] = count2 - 1;
        }
        count2++;
      }
      indices[indicesOffset++] = centerIndex + 1;
      indices[indicesOffset++] = centerIndex;
      indices[indicesOffset++] = count2 - 1;
    }
  };
  const buildEllipse = { ...buildCircle, extension: { ...buildCircle.extension, name: "ellipse" } };
  const buildRoundedRectangle = { ...buildCircle, extension: { ...buildCircle.extension, name: "roundedRectangle" } };
  const closePointEps = 1e-4;
  const curveEps = 1e-4;
  function getOrientationOfPoints(points) {
    const m2 = points.length;
    if (m2 < 6) {
      return 1;
    }
    let area2 = 0;
    for (let i2 = 0, x1 = points[m2 - 2], y1 = points[m2 - 1]; i2 < m2; i2 += 2) {
      const x2 = points[i2];
      const y2 = points[i2 + 1];
      area2 += (x2 - x1) * (y2 + y1);
      x1 = x2;
      y1 = y2;
    }
    if (area2 < 0) {
      return -1;
    }
    return 1;
  }
  function square(x2, y2, nx, ny, innerWeight, outerWeight, clockwise, verts) {
    const ix = x2 - nx * innerWeight;
    const iy = y2 - ny * innerWeight;
    const ox = x2 + nx * outerWeight;
    const oy = y2 + ny * outerWeight;
    let exx;
    let eyy;
    if (clockwise) {
      exx = ny;
      eyy = -nx;
    } else {
      exx = -ny;
      eyy = nx;
    }
    const eix = ix + exx;
    const eiy = iy + eyy;
    const eox = ox + exx;
    const eoy = oy + eyy;
    verts.push(eix, eiy);
    verts.push(eox, eoy);
    return 2;
  }
  function round(cx, cy, sx, sy, ex, ey, verts, clockwise) {
    const cx2p0x = sx - cx;
    const cy2p0y = sy - cy;
    let angle0 = Math.atan2(cx2p0x, cy2p0y);
    let angle1 = Math.atan2(ex - cx, ey - cy);
    if (clockwise && angle0 < angle1) {
      angle0 += Math.PI * 2;
    } else if (!clockwise && angle0 > angle1) {
      angle1 += Math.PI * 2;
    }
    let startAngle = angle0;
    const angleDiff = angle1 - angle0;
    const absAngleDiff = Math.abs(angleDiff);
    const radius = Math.sqrt(cx2p0x * cx2p0x + cy2p0y * cy2p0y);
    const segCount = (15 * absAngleDiff * Math.sqrt(radius) / Math.PI >> 0) + 1;
    const angleInc = angleDiff / segCount;
    startAngle += angleInc;
    if (clockwise) {
      verts.push(cx, cy);
      verts.push(sx, sy);
      for (let i2 = 1, angle = startAngle; i2 < segCount; i2++, angle += angleInc) {
        verts.push(cx, cy);
        verts.push(
          cx + Math.sin(angle) * radius,
          cy + Math.cos(angle) * radius
        );
      }
      verts.push(cx, cy);
      verts.push(ex, ey);
    } else {
      verts.push(sx, sy);
      verts.push(cx, cy);
      for (let i2 = 1, angle = startAngle; i2 < segCount; i2++, angle += angleInc) {
        verts.push(
          cx + Math.sin(angle) * radius,
          cy + Math.cos(angle) * radius
        );
        verts.push(cx, cy);
      }
      verts.push(ex, ey);
      verts.push(cx, cy);
    }
    return segCount * 2;
  }
  function buildLine(points, lineStyle, flipAlignment, closed, vertices, indices) {
    const eps = closePointEps;
    if (points.length === 0) {
      return;
    }
    const style = lineStyle;
    let alignment = style.alignment;
    if (lineStyle.alignment !== 0.5) {
      let orientation = getOrientationOfPoints(points);
      alignment = (alignment - 0.5) * orientation + 0.5;
    }
    const firstPoint = new Point(points[0], points[1]);
    const lastPoint = new Point(points[points.length - 2], points[points.length - 1]);
    const closedShape = closed;
    const closedPath = Math.abs(firstPoint.x - lastPoint.x) < eps && Math.abs(firstPoint.y - lastPoint.y) < eps;
    if (closedShape) {
      points = points.slice();
      if (closedPath) {
        points.pop();
        points.pop();
        lastPoint.set(points[points.length - 2], points[points.length - 1]);
      }
      const midPointX = (firstPoint.x + lastPoint.x) * 0.5;
      const midPointY = (lastPoint.y + firstPoint.y) * 0.5;
      points.unshift(midPointX, midPointY);
      points.push(midPointX, midPointY);
    }
    const verts = vertices;
    const length2 = points.length / 2;
    let indexCount = points.length;
    const indexStart = verts.length / 2;
    const width = style.width / 2;
    const widthSquared = width * width;
    const miterLimitSquared = style.miterLimit * style.miterLimit;
    let x0 = points[0];
    let y0 = points[1];
    let x1 = points[2];
    let y1 = points[3];
    let x2 = 0;
    let y2 = 0;
    let perpX = -(y0 - y1);
    let perpY = x0 - x1;
    let perp1x = 0;
    let perp1y = 0;
    let dist = Math.sqrt(perpX * perpX + perpY * perpY);
    perpX /= dist;
    perpY /= dist;
    perpX *= width;
    perpY *= width;
    const ratio = alignment;
    const innerWeight = (1 - ratio) * 2;
    const outerWeight = ratio * 2;
    if (!closedShape) {
      if (style.cap === "round") {
        indexCount += round(
          x0 - perpX * (innerWeight - outerWeight) * 0.5,
          y0 - perpY * (innerWeight - outerWeight) * 0.5,
          x0 - perpX * innerWeight,
          y0 - perpY * innerWeight,
          x0 + perpX * outerWeight,
          y0 + perpY * outerWeight,
          verts,
          true
        ) + 2;
      } else if (style.cap === "square") {
        indexCount += square(x0, y0, perpX, perpY, innerWeight, outerWeight, true, verts);
      }
    }
    verts.push(
      x0 - perpX * innerWeight,
      y0 - perpY * innerWeight
    );
    verts.push(
      x0 + perpX * outerWeight,
      y0 + perpY * outerWeight
    );
    for (let i2 = 1; i2 < length2 - 1; ++i2) {
      x0 = points[(i2 - 1) * 2];
      y0 = points[(i2 - 1) * 2 + 1];
      x1 = points[i2 * 2];
      y1 = points[i2 * 2 + 1];
      x2 = points[(i2 + 1) * 2];
      y2 = points[(i2 + 1) * 2 + 1];
      perpX = -(y0 - y1);
      perpY = x0 - x1;
      dist = Math.sqrt(perpX * perpX + perpY * perpY);
      perpX /= dist;
      perpY /= dist;
      perpX *= width;
      perpY *= width;
      perp1x = -(y1 - y2);
      perp1y = x1 - x2;
      dist = Math.sqrt(perp1x * perp1x + perp1y * perp1y);
      perp1x /= dist;
      perp1y /= dist;
      perp1x *= width;
      perp1y *= width;
      const dx0 = x1 - x0;
      const dy0 = y0 - y1;
      const dx1 = x1 - x2;
      const dy1 = y2 - y1;
      const dot = dx0 * dx1 + dy0 * dy1;
      const cross = dy0 * dx1 - dy1 * dx0;
      const clockwise = cross < 0;
      if (Math.abs(cross) < 1e-3 * Math.abs(dot)) {
        verts.push(
          x1 - perpX * innerWeight,
          y1 - perpY * innerWeight
        );
        verts.push(
          x1 + perpX * outerWeight,
          y1 + perpY * outerWeight
        );
        if (dot >= 0) {
          if (style.join === "round") {
            indexCount += round(
              x1,
              y1,
              x1 - perpX * innerWeight,
              y1 - perpY * innerWeight,
              x1 - perp1x * innerWeight,
              y1 - perp1y * innerWeight,
              verts,
              false
            ) + 4;
          } else {
            indexCount += 2;
          }
          verts.push(
            x1 - perp1x * outerWeight,
            y1 - perp1y * outerWeight
          );
          verts.push(
            x1 + perp1x * innerWeight,
            y1 + perp1y * innerWeight
          );
        }
        continue;
      }
      const c1 = (-perpX + x0) * (-perpY + y1) - (-perpX + x1) * (-perpY + y0);
      const c2 = (-perp1x + x2) * (-perp1y + y1) - (-perp1x + x1) * (-perp1y + y2);
      const px = (dx0 * c2 - dx1 * c1) / cross;
      const py = (dy1 * c1 - dy0 * c2) / cross;
      const pDist = (px - x1) * (px - x1) + (py - y1) * (py - y1);
      const imx = x1 + (px - x1) * innerWeight;
      const imy = y1 + (py - y1) * innerWeight;
      const omx = x1 - (px - x1) * outerWeight;
      const omy = y1 - (py - y1) * outerWeight;
      const smallerInsideSegmentSq = Math.min(dx0 * dx0 + dy0 * dy0, dx1 * dx1 + dy1 * dy1);
      const insideWeight = clockwise ? innerWeight : outerWeight;
      const smallerInsideDiagonalSq = smallerInsideSegmentSq + insideWeight * insideWeight * widthSquared;
      const insideMiterOk = pDist <= smallerInsideDiagonalSq;
      if (insideMiterOk) {
        if (style.join === "bevel" || pDist / widthSquared > miterLimitSquared) {
          if (clockwise) {
            verts.push(imx, imy);
            verts.push(x1 + perpX * outerWeight, y1 + perpY * outerWeight);
            verts.push(imx, imy);
            verts.push(x1 + perp1x * outerWeight, y1 + perp1y * outerWeight);
          } else {
            verts.push(x1 - perpX * innerWeight, y1 - perpY * innerWeight);
            verts.push(omx, omy);
            verts.push(x1 - perp1x * innerWeight, y1 - perp1y * innerWeight);
            verts.push(omx, omy);
          }
          indexCount += 2;
        } else if (style.join === "round") {
          if (clockwise) {
            verts.push(imx, imy);
            verts.push(x1 + perpX * outerWeight, y1 + perpY * outerWeight);
            indexCount += round(
              x1,
              y1,
              x1 + perpX * outerWeight,
              y1 + perpY * outerWeight,
              x1 + perp1x * outerWeight,
              y1 + perp1y * outerWeight,
              verts,
              true
            ) + 4;
            verts.push(imx, imy);
            verts.push(x1 + perp1x * outerWeight, y1 + perp1y * outerWeight);
          } else {
            verts.push(x1 - perpX * innerWeight, y1 - perpY * innerWeight);
            verts.push(omx, omy);
            indexCount += round(
              x1,
              y1,
              x1 - perpX * innerWeight,
              y1 - perpY * innerWeight,
              x1 - perp1x * innerWeight,
              y1 - perp1y * innerWeight,
              verts,
              false
            ) + 4;
            verts.push(x1 - perp1x * innerWeight, y1 - perp1y * innerWeight);
            verts.push(omx, omy);
          }
        } else {
          verts.push(imx, imy);
          verts.push(omx, omy);
        }
      } else {
        verts.push(x1 - perpX * innerWeight, y1 - perpY * innerWeight);
        verts.push(x1 + perpX * outerWeight, y1 + perpY * outerWeight);
        if (style.join === "round") {
          if (clockwise) {
            indexCount += round(
              x1,
              y1,
              x1 + perpX * outerWeight,
              y1 + perpY * outerWeight,
              x1 + perp1x * outerWeight,
              y1 + perp1y * outerWeight,
              verts,
              true
            ) + 2;
          } else {
            indexCount += round(
              x1,
              y1,
              x1 - perpX * innerWeight,
              y1 - perpY * innerWeight,
              x1 - perp1x * innerWeight,
              y1 - perp1y * innerWeight,
              verts,
              false
            ) + 2;
          }
        } else if (style.join === "miter" && pDist / widthSquared <= miterLimitSquared) {
          if (clockwise) {
            verts.push(omx, omy);
            verts.push(omx, omy);
          } else {
            verts.push(imx, imy);
            verts.push(imx, imy);
          }
          indexCount += 2;
        }
        verts.push(x1 - perp1x * innerWeight, y1 - perp1y * innerWeight);
        verts.push(x1 + perp1x * outerWeight, y1 + perp1y * outerWeight);
        indexCount += 2;
      }
    }
    x0 = points[(length2 - 2) * 2];
    y0 = points[(length2 - 2) * 2 + 1];
    x1 = points[(length2 - 1) * 2];
    y1 = points[(length2 - 1) * 2 + 1];
    perpX = -(y0 - y1);
    perpY = x0 - x1;
    dist = Math.sqrt(perpX * perpX + perpY * perpY);
    perpX /= dist;
    perpY /= dist;
    perpX *= width;
    perpY *= width;
    verts.push(x1 - perpX * innerWeight, y1 - perpY * innerWeight);
    verts.push(x1 + perpX * outerWeight, y1 + perpY * outerWeight);
    if (!closedShape) {
      if (style.cap === "round") {
        indexCount += round(
          x1 - perpX * (innerWeight - outerWeight) * 0.5,
          y1 - perpY * (innerWeight - outerWeight) * 0.5,
          x1 - perpX * innerWeight,
          y1 - perpY * innerWeight,
          x1 + perpX * outerWeight,
          y1 + perpY * outerWeight,
          verts,
          false
        ) + 2;
      } else if (style.cap === "square") {
        indexCount += square(x1, y1, perpX, perpY, innerWeight, outerWeight, false, verts);
      }
    }
    const eps2 = curveEps * curveEps;
    for (let i2 = indexStart; i2 < indexCount + indexStart - 2; ++i2) {
      x0 = verts[i2 * 2];
      y0 = verts[i2 * 2 + 1];
      x1 = verts[(i2 + 1) * 2];
      y1 = verts[(i2 + 1) * 2 + 1];
      x2 = verts[(i2 + 2) * 2];
      y2 = verts[(i2 + 2) * 2 + 1];
      if (Math.abs(x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)) < eps2) {
        continue;
      }
      indices.push(i2, i2 + 1, i2 + 2);
    }
  }
  function buildPixelLine(points, closed, vertices, indices) {
    const eps = closePointEps;
    if (points.length === 0) {
      return;
    }
    const fx = points[0];
    const fy = points[1];
    const lx = points[points.length - 2];
    const ly = points[points.length - 1];
    const closePath = closed || Math.abs(fx - lx) < eps && Math.abs(fy - ly) < eps;
    const verts = vertices;
    const length2 = points.length / 2;
    const indexStart = verts.length / 2;
    for (let i2 = 0; i2 < length2; i2++) {
      verts.push(points[i2 * 2]);
      verts.push(points[i2 * 2 + 1]);
    }
    for (let i2 = 0; i2 < length2 - 1; i2++) {
      indices.push(indexStart + i2, indexStart + i2 + 1);
    }
    if (closePath) {
      indices.push(indexStart + length2 - 1, indexStart);
    }
  }
  function triangulateWithHoles(points, holes, vertices, verticesStride, verticesOffset, indices, indicesOffset) {
    const triangles = earcut(points, holes, 2);
    if (!triangles) {
      return;
    }
    for (let i2 = 0; i2 < triangles.length; i2 += 3) {
      indices[indicesOffset++] = triangles[i2] + verticesOffset;
      indices[indicesOffset++] = triangles[i2 + 1] + verticesOffset;
      indices[indicesOffset++] = triangles[i2 + 2] + verticesOffset;
    }
    let index = verticesOffset * verticesStride;
    for (let i2 = 0; i2 < points.length; i2 += 2) {
      vertices[index] = points[i2];
      vertices[index + 1] = points[i2 + 1];
      index += verticesStride;
    }
  }
  const emptyArray = [];
  const buildPolygon = {
    extension: {
      type: ExtensionType.ShapeBuilder,
      name: "polygon"
    },
    build(shape, points) {
      for (let i2 = 0; i2 < shape.points.length; i2++) {
        points[i2] = shape.points[i2];
      }
      return true;
    },
    triangulate(points, vertices, verticesStride, verticesOffset, indices, indicesOffset) {
      triangulateWithHoles(points, emptyArray, vertices, verticesStride, verticesOffset, indices, indicesOffset);
    }
  };
  const buildRectangle = {
    extension: {
      type: ExtensionType.ShapeBuilder,
      name: "rectangle"
    },
    build(shape, points) {
      const rectData = shape;
      const x2 = rectData.x;
      const y2 = rectData.y;
      const width = rectData.width;
      const height = rectData.height;
      if (!(width > 0 && height > 0)) {
        return false;
      }
      points[0] = x2;
      points[1] = y2;
      points[2] = x2 + width;
      points[3] = y2;
      points[4] = x2 + width;
      points[5] = y2 + height;
      points[6] = x2;
      points[7] = y2 + height;
      return true;
    },
    triangulate(points, vertices, verticesStride, verticesOffset, indices, indicesOffset) {
      let count2 = 0;
      verticesOffset *= verticesStride;
      vertices[verticesOffset + count2] = points[0];
      vertices[verticesOffset + count2 + 1] = points[1];
      count2 += verticesStride;
      vertices[verticesOffset + count2] = points[2];
      vertices[verticesOffset + count2 + 1] = points[3];
      count2 += verticesStride;
      vertices[verticesOffset + count2] = points[6];
      vertices[verticesOffset + count2 + 1] = points[7];
      count2 += verticesStride;
      vertices[verticesOffset + count2] = points[4];
      vertices[verticesOffset + count2 + 1] = points[5];
      count2 += verticesStride;
      const verticesIndex = verticesOffset / verticesStride;
      indices[indicesOffset++] = verticesIndex;
      indices[indicesOffset++] = verticesIndex + 1;
      indices[indicesOffset++] = verticesIndex + 2;
      indices[indicesOffset++] = verticesIndex + 1;
      indices[indicesOffset++] = verticesIndex + 3;
      indices[indicesOffset++] = verticesIndex + 2;
    }
  };
  const buildTriangle = {
    extension: {
      type: ExtensionType.ShapeBuilder,
      name: "triangle"
    },
    build(shape, points) {
      points[0] = shape.x;
      points[1] = shape.y;
      points[2] = shape.x2;
      points[3] = shape.y2;
      points[4] = shape.x3;
      points[5] = shape.y3;
      return true;
    },
    triangulate(points, vertices, verticesStride, verticesOffset, indices, indicesOffset) {
      let count2 = 0;
      verticesOffset *= verticesStride;
      vertices[verticesOffset + count2] = points[0];
      vertices[verticesOffset + count2 + 1] = points[1];
      count2 += verticesStride;
      vertices[verticesOffset + count2] = points[2];
      vertices[verticesOffset + count2 + 1] = points[3];
      count2 += verticesStride;
      vertices[verticesOffset + count2] = points[4];
      vertices[verticesOffset + count2 + 1] = points[5];
      const verticesIndex = verticesOffset / verticesStride;
      indices[indicesOffset++] = verticesIndex;
      indices[indicesOffset++] = verticesIndex + 1;
      indices[indicesOffset++] = verticesIndex + 2;
    }
  };
  const emptyColorStops = [{ offset: 0, color: "white" }, { offset: 1, color: "black" }];
  const _FillGradient = class _FillGradient2 {
    constructor(...args) {
      this.uid = uid$1("fillGradient");
      this._tick = 0;
      this.type = "linear";
      this.colorStops = [];
      let options = ensureGradientOptions(args);
      const defaults = options.type === "radial" ? _FillGradient2.defaultRadialOptions : _FillGradient2.defaultLinearOptions;
      options = { ...defaults, ...definedProps(options) };
      this._textureSize = options.textureSize;
      this._wrapMode = options.wrapMode;
      if (options.type === "radial") {
        this.center = options.center;
        this.outerCenter = options.outerCenter ?? this.center;
        this.innerRadius = options.innerRadius;
        this.outerRadius = options.outerRadius;
        this.scale = options.scale;
        this.rotation = options.rotation;
      } else {
        this.start = options.start;
        this.end = options.end;
      }
      this.textureSpace = options.textureSpace;
      this.type = options.type;
      options.colorStops.forEach((stop2) => {
        this.addColorStop(stop2.offset, stop2.color);
      });
    }

    addColorStop(offset2, color) {
      this.colorStops.push({ offset: offset2, color: Color.shared.setValue(color).toHexa() });
      return this;
    }

    buildLinearGradient() {
      if (this.texture) return;
      let { x: x0, y: y0 } = this.start;
      let { x: x1, y: y1 } = this.end;
      let dx = x1 - x0;
      let dy = y1 - y0;
      const flip = dx < 0 || dy < 0;
      if (this._wrapMode === "clamp-to-edge") {
        if (dx < 0) {
          const temp = x0;
          x0 = x1;
          x1 = temp;
          dx *= -1;
        }
        if (dy < 0) {
          const temp = y0;
          y0 = y1;
          y1 = temp;
          dy *= -1;
        }
      }
      const colorStops = this.colorStops.length ? this.colorStops : emptyColorStops;
      const defaultSize = this._textureSize;
      const { canvas, context: context2 } = getCanvas(defaultSize, 1);
      const gradient = !flip ? context2.createLinearGradient(0, 0, this._textureSize, 0) : context2.createLinearGradient(this._textureSize, 0, 0, 0);
      addColorStops(gradient, colorStops);
      context2.fillStyle = gradient;
      context2.fillRect(0, 0, defaultSize, 1);
      this.texture = new Texture({
        source: new ImageSource({
          resource: canvas,
          addressMode: this._wrapMode
        })
      });
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const m2 = new Matrix();
      m2.scale(dist / defaultSize, 1);
      m2.rotate(angle);
      m2.translate(x0, y0);
      if (this.textureSpace === "local") {
        m2.scale(defaultSize, defaultSize);
      }
      this.transform = m2;
    }

    buildGradient() {
      if (!this.texture) this._tick++;
      if (this.type === "linear") {
        this.buildLinearGradient();
      } else {
        this.buildRadialGradient();
      }
    }

    buildRadialGradient() {
      if (this.texture) return;
      const colorStops = this.colorStops.length ? this.colorStops : emptyColorStops;
      const defaultSize = this._textureSize;
      const { canvas, context: context2 } = getCanvas(defaultSize, defaultSize);
      const { x: x0, y: y0 } = this.center;
      const { x: x1, y: y1 } = this.outerCenter;
      const r0 = this.innerRadius;
      const r1 = this.outerRadius;
      const ox = x1 - r1;
      const oy = y1 - r1;
      const scale = defaultSize / (r1 * 2);
      const cx = (x0 - ox) * scale;
      const cy = (y0 - oy) * scale;
      const gradient = context2.createRadialGradient(
        cx,
        cy,
        r0 * scale,
        (x1 - ox) * scale,
        (y1 - oy) * scale,
        r1 * scale
      );
      addColorStops(gradient, colorStops);
      context2.fillStyle = colorStops[colorStops.length - 1].color;
      context2.fillRect(0, 0, defaultSize, defaultSize);
      context2.fillStyle = gradient;
      context2.translate(cx, cy);
      context2.rotate(this.rotation);
      context2.scale(1, this.scale);
      context2.translate(-cx, -cy);
      context2.fillRect(0, 0, defaultSize, defaultSize);
      this.texture = new Texture({
        source: new ImageSource({
          resource: canvas,
          addressMode: this._wrapMode
        })
      });
      const m2 = new Matrix();
      m2.scale(1 / scale, 1 / scale);
      m2.translate(ox, oy);
      if (this.textureSpace === "local") {
        m2.scale(defaultSize, defaultSize);
      }
      this.transform = m2;
    }

    destroy() {
      this.texture?.destroy(true);
      this.texture = null;
      this.transform = null;
      this.colorStops = [];
      this.start = null;
      this.end = null;
      this.center = null;
      this.outerCenter = null;
    }

    get styleKey() {
      return `fill-gradient-${this.uid}-${this._tick}`;
    }
  };
  _FillGradient.defaultLinearOptions = {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [],
    textureSpace: "local",
    type: "linear",
    textureSize: 256,
    wrapMode: "clamp-to-edge"
  };
  _FillGradient.defaultRadialOptions = {
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerRadius: 0.5,
    colorStops: [],
    scale: 1,
    textureSpace: "local",
    type: "radial",
    textureSize: 256,
    wrapMode: "clamp-to-edge"
  };
  let FillGradient = _FillGradient;
  function addColorStops(gradient, colorStops) {
    for (let i2 = 0; i2 < colorStops.length; i2++) {
      const stop2 = colorStops[i2];
      gradient.addColorStop(stop2.offset, stop2.color);
    }
  }
  function getCanvas(width, height) {
    const canvas = DOMAdapter.get().createCanvas(width, height);
    const context2 = canvas.getContext("2d");
    return { canvas, context: context2 };
  }
  function ensureGradientOptions(args) {
    let options = args[0] ?? {};
    if (typeof options === "number" || args[1]) {
      deprecation("8.5.2", `use options object instead`);
      options = {
        type: "linear",
        start: { x: args[0], y: args[1] },
        end: { x: args[2], y: args[3] },
        textureSpace: args[4],
        textureSize: args[5] ?? FillGradient.defaultLinearOptions.textureSize
      };
    }
    return options;
  }
  const tempTextureMatrix$2 = new Matrix();
  const tempRect$2 = new Rectangle();
  function generateTextureMatrix(out2, style, shape, matrix) {
    const textureMatrix = style.matrix ? out2.copyFrom(style.matrix).invert() : out2.identity();
    if (style.textureSpace === "local") {
      const bounds = shape.getBounds(tempRect$2);
      if (style.width) {
        bounds.pad(style.width);
      }
      const { x: tx, y: ty } = bounds;
      const sx = 1 / bounds.width;
      const sy = 1 / bounds.height;
      const mTx = -tx * sx;
      const mTy = -ty * sy;
      const a1 = textureMatrix.a;
      const b1 = textureMatrix.b;
      const c1 = textureMatrix.c;
      const d1 = textureMatrix.d;
      textureMatrix.a *= sx;
      textureMatrix.b *= sx;
      textureMatrix.c *= sy;
      textureMatrix.d *= sy;
      textureMatrix.tx = mTx * a1 + mTy * c1 + textureMatrix.tx;
      textureMatrix.ty = mTx * b1 + mTy * d1 + textureMatrix.ty;
    } else {
      textureMatrix.translate(style.texture.frame.x, style.texture.frame.y);
      textureMatrix.scale(1 / style.texture.source.width, 1 / style.texture.source.height);
    }
    const sourceStyle = style.texture.source.style;
    if (!(style.fill instanceof FillGradient) && sourceStyle.addressMode === "clamp-to-edge") {
      sourceStyle.addressMode = "repeat";
      sourceStyle.update();
    }
    if (matrix) {
      textureMatrix.append(tempTextureMatrix$2.copyFrom(matrix).invert());
    }
    return textureMatrix;
  }
  const shapeBuilders = {};
  extensions.handleByMap(ExtensionType.ShapeBuilder, shapeBuilders);
  extensions.add(buildRectangle, buildPolygon, buildTriangle, buildCircle, buildEllipse, buildRoundedRectangle);
  const tempRect$1 = new Rectangle();
  const tempTextureMatrix$1 = new Matrix();
  function buildContextBatches(context2, gpuContext) {
    const { geometryData, batches } = gpuContext;
    batches.length = 0;
    geometryData.indices.length = 0;
    geometryData.vertices.length = 0;
    geometryData.uvs.length = 0;
    for (let i2 = 0; i2 < context2.instructions.length; i2++) {
      const instruction = context2.instructions[i2];
      if (instruction.action === "texture") {
        addTextureToGeometryData(instruction.data, batches, geometryData);
      } else if (instruction.action === "fill" || instruction.action === "stroke") {
        const isStroke = instruction.action === "stroke";
        const shapePath = instruction.data.path.shapePath;
        const style = instruction.data.style;
        const hole = instruction.data.hole;
        if (isStroke && hole) {
          addShapePathToGeometryData(hole.shapePath, style, true, batches, geometryData);
        }
        if (hole) {
          shapePath.shapePrimitives[shapePath.shapePrimitives.length - 1].holes = hole.shapePath.shapePrimitives;
        }
        addShapePathToGeometryData(shapePath, style, isStroke, batches, geometryData);
      }
    }
  }
  function addTextureToGeometryData(data, batches, geometryData) {
    const points = [];
    const build = shapeBuilders.rectangle;
    const rect = tempRect$1;
    rect.x = data.dx;
    rect.y = data.dy;
    rect.width = data.dw;
    rect.height = data.dh;
    const matrix = data.transform;
    if (!build.build(rect, points)) {
      return;
    }
    const { vertices, uvs, indices } = geometryData;
    const indexOffset = indices.length;
    const vertOffset = vertices.length / 2;
    if (matrix) {
      transformVertices(points, matrix);
    }
    build.triangulate(points, vertices, 2, vertOffset, indices, indexOffset);
    const texture = data.image;
    const textureUvs = texture.uvs;
    uvs.push(
      textureUvs.x0,
      textureUvs.y0,
      textureUvs.x1,
      textureUvs.y1,
      textureUvs.x3,
      textureUvs.y3,
      textureUvs.x2,
      textureUvs.y2
    );
    const graphicsBatch = BigPool.get(BatchableGraphics);
    graphicsBatch.indexOffset = indexOffset;
    graphicsBatch.indexSize = indices.length - indexOffset;
    graphicsBatch.attributeOffset = vertOffset;
    graphicsBatch.attributeSize = vertices.length / 2 - vertOffset;
    graphicsBatch.baseColor = data.style;
    graphicsBatch.alpha = data.alpha;
    graphicsBatch.texture = texture;
    graphicsBatch.geometryData = geometryData;
    batches.push(graphicsBatch);
  }
  function addShapePathToGeometryData(shapePath, style, isStroke, batches, geometryData) {
    const { vertices, uvs, indices } = geometryData;
    shapePath.shapePrimitives.forEach(({ shape, transform: matrix, holes }) => {
      const points = [];
      const build = shapeBuilders[shape.type];
      if (!build.build(shape, points)) {
        return;
      }
      const indexOffset = indices.length;
      const vertOffset = vertices.length / 2;
      let topology = "triangle-list";
      if (matrix) {
        transformVertices(points, matrix);
      }
      if (!isStroke) {
        if (holes) {
          const holeIndices = [];
          const otherPoints = points.slice();
          const holeArrays = getHoleArrays(holes);
          holeArrays.forEach((holePoints) => {
            holeIndices.push(otherPoints.length / 2);
            otherPoints.push(...holePoints);
          });
          triangulateWithHoles(otherPoints, holeIndices, vertices, 2, vertOffset, indices, indexOffset);
        } else {
          build.triangulate(points, vertices, 2, vertOffset, indices, indexOffset);
        }
      } else {
        const close = shape.closePath ?? true;
        const lineStyle = style;
        if (!lineStyle.pixelLine) {
          buildLine(points, lineStyle, false, close, vertices, indices);
        } else {
          buildPixelLine(points, close, vertices, indices);
          topology = "line-list";
        }
      }
      const uvsOffset = uvs.length / 2;
      const texture = style.texture;
      if (texture !== Texture.WHITE) {
        const textureMatrix = generateTextureMatrix(tempTextureMatrix$1, style, shape, matrix);
        buildUvs(vertices, 2, vertOffset, uvs, uvsOffset, 2, vertices.length / 2 - vertOffset, textureMatrix);
      } else {
        buildSimpleUvs(uvs, uvsOffset, 2, vertices.length / 2 - vertOffset);
      }
      const graphicsBatch = BigPool.get(BatchableGraphics);
      graphicsBatch.indexOffset = indexOffset;
      graphicsBatch.indexSize = indices.length - indexOffset;
      graphicsBatch.attributeOffset = vertOffset;
      graphicsBatch.attributeSize = vertices.length / 2 - vertOffset;
      graphicsBatch.baseColor = style.color;
      graphicsBatch.alpha = style.alpha;
      graphicsBatch.texture = texture;
      graphicsBatch.geometryData = geometryData;
      graphicsBatch.topology = topology;
      batches.push(graphicsBatch);
    });
  }
  function getHoleArrays(holePrimitives) {
    const holeArrays = [];
    for (let k2 = 0; k2 < holePrimitives.length; k2++) {
      const holePrimitive = holePrimitives[k2].shape;
      const holePoints = [];
      const holeBuilder = shapeBuilders[holePrimitive.type];
      if (holeBuilder.build(holePrimitive, holePoints)) {
        holeArrays.push(holePoints);
      }
    }
    return holeArrays;
  }
  class GpuGraphicsContext {
    constructor() {
      this.batches = [];
      this.geometryData = {
        vertices: [],
        uvs: [],
        indices: []
      };
    }
    reset() {
      if (this.batches) {
        this.batches.forEach((batch) => {
          BigPool.return(batch);
        });
      }
      if (this.graphicsData) {
        BigPool.return(this.graphicsData);
      }
      this.isBatchable = false;
      this.context = null;
      this.batches.length = 0;
      this.geometryData.indices.length = 0;
      this.geometryData.vertices.length = 0;
      this.geometryData.uvs.length = 0;
      this.graphicsData = null;
    }
    destroy() {
      this.reset();
      this.batches = null;
      this.geometryData = null;
    }
  }
  class GraphicsContextRenderData {
    constructor() {
      this.instructions = new InstructionSet();
    }
    init(options) {
      const maxTextures = options.maxTextures;
      this.batcher ? this.batcher._updateMaxTextures(maxTextures) : this.batcher = new DefaultBatcher({ maxTextures });
      this.instructions.reset();
    }

    get geometry() {
      deprecation(v8_3_4, "GraphicsContextRenderData#geometry is deprecated, please use batcher.geometry instead.");
      return this.batcher.geometry;
    }
    destroy() {
      this.batcher.destroy();
      this.instructions.destroy();
      this.batcher = null;
      this.instructions = null;
    }
  }
  const _GraphicsContextSystem = class _GraphicsContextSystem2 {
    constructor(renderer) {
      this._renderer = renderer;
      this._managedContexts = new GCManagedHash({ renderer, type: "resource", name: "graphicsContext" });
    }

    init(options) {
      _GraphicsContextSystem2.defaultOptions.bezierSmoothness = options?.bezierSmoothness ?? _GraphicsContextSystem2.defaultOptions.bezierSmoothness;
    }

    getContextRenderData(context2) {
      return context2._gpuData[this._renderer.uid].graphicsData || this._initContextRenderData(context2);
    }

    updateGpuContext(context2) {
      const hasContext = !!context2._gpuData[this._renderer.uid];
      const gpuContext = context2._gpuData[this._renderer.uid] || this._initContext(context2);
      if (context2.dirty || !hasContext) {
        if (hasContext) {
          gpuContext.reset();
        }
        buildContextBatches(context2, gpuContext);
        const batchMode = context2.batchMode;
        if (context2.customShader || batchMode === "no-batch") {
          gpuContext.isBatchable = false;
        } else if (batchMode === "auto") {
          gpuContext.isBatchable = gpuContext.geometryData.vertices.length < 400;
        } else {
          gpuContext.isBatchable = true;
        }
        context2.dirty = false;
      }
      return gpuContext;
    }

    getGpuContext(context2) {
      return context2._gpuData[this._renderer.uid] || this._initContext(context2);
    }
    _initContextRenderData(context2) {
      const graphicsData = BigPool.get(GraphicsContextRenderData, {
        maxTextures: this._renderer.limits.maxBatchableTextures
      });
      const gpuContext = context2._gpuData[this._renderer.uid];
      const { batches, geometryData } = gpuContext;
      gpuContext.graphicsData = graphicsData;
      const vertexSize = geometryData.vertices.length;
      const indexSize = geometryData.indices.length;
      for (let i2 = 0; i2 < batches.length; i2++) {
        batches[i2].applyTransform = false;
      }
      const batcher = graphicsData.batcher;
      batcher.ensureAttributeBuffer(vertexSize);
      batcher.ensureIndexBuffer(indexSize);
      batcher.begin();
      for (let i2 = 0; i2 < batches.length; i2++) {
        const batch = batches[i2];
        batcher.add(batch);
      }
      batcher.finish(graphicsData.instructions);
      const geometry = batcher.geometry;
      geometry.indexBuffer.setDataWithSize(batcher.indexBuffer, batcher.indexSize, true);
      geometry.buffers[0].setDataWithSize(batcher.attributeBuffer.float32View, batcher.attributeSize, true);
      const drawBatches = batcher.batches;
      for (let i2 = 0; i2 < drawBatches.length; i2++) {
        const batch = drawBatches[i2];
        batch.bindGroup = getTextureBatchBindGroup(
          batch.textures.textures,
          batch.textures.count,
          this._renderer.limits.maxBatchableTextures
        );
      }
      return graphicsData;
    }
    _initContext(context2) {
      const gpuContext = new GpuGraphicsContext();
      gpuContext.context = context2;
      context2._gpuData[this._renderer.uid] = gpuContext;
      this._managedContexts.add(context2);
      return gpuContext;
    }
    destroy() {
      this._managedContexts.destroy();
      this._renderer = null;
    }
  };
  _GraphicsContextSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem
    ],
    name: "graphicsContext"
  };
  _GraphicsContextSystem.defaultOptions = {

    bezierSmoothness: 0.5
  };
  let GraphicsContextSystem = _GraphicsContextSystem;
  const RECURSION_LIMIT$1 = 8;
  const FLT_EPSILON$1 = 11920929e-14;
  const PATH_DISTANCE_EPSILON$1 = 1;
  function buildAdaptiveBezier(points, sX, sY, cp1x, cp1y, cp2x, cp2y, eX, eY, smoothness) {
    const scale = 1;
    const smoothing = Math.min(
      0.99,

      Math.max(0, smoothness ?? GraphicsContextSystem.defaultOptions.bezierSmoothness)
    );
    let distanceTolerance = (PATH_DISTANCE_EPSILON$1 - smoothing) / scale;
    distanceTolerance *= distanceTolerance;
    begin$1(sX, sY, cp1x, cp1y, cp2x, cp2y, eX, eY, points, distanceTolerance);
    return points;
  }
  function begin$1(sX, sY, cp1x, cp1y, cp2x, cp2y, eX, eY, points, distanceTolerance) {
    recursive$1(sX, sY, cp1x, cp1y, cp2x, cp2y, eX, eY, points, distanceTolerance, 0);
    points.push(eX, eY);
  }
  function recursive$1(x1, y1, x2, y2, x3, y3, x4, y4, points, distanceTolerance, level) {
    if (level > RECURSION_LIMIT$1) {
      return;
    }
    const x12 = (x1 + x2) / 2;
    const y12 = (y1 + y2) / 2;
    const x23 = (x2 + x3) / 2;
    const y23 = (y2 + y3) / 2;
    const x34 = (x3 + x4) / 2;
    const y34 = (y3 + y4) / 2;
    const x123 = (x12 + x23) / 2;
    const y123 = (y12 + y23) / 2;
    const x234 = (x23 + x34) / 2;
    const y234 = (y23 + y34) / 2;
    const x1234 = (x123 + x234) / 2;
    const y1234 = (y123 + y234) / 2;
    if (level > 0) {
      let dx = x4 - x1;
      let dy = y4 - y1;
      const d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
      const d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);
      if (d2 > FLT_EPSILON$1 && d3 > FLT_EPSILON$1) {
        if ((d2 + d3) * (d2 + d3) <= distanceTolerance * (dx * dx + dy * dy)) {
          {
            points.push(x1234, y1234);
            return;
          }
        }
      } else if (d2 > FLT_EPSILON$1) {
        if (d2 * d2 <= distanceTolerance * (dx * dx + dy * dy)) {
          {
            points.push(x1234, y1234);
            return;
          }
        }
      } else if (d3 > FLT_EPSILON$1) {
        if (d3 * d3 <= distanceTolerance * (dx * dx + dy * dy)) {
          {
            points.push(x1234, y1234);
            return;
          }
        }
      } else {
        dx = x1234 - (x1 + x4) / 2;
        dy = y1234 - (y1 + y4) / 2;
        if (dx * dx + dy * dy <= distanceTolerance) {
          points.push(x1234, y1234);
          return;
        }
      }
    }
    recursive$1(x1, y1, x12, y12, x123, y123, x1234, y1234, points, distanceTolerance, level + 1);
    recursive$1(x1234, y1234, x234, y234, x34, y34, x4, y4, points, distanceTolerance, level + 1);
  }
  const RECURSION_LIMIT = 8;
  const FLT_EPSILON = 11920929e-14;
  const PATH_DISTANCE_EPSILON = 1;
  function buildAdaptiveQuadratic(points, sX, sY, cp1x, cp1y, eX, eY, smoothness) {
    const scale = 1;
    const smoothing = Math.min(
      0.99,

      Math.max(0, smoothness ?? GraphicsContextSystem.defaultOptions.bezierSmoothness)
    );
    let distanceTolerance = (PATH_DISTANCE_EPSILON - smoothing) / scale;
    distanceTolerance *= distanceTolerance;
    begin(sX, sY, cp1x, cp1y, eX, eY, points, distanceTolerance);
    return points;
  }
  function begin(sX, sY, cp1x, cp1y, eX, eY, points, distanceTolerance) {
    recursive(points, sX, sY, cp1x, cp1y, eX, eY, distanceTolerance, 0);
    points.push(eX, eY);
  }
  function recursive(points, x1, y1, x2, y2, x3, y3, distanceTolerance, level) {
    if (level > RECURSION_LIMIT) {
      return;
    }
    const x12 = (x1 + x2) / 2;
    const y12 = (y1 + y2) / 2;
    const x23 = (x2 + x3) / 2;
    const y23 = (y2 + y3) / 2;
    const x123 = (x12 + x23) / 2;
    const y123 = (y12 + y23) / 2;
    let dx = x3 - x1;
    let dy = y3 - y1;
    const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
    if (d2 > FLT_EPSILON) {
      if (d2 * d2 <= distanceTolerance * (dx * dx + dy * dy)) {
        {
          points.push(x123, y123);
          return;
        }
      }
    } else {
      dx = x123 - (x1 + x3) / 2;
      dy = y123 - (y1 + y3) / 2;
      if (dx * dx + dy * dy <= distanceTolerance) {
        points.push(x123, y123);
        return;
      }
    }
    recursive(points, x1, y1, x12, y12, x123, y123, distanceTolerance, level + 1);
    recursive(points, x123, y123, x23, y23, x3, y3, distanceTolerance, level + 1);
  }
  function buildArc(points, x2, y2, radius, start2, end, clockwise, steps) {
    let dist = Math.abs(start2 - end);
    if (!clockwise && start2 > end) {
      dist = 2 * Math.PI - dist;
    } else if (clockwise && end > start2) {
      dist = 2 * Math.PI - dist;
    }
    steps || (steps = Math.max(6, Math.floor(6 * Math.pow(radius, 1 / 3) * (dist / Math.PI))));
    steps = Math.max(steps, 3);
    let f2 = dist / steps;
    let t2 = start2;
    f2 *= clockwise ? -1 : 1;
    for (let i2 = 0; i2 < steps + 1; i2++) {
      const cs = Math.cos(t2);
      const sn = Math.sin(t2);
      const nx = x2 + cs * radius;
      const ny = y2 + sn * radius;
      points.push(nx, ny);
      t2 += f2;
    }
  }
  function buildArcTo(points, x1, y1, x2, y2, radius) {
    const fromX = points[points.length - 2];
    const fromY = points[points.length - 1];
    const a1 = fromY - y1;
    const b1 = fromX - x1;
    const a2 = y2 - y1;
    const b2 = x2 - x1;
    const mm = Math.abs(a1 * b2 - b1 * a2);
    if (mm < 1e-8 || radius === 0) {
      if (points[points.length - 2] !== x1 || points[points.length - 1] !== y1) {
        points.push(x1, y1);
      }
      return;
    }
    const dd = a1 * a1 + b1 * b1;
    const cc = a2 * a2 + b2 * b2;
    const tt = a1 * a2 + b1 * b2;
    const k1 = radius * Math.sqrt(dd) / mm;
    const k2 = radius * Math.sqrt(cc) / mm;
    const j1 = k1 * tt / dd;
    const j2 = k2 * tt / cc;
    const cx = k1 * b2 + k2 * b1;
    const cy = k1 * a2 + k2 * a1;
    const px = b1 * (k2 + j1);
    const py = a1 * (k2 + j1);
    const qx = b2 * (k1 + j2);
    const qy = a2 * (k1 + j2);
    const startAngle = Math.atan2(py - cy, px - cx);
    const endAngle = Math.atan2(qy - cy, qx - cx);
    buildArc(
      points,
      cx + x1,
      cy + y1,
      radius,
      startAngle,
      endAngle,
      b1 * a2 > b2 * a1
    );
  }
  const TAU$2 = Math.PI * 2;
  const out = {
    centerX: 0,
    centerY: 0,
    ang1: 0,
    ang2: 0
  };
  const mapToEllipse = ({ x: x2, y: y2 }, rx, ry, cosPhi, sinPhi, centerX, centerY, out2) => {
    x2 *= rx;
    y2 *= ry;
    const xp = cosPhi * x2 - sinPhi * y2;
    const yp = sinPhi * x2 + cosPhi * y2;
    out2.x = xp + centerX;
    out2.y = yp + centerY;
    return out2;
  };
  function approxUnitArc(ang1, ang2) {
    const a1 = ang2 === -1.5707963267948966 ? -0.551915024494 : 4 / 3 * Math.tan(ang2 / 4);
    const a2 = ang2 === 1.5707963267948966 ? 0.551915024494 : a1;
    const x1 = Math.cos(ang1);
    const y1 = Math.sin(ang1);
    const x2 = Math.cos(ang1 + ang2);
    const y2 = Math.sin(ang1 + ang2);
    return [
      {
        x: x1 - y1 * a2,
        y: y1 + x1 * a2
      },
      {
        x: x2 + y2 * a2,
        y: y2 - x2 * a2
      },
      {
        x: x2,
        y: y2
      }
    ];
  }
  const vectorAngle = (ux2, uy2, vx2, vy2) => {
    const sign2 = ux2 * vy2 - uy2 * vx2 < 0 ? -1 : 1;
    let dot = ux2 * vx2 + uy2 * vy2;
    if (dot > 1) {
      dot = 1;
    }
    if (dot < -1) {
      dot = -1;
    }
    return sign2 * Math.acos(dot);
  };
  const getArcCenter = (px, py, cx, cy, rx, ry, largeArcFlag, sweepFlag, sinPhi, cosPhi, pxp, pyp, out2) => {
    const rxSq = Math.pow(rx, 2);
    const rySq = Math.pow(ry, 2);
    const pxpSq = Math.pow(pxp, 2);
    const pypSq = Math.pow(pyp, 2);
    let radicant = rxSq * rySq - rxSq * pypSq - rySq * pxpSq;
    if (radicant < 0) {
      radicant = 0;
    }
    radicant /= rxSq * pypSq + rySq * pxpSq;
    radicant = Math.sqrt(radicant) * (largeArcFlag === sweepFlag ? -1 : 1);
    const centerXp = radicant * rx / ry * pyp;
    const centerYp = radicant * -ry / rx * pxp;
    const centerX = cosPhi * centerXp - sinPhi * centerYp + (px + cx) / 2;
    const centerY = sinPhi * centerXp + cosPhi * centerYp + (py + cy) / 2;
    const vx1 = (pxp - centerXp) / rx;
    const vy1 = (pyp - centerYp) / ry;
    const vx2 = (-pxp - centerXp) / rx;
    const vy2 = (-pyp - centerYp) / ry;
    const ang1 = vectorAngle(1, 0, vx1, vy1);
    let ang2 = vectorAngle(vx1, vy1, vx2, vy2);
    if (sweepFlag === 0 && ang2 > 0) {
      ang2 -= TAU$2;
    }
    if (sweepFlag === 1 && ang2 < 0) {
      ang2 += TAU$2;
    }
    out2.centerX = centerX;
    out2.centerY = centerY;
    out2.ang1 = ang1;
    out2.ang2 = ang2;
  };
  function buildArcToSvg(points, px, py, cx, cy, rx, ry, xAxisRotation = 0, largeArcFlag = 0, sweepFlag = 0) {
    if (rx === 0 || ry === 0) {
      return;
    }
    const sinPhi = Math.sin(xAxisRotation * TAU$2 / 360);
    const cosPhi = Math.cos(xAxisRotation * TAU$2 / 360);
    const pxp = cosPhi * (px - cx) / 2 + sinPhi * (py - cy) / 2;
    const pyp = -sinPhi * (px - cx) / 2 + cosPhi * (py - cy) / 2;
    if (pxp === 0 && pyp === 0) {
      return;
    }
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const lambda = Math.pow(pxp, 2) / Math.pow(rx, 2) + Math.pow(pyp, 2) / Math.pow(ry, 2);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    getArcCenter(
      px,
      py,
      cx,
      cy,
      rx,
      ry,
      largeArcFlag,
      sweepFlag,
      sinPhi,
      cosPhi,
      pxp,
      pyp,
      out
    );
    let { ang1, ang2 } = out;
    const { centerX, centerY } = out;
    let ratio = Math.abs(ang2) / (TAU$2 / 4);
    if (Math.abs(1 - ratio) < 1e-7) {
      ratio = 1;
    }
    const segments = Math.max(Math.ceil(ratio), 1);
    ang2 /= segments;
    let lastX = points[points.length - 2];
    let lastY = points[points.length - 1];
    const outCurvePoint = { x: 0, y: 0 };
    for (let i2 = 0; i2 < segments; i2++) {
      const curve = approxUnitArc(ang1, ang2);
      const { x: x1, y: y1 } = mapToEllipse(curve[0], rx, ry, cosPhi, sinPhi, centerX, centerY, outCurvePoint);
      const { x: x2, y: y2 } = mapToEllipse(curve[1], rx, ry, cosPhi, sinPhi, centerX, centerY, outCurvePoint);
      const { x: x3, y: y3 } = mapToEllipse(curve[2], rx, ry, cosPhi, sinPhi, centerX, centerY, outCurvePoint);
      buildAdaptiveBezier(
        points,
        lastX,
        lastY,
        x1,
        y1,
        x2,
        y2,
        x3,
        y3
      );
      lastX = x3;
      lastY = y3;
      ang1 += ang2;
    }
  }
  function roundedShapeArc(g2, points, radius) {
    const vecFrom = (p2, pp) => {
      const x2 = pp.x - p2.x;
      const y2 = pp.y - p2.y;
      const len = Math.sqrt(x2 * x2 + y2 * y2);
      const nx = x2 / len;
      const ny = y2 / len;
      return { len, nx, ny };
    };
    const sharpCorner = (i2, p2) => {
      if (i2 === 0) {
        g2.moveTo(p2.x, p2.y);
      } else {
        g2.lineTo(p2.x, p2.y);
      }
    };
    let p1 = points[points.length - 1];
    for (let i2 = 0; i2 < points.length; i2++) {
      const p2 = points[i2 % points.length];
      const pRadius = p2.radius ?? radius;
      if (pRadius <= 0) {
        sharpCorner(i2, p2);
        p1 = p2;
        continue;
      }
      const p3 = points[(i2 + 1) % points.length];
      const v1 = vecFrom(p2, p1);
      const v2 = vecFrom(p2, p3);
      if (v1.len < 1e-4 || v2.len < 1e-4) {
        sharpCorner(i2, p2);
        p1 = p2;
        continue;
      }
      let angle = Math.asin(v1.nx * v2.ny - v1.ny * v2.nx);
      let radDirection = 1;
      let drawDirection = false;
      if (v1.nx * v2.nx - v1.ny * -v2.ny < 0) {
        if (angle < 0) {
          angle = Math.PI + angle;
        } else {
          angle = Math.PI - angle;
          radDirection = -1;
          drawDirection = true;
        }
      } else if (angle > 0) {
        radDirection = -1;
        drawDirection = true;
      }
      const halfAngle = angle / 2;
      let cRadius;
      let lenOut = Math.abs(
        Math.cos(halfAngle) * pRadius / Math.sin(halfAngle)
      );
      if (lenOut > Math.min(v1.len / 2, v2.len / 2)) {
        lenOut = Math.min(v1.len / 2, v2.len / 2);
        cRadius = Math.abs(lenOut * Math.sin(halfAngle) / Math.cos(halfAngle));
      } else {
        cRadius = pRadius;
      }
      const cX = p2.x + v2.nx * lenOut + -v2.ny * cRadius * radDirection;
      const cY = p2.y + v2.ny * lenOut + v2.nx * cRadius * radDirection;
      const startAngle = Math.atan2(v1.ny, v1.nx) + Math.PI / 2 * radDirection;
      const endAngle = Math.atan2(v2.ny, v2.nx) - Math.PI / 2 * radDirection;
      if (i2 === 0) {
        g2.moveTo(
          cX + Math.cos(startAngle) * cRadius,
          cY + Math.sin(startAngle) * cRadius
        );
      }
      g2.arc(cX, cY, cRadius, startAngle, endAngle, drawDirection);
      p1 = p2;
    }
  }
  function roundedShapeQuadraticCurve(g2, points, radius, smoothness) {
    const distance = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    const pointLerp = (p1, p2, t2) => ({
      x: p1.x + (p2.x - p1.x) * t2,
      y: p1.y + (p2.y - p1.y) * t2
    });
    const numPoints = points.length;
    for (let i2 = 0; i2 < numPoints; i2++) {
      const thisPoint = points[(i2 + 1) % numPoints];
      const pRadius = thisPoint.radius ?? radius;
      if (pRadius <= 0) {
        if (i2 === 0) {
          g2.moveTo(thisPoint.x, thisPoint.y);
        } else {
          g2.lineTo(thisPoint.x, thisPoint.y);
        }
        continue;
      }
      const lastPoint = points[i2];
      const nextPoint = points[(i2 + 2) % numPoints];
      const lastEdgeLength = distance(lastPoint, thisPoint);
      let start2;
      if (lastEdgeLength < 1e-4) {
        start2 = thisPoint;
      } else {
        const lastOffsetDistance = Math.min(lastEdgeLength / 2, pRadius);
        start2 = pointLerp(
          thisPoint,
          lastPoint,
          lastOffsetDistance / lastEdgeLength
        );
      }
      const nextEdgeLength = distance(nextPoint, thisPoint);
      let end;
      if (nextEdgeLength < 1e-4) {
        end = thisPoint;
      } else {
        const nextOffsetDistance = Math.min(nextEdgeLength / 2, pRadius);
        end = pointLerp(
          thisPoint,
          nextPoint,
          nextOffsetDistance / nextEdgeLength
        );
      }
      if (i2 === 0) {
        g2.moveTo(start2.x, start2.y);
      } else {
        g2.lineTo(start2.x, start2.y);
      }
      g2.quadraticCurveTo(thisPoint.x, thisPoint.y, end.x, end.y, smoothness);
    }
  }
  const tempRectangle = new Rectangle();
  class ShapePath {
    constructor(graphicsPath2D) {
      this.shapePrimitives = [];
      this._currentPoly = null;
      this._bounds = new Bounds();
      this._graphicsPath2D = graphicsPath2D;
      this.signed = graphicsPath2D.checkForHoles;
    }

    moveTo(x2, y2) {
      this.startPoly(x2, y2);
      return this;
    }

    lineTo(x2, y2) {
      this._ensurePoly();
      const points = this._currentPoly.points;
      const fromX = points[points.length - 2];
      const fromY = points[points.length - 1];
      if (fromX !== x2 || fromY !== y2) {
        points.push(x2, y2);
      }
      return this;
    }

    arc(x2, y2, radius, startAngle, endAngle, counterclockwise) {
      this._ensurePoly(false);
      const points = this._currentPoly.points;
      buildArc(points, x2, y2, radius, startAngle, endAngle, counterclockwise);
      return this;
    }

    arcTo(x1, y1, x2, y2, radius) {
      this._ensurePoly();
      const points = this._currentPoly.points;
      buildArcTo(points, x1, y1, x2, y2, radius);
      return this;
    }

    arcToSvg(rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x2, y2) {
      const points = this._currentPoly.points;
      buildArcToSvg(
        points,
        this._currentPoly.lastX,
        this._currentPoly.lastY,
        x2,
        y2,
        rx,
        ry,
        xAxisRotation,
        largeArcFlag,
        sweepFlag
      );
      return this;
    }

    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2, smoothness) {
      this._ensurePoly();
      const currentPoly = this._currentPoly;
      buildAdaptiveBezier(
        this._currentPoly.points,
        currentPoly.lastX,
        currentPoly.lastY,
        cp1x,
        cp1y,
        cp2x,
        cp2y,
        x2,
        y2,
        smoothness
      );
      return this;
    }

    quadraticCurveTo(cp1x, cp1y, x2, y2, smoothing) {
      this._ensurePoly();
      const currentPoly = this._currentPoly;
      buildAdaptiveQuadratic(
        this._currentPoly.points,
        currentPoly.lastX,
        currentPoly.lastY,
        cp1x,
        cp1y,
        x2,
        y2,
        smoothing
      );
      return this;
    }

    closePath() {
      this.endPoly(true);
      return this;
    }

    addPath(path, transform) {
      this.endPoly();
      if (transform && !transform.isIdentity()) {
        path = path.clone(true);
        path.transform(transform);
      }
      const shapePrimitives = this.shapePrimitives;
      const start2 = shapePrimitives.length;
      for (let i2 = 0; i2 < path.instructions.length; i2++) {
        const instruction = path.instructions[i2];
        this[instruction.action](...instruction.data);
      }
      if (path.checkForHoles && shapePrimitives.length - start2 > 1) {
        let mainShape = null;
        for (let i2 = start2; i2 < shapePrimitives.length; i2++) {
          const shapePrimitive = shapePrimitives[i2];
          if (shapePrimitive.shape.type === "polygon") {
            const polygon = shapePrimitive.shape;
            const mainPolygon = mainShape?.shape;
            if (mainPolygon && mainPolygon.containsPolygon(polygon)) {
              mainShape.holes || (mainShape.holes = []);
              mainShape.holes.push(shapePrimitive);
              shapePrimitives.copyWithin(i2, i2 + 1);
              shapePrimitives.length--;
              i2--;
            } else {
              mainShape = shapePrimitive;
            }
          }
        }
      }
      return this;
    }

    finish(closePath = false) {
      this.endPoly(closePath);
    }

    rect(x2, y2, w2, h2, transform) {
      this.drawShape(new Rectangle(x2, y2, w2, h2), transform);
      return this;
    }

    circle(x2, y2, radius, transform) {
      this.drawShape(new Circle(x2, y2, radius), transform);
      return this;
    }

    poly(points, close, transform) {
      const polygon = new Polygon(points);
      polygon.closePath = close;
      this.drawShape(polygon, transform);
      return this;
    }

    regularPoly(x2, y2, radius, sides, rotation = 0, transform) {
      sides = Math.max(sides | 0, 3);
      const startAngle = -1 * Math.PI / 2 + rotation;
      const delta = Math.PI * 2 / sides;
      const polygon = [];
      for (let i2 = 0; i2 < sides; i2++) {
        const angle = startAngle - i2 * delta;
        polygon.push(
          x2 + radius * Math.cos(angle),
          y2 + radius * Math.sin(angle)
        );
      }
      this.poly(polygon, true, transform);
      return this;
    }

    roundPoly(x2, y2, radius, sides, corner, rotation = 0, smoothness) {
      sides = Math.max(sides | 0, 3);
      if (corner <= 0) {
        return this.regularPoly(x2, y2, radius, sides, rotation);
      }
      const sideLength = radius * Math.sin(Math.PI / sides) - 1e-3;
      corner = Math.min(corner, sideLength);
      const startAngle = -1 * Math.PI / 2 + rotation;
      const delta = Math.PI * 2 / sides;
      const internalAngle = (sides - 2) * Math.PI / sides / 2;
      for (let i2 = 0; i2 < sides; i2++) {
        const angle = i2 * delta + startAngle;
        const x0 = x2 + radius * Math.cos(angle);
        const y0 = y2 + radius * Math.sin(angle);
        const a1 = angle + Math.PI + internalAngle;
        const a2 = angle - Math.PI - internalAngle;
        const x1 = x0 + corner * Math.cos(a1);
        const y1 = y0 + corner * Math.sin(a1);
        const x3 = x0 + corner * Math.cos(a2);
        const y3 = y0 + corner * Math.sin(a2);
        if (i2 === 0) {
          this.moveTo(x1, y1);
        } else {
          this.lineTo(x1, y1);
        }
        this.quadraticCurveTo(x0, y0, x3, y3, smoothness);
      }
      return this.closePath();
    }

    roundShape(points, radius, useQuadratic = false, smoothness) {
      if (points.length < 3) {
        return this;
      }
      if (useQuadratic) {
        roundedShapeQuadraticCurve(this, points, radius, smoothness);
      } else {
        roundedShapeArc(this, points, radius);
      }
      return this.closePath();
    }

    filletRect(x2, y2, width, height, fillet) {
      if (fillet === 0) {
        return this.rect(x2, y2, width, height);
      }
      const maxFillet = Math.min(width, height) / 2;
      const inset = Math.min(maxFillet, Math.max(-maxFillet, fillet));
      const right = x2 + width;
      const bottom = y2 + height;
      const dir = inset < 0 ? -inset : 0;
      const size = Math.abs(inset);
      return this.moveTo(x2, y2 + size).arcTo(x2 + dir, y2 + dir, x2 + size, y2, size).lineTo(right - size, y2).arcTo(right - dir, y2 + dir, right, y2 + size, size).lineTo(right, bottom - size).arcTo(right - dir, bottom - dir, x2 + width - size, bottom, size).lineTo(x2 + size, bottom).arcTo(x2 + dir, bottom - dir, x2, bottom - size, size).closePath();
    }

    chamferRect(x2, y2, width, height, chamfer, transform) {
      if (chamfer <= 0) {
        return this.rect(x2, y2, width, height);
      }
      const inset = Math.min(chamfer, Math.min(width, height) / 2);
      const right = x2 + width;
      const bottom = y2 + height;
      const points = [
        x2 + inset,
        y2,
        right - inset,
        y2,
        right,
        y2 + inset,
        right,
        bottom - inset,
        right - inset,
        bottom,
        x2 + inset,
        bottom,
        x2,
        bottom - inset,
        x2,
        y2 + inset
      ];
      for (let i2 = points.length - 1; i2 >= 2; i2 -= 2) {
        if (points[i2] === points[i2 - 2] && points[i2 - 1] === points[i2 - 3]) {
          points.splice(i2 - 1, 2);
        }
      }
      return this.poly(points, true, transform);
    }

    ellipse(x2, y2, radiusX, radiusY, transform) {
      this.drawShape(new Ellipse(x2, y2, radiusX, radiusY), transform);
      return this;
    }

    roundRect(x2, y2, w2, h2, radius, transform) {
      this.drawShape(new RoundedRectangle(x2, y2, w2, h2, radius), transform);
      return this;
    }

    drawShape(shape, matrix) {
      this.endPoly();
      this.shapePrimitives.push({ shape, transform: matrix });
      return this;
    }

    startPoly(x2, y2) {
      let currentPoly = this._currentPoly;
      if (currentPoly) {
        this.endPoly();
      }
      currentPoly = new Polygon();
      currentPoly.points.push(x2, y2);
      this._currentPoly = currentPoly;
      return this;
    }

    endPoly(closePath = false) {
      const shape = this._currentPoly;
      if (shape && shape.points.length > 2) {
        shape.closePath = closePath;
        this.shapePrimitives.push({ shape });
      }
      this._currentPoly = null;
      return this;
    }
    _ensurePoly(start2 = true) {
      if (this._currentPoly) return;
      this._currentPoly = new Polygon();
      if (start2) {
        const lastShape = this.shapePrimitives[this.shapePrimitives.length - 1];
        if (lastShape) {
          let lx = lastShape.shape.x;
          let ly = lastShape.shape.y;
          if (lastShape.transform && !lastShape.transform.isIdentity()) {
            const t2 = lastShape.transform;
            const tempX = lx;
            lx = t2.a * lx + t2.c * ly + t2.tx;
            ly = t2.b * tempX + t2.d * ly + t2.ty;
          }
          this._currentPoly.points.push(lx, ly);
        } else {
          this._currentPoly.points.push(0, 0);
        }
      }
    }

    buildPath() {
      const path = this._graphicsPath2D;
      this.shapePrimitives.length = 0;
      this._currentPoly = null;
      for (let i2 = 0; i2 < path.instructions.length; i2++) {
        const instruction = path.instructions[i2];
        this[instruction.action](...instruction.data);
      }
      this.finish();
    }

    get bounds() {
      const bounds = this._bounds;
      bounds.clear();
      const shapePrimitives = this.shapePrimitives;
      for (let i2 = 0; i2 < shapePrimitives.length; i2++) {
        const shapePrimitive = shapePrimitives[i2];
        const boundsRect = shapePrimitive.shape.getBounds(tempRectangle);
        if (shapePrimitive.transform) {
          bounds.addRect(boundsRect, shapePrimitive.transform);
        } else {
          bounds.addRect(boundsRect);
        }
      }
      return bounds;
    }
  }
  class GraphicsPath {

    constructor(instructions, signed = false) {
      this.instructions = [];
      this.uid = uid$1("graphicsPath");
      this._dirty = true;
      this.checkForHoles = signed;
      if (typeof instructions === "string") {
        parseSVGPath(instructions, this);
      } else {
        this.instructions = instructions?.slice() ?? [];
      }
    }

    get shapePath() {
      if (!this._shapePath) {
        this._shapePath = new ShapePath(this);
      }
      if (this._dirty) {
        this._dirty = false;
        this._shapePath.buildPath();
      }
      return this._shapePath;
    }

    addPath(path, transform) {
      path = path.clone();
      this.instructions.push({ action: "addPath", data: [path, transform] });
      this._dirty = true;
      return this;
    }
    arc(...args) {
      this.instructions.push({ action: "arc", data: args });
      this._dirty = true;
      return this;
    }
    arcTo(...args) {
      this.instructions.push({ action: "arcTo", data: args });
      this._dirty = true;
      return this;
    }
    arcToSvg(...args) {
      this.instructions.push({ action: "arcToSvg", data: args });
      this._dirty = true;
      return this;
    }
    bezierCurveTo(...args) {
      this.instructions.push({ action: "bezierCurveTo", data: args });
      this._dirty = true;
      return this;
    }

    bezierCurveToShort(cp2x, cp2y, x2, y2, smoothness) {
      const last = this.instructions[this.instructions.length - 1];
      const lastPoint = this.getLastPoint(Point.shared);
      let cp1x = 0;
      let cp1y = 0;
      if (!last || last.action !== "bezierCurveTo") {
        cp1x = lastPoint.x;
        cp1y = lastPoint.y;
      } else {
        cp1x = last.data[2];
        cp1y = last.data[3];
        const currentX = lastPoint.x;
        const currentY = lastPoint.y;
        cp1x = currentX + (currentX - cp1x);
        cp1y = currentY + (currentY - cp1y);
      }
      this.instructions.push({ action: "bezierCurveTo", data: [cp1x, cp1y, cp2x, cp2y, x2, y2, smoothness] });
      this._dirty = true;
      return this;
    }

    closePath() {
      this.instructions.push({ action: "closePath", data: [] });
      this._dirty = true;
      return this;
    }
    ellipse(...args) {
      this.instructions.push({ action: "ellipse", data: args });
      this._dirty = true;
      return this;
    }
    lineTo(...args) {
      this.instructions.push({ action: "lineTo", data: args });
      this._dirty = true;
      return this;
    }
    moveTo(...args) {
      this.instructions.push({ action: "moveTo", data: args });
      return this;
    }
    quadraticCurveTo(...args) {
      this.instructions.push({ action: "quadraticCurveTo", data: args });
      this._dirty = true;
      return this;
    }

    quadraticCurveToShort(x2, y2, smoothness) {
      const last = this.instructions[this.instructions.length - 1];
      const lastPoint = this.getLastPoint(Point.shared);
      let cpx1 = 0;
      let cpy1 = 0;
      if (!last || last.action !== "quadraticCurveTo") {
        cpx1 = lastPoint.x;
        cpy1 = lastPoint.y;
      } else {
        cpx1 = last.data[0];
        cpy1 = last.data[1];
        const currentX = lastPoint.x;
        const currentY = lastPoint.y;
        cpx1 = currentX + (currentX - cpx1);
        cpy1 = currentY + (currentY - cpy1);
      }
      this.instructions.push({ action: "quadraticCurveTo", data: [cpx1, cpy1, x2, y2, smoothness] });
      this._dirty = true;
      return this;
    }

    rect(x2, y2, w2, h2, transform) {
      this.instructions.push({ action: "rect", data: [x2, y2, w2, h2, transform] });
      this._dirty = true;
      return this;
    }

    circle(x2, y2, radius, transform) {
      this.instructions.push({ action: "circle", data: [x2, y2, radius, transform] });
      this._dirty = true;
      return this;
    }
    roundRect(...args) {
      this.instructions.push({ action: "roundRect", data: args });
      this._dirty = true;
      return this;
    }
    poly(...args) {
      this.instructions.push({ action: "poly", data: args });
      this._dirty = true;
      return this;
    }
    regularPoly(...args) {
      this.instructions.push({ action: "regularPoly", data: args });
      this._dirty = true;
      return this;
    }
    roundPoly(...args) {
      this.instructions.push({ action: "roundPoly", data: args });
      this._dirty = true;
      return this;
    }
    roundShape(...args) {
      this.instructions.push({ action: "roundShape", data: args });
      this._dirty = true;
      return this;
    }
    filletRect(...args) {
      this.instructions.push({ action: "filletRect", data: args });
      this._dirty = true;
      return this;
    }
    chamferRect(...args) {
      this.instructions.push({ action: "chamferRect", data: args });
      this._dirty = true;
      return this;
    }

    star(x2, y2, points, radius, innerRadius, rotation, transform) {
      innerRadius || (innerRadius = radius / 2);
      const startAngle = -1 * Math.PI / 2 + rotation;
      const len = points * 2;
      const delta = Math.PI * 2 / len;
      const polygon = [];
      for (let i2 = 0; i2 < len; i2++) {
        const r2 = i2 % 2 ? innerRadius : radius;
        const angle = i2 * delta + startAngle;
        polygon.push(
          x2 + r2 * Math.cos(angle),
          y2 + r2 * Math.sin(angle)
        );
      }
      this.poly(polygon, true, transform);
      return this;
    }

    clone(deep = false) {
      const newGraphicsPath2D = new GraphicsPath();
      newGraphicsPath2D.checkForHoles = this.checkForHoles;
      if (!deep) {
        newGraphicsPath2D.instructions = this.instructions.slice();
      } else {
        for (let i2 = 0; i2 < this.instructions.length; i2++) {
          const instruction = this.instructions[i2];
          newGraphicsPath2D.instructions.push({ action: instruction.action, data: instruction.data.slice() });
        }
      }
      return newGraphicsPath2D;
    }
    clear() {
      this.instructions.length = 0;
      this._dirty = true;
      return this;
    }

    transform(matrix) {
      if (matrix.isIdentity()) return this;
      const a2 = matrix.a;
      const b2 = matrix.b;
      const c2 = matrix.c;
      const d2 = matrix.d;
      const tx = matrix.tx;
      const ty = matrix.ty;
      let x2 = 0;
      let y2 = 0;
      let cpx1 = 0;
      let cpy1 = 0;
      let cpx2 = 0;
      let cpy2 = 0;
      let rx = 0;
      let ry = 0;
      for (let i2 = 0; i2 < this.instructions.length; i2++) {
        const instruction = this.instructions[i2];
        const data = instruction.data;
        switch (instruction.action) {
          case "moveTo":
          case "lineTo":
            x2 = data[0];
            y2 = data[1];
            data[0] = a2 * x2 + c2 * y2 + tx;
            data[1] = b2 * x2 + d2 * y2 + ty;
            break;
          case "bezierCurveTo":
            cpx1 = data[0];
            cpy1 = data[1];
            cpx2 = data[2];
            cpy2 = data[3];
            x2 = data[4];
            y2 = data[5];
            data[0] = a2 * cpx1 + c2 * cpy1 + tx;
            data[1] = b2 * cpx1 + d2 * cpy1 + ty;
            data[2] = a2 * cpx2 + c2 * cpy2 + tx;
            data[3] = b2 * cpx2 + d2 * cpy2 + ty;
            data[4] = a2 * x2 + c2 * y2 + tx;
            data[5] = b2 * x2 + d2 * y2 + ty;
            break;
          case "quadraticCurveTo":
            cpx1 = data[0];
            cpy1 = data[1];
            x2 = data[2];
            y2 = data[3];
            data[0] = a2 * cpx1 + c2 * cpy1 + tx;
            data[1] = b2 * cpx1 + d2 * cpy1 + ty;
            data[2] = a2 * x2 + c2 * y2 + tx;
            data[3] = b2 * x2 + d2 * y2 + ty;
            break;
          case "arcToSvg":
            x2 = data[5];
            y2 = data[6];
            rx = data[0];
            ry = data[1];
            data[0] = a2 * rx + c2 * ry;
            data[1] = b2 * rx + d2 * ry;
            data[5] = a2 * x2 + c2 * y2 + tx;
            data[6] = b2 * x2 + d2 * y2 + ty;
            break;
          case "circle":
            data[4] = adjustTransform(data[3], matrix);
            break;
          case "rect":
            data[4] = adjustTransform(data[4], matrix);
            break;
          case "ellipse":
            data[8] = adjustTransform(data[8], matrix);
            break;
          case "roundRect":
            data[5] = adjustTransform(data[5], matrix);
            break;
          case "addPath":
            data[0].transform(matrix);
            break;
          case "poly":
            data[2] = adjustTransform(data[2], matrix);
            break;
          case "regularPoly":
          case "chamferRect":
            data[5] = adjustTransform(data[5], matrix);
            break;
          case "closePath":
            break;
          default:
            warn("unknown transform action", instruction.action);
            break;
        }
      }
      this._dirty = true;
      return this;
    }
    get bounds() {
      return this.shapePath.bounds;
    }

    getLastPoint(out2) {
      let index = this.instructions.length - 1;
      let lastInstruction = this.instructions[index];
      if (!lastInstruction) {
        out2.x = 0;
        out2.y = 0;
        return out2;
      }
      while (lastInstruction.action === "closePath") {
        index--;
        if (index < 0) {
          out2.x = 0;
          out2.y = 0;
          return out2;
        }
        lastInstruction = this.instructions[index];
      }
      switch (lastInstruction.action) {
        case "moveTo":
        case "lineTo":
          out2.x = lastInstruction.data[0];
          out2.y = lastInstruction.data[1];
          break;
        case "quadraticCurveTo":
          out2.x = lastInstruction.data[2];
          out2.y = lastInstruction.data[3];
          break;
        case "bezierCurveTo":
          out2.x = lastInstruction.data[4];
          out2.y = lastInstruction.data[5];
          break;
        case "arc":
        case "arcToSvg":
          out2.x = lastInstruction.data[5];
          out2.y = lastInstruction.data[6];
          break;
        case "addPath":
          lastInstruction.data[0].getLastPoint(out2);
          break;
      }
      return out2;
    }
  }
  function adjustTransform(currentMatrix, transform) {
    if (currentMatrix) {
      return currentMatrix.prepend(transform);
    }
    return transform.clone();
  }
  function parseSVGFloatAttribute(svg, id, defaultValue2) {
    const value = svg.getAttribute(id);
    return value ? Number(value) : defaultValue2;
  }
  function parseSVGDefinitions(svg, session) {
    const definitions = svg.querySelectorAll("defs");
    for (let i2 = 0; i2 < definitions.length; i2++) {
      const definition = definitions[i2];
      for (let j2 = 0; j2 < definition.children.length; j2++) {
        const child = definition.children[j2];
        switch (child.nodeName.toLowerCase()) {
          case "lineargradient":
            session.defs[child.id] = parseLinearGradient(child);
            break;
          case "radialgradient":
            session.defs[child.id] = parseRadialGradient();
            break;
        }
      }
    }
  }
  function parseLinearGradient(child) {
    const x0 = parseSVGFloatAttribute(child, "x1", 0);
    const y0 = parseSVGFloatAttribute(child, "y1", 0);
    const x1 = parseSVGFloatAttribute(child, "x2", 1);
    const y1 = parseSVGFloatAttribute(child, "y2", 0);
    const gradientUnit = child.getAttribute("gradientUnits") || "objectBoundingBox";
    const gradient = new FillGradient(
      x0,
      y0,
      x1,
      y1,
      gradientUnit === "objectBoundingBox" ? "local" : "global"
    );
    for (let k2 = 0; k2 < child.children.length; k2++) {
      const stop2 = child.children[k2];
      const offset2 = parseSVGFloatAttribute(stop2, "offset", 0);
      const color = Color.shared.setValue(stop2.getAttribute("stop-color")).toNumber();
      gradient.addColorStop(offset2, color);
    }
    return gradient;
  }
  function parseRadialGradient(_child) {
    warn("[SVG Parser] Radial gradients are not yet supported");
    return new FillGradient(0, 0, 1, 0);
  }
  function extractSvgUrlId(url) {
    const match = url.match(/url\s*\(\s*['"]?\s*#([^'"\s)]+)\s*['"]?\s*\)/i);
    return match ? match[1] : "";
  }
  const styleAttributes = {

    fill: { type: "paint", default: 0 },

    "fill-opacity": { type: "number", default: 1 },

    stroke: { type: "paint", default: 0 },

    "stroke-width": { type: "number", default: 1 },

    "stroke-opacity": { type: "number", default: 1 },

    "stroke-linecap": { type: "string", default: "butt" },

    "stroke-linejoin": { type: "string", default: "miter" },

    "stroke-miterlimit": { type: "number", default: 10 },

    "stroke-dasharray": { type: "string", default: "none" },

    "stroke-dashoffset": { type: "number", default: 0 },

    opacity: { type: "number", default: 1 }

  };
  function parseSVGStyle(svg, session) {
    const style = svg.getAttribute("style");
    const strokeStyle = {};
    const fillStyle = {};
    const result = {
      strokeStyle,
      fillStyle,
      useFill: false,
      useStroke: false
    };
    for (const key in styleAttributes) {
      const attribute = svg.getAttribute(key);
      if (attribute) {
        parseAttribute(session, result, key, attribute.trim());
      }
    }
    if (style) {
      const styleParts = style.split(";");
      for (let i2 = 0; i2 < styleParts.length; i2++) {
        const stylePart = styleParts[i2].trim();
        const [key, value] = stylePart.split(":");
        if (styleAttributes[key]) {
          parseAttribute(session, result, key, value.trim());
        }
      }
    }
    return {
      strokeStyle: result.useStroke ? strokeStyle : null,
      fillStyle: result.useFill ? fillStyle : null,
      useFill: result.useFill,
      useStroke: result.useStroke
    };
  }
  function parseAttribute(session, result, id, value) {
    switch (id) {
      case "stroke":
        if (value !== "none") {
          if (value.startsWith("url(")) {
            const id2 = extractSvgUrlId(value);
            result.strokeStyle.fill = session.defs[id2];
          } else {
            result.strokeStyle.color = Color.shared.setValue(value).toNumber();
          }
          result.useStroke = true;
        }
        break;
      case "stroke-width":
        result.strokeStyle.width = Number(value);
        break;
      case "fill":
        if (value !== "none") {
          if (value.startsWith("url(")) {
            const id2 = extractSvgUrlId(value);
            result.fillStyle.fill = session.defs[id2];
          } else {
            result.fillStyle.color = Color.shared.setValue(value).toNumber();
          }
          result.useFill = true;
        }
        break;
      case "fill-opacity":
        result.fillStyle.alpha = Number(value);
        break;
      case "stroke-opacity":
        result.strokeStyle.alpha = Number(value);
        break;
      case "opacity":
        result.fillStyle.alpha = Number(value);
        result.strokeStyle.alpha = Number(value);
        break;
    }
  }
  function checkForNestedPattern(subpathsWithArea) {
    if (subpathsWithArea.length <= 2) {
      return true;
    }
    const areas = subpathsWithArea.map((s2) => s2.area).sort((a2, b2) => b2 - a2);
    const [largestArea, secondArea] = areas;
    const smallestArea = areas[areas.length - 1];
    const largestToSecondRatio = largestArea / secondArea;
    const secondToSmallestRatio = secondArea / smallestArea;
    if (largestToSecondRatio > 3 && secondToSmallestRatio < 2) {
      return false;
    }
    return true;
  }
  function extractSubpaths(pathData) {
    const parts = pathData.split(/(?=[Mm])/);
    const subpaths = parts.filter((part) => part.trim().length > 0);
    return subpaths;
  }
  function calculatePathArea(pathData) {
    const coords = pathData.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (!coords || coords.length < 4) return 0;
    const numbers = coords.map(Number);
    const xs = [];
    const ys = [];
    for (let i2 = 0; i2 < numbers.length; i2 += 2) {
      if (i2 + 1 < numbers.length) {
        xs.push(numbers[i2]);
        ys.push(numbers[i2 + 1]);
      }
    }
    if (xs.length === 0 || ys.length === 0) return 0;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const area2 = (maxX - minX) * (maxY - minY);
    return area2;
  }
  function appendSVGPath(pathData, graphicsPath) {
    const tempPath = new GraphicsPath(pathData, false);
    for (const instruction of tempPath.instructions) {
      graphicsPath.instructions.push(instruction);
    }
  }
  function SVGParser(svg, graphicsContext) {
    if (typeof svg === "string") {
      const div = document.createElement("div");
      div.innerHTML = svg.trim();
      svg = div.querySelector("svg");
    }
    const session = {
      context: graphicsContext,
      defs: {},
      path: new GraphicsPath()
    };
    parseSVGDefinitions(svg, session);
    const children = svg.children;
    const { fillStyle, strokeStyle } = parseSVGStyle(svg, session);
    for (let i2 = 0; i2 < children.length; i2++) {
      const child = children[i2];
      if (child.nodeName.toLowerCase() === "defs") continue;
      renderChildren(child, session, fillStyle, strokeStyle);
    }
    return graphicsContext;
  }
  function renderChildren(svg, session, fillStyle, strokeStyle) {
    const children = svg.children;
    const { fillStyle: f1, strokeStyle: s1 } = parseSVGStyle(svg, session);
    if (f1 && fillStyle) {
      fillStyle = { ...fillStyle, ...f1 };
    } else if (f1) {
      fillStyle = f1;
    }
    if (s1 && strokeStyle) {
      strokeStyle = { ...strokeStyle, ...s1 };
    } else if (s1) {
      strokeStyle = s1;
    }
    const noStyle = !fillStyle && !strokeStyle;
    if (noStyle) {
      fillStyle = { color: 0 };
    }
    let x2;
    let y2;
    let x1;
    let y1;
    let x22;
    let y22;
    let cx;
    let cy;
    let r2;
    let rx;
    let ry;
    let points;
    let pointsString;
    let d2;
    let graphicsPath;
    let width;
    let height;
    switch (svg.nodeName.toLowerCase()) {
      case "path": {
        d2 = svg.getAttribute("d");
        const fillRule = svg.getAttribute("fill-rule");
        const subpaths = extractSubpaths(d2);
        const hasExplicitEvenodd = fillRule === "evenodd";
        const hasMultipleSubpaths = subpaths.length > 1;
        const shouldProcessHoles = hasExplicitEvenodd && hasMultipleSubpaths;
        if (shouldProcessHoles) {
          const subpathsWithArea = subpaths.map((subpath) => ({
            path: subpath,
            area: calculatePathArea(subpath)
          }));
          subpathsWithArea.sort((a2, b2) => b2.area - a2.area);
          const useMultipleHolesApproach = subpaths.length > 3 || !checkForNestedPattern(subpathsWithArea);
          if (useMultipleHolesApproach) {
            for (let i2 = 0; i2 < subpathsWithArea.length; i2++) {
              const subpath = subpathsWithArea[i2];
              const isMainShape = i2 === 0;
              session.context.beginPath();
              const newPath = new GraphicsPath(void 0, true);
              appendSVGPath(subpath.path, newPath);
              session.context.path(newPath);
              if (isMainShape) {
                if (fillStyle) session.context.fill(fillStyle);
                if (strokeStyle) session.context.stroke(strokeStyle);
              } else {
                session.context.cut();
              }
            }
          } else {
            for (let i2 = 0; i2 < subpathsWithArea.length; i2++) {
              const subpath = subpathsWithArea[i2];
              const isHole = i2 % 2 === 1;
              session.context.beginPath();
              const newPath = new GraphicsPath(void 0, true);
              appendSVGPath(subpath.path, newPath);
              session.context.path(newPath);
              if (isHole) {
                session.context.cut();
              } else {
                if (fillStyle) session.context.fill(fillStyle);
                if (strokeStyle) session.context.stroke(strokeStyle);
              }
            }
          }
        } else {
          const useEvenoddForGraphicsPath = fillRule ? fillRule === "evenodd" : true;
          graphicsPath = new GraphicsPath(d2, useEvenoddForGraphicsPath);
          session.context.path(graphicsPath);
          if (fillStyle) session.context.fill(fillStyle);
          if (strokeStyle) session.context.stroke(strokeStyle);
        }
        break;
      }
      case "circle":
        cx = parseSVGFloatAttribute(svg, "cx", 0);
        cy = parseSVGFloatAttribute(svg, "cy", 0);
        r2 = parseSVGFloatAttribute(svg, "r", 0);
        session.context.ellipse(cx, cy, r2, r2);
        if (fillStyle) session.context.fill(fillStyle);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "rect":
        x2 = parseSVGFloatAttribute(svg, "x", 0);
        y2 = parseSVGFloatAttribute(svg, "y", 0);
        width = parseSVGFloatAttribute(svg, "width", 0);
        height = parseSVGFloatAttribute(svg, "height", 0);
        rx = parseSVGFloatAttribute(svg, "rx", 0);
        ry = parseSVGFloatAttribute(svg, "ry", 0);
        if (rx || ry) {
          session.context.roundRect(x2, y2, width, height, rx || ry);
        } else {
          session.context.rect(x2, y2, width, height);
        }
        if (fillStyle) session.context.fill(fillStyle);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "ellipse":
        cx = parseSVGFloatAttribute(svg, "cx", 0);
        cy = parseSVGFloatAttribute(svg, "cy", 0);
        rx = parseSVGFloatAttribute(svg, "rx", 0);
        ry = parseSVGFloatAttribute(svg, "ry", 0);
        session.context.beginPath();
        session.context.ellipse(cx, cy, rx, ry);
        if (fillStyle) session.context.fill(fillStyle);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "line":
        x1 = parseSVGFloatAttribute(svg, "x1", 0);
        y1 = parseSVGFloatAttribute(svg, "y1", 0);
        x22 = parseSVGFloatAttribute(svg, "x2", 0);
        y22 = parseSVGFloatAttribute(svg, "y2", 0);
        session.context.beginPath();
        session.context.moveTo(x1, y1);
        session.context.lineTo(x22, y22);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "polygon":
        pointsString = svg.getAttribute("points");
        points = pointsString.match(/-?\d+/g).map((n2) => parseInt(n2, 10));
        session.context.poly(points, true);
        if (fillStyle) session.context.fill(fillStyle);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "polyline":
        pointsString = svg.getAttribute("points");
        points = pointsString.match(/-?\d+/g).map((n2) => parseInt(n2, 10));
        session.context.poly(points, false);
        if (strokeStyle) session.context.stroke(strokeStyle);
        break;
      case "g":
      case "svg":
        break;
      default: {
        warn(`[SVG parser] <${svg.nodeName}> elements unsupported`);
        break;
      }
    }
    if (noStyle) {
      fillStyle = null;
    }
    for (let i2 = 0; i2 < children.length; i2++) {
      renderChildren(children[i2], session, fillStyle, strokeStyle);
    }
  }
  const repetitionMap = {
    repeat: {
      addressModeU: "repeat",
      addressModeV: "repeat"
    },
    "repeat-x": {
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge"
    },
    "repeat-y": {
      addressModeU: "clamp-to-edge",
      addressModeV: "repeat"
    },
    "no-repeat": {
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    }
  };
  class FillPattern {
    constructor(texture, repetition) {
      this.uid = uid$1("fillPattern");
      this._tick = 0;
      this.transform = new Matrix();
      this.texture = texture;
      this.transform.scale(
        1 / texture.frame.width,
        1 / texture.frame.height
      );
      if (repetition) {
        texture.source.style.addressModeU = repetitionMap[repetition].addressModeU;
        texture.source.style.addressModeV = repetitionMap[repetition].addressModeV;
      }
    }

    setTransform(transform) {
      const texture = this.texture;
      this.transform.copyFrom(transform);
      this.transform.invert();
      this.transform.scale(
        1 / texture.frame.width,
        1 / texture.frame.height
      );
      this._tick++;
    }

    get texture() {
      return this._texture;
    }
    set texture(value) {
      if (this._texture === value) return;
      this._texture = value;
      this._tick++;
    }

    get styleKey() {
      return `fill-pattern-${this.uid}-${this._tick}`;
    }

    destroy() {
      this.texture.destroy(true);
      this.texture = null;
    }
  }
  function isColorLike(value) {
    return Color.isColorLike(value);
  }
  function isFillPattern(value) {
    return value instanceof FillPattern;
  }
  function isFillGradient(value) {
    return value instanceof FillGradient;
  }
  function isTexture(value) {
    return value instanceof Texture;
  }
  function handleColorLike(fill, value, defaultStyle) {
    const temp = Color.shared.setValue(value ?? 0);
    fill.color = temp.toNumber();
    fill.alpha = temp.alpha === 1 ? defaultStyle.alpha : temp.alpha;
    fill.texture = Texture.WHITE;
    return { ...defaultStyle, ...fill };
  }
  function handleTexture(fill, value, defaultStyle) {
    fill.texture = value;
    return { ...defaultStyle, ...fill };
  }
  function handleFillPattern(fill, value, defaultStyle) {
    fill.fill = value;
    fill.color = 16777215;
    fill.texture = value.texture;
    fill.matrix = value.transform;
    return { ...defaultStyle, ...fill };
  }
  function handleFillGradient(fill, value, defaultStyle) {
    value.buildGradient();
    fill.fill = value;
    fill.color = 16777215;
    fill.texture = value.texture;
    fill.matrix = value.transform;
    fill.textureSpace = value.textureSpace;
    return { ...defaultStyle, ...fill };
  }
  function handleFillObject(value, defaultStyle) {
    const style = { ...defaultStyle, ...value };
    const color = Color.shared.setValue(style.color);
    style.alpha *= color.alpha;
    style.color = color.toNumber();
    return style;
  }
  function toFillStyle(value, defaultStyle) {
    if (value === void 0 || value === null) {
      return null;
    }
    const fill = {};
    const objectStyle = value;
    if (isColorLike(value)) {
      return handleColorLike(fill, value, defaultStyle);
    } else if (isTexture(value)) {
      return handleTexture(fill, value, defaultStyle);
    } else if (isFillPattern(value)) {
      return handleFillPattern(fill, value, defaultStyle);
    } else if (isFillGradient(value)) {
      return handleFillGradient(fill, value, defaultStyle);
    } else if (objectStyle.fill && isFillPattern(objectStyle.fill)) {
      return handleFillPattern(objectStyle, objectStyle.fill, defaultStyle);
    } else if (objectStyle.fill && isFillGradient(objectStyle.fill)) {
      return handleFillGradient(objectStyle, objectStyle.fill, defaultStyle);
    }
    return handleFillObject(objectStyle, defaultStyle);
  }
  function toStrokeStyle(value, defaultStyle) {
    const { width, alignment, miterLimit, cap, join, pixelLine, ...rest } = defaultStyle;
    const fill = toFillStyle(value, rest);
    if (!fill) {
      return null;
    }
    return {
      width,
      alignment,
      miterLimit,
      cap,
      join,
      pixelLine,
      ...fill
    };
  }
  function getMaxMiterRatio(path, miterLimit) {
    let maxRatio = 1;
    const shapePrimitives = path.shapePath.shapePrimitives;
    for (let i2 = 0; i2 < shapePrimitives.length; i2++) {
      const shape = shapePrimitives[i2].shape;
      if (shape.type !== "polygon") continue;
      const points = shape.points;
      const n2 = points.length;
      if (n2 < 6) continue;
      const closed = shape.closePath;
      for (let j2 = 0; j2 < n2; j2 += 2) {
        if (!closed && (j2 === 0 || j2 === n2 - 2)) continue;
        const prevIdx = (j2 - 2 + n2) % n2;
        const nextIdx = (j2 + 2) % n2;
        const x0 = points[prevIdx];
        const y0 = points[prevIdx + 1];
        const x1 = points[j2];
        const y1 = points[j2 + 1];
        const x2 = points[nextIdx];
        const y2 = points[nextIdx + 1];
        const dx0 = x0 - x1;
        const dy0 = y0 - y1;
        const dx1 = x2 - x1;
        const dy1 = y2 - y1;
        const len0Sq = dx0 * dx0 + dy0 * dy0;
        const len1Sq = dx1 * dx1 + dy1 * dy1;
        if (len0Sq < 1e-12 || len1Sq < 1e-12) continue;
        const dot = dx0 * dx1 + dy0 * dy1;
        const cosAngle = dot / Math.sqrt(len0Sq * len1Sq);
        let clampedCos = cosAngle;
        if (clampedCos < -1) clampedCos = -1;
        else if (clampedCos > 1) clampedCos = 1;
        const sinHalfAngle = Math.sqrt((1 - clampedCos) * 0.5);
        if (sinHalfAngle < 1e-6) continue;
        const miterRatio = Math.min(1 / sinHalfAngle, miterLimit);
        if (miterRatio > maxRatio) maxRatio = miterRatio;
      }
    }
    return maxRatio;
  }
  const tmpPoint = new Point();
  const tempMatrix$3 = new Matrix();
  const _GraphicsContext = class _GraphicsContext2 extends EventEmitter {
    constructor() {
      super(...arguments);
      this._gpuData =                 Object.create(null);
      this.autoGarbageCollect = true;
      this._gcLastUsed = -1;
      this.uid = uid$1("graphicsContext");
      this.dirty = true;
      this.batchMode = "auto";
      this.instructions = [];
      this.destroyed = false;
      this._activePath = new GraphicsPath();
      this._transform = new Matrix();
      this._fillStyle = { ..._GraphicsContext2.defaultFillStyle };
      this._strokeStyle = { ..._GraphicsContext2.defaultStrokeStyle };
      this._stateStack = [];
      this._tick = 0;
      this._bounds = new Bounds();
      this._boundsDirty = true;
    }

    clone() {
      const clone = new _GraphicsContext2();
      clone.batchMode = this.batchMode;
      clone.instructions = this.instructions.slice();
      clone._activePath = this._activePath.clone();
      clone._transform = this._transform.clone();
      clone._fillStyle = { ...this._fillStyle };
      clone._strokeStyle = { ...this._strokeStyle };
      clone._stateStack = this._stateStack.slice();
      clone._bounds = this._bounds.clone();
      clone._boundsDirty = true;
      return clone;
    }

    get fillStyle() {
      return this._fillStyle;
    }
    set fillStyle(value) {
      this._fillStyle = toFillStyle(value, _GraphicsContext2.defaultFillStyle);
    }

    get strokeStyle() {
      return this._strokeStyle;
    }
    set strokeStyle(value) {
      this._strokeStyle = toStrokeStyle(value, _GraphicsContext2.defaultStrokeStyle);
    }

    setFillStyle(style) {
      this._fillStyle = toFillStyle(style, _GraphicsContext2.defaultFillStyle);
      return this;
    }

    setStrokeStyle(style) {
      this._strokeStyle = toFillStyle(style, _GraphicsContext2.defaultStrokeStyle);
      return this;
    }
    texture(texture, tint, dx, dy, dw, dh) {
      this.instructions.push({
        action: "texture",
        data: {
          image: texture,
          dx: dx || 0,
          dy: dy || 0,
          dw: dw || texture.frame.width,
          dh: dh || texture.frame.height,
          transform: this._transform.clone(),
          alpha: this._fillStyle.alpha,
          style: tint || tint === 0 ? Color.shared.setValue(tint).toNumber() : 16777215
        }
      });
      this.onUpdate();
      return this;
    }

    beginPath() {
      this._activePath = new GraphicsPath();
      return this;
    }
    fill(style, alpha) {
      let path;
      const lastInstruction = this.instructions[this.instructions.length - 1];
      if (this._tick === 0 && lastInstruction?.action === "stroke") {
        path = lastInstruction.data.path;
      } else {
        path = this._activePath.clone();
      }
      if (!path) return this;
      if (style != null) {
        if (alpha !== void 0 && typeof style === "number") {
          deprecation(v8_0_0, "GraphicsContext.fill(color, alpha) is deprecated, use GraphicsContext.fill({ color, alpha }) instead");
          style = { color: style, alpha };
        }
        this._fillStyle = toFillStyle(style, _GraphicsContext2.defaultFillStyle);
      }
      this.instructions.push({
        action: "fill",

        data: { style: this.fillStyle, path }
      });
      this.onUpdate();
      this._initNextPathLocation();
      this._tick = 0;
      return this;
    }
    _initNextPathLocation() {
      const { x: x2, y: y2 } = this._activePath.getLastPoint(Point.shared);
      this._activePath.clear();
      this._activePath.moveTo(x2, y2);
    }

    stroke(style) {
      let path;
      const lastInstruction = this.instructions[this.instructions.length - 1];
      if (this._tick === 0 && lastInstruction?.action === "fill") {
        path = lastInstruction.data.path;
      } else {
        path = this._activePath.clone();
      }
      if (!path) return this;
      if (style != null) {
        this._strokeStyle = toStrokeStyle(style, _GraphicsContext2.defaultStrokeStyle);
      }
      this.instructions.push({
        action: "stroke",

        data: { style: this.strokeStyle, path }
      });
      this.onUpdate();
      this._initNextPathLocation();
      this._tick = 0;
      return this;
    }

    cut() {
      for (let i2 = 0; i2 < 2; i2++) {
        const lastInstruction = this.instructions[this.instructions.length - 1 - i2];
        const holePath = this._activePath.clone();
        if (lastInstruction) {
          if (lastInstruction.action === "stroke" || lastInstruction.action === "fill") {
            if (lastInstruction.data.hole) {
              lastInstruction.data.hole.addPath(holePath);
            } else {
              lastInstruction.data.hole = holePath;
              break;
            }
          }
        }
      }
      this._initNextPathLocation();
      return this;
    }

    arc(x2, y2, radius, startAngle, endAngle, counterclockwise) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.arc(
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty,
        radius,
        startAngle,
        endAngle,
        counterclockwise
      );
      return this;
    }

    arcTo(x1, y1, x2, y2, radius) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.arcTo(
        t2.a * x1 + t2.c * y1 + t2.tx,
        t2.b * x1 + t2.d * y1 + t2.ty,
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty,
        radius
      );
      return this;
    }

    arcToSvg(rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x2, y2) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.arcToSvg(
        rx,
        ry,
        xAxisRotation,

        largeArcFlag,
        sweepFlag,
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty
      );
      return this;
    }

    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2, smoothness) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.bezierCurveTo(
        t2.a * cp1x + t2.c * cp1y + t2.tx,
        t2.b * cp1x + t2.d * cp1y + t2.ty,
        t2.a * cp2x + t2.c * cp2y + t2.tx,
        t2.b * cp2x + t2.d * cp2y + t2.ty,
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty,
        smoothness
      );
      return this;
    }

    closePath() {
      this._tick++;
      this._activePath?.closePath();
      return this;
    }

    ellipse(x2, y2, radiusX, radiusY) {
      this._tick++;
      this._activePath.ellipse(x2, y2, radiusX, radiusY, this._transform.clone());
      return this;
    }

    circle(x2, y2, radius) {
      this._tick++;
      this._activePath.circle(x2, y2, radius, this._transform.clone());
      return this;
    }

    path(path) {
      this._tick++;
      this._activePath.addPath(path, this._transform.clone());
      return this;
    }

    lineTo(x2, y2) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.lineTo(
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty
      );
      return this;
    }

    moveTo(x2, y2) {
      this._tick++;
      const t2 = this._transform;
      const instructions = this._activePath.instructions;
      const transformedX = t2.a * x2 + t2.c * y2 + t2.tx;
      const transformedY = t2.b * x2 + t2.d * y2 + t2.ty;
      if (instructions.length === 1 && instructions[0].action === "moveTo") {
        instructions[0].data[0] = transformedX;
        instructions[0].data[1] = transformedY;
        return this;
      }
      this._activePath.moveTo(
        transformedX,
        transformedY
      );
      return this;
    }

    quadraticCurveTo(cpx, cpy, x2, y2, smoothness) {
      this._tick++;
      const t2 = this._transform;
      this._activePath.quadraticCurveTo(
        t2.a * cpx + t2.c * cpy + t2.tx,
        t2.b * cpx + t2.d * cpy + t2.ty,
        t2.a * x2 + t2.c * y2 + t2.tx,
        t2.b * x2 + t2.d * y2 + t2.ty,
        smoothness
      );
      return this;
    }

    rect(x2, y2, w2, h2) {
      this._tick++;
      this._activePath.rect(x2, y2, w2, h2, this._transform.clone());
      return this;
    }

    roundRect(x2, y2, w2, h2, radius) {
      this._tick++;
      this._activePath.roundRect(x2, y2, w2, h2, radius, this._transform.clone());
      return this;
    }

    poly(points, close) {
      this._tick++;
      this._activePath.poly(points, close, this._transform.clone());
      return this;
    }

    regularPoly(x2, y2, radius, sides, rotation = 0, transform) {
      this._tick++;
      this._activePath.regularPoly(x2, y2, radius, sides, rotation, transform);
      return this;
    }

    roundPoly(x2, y2, radius, sides, corner, rotation) {
      this._tick++;
      this._activePath.roundPoly(x2, y2, radius, sides, corner, rotation);
      return this;
    }

    roundShape(points, radius, useQuadratic, smoothness) {
      this._tick++;
      this._activePath.roundShape(points, radius, useQuadratic, smoothness);
      return this;
    }

    filletRect(x2, y2, width, height, fillet) {
      this._tick++;
      this._activePath.filletRect(x2, y2, width, height, fillet);
      return this;
    }

    chamferRect(x2, y2, width, height, chamfer, transform) {
      this._tick++;
      this._activePath.chamferRect(x2, y2, width, height, chamfer, transform);
      return this;
    }

    star(x2, y2, points, radius, innerRadius = 0, rotation = 0) {
      this._tick++;
      this._activePath.star(x2, y2, points, radius, innerRadius, rotation, this._transform.clone());
      return this;
    }

    svg(svg) {
      this._tick++;
      SVGParser(svg, this);
      return this;
    }

    restore() {
      const state = this._stateStack.pop();
      if (state) {
        this._transform = state.transform;
        this._fillStyle = state.fillStyle;
        this._strokeStyle = state.strokeStyle;
      }
      return this;
    }

    save() {
      this._stateStack.push({
        transform: this._transform.clone(),
        fillStyle: { ...this._fillStyle },
        strokeStyle: { ...this._strokeStyle }
      });
      return this;
    }

    getTransform() {
      return this._transform;
    }

    resetTransform() {
      this._transform.identity();
      return this;
    }

    rotate(angle) {
      this._transform.rotate(angle);
      return this;
    }

    scale(x2, y2 = x2) {
      this._transform.scale(x2, y2);
      return this;
    }
    setTransform(a2, b2, c2, d2, dx, dy) {
      if (a2 instanceof Matrix) {
        this._transform.set(a2.a, a2.b, a2.c, a2.d, a2.tx, a2.ty);
        return this;
      }
      this._transform.set(a2, b2, c2, d2, dx, dy);
      return this;
    }
    transform(a2, b2, c2, d2, dx, dy) {
      if (a2 instanceof Matrix) {
        this._transform.append(a2);
        return this;
      }
      tempMatrix$3.set(a2, b2, c2, d2, dx, dy);
      this._transform.append(tempMatrix$3);
      return this;
    }

    translate(x2, y2 = x2) {
      this._transform.translate(x2, y2);
      return this;
    }

    clear() {
      this._activePath.clear();
      this.instructions.length = 0;
      this.resetTransform();
      this.onUpdate();
      return this;
    }
    onUpdate() {
      this._boundsDirty = true;
      this.dirty = true;
      this.emit("update", this, 16);
    }

    get bounds() {
      if (!this._boundsDirty) return this._bounds;
      this._boundsDirty = false;
      const bounds = this._bounds;
      bounds.clear();
      for (let i2 = 0; i2 < this.instructions.length; i2++) {
        const instruction = this.instructions[i2];
        const action = instruction.action;
        if (action === "fill") {
          const data = instruction.data;
          bounds.addBounds(data.path.bounds);
        } else if (action === "texture") {
          const data = instruction.data;
          bounds.addFrame(data.dx, data.dy, data.dx + data.dw, data.dy + data.dh, data.transform);
        }
        if (action === "stroke") {
          const data = instruction.data;
          const alignment = data.style.alignment;
          let outerPadding = data.style.width * (1 - alignment);
          if (data.style.join === "miter") {
            outerPadding *= getMaxMiterRatio(data.path, data.style.miterLimit);
          }
          const _bounds = data.path.bounds;
          bounds.addFrame(
            _bounds.minX - outerPadding,
            _bounds.minY - outerPadding,
            _bounds.maxX + outerPadding,
            _bounds.maxY + outerPadding
          );
        }
      }
      if (!bounds.isValid) {
        bounds.set(0, 0, 0, 0);
      }
      return bounds;
    }

    containsPoint(point) {
      if (!this.bounds.containsPoint(point.x, point.y)) return false;
      const instructions = this.instructions;
      let hasHit = false;
      for (let k2 = 0; k2 < instructions.length; k2++) {
        const instruction = instructions[k2];
        const data = instruction.data;
        const path = data.path;
        if (!instruction.action || !path) continue;
        const style = data.style;
        const shapes = path.shapePath.shapePrimitives;
        for (let i2 = 0; i2 < shapes.length; i2++) {
          const shape = shapes[i2].shape;
          if (!style || !shape) continue;
          const transform = shapes[i2].transform;
          const transformedPoint = transform ? transform.applyInverse(point, tmpPoint) : point;
          if (instruction.action === "fill") {
            hasHit = shape.contains(transformedPoint.x, transformedPoint.y);
          } else {
            const strokeStyle = style;
            hasHit = shape.strokeContains(transformedPoint.x, transformedPoint.y, strokeStyle.width, strokeStyle.alignment);
          }
          const holes = data.hole;
          if (holes) {
            const holeShapes = holes.shapePath?.shapePrimitives;
            if (holeShapes) {
              for (let j2 = 0; j2 < holeShapes.length; j2++) {
                if (holeShapes[j2].shape.contains(transformedPoint.x, transformedPoint.y)) {
                  hasHit = false;
                }
              }
            }
          }
          if (hasHit) {
            return true;
          }
        }
      }
      return hasHit;
    }

    unload() {
      this.emit("unload", this);
      for (const key in this._gpuData) {
        this._gpuData[key]?.destroy();
      }
      this._gpuData =                 Object.create(null);
    }

    destroy(options = false) {
      if (this.destroyed) return;
      this.destroyed = true;
      this._stateStack.length = 0;
      this._transform = null;
      this.unload();
      this.emit("destroy", this);
      this.removeAllListeners();
      const destroyTexture = typeof options === "boolean" ? options : options?.texture;
      if (destroyTexture) {
        const destroyTextureSource = typeof options === "boolean" ? options : options?.textureSource;
        if (this._fillStyle.texture) {
          this._fillStyle.fill && "uid" in this._fillStyle.fill ? this._fillStyle.fill.destroy() : this._fillStyle.texture.destroy(destroyTextureSource);
        }
        if (this._strokeStyle.texture) {
          this._strokeStyle.fill && "uid" in this._strokeStyle.fill ? this._strokeStyle.fill.destroy() : this._strokeStyle.texture.destroy(destroyTextureSource);
        }
      }
      this._fillStyle = null;
      this._strokeStyle = null;
      this.instructions = null;
      this._activePath = null;
      this._bounds = null;
      this._stateStack = null;
      this.customShader = null;
      this._transform = null;
    }
  };
  _GraphicsContext.defaultFillStyle = {

    color: 16777215,

    alpha: 1,

    texture: Texture.WHITE,

    matrix: null,

    fill: null,

    textureSpace: "local"
  };
  _GraphicsContext.defaultStrokeStyle = {

    width: 1,

    color: 16777215,

    alpha: 1,

    alignment: 0.5,

    miterLimit: 10,

    cap: "butt",

    join: "miter",

    texture: Texture.WHITE,

    matrix: null,

    fill: null,

    textureSpace: "local",

    pixelLine: false
  };
  let GraphicsContext = _GraphicsContext;
  let canUseNewCanvasBlendModesValue;
  function createColoredCanvas(color) {
    const canvas = DOMAdapter.get().createCanvas(6, 1);
    const context2 = canvas.getContext("2d");
    context2.fillStyle = color;
    context2.fillRect(0, 0, 6, 1);
    return canvas;
  }
  function canUseNewCanvasBlendModes() {
    if (canUseNewCanvasBlendModesValue !== void 0) {
      return canUseNewCanvasBlendModesValue;
    }
    try {
      const magenta = createColoredCanvas("#ff00ff");
      const yellow = createColoredCanvas("#ffff00");
      const canvas = DOMAdapter.get().createCanvas(6, 1);
      const context2 = canvas.getContext("2d");
      context2.globalCompositeOperation = "multiply";
      context2.drawImage(magenta, 0, 0);
      context2.drawImage(yellow, 2, 0);
      const imageData = context2.getImageData(2, 0, 1, 1);
      if (!imageData) {
        canUseNewCanvasBlendModesValue = false;
      } else {
        const data = imageData.data;
        canUseNewCanvasBlendModesValue = data[0] === 255 && data[1] === 0 && data[2] === 0;
      }
    } catch (_error) {
      canUseNewCanvasBlendModesValue = false;
    }
    return canUseNewCanvasBlendModesValue;
  }
  const canvasUtils = {
    canvas: null,
    convertTintToImage: false,
    cacheStepsPerColorChannel: 8,
    canUseMultiply: canUseNewCanvasBlendModes(),
    tintMethod: null,
    _canvasSourceCache:                 new WeakMap(),
    _unpremultipliedCache:                 new WeakMap(),
    getCanvasSource: (texture) => {
      const source2 = texture.source;
      const resource = source2?.resource;
      if (!resource) {
        return null;
      }
      const isPMA = source2.alphaMode === "premultiplied-alpha";
      const resourceWidth = source2.resourceWidth ?? source2.pixelWidth;
      const resourceHeight = source2.resourceHeight ?? source2.pixelHeight;
      const needsResize = resourceWidth !== source2.pixelWidth || resourceHeight !== source2.pixelHeight;
      if (isPMA) {
        if (resource instanceof HTMLCanvasElement || typeof OffscreenCanvas !== "undefined" && resource instanceof OffscreenCanvas) {
          if (!needsResize) {
            return resource;
          }
        }
        const cached = canvasUtils._unpremultipliedCache.get(source2);
        if (cached?.resourceId === source2._resourceId) {
          return cached.canvas;
        }
      }
      if (resource instanceof Uint8Array || resource instanceof Uint8ClampedArray || resource instanceof Int8Array || resource instanceof Uint16Array || resource instanceof Int16Array || resource instanceof Uint32Array || resource instanceof Int32Array || resource instanceof Float32Array || resource instanceof ArrayBuffer) {
        const cached = canvasUtils._canvasSourceCache.get(source2);
        if (cached?.resourceId === source2._resourceId) {
          return cached.canvas;
        }
        const canvas = DOMAdapter.get().createCanvas(source2.pixelWidth, source2.pixelHeight);
        const context2 = canvas.getContext("2d");
        const imageData = context2.createImageData(source2.pixelWidth, source2.pixelHeight);
        const data = imageData.data;
        const bytes = resource instanceof ArrayBuffer ? new Uint8Array(resource) : new Uint8Array(resource.buffer, resource.byteOffset, resource.byteLength);
        if (source2.format === "bgra8unorm") {
          for (let i2 = 0; i2 < data.length && i2 + 3 < bytes.length; i2 += 4) {
            data[i2] = bytes[i2 + 2];
            data[i2 + 1] = bytes[i2 + 1];
            data[i2 + 2] = bytes[i2];
            data[i2 + 3] = bytes[i2 + 3];
          }
        } else {
          data.set(bytes.subarray(0, data.length));
        }
        context2.putImageData(imageData, 0, 0);
        canvasUtils._canvasSourceCache.set(source2, { canvas, resourceId: source2._resourceId });
        return canvas;
      }
      if (isPMA) {
        const canvas = DOMAdapter.get().createCanvas(source2.pixelWidth, source2.pixelHeight);
        const context2 = canvas.getContext("2d", { willReadFrequently: true });
        canvas.width = source2.pixelWidth;
        canvas.height = source2.pixelHeight;
        context2.drawImage(resource, 0, 0);
        const imageData = context2.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i2 = 0; i2 < data.length; i2 += 4) {
          const a2 = data[i2 + 3];
          if (a2 > 0) {
            const alphaInv = 255 / a2;
            data[i2] = Math.min(255, data[i2] * alphaInv + 0.5);
            data[i2 + 1] = Math.min(255, data[i2 + 1] * alphaInv + 0.5);
            data[i2 + 2] = Math.min(255, data[i2 + 2] * alphaInv + 0.5);
          }
        }
        context2.putImageData(imageData, 0, 0);
        canvasUtils._unpremultipliedCache.set(source2, { canvas, resourceId: source2._resourceId });
        return canvas;
      }
      if (needsResize) {
        const cached = canvasUtils._canvasSourceCache.get(source2);
        if (cached?.resourceId === source2._resourceId) {
          return cached.canvas;
        }
        const canvas = DOMAdapter.get().createCanvas(source2.pixelWidth, source2.pixelHeight);
        const context2 = canvas.getContext("2d");
        canvas.width = source2.pixelWidth;
        canvas.height = source2.pixelHeight;
        context2.drawImage(resource, 0, 0);
        canvasUtils._canvasSourceCache.set(source2, { canvas, resourceId: source2._resourceId });
        return canvas;
      }
      return resource;
    },
    getTintedCanvas: (sprite, color) => {
      const texture = sprite.texture;
      const stringColor = Color.shared.setValue(color).toHex();
      const cache = texture.tintCache || (texture.tintCache = {});
      const cachedCanvas = cache[stringColor];
      const resourceId = texture.source._resourceId;
      if (cachedCanvas?.tintId === resourceId) {
        return cachedCanvas;
      }
      const canvas = cachedCanvas && "getContext" in cachedCanvas ? cachedCanvas : DOMAdapter.get().createCanvas();
      canvasUtils.tintMethod(texture, color, canvas);
      canvas.tintId = resourceId;
      {
        cache[stringColor] = canvas;
      }
      return cache[stringColor];
    },
    getTintedPattern: (texture, color) => {
      const stringColor = Color.shared.setValue(color).toHex();
      const cache = texture.patternCache || (texture.patternCache = {});
      const resourceId = texture.source._resourceId;
      let pattern = cache[stringColor];
      if (pattern?.tintId === resourceId) {
        return pattern;
      }
      if (!canvasUtils.canvas) {
        canvasUtils.canvas = DOMAdapter.get().createCanvas();
      }
      canvasUtils.tintMethod(texture, color, canvasUtils.canvas);
      const context2 = canvasUtils.canvas.getContext("2d");
      pattern = context2.createPattern(canvasUtils.canvas, "repeat");
      pattern.tintId = resourceId;
      cache[stringColor] = pattern;
      return pattern;
    },

    applyPatternTransform: (pattern, matrix, invert = true) => {
      if (!matrix) return;
      const patternAny = pattern;
      if (!patternAny.setTransform) return;
      const DOMMatrixCtor = globalThis.DOMMatrix;
      if (!DOMMatrixCtor) return;
      const domMatrix = new DOMMatrixCtor([matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]);
      patternAny.setTransform(invert ? domMatrix.inverse() : domMatrix);
    },
    tintWithMultiply: (texture, color, canvas) => {
      const context2 = canvas.getContext("2d");
      const crop = texture.frame.clone();
      const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
      const rotate = texture.rotate;
      crop.x *= resolution;
      crop.y *= resolution;
      crop.width *= resolution;
      crop.height *= resolution;
      const isVertical = groupD8.isVertical(rotate);
      const outWidth = isVertical ? crop.height : crop.width;
      const outHeight = isVertical ? crop.width : crop.height;
      canvas.width = Math.ceil(outWidth);
      canvas.height = Math.ceil(outHeight);
      context2.save();
      context2.fillStyle = Color.shared.setValue(color).toHex();
      context2.fillRect(0, 0, outWidth, outHeight);
      context2.globalCompositeOperation = "multiply";
      const source2 = canvasUtils.getCanvasSource(texture);
      if (!source2) {
        context2.restore();
        return;
      }
      if (rotate) {
        canvasUtils._applyInverseRotation(context2, rotate, crop.width, crop.height);
      }
      context2.drawImage(
        source2,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      context2.globalCompositeOperation = "destination-atop";
      context2.drawImage(
        source2,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      context2.restore();
    },
    tintWithOverlay: (texture, color, canvas) => {
      const context2 = canvas.getContext("2d");
      const crop = texture.frame.clone();
      const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
      const rotate = texture.rotate;
      crop.x *= resolution;
      crop.y *= resolution;
      crop.width *= resolution;
      crop.height *= resolution;
      const isVertical = groupD8.isVertical(rotate);
      const outWidth = isVertical ? crop.height : crop.width;
      const outHeight = isVertical ? crop.width : crop.height;
      canvas.width = Math.ceil(outWidth);
      canvas.height = Math.ceil(outHeight);
      context2.save();
      context2.globalCompositeOperation = "copy";
      context2.fillStyle = Color.shared.setValue(color).toHex();
      context2.fillRect(0, 0, outWidth, outHeight);
      context2.globalCompositeOperation = "destination-atop";
      const source2 = canvasUtils.getCanvasSource(texture);
      if (!source2) {
        context2.restore();
        return;
      }
      if (rotate) {
        canvasUtils._applyInverseRotation(context2, rotate, crop.width, crop.height);
      }
      context2.drawImage(
        source2,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      context2.restore();
    },
    tintWithPerPixel: (texture, color, canvas) => {
      const context2 = canvas.getContext("2d");
      const crop = texture.frame.clone();
      const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
      const rotate = texture.rotate;
      crop.x *= resolution;
      crop.y *= resolution;
      crop.width *= resolution;
      crop.height *= resolution;
      const isVertical = groupD8.isVertical(rotate);
      const outWidth = isVertical ? crop.height : crop.width;
      const outHeight = isVertical ? crop.width : crop.height;
      canvas.width = Math.ceil(outWidth);
      canvas.height = Math.ceil(outHeight);
      context2.save();
      context2.globalCompositeOperation = "copy";
      const source2 = canvasUtils.getCanvasSource(texture);
      if (!source2) {
        context2.restore();
        return;
      }
      if (rotate) {
        canvasUtils._applyInverseRotation(context2, rotate, crop.width, crop.height);
      }
      context2.drawImage(
        source2,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      context2.restore();
      const r2 = color >> 16 & 255;
      const g2 = color >> 8 & 255;
      const b2 = color & 255;
      const imageData = context2.getImageData(0, 0, outWidth, outHeight);
      const data = imageData.data;
      for (let i2 = 0; i2 < data.length; i2 += 4) {
        data[i2] = data[i2] * r2 / 255;
        data[i2 + 1] = data[i2 + 1] * g2 / 255;
        data[i2 + 2] = data[i2 + 2] * b2 / 255;
      }
      context2.putImageData(imageData, 0, 0);
    },

    _applyInverseRotation: (context2, rotate, srcWidth, srcHeight) => {
      const inv = groupD8.inv(rotate);
      const a2 = groupD8.uX(inv);
      const b2 = groupD8.uY(inv);
      const c2 = groupD8.vX(inv);
      const d2 = groupD8.vY(inv);
      const tx = -Math.min(0, a2 * srcWidth, c2 * srcHeight, a2 * srcWidth + c2 * srcHeight);
      const ty = -Math.min(0, b2 * srcWidth, d2 * srcHeight, b2 * srcWidth + d2 * srcHeight);
      context2.transform(a2, b2, c2, d2, tx, ty);
    }
  };
  canvasUtils.tintMethod = canvasUtils.canUseMultiply ? canvasUtils.tintWithMultiply : canvasUtils.tintWithPerPixel;
  class CanvasPoolClass {
    constructor(canvasOptions) {
      this._canvasPool =                 Object.create(null);
      this.canvasOptions = canvasOptions || {};
      this.enableFullScreen = false;
    }

    _createCanvasAndContext(pixelWidth, pixelHeight) {
      const canvas = DOMAdapter.get().createCanvas();
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const context2 = canvas.getContext("2d");
      return { canvas, context: context2 };
    }

    getOptimalCanvasAndContext(minWidth, minHeight, resolution = 1) {
      minWidth = Math.ceil(minWidth * resolution - 1e-6);
      minHeight = Math.ceil(minHeight * resolution - 1e-6);
      minWidth = nextPow2(minWidth);
      minHeight = nextPow2(minHeight);
      const key = (minWidth << 17) + (minHeight << 1);
      if (!this._canvasPool[key]) {
        this._canvasPool[key] = [];
      }
      let canvasAndContext = this._canvasPool[key].pop();
      if (!canvasAndContext) {
        canvasAndContext = this._createCanvasAndContext(minWidth, minHeight);
      }
      return canvasAndContext;
    }

    returnCanvasAndContext(canvasAndContext) {
      const canvas = canvasAndContext.canvas;
      const { width, height } = canvas;
      const key = (width << 17) + (height << 1);
      canvasAndContext.context.resetTransform();
      canvasAndContext.context.clearRect(0, 0, width, height);
      this._canvasPool[key].push(canvasAndContext);
    }
    clear() {
      this._canvasPool = {};
    }
  }
  const CanvasPool = new CanvasPoolClass();
  GlobalResourceRegistry.register(CanvasPool);
  const tempProjectionMatrix = new Matrix();
  function getGlobalRenderableBounds(renderables, bounds) {
    bounds.clear();
    const actualMatrix = bounds.matrix;
    for (let i2 = 0; i2 < renderables.length; i2++) {
      const renderable = renderables[i2];
      if (renderable.globalDisplayStatus < 7) {
        continue;
      }
      const renderGroup = renderable.renderGroup ?? renderable.parentRenderGroup;
      if (renderGroup?.isCachedAsTexture) {
        bounds.matrix = tempProjectionMatrix.copyFrom(renderGroup.textureOffsetInverseTransform).append(renderable.worldTransform);
      } else if (renderGroup?._parentCacheAsTextureRenderGroup) {
        bounds.matrix = tempProjectionMatrix.copyFrom(renderGroup._parentCacheAsTextureRenderGroup.inverseWorldTransform).append(renderable.groupTransform);
      } else {
        bounds.matrix = renderable.worldTransform;
      }
      bounds.addBounds(renderable.bounds);
    }
    bounds.matrix = actualMatrix;
    return bounds;
  }
  const tempBounds$2 = new Bounds();
  function getPo2TextureFromSource(image, width, height, resolution, autoGenerateMipmaps = false) {
    const bounds = tempBounds$2;
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = image.width / resolution | 0;
    bounds.maxY = image.height / resolution | 0;
    const texture = TexturePool.getOptimalTexture(
      bounds.width,
      bounds.height,
      resolution,
      false,
      autoGenerateMipmaps
    );
    texture.source.uploadMethodId = "image";
    texture.source.resource = image;
    texture.source.alphaMode = "premultiply-alpha-on-upload";
    texture.frame.width = width / resolution;
    texture.frame.height = height / resolution;
    texture.source.emit("update", texture.source);
    texture.updateUvs();
    return texture;
  }
  function isCanvasFilterCapable(filter) {
    return typeof filter.getCanvasFilterString === "function";
  }
  class CanvasFilterFrame {
    constructor() {
      this.skip = false;
      this.useClip = false;
      this.filters = null;
      this.container = null;
      this.bounds = new Bounds();
      this.cssFilterString = "";
    }
  }
  class CanvasFilterSystem {

    constructor(renderer) {
      this._filterStack = [];
      this._filterStackIndex = 0;
      this._savedStates = [];
      this._alphaMultiplier = 1;
      this._warnedFilterTypes =                 new Set();
      this.renderer = renderer;
    }

    push(instruction) {
      const filterFrame = this._pushFilterFrame();
      const filters = instruction.filterEffect.filters;
      filterFrame.skip = false;
      filterFrame.useClip = false;
      filterFrame.filters = filters;
      filterFrame.container = instruction.container;
      filterFrame.cssFilterString = "";
      if (filters.every((filter) => !filter.enabled)) {
        filterFrame.skip = true;
        return;
      }
      const cssFilters = [];
      const alphaMultiplier = 1;
      for (const filter of filters) {
        if (!filter.enabled) continue;
        if (!isCanvasFilterCapable(filter)) {
          this._warnUnsupportedFilter(filter);
          continue;
        }
        const cssString = filter.getCanvasFilterString();
        if (cssString === null) {
          this._warnUnsupportedFilter(filter);
          continue;
        }
        if (cssString) {
          cssFilters.push(cssString);
        }
      }
      if (cssFilters.length === 0 && alphaMultiplier === 1) {
        filterFrame.skip = true;
        return;
      }
      filterFrame.cssFilterString = cssFilters.join(" ");
      this._calculateFilterArea(instruction, filterFrame.bounds);
      filterFrame.useClip = !!instruction.filterEffect.filterArea;
      const context2 = this.renderer.canvasContext.activeContext;
      const previousFilter = context2.filter || "none";
      this._savedStates.push({ filter: previousFilter, alphaMultiplier: this._alphaMultiplier });
      if (filterFrame.useClip && Number.isFinite(filterFrame.bounds.width) && Number.isFinite(filterFrame.bounds.height) && filterFrame.bounds.width > 0 && filterFrame.bounds.height > 0) {
        const resolution = this.renderer.canvasContext.activeResolution || 1;
        context2.save();
        context2.setTransform(1, 0, 0, 1, 0, 0);
        context2.beginPath();
        context2.rect(
          filterFrame.bounds.x * resolution,
          filterFrame.bounds.y * resolution,
          filterFrame.bounds.width * resolution,
          filterFrame.bounds.height * resolution
        );
        context2.clip();
      } else {
        filterFrame.useClip = false;
      }
      if (filterFrame.cssFilterString) {
        context2.filter = previousFilter !== "none" ? `${previousFilter} ${filterFrame.cssFilterString}` : filterFrame.cssFilterString;
      }
    }

    pop() {
      const filterFrame = this._popFilterFrame();
      if (filterFrame.skip) {
        return;
      }
      const savedState = this._savedStates.pop();
      if (!savedState) {
        return;
      }
      const context2 = this.renderer.canvasContext.activeContext;
      if (filterFrame.useClip) {
        context2.restore();
      } else {
        context2.filter = savedState.filter;
      }
      this._alphaMultiplier = savedState.alphaMultiplier;
    }

    generateFilteredTexture({ texture, filters }) {
      if (!filters?.length || filters.every((filter) => !filter.enabled)) {
        return texture;
      }
      const cssFilters = [];
      const alphaMultiplier = 1;
      for (const filter of filters) {
        if (!filter.enabled) continue;
        if (!isCanvasFilterCapable(filter)) {
          this._warnUnsupportedFilter(filter);
          continue;
        }
        const cssString = filter.getCanvasFilterString();
        if (cssString === null) {
          this._warnUnsupportedFilter(filter);
          continue;
        }
        if (cssString) {
          cssFilters.push(cssString);
        }
      }
      if (cssFilters.length === 0 && alphaMultiplier === 1) {
        return texture;
      }
      const source2 = canvasUtils.getCanvasSource(texture);
      if (!source2) {
        return texture;
      }
      const frame = texture.frame;
      const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
      const width = frame.width;
      const height = frame.height;
      const canvasAndContext = CanvasPool.getOptimalCanvasAndContext(width, height, resolution);
      const { canvas, context: context2 } = canvasAndContext;
      context2.setTransform(1, 0, 0, 1, 0, 0);
      context2.clearRect(0, 0, canvas.width, canvas.height);
      if (cssFilters.length) {
        context2.filter = cssFilters.join(" ");
      }
      const sx = frame.x * resolution;
      const sy = frame.y * resolution;
      const sw = width * resolution;
      const sh = height * resolution;
      context2.drawImage(
        source2,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        sw,
        sh
      );
      context2.filter = "none";
      context2.globalAlpha = 1;
      return getPo2TextureFromSource(canvas, width, height, resolution);
    }

    _calculateFilterArea(instruction, bounds) {
      if (instruction.renderables) {
        getGlobalRenderableBounds(instruction.renderables, bounds);
      } else if (instruction.filterEffect.filterArea) {
        bounds.clear();
        bounds.addRect(instruction.filterEffect.filterArea);
        bounds.applyMatrix(instruction.container.worldTransform);
      } else {
        instruction.container.getFastGlobalBounds(true, bounds);
      }
      if (instruction.container) {
        const renderGroup = instruction.container.renderGroup || instruction.container.parentRenderGroup;
        const filterFrameTransform = renderGroup?.cacheToLocalTransform;
        if (filterFrameTransform) {
          bounds.applyMatrix(filterFrameTransform);
        }
      }
    }
    _warnUnsupportedFilter(filter) {
      const filterName = filter?.constructor?.name || "Filter";
      if (this._warnedFilterTypes.has(filterName)) {
        return;
      }
      this._warnedFilterTypes.add(filterName);
      console.warn(
        `CanvasRenderer: filter "${filterName}" is not supported in Canvas2D and will be skipped.`
      );
    }
    get alphaMultiplier() {
      return this._alphaMultiplier;
    }
    _pushFilterFrame() {
      let filterFrame = this._filterStack[this._filterStackIndex];
      if (!filterFrame) {
        filterFrame = this._filterStack[this._filterStackIndex] = new CanvasFilterFrame();
      }
      this._filterStackIndex++;
      return filterFrame;
    }
    _popFilterFrame() {
      if (this._filterStackIndex <= 0) {
        return this._filterStack[0];
      }
      this._filterStackIndex--;
      return this._filterStack[this._filterStackIndex];
    }

    destroy() {
      this._filterStack = null;
      this._savedStates = null;
      this._warnedFilterTypes = null;
      this._alphaMultiplier = 1;
    }
  }
  CanvasFilterSystem.extension = {
    type: [ExtensionType.CanvasSystem],
    name: "filter"
  };
  var vertex$1 = "in vec2 aPosition;\nout vec2 vTextureCoord;\n\nuniform vec4 uInputSize;\nuniform vec4 uOutputFrame;\nuniform vec4 uOutputTexture;\n\nvec4 filterVertexPosition( void )\n{\n    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;\n    \n    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;\n\n    return vec4(position, 0.0, 1.0);\n}\n\nvec2 filterTextureCoord( void )\n{\n    return aPosition * (uOutputFrame.zw * uInputSize.zw);\n}\n\nvoid main(void)\n{\n    gl_Position = filterVertexPosition();\n    vTextureCoord = filterTextureCoord();\n}\n";
  const GAUSSIAN_VALUES = {
    5: [0.153388, 0.221461, 0.250301],
    7: [0.071303, 0.131514, 0.189879, 0.214607],
    9: [0.028532, 0.067234, 0.124009, 0.179044, 0.20236],
    11: [93e-4, 0.028002, 0.065984, 0.121703, 0.175713, 0.198596],
    13: [2406e-6, 9255e-6, 0.027867, 0.065666, 0.121117, 0.174868, 0.197641],
    15: [489e-6, 2403e-6, 9246e-6, 0.02784, 0.065602, 0.120999, 0.174697, 0.197448]
  };
  const fragTemplate = [
    "in vec2 vBlurTexCoords[%size%];",
    "uniform sampler2D uTexture;",
    "out vec4 finalColor;",
    "void main(void)",
    "{",
    "    %blur%",
    "}"
  ].join("\n");
  function generateBlurFragSource(kernelSize) {
    const kernel = GAUSSIAN_VALUES[kernelSize];
    const halfLength = kernel.length;
    let blurLoop = "";
    const prefixFirst = "finalColor = ";
    const prefixRest = "    + ";
    const template = "texture(uTexture, vBlurTexCoords[%index%]) * %value%";
    for (let i2 = 0; i2 < kernelSize; i2++) {
      const prefix = i2 === 0 ? prefixFirst : prefixRest;
      const value = i2 < halfLength ? i2 : kernelSize - i2 - 1;
      const blur = template.replace("%index%", i2.toString()).replace("%value%", kernel[value].toString());
      blurLoop += `${prefix}${blur}
`;
    }
    return fragTemplate.replace("%blur%", `${blurLoop};`).replace("%size%", kernelSize.toString());
  }
  const vertTemplate = `
    in vec2 aPosition;

    uniform float uStrength;

    out vec2 vBlurTexCoords[%size%];

    uniform vec4 uInputSize;
    uniform vec4 uOutputFrame;
    uniform vec4 uOutputTexture;

    vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

    vec2 filterTextureCoord( void )
    {
        return aPosition * (uOutputFrame.zw * uInputSize.zw);
    }

    void main(void)
    {
        gl_Position = filterVertexPosition();

        float pixelStrength = uInputSize.%dimension% * uStrength;

        vec2 textureCoord = filterTextureCoord();
        %blur%
    }`;
  function generateBlurVertSource(kernelSize, x2) {
    const halfLength = Math.ceil(kernelSize / 2);
    let vertSource = vertTemplate;
    let blurLoop = "";
    let template;
    if (x2) {
      template = "vBlurTexCoords[%index%] =  textureCoord + vec2(%sampleIndex% * pixelStrength, 0.0);";
    } else {
      template = "vBlurTexCoords[%index%] =  textureCoord + vec2(0.0, %sampleIndex% * pixelStrength);";
    }
    for (let i2 = 0; i2 < kernelSize; i2++) {
      let blur = template.replace("%index%", i2.toString());
      blur = blur.replace("%sampleIndex%", `${i2 - (halfLength - 1)}.0`);
      blurLoop += blur;
      blurLoop += "\n";
    }
    vertSource = vertSource.replace("%blur%", blurLoop);
    vertSource = vertSource.replace("%size%", kernelSize.toString());
    vertSource = vertSource.replace("%dimension%", x2 ? "z" : "w");
    return vertSource;
  }
  function generateBlurGlProgram(horizontal, kernelSize) {
    const vertex2 = generateBlurVertSource(kernelSize, horizontal);
    const fragment2 = generateBlurFragSource(kernelSize);
    return GlProgram.from({
      vertex: vertex2,
      fragment: fragment2,
      name: `blur-${horizontal ? "horizontal" : "vertical"}-pass-filter`
    });
  }
  var source$2 = "\n\nstruct GlobalFilterUniforms {\n  uInputSize:vec4<f32>,\n  uInputPixel:vec4<f32>,\n  uInputClamp:vec4<f32>,\n  uOutputFrame:vec4<f32>,\n  uGlobalFrame:vec4<f32>,\n  uOutputTexture:vec4<f32>,\n};\n\nstruct BlurUniforms {\n  uStrength:f32,\n};\n\n@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;\n@group(0) @binding(1) var uTexture: texture_2d<f32>;\n@group(0) @binding(2) var uSampler : sampler;\n\n@group(1) @binding(0) var<uniform> blurUniforms : BlurUniforms;\n\n\nstruct VSOutput {\n    @builtin(position) position: vec4<f32>,\n    %blur-struct%\n  };\n\nfn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>\n{\n    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;\n\n    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;\n\n    return vec4(position, 0.0, 1.0);\n}\n\nfn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>\n{\n    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);\n}\n\nfn globalTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>\n{\n  return  (aPosition.xy / gfu.uGlobalFrame.zw) + (gfu.uGlobalFrame.xy / gfu.uGlobalFrame.zw);\n}\n\nfn getSize() -> vec2<f32>\n{\n  return gfu.uGlobalFrame.zw;\n}\n\n\n@vertex\nfn mainVertex(\n  @location(0) aPosition : vec2<f32>,\n) -> VSOutput {\n\n  let filteredCord = filterTextureCoord(aPosition);\n\n  let pixelStrength = gfu.uInputSize.%dimension% * blurUniforms.uStrength;\n\n  return VSOutput(\n   filterVertexPosition(aPosition),\n    %blur-vertex-out%\n  );\n}\n\n@fragment\nfn mainFragment(\n  @builtin(position) position: vec4<f32>,\n  %blur-fragment-in%\n) -> @location(0) vec4<f32> {\n\n    var   finalColor = vec4(0.0);\n\n    %blur-sampling%\n\n    return finalColor;\n}\n";
  function generateBlurProgram(horizontal, kernelSize) {
    const kernel = GAUSSIAN_VALUES[kernelSize];
    const halfLength = kernel.length;
    const blurStructSource = [];
    const blurOutSource = [];
    const blurSamplingSource = [];
    for (let i2 = 0; i2 < kernelSize; i2++) {
      blurStructSource[i2] = `@location(${i2}) offset${i2}: vec2<f32>,`;
      if (horizontal) {
        blurOutSource[i2] = `filteredCord + vec2(${i2 - halfLength + 1} * pixelStrength, 0.0),`;
      } else {
        blurOutSource[i2] = `filteredCord + vec2(0.0, ${i2 - halfLength + 1} * pixelStrength),`;
      }
      const kernelIndex = i2 < halfLength ? i2 : kernelSize - i2 - 1;
      const kernelValue = kernel[kernelIndex].toString();
      blurSamplingSource[i2] = `finalColor += textureSample(uTexture, uSampler, offset${i2}) * ${kernelValue};`;
    }
    const blurStruct = blurStructSource.join("\n");
    const blurOut = blurOutSource.join("\n");
    const blurSampling = blurSamplingSource.join("\n");
    const finalSource = source$2.replace("%blur-struct%", blurStruct).replace("%blur-vertex-out%", blurOut).replace("%blur-fragment-in%", blurStruct).replace("%blur-sampling%", blurSampling).replace("%dimension%", horizontal ? "z" : "w");
    return GpuProgram.from({
      vertex: {
        source: finalSource,
        entryPoint: "mainVertex"
      },
      fragment: {
        source: finalSource,
        entryPoint: "mainFragment"
      }
    });
  }
  const _BlurFilterPass = class _BlurFilterPass2 extends Filter {

    constructor(options) {
      options = { ..._BlurFilterPass2.defaultOptions, ...options };
      const glProgram = generateBlurGlProgram(options.horizontal, options.kernelSize);
      const gpuProgram = generateBlurProgram(options.horizontal, options.kernelSize);
      super({
        glProgram,
        gpuProgram,
        resources: {
          blurUniforms: {
            uStrength: { value: 0, type: "f32" }
          }
        },
        ...options
      });
      this.horizontal = options.horizontal;
      this.legacy = options.legacy ?? false;
      this._quality = 0;
      this.quality = options.quality;
      this.blur = options.strength;
      this._blurUniforms = this.resources.blurUniforms;
      this._uniforms = this._blurUniforms.uniforms;
    }

    apply(filterManager, input, output, clearMode) {
      if (this.legacy) {
        this._applyLegacy(filterManager, input, output, clearMode);
      } else {
        this._applyOptimized(filterManager, input, output, clearMode);
      }
    }
    _applyLegacy(filterManager, input, output, clearMode) {
      this._uniforms.uStrength = this.strength / this.passes;
      if (this.passes === 1) {
        filterManager.applyFilter(this, input, output, clearMode);
      } else {
        const tempTexture = TexturePool.getSameSizeTexture(input);
        let flip = input;
        let flop = tempTexture;
        this._state.blend = false;
        const shouldClear = filterManager.renderer.type === RendererType.WEBGPU;
        for (let i2 = 0; i2 < this.passes - 1; i2++) {
          filterManager.applyFilter(this, flip, flop, i2 === 0 ? true : shouldClear);
          const temp = flop;
          flop = flip;
          flip = temp;
        }
        this._state.blend = true;
        filterManager.applyFilter(this, flip, output, clearMode);
        TexturePool.returnTexture(tempTexture);
      }
    }
    _applyOptimized(filterManager, input, output, clearMode) {
      this._uniforms.uStrength = this._calculateInitialStrength();
      if (this.passes === 1) {
        filterManager.applyFilter(this, input, output, clearMode);
      } else {
        const tempTexture = TexturePool.getSameSizeTexture(input);
        let flip = input;
        let flop = tempTexture;
        this._state.blend = false;
        const renderer = filterManager.renderer;
        const isWebGPU = renderer.type === RendererType.WEBGPU;
        const uboBatcher = isWebGPU ? renderer.renderPipes.uniformBatch : null;
        for (let i2 = 0; i2 < this.passes - 1; i2++) {
          if (uboBatcher) {
            this.groups[1].setResource(uboBatcher.getUboResource(this._blurUniforms), 0);
          }
          filterManager.applyFilter(this, flip, flop, isWebGPU);
          const temp = flop;
          flop = flip;
          flip = temp;
          this._uniforms.uStrength *= 0.5;
        }
        if (uboBatcher) {
          this.groups[1].setResource(uboBatcher.getUboResource(this._blurUniforms), 0);
        }
        this._state.blend = true;
        filterManager.applyFilter(this, flip, output, clearMode);
        TexturePool.returnTexture(tempTexture);
      }
    }

    _calculateInitialStrength() {
      let sumOfSquares = 1;
      let coefficient = 0.5;
      for (let i2 = 1; i2 < this.passes; i2++) {
        sumOfSquares += coefficient * coefficient;
        coefficient *= 0.5;
      }
      return this.strength / Math.sqrt(sumOfSquares);
    }

    get blur() {
      return this.strength;
    }
    set blur(value) {
      this.padding = 1 + Math.abs(value) * 2;
      this.strength = value;
    }

    get quality() {
      return this._quality;
    }
    set quality(value) {
      this._quality = value;
      this.passes = value;
    }
  };
  _BlurFilterPass.defaultOptions = {

    strength: 8,

    quality: 4,

    kernelSize: 5,

    legacy: false
  };
  let BlurFilterPass = _BlurFilterPass;
  class BlurFilter extends Filter {
    constructor(...args) {
      let options = args[0] ?? {};
      if (typeof options === "number") {
        deprecation(v8_0_0, "BlurFilter constructor params are now options object. See params: { strength, quality, resolution, kernelSize }");
        options = { strength: options };
        if (args[1] !== void 0) options.quality = args[1];
        if (args[2] !== void 0) options.resolution = args[2] || "inherit";
        if (args[3] !== void 0) options.kernelSize = args[3];
      }
      options = { ...BlurFilterPass.defaultOptions, ...options };
      const { strength, strengthX, strengthY, quality, ...rest } = options;
      super({
        ...rest,
        compatibleRenderers: RendererType.BOTH,
        resources: {}
      });
      this._repeatEdgePixels = false;
      this.blurXFilter = new BlurFilterPass({ horizontal: true, ...options });
      this.blurYFilter = new BlurFilterPass({ horizontal: false, ...options });
      this.quality = quality;
      this.strengthX = strengthX ?? strength;
      this.strengthY = strengthY ?? strength;
      this.repeatEdgePixels = false;
    }

    apply(filterManager, input, output, clearMode) {
      const xStrength = Math.abs(this.blurXFilter.strength);
      const yStrength = Math.abs(this.blurYFilter.strength);
      if (xStrength && yStrength) {
        const tempTexture = TexturePool.getSameSizeTexture(input);
        this.blurXFilter.blendMode = "normal";
        this.blurXFilter.apply(filterManager, input, tempTexture, true);
        this.blurYFilter.blendMode = this.blendMode;
        this.blurYFilter.apply(filterManager, tempTexture, output, clearMode);
        TexturePool.returnTexture(tempTexture);
      } else if (yStrength) {
        this.blurYFilter.blendMode = this.blendMode;
        this.blurYFilter.apply(filterManager, input, output, clearMode);
      } else {
        this.blurXFilter.blendMode = this.blendMode;
        this.blurXFilter.apply(filterManager, input, output, clearMode);
      }
    }
    updatePadding() {
      if (this._repeatEdgePixels) {
        this.padding = 0;
      } else {
        this.padding = Math.max(Math.abs(this.blurXFilter.blur), Math.abs(this.blurYFilter.blur)) * 2;
      }
    }

    get strength() {
      if (this.strengthX !== this.strengthY) {
        throw new Error("BlurFilter's strengthX and strengthY are different");
      }
      return this.strengthX;
    }
    set strength(value) {
      this.blurXFilter.blur = this.blurYFilter.blur = value;
      this.updatePadding();
    }

    get quality() {
      return this.blurXFilter.quality;
    }
    set quality(value) {
      this.blurXFilter.quality = this.blurYFilter.quality = value;
    }

    get strengthX() {
      return this.blurXFilter.blur;
    }
    set strengthX(value) {
      this.blurXFilter.blur = value;
      this.updatePadding();
    }

    get strengthY() {
      return this.blurYFilter.blur;
    }
    set strengthY(value) {
      this.blurYFilter.blur = value;
      this.updatePadding();
    }

    get blur() {
      deprecation("8.3.0", "BlurFilter.blur is deprecated, please use BlurFilter.strength instead.");
      return this.strength;
    }
    set blur(value) {
      deprecation("8.3.0", "BlurFilter.blur is deprecated, please use BlurFilter.strength instead.");
      this.strength = value;
    }

    get blurX() {
      deprecation("8.3.0", "BlurFilter.blurX is deprecated, please use BlurFilter.strengthX instead.");
      return this.strengthX;
    }
    set blurX(value) {
      deprecation("8.3.0", "BlurFilter.blurX is deprecated, please use BlurFilter.strengthX instead.");
      this.strengthX = value;
    }

    get blurY() {
      deprecation("8.3.0", "BlurFilter.blurY is deprecated, please use BlurFilter.strengthY instead.");
      return this.strengthY;
    }
    set blurY(value) {
      deprecation("8.3.0", "BlurFilter.blurY is deprecated, please use BlurFilter.strengthY instead.");
      this.strengthY = value;
    }

    get repeatEdgePixels() {
      return this._repeatEdgePixels;
    }
    set repeatEdgePixels(value) {
      this._repeatEdgePixels = value;
      this.updatePadding();
    }
  }
  BlurFilter.defaultOptions = {

    strength: 8,

    quality: 4,

    kernelSize: 5,

    legacy: false
  };
  var fragment$1 = "in vec2 vTextureCoord;\nout vec4 finalColor;\nuniform sampler2D uTexture;\nvoid main() {\n    finalColor = texture(uTexture, vTextureCoord);\n}\n";
  var source$1 = "struct GlobalFilterUniforms {\n  uInputSize: vec4<f32>,\n  uInputPixel: vec4<f32>,\n  uInputClamp: vec4<f32>,\n  uOutputFrame: vec4<f32>,\n  uGlobalFrame: vec4<f32>,\n  uOutputTexture: vec4<f32>,\n};\n\n@group(0) @binding(0) var <uniform> gfu: GlobalFilterUniforms;\n@group(0) @binding(1) var uTexture: texture_2d<f32>;\n@group(0) @binding(2) var uSampler: sampler;\n\nstruct VSOutput {\n  @builtin(position) position: vec4<f32>,\n  @location(0) uv: vec2<f32>\n};\n\nfn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32>\n{\n    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;\n\n    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;\n\n    return vec4(position, 0.0, 1.0);\n}\n\nfn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32>\n{\n    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);\n}\n\n@vertex\nfn mainVertex(\n  @location(0) aPosition: vec2<f32>,\n) -> VSOutput {\n  return VSOutput(\n   filterVertexPosition(aPosition),\n   filterTextureCoord(aPosition)\n  );\n}\n\n@fragment\nfn mainFragment(\n  @location(0) uv: vec2<f32>,\n) -> @location(0) vec4<f32> {\n    return textureSample(uTexture, uSampler, uv);\n}\n";
  class PassthroughFilter extends Filter {
    constructor() {
      const gpuProgram = GpuProgram.from({
        vertex: { source: source$1, entryPoint: "mainVertex" },
        fragment: { source: source$1, entryPoint: "mainFragment" },
        name: "passthrough-filter"
      });
      const glProgram = GlProgram.from({
        vertex: vertex$1,
        fragment: fragment$1,
        name: "passthrough-filter"
      });
      super({
        gpuProgram,
        glProgram
      });
    }
  }
  class FilterPipe {
    constructor(renderer) {
      this._renderer = renderer;
    }
    push(filterEffect, container, instructionSet) {
      const renderPipes2 = this._renderer.renderPipes;
      renderPipes2.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "filter",
        canBundle: false,
        action: "pushFilter",
        container,
        filterEffect
      });
    }
    pop(_filterEffect, _container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "filter",
        action: "popFilter",
        canBundle: false
      });
    }
    execute(instruction) {
      if (instruction.action === "pushFilter") {
        this._renderer.filter.push(instruction);
      } else if (instruction.action === "popFilter") {
        this._renderer.filter.pop();
      }
    }
    destroy() {
      this._renderer = null;
    }
  }
  FilterPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "filter"
  };
  const quadGeometry = new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0
      }
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3])
  });
  class FilterData {
    constructor() {
      this.skip = false;
      this.inputTexture = null;
      this.backTexture = null;
      this.filters = null;
      this.bounds = new Bounds();
      this.container = null;
      this.blendRequired = false;
      this.outputRenderSurface = null;
      this.globalFrame = { x: 0, y: 0, width: 0, height: 0 };
      this.firstEnabledIndex = -1;
      this.lastEnabledIndex = -1;
    }
  }
  class FilterSystem {
    constructor(renderer) {
      this._filterStackIndex = 0;
      this._filterStack = [];
      this._filterGlobalUniforms = new UniformGroup({
        uInputSize: { value: new Float32Array(4), type: "vec4<f32>" },
        uInputPixel: { value: new Float32Array(4), type: "vec4<f32>" },
        uInputClamp: { value: new Float32Array(4), type: "vec4<f32>" },
        uOutputFrame: { value: new Float32Array(4), type: "vec4<f32>" },
        uGlobalFrame: { value: new Float32Array(4), type: "vec4<f32>" },
        uOutputTexture: { value: new Float32Array(4), type: "vec4<f32>" }
      });
      this._globalFilterBindGroup = new BindGroup({});
      this.renderer = renderer;
    }

    get activeBackTexture() {
      return this._activeFilterData?.backTexture;
    }

    push(instruction) {
      const renderer = this.renderer;
      const filters = instruction.filterEffect.filters;
      const filterData = this._pushFilterData();
      filterData.skip = false;
      filterData.filters = filters;
      filterData.container = instruction.container;
      filterData.outputRenderSurface = renderer.renderTarget.renderSurface;
      const colorTextureSource = renderer.renderTarget.renderTarget.colorTexture.source;
      const rootResolution = colorTextureSource.resolution;
      const rootAntialias = colorTextureSource.antialias;
      if (filters.every((filter) => !filter.enabled)) {
        filterData.skip = true;
        return;
      }
      const bounds = filterData.bounds;
      this._calculateFilterArea(instruction, bounds);
      this._calculateFilterBounds(filterData, renderer.renderTarget.rootViewPort, rootAntialias, rootResolution, 1);
      if (filterData.skip) {
        return;
      }
      const previousFilterData = this._getPreviousFilterData();
      const globalResolution = this._findFilterResolution(rootResolution);
      let offsetX = 0;
      let offsetY = 0;
      if (previousFilterData) {
        offsetX = previousFilterData.bounds.minX;
        offsetY = previousFilterData.bounds.minY;
      }
      this._calculateGlobalFrame(
        filterData,
        offsetX,
        offsetY,
        globalResolution,
        colorTextureSource.width,
        colorTextureSource.height
      );
      this._setupFilterTextures(filterData, bounds, renderer, previousFilterData);
    }

    generateFilteredTexture({ texture, filters }) {
      const filterData = this._pushFilterData();
      this._activeFilterData = filterData;
      filterData.skip = false;
      filterData.filters = filters;
      const colorTextureSource = texture.source;
      const rootResolution = colorTextureSource.resolution;
      const rootAntialias = colorTextureSource.antialias;
      if (filters.every((filter) => !filter.enabled)) {
        filterData.skip = true;
        return texture;
      }
      const bounds = filterData.bounds;
      bounds.addRect(texture.frame);
      this._calculateFilterBounds(filterData, bounds.rectangle, rootAntialias, rootResolution, 0);
      if (filterData.skip) {
        return texture;
      }
      const globalResolution = rootResolution;
      const offsetX = 0;
      const offsetY = 0;
      this._calculateGlobalFrame(
        filterData,
        offsetX,
        offsetY,
        globalResolution,
        colorTextureSource.width,
        colorTextureSource.height
      );
      filterData.outputRenderSurface = TexturePool.getOptimalTexture(
        bounds.width,
        bounds.height,
        filterData.resolution,
        filterData.antialias
      );
      filterData.backTexture = Texture.EMPTY;
      filterData.inputTexture = texture;
      const renderer = this.renderer;
      renderer.renderTarget.finishRenderPass();
      this._applyFiltersToTexture(filterData, true);
      const outputTexture = filterData.outputRenderSurface;
      outputTexture.source.alphaMode = "premultiplied-alpha";
      return outputTexture;
    }

    pop() {
      const renderer = this.renderer;
      const filterData = this._popFilterData();
      if (filterData.skip) {
        return;
      }
      renderer.globalUniforms.pop();
      renderer.renderTarget.finishRenderPass();
      this._activeFilterData = filterData;
      this._applyFiltersToTexture(filterData, false);
      if (filterData.blendRequired) {
        TexturePool.returnTexture(filterData.backTexture);
      }
      TexturePool.returnTexture(filterData.inputTexture);
    }

    getBackTexture(lastRenderSurface, bounds, previousBounds) {
      const backgroundResolution = lastRenderSurface.colorTexture.source._resolution;
      const backTexture = TexturePool.getOptimalTexture(
        bounds.width,
        bounds.height,
        backgroundResolution,
        false
      );
      let x2 = bounds.minX;
      let y2 = bounds.minY;
      if (previousBounds) {
        x2 -= previousBounds.minX;
        y2 -= previousBounds.minY;
      }
      x2 = Math.floor(x2 * backgroundResolution);
      y2 = Math.floor(y2 * backgroundResolution);
      const width = Math.ceil(bounds.width * backgroundResolution);
      const height = Math.ceil(bounds.height * backgroundResolution);
      this.renderer.renderTarget.copyToTexture(
        lastRenderSurface,
        backTexture,
        { x: x2, y: y2 },
        { width, height },
        { x: 0, y: 0 }
      );
      return backTexture;
    }

    applyFilter(filter, input, output, clear) {
      const renderer = this.renderer;
      const filterData = this._activeFilterData;
      const outputRenderSurface = filterData.outputRenderSurface;
      const isFinalTarget = outputRenderSurface === output;
      const rootResolution = renderer.renderTarget.rootRenderTarget.colorTexture.source._resolution;
      const resolution = this._findFilterResolution(rootResolution);
      let offsetX = 0;
      let offsetY = 0;
      if (isFinalTarget) {
        const offset2 = this._findPreviousFilterOffset();
        offsetX = offset2.x;
        offsetY = offset2.y;
      }
      this._updateFilterUniforms(input, output, filterData, offsetX, offsetY, resolution, isFinalTarget, clear);
      const filterToApply = filter.enabled ? filter : this._getPassthroughFilter();
      this._setupBindGroupsAndRender(filterToApply, input, renderer);
    }

    calculateSpriteMatrix(outputMatrix, sprite) {
      const data = this._activeFilterData;
      const mappedMatrix = outputMatrix.set(
        data.inputTexture._source.width,
        0,
        0,
        data.inputTexture._source.height,
        data.bounds.minX,
        data.bounds.minY
      );
      const worldTransform = sprite.worldTransform.copyTo(Matrix.shared);
      const renderGroup = sprite.renderGroup || sprite.parentRenderGroup;
      if (renderGroup && renderGroup.cacheToLocalTransform) {
        worldTransform.prepend(renderGroup.cacheToLocalTransform);
      }
      worldTransform.invert();
      mappedMatrix.prepend(worldTransform);
      mappedMatrix.scale(
        1 / sprite.texture.orig.width,
        1 / sprite.texture.orig.height
      );
      mappedMatrix.translate(sprite.anchor.x, sprite.anchor.y);
      return mappedMatrix;
    }
    destroy() {
      this._passthroughFilter?.destroy(true);
      this._passthroughFilter = null;
    }
    _getPassthroughFilter() {
      this._passthroughFilter ?? (this._passthroughFilter = new PassthroughFilter());
      return this._passthroughFilter;
    }

    _setupBindGroupsAndRender(filter, input, renderer) {
      if (renderer.renderPipes.uniformBatch) {
        const batchUniforms = renderer.renderPipes.uniformBatch.getUboResource(this._filterGlobalUniforms);
        this._globalFilterBindGroup.setResource(batchUniforms, 0);
      } else {
        this._globalFilterBindGroup.setResource(this._filterGlobalUniforms, 0);
      }
      this._globalFilterBindGroup.setResource(input.source, 1);
      this._globalFilterBindGroup.setResource(input.source.style, 2);
      filter.groups[0] = this._globalFilterBindGroup;
      renderer.encoder.draw({
        geometry: quadGeometry,
        shader: filter,
        state: filter._state,
        topology: "triangle-list"
      });
      if (renderer.type === RendererType.WEBGL) {
        renderer.renderTarget.finishRenderPass();
      }
    }

    _setupFilterTextures(filterData, bounds, renderer, previousFilterData) {
      filterData.backTexture = Texture.EMPTY;
      filterData.inputTexture = TexturePool.getOptimalTexture(
        bounds.width,
        bounds.height,
        filterData.resolution,
        filterData.antialias
      );
      if (filterData.blendRequired) {
        renderer.renderTarget.finishRenderPass();
        const renderTarget = renderer.renderTarget.getRenderTarget(filterData.outputRenderSurface);
        filterData.backTexture = this.getBackTexture(renderTarget, bounds, previousFilterData?.bounds);
      }
      renderer.renderTarget.bind(filterData.inputTexture, true);
      renderer.globalUniforms.push({
        offset: bounds
      });
    }

    _calculateGlobalFrame(filterData, offsetX, offsetY, globalResolution, sourceWidth, sourceHeight) {
      const globalFrame = filterData.globalFrame;
      globalFrame.x = offsetX * globalResolution;
      globalFrame.y = offsetY * globalResolution;
      globalFrame.width = sourceWidth * globalResolution;
      globalFrame.height = sourceHeight * globalResolution;
    }

    _updateFilterUniforms(input, output, filterData, offsetX, offsetY, resolution, isFinalTarget, clear) {
      const uniforms = this._filterGlobalUniforms.uniforms;
      const outputFrame = uniforms.uOutputFrame;
      const inputSize = uniforms.uInputSize;
      const inputPixel = uniforms.uInputPixel;
      const inputClamp = uniforms.uInputClamp;
      const globalFrame = uniforms.uGlobalFrame;
      const outputTexture = uniforms.uOutputTexture;
      if (isFinalTarget) {
        outputFrame[0] = filterData.bounds.minX - offsetX;
        outputFrame[1] = filterData.bounds.minY - offsetY;
      } else {
        outputFrame[0] = 0;
        outputFrame[1] = 0;
      }
      outputFrame[2] = input.frame.width;
      outputFrame[3] = input.frame.height;
      inputSize[0] = input.source.width;
      inputSize[1] = input.source.height;
      inputSize[2] = 1 / inputSize[0];
      inputSize[3] = 1 / inputSize[1];
      inputPixel[0] = input.source.pixelWidth;
      inputPixel[1] = input.source.pixelHeight;
      inputPixel[2] = 1 / inputPixel[0];
      inputPixel[3] = 1 / inputPixel[1];
      inputClamp[0] = 0.5 * inputPixel[2];
      inputClamp[1] = 0.5 * inputPixel[3];
      inputClamp[2] = input.frame.width * inputSize[2] - 0.5 * inputPixel[2];
      inputClamp[3] = input.frame.height * inputSize[3] - 0.5 * inputPixel[3];
      const rootTexture = this.renderer.renderTarget.rootRenderTarget.colorTexture;
      globalFrame[0] = offsetX * resolution;
      globalFrame[1] = offsetY * resolution;
      globalFrame[2] = rootTexture.source.width * resolution;
      globalFrame[3] = rootTexture.source.height * resolution;
      if (output instanceof Texture) output.source.resource = null;
      const renderTarget = this.renderer.renderTarget.getRenderTarget(output);
      this.renderer.renderTarget.bind(output, !!clear);
      if (output instanceof Texture) {
        outputTexture[0] = output.frame.width;
        outputTexture[1] = output.frame.height;
      } else {
        outputTexture[0] = renderTarget.width;
        outputTexture[1] = renderTarget.height;
      }
      outputTexture[2] = renderTarget.isRoot ? -1 : 1;
      this._filterGlobalUniforms.update();
    }

    _findFilterResolution(rootResolution) {
      let currentIndex = this._filterStackIndex - 1;
      while (currentIndex > 0 && this._filterStack[currentIndex].skip) {
        --currentIndex;
      }
      return currentIndex > 0 && this._filterStack[currentIndex].inputTexture ? this._filterStack[currentIndex].inputTexture.source._resolution : rootResolution;
    }

    _findPreviousFilterOffset() {
      let offsetX = 0;
      let offsetY = 0;
      let lastIndex = this._filterStackIndex;
      while (lastIndex > 0) {
        lastIndex--;
        const prevFilterData = this._filterStack[lastIndex];
        if (!prevFilterData.skip) {
          offsetX = prevFilterData.bounds.minX;
          offsetY = prevFilterData.bounds.minY;
          break;
        }
      }
      return { x: offsetX, y: offsetY };
    }

    _calculateFilterArea(instruction, bounds) {
      if (instruction.renderables) {
        getGlobalRenderableBounds(instruction.renderables, bounds);
      } else if (instruction.filterEffect.filterArea) {
        bounds.clear();
        bounds.addRect(instruction.filterEffect.filterArea);
        bounds.applyMatrix(instruction.container.worldTransform);
      } else {
        instruction.container.getFastGlobalBounds(true, bounds);
      }
      if (instruction.container) {
        const renderGroup = instruction.container.renderGroup || instruction.container.parentRenderGroup;
        const filterFrameTransform = renderGroup.cacheToLocalTransform;
        if (filterFrameTransform) {
          bounds.applyMatrix(filterFrameTransform);
        }
      }
    }
    _applyFiltersToTexture(filterData, clear) {
      const inputTexture = filterData.inputTexture;
      const bounds = filterData.bounds;
      const filters = filterData.filters;
      const firstEnabled = filterData.firstEnabledIndex;
      const lastEnabled = filterData.lastEnabledIndex;
      this._globalFilterBindGroup.setResource(inputTexture.source.style, 2);
      this._globalFilterBindGroup.setResource(filterData.backTexture.source, 3);
      if (firstEnabled === lastEnabled) {
        filters[firstEnabled].apply(this, inputTexture, filterData.outputRenderSurface, clear);
      } else {
        let flip = filterData.inputTexture;
        const tempTexture = TexturePool.getOptimalTexture(
          bounds.width,
          bounds.height,
          flip.source._resolution,
          false
        );
        let flop = tempTexture;
        for (let i2 = firstEnabled; i2 < lastEnabled; i2++) {
          const filter = filters[i2];
          if (!filter.enabled) continue;
          filter.apply(this, flip, flop, true);
          const t2 = flip;
          flip = flop;
          flop = t2;
        }
        filters[lastEnabled].apply(this, flip, filterData.outputRenderSurface, clear);
        TexturePool.returnTexture(tempTexture);
      }
    }
    _calculateFilterBounds(filterData, viewPort, rootAntialias, rootResolution, paddingMultiplier) {
      const renderer = this.renderer;
      const bounds = filterData.bounds;
      const filters = filterData.filters;
      let resolution = Infinity;
      let padding = 0;
      let antialias = true;
      let blendRequired = false;
      let enabled = false;
      let clipToViewport = true;
      let firstEnabledIndex = -1;
      let lastEnabledIndex = -1;
      for (let i2 = 0; i2 < filters.length; i2++) {
        const filter = filters[i2];
        if (!filter.enabled) continue;
        if (firstEnabledIndex === -1) firstEnabledIndex = i2;
        lastEnabledIndex = i2;
        resolution = Math.min(resolution, filter.resolution === "inherit" ? rootResolution : filter.resolution);
        padding += filter.padding;
        if (filter.antialias === "off") {
          antialias = false;
        } else if (filter.antialias === "inherit") {
          antialias && (antialias = rootAntialias);
        }
        if (!filter.clipToViewport) {
          clipToViewport = false;
        }
        const isCompatible = !!(filter.compatibleRenderers & renderer.type);
        if (!isCompatible) {
          enabled = false;
          break;
        }
        if (filter.blendRequired && !(renderer.backBuffer?.useBackBuffer ?? true)) {
          warn("Blend filter requires backBuffer on WebGL renderer to be enabled. Set `useBackBuffer: true` in the renderer options.");
          enabled = false;
          break;
        }
        enabled = true;
        blendRequired || (blendRequired = filter.blendRequired);
      }
      if (!enabled) {
        filterData.skip = true;
        return;
      }
      if (clipToViewport) {
        bounds.fitBounds(0, viewPort.width / rootResolution, 0, viewPort.height / rootResolution);
      }
      bounds.scale(resolution).ceil().scale(1 / resolution).pad((padding | 0) * paddingMultiplier);
      if (!bounds.isPositive) {
        filterData.skip = true;
        return;
      }
      filterData.antialias = antialias;
      filterData.resolution = resolution;
      filterData.blendRequired = blendRequired;
      filterData.firstEnabledIndex = firstEnabledIndex;
      filterData.lastEnabledIndex = lastEnabledIndex;
    }
    _popFilterData() {
      this._filterStackIndex--;
      return this._filterStack[this._filterStackIndex];
    }
    _getPreviousFilterData() {
      let previousFilterData;
      let index = this._filterStackIndex - 1;
      while (index > 0) {
        index--;
        previousFilterData = this._filterStack[index];
        if (!previousFilterData.skip) {
          break;
        }
      }
      return previousFilterData;
    }
    _pushFilterData() {
      let filterData = this._filterStack[this._filterStackIndex];
      if (!filterData) {
        filterData = this._filterStack[this._filterStackIndex] = new FilterData();
      }
      this._filterStackIndex++;
      return filterData;
    }
  }
  FilterSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem
    ],
    name: "filter"
  };
  var fragment = "in vec2 vMaskCoord;\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform sampler2D uMaskTexture;\n\nuniform float uAlpha;\nuniform vec4 uMaskClamp;\nuniform float uInverse;\nuniform float uChannel;\n\nout vec4 finalColor;\n\nvoid main(void)\n{\n    float clip = step(3.5,\n        step(uMaskClamp.x, vMaskCoord.x) +\n        step(uMaskClamp.y, vMaskCoord.y) +\n        step(vMaskCoord.x, uMaskClamp.z) +\n        step(vMaskCoord.y, uMaskClamp.w));\n\n    // TODO look into why this is needed\n    float npmAlpha = uAlpha;\n    vec4 original = texture(uTexture, vTextureCoord);\n    vec4 masky = texture(uMaskTexture, vMaskCoord);\n\n    float a;\n    if (uChannel == 1.0) {\n        a = masky.a * npmAlpha * clip;\n    } else {\n        float alphaMul = 1.0 - npmAlpha * (1.0 - masky.a);\n        a = alphaMul * masky.r * npmAlpha * clip;\n    }\n\n    if (uInverse == 1.0) {\n        a = 1.0 - a;\n    }\n\n    finalColor = original * a;\n}\n";
  var vertex = "in vec2 aPosition;\n\nout vec2 vTextureCoord;\nout vec2 vMaskCoord;\n\n\nuniform vec4 uInputSize;\nuniform vec4 uOutputFrame;\nuniform vec4 uOutputTexture;\nuniform mat3 uFilterMatrix;\n\nvec4 filterVertexPosition(  vec2 aPosition )\n{\n    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;\n       \n    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;\n\n    return vec4(position, 0.0, 1.0);\n}\n\nvec2 filterTextureCoord(  vec2 aPosition )\n{\n    return aPosition * (uOutputFrame.zw * uInputSize.zw);\n}\n\nvec2 getFilterCoord( vec2 aPosition )\n{\n    return  ( uFilterMatrix * vec3( filterTextureCoord(aPosition), 1.0)  ).xy;\n}   \n\nvoid main(void)\n{\n    gl_Position = filterVertexPosition(aPosition);\n    vTextureCoord = filterTextureCoord(aPosition);\n    vMaskCoord = getFilterCoord(aPosition);\n}\n";
  var source = "struct GlobalFilterUniforms {\n  uInputSize:vec4<f32>,\n  uInputPixel:vec4<f32>,\n  uInputClamp:vec4<f32>,\n  uOutputFrame:vec4<f32>,\n  uGlobalFrame:vec4<f32>,\n  uOutputTexture:vec4<f32>,\n};\n\nstruct MaskUniforms {\n  uFilterMatrix:mat3x3<f32>,\n  uMaskClamp:vec4<f32>,\n  uAlpha:f32,\n  uInverse:f32,\n  uChannel:f32,\n};\n\n@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;\n@group(0) @binding(1) var uTexture: texture_2d<f32>;\n@group(0) @binding(2) var uSampler : sampler;\n\n@group(1) @binding(0) var<uniform> filterUniforms : MaskUniforms;\n@group(1) @binding(1) var uMaskTexture: texture_2d<f32>;\n\nstruct VSOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) uv : vec2<f32>,\n    @location(1) filterUv : vec2<f32>,\n};\n\nfn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>\n{\n    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;\n\n    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;\n\n    return vec4(position, 0.0, 1.0);\n}\n\nfn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>\n{\n    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);\n}\n\nfn globalTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>\n{\n  return  (aPosition.xy / gfu.uGlobalFrame.zw) + (gfu.uGlobalFrame.xy / gfu.uGlobalFrame.zw);\n}\n\nfn getFilterCoord(aPosition:vec2<f32> ) -> vec2<f32>\n{\n  return ( filterUniforms.uFilterMatrix * vec3( filterTextureCoord(aPosition), 1.0)  ).xy;\n}\n\nfn getSize() -> vec2<f32>\n{\n  return gfu.uGlobalFrame.zw;\n}\n\n@vertex\nfn mainVertex(\n  @location(0) aPosition : vec2<f32>,\n) -> VSOutput {\n  return VSOutput(\n   filterVertexPosition(aPosition),\n   filterTextureCoord(aPosition),\n   getFilterCoord(aPosition)\n  );\n}\n\n@fragment\nfn mainFragment(\n  @location(0) uv: vec2<f32>,\n  @location(1) filterUv: vec2<f32>,\n  @builtin(position) position: vec4<f32>\n) -> @location(0) vec4<f32> {\n\n    var maskClamp = filterUniforms.uMaskClamp;\n    var uAlpha = filterUniforms.uAlpha;\n\n    var clip = step(3.5,\n      step(maskClamp.x, filterUv.x) +\n      step(maskClamp.y, filterUv.y) +\n      step(filterUv.x, maskClamp.z) +\n      step(filterUv.y, maskClamp.w));\n\n    var mask = textureSample(uMaskTexture, uSampler, filterUv);\n    var source = textureSample(uTexture, uSampler, uv);\n\n    var a: f32;\n    if (filterUniforms.uChannel == 1.0) {\n        a = mask.a * uAlpha * clip;\n    } else {\n        var alphaMul = 1.0 - uAlpha * (1.0 - mask.a);\n        a = alphaMul * mask.r * uAlpha * clip;\n    }\n\n    if (filterUniforms.uInverse == 1.0) {\n        a = 1.0 - a;\n    }\n\n    return source * a;\n}\n";
  class MaskFilter extends Filter {
    constructor(options) {
      const { sprite, ...rest } = options;
      const textureMatrix = new TextureMatrix(sprite.texture);
      const filterUniforms = new UniformGroup({
        uFilterMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uMaskClamp: { value: textureMatrix.uClampFrame, type: "vec4<f32>" },
        uAlpha: { value: 1, type: "f32" },
        uInverse: { value: options.inverse ? 1 : 0, type: "f32" },
        uChannel: { value: options.channel === "alpha" ? 1 : 0, type: "f32" }
      });
      const gpuProgram = GpuProgram.from({
        vertex: {
          source,
          entryPoint: "mainVertex"
        },
        fragment: {
          source,
          entryPoint: "mainFragment"
        }
      });
      const glProgram = GlProgram.from({
        vertex,
        fragment,
        name: "mask-filter"
      });
      super({
        ...rest,
        gpuProgram,
        glProgram,
        clipToViewport: false,
        resources: {
          filterUniforms,
          uMaskTexture: sprite.texture.source
        }
      });
      this.sprite = sprite;
      this._textureMatrix = textureMatrix;
    }
    set inverse(value) {
      this.resources.filterUniforms.uniforms.uInverse = value ? 1 : 0;
    }
    get inverse() {
      return this.resources.filterUniforms.uniforms.uInverse === 1;
    }
    set channel(value) {
      this.resources.filterUniforms.uniforms.uChannel = value === "alpha" ? 1 : 0;
    }
    get channel() {
      return this.resources.filterUniforms.uniforms.uChannel === 1 ? "alpha" : "red";
    }
    apply(filterManager, input, output, clearMode) {
      this._textureMatrix.texture = this.sprite.texture;
      filterManager.calculateSpriteMatrix(
        this.resources.filterUniforms.uniforms.uFilterMatrix,
        this.sprite
      ).prepend(this._textureMatrix.mapCoord);
      this.resources.uMaskTexture = this.sprite.texture.source;
      filterManager.applyFilter(this, input, output, clearMode);
    }
  }
  class CanvasGraphicsContext {
    constructor() {
      this.isBatchable = false;
    }

    reset() {
      this.isBatchable = false;
      this.context = null;
      if (this.graphicsData) {
        this.graphicsData.destroy();
        this.graphicsData = null;
      }
    }

    destroy() {
      this.reset();
    }
  }
  class CanvasGraphicsContextRenderData {
    constructor() {
      this.instructions = new InstructionSet();
    }

    init() {
      this.instructions.reset();
    }

    destroy() {
      this.instructions.destroy();
      this.instructions = null;
    }
  }
  const _CanvasGraphicsContextSystem = class _CanvasGraphicsContextSystem2 {
    constructor(renderer) {
      this._renderer = renderer;
      this._managedContexts = new GCManagedHash({ renderer, type: "resource", name: "graphicsContext" });
    }

    init(options) {
      _CanvasGraphicsContextSystem2.defaultOptions.bezierSmoothness = options?.bezierSmoothness ?? _CanvasGraphicsContextSystem2.defaultOptions.bezierSmoothness;
    }

    getContextRenderData(context2) {
      const gpuContext = this.getGpuContext(context2);
      return gpuContext.graphicsData || this._initContextRenderData(context2);
    }

    updateGpuContext(context2) {
      const gpuData = context2._gpuData;
      const hasContext = !!gpuData[this._renderer.uid];
      const gpuContext = gpuData[this._renderer.uid] || this._initContext(context2);
      if (context2.dirty || !hasContext) {
        if (hasContext) {
          gpuContext.reset();
        }
        gpuContext.isBatchable = false;
        context2.dirty = false;
      }
      return gpuContext;
    }

    getGpuContext(context2) {
      const gpuData = context2._gpuData;
      return gpuData[this._renderer.uid] || this._initContext(context2);
    }
    _initContextRenderData(context2) {
      const renderData = new CanvasGraphicsContextRenderData();
      const gpuContext = this.getGpuContext(context2);
      gpuContext.graphicsData = renderData;
      renderData.init();
      return renderData;
    }
    _initContext(context2) {
      const gpuContext = new CanvasGraphicsContext();
      gpuContext.context = context2;
      context2._gpuData[this._renderer.uid] = gpuContext;
      this._managedContexts.add(context2);
      return gpuContext;
    }
    destroy() {
      this._managedContexts.destroy();
      this._renderer = null;
    }
  };
  _CanvasGraphicsContextSystem.extension = {
    type: [
      ExtensionType.CanvasSystem
    ],
    name: "graphicsContext"
  };
  _CanvasGraphicsContextSystem.defaultOptions = {

    bezierSmoothness: 0.5
  };
  let CanvasGraphicsContextSystem = _CanvasGraphicsContextSystem;
  class CanvasGraphicsPipe {
    constructor(renderer, adaptor) {
      this.state = State.for2d();
      this.renderer = renderer;
      this._adaptor = adaptor;
      this.renderer.runners.contextChange.add(this);
      this._managedGraphics = new GCManagedHash({ renderer, type: "renderable", priority: -1, name: "graphics" });
    }
    contextChange() {
      this._adaptor.contextChange(this.renderer);
    }
    validateRenderable(_graphics) {
      return false;
    }
    addRenderable(graphics, instructionSet) {
      this._managedGraphics.add(graphics);
      this.renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add(graphics);
    }
    updateRenderable(_graphics) {
    }
    execute(graphics) {
      if (!graphics.isRenderable) return;
      this._adaptor.execute(this, graphics);
    }
    destroy() {
      this._managedGraphics.destroy();
      this.renderer = null;
      this._adaptor.destroy();
      this._adaptor = null;
    }
  }
  CanvasGraphicsPipe.extension = {
    type: [
      ExtensionType.CanvasPipes
    ],
    name: "graphics"
  };
  function color32BitToUniform(abgr, out2, offset2) {
    const alpha = (abgr >> 24 & 255) / 255;
    out2[offset2++] = (abgr & 255) / 255 * alpha;
    out2[offset2++] = (abgr >> 8 & 255) / 255 * alpha;
    out2[offset2++] = (abgr >> 16 & 255) / 255 * alpha;
    out2[offset2++] = alpha;
  }
  class GraphicsGpuData {
    constructor() {
      this.batches = [];
      this.batched = false;
    }
    destroy() {
      this.batches.forEach((batch) => {
        BigPool.return(batch);
      });
      this.batches.length = 0;
    }
  }
  class GraphicsPipe {
    constructor(renderer, adaptor) {
      this.state = State.for2d();
      this.renderer = renderer;
      this._adaptor = adaptor;
      this.renderer.runners.contextChange.add(this);
      this._managedGraphics = new GCManagedHash({ renderer, type: "renderable", priority: -1, name: "graphics" });
    }
    contextChange() {
      this._adaptor.contextChange(this.renderer);
    }
    validateRenderable(graphics) {
      const context2 = graphics.context;
      const wasBatched = !!graphics._gpuData;
      const contextSystem = this.renderer.graphicsContext;
      const gpuContext = contextSystem.updateGpuContext(context2);
      if (gpuContext.isBatchable || wasBatched !== gpuContext.isBatchable) {
        return true;
      }
      return false;
    }
    addRenderable(graphics, instructionSet) {
      const contextSystem = this.renderer.graphicsContext;
      const gpuContext = contextSystem.updateGpuContext(graphics.context);
      if (graphics.didViewUpdate) {
        this._rebuild(graphics);
      }
      if (gpuContext.isBatchable) {
        this._addToBatcher(graphics, instructionSet);
      } else {
        this.renderer.renderPipes.batch.break(instructionSet);
        instructionSet.add(graphics);
      }
    }
    updateRenderable(graphics) {
      const gpuData = this._getGpuDataForRenderable(graphics);
      const batches = gpuData.batches;
      for (let i2 = 0; i2 < batches.length; i2++) {
        const batch = batches[i2];
        batch._batcher.updateElement(batch);
      }
    }
    execute(graphics) {
      if (!graphics.isRenderable) return;
      const renderer = this.renderer;
      const context2 = graphics.context;
      const contextSystem = renderer.graphicsContext;
      if (!contextSystem.getGpuContext(context2).batches.length) {
        return;
      }
      const shader = context2.customShader || this._adaptor.shader;
      this.state.blendMode = graphics.groupBlendMode;
      const localUniforms = shader.resources.localUniforms.uniforms;
      localUniforms.uTransformMatrix = graphics.groupTransform;
      localUniforms.uRound = renderer._roundPixels | graphics._roundPixels;
      color32BitToUniform(
        graphics.groupColorAlpha,
        localUniforms.uColor,
        0
      );
      this._adaptor.execute(this, graphics);
    }
    _rebuild(graphics) {
      const gpuData = this._getGpuDataForRenderable(graphics);
      const contextSystem = this.renderer.graphicsContext;
      const gpuContext = contextSystem.updateGpuContext(graphics.context);
      gpuData.destroy();
      if (gpuContext.isBatchable) {
        this._updateBatchesForRenderable(graphics, gpuData);
      }
    }
    _addToBatcher(graphics, instructionSet) {
      const batchPipe = this.renderer.renderPipes.batch;
      const batches = this._getGpuDataForRenderable(graphics).batches;
      for (let i2 = 0; i2 < batches.length; i2++) {
        const batch = batches[i2];
        batchPipe.addToBatch(batch, instructionSet);
      }
    }
    _getGpuDataForRenderable(graphics) {
      return graphics._gpuData[this.renderer.uid] || this._initGpuDataForRenderable(graphics);
    }
    _initGpuDataForRenderable(graphics) {
      const gpuData = new GraphicsGpuData();
      graphics._gpuData[this.renderer.uid] = gpuData;
      this._managedGraphics.add(graphics);
      return gpuData;
    }
    _updateBatchesForRenderable(graphics, gpuData) {
      const context2 = graphics.context;
      const contextSystem = this.renderer.graphicsContext;
      const gpuContext = contextSystem.getGpuContext(context2);
      const roundPixels = this.renderer._roundPixels | graphics._roundPixels;
      gpuData.batches = gpuContext.batches.map((batch) => {
        const batchClone = BigPool.get(BatchableGraphics);
        batch.copyTo(batchClone);
        batchClone.renderable = graphics;
        batchClone.roundPixels = roundPixels;
        return batchClone;
      });
    }
    destroy() {
      this._managedGraphics.destroy();
      this.renderer = null;
      this._adaptor.destroy();
      this._adaptor = null;
      this.state = null;
    }
  }
  GraphicsPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes
    ],
    name: "graphics"
  };
  extensions.add(CanvasGraphicsPipe);
  extensions.add(GraphicsPipe);
  extensions.add(CanvasGraphicsContextSystem);
  extensions.add(GraphicsContextSystem);
  class Graphics extends ViewContainer {

    constructor(options) {
      if (options instanceof GraphicsContext) {
        options = { context: options };
      }
      const { context: context2, roundPixels, ...rest } = options || {};
      super({
        label: "Graphics",
        ...rest
      });
      this.renderPipeId = "graphics";
      if (!context2) {
        this.context = this._ownedContext = new GraphicsContext();
        this.context.autoGarbageCollect = this.autoGarbageCollect;
      } else {
        this.context = context2;
      }
      this.didViewUpdate = true;
      this.allowChildren = false;
      this.roundPixels = roundPixels ?? false;
    }
    set context(context2) {
      if (context2 === this._context) return;
      if (this._context) {
        this._context.off("update", this.onViewUpdate, this);
        this._context.off("unload", this.unload, this);
      }
      this._context = context2;
      this._context.on("update", this.onViewUpdate, this);
      this._context.on("unload", this.unload, this);
      this.onViewUpdate();
    }

    get context() {
      return this._context;
    }

    get bounds() {
      return this._context.bounds;
    }

    updateBounds() {
    }

    containsPoint(point) {
      return this._context.containsPoint(point);
    }

    destroy(options) {
      if (this._ownedContext && !options) {
        this._ownedContext.destroy(options);
      } else if (options === true || options?.context === true) {
        this._context.destroy(options);
      }
      this._ownedContext = null;
      this._context = null;
      super.destroy(options);
    }

    _onTouch(now) {
      this._gcLastUsed = now;
      this._context._gcLastUsed = now;
    }
    _callContextMethod(method, args) {
      this.context[method](...args);
      return this;
    }

    setFillStyle(...args) {
      return this._callContextMethod("setFillStyle", args);
    }

    setStrokeStyle(...args) {
      return this._callContextMethod("setStrokeStyle", args);
    }
    fill(...args) {
      return this._callContextMethod("fill", args);
    }

    stroke(...args) {
      return this._callContextMethod("stroke", args);
    }
    texture(...args) {
      return this._callContextMethod("texture", args);
    }

    beginPath() {
      return this._callContextMethod("beginPath", []);
    }

    cut() {
      return this._callContextMethod("cut", []);
    }
    arc(...args) {
      return this._callContextMethod("arc", args);
    }
    arcTo(...args) {
      return this._callContextMethod("arcTo", args);
    }
    arcToSvg(...args) {
      return this._callContextMethod("arcToSvg", args);
    }
    bezierCurveTo(...args) {
      return this._callContextMethod("bezierCurveTo", args);
    }

    closePath() {
      return this._callContextMethod("closePath", []);
    }
    ellipse(...args) {
      return this._callContextMethod("ellipse", args);
    }
    circle(...args) {
      return this._callContextMethod("circle", args);
    }
    path(...args) {
      return this._callContextMethod("path", args);
    }
    lineTo(...args) {
      return this._callContextMethod("lineTo", args);
    }
    moveTo(...args) {
      return this._callContextMethod("moveTo", args);
    }
    quadraticCurveTo(...args) {
      return this._callContextMethod("quadraticCurveTo", args);
    }
    rect(...args) {
      return this._callContextMethod("rect", args);
    }
    roundRect(...args) {
      return this._callContextMethod("roundRect", args);
    }
    poly(...args) {
      return this._callContextMethod("poly", args);
    }
    regularPoly(...args) {
      return this._callContextMethod("regularPoly", args);
    }
    roundPoly(...args) {
      return this._callContextMethod("roundPoly", args);
    }
    roundShape(...args) {
      return this._callContextMethod("roundShape", args);
    }
    filletRect(...args) {
      return this._callContextMethod("filletRect", args);
    }
    chamferRect(...args) {
      return this._callContextMethod("chamferRect", args);
    }
    star(...args) {
      return this._callContextMethod("star", args);
    }
    svg(...args) {
      return this._callContextMethod("svg", args);
    }
    restore(...args) {
      return this._callContextMethod("restore", args);
    }

    save() {
      return this._callContextMethod("save", []);
    }

    getTransform() {
      return this.context.getTransform();
    }

    resetTransform() {
      return this._callContextMethod("resetTransform", []);
    }
    rotateTransform(...args) {
      return this._callContextMethod("rotate", args);
    }
    scaleTransform(...args) {
      return this._callContextMethod("scale", args);
    }
    setTransform(...args) {
      return this._callContextMethod("setTransform", args);
    }
    transform(...args) {
      return this._callContextMethod("transform", args);
    }
    translateTransform(...args) {
      return this._callContextMethod("translate", args);
    }

    clear() {
      return this._callContextMethod("clear", []);
    }

    get fillStyle() {
      return this._context.fillStyle;
    }
    set fillStyle(value) {
      this._context.fillStyle = value;
    }

    get strokeStyle() {
      return this._context.strokeStyle;
    }
    set strokeStyle(value) {
      this._context.strokeStyle = value;
    }

    clone(deep = false) {
      if (deep) {
        return new Graphics(this._context.clone());
      }
      this._ownedContext = null;
      const clone = new Graphics(this._context);
      return clone;
    }

    lineStyle(width, color, alpha) {
      deprecation(v8_0_0, "Graphics#lineStyle is no longer needed. Use Graphics#setStrokeStyle to set the stroke style.");
      const strokeStyle = {};
      width && (strokeStyle.width = width);
      color && (strokeStyle.color = color);
      alpha && (strokeStyle.alpha = alpha);
      this.context.strokeStyle = strokeStyle;
      return this;
    }

    beginFill(color, alpha) {
      deprecation(v8_0_0, "Graphics#beginFill is no longer needed. Use Graphics#fill to fill the shape with the desired style.");
      const fillStyle = {};
      if (color !== void 0) fillStyle.color = color;
      if (alpha !== void 0) fillStyle.alpha = alpha;
      this.context.fillStyle = fillStyle;
      return this;
    }

    endFill() {
      deprecation(v8_0_0, "Graphics#endFill is no longer needed. Use Graphics#fill to fill the shape with the desired style.");
      this.context.fill();
      const strokeStyle = this.context.strokeStyle;
      if (strokeStyle.width !== GraphicsContext.defaultStrokeStyle.width || strokeStyle.color !== GraphicsContext.defaultStrokeStyle.color || strokeStyle.alpha !== GraphicsContext.defaultStrokeStyle.alpha) {
        this.context.stroke();
      }
      return this;
    }

    drawCircle(...args) {
      deprecation(v8_0_0, "Graphics#drawCircle has been renamed to Graphics#circle");
      return this._callContextMethod("circle", args);
    }

    drawEllipse(...args) {
      deprecation(v8_0_0, "Graphics#drawEllipse has been renamed to Graphics#ellipse");
      return this._callContextMethod("ellipse", args);
    }

    drawPolygon(...args) {
      deprecation(v8_0_0, "Graphics#drawPolygon has been renamed to Graphics#poly");
      return this._callContextMethod("poly", args);
    }

    drawRect(...args) {
      deprecation(v8_0_0, "Graphics#drawRect has been renamed to Graphics#rect");
      return this._callContextMethod("rect", args);
    }

    drawRoundedRect(...args) {
      deprecation(v8_0_0, "Graphics#drawRoundedRect has been renamed to Graphics#roundRect");
      return this._callContextMethod("roundRect", args);
    }

    drawStar(...args) {
      deprecation(v8_0_0, "Graphics#drawStar has been renamed to Graphics#star");
      return this._callContextMethod("star", args);
    }
  }
  const localUniformBit = {
    vertex: {
      header: (

        `

            struct LocalUniforms {
                uTransformMatrix:mat3x3<f32>,
                uColor:vec4<f32>,
                uRound:f32,
            }

            @group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;
        `
      ),
      main: (

        `
            vColor *= localUniforms.uColor;
            modelMatrix *= localUniforms.uTransformMatrix;
        `
      ),
      end: (

        `
            if(localUniforms.uRound == 1)
            {
                vPosition = vec4(roundPixels(vPosition.xy, globalUniforms.uResolution), vPosition.zw);
            }
        `
      )
    }
  };
  ({
    vertex: {
      ...localUniformBit.vertex,

      header: localUniformBit.vertex.header.replace("group(1)", "group(2)")
    }
  });
  const localUniformBitGl = {
    name: "local-uniform-bit",
    vertex: {
      header: (

        `

            uniform mat3 uTransformMatrix;
            uniform vec4 uColor;
            uniform float uRound;
        `
      ),
      main: (

        `
            vColor *= uColor;
            modelMatrix = uTransformMatrix;
        `
      ),
      end: (

        `
            if(uRound == 1.)
            {
                gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
            }
        `
      )
    }
  };
  class BatchableSprite {
    constructor() {
      this.batcherName = "default";
      this.topology = "triangle-list";
      this.attributeSize = 4;
      this.indexSize = 6;
      this.packAsQuad = true;
      this.roundPixels = 0;
      this._attributeStart = 0;
      this._batcher = null;
      this._batch = null;
    }
    get blendMode() {
      return this.renderable.groupBlendMode;
    }
    get color() {
      return this.renderable.groupColorAlpha;
    }
    reset() {
      this.renderable = null;
      this.texture = null;
      this._batcher = null;
      this._batch = null;
      this.bounds = null;
    }
    destroy() {
      this.reset();
    }
  }
  function isSafari() {
    const { userAgent } = DOMAdapter.get().getNavigator();
    return /^((?!chrome|android).)*safari/i.test(userAgent);
  }
  const _CanvasBatchAdaptor = class _CanvasBatchAdaptor2 {
    static _getPatternRepeat(addressModeU, addressModeV) {
      const repeatU = addressModeU && addressModeU !== "clamp-to-edge";
      const repeatV = addressModeV && addressModeV !== "clamp-to-edge";
      if (repeatU && repeatV) return "repeat";
      if (repeatU) return "repeat-x";
      if (repeatV) return "repeat-y";
      return "no-repeat";
    }
    start(batchPipe, geometry, shader) {
    }
    execute(batchPipe, batch) {
      const elements = batch.elements;
      if (!elements || !elements.length) return;
      const renderer = batchPipe.renderer;
      const contextSystem = renderer.canvasContext;
      const context2 = contextSystem.activeContext;
      for (let i2 = 0; i2 < elements.length; i2++) {
        const element = elements[i2];
        if (!element.packAsQuad) continue;
        const quad = element;
        const texture = quad.texture;
        const source2 = texture ? canvasUtils.getCanvasSource(texture) : null;
        if (!source2) continue;
        const textureStyle = texture.source.style;
        const smoothProperty = contextSystem.smoothProperty;
        const shouldSmooth = textureStyle.scaleMode !== "nearest";
        if (context2[smoothProperty] !== shouldSmooth) {
          context2[smoothProperty] = shouldSmooth;
        }
        contextSystem.setBlendMode(batch.blendMode);
        const globalColor = renderer.globalUniforms.globalUniformData?.worldColor ?? 4294967295;
        const argb = quad.color;
        const globalAlpha = (globalColor >>> 24 & 255) / 255;
        const quadAlpha = (argb >>> 24 & 255) / 255;
        const filterAlpha = renderer.filter?.alphaMultiplier ?? 1;
        const alpha = globalAlpha * quadAlpha * filterAlpha;
        if (alpha <= 0) continue;
        context2.globalAlpha = alpha;
        const globalTint = globalColor & 16777215;
        const quadTint = argb & 16777215;
        const tint = bgr2rgb(multiplyHexColors(quadTint, globalTint));
        const frame = texture.frame;
        const repeatU = textureStyle.addressModeU ?? textureStyle.addressMode;
        const repeatV = textureStyle.addressModeV ?? textureStyle.addressMode;
        const repeat = _CanvasBatchAdaptor2._getPatternRepeat(repeatU, repeatV);
        const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
        const isFromCachedRenderGroup = quad.renderable?.renderGroup?.isCachedAsTexture;
        const sx = frame.x * resolution;
        const sy = frame.y * resolution;
        const sw = frame.width * resolution;
        const sh = frame.height * resolution;
        const bounds = quad.bounds;
        const isRootTarget = renderer.renderTarget.renderTarget.isRoot;
        const dx = bounds.minX;
        const dy = bounds.minY;
        const dw = bounds.maxX - bounds.minX;
        const dh = bounds.maxY - bounds.minY;
        const rotate = texture.rotate;
        const uvs = texture.uvs;
        const uvMin = Math.min(uvs.x0, uvs.x1, uvs.x2, uvs.x3, uvs.y0, uvs.y1, uvs.y2, uvs.y3);
        const uvMax = Math.max(uvs.x0, uvs.x1, uvs.x2, uvs.x3, uvs.y0, uvs.y1, uvs.y2, uvs.y3);
        const needsRepeat = repeat !== "no-repeat" && (uvMin < 0 || uvMax > 1);
        const willUseProcessedCanvas = !needsRepeat && (tint !== 16777215 || rotate);
        const applyRotateTransform = rotate && !willUseProcessedCanvas;
        if (applyRotateTransform) {
          _CanvasBatchAdaptor2._tempPatternMatrix.copyFrom(quad.transform);
          groupD8.matrixAppendRotationInv(
            _CanvasBatchAdaptor2._tempPatternMatrix,
            rotate,
            dx,
            dy,
            dw,
            dh
          );
          contextSystem.setContextTransform(
            _CanvasBatchAdaptor2._tempPatternMatrix,
            quad.roundPixels === 1,
            void 0,
            isFromCachedRenderGroup && isRootTarget
          );
        } else {
          contextSystem.setContextTransform(
            quad.transform,
            quad.roundPixels === 1,
            void 0,
            isFromCachedRenderGroup && isRootTarget
          );
        }
        const drawX = applyRotateTransform ? 0 : dx;
        const drawY = applyRotateTransform ? 0 : dy;
        const drawW = dw;
        const drawH = dh;
        if (needsRepeat) {
          let patternSource = source2;
          const canTint = tint !== 16777215 && !rotate;
          const fitsFrame = frame.width <= texture.source.width && frame.height <= texture.source.height;
          if (canTint && fitsFrame) {
            patternSource = canvasUtils.getTintedCanvas({ texture }, tint);
          }
          const pattern = context2.createPattern(patternSource, repeat);
          if (!pattern) continue;
          const denomX = drawW;
          const denomY = drawH;
          if (denomX === 0 || denomY === 0) continue;
          const invDx = 1 / denomX;
          const invDy = 1 / denomY;
          const a2 = (uvs.x1 - uvs.x0) * invDx;
          const b2 = (uvs.y1 - uvs.y0) * invDx;
          const c2 = (uvs.x3 - uvs.x0) * invDy;
          const d2 = (uvs.y3 - uvs.y0) * invDy;
          const tx = uvs.x0 - a2 * drawX - c2 * drawY;
          const ty = uvs.y0 - b2 * drawX - d2 * drawY;
          const pixelWidth = texture.source.pixelWidth;
          const pixelHeight = texture.source.pixelHeight;
          _CanvasBatchAdaptor2._tempPatternMatrix.set(
            a2 * pixelWidth,
            b2 * pixelHeight,
            c2 * pixelWidth,
            d2 * pixelHeight,
            tx * pixelWidth,
            ty * pixelHeight
          );
          canvasUtils.applyPatternTransform(pattern, _CanvasBatchAdaptor2._tempPatternMatrix);
          context2.fillStyle = pattern;
          context2.fillRect(drawX, drawY, drawW, drawH);
        } else {
          const needsProcessing = tint !== 16777215 || rotate;
          const processedSource = needsProcessing ? canvasUtils.getTintedCanvas({ texture }, tint) : source2;
          const isProcessed = processedSource !== source2;
          context2.drawImage(
            processedSource,
            isProcessed ? 0 : sx,
            isProcessed ? 0 : sy,
            isProcessed ? processedSource.width : sw,
            isProcessed ? processedSource.height : sh,
            drawX,
            drawY,
            drawW,
            drawH
          );
        }
      }
    }
  };
  _CanvasBatchAdaptor._tempPatternMatrix = new Matrix();
  _CanvasBatchAdaptor.extension = {
    type: [
      ExtensionType.CanvasPipesAdaptor
    ],
    name: "batch"
  };
  let CanvasBatchAdaptor = _CanvasBatchAdaptor;
  class GlBatchAdaptor {
    constructor() {
      this._tempState = State.for2d();
      this._didUploadHash = {};
    }
    init(batcherPipe) {
      batcherPipe.renderer.runners.contextChange.add(this);
    }
    contextChange() {
      this._didUploadHash = {};
    }
    start(batchPipe, geometry, shader) {
      const renderer = batchPipe.renderer;
      const didUpload = this._didUploadHash[shader.uid];
      renderer.shader.bind(shader, didUpload);
      if (!didUpload) {
        this._didUploadHash[shader.uid] = true;
      }
      renderer.shader.updateUniformGroup(renderer.globalUniforms.uniformGroup);
      renderer.geometry.bind(geometry, shader.glProgram);
    }
    execute(batchPipe, batch) {
      const renderer = batchPipe.renderer;
      this._tempState.blendMode = batch.blendMode;
      renderer.state.set(this._tempState);
      const textures = batch.textures.textures;
      for (let i2 = 0; i2 < batch.textures.count; i2++) {
        renderer.texture.bind(textures[i2], i2);
      }
      renderer.geometry.draw(batch.topology, batch.size, batch.start);
    }
  }
  GlBatchAdaptor.extension = {
    type: [
      ExtensionType.WebGLPipesAdaptor
    ],
    name: "batch"
  };
  const _BatcherPipe = class _BatcherPipe2 {
    constructor(renderer, adaptor) {
      this.state = State.for2d();
      this._batchersByInstructionSet =                 Object.create(null);
      this._activeBatches =                 Object.create(null);
      this.renderer = renderer;
      this._adaptor = adaptor;
      this._adaptor.init?.(this);
    }
    static getBatcher(name) {
      return new this._availableBatchers[name]();
    }
    buildStart(instructionSet) {
      let batchers = this._batchersByInstructionSet[instructionSet.uid];
      if (!batchers) {
        batchers = this._batchersByInstructionSet[instructionSet.uid] =                 Object.create(null);
        batchers.default || (batchers.default = new DefaultBatcher({
          maxTextures: this.renderer.limits.maxBatchableTextures
        }));
      }
      this._activeBatches = batchers;
      this._activeBatch = this._activeBatches.default;
      for (const i2 in this._activeBatches) {
        this._activeBatches[i2].begin();
      }
    }
    addToBatch(batchableObject, instructionSet) {
      if (this._activeBatch.name !== batchableObject.batcherName) {
        this._activeBatch.break(instructionSet);
        let batch = this._activeBatches[batchableObject.batcherName];
        if (!batch) {
          batch = this._activeBatches[batchableObject.batcherName] = _BatcherPipe2.getBatcher(batchableObject.batcherName);
          batch.begin();
        }
        this._activeBatch = batch;
      }
      this._activeBatch.add(batchableObject);
    }
    break(instructionSet) {
      this._activeBatch.break(instructionSet);
    }
    buildEnd(instructionSet) {
      this._activeBatch.break(instructionSet);
      const batches = this._activeBatches;
      for (const i2 in batches) {
        const batch = batches[i2];
        const geometry = batch.geometry;
        geometry.indexBuffer.setDataWithSize(batch.indexBuffer, batch.indexSize, true);
        geometry.buffers[0].setDataWithSize(batch.attributeBuffer.float32View, batch.attributeSize, false);
      }
    }
    upload(instructionSet) {
      const batchers = this._batchersByInstructionSet[instructionSet.uid];
      for (const i2 in batchers) {
        const batcher = batchers[i2];
        const geometry = batcher.geometry;
        if (batcher.dirty) {
          batcher.dirty = false;
          geometry.buffers[0].update(batcher.attributeSize * 4);
        }
      }
    }
    execute(batch) {
      if (batch.action === "startBatch") {
        const batcher = batch.batcher;
        const geometry = batcher.geometry;
        const shader = batcher.shader;
        this._adaptor.start(this, geometry, shader);
      }
      this._adaptor.execute(this, batch);
    }
    destroy() {
      this.state = null;
      this.renderer = null;
      this._adaptor = null;
      for (const i2 in this._activeBatches) {
        this._activeBatches[i2].destroy();
      }
      this._activeBatches = null;
    }
  };
  _BatcherPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "batch"
  };
  _BatcherPipe._availableBatchers =                 Object.create(null);
  let BatcherPipe = _BatcherPipe;
  extensions.handleByMap(ExtensionType.Batcher, BatcherPipe._availableBatchers);
  extensions.add(DefaultBatcher);
  const textureBitGl = {
    name: "texture-bit",
    vertex: {
      header: (

        `
            uniform mat3 uTextureMatrix;
        `
      ),
      main: (

        `
            uv = (uTextureMatrix * vec3(uv, 1.0)).xy;
        `
      )
    },
    fragment: {
      header: (

        `
        uniform sampler2D uTexture;

        `
      ),
      main: (

        `
            outColor = texture(uTexture, vUV);
        `
      )
    }
  };
  const tempBounds$1 = new Bounds();
  class AlphaMaskEffect extends FilterEffect {
    constructor() {
      super();
      this.filters = [new MaskFilter({
        sprite: new Sprite(Texture.EMPTY),
        inverse: false,
        resolution: "inherit",
        antialias: "inherit"
      })];
    }
    get sprite() {
      return this.filters[0].sprite;
    }
    set sprite(value) {
      this.filters[0].sprite = value;
    }
    get inverse() {
      return this.filters[0].inverse;
    }
    set inverse(value) {
      this.filters[0].inverse = value;
    }
    get channel() {
      return this.filters[0].channel;
    }
    set channel(value) {
      this.filters[0].channel = value;
    }
  }
  class AlphaMaskPipe {
    constructor(renderer) {
      this._activeMaskStage = [];
      this._renderer = renderer;
    }
    push(mask, maskedContainer, instructionSet) {
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "alphaMask",
        action: "pushMaskBegin",
        mask,
        inverse: maskedContainer._maskOptions.inverse,
        canBundle: false,
        maskedContainer
      });
      mask.inverse = maskedContainer._maskOptions.inverse;
      mask.channel = maskedContainer._maskOptions.channel ?? "red";
      if (mask.renderMaskToTexture) {
        const maskContainer = mask.mask;
        maskContainer.includeInBuild = true;
        maskContainer.collectRenderables(
          instructionSet,
          renderer,
          null
        );
        maskContainer.includeInBuild = false;
      }
      renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "alphaMask",
        action: "pushMaskEnd",
        mask,
        maskedContainer,
        inverse: maskedContainer._maskOptions.inverse,
        canBundle: false
      });
    }
    pop(mask, _maskedContainer, instructionSet) {
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "alphaMask",
        action: "popMaskEnd",
        mask,
        inverse: _maskedContainer._maskOptions.inverse,
        canBundle: false
      });
    }
    execute(instruction) {
      const renderer = this._renderer;
      const renderMask = instruction.mask.renderMaskToTexture;
      if (instruction.action === "pushMaskBegin") {
        const filterEffect = BigPool.get(AlphaMaskEffect);
        filterEffect.inverse = instruction.inverse;
        filterEffect.channel = instruction.mask.channel;
        if (renderMask) {
          instruction.mask.mask.measurable = true;
          const bounds = getGlobalBounds(instruction.mask.mask, true, tempBounds$1);
          instruction.mask.mask.measurable = false;
          bounds.ceil();
          const colorTextureSource = renderer.renderTarget.renderTarget.colorTexture.source;
          const filterTexture = TexturePool.getOptimalTexture(
            bounds.width,
            bounds.height,
            colorTextureSource._resolution,
            colorTextureSource.antialias
          );
          renderer.renderTarget.push(filterTexture, true);
          renderer.globalUniforms.push({
            offset: bounds,
            worldColor: 4294967295
          });
          const sprite = filterEffect.sprite;
          sprite.texture = filterTexture;
          sprite.worldTransform.tx = bounds.minX;
          sprite.worldTransform.ty = bounds.minY;
          this._activeMaskStage.push({
            filterEffect,
            maskedContainer: instruction.maskedContainer,
            filterTexture
          });
        } else {
          filterEffect.sprite = instruction.mask.mask;
          this._activeMaskStage.push({
            filterEffect,
            maskedContainer: instruction.maskedContainer
          });
        }
      } else if (instruction.action === "pushMaskEnd") {
        const maskData = this._activeMaskStage[this._activeMaskStage.length - 1];
        if (renderMask) {
          if (renderer.type === RendererType.WEBGL) {
            renderer.renderTarget.finishRenderPass();
          }
          renderer.renderTarget.pop();
          renderer.globalUniforms.pop();
        }
        renderer.filter.push({
          renderPipeId: "filter",
          action: "pushFilter",
          container: maskData.maskedContainer,
          filterEffect: maskData.filterEffect,
          canBundle: false
        });
      } else if (instruction.action === "popMaskEnd") {
        renderer.filter.pop();
        const maskData = this._activeMaskStage.pop();
        if (renderMask) {
          TexturePool.returnTexture(maskData.filterTexture);
        }
        BigPool.return(maskData.filterEffect);
      }
    }
    destroy() {
      this._renderer = null;
      this._activeMaskStage = null;
    }
  }
  AlphaMaskPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "alphaMask"
  };
  class CanvasColorMaskPipe {
    constructor(renderer) {
      this._colorStack = [];
      this._colorStackIndex = 0;
      this._currentColor = 0;
      this._renderer = renderer;
    }
    buildStart() {
      this._colorStack[0] = 15;
      this._colorStackIndex = 1;
      this._currentColor = 15;
    }
    push(mask, _container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      const colorStack = this._colorStack;
      colorStack[this._colorStackIndex] = colorStack[this._colorStackIndex - 1] & mask.mask;
      const currentColor = this._colorStack[this._colorStackIndex];
      if (currentColor !== this._currentColor) {
        this._currentColor = currentColor;
        instructionSet.add({
          renderPipeId: "colorMask",
          colorMask: currentColor,
          canBundle: false
        });
      }
      this._colorStackIndex++;
    }
    pop(_mask, _container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      const colorStack = this._colorStack;
      this._colorStackIndex--;
      const currentColor = colorStack[this._colorStackIndex - 1];
      if (currentColor !== this._currentColor) {
        this._currentColor = currentColor;
        instructionSet.add({
          renderPipeId: "colorMask",
          colorMask: currentColor,
          canBundle: false
        });
      }
    }
    execute(_instruction) {
    }
    destroy() {
      this._renderer = null;
      this._colorStack = null;
    }
  }
  CanvasColorMaskPipe.extension = {
    type: [
      ExtensionType.CanvasPipes
    ],
    name: "colorMask"
  };
  class ColorMaskPipe {
    constructor(renderer) {
      this._colorStack = [];
      this._colorStackIndex = 0;
      this._currentColor = 0;
      this._renderer = renderer;
    }
    buildStart() {
      this._colorStack[0] = 15;
      this._colorStackIndex = 1;
      this._currentColor = 15;
    }
    push(mask, _container, instructionSet) {
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      const colorStack = this._colorStack;
      colorStack[this._colorStackIndex] = colorStack[this._colorStackIndex - 1] & mask.mask;
      const currentColor = this._colorStack[this._colorStackIndex];
      if (currentColor !== this._currentColor) {
        this._currentColor = currentColor;
        instructionSet.add({
          renderPipeId: "colorMask",
          colorMask: currentColor,
          canBundle: false
        });
      }
      this._colorStackIndex++;
    }
    pop(_mask, _container, instructionSet) {
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      const colorStack = this._colorStack;
      this._colorStackIndex--;
      const currentColor = colorStack[this._colorStackIndex - 1];
      if (currentColor !== this._currentColor) {
        this._currentColor = currentColor;
        instructionSet.add({
          renderPipeId: "colorMask",
          colorMask: currentColor,
          canBundle: false
        });
      }
    }
    execute(instruction) {
      const renderer = this._renderer;
      renderer.colorMask.setMask(instruction.colorMask);
    }
    destroy() {
      this._renderer = null;
      this._colorStack = null;
    }
  }
  ColorMaskPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes
    ],
    name: "colorMask"
  };
  function buildRoundedRectPath$1(context2, x2, y2, width, height, radius) {
    radius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    context2.moveTo(x2 + radius, y2);
    context2.lineTo(x2 + width - radius, y2);
    context2.quadraticCurveTo(x2 + width, y2, x2 + width, y2 + radius);
    context2.lineTo(x2 + width, y2 + height - radius);
    context2.quadraticCurveTo(x2 + width, y2 + height, x2 + width - radius, y2 + height);
    context2.lineTo(x2 + radius, y2 + height);
    context2.quadraticCurveTo(x2, y2 + height, x2, y2 + height - radius);
    context2.lineTo(x2, y2 + radius);
    context2.quadraticCurveTo(x2, y2, x2 + radius, y2);
  }
  function buildShapePath$1(context2, shape) {
    switch (shape.type) {
      case "rectangle": {
        const rect = shape;
        context2.rect(rect.x, rect.y, rect.width, rect.height);
        break;
      }
      case "roundedRectangle": {
        const rect = shape;
        buildRoundedRectPath$1(context2, rect.x, rect.y, rect.width, rect.height, rect.radius);
        break;
      }
      case "circle": {
        const circle = shape;
        context2.moveTo(circle.x + circle.radius, circle.y);
        context2.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        break;
      }
      case "ellipse": {
        const ellipse = shape;
        if (context2.ellipse) {
          context2.moveTo(ellipse.x + ellipse.halfWidth, ellipse.y);
          context2.ellipse(ellipse.x, ellipse.y, ellipse.halfWidth, ellipse.halfHeight, 0, 0, Math.PI * 2);
        } else {
          context2.save();
          context2.translate(ellipse.x, ellipse.y);
          context2.scale(ellipse.halfWidth, ellipse.halfHeight);
          context2.moveTo(1, 0);
          context2.arc(0, 0, 1, 0, Math.PI * 2);
          context2.restore();
        }
        break;
      }
      case "triangle": {
        const tri = shape;
        context2.moveTo(tri.x, tri.y);
        context2.lineTo(tri.x2, tri.y2);
        context2.lineTo(tri.x3, tri.y3);
        context2.closePath();
        break;
      }
      case "polygon":
      default: {
        const poly = shape;
        const points = poly.points;
        if (!points?.length) break;
        context2.moveTo(points[0], points[1]);
        for (let i2 = 2; i2 < points.length; i2 += 2) {
          context2.lineTo(points[i2], points[i2 + 1]);
        }
        if (poly.closePath) {
          context2.closePath();
        }
        break;
      }
    }
  }
  function buildStrokeMaskPath(context2, shape, strokeStyle) {
    const points = [];
    const vertices = [];
    const indices = [];
    const shapeBuilder = shapeBuilders[shape.type];
    if (!shapeBuilder?.build(shape, points)) return false;
    const close = shape.closePath ?? true;
    buildLine(points, strokeStyle, false, close, vertices, indices);
    for (let i2 = 0; i2 < indices.length; i2 += 3) {
      const i0 = indices[i2] * 2;
      const i1 = indices[i2 + 1] * 2;
      const i22 = indices[i2 + 2] * 2;
      context2.moveTo(vertices[i0], vertices[i0 + 1]);
      context2.lineTo(vertices[i1], vertices[i1 + 1]);
      context2.lineTo(vertices[i22], vertices[i22 + 1]);
      context2.closePath();
    }
    return true;
  }
  function addHolePaths$1(context2, holes) {
    if (!holes?.length) return false;
    for (let i2 = 0; i2 < holes.length; i2++) {
      const hole = holes[i2];
      if (!hole?.shape) continue;
      const transform = hole.transform;
      const hasTransform = transform && !transform.isIdentity();
      if (hasTransform) {
        context2.save();
        context2.transform(transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty);
      }
      buildShapePath$1(context2, hole.shape);
      if (hasTransform) {
        context2.restore();
      }
    }
    return true;
  }
  class CanvasStencilMaskPipe {
    constructor(renderer) {
      this._warnedMaskTypes =                 new Set();
      this._canvasMaskStack = [];
      this._renderer = renderer;
    }
    push(mask, _container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "pushMaskBegin",
        mask,
        inverse: _container._maskOptions.inverse,
        canBundle: false
      });
    }
    pop(_mask, _container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "popMaskEnd",
        mask: _mask,
        inverse: _container._maskOptions.inverse,
        canBundle: false
      });
    }
    execute(instruction) {
      if (instruction.action !== "pushMaskBegin" && instruction.action !== "popMaskEnd") {
        return;
      }
      const canvasRenderer = this._renderer;
      const contextSystem = canvasRenderer.canvasContext;
      const context2 = contextSystem?.activeContext;
      if (!context2) return;
      if (instruction.action === "popMaskEnd") {
        const didClip = this._canvasMaskStack.pop();
        if (didClip) {
          context2.restore();
        }
        return;
      }
      if (instruction.inverse) {
        this._warnOnce(
          "inverse",
          "CanvasRenderer: inverse masks are not supported on Canvas2D; ignoring inverse flag."
        );
      }
      const maskContainer = instruction.mask.mask;
      if (!(maskContainer instanceof Graphics)) {
        this._warnOnce(
          "nonGraphics",
          "CanvasRenderer: only Graphics masks are supported in Canvas2D; skipping mask."
        );
        this._canvasMaskStack.push(false);
        return;
      }
      const graphics = maskContainer;
      const instructions = graphics.context?.instructions;
      if (!instructions?.length) {
        this._canvasMaskStack.push(false);
        return;
      }
      context2.save();
      contextSystem.setContextTransform(
        graphics.groupTransform,
        (canvasRenderer._roundPixels | graphics._roundPixels) === 1
      );
      context2.beginPath();
      let drewPath = false;
      let hasHoles = false;
      for (let i2 = 0; i2 < instructions.length; i2++) {
        const instructionData = instructions[i2];
        const action = instructionData.action;
        if (action !== "fill" && action !== "stroke") continue;
        const data = instructionData.data;
        const shapePath = data?.path?.shapePath;
        if (!shapePath?.shapePrimitives?.length) continue;
        const isStroke = action === "stroke";
        const shapePrimitives = shapePath.shapePrimitives;
        for (let j2 = 0; j2 < shapePrimitives.length; j2++) {
          const primitive = shapePrimitives[j2];
          if (!primitive?.shape) continue;
          const transform = primitive.transform;
          const hasTransform = transform && !transform.isIdentity();
          if (hasTransform) {
            context2.save();
            context2.transform(transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty);
          }
          if (isStroke && data.style) {
            drewPath = buildStrokeMaskPath(
              context2,
              primitive.shape,
              data.style
            ) || drewPath;
          } else {
            buildShapePath$1(context2, primitive.shape);
            hasHoles = addHolePaths$1(context2, primitive.holes) || hasHoles;
            drewPath = true;
          }
          if (hasTransform) {
            context2.restore();
          }
        }
      }
      if (!drewPath) {
        context2.restore();
        this._canvasMaskStack.push(false);
        return;
      }
      if (hasHoles) {
        context2.clip("evenodd");
      } else {
        context2.clip();
      }
      this._canvasMaskStack.push(true);
    }
    destroy() {
      this._renderer = null;
      this._warnedMaskTypes = null;
      this._canvasMaskStack = null;
    }
    _warnOnce(key, message) {
      if (this._warnedMaskTypes.has(key)) return;
      this._warnedMaskTypes.add(key);
      warn(message);
    }
  }
  CanvasStencilMaskPipe.extension = {
    type: [
      ExtensionType.CanvasPipes
    ],
    name: "stencilMask"
  };
  class StencilMaskPipe {
    constructor(renderer) {
      this._maskStackHash = {};
      this._maskHash =                 new WeakMap();
      this._renderer = renderer;
    }
    push(mask, _container, instructionSet) {
      var _a;
      const effect = mask;
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      renderer.renderPipes.blendMode.setBlendMode(effect.mask, "none", instructionSet);
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "pushMaskBegin",
        mask,
        inverse: _container._maskOptions.inverse,
        canBundle: false
      });
      const maskContainer = effect.mask;
      maskContainer.includeInBuild = true;
      if (!this._maskHash.has(effect)) {
        this._maskHash.set(effect, {
          instructionsStart: 0,
          instructionsLength: 0
        });
      }
      const maskData = this._maskHash.get(effect);
      maskData.instructionsStart = instructionSet.instructionSize;
      maskContainer.collectRenderables(
        instructionSet,
        renderer,
        null
      );
      maskContainer.includeInBuild = false;
      renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "pushMaskEnd",
        mask,
        inverse: _container._maskOptions.inverse,
        canBundle: false
      });
      const instructionsLength = instructionSet.instructionSize - maskData.instructionsStart - 1;
      maskData.instructionsLength = instructionsLength;
      const renderTargetUid = renderer.renderTarget.renderTarget.uid;
      (_a = this._maskStackHash)[renderTargetUid] ?? (_a[renderTargetUid] = 0);
    }
    pop(mask, _container, instructionSet) {
      const effect = mask;
      const renderer = this._renderer;
      renderer.renderPipes.batch.break(instructionSet);
      renderer.renderPipes.blendMode.setBlendMode(effect.mask, "none", instructionSet);
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "popMaskBegin",
        inverse: _container._maskOptions.inverse,
        canBundle: false
      });
      const maskData = this._maskHash.get(mask);
      for (let i2 = 0; i2 < maskData.instructionsLength; i2++) {
        instructionSet.instructions[instructionSet.instructionSize++] = instructionSet.instructions[maskData.instructionsStart++];
      }
      instructionSet.add({
        renderPipeId: "stencilMask",
        action: "popMaskEnd",
        canBundle: false
      });
    }
    execute(instruction) {
      var _a;
      const renderer = this._renderer;
      const gpuRenderer = renderer;
      const renderTargetUid = renderer.renderTarget.renderTarget.uid;
      let maskStackIndex = (_a = this._maskStackHash)[renderTargetUid] ?? (_a[renderTargetUid] = 0);
      if (instruction.action === "pushMaskBegin") {
        gpuRenderer.renderTarget.ensureDepthStencil();
        gpuRenderer.stencil.setStencilMode(STENCIL_MODES.RENDERING_MASK_ADD, maskStackIndex);
        maskStackIndex++;
        gpuRenderer.colorMask.setMask(0);
      } else if (instruction.action === "pushMaskEnd") {
        if (instruction.inverse) {
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.INVERSE_MASK_ACTIVE, maskStackIndex);
        } else {
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.MASK_ACTIVE, maskStackIndex);
        }
        gpuRenderer.colorMask.setMask(15);
      } else if (instruction.action === "popMaskBegin") {
        gpuRenderer.colorMask.setMask(0);
        if (maskStackIndex !== 0) {
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.RENDERING_MASK_REMOVE, maskStackIndex);
        } else {
          gpuRenderer.renderTarget.clear(null, CLEAR.STENCIL);
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.DISABLED, maskStackIndex);
        }
        maskStackIndex--;
      } else if (instruction.action === "popMaskEnd") {
        if (instruction.inverse) {
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.INVERSE_MASK_ACTIVE, maskStackIndex);
        } else {
          gpuRenderer.stencil.setStencilMode(STENCIL_MODES.MASK_ACTIVE, maskStackIndex);
        }
        gpuRenderer.colorMask.setMask(15);
      }
      this._maskStackHash[renderTargetUid] = maskStackIndex;
    }
    destroy() {
      this._renderer = null;
      this._maskStackHash = null;
      this._maskHash = null;
    }
  }
  StencilMaskPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes
    ],
    name: "stencilMask"
  };
  const FALLBACK_BLEND = "source-over";
  function mapCanvasBlendModesToPixi() {
    const supportsAdvanced = canUseNewCanvasBlendModes();
    const map =                 Object.create(null);
    map.inherit = FALLBACK_BLEND;
    map.none = FALLBACK_BLEND;
    map.normal = "source-over";
    map.add = "lighter";
    map.multiply = supportsAdvanced ? "multiply" : FALLBACK_BLEND;
    map.screen = supportsAdvanced ? "screen" : FALLBACK_BLEND;
    map.overlay = supportsAdvanced ? "overlay" : FALLBACK_BLEND;
    map.darken = supportsAdvanced ? "darken" : FALLBACK_BLEND;
    map.lighten = supportsAdvanced ? "lighten" : FALLBACK_BLEND;
    map["color-dodge"] = supportsAdvanced ? "color-dodge" : FALLBACK_BLEND;
    map["color-burn"] = supportsAdvanced ? "color-burn" : FALLBACK_BLEND;
    map["hard-light"] = supportsAdvanced ? "hard-light" : FALLBACK_BLEND;
    map["soft-light"] = supportsAdvanced ? "soft-light" : FALLBACK_BLEND;
    map.difference = supportsAdvanced ? "difference" : FALLBACK_BLEND;
    map.exclusion = supportsAdvanced ? "exclusion" : FALLBACK_BLEND;
    map.saturation = supportsAdvanced ? "saturation" : FALLBACK_BLEND;
    map.color = supportsAdvanced ? "color" : FALLBACK_BLEND;
    map.luminosity = supportsAdvanced ? "luminosity" : FALLBACK_BLEND;
    map["linear-burn"] = supportsAdvanced ? "color-burn" : FALLBACK_BLEND;
    map["linear-dodge"] = supportsAdvanced ? "color-dodge" : FALLBACK_BLEND;
    map["linear-light"] = supportsAdvanced ? "hard-light" : FALLBACK_BLEND;
    map["pin-light"] = supportsAdvanced ? "hard-light" : FALLBACK_BLEND;
    map["vivid-light"] = supportsAdvanced ? "hard-light" : FALLBACK_BLEND;
    map["hard-mix"] = FALLBACK_BLEND;
    map.negation = supportsAdvanced ? "difference" : FALLBACK_BLEND;
    map["normal-npm"] = map.normal;
    map["add-npm"] = map.add;
    map["screen-npm"] = map.screen;
    map.erase = "destination-out";
    map.subtract = FALLBACK_BLEND;
    map.divide = FALLBACK_BLEND;
    map.min = FALLBACK_BLEND;
    map.max = FALLBACK_BLEND;
    return map;
  }
  const tempMatrix$2 = new Matrix();
  class CanvasContextSystem {

    constructor(renderer) {
      this.activeResolution = 1;
      this.smoothProperty = "imageSmoothingEnabled";
      this.blendModes = mapCanvasBlendModesToPixi();
      this._activeBlendMode = "normal";
      this._projTransform = null;
      this._outerBlend = false;
      this._warnedBlendModes =                 new Set();
      this._renderer = renderer;
    }
    resolutionChange(resolution) {
      this.activeResolution = resolution;
    }

    init() {
      const alpha = this._renderer.background.alpha < 1;
      this.rootContext = this._renderer.canvas.getContext(
        "2d",
        { alpha }
      );
      this.activeContext = this.rootContext;
      this.activeResolution = this._renderer.resolution;
      if (!this.rootContext.imageSmoothingEnabled) {
        const rc = this.rootContext;
        if (rc.webkitImageSmoothingEnabled) {
          this.smoothProperty = "webkitImageSmoothingEnabled";
        } else if (rc.mozImageSmoothingEnabled) {
          this.smoothProperty = "mozImageSmoothingEnabled";
        } else if (rc.oImageSmoothingEnabled) {
          this.smoothProperty = "oImageSmoothingEnabled";
        } else if (rc.msImageSmoothingEnabled) {
          this.smoothProperty = "msImageSmoothingEnabled";
        }
      }
    }

    setContextTransform(transform, roundPixels, localResolution, skipGlobalTransform) {
      const globalTransform = skipGlobalTransform ? Matrix.IDENTITY : this._renderer.globalUniforms.globalUniformData?.worldTransformMatrix || Matrix.IDENTITY;
      let mat = tempMatrix$2;
      mat.copyFrom(globalTransform);
      mat.append(transform);
      const proj = this._projTransform;
      const contextResolution = this.activeResolution;
      localResolution = localResolution || contextResolution;
      if (proj) {
        const finalMat = Matrix.shared;
        finalMat.copyFrom(mat);
        finalMat.prepend(proj);
        mat = finalMat;
      }
      if (roundPixels) {
        this.activeContext.setTransform(
          mat.a * localResolution,
          mat.b * localResolution,
          mat.c * localResolution,
          mat.d * localResolution,
          mat.tx * contextResolution | 0,
          mat.ty * contextResolution | 0
        );
      } else {
        this.activeContext.setTransform(
          mat.a * localResolution,
          mat.b * localResolution,
          mat.c * localResolution,
          mat.d * localResolution,
          mat.tx * contextResolution,
          mat.ty * contextResolution
        );
      }
    }

    clear(clearColor, alpha) {
      const context2 = this.activeContext;
      const renderer = this._renderer;
      context2.clearRect(0, 0, renderer.width, renderer.height);
      if (clearColor) {
        const color = Color.shared.setValue(clearColor);
        context2.globalAlpha = alpha ?? color.alpha;
        context2.fillStyle = color.toHex();
        context2.fillRect(0, 0, renderer.width, renderer.height);
        context2.globalAlpha = 1;
      }
    }

    setBlendMode(blendMode) {
      if (this._activeBlendMode === blendMode) return;
      this._activeBlendMode = blendMode;
      this._outerBlend = false;
      const mappedBlend = this.blendModes[blendMode];
      if (!mappedBlend) {
        if (!this._warnedBlendModes.has(blendMode)) {
          console.warn(
            `CanvasRenderer: blend mode "${blendMode}" is not supported in Canvas2D; falling back to "source-over".`
          );
          this._warnedBlendModes.add(blendMode);
        }
        this.activeContext.globalCompositeOperation = "source-over";
        return;
      }
      this.activeContext.globalCompositeOperation = mappedBlend;
    }

    destroy() {
      this.rootContext = null;
      this.activeContext = null;
      this._warnedBlendModes.clear();
    }
  }
  CanvasContextSystem.extension = {
    type: [
      ExtensionType.CanvasSystem
    ],
    name: "canvasContext"
  };
  class CanvasLimitsSystem {
    constructor() {
      this.maxTextures = 16;
      this.maxBatchableTextures = 16;
      this.maxUniformBindings = 0;
    }
    init() {
    }
  }
  CanvasLimitsSystem.extension = {
    type: [
      ExtensionType.CanvasSystem
    ],
    name: "limits"
  };
  class CustomRenderPipe {
    constructor(renderer) {
      this._renderer = renderer;
    }
    updateRenderable() {
    }
    destroyRenderable() {
    }
    validateRenderable() {
      return false;
    }
    addRenderable(container, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add(container);
    }
    execute(container) {
      if (!container.isRenderable) return;
      container.render(this._renderer);
    }
    destroy() {
      this._renderer = null;
    }
  }
  CustomRenderPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "customRender"
  };
  function executeInstructions(renderGroup, renderer) {
    const instructionSet = renderGroup.instructionSet;
    const instructions = instructionSet.instructions;
    for (let i2 = 0; i2 < instructionSet.instructionSize; i2++) {
      const instruction = instructions[i2];
      renderer[instruction.renderPipeId].execute(instruction);
    }
  }
  class RenderGroupPipe {
    constructor(renderer) {
      this._renderer = renderer;
    }
    addRenderGroup(renderGroup, instructionSet) {
      if (renderGroup.isCachedAsTexture) {
        this._addRenderableCacheAsTexture(renderGroup, instructionSet);
      } else {
        this._addRenderableDirect(renderGroup, instructionSet);
      }
    }
    execute(renderGroup) {
      if (!renderGroup.isRenderable) return;
      if (renderGroup.isCachedAsTexture) {
        this._executeCacheAsTexture(renderGroup);
      } else {
        this._executeDirect(renderGroup);
      }
    }
    destroy() {
      this._renderer = null;
    }
    _addRenderableDirect(renderGroup, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      if (renderGroup._batchableRenderGroup) {
        BigPool.return(renderGroup._batchableRenderGroup);
        renderGroup._batchableRenderGroup = null;
      }
      instructionSet.add(renderGroup);
    }
    _addRenderableCacheAsTexture(renderGroup, instructionSet) {
      const batchableRenderGroup = renderGroup._batchableRenderGroup ?? (renderGroup._batchableRenderGroup = BigPool.get(BatchableSprite));
      batchableRenderGroup.renderable = renderGroup.root;
      batchableRenderGroup.transform = renderGroup.root.relativeGroupTransform;
      batchableRenderGroup.texture = renderGroup.texture;
      batchableRenderGroup.bounds = renderGroup._textureBounds;
      instructionSet.add(renderGroup);
      this._renderer.renderPipes.blendMode.pushBlendMode(renderGroup, renderGroup.root.groupBlendMode, instructionSet);
      this._renderer.renderPipes.batch.addToBatch(batchableRenderGroup, instructionSet);
      this._renderer.renderPipes.blendMode.popBlendMode(instructionSet);
    }
    _executeCacheAsTexture(renderGroup) {
      if (renderGroup.textureNeedsUpdate) {
        renderGroup.textureNeedsUpdate = false;
        const worldTransformMatrix = new Matrix().translate(
          -renderGroup._textureBounds.x,
          -renderGroup._textureBounds.y
        );
        this._renderer.renderTarget.push(renderGroup.texture, true, null, renderGroup.texture.frame);
        this._renderer.globalUniforms.push({
          worldTransformMatrix,
          worldColor: 4294967295,
          offset: { x: 0, y: 0 }
        });
        executeInstructions(renderGroup, this._renderer.renderPipes);
        this._renderer.renderTarget.finishRenderPass();
        this._renderer.renderTarget.pop();
        this._renderer.globalUniforms.pop();
      }
      renderGroup._batchableRenderGroup._batcher.updateElement(renderGroup._batchableRenderGroup);
      renderGroup._batchableRenderGroup._batcher.geometry.buffers[0].update();
    }
    _executeDirect(renderGroup) {
      this._renderer.globalUniforms.push({
        worldTransformMatrix: renderGroup.inverseParentTextureTransform,
        worldColor: renderGroup.worldColorAlpha
      });
      executeInstructions(renderGroup, this._renderer.renderPipes);
      this._renderer.globalUniforms.pop();
    }
  }
  RenderGroupPipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "renderGroup"
  };
  const emptyCanvasStyle = "#808080";
  const tempMatrix$1 = new Matrix();
  const tempTextureMatrix = new Matrix();
  const tempGradientMatrix = new Matrix();
  const tempPatternMatrix = new Matrix();
  function fillTriangles(context2, vertices, indices) {
    context2.beginPath();
    for (let i2 = 0; i2 < indices.length; i2 += 3) {
      const i0 = indices[i2] * 2;
      const i1 = indices[i2 + 1] * 2;
      const i22 = indices[i2 + 2] * 2;
      context2.moveTo(vertices[i0], vertices[i0 + 1]);
      context2.lineTo(vertices[i1], vertices[i1 + 1]);
      context2.lineTo(vertices[i22], vertices[i22 + 1]);
      context2.closePath();
    }
    context2.fill();
  }
  function colorToHex(color) {
    const clamped = color & 16777215;
    return `#${clamped.toString(16).padStart(6, "0")}`;
  }
  function buildRoundedRectPath(context2, x2, y2, width, height, radius) {
    radius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    context2.moveTo(x2 + radius, y2);
    context2.lineTo(x2 + width - radius, y2);
    context2.quadraticCurveTo(x2 + width, y2, x2 + width, y2 + radius);
    context2.lineTo(x2 + width, y2 + height - radius);
    context2.quadraticCurveTo(x2 + width, y2 + height, x2 + width - radius, y2 + height);
    context2.lineTo(x2 + radius, y2 + height);
    context2.quadraticCurveTo(x2, y2 + height, x2, y2 + height - radius);
    context2.lineTo(x2, y2 + radius);
    context2.quadraticCurveTo(x2, y2, x2 + radius, y2);
  }
  function buildShapePath(context2, shape) {
    switch (shape.type) {
      case "rectangle": {
        const rect = shape;
        context2.rect(rect.x, rect.y, rect.width, rect.height);
        break;
      }
      case "roundedRectangle": {
        const rect = shape;
        buildRoundedRectPath(context2, rect.x, rect.y, rect.width, rect.height, rect.radius);
        break;
      }
      case "circle": {
        const circle = shape;
        context2.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        break;
      }
      case "ellipse": {
        const ellipse = shape;
        if (context2.ellipse) {
          context2.ellipse(ellipse.x, ellipse.y, ellipse.halfWidth, ellipse.halfHeight, 0, 0, Math.PI * 2);
        } else {
          context2.save();
          context2.translate(ellipse.x, ellipse.y);
          context2.scale(ellipse.halfWidth, ellipse.halfHeight);
          context2.arc(0, 0, 1, 0, Math.PI * 2);
          context2.restore();
        }
        break;
      }
      case "triangle": {
        const tri = shape;
        context2.moveTo(tri.x, tri.y);
        context2.lineTo(tri.x2, tri.y2);
        context2.lineTo(tri.x3, tri.y3);
        context2.closePath();
        break;
      }
      case "polygon":
      default: {
        const poly = shape;
        const points = poly.points;
        if (!points?.length) break;
        context2.moveTo(points[0], points[1]);
        for (let i2 = 2; i2 < points.length; i2 += 2) {
          context2.lineTo(points[i2], points[i2 + 1]);
        }
        if (poly.closePath) {
          context2.closePath();
        }
        break;
      }
    }
  }
  function addHolePaths(context2, holes) {
    if (!holes?.length) return false;
    for (let i2 = 0; i2 < holes.length; i2++) {
      const hole = holes[i2];
      if (!hole?.shape) continue;
      const transform = hole.transform;
      const hasTransform = transform && !transform.isIdentity();
      if (hasTransform) {
        context2.save();
        context2.transform(transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty);
      }
      buildShapePath(context2, hole.shape);
      if (hasTransform) {
        context2.restore();
      }
    }
    return true;
  }
  function getCanvasStyle(style, tint, textureMatrix, currentTransform) {
    const fill = style.fill;
    if (fill instanceof FillGradient) {
      fill.buildGradient();
      const gradientTexture = fill.texture;
      if (gradientTexture) {
        const pattern = canvasUtils.getTintedPattern(gradientTexture, tint);
        const patternMatrix = textureMatrix ? tempPatternMatrix.copyFrom(textureMatrix).scale(gradientTexture.source.pixelWidth, gradientTexture.source.pixelHeight) : tempPatternMatrix.copyFrom(fill.transform);
        if (currentTransform && !style.textureSpace) {
          patternMatrix.append(currentTransform);
        }
        canvasUtils.applyPatternTransform(pattern, patternMatrix);
        return pattern;
      }
    }
    if (fill instanceof FillPattern) {
      const pattern = canvasUtils.getTintedPattern(fill.texture, tint);
      canvasUtils.applyPatternTransform(pattern, fill.transform);
      return pattern;
    }
    const texture = style.texture;
    if (texture && texture !== Texture.WHITE) {
      if (!texture.source.resource) {
        return emptyCanvasStyle;
      }
      const pattern = canvasUtils.getTintedPattern(texture, tint);
      const patternMatrix = textureMatrix ? tempPatternMatrix.copyFrom(textureMatrix).scale(texture.source.pixelWidth, texture.source.pixelHeight) : style.matrix;
      canvasUtils.applyPatternTransform(pattern, patternMatrix);
      return pattern;
    }
    return colorToHex(tint);
  }
  class CanvasGraphicsAdaptor {
    constructor() {
      this.shader = null;
    }
    contextChange(renderer) {
    }
    execute(graphicsPipe, renderable) {
      const renderer = graphicsPipe.renderer;
      const contextSystem = renderer.canvasContext;
      const context2 = contextSystem.activeContext;
      const baseTransform = renderable.groupTransform;
      const globalColor = renderer.globalUniforms.globalUniformData?.worldColor ?? 4294967295;
      const groupColorAlpha = renderable.groupColorAlpha;
      const globalAlpha = (globalColor >>> 24 & 255) / 255;
      const groupAlphaValue = (groupColorAlpha >>> 24 & 255) / 255;
      const filterAlpha = renderer.filter?.alphaMultiplier ?? 1;
      const groupAlpha = globalAlpha * groupAlphaValue * filterAlpha;
      if (groupAlpha <= 0) return;
      const globalTint = globalColor & 16777215;
      const groupTintBGR = groupColorAlpha & 16777215;
      const groupTint = bgr2rgb(multiplyHexColors(groupTintBGR, globalTint));
      const roundPixels = renderer._roundPixels | renderable._roundPixels;
      context2.save();
      contextSystem.setContextTransform(baseTransform, roundPixels === 1);
      contextSystem.setBlendMode(renderable.groupBlendMode);
      const instructions = renderable.context.instructions;
      for (let i2 = 0; i2 < instructions.length; i2++) {
        const instruction = instructions[i2];
        if (instruction.action === "texture") {
          const data2 = instruction.data;
          const texture = data2.image;
          const source2 = texture ? canvasUtils.getCanvasSource(texture) : null;
          if (!source2) continue;
          const alpha2 = data2.alpha * groupAlpha;
          if (alpha2 <= 0) continue;
          const tint2 = multiplyHexColors(data2.style, groupTint);
          context2.globalAlpha = alpha2;
          let drawSource = source2;
          if (tint2 !== 16777215) {
            drawSource = canvasUtils.getTintedCanvas({ texture }, tint2);
          }
          const frame = texture.frame;
          const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
          let sx = frame.x * resolution;
          let sy = frame.y * resolution;
          const sw = frame.width * resolution;
          const sh = frame.height * resolution;
          if (drawSource !== source2) {
            sx = 0;
            sy = 0;
          }
          const transform = data2.transform;
          const hasTransform = transform && !transform.isIdentity();
          const rotate = texture.rotate;
          if (hasTransform || rotate) {
            tempMatrix$1.copyFrom(baseTransform);
            if (hasTransform) {
              tempMatrix$1.append(transform);
            }
            if (rotate) {
              groupD8.matrixAppendRotationInv(tempMatrix$1, rotate, data2.dx, data2.dy, data2.dw, data2.dh);
            }
            contextSystem.setContextTransform(tempMatrix$1, roundPixels === 1);
          } else {
            contextSystem.setContextTransform(baseTransform, roundPixels === 1);
          }
          context2.drawImage(
            drawSource,
            sx,
            sy,
            drawSource === source2 ? sw : drawSource.width,
            drawSource === source2 ? sh : drawSource.height,
            rotate ? 0 : data2.dx,
            rotate ? 0 : data2.dy,
            data2.dw,
            data2.dh
          );
          if (hasTransform || rotate) {
            contextSystem.setContextTransform(baseTransform, roundPixels === 1);
          }
          continue;
        }
        const data = instruction.data;
        const shapePath = data?.path?.shapePath;
        if (!shapePath?.shapePrimitives?.length) continue;
        const style = data.style;
        const tint = multiplyHexColors(style.color, groupTint);
        const alpha = style.alpha * groupAlpha;
        if (alpha <= 0) continue;
        const isStroke = instruction.action === "stroke";
        context2.globalAlpha = alpha;
        if (isStroke) {
          const strokeStyle = style;
          context2.lineWidth = strokeStyle.width;
          context2.lineCap = strokeStyle.cap;
          context2.lineJoin = strokeStyle.join;
          context2.miterLimit = strokeStyle.miterLimit;
        }
        const shapePrimitives = shapePath.shapePrimitives;
        if (!isStroke && data.hole?.shapePath?.shapePrimitives?.length) {
          const lastShape = shapePrimitives[shapePrimitives.length - 1];
          lastShape.holes = data.hole.shapePath.shapePrimitives;
        }
        for (let j2 = 0; j2 < shapePrimitives.length; j2++) {
          const primitive = shapePrimitives[j2];
          if (!primitive?.shape) continue;
          const transform = primitive.transform;
          const hasTransform = transform && !transform.isIdentity();
          const hasTexture = style.texture && style.texture !== Texture.WHITE;
          const textureTransform = style.textureSpace === "global" ? transform : null;
          const textureMatrix = hasTexture ? generateTextureMatrix(tempTextureMatrix, style, primitive.shape, textureTransform) : null;
          const currentTransform = hasTransform ? tempGradientMatrix.copyFrom(baseTransform).append(transform) : baseTransform;
          const canvasStyle = getCanvasStyle(
            style,
            tint,
            textureMatrix,
            currentTransform
          );
          if (hasTransform) {
            context2.save();
            context2.transform(transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty);
          }
          if (isStroke) {
            const strokeStyle = style;
            const useStrokeGeometry = strokeStyle.alignment !== 0.5 && !strokeStyle.pixelLine;
            if (useStrokeGeometry) {
              const points = [];
              const vertices = [];
              const indices = [];
              const shapeBuilder = shapeBuilders[primitive.shape.type];
              if (shapeBuilder?.build(primitive.shape, points)) {
                const close = primitive.shape.closePath ?? true;
                buildLine(points, strokeStyle, false, close, vertices, indices);
                context2.fillStyle = canvasStyle;
                fillTriangles(context2, vertices, indices);
              } else {
                context2.strokeStyle = canvasStyle;
                context2.beginPath();
                buildShapePath(context2, primitive.shape);
                context2.stroke();
              }
            } else {
              context2.strokeStyle = canvasStyle;
              context2.beginPath();
              buildShapePath(context2, primitive.shape);
              context2.stroke();
            }
          } else {
            context2.fillStyle = canvasStyle;
            context2.beginPath();
            buildShapePath(context2, primitive.shape);
            const hasHoles = addHolePaths(context2, primitive.holes);
            if (hasHoles) {
              context2.fill("evenodd");
            } else {
              context2.fill();
            }
          }
          if (hasTransform) {
            context2.restore();
          }
        }
      }
      context2.restore();
    }
    destroy() {
      this.shader = null;
    }
  }
  CanvasGraphicsAdaptor.extension = {
    type: [
      ExtensionType.CanvasPipesAdaptor
    ],
    name: "graphics"
  };
  class SpritePipe {
    constructor(renderer) {
      this._renderer = renderer;
    }
    addRenderable(sprite, instructionSet) {
      const gpuSprite = this._getGpuSprite(sprite);
      if (sprite.didViewUpdate) this._updateBatchableSprite(sprite, gpuSprite);
      this._renderer.renderPipes.batch.addToBatch(gpuSprite, instructionSet);
    }
    updateRenderable(sprite) {
      const gpuSprite = this._getGpuSprite(sprite);
      if (sprite.didViewUpdate) this._updateBatchableSprite(sprite, gpuSprite);
      gpuSprite._batcher.updateElement(gpuSprite);
    }
    validateRenderable(sprite) {
      const gpuSprite = this._getGpuSprite(sprite);
      return !gpuSprite._batcher.checkAndUpdateTexture(
        gpuSprite,
        sprite._texture
      );
    }
    _updateBatchableSprite(sprite, batchableSprite) {
      batchableSprite.bounds = sprite.visualBounds;
      batchableSprite.texture = sprite._texture;
    }
    _getGpuSprite(sprite) {
      return sprite._gpuData[this._renderer.uid] || this._initGPUSprite(sprite);
    }
    _initGPUSprite(sprite) {
      const batchableSprite = new BatchableSprite();
      batchableSprite.renderable = sprite;
      batchableSprite.transform = sprite.groupTransform;
      batchableSprite.texture = sprite._texture;
      batchableSprite.bounds = sprite.visualBounds;
      batchableSprite.roundPixels = this._renderer._roundPixels | sprite._roundPixels;
      sprite._gpuData[this._renderer.uid] = batchableSprite;
      return batchableSprite;
    }
    destroy() {
      this._renderer = null;
    }
  }
  SpritePipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "sprite"
  };
  const BLEND_MODE_FILTERS = {};
  extensions.handle(ExtensionType.BlendMode, (value) => {
    if (!value.name) {
      throw new Error("BlendMode extension must have a name property");
    }
    BLEND_MODE_FILTERS[value.name] = value.ref;
  }, (value) => {
    delete BLEND_MODE_FILTERS[value.name];
  });
  class BlendModePipe {
    constructor(renderer) {
      this._blendModeStack = [];
      this._isAdvanced = false;
      this._filterHash =                 Object.create(null);
      this._renderer = renderer;
      this._renderer.runners.prerender.add(this);
    }
    prerender() {
      this._activeBlendMode = "normal";
      this._isAdvanced = false;
    }

    pushBlendMode(renderable, blendMode, instructionSet) {
      this._blendModeStack.push(blendMode);
      this.setBlendMode(renderable, blendMode, instructionSet);
    }

    popBlendMode(instructionSet) {
      this._blendModeStack.pop();
      const blendMode = this._blendModeStack[this._activeBlendMode.length - 1] ?? "normal";
      this.setBlendMode(null, blendMode, instructionSet);
    }

    setBlendMode(renderable, blendMode, instructionSet) {
      const isRenderGroup = renderable instanceof RenderGroup;
      if (this._activeBlendMode === blendMode) {
        if (this._isAdvanced && renderable && !isRenderGroup) {
          this._renderableList?.push(renderable);
        }
        return;
      }
      if (this._isAdvanced) this._endAdvancedBlendMode(instructionSet);
      this._activeBlendMode = blendMode;
      if (!renderable) return;
      this._isAdvanced = !!BLEND_MODE_FILTERS[blendMode];
      if (this._isAdvanced) this._beginAdvancedBlendMode(renderable, instructionSet);
    }
    _beginAdvancedBlendMode(renderable, instructionSet) {
      this._renderer.renderPipes.batch.break(instructionSet);
      const blendMode = this._activeBlendMode;
      if (!BLEND_MODE_FILTERS[blendMode]) {
        warn(`Unable to assign BlendMode: '${blendMode}'. You may want to include: import 'pixi.js/advanced-blend-modes'`);
        return;
      }
      const filterEffect = this._ensureFilterEffect(blendMode);
      const isRenderGroup = renderable instanceof RenderGroup;
      const instruction = {
        renderPipeId: "filter",
        action: "pushFilter",
        filterEffect,
        renderables: isRenderGroup ? null : [renderable],
        container: isRenderGroup ? renderable.root : null,
        canBundle: false
      };
      this._renderableList = instruction.renderables;
      instructionSet.add(instruction);
    }
    _ensureFilterEffect(blendMode) {
      let filterEffect = this._filterHash[blendMode];
      if (!filterEffect) {
        filterEffect = this._filterHash[blendMode] = new FilterEffect();
        filterEffect.filters = [new BLEND_MODE_FILTERS[blendMode]()];
      }
      return filterEffect;
    }
    _endAdvancedBlendMode(instructionSet) {
      this._isAdvanced = false;
      this._renderableList = null;
      this._renderer.renderPipes.batch.break(instructionSet);
      instructionSet.add({
        renderPipeId: "filter",
        action: "popFilter",
        canBundle: false
      });
    }

    buildStart() {
      this._isAdvanced = false;
    }

    buildEnd(instructionSet) {
      if (!this._isAdvanced) return;
      this._endAdvancedBlendMode(instructionSet);
    }

    destroy() {
      this._renderer = null;
      this._renderableList = null;
      for (const i2 in this._filterHash) {
        this._filterHash[i2].destroy();
      }
      this._filterHash = null;
    }
  }
  BlendModePipe.extension = {
    type: [
      ExtensionType.WebGLPipes,
      ExtensionType.WebGPUPipes,
      ExtensionType.CanvasPipes
    ],
    name: "blendMode"
  };
  function clearList(list, index) {
    index || (index = 0);
    for (let j2 = index; j2 < list.length; j2++) {
      if (list[j2]) {
        list[j2] = null;
      } else {
        break;
      }
    }
  }
  const tempContainer = new Container();
  const UPDATE_BLEND_COLOR_VISIBLE = UPDATE_VISIBLE | UPDATE_COLOR | UPDATE_BLEND;
  function updateRenderGroupTransforms(renderGroup, updateChildRenderGroups = false) {
    updateRenderGroupTransform(renderGroup);
    const childrenToUpdate = renderGroup.childrenToUpdate;
    const updateTick = renderGroup.updateTick++;
    for (const j2 in childrenToUpdate) {
      const renderGroupDepth = Number(j2);
      const childrenAtDepth = childrenToUpdate[j2];
      const list = childrenAtDepth.list;
      const index = childrenAtDepth.index;
      for (let i2 = 0; i2 < index; i2++) {
        const child = list[i2];
        if (child.parentRenderGroup === renderGroup && child.relativeRenderGroupDepth === renderGroupDepth) {
          updateTransformAndChildren(child, updateTick, 0);
        }
      }
      clearList(list, index);
      childrenAtDepth.index = 0;
    }
    if (updateChildRenderGroups) {
      for (let i2 = 0; i2 < renderGroup.renderGroupChildren.length; i2++) {
        updateRenderGroupTransforms(renderGroup.renderGroupChildren[i2], updateChildRenderGroups);
      }
    }
  }
  function updateRenderGroupTransform(renderGroup) {
    const root = renderGroup.root;
    let worldAlpha;
    if (renderGroup.renderGroupParent) {
      const renderGroupParent = renderGroup.renderGroupParent;
      renderGroup.worldTransform.appendFrom(
        root.relativeGroupTransform,
        renderGroupParent.worldTransform
      );
      renderGroup.worldColor = multiplyColors(
        root.groupColor,
        renderGroupParent.worldColor
      );
      worldAlpha = root.groupAlpha * renderGroupParent.worldAlpha;
    } else {
      renderGroup.worldTransform.copyFrom(root.localTransform);
      renderGroup.worldColor = root.localColor;
      worldAlpha = root.localAlpha;
    }
    worldAlpha = worldAlpha < 0 ? 0 : worldAlpha > 1 ? 1 : worldAlpha;
    renderGroup.worldAlpha = worldAlpha;
    renderGroup.worldColorAlpha = renderGroup.worldColor + ((worldAlpha * 255 | 0) << 24);
  }
  function updateTransformAndChildren(container, updateTick, updateFlags) {
    if (updateTick === container.updateTick) return;
    container.updateTick = updateTick;
    container.didChange = false;
    const localTransform = container.localTransform;
    container.updateLocalTransform();
    const parent = container.parent;
    if (parent && !parent.renderGroup) {
      updateFlags |= container._updateFlags;
      container.relativeGroupTransform.appendFrom(
        localTransform,
        parent.relativeGroupTransform
      );
      if (updateFlags & UPDATE_BLEND_COLOR_VISIBLE) {
        updateColorBlendVisibility(container, parent, updateFlags);
      }
    } else {
      updateFlags = container._updateFlags;
      container.relativeGroupTransform.copyFrom(localTransform);
      if (updateFlags & UPDATE_BLEND_COLOR_VISIBLE) {
        updateColorBlendVisibility(container, tempContainer, updateFlags);
      }
    }
    if (!container.renderGroup) {
      const children = container.children;
      const length2 = children.length;
      for (let i2 = 0; i2 < length2; i2++) {
        updateTransformAndChildren(children[i2], updateTick, updateFlags);
      }
      const renderGroup = container.parentRenderGroup;
      const renderable = container;
      if (renderable.renderPipeId && !renderGroup.structureDidChange) {
        renderGroup.updateRenderable(renderable);
      }
    }
  }
  function updateColorBlendVisibility(container, parent, updateFlags) {
    if (updateFlags & UPDATE_COLOR) {
      container.groupColor = multiplyColors(
        container.localColor,
        parent.groupColor
      );
      let groupAlpha = container.localAlpha * parent.groupAlpha;
      groupAlpha = groupAlpha < 0 ? 0 : groupAlpha > 1 ? 1 : groupAlpha;
      container.groupAlpha = groupAlpha;
      container.groupColorAlpha = container.groupColor + ((groupAlpha * 255 | 0) << 24);
    }
    if (updateFlags & UPDATE_BLEND) {
      container.groupBlendMode = container.localBlendMode === "inherit" ? parent.groupBlendMode : container.localBlendMode;
    }
    if (updateFlags & UPDATE_VISIBLE) {
      container.globalDisplayStatus = container.localDisplayStatus & parent.globalDisplayStatus;
    }
    container._updateFlags = 0;
  }
  function validateRenderables(renderGroup, renderPipes2) {
    const { list } = renderGroup.childrenRenderablesToUpdate;
    let rebuildRequired = false;
    for (let i2 = 0; i2 < renderGroup.childrenRenderablesToUpdate.index; i2++) {
      const container = list[i2];
      const renderable = container;
      const pipe = renderPipes2[renderable.renderPipeId];
      rebuildRequired = pipe.validateRenderable(container);
      if (rebuildRequired) {
        break;
      }
    }
    renderGroup.structureDidChange = rebuildRequired;
    return rebuildRequired;
  }
  const tempMatrix = new Matrix();
  class RenderGroupSystem {
    constructor(renderer) {
      this._renderer = renderer;
    }
    render({ container, transform }) {
      const parent = container.parent;
      const renderGroupParent = container.renderGroup.renderGroupParent;
      container.parent = null;
      container.renderGroup.renderGroupParent = null;
      const renderer = this._renderer;
      const originalLocalTransform = tempMatrix;
      if (transform) {
        originalLocalTransform.copyFrom(container.renderGroup.localTransform);
        container.renderGroup.localTransform.copyFrom(transform);
      }
      const renderPipes2 = renderer.renderPipes;
      this._updateCachedRenderGroups(container.renderGroup, null);
      this._updateRenderGroups(container.renderGroup);
      renderer.globalUniforms.start({
        worldTransformMatrix: transform ? container.renderGroup.localTransform : container.renderGroup.worldTransform,
        worldColor: container.renderGroup.worldColorAlpha
      });
      executeInstructions(container.renderGroup, renderPipes2);
      if (renderPipes2.uniformBatch) {
        renderPipes2.uniformBatch.renderEnd();
      }
      if (transform) {
        container.renderGroup.localTransform.copyFrom(originalLocalTransform);
      }
      container.parent = parent;
      container.renderGroup.renderGroupParent = renderGroupParent;
    }
    destroy() {
      this._renderer = null;
    }
    _updateCachedRenderGroups(renderGroup, closestCacheAsTexture) {
      renderGroup._parentCacheAsTextureRenderGroup = closestCacheAsTexture;
      if (renderGroup.isCachedAsTexture) {
        if (!renderGroup.textureNeedsUpdate) return;
        closestCacheAsTexture = renderGroup;
      }
      for (let i2 = renderGroup.renderGroupChildren.length - 1; i2 >= 0; i2--) {
        this._updateCachedRenderGroups(renderGroup.renderGroupChildren[i2], closestCacheAsTexture);
      }
      renderGroup.invalidateMatrices();
      if (renderGroup.isCachedAsTexture) {
        if (renderGroup.textureNeedsUpdate) {
          const bounds = renderGroup.root.getLocalBounds();
          const renderer = this._renderer;
          const resolution = renderGroup.textureOptions.resolution || renderer.view.resolution;
          const antialias = renderGroup.textureOptions.antialias ?? renderer.view.antialias;
          const scaleMode = renderGroup.textureOptions.scaleMode ?? "linear";
          const lastTexture = renderGroup.texture;
          bounds.ceil();
          if (renderGroup.texture) {
            TexturePool.returnTexture(renderGroup.texture, true);
          }
          const texture = TexturePool.getOptimalTexture(
            bounds.width,
            bounds.height,
            resolution,
            antialias
          );
          texture._source.style = new TextureStyle({ scaleMode });
          renderGroup.texture = texture;
          renderGroup._textureBounds || (renderGroup._textureBounds = new Bounds());
          renderGroup._textureBounds.copyFrom(bounds);
          if (lastTexture !== renderGroup.texture) {
            if (renderGroup.renderGroupParent) {
              renderGroup.renderGroupParent.structureDidChange = true;
            }
          }
        }
      } else if (renderGroup.texture) {
        TexturePool.returnTexture(renderGroup.texture, true);
        renderGroup.texture = null;
      }
    }
    _updateRenderGroups(renderGroup) {
      const renderer = this._renderer;
      const renderPipes2 = renderer.renderPipes;
      renderGroup.runOnRender(renderer);
      renderGroup.instructionSet.renderPipes = renderPipes2;
      if (!renderGroup.structureDidChange) {
        validateRenderables(renderGroup, renderPipes2);
      } else {
        clearList(renderGroup.childrenRenderablesToUpdate.list, 0);
      }
      updateRenderGroupTransforms(renderGroup);
      if (renderGroup.structureDidChange) {
        renderGroup.structureDidChange = false;
        this._buildInstructions(renderGroup, renderer);
      } else {
        this._updateRenderables(renderGroup);
      }
      renderGroup.childrenRenderablesToUpdate.index = 0;
      renderer.renderPipes.batch.upload(renderGroup.instructionSet);
      if (renderGroup.isCachedAsTexture && !renderGroup.textureNeedsUpdate) return;
      for (let i2 = 0; i2 < renderGroup.renderGroupChildren.length; i2++) {
        this._updateRenderGroups(renderGroup.renderGroupChildren[i2]);
      }
    }
    _updateRenderables(renderGroup) {
      const { list, index } = renderGroup.childrenRenderablesToUpdate;
      for (let i2 = 0; i2 < index; i2++) {
        const container = list[i2];
        if (container.didViewUpdate) {
          renderGroup.updateRenderable(container);
        }
      }
      clearList(list, index);
    }
    _buildInstructions(renderGroup, rendererOrPipes) {
      const root = renderGroup.root;
      const instructionSet = renderGroup.instructionSet;
      instructionSet.reset();
      const renderer = rendererOrPipes.renderPipes ? rendererOrPipes : rendererOrPipes.batch.renderer;
      const renderPipes2 = renderer.renderPipes;
      renderPipes2.batch.buildStart(instructionSet);
      renderPipes2.blendMode.buildStart();
      renderPipes2.colorMask.buildStart();
      if (root.sortableChildren) {
        root.sortChildren();
      }
      root.collectRenderablesWithEffects(instructionSet, renderer, null);
      renderPipes2.batch.buildEnd(instructionSet);
      renderPipes2.blendMode.buildEnd(instructionSet);
    }
  }
  RenderGroupSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "renderGroup"
  };
  const _BackgroundSystem = class _BackgroundSystem2 {
    constructor() {
      this.clearBeforeRender = true;
      this._backgroundColor = new Color(0);
      this.color = this._backgroundColor;
      this.alpha = 1;
    }

    init(options) {
      options = { ..._BackgroundSystem2.defaultOptions, ...options };
      this.clearBeforeRender = options.clearBeforeRender;
      this.color = options.background || options.backgroundColor || this._backgroundColor;
      this.alpha = options.backgroundAlpha;
      this._backgroundColor.setAlpha(options.backgroundAlpha);
    }

    get color() {
      return this._backgroundColor;
    }
    set color(value) {
      const incoming = Color.shared.setValue(value);
      if (incoming.alpha < 1 && this._backgroundColor.alpha === 1) {
        warn(
          "Cannot set a transparent background on an opaque canvas. To enable transparency, set backgroundAlpha < 1 when initializing your Application."
        );
      }
      this._backgroundColor.setValue(value);
    }

    get alpha() {
      return this._backgroundColor.alpha;
    }
    set alpha(value) {
      this._backgroundColor.setAlpha(value);
    }

    get colorRgba() {
      return this._backgroundColor.toArray();
    }

    destroy() {
    }
  };
  _BackgroundSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "background",
    priority: 0
  };
  _BackgroundSystem.defaultOptions = {

    backgroundAlpha: 1,

    backgroundColor: 0,

    clearBeforeRender: true
  };
  let BackgroundSystem = _BackgroundSystem;
  const imageTypes = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp"
  };
  const _ExtractSystem = class _ExtractSystem2 {

    constructor(renderer) {
      this._renderer = renderer;
    }
    _normalizeOptions(options, defaults = {}) {
      if (options instanceof Container || options instanceof Texture) {
        return {
          target: options,
          ...defaults
        };
      }
      return {
        ...defaults,
        ...options
      };
    }

    async image(options) {
      const image = DOMAdapter.get().createImage();
      image.src = await this.base64(options);
      return image;
    }

    async base64(options) {
      options = this._normalizeOptions(
        options,
        _ExtractSystem2.defaultImageOptions
      );
      const { format, quality } = options;
      const canvas = this.canvas(options);
      if (canvas.toBlob !== void 0) {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("ICanvas.toBlob failed!"));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }, imageTypes[format], quality);
        });
      }
      if (canvas.toDataURL !== void 0) {
        return canvas.toDataURL(imageTypes[format], quality);
      }
      if (canvas.convertToBlob !== void 0) {
        const blob = await canvas.convertToBlob({ type: imageTypes[format], quality });
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      throw new Error("Extract.base64() requires ICanvas.toDataURL, ICanvas.toBlob, or ICanvas.convertToBlob to be implemented");
    }

    canvas(options) {
      options = this._normalizeOptions(options);
      const target = options.target;
      const renderer = this._renderer;
      if (target instanceof Texture) {
        return renderer.texture.generateCanvas(target);
      }
      const texture = renderer.textureGenerator.generateTexture(options);
      const canvas = renderer.texture.generateCanvas(texture);
      texture.destroy(true);
      return canvas;
    }

    pixels(options) {
      options = this._normalizeOptions(options);
      const target = options.target;
      const renderer = this._renderer;
      const texture = target instanceof Texture ? target : renderer.textureGenerator.generateTexture(options);
      const pixelInfo = renderer.texture.getPixels(texture);
      if (target instanceof Container) {
        texture.destroy(true);
      }
      return pixelInfo;
    }

    texture(options) {
      options = this._normalizeOptions(options);
      if (options.target instanceof Texture) return options.target;
      return this._renderer.textureGenerator.generateTexture(options);
    }

    download(options) {
      options = this._normalizeOptions(options);
      const canvas = this.canvas(options);
      const link = document.createElement("a");
      link.download = options.filename ?? "image.png";
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    log(options) {
      const width = options.width ?? 200;
      options = this._normalizeOptions(options);
      const canvas = this.canvas(options);
      const base64 = canvas.toDataURL();
      console.log(`[Pixi Texture] ${canvas.width}px ${canvas.height}px`);
      const style = [
        "font-size: 1px;",
        `padding: ${width}px ${300}px;`,
        `background: url(${base64}) no-repeat;`,
        "background-size: contain;"
      ].join(" ");
      console.log("%c ", style);
    }
    destroy() {
      this._renderer = null;
    }
  };
  _ExtractSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "extract"
  };
  _ExtractSystem.defaultImageOptions = {
    format: "png",
    quality: 1
  };
  let ExtractSystem = _ExtractSystem;
  class RenderTexture extends Texture {

    static create(options) {
      const { dynamic, textureOptions, ...rest } = options;
      return new RenderTexture({
        ...textureOptions,
        source: new TextureSource(rest),
        dynamic: dynamic ?? false
      });
    }

    resize(width, height, resolution) {
      this.source.resize(width, height, resolution);
      return this;
    }
  }
  const tempRect = new Rectangle();
  const tempBounds = new Bounds();
  const noColor = [0, 0, 0, 0];
  class GenerateTextureSystem {
    constructor(renderer) {
      this._renderer = renderer;
    }

    generateTexture(options) {
      if (options instanceof Container) {
        options = {
          target: options,
          frame: void 0,
          textureSourceOptions: {},
          resolution: void 0
        };
      }
      const resolution = options.resolution || this._renderer.resolution;
      const antialias = options.antialias || this._renderer.view.antialias;
      const container = options.target;
      let clearColor = options.clearColor;
      if (clearColor) {
        const isRGBAArray = Array.isArray(clearColor) && clearColor.length === 4;
        clearColor = isRGBAArray ? clearColor : Color.shared.setValue(clearColor).toArray();
      } else {
        clearColor = noColor;
      }
      const region = options.frame?.copyTo(tempRect) || getLocalBounds(container, tempBounds).rectangle;
      const textureOptions = options.defaultAnchor && {
        defaultAnchor: options.defaultAnchor
      };
      region.width = Math.max(region.width, 1 / resolution) | 0;
      region.height = Math.max(region.height, 1 / resolution) | 0;
      const target = RenderTexture.create({
        ...options.textureSourceOptions,
        width: region.width,
        height: region.height,
        resolution,
        antialias,
        textureOptions
      });
      const transform = Matrix.shared.translate(-region.x, -region.y);
      this._renderer.render({
        container,
        transform,
        target,
        clearColor
      });
      target.source.updateMipmaps();
      return target;
    }
    destroy() {
      this._renderer = null;
    }
  }
  GenerateTextureSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "textureGenerator"
  };
  function cleanHash(hash) {
    let clean = false;
    for (const i2 in hash) {
      if (hash[i2] == void 0) {
        clean = true;
        break;
      }
    }
    if (!clean) return hash;
    const cleanHash2 =                 Object.create(null);
    for (const i2 in hash) {
      const value = hash[i2];
      if (value) {
        cleanHash2[i2] = value;
      }
    }
    return cleanHash2;
  }
  function cleanArray(arr) {
    let offset2 = 0;
    for (let i2 = 0; i2 < arr.length; i2++) {
      if (arr[i2] == void 0) {
        offset2++;
      } else {
        arr[i2 - offset2] = arr[i2];
      }
    }
    arr.length -= offset2;
    return arr;
  }
  const _GCSystem = class _GCSystem2 {

    constructor(renderer) {
      this._managedResources = [];
      this._managedResourceHashes = [];
      this._managedCollections = [];
      this._ready = false;
      this._renderer = renderer;
    }

    init(options) {
      options = { ..._GCSystem2.defaultOptions, ...options };
      this.maxUnusedTime = options.gcMaxUnusedTime;
      this._frequency = options.gcFrequency;
      this.enabled = options.gcActive;
      this.now = performance.now();
    }

    get enabled() {
      return !!this._handler;
    }

    set enabled(value) {
      if (this.enabled === value) return;
      if (value) {
        this._handler = this._renderer.scheduler.repeat(
          () => {
            this._ready = true;
          },
          this._frequency,
          false
        );
        this._collectionsHandler = this._renderer.scheduler.repeat(
          () => {
            for (const hash of this._managedCollections) {
              const { context: context2, collection, type } = hash;
              if (type === "hash") {
                context2[collection] = cleanHash(context2[collection]);
              } else {
                context2[collection] = cleanArray(context2[collection]);
              }
            }
          },
          this._frequency
        );
      } else {
        this._renderer.scheduler.cancel(this._handler);
        this._renderer.scheduler.cancel(this._collectionsHandler);
        this._handler = 0;
        this._collectionsHandler = 0;
      }
    }

    prerender({ container }) {
      this.now = performance.now();
      container.renderGroup.gcTick = this._renderer.tick++;
      this._updateInstructionGCTick(container.renderGroup, container.renderGroup.gcTick);
    }

    postrender() {
      if (!this._ready || !this.enabled) return;
      this.run();
      this._ready = false;
    }

    _updateInstructionGCTick(renderGroup, gcTick) {
      renderGroup.instructionSet.gcTick = gcTick;
      renderGroup.gcTick = gcTick;
      for (const child of renderGroup.renderGroupChildren) {
        this._updateInstructionGCTick(child, gcTick);
      }
    }

    addCollection(context2, collection, type) {
      this._managedCollections.push({
        context: context2,
        collection,
        type
      });
    }

    addResource(resource, type) {
      if (resource._gcLastUsed !== -1) {
        resource._gcLastUsed = this.now;
        resource._onTouch?.(this.now);
        return;
      }
      const index = this._managedResources.length;
      resource._gcData = {
        index,
        type
      };
      resource._gcLastUsed = this.now;
      resource._onTouch?.(this.now);
      resource.once("unload", this.removeResource, this);
      this._managedResources.push(resource);
    }

    removeResource(resource) {
      const gcData = resource._gcData;
      if (!gcData) return;
      const index = gcData.index;
      const last = this._managedResources.length - 1;
      if (index !== last) {
        const lastResource = this._managedResources[last];
        this._managedResources[index] = lastResource;
        lastResource._gcData.index = index;
      }
      this._managedResources.length--;
      resource._gcData = null;
      resource._gcLastUsed = -1;
    }

    addResourceHash(context2, hash, type, priority = 0) {
      this._managedResourceHashes.push({
        context: context2,
        hash,
        type,
        priority
      });
      this._managedResourceHashes.sort((a2, b2) => a2.priority - b2.priority);
    }

    run() {
      const now = performance.now();
      const managedResourceHashes = this._managedResourceHashes;
      for (const hashEntry of managedResourceHashes) {
        this.runOnHash(hashEntry, now);
      }
      let writeIndex = 0;
      for (let i2 = 0; i2 < this._managedResources.length; i2++) {
        const resource = this._managedResources[i2];
        writeIndex = this.runOnResource(resource, now, writeIndex);
      }
      this._managedResources.length = writeIndex;
    }
    updateRenderableGCTick(renderable, now) {
      const renderGroup = renderable.renderGroup ?? renderable.parentRenderGroup;
      const currentTick = renderGroup?.instructionSet?.gcTick ?? -1;
      if ((renderGroup?.gcTick ?? 0) === currentTick) {
        renderable._gcLastUsed = now;
        renderable._onTouch?.(now);
      }
    }
    runOnResource(resource, now, writeIndex) {
      const gcData = resource._gcData;
      if (gcData.type === "renderable") {
        this.updateRenderableGCTick(resource, now);
      }
      const isRecentlyUsed = now - resource._gcLastUsed < this.maxUnusedTime;
      if (isRecentlyUsed || !resource.autoGarbageCollect) {
        this._managedResources[writeIndex] = resource;
        gcData.index = writeIndex;
        writeIndex++;
      } else {
        resource.unload();
        resource._gcData = null;
        resource._gcLastUsed = -1;
        resource.off("unload", this.removeResource, this);
      }
      return writeIndex;
    }

    _createHashClone(hashValue, stopKey) {
      const hashClone =                 Object.create(null);
      for (const k2 in hashValue) {
        if (k2 === stopKey) break;
        if (hashValue[k2] !== null) hashClone[k2] = hashValue[k2];
      }
      return hashClone;
    }
    runOnHash(hashEntry, now) {
      const { context: context2, hash, type } = hashEntry;
      const hashValue = context2[hash];
      let hashClone = null;
      let nullCount = 0;
      for (const key in hashValue) {
        const resource = hashValue[key];
        if (resource === null) {
          nullCount++;
          if (nullCount === 1e4 && !hashClone) {
            hashClone = this._createHashClone(hashValue, key);
          }
          continue;
        }
        if (resource._gcLastUsed === -1) {
          resource._gcLastUsed = now;
          resource._onTouch?.(now);
          if (hashClone) hashClone[key] = resource;
          continue;
        }
        if (type === "renderable") {
          this.updateRenderableGCTick(resource, now);
        }
        const isRecentlyUsed = now - resource._gcLastUsed < this.maxUnusedTime;
        if (!isRecentlyUsed && resource.autoGarbageCollect) {
          if (!hashClone) {
            if (nullCount + 1 !== 1e4) {
              hashValue[key] = null;
              nullCount++;
            } else {
              hashClone = this._createHashClone(hashValue, key);
            }
          }
          if (type === "renderable") {
            const res = resource;
            const renderGroup = res.renderGroup ?? res.parentRenderGroup;
            if (renderGroup) renderGroup.structureDidChange = true;
          }
          resource.unload();
          resource._gcData = null;
          resource._gcLastUsed = -1;
        } else if (hashClone) {
          hashClone[key] = resource;
        }
      }
      if (hashClone) {
        context2[hash] = hashClone;
      }
    }

    destroy() {
      this.enabled = false;
      this._managedResources.forEach((resource) => {
        resource.off("unload", this.removeResource, this);
      });
      this._managedResources.length = 0;
      this._managedResourceHashes.length = 0;
      this._managedCollections.length = 0;
      this._renderer = null;
    }
  };
  _GCSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "gc",
    priority: 0
  };
  _GCSystem.defaultOptions = {

    gcActive: true,

    gcMaxUnusedTime: 6e4,

    gcFrequency: 3e4
  };
  let GCSystem = _GCSystem;
  class GlobalUniformSystem {
    constructor(renderer) {
      this._stackIndex = 0;
      this._globalUniformDataStack = [];
      this._uniformsPool = [];
      this._activeUniforms = [];
      this._bindGroupPool = [];
      this._activeBindGroups = [];
      this._renderer = renderer;
    }
    reset() {
      this._stackIndex = 0;
      for (let i2 = 0; i2 < this._activeUniforms.length; i2++) {
        this._uniformsPool.push(this._activeUniforms[i2]);
      }
      for (let i2 = 0; i2 < this._activeBindGroups.length; i2++) {
        this._bindGroupPool.push(this._activeBindGroups[i2]);
      }
      this._activeUniforms.length = 0;
      this._activeBindGroups.length = 0;
    }
    start(options) {
      this.reset();
      this.push(options);
    }
    bind({
      size,
      projectionMatrix,
      worldTransformMatrix,
      worldColor,
      offset: offset2
    }) {
      const renderTarget = this._renderer.renderTarget.renderTarget;
      const currentGlobalUniformData = this._stackIndex ? this._globalUniformDataStack[this._stackIndex - 1] : {
        worldTransformMatrix: new Matrix(),
        worldColor: 4294967295,
        offset: new Point()
      };
      const globalUniformData = {
        projectionMatrix: projectionMatrix || this._renderer.renderTarget.projectionMatrix,
        resolution: size || renderTarget.size,
        worldTransformMatrix: worldTransformMatrix || currentGlobalUniformData.worldTransformMatrix,
        worldColor: worldColor || currentGlobalUniformData.worldColor,
        offset: offset2 || currentGlobalUniformData.offset,
        bindGroup: null
      };
      const uniformGroup = this._uniformsPool.pop() || this._createUniforms();
      this._activeUniforms.push(uniformGroup);
      const uniforms = uniformGroup.uniforms;
      uniforms.uProjectionMatrix = globalUniformData.projectionMatrix;
      uniforms.uResolution = globalUniformData.resolution;
      uniforms.uWorldTransformMatrix.copyFrom(globalUniformData.worldTransformMatrix);
      uniforms.uWorldTransformMatrix.tx -= globalUniformData.offset.x;
      uniforms.uWorldTransformMatrix.ty -= globalUniformData.offset.y;
      color32BitToUniform(
        globalUniformData.worldColor,
        uniforms.uWorldColorAlpha,
        0
      );
      uniformGroup.update();
      let bindGroup;
      if (this._renderer.renderPipes.uniformBatch) {
        bindGroup = this._renderer.renderPipes.uniformBatch.getUniformBindGroup(uniformGroup, false);
      } else {
        bindGroup = this._bindGroupPool.pop() || new BindGroup();
        this._activeBindGroups.push(bindGroup);
        bindGroup.setResource(uniformGroup, 0);
      }
      globalUniformData.bindGroup = bindGroup;
      this._currentGlobalUniformData = globalUniformData;
    }
    push(options) {
      this.bind(options);
      this._globalUniformDataStack[this._stackIndex++] = this._currentGlobalUniformData;
    }
    pop() {
      this._currentGlobalUniformData = this._globalUniformDataStack[--this._stackIndex - 1];
      if (this._renderer.type === RendererType.WEBGL) {
        this._currentGlobalUniformData.bindGroup.resources[0].update();
      }
    }
    get bindGroup() {
      return this._currentGlobalUniformData.bindGroup;
    }
    get globalUniformData() {
      return this._currentGlobalUniformData;
    }
    get uniformGroup() {
      return this._currentGlobalUniformData.bindGroup.resources[0];
    }
    _createUniforms() {
      const globalUniforms = new UniformGroup({
        uProjectionMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uWorldTransformMatrix: { value: new Matrix(), type: "mat3x3<f32>" },

        uWorldColorAlpha: { value: new Float32Array(4), type: "vec4<f32>" },
        uResolution: { value: [0, 0], type: "vec2<f32>" }
      }, {
        isStatic: true
      });
      return globalUniforms;
    }
    destroy() {
      this._renderer = null;
      this._globalUniformDataStack.length = 0;
      this._uniformsPool.length = 0;
      this._activeUniforms.length = 0;
      this._bindGroupPool.length = 0;
      this._activeBindGroups.length = 0;
      this._currentGlobalUniformData = null;
    }
  }
  GlobalUniformSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "globalUniforms"
  };
  let uid = 1;
  class SchedulerSystem {
    constructor() {
      this._tasks = [];
      this._offset = 0;
    }

    init() {
      Ticker.system.add(this._update, this);
    }

    repeat(func, duration, useOffset = true) {
      const id = uid++;
      let offset2 = 0;
      if (useOffset) {
        this._offset += 1e3;
        offset2 = this._offset;
      }
      this._tasks.push({
        func,
        duration,
        start: performance.now(),
        offset: offset2,
        last: performance.now(),
        repeat: true,
        id
      });
      return id;
    }

    cancel(id) {
      for (let i2 = 0; i2 < this._tasks.length; i2++) {
        if (this._tasks[i2].id === id) {
          this._tasks.splice(i2, 1);
          return;
        }
      }
    }

    _update() {
      const now = performance.now();
      for (let i2 = 0; i2 < this._tasks.length; i2++) {
        const task = this._tasks[i2];
        if (now - task.offset - task.last >= task.duration) {
          const elapsed = now - task.start;
          task.func(elapsed);
          task.last = now;
        }
      }
    }

    destroy() {
      Ticker.system.remove(this._update, this);
      this._tasks.length = 0;
    }
  }
  SchedulerSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "scheduler",
    priority: 0
  };
  let saidHello = false;
  function sayHello(type) {
    if (saidHello) {
      return;
    }
    if (DOMAdapter.get().getNavigator().userAgent.toLowerCase().indexOf("chrome") > -1) {
      const args = [
        `%c  %c  %c  %c  %c PixiJS %c v${VERSION} (${type}) http://www.pixijs.com/

`,
        "background: #E72264; padding:5px 0;",
        "background: #6CA2EA; padding:5px 0;",
        "background: #B5D33D; padding:5px 0;",
        "background: #FED23F; padding:5px 0;",
        "color: #FFFFFF; background: #E72264; padding:5px 0;",
        "color: #E72264; background: #FFFFFF; padding:5px 0;"
      ];
      globalThis.console.log(...args);
    } else if (globalThis.console) {
      globalThis.console.log(`PixiJS ${VERSION} - ${type} - http://www.pixijs.com/`);
    }
    saidHello = true;
  }
  class HelloSystem {
    constructor(renderer) {
      this._renderer = renderer;
    }

    init(options) {
      if (options.hello) {
        let name = this._renderer.name;
        if (this._renderer.type === RendererType.WEBGL) {
          name += ` ${this._renderer.context.webGLVersion}`;
        }
        sayHello(name);
      }
    }
  }
  HelloSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "hello",
    priority: -2
  };
  HelloSystem.defaultOptions = {

    hello: false
  };
  const _RenderableGCSystem = class _RenderableGCSystem2 {

    constructor(renderer) {
      this._renderer = renderer;
    }

    init(options) {
      options = { ..._RenderableGCSystem2.defaultOptions, ...options };
      this.maxUnusedTime = options.renderableGCMaxUnusedTime;
    }

    get enabled() {
      deprecation("8.15.0", "RenderableGCSystem.enabled is deprecated, please use the GCSystem.enabled instead.");
      return this._renderer.gc.enabled;
    }

    set enabled(value) {
      deprecation("8.15.0", "RenderableGCSystem.enabled is deprecated, please use the GCSystem.enabled instead.");
      this._renderer.gc.enabled = value;
    }

    addManagedHash(context2, hash) {
      deprecation("8.15.0", "RenderableGCSystem.addManagedHash is deprecated, please use the GCSystem.addCollection instead.");
      this._renderer.gc.addCollection(context2, hash, "hash");
    }

    addManagedArray(context2, hash) {
      deprecation("8.15.0", "RenderableGCSystem.addManagedArray is deprecated, please use the GCSystem.addCollection instead.");
      this._renderer.gc.addCollection(context2, hash, "array");
    }

    addRenderable(_renderable) {
      deprecation("8.15.0", "RenderableGCSystem.addRenderable is deprecated, please use the GCSystem instead.");
      this._renderer.gc.addResource(_renderable, "renderable");
    }

    run() {
      deprecation("8.15.0", "RenderableGCSystem.run is deprecated, please use the GCSystem instead.");
      this._renderer.gc.run();
    }

    destroy() {
      this._renderer = null;
    }
  };
  _RenderableGCSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "renderableGC",
    priority: 0
  };
  _RenderableGCSystem.defaultOptions = {

    renderableGCActive: true,

    renderableGCMaxUnusedTime: 6e4,

    renderableGCFrequency: 3e4
  };
  let RenderableGCSystem = _RenderableGCSystem;
  const _TextureGCSystem = class _TextureGCSystem2 {

    get count() {
      return this._renderer.tick;
    }

    get checkCount() {
      return this._checkCount;
    }
    set checkCount(value) {
      deprecation("8.15.0", "TextureGCSystem.run is deprecated, please use the GCSystem instead.");
      this._checkCount = value;
    }

    get maxIdle() {
      return this._renderer.gc.maxUnusedTime / 1e3 * 60;
    }
    set maxIdle(value) {
      deprecation("8.15.0", "TextureGCSystem.run is deprecated, please use the GCSystem instead.");
      this._renderer.gc.maxUnusedTime = value / 60 * 1e3;
    }

    get checkCountMax() {
      return Math.floor(this._renderer.gc["_frequency"] / 1e3);
    }
    set checkCountMax(_value) {
      deprecation("8.15.0", "TextureGCSystem.run is deprecated, please use the GCSystem instead.");
    }

    get active() {
      return this._renderer.gc.enabled;
    }
    set active(value) {
      deprecation("8.15.0", "TextureGCSystem.run is deprecated, please use the GCSystem instead.");
      this._renderer.gc.enabled = value;
    }

    constructor(renderer) {
      this._renderer = renderer;
      this._checkCount = 0;
    }
    init(options) {
      if (options.textureGCActive !== _TextureGCSystem2.defaultOptions.textureGCActive) {
        this.active = options.textureGCActive;
      }
      if (options.textureGCMaxIdle !== _TextureGCSystem2.defaultOptions.textureGCMaxIdle) {
        this.maxIdle = options.textureGCMaxIdle;
      }
      if (options.textureGCCheckCountMax !== _TextureGCSystem2.defaultOptions.textureGCCheckCountMax) {
        this.checkCountMax = options.textureGCCheckCountMax;
      }
    }

    run() {
      deprecation("8.15.0", "TextureGCSystem.run is deprecated, please use the GCSystem instead.");
      this._renderer.gc.run();
    }
    destroy() {
      this._renderer = null;
    }
  };
  _TextureGCSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem
    ],
    name: "textureGC"
  };
  _TextureGCSystem.defaultOptions = {

    textureGCActive: true,

    textureGCAMaxIdle: null,

    textureGCMaxIdle: 60 * 60,

    textureGCCheckCountMax: 600
  };
  let TextureGCSystem = _TextureGCSystem;
  const _RenderTarget = class _RenderTarget2 {

    constructor(descriptor = {}) {
      this.uid = uid$1("renderTarget");
      this.colorTextures = [];
      this.dirtyId = 0;
      this.isRoot = false;
      this._size = new Float32Array(2);
      this._managedColorTextures = false;
      descriptor = { ..._RenderTarget2.defaultOptions, ...descriptor };
      this.stencil = descriptor.stencil;
      this.depth = descriptor.depth;
      this.isRoot = descriptor.isRoot;
      if (typeof descriptor.colorTextures === "number") {
        this._managedColorTextures = true;
        for (let i2 = 0; i2 < descriptor.colorTextures; i2++) {
          this.colorTextures.push(
            new TextureSource({
              width: descriptor.width,
              height: descriptor.height,
              resolution: descriptor.resolution,
              antialias: descriptor.antialias
            })
          );
        }
      } else {
        this.colorTextures = [...descriptor.colorTextures.map((texture) => texture.source)];
        const colorSource = this.colorTexture.source;
        this.resize(colorSource.width, colorSource.height, colorSource._resolution);
      }
      this.colorTexture.source.on("resize", this.onSourceResize, this);
      if (descriptor.depthStencilTexture || this.stencil) {
        if (descriptor.depthStencilTexture instanceof Texture || descriptor.depthStencilTexture instanceof TextureSource) {
          this.depthStencilTexture = descriptor.depthStencilTexture.source;
        } else {
          this.ensureDepthStencilTexture();
        }
      }
    }
    get size() {
      const _size = this._size;
      _size[0] = this.pixelWidth;
      _size[1] = this.pixelHeight;
      return _size;
    }
    get width() {
      return this.colorTexture.source.width;
    }
    get height() {
      return this.colorTexture.source.height;
    }
    get pixelWidth() {
      return this.colorTexture.source.pixelWidth;
    }
    get pixelHeight() {
      return this.colorTexture.source.pixelHeight;
    }
    get resolution() {
      return this.colorTexture.source._resolution;
    }
    get colorTexture() {
      return this.colorTextures[0];
    }
    onSourceResize(source2) {
      this.resize(source2.width, source2.height, source2._resolution, true);
    }

    ensureDepthStencilTexture() {
      if (!this.depthStencilTexture) {
        this.depthStencilTexture = new TextureSource({
          width: this.width,
          height: this.height,
          resolution: this.resolution,
          format: "depth24plus-stencil8",
          autoGenerateMipmaps: false,
          antialias: false,
          mipLevelCount: 1

        });
      }
    }
    resize(width, height, resolution = this.resolution, skipColorTexture = false) {
      this.dirtyId++;
      this.colorTextures.forEach((colorTexture, i2) => {
        if (skipColorTexture && i2 === 0) return;
        colorTexture.source.resize(width, height, resolution);
      });
      if (this.depthStencilTexture) {
        this.depthStencilTexture.source.resize(width, height, resolution);
      }
    }
    destroy() {
      this.colorTexture.source.off("resize", this.onSourceResize, this);
      if (this._managedColorTextures) {
        this.colorTextures.forEach((texture) => {
          texture.destroy();
        });
      }
      if (this.depthStencilTexture) {
        this.depthStencilTexture.destroy();
        delete this.depthStencilTexture;
      }
    }
  };
  _RenderTarget.defaultOptions = {

    width: 0,

    height: 0,

    resolution: 1,

    colorTextures: 1,

    stencil: false,

    depth: false,

    antialias: false,

    isRoot: false
  };
  let RenderTarget = _RenderTarget;
  const canvasCache =                 new Map();
  GlobalResourceRegistry.register(canvasCache);
  function getCanvasTexture(canvas, options) {
    if (!canvasCache.has(canvas)) {
      const texture = new Texture({
        source: new CanvasSource({
          resource: canvas,
          ...options
        })
      });
      const onDestroy = () => {
        if (canvasCache.get(canvas) === texture) {
          canvasCache.delete(canvas);
        }
      };
      texture.once("destroy", onDestroy);
      texture.source.once("destroy", onDestroy);
      canvasCache.set(canvas, texture);
    }
    return canvasCache.get(canvas);
  }
  const _ViewSystem = class _ViewSystem2 {

    get autoDensity() {
      return this.texture.source.autoDensity;
    }
    set autoDensity(value) {
      this.texture.source.autoDensity = value;
    }

    get resolution() {
      return this.texture.source._resolution;
    }
    set resolution(value) {
      this.texture.source.resize(
        this.texture.source.width,
        this.texture.source.height,
        value
      );
    }

    init(options) {
      options = {
        ..._ViewSystem2.defaultOptions,
        ...options
      };
      if (options.view) {
        deprecation(v8_0_0, "ViewSystem.view has been renamed to ViewSystem.canvas");
        options.canvas = options.view;
      }
      this.screen = new Rectangle(0, 0, options.width, options.height);
      this.canvas = options.canvas || DOMAdapter.get().createCanvas();
      this.antialias = !!options.antialias;
      this.texture = getCanvasTexture(this.canvas, options);
      this.renderTarget = new RenderTarget({
        colorTextures: [this.texture],
        depth: !!options.depth,
        isRoot: true
      });
      this.texture.source.transparent = options.backgroundAlpha < 1;
      this.resolution = options.resolution;
    }

    resize(desiredScreenWidth, desiredScreenHeight, resolution) {
      this.texture.source.resize(desiredScreenWidth, desiredScreenHeight, resolution);
      this.screen.width = this.texture.frame.width;
      this.screen.height = this.texture.frame.height;
    }

    destroy(options = false) {
      const removeView = typeof options === "boolean" ? options : !!options?.removeView;
      if (removeView && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.texture.destroy();
    }
  };
  _ViewSystem.extension = {
    type: [
      ExtensionType.WebGLSystem,
      ExtensionType.WebGPUSystem,
      ExtensionType.CanvasSystem
    ],
    name: "view",
    priority: 0
  };
  _ViewSystem.defaultOptions = {

    width: 800,

    height: 600,

    autoDensity: false,

    antialias: false
  };
  let ViewSystem = _ViewSystem;
  const SharedSystems = [
    BackgroundSystem,
    GlobalUniformSystem,
    HelloSystem,
    ViewSystem,
    RenderGroupSystem,
    GCSystem,
    TextureGCSystem,
    GenerateTextureSystem,
    ExtractSystem,
    RendererInitHook,
    RenderableGCSystem,
    SchedulerSystem
  ];
  const SharedRenderPipes = [
    BlendModePipe,
    BatcherPipe,
    SpritePipe,
    RenderGroupPipe,
    AlphaMaskPipe,
    StencilMaskPipe,
    ColorMaskPipe,
    CustomRenderPipe
  ];
  function calculateProjection(pm, x2, y2, width, height, flipY) {
    const sign2 = flipY ? 1 : -1;
    pm.identity();
    pm.a = 1 / width * 2;
    pm.d = sign2 * (1 / height * 2);
    pm.tx = -1 - x2 * pm.a;
    pm.ty = -sign2 - y2 * pm.d;
    return pm;
  }
  function isRenderingToScreen(renderTarget) {
    const resource = renderTarget.colorTexture.source.resource;
    return globalThis.HTMLCanvasElement && resource instanceof HTMLCanvasElement && document.body.contains(resource);
  }
  class RenderTargetSystem {
    constructor(renderer) {
      this.rootViewPort = new Rectangle();
      this.viewport = new Rectangle();
      this.mipLevel = 0;
      this.layer = 0;
      this.onRenderTargetChange = new SystemRunner("onRenderTargetChange");
      this.projectionMatrix = new Matrix();
      this.defaultClearColor = [0, 0, 0, 0];
      this._renderSurfaceToRenderTargetHash =                 new Map();
      this._gpuRenderTargetHash =                 Object.create(null);
      this._renderTargetStack = [];
      this._renderer = renderer;
      renderer.gc.addCollection(this, "_gpuRenderTargetHash", "hash");
    }

    finishRenderPass() {
      this.adaptor.finishRenderPass(this.renderTarget);
    }

    renderStart({
      target,
      clear,
      clearColor,
      frame,
      mipLevel,
      layer: layer2
    }) {
      this._renderTargetStack.length = 0;
      this.push(
        target,
        clear,
        clearColor,
        frame,
        mipLevel ?? 0,
        layer2 ?? 0
      );
      this.rootViewPort.copyFrom(this.viewport);
      this.rootRenderTarget = this.renderTarget;
      this.renderingToScreen = isRenderingToScreen(this.rootRenderTarget);
      this.adaptor.prerender?.(this.rootRenderTarget);
    }
    postrender() {
      this.adaptor.postrender?.(this.rootRenderTarget);
    }

    bind(renderSurface, clear = true, clearColor, frame, mipLevel = 0, layer2 = 0) {
      const renderTarget = this.getRenderTarget(renderSurface);
      const didChange = this.renderTarget !== renderTarget;
      this.renderTarget = renderTarget;
      this.renderSurface = renderSurface;
      const gpuRenderTarget = this.getGpuRenderTarget(renderTarget);
      if (renderTarget.pixelWidth !== gpuRenderTarget.width || renderTarget.pixelHeight !== gpuRenderTarget.height) {
        this.adaptor.resizeGpuRenderTarget(renderTarget);
        gpuRenderTarget.width = renderTarget.pixelWidth;
        gpuRenderTarget.height = renderTarget.pixelHeight;
      }
      const source2 = renderTarget.colorTexture;
      const viewport = this.viewport;
      const arrayLayerCount = source2.arrayLayerCount || 1;
      if ((layer2 | 0) !== layer2) {
        layer2 |= 0;
      }
      if (layer2 < 0 || layer2 >= arrayLayerCount) {
        throw new Error(`[RenderTargetSystem] layer ${layer2} is out of bounds (arrayLayerCount=${arrayLayerCount}).`);
      }
      this.mipLevel = mipLevel | 0;
      this.layer = layer2 | 0;
      const pixelWidth = Math.max(source2.pixelWidth >> mipLevel, 1);
      const pixelHeight = Math.max(source2.pixelHeight >> mipLevel, 1);
      if (!frame && renderSurface instanceof Texture) {
        frame = renderSurface.frame;
      }
      if (frame) {
        const resolution = source2._resolution;
        const scale = 1 << Math.max(mipLevel | 0, 0);
        const baseX = frame.x * resolution + 0.5 | 0;
        const baseY = frame.y * resolution + 0.5 | 0;
        const baseW = frame.width * resolution + 0.5 | 0;
        const baseH = frame.height * resolution + 0.5 | 0;
        let x2 = Math.floor(baseX / scale);
        let y2 = Math.floor(baseY / scale);
        let w2 = Math.ceil(baseW / scale);
        let h2 = Math.ceil(baseH / scale);
        x2 = Math.min(Math.max(x2, 0), pixelWidth - 1);
        y2 = Math.min(Math.max(y2, 0), pixelHeight - 1);
        w2 = Math.min(Math.max(w2, 1), pixelWidth - x2);
        h2 = Math.min(Math.max(h2, 1), pixelHeight - y2);
        viewport.x = x2;
        viewport.y = y2;
        viewport.width = w2;
        viewport.height = h2;
      } else {
        viewport.x = 0;
        viewport.y = 0;
        viewport.width = pixelWidth;
        viewport.height = pixelHeight;
      }
      calculateProjection(
        this.projectionMatrix,
        0,
        0,
        viewport.width / source2.resolution,
        viewport.height / source2.resolution,
        !renderTarget.isRoot
      );
      this.adaptor.startRenderPass(renderTarget, clear, clearColor, viewport, mipLevel, layer2);
      if (didChange) {
        this.onRenderTargetChange.emit(renderTarget);
      }
      return renderTarget;
    }
    clear(target, clear = CLEAR.ALL, clearColor, mipLevel = this.mipLevel, layer2 = this.layer) {
      if (!clear) return;
      if (target) {
        target = this.getRenderTarget(target);
      }
      this.adaptor.clear(
        target || this.renderTarget,
        clear,
        clearColor,
        this.viewport,
        mipLevel,
        layer2
      );
    }
    contextChange() {
      this._gpuRenderTargetHash =                 Object.create(null);
    }

    push(renderSurface, clear = CLEAR.ALL, clearColor, frame, mipLevel = 0, layer2 = 0) {
      const renderTarget = this.bind(renderSurface, clear, clearColor, frame, mipLevel, layer2);
      this._renderTargetStack.push({
        renderTarget,
        frame,
        mipLevel,
        layer: layer2
      });
      return renderTarget;
    }

    pop() {
      this._renderTargetStack.pop();
      const currentRenderTargetData = this._renderTargetStack[this._renderTargetStack.length - 1];
      this.bind(
        currentRenderTargetData.renderTarget,
        false,
        null,
        currentRenderTargetData.frame,
        currentRenderTargetData.mipLevel,
        currentRenderTargetData.layer
      );
    }

    getRenderTarget(renderSurface) {
      if (renderSurface.isTexture) {
        renderSurface = renderSurface.source;
      }
      return this._renderSurfaceToRenderTargetHash.get(renderSurface) ?? this._initRenderTarget(renderSurface);
    }

    copyToTexture(sourceRenderSurfaceTexture, destinationTexture, originSrc, size, originDest) {
      if (originSrc.x < 0) {
        size.width += originSrc.x;
        originDest.x -= originSrc.x;
        originSrc.x = 0;
      }
      if (originSrc.y < 0) {
        size.height += originSrc.y;
        originDest.y -= originSrc.y;
        originSrc.y = 0;
      }
      const { pixelWidth, pixelHeight } = sourceRenderSurfaceTexture;
      size.width = Math.min(size.width, pixelWidth - originSrc.x);
      size.height = Math.min(size.height, pixelHeight - originSrc.y);
      return this.adaptor.copyToTexture(
        sourceRenderSurfaceTexture,
        destinationTexture,
        originSrc,
        size,
        originDest
      );
    }

    ensureDepthStencil() {
      if (!this.renderTarget.stencil) {
        this.renderTarget.stencil = true;
        this.adaptor.startRenderPass(this.renderTarget, false, null, this.viewport, 0, this.layer);
      }
    }

    destroy() {
      this._renderer = null;
      this._renderSurfaceToRenderTargetHash.forEach((renderTarget, key) => {
        if (renderTarget !== key) {
          renderTarget.destroy();
        }
      });
      this._renderSurfaceToRenderTargetHash.clear();
      this._gpuRenderTargetHash =                 Object.create(null);
    }
    _initRenderTarget(renderSurface) {
      let renderTarget = null;
      if (CanvasSource.test(renderSurface)) {
        renderSurface = getCanvasTexture(renderSurface).source;
      }
      if (renderSurface instanceof RenderTarget) {
        renderTarget = renderSurface;
      } else if (renderSurface instanceof TextureSource) {
        renderTarget = new RenderTarget({
          colorTextures: [renderSurface]
        });
        if (renderSurface.source instanceof CanvasSource) {
          renderTarget.isRoot = true;
        }
        renderSurface.once("destroy", () => {
          renderTarget.destroy();
          this._renderSurfaceToRenderTargetHash.delete(renderSurface);
          const gpuRenderTarget = this._gpuRenderTargetHash[renderTarget.uid];
          if (gpuRenderTarget) {
            this._gpuRenderTargetHash[renderTarget.uid] = null;
            this.adaptor.destroyGpuRenderTarget(gpuRenderTarget);
          }
        });
      }
      this._renderSurfaceToRenderTargetHash.set(renderSurface, renderTarget);
      return renderTarget;
    }
    getGpuRenderTarget(renderTarget) {
      return this._gpuRenderTargetHash[renderTarget.uid] || (this._gpuRenderTargetHash[renderTarget.uid] = this.adaptor.initGpuRenderTarget(renderTarget));
    }
    resetState() {
      this.renderTarget = null;
      this.renderSurface = null;
    }
  }
  class CanvasRenderTargetAdaptor {

    init(renderer, renderTargetSystem) {
      this._renderer = renderer;
      this._renderTargetSystem = renderTargetSystem;
    }

    initGpuRenderTarget(renderTarget) {
      const colorTexture = renderTarget.colorTexture;
      const { canvas, context: context2 } = this._ensureCanvas(colorTexture);
      return {
        canvas,
        context: context2,
        width: canvas.width,
        height: canvas.height
      };
    }

    resizeGpuRenderTarget(renderTarget) {
      const colorTexture = renderTarget.colorTexture;
      const { canvas } = this._ensureCanvas(colorTexture);
      canvas.width = renderTarget.pixelWidth;
      canvas.height = renderTarget.pixelHeight;
    }

    startRenderPass(renderTarget, clear, clearColor, viewport) {
      const gpuRenderTarget = this._renderTargetSystem.getGpuRenderTarget(renderTarget);
      this._renderer.canvasContext.activeContext = gpuRenderTarget.context;
      this._renderer.canvasContext.activeResolution = renderTarget.resolution;
      if (clear) {
        this.clear(renderTarget, clear, clearColor, viewport);
      }
    }

    clear(renderTarget, _clear, clearColor, viewport) {
      const gpuRenderTarget = this._renderTargetSystem.getGpuRenderTarget(renderTarget);
      const context2 = gpuRenderTarget.context;
      const bounds = viewport || { x: 0, y: 0, width: renderTarget.pixelWidth, height: renderTarget.pixelHeight };
      context2.setTransform(1, 0, 0, 1, 0, 0);
      context2.clearRect(bounds.x, bounds.y, bounds.width, bounds.height);
      if (clearColor) {
        const color = Color.shared.setValue(clearColor);
        if (color.alpha > 0) {
          context2.globalAlpha = color.alpha;
          context2.fillStyle = color.toHex();
          context2.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
          context2.globalAlpha = 1;
        }
      }
    }

    finishRenderPass() {
    }

    copyToTexture(sourceRenderSurfaceTexture, destinationTexture, originSrc, size, originDest) {
      const sourceGpuTarget = this._renderTargetSystem.getGpuRenderTarget(sourceRenderSurfaceTexture);
      const sourceCanvas = sourceGpuTarget.canvas;
      const destSource = destinationTexture.source;
      const { context: context2 } = this._ensureCanvas(destSource);
      const dx = originDest?.x ?? 0;
      const dy = originDest?.y ?? 0;
      context2.drawImage(
        sourceCanvas,
        originSrc.x,
        originSrc.y,
        size.width,
        size.height,
        dx,
        dy,
        size.width,
        size.height
      );
      destSource.update();
      return destinationTexture;
    }

    destroyGpuRenderTarget(_gpuRenderTarget) {
    }
    _ensureCanvas(source2) {
      let canvas = source2.resource;
      if (!canvas || !CanvasSource.test(canvas)) {
        canvas = DOMAdapter.get().createCanvas(source2.pixelWidth, source2.pixelHeight);
        source2.resource = canvas;
      }
      if (canvas.width !== source2.pixelWidth || canvas.height !== source2.pixelHeight) {
        canvas.width = source2.pixelWidth;
        canvas.height = source2.pixelHeight;
      }
      const context2 = canvas.getContext("2d");
      return { canvas, context: context2 };
    }
  }
  class CanvasRenderTargetSystem extends RenderTargetSystem {
    constructor(renderer) {
      super(renderer);
      this.adaptor = new CanvasRenderTargetAdaptor();
      this.adaptor.init(renderer, this);
    }
  }
  CanvasRenderTargetSystem.extension = {
    type: [ExtensionType.CanvasSystem],
    name: "renderTarget"
  };
  class CanvasTextureSystem {

    constructor(renderer) {
    }

    init() {
    }

    initSource(_source) {
    }

    generateCanvas(texture) {
      const canvas = DOMAdapter.get().createCanvas();
      const context2 = canvas.getContext("2d");
      const source2 = canvasUtils.getCanvasSource(texture);
      if (!source2) {
        return canvas;
      }
      const frame = texture.frame;
      const resolution = texture.source._resolution ?? texture.source.resolution ?? 1;
      const sx = frame.x * resolution;
      const sy = frame.y * resolution;
      const sw = frame.width * resolution;
      const sh = frame.height * resolution;
      canvas.width = Math.ceil(sw);
      canvas.height = Math.ceil(sh);
      context2.drawImage(
        source2,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        sw,
        sh
      );
      return canvas;
    }

    getPixels(texture) {
      const canvas = this.generateCanvas(texture);
      const context2 = canvas.getContext("2d", { willReadFrequently: true });
      const imageData = context2.getImageData(0, 0, canvas.width, canvas.height);
      return {
        pixels: imageData.data,
        width: canvas.width,
        height: canvas.height
      };
    }

    destroy() {
    }
  }
  CanvasTextureSystem.extension = {
    type: [
      ExtensionType.CanvasSystem
    ],
    name: "texture"
  };
  const DefaultCanvasSystems = [
    ...SharedSystems,
    CanvasContextSystem,
    CanvasLimitsSystem,
    CanvasTextureSystem,
    CanvasRenderTargetSystem
  ];
  const DefaultCanvasPipes = [
    BlendModePipe,
    BatcherPipe,
    SpritePipe,
    RenderGroupPipe,
    AlphaMaskPipe,
    CanvasStencilMaskPipe,
    CanvasColorMaskPipe,
    CustomRenderPipe
  ];
  const DefaultCanvasAdapters = [
    CanvasBatchAdaptor,
    CanvasGraphicsAdaptor
  ];
  const systems$1 = [];
  const renderPipes$1 = [];
  const renderPipeAdaptors$1 = [];
  extensions.handleByNamedList(ExtensionType.CanvasSystem, systems$1);
  extensions.handleByNamedList(ExtensionType.CanvasPipes, renderPipes$1);
  extensions.handleByNamedList(ExtensionType.CanvasPipesAdaptor, renderPipeAdaptors$1);
  extensions.add(...DefaultCanvasSystems, ...DefaultCanvasPipes, ...DefaultCanvasAdapters);
  class CanvasRenderer extends AbstractRenderer {
    constructor() {
      const systemConfig = {
        name: "canvas",
        type: RendererType.CANVAS,
        systems: systems$1,
        renderPipes: renderPipes$1,
        renderPipeAdaptors: renderPipeAdaptors$1
      };
      super(systemConfig);
    }
  }
  const CanvasRenderer$1 =                 Object.freeze(                Object.defineProperty({
    __proto__: null,
    CanvasRenderer
  }, Symbol.toStringTag, { value: "Module" }));
  var BUFFER_TYPE =                 ((BUFFER_TYPE2) => {
    BUFFER_TYPE2[BUFFER_TYPE2["ELEMENT_ARRAY_BUFFER"] = 34963] = "ELEMENT_ARRAY_BUFFER";
    BUFFER_TYPE2[BUFFER_TYPE2["ARRAY_BUFFER"] = 34962] = "ARRAY_BUFFER";
    BUFFER_TYPE2[BUFFER_TYPE2["UNIFORM_BUFFER"] = 35345] = "UNIFORM_BUFFER";
    return BUFFER_TYPE2;
  })(BUFFER_TYPE || {});
  class GlBuffer {
    constructor(buffer, type) {
      this._lastBindBaseLocation = -1;
      this._lastBindCallId = -1;
      this.buffer = buffer || null;
      this.updateID = -1;
      this.byteLength = -1;
      this.type = type;
    }
    destroy() {
      this.buffer = null;
      this.updateID = -1;
      this.byteLength = -1;
      this.type = -1;
      this._lastBindBaseLocation = -1;
      this._lastBindCallId = -1;
    }
  }
  class GlBufferSystem {

    constructor(renderer) {
      this._boundBufferBases =                 Object.create(null);
      this._minBaseLocation = 0;
      this._nextBindBaseIndex = this._minBaseLocation;
      this._bindCallId = 0;
      this._renderer = renderer;
      this._managedBuffers = new GCManagedHash({
        renderer,
        type: "resource",
        onUnload: this.onBufferUnload.bind(this),
        name: "glBuffer"
      });
    }

    destroy() {
      this._managedBuffers.destroy();
      this._renderer = null;
      this._gl = null;
      this._boundBufferBases = {};
    }

    contextChange() {
      this._gl = this._renderer.gl;
      this.destroyAll(true);
      this._maxBindings = this._renderer.limits.maxUniformBindings;
    }
    getGlBuffer(buffer) {
      buffer._gcLastUsed = this._renderer.gc.now;
      return buffer._gpuData[this._renderer.uid] || this.createGLBuffer(buffer);
    }

    bind(buffer) {
      const { _gl: gl } = this;
      const glBuffer = this.getGlBuffer(buffer);
      gl.bindBuffer(glBuffer.type, glBuffer.buffer);
    }

    bindBufferBase(glBuffer, index) {
      const { _gl: gl } = this;
      if (this._boundBufferBases[index] !== glBuffer) {
        this._boundBufferBases[index] = glBuffer;
        glBuffer._lastBindBaseLocation = index;
        gl.bindBufferBase(gl.UNIFORM_BUFFER, index, glBuffer.buffer);
      }
    }
    nextBindBase(hasTransformFeedback) {
      this._bindCallId++;
      this._minBaseLocation = 0;
      if (hasTransformFeedback) {
        this._boundBufferBases[0] = null;
        this._minBaseLocation = 1;
        if (this._nextBindBaseIndex < 1) {
          this._nextBindBaseIndex = 1;
        }
      }
    }
    freeLocationForBufferBase(glBuffer) {
      let freeIndex = this.getLastBindBaseLocation(glBuffer);
      if (freeIndex >= this._minBaseLocation) {
        glBuffer._lastBindCallId = this._bindCallId;
        return freeIndex;
      }
      let loop = 0;
      let nextIndex = this._nextBindBaseIndex;
      while (loop < 2) {
        if (nextIndex >= this._maxBindings) {
          nextIndex = this._minBaseLocation;
          loop++;
        }
        const curBuf = this._boundBufferBases[nextIndex];
        if (curBuf && curBuf._lastBindCallId === this._bindCallId) {
          nextIndex++;
          continue;
        }
        break;
      }
      freeIndex = nextIndex;
      this._nextBindBaseIndex = nextIndex + 1;
      if (loop >= 2) {
        return -1;
      }
      glBuffer._lastBindCallId = this._bindCallId;
      this._boundBufferBases[freeIndex] = null;
      return freeIndex;
    }
    getLastBindBaseLocation(glBuffer) {
      const index = glBuffer._lastBindBaseLocation;
      if (this._boundBufferBases[index] === glBuffer) {
        return index;
      }
      return -1;
    }

    bindBufferRange(glBuffer, index, offset2, size) {
      const { _gl: gl } = this;
      offset2 || (offset2 = 0);
      index || (index = 0);
      this._boundBufferBases[index] = null;
      gl.bindBufferRange(gl.UNIFORM_BUFFER, index || 0, glBuffer.buffer, offset2 * 256, size || 256);
    }

    updateBuffer(buffer) {
      const { _gl: gl } = this;
      const glBuffer = this.getGlBuffer(buffer);
      if (buffer._updateID === glBuffer.updateID) {
        return glBuffer;
      }
      glBuffer.updateID = buffer._updateID;
      gl.bindBuffer(glBuffer.type, glBuffer.buffer);
      const data = buffer.data;
      const drawType = buffer.descriptor.usage & BufferUsage.STATIC ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW;
      if (data) {
        if (glBuffer.byteLength >= data.byteLength) {
          gl.bufferSubData(glBuffer.type, 0, data, 0, buffer._updateSize / data.BYTES_PER_ELEMENT);
        } else {
          glBuffer.byteLength = data.byteLength;
          gl.bufferData(glBuffer.type, data, drawType);
        }
      } else {
        glBuffer.byteLength = buffer.descriptor.size;
        gl.bufferData(glBuffer.type, glBuffer.byteLength, drawType);
      }
      return glBuffer;
    }

    destroyAll(contextLost = false) {
      this._managedBuffers.removeAll(contextLost);
    }
    onBufferUnload(buffer, contextLost = false) {
      const glBuffer = buffer._gpuData[this._renderer.uid];
      if (!glBuffer) return;
      if (!contextLost) this._gl.deleteBuffer(glBuffer.buffer);
    }

    createGLBuffer(buffer) {
      const { _gl: gl } = this;
      let type = BUFFER_TYPE.ARRAY_BUFFER;
      if (buffer.descriptor.usage & BufferUsage.INDEX) {
        type = BUFFER_TYPE.ELEMENT_ARRAY_BUFFER;
      } else if (buffer.descriptor.usage & BufferUsage.UNIFORM) {
        type = BUFFER_TYPE.UNIFORM_BUFFER;
      }
      const glBuffer = new GlBuffer(gl.createBuffer(), type);
      buffer._gpuData[this._renderer.uid] = glBuffer;
      this._managedBuffers.add(buffer);
      return glBuffer;
    }
    resetState() {
      this._boundBufferBases =                 Object.create(null);
    }
  }
  GlBufferSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "buffer"
  };
  const _GlContextSystem = class _GlContextSystem2 {

    constructor(renderer) {
      this.supports = {

        uint32Indices: true,

        uniformBufferObject: true,

        vertexArrayObject: true,

        srgbTextures: true,

        nonPowOf2wrapping: true,

        msaa: true,

        nonPowOf2mipmaps: true
      };
      this._renderer = renderer;
      this.extensions =                 Object.create(null);
      this.handleContextLost = this.handleContextLost.bind(this);
      this.handleContextRestored = this.handleContextRestored.bind(this);
    }

    get isLost() {
      return !this.gl || this.gl.isContextLost();
    }

    contextChange(gl) {
      this.gl = gl;
      this._renderer.gl = gl;
    }
    init(options) {
      options = { ..._GlContextSystem2.defaultOptions, ...options };
      let multiView = this.multiView = options.multiView;
      if (options.context && multiView) {
        warn("Renderer created with both a context and multiview enabled. Disabling multiView as both cannot work together.");
        multiView = false;
      }
      if (multiView) {
        this.canvas = DOMAdapter.get().createCanvas(this._renderer.canvas.width, this._renderer.canvas.height);
      } else {
        this.canvas = this._renderer.view.canvas;
      }
      if (options.context) {
        this.initFromContext(options.context);
      } else {
        const alpha = this._renderer.background.alpha < 1;
        const premultipliedAlpha = options.premultipliedAlpha ?? true;
        const antialias = options.antialias && !this._renderer.backBuffer.useBackBuffer;
        this.createContext(options.preferWebGLVersion, {
          alpha,
          premultipliedAlpha,
          antialias,
          stencil: true,
          preserveDrawingBuffer: options.preserveDrawingBuffer,
          powerPreference: options.powerPreference ?? "default"
        });
      }
    }
    ensureCanvasSize(targetCanvas) {
      if (!this.multiView) {
        if (targetCanvas !== this.canvas) {
          warn("multiView is disabled, but targetCanvas is not the main canvas");
        }
        return;
      }
      const { canvas } = this;
      if (canvas.width < targetCanvas.width || canvas.height < targetCanvas.height) {
        canvas.width = Math.max(targetCanvas.width, targetCanvas.width);
        canvas.height = Math.max(targetCanvas.height, targetCanvas.height);
      }
    }

    initFromContext(gl) {
      this.gl = gl;
      this.webGLVersion = gl instanceof DOMAdapter.get().getWebGLRenderingContext() ? 1 : 2;
      this.getExtensions();
      this.validateContext(gl);
      this._renderer.runners.contextChange.emit(gl);
      const element = this._renderer.view.canvas;
      element.addEventListener("webglcontextlost", this.handleContextLost, false);
      element.addEventListener("webglcontextrestored", this.handleContextRestored, false);
    }

    createContext(preferWebGLVersion, options) {
      let gl;
      const canvas = this.canvas;
      if (preferWebGLVersion === 2) {
        gl = canvas.getContext("webgl2", options);
      }
      if (!gl) {
        gl = canvas.getContext("webgl", options);
        if (!gl) {
          throw new Error("This browser does not support WebGL. Try using the canvas renderer");
        }
      }
      this.gl = gl;
      this.initFromContext(this.gl);
    }

    getExtensions() {
      const { gl } = this;
      const common = {
        anisotropicFiltering: gl.getExtension("EXT_texture_filter_anisotropic"),
        floatTextureLinear: gl.getExtension("OES_texture_float_linear"),
        s3tc: gl.getExtension("WEBGL_compressed_texture_s3tc"),
        s3tc_sRGB: gl.getExtension("WEBGL_compressed_texture_s3tc_srgb"),

        etc: gl.getExtension("WEBGL_compressed_texture_etc"),
        etc1: gl.getExtension("WEBGL_compressed_texture_etc1"),
        pvrtc: gl.getExtension("WEBGL_compressed_texture_pvrtc") || gl.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc"),
        atc: gl.getExtension("WEBGL_compressed_texture_atc"),
        astc: gl.getExtension("WEBGL_compressed_texture_astc"),
        bptc: gl.getExtension("EXT_texture_compression_bptc"),
        rgtc: gl.getExtension("EXT_texture_compression_rgtc"),
        loseContext: gl.getExtension("WEBGL_lose_context")
      };
      if (this.webGLVersion === 1) {
        this.extensions = {
          ...common,
          drawBuffers: gl.getExtension("WEBGL_draw_buffers"),
          depthTexture: gl.getExtension("WEBGL_depth_texture"),
          vertexArrayObject: gl.getExtension("OES_vertex_array_object") || gl.getExtension("MOZ_OES_vertex_array_object") || gl.getExtension("WEBKIT_OES_vertex_array_object"),
          uint32ElementIndex: gl.getExtension("OES_element_index_uint"),

          floatTexture: gl.getExtension("OES_texture_float"),
          floatTextureLinear: gl.getExtension("OES_texture_float_linear"),
          textureHalfFloat: gl.getExtension("OES_texture_half_float"),
          textureHalfFloatLinear: gl.getExtension("OES_texture_half_float_linear"),
          vertexAttribDivisorANGLE: gl.getExtension("ANGLE_instanced_arrays"),
          srgb: gl.getExtension("EXT_sRGB")
        };
      } else {
        this.extensions = {
          ...common,
          colorBufferFloat: gl.getExtension("EXT_color_buffer_float")
        };
        const provokeExt = gl.getExtension("WEBGL_provoking_vertex");
        if (provokeExt) {
          provokeExt.provokingVertexWEBGL(provokeExt.FIRST_VERTEX_CONVENTION_WEBGL);
        }
      }
    }

    handleContextLost(event) {
      event.preventDefault();
      if (this._contextLossForced) {
        this._contextLossForced = false;
        setTimeout(() => {
          if (this.gl.isContextLost()) {
            this.extensions.loseContext?.restoreContext();
          }
        }, 0);
      }
    }

    handleContextRestored() {
      this.getExtensions();
      this._renderer.runners.contextChange.emit(this.gl);
    }
    destroy() {
      const element = this._renderer.view.canvas;
      this._renderer = null;
      element.removeEventListener("webglcontextlost", this.handleContextLost);
      element.removeEventListener("webglcontextrestored", this.handleContextRestored);
      this.gl.useProgram(null);
      this.extensions.loseContext?.loseContext();
    }

    forceContextLoss() {
      this.extensions.loseContext?.loseContext();
      this._contextLossForced = true;
    }

    validateContext(gl) {
      const attributes = gl.getContextAttributes();
      if (attributes && !attributes.stencil) {
        warn("Provided WebGL context does not have a stencil buffer, masks may not render correctly");
      }
      const supports = this.supports;
      const isWebGl2 = this.webGLVersion === 2;
      const extensions2 = this.extensions;
      supports.uint32Indices = isWebGl2 || !!extensions2.uint32ElementIndex;
      supports.uniformBufferObject = isWebGl2;
      supports.vertexArrayObject = isWebGl2 || !!extensions2.vertexArrayObject;
      supports.srgbTextures = isWebGl2 || !!extensions2.srgb;
      supports.nonPowOf2wrapping = isWebGl2;
      supports.nonPowOf2mipmaps = isWebGl2;
      supports.msaa = isWebGl2;
      if (!supports.uint32Indices) {
        warn("Provided WebGL context does not support 32 index buffer, large scenes may not render correctly");
      }
    }
  };
  _GlContextSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "context"
  };
  _GlContextSystem.defaultOptions = {

    context: null,

    premultipliedAlpha: true,

    preserveDrawingBuffer: false,

    powerPreference: void 0,

    preferWebGLVersion: 2,

    multiView: false
  };
  let GlContextSystem = _GlContextSystem;
  function ensureAttributes(geometry, extractedData) {
    for (const i2 in geometry.attributes) {
      const attribute = geometry.attributes[i2];
      const attributeData = extractedData[i2];
      if (attributeData) {
        attribute.format ?? (attribute.format = attributeData.format);
        attribute.offset ?? (attribute.offset = attributeData.offset);
        attribute.instance ?? (attribute.instance = attributeData.instance);
      } else {
        warn(`Attribute ${i2} is not present in the shader, but is present in the geometry. Unable to infer attribute details.`);
      }
    }
    ensureStartAndStride(geometry);
  }
  function ensureStartAndStride(geometry) {
    const { buffers, attributes } = geometry;
    const tempStride = {};
    const tempStart = {};
    for (const j2 in buffers) {
      const buffer = buffers[j2];
      tempStride[buffer.uid] = 0;
      tempStart[buffer.uid] = 0;
    }
    for (const j2 in attributes) {
      const attribute = attributes[j2];
      tempStride[attribute.buffer.uid] += getAttributeInfoFromFormat(attribute.format).stride;
    }
    for (const j2 in attributes) {
      const attribute = attributes[j2];
      attribute.stride ?? (attribute.stride = tempStride[attribute.buffer.uid]);
      attribute.start ?? (attribute.start = tempStart[attribute.buffer.uid]);
      tempStart[attribute.buffer.uid] += getAttributeInfoFromFormat(attribute.format).stride;
    }
  }
  var GL_FORMATS =                 ((GL_FORMATS2) => {
    GL_FORMATS2[GL_FORMATS2["RGBA"] = 6408] = "RGBA";
    GL_FORMATS2[GL_FORMATS2["RGB"] = 6407] = "RGB";
    GL_FORMATS2[GL_FORMATS2["RG"] = 33319] = "RG";
    GL_FORMATS2[GL_FORMATS2["RED"] = 6403] = "RED";
    GL_FORMATS2[GL_FORMATS2["RGBA_INTEGER"] = 36249] = "RGBA_INTEGER";
    GL_FORMATS2[GL_FORMATS2["RGB_INTEGER"] = 36248] = "RGB_INTEGER";
    GL_FORMATS2[GL_FORMATS2["RG_INTEGER"] = 33320] = "RG_INTEGER";
    GL_FORMATS2[GL_FORMATS2["RED_INTEGER"] = 36244] = "RED_INTEGER";
    GL_FORMATS2[GL_FORMATS2["ALPHA"] = 6406] = "ALPHA";
    GL_FORMATS2[GL_FORMATS2["LUMINANCE"] = 6409] = "LUMINANCE";
    GL_FORMATS2[GL_FORMATS2["LUMINANCE_ALPHA"] = 6410] = "LUMINANCE_ALPHA";
    GL_FORMATS2[GL_FORMATS2["DEPTH_COMPONENT"] = 6402] = "DEPTH_COMPONENT";
    GL_FORMATS2[GL_FORMATS2["DEPTH_STENCIL"] = 34041] = "DEPTH_STENCIL";
    return GL_FORMATS2;
  })(GL_FORMATS || {});
  var GL_TARGETS =                 ((GL_TARGETS2) => {
    GL_TARGETS2[GL_TARGETS2["TEXTURE_2D"] = 3553] = "TEXTURE_2D";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP"] = 34067] = "TEXTURE_CUBE_MAP";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_2D_ARRAY"] = 35866] = "TEXTURE_2D_ARRAY";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_POSITIVE_X"] = 34069] = "TEXTURE_CUBE_MAP_POSITIVE_X";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_NEGATIVE_X"] = 34070] = "TEXTURE_CUBE_MAP_NEGATIVE_X";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_POSITIVE_Y"] = 34071] = "TEXTURE_CUBE_MAP_POSITIVE_Y";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_NEGATIVE_Y"] = 34072] = "TEXTURE_CUBE_MAP_NEGATIVE_Y";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_POSITIVE_Z"] = 34073] = "TEXTURE_CUBE_MAP_POSITIVE_Z";
    GL_TARGETS2[GL_TARGETS2["TEXTURE_CUBE_MAP_NEGATIVE_Z"] = 34074] = "TEXTURE_CUBE_MAP_NEGATIVE_Z";
    return GL_TARGETS2;
  })(GL_TARGETS || {});
  var GL_TYPES =                 ((GL_TYPES2) => {
    GL_TYPES2[GL_TYPES2["UNSIGNED_BYTE"] = 5121] = "UNSIGNED_BYTE";
    GL_TYPES2[GL_TYPES2["UNSIGNED_SHORT"] = 5123] = "UNSIGNED_SHORT";
    GL_TYPES2[GL_TYPES2["UNSIGNED_SHORT_5_6_5"] = 33635] = "UNSIGNED_SHORT_5_6_5";
    GL_TYPES2[GL_TYPES2["UNSIGNED_SHORT_4_4_4_4"] = 32819] = "UNSIGNED_SHORT_4_4_4_4";
    GL_TYPES2[GL_TYPES2["UNSIGNED_SHORT_5_5_5_1"] = 32820] = "UNSIGNED_SHORT_5_5_5_1";
    GL_TYPES2[GL_TYPES2["UNSIGNED_INT"] = 5125] = "UNSIGNED_INT";
    GL_TYPES2[GL_TYPES2["UNSIGNED_INT_10F_11F_11F_REV"] = 35899] = "UNSIGNED_INT_10F_11F_11F_REV";
    GL_TYPES2[GL_TYPES2["UNSIGNED_INT_2_10_10_10_REV"] = 33640] = "UNSIGNED_INT_2_10_10_10_REV";
    GL_TYPES2[GL_TYPES2["UNSIGNED_INT_24_8"] = 34042] = "UNSIGNED_INT_24_8";
    GL_TYPES2[GL_TYPES2["UNSIGNED_INT_5_9_9_9_REV"] = 35902] = "UNSIGNED_INT_5_9_9_9_REV";
    GL_TYPES2[GL_TYPES2["BYTE"] = 5120] = "BYTE";
    GL_TYPES2[GL_TYPES2["SHORT"] = 5122] = "SHORT";
    GL_TYPES2[GL_TYPES2["INT"] = 5124] = "INT";
    GL_TYPES2[GL_TYPES2["FLOAT"] = 5126] = "FLOAT";
    GL_TYPES2[GL_TYPES2["FLOAT_32_UNSIGNED_INT_24_8_REV"] = 36269] = "FLOAT_32_UNSIGNED_INT_24_8_REV";
    GL_TYPES2[GL_TYPES2["HALF_FLOAT"] = 36193] = "HALF_FLOAT";
    return GL_TYPES2;
  })(GL_TYPES || {});
  const infoMap = {
    uint8x2: GL_TYPES.UNSIGNED_BYTE,
    uint8x4: GL_TYPES.UNSIGNED_BYTE,
    sint8x2: GL_TYPES.BYTE,
    sint8x4: GL_TYPES.BYTE,
    unorm8x2: GL_TYPES.UNSIGNED_BYTE,
    unorm8x4: GL_TYPES.UNSIGNED_BYTE,
    snorm8x2: GL_TYPES.BYTE,
    snorm8x4: GL_TYPES.BYTE,
    uint16x2: GL_TYPES.UNSIGNED_SHORT,
    uint16x4: GL_TYPES.UNSIGNED_SHORT,
    sint16x2: GL_TYPES.SHORT,
    sint16x4: GL_TYPES.SHORT,
    unorm16x2: GL_TYPES.UNSIGNED_SHORT,
    unorm16x4: GL_TYPES.UNSIGNED_SHORT,
    snorm16x2: GL_TYPES.SHORT,
    snorm16x4: GL_TYPES.SHORT,
    float16x2: GL_TYPES.HALF_FLOAT,
    float16x4: GL_TYPES.HALF_FLOAT,
    float32: GL_TYPES.FLOAT,
    float32x2: GL_TYPES.FLOAT,
    float32x3: GL_TYPES.FLOAT,
    float32x4: GL_TYPES.FLOAT,
    uint32: GL_TYPES.UNSIGNED_INT,
    uint32x2: GL_TYPES.UNSIGNED_INT,
    uint32x3: GL_TYPES.UNSIGNED_INT,
    uint32x4: GL_TYPES.UNSIGNED_INT,
    sint32: GL_TYPES.INT,
    sint32x2: GL_TYPES.INT,
    sint32x3: GL_TYPES.INT,
    sint32x4: GL_TYPES.INT
  };
  function getGlTypeFromFormat(format) {
    return infoMap[format] ?? infoMap.float32;
  }
  const topologyToGlMap = {
    "point-list": 0,
    "line-list": 1,
    "line-strip": 3,
    "triangle-list": 4,
    "triangle-strip": 5
  };
  class GlGeometryGpuData {
    constructor() {
      this.vaoCache =                 Object.create(null);
    }
    destroy() {
      this.vaoCache =                 Object.create(null);
    }
  }
  class GlGeometrySystem {

    constructor(renderer) {
      this._renderer = renderer;
      this._activeGeometry = null;
      this._activeVao = null;
      this.hasVao = true;
      this.hasInstance = true;
      this._managedGeometries = new GCManagedHash({
        renderer,
        type: "resource",
        onUnload: this.onGeometryUnload.bind(this),
        name: "glGeometry"
      });
    }

    contextChange() {
      const gl = this.gl = this._renderer.gl;
      if (!this._renderer.context.supports.vertexArrayObject) {
        throw new Error("[PixiJS] Vertex Array Objects are not supported on this device");
      }
      this.destroyAll(true);
      const nativeVaoExtension = this._renderer.context.extensions.vertexArrayObject;
      if (nativeVaoExtension) {
        gl.createVertexArray = () => nativeVaoExtension.createVertexArrayOES();
        gl.bindVertexArray = (vao) => nativeVaoExtension.bindVertexArrayOES(vao);
        gl.deleteVertexArray = (vao) => nativeVaoExtension.deleteVertexArrayOES(vao);
      }
      const nativeInstancedExtension = this._renderer.context.extensions.vertexAttribDivisorANGLE;
      if (nativeInstancedExtension) {
        gl.drawArraysInstanced = (a2, b2, c2, d2) => {
          nativeInstancedExtension.drawArraysInstancedANGLE(a2, b2, c2, d2);
        };
        gl.drawElementsInstanced = (a2, b2, c2, d2, e2) => {
          nativeInstancedExtension.drawElementsInstancedANGLE(a2, b2, c2, d2, e2);
        };
        gl.vertexAttribDivisor = (a2, b2) => nativeInstancedExtension.vertexAttribDivisorANGLE(a2, b2);
      }
      this._activeGeometry = null;
      this._activeVao = null;
    }

    bind(geometry, program) {
      const gl = this.gl;
      this._activeGeometry = geometry;
      const vao = this.getVao(geometry, program);
      if (this._activeVao !== vao) {
        this._activeVao = vao;
        gl.bindVertexArray(vao);
      }
      this.updateBuffers();
    }

    resetState() {
      this.unbind();
    }

    updateBuffers() {
      const geometry = this._activeGeometry;
      const bufferSystem = this._renderer.buffer;
      for (let i2 = 0; i2 < geometry.buffers.length; i2++) {
        const buffer = geometry.buffers[i2];
        bufferSystem.updateBuffer(buffer);
      }
      geometry._gcLastUsed = this._renderer.gc.now;
    }

    checkCompatibility(geometry, program) {
      const geometryAttributes = geometry.attributes;
      const shaderAttributes = program._attributeData;
      for (const j2 in shaderAttributes) {
        if (!geometryAttributes[j2]) {
          throw new Error(`shader and geometry incompatible, geometry missing the "${j2}" attribute`);
        }
      }
    }

    getSignature(geometry, program) {
      const attribs = geometry.attributes;
      const shaderAttributes = program._attributeData;
      const strings = ["g", geometry.uid];
      for (const i2 in attribs) {
        if (shaderAttributes[i2]) {
          strings.push(i2, shaderAttributes[i2].location);
        }
      }
      return strings.join("-");
    }
    getVao(geometry, program) {
      return geometry._gpuData[this._renderer.uid]?.vaoCache[program._key] || this.initGeometryVao(geometry, program);
    }

    initGeometryVao(geometry, program, _incRefCount = true) {
      const gl = this._renderer.gl;
      const bufferSystem = this._renderer.buffer;
      this._renderer.shader._getProgramData(program);
      this.checkCompatibility(geometry, program);
      const signature = this.getSignature(geometry, program);
      let gpuData = geometry._gpuData[this._renderer.uid];
      if (!gpuData) {
        gpuData = new GlGeometryGpuData();
        geometry._gpuData[this._renderer.uid] = gpuData;
        this._managedGeometries.add(geometry);
      }
      const vaoObjectHash = gpuData.vaoCache;
      let vao = vaoObjectHash[signature];
      if (vao) {
        vaoObjectHash[program._key] = vao;
        return vao;
      }
      ensureAttributes(geometry, program._attributeData);
      const buffers = geometry.buffers;
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      for (let i2 = 0; i2 < buffers.length; i2++) {
        const buffer = buffers[i2];
        bufferSystem.bind(buffer);
      }
      this.activateVao(geometry, program);
      vaoObjectHash[program._key] = vao;
      vaoObjectHash[signature] = vao;
      gl.bindVertexArray(null);
      return vao;
    }
    onGeometryUnload(geometry, contextLost = false) {
      const gpuData = geometry._gpuData[this._renderer.uid];
      if (!gpuData) return;
      const vaoCache = gpuData.vaoCache;
      if (!contextLost) {
        for (const i2 in vaoCache) {
          if (this._activeVao !== vaoCache[i2]) {
            this.resetState();
          }
          this.gl.deleteVertexArray(vaoCache[i2]);
        }
      }
    }

    destroyAll(contextLost = false) {
      this._managedGeometries.removeAll(contextLost);
    }

    activateVao(geometry, program) {
      const gl = this._renderer.gl;
      const bufferSystem = this._renderer.buffer;
      const attributes = geometry.attributes;
      if (geometry.indexBuffer) {
        bufferSystem.bind(geometry.indexBuffer);
      }
      let lastBuffer = null;
      for (const j2 in attributes) {
        const attribute = attributes[j2];
        const buffer = attribute.buffer;
        const glBuffer = bufferSystem.getGlBuffer(buffer);
        const programAttrib = program._attributeData[j2];
        if (programAttrib) {
          if (lastBuffer !== glBuffer) {
            bufferSystem.bind(buffer);
            lastBuffer = glBuffer;
          }
          const location = programAttrib.location;
          gl.enableVertexAttribArray(location);
          const attributeInfo = getAttributeInfoFromFormat(attribute.format);
          const type = getGlTypeFromFormat(attribute.format);
          if (programAttrib.format?.substring(1, 4) === "int") {
            gl.vertexAttribIPointer(
              location,
              attributeInfo.size,
              type,
              attribute.stride,
              attribute.offset
            );
          } else {
            gl.vertexAttribPointer(
              location,
              attributeInfo.size,
              type,
              attributeInfo.normalised,
              attribute.stride,
              attribute.offset
            );
          }
          if (attribute.instance) {
            if (this.hasInstance) {
              const divisor = attribute.divisor ?? 1;
              gl.vertexAttribDivisor(location, divisor);
            } else {
              throw new Error("geometry error, GPU Instancing is not supported on this device");
            }
          }
        }
      }
    }

    draw(topology, size, start2, instanceCount) {
      const { gl } = this._renderer;
      const geometry = this._activeGeometry;
      const glTopology = topologyToGlMap[topology || geometry.topology];
      instanceCount ?? (instanceCount = geometry.instanceCount);
      if (geometry.indexBuffer) {
        const byteSize = geometry.indexBuffer.data.BYTES_PER_ELEMENT;
        const glType = byteSize === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
        if (instanceCount !== 1) {
          gl.drawElementsInstanced(glTopology, size || geometry.indexBuffer.data.length, glType, (start2 || 0) * byteSize, instanceCount);
        } else {
          gl.drawElements(glTopology, size || geometry.indexBuffer.data.length, glType, (start2 || 0) * byteSize);
        }
      } else if (instanceCount !== 1) {
        gl.drawArraysInstanced(glTopology, start2 || 0, size || geometry.getSize(), instanceCount);
      } else {
        gl.drawArrays(glTopology, start2 || 0, size || geometry.getSize());
      }
      return this;
    }

    unbind() {
      this.gl.bindVertexArray(null);
      this._activeVao = null;
      this._activeGeometry = null;
    }
    destroy() {
      this._managedGeometries.destroy();
      this._renderer = null;
      this.gl = null;
      this._activeVao = null;
      this._activeGeometry = null;
    }
  }
  GlGeometrySystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "geometry"
  };
  const bigTriangleGeometry = new Geometry({
    attributes: {
      aPosition: [
        -1,
        -1,

        3,
        -1,

        -1,
        3

      ]
    }
  });
  const _GlBackBufferSystem = class _GlBackBufferSystem2 {
    constructor(renderer) {
      this.useBackBuffer = false;
      this._useBackBufferThisRender = false;
      this._renderer = renderer;
    }
    init(options = {}) {
      const { useBackBuffer, antialias } = { ..._GlBackBufferSystem2.defaultOptions, ...options };
      this.useBackBuffer = useBackBuffer;
      this._antialias = antialias;
      if (!this._renderer.context.supports.msaa) {
        warn("antialiasing, is not supported on when using the back buffer");
        this._antialias = false;
      }
      this._state = State.for2d();
      const bigTriangleProgram = new GlProgram({
        vertex: `
                attribute vec2 aPosition;
                out vec2 vUv;

                void main() {
                    gl_Position = vec4(aPosition, 0.0, 1.0);

                    vUv = (aPosition + 1.0) / 2.0;

                    // flip dem UVs
                    vUv.y = 1.0 - vUv.y;
                }`,
        fragment: `
                in vec2 vUv;
                out vec4 finalColor;

                uniform sampler2D uTexture;

                void main() {
                    finalColor = texture(uTexture, vUv);
                }`,
        name: "big-triangle"
      });
      this._bigTriangleShader = new Shader({
        glProgram: bigTriangleProgram,
        resources: {
          uTexture: Texture.WHITE.source
        }
      });
    }

    renderStart(options) {
      const renderTarget = this._renderer.renderTarget.getRenderTarget(options.target);
      this._useBackBufferThisRender = this.useBackBuffer && !!renderTarget.isRoot;
      if (this._useBackBufferThisRender) {
        const renderTarget2 = this._renderer.renderTarget.getRenderTarget(options.target);
        this._targetTexture = renderTarget2.colorTexture;
        options.target = this._getBackBufferTexture(renderTarget2.colorTexture);
      }
    }
    renderEnd() {
      this._presentBackBuffer();
    }
    _presentBackBuffer() {
      const renderer = this._renderer;
      renderer.renderTarget.finishRenderPass();
      if (!this._useBackBufferThisRender) return;
      renderer.renderTarget.bind(this._targetTexture, false);
      this._bigTriangleShader.resources.uTexture = this._backBufferTexture.source;
      renderer.encoder.draw({
        geometry: bigTriangleGeometry,
        shader: this._bigTriangleShader,
        state: this._state
      });
    }
    _getBackBufferTexture(targetSourceTexture) {
      this._backBufferTexture = this._backBufferTexture || new Texture({
        source: new TextureSource({
          width: targetSourceTexture.width,
          height: targetSourceTexture.height,
          resolution: targetSourceTexture._resolution,
          antialias: this._antialias
        })
      });
      this._backBufferTexture.source.resize(
        targetSourceTexture.width,
        targetSourceTexture.height,
        targetSourceTexture._resolution
      );
      return this._backBufferTexture;
    }

    destroy() {
      if (this._backBufferTexture) {
        this._backBufferTexture.destroy();
        this._backBufferTexture = null;
      }
    }
  };
  _GlBackBufferSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "backBuffer",
    priority: 1
  };
  _GlBackBufferSystem.defaultOptions = {

    useBackBuffer: false
  };
  let GlBackBufferSystem = _GlBackBufferSystem;
  class GlColorMaskSystem {
    constructor(renderer) {
      this._colorMaskCache = 15;
      this._renderer = renderer;
    }
    setMask(colorMask) {
      if (this._colorMaskCache === colorMask) return;
      this._colorMaskCache = colorMask;
      this._renderer.gl.colorMask(
        !!(colorMask & 8),
        !!(colorMask & 4),
        !!(colorMask & 2),
        !!(colorMask & 1)
      );
    }
  }
  GlColorMaskSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "colorMask"
  };
  class GlEncoderSystem {
    constructor(renderer) {
      this.commandFinished = Promise.resolve();
      this._renderer = renderer;
    }
    setGeometry(geometry, shader) {
      this._renderer.geometry.bind(geometry, shader.glProgram);
    }
    finishRenderPass() {
    }
    draw(options) {
      const renderer = this._renderer;
      const { geometry, shader, state, skipSync, topology: type, size, start: start2, instanceCount } = options;
      renderer.shader.bind(shader, skipSync);
      renderer.geometry.bind(geometry, renderer.shader._activeProgram);
      if (state) {
        renderer.state.set(state);
      }
      renderer.geometry.draw(type, size, start2, instanceCount ?? geometry.instanceCount);
    }
    destroy() {
      this._renderer = null;
    }
  }
  GlEncoderSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "encoder"
  };
  class GlLimitsSystem {
    constructor(renderer) {
      this._renderer = renderer;
    }
    contextChange() {
      const gl = this._renderer.gl;
      this.maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      this.maxBatchableTextures = checkMaxIfStatementsInShader(this.maxTextures, gl);
      const isWebGl2 = this._renderer.context.webGLVersion === 2;
      this.maxUniformBindings = isWebGl2 ? gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) : 0;
    }
    destroy() {
    }
  }
  GlLimitsSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "limits"
  };
  class GlRenderTarget {
    constructor() {
      this.width = -1;
      this.height = -1;
      this.msaa = false;
      this._attachedMipLevel = 0;
      this._attachedLayer = 0;
      this.msaaRenderBuffer = [];
    }
  }
  const GpuStencilModesToPixi = [];
  GpuStencilModesToPixi[STENCIL_MODES.NONE] = void 0;
  GpuStencilModesToPixi[STENCIL_MODES.DISABLED] = {
    stencilWriteMask: 0,
    stencilReadMask: 0
  };
  GpuStencilModesToPixi[STENCIL_MODES.RENDERING_MASK_ADD] = {
    stencilFront: {
      compare: "equal",
      passOp: "increment-clamp"
    },
    stencilBack: {
      compare: "equal",
      passOp: "increment-clamp"
    }
  };
  GpuStencilModesToPixi[STENCIL_MODES.RENDERING_MASK_REMOVE] = {
    stencilFront: {
      compare: "equal",
      passOp: "decrement-clamp"
    },
    stencilBack: {
      compare: "equal",
      passOp: "decrement-clamp"
    }
  };
  GpuStencilModesToPixi[STENCIL_MODES.MASK_ACTIVE] = {
    stencilWriteMask: 0,
    stencilFront: {
      compare: "equal",
      passOp: "keep"
    },
    stencilBack: {
      compare: "equal",
      passOp: "keep"
    }
  };
  GpuStencilModesToPixi[STENCIL_MODES.INVERSE_MASK_ACTIVE] = {
    stencilWriteMask: 0,
    stencilFront: {
      compare: "not-equal",
      passOp: "keep"
    },
    stencilBack: {
      compare: "not-equal",
      passOp: "keep"
    }
  };
  class GlStencilSystem {
    constructor(renderer) {
      this._stencilCache = {
        enabled: false,
        stencilReference: 0,
        stencilMode: STENCIL_MODES.NONE
      };
      this._renderTargetStencilState =                 Object.create(null);
      renderer.renderTarget.onRenderTargetChange.add(this);
    }
    contextChange(gl) {
      this._gl = gl;
      this._comparisonFuncMapping = {
        always: gl.ALWAYS,
        never: gl.NEVER,
        equal: gl.EQUAL,
        "not-equal": gl.NOTEQUAL,
        less: gl.LESS,
        "less-equal": gl.LEQUAL,
        greater: gl.GREATER,
        "greater-equal": gl.GEQUAL
      };
      this._stencilOpsMapping = {
        keep: gl.KEEP,
        zero: gl.ZERO,
        replace: gl.REPLACE,
        invert: gl.INVERT,
        "increment-clamp": gl.INCR,
        "decrement-clamp": gl.DECR,
        "increment-wrap": gl.INCR_WRAP,
        "decrement-wrap": gl.DECR_WRAP
      };
      this.resetState();
    }
    onRenderTargetChange(renderTarget) {
      if (this._activeRenderTarget === renderTarget) return;
      this._activeRenderTarget = renderTarget;
      let stencilState = this._renderTargetStencilState[renderTarget.uid];
      if (!stencilState) {
        stencilState = this._renderTargetStencilState[renderTarget.uid] = {
          stencilMode: STENCIL_MODES.DISABLED,
          stencilReference: 0
        };
      }
      this.setStencilMode(stencilState.stencilMode, stencilState.stencilReference);
    }
    resetState() {
      this._stencilCache.enabled = false;
      this._stencilCache.stencilMode = STENCIL_MODES.NONE;
      this._stencilCache.stencilReference = 0;
    }
    setStencilMode(stencilMode, stencilReference) {
      const stencilState = this._renderTargetStencilState[this._activeRenderTarget.uid];
      const gl = this._gl;
      const mode = GpuStencilModesToPixi[stencilMode];
      const _stencilCache = this._stencilCache;
      stencilState.stencilMode = stencilMode;
      stencilState.stencilReference = stencilReference;
      if (stencilMode === STENCIL_MODES.DISABLED) {
        if (this._stencilCache.enabled) {
          this._stencilCache.enabled = false;
          gl.disable(gl.STENCIL_TEST);
        }
        return;
      }
      if (!this._stencilCache.enabled) {
        this._stencilCache.enabled = true;
        gl.enable(gl.STENCIL_TEST);
      }
      if (stencilMode !== _stencilCache.stencilMode || _stencilCache.stencilReference !== stencilReference) {
        _stencilCache.stencilMode = stencilMode;
        _stencilCache.stencilReference = stencilReference;
        gl.stencilFunc(this._comparisonFuncMapping[mode.stencilBack.compare], stencilReference, 255);
        gl.stencilOp(gl.KEEP, gl.KEEP, this._stencilOpsMapping[mode.stencilBack.passOp]);
      }
    }
  }
  GlStencilSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "stencil"
  };
  class UboSystem {
    constructor(adaptor) {
      this._syncFunctionHash =                 Object.create(null);
      this._adaptor = adaptor;
      this._systemCheck();
    }

    _systemCheck() {
      if (!unsafeEvalSupported()) {
        throw new Error("Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module to enable support.");
      }
    }
    ensureUniformGroup(uniformGroup) {
      const uniformData = this.getUniformGroupData(uniformGroup);
      uniformGroup.buffer || (uniformGroup.buffer = new Buffer({
        data: new Float32Array(uniformData.layout.size / 4),
        usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST
      }));
    }
    getUniformGroupData(uniformGroup) {
      return this._syncFunctionHash[uniformGroup._signature] || this._initUniformGroup(uniformGroup);
    }
    _initUniformGroup(uniformGroup) {
      const uniformGroupSignature = uniformGroup._signature;
      let uniformData = this._syncFunctionHash[uniformGroupSignature];
      if (!uniformData) {
        const elements = Object.keys(uniformGroup.uniformStructures).map((i2) => uniformGroup.uniformStructures[i2]);
        const layout = this._adaptor.createUboElements(elements);
        const syncFunction = this._generateUboSync(layout.uboElements);
        uniformData = this._syncFunctionHash[uniformGroupSignature] = {
          layout,
          syncFunction
        };
      }
      return this._syncFunctionHash[uniformGroupSignature];
    }
    _generateUboSync(uboElements) {
      return this._adaptor.generateUboSync(uboElements);
    }
    syncUniformGroup(uniformGroup, data, offset2) {
      const uniformGroupData = this.getUniformGroupData(uniformGroup);
      uniformGroup.buffer || (uniformGroup.buffer = new Buffer({
        data: new Float32Array(uniformGroupData.layout.size / 4),
        usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST
      }));
      let dataInt32 = null;
      if (!data) {
        data = uniformGroup.buffer.data;
        dataInt32 = uniformGroup.buffer.dataInt32;
      }
      offset2 || (offset2 = 0);
      uniformGroupData.syncFunction(uniformGroup.uniforms, data, dataInt32, offset2);
      return true;
    }
    updateUniformGroup(uniformGroup) {
      if (uniformGroup.isStatic && !uniformGroup._dirtyId) return false;
      uniformGroup._dirtyId = 0;
      const synced = this.syncUniformGroup(uniformGroup);
      uniformGroup.buffer.update();
      return synced;
    }
    destroy() {
      this._syncFunctionHash = null;
    }
  }
  const WGSL_TO_STD40_SIZE = {
    f32: 4,
    i32: 4,
    "vec2<f32>": 8,
    "vec3<f32>": 12,
    "vec4<f32>": 16,
    "vec2<i32>": 8,
    "vec3<i32>": 12,
    "vec4<i32>": 16,
    "mat2x2<f32>": 16 * 2,
    "mat3x3<f32>": 16 * 3,
    "mat4x4<f32>": 16 * 4

  };
  function createUboElementsSTD40(uniformData) {
    const uboElements = uniformData.map((data) => ({
      data,
      offset: 0,
      size: 0
    }));
    const chunkSize = 16;
    let size = 0;
    let offset2 = 0;
    for (let i2 = 0; i2 < uboElements.length; i2++) {
      const uboElement = uboElements[i2];
      size = WGSL_TO_STD40_SIZE[uboElement.data.type];
      if (!size) {
        throw new Error(`Unknown type ${uboElement.data.type}`);
      }
      if (uboElement.data.size > 1) {
        size = Math.max(size, chunkSize) * uboElement.data.size;
      }
      const boundary = size === 12 ? 16 : size;
      uboElement.size = size;
      const curOffset = offset2 % chunkSize;
      if (curOffset > 0 && chunkSize - curOffset < boundary) {
        offset2 += (chunkSize - curOffset) % 16;
      } else {
        offset2 += (size - curOffset % size) % size;
      }
      uboElement.offset = offset2;
      offset2 += size;
    }
    offset2 = Math.ceil(offset2 / 16) * 16;
    return { uboElements, size: offset2 };
  }
  const uniformParsers = [

    {
      type: "mat3x3<f32>",
      test: (data) => {
        const value = data.value;
        return value.a !== void 0;
      },
      ubo: `
            var matrix = uv[name].toArray(true);
            data[offset] = matrix[0];
            data[offset + 1] = matrix[1];
            data[offset + 2] = matrix[2];
            data[offset + 4] = matrix[3];
            data[offset + 5] = matrix[4];
            data[offset + 6] = matrix[5];
            data[offset + 8] = matrix[6];
            data[offset + 9] = matrix[7];
            data[offset + 10] = matrix[8];
        `,
      uniform: `
            gl.uniformMatrix3fv(ud[name].location, false, uv[name].toArray(true));
        `
    },

    {
      type: "vec4<f32>",
      test: (data) => data.type === "vec4<f32>" && data.size === 1 && data.value.width !== void 0,
      ubo: `
            v = uv[name];
            data[offset] = v.x;
            data[offset + 1] = v.y;
            data[offset + 2] = v.width;
            data[offset + 3] = v.height;
        `,
      uniform: `
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.x || cv[1] !== v.y || cv[2] !== v.width || cv[3] !== v.height) {
                cv[0] = v.x;
                cv[1] = v.y;
                cv[2] = v.width;
                cv[3] = v.height;
                gl.uniform4f(ud[name].location, v.x, v.y, v.width, v.height);
            }
        `
    },

    {
      type: "vec2<f32>",
      test: (data) => data.type === "vec2<f32>" && data.size === 1 && data.value.x !== void 0,
      ubo: `
            v = uv[name];
            data[offset] = v.x;
            data[offset + 1] = v.y;
        `,
      uniform: `
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.x || cv[1] !== v.y) {
                cv[0] = v.x;
                cv[1] = v.y;
                gl.uniform2f(ud[name].location, v.x, v.y);
            }
        `
    },

    {
      type: "vec4<f32>",
      test: (data) => data.type === "vec4<f32>" && data.size === 1 && data.value.red !== void 0,
      ubo: `
            v = uv[name];
            data[offset] = v.red;
            data[offset + 1] = v.green;
            data[offset + 2] = v.blue;
            data[offset + 3] = v.alpha;
        `,
      uniform: `
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.red || cv[1] !== v.green || cv[2] !== v.blue || cv[3] !== v.alpha) {
                cv[0] = v.red;
                cv[1] = v.green;
                cv[2] = v.blue;
                cv[3] = v.alpha;
                gl.uniform4f(ud[name].location, v.red, v.green, v.blue, v.alpha);
            }
        `
    },

    {
      type: "vec3<f32>",
      test: (data) => data.type === "vec3<f32>" && data.size === 1 && data.value.red !== void 0,
      ubo: `
            v = uv[name];
            data[offset] = v.red;
            data[offset + 1] = v.green;
            data[offset + 2] = v.blue;
        `,
      uniform: `
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.red || cv[1] !== v.green || cv[2] !== v.blue) {
                cv[0] = v.red;
                cv[1] = v.green;
                cv[2] = v.blue;
                gl.uniform3f(ud[name].location, v.red, v.green, v.blue);
            }
        `
    }
  ];
  function createUboSyncFunction(uboElements, parserCode, arrayGenerationFunction, singleSettersMap) {
    const funcFragments = [`
        var v = null;
        var v2 = null;
        var t = 0;
        var index = 0;
        var name = null;
        var arrayOffset = null;
    `];
    let prev = 0;
    for (let i2 = 0; i2 < uboElements.length; i2++) {
      const uboElement = uboElements[i2];
      const name = uboElement.data.name;
      let parsed = false;
      let offset2 = 0;
      for (let j2 = 0; j2 < uniformParsers.length; j2++) {
        const uniformParser = uniformParsers[j2];
        if (uniformParser.test(uboElement.data)) {
          offset2 = uboElement.offset / 4;
          funcFragments.push(
            `name = "${name}";`,
            `offset += ${offset2 - prev};`,
            uniformParsers[j2][parserCode] || uniformParsers[j2].ubo
          );
          parsed = true;
          break;
        }
      }
      if (!parsed) {
        if (uboElement.data.size > 1) {
          offset2 = uboElement.offset / 4;
          funcFragments.push(arrayGenerationFunction(uboElement, offset2 - prev));
        } else {
          const template = singleSettersMap[uboElement.data.type];
          offset2 = uboElement.offset / 4;
          funcFragments.push(

            `
                    v = uv.${name};
                    offset += ${offset2 - prev};
                    ${template};
                `
          );
        }
      }
      prev = offset2;
    }
    const fragmentSrc = funcFragments.join("\n");
    return new Function(
      "uv",
      "data",
      "dataInt32",
      "offset",
      fragmentSrc
    );
  }
  function loopMatrix(col, row) {
    const total = col * row;
    return `
        for (let i = 0; i < ${total}; i++) {
            data[offset + (((i / ${col})|0) * 4) + (i % ${col})] = v[i];
        }
    `;
  }
  const uboSyncFunctionsSTD40 = {
    f32: `
        data[offset] = v;`,
    i32: `
        dataInt32[offset] = v;`,
    "vec2<f32>": `
        data[offset] = v[0];
        data[offset + 1] = v[1];`,
    "vec3<f32>": `
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];`,
    "vec4<f32>": `
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 3] = v[3];`,
    "vec2<i32>": `
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];`,
    "vec3<i32>": `
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];
        dataInt32[offset + 2] = v[2];`,
    "vec4<i32>": `
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];
        dataInt32[offset + 2] = v[2];
        dataInt32[offset + 3] = v[3];`,
    "mat2x2<f32>": `
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 4] = v[2];
        data[offset + 5] = v[3];`,
    "mat3x3<f32>": `
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 4] = v[3];
        data[offset + 5] = v[4];
        data[offset + 6] = v[5];
        data[offset + 8] = v[6];
        data[offset + 9] = v[7];
        data[offset + 10] = v[8];`,
    "mat4x4<f32>": `
        for (let i = 0; i < 16; i++) {
            data[offset + i] = v[i];
        }`,
    "mat3x2<f32>": loopMatrix(3, 2),
    "mat4x2<f32>": loopMatrix(4, 2),
    "mat2x3<f32>": loopMatrix(2, 3),
    "mat4x3<f32>": loopMatrix(4, 3),
    "mat2x4<f32>": loopMatrix(2, 4),
    "mat3x4<f32>": loopMatrix(3, 4)
  };
  ({
    ...uboSyncFunctionsSTD40
  });
  function generateArraySyncSTD40(uboElement, offsetToAdd) {
    const rowSize = Math.max(WGSL_TO_STD40_SIZE[uboElement.data.type] / 16, 1);
    const elementSize = uboElement.data.value.length / uboElement.data.size;
    const remainder = (4 - elementSize % 4) % 4;
    const data = uboElement.data.type.indexOf("i32") >= 0 ? "dataInt32" : "data";
    return `
        v = uv.${uboElement.data.name};
        offset += ${offsetToAdd};

        arrayOffset = offset;

        t = 0;

        for(var i=0; i < ${uboElement.data.size * rowSize}; i++)
        {
            for(var j = 0; j < ${elementSize}; j++)
            {
                ${data}[arrayOffset++] = v[t++];
            }
            ${remainder !== 0 ? `arrayOffset += ${remainder};` : ""}
        }
    `;
  }
  function createUboSyncFunctionSTD40(uboElements) {
    return createUboSyncFunction(
      uboElements,
      "uboStd40",
      generateArraySyncSTD40,
      uboSyncFunctionsSTD40
    );
  }
  class GlUboSystem extends UboSystem {
    constructor() {
      super({
        createUboElements: createUboElementsSTD40,
        generateUboSync: createUboSyncFunctionSTD40
      });
    }
  }
  GlUboSystem.extension = {
    type: [ExtensionType.WebGLSystem],
    name: "ubo"
  };
  class GlRenderTargetAdaptor {
    constructor() {
      this._clearColorCache = [0, 0, 0, 0];
      this._viewPortCache = new Rectangle();
    }
    init(renderer, renderTargetSystem) {
      this._renderer = renderer;
      this._renderTargetSystem = renderTargetSystem;
      renderer.runners.contextChange.add(this);
    }
    contextChange() {
      this._clearColorCache = [0, 0, 0, 0];
      this._viewPortCache = new Rectangle();
      const gl = this._renderer.gl;
      this._drawBuffersCache = [];
      for (let i2 = 1; i2 <= 16; i2++) {
        this._drawBuffersCache[i2] = Array.from({ length: i2 }, (_, j2) => gl.COLOR_ATTACHMENT0 + j2);
      }
    }
    copyToTexture(sourceRenderSurfaceTexture, destinationTexture, originSrc, size, originDest) {
      const renderTargetSystem = this._renderTargetSystem;
      const renderer = this._renderer;
      const glRenderTarget = renderTargetSystem.getGpuRenderTarget(sourceRenderSurfaceTexture);
      const gl = renderer.gl;
      this.finishRenderPass(sourceRenderSurfaceTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glRenderTarget.resolveTargetFramebuffer);
      renderer.texture.bind(destinationTexture, 0);
      gl.copyTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        originDest.x,
        originDest.y,
        originSrc.x,
        originSrc.y,
        size.width,
        size.height
      );
      return destinationTexture;
    }
    startRenderPass(renderTarget, clear = true, clearColor, viewport, mipLevel = 0, layer2 = 0) {
      const renderTargetSystem = this._renderTargetSystem;
      const source2 = renderTarget.colorTexture;
      const gpuRenderTarget = renderTargetSystem.getGpuRenderTarget(renderTarget);
      if (layer2 !== 0 && this._renderer.context.webGLVersion < 2) {
        throw new Error("[RenderTargetSystem] Rendering to array layers requires WebGL2.");
      }
      if (mipLevel > 0) {
        if (gpuRenderTarget.msaa) {
          throw new Error("[RenderTargetSystem] Rendering to mip levels is not supported with MSAA render targets.");
        }
        if (this._renderer.context.webGLVersion < 2) {
          throw new Error("[RenderTargetSystem] Rendering to mip levels requires WebGL2.");
        }
      }
      let viewPortY = viewport.y;
      if (renderTarget.isRoot) {
        viewPortY = source2.pixelHeight - viewport.height - viewport.y;
      }
      renderTarget.colorTextures.forEach((texture) => {
        this._renderer.texture.unbind(texture);
      });
      const gl = this._renderer.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, gpuRenderTarget.framebuffer);
      if (!renderTarget.isRoot && (gpuRenderTarget._attachedMipLevel !== mipLevel || gpuRenderTarget._attachedLayer !== layer2)) {
        renderTarget.colorTextures.forEach((colorTexture, i2) => {
          const glSource = this._renderer.texture.getGlSource(colorTexture);
          if (glSource.target === gl.TEXTURE_2D) {
            if (layer2 !== 0) {
              throw new Error("[RenderTargetSystem] layer must be 0 when rendering to 2D textures in WebGL.");
            }
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0 + i2,
              gl.TEXTURE_2D,
              glSource.texture,
              mipLevel
            );
          } else if (glSource.target === gl.TEXTURE_2D_ARRAY) {
            if (this._renderer.context.webGLVersion < 2) {
              throw new Error("[RenderTargetSystem] Rendering to 2D array textures requires WebGL2.");
            }
            gl.framebufferTextureLayer(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0 + i2,
              glSource.texture,
              mipLevel,
              layer2
            );
          } else if (glSource.target === gl.TEXTURE_CUBE_MAP) {
            if (layer2 < 0 || layer2 > 5) {
              throw new Error("[RenderTargetSystem] Cube map layer must be between 0 and 5.");
            }
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0 + i2,
              gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer2,
              glSource.texture,
              mipLevel
            );
          } else {
            throw new Error("[RenderTargetSystem] Unsupported texture target for render-to-layer in WebGL.");
          }
        });
        gpuRenderTarget._attachedMipLevel = mipLevel;
        gpuRenderTarget._attachedLayer = layer2;
      }
      if (renderTarget.colorTextures.length > 1) {
        this._setDrawBuffers(renderTarget, gl);
      }
      const viewPortCache = this._viewPortCache;
      if (viewPortCache.x !== viewport.x || viewPortCache.y !== viewPortY || viewPortCache.width !== viewport.width || viewPortCache.height !== viewport.height) {
        viewPortCache.x = viewport.x;
        viewPortCache.y = viewPortY;
        viewPortCache.width = viewport.width;
        viewPortCache.height = viewport.height;
        gl.viewport(
          viewport.x,
          viewPortY,
          viewport.width,
          viewport.height
        );
      }
      if (!gpuRenderTarget.depthStencilRenderBuffer && (renderTarget.stencil || renderTarget.depth)) {
        this._initStencil(gpuRenderTarget);
      }
      this.clear(renderTarget, clear, clearColor);
    }
    finishRenderPass(renderTarget) {
      const renderTargetSystem = this._renderTargetSystem;
      const glRenderTarget = renderTargetSystem.getGpuRenderTarget(renderTarget);
      if (!glRenderTarget.msaa) return;
      const gl = this._renderer.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, glRenderTarget.resolveTargetFramebuffer);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, glRenderTarget.framebuffer);
      gl.blitFramebuffer(
        0,
        0,
        glRenderTarget.width,
        glRenderTarget.height,
        0,
        0,
        glRenderTarget.width,
        glRenderTarget.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, glRenderTarget.framebuffer);
    }
    initGpuRenderTarget(renderTarget) {
      const renderer = this._renderer;
      const gl = renderer.gl;
      const glRenderTarget = new GlRenderTarget();
      glRenderTarget._attachedMipLevel = 0;
      glRenderTarget._attachedLayer = 0;
      const colorTexture = renderTarget.colorTexture;
      if (colorTexture instanceof CanvasSource) {
        this._renderer.context.ensureCanvasSize(renderTarget.colorTexture.resource);
        glRenderTarget.framebuffer = null;
        return glRenderTarget;
      }
      this._initColor(renderTarget, glRenderTarget);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return glRenderTarget;
    }
    destroyGpuRenderTarget(gpuRenderTarget) {
      const gl = this._renderer.gl;
      if (gpuRenderTarget.framebuffer) {
        gl.deleteFramebuffer(gpuRenderTarget.framebuffer);
        gpuRenderTarget.framebuffer = null;
      }
      if (gpuRenderTarget.resolveTargetFramebuffer) {
        gl.deleteFramebuffer(gpuRenderTarget.resolveTargetFramebuffer);
        gpuRenderTarget.resolveTargetFramebuffer = null;
      }
      if (gpuRenderTarget.depthStencilRenderBuffer) {
        gl.deleteRenderbuffer(gpuRenderTarget.depthStencilRenderBuffer);
        gpuRenderTarget.depthStencilRenderBuffer = null;
      }
      gpuRenderTarget.msaaRenderBuffer.forEach((renderBuffer) => {
        gl.deleteRenderbuffer(renderBuffer);
      });
      gpuRenderTarget.msaaRenderBuffer = null;
    }
    clear(_renderTarget, clear, clearColor, _viewport, _mipLevel = 0, layer2 = 0) {
      if (!clear) return;
      if (layer2 !== 0) {
        throw new Error("[RenderTargetSystem] Clearing array layers is not supported in WebGL renderer.");
      }
      const renderTargetSystem = this._renderTargetSystem;
      if (typeof clear === "boolean") {
        clear = clear ? CLEAR.ALL : CLEAR.NONE;
      }
      const gl = this._renderer.gl;
      if (clear & CLEAR.COLOR) {
        clearColor ?? (clearColor = renderTargetSystem.defaultClearColor);
        const clearColorCache = this._clearColorCache;
        const clearColorArray = clearColor;
        if (clearColorCache[0] !== clearColorArray[0] || clearColorCache[1] !== clearColorArray[1] || clearColorCache[2] !== clearColorArray[2] || clearColorCache[3] !== clearColorArray[3]) {
          clearColorCache[0] = clearColorArray[0];
          clearColorCache[1] = clearColorArray[1];
          clearColorCache[2] = clearColorArray[2];
          clearColorCache[3] = clearColorArray[3];
          gl.clearColor(clearColorArray[0], clearColorArray[1], clearColorArray[2], clearColorArray[3]);
        }
      }
      gl.clear(clear);
    }
    resizeGpuRenderTarget(renderTarget) {
      if (renderTarget.isRoot) return;
      const renderTargetSystem = this._renderTargetSystem;
      const glRenderTarget = renderTargetSystem.getGpuRenderTarget(renderTarget);
      this._resizeColor(renderTarget, glRenderTarget);
      if (renderTarget.stencil || renderTarget.depth) {
        this._resizeStencil(glRenderTarget);
      }
    }
    _initColor(renderTarget, glRenderTarget) {
      const renderer = this._renderer;
      const gl = renderer.gl;
      const resolveTargetFramebuffer = gl.createFramebuffer();
      glRenderTarget.resolveTargetFramebuffer = resolveTargetFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, resolveTargetFramebuffer);
      glRenderTarget.width = renderTarget.colorTexture.source.pixelWidth;
      glRenderTarget.height = renderTarget.colorTexture.source.pixelHeight;
      const colorTextures = renderTarget.colorTextures;
      colorTextures.forEach((colorTexture, i2) => {
        const source2 = colorTexture.source;
        if (source2.antialias) {
          if (renderer.context.supports.msaa) {
            glRenderTarget.msaa = true;
          } else {
            warn("[RenderTexture] Antialiasing on textures is not supported in WebGL1");
          }
        }
        renderer.texture.bindSource(source2, 0);
        const glSource = renderer.texture.getGlSource(source2);
        const glTexture = glSource.texture;
        if (glSource.target === gl.TEXTURE_2D) {
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + i2,
            gl.TEXTURE_2D,
            glTexture,
            0
          );
        } else if (glSource.target === gl.TEXTURE_2D_ARRAY) {
          if (renderer.context.webGLVersion < 2) {
            throw new Error("[RenderTargetSystem] TEXTURE_2D_ARRAY requires WebGL2.");
          }
          gl.framebufferTextureLayer(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + i2,
            glTexture,
            0,
            0
          );
        } else if (glSource.target === gl.TEXTURE_CUBE_MAP) {
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + i2,
            gl.TEXTURE_CUBE_MAP_POSITIVE_X,
            glTexture,
            0
          );
        } else {
          throw new Error("[RenderTargetSystem] Unsupported texture target for framebuffer attachment.");
        }
      });
      if (glRenderTarget.msaa) {
        const viewFramebuffer = gl.createFramebuffer();
        glRenderTarget.framebuffer = viewFramebuffer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, viewFramebuffer);
        renderTarget.colorTextures.forEach((_, i2) => {
          const msaaRenderBuffer = gl.createRenderbuffer();
          glRenderTarget.msaaRenderBuffer[i2] = msaaRenderBuffer;
        });
      } else {
        glRenderTarget.framebuffer = resolveTargetFramebuffer;
      }
      this._resizeColor(renderTarget, glRenderTarget);
    }
    _resizeColor(renderTarget, glRenderTarget) {
      const source2 = renderTarget.colorTexture.source;
      glRenderTarget.width = source2.pixelWidth;
      glRenderTarget.height = source2.pixelHeight;
      glRenderTarget._attachedMipLevel = 0;
      glRenderTarget._attachedLayer = 0;
      renderTarget.colorTextures.forEach((colorTexture, i2) => {
        if (i2 === 0) return;
        colorTexture.source.resize(source2.width, source2.height, source2._resolution);
      });
      if (glRenderTarget.msaa) {
        const renderer = this._renderer;
        const gl = renderer.gl;
        const viewFramebuffer = glRenderTarget.framebuffer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, viewFramebuffer);
        renderTarget.colorTextures.forEach((colorTexture, i2) => {
          const source22 = colorTexture.source;
          renderer.texture.bindSource(source22, 0);
          const glSource = renderer.texture.getGlSource(source22);
          const glInternalFormat = glSource.internalFormat;
          const msaaRenderBuffer = glRenderTarget.msaaRenderBuffer[i2];
          gl.bindRenderbuffer(
            gl.RENDERBUFFER,
            msaaRenderBuffer
          );
          gl.renderbufferStorageMultisample(
            gl.RENDERBUFFER,
            4,
            glInternalFormat,
            source22.pixelWidth,
            source22.pixelHeight
          );
          gl.framebufferRenderbuffer(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + i2,
            gl.RENDERBUFFER,
            msaaRenderBuffer
          );
        });
      }
    }
    _initStencil(glRenderTarget) {
      if (glRenderTarget.framebuffer === null) return;
      const gl = this._renderer.gl;
      const depthStencilRenderBuffer = gl.createRenderbuffer();
      glRenderTarget.depthStencilRenderBuffer = depthStencilRenderBuffer;
      gl.bindRenderbuffer(
        gl.RENDERBUFFER,
        depthStencilRenderBuffer
      );
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.RENDERBUFFER,
        depthStencilRenderBuffer
      );
      this._resizeStencil(glRenderTarget);
    }
    _resizeStencil(glRenderTarget) {
      const gl = this._renderer.gl;
      gl.bindRenderbuffer(
        gl.RENDERBUFFER,
        glRenderTarget.depthStencilRenderBuffer
      );
      if (glRenderTarget.msaa) {
        gl.renderbufferStorageMultisample(
          gl.RENDERBUFFER,
          4,
          gl.DEPTH24_STENCIL8,
          glRenderTarget.width,
          glRenderTarget.height
        );
      } else {
        gl.renderbufferStorage(
          gl.RENDERBUFFER,
          this._renderer.context.webGLVersion === 2 ? gl.DEPTH24_STENCIL8 : gl.DEPTH_STENCIL,
          glRenderTarget.width,
          glRenderTarget.height
        );
      }
    }
    prerender(renderTarget) {
      const resource = renderTarget.colorTexture.resource;
      if (this._renderer.context.multiView && CanvasSource.test(resource)) {
        this._renderer.context.ensureCanvasSize(resource);
      }
    }
    postrender(renderTarget) {
      if (!this._renderer.context.multiView) return;
      if (CanvasSource.test(renderTarget.colorTexture.resource)) {
        const contextCanvas = this._renderer.context.canvas;
        const canvasSource = renderTarget.colorTexture;
        canvasSource.context2D.drawImage(
          contextCanvas,
          0,
          canvasSource.pixelHeight - contextCanvas.height
        );
      }
    }
    _setDrawBuffers(renderTarget, gl) {
      const count2 = renderTarget.colorTextures.length;
      const bufferArray = this._drawBuffersCache[count2];
      if (this._renderer.context.webGLVersion === 1) {
        const ext = this._renderer.context.extensions.drawBuffers;
        if (!ext) {
          warn("[RenderTexture] This WebGL1 context does not support rendering to multiple targets");
        } else {
          ext.drawBuffersWEBGL(bufferArray);
        }
      } else {
        gl.drawBuffers(bufferArray);
      }
    }
  }
  class GlRenderTargetSystem extends RenderTargetSystem {
    constructor(renderer) {
      super(renderer);
      this.adaptor = new GlRenderTargetAdaptor();
      this.adaptor.init(renderer, this);
    }
  }
  GlRenderTargetSystem.extension = {
    type: [ExtensionType.WebGLSystem],
    name: "renderTarget"
  };
  class BufferResource extends EventEmitter {

    constructor({ buffer, offset: offset2, size }) {
      super();
      this.uid = uid$1("buffer");
      this._resourceType = "bufferResource";
      this._touched = 0;
      this._resourceId = uid$1("resource");
      this._bufferResource = true;
      this.destroyed = false;
      this.buffer = buffer;
      this.offset = offset2 | 0;
      this.size = size;
      this.buffer.on("change", this.onBufferChange, this);
    }
    onBufferChange() {
      this._resourceId = uid$1("resource");
      this.emit("change", this);
    }

    destroy(destroyBuffer = false) {
      this.destroyed = true;
      if (destroyBuffer) {
        this.buffer.destroy();
      }
      this.emit("change", this);
      this.buffer = null;
      this.removeAllListeners();
    }
  }
  function generateShaderSyncCode(shader, shaderSystem) {
    const funcFragments = [];
    const headerFragments = [`
        var g = s.groups;
        var sS = r.shader;
        var p = s.glProgram;
        var ugS = r.uniformGroup;
        var resources;
    `];
    let addedTextreSystem = false;
    let textureCount = 0;
    const programData = shaderSystem._getProgramData(shader.glProgram);
    for (const i2 in shader.groups) {
      const group = shader.groups[i2];
      funcFragments.push(`
            resources = g[${i2}].resources;
        `);
      for (const j2 in group.resources) {
        const resource = group.resources[j2];
        if (resource instanceof UniformGroup) {
          if (resource.ubo) {
            const resName = shader._uniformBindMap[i2][Number(j2)];
            funcFragments.push(`
                        sS.bindUniformBlock(
                            resources[${j2}],
                            '${resName}',
                            ${shader.glProgram._uniformBlockData[resName].index}
                        );
                    `);
          } else {
            funcFragments.push(`
                        ugS.updateUniformGroup(resources[${j2}], p, sD);
                    `);
          }
        } else if (resource instanceof BufferResource) {
          const resName = shader._uniformBindMap[i2][Number(j2)];
          funcFragments.push(`
                    sS.bindUniformBlock(
                        resources[${j2}],
                        '${resName}',
                        ${shader.glProgram._uniformBlockData[resName].index}
                    );
                `);
        } else if (resource instanceof TextureSource) {
          const uniformName = shader._uniformBindMap[i2][j2];
          const uniformData = programData.uniformData[uniformName];
          if (uniformData) {
            if (!addedTextreSystem) {
              addedTextreSystem = true;
              headerFragments.push(`
                        var tS = r.texture;
                        `);
            }
            shaderSystem._gl.uniform1i(uniformData.location, textureCount);
            funcFragments.push(`
                        tS.bind(resources[${j2}], ${textureCount});
                    `);
            textureCount++;
          }
        }
      }
    }
    const functionSource = [...headerFragments, ...funcFragments].join("\n");
    return new Function("r", "s", "sD", functionSource);
  }
  class GlProgramData {

    constructor(program, uniformData) {
      this.program = program;
      this.uniformData = uniformData;
      this.uniformGroups = {};
      this.uniformDirtyGroups = {};
      this.uniformBlockBindings = {};
    }

    destroy() {
      this.uniformData = null;
      this.uniformGroups = null;
      this.uniformDirtyGroups = null;
      this.uniformBlockBindings = null;
      this.program = null;
    }
  }
  function compileShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
  }
  function booleanArray(size) {
    const array = new Array(size);
    for (let i2 = 0; i2 < array.length; i2++) {
      array[i2] = false;
    }
    return array;
  }
  function defaultValue(type, size) {
    switch (type) {
      case "float":
        return 0;
      case "vec2":
        return new Float32Array(2 * size);
      case "vec3":
        return new Float32Array(3 * size);
      case "vec4":
        return new Float32Array(4 * size);
      case "int":
      case "uint":
      case "sampler2D":
      case "sampler2DArray":
        return 0;
      case "ivec2":
        return new Int32Array(2 * size);
      case "ivec3":
        return new Int32Array(3 * size);
      case "ivec4":
        return new Int32Array(4 * size);
      case "uvec2":
        return new Uint32Array(2 * size);
      case "uvec3":
        return new Uint32Array(3 * size);
      case "uvec4":
        return new Uint32Array(4 * size);
      case "bool":
        return false;
      case "bvec2":
        return booleanArray(2 * size);
      case "bvec3":
        return booleanArray(3 * size);
      case "bvec4":
        return booleanArray(4 * size);
      case "mat2":
        return new Float32Array([
          1,
          0,
          0,
          1
        ]);
      case "mat3":
        return new Float32Array([
          1,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          1
        ]);
      case "mat4":
        return new Float32Array([
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ]);
    }
    return null;
  }
  let GL_TABLE = null;
  const GL_TO_GLSL_TYPES = {
    FLOAT: "float",
    FLOAT_VEC2: "vec2",
    FLOAT_VEC3: "vec3",
    FLOAT_VEC4: "vec4",
    INT: "int",
    INT_VEC2: "ivec2",
    INT_VEC3: "ivec3",
    INT_VEC4: "ivec4",
    UNSIGNED_INT: "uint",
    UNSIGNED_INT_VEC2: "uvec2",
    UNSIGNED_INT_VEC3: "uvec3",
    UNSIGNED_INT_VEC4: "uvec4",
    BOOL: "bool",
    BOOL_VEC2: "bvec2",
    BOOL_VEC3: "bvec3",
    BOOL_VEC4: "bvec4",
    FLOAT_MAT2: "mat2",
    FLOAT_MAT3: "mat3",
    FLOAT_MAT4: "mat4",
    SAMPLER_2D: "sampler2D",
    INT_SAMPLER_2D: "sampler2D",
    UNSIGNED_INT_SAMPLER_2D: "sampler2D",
    SAMPLER_CUBE: "samplerCube",
    INT_SAMPLER_CUBE: "samplerCube",
    UNSIGNED_INT_SAMPLER_CUBE: "samplerCube",
    SAMPLER_2D_ARRAY: "sampler2DArray",
    INT_SAMPLER_2D_ARRAY: "sampler2DArray",
    UNSIGNED_INT_SAMPLER_2D_ARRAY: "sampler2DArray"
  };
  const GLSL_TO_VERTEX_TYPES = {
    float: "float32",
    vec2: "float32x2",
    vec3: "float32x3",
    vec4: "float32x4",
    int: "sint32",
    ivec2: "sint32x2",
    ivec3: "sint32x3",
    ivec4: "sint32x4",
    uint: "uint32",
    uvec2: "uint32x2",
    uvec3: "uint32x3",
    uvec4: "uint32x4",
    bool: "uint32",
    bvec2: "uint32x2",
    bvec3: "uint32x3",
    bvec4: "uint32x4"
  };
  function mapType(gl, type) {
    if (!GL_TABLE) {
      const typeNames = Object.keys(GL_TO_GLSL_TYPES);
      GL_TABLE = {};
      for (let i2 = 0; i2 < typeNames.length; ++i2) {
        const tn = typeNames[i2];
        GL_TABLE[gl[tn]] = GL_TO_GLSL_TYPES[tn];
      }
    }
    return GL_TABLE[type];
  }
  function mapGlToVertexFormat(gl, type) {
    const typeValue = mapType(gl, type);
    return GLSL_TO_VERTEX_TYPES[typeValue] || "float32";
  }
  function extractAttributesFromGlProgram(program, gl, sortAttributes = false) {
    const attributes = {};
    const totalAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i2 = 0; i2 < totalAttributes; i2++) {
      const attribData = gl.getActiveAttrib(program, i2);
      if (attribData.name.startsWith("gl_")) {
        continue;
      }
      const format = mapGlToVertexFormat(gl, attribData.type);
      attributes[attribData.name] = {
        location: 0,

        format,
        stride: getAttributeInfoFromFormat(format).stride,
        offset: 0,
        instance: false,
        start: 0
      };
    }
    const keys = Object.keys(attributes);
    if (sortAttributes) {
      keys.sort((a2, b2) => a2 > b2 ? 1 : -1);
      for (let i2 = 0; i2 < keys.length; i2++) {
        attributes[keys[i2]].location = i2;
        gl.bindAttribLocation(program, i2, keys[i2]);
      }
      gl.linkProgram(program);
    } else {
      for (let i2 = 0; i2 < keys.length; i2++) {
        attributes[keys[i2]].location = gl.getAttribLocation(program, keys[i2]);
      }
    }
    return attributes;
  }
  function getUboData(program, gl) {
    if (!gl.ACTIVE_UNIFORM_BLOCKS) return {};
    const uniformBlocks = {};
    const totalUniformsBlocks = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS);
    for (let i2 = 0; i2 < totalUniformsBlocks; i2++) {
      const name = gl.getActiveUniformBlockName(program, i2);
      const uniformBlockIndex = gl.getUniformBlockIndex(program, name);
      const size = gl.getActiveUniformBlockParameter(program, i2, gl.UNIFORM_BLOCK_DATA_SIZE);
      uniformBlocks[name] = {
        name,
        index: uniformBlockIndex,
        size
      };
    }
    return uniformBlocks;
  }
  function getUniformData(program, gl) {
    const uniforms = {};
    const totalUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i2 = 0; i2 < totalUniforms; i2++) {
      const uniformData = gl.getActiveUniform(program, i2);
      const name = uniformData.name.replace(/\[.*?\]$/, "");
      const isArray = !!uniformData.name.match(/\[.*?\]$/);
      const type = mapType(gl, uniformData.type);
      uniforms[name] = {
        name,
        index: i2,
        type,
        size: uniformData.size,
        isArray,
        value: defaultValue(type, uniformData.size)
      };
    }
    return uniforms;
  }
  function logPrettyShaderError(gl, shader) {
    const shaderSrc = gl.getShaderSource(shader).split("\n").map((line, index) => `${index}: ${line}`);
    const shaderLog = gl.getShaderInfoLog(shader);
    const splitShader = shaderLog.split("\n");
    const dedupe = {};
    const lineNumbers = splitShader.map((line) => parseFloat(line.replace(/^ERROR\: 0\:([\d]+)\:.*$/, "$1"))).filter((n2) => {
      if (n2 && !dedupe[n2]) {
        dedupe[n2] = true;
        return true;
      }
      return false;
    });
    const logArgs = [""];
    lineNumbers.forEach((number2) => {
      shaderSrc[number2 - 1] = `%c${shaderSrc[number2 - 1]}%c`;
      logArgs.push("background: #FF0000; color:#FFFFFF; font-size: 10px", "font-size: 10px");
    });
    const fragmentSourceToLog = shaderSrc.join("\n");
    logArgs[0] = fragmentSourceToLog;
    console.error(shaderLog);
    console.groupCollapsed("click to view full shader code");
    console.warn(...logArgs);
    console.groupEnd();
  }
  function logProgramError(gl, program, vertexShader, fragmentShader) {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        logPrettyShaderError(gl, vertexShader);
      }
      if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        logPrettyShaderError(gl, fragmentShader);
      }
      console.error("PixiJS Error: Could not initialize shader.");
      if (gl.getProgramInfoLog(program) !== "") {
        console.warn("PixiJS Warning: gl.getProgramInfoLog()", gl.getProgramInfoLog(program));
      }
    }
  }
  function generateProgram(gl, program) {
    const glVertShader = compileShader(gl, gl.VERTEX_SHADER, program.vertex);
    const glFragShader = compileShader(gl, gl.FRAGMENT_SHADER, program.fragment);
    const webGLProgram = gl.createProgram();
    gl.attachShader(webGLProgram, glVertShader);
    gl.attachShader(webGLProgram, glFragShader);
    const transformFeedbackVaryings = program.transformFeedbackVaryings;
    if (transformFeedbackVaryings) {
      if (typeof gl.transformFeedbackVaryings !== "function") {
        warn(`TransformFeedback is not supported but TransformFeedbackVaryings are given.`);
      } else {
        gl.transformFeedbackVaryings(
          webGLProgram,
          transformFeedbackVaryings.names,
          transformFeedbackVaryings.bufferMode === "separate" ? gl.SEPARATE_ATTRIBS : gl.INTERLEAVED_ATTRIBS
        );
      }
    }
    gl.linkProgram(webGLProgram);
    if (!gl.getProgramParameter(webGLProgram, gl.LINK_STATUS)) {
      logProgramError(gl, webGLProgram, glVertShader, glFragShader);
    }
    program._attributeData = extractAttributesFromGlProgram(
      webGLProgram,
      gl,
      !/^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m.test(program.vertex)
    );
    program._uniformData = getUniformData(webGLProgram, gl);
    program._uniformBlockData = getUboData(webGLProgram, gl);
    gl.deleteShader(glVertShader);
    gl.deleteShader(glFragShader);
    const uniformData = {};
    for (const i2 in program._uniformData) {
      const data = program._uniformData[i2];
      uniformData[i2] = {
        location: gl.getUniformLocation(webGLProgram, i2),
        value: defaultValue(data.type, data.size)
      };
    }
    const glProgram = new GlProgramData(webGLProgram, uniformData);
    return glProgram;
  }
  const defaultSyncData = {
    textureCount: 0,
    blockIndex: 0
  };
  class GlShaderSystem {
    constructor(renderer) {
      this._activeProgram = null;
      this._programDataHash =                 Object.create(null);
      this._shaderSyncFunctions =                 Object.create(null);
      this._renderer = renderer;
    }
    contextChange(gl) {
      this._gl = gl;
      this._programDataHash =                 Object.create(null);
      this._shaderSyncFunctions =                 Object.create(null);
      this._activeProgram = null;
    }

    bind(shader, skipSync) {
      this._setProgram(shader.glProgram);
      if (skipSync) return;
      defaultSyncData.textureCount = 0;
      defaultSyncData.blockIndex = 0;
      let syncFunction = this._shaderSyncFunctions[shader.glProgram._key];
      if (!syncFunction) {
        syncFunction = this._shaderSyncFunctions[shader.glProgram._key] = this._generateShaderSync(shader, this);
      }
      this._renderer.buffer.nextBindBase(!!shader.glProgram.transformFeedbackVaryings);
      syncFunction(this._renderer, shader, defaultSyncData);
    }

    updateUniformGroup(uniformGroup) {
      this._renderer.uniformGroup.updateUniformGroup(uniformGroup, this._activeProgram, defaultSyncData);
    }

    bindUniformBlock(uniformGroup, name, index = 0) {
      const bufferSystem = this._renderer.buffer;
      const programData = this._getProgramData(this._activeProgram);
      const isBufferResource = uniformGroup._bufferResource;
      if (!isBufferResource) {
        this._renderer.ubo.updateUniformGroup(uniformGroup);
      }
      const buffer = uniformGroup.buffer;
      const glBuffer = bufferSystem.updateBuffer(buffer);
      const boundLocation = bufferSystem.freeLocationForBufferBase(glBuffer);
      if (isBufferResource) {
        const { offset: offset2, size } = uniformGroup;
        if (offset2 === 0 && size === buffer.data.byteLength) {
          bufferSystem.bindBufferBase(glBuffer, boundLocation);
        } else {
          bufferSystem.bindBufferRange(glBuffer, boundLocation, offset2);
        }
      } else if (bufferSystem.getLastBindBaseLocation(glBuffer) !== boundLocation) {
        bufferSystem.bindBufferBase(glBuffer, boundLocation);
      }
      const uniformBlockIndex = this._activeProgram._uniformBlockData[name].index;
      if (programData.uniformBlockBindings[index] === boundLocation) return;
      programData.uniformBlockBindings[index] = boundLocation;
      this._renderer.gl.uniformBlockBinding(programData.program, uniformBlockIndex, boundLocation);
    }
    _setProgram(program) {
      if (this._activeProgram === program) return;
      this._activeProgram = program;
      const programData = this._getProgramData(program);
      this._gl.useProgram(programData.program);
    }

    _getProgramData(program) {
      return this._programDataHash[program._key] || this._createProgramData(program);
    }
    _createProgramData(program) {
      const key = program._key;
      this._programDataHash[key] = generateProgram(this._gl, program);
      return this._programDataHash[key];
    }
    destroy() {
      for (const key of Object.keys(this._programDataHash)) {
        this._programDataHash[key].destroy();
      }
      this._programDataHash = null;
      this._shaderSyncFunctions = null;
      this._activeProgram = null;
      this._renderer = null;
      this._gl = null;
    }

    _generateShaderSync(shader, shaderSystem) {
      return generateShaderSyncCode(shader, shaderSystem);
    }
    resetState() {
      this._activeProgram = null;
    }
  }
  GlShaderSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "shader"
  };
  const UNIFORM_TO_SINGLE_SETTERS = {
    f32: `if (cv !== v) {
            cu.value = v;
            gl.uniform1f(location, v);
        }`,
    "vec2<f32>": `if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2f(location, v[0], v[1]);
        }`,
    "vec3<f32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3f(location, v[0], v[1], v[2]);
        }`,
    "vec4<f32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4f(location, v[0], v[1], v[2], v[3]);
        }`,
    i32: `if (cv !== v) {
            cu.value = v;
            gl.uniform1i(location, v);
        }`,
    "vec2<i32>": `if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2i(location, v[0], v[1]);
        }`,
    "vec3<i32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3i(location, v[0], v[1], v[2]);
        }`,
    "vec4<i32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4i(location, v[0], v[1], v[2], v[3]);
        }`,
    u32: `if (cv !== v) {
            cu.value = v;
            gl.uniform1ui(location, v);
        }`,
    "vec2<u32>": `if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2ui(location, v[0], v[1]);
        }`,
    "vec3<u32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3ui(location, v[0], v[1], v[2]);
        }`,
    "vec4<u32>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4ui(location, v[0], v[1], v[2], v[3]);
        }`,
    bool: `if (cv !== v) {
            cu.value = v;
            gl.uniform1i(location, v);
        }`,
    "vec2<bool>": `if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2i(location, v[0], v[1]);
        }`,
    "vec3<bool>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3i(location, v[0], v[1], v[2]);
        }`,
    "vec4<bool>": `if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4i(location, v[0], v[1], v[2], v[3]);
        }`,
    "mat2x2<f32>": `gl.uniformMatrix2fv(location, false, v);`,
    "mat3x3<f32>": `gl.uniformMatrix3fv(location, false, v);`,
    "mat4x4<f32>": `gl.uniformMatrix4fv(location, false, v);`
  };
  const UNIFORM_TO_ARRAY_SETTERS = {
    f32: `gl.uniform1fv(location, v);`,
    "vec2<f32>": `gl.uniform2fv(location, v);`,
    "vec3<f32>": `gl.uniform3fv(location, v);`,
    "vec4<f32>": `gl.uniform4fv(location, v);`,
    "mat2x2<f32>": `gl.uniformMatrix2fv(location, false, v);`,
    "mat3x3<f32>": `gl.uniformMatrix3fv(location, false, v);`,
    "mat4x4<f32>": `gl.uniformMatrix4fv(location, false, v);`,
    i32: `gl.uniform1iv(location, v);`,
    "vec2<i32>": `gl.uniform2iv(location, v);`,
    "vec3<i32>": `gl.uniform3iv(location, v);`,
    "vec4<i32>": `gl.uniform4iv(location, v);`,
    u32: `gl.uniform1iv(location, v);`,
    "vec2<u32>": `gl.uniform2iv(location, v);`,
    "vec3<u32>": `gl.uniform3iv(location, v);`,
    "vec4<u32>": `gl.uniform4iv(location, v);`,
    bool: `gl.uniform1iv(location, v);`,
    "vec2<bool>": `gl.uniform2iv(location, v);`,
    "vec3<bool>": `gl.uniform3iv(location, v);`,
    "vec4<bool>": `gl.uniform4iv(location, v);`
  };
  function generateUniformsSync(group, uniformData) {
    const funcFragments = [`
        var v = null;
        var cv = null;
        var cu = null;
        var t = 0;
        var gl = renderer.gl;
        var name = null;
    `];
    for (const i2 in group.uniforms) {
      if (!uniformData[i2]) {
        if (group.uniforms[i2] instanceof UniformGroup) {
          if (group.uniforms[i2].ubo) {
            funcFragments.push(`
                        renderer.shader.bindUniformBlock(uv.${i2}, "${i2}");
                    `);
          } else {
            funcFragments.push(`
                        renderer.shader.updateUniformGroup(uv.${i2});
                    `);
          }
        } else if (group.uniforms[i2] instanceof BufferResource) {
          funcFragments.push(`
                        renderer.shader.bindBufferResource(uv.${i2}, "${i2}");
                    `);
        }
        continue;
      }
      const uniform = group.uniformStructures[i2];
      let parsed = false;
      for (let j2 = 0; j2 < uniformParsers.length; j2++) {
        const parser = uniformParsers[j2];
        if (uniform.type === parser.type && parser.test(uniform)) {
          funcFragments.push(`name = "${i2}";`, uniformParsers[j2].uniform);
          parsed = true;
          break;
        }
      }
      if (!parsed) {
        const templateType = uniform.size === 1 ? UNIFORM_TO_SINGLE_SETTERS : UNIFORM_TO_ARRAY_SETTERS;
        const template = templateType[uniform.type].replace("location", `ud["${i2}"].location`);
        funcFragments.push(`
            cu = ud["${i2}"];
            cv = cu.value;
            v = uv["${i2}"];
            ${template};`);
      }
    }
    return new Function("ud", "uv", "renderer", "syncData", funcFragments.join("\n"));
  }
  class GlUniformGroupSystem {

    constructor(renderer) {
      this._cache = {};
      this._uniformGroupSyncHash = {};
      this._renderer = renderer;
      this.gl = null;
      this._cache = {};
    }
    contextChange(gl) {
      this.gl = gl;
    }

    updateUniformGroup(group, program, syncData) {
      const programData = this._renderer.shader._getProgramData(program);
      if (!group.isStatic || group._dirtyId !== programData.uniformDirtyGroups[group.uid]) {
        programData.uniformDirtyGroups[group.uid] = group._dirtyId;
        const syncFunc = this._getUniformSyncFunction(group, program);
        syncFunc(programData.uniformData, group.uniforms, this._renderer, syncData);
      }
    }

    _getUniformSyncFunction(group, program) {
      return this._uniformGroupSyncHash[group._signature]?.[program._key] || this._createUniformSyncFunction(group, program);
    }
    _createUniformSyncFunction(group, program) {
      const uniformGroupSyncHash = this._uniformGroupSyncHash[group._signature] || (this._uniformGroupSyncHash[group._signature] = {});
      const id = this._getSignature(group, program._uniformData, "u");
      if (!this._cache[id]) {
        this._cache[id] = this._generateUniformsSync(group, program._uniformData);
      }
      uniformGroupSyncHash[program._key] = this._cache[id];
      return uniformGroupSyncHash[program._key];
    }
    _generateUniformsSync(group, uniformData) {
      return generateUniformsSync(group, uniformData);
    }

    _getSignature(group, uniformData, preFix) {
      const uniforms = group.uniforms;
      const strings = [`${preFix}-`];
      for (const i2 in uniforms) {
        strings.push(i2);
        if (uniformData[i2]) {
          strings.push(uniformData[i2].type);
        }
      }
      return strings.join("-");
    }

    destroy() {
      this._renderer = null;
      this._cache = null;
    }
  }
  GlUniformGroupSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "uniformGroup"
  };
  function mapWebGLBlendModesToPixi(gl) {
    const blendMap = {};
    blendMap.normal = [gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    blendMap.add = [gl.ONE, gl.ONE];
    blendMap.multiply = [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    blendMap.screen = [gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    blendMap.none = [0, 0];
    blendMap["normal-npm"] = [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    blendMap["add-npm"] = [gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE];
    blendMap["screen-npm"] = [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    blendMap.erase = [gl.ZERO, gl.ONE_MINUS_SRC_ALPHA];
    const isWebGl2 = !(gl instanceof DOMAdapter.get().getWebGLRenderingContext());
    if (isWebGl2) {
      blendMap.min = [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.MIN, gl.MIN];
      blendMap.max = [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.MAX, gl.MAX];
    } else {
      const ext = gl.getExtension("EXT_blend_minmax");
      if (ext) {
        blendMap.min = [gl.ONE, gl.ONE, gl.ONE, gl.ONE, ext.MIN_EXT, ext.MIN_EXT];
        blendMap.max = [gl.ONE, gl.ONE, gl.ONE, gl.ONE, ext.MAX_EXT, ext.MAX_EXT];
      }
    }
    return blendMap;
  }
  const BLEND = 0;
  const OFFSET = 1;
  const CULLING = 2;
  const DEPTH_TEST = 3;
  const WINDING = 4;
  const DEPTH_MASK = 5;
  const _GlStateSystem = class _GlStateSystem2 {
    constructor(renderer) {
      this._invertFrontFace = false;
      this.gl = null;
      this.stateId = 0;
      this.polygonOffset = 0;
      this.blendMode = "none";
      this._blendEq = false;
      this.map = [];
      this.map[BLEND] = this.setBlend;
      this.map[OFFSET] = this.setOffset;
      this.map[CULLING] = this.setCullFace;
      this.map[DEPTH_TEST] = this.setDepthTest;
      this.map[WINDING] = this.setFrontFace;
      this.map[DEPTH_MASK] = this.setDepthMask;
      this.checks = [];
      this.defaultState = State.for2d();
      renderer.renderTarget.onRenderTargetChange.add(this);
    }
    onRenderTargetChange(renderTarget) {
      this._invertFrontFace = !renderTarget.isRoot;
      if (this._cullFace) {
        this.setFrontFace(this._frontFace);
      } else {
        this._frontFaceDirty = true;
      }
    }
    contextChange(gl) {
      this.gl = gl;
      this.blendModesMap = mapWebGLBlendModesToPixi(gl);
      this.resetState();
    }

    set(state) {
      state || (state = this.defaultState);
      if (this.stateId !== state.data) {
        let diff = this.stateId ^ state.data;
        let i2 = 0;
        while (diff) {
          if (diff & 1) {
            this.map[i2].call(this, !!(state.data & 1 << i2));
          }
          diff >>= 1;
          i2++;
        }
        this.stateId = state.data;
      }
      for (let i2 = 0; i2 < this.checks.length; i2++) {
        this.checks[i2](this, state);
      }
    }

    forceState(state) {
      state || (state = this.defaultState);
      for (let i2 = 0; i2 < this.map.length; i2++) {
        this.map[i2].call(this, !!(state.data & 1 << i2));
      }
      for (let i2 = 0; i2 < this.checks.length; i2++) {
        this.checks[i2](this, state);
      }
      this.stateId = state.data;
    }

    setBlend(value) {
      this._updateCheck(_GlStateSystem2._checkBlendMode, value);
      this.gl[value ? "enable" : "disable"](this.gl.BLEND);
    }

    setOffset(value) {
      this._updateCheck(_GlStateSystem2._checkPolygonOffset, value);
      this.gl[value ? "enable" : "disable"](this.gl.POLYGON_OFFSET_FILL);
    }

    setDepthTest(value) {
      this.gl[value ? "enable" : "disable"](this.gl.DEPTH_TEST);
    }

    setDepthMask(value) {
      this.gl.depthMask(value);
    }

    setCullFace(value) {
      this._cullFace = value;
      this.gl[value ? "enable" : "disable"](this.gl.CULL_FACE);
      if (this._cullFace && this._frontFaceDirty) {
        this.setFrontFace(this._frontFace);
      }
    }

    setFrontFace(value) {
      this._frontFace = value;
      this._frontFaceDirty = false;
      const faceMode = this._invertFrontFace ? !value : value;
      if (this._glFrontFace !== faceMode) {
        this._glFrontFace = faceMode;
        this.gl.frontFace(this.gl[faceMode ? "CW" : "CCW"]);
      }
    }

    setBlendMode(value) {
      if (!this.blendModesMap[value]) {
        value = "normal";
      }
      if (value === this.blendMode) {
        return;
      }
      this.blendMode = value;
      const mode = this.blendModesMap[value];
      const gl = this.gl;
      if (mode.length === 2) {
        gl.blendFunc(mode[0], mode[1]);
      } else {
        gl.blendFuncSeparate(mode[0], mode[1], mode[2], mode[3]);
      }
      if (mode.length === 6) {
        this._blendEq = true;
        gl.blendEquationSeparate(mode[4], mode[5]);
      } else if (this._blendEq) {
        this._blendEq = false;
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      }
    }

    setPolygonOffset(value, scale) {
      this.gl.polygonOffset(value, scale);
    }

    resetState() {
      this._glFrontFace = false;
      this._frontFace = false;
      this._cullFace = false;
      this._frontFaceDirty = false;
      this._invertFrontFace = false;
      this.gl.frontFace(this.gl.CCW);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
      this.forceState(this.defaultState);
      this._blendEq = true;
      this.blendMode = "";
      this.setBlendMode("normal");
    }

    _updateCheck(func, value) {
      const index = this.checks.indexOf(func);
      if (value && index === -1) {
        this.checks.push(func);
      } else if (!value && index !== -1) {
        this.checks.splice(index, 1);
      }
    }

    static _checkBlendMode(system, state) {
      system.setBlendMode(state.blendMode);
    }

    static _checkPolygonOffset(system, state) {
      system.setPolygonOffset(1, state.polygonOffset);
    }

    destroy() {
      this.gl = null;
      this.checks.length = 0;
    }
  };
  _GlStateSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "state"
  };
  let GlStateSystem = _GlStateSystem;
  class GlTexture {
    constructor(texture) {
      this.target = GL_TARGETS.TEXTURE_2D;
      this._layerInitMask = 0;
      this.texture = texture;
      this.width = -1;
      this.height = -1;
      this.type = GL_TYPES.UNSIGNED_BYTE;
      this.internalFormat = GL_FORMATS.RGBA;
      this.format = GL_FORMATS.RGBA;
      this.samplerType = 0;
    }
    destroy() {
    }
  }
  const glUploadBufferImageResource = {
    id: "buffer",
    upload(source2, glTexture, gl, _webGLVersion, targetOverride, forceAllocation = false) {
      const target = targetOverride || glTexture.target;
      if (!forceAllocation && (glTexture.width === source2.width && glTexture.height === source2.height)) {
        gl.texSubImage2D(
          target,
          0,
          0,
          0,
          source2.width,
          source2.height,
          glTexture.format,
          glTexture.type,
          source2.resource
        );
      } else {
        gl.texImage2D(
          target,
          0,
          glTexture.internalFormat,
          source2.width,
          source2.height,
          0,
          glTexture.format,
          glTexture.type,
          source2.resource
        );
      }
      glTexture.width = source2.width;
      glTexture.height = source2.height;
    }
  };
  const compressedFormatMap = {
    "bc1-rgba-unorm": true,
    "bc1-rgba-unorm-srgb": true,
    "bc2-rgba-unorm": true,
    "bc2-rgba-unorm-srgb": true,
    "bc3-rgba-unorm": true,
    "bc3-rgba-unorm-srgb": true,
    "bc4-r-unorm": true,
    "bc4-r-snorm": true,
    "bc5-rg-unorm": true,
    "bc5-rg-snorm": true,
    "bc6h-rgb-ufloat": true,
    "bc6h-rgb-float": true,
    "bc7-rgba-unorm": true,
    "bc7-rgba-unorm-srgb": true,

    "etc2-rgb8unorm": true,
    "etc2-rgb8unorm-srgb": true,
    "etc2-rgb8a1unorm": true,
    "etc2-rgb8a1unorm-srgb": true,
    "etc2-rgba8unorm": true,
    "etc2-rgba8unorm-srgb": true,
    "eac-r11unorm": true,
    "eac-r11snorm": true,
    "eac-rg11unorm": true,
    "eac-rg11snorm": true,

    "astc-4x4-unorm": true,
    "astc-4x4-unorm-srgb": true,
    "astc-5x4-unorm": true,
    "astc-5x4-unorm-srgb": true,
    "astc-5x5-unorm": true,
    "astc-5x5-unorm-srgb": true,
    "astc-6x5-unorm": true,
    "astc-6x5-unorm-srgb": true,
    "astc-6x6-unorm": true,
    "astc-6x6-unorm-srgb": true,
    "astc-8x5-unorm": true,
    "astc-8x5-unorm-srgb": true,
    "astc-8x6-unorm": true,
    "astc-8x6-unorm-srgb": true,
    "astc-8x8-unorm": true,
    "astc-8x8-unorm-srgb": true,
    "astc-10x5-unorm": true,
    "astc-10x5-unorm-srgb": true,
    "astc-10x6-unorm": true,
    "astc-10x6-unorm-srgb": true,
    "astc-10x8-unorm": true,
    "astc-10x8-unorm-srgb": true,
    "astc-10x10-unorm": true,
    "astc-10x10-unorm-srgb": true,
    "astc-12x10-unorm": true,
    "astc-12x10-unorm-srgb": true,
    "astc-12x12-unorm": true,
    "astc-12x12-unorm-srgb": true
  };
  const glUploadCompressedTextureResource = {
    id: "compressed",
    upload(source2, glTexture, gl, _webGLVersion, targetOverride, _forceAllocation) {
      const target = targetOverride ?? glTexture.target;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      let mipWidth = source2.pixelWidth;
      let mipHeight = source2.pixelHeight;
      const compressed = !!compressedFormatMap[source2.format];
      for (let i2 = 0; i2 < source2.resource.length; i2++) {
        const levelBuffer = source2.resource[i2];
        if (compressed) {
          gl.compressedTexImage2D(
            target,
            i2,
            glTexture.internalFormat,
            mipWidth,
            mipHeight,
            0,
            levelBuffer
          );
        } else {
          gl.texImage2D(
            target,
            i2,
            glTexture.internalFormat,
            mipWidth,
            mipHeight,
            0,
            glTexture.format,
            glTexture.type,
            levelBuffer
          );
        }
        mipWidth = Math.max(mipWidth >> 1, 1);
        mipHeight = Math.max(mipHeight >> 1, 1);
      }
    }
  };
  const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];
  function createGlUploadCubeTextureResource(uploaders) {
    return {
      id: "cube",
      upload(source2, glTexture, gl, webGLVersion) {
        const faces = source2.faces;
        for (let faceIndex = 0; faceIndex < FACE_ORDER.length; faceIndex++) {
          const key = FACE_ORDER[faceIndex];
          const face = faces[key];
          const uploader = uploaders[face.uploadMethodId] || uploaders.image;
          uploader.upload(
            face,
            glTexture,
            gl,
            webGLVersion,

            GL_TARGETS.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex,

            (glTexture._layerInitMask & 1 << faceIndex) === 0
          );
          glTexture._layerInitMask |= 1 << faceIndex;
        }
        glTexture.width = source2.pixelWidth;
        glTexture.height = source2.pixelHeight;
      }
    };
  }
  const glUploadImageResource = {
    id: "image",
    upload(source2, glTexture, gl, webGLVersion, targetOverride, forceAllocation = false) {
      const target = targetOverride || glTexture.target;
      const textureWidth = source2.pixelWidth;
      const textureHeight = source2.pixelHeight;
      const resourceWidth = source2.resourceWidth;
      const resourceHeight = source2.resourceHeight;
      const isWebGL2 = webGLVersion === 2;
      const needsAllocation = forceAllocation || glTexture.width !== textureWidth || glTexture.height !== textureHeight;
      const resourceFitsTexture = resourceWidth >= textureWidth && resourceHeight >= textureHeight;
      const resource = source2.resource;
      const uploadFunction = isWebGL2 ? uploadImageWebGL2 : uploadImageWebGL1;
      uploadFunction(
        gl,
        target,
        glTexture,
        textureWidth,
        textureHeight,
        resourceWidth,
        resourceHeight,
        resource,
        needsAllocation,
        resourceFitsTexture
      );
      glTexture.width = textureWidth;
      glTexture.height = textureHeight;
    }
  };
  function uploadImageWebGL2(gl, target, glTexture, textureWidth, textureHeight, resourceWidth, resourceHeight, resource, needsAllocation, resourceFitsTexture) {
    if (!resourceFitsTexture) {
      if (needsAllocation) {
        gl.texImage2D(
          target,
          0,
          glTexture.internalFormat,
          textureWidth,
          textureHeight,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
      }
      gl.texSubImage2D(
        target,
        0,
        0,
        0,
        resourceWidth,
        resourceHeight,
        glTexture.format,
        glTexture.type,
        resource
      );
      return;
    }
    if (!needsAllocation) {
      gl.texSubImage2D(
        target,
        0,
        0,
        0,
        glTexture.format,
        glTexture.type,
        resource
      );
      return;
    }
    gl.texImage2D(
      target,
      0,
      glTexture.internalFormat,
      textureWidth,
      textureHeight,
      0,
      glTexture.format,
      glTexture.type,
      resource
    );
  }
  function uploadImageWebGL1(gl, target, glTexture, textureWidth, textureHeight, _resourceWidth, _resourceHeight, resource, needsAllocation, resourceFitsTexture) {
    if (!resourceFitsTexture) {
      if (needsAllocation) {
        gl.texImage2D(
          target,
          0,
          glTexture.internalFormat,
          textureWidth,
          textureHeight,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
      }
      gl.texSubImage2D(
        target,
        0,
        0,
        0,
        glTexture.format,
        glTexture.type,
        resource
      );
      return;
    }
    if (!needsAllocation) {
      gl.texSubImage2D(
        target,
        0,
        0,
        0,
        glTexture.format,
        glTexture.type,
        resource
      );
      return;
    }
    gl.texImage2D(
      target,
      0,
      glTexture.internalFormat,
      glTexture.format,
      glTexture.type,
      resource
    );
  }
  const defaultForceAllocation = isSafari();
  const glUploadVideoResource = {
    id: "video",
    upload(source2, glTexture, gl, webGLVersion, targetOverride, forceAllocation = defaultForceAllocation) {
      if (!source2.isValid) {
        const target = targetOverride ?? glTexture.target;
        gl.texImage2D(
          target,
          0,
          glTexture.internalFormat,
          1,
          1,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
        return;
      }
      glUploadImageResource.upload(source2, glTexture, gl, webGLVersion, targetOverride, forceAllocation);
    }
  };
  const scaleModeToGlFilter = {
    linear: 9729,
    nearest: 9728
  };
  const mipmapScaleModeToGlFilter = {
    linear: {
      linear: 9987,
      nearest: 9985
    },
    nearest: {
      linear: 9986,
      nearest: 9984
    }
  };
  const wrapModeToGlAddress = {
    "clamp-to-edge": 33071,
    repeat: 10497,
    "mirror-repeat": 33648
  };
  const compareModeToGlCompare = {
    never: 512,
    less: 513,
    equal: 514,
    "less-equal": 515,
    greater: 516,
    "not-equal": 517,
    "greater-equal": 518,
    always: 519
  };
  function applyStyleParams(style, gl, mipmaps, anisotropicExt, glFunctionName, firstParam, forceClamp, firstCreation) {
    const castParam = firstParam;
    if (!firstCreation || style.addressModeU !== "repeat" || style.addressModeV !== "repeat" || style.addressModeW !== "repeat") {
      const wrapModeS = wrapModeToGlAddress[forceClamp ? "clamp-to-edge" : style.addressModeU];
      const wrapModeT = wrapModeToGlAddress[forceClamp ? "clamp-to-edge" : style.addressModeV];
      const wrapModeR = wrapModeToGlAddress[forceClamp ? "clamp-to-edge" : style.addressModeW];
      gl[glFunctionName](castParam, gl.TEXTURE_WRAP_S, wrapModeS);
      gl[glFunctionName](castParam, gl.TEXTURE_WRAP_T, wrapModeT);
      if (gl.TEXTURE_WRAP_R) gl[glFunctionName](castParam, gl.TEXTURE_WRAP_R, wrapModeR);
    }
    if (!firstCreation || style.magFilter !== "linear") {
      gl[glFunctionName](castParam, gl.TEXTURE_MAG_FILTER, scaleModeToGlFilter[style.magFilter]);
    }
    if (mipmaps) {
      if (!firstCreation || style.mipmapFilter !== "linear") {
        const glFilterMode = mipmapScaleModeToGlFilter[style.minFilter][style.mipmapFilter];
        gl[glFunctionName](castParam, gl.TEXTURE_MIN_FILTER, glFilterMode);
      }
    } else {
      gl[glFunctionName](castParam, gl.TEXTURE_MIN_FILTER, scaleModeToGlFilter[style.minFilter]);
    }
    if (anisotropicExt && style.maxAnisotropy > 1) {
      const level = Math.min(style.maxAnisotropy, gl.getParameter(anisotropicExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
      gl[glFunctionName](castParam, anisotropicExt.TEXTURE_MAX_ANISOTROPY_EXT, level);
    }
    if (style.compare) {
      gl[glFunctionName](castParam, gl.TEXTURE_COMPARE_FUNC, compareModeToGlCompare[style.compare]);
    }
  }
  function mapFormatToGlFormat(gl) {
    return {

      r8unorm: gl.RED,
      r8snorm: gl.RED,
      r8uint: gl.RED,
      r8sint: gl.RED,

      r16uint: gl.RED,
      r16sint: gl.RED,
      r16float: gl.RED,
      rg8unorm: gl.RG,
      rg8snorm: gl.RG,
      rg8uint: gl.RG,
      rg8sint: gl.RG,

      r32uint: gl.RED,
      r32sint: gl.RED,
      r32float: gl.RED,
      rg16uint: gl.RG,
      rg16sint: gl.RG,
      rg16float: gl.RG,
      rgba8unorm: gl.RGBA,
      "rgba8unorm-srgb": gl.RGBA,

      rgba8snorm: gl.RGBA,
      rgba8uint: gl.RGBA,
      rgba8sint: gl.RGBA,
      bgra8unorm: gl.RGBA,
      "bgra8unorm-srgb": gl.RGBA,
      rgb9e5ufloat: gl.RGB,
      rgb10a2unorm: gl.RGBA,
      rg11b10ufloat: gl.RGB,

      rg32uint: gl.RG,
      rg32sint: gl.RG,
      rg32float: gl.RG,
      rgba16uint: gl.RGBA,
      rgba16sint: gl.RGBA,
      rgba16float: gl.RGBA,

      rgba32uint: gl.RGBA,
      rgba32sint: gl.RGBA,
      rgba32float: gl.RGBA,

      stencil8: gl.STENCIL_INDEX8,
      depth16unorm: gl.DEPTH_COMPONENT,
      depth24plus: gl.DEPTH_COMPONENT,
      "depth24plus-stencil8": gl.DEPTH_STENCIL,
      depth32float: gl.DEPTH_COMPONENT,
      "depth32float-stencil8": gl.DEPTH_STENCIL
    };
  }
  function mapFormatToGlInternalFormat(gl, extensions2) {
    let srgb = {};
    let bgra8unorm = gl.RGBA;
    if (!(gl instanceof DOMAdapter.get().getWebGLRenderingContext())) {
      srgb = {
        "rgba8unorm-srgb": gl.SRGB8_ALPHA8,
        "bgra8unorm-srgb": gl.SRGB8_ALPHA8
      };
      bgra8unorm = gl.RGBA8;
    } else if (extensions2.srgb) {
      srgb = {
        "rgba8unorm-srgb": extensions2.srgb.SRGB8_ALPHA8_EXT,
        "bgra8unorm-srgb": extensions2.srgb.SRGB8_ALPHA8_EXT
      };
    }
    return {

      r8unorm: gl.R8,
      r8snorm: gl.R8_SNORM,
      r8uint: gl.R8UI,
      r8sint: gl.R8I,

      r16uint: gl.R16UI,
      r16sint: gl.R16I,
      r16float: gl.R16F,
      rg8unorm: gl.RG8,
      rg8snorm: gl.RG8_SNORM,
      rg8uint: gl.RG8UI,
      rg8sint: gl.RG8I,

      r32uint: gl.R32UI,
      r32sint: gl.R32I,
      r32float: gl.R32F,
      rg16uint: gl.RG16UI,
      rg16sint: gl.RG16I,
      rg16float: gl.RG16F,
      rgba8unorm: gl.RGBA,
      ...srgb,

      rgba8snorm: gl.RGBA8_SNORM,
      rgba8uint: gl.RGBA8UI,
      rgba8sint: gl.RGBA8I,
      bgra8unorm,
      rgb9e5ufloat: gl.RGB9_E5,
      rgb10a2unorm: gl.RGB10_A2,
      rg11b10ufloat: gl.R11F_G11F_B10F,

      rg32uint: gl.RG32UI,
      rg32sint: gl.RG32I,
      rg32float: gl.RG32F,
      rgba16uint: gl.RGBA16UI,
      rgba16sint: gl.RGBA16I,
      rgba16float: gl.RGBA16F,

      rgba32uint: gl.RGBA32UI,
      rgba32sint: gl.RGBA32I,
      rgba32float: gl.RGBA32F,

      stencil8: gl.STENCIL_INDEX8,
      depth16unorm: gl.DEPTH_COMPONENT16,
      depth24plus: gl.DEPTH_COMPONENT24,
      "depth24plus-stencil8": gl.DEPTH24_STENCIL8,
      depth32float: gl.DEPTH_COMPONENT32F,
      "depth32float-stencil8": gl.DEPTH32F_STENCIL8,

      ...extensions2.s3tc ? {
        "bc1-rgba-unorm": extensions2.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT,
        "bc2-rgba-unorm": extensions2.s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT,
        "bc3-rgba-unorm": extensions2.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT
      } : {},
      ...extensions2.s3tc_sRGB ? {
        "bc1-rgba-unorm-srgb": extensions2.s3tc_sRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT,
        "bc2-rgba-unorm-srgb": extensions2.s3tc_sRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT,
        "bc3-rgba-unorm-srgb": extensions2.s3tc_sRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
      } : {},
      ...extensions2.rgtc ? {
        "bc4-r-unorm": extensions2.rgtc.COMPRESSED_RED_RGTC1_EXT,
        "bc4-r-snorm": extensions2.rgtc.COMPRESSED_SIGNED_RED_RGTC1_EXT,
        "bc5-rg-unorm": extensions2.rgtc.COMPRESSED_RED_GREEN_RGTC2_EXT,
        "bc5-rg-snorm": extensions2.rgtc.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT
      } : {},
      ...extensions2.bptc ? {
        "bc6h-rgb-float": extensions2.bptc.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT,
        "bc6h-rgb-ufloat": extensions2.bptc.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT,
        "bc7-rgba-unorm": extensions2.bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT,
        "bc7-rgba-unorm-srgb": extensions2.bptc.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT
      } : {},
      ...extensions2.etc ? {
        "etc2-rgb8unorm": extensions2.etc.COMPRESSED_RGB8_ETC2,
        "etc2-rgb8unorm-srgb": extensions2.etc.COMPRESSED_SRGB8_ETC2,
        "etc2-rgb8a1unorm": extensions2.etc.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
        "etc2-rgb8a1unorm-srgb": extensions2.etc.COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2,
        "etc2-rgba8unorm": extensions2.etc.COMPRESSED_RGBA8_ETC2_EAC,
        "etc2-rgba8unorm-srgb": extensions2.etc.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC,
        "eac-r11unorm": extensions2.etc.COMPRESSED_R11_EAC,

        "eac-rg11unorm": extensions2.etc.COMPRESSED_SIGNED_RG11_EAC

      } : {},
      ...extensions2.astc ? {
        "astc-4x4-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_4x4_KHR,
        "astc-4x4-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR,
        "astc-5x4-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_5x4_KHR,
        "astc-5x4-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR,
        "astc-5x5-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_5x5_KHR,
        "astc-5x5-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR,
        "astc-6x5-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_6x5_KHR,
        "astc-6x5-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR,
        "astc-6x6-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_6x6_KHR,
        "astc-6x6-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR,
        "astc-8x5-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_8x5_KHR,
        "astc-8x5-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR,
        "astc-8x6-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_8x6_KHR,
        "astc-8x6-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR,
        "astc-8x8-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_8x8_KHR,
        "astc-8x8-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR,
        "astc-10x5-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_10x5_KHR,
        "astc-10x5-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR,
        "astc-10x6-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_10x6_KHR,
        "astc-10x6-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR,
        "astc-10x8-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_10x8_KHR,
        "astc-10x8-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR,
        "astc-10x10-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_10x10_KHR,
        "astc-10x10-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR,
        "astc-12x10-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_12x10_KHR,
        "astc-12x10-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR,
        "astc-12x12-unorm": extensions2.astc.COMPRESSED_RGBA_ASTC_12x12_KHR,
        "astc-12x12-unorm-srgb": extensions2.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR
      } : {}
    };
  }
  function mapFormatToGlType(gl) {
    return {

      r8unorm: gl.UNSIGNED_BYTE,
      r8snorm: gl.BYTE,
      r8uint: gl.UNSIGNED_BYTE,
      r8sint: gl.BYTE,

      r16uint: gl.UNSIGNED_SHORT,
      r16sint: gl.SHORT,
      r16float: gl.HALF_FLOAT,
      rg8unorm: gl.UNSIGNED_BYTE,
      rg8snorm: gl.BYTE,
      rg8uint: gl.UNSIGNED_BYTE,
      rg8sint: gl.BYTE,

      r32uint: gl.UNSIGNED_INT,
      r32sint: gl.INT,
      r32float: gl.FLOAT,
      rg16uint: gl.UNSIGNED_SHORT,
      rg16sint: gl.SHORT,
      rg16float: gl.HALF_FLOAT,
      rgba8unorm: gl.UNSIGNED_BYTE,
      "rgba8unorm-srgb": gl.UNSIGNED_BYTE,

      rgba8snorm: gl.BYTE,
      rgba8uint: gl.UNSIGNED_BYTE,
      rgba8sint: gl.BYTE,
      bgra8unorm: gl.UNSIGNED_BYTE,
      "bgra8unorm-srgb": gl.UNSIGNED_BYTE,
      rgb9e5ufloat: gl.UNSIGNED_INT_5_9_9_9_REV,
      rgb10a2unorm: gl.UNSIGNED_INT_2_10_10_10_REV,
      rg11b10ufloat: gl.UNSIGNED_INT_10F_11F_11F_REV,

      rg32uint: gl.UNSIGNED_INT,
      rg32sint: gl.INT,
      rg32float: gl.FLOAT,
      rgba16uint: gl.UNSIGNED_SHORT,
      rgba16sint: gl.SHORT,
      rgba16float: gl.HALF_FLOAT,

      rgba32uint: gl.UNSIGNED_INT,
      rgba32sint: gl.INT,
      rgba32float: gl.FLOAT,

      stencil8: gl.UNSIGNED_BYTE,
      depth16unorm: gl.UNSIGNED_SHORT,
      depth24plus: gl.UNSIGNED_INT,
      "depth24plus-stencil8": gl.UNSIGNED_INT_24_8,
      depth32float: gl.FLOAT,
      "depth32float-stencil8": gl.FLOAT_32_UNSIGNED_INT_24_8_REV
    };
  }
  function mapViewDimensionToGlTarget(gl) {
    return {
      "2d": gl.TEXTURE_2D,
      cube: gl.TEXTURE_CUBE_MAP,
      "1d": null,

      "3d": gl?.TEXTURE_3D || null,
      "2d-array": gl?.TEXTURE_2D_ARRAY || null,
      "cube-array": gl?.TEXTURE_CUBE_MAP_ARRAY || null
    };
  }
  const BYTES_PER_PIXEL = 4;
  class GlTextureSystem {
    constructor(renderer) {
      this._glSamplers =                 Object.create(null);
      this._boundTextures = [];
      this._activeTextureLocation = -1;
      this._boundSamplers =                 Object.create(null);
      this._premultiplyAlpha = false;
      this._useSeparateSamplers = false;
      this._renderer = renderer;
      this._managedTextures = new GCManagedHash({
        renderer,
        type: "resource",
        onUnload: this.onSourceUnload.bind(this),
        name: "glTexture"
      });
      const baseUploaders = {
        image: glUploadImageResource,
        buffer: glUploadBufferImageResource,
        video: glUploadVideoResource,
        compressed: glUploadCompressedTextureResource
      };
      this._uploads = {
        ...baseUploaders,
        cube: createGlUploadCubeTextureResource(baseUploaders)
      };
    }

    get managedTextures() {
      return Object.values(this._managedTextures.items);
    }
    contextChange(gl) {
      this._gl = gl;
      if (!this._mapFormatToInternalFormat) {
        this._mapFormatToInternalFormat = mapFormatToGlInternalFormat(gl, this._renderer.context.extensions);
        this._mapFormatToType = mapFormatToGlType(gl);
        this._mapFormatToFormat = mapFormatToGlFormat(gl);
        this._mapViewDimensionToGlTarget = mapViewDimensionToGlTarget(gl);
      }
      this._managedTextures.removeAll(true);
      this._glSamplers =                 Object.create(null);
      this._boundSamplers =                 Object.create(null);
      this._premultiplyAlpha = false;
      for (let i2 = 0; i2 < 16; i2++) {
        this.bind(Texture.EMPTY, i2);
      }
    }

    initSource(source2) {
      this.bind(source2);
    }
    bind(texture, location = 0) {
      const source2 = texture.source;
      if (texture) {
        this.bindSource(source2, location);
        if (this._useSeparateSamplers) {
          this._bindSampler(source2.style, location);
        }
      } else {
        this.bindSource(null, location);
        if (this._useSeparateSamplers) {
          this._bindSampler(null, location);
        }
      }
    }
    bindSource(source2, location = 0) {
      const gl = this._gl;
      source2._gcLastUsed = this._renderer.gc.now;
      if (this._boundTextures[location] !== source2) {
        this._boundTextures[location] = source2;
        this._activateLocation(location);
        source2 || (source2 = Texture.EMPTY.source);
        const glTexture = this.getGlSource(source2);
        gl.bindTexture(glTexture.target, glTexture.texture);
      }
    }
    _bindSampler(style, location = 0) {
      const gl = this._gl;
      if (!style) {
        this._boundSamplers[location] = null;
        gl.bindSampler(location, null);
        return;
      }
      const sampler = this._getGlSampler(style);
      if (this._boundSamplers[location] !== sampler) {
        this._boundSamplers[location] = sampler;
        gl.bindSampler(location, sampler);
      }
    }
    unbind(texture) {
      const source2 = texture.source;
      const boundTextures = this._boundTextures;
      const gl = this._gl;
      for (let i2 = 0; i2 < boundTextures.length; i2++) {
        if (boundTextures[i2] === source2) {
          this._activateLocation(i2);
          const glTexture = this.getGlSource(source2);
          gl.bindTexture(glTexture.target, null);
          boundTextures[i2] = null;
        }
      }
    }
    _activateLocation(location) {
      if (this._activeTextureLocation !== location) {
        this._activeTextureLocation = location;
        this._gl.activeTexture(this._gl.TEXTURE0 + location);
      }
    }
    _initSource(source2) {
      const gl = this._gl;
      const glTexture = new GlTexture(gl.createTexture());
      glTexture.type = this._mapFormatToType[source2.format];
      glTexture.internalFormat = this._mapFormatToInternalFormat[source2.format];
      glTexture.format = this._mapFormatToFormat[source2.format];
      glTexture.target = this._mapViewDimensionToGlTarget[source2.viewDimension];
      if (glTexture.target === null) {
        throw new Error(`Unsupported view dimension: ${source2.viewDimension} with this webgl version: ${this._renderer.context.webGLVersion}`);
      }
      if (source2.uploadMethodId === "cube") {
        glTexture.target = gl.TEXTURE_CUBE_MAP;
      }
      if (source2.autoGenerateMipmaps && (this._renderer.context.supports.nonPowOf2mipmaps || source2.isPowerOfTwo)) {
        const biggestDimension = Math.max(source2.width, source2.height);
        source2.mipLevelCount = Math.floor(Math.log2(biggestDimension)) + 1;
      }
      source2._gpuData[this._renderer.uid] = glTexture;
      const added = this._managedTextures.add(source2);
      if (added) {
        source2.on("update", this.onSourceUpdate, this);
        source2.on("resize", this.onSourceUpdate, this);
        source2.on("styleChange", this.onStyleChange, this);
        source2.on("updateMipmaps", this.onUpdateMipmaps, this);
      }
      this.onSourceUpdate(source2);
      this.updateStyle(source2, false);
      return glTexture;
    }
    onStyleChange(source2) {
      this.updateStyle(source2, false);
    }
    updateStyle(source2, firstCreation) {
      const gl = this._gl;
      const glTexture = this.getGlSource(source2);
      gl.bindTexture(glTexture.target, glTexture.texture);
      this._boundTextures[this._activeTextureLocation] = source2;
      applyStyleParams(
        source2.style,
        gl,
        source2.mipLevelCount > 1,
        this._renderer.context.extensions.anisotropicFiltering,
        "texParameteri",
        glTexture.target,

        !this._renderer.context.supports.nonPowOf2wrapping && !source2.isPowerOfTwo,
        firstCreation
      );
    }
    onSourceUnload(source2, contextLost = false) {
      const glTexture = source2._gpuData[this._renderer.uid];
      if (!glTexture) return;
      if (!contextLost) {
        this.unbind(source2);
        this._gl.deleteTexture(glTexture.texture);
      }
      source2.off("update", this.onSourceUpdate, this);
      source2.off("resize", this.onSourceUpdate, this);
      source2.off("styleChange", this.onStyleChange, this);
      source2.off("updateMipmaps", this.onUpdateMipmaps, this);
    }
    onSourceUpdate(source2) {
      const gl = this._gl;
      const glTexture = this.getGlSource(source2);
      gl.bindTexture(glTexture.target, glTexture.texture);
      this._boundTextures[this._activeTextureLocation] = source2;
      const premultipliedAlpha = source2.alphaMode === "premultiply-alpha-on-upload";
      if (this._premultiplyAlpha !== premultipliedAlpha) {
        this._premultiplyAlpha = premultipliedAlpha;
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultipliedAlpha);
      }
      if (this._uploads[source2.uploadMethodId]) {
        this._uploads[source2.uploadMethodId].upload(source2, glTexture, gl, this._renderer.context.webGLVersion);
      } else if (glTexture.target === gl.TEXTURE_2D) {
        this._initEmptyTexture2D(glTexture, source2);
      } else if (glTexture.target === gl.TEXTURE_2D_ARRAY) {
        this._initEmptyTexture2DArray(glTexture, source2);
      } else if (glTexture.target === gl.TEXTURE_CUBE_MAP) {
        this._initEmptyTextureCube(glTexture, source2);
      } else {
        throw new Error("[GlTextureSystem] Unsupported texture target for empty allocation.");
      }
      this._applyMipRange(glTexture, source2);
      if (source2.autoGenerateMipmaps && source2.mipLevelCount > 1) {
        this.onUpdateMipmaps(source2, false);
      }
    }
    onUpdateMipmaps(source2, bind = true) {
      if (bind) this.bindSource(source2, 0);
      const glTexture = this.getGlSource(source2);
      this._gl.generateMipmap(glTexture.target);
    }
    _initEmptyTexture2D(glTexture, source2) {
      const gl = this._gl;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        glTexture.internalFormat,
        source2.pixelWidth,
        source2.pixelHeight,
        0,
        glTexture.format,
        glTexture.type,
        null
      );
      let w2 = Math.max(source2.pixelWidth >> 1, 1);
      let h2 = Math.max(source2.pixelHeight >> 1, 1);
      for (let level = 1; level < source2.mipLevelCount; level++) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          level,
          glTexture.internalFormat,
          w2,
          h2,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
        w2 = Math.max(w2 >> 1, 1);
        h2 = Math.max(h2 >> 1, 1);
      }
    }
    _initEmptyTexture2DArray(glTexture, source2) {
      if (this._renderer.context.webGLVersion !== 2) {
        throw new Error("[GlTextureSystem] TEXTURE_2D_ARRAY requires WebGL2.");
      }
      const gl2 = this._gl;
      const depth = Math.max(source2.arrayLayerCount | 0, 1);
      gl2.texImage3D(
        gl2.TEXTURE_2D_ARRAY,
        0,
        glTexture.internalFormat,
        source2.pixelWidth,
        source2.pixelHeight,
        depth,
        0,
        glTexture.format,
        glTexture.type,
        null
      );
      let w2 = Math.max(source2.pixelWidth >> 1, 1);
      let h2 = Math.max(source2.pixelHeight >> 1, 1);
      for (let level = 1; level < source2.mipLevelCount; level++) {
        gl2.texImage3D(
          gl2.TEXTURE_2D_ARRAY,
          level,
          glTexture.internalFormat,
          w2,
          h2,
          depth,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
        w2 = Math.max(w2 >> 1, 1);
        h2 = Math.max(h2 >> 1, 1);
      }
    }
    _initEmptyTextureCube(glTexture, source2) {
      const gl = this._gl;
      const totalCubeFaces = 6;
      for (let face = 0; face < totalCubeFaces; face++) {
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          0,
          glTexture.internalFormat,
          source2.pixelWidth,
          source2.pixelHeight,
          0,
          glTexture.format,
          glTexture.type,
          null
        );
      }
      let w2 = Math.max(source2.pixelWidth >> 1, 1);
      let h2 = Math.max(source2.pixelHeight >> 1, 1);
      for (let level = 1; level < source2.mipLevelCount; level++) {
        for (let face = 0; face < totalCubeFaces; face++) {
          gl.texImage2D(
            gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
            level,
            glTexture.internalFormat,
            w2,
            h2,
            0,
            glTexture.format,
            glTexture.type,
            null
          );
        }
        w2 = Math.max(w2 >> 1, 1);
        h2 = Math.max(h2 >> 1, 1);
      }
    }

    _applyMipRange(glTexture, source2) {
      if (this._renderer.context.webGLVersion !== 2) return;
      if (source2.mipLevelCount <= 1) return;
      const gl = this._gl;
      const maxLevel = Math.max((source2.mipLevelCount | 0) - 1, 0);
      gl.texParameteri(glTexture.target, gl.TEXTURE_BASE_LEVEL, 0);
      gl.texParameteri(glTexture.target, gl.TEXTURE_MAX_LEVEL, maxLevel);
    }
    _initSampler(style) {
      const gl = this._gl;
      const glSampler = this._gl.createSampler();
      this._glSamplers[style._resourceId] = glSampler;
      applyStyleParams(
        style,
        gl,
        this._boundTextures[this._activeTextureLocation].mipLevelCount > 1,
        this._renderer.context.extensions.anisotropicFiltering,
        "samplerParameteri",
        glSampler,
        false,
        true
      );
      return this._glSamplers[style._resourceId];
    }
    _getGlSampler(sampler) {
      return this._glSamplers[sampler._resourceId] || this._initSampler(sampler);
    }
    getGlSource(source2) {
      source2._gcLastUsed = this._renderer.gc.now;
      return source2._gpuData[this._renderer.uid] || this._initSource(source2);
    }
    generateCanvas(texture) {
      const { pixels, width, height } = this.getPixels(texture);
      const canvas = DOMAdapter.get().createCanvas();
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(pixels);
        ctx.putImageData(imageData, 0, 0);
      }
      return canvas;
    }
    getPixels(texture) {
      const resolution = texture.source.resolution;
      const frame = texture.frame;
      const width = Math.max(Math.round(frame.width * resolution), 1);
      const height = Math.max(Math.round(frame.height * resolution), 1);
      const pixels = new Uint8Array(BYTES_PER_PIXEL * width * height);
      const renderer = this._renderer;
      const renderTarget = renderer.renderTarget.getRenderTarget(texture);
      const glRenterTarget = renderer.renderTarget.getGpuRenderTarget(renderTarget);
      const gl = renderer.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, glRenterTarget.resolveTargetFramebuffer);
      gl.readPixels(
        Math.round(frame.x * resolution),
        Math.round(frame.y * resolution),
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      return { pixels: new Uint8ClampedArray(pixels.buffer), width, height };
    }
    destroy() {
      this._managedTextures.destroy();
      this._glSamplers = null;
      this._boundTextures = null;
      this._boundSamplers = null;
      this._mapFormatToInternalFormat = null;
      this._mapFormatToType = null;
      this._mapFormatToFormat = null;
      this._uploads = null;
      this._renderer = null;
    }
    resetState() {
      this._activeTextureLocation = -1;
      this._boundTextures.fill(Texture.EMPTY.source);
      this._boundSamplers =                 Object.create(null);
      const gl = this._gl;
      this._premultiplyAlpha = false;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this._premultiplyAlpha);
    }
  }
  GlTextureSystem.extension = {
    type: [
      ExtensionType.WebGLSystem
    ],
    name: "texture"
  };
  class GlGraphicsAdaptor {
    contextChange(renderer) {
      const uniforms = new UniformGroup({
        uColor: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
        uTransformMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uRound: { value: 0, type: "f32" }
      });
      const maxTextures = renderer.limits.maxBatchableTextures;
      const glProgram = compileHighShaderGlProgram({
        name: "graphics",
        bits: [
          colorBitGl,
          generateTextureBatchBitGl(maxTextures),
          localUniformBitGl,
          roundPixelsBitGl
        ]
      });
      this.shader = new Shader({
        glProgram,
        resources: {
          localUniforms: uniforms,
          batchSamplers: getBatchSamplersUniformGroup(maxTextures)
        }
      });
    }
    execute(graphicsPipe, renderable) {
      const context2 = renderable.context;
      const shader = context2.customShader || this.shader;
      const renderer = graphicsPipe.renderer;
      const contextSystem = renderer.graphicsContext;
      const {
        batcher,
        instructions
      } = contextSystem.getContextRenderData(context2);
      shader.groups[0] = renderer.globalUniforms.bindGroup;
      renderer.state.set(graphicsPipe.state);
      renderer.shader.bind(shader);
      renderer.geometry.bind(batcher.geometry, shader.glProgram);
      const batches = instructions.instructions;
      for (let i2 = 0; i2 < instructions.instructionSize; i2++) {
        const batch = batches[i2];
        if (batch.size) {
          for (let j2 = 0; j2 < batch.textures.count; j2++) {
            renderer.texture.bind(batch.textures.textures[j2], j2);
          }
          renderer.geometry.draw(batch.topology, batch.size, batch.start);
        }
      }
    }
    destroy() {
      this.shader.destroy(true);
      this.shader = null;
    }
  }
  GlGraphicsAdaptor.extension = {
    type: [
      ExtensionType.WebGLPipesAdaptor
    ],
    name: "graphics"
  };
  class GlMeshAdaptor {
    init() {
      const glProgram = compileHighShaderGlProgram({
        name: "mesh",
        bits: [
          localUniformBitGl,
          textureBitGl,
          roundPixelsBitGl
        ]
      });
      this._shader = new Shader({
        glProgram,
        resources: {
          uTexture: Texture.EMPTY.source,
          textureUniforms: {
            uTextureMatrix: { type: "mat3x3<f32>", value: new Matrix() }
          }
        }
      });
    }
    execute(meshPipe, mesh) {
      const renderer = meshPipe.renderer;
      let shader = mesh._shader;
      if (!shader) {
        shader = this._shader;
        const texture = mesh.texture;
        const source2 = texture.source;
        shader.resources.uTexture = source2;
        shader.resources.uSampler = source2.style;
        shader.resources.textureUniforms.uniforms.uTextureMatrix = texture.textureMatrix.mapCoord;
      } else if (!shader.glProgram) {
        warn("Mesh shader has no glProgram", mesh.shader);
        return;
      }
      shader.groups[100] = renderer.globalUniforms.bindGroup;
      shader.groups[101] = meshPipe.localUniformsBindGroup;
      renderer.encoder.draw({
        geometry: mesh._geometry,
        shader,
        state: mesh.state
      });
    }
    destroy() {
      this._shader.destroy(true);
      this._shader = null;
    }
  }
  GlMeshAdaptor.extension = {
    type: [
      ExtensionType.WebGLPipesAdaptor
    ],
    name: "mesh"
  };
  const DefaultWebGLSystems = [
    ...SharedSystems,
    GlUboSystem,
    GlBackBufferSystem,
    GlContextSystem,
    GlLimitsSystem,
    GlBufferSystem,
    GlTextureSystem,
    GlRenderTargetSystem,
    GlGeometrySystem,
    GlUniformGroupSystem,
    GlShaderSystem,
    GlEncoderSystem,
    GlStateSystem,
    GlStencilSystem,
    GlColorMaskSystem
  ];
  const DefaultWebGLPipes = [...SharedRenderPipes];
  const DefaultWebGLAdapters = [GlBatchAdaptor, GlMeshAdaptor, GlGraphicsAdaptor];
  const systems = [];
  const renderPipes = [];
  const renderPipeAdaptors = [];
  extensions.handleByNamedList(ExtensionType.WebGLSystem, systems);
  extensions.handleByNamedList(ExtensionType.WebGLPipes, renderPipes);
  extensions.handleByNamedList(ExtensionType.WebGLPipesAdaptor, renderPipeAdaptors);
  extensions.add(...DefaultWebGLSystems, ...DefaultWebGLPipes, ...DefaultWebGLAdapters);
  class WebGLRenderer extends AbstractRenderer {
    constructor() {
      const systemConfig = {
        name: "webgl",
        type: RendererType.WEBGL,
        systems,
        renderPipes,
        renderPipeAdaptors
      };
      super(systemConfig);
    }
  }
  const WebGLRenderer$1 =                 Object.freeze(                Object.defineProperty({
    __proto__: null,
    WebGLRenderer
  }, Symbol.toStringTag, { value: "Module" }));
  extensions.add(browserExt, webworkerExt);
  const MIO_DEFAULTS = {
    appearance: {
      radius: 56,

      bodyColor: 789263,
      bodyAlpha: 1,

      hueStart: 296.5,
      hueSpan: -52.5,
      hueAngle: 225,

      hueDrift: 0,
      hueSpin: 0,
      hueLoop: true,

      saturation: 1,

      lightness: 0.75,

      iridescence: 0,

      outlineWidth: 3,

      glow: 10,
      glowBlur: true,

      eyeColor: 16776191,
      eyeScale: 0.3
    },
    physics: {

      points: 12,

      shapePreset: "blob",

      shapeLobes: 3,
      shapeAmount: 1,
      shapeAngle: 0,

      shapeShuffle: 60,

      radialStiffness: 460,
      edgeStiffness: 540,
      bendStiffness: 170,
      pressure: 2400,

      damping: 9,
      airDamping: 0.5,
      magnetStrength: 2200,
      magnetRange: 260,
      magnetGrip: 0.24,
      magnetDamping: 7,
      floatAmplitude: 10,
      floatSpeed: 1.1,
      idleWobble: 0.085,
      idleWobbleSpeed: 0.55,
      speedStretch: 0.3,
      friction: 0.86,
      restitution: 0.2,
      dragStiffness: 480,
      throwBoost: 1,
      minStretch: 0.55,
      maxStretch: 1.7,
      minAngularGap: 0.25,
      limitIterations: 3,
      dragMaxAccel: 9e3,
      subStep: 1 / 240,
      maxSubSteps: 8
    }
  };
  const NAMESPACE = "os.mio.";
  function doAction(hookName, ...args) {
    if (!hookName.startsWith(NAMESPACE)) {
      return;
    }
    const name = `mio:${hookName.slice(NAMESPACE.length)}`;
    try {
      document.dispatchEvent(
        new CustomEvent(name, { detail: args[0] ?? {} })
      );
    } catch {
    }
  }
  const MAGNET_KINDS =                 new Set([
    "window",
    "widget"
  ]);
  const CHROME_KINDS =                 new Set([
    "dock",
    "shell"
  ]);
  const FORBIDDEN_KINDS =                 new Set([
    "dock"
  ]);
  function collectObstacles(surfaces, origin, bounds) {
    const out2 = [];
    for (const surface of surfaces) {
      const r2 = surface.rect;
      if (!r2 || r2.width <= 0 || r2.height <= 0) {
        continue;
      }
      let x2 = r2.x - origin.left;
      let y2 = r2.y - origin.top;
      let width = r2.width;
      let height = r2.height;
      if (bounds && CHROME_KINDS.has(surface.kind)) {
        if ("right" === surface.face) {
          width = x2 + width;
          x2 = 0;
        } else if ("left" === surface.face) {
          width = Math.max(width, bounds.width - x2);
        } else if ("top" === surface.face) {
          height = Math.max(height, bounds.height - y2);
        } else {
          height = y2 + height;
          y2 = 0;
        }
      }
      out2.push({
        id: surface.id,
        kind: surface.kind,
        face: surface.face,
        x: x2,
        y: y2,
        width,
        height
      });
    }
    return out2;
  }
  function clampOutsideChrome(point, radius, obstacles) {
    let { x: x2, y: y2 } = point;
    for (const o2 of obstacles) {
      if (!FORBIDDEN_KINDS.has(o2.kind)) {
        continue;
      }
      if (x2 <= o2.x - radius || x2 >= o2.x + o2.width + radius || y2 <= o2.y - radius || y2 >= o2.y + o2.height + radius) {
        continue;
      }
      ({ x: x2, y: y2 } = outsideFace(o2, x2, y2, radius));
    }
    return { x: x2, y: y2 };
  }
  function outsideFace(o2, px, py, clear) {
    if ("right" === o2.face) {
      return { x: o2.x + o2.width + clear, y: py };
    }
    if ("left" === o2.face) {
      return { x: o2.x - clear, y: py };
    }
    if ("top" === o2.face) {
      return { x: px, y: o2.y - clear };
    }
    return { x: px, y: o2.y + o2.height + clear };
  }
  function distanceToObstacle(px, py, o2) {
    const dx = Math.max(o2.x - px, 0, px - (o2.x + o2.width));
    const dy = Math.max(o2.y - py, 0, py - (o2.y + o2.height));
    return Math.hypot(dx, dy);
  }
  function closestPointOn(px, py, o2) {
    return {
      x: Math.min(Math.max(px, o2.x), o2.x + o2.width),
      y: Math.min(Math.max(py, o2.y), o2.y + o2.height)
    };
  }
  function magnetPull(px, py, radius, obstacles, range) {
    if (range <= 0) {
      return null;
    }
    let nearest = null;
    let nearestDistance = Infinity;
    for (const o2 of obstacles) {
      if (!MAGNET_KINDS.has(o2.kind)) {
        continue;
      }
      const d2 = distanceToObstacle(px, py, o2);
      if (d2 < nearestDistance) {
        nearestDistance = d2;
        nearest = o2;
      }
    }
    if (!nearest) {
      return null;
    }
    const gap = nearestDistance - radius;
    if (gap >= range) {
      return null;
    }
    const t2 = 1 - Math.max(gap, 0) / range;
    const strength = t2 * t2 * (3 - 2 * t2);
    const target = closestPointOn(px, py, nearest);
    const dx = target.x - px;
    const dy = target.y - py;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      return { dx: 0, dy: 0, strength, gap };
    }
    return { dx: dx / len, dy: dy / len, strength, gap };
  }
  function clusterBounds(seed, obstacles, pad = 8) {
    let minX = seed.x;
    let minY = seed.y;
    let maxX = seed.x + seed.width;
    let maxY = seed.y + seed.height;
    const remaining = obstacles.filter(
      (o2) => MAGNET_KINDS.has(o2.kind) && o2 !== seed
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (let i2 = remaining.length - 1; i2 >= 0; i2--) {
        const o2 = remaining[i2];
        const overlaps = o2.x < maxX + pad && o2.x + o2.width > minX - pad && o2.y < maxY + pad && o2.y + o2.height > minY - pad;
        if (!overlaps) {
          continue;
        }
        minX = Math.min(minX, o2.x);
        minY = Math.min(minY, o2.y);
        maxX = Math.max(maxX, o2.x + o2.width);
        maxY = Math.max(maxY, o2.y + o2.height);
        remaining.splice(i2, 1);
        grew = true;
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  const TRAPPED_DEPTH_FACTOR = 0.75;
  function findEscape(px, py, radius, obstacles, bounds) {
    for (const o2 of obstacles) {
      if (!FORBIDDEN_KINDS.has(o2.kind)) {
        continue;
      }
      if (px <= o2.x || px >= o2.x + o2.width || py <= o2.y || py >= o2.y + o2.height) {
        continue;
      }
      const out2 = outsideFace(o2, px, py, radius + 8);
      return {
        x: Math.min(Math.max(out2.x, radius), Math.max(radius, bounds.width - radius)),
        y: Math.min(Math.max(out2.y, radius), Math.max(radius, bounds.height - radius))
      };
    }
    const minDepth = radius * TRAPPED_DEPTH_FACTOR;
    let trappedIn = null;
    let deepest = minDepth;
    for (const o2 of obstacles) {
      if (!MAGNET_KINDS.has(o2.kind)) {
        continue;
      }
      const depth = Math.min(
        px - o2.x,
        o2.x + o2.width - px,
        py - o2.y,
        o2.y + o2.height - py
      );
      if (depth > deepest) {
        deepest = depth;
        trappedIn = o2;
      }
    }
    if (!trappedIn) {
      return null;
    }
    const cluster = clusterBounds(trappedIn, obstacles);
    const margin = radius + 8;
    const midX = cluster.x + cluster.width / 2;
    const midY = cluster.y + cluster.height / 2;
    const candidates = [
      { x: midX, y: cluster.y - margin },
      { x: midX, y: cluster.y + cluster.height + margin },
      { x: cluster.x - margin, y: midY },
      { x: cluster.x + cluster.width + margin, y: midY }
    ].filter(
      (c2) => c2.x >= radius && c2.y >= radius && c2.x <= bounds.width - radius && c2.y <= bounds.height - radius
    );
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestDistance = Infinity;
      for (const c2 of candidates) {
        const d2 = Math.hypot(c2.x - px, c2.y - py);
        if (d2 < bestDistance) {
          bestDistance = d2;
          best = c2;
        }
      }
      return best;
    }
    const gaps = [
      { size: cluster.y, x: midX, y: cluster.y / 2 },
      {
        size: bounds.height - (cluster.y + cluster.height),
        x: midX,
        y: (cluster.y + cluster.height + bounds.height) / 2
      },
      { size: cluster.x, x: cluster.x / 2, y: midY },
      {
        size: bounds.width - (cluster.x + cluster.width),
        x: (cluster.x + cluster.width + bounds.width) / 2,
        y: midY
      }
    ].sort((a2, b2) => b2.size - a2.size);
    const widest = gaps[0];
    if (widest && widest.size >= radius) {
      return { x: widest.x, y: widest.y };
    }
    return { x: bounds.width / 2, y: bounds.height / 2 };
  }
  function resolveObstacleCollisions(p2, obstacles, restitution, friction) {
    let touched = false;
    for (const o2 of obstacles) {
      const right = o2.x + o2.width;
      const bottom = o2.y + o2.height;
      if (p2.x <= o2.x || p2.x >= right || p2.y <= o2.y || p2.y >= bottom) {
        continue;
      }
      const fromLeft = p2.x - o2.x;
      const fromRight = right - p2.x;
      const fromTop = p2.y - o2.y;
      const fromBottom = bottom - p2.y;
      const min = Math.min(fromLeft, fromRight, fromTop, fromBottom);
      touched = true;
      if (min === fromTop) {
        p2.y = o2.y;
        if (p2.vy > 0) {
          p2.vy = -p2.vy * restitution;
        }
        p2.vx *= friction;
      } else if (min === fromBottom) {
        p2.y = bottom;
        if (p2.vy < 0) {
          p2.vy = -p2.vy * restitution;
        }
        p2.vx *= friction;
      } else if (min === fromLeft) {
        p2.x = o2.x;
        if (p2.vx > 0) {
          p2.vx = -p2.vx * restitution;
        }
        p2.vy *= friction;
      } else {
        p2.x = right;
        if (p2.vx < 0) {
          p2.vx = -p2.vx * restitution;
        }
        p2.vy *= friction;
      }
    }
    return touched;
  }
  function clampToBounds(p2, width, height, restitution, friction) {
    let touched = false;
    if (p2.x < 0) {
      p2.x = 0;
      if (p2.vx < 0) {
        p2.vx = -p2.vx * restitution;
      }
      p2.vy *= friction;
      touched = true;
    } else if (p2.x > width) {
      p2.x = width;
      if (p2.vx > 0) {
        p2.vx = -p2.vx * restitution;
      }
      p2.vy *= friction;
      touched = true;
    }
    if (p2.y < 0) {
      p2.y = 0;
      if (p2.vy < 0) {
        p2.vy = -p2.vy * restitution;
      }
      p2.vx *= friction;
      touched = true;
    } else if (p2.y > height) {
      p2.y = height;
      if (p2.vy > 0) {
        p2.vy = -p2.vy * restitution;
      }
      p2.vx *= friction;
      touched = true;
    }
    return touched;
  }
  const MAX_STALE_MS = 250;
  function keyed(obstacles) {
    const out2 =                 new Map();
    const seen =                 new Map();
    for (const o2 of obstacles) {
      const n2 = seen.get(o2.id) ?? 0;
      seen.set(o2.id, n2 + 1);
      out2.set(0 === n2 ? o2.id : `${o2.id}#${n2}`, o2);
    }
    return out2;
  }
  function unchanged(a2, b2) {
    if (a2.size !== b2.size) {
      return false;
    }
    for (const [key, prev] of a2) {
      const next = b2.get(key);
      if (!next || next.x !== prev.x || next.y !== prev.y || next.width !== prev.width || next.height !== prev.height) {
        return false;
      }
    }
    return true;
  }
  function lerp(a2, b2, t2) {
    return a2 + (b2 - a2) * t2;
  }
  function createObstacleTrack(intervalMs) {
    const interval = Math.max(1, intervalMs);
    let previous =                 new Map();
    let current =                 new Map();
    let currentList = [];
    let sampledAt = 0;
    let still = true;
    return {
      sample(obstacles, nowMs) {
        const gap = nowMs - sampledAt;
        previous = current;
        current = keyed(obstacles);
        currentList = obstacles;
        sampledAt = nowMs;
        still = gap > MAX_STALE_MS || unchanged(previous, current);
      },
      at(nowMs) {
        if (still) {
          return currentList;
        }
        const t2 = Math.min(
          1,
          Math.max(0, (nowMs - sampledAt) / interval)
        );
        if (1 <= t2) {
          return currentList;
        }
        const out2 = [];
        for (const [key, o2] of current) {
          const prev = previous.get(key);
          if (!prev) {
            out2.push(o2);
            continue;
          }
          out2.push({
            id: o2.id,
            kind: o2.kind,
            face: o2.face,
            x: lerp(prev.x, o2.x, t2),
            y: lerp(prev.y, o2.y, t2),
            width: lerp(prev.width, o2.width, t2),
            height: lerp(prev.height, o2.height, t2)
          });
        }
        return out2;
      },
      reset() {
        previous = current;
        still = true;
      }
    };
  }
  const LEAVE_GRACE_MS = 250;
  function createPointerTracker() {
    let position = null;
    let leaveTimer = null;
    let destroyed = false;
    const frameCache =                 new WeakMap();
    const cancelLeave = () => {
      if (leaveTimer !== null) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    };
    const set = (x2, y2) => {
      cancelLeave();
      position = { x: x2, y: y2 };
    };
    const onMove = (e2) => {
      set(e2.clientX, e2.clientY);
    };
    const onLeave = () => {
      cancelLeave();
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        position = null;
      }, LEAVE_GRACE_MS);
    };
    const resolveFrame = (source2) => {
      if (!source2) {
        return null;
      }
      const cached = frameCache.get(source2);
      if (cached && cached.isConnected && cached.contentWindow === source2) {
        return cached;
      }
      const frames = document.querySelectorAll("iframe");
      for (const frame of Array.from(frames)) {
        if (frame.contentWindow === source2) {
          frameCache.set(source2, frame);
          return frame;
        }
      }
      return null;
    };
    const enableIn = (target) => {
      if (!target) {
        return;
      }
      try {
        target.postMessage(
          { type: "os-pointer-track", enabled: true },
          window.location.origin
        );
      } catch {
      }
    };
    const broadcast = (enabled) => {
      const frames = document.querySelectorAll("iframe");
      for (const frame of Array.from(frames)) {
        try {
          frame.contentWindow?.postMessage(
            { type: "os-pointer-track", enabled },
            window.location.origin
          );
        } catch {
        }
      }
    };
    const onMessage = (e2) => {
      if (destroyed || e2.origin !== window.location.origin) {
        return;
      }
      const data = e2.data;
      if (!data || typeof data.type !== "string") {
        return;
      }
      if (data.type === "os-bridge-ready") {
        enableIn(e2.source);
        return;
      }
      if (data.type !== "os-pointer-move") {
        return;
      }
      if (typeof data.x !== "number" || typeof data.y !== "number") {
        return;
      }
      const frame = resolveFrame(e2.source);
      if (!frame) {
        return;
      }
      const rect = frame.getBoundingClientRect();
      set(rect.left + data.x, rect.top + data.y);
    };
    window.addEventListener("pointermove", onMove, {
      capture: true,
      passive: true
    });
    window.addEventListener("pointerdown", onMove, {
      capture: true,
      passive: true
    });
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("message", onMessage);
    broadcast(true);
    return {
      get: () => position,
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        cancelLeave();
        window.removeEventListener("pointermove", onMove, { capture: true });
        window.removeEventListener("pointerdown", onMove, { capture: true });
        document.documentElement.removeEventListener("mouseleave", onLeave);
        window.removeEventListener("message", onMessage);
        broadcast(false);
      }
    };
  }
  function hslToRgbInt(h2, s2, l2) {
    const hue = (h2 % 360 + 360) % 360;
    const sat = Math.min(1, Math.max(0, s2));
    const lig = Math.min(1, Math.max(0, l2));
    const c2 = (1 - Math.abs(2 * lig - 1)) * sat;
    const hp = hue / 60;
    const x2 = c2 * (1 - Math.abs(hp % 2 - 1));
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    if (hp < 1) {
      r2 = c2;
      g2 = x2;
    } else if (hp < 2) {
      r2 = x2;
      g2 = c2;
    } else if (hp < 3) {
      g2 = c2;
      b2 = x2;
    } else if (hp < 4) {
      g2 = x2;
      b2 = c2;
    } else if (hp < 5) {
      r2 = x2;
      b2 = c2;
    } else {
      r2 = c2;
      b2 = x2;
    }
    const m2 = lig - c2 / 2;
    const to8 = (v2) => Math.min(255, Math.max(0, Math.round((v2 + m2) * 255)));
    return to8(r2) << 16 | to8(g2) << 8 | to8(b2);
  }
  function lighten(rgb, amount) {
    const t2 = Math.min(1, Math.max(0, amount));
    const r2 = rgb >> 16 & 255;
    const g2 = rgb >> 8 & 255;
    const b2 = rgb & 255;
    const mix = (v2) => Math.round(v2 + (255 - v2) * t2);
    return mix(r2) << 16 | mix(g2) << 8 | mix(b2);
  }
  const HOLO_HUE_SWING = 82;
  const HOLO_GRATING_SWING = 36;
  const HOLO_GLINT_EXPONENT = 6;
  const TAU$1 = Math.PI * 2;
  const DEG = Math.PI / 180;
  function grating(t2, phase) {
    return 0.68 * Math.sin(t2 * TAU$1 * 3 + phase * DEG * 2) + 0.32 * Math.sin(t2 * TAU$1 * 5 - phase * DEG * 1.3);
  }
  function rake(view, i2) {
    const n2 = view.normals[i2 % view.normals.length];
    if (!n2) {
      return 0;
    }
    return n2.nx * view.tilt.x + n2.ny * view.tilt.y;
  }
  function chromaRing(count2, phase, appearance, view, spin = 0) {
    const n2 = Math.max(1, Math.round(count2));
    const holo = view ? Math.max(0, appearance.iridescence) : 0;
    const out2 = new Array(n2);
    for (let i2 = 0; i2 < n2; i2++) {
      const t2 = i2 / n2;
      const shifted = ((t2 - (appearance.hueAngle + spin) / 360) % 1 + 1) % 1;
      const ramp = appearance.hueLoop ? 0.5 - 0.5 * Math.cos(shifted * TAU$1) : shifted;
      let hue = appearance.hueStart + appearance.hueSpan * ramp + phase;
      const lift = 0.5 + 0.5 * Math.cos((t2 - 1 / 3) * Math.PI * 2);
      let lightness = appearance.lightness * (0.72 + 0.28 * lift);
      let saturation = appearance.saturation;
      if (holo > 0 && view) {
        const d2 = rake(view, i2);
        const ripple = grating(t2, phase);
        hue += holo * (HOLO_HUE_SWING * d2 + HOLO_GRATING_SWING * ripple);
        const glint = Math.pow(Math.max(0, d2), HOLO_GLINT_EXPONENT);
        lightness += holo * (0.32 * glint + 0.07 * ripple);
        saturation *= 1 - Math.min(1, holo) * 0.45 * glint;
      }
      out2[i2] = hslToRgbInt(hue, saturation, lightness);
    }
    return out2;
  }
  function holoSpecular(count2, appearance, view) {
    const n2 = Math.max(1, Math.round(count2));
    const holo = Math.max(0, Math.min(1, appearance.iridescence));
    const out2 = new Array(n2);
    for (let i2 = 0; i2 < n2; i2++) {
      out2[i2] = holo * Math.pow(Math.max(0, rake(view, i2)), HOLO_GLINT_EXPONENT);
    }
    return out2;
  }
  const RIBBON_SAMPLES = 144;
  const CURVE_SMOOTHNESS = 0.85;
  const GLOW_FALLOFF = 2;
  const SHEEN_SHELLS = [
    { from: 0.07, to: 0.22, alpha: 0.34 },
    { from: 0.22, to: 0.4, alpha: 0.24 },
    { from: 0.4, to: 0.6, alpha: 0.15 },
    { from: 0.6, to: 0.8, alpha: 0.08 },
    { from: 0.8, to: 1, alpha: 0.035 }
  ];
  function mid(a2, b2) {
    return { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
  }
  function buildRibbon(rim, centre, total = RIBBON_SAMPLES) {
    const out2 = [];
    const n2 = rim.length;
    if (n2 < 3) {
      return out2;
    }
    const wanted = Math.max(2, Math.ceil(Math.max(1, total) / n2));
    const step = wanted % 2 === 0 ? wanted : wanted + 1;
    for (let i2 = 0; i2 < n2; i2++) {
      const a2 = mid(rim[(i2 + n2 - 1) % n2], rim[i2]);
      const c2 = rim[i2];
      const b2 = mid(rim[i2], rim[(i2 + 1) % n2]);
      for (let k2 = 0; k2 < step; k2++) {
        const u2 = k2 / step;
        const v2 = 1 - u2;
        const x2 = v2 * v2 * a2.x + 2 * u2 * v2 * c2.x + u2 * u2 * b2.x;
        const y2 = v2 * v2 * a2.y + 2 * u2 * v2 * c2.y + u2 * u2 * b2.y;
        let tx = v2 * (c2.x - a2.x) + u2 * (b2.x - c2.x);
        let ty = v2 * (c2.y - a2.y) + u2 * (b2.y - c2.y);
        let len = Math.hypot(tx, ty);
        if (len < 1e-6) {
          tx = x2 - centre.x;
          ty = y2 - centre.y;
          len = Math.hypot(tx, ty) || 1;
          out2.push({ x: x2, y: y2, nx: tx / len, ny: ty / len });
          continue;
        }
        let nx = -ty / len;
        let ny = tx / len;
        if (nx * (x2 - centre.x) + ny * (y2 - centre.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        out2.push({ x: x2, y: y2, nx, ny });
      }
    }
    return out2;
  }
  function controlThrough(a2, m2, b2) {
    return {
      x: 2 * m2.x - (a2.x + b2.x) / 2,
      y: 2 * m2.y - (a2.y + b2.y) / 2
    };
  }
  function offset(s2, by) {
    return { x: s2.x + s2.nx * by, y: s2.y + s2.ny * by };
  }
  function curvedCell(g2, outerA, outerM, outerB, innerA, innerM, innerB) {
    const co = controlThrough(outerA, outerM, outerB);
    const ci = controlThrough(innerA, innerM, innerB);
    g2.moveTo(outerA.x, outerA.y);
    g2.quadraticCurveTo(co.x, co.y, outerB.x, outerB.y, CURVE_SMOOTHNESS);
    g2.lineTo(innerB.x, innerB.y);
    g2.quadraticCurveTo(ci.x, ci.y, innerA.x, innerA.y, CURVE_SMOOTHNESS);
    g2.closePath();
  }
  function fillBody(g2, rim, color, alpha) {
    const n2 = rim.length;
    if (n2 < 3 || alpha <= 0) {
      return;
    }
    const first = mid(rim[n2 - 1], rim[0]);
    g2.moveTo(first.x, first.y);
    for (let i2 = 0; i2 < n2; i2++) {
      const control = rim[i2];
      const next = mid(rim[i2], rim[(i2 + 1) % n2]);
      g2.quadraticCurveTo(
        control.x,
        control.y,
        next.x,
        next.y,
        CURVE_SMOOTHNESS
      );
    }
    g2.closePath();
    g2.fill({ color, alpha });
  }
  function fillBandBetween(g2, samples, colors, outer, inner, alpha, stride) {
    const m2 = samples.length;
    const step = Math.max(1, Math.round(stride));
    const half = step % 2 === 0 ? step / 2 : 0;
    for (let i2 = 0; i2 < m2; i2 += step) {
      const a2 = samples[i2];
      const b2 = samples[(i2 + step) % m2];
      if (half > 0) {
        const c2 = samples[(i2 + half) % m2];
        curvedCell(
          g2,
          outer(a2),
          outer(c2),
          outer(b2),
          inner(a2),
          inner(c2),
          inner(b2)
        );
      } else {
        const oa = outer(a2);
        const ob = outer(b2);
        const ia = inner(a2);
        const ib = inner(b2);
        g2.poly([oa.x, oa.y, ob.x, ob.y, ib.x, ib.y, ia.x, ia.y]);
      }
      g2.fill({ color: colors[i2 % colors.length], alpha });
    }
  }
  function fillBand(g2, samples, colors, outer, inner, alpha, stride = 2) {
    if (samples.length < 3 || alpha <= 0 || outer + inner <= 0) {
      return;
    }
    fillBandBetween(
      g2,
      samples,
      colors,
      (s2) => offset(s2, outer),
      (s2) => offset(s2, -inner),
      alpha,
      stride
    );
  }
  function fillGlow(g2, samples, centre, colors, reach, bleed, peak, maxShells, stride = 2) {
    if (samples.length < 3 || peak <= 0 || reach <= 0) {
      return;
    }
    let sum = 0;
    for (const s2 of samples) {
      sum += Math.hypot(s2.x - centre.x, s2.y - centre.y);
    }
    const mean = sum / samples.length;
    if (!(mean > 1e-3)) {
      return;
    }
    const dilate = (px) => (s2) => {
      const k2 = Math.max(0, 1 + px / mean);
      return {
        x: centre.x + (s2.x - centre.x) * k2,
        y: centre.y + (s2.y - centre.y) * k2
      };
    };
    const reachPx = reach * mean;
    const n2 = glowShells(reachPx, Math.max(1, Math.round(maxShells)));
    for (let i2 = 0; i2 < n2; i2++) {
      const alpha = peak * Math.pow(1 - (i2 + 0.5) / n2, GLOW_FALLOFF);
      fillBandBetween(
        g2,
        samples,
        colors,
        dilate((i2 + 1) / n2 * reachPx),

        dilate(i2 === 0 ? -bleed : i2 / n2 * reachPx),
        alpha,
        stride
      );
    }
  }
  function glowShells(reach, max) {
    return Math.max(2, Math.min(max, Math.round(reach / 14)));
  }
  const GLOW_REACH = { halo: 0.16, bloom: 0.075 };
  function glowReach(glow) {
    return {
      halo: GLOW_REACH.halo * glow,
      bloom: GLOW_REACH.bloom * glow
    };
  }
  function glowBlurStrength(radius, glow) {
    const reach = glowReach(glow);
    const spacing = (ratio, max) => {
      const px = ratio * radius;
      return Math.max(2, px / glowShells(px, max) * 2);
    };
    return {
      halo: spacing(reach.halo, HALO_SHELL_CAP),
      bloom: spacing(reach.bloom, BLOOM_SHELL_CAP)
    };
  }
  const HALO_SHELL_CAP = 10;
  const BLOOM_SHELL_CAP = 5;
  function fillSheen(g2, samples, centre, colors, scale, stride = 6) {
    const m2 = samples.length;
    if (m2 < 3 || scale <= 0) {
      return;
    }
    const step = Math.max(1, Math.round(stride));
    const half = step % 2 === 0 ? step / 2 : 0;
    const at = (s2, t2) => ({
      x: s2.x + (centre.x - s2.x) * t2,
      y: s2.y + (centre.y - s2.y) * t2
    });
    for (const shell of SHEEN_SHELLS) {
      for (let i2 = 0; i2 < m2; i2 += step) {
        const a2 = samples[i2];
        const b2 = samples[(i2 + step) % m2];
        const c2 = half > 0 ? samples[(i2 + half) % m2] : null;
        const outerA = at(a2, shell.from);
        const outerB = at(b2, shell.from);
        const innerA = shell.to >= 1 ? centre : at(a2, shell.to);
        const innerB = shell.to >= 1 ? centre : at(b2, shell.to);
        if (c2 && shell.to >= 1) {
          const arc = controlThrough(outerA, at(c2, shell.from), outerB);
          g2.moveTo(outerA.x, outerA.y);
          g2.quadraticCurveTo(
            arc.x,
            arc.y,
            outerB.x,
            outerB.y,
            CURVE_SMOOTHNESS
          );
          g2.lineTo(centre.x, centre.y);
          g2.closePath();
        } else if (c2) {
          curvedCell(
            g2,
            outerA,
            at(c2, shell.from),
            outerB,
            innerA,
            at(c2, shell.to),
            innerB
          );
        } else if (shell.to >= 1) {
          g2.poly([outerA.x, outerA.y, outerB.x, outerB.y, centre.x, centre.y]);
        } else {
          g2.poly([
            outerA.x,
            outerA.y,
            outerB.x,
            outerB.y,
            innerB.x,
            innerB.y,
            innerA.x,
            innerA.y
          ]);
        }
        g2.fill({
          color: colors[i2 % colors.length],
          alpha: shell.alpha * scale
        });
      }
    }
  }
  function rimBounds(rim) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p2 of rim) {
      if (p2.x < minX) {
        minX = p2.x;
      }
      if (p2.x > maxX) {
        maxX = p2.x;
      }
      if (p2.y < minY) {
        minY = p2.y;
      }
      if (p2.y > maxY) {
        maxY = p2.y;
      }
    }
    return { width: maxX - minX, height: maxY - minY };
  }
  function eyeLayout(frame, appearance) {
    const r2 = frame.radius;
    const { width: bw, height: bh } = rimBounds(frame.rim);
    const squashX = 1 + 0.35 * (bw / (2 * r2) - 1);
    const squashY = 1 + 0.35 * (bh / (2 * r2) - 1);
    const height = r2 * appearance.eyeScale * clamp$2(squashY, 0.4, 1.6);
    const width = height * 0.46;
    let gx = 0;
    let gy = 0;
    if (frame.gaze) {
      const dx = frame.gaze.x - frame.centre.x;
      const dy = frame.gaze.y - frame.centre.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-3) {
        const reach = Math.min(1, dist / (r2 * 3));
        gx = dx / dist * reach * r2 * 0.16;
        gy = dy / dist * reach * r2 * 0.13;
      }
    }
    const gap = r2 * 0.28 * clamp$2(squashX, 0.5, 1.6);
    const cy = frame.centre.y - r2 * 0.02 + gy;
    return {
      left: { x: frame.centre.x - gap + gx, y: cy },
      right: { x: frame.centre.x + gap + gx, y: cy },
      width,
      height: height * (1 - clamp$2(frame.blink, 0, 1) * 0.94)
    };
  }
  function clamp$2(v2, lo, hi) {
    return Math.min(hi, Math.max(lo, v2));
  }
  function drawMio(layers, frame, appearance) {
    const { rim } = frame;
    if (rim.length < 3) {
      return;
    }
    const samples = buildRibbon(rim, frame.centre);
    if (samples.length < 3) {
      return;
    }
    const view = {
      normals: samples,
      tilt: frame.tilt
    };
    const spin = appearance.hueSpin * frame.elapsed;
    const colors = chromaRing(
      samples.length,
      appearance.hueDrift * frame.elapsed,
      appearance,
      view,
      spin
    );
    const w2 = appearance.outlineWidth;
    const bleed = Math.max(1, w2 * 0.4);
    const cells = (count2) => {
      const s2 = Math.max(2, Math.round(samples.length / count2));
      return s2 % 2 === 0 ? s2 : s2 + 1;
    };
    const fine = 2;
    const coarse = cells(12);
    const glow = appearance.glow;
    layers.halo.clear();
    layers.bloom.clear();
    if (glow > 0) {
      const reach = glowReach(glow);
      fillGlow(
        layers.halo,
        samples,
        frame.centre,
        colors,
        reach.halo,
        bleed,
        0.2,
        HALO_SHELL_CAP,
        coarse
      );
      fillGlow(
        layers.bloom,
        samples,
        frame.centre,
        colors,
        reach.bloom,
        bleed,
        0.4,
        BLOOM_SHELL_CAP,
        fine
      );
    }
    layers.body.clear();
    fillBody(layers.body, rim, appearance.bodyColor, appearance.bodyAlpha);
    layers.sheen.clear();
    const sheen = Math.min(1, Math.max(0, appearance.iridescence));
    if (sheen > 0) {
      fillSheen(
        layers.sheen,
        samples,
        frame.centre,
        chromaRing(
          samples.length,
          appearance.hueDrift * frame.elapsed * 0.6 + 140,
          appearance,
          {
            normals: samples,
            tilt: { x: -frame.tilt.y, y: frame.tilt.x }
          },
          spin
        ),
        sheen,
        cells(8)
      );
    }
    const glint = holoSpecular(samples.length, appearance, view);
    const coreColors = colors.map(
      (c2, i2) => lighten(c2, 0.3 + 0.45 * glint[i2])
    );
    layers.core.clear();
    fillBand(layers.core, samples, coreColors, w2 * 0.5, w2 * 0.5, 1, fine);
    const eyes = eyeLayout(frame, appearance);
    layers.eyes.clear();
    if (eyes.height > 0.5) {
      for (const eye of [eyes.left, eyes.right]) {
        layers.eyes.roundRect(
          eye.x - eyes.width / 2,
          eye.y - eyes.height / 2,
          eyes.width,
          eyes.height,
          Math.min(eyes.width, eyes.height) / 2
        );
      }
      layers.eyes.fill({ color: appearance.eyeColor, alpha: 1 });
    }
  }
  function openMioMenu(_pos) {
  }
  const STRETCH_FULL_SPEED = 1200;
  const BUMP_ZONE = 1.25;
  const HALF_PI = Math.PI / 2;
  const TAU = Math.PI * 2;
  const BLOB_AMPLITUDE = 0.05;
  function uprightPhase(angle) {
    return ((angle + HALF_PI) % TAU + TAU) % TAU;
  }
  function crest(cosine, power) {
    return Math.pow(0.5 + 0.5 * cosine, power);
  }
  function ghostDeviation(angle) {
    const under = Math.max(0, Math.sin(angle));
    const n2 = 2 + 3.2 * under;
    const c2 = Math.abs(Math.cos(angle));
    const s2 = Math.abs(Math.sin(angle));
    const square2 = 1 / Math.pow(Math.pow(c2, n2) + Math.pow(s2, n2), 1 / n2) - 1;
    const feet = -0.17 * Math.pow(under, 1.4) * Math.cos(6 * angle);
    return square2 + feet;
  }
  function potatoDeviation(angle) {
    return 0.16 * Math.cos(2 * angle + 0.9) + 0.095 * Math.cos(3 * angle - 2.1) + 0.036 * Math.cos(5 * angle + 1.3) + 0.019 * Math.cos(7 * angle - 0.4);
  }
  function starDeviation(phase) {
    return 0.58 * (crest(Math.cos(5 * phase), 3) - 0.3125);
  }
  function flowerDeviation(phase) {
    return 0.34 * (crest(Math.cos(6 * phase), 2) - 0.375);
  }
  function diamondDeviation(phase) {
    return 0.34 * (crest(Math.cos(4 * phase), 2) - 0.375);
  }
  function dropDeviation(phase) {
    return 0.72 * (Math.pow(Math.max(0, Math.cos(phase)), 8) - 0.1367);
  }
  function cloudDeviation(phase) {
    const up = Math.max(0, Math.cos(phase));
    const down = Math.max(0, -Math.cos(phase));
    return 0.34 * (Math.sqrt(up) * (0.5 + 0.5 * Math.cos(5 * phase)) - 0.7 * down * down - 0.0247);
  }
  function heartDeviation(phase) {
    const fold = phase > Math.PI ? TAU - phase : phase;
    const cleft = -0.34 * Math.pow(Math.max(0, Math.cos(phase)), 6);
    const lobes = 0.3 * Math.pow(Math.max(0, Math.cos(fold - 1)), 3);
    const tip = 0.34 * Math.pow(Math.max(0, -Math.cos(phase)), 8);
    return cleft + lobes + tip + 0.02;
  }
  function presetDeviation(angle, physics) {
    switch (physics.shapePreset) {
      case "circle":
        return 0;
      case "ghost":
        return ghostDeviation(angle);
      case "potato":
        return potatoDeviation(angle);
      case "star":
        return starDeviation(uprightPhase(angle));
      case "flower":
        return flowerDeviation(uprightPhase(angle));
      case "diamond":
        return diamondDeviation(uprightPhase(angle));
      case "drop":
        return dropDeviation(uprightPhase(angle));
      case "cloud":
        return cloudDeviation(uprightPhase(angle));
      case "heart":
        return heartDeviation(uprightPhase(angle));
      case "custom": {
        const lobes = Math.round(physics.shapeLobes);
        if (lobes < 2) {
          return 0;
        }
        return 1 / (1 + lobes * lobes) * Math.cos(lobes * angle);
      }
      default:
        return BLOB_AMPLITUDE * Math.cos(3 * (angle + HALF_PI));
    }
  }
  function presetRimPoints(physics) {
    switch (physics.shapePreset) {
      case "star":
        return 40;
      case "flower":
        return 36;
      case "heart":
      case "cloud":
        return 32;
      case "drop":
        return 28;
      case "ghost":
        return 26;
      case "potato":
      case "diamond":
        return 24;
      case "custom":
        return Math.max(12, Math.round(physics.shapeLobes) * 7);
      default:
        return 12;
    }
  }
  function shapeProfile(angle, physics) {
    if (physics.shapeAmount <= 0) {
      return 1;
    }
    const upright = angle - physics.shapeAngle * Math.PI / 180;
    return 1 + physics.shapeAmount * presetDeviation(upright, physics);
  }
  function createSoftBody(cx, cy, radius, count2, profile) {
    const n2 = Math.max(3, Math.round(count2));
    const rim = [];
    for (let i2 = 0; i2 < n2; i2++) {
      const angle = i2 / n2 * Math.PI * 2;
      const r2 = radius * (profile ? profile(angle) : 1);
      rim.push({
        angle,
        x: cx + Math.cos(angle) * r2,
        y: cy + Math.sin(angle) * r2,
        vx: 0,
        vy: 0
      });
    }
    return {
      core: { x: cx, y: cy, vx: 0, vy: 0 },
      rim,
      radius,
      profile,

      restArea: 0.5 * n2 * radius * radius * Math.sin(2 * Math.PI / n2),
      elapsed: 0,
      accumulator: 0
    };
  }
  function resampleBody(body, count2) {
    const n2 = Math.max(3, Math.round(count2));
    const old = body.rim;
    const from = old.length;
    if (n2 === from || from < 3) {
      return;
    }
    syncCore(body);
    const cx = body.core.x;
    const cy = body.core.y;
    const radius = (p2) => Math.hypot(p2.x - cx, p2.y - cy);
    const rim = new Array(n2);
    for (let i2 = 0; i2 < n2; i2++) {
      const u2 = i2 / n2 * from;
      const lo = Math.floor(u2);
      const t2 = u2 - lo;
      const a2 = old[lo % from];
      const b2 = old[(lo + 1) % from];
      let x2 = a2.x + (b2.x - a2.x) * t2;
      let y2 = a2.y + (b2.y - a2.y) * t2;
      const dist = Math.hypot(x2 - cx, y2 - cy);
      if (dist > 1e-6) {
        const want = radius(a2) + (radius(b2) - radius(a2)) * t2;
        x2 = cx + (x2 - cx) / dist * want;
        y2 = cy + (y2 - cy) / dist * want;
      }
      rim[i2] = {
        angle: i2 / n2 * TAU,
        x: x2,
        y: y2,
        vx: a2.vx + (b2.vx - a2.vx) * t2,
        vy: a2.vy + (b2.vy - a2.vy) * t2
      };
    }
    body.rim = rim;
    body.restArea = 0.5 * n2 * body.radius * body.radius * Math.sin(2 * Math.PI / n2);
    syncCore(body);
  }
  function polygonArea(rim) {
    let area2 = 0;
    for (let i2 = 0; i2 < rim.length; i2++) {
      const a2 = rim[i2];
      const b2 = rim[(i2 + 1) % rim.length];
      area2 += a2.x * b2.y - b2.x * a2.y;
    }
    return area2 / 2;
  }
  function syncCore(body) {
    let x2 = 0;
    let y2 = 0;
    let vx2 = 0;
    let vy2 = 0;
    for (const p2 of body.rim) {
      x2 += p2.x;
      y2 += p2.y;
      vx2 += p2.vx;
      vy2 += p2.vy;
    }
    const n2 = body.rim.length || 1;
    body.core.x = x2 / n2;
    body.core.y = y2 / n2;
    body.core.vx = vx2 / n2;
    body.core.vy = vy2 / n2;
  }
  function translateBody(body, x2, y2) {
    syncCore(body);
    const dx = x2 - body.core.x;
    const dy = y2 - body.core.y;
    for (const p2 of body.rim) {
      p2.x += dx;
      p2.y += dy;
    }
    syncCore(body);
  }
  function addVelocity(body, vx2, vy2) {
    for (const p2 of body.rim) {
      p2.vx += vx2;
      p2.vy += vy2;
    }
    syncCore(body);
  }
  function resetBody(body, x2, y2) {
    const n2 = body.rim.length;
    for (let i2 = 0; i2 < n2; i2++) {
      const p2 = body.rim[i2];
      const r2 = body.radius * (body.profile ? body.profile(p2.angle) : 1);
      p2.x = x2 + Math.cos(p2.angle) * r2;
      p2.y = y2 + Math.sin(p2.angle) * r2;
      p2.vx = 0;
      p2.vy = 0;
    }
    body.accumulator = 0;
    syncCore(body);
  }
  function stepSoftBody(body, frameSeconds, input) {
    const { physics } = input;
    const dt = physics.subStep;
    const safe = Number.isFinite(frameSeconds) ? frameSeconds : 0;
    const frame = Math.min(Math.max(safe, 0), dt * physics.maxSubSteps);
    body.accumulator += frame;
    let steps = 0;
    while (body.accumulator >= dt && steps < physics.maxSubSteps) {
      body.accumulator -= dt;
      steps++;
      substep(body, dt, input);
    }
    if (body.accumulator > dt * physics.maxSubSteps) {
      body.accumulator = 0;
    }
    syncCore(body);
  }
  function substep(body, dt, input) {
    const { physics, obstacles, bounds, dragTarget } = input;
    const rim = body.rim;
    const n2 = rim.length;
    body.elapsed += dt;
    syncCore(body);
    const centre = body.core;
    const pull = input.magnet;
    const strength = pull ? Math.min(1, Math.max(0, pull.strength)) : 0;
    const float = 1 - strength;
    const wobbleFade = input.dragTarget ? 0 : float;
    const ix = new Float64Array(n2);
    const iy = new Float64Array(n2);
    const restR = new Float64Array(n2);
    const shape = body.profile;
    for (let i2 = 0; i2 < n2; i2++) {
      const a2 = rim[i2].angle;
      restR[i2] = body.radius * (shape ? shape(a2) : shapeProfile(a2, physics));
    }
    const wobble = physics.idleWobble * wobbleFade;
    if (wobble > 0) {
      const t2 = physics.idleWobbleSpeed * body.elapsed;
      for (let i2 = 0; i2 < n2; i2++) {
        const a2 = rim[i2].angle;
        const breathe = 0.55 * Math.sin(2 * a2 + t2) + 0.3 * Math.sin(3 * a2 - t2 * 1.37 + 2.1) + 0.15 * Math.sin(5 * a2 + t2 * 0.71 + 4.2);
        restR[i2] *= 1 + wobble * breathe;
      }
    }
    if (physics.speedStretch > 0) {
      const speed = Math.hypot(centre.vx, centre.vy);
      if (speed > 1) {
        const amount = physics.speedStretch * Math.min(1, speed / STRETCH_FULL_SPEED);
        const k2 = 1 + amount;
        const kk = k2 * k2;
        const dirX = centre.vx / speed;
        const dirY = centre.vy / speed;
        for (let i2 = 0; i2 < n2; i2++) {
          const angle = rim[i2].angle;
          const a2 = Math.cos(angle) * dirX + Math.sin(angle) * dirY;
          const aa = a2 * a2;
          restR[i2] /= Math.sqrt(aa / kk + kk * (1 - aa));
        }
      }
    }
    let targetArea = 0;
    for (let i2 = 0; i2 < n2; i2++) {
      targetArea += restR[i2] * restR[(i2 + 1) % n2];
    }
    targetArea *= 0.5 * Math.sin(2 * Math.PI / n2);
    if (physics.radialStiffness > 0) {
      for (let i2 = 0; i2 < n2; i2++) {
        const p2 = rim[i2];
        let dx = p2.x - centre.x;
        let dy = p2.y - centre.y;
        let len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          dx = Math.cos(p2.angle);
          dy = Math.sin(p2.angle);
          len = 1;
        }
        const f2 = physics.radialStiffness * (len - restR[i2]);
        ix[i2] -= f2 * dx / len;
        iy[i2] -= f2 * dy / len;
      }
    }
    applyRingSprings(
      rim,
      ix,
      iy,
      1,
      restR,
      Math.sin(Math.PI / n2),
      physics.edgeStiffness
    );
    if (n2 > 4 && physics.bendStiffness > 0) {
      applyRingSprings(
        rim,
        ix,
        iy,
        2,
        restR,
        Math.sin(2 * Math.PI / n2),
        physics.bendStiffness
      );
    }
    if (physics.pressure > 0) {
      const signed = polygonArea(rim);
      const area2 = Math.abs(signed);
      const deficit = Math.min(
        2,
        Math.max(-1, targetArea / Math.max(area2, 1e-3) - 1)
      );
      if (deficit !== 0) {
        const wind = signed < 0 ? -1 : 1;
        const nominalEdge = 2 * body.radius * Math.sin(Math.PI / n2);
        const push = physics.pressure * deficit * wind / (2 * nominalEdge);
        for (let i2 = 0; i2 < n2; i2++) {
          const a2 = rim[i2];
          const b2 = rim[(i2 + 1) % n2];
          const dx = b2.x - a2.x;
          const dy = b2.y - a2.y;
          const fx = dy * push;
          const fy = -dx * push;
          ix[i2] += fx;
          iy[i2] += fy;
          ix[(i2 + 1) % n2] += fx;
          iy[(i2 + 1) % n2] += fy;
        }
      }
    }
    let meanIx = 0;
    let meanIy = 0;
    for (let i2 = 0; i2 < n2; i2++) {
      meanIx += ix[i2];
      meanIy += iy[i2];
    }
    meanIx /= n2;
    meanIy /= n2;
    const w2 = physics.floatSpeed;
    const bobA = -physics.floatAmplitude * w2 * w2 * Math.sin(w2 * body.elapsed);
    const swayA = -0.17 * physics.floatAmplitude * w2 * w2 * Math.sin(w2 * 0.7 * body.elapsed + 1.1);
    let extX = float * swayA;
    let extY = float * bobA;
    if (pull) {
      const restGap = -body.radius * physics.magnetGrip;
      const soft = Math.max(1, body.radius * 0.35);
      const offset2 = Math.min(1, Math.max(-1, (pull.gap - restGap) / soft));
      const magnet = physics.magnetStrength * strength * offset2;
      extX += pull.dx * magnet;
      extY += pull.dy * magnet;
      const hold = physics.magnetDamping * strength;
      extX -= centre.vx * hold;
      extY -= centre.vy * hold;
    }
    if (dragTarget) {
      const r2 = body.radius;
      const tx = clamp$1(dragTarget.x, r2, Math.max(r2, bounds.width - r2));
      const ty = clamp$1(dragTarget.y, r2, Math.max(r2, bounds.height - r2));
      const k2 = physics.dragStiffness;
      const c2 = 2 * Math.sqrt(k2);
      let dragX = (tx - centre.x) * k2 - centre.vx * c2;
      let dragY = (ty - centre.y) * k2 - centre.vy * c2;
      const magnitude = Math.hypot(dragX, dragY);
      if (magnitude > physics.dragMaxAccel) {
        const scale = physics.dragMaxAccel / magnitude;
        dragX *= scale;
        dragY *= scale;
      }
      extX += dragX;
      extY += dragY;
    }
    const internalDamp = 1 + physics.damping * dt;
    const airDamp = 1 + physics.airDamping * dt;
    const meanVx = centre.vx;
    const meanVy = centre.vy;
    for (let i2 = 0; i2 < n2; i2++) {
      const p2 = rim[i2];
      let vx2 = p2.vx + (ix[i2] - meanIx + extX) * dt;
      let vy2 = p2.vy + (iy[i2] - meanIy + extY) * dt;
      vx2 = meanVx + (vx2 - meanVx) / internalDamp;
      vy2 = meanVy + (vy2 - meanVy) / internalDamp;
      p2.vx = vx2 / airDamp;
      p2.vy = vy2 / airDamp;
      p2.x += p2.vx * dt;
      p2.y += p2.vy * dt;
    }
    const contacting = new Uint8Array(n2);
    const contactPass = () => {
      for (let i2 = 0; i2 < n2; i2++) {
        const hit = resolveObstacleCollisions(
          rim[i2],
          obstacles,
          physics.restitution,
          physics.friction
        );
        const clamped = clampToBounds(
          rim[i2],
          bounds.width,
          bounds.height,
          physics.restitution,
          physics.friction
        );
        contacting[i2] = hit || clamped ? 1 : 0;
      }
    };
    const solverPasses = Math.max(1, physics.limitIterations);
    for (let pass = 0; pass < solverPasses; pass++) {
      contactPass();
      if (physics.limitIterations > 0) {
        enforceLimits(body, restR, physics);
      }
      enforceAngularOrder(body, physics.minAngularGap);
    }
    if (physics.limitIterations > 0) {
      contactPass();
      enforceLimits(body, restR, physics, contacting);
    }
    enforceAngularOrder(body, physics.minAngularGap);
  }
  function clamp$1(v2, lo, hi) {
    return Math.min(Math.max(v2, lo), Math.max(lo, hi));
  }
  function enforceAngularOrder(body, minGapFraction) {
    const rim = body.rim;
    const n2 = rim.length;
    if (n2 < 3 || minGapFraction <= 0 || minGapFraction >= 1) {
      return;
    }
    syncCore(body);
    const cx = body.core.x;
    const cy = body.core.y;
    const even = 2 * Math.PI / n2;
    const minGap = even * minGapFraction;
    const angle = new Float64Array(n2);
    const gap = new Float64Array(n2);
    for (let i2 = 0; i2 < n2; i2++) {
      angle[i2] = Math.atan2(rim[i2].y - cy, rim[i2].x - cx);
    }
    let total = 0;
    let healthy = true;
    for (let i2 = 0; i2 < n2; i2++) {
      let g2 = angle[(i2 + 1) % n2] - angle[i2];
      while (g2 <= -Math.PI) {
        g2 += 2 * Math.PI;
      }
      while (g2 > Math.PI) {
        g2 -= 2 * Math.PI;
      }
      gap[i2] = g2;
      total += g2;
      if (g2 < minGap) {
        healthy = false;
      }
    }
    if (healthy && Math.abs(total - 2 * Math.PI) < 1e-6) {
      return;
    }
    const slackBudget = 2 * Math.PI - n2 * minGap;
    let slackTotal = 0;
    for (let i2 = 0; i2 < n2; i2++) {
      const clamped = Math.max(gap[i2], minGap);
      gap[i2] = clamped;
      slackTotal += clamped - minGap;
    }
    if (slackTotal > 1e-9) {
      const scale = slackBudget / slackTotal;
      for (let i2 = 0; i2 < n2; i2++) {
        gap[i2] = minGap + (gap[i2] - minGap) * scale;
      }
    } else {
      gap.fill(even);
    }
    const target = new Float64Array(n2);
    target[0] = angle[0];
    for (let i2 = 1; i2 < n2; i2++) {
      target[i2] = target[i2 - 1] + gap[i2 - 1];
    }
    let drift = 0;
    for (let i2 = 0; i2 < n2; i2++) {
      let d2 = target[i2] - angle[i2];
      while (d2 <= -Math.PI) {
        d2 += 2 * Math.PI;
      }
      while (d2 > Math.PI) {
        d2 -= 2 * Math.PI;
      }
      drift += d2;
    }
    drift /= n2;
    for (let i2 = 0; i2 < n2; i2++) {
      let delta = target[i2] - drift - angle[i2];
      while (delta <= -Math.PI) {
        delta += 2 * Math.PI;
      }
      while (delta > Math.PI) {
        delta -= 2 * Math.PI;
      }
      if (delta !== 0) {
        rotateAbout(rim[i2], cx, cy, delta);
      }
    }
  }
  function rotateAbout(p2, cx, cy, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = p2.x - cx;
    const dy = p2.y - cy;
    p2.x = cx + dx * cos - dy * sin;
    p2.y = cy + dx * sin + dy * cos;
    const vx2 = p2.vx;
    const vy2 = p2.vy;
    p2.vx = vx2 * cos - vy2 * sin;
    p2.vy = vx2 * sin + vy2 * cos;
  }
  function limitDistance(a2, b2, minLen, maxLen) {
    const dx = b2.x - a2.x;
    const dy = b2.y - a2.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      return false;
    }
    let target = 0;
    if (len > maxLen) {
      target = maxLen;
    } else if (len < minLen) {
      target = minLen;
    } else {
      return false;
    }
    const nx = dx / len;
    const ny = dy / len;
    const shift = (len - target) * 0.5;
    a2.x += nx * shift;
    a2.y += ny * shift;
    b2.x -= nx * shift;
    b2.y -= ny * shift;
    const relative = (b2.vx - a2.vx) * nx + (b2.vy - a2.vy) * ny;
    const feeding = target === maxLen ? relative > 0 : relative < 0;
    if (feeding) {
      const half = relative * 0.5;
      a2.vx += nx * half;
      a2.vy += ny * half;
      b2.vx -= nx * half;
      b2.vy -= ny * half;
    }
    return true;
  }
  function enforceLimits(body, restR, physics, pinned = null) {
    const rim = body.rim;
    const n2 = rim.length;
    const chord = Math.sin(Math.PI / n2);
    const min = physics.minStretch;
    const max = physics.maxStretch;
    for (let i2 = 0; i2 < n2; i2++) {
      const j2 = (i2 + 1) % n2;
      if (pinned && (pinned[i2] || pinned[j2])) {
        continue;
      }
      const rest = (restR[i2] + restR[j2]) * chord;
      limitDistance(rim[i2], rim[j2], rest * min, rest * max);
    }
    syncCore(body);
    const cx = body.core.x;
    const cy = body.core.y;
    let shiftX = 0;
    let shiftY = 0;
    let touched = false;
    for (let i2 = 0; i2 < n2; i2++) {
      if (pinned && pinned[i2]) {
        continue;
      }
      const p2 = rim[i2];
      const dx = p2.x - cx;
      const dy = p2.y - cy;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        continue;
      }
      const lo = restR[i2] * min;
      const hi = restR[i2] * max;
      const ux2 = dx / len;
      const uy2 = dy / len;
      const radial = p2.vx * ux2 + p2.vy * uy2;
      const zoneLo = lo * BUMP_ZONE;
      const zoneHi = hi / BUMP_ZONE;
      if (len < zoneLo && radial < 0 && zoneLo > lo) {
        const t2 = Math.min(1, (zoneLo - len) / (zoneLo - lo));
        p2.vx -= ux2 * radial * t2;
        p2.vy -= uy2 * radial * t2;
      } else if (len > zoneHi && radial > 0 && hi > zoneHi) {
        const t2 = Math.min(1, (len - zoneHi) / (hi - zoneHi));
        p2.vx -= ux2 * radial * t2;
        p2.vy -= uy2 * radial * t2;
      }
      let target = 0;
      if (len < lo) {
        target = lo;
      } else if (len > hi) {
        target = hi;
      } else {
        continue;
      }
      const scale = target / len;
      const nx = dx * (scale - 1);
      const ny = dy * (scale - 1);
      p2.x += nx;
      p2.y += ny;
      shiftX += nx;
      shiftY += ny;
      touched = true;
      const after = p2.vx * ux2 + p2.vy * uy2;
      if (target === lo ? after < 0 : after > 0) {
        p2.vx -= ux2 * after;
        p2.vy -= uy2 * after;
      }
    }
    if (touched) {
      let movable = n2;
      if (pinned) {
        movable = 0;
        for (let i2 = 0; i2 < n2; i2++) {
          if (!pinned[i2]) {
            movable++;
          }
        }
      }
      if (movable > 0) {
        const meanX = shiftX / movable;
        const meanY = shiftY / movable;
        for (let i2 = 0; i2 < n2; i2++) {
          if (pinned && pinned[i2]) {
            continue;
          }
          rim[i2].x -= meanX;
          rim[i2].y -= meanY;
        }
      }
    }
    syncCore(body);
  }
  function applyRingSprings(rim, ax, ay, stride, restR, chordFactor, stiffness) {
    if (stiffness <= 0) {
      return;
    }
    const n2 = rim.length;
    for (let i2 = 0; i2 < n2; i2++) {
      const j2 = (i2 + stride) % n2;
      const a2 = rim[i2];
      const b2 = rim[j2];
      const dx = b2.x - a2.x;
      const dy = b2.y - a2.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        continue;
      }
      const rest = (restR[i2] + restR[j2]) * chordFactor;
      const f2 = stiffness * (len - rest) / 2;
      const nx = dx / len;
      const ny = dy / len;
      ax[i2] += f2 * nx;
      ay[i2] += f2 * ny;
      ax[j2] -= f2 * nx;
      ay[j2] -= f2 * ny;
    }
  }
  const SURFACE_REFRESH_MS = 50;
  const BLINK_MIN_GAP = 2.6;
  const BLINK_MAX_EXTRA = 4.5;
  const BLINK_DURATION = 0.14;
  const HANDLE_SCALE = 2.1;
  const AMBIENT_RAKE_RATE = 0.42;
  const FULL_RAKE_SPEED = 900;
  const MORPH_SECONDS = 2.6;
  const MAX_RIM_POINTS = 64;
  const SHUFFLE_SHAPES = [
    "circle",
    "blob",
    "ghost",
    "potato",
    "star",
    "flower",
    "heart",
    "diamond",
    "drop",
    "cloud"
  ];
  const IDLE_RAKE = 0.62;
  const TRAPPED_DWELL_S = 0.22;
  async function mountMio(options) {
    const api2 = window.wp?.os;
    if (api2?.loadModules) {
      try {
        await api2.loadModules(["pixijs"]);
      } catch (err) {
        console.warn("[desktop-mode/mio] PixiJS failed to load.", err);
        return null;
      }
    }
    const pixi = window.PIXI;
    if (!pixi) {
      console.warn(
        "[desktop-mode/mio] window.PIXI is undefined; cannot mount."
      );
      return null;
    }
    const { host, savePosition } = options;
    const app = new pixi.Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    if (!host.isConnected) {
      app.destroy({ removeView: true }, { children: true, texture: true });
      return null;
    }
    let requested = options.config;
    let config = calmed(requested);
    const canvas = app.canvas;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);
    const layers = buildLayers(pixi, app, config);
    const originOf = () => {
      const r2 = host.getBoundingClientRect();
      return { left: r2.left, top: r2.top };
    };
    let origin = originOf();
    const size = () => ({
      width: host.clientWidth || 1,
      height: host.clientHeight || 1
    });
    const start2 = options.position ? { x: options.position.x - origin.left, y: options.position.y - origin.top } : defaultStart(size(), config.appearance.radius);
    let morphFrom = null;
    let morphAt = 0;
    let nextShuffle = shuffleDelay(config.physics.shapeShuffle);
    let shape = config.physics.shapePreset;
    const profile = (angle) => {
      const to = shapeProfile(angle, { ...config.physics, shapePreset: shape });
      if (!morphFrom) {
        return to;
      }
      const from = shapeProfile(angle, {
        ...config.physics,
        shapePreset: morphFrom
      });
      return from + (to - from) * smoothstep(morphAt / MORPH_SECONDS);
    };
    const neededPoints = () => Math.min(
      MAX_RIM_POINTS,
      Math.max(
        config.physics.points,
        presetRimPoints({ ...config.physics, shapePreset: shape }),
        morphFrom ? presetRimPoints({ ...config.physics, shapePreset: morphFrom }) : 0
      )
    );
    const retargetShape = (next) => {
      if (next === shape) {
        return;
      }
      morphFrom = shape;
      morphAt = 0;
      shape = next;
      nextShuffle = shuffleDelay(config.physics.shapeShuffle);
      doAction("os.mio.shape-changed", { shape, from: morphFrom });
    };
    const updateShape = (seconds) => {
      if (morphFrom) {
        morphAt += seconds;
        if (morphAt >= MORPH_SECONDS) {
          morphFrom = null;
          morphAt = 0;
        }
      }
      const every = config.physics.shapeShuffle;
      if (every <= 0) {
        retargetShape(config.physics.shapePreset);
        nextShuffle = 0;
        return;
      }
      nextShuffle -= seconds;
      if (nextShuffle > 0 || morphFrom) {
        return;
      }
      const next = pickShape(shape);
      nextShuffle = shuffleDelay(every);
      if (next === shape) {
        return;
      }
      morphFrom = shape;
      morphAt = 0;
      shape = next;
      doAction("os.mio.shape-changed", { shape, from: morphFrom });
    };
    let body = createSoftBody(
      clamp(start2.x, config.appearance.radius, size().width - config.appearance.radius),
      clamp(start2.y, config.appearance.radius, size().height - config.appearance.radius),
      config.appearance.radius,
      neededPoints(),
      profile
    );
    const syncResolution = () => {
      const want = neededPoints();
      if (want !== body.rim.length) {
        resampleBody(body, want);
      }
    };
    const handle2 = document.createElement("div");
    handle2.className = "os-mio__handle";
    handle2.setAttribute("aria-hidden", "true");
    sizeHandle(handle2, config);
    host.appendChild(handle2);
    const pointer = createPointerTracker();
    const desk = createObstacleTrack(SURFACE_REFRESH_MS);
    let obstacles = [];
    let lastSurfaceRead = 0;
    let animating = true;
    let destroyed = false;
    let elapsed = 0;
    let nextBlinkAt = BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
    let blinkStartedAt = -1;
    let dragging = false;
    let trappedFor = 0;
    let dragPointerId = null;
    let dragTarget = null;
    let dragGrab = { x: 0, y: 0 };
    let tiltAngle = 0;
    let tilt = { x: 1, y: 0 };
    let reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let driftVx = 0;
    let driftVy = 0;
    let lastCore = { x: body.core.x, y: body.core.y };
    const forgetMotion = () => {
      lastCore = { x: body.core.x, y: body.core.y };
    };
    const updateTilt = (seconds) => {
      if (seconds > 0) {
        const vx2 = (body.core.x - lastCore.x) / seconds;
        const vy2 = (body.core.y - lastCore.y) / seconds;
        const blend = Math.min(1, seconds * 6);
        driftVx += (vx2 - driftVx) * blend;
        driftVy += (vy2 - driftVy) * blend;
      }
      forgetMotion();
      if (!reducedMotion) {
        tiltAngle += seconds * AMBIENT_RAKE_RATE;
      }
      let x2 = Math.cos(tiltAngle);
      let y2 = Math.sin(tiltAngle);
      const speed = Math.hypot(driftVx, driftVy);
      const lead = Math.min(1, speed / FULL_RAKE_SPEED);
      if (speed > 1) {
        x2 = x2 * (1 - lead) + driftVx / speed * lead;
        y2 = y2 * (1 - lead) + driftVy / speed * lead;
      }
      const len = Math.hypot(x2, y2) || 1;
      const strength = IDLE_RAKE + (1 - IDLE_RAKE) * lead;
      tilt = { x: x2 / len * strength, y: y2 / len * strength };
    };
    const readSurfaces = (nowMs2) => {
      if (nowMs2 - lastSurfaceRead >= SURFACE_REFRESH_MS) {
        lastSurfaceRead = nowMs2;
        origin = originOf();
        const surfaces = window.wp?.os?.getWallpaperSurfaces?.();
        desk.sample(
          Array.isArray(surfaces) ? collectObstacles(surfaces, origin, size()) : [],
          nowMs2
        );
      }
      obstacles = desk.at(nowMs2);
    };
    const toLayer = (p2) => ({
      x: p2.x - origin.left,
      y: p2.y - origin.top
    });
    const toViewport = () => ({
      x: body.core.x + origin.left,
      y: body.core.y + origin.top
    });
    let flickVx = 0;
    let flickVy = 0;
    let lastDragAt = 0;
    let lastDragPoint = null;
    const nowMs = () => typeof performance !== "undefined" ? performance.now() : elapsed * 1e3;
    const clampTarget = (p2) => {
      const bounds = size();
      const r2 = body.radius;
      const clear = clampOutsideChrome(p2, r2, obstacles);
      return {
        x: clamp(clear.x, r2, Math.max(r2, bounds.width - r2)),
        y: clamp(clear.y, r2, Math.max(r2, bounds.height - r2))
      };
    };
    const onHandleDown = (e2) => {
      if (dragging || e2.button !== 0) {
        return;
      }
      dragging = true;
      dragPointerId = e2.pointerId;
      const local = toLayer({ x: e2.clientX, y: e2.clientY });
      dragGrab = { x: body.core.x - local.x, y: body.core.y - local.y };
      dragTarget = { x: body.core.x, y: body.core.y };
      flickVx = 0;
      flickVy = 0;
      lastDragAt = nowMs();
      lastDragPoint = { x: local.x, y: local.y };
      handle2.classList.add("is-dragging");
      try {
        handle2.setPointerCapture(e2.pointerId);
      } catch {
      }
      e2.preventDefault();
      doAction("os.mio.grabbed", { position: toViewport() });
    };
    const onDragMove = (e2) => {
      if (!dragging || e2.pointerId !== dragPointerId) {
        return;
      }
      const local = toLayer({ x: e2.clientX, y: e2.clientY });
      dragTarget = clampTarget({
        x: local.x + dragGrab.x,
        y: local.y + dragGrab.y
      });
      const at = nowMs();
      const dt = (at - lastDragAt) / 1e3;
      if (lastDragPoint && dt > 1e-3) {
        const vx2 = (local.x - lastDragPoint.x) / dt;
        const vy2 = (local.y - lastDragPoint.y) / dt;
        const blend = Math.min(1, dt * 12);
        flickVx += (vx2 - flickVx) * blend;
        flickVy += (vy2 - flickVy) * blend;
      }
      lastDragAt = at;
      lastDragPoint = local;
    };
    const finishDrag = (throwIt) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      const pointerId = dragPointerId;
      dragPointerId = null;
      dragTarget = null;
      lastDragPoint = null;
      handle2.classList.remove("is-dragging");
      if (pointerId !== null) {
        try {
          handle2.releasePointerCapture(pointerId);
        } catch {
        }
      }
      if (throwIt) {
        const boost = config.physics.throwBoost;
        const maxSpeed = 4e3;
        const speed = Math.hypot(flickVx, flickVy);
        const scale = speed > maxSpeed ? maxSpeed / speed * boost : boost;
        addVelocity(body, flickVx * scale, flickVy * scale);
      }
      flickVx = 0;
      flickVy = 0;
      const dropped = toViewport();
      savePosition(dropped);
      doAction("os.mio.dropped", { position: dropped });
    };
    const onDragEnd = (e2) => {
      if (!dragging || e2.pointerId !== dragPointerId) {
        return;
      }
      finishDrag(true);
    };
    const onDragCancel = (e2) => {
      if (!dragging || e2.pointerId !== dragPointerId) {
        return;
      }
      finishDrag(false);
    };
    const onLostCapture = () => finishDrag(true);
    const onWindowBlur = () => finishDrag(false);
    const onHandleContextMenu = (e2) => {
      e2.preventDefault();
      e2.stopPropagation();
      openMioMenu({ x: e2.clientX, y: e2.clientY });
    };
    handle2.addEventListener("pointerdown", onHandleDown);
    handle2.addEventListener("contextmenu", onHandleContextMenu);
    handle2.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onDragCancel, true);
    window.addEventListener("blur", onWindowBlur);
    const tick = () => {
      if (destroyed || !animating) {
        return;
      }
      const dtMs = app.ticker.deltaMS;
      const seconds = Math.min(dtMs, 100) / 1e3;
      elapsed += seconds;
      readSurfaces(
        typeof performance !== "undefined" ? performance.now() : elapsed * 1e3
      );
      const bounds = size();
      if (!dragging) {
        const escape = findEscape(
          body.core.x,
          body.core.y,
          body.radius,
          obstacles,
          bounds
        );
        if (escape) {
          trappedFor += seconds;
          if (trappedFor >= TRAPPED_DWELL_S) {
            trappedFor = 0;
            resetBody(body, escape.x, escape.y);
            forgetMotion();
            savePosition(toViewport());
            doAction("os.mio.displaced", {
              position: toViewport()
            });
          }
        } else {
          trappedFor = 0;
        }
      } else {
        trappedFor = 0;
      }
      const magnet = dragging ? null : magnetPull(
        body.core.x,
        body.core.y,
        body.radius,
        obstacles,
        config.physics.magnetRange
      );
      stepSoftBody(body, seconds, {
        physics: config.physics,
        magnet,

        obstacles,
        bounds,
        dragTarget
      });
      updateTilt(seconds);
      updateShape(seconds);
      syncResolution();
      if (blinkStartedAt < 0 && elapsed >= nextBlinkAt) {
        blinkStartedAt = elapsed;
      }
      let blink = 0;
      if (blinkStartedAt >= 0) {
        const t2 = (elapsed - blinkStartedAt) / BLINK_DURATION;
        if (t2 >= 1) {
          blinkStartedAt = -1;
          nextBlinkAt = elapsed + BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
        } else {
          blink = Math.sin(t2 * Math.PI);
        }
      }
      const cursor = pointer.get();
      drawMio(
        layers,
        {
          rim: body.rim,
          centre: body.core,
          radius: body.radius,
          elapsed,
          gaze: cursor ? toLayer(cursor) : null,
          blink,
          tilt
        },
        config.appearance
      );
      const half = body.radius * HANDLE_SCALE / 2;
      handle2.style.transform = `translate3d(${body.core.x - half}px, ${body.core.y - half}px, 0)`;
    };
    app.ticker.add(tick);
    const resizeObserver = new ResizeObserver(() => {
      if (destroyed) {
        return;
      }
      if (!host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) {
        return;
      }
      const { width, height } = size();
      app.renderer.resize(width, height);
      origin = originOf();
      desk.reset();
      const r2 = body.radius;
      const x2 = clamp(body.core.x, r2, Math.max(r2, width - r2));
      const y2 = clamp(body.core.y, r2, Math.max(r2, height - r2));
      if (x2 !== body.core.x || y2 !== body.core.y) {
        translateBody(body, x2, y2);
        forgetMotion();
      }
    });
    resizeObserver.observe(host);
    const onVisibility = () => {
      setAnimating(!document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const onMotionChange = () => {
      reducedMotion = motionQuery?.matches === true;
      config = calmed(requested);
    };
    motionQuery?.addEventListener?.("change", onMotionChange);
    function setAnimating(next) {
      if (destroyed || animating === next) {
        return;
      }
      animating = next;
      if (next) {
        body.accumulator = 0;
        app.ticker.start();
      } else {
        app.ticker.stop();
      }
    }
    doAction("os.mio.mounted", { position: toViewport() });
    return {
      getPosition: () => toViewport(),
      setPosition: (x2, y2) => {
        const bounds = size();
        const r2 = body.radius;
        translateBody(
          body,
          clamp(x2 - origin.left, r2, Math.max(r2, bounds.width - r2)),
          clamp(y2 - origin.top, r2, Math.max(r2, bounds.height - r2))
        );
        forgetMotion();
        savePosition(toViewport());
      },
      setAnimating,
      applyConfig: (next) => {
        requested = next;
        const calm = calmed(next);
        const rebuild = calm.physics.points !== config.physics.points || calm.appearance.radius !== config.appearance.radius;
        const pickedShape = calm.physics.shapePreset !== config.physics.shapePreset ? calm.physics.shapePreset : null;
        config = calm;
        if (pickedShape) {
          retargetShape(pickedShape);
        }
        applyGlow(pixi, layers, config);
        applySheenBlur(pixi, layers, config);
        sizeHandle(handle2, config);
        if (rebuild) {
          const at = { x: body.core.x, y: body.core.y };
          body = createSoftBody(
            at.x,
            at.y,
            config.appearance.radius,
            neededPoints(),
            profile
          );
          forgetMotion();
        } else {
          syncResolution();
        }
      },
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        if (host.isConnected) {
          savePosition(toViewport());
        }
        app.ticker.remove(tick);
        resizeObserver.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        motionQuery?.removeEventListener?.("change", onMotionChange);
        handle2.removeEventListener("pointerdown", onHandleDown);
        handle2.removeEventListener("contextmenu", onHandleContextMenu);
        handle2.removeEventListener("lostpointercapture", onLostCapture);
        window.removeEventListener("pointermove", onDragMove, true);
        window.removeEventListener("pointerup", onDragEnd, true);
        window.removeEventListener("pointercancel", onDragCancel, true);
        window.removeEventListener("blur", onWindowBlur);
        handle2.remove();
        pointer.destroy();
        app.destroy({ removeView: true }, { children: true, texture: true });
        doAction("os.mio.unmounted", {});
      }
    };
  }
  function calmed(config) {
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      return config;
    }
    return {

      appearance: { ...config.appearance, hueDrift: 0, hueSpin: 0 },

      physics: { ...config.physics, floatAmplitude: 0, shapeShuffle: 0 }
    };
  }
  function buildLayers(pixi, app, config) {
    const root = new pixi.Container();
    const halo = new pixi.Graphics();
    const bloom = new pixi.Graphics();
    const body = new pixi.Graphics();
    const sheen = new pixi.Graphics();
    const core = new pixi.Graphics();
    const eyes = new pixi.Graphics();
    halo.blendMode = "add";
    bloom.blendMode = "add";
    sheen.blendMode = "add";
    root.addChild(halo);
    root.addChild(bloom);
    root.addChild(body);
    root.addChild(sheen);
    root.addChild(core);
    root.addChild(eyes);
    app.stage.addChild(root);
    const layers = { root, halo, bloom, body, sheen, core, eyes };
    applyGlow(pixi, layers, config);
    applySheenBlur(pixi, layers, config);
    return layers;
  }
  const GLOW_BLEND = "add";
  function applyGlow(pixi, layers, config) {
    const want = config.appearance.glowBlur && config.appearance.glow > 0;
    if (!want || typeof pixi.BlurFilter !== "function") {
      layers.halo.filters = [];
      layers.bloom.filters = [];
      return;
    }
    const strength = glowBlurStrength(
      config.appearance.radius,
      config.appearance.glow
    );
    for (const [layer2, blur] of [
      [layers.halo, strength.halo],
      [layers.bloom, strength.bloom]
    ]) {
      try {
        layer2.filters = [
          new pixi.BlurFilter({
            strength: blur,
            quality: 2,

            blendMode: GLOW_BLEND
          })
        ];
      } catch {
        layer2.filters = [];
      }
    }
  }
  function applySheenBlur(pixi, layers, config) {
    const want = config.appearance.iridescence > 0;
    if (!want || typeof pixi.BlurFilter !== "function") {
      layers.sheen.filters = [];
      return;
    }
    try {
      layers.sheen.filters = [
        new pixi.BlurFilter({
          strength: Math.min(
            24,
            Math.max(3, config.appearance.radius * 0.12)
          ),
          quality: 2,

          blendMode: GLOW_BLEND
        })
      ];
    } catch {
      layers.sheen.filters = [];
    }
  }
  function sizeHandle(handle2, config) {
    const px = `${config.appearance.radius * HANDLE_SCALE}px`;
    handle2.style.width = px;
    handle2.style.height = px;
  }
  function defaultStart(bounds, radius) {
    return {
      x: clamp(bounds.width * 0.22, radius, bounds.width - radius),
      y: clamp(bounds.height * 0.62, radius, bounds.height - radius)
    };
  }
  function clamp(v2, lo, hi) {
    return Math.min(Math.max(v2, lo), Math.max(lo, hi));
  }
  function smoothstep(t2) {
    const x2 = Math.min(1, Math.max(0, t2));
    return x2 * x2 * (3 - 2 * x2);
  }
  function shuffleDelay(every) {
    return every > 0 ? every * (0.75 + Math.random() * 0.5) : 0;
  }
  function pickShape(current) {
    const options = SHUFFLE_SHAPES.filter((s2) => s2 !== current);
    return options[Math.floor(Math.random() * options.length)] ?? current;
  }
  let selector = null;
  let installed = false;
  function contentBox(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const style = window.getComputedStyle(el);
    const num = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const left = num(style.borderLeftWidth) + num(style.paddingLeft);
    const right = num(style.borderRightWidth) + num(style.paddingRight);
    const top = num(style.borderTopWidth) + num(style.paddingTop);
    const bottom = num(style.borderBottomWidth) + num(style.paddingBottom);
    const width = rect.width - left - right;
    const height = rect.height - top - bottom;
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { x: rect.left + left, y: rect.top + top, width, height };
  }
  function collect() {
    if (!selector) {
      return [];
    }
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return [];
    }
    const out2 = [];
    const viewportHeight = window.innerHeight || 0;
    const viewportWidth = window.innerWidth || 0;
    let index = 0;
    for (const el of Array.from(matches)) {
      const rect = contentBox(el);
      index++;
      if (!rect) {
        continue;
      }
      if (rect.y > viewportHeight || rect.y + rect.height < 0 || rect.x > viewportWidth || rect.x + rect.width < 0) {
        continue;
      }
      out2.push({
        id: `mio-marker:${index}`,

        kind: "window",
        rect,

        face: "top",
        element: el
      });
    }
    return out2;
  }
  function setColliders(next) {
    selector = next && next.trim() ? next.trim() : null;
    if (selector) {
      install();
    }
  }
  function getColliders() {
    return selector;
  }
  function install() {
    if (installed) {
      return;
    }
    const w2 = window;
    if (w2.wp?.os) {
      installed = true;
      return;
    }
    w2.wp = w2.wp || {};
    w2.wp.os = { getWallpaperSurfaces: collect };
    installed = true;
  }
  const LAYER_ID = "mio-layer";
  const STYLE_ID = "mio-layer-style";
  const POSITION_KEY = "mio-js/position";
  const LAYER_CSS = `
#${LAYER_ID} {
	position: fixed;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
	z-index: 2147483000;
}

#${LAYER_ID} .os-mio__handle {

	position: absolute;
	top: 0;
	left: 0;
	border-radius: 50%;
	pointer-events: auto;
	cursor: grab;
	will-change: transform;
	touch-action: none;
}

#${LAYER_ID} .os-mio__handle.is-dragging {
	cursor: grabbing;
}
`;
  let handle = null;
  let layer = null;
  let starting = null;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = LAYER_CSS;
    document.head.appendChild(style);
  }
  function ensureLayer() {
    const existing = document.getElementById(LAYER_ID);
    if (existing) {
      return existing;
    }
    const el = document.createElement("div");
    el.id = LAYER_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    return el;
  }
  function readPosition() {
    try {
      const raw = window.localStorage.getItem(POSITION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number" || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
        return null;
      }
      return { x: parsed.x, y: parsed.y };
    } catch {
      return null;
    }
  }
  function writePosition(pos) {
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
    } catch {
    }
  }
  const PIXI = { Application, BlurFilter, Container, Graphics };
  async function withPixiGlobal(fn) {
    const had = Object.prototype.hasOwnProperty.call(window, "PIXI");
    const previous = window.PIXI;
    window.PIXI = PIXI;
    try {
      return await fn();
    } finally {
      if (had) {
        window.PIXI = previous;
      } else {
        delete window.PIXI;
      }
    }
  }
  async function start() {
    if (handle) {
      return;
    }
    if (starting) {
      return starting;
    }
    starting = (async () => {
      ensureStyle();
      const host = ensureLayer();
      layer = host;
      let mounted;
      try {
        mounted = await withPixiGlobal(
          () => mountMio({
            host,
            config: MIO_DEFAULTS,
            position: readPosition(),
            savePosition: writePosition
          })
        );
      } catch (err) {
        console.warn("[mio-js] Mio failed to start.", err);
        mounted = null;
      }
      if (!mounted) {
        host.remove();
        layer = null;
        return;
      }
      handle = mounted;
    })().finally(() => {
      starting = null;
    });
    return starting;
  }
  function stop() {
    const live = handle;
    handle = null;
    if (live) {
      const resting = live.getPosition();
      if (resting) {
        writePosition(resting);
      }
      live.destroy();
    }
    layer?.remove();
    layer = null;
  }
  const api = {
    start,
    stop,
    isRunning: () => handle !== null,
    getPosition: () => handle?.getPosition() ?? null,
    setPosition: (x2, y2) => handle?.setPosition(x2, y2),
    setColliders,
    getColliders,
    config: MIO_DEFAULTS
  };
  window.Mio = api;
  const tag = document.currentScript;
  function wantsAutoBoot() {
    if (window.MIO_AUTO_BOOT === false) {
      return false;
    }
    return tag?.dataset?.mioAuto !== "false";
  }
  if (tag?.dataset?.mioColliders) {
    setColliders(tag.dataset.mioColliders);
  }
  if (wantsAutoBoot()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => void start(), {
        once: true
      });
    } else {
      void start();
    }
  }
  extensions.add(FilterSystem, CanvasFilterSystem);
  extensions.add(FilterPipe);
  const browserAll =                 Object.freeze(                Object.defineProperty({
    __proto__: null
  }, Symbol.toStringTag, { value: "Module" }));
  const webworkerAll =                 Object.freeze(                Object.defineProperty({
    __proto__: null
  }, Symbol.toStringTag, { value: "Module" }));
  return api;
}();
