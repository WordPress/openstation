var wpDesktopRecycleBin = function(exports) {
  "use strict";
  const TEXT_DOMAIN = "desktop-mode";
  function i18n() {
    return window.wp?.i18n;
  }
  function __(text, domain = TEXT_DOMAIN) {
    return i18n()?.__(text, domain) ?? text;
  }
  function sprintf(format, ...args) {
    const impl = i18n()?.sprintf;
    if (impl) {
      return impl(format, ...args);
    }
    let i = 0;
    return format.replace(/%[sd]/g, () => String(args[i++] ?? ""));
  }
  const LOG_PREFIX = "[wpdm-bin badge]";
  function log(...args) {
    try {
      if (window.localStorage?.getItem("wpdmBinDebug")) {
        console.info(LOG_PREFIX, ...args);
      }
    } catch {
    }
  }
  const TARGET_ID = "wpdm-recycle-bin";
  const BADGE_CLASS = "wp-desktop-dock__badge";
  const ICON_BADGE_CLASS = "wp-desktop-icon__badge";
  let _current = 0;
  function setRecycleBinBadge(next) {
    const safe = Math.max(0, Math.floor(next));
    const prev = _current;
    _current = safe;
    log("setRecycleBinBadge", { prev, next: safe });
    paintBadge(safe);
  }
  function paintBadge(count) {
    const tile = document.querySelector(
      `[data-system-id="${cssEscape(TARGET_ID)}"]`
    );
    const icon = document.querySelector(
      `[data-icon-id="${cssEscape(TARGET_ID)}"]`
    );
    log("paintBadge", {
      count,
      tile: !!tile,
      icon: !!icon
    });
    if (tile) {
      const primary = tile.querySelector(
        ".wp-desktop-dock__item-primary"
      );
      applyBadge(primary ?? tile, BADGE_CLASS, count);
    }
    if (icon) {
      applyBadge(icon, ICON_BADGE_CLASS, count);
    }
  }
  function applyBadge(host, className, count) {
    const existing = host.querySelector(
      `:scope > .${className}`
    );
    if (count <= 0) {
      existing?.remove();
      return;
    }
    const display = count > 99 ? "99+" : String(count);
    if (existing) {
      if (existing.textContent !== display) {
        existing.textContent = display;
      }
      return;
    }
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = display;
    badge.setAttribute("aria-label", `${count} in trash`);
    host.appendChild(badge);
  }
  function cssEscape(value) {
    const c = window.CSS;
    return c?.escape ? c.escape(value) : value;
  }
  const EVENT_NAME = "wp-desktop-recycle-bin-changed";
  const HEARTBEAT_FIELD = "wpdm_recycle_bin_seen_ts";
  const POSTMESSAGE_TYPE = "wp-desktop-recycle-bin-changed";
  const state = {
    started: false,
    seenTs: 0,
    postMessageHandler: null,
    heartbeatSendHandler: null,
    heartbeatTickHandler: null
  };
  function dispatchChanged(source, ts) {
    const detail = {
      kind: "external",
      ok: 0,
      errors: [],
      source,
      ts
    };
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    const hooks = window.wp?.hooks;
    if (hooks && typeof hooks.doAction === "function") {
      hooks.doAction("wp_desktop.recycleBin.changed", detail);
    }
  }
  function start() {
    if (state.started) {
      return;
    }
    state.started = true;
    state.seenTs = Date.now();
    const expectedOrigin = window.location.origin;
    state.postMessageHandler = (e) => {
      if (e.origin !== expectedOrigin) {
        return;
      }
      const data = e.data;
      if (!data || data.type !== POSTMESSAGE_TYPE) {
        return;
      }
      const ts = typeof data.ts === "number" ? data.ts : Date.now();
      if (ts <= state.seenTs) {
        return;
      }
      state.seenTs = ts;
      dispatchChanged("chromeless", ts);
    };
    window.addEventListener("message", state.postMessageHandler);
    const $ = window.jQuery;
    if (!$) {
      return;
    }
    state.heartbeatSendHandler = (...args) => {
      const data = args[1];
      if (data) {
        data[HEARTBEAT_FIELD] = state.seenTs;
      }
    };
    $(document).on("heartbeat-send", state.heartbeatSendHandler);
    state.heartbeatTickHandler = (...args) => {
      const response = args[1];
      const block = response?.wpdm_recycle_bin;
      if (!block) {
        return;
      }
      const ts = typeof block.ts === "number" ? block.ts : 0;
      if (ts > state.seenTs) {
        state.seenTs = ts;
        if (block.changed) {
          dispatchChanged("heartbeat", ts);
        }
      }
    };
    $(document).on("heartbeat-tick", state.heartbeatTickHandler);
  }
  function stop() {
    if (!state.started) {
      return;
    }
    state.started = false;
    if (state.postMessageHandler) {
      window.removeEventListener("message", state.postMessageHandler);
      state.postMessageHandler = null;
    }
    const $ = window.jQuery;
    if ($) {
      if (state.heartbeatSendHandler) {
        $(document).off("heartbeat-send", state.heartbeatSendHandler);
      }
      if (state.heartbeatTickHandler) {
        $(document).off("heartbeat-tick", state.heartbeatTickHandler);
      }
    }
    state.heartbeatSendHandler = null;
    state.heartbeatTickHandler = null;
  }
  function config() {
    const cfg = window.wpDesktopRecycleBinConfig;
    if (!cfg) {
      throw new Error(
        "wpDesktopRecycleBinConfig is missing — the recycle-bin bundle was loaded outside of desktop mode."
      );
    }
    return cfg;
  }
  async function request(url, init) {
    const cfg = config();
    const response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": cfg.restNonce,
        Accept: "application/json",
        ...init.body ? { "Content-Type": "application/json" } : {},
        ...init.headers ?? {}
      }
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const json = await response.json();
        if (json && typeof json.message === "string") {
          message = json.message;
        }
      } catch {
      }
      throw new Error(message);
    }
    return await response.json();
  }
  function fetchList(params = {}) {
    const url = new URL(config().listUrl);
    if (params.page) {
      url.searchParams.set("page", String(params.page));
    }
    if (params.perPage) {
      url.searchParams.set("per_page", String(params.perPage));
    }
    if (params.type) {
      url.searchParams.set("type", params.type);
    }
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    return request(url.toString(), { method: "GET" });
  }
  function restoreItems(items) {
    return request(config().restoreUrl, {
      method: "POST",
      body: JSON.stringify({ items })
    });
  }
  function purgeItems(items) {
    return request(config().purgeUrl, {
      method: "POST",
      body: JSON.stringify({ items })
    });
  }
  function emptyBin() {
    return request(config().emptyUrl, {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  const ROOT = "[data-wpdm-recycle-bin-root]";
  const FILTER = "[data-wpdm-recycle-bin-filter]";
  const SEARCH = "[data-wpdm-recycle-bin-search]";
  const REFRESH = "[data-wpdm-recycle-bin-refresh]";
  const TABLE = "[data-wpdm-recycle-bin-table]";
  const BULK = "[data-wpdm-recycle-bin-bulk]";
  const COUNT = "[data-wpdm-recycle-bin-count]";
  const RESTORE_SEL = "[data-wpdm-recycle-bin-restore-selected]";
  const PURGE_SEL = "[data-wpdm-recycle-bin-purge-selected]";
  const EMPTY_BTN = "[data-wpdm-recycle-bin-empty]";
  let currentRowActionRestore = () => {
  };
  let currentRowActionPurge = () => {
  };
  const rowActionRestore = (ref) => currentRowActionRestore(ref);
  const rowActionPurge = (ref) => currentRowActionPurge(ref);
  let cachedItems = null;
  function itemsFingerprint(items) {
    if (items.length === 0) {
      return "";
    }
    const parts = items.map((i) => `${i.id}:${i.deleted_at}`).sort();
    return parts.join("|");
  }
  function buildColumns() {
    const cols = [
      {
        key: "preview",
        label: "",
        width: "52px",
        render: (_v, row) => {
          if (row.preview && row.type === "attachment" && row.mime.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = row.preview;
            img.alt = "";
            img.loading = "lazy";
            img.style.cssText = "width:36px;height:36px;border-radius:4px;object-fit:cover;display:block;";
            return img;
          }
          const empty = document.createElement("span");
          empty.style.cssText = "display:inline-block;width:36px;height:36px;";
          return empty;
        }
      },
      {
        key: "title",
        label: __("Title"),
        sortable: true,
        filter: "text",
        render: (_v, row) => {
          const cell = document.createElement("span");
          cell.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;";
          const title = document.createElement("span");
          title.style.cssText = "font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;";
          title.textContent = row.title;
          title.title = row.title;
          cell.appendChild(title);
          if (row.subtitle) {
            const sub = document.createElement("span");
            sub.style.cssText = "font-size:12px;color:#50575e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;";
            sub.textContent = row.subtitle;
            sub.title = row.subtitle;
            cell.appendChild(sub);
          }
          return cell;
        }
      },
      {
        key: "type",
        label: __("Type"),
        sortable: true,
        filter: "select",
        width: "120px",
        render: (_v, row) => labelForType(row.type)
      },
      {
        key: "deleted_at",
        label: __("Deleted"),
        sortable: true,
        width: "180px",
        sortValue: (row) => Date.parse(row.deleted_at + "Z") || 0,
        render: (_v, row) => {
          const el = document.createElement("wpd-relative-time");
          el.setAttribute("datetime", row.deleted_at);
          return el;
        }
      },
      {
        key: "deleted_by",
        label: __("By"),
        sortable: true,
        filter: "text",
        width: "160px",
        render: (_v, row) => row.deleted_by || "—"
      },
      {
        key: "__actions",
        label: "",
        width: "96px",
        align: "end",
        render: (_v, row) => {
          const wrap = document.createElement("span");
          wrap.style.cssText = "display:inline-flex;gap:4px;justify-content:flex-end;align-items:center;flex-wrap:nowrap;white-space:nowrap;line-height:1;";
          if (row.can_restore) {
            wrap.appendChild(makeRowButton({
              label: __("Restore"),
              icon: "restore",
              onClick: () => rowActionRestore({ id: row.id, type: row.type })
            }));
          }
          if (row.can_purge) {
            wrap.appendChild(makeRowButton({
              label: __("Delete forever"),
              icon: "trash",
              variant: "danger",
              onClick: () => rowActionPurge({ id: row.id, type: row.type })
            }));
          }
          return wrap;
        }
      }
    ];
    const hooks = window.wp?.hooks;
    if (hooks && typeof hooks.applyFilters === "function") {
      return hooks.applyFilters(
        "wp_desktop.recycleBin.columns",
        cols
      );
    }
    return cols;
  }
  function labelForType(type) {
    switch (type) {
      case "post":
        return __("Post");
      case "page":
        return __("Page");
      case "attachment":
        return __("Media");
      case "comment":
        return __("Comment");
      default:
        return type;
    }
  }
  const ICON_SVG = {
    restore: '<path d="M12 5V2L7 6l5 4V7c2.76 0 5 2.24 5 5 0 .83-.21 1.61-.57 2.3l1.46 1.46A6.96 6.96 0 0 0 19 12c0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5 0-.83.21-1.61.57-2.3L6.11 8.24A6.96 6.96 0 0 0 5 12c0 3.87 3.13 7 7 7v3l5-4-5-4v3z" fill="currentColor"/>',
    trash: '<path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" fill="currentColor"/>'
  };
  function makeRowButton(opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-noclick", "");
    btn.setAttribute("aria-label", opts.label);
    btn.title = opts.label;
    const isDanger = opts.variant === "danger";
    const restColor = isDanger ? "#d63638" : "#50575e";
    const restBorder = isDanger ? "#d63638" : "#c3c4c7";
    const applyRest = () => {
      btn.style.background = "#fff";
      btn.style.color = restColor;
      btn.style.borderColor = restBorder;
    };
    const applyHover = () => {
      if (isDanger) {
        btn.style.background = "#d63638";
        btn.style.color = "#fff";
        btn.style.borderColor = "#d63638";
      } else {
        btn.style.background = "#f0f0f1";
        btn.style.color = "#1d2327";
        btn.style.borderColor = "#8c8f94";
      }
    };
    btn.style.cssText = [
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "flex: 0 0 30px",
      "width: 30px",
      "height: 30px",
      "padding: 0",
      "margin: 0",
      "border: 1px solid " + restBorder,
      "border-radius: 6px",
      "background: #fff",
      "color: " + restColor,
      "cursor: pointer",
      "box-sizing: border-box",
      "line-height: 1",
      "font: inherit",
      "transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease"
    ].join(";");
    btn.addEventListener("mouseenter", applyHover);
    btn.addEventListener("mouseleave", applyRest);
    btn.addEventListener("focus", applyHover);
    btn.addEventListener("blur", applyRest);
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.style.display = "block";
    svg.innerHTML = ICON_SVG[opts.icon] ?? "";
    btn.appendChild(svg);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onClick();
    });
    return btn;
  }
  function renderRecycleBin(body) {
    const root = body.querySelector(ROOT);
    const table = body.querySelector(TABLE);
    if (!root || !table) {
      return;
    }
    const state2 = {
      filter: "",
      search: "",
      searchDebounce: null
    };
    currentRowActionRestore = (ref) => void handleRestore([ref]);
    currentRowActionPurge = (ref) => void handlePurge([ref]);
    table.columns = buildColumns();
    table.getRowId = (row) => row.id;
    let currentFingerprint = "";
    if (cachedItems) {
      table.data = cachedItems;
      currentFingerprint = itemsFingerprint(cachedItems);
      table.removeAttribute("loading");
    }
    let refreshSeq = 0;
    const refresh = async () => {
      const showSkeleton = !cachedItems;
      const mySeq = ++refreshSeq;
      if (showSkeleton) {
        table.toggleAttribute("loading", true);
      }
      try {
        const { items, total } = await fetchList({
          type: state2.filter,
          search: state2.search,
          perPage: 200
        });
        if (mySeq !== refreshSeq) {
          return;
        }
        const next = itemsFingerprint(items);
        if (next !== currentFingerprint) {
          table.data = items;
          currentFingerprint = next;
          cachedItems = items;
        } else {
          cachedItems = items;
        }
        setRecycleBinBadge(total);
      } catch (err) {
        if (mySeq !== refreshSeq) {
          return;
        }
        console.error("[recycle-bin] list failed", err);
        if (showSkeleton) {
          table.data = [];
          currentFingerprint = "";
        }
      } finally {
        if (mySeq === refreshSeq) {
          if (showSkeleton) {
            table.toggleAttribute("loading", false);
          }
          refreshBulkBar();
        }
      }
    };
    const bulk = root.querySelector(BULK);
    const countEl = root.querySelector(COUNT);
    const refreshBulkBar = () => {
      if (!bulk || !countEl) {
        return;
      }
      const selected = Array.from(table.selection ?? []);
      if (selected.length === 0) {
        bulk.hidden = true;
        return;
      }
      bulk.hidden = false;
      countEl.textContent = sprintf(
        /* translators: %d: selected row count. */
        __("%d selected"),
        selected.length
      );
    };
    const collectSelectedItems = () => {
      const sel = Array.from(table.selection ?? []);
      const idSet = new Set(sel.map((id) => Number(id)));
      const out = [];
      for (const row of table.data ?? []) {
        if (idSet.has(row.id)) {
          out.push({ id: row.id, type: row.type });
        }
      }
      return out;
    };
    const handleRestore = async (refs) => {
      if (refs.length === 0) {
        return;
      }
      const types = Array.from(new Set(refs.map((r) => r.type)));
      try {
        const result = await restoreItems(refs);
        emitDoneEvent("restore", result.ok, result.errors, types, result.ok);
      } catch (err) {
        console.error("[recycle-bin] restore failed", err);
      }
      table.clearSelection();
      await refresh();
    };
    const handlePurge = async (refs) => {
      if (refs.length === 0) {
        return;
      }
      const ok = window.confirm(
        sprintf(
          /* translators: %d: row count. */
          __("Permanently delete %d item(s)? This cannot be undone."),
          refs.length
        )
      );
      if (!ok) {
        return;
      }
      const types = Array.from(new Set(refs.map((r) => r.type)));
      try {
        const result = await purgeItems(refs);
        emitDoneEvent("purge", result.ok, result.errors, types, result.ok);
      } catch (err) {
        console.error("[recycle-bin] purge failed", err);
      }
      table.clearSelection();
      await refresh();
    };
    const handleEmpty = async () => {
      const ok = window.confirm(
        __(
          "Empty the recycle bin? Every item visible in the current view will be permanently deleted."
        )
      );
      if (!ok) {
        return;
      }
      const allTypes = Array.from(
        new Set((table.data ?? []).map((r) => r.type))
      );
      try {
        const result = await emptyBin();
        emitDoneEvent(
          "empty",
          new Array(result.purged).fill(0),
          result.skipped > 0 ? [{
            id: 0,
            code: "wpdm_recycle_bin_skipped",
            message: sprintf(
              /* translators: %d: skipped count. */
              __("%d item(s) skipped (insufficient permissions)."),
              result.skipped
            )
          }] : [],
          allTypes,
          []
        );
      } catch (err) {
        console.error("[recycle-bin] empty failed", err);
      }
      await refresh();
    };
    root.querySelector(FILTER)?.addEventListener("wpd-pick", (e) => {
      const detail = e.detail;
      state2.filter = detail?.value ?? "";
      void refresh();
    });
    const search = root.querySelector(SEARCH);
    search?.addEventListener("wpd-input-change", (e) => {
      const value = e.detail?.value ?? "";
      state2.search = value;
      if (state2.searchDebounce !== null) {
        window.clearTimeout(state2.searchDebounce);
      }
      state2.searchDebounce = window.setTimeout(() => {
        void refresh();
      }, 250);
    });
    body.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      if (target.closest(REFRESH)) {
        void refresh();
        return;
      }
      if (target.closest(RESTORE_SEL)) {
        void handleRestore(collectSelectedItems());
        return;
      }
      if (target.closest(PURGE_SEL)) {
        void handlePurge(collectSelectedItems());
        return;
      }
      if (target.closest(EMPTY_BTN)) {
        void handleEmpty();
      }
    });
    table.addEventListener("wpd-table-selection-change", () => {
      refreshBulkBar();
    });
    table.sort = { key: "deleted_at", direction: "desc" };
    start();
    let externalRefreshTimer = null;
    const onExternalChange = (e) => {
      const detail = e.detail;
      if (!detail?.source || detail.source === "local") {
        return;
      }
      if (externalRefreshTimer !== null) {
        window.clearTimeout(externalRefreshTimer);
      }
      externalRefreshTimer = window.setTimeout(() => {
        externalRefreshTimer = null;
        void refresh();
      }, 200);
    };
    document.addEventListener("wp-desktop-recycle-bin-changed", onExternalChange);
    const broadcastUnsubs = [];
    const api = window.wp?.desktop;
    if (api && typeof api.subscribe === "function") {
      const onDomainChanged = (payload) => {
        const detail = payload;
        if (detail?.source === "recycle-bin") {
          return;
        }
        if (externalRefreshTimer !== null) {
          window.clearTimeout(externalRefreshTimer);
        }
        externalRefreshTimer = window.setTimeout(() => {
          externalRefreshTimer = null;
          void refresh();
        }, 200);
      };
      broadcastUnsubs.push(
        api.subscribe("wp-desktop.post.changed", onDomainChanged),
        api.subscribe("wp-desktop.page.changed", onDomainChanged),
        api.subscribe("wp-desktop.attachment.changed", onDomainChanged),
        api.subscribe("wp-desktop.comment.changed", onDomainChanged)
      );
    }
    const onWindowClosed = (e) => {
      const detail = e.detail;
      if (detail?.windowId !== "wpdm-recycle-bin") {
        return;
      }
      stop();
      document.removeEventListener(
        "wp-desktop-recycle-bin-changed",
        onExternalChange
      );
      for (const unsub of broadcastUnsubs) {
        try {
          unsub();
        } catch (err) {
        }
      }
      broadcastUnsubs.length = 0;
      if (externalRefreshTimer !== null) {
        window.clearTimeout(externalRefreshTimer);
        externalRefreshTimer = null;
      }
      currentRowActionRestore = () => {
      };
      currentRowActionPurge = () => {
      };
      document.removeEventListener("wp-desktop-window-closed", onWindowClosed);
    };
    document.addEventListener("wp-desktop-window-closed", onWindowClosed);
    void refresh();
  }
  function emitDoneEvent(kind, ok, errors, affectedTypes = [], affectedIds = []) {
    const detail = { kind, ok: ok.length, errors, source: "local" };
    document.dispatchEvent(
      new CustomEvent("wp-desktop-recycle-bin-changed", { detail })
    );
    const hooks = window.wp?.hooks;
    if (hooks && typeof hooks.doAction === "function") {
      hooks.doAction("wp_desktop.recycleBin.changed", detail);
    }
    const api = window.wp?.desktop;
    if (api && typeof api.broadcast === "function" && affectedTypes.length > 0) {
      const action = kind === "restore" ? "untrashed" : "deleted";
      for (const type of affectedTypes) {
        api.broadcast(`wp-desktop.${type}.changed`, {
          source: "recycle-bin",
          action,
          ids: affectedIds
        });
      }
    }
  }
  const registry = window.wpDesktopNativeWindows ?? (window.wpDesktopNativeWindows = {});
  registry["wpdm-recycle-bin"] = (body) => {
    renderRecycleBin(body);
  };
  exports.renderRecycleBin = renderRecycleBin;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
