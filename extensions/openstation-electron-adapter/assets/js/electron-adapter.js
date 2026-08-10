var openStationElectronAdapter = function(exports) {
  "use strict";
  const POLL_MS = 2e3;
  const PROBE_TIMEOUT_MS = 1500;
  async function connectToAgent(config) {
    if (!config?.hasAgent || !config.url || !config.token) {
      return null;
    }
    const base = config.url.replace(/\/+$/, "");
    const headers = { Authorization: `Bearer ${config.token}` };
    const call = async (path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...headers,
          ...init.body ? { "Content-Type": "application/json" } : {}
        }
      });
      if (!response.ok) {
        throw new Error(`agent HTTP ${response.status}`);
      }
      return await response.json();
    };
    let info;
    try {
      const controller = new AbortController();
      const timer2 = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const ping = await fetch(`${base}/ping`, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timer2);
      if (!ping.ok) {
        return null;
      }
      const data = await ping.json();
      info = {
        isDesktopHost: true,
        protocol: Number(data.protocol) || 1,
        platform: String(data.platform || config.platform || ""),
        osLabel: String(data.osLabel || config.osLabel || ""),
        appVersion: String(data.appVersion || ""),
        hostId: String(data.hostId || ""),
        freedWindows: Array.isArray(data.freedWindows) ? data.freedWindows : []
      };
    } catch {
      return null;
    }
    const dockedListeners = [];
    const freedListeners = [];
    let known = new Set(info.freedWindows);
    let timer = null;
    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const poll = async () => {
      let current;
      try {
        const data = await call("/windows");
        current = new Set(
          Array.isArray(data.windowIds) ? data.windowIds : []
        );
      } catch {
        for (const id of known) {
          dockedListeners.forEach((cb) => cb({ windowId: id }));
        }
        known = /* @__PURE__ */ new Set();
        stopPolling();
        return;
      }
      for (const id of known) {
        if (!current.has(id)) {
          dockedListeners.forEach((cb) => cb({ windowId: id }));
        }
      }
      for (const id of current) {
        if (!known.has(id)) {
          freedListeners.forEach((cb) => cb({ windowId: id }));
        }
      }
      known = current;
      if (!known.size) {
        stopPolling();
      }
    };
    const startPolling = () => {
      if (!timer) {
        timer = setInterval(() => void poll(), POLL_MS);
      }
    };
    if (known.size) {
      startPolling();
    }
    const idle = { state: "idle" };
    return {
      isDesktopHost: true,
      protocol: info.protocol,
      platform: info.platform,
      osLabel: info.osLabel,
      appVersion: info.appVersion,
      getInfo: async () => {
        const data = await call("/ping");
        const freed = Array.isArray(data.freedWindows) ? data.freedWindows : [];
        known = new Set(freed);
        if (known.size) {
          startPolling();
        }
        return { ...info, freedWindows: freed };
      },
      freeWindow: async (req) => {
        const result = await call("/free", {
          method: "POST",
          body: JSON.stringify(req)
        });
        if (result?.ok) {
          known.add(req.windowId);
          startPolling();
        }
        return result;
      },
      dockWindow: async (windowId) => {
        const result = await call("/dock", {
          method: "POST",
          body: JSON.stringify({ windowId })
        });
        return { ok: !!result.ok };
      },
      focusWindow: async (windowId) => {
        const result = await call("/focus", {
          method: "POST",
          body: JSON.stringify({ windowId })
        });
        return { ok: !!result.ok };
      },
      listFreedWindows: async () => {
        const data = await call("/windows");
        return {
          windowIds: Array.isArray(data.windowIds) ? data.windowIds : []
        };
      },
      // The app owns its own connection to WordPress. A browser tab
      // asking it to re-register would be speaking for a process it
      // does not own.
      handshake: () => Promise.resolve(idle),
      getConnection: () => Promise.resolve(idle),
      disconnect: () => Promise.resolve({ ok: false }),
      onWindowDocked: (cb) => {
        dockedListeners.push(cb);
        return () => {
          const i = dockedListeners.indexOf(cb);
          if (i >= 0) {
            dockedListeners.splice(i, 1);
          }
        };
      },
      onWindowFreed: (cb) => {
        freedListeners.push(cb);
        return () => {
          const i = freedListeners.indexOf(cb);
          if (i >= 0) {
            freedListeners.splice(i, 1);
          }
        };
      },
      onConnectionChange: () => () => {
      }
    };
  }
  class FreedWindows {
    /**
     * @param deps Injected collaborators.
     */
    constructor(deps) {
      this.deps = deps;
      this.ids = /* @__PURE__ */ new Set();
    }
    /** @return Ids currently out on the real desktop. */
    list() {
      return Array.from(this.ids);
    }
    /**
     * @param windowId Window id.
     * @return Whether it is out on the desktop.
     */
    has(windowId) {
      return this.ids.has(windowId);
    }
    /**
     * Adopt ids the host already had open — a shell reload does not
     * close native windows, so boot is not a clean slate.
     *
     * Silent by design: nothing *changed*, the adapter is only
     * catching up with what was already true, and firing "freed" for
     * each would tell subscribers about transitions that never
     * happened.
     *
     * @param windowIds Ids reported by the host.
     */
    adoptExisting(windowIds) {
      for (const id of windowIds) {
        if (id) {
          this.ids.add(id);
        }
      }
    }
    /**
     * Mark a window as out on the desktop and get it off the desk.
     *
     * @param windowId Window id.
     */
    adopt(windowId) {
      if (!windowId || this.ids.has(windowId)) {
        return;
      }
      this.ids.add(windowId);
      const win = this.deps.manager.getById(windowId);
      if (win) {
        win.element.classList.add("os-window--freed");
        win.element.setAttribute("data-os-freed", "1");
        if ("minimized" !== win.state) {
          win.minimize();
        }
      }
      this.deps.onFreed?.(windowId);
    }
    /**
     * Restore a window that is no longer out on the desktop.
     *
     * @param windowId Window id.
     */
    release(windowId) {
      if (!this.ids.delete(windowId)) {
        return;
      }
      const win = this.deps.manager.getById(windowId);
      if (win) {
        win.element.classList.remove("os-window--freed");
        win.element.removeAttribute("data-os-freed");
        if ("minimized" === win.state) {
          win.restore();
        }
        this.deps.manager.focus(win);
      }
      this.deps.onDocked?.(windowId);
    }
    /**
     * Anything that would surface a freed window inside the shell
     * raises the native window instead.
     *
     * @param windowId Window id.
     */
    redirect(windowId) {
      if (!this.ids.has(windowId)) {
        return;
      }
      const win = this.deps.manager.getById(windowId);
      if (win && "minimized" !== win.state) {
        win.minimize();
      }
      this.deps.focusNative(windowId);
    }
    /**
     * A window the user closed for real is no longer anyone's problem —
     * take its native counterpart down with it.
     *
     * @param windowId Window id.
     */
    forget(windowId) {
      if (this.ids.delete(windowId)) {
        this.deps.closeNative(windowId);
      }
    }
  }
  const HOST_PROTOCOL = 1;
  function getHostBridge(scope = typeof window === "undefined" ? void 0 : window) {
    if (!scope) {
      return null;
    }
    const candidate = scope.openStationDesktopHost;
    if (!candidate || true !== candidate.isDesktopHost) {
      return null;
    }
    const protocol = Number(candidate.protocol);
    if (!Number.isFinite(protocol) || protocol > HOST_PROTOCOL) {
      return null;
    }
    if ("function" !== typeof candidate.freeWindow) {
      return null;
    }
    return candidate;
  }
  function getFrameBridge(scope = typeof window === "undefined" ? void 0 : window) {
    if (!scope) {
      return null;
    }
    const candidate = scope.openStationDesktopFrame;
    if (!candidate || true !== candidate.isFreedWindow) {
      return null;
    }
    return candidate;
  }
  function sendLabel(osLabel, translate = (text) => text) {
    const label = String(osLabel || "").trim();
    if (!label) {
      return translate("Send to your desktop");
    }
    return translate("Send to your %s").replace("%s", label);
  }
  function freedWindowUrl(win, opts) {
    const isNative = !!win.config?.native;
    const current = win.getCurrentUrl ? win.getCurrentUrl() : "";
    if (!isNative && current) {
      try {
        const url = new URL(current, opts.origin || void 0);
        if (!/^https?:$/.test(url.protocol)) {
          return "";
        }
        url.searchParams.set("openstation_chromeless", "1");
        return url.toString();
      } catch {
        return "";
      }
    }
    if (!opts.adminUrl || !win.id) {
      return "";
    }
    try {
      const solo = new URL("index.php", opts.adminUrl);
      solo.searchParams.set(opts.soloParam || "openstation_solo", win.id);
      return solo.toString();
    } catch {
      return "";
    }
  }
  function sameDocument(a, b) {
    const strip = (raw) => {
      try {
        const url = new URL(raw, window.location.origin);
        for (const flag of [
          "openstation_chromeless",
          "desktop_mode_portal",
          "desktop_mode_portal_intent"
        ]) {
          url.searchParams.delete(flag);
        }
        url.searchParams.sort();
        return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
      } catch {
        return raw;
      }
    };
    return strip(a) === strip(b);
  }
  function installSoloForwarder(frame, os, config) {
    if ("function" !== typeof frame.openWindow) {
      return;
    }
    const soloId = String(os.config.soloWindow || "");
    os.hooks.addAction(
      os.HOOKS.WINDOW_OPENED,
      "openstation-electron/solo-forwarder",
      (payload) => {
        const windowId = payload?.windowId;
        if (!windowId || windowId === soloId) {
          return;
        }
        const win = os.windowManager.getById(windowId);
        if (!win) {
          return;
        }
        const url = freedWindowUrl(
          {
            id: win.id,
            config: win.config,
            // At `WINDOW_OPENED` an iframe window may not have
            // navigated yet, so fall back to the URL it was
            // configured with rather than to solo mode.
            getCurrentUrl: () => (win.getCurrentUrl ? win.getCurrentUrl() : "") || win.config.url || ""
          },
          {
            adminUrl: os.config.adminUrl,
            soloParam: config.soloParam,
            origin: window.location.origin
          }
        );
        if (!url) {
          return;
        }
        if (sameDocument(url, window.location.href)) {
          return;
        }
        const rect = win.element?.getBoundingClientRect();
        void frame.openWindow({
          windowId,
          url,
          title: win.config.title,
          width: rect ? Math.round(rect.width) : void 0,
          height: rect ? Math.round(rect.height) : void 0,
          native: !!win.config.native
        }).then((result) => {
          if (!result?.ok) {
            console.error(
              "[openstation-electron] host refused to open a window:",
              result?.error
            );
            return;
          }
          win.close?.();
        }).catch((err) => {
          console.error(
            "[openstation-electron] could not forward a window to the host:",
            err
          );
        });
      }
    );
  }
  const NONCE_RETRY_MS = 6e4;
  const EVENT_FREED = "os-desktop-host-freed";
  const EVENT_DOCKED = "os-desktop-host-docked";
  const EVENT_CONNECTION = "os-desktop-host-connection";
  const TEXT_DOMAIN = "openstation-electron-adapter";
  function __(text) {
    const i18n = window.wp?.i18n;
    return i18n?.__ ? i18n.__(text, TEXT_DOMAIN) : text;
  }
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }
  function markSoloHost() {
    const frame = getFrameBridge();
    if (!frame) {
      return;
    }
    document.body.classList.add("os-solo--host");
    if ("darwin" === frame.platform) {
      document.body.classList.add("os-solo--darwin");
    }
  }
  function boot(bridge, os, config) {
    let info = null;
    let connection = { state: "idle" };
    let lastNonceRetry = 0;
    const freed = new FreedWindows({
      manager: os.windowManager,
      focusNative: (id) => {
        void bridge.focusWindow(id);
      },
      closeNative: (id) => {
        void bridge.dockWindow(id);
      },
      onFreed: (windowId) => emit(EVENT_FREED, { windowId }),
      onDocked: (windowId) => emit(EVENT_DOCKED, { windowId })
    });
    function handshake() {
      if (!config.enabled || !config.restRoot) {
        return;
      }
      void bridge.handshake({
        restUrl: config.restRoot,
        nonce: os.config.restNonce,
        siteUrl: window.location.origin
      }).then((state) => {
        connection = state;
        emit(EVENT_CONNECTION, state);
      }).catch((err) => {
        console.error("[openstation-electron] handshake failed:", err);
      });
    }
    async function free(windowId) {
      const win = os.windowManager.getById(windowId);
      if (!win) {
        return false;
      }
      if (freed.has(windowId)) {
        await bridge.focusWindow(windowId);
        return true;
      }
      const url = freedWindowUrl(win, {
        adminUrl: os.config.adminUrl,
        soloParam: config.soloParam,
        origin: window.location.origin
      });
      if (!url) {
        return false;
      }
      const rect = win.element.getBoundingClientRect();
      const result = await bridge.freeWindow({
        windowId,
        url,
        title: win.config.title,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        native: !!win.config.native
      });
      if (!result?.ok) {
        console.error(
          "[openstation-electron] host refused to free the window:",
          result?.error
        );
        return false;
      }
      freed.adopt(windowId);
      return true;
    }
    async function dock(windowId) {
      if (!freed.has(windowId)) {
        return false;
      }
      const result = await bridge.dockWindow(windowId);
      return !!result?.ok;
    }
    bridge.onWindowDocked(({ windowId }) => freed.release(windowId));
    bridge.onWindowFreed(({ windowId }) => {
      freed.adopt(windowId);
    });
    bridge.onConnectionChange((state) => {
      connection = state;
      emit(EVENT_CONNECTION, state);
      if ("nonce-stale" === state.state) {
        const now = Date.now();
        if (now - lastNonceRetry >= NONCE_RETRY_MS) {
          lastNonceRetry = now;
          handshake();
        }
      }
    });
    os.hooks.addAction(
      os.HOOKS.WINDOW_RESTORED,
      "openstation-electron/redirect",
      (payload) => payload?.windowId && freed.redirect(payload.windowId)
    );
    os.hooks.addAction(
      os.HOOKS.WINDOW_FOCUSED,
      "openstation-electron/redirect",
      (payload) => payload?.windowId && freed.redirect(payload.windowId)
    );
    os.hooks.addAction(
      os.HOOKS.WINDOW_CLOSED,
      "openstation-electron/cleanup",
      (payload) => payload?.windowId && freed.forget(payload.windowId)
    );
    os.registerWindowAction({
      id: "openstation-electron/send-to-desktop",
      order: 60,
      icon: (win) => freed.has(win.id) ? "dashicons-editor-contract" : "dashicons-desktop",
      label: (win) => freed.has(win.id) ? __("Bring back into OpenStation") : sendLabel(bridge.osLabel, __),
      onSelect: (win) => {
        if (freed.has(win.id)) {
          void dock(win.id);
        } else {
          void free(win.id);
        }
      },
      owner: "openstation-electron-adapter"
    });
    const api = {
      isAvailable: () => true,
      getInfo: () => info,
      getSendLabel: () => sendLabel(bridge.osLabel, __),
      getDockLabel: () => __("Bring back into OpenStation"),
      isFreedWindow: () => null !== getFrameBridge(),
      free,
      dock,
      listFreed: () => freed.list(),
      isFreed: (windowId) => freed.has(windowId),
      getConnection: () => connection
    };
    os.electron = api;
    void bridge.getInfo().then((result) => {
      info = result;
      freed.adoptExisting(result?.freedWindows ?? []);
    }).catch(() => {
    }).then(handshake);
    return api;
  }
  const SHELL_WAIT_MS = 15e3;
  const SHELL_POLL_MS = 50;
  function waitForShell() {
    const ready = () => {
      const os = window.wp?.os;
      return os?.ready ? os : null;
    };
    const now = ready();
    if (now) {
      return Promise.resolve(now);
    }
    return new Promise((resolve) => {
      const deadline = Date.now() + SHELL_WAIT_MS;
      const timer = setInterval(() => {
        const os = ready();
        if (os) {
          clearInterval(timer);
          resolve(os);
          return;
        }
        if (Date.now() > deadline) {
          clearInterval(timer);
          console.error(
            "[openstation-electron] wp.os never appeared — the adapter bundle loaded outside OpenStation."
          );
          resolve(null);
        }
      }, SHELL_POLL_MS);
    });
  }
  function start() {
    if (document.body) {
      markSoloHost();
    } else {
      document.addEventListener("DOMContentLoaded", markSoloHost);
    }
    const config = window.openStationElectronConfig;
    if (!config) {
      console.error(
        "[openstation-electron] openStationElectronConfig is missing — the bundle was enqueued without its config."
      );
      return;
    }
    const frame = getFrameBridge();
    if (frame) {
      void waitForShell().then((os) => {
        if (os) {
          os.ready(
            () => installSoloForwarder(
              frame,
              os,
              config
            )
          );
        }
      });
      return;
    }
    void (async () => {
      const bridge = getHostBridge() ?? await connectToAgent(config.agent);
      if (!bridge) {
        return;
      }
      const os = await waitForShell();
      if (!os) {
        return;
      }
      os.ready(() => boot(bridge, os, config));
    })();
  }
  start();
  exports.EVENT_CONNECTION = EVENT_CONNECTION;
  exports.EVENT_DOCKED = EVENT_DOCKED;
  exports.EVENT_FREED = EVENT_FREED;
  exports.boot = boot;
  exports.start = start;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
