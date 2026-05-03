(function() {
  "use strict";
  class RestError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  function cfg() {
    const c = window.wpDesktopRoutinesConfig;
    if (!c) {
      throw new RestError(0, "no_config", "Routines config missing.");
    }
    return c;
  }
  async function request(url, init = {}) {
    const c = cfg();
    const headers = new Headers(init.headers);
    headers.set("X-WP-Nonce", c.restNonce);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const j = json;
      throw new RestError(
        res.status,
        j?.code ?? `http_${res.status}`,
        j?.message ?? `Request failed (${res.status})`
      );
    }
    return json;
  }
  function listRoutines() {
    return request(cfg().rootUrl);
  }
  function createRoutine(body) {
    return request(cfg().rootUrl, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  function updateRoutine(id, body) {
    return request(`${cfg().rootUrl}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  }
  function deleteRoutine(id) {
    return request(`${cfg().rootUrl}/${id}`, { method: "DELETE" });
  }
  function testRoutine(id, payload) {
    return request(`${cfg().rootUrl}/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ payload })
    });
  }
  function runRoutine(id, payload) {
    return request(`${cfg().rootUrl}/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ payload })
    });
  }
  function setEnabled(id, enabled) {
    return request(`${cfg().rootUrl}/${id}/enable`, {
      method: "POST",
      body: JSON.stringify({ enabled })
    });
  }
  function listRuns(id, limit = 50) {
    return request(`${cfg().rootUrl}/${id}/runs?limit=${limit}`);
  }
  function fetchCatalog() {
    return request(cfg().catalogUrl);
  }
  function fetchTemplates() {
    return request(cfg().templatesUrl);
  }
  function installTemplate(templateId, title) {
    return request(cfg().fromTemplateUrl, {
      method: "POST",
      body: JSON.stringify({ template_id: templateId, title })
    });
  }
  const ROOT = "[data-wpdm-routines-root]";
  const LIST = "[data-wpdm-routines-list]";
  const MAIN = "[data-wpdm-routines-main]";
  const NEW_BTN = "[data-wpdm-routines-new]";
  const TEMPLATES_BTN = "[data-wpdm-routines-templates]";
  const state = {
    routines: [],
    catalog: null,
    selectedId: null,
    dirty: false
  };
  const EMPTY_DEF = {
    version: 1,
    trigger: { kind: "hook", id: "publish_post", priority: 10 },
    conditions: [],
    steps: [
      {
        kind: "log",
        id: "log_it",
        args: { level: "info", message: "Routine fired: {{payload.post.title}}" }
      }
    ],
    run_as: "author",
    settings: {
      rate_limit: { max: 0, per_seconds: 60 },
      timeout_ms: 5e3,
      stop_on_error: true
    }
  };
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    const { class: className, dataset, ...rest } = props;
    if (className) {
      node.className = className;
    }
    if (dataset) {
      for (const [k, v] of Object.entries(dataset)) {
        node.dataset[k] = v;
      }
    }
    Object.assign(node, rest);
    for (const child of children) {
      node.append(child);
    }
    return node;
  }
  async function loadAll() {
    const [list, catalog] = await Promise.all([
      listRoutines(),
      fetchCatalog()
    ]);
    state.routines = list.items;
    state.catalog = catalog;
  }
  function renderList(body) {
    const list = body.querySelector(LIST);
    if (!list) {
      return;
    }
    list.replaceChildren();
    if (state.routines.length === 0) {
      list.append(
        el("p", { class: "wpdm-routines__list-empty" }, [
          "No routines yet — start from a template."
        ])
      );
      return;
    }
    for (const routine of state.routines) {
      const row = el("button", {
        class: "wpdm-routines__list-item" + (state.selectedId === routine.id ? " is-selected" : ""),
        type: "button",
        dataset: { id: String(routine.id) }
      });
      const title = el("span", { class: "wpdm-routines__list-title" });
      title.textContent = routine.title;
      const meta = el("span", { class: "wpdm-routines__list-meta" });
      meta.textContent = `${routine.def.trigger.id} • ${routine.stats.runs} runs`;
      const dot = el("span", {
        class: "wpdm-routines__list-dot" + (routine.enabled ? " is-on" : "")
      });
      dot.title = routine.enabled ? "Enabled" : "Disabled";
      row.append(dot, title, meta);
      row.addEventListener("click", () => {
        if (state.dirty && !confirm("Discard unsaved changes?")) {
          return;
        }
        state.selectedId = routine.id;
        state.dirty = false;
        renderList(body);
        renderEditor(body);
      });
      list.append(row);
    }
  }
  function renderEditor(body) {
    const main = body.querySelector(MAIN);
    if (!main) {
      return;
    }
    main.replaceChildren();
    const routine = state.selectedId !== null ? state.routines.find((r) => r.id === state.selectedId) : null;
    if (!routine) {
      main.append(
        el("div", { class: "wpdm-routines__empty" }, [
          el(
            "p",
            {},
            ["Pick a routine on the left, or start from a template."]
          )
        ])
      );
      return;
    }
    main.append(buildEditorPanel(body, routine));
  }
  function buildEditorPanel(body, routine) {
    const panel = el("section", { class: "wpdm-routines__editor" });
    const header = el("header", { class: "wpdm-routines__editor-header" });
    const titleField = el("input", {
      class: "wpdm-routines__title-field",
      type: "text",
      value: routine.title
    });
    titleField.addEventListener("input", () => {
      state.dirty = true;
    });
    const enabledLabel = el("label", { class: "wpdm-routines__enable" });
    const enabledInput = el("input", { type: "checkbox" });
    enabledInput.checked = routine.enabled;
    enabledInput.addEventListener("change", async () => {
      try {
        const updated = await setEnabled(routine.id, enabledInput.checked);
        Object.assign(routine, updated);
        renderList(body);
      } catch (err) {
        alert(describeError(err));
        enabledInput.checked = !enabledInput.checked;
      }
    });
    enabledLabel.append(enabledInput, document.createTextNode(" Enabled"));
    header.append(titleField, enabledLabel);
    const editorWrap = el("div", { class: "wpdm-routines__json-wrap" });
    const editorLabel = el(
      "label",
      { class: "wpdm-routines__json-label" },
      ["Definition (JSON)"]
    );
    const editor = el("textarea", {
      class: "wpdm-routines__json",
      spellcheck: false
    });
    editor.value = JSON.stringify(routine.def, null, 2);
    editor.addEventListener("input", () => {
      state.dirty = true;
    });
    editorWrap.append(editorLabel, editor);
    const validation = el("p", { class: "wpdm-routines__validation" });
    const bar = el("div", { class: "wpdm-routines__action-bar" });
    const saveBtn = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--primary",
      type: "button"
    }, ["Save"]);
    const testBtn = el("button", {
      class: "wpdm-routines__btn",
      type: "button"
    }, ["Test (dry-run)"]);
    const runBtn = el("button", {
      class: "wpdm-routines__btn",
      type: "button"
    }, ["Run now"]);
    const deleteBtn = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--danger",
      type: "button"
    }, ["Delete"]);
    bar.append(saveBtn, testBtn, runBtn, deleteBtn);
    const out = el("div", { class: "wpdm-routines__output" });
    const history = el("section", { class: "wpdm-routines__history" });
    const historyTitle = el("h4", {}, ["Recent runs"]);
    const historyList = el("div", { class: "wpdm-routines__history-list" });
    history.append(historyTitle, historyList);
    saveBtn.addEventListener("click", async () => {
      const def = parseJson(editor.value, validation);
      if (!def) {
        return;
      }
      try {
        const updated = await updateRoutine(routine.id, {
          title: titleField.value,
          def
        });
        Object.assign(routine, updated);
        state.dirty = false;
        validation.textContent = "Saved.";
        validation.className = "wpdm-routines__validation is-success";
        renderList(body);
      } catch (err) {
        validation.textContent = describeError(err);
        validation.className = "wpdm-routines__validation is-error";
      }
    });
    testBtn.addEventListener("click", async () => {
      const def = parseJson(editor.value, validation);
      if (!def) {
        return;
      }
      const trig = state.catalog?.triggers.find(
        (t) => t.id === def.trigger.id
      );
      const payload = trig?.sample_payload ?? {};
      try {
        await updateRoutine(routine.id, {
          title: titleField.value,
          def
        });
        const result = await testRoutine(routine.id, payload);
        renderRunResult(out, result);
      } catch (err) {
        out.textContent = describeError(err);
      }
    });
    runBtn.addEventListener("click", async () => {
      if (!confirm(
        "Run the routine for real? Side effects (emails, HTTP) will execute."
      )) {
        return;
      }
      const trig = state.catalog?.triggers.find(
        (t) => t.id === routine.def.trigger.id
      );
      const payload = trig?.sample_payload ?? {};
      try {
        const result = await runRoutine(routine.id, payload);
        renderRunResult(out, result);
        void refreshHistory(routine.id, historyList);
      } catch (err) {
        out.textContent = describeError(err);
      }
    });
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete "${routine.title}"? This cannot be undone.`)) {
        return;
      }
      try {
        await deleteRoutine(routine.id);
        state.routines = state.routines.filter(
          (r) => r.id !== routine.id
        );
        state.selectedId = null;
        state.dirty = false;
        renderList(body);
        renderEditor(body);
      } catch (err) {
        alert(describeError(err));
      }
    });
    panel.append(header, editorWrap, validation, bar, out, history);
    void refreshHistory(routine.id, historyList);
    return panel;
  }
  function parseJson(source, statusEl) {
    try {
      const parsed = JSON.parse(source);
      statusEl.textContent = "";
      statusEl.className = "wpdm-routines__validation";
      return parsed;
    } catch (err) {
      statusEl.textContent = `Invalid JSON: ${err.message}`;
      statusEl.className = "wpdm-routines__validation is-error";
      return null;
    }
  }
  function describeError(err) {
    if (err instanceof RestError) {
      return `${err.code} (${err.status}): ${err.message}`;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
  function renderRunResult(out, result) {
    out.replaceChildren();
    const head = el(
      "div",
      {
        class: `wpdm-routines__result wpdm-routines__result--${result.status}`
      },
      [`${result.status.toUpperCase()} in ${result.duration_ms}ms`]
    );
    out.append(head);
    if (result.error) {
      const err = el("pre", { class: "wpdm-routines__error" });
      err.textContent = result.error;
      out.append(err);
    }
    const log = el("ol", { class: "wpdm-routines__log" });
    for (const entry of result.steps_log) {
      const li = el("li", {
        class: entry.ok ? "wpdm-routines__log-ok" : "wpdm-routines__log-fail"
      });
      li.textContent = `${entry.kind} ${entry.id || ""} — ${entry.ms}ms${entry.error ? ` — ${entry.error}` : ""}${entry.branch ? ` [${entry.branch}]` : ""}`;
      log.append(li);
    }
    out.append(log);
  }
  async function refreshHistory(routineId, listNode) {
    listNode.replaceChildren(document.createTextNode("Loading…"));
    try {
      const { items } = await listRuns(routineId, 20);
      listNode.replaceChildren();
      if (items.length === 0) {
        listNode.append(
          el("p", { class: "wpdm-routines__history-empty" }, [
            "No runs yet."
          ])
        );
        return;
      }
      for (const r of items) {
        const row = el("div", {
          class: `wpdm-routines__history-row wpdm-routines__history-row--${r.status}`
        });
        row.textContent = `${r.started_at} — ${r.status} — ${r.duration_ms}ms${r.error ? ` — ${r.error}` : ""}`;
        listNode.append(row);
      }
    } catch (err) {
      listNode.replaceChildren(
        document.createTextNode(describeError(err))
      );
    }
  }
  async function openTemplatesPicker(body) {
    const dialog = el("div", { class: "wpdm-routines__modal" });
    const card = el("div", { class: "wpdm-routines__modal-card" });
    card.append(
      el("h3", {}, ["Browse templates"]),
      el(
        "p",
        { class: "wpdm-routines__modal-hint" },
        [
          "Each template installs as a disabled routine — review the JSON, then enable when you’re ready."
        ]
      )
    );
    const list = el("div", { class: "wpdm-routines__template-list" });
    card.append(list);
    const close = el("button", { class: "wpdm-routines__btn", type: "button" }, ["Close"]);
    close.addEventListener("click", () => dialog.remove());
    card.append(close);
    dialog.append(card);
    body.append(dialog);
    try {
      const { items } = await fetchTemplates();
      if (items.length === 0) {
        list.textContent = "No templates registered yet.";
        return;
      }
      for (const tpl of items) {
        list.append(renderTemplateCard(body, tpl, dialog));
      }
    } catch (err) {
      list.textContent = describeError(err);
    }
  }
  function renderTemplateCard(body, tpl, dialog) {
    const card = el("article", { class: "wpdm-routines__template-card" });
    const title = el("h4", {});
    title.textContent = tpl.title;
    const desc = el("p", {});
    desc.textContent = tpl.description;
    const meta = el("p", { class: "wpdm-routines__template-meta" });
    meta.textContent = `${tpl.group} • trigger: ${tpl.def.trigger.id}`;
    const install = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--primary",
      type: "button"
    }, ["Install"]);
    install.addEventListener("click", async () => {
      try {
        const created = await installTemplate(tpl.id);
        state.routines = [created, ...state.routines];
        state.selectedId = created.id;
        renderList(body);
        renderEditor(body);
        dialog.remove();
      } catch (err) {
        alert(describeError(err));
      }
    });
    card.append(title, meta, desc, install);
    return card;
  }
  async function createBlankRoutine(body) {
    try {
      const created = await createRoutine({
        title: "Untitled routine",
        enabled: false,
        def: structuredClone(EMPTY_DEF)
      });
      state.routines = [created, ...state.routines];
      state.selectedId = created.id;
      renderList(body);
      renderEditor(body);
    } catch (err) {
      alert(describeError(err));
    }
  }
  async function renderRoutinesWindow(body) {
    const root = body.querySelector(ROOT);
    if (!root) {
      return;
    }
    const newBtn = body.querySelector(NEW_BTN);
    newBtn?.addEventListener("click", () => createBlankRoutine(body));
    const tplBtn = body.querySelector(TEMPLATES_BTN);
    tplBtn?.addEventListener("click", () => openTemplatesPicker(body));
    try {
      await loadAll();
    } catch (err) {
      const main = body.querySelector(MAIN);
      if (main) {
        main.replaceChildren();
        main.append(
          el("p", { class: "wpdm-routines__validation is-error" }, [
            describeError(err)
          ])
        );
      }
      return;
    }
    if (state.selectedId === null && state.routines.length > 0) {
      state.selectedId = state.routines[0].id;
    }
    renderList(body);
    renderEditor(body);
  }
  window.wpDesktopNativeWindows = window.wpDesktopNativeWindows ?? {};
  window.wpDesktopNativeWindows["wpdm-routines"] = (body) => {
    void renderRoutinesWindow(body);
  };
})();
