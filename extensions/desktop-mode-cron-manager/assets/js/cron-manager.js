var wpDesktopCronManager = function(exports) {
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
  function config() {
    const cfg = window.wpDesktopCronManagerConfig;
    if (!cfg) {
      throw new Error(
        "wpDesktopCronManagerConfig is missing - the cron-manager bundle was loaded outside of desktop mode."
      );
    }
    return cfg;
  }
  async function request(url, init = {}) {
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
  function fetchEvents() {
    return request(config().eventsUrl, { method: "GET" });
  }
  function fetchSchedules() {
    return request(config().schedulesUrl, { method: "GET" });
  }
  function createEvent(event) {
    return request(config().eventsUrl, {
      method: "POST",
      body: JSON.stringify(event)
    });
  }
  function updateEvent(identity, event) {
    return request(config().eventsUrl, {
      method: "PUT",
      body: JSON.stringify({ identity, event })
    });
  }
  function deleteEvent(identity) {
    return request(config().eventsUrl, {
      method: "DELETE",
      body: JSON.stringify({ identity })
    });
  }
  function runEventNow(identity) {
    return request(config().runNowUrl, {
      method: "POST",
      body: JSON.stringify({ identity })
    });
  }
  const ROOT = "[data-wpdm-cron-manager-root]";
  const SEARCH = "[data-wpdm-cron-manager-search]";
  const FILTER = "[data-wpdm-cron-manager-schedule-filter]";
  const FEEDBACK = "[data-wpdm-cron-manager-feedback]";
  const REFRESH = "[data-wpdm-cron-manager-refresh]";
  const CREATE = "[data-wpdm-cron-manager-create]";
  const TABLE = "[data-wpdm-cron-manager-table]";
  const EDITOR = "[data-wpdm-cron-manager-editor]";
  const EDITOR_TITLE = "[data-wpdm-cron-manager-editor-title]";
  const CLOSE_EDITOR = "[data-wpdm-cron-manager-close-editor]";
  const CUSTOM_SCHEDULE = "[data-wpdm-cron-manager-custom-schedule]";
  const NOTICE = "[data-wpdm-cron-manager-notice]";
  const SAVE = "[data-wpdm-cron-manager-save]";
  const CANCEL = "[data-wpdm-cron-manager-cancel]";
  const DELETE = "[data-wpdm-cron-manager-delete]";
  const CUSTOM_VALUE = "__custom";
  const SINGLE_FILTER = "__single";
  const feedbackTimers = /* @__PURE__ */ new WeakMap();
  function buildColumns(onEdit, onDelete, onRunNow) {
    return [
      {
        key: "hook",
        label: __("Hook"),
        sortable: true,
        filter: "text",
        render: (_v, row) => renderHookCell(row)
      },
      {
        key: "timestamp",
        label: __("Next run"),
        sortable: true,
        width: "180px",
        sortValue: (row) => row.timestamp,
        render: (_v, row) => renderNextRun(row)
      },
      {
        key: "schedule",
        label: __("Recurrence"),
        sortable: true,
        width: "150px",
        render: (_v, row) => row.scheduleDisplay
      },
      {
        key: "argsSummary",
        label: __("Args"),
        width: "220px",
        render: (_v, row) => renderArgsCell(row)
      },
      {
        key: "due",
        label: __("Status"),
        sortable: true,
        width: "110px",
        sortValue: (row) => statusOrder(row),
        render: (_v, row) => renderStatus(row)
      },
      {
        key: "__actions",
        label: "",
        width: "142px",
        align: "end",
        render: (_v, row) => {
          const wrap = document.createElement("span");
          wrap.style.cssText = "display:inline-flex;gap:4px;align-items:center;justify-content:flex-end;white-space:nowrap;";
          wrap.append(
            makeRowButton(__("Edit"), () => onEdit(row)),
            makeRowButton(__("Run now"), () => onRunNow(row)),
            makeRowButton(__("Delete"), () => onDelete(row), true)
          );
          return wrap;
        }
      }
    ];
  }
  function renderHookCell(row) {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;";
    const hook = document.createElement("span");
    hook.style.cssText = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;";
    hook.textContent = row.hook;
    hook.title = row.hook;
    wrap.appendChild(hook);
    const meta = document.createElement("span");
    meta.style.cssText = "font-size:12px;color:#646970;";
    if (row.callbackCount > 0) {
      meta.textContent = sprintf(
        /* translators: %d: callback count. */
        __("%d callback(s)"),
        row.callbackCount
      );
    } else {
      meta.textContent = __("No registered callback");
    }
    wrap.appendChild(meta);
    return wrap;
  }
  function renderNextRun(row) {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;white-space:nowrap;";
    const local = document.createElement("span");
    local.textContent = row.nextRunLocal;
    const rel = document.createElement("wpd-relative-time");
    rel.setAttribute("datetime", row.nextRunGmt);
    rel.style.cssText = "font-size:12px;color:#646970;";
    wrap.append(local, rel);
    return wrap;
  }
  function renderArgsCell(row) {
    const text = document.createElement("span");
    text.style.cssText = "display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;";
    text.textContent = row.argsSummary;
    text.title = row.argsSummary;
    return text;
  }
  function renderStatus(row) {
    const badge = document.createElement("span");
    let label = __("Scheduled");
    let color = "#0a7f49";
    let bg = "#edfaef";
    if (row.overdue) {
      label = __("Overdue");
      color = "#b32d2e";
      bg = "#fcf0f1";
    } else if (row.due) {
      label = __("Due");
      color = "#8a6d1d";
      bg = "#fff8e5";
    }
    badge.textContent = label;
    badge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "height:22px",
      "padding:0 8px",
      "border-radius:999px",
      "font-size:12px",
      "font-weight:600",
      `color:${color}`,
      `background:${bg}`
    ].join(";");
    return badge;
  }
  function statusOrder(row) {
    if (row.overdue) {
      return 0;
    }
    if (row.due) {
      return 1;
    }
    return 2;
  }
  function makeRowButton(label, onClick, danger = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("data-noclick", "");
    btn.style.cssText = [
      "height:28px",
      "padding:0 8px",
      "border:1px solid " + (danger ? "#d63638" : "#c3c4c7"),
      "border-radius:6px",
      "background:#fff",
      "color:" + (danger ? "#d63638" : "#1d2327"),
      "font:inherit",
      "font-size:12px",
      "cursor:pointer"
    ].join(";");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }
  function renderCronManager(body) {
    const root = body.querySelector(ROOT);
    const table = body.querySelector(TABLE);
    const editor = body.querySelector(EDITOR);
    if (!root || !table || !editor) {
      return;
    }
    const state = {
      events: [],
      schedules: [],
      search: "",
      filter: "",
      editing: null,
      loadSeq: 0
    };
    const fields = getFields(editor);
    table.columns = buildColumns(
      (event) => openEditor(root, editor, fields, state, event),
      (event) => void handleDelete(table, state, event),
      (event) => void handleRunNow(table, state, root, event)
    );
    table.getRowId = (row) => row.id;
    table.sort = { key: "timestamp", direction: "asc" };
    const render = () => {
      table.data = filterEvents(state);
    };
    root.querySelector(SEARCH)?.addEventListener("wpd-input-change", (e) => {
      state.search = e.detail?.value ?? "";
      render();
    });
    root.querySelector(FILTER)?.addEventListener("wpd-pick", (e) => {
      state.filter = e.detail?.value ?? "";
      render();
    });
    fields.schedule?.addEventListener("wpd-pick", (e) => {
      const value = e.detail?.value ?? "";
      toggleCustomSchedule(editor, value === CUSTOM_VALUE);
    });
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      if (target.closest(REFRESH)) {
        void load(table, state, root);
        return;
      }
      if (target.closest(CREATE)) {
        openEditor(root, editor, fields, state, null);
        return;
      }
      if (target.closest(CLOSE_EDITOR) || target.closest(CANCEL)) {
        closeEditor(root, editor, state);
        return;
      }
      if (target.closest(SAVE)) {
        void handleSave(table, state, root, editor, fields);
        return;
      }
      if (target.closest(DELETE) && state.editing) {
        void handleDelete(table, state, state.editing);
      }
    });
    table.addEventListener("wpd-table-row-click", (e) => {
      const row = e.detail?.row;
      if (row) {
        openEditor(root, editor, fields, state, row);
      }
    });
    void load(table, state, root);
  }
  async function load(table, state, root) {
    const seq = ++state.loadSeq;
    table.toggleAttribute("loading", true);
    setRootNotice(root, "");
    try {
      const [schedules, events] = await Promise.all([
        fetchSchedules(),
        fetchEvents()
      ]);
      if (seq !== state.loadSeq) {
        return;
      }
      state.schedules = schedules.schedules;
      state.events = events.events;
      populateFilter(root, state);
      const editor = root.querySelector(EDITOR);
      if (editor) {
        populateScheduleSelect(editor, state, "");
      }
      table.data = filterEvents(state);
    } catch (err) {
      if (seq === state.loadSeq) {
        console.error("[cron-manager] load failed", err);
        setRootNotice(root, err.message || String(err));
        table.data = [];
      }
    } finally {
      if (seq === state.loadSeq) {
        table.toggleAttribute("loading", false);
      }
    }
  }
  function filterEvents(state) {
    const q = state.search.trim().toLowerCase();
    return state.events.filter((event) => {
      if (state.filter === SINGLE_FILTER && event.schedule !== "") {
        return false;
      }
      if (state.filter && state.filter !== SINGLE_FILTER && event.schedule !== state.filter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return [
        event.hook,
        event.schedule,
        event.scheduleDisplay,
        event.argsSummary
      ].join(" ").toLowerCase().includes(q);
    });
  }
  function populateFilter(root, state) {
    const select = root.querySelector(FILTER);
    if (!select) {
      return;
    }
    select.innerHTML = `<wpd-option value="">${escapeHtml(__("All schedules"))}</wpd-option><wpd-option value="${SINGLE_FILTER}">${escapeHtml(__("One time"))}</wpd-option>` + state.schedules.map(
      (s) => `<wpd-option value="${escapeAttr(s.slug)}">${escapeHtml(
        s.display
      )}</wpd-option>`
    ).join("");
    setControlValue(select, state.filter);
  }
  function populateScheduleSelect(editor, state, value) {
    const select = editor.querySelector(
      '[data-wpdm-cron-manager-field="schedule"]'
    );
    if (!select) {
      return;
    }
    select.innerHTML = `<wpd-option value="">${escapeHtml(__("One time"))}</wpd-option>` + state.schedules.map(
      (s) => `<wpd-option value="${escapeAttr(s.slug)}">${escapeHtml(
        s.display
      )} (${s.interval}s)</wpd-option>`
    ).join("") + `<wpd-option value="${CUSTOM_VALUE}">${escapeHtml(
      __("Custom interval")
    )}</wpd-option>`;
    setControlValue(select, value);
    toggleCustomSchedule(editor, value === CUSTOM_VALUE);
  }
  function openEditor(root, editor, fields, state, event) {
    state.editing = event;
    root.classList.add("wpdm-cron-manager--editing");
    editor.hidden = false;
    setEditorNotice(editor, "");
    const title = editor.querySelector(EDITOR_TITLE);
    if (title) {
      title.textContent = event ? __("Edit cron job") : __("Create cron job");
    }
    populateScheduleSelect(editor, state, event?.schedule ?? "");
    setControlValue(fields.hook, event?.hook ?? "");
    setInputValue(
      fields.timestamp,
      toDatetimeLocal(event?.timestamp ?? Math.ceil(Date.now() / 1e3) + 300)
    );
    setControlValue(fields.customSlug, "");
    setControlValue(fields.customInterval, "300");
    setControlValue(fields.customDisplay, "");
    setTextareaValue(fields.args, event?.argsJson || "[]");
    if (fields.args) {
      fields.args.disabled = event?.argsEditable === false;
    }
    if (event?.argsEditable === false) {
      setEditorNotice(
        editor,
        __(
          "This event has args that cannot be represented as JSON. You can change its hook, time, and recurrence; the original args will be preserved."
        )
      );
    }
    const del = editor.querySelector(DELETE);
    if (del) {
      del.hidden = !event;
    }
  }
  function closeEditor(root, editor, state) {
    state.editing = null;
    editor.hidden = true;
    root.classList.remove("wpdm-cron-manager--editing");
    setEditorNotice(editor, "");
  }
  async function handleSave(table, state, root, editor, fields) {
    setEditorNotice(editor, "");
    let payload;
    try {
      payload = buildPayload(fields, state.editing);
    } catch (err) {
      setEditorNotice(editor, err.message || String(err));
      return;
    }
    table.toggleAttribute("loading", true);
    try {
      const result = state.editing ? await updateEvent(state.editing.identity, payload) : await createEvent(payload);
      state.events = result.events;
      table.data = filterEvents(state);
      closeEditor(root, editor, state);
    } catch (err) {
      console.error("[cron-manager] save failed", err);
      setEditorNotice(editor, err.message || String(err));
    } finally {
      table.toggleAttribute("loading", false);
    }
  }
  async function handleDelete(table, state, event) {
    const ok = window.confirm(
      sprintf(
        /* translators: %s: cron hook. */
        __('Delete cron job "%s"?'),
        event.hook
      )
    );
    if (!ok) {
      return;
    }
    table.toggleAttribute("loading", true);
    try {
      const result = await deleteEvent(event.identity);
      state.events = result.events;
      table.data = filterEvents(state);
    } catch (err) {
      console.error("[cron-manager] delete failed", err);
      window.alert(err.message || String(err));
    } finally {
      table.toggleAttribute("loading", false);
    }
  }
  async function handleRunNow(table, state, root, event) {
    showFeedback(
      root,
      sprintf(
        /* translators: %s: cron hook. */
        __('Running "%s"…'),
        event.hook
      )
    );
    try {
      const result = await runEventNow(event.identity);
      state.events = result.events;
      table.data = filterEvents(state);
      showFeedback(
        root,
        sprintf(
          /* translators: %s: cron hook. */
          __('Ran "%s". Cron list refreshed.'),
          event.hook
        )
      );
    } catch (err) {
      console.error("[cron-manager] run-now failed", err);
      showFeedback(root, err.message || String(err), "error");
      window.alert(err.message || String(err));
    }
  }
  function buildPayload(fields, editing) {
    const hook = getControlValue(fields.hook).trim();
    if (!hook) {
      throw new Error(__("Hook is required."));
    }
    const timestamp = parseDatetimeLocal(fields.timestamp?.value ?? "");
    if (timestamp <= 0) {
      throw new Error(__("Next run is required."));
    }
    const scheduleValue = getControlValue(fields.schedule);
    const payload = {
      hook,
      timestamp,
      schedule: scheduleValue === CUSTOM_VALUE ? "" : scheduleValue
    };
    if (scheduleValue === CUSTOM_VALUE) {
      const slug = getControlValue(fields.customSlug).trim();
      const interval = Number(getControlValue(fields.customInterval));
      const display = getControlValue(fields.customDisplay).trim();
      if (!slug) {
        throw new Error(__("Custom schedule slug is required."));
      }
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new Error(__("Custom interval must be greater than zero."));
      }
      payload.customSchedule = { slug, interval, display };
    }
    if (!editing || editing.argsEditable) {
      payload.args = parseArgs(fields.args?.value ?? "");
    }
    return payload;
  }
  function parseArgs(raw) {
    const text = raw.trim();
    if (!text) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(__("Args must be valid JSON."));
    }
    if (!Array.isArray(parsed) && !isPlainObject(parsed)) {
      throw new Error(__("Args must be a JSON array or object."));
    }
    return parsed;
  }
  function isPlainObject(value) {
    return !!value && typeof value === "object" && value.constructor === Object;
  }
  function getFields(editor) {
    const field = (name) => editor.querySelector(
      `[data-wpdm-cron-manager-field="${name}"]`
    );
    return {
      hook: field("hook"),
      timestamp: field("timestamp"),
      schedule: field("schedule"),
      customSlug: field("customSlug"),
      customInterval: field("customInterval"),
      customDisplay: field("customDisplay"),
      args: field("args")
    };
  }
  function toggleCustomSchedule(editor, visible) {
    const custom = editor.querySelector(CUSTOM_SCHEDULE);
    if (custom) {
      custom.hidden = !visible;
    }
  }
  function setRootNotice(root, message) {
    const editor = root.querySelector(EDITOR);
    if (editor) {
      setEditorNotice(editor, message);
    }
  }
  function showFeedback(root, message, type = "success") {
    const el = root.querySelector(FEEDBACK);
    if (!el) {
      return;
    }
    const previous = feedbackTimers.get(root);
    if (previous) {
      window.clearTimeout(previous);
    }
    el.textContent = message;
    el.dataset.type = type;
    el.hidden = false;
    const timer = window.setTimeout(() => {
      el.hidden = true;
      feedbackTimers.delete(root);
    }, 4500);
    feedbackTimers.set(root, timer);
  }
  function setEditorNotice(editor, message) {
    const notice = editor.querySelector(NOTICE);
    if (!notice) {
      return;
    }
    notice.textContent = message;
    notice.hidden = !message;
  }
  function getControlValue(el) {
    if (!el) {
      return "";
    }
    const withValue = el;
    if (withValue.value !== void 0 && withValue.value !== null) {
      return String(withValue.value);
    }
    return el.getAttribute("value") ?? "";
  }
  function setControlValue(el, value) {
    if (!el) {
      return;
    }
    el.value = value;
    if (value === "") {
      el.removeAttribute("value");
    } else {
      el.setAttribute("value", value);
    }
  }
  function setInputValue(input, value) {
    if (input) {
      input.value = value;
    }
  }
  function setTextareaValue(textarea, value) {
    if (textarea) {
      textarea.value = value;
    }
  }
  function toDatetimeLocal(timestamp) {
    const d = new Date(timestamp * 1e3);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function parseDatetimeLocal(value) {
    if (!value) {
      return 0;
    }
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1e3) : 0;
  }
  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function escapeAttr(value) {
    return escapeHtml(value);
  }
  const registry = window.wpDesktopNativeWindows ?? (window.wpDesktopNativeWindows = {});
  registry["wpdm-cron-manager"] = (body) => {
    renderCronManager(body);
  };
  exports.renderCronManager = renderCronManager;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
