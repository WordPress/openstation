var openStationElectronAdapter = function(exports) {
  "use strict";
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
  function start() {
    if (document.body) {
      markSoloHost();
    } else {
      document.addEventListener("DOMContentLoaded", markSoloHost);
    }
    const bridge = getHostBridge();
    if (!bridge) {
      return;
    }
    const os = window.wp?.os;
    if (!os?.ready) {
      console.error(
        "[openstation-electron] wp.os is missing — the adapter bundle loaded outside OpenStation."
      );
      return;
    }
    const config = window.openStationElectronConfig;
    if (!config) {
      console.error(
        "[openstation-electron] openStationElectronConfig is missing — the bundle was enqueued without its config."
      );
      return;
    }
    os.ready(() => boot(bridge, os, config));
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
//# sourceMappingURL=electron-adapter.js.map
