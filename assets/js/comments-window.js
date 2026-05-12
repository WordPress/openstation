(function() {
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
  const NONCE_HEADER = "X-WP-Nonce";
  function injectRestNonce(input, init) {
    const nonce = readRestNonce();
    if (!nonce) {
      return init;
    }
    const url = resolveUrl(input);
    if (!url || !isSameOriginRestUrl(url)) {
      return init;
    }
    const baseHeaders = init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : void 0);
    const headers = new Headers(baseHeaders ?? {});
    if (headers.has(NONCE_HEADER)) {
      return init;
    }
    headers.set(NONCE_HEADER, nonce);
    return { ...init ?? {}, headers };
  }
  function readRestNonce() {
    if (typeof window === "undefined") {
      return void 0;
    }
    const cfg = window.desktopModeConfig;
    const value = cfg?.restNonce;
    return typeof value === "string" && value.length > 0 ? value : void 0;
  }
  function resolveUrl(input) {
    try {
      const base = typeof window !== "undefined" && window.location ? window.location.href : void 0;
      if (typeof input === "string") {
        return new URL(input, base);
      }
      if (input instanceof URL) {
        return input;
      }
      if (typeof Request !== "undefined" && input instanceof Request) {
        return new URL(input.url, base);
      }
      return null;
    } catch {
      return null;
    }
  }
  function isSameOriginRestUrl(url) {
    if (typeof window === "undefined" || !window.location || url.origin !== window.location.origin) {
      return false;
    }
    if (url.pathname.includes("/wp-json/")) {
      return true;
    }
    if (url.searchParams.has("rest_route")) {
      return true;
    }
    return false;
  }
  function trackedFetch(input, init, opts = {}) {
    const fn = window.wp?.desktop?.fetch;
    if (typeof fn === "function") {
      return fn(input, init, opts);
    }
    const finalInit = injectRestNonce(input, init);
    return fetch(input, finalInit);
  }
  const HIGHLIGHTS = [
    {
      icon: "dashicons-yes-alt",
      title: __("Triage in one place"),
      body: __(
        "Pending / All / Spam / Trash / Mine tabs — every status surface in a single window with live counts."
      )
    },
    {
      icon: "dashicons-controls-repeat",
      title: __("Bulk moderation with undo"),
      body: __(
        "Multi-select and approve, spam, or trash dozens at once. Every action shows an 8-second undo toast."
      )
    },
    {
      icon: "dashicons-format-chat",
      title: __("Inline reply"),
      body: __(
        "Reply right inside the row — no modal, no full-page navigation. Press R on any row to jump straight to the editor."
      )
    },
    {
      icon: "dashicons-warning",
      title: __("Spam confidence score"),
      body: __(
        "Every comment gets a 0–100 score from Akismet + heuristics. Optionally turn on AI scoring in OS Settings → Features so each new comment is also scored by your configured AI provider on arrival."
      )
    },
    {
      icon: "dashicons-admin-users",
      title: __("Author insights drawer"),
      body: __(
        "Click an avatar to see the author's full history — total comments, spam rate, first seen, and one-click block."
      )
    },
    {
      icon: "dashicons-keyboard-hide",
      title: __("Keyboard moderation"),
      body: __(
        "J/K to navigate, A approve, S spam, D trash, R reply, E edit, U undo. Press ? any time for the cheat sheet."
      )
    }
  ];
  async function showCommentsIntroDialog() {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "wpd-intro-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "wpd-intro wpd-intro--comments";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "wpd-comments-intro-title");
      dialog.tabIndex = -1;
      backdrop.appendChild(dialog);
      const titleEl = document.createElement("h2");
      titleEl.id = "wpd-comments-intro-title";
      titleEl.className = "wpd-intro__title";
      titleEl.textContent = __("Welcome to the new Comments");
      dialog.appendChild(titleEl);
      const lede = document.createElement("p");
      lede.className = "wpd-intro__lede";
      lede.textContent = __(
        "A moderation surface built around how you actually triage: bulk actions with undo, an inline reply editor, keyboard shortcuts, and a spam score that surfaces the obvious junk first."
      );
      dialog.appendChild(lede);
      const grid = document.createElement("div");
      grid.className = "wpd-intro__grid";
      HIGHLIGHTS.forEach((h) => {
        const card = document.createElement("div");
        card.className = "wpd-intro__card";
        const icon = document.createElement("span");
        icon.className = `dashicons ${h.icon} wpd-intro__card-icon`;
        icon.setAttribute("aria-hidden", "true");
        const heading = document.createElement("h3");
        heading.className = "wpd-intro__card-title";
        heading.textContent = h.title;
        const body = document.createElement("p");
        body.className = "wpd-intro__card-body";
        body.textContent = h.body;
        card.append(icon, heading, body);
        grid.appendChild(card);
      });
      dialog.appendChild(grid);
      const escape = document.createElement("p");
      escape.className = "wpd-intro__escape";
      escape.textContent = __(
        "Prefer the classic Comments screen? You can switch back any time from OS Settings → Features."
      );
      dialog.appendChild(escape);
      const actions = document.createElement("div");
      actions.className = "wpd-intro__actions";
      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "wpd-intro__btn wpd-intro__btn--secondary";
      settingsBtn.textContent = __("Take me to settings");
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "wpd-intro__btn wpd-intro__btn--primary";
      confirmBtn.textContent = __("Let me moderate");
      actions.append(settingsBtn, confirmBtn);
      dialog.appendChild(actions);
      document.body.appendChild(backdrop);
      const cleanup = (result) => {
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup("cancel");
        }
      };
      document.addEventListener("keydown", onKey);
      confirmBtn.addEventListener("click", () => cleanup("confirm"));
      settingsBtn.addEventListener("click", () => cleanup("settings"));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          cleanup("cancel");
        }
      });
      requestAnimationFrame(() => dialog.focus());
    });
  }
  function statusForTab(tab) {
    switch (tab) {
      case "pending":
        return "hold";
      case "all":
        return "approve";
      case "spam":
        return "spam";
      case "trash":
        return "trash";
      case "mine":
        return "approve,hold,spam";
    }
  }
  let activeWindowId = "desktop-mode-comments";
  function setActiveWindowId(id) {
    activeWindowId = id;
  }
  let activeConfig = null;
  function setActiveConfig(config) {
    activeConfig = config;
  }
  function getActiveConfig() {
    return activeConfig;
  }
  function authHeaders(cfg) {
    return {
      "X-WP-Nonce": cfg.restNonce,
      "Content-Type": "application/json"
    };
  }
  async function fetchComments(cfg, params) {
    const url = new URL(cfg.commentsUrl);
    const qa = cfg.queryArgs ?? {};
    Object.entries(qa).forEach(([k, v]) => {
      if (k === "status") {
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((item) => url.searchParams.append(k, String(item)));
      } else if (v !== null && v !== void 0) {
        url.searchParams.set(k, String(v));
      }
    });
    url.searchParams.set("status", statusForTab(params.tab));
    url.searchParams.set("page", String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.search && params.search.trim() !== "") {
      url.searchParams.set("search", params.search.trim());
    }
    if (params.tab === "mine" && params.currentUserId > 0) {
      url.searchParams.set("author", String(params.currentUserId));
    }
    const response = await trackedFetch(
      url.toString(),
      {
        method: "GET",
        credentials: "same-origin",
        headers: authHeaders(cfg)
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/list"
      }
    );
    if (!response.ok) {
      throw new Error(`Comments list failed: ${response.status}`);
    }
    const rows = await response.json();
    const total = parseInt(
      response.headers.get("X-WP-Total") ?? String(rows.length),
      10
    );
    const totalPages = parseInt(
      response.headers.get("X-WP-TotalPages") ?? "1",
      10
    );
    return { rows, total, totalPages };
  }
  async function bulkModerate(cfg, ids, action) {
    const response = await trackedFetch(
      cfg.bulkUrl,
      {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(cfg),
        body: JSON.stringify({ ids, action })
      },
      {
        windowId: activeWindowId,
        source: `desktop-mode/comments/bulk/${action}`
      }
    );
    if (!response.ok) {
      throw new Error(`Bulk action ${action} failed: ${response.status}`);
    }
    return await response.json();
  }
  async function updateCommentContent(cfg, id, content) {
    const url = `${cfg.commentsUrl}/${id}`;
    const response = await trackedFetch(
      url,
      {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(cfg),
        body: JSON.stringify({ content })
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/edit"
      }
    );
    if (!response.ok) {
      throw new Error(`Comment edit failed: ${response.status}`);
    }
    return await response.json();
  }
  async function postReply(cfg, parentId, content) {
    const response = await trackedFetch(
      cfg.replyUrl,
      {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(cfg),
        body: JSON.stringify({ parent: parentId, content })
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/reply"
      }
    );
    if (!response.ok) {
      throw new Error(`Reply failed: ${response.status}`);
    }
    return await response.json();
  }
  async function fetchAuthorInsights(cfg, email) {
    const url = `${cfg.insightsUrlBase}${encodeURIComponent(email)}`;
    const response = await trackedFetch(
      url,
      {
        method: "GET",
        credentials: "same-origin",
        headers: authHeaders(cfg)
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/insights"
      }
    );
    if (!response.ok) {
      throw new Error(`Insights failed: ${response.status}`);
    }
    return await response.json();
  }
  async function fetchCounts(cfg) {
    const response = await trackedFetch(
      cfg.countsUrl,
      {
        method: "GET",
        credentials: "same-origin",
        headers: authHeaders(cfg)
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/counts",
        silent: true
      }
    );
    if (!response.ok) {
      throw new Error(`Counts failed: ${response.status}`);
    }
    return await response.json();
  }
  async function fetchReplies(cfg, parentId) {
    const url = new URL(cfg.commentsUrl);
    url.searchParams.set("parent", String(parentId));
    url.searchParams.set("per_page", "50");
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "asc");
    url.searchParams.set("status", "approve,hold");
    const response = await trackedFetch(
      url.toString(),
      {
        method: "GET",
        credentials: "same-origin",
        headers: authHeaders(cfg)
      },
      {
        windowId: activeWindowId,
        source: "desktop-mode/comments/replies"
      }
    );
    if (!response.ok) {
      throw new Error(`Replies fetch failed: ${response.status}`);
    }
    return await response.json();
  }
  function getApi() {
    return window.wp?.desktop;
  }
  function showToast(message, duration = 4e3, actions) {
    const api = getApi();
    if (api?.showToast) {
      api.showToast({ message, duration, actions });
      return;
    }
    console.info("[comments-window]", message);
  }
  function publish(channel, payload) {
    getApi()?.activity?.publish?.(channel, payload);
  }
  function updateDockBadge(count) {
    const api = getApi();
    api?.dock?.setBadge?.("desktop-mode-comments", count);
    api?.taskbar?.setBadge?.("desktop-mode-comments", count);
    api?.icons?.setBadge?.("desktop-mode-comments", count);
  }
  function readConfig() {
    const cfg = window;
    const fromShared = cfg.desktopModeWindowConfig?.["desktop-mode-comments"];
    if (fromShared) {
      return fromShared;
    }
    const fromLazy = cfg.desktopModeNativeWindowConfig?.["desktop-mode-comments"];
    return fromLazy ?? null;
  }
  function spamChipFor(row) {
    const score = Math.max(0, Math.min(100, row.desktop_mode_spam_score));
    const chip = document.createElement("span");
    chip.className = "desktop-mode-comments__spam-chip";
    chip.dataset.score = String(score);
    let tone = "low";
    if (score >= 70) {
      tone = "high";
    } else if (score >= 40) {
      tone = "medium";
    }
    chip.dataset.tone = tone;
    if (row.desktop_mode_ai_verdict) {
      chip.dataset.ai = "1";
    }
    chip.textContent = String(score);
    const notes = [];
    if (row.desktop_mode_akismet === "true") {
      notes.push(__("Akismet flagged this comment as spam."));
    } else if (row.desktop_mode_akismet === "false") {
      notes.push(__("Akismet cleared this comment."));
    }
    const verdict = row.desktop_mode_ai_verdict;
    if (verdict) {
      if (verdict.spam) {
        notes.push(__("AI: looks like promotional spam."));
      }
      if (verdict.harmful) {
        notes.push(__("AI: hostile / abusive tone."));
      }
      if (!verdict.spam && !verdict.harmful) {
        notes.push(__("AI: looks safe."));
      }
      if (verdict.summary) {
        notes.push(verdict.summary);
      }
    }
    chip.title = notes.length > 0 ? sprintf(
      /* translators: 1: spam score 0–100, 2: extra moderation notes. */
      __("Spam score: %1$d / 100. %2$s"),
      score,
      notes.join(" ")
    ) : sprintf(
      /* translators: %d: spam score 0–100. */
      __("Spam score: %d / 100."),
      score
    );
    return chip;
  }
  function mountRichEditor(placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-mode-comments__reply";
    const toolbar = document.createElement("div");
    toolbar.className = "desktop-mode-comments__reply-toolbar";
    const cmds = [
      { cmd: "bold", icon: "dashicons-editor-bold", label: __("Bold") },
      { cmd: "italic", icon: "dashicons-editor-italic", label: __("Italic") },
      { cmd: "insertUnorderedList", icon: "dashicons-editor-ul", label: __("Bulleted list") },
      { cmd: "insertOrderedList", icon: "dashicons-editor-ol", label: __("Numbered list") }
    ];
    cmds.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "desktop-mode-comments__reply-tool";
      btn.title = c.label;
      btn.setAttribute("aria-label", c.label);
      btn.innerHTML = `<span class="dashicons ${c.icon}" aria-hidden="true"></span>`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        document.execCommand(c.cmd);
        editable.focus();
      });
      toolbar.appendChild(btn);
    });
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "desktop-mode-comments__reply-tool";
    linkBtn.title = __("Wrap selection in a link");
    linkBtn.setAttribute("aria-label", __("Wrap selection in a link"));
    linkBtn.innerHTML = '<span class="dashicons dashicons-admin-links" aria-hidden="true"></span>';
    linkBtn.addEventListener("mousedown", (e) => e.preventDefault());
    linkBtn.addEventListener("click", () => {
      const selection = editable.ownerDocument.getSelection?.()?.toString().trim() ?? "";
      if (/^https?:\/\//i.test(selection)) {
        document.execCommand("createLink", false, selection);
      } else {
        showToast(
          __("Select a full URL (https://…) in your reply, then click the link button.")
        );
      }
    });
    toolbar.appendChild(linkBtn);
    const editable = document.createElement("div");
    editable.className = "desktop-mode-comments__reply-input";
    editable.contentEditable = "true";
    editable.setAttribute("role", "textbox");
    editable.setAttribute("aria-multiline", "true");
    editable.setAttribute("aria-label", placeholder);
    editable.dataset.placeholder = placeholder;
    wrap.append(toolbar, editable);
    return {
      root: wrap,
      getValue: () => editable.innerHTML.trim(),
      focus: () => editable.focus(),
      destroy: () => wrap.remove()
    };
  }
  function mountPlainEditor(placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-mode-comments__reply desktop-mode-comments__reply--plain";
    const ta = document.createElement("textarea");
    ta.className = "desktop-mode-comments__reply-input";
    ta.placeholder = placeholder;
    ta.rows = 3;
    wrap.appendChild(ta);
    return {
      root: wrap,
      getValue: () => ta.value.trim(),
      focus: () => ta.focus(),
      destroy: () => wrap.remove()
    };
  }
  function mountReplyEditor(flavor, placeholder) {
    if (flavor === "plain") {
      return mountPlainEditor(placeholder);
    }
    return mountRichEditor(placeholder);
  }
  async function openAuthorDrawer(cfg, host, email) {
    host.hidden = false;
    host.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "desktop-mode-comments__drawer-loading";
    loading.textContent = __("Loading author insights…");
    host.appendChild(loading);
    let data;
    try {
      data = await fetchAuthorInsights(cfg, email);
    } catch (err) {
      host.replaceChildren();
      const errEl = document.createElement("p");
      errEl.className = "desktop-mode-comments__drawer-error";
      errEl.textContent = err instanceof Error ? err.message : __("Could not load insights.");
      host.appendChild(errEl);
      return;
    }
    host.replaceChildren();
    const header = document.createElement("header");
    header.className = "desktop-mode-comments__drawer-header";
    const avatar = document.createElement("img");
    avatar.src = data.avatarUrl;
    avatar.alt = "";
    avatar.width = 64;
    avatar.height = 64;
    avatar.className = "desktop-mode-comments__drawer-avatar";
    const headerText = document.createElement("div");
    const name = document.createElement("h2");
    name.textContent = data.userName || data.email;
    const sub = document.createElement("p");
    sub.textContent = data.email;
    sub.className = "desktop-mode-comments__drawer-sub";
    headerText.append(name, sub);
    header.append(avatar, headerText);
    host.appendChild(header);
    const reliability = document.createElement("div");
    reliability.className = "desktop-mode-comments__drawer-meter";
    const reliabilityLabel = document.createElement("span");
    reliabilityLabel.textContent = sprintf(
      /* translators: %d: 0–100 reliability score. */
      __("Reliability: %d / 100"),
      data.reliability
    );
    const meter = document.createElement("div");
    meter.className = "desktop-mode-comments__drawer-bar";
    meter.style.setProperty("--value", `${data.reliability}%`);
    reliability.append(reliabilityLabel, meter);
    host.appendChild(reliability);
    const stats = document.createElement("dl");
    stats.className = "desktop-mode-comments__drawer-stats";
    const lines = [
      [__("Total comments"), String(data.total)],
      [__("Approved"), String(data.counts.approve)],
      [__("Pending"), String(data.counts.hold)],
      [__("Spam"), String(data.counts.spam)],
      [__("Trash"), String(data.counts.trash)],
      [
        __("First seen"),
        data.oldest ? (/* @__PURE__ */ new Date(data.oldest + "Z")).toLocaleDateString() : "—"
      ],
      [
        __("Last seen"),
        data.newest ? (/* @__PURE__ */ new Date(data.newest + "Z")).toLocaleDateString() : "—"
      ]
    ];
    lines.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      stats.append(dt, dd);
    });
    host.appendChild(stats);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "desktop-mode-comments__drawer-close";
    closeBtn.textContent = __("Close");
    closeBtn.addEventListener("click", () => {
      host.hidden = true;
      host.replaceChildren();
    });
    host.appendChild(closeBtn);
    publish("desktop-mode-comments/insights-opened", { email: data.email });
  }
  const undoStack = [];
  function inverseAction(action) {
    switch (action) {
      case "approve":
        return "unapprove";
      case "unapprove":
        return "approve";
      case "spam":
        return "unspam";
      case "unspam":
        return "spam";
      case "trash":
        return "untrash";
      case "untrash":
        return "trash";
    }
  }
  function actionPastTense(action, count) {
    switch (action) {
      case "approve":
        return sprintf(__("Approved %d."), count);
      case "unapprove":
        return sprintf(__("Unapproved %d."), count);
      case "spam":
        return sprintf(__("Marked %d as spam."), count);
      case "unspam":
        return sprintf(__("Un-spammed %d."), count);
      case "trash":
        return sprintf(__("Trashed %d."), count);
      case "untrash":
        return sprintf(__("Restored %d."), count);
    }
  }
  async function renderCommentsWindow(body) {
    const cfg = readConfig();
    if (!cfg) {
      body.innerHTML = `<p class="desktop-mode-comments__fatal">${__(
        "Comments window configuration missing."
      )}</p>`;
      return;
    }
    setActiveConfig(cfg);
    const tabsEl = body.querySelector(
      "[data-desktop-mode-comments-tabs]"
    );
    const newPillEl = body.querySelector(
      "[data-desktop-mode-comments-new-pill]"
    );
    const drawerEl = body.querySelector(
      "[data-desktop-mode-comments-drawer]"
    );
    if (!tabsEl || !newPillEl || !drawerEl) {
      return;
    }
    const helpEl = body.querySelector(
      "[data-desktop-mode-comments-help]"
    );
    const panels = {
      pending: makePanel(body, "pending", cfg),
      all: makePanel(body, "all", cfg),
      spam: makePanel(body, "spam", cfg),
      trash: makePanel(body, "trash", cfg),
      mine: makePanel(body, "mine", cfg)
    };
    let activeTab = "pending";
    let lastSeenPending = 0;
    const refresh = async (tab, opts = {}) => {
      const state = panels[tab];
      if (!state.table || !state.tableHost) {
        return;
      }
      state.table.setAttribute("loading", "");
      try {
        const params = {
          tab,
          page: state.page,
          perPage: state.perPage,
          search: state.search,
          currentUserId: cfg.currentUserId
        };
        const result = await fetchComments(cfg, params);
        state.rows = result.rows;
        state.total = result.total;
        state.totalPages = result.totalPages;
        state.repliesByParent.clear();
        state.openReplies.clear();
        await customElements.whenDefined("wpd-table");
        state.table.data = state.rows;
        updatePager(state);
        if (tab === "pending" && !opts.force) {
          if (lastSeenPending === 0) {
            lastSeenPending = result.total;
          }
        }
      } catch (err) {
        console.error("[comments-window] refresh failed:", err);
        showToast(
          err instanceof Error ? err.message : __("Could not load comments.")
        );
      } finally {
        state.table.removeAttribute("loading");
      }
    };
    const setActive = (tab) => {
      activeTab = tab;
      tabsEl.setAttribute("value", tab);
      void refresh(tab);
    };
    tabsEl.addEventListener("wpd-tab-change", (e) => {
      const next = e.detail?.value;
      if (next) {
        setActive(next);
      }
    });
    Object.values(panels).forEach((state) => {
      wirePanel(state, cfg, async (ids, action) => {
        await runBulk(ids, action, state, refresh, cfg);
      }, drawerEl);
    });
    setActive("pending");
    let countsTimer = null;
    const pollCounts = async () => {
      try {
        const counts = await fetchCounts(cfg);
        updateDockBadge(counts.pending);
        if (activeTab === "pending") {
          const diff = counts.pending - lastSeenPending;
          if (diff > 0) {
            newPillEl.hidden = false;
            newPillEl.replaceChildren();
            const label = document.createElement("span");
            label.textContent = sprintf(
              /* translators: %d: number of new pending comments. */
              __("%d new pending — reload"),
              diff
            );
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = __("Reload");
            btn.addEventListener("click", () => {
              newPillEl.hidden = true;
              lastSeenPending = counts.pending;
              void refresh("pending", { force: true });
            });
            newPillEl.append(label, btn);
          }
        }
      } catch {
      }
    };
    countsTimer = window.setInterval(pollCounts, 3e4);
    void pollCounts();
    const onKey = (e) => {
      const ownerDoc = body.ownerDocument;
      if (!body.contains(ownerDoc.activeElement)) {
        return;
      }
      const target = ownerDoc.activeElement;
      const editing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.tagName === "WPD-TEXT-FIELD");
      if (editing) {
        return;
      }
      const state = panels[activeTab];
      if (!state.table) {
        return;
      }
      const ids = Array.from(state.table.selection).map((v) => Number(v)).filter(Boolean);
      switch (e.key) {
        case "j":
        case "k":
          e.preventDefault();
          moveFocus(state, e.key === "j" ? 1 : -1);
          break;
        case "a":
          if (ids.length > 0) {
            e.preventDefault();
            const targetAction = activeTab === "pending" ? "approve" : "unapprove";
            void runBulk(ids, targetAction, state, refresh, cfg);
          }
          break;
        case "s":
          if (ids.length > 0) {
            e.preventDefault();
            void runBulk(
              ids,
              activeTab === "spam" ? "unspam" : "spam",
              state,
              refresh,
              cfg
            );
          }
          break;
        case "d":
          if (ids.length > 0) {
            e.preventDefault();
            void runBulk(
              ids,
              activeTab === "trash" ? "untrash" : "trash",
              state,
              refresh,
              cfg
            );
          }
          break;
        case "u":
          e.preventDefault();
          void undoLast(cfg, refresh, activeTab);
          break;
        case "r":
          if (ids.length === 1) {
            e.preventDefault();
            openReplyFor(state, ids[0], cfg);
          }
          break;
        case "e":
          if (ids.length === 1) {
            e.preventDefault();
            openEditFor(state, ids[0], cfg, refresh);
          }
          break;
        case "?":
          if (helpEl) {
            e.preventDefault();
            helpEl.hidden = !helpEl.hidden;
            helpEl.querySelector("[data-desktop-mode-comments-help-close]")?.addEventListener(
              "click",
              () => {
                helpEl.hidden = true;
              },
              { once: true }
            );
          }
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    if (!cfg.introSeen) {
      void (async () => {
        const outcome = await showCommentsIntroDialog();
        if (outcome !== "cancel") {
          try {
            await trackedFetch(
              cfg.introUrl,
              {
                method: "POST",
                credentials: "same-origin",
                headers: {
                  "X-WP-Nonce": cfg.restNonce,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ slug: cfg.introSlug })
              },
              { source: "desktop-mode/comments/intro-seen", silent: true }
            );
          } catch {
          }
        }
        if (outcome === "settings") {
          getApi()?.openWindow?.({ id: "desktop-mode-os-settings" });
        }
      })();
    }
    const onClosed = (e) => {
      const detail = e.detail;
      if (detail?.windowId !== "desktop-mode-comments") {
        return;
      }
      if (countsTimer) {
        window.clearInterval(countsTimer);
        countsTimer = null;
      }
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("desktop-mode-window-closed", onClosed);
      setActiveConfig(null);
    };
    document.addEventListener("desktop-mode-window-closed", onClosed);
  }
  function makePanel(body, tab, cfg) {
    const root = body.querySelector(
      `[data-desktop-mode-comments-panel="${tab}"]`
    );
    if (!root) {
      throw new Error(`[comments-window] panel ${tab} not found`);
    }
    root.innerHTML = `
		<header class="desktop-mode-comments__toolbar">
			<div class="desktop-mode-comments__toolbar-left">
				<wpd-text-field
					data-desktop-mode-comments-search
					placeholder="${__("Search comments…")}"
				></wpd-text-field>
			</div>
			<div class="desktop-mode-comments__toolbar-right" data-desktop-mode-comments-bulk hidden>
				<span class="desktop-mode-comments__count" data-desktop-mode-comments-count></span>
				<span class="desktop-mode-comments__bulk-actions" data-desktop-mode-comments-bulk-actions></span>
			</div>
			<div class="desktop-mode-comments__toolbar-trailing">
				<wpd-button variant="ghost" data-desktop-mode-comments-refresh title="${__(
      "Refresh"
    )}">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
			</div>
		</header>
		<div class="desktop-mode-comments__body" data-desktop-mode-comments-body>
			<wpd-table
				data-desktop-mode-comments-table
				selectable="multi"
				sticky-header
				hover
				striped
				bordered
				loading
			>
				<div slot="empty" class="desktop-mode-comments__empty">
					<span class="dashicons dashicons-admin-comments" aria-hidden="true"></span>
					<p>${__("No comments to moderate here.")}</p>
				</div>
			</wpd-table>
		</div>
		<footer class="desktop-mode-comments__pager">
			<div class="desktop-mode-comments__pager-meta" data-desktop-mode-comments-page-indicator>—</div>
			<div class="desktop-mode-comments__pager-nav">
				<wpd-button variant="ghost" data-desktop-mode-comments-prev disabled>
					<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
					${__("Previous")}
				</wpd-button>
				<wpd-button variant="ghost" data-desktop-mode-comments-next disabled>
					${__("Next")}
					<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
				</wpd-button>
				<label class="desktop-mode-comments__pager-perpage">
					${__("Per page")}
					<select data-desktop-mode-comments-per-page>
						<option value="10">10</option>
						<option value="20" selected>20</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
				</label>
			</div>
		</footer>
	`;
    return {
      root,
      tab,
      page: 1,
      perPage: cfg.defaultPerPage,
      search: "",
      total: 0,
      totalPages: 1,
      rows: [],
      repliesByParent: /* @__PURE__ */ new Map(),
      openReplies: /* @__PURE__ */ new Set()
    };
  }
  function buildColumns(cfg, state, drawerEl) {
    const cols = [];
    cols.push({
      key: "author_name",
      label: __("Author"),
      sticky: true,
      minWidth: "180px",
      render: (_v, row) => {
        const wrap = document.createElement("div");
        wrap.className = "desktop-mode-comments__author";
        const avatar = document.createElement("button");
        avatar.type = "button";
        avatar.className = "desktop-mode-comments__avatar-btn";
        avatar.title = __("Show author insights");
        const url = row.author_avatar_urls?.["48"] ?? "";
        avatar.innerHTML = url ? `<img src="${url}" alt="" width="32" height="32" />` : '<span class="dashicons dashicons-admin-users" aria-hidden="true"></span>';
        avatar.addEventListener("click", (e) => {
          e.stopPropagation();
          void openAuthorDrawer(cfg, drawerEl, row.author_email);
        });
        const meta = document.createElement("div");
        meta.className = "desktop-mode-comments__author-meta";
        const name = document.createElement("strong");
        name.textContent = row.author_name || __("Anonymous");
        const email = document.createElement("small");
        email.textContent = row.author_email;
        meta.append(name, email);
        wrap.append(avatar, meta);
        return wrap;
      }
    });
    cols.push({
      key: "content",
      label: __("Comment"),
      minWidth: "320px",
      render: (_v, row) => {
        const wrap = document.createElement("div");
        wrap.className = "desktop-mode-comments__content";
        const body = document.createElement("div");
        body.className = "desktop-mode-comments__content-body";
        body.innerHTML = row.content?.rendered ?? "";
        wrap.appendChild(body);
        if (row.desktop_mode_replies_count > 0) {
          const tog = document.createElement("button");
          tog.type = "button";
          tog.className = "desktop-mode-comments__replies-toggle";
          tog.textContent = sprintf(
            /* translators: %d: number of direct replies. */
            __("+ %d replies"),
            row.desktop_mode_replies_count
          );
          tog.addEventListener("click", (e) => {
            e.stopPropagation();
            void toggleReplies(state, row.id, cfg, wrap);
          });
          wrap.appendChild(tog);
        }
        return wrap;
      }
    });
    cols.push({
      key: "desktop_mode_post_title",
      label: __("In response to"),
      minWidth: "180px",
      render: (_v, row) => {
        if (!row.desktop_mode_post_link) {
          return row.desktop_mode_post_title;
        }
        const a = document.createElement("a");
        a.href = row.desktop_mode_post_link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = row.desktop_mode_post_title;
        return a;
      }
    });
    cols.push({
      key: "desktop_mode_spam_score",
      label: __("Spam"),
      align: "center",
      sortable: true,
      width: "78px",
      render: (_v, row) => spamChipFor(row)
    });
    cols.push({
      key: "date_gmt",
      label: __("Submitted on"),
      sortable: true,
      width: "160px",
      render: (_v, row) => {
        try {
          return (/* @__PURE__ */ new Date(row.date_gmt + "Z")).toLocaleString();
        } catch {
          return row.date_gmt;
        }
      }
    });
    return cols;
  }
  function wirePanel(state, cfg, runBulkLocal, drawerEl) {
    const table = state.root.querySelector(
      "[data-desktop-mode-comments-table]"
    );
    const body = state.root.querySelector(
      "[data-desktop-mode-comments-body]"
    );
    const bulkBar = state.root.querySelector(
      "[data-desktop-mode-comments-bulk]"
    );
    const bulkActionsHost = state.root.querySelector(
      "[data-desktop-mode-comments-bulk-actions]"
    );
    const countEl = state.root.querySelector(
      "[data-desktop-mode-comments-count]"
    );
    if (!table || !body || !bulkBar || !bulkActionsHost || !countEl) {
      return;
    }
    const searchEl = state.root.querySelector(
      "[data-desktop-mode-comments-search]"
    );
    const refreshBtn = state.root.querySelector(
      "[data-desktop-mode-comments-refresh]"
    );
    const prevBtn = state.root.querySelector(
      "[data-desktop-mode-comments-prev]"
    );
    const nextBtn = state.root.querySelector(
      "[data-desktop-mode-comments-next]"
    );
    const perPageSel = state.root.querySelector(
      "[data-desktop-mode-comments-per-page]"
    );
    state.table = table;
    state.tableHost = body;
    void customElements.whenDefined("wpd-table").then(() => {
      table.columns = buildColumns(cfg, state, drawerEl);
      table.getRowId = (row) => row.id;
      if (state.rows.length > 0) {
        table.data = state.rows;
      }
    });
    const renderBulkActions = () => {
      bulkActionsHost.replaceChildren();
      const actions = [];
      if (state.tab === "pending" || state.tab === "all" || state.tab === "mine") {
        actions.push({ label: __("Approve"), action: "approve" });
        actions.push({ label: __("Unapprove"), action: "unapprove" });
      }
      if (state.tab === "spam") {
        actions.push({ label: __("Not spam"), action: "unspam" });
      } else {
        actions.push({ label: __("Spam"), action: "spam" });
      }
      if (state.tab === "trash") {
        actions.push({ label: __("Restore"), action: "untrash" });
      } else {
        actions.push({ label: __("Trash"), action: "trash", danger: true });
      }
      actions.forEach((a) => {
        const btn = document.createElement("wpd-button");
        btn.setAttribute("variant", a.danger ? "danger" : "ghost");
        btn.textContent = a.label;
        btn.addEventListener("click", () => {
          const sel = Array.from(table.selection).map((v) => Number(v)).filter(Boolean);
          if (sel.length > 0) {
            void runBulkLocal(sel, a.action);
          }
        });
        bulkActionsHost.appendChild(btn);
      });
    };
    renderBulkActions();
    table.addEventListener("wpd-table-selection-change", () => {
      const count = table.selection.size;
      bulkBar.hidden = count === 0;
      countEl.textContent = sprintf(
        /* translators: %d: count of selected rows. */
        __("%d selected"),
        count
      );
    });
    let searchDebounce = null;
    searchEl?.addEventListener("wpd-input-change", (e) => {
      const val = e.detail?.value ?? "";
      if (searchDebounce) {
        window.clearTimeout(searchDebounce);
      }
      searchDebounce = window.setTimeout(() => {
        state.search = String(val);
        state.page = 1;
        void reloadActivePanel(state);
      }, 300);
    });
    refreshBtn?.addEventListener("click", () => {
      void reloadActivePanel(state);
    });
    prevBtn?.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        void reloadActivePanel(state);
      }
    });
    nextBtn?.addEventListener("click", () => {
      if (state.page < state.totalPages) {
        state.page += 1;
        void reloadActivePanel(state);
      }
    });
    perPageSel?.addEventListener("change", () => {
      state.perPage = parseInt(perPageSel.value, 10) || 20;
      state.page = 1;
      void reloadActivePanel(state);
    });
  }
  async function reloadActivePanel(state) {
    const cfg = getActiveConfig();
    if (!cfg || !state.table) {
      return;
    }
    state.table.setAttribute("loading", "");
    try {
      const result = await fetchComments(cfg, {
        tab: state.tab,
        page: state.page,
        perPage: state.perPage,
        search: state.search,
        currentUserId: cfg.currentUserId
      });
      state.rows = result.rows;
      state.total = result.total;
      state.totalPages = result.totalPages;
      await customElements.whenDefined("wpd-table");
      state.table.data = state.rows;
      updatePager(state);
    } catch (err) {
      console.error("[comments-window] reload failed:", err);
      showToast(
        err instanceof Error ? err.message : __("Could not load comments.")
      );
    } finally {
      state.table.removeAttribute("loading");
    }
  }
  function updatePager(state) {
    const indicator = state.root.querySelector(
      "[data-desktop-mode-comments-page-indicator]"
    );
    const prevBtn = state.root.querySelector(
      "[data-desktop-mode-comments-prev]"
    );
    const nextBtn = state.root.querySelector(
      "[data-desktop-mode-comments-next]"
    );
    if (indicator) {
      indicator.textContent = sprintf(
        /* translators: 1: current page, 2: total pages, 3: total rows. */
        __("Page %1$d of %2$d (%3$d total)"),
        state.page,
        state.totalPages,
        state.total
      );
    }
    if (prevBtn) {
      prevBtn.disabled = state.page <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = state.page >= state.totalPages;
    }
  }
  async function toggleReplies(state, parentId, cfg, host) {
    const existing = host.querySelector(".desktop-mode-comments__replies");
    if (existing) {
      existing.remove();
      state.openReplies.delete(parentId);
      return;
    }
    state.openReplies.add(parentId);
    let replies = state.repliesByParent.get(parentId);
    if (!replies) {
      try {
        replies = await fetchReplies(cfg, parentId);
        state.repliesByParent.set(parentId, replies);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : __("Could not load replies.")
        );
        return;
      }
    }
    const tree = document.createElement("div");
    tree.className = "desktop-mode-comments__replies";
    replies.forEach((r) => {
      const item = document.createElement("div");
      item.className = "desktop-mode-comments__reply-row";
      const author = document.createElement("strong");
      author.textContent = r.author_name || __("Anonymous");
      const sep = document.createTextNode(" — ");
      const cnt = document.createElement("span");
      cnt.innerHTML = r.content?.rendered ?? "";
      item.append(author, sep, cnt);
      tree.appendChild(item);
    });
    host.appendChild(tree);
  }
  function openReplyFor(state, id, cfg) {
    const row = state.rows.find((r) => r.id === id);
    if (!row) {
      return;
    }
    const tr = state.tableHost?.querySelector(
      `tr[data-row-id="${id}"]`
    );
    const host = tr?.nextElementSibling?.classList.contains(
      "desktop-mode-comments__inline-host"
    ) ? tr.nextElementSibling : (() => {
      const ins = document.createElement("div");
      ins.className = "desktop-mode-comments__inline-host";
      tr?.after(ins);
      return ins;
    })();
    host.replaceChildren();
    const editor = mountReplyEditor(
      cfg.replyEditor,
      __("Write a reply…")
    );
    host.appendChild(editor.root);
    const actions = document.createElement("div");
    actions.className = "desktop-mode-comments__inline-actions";
    const cancel = document.createElement("wpd-button");
    cancel.setAttribute("variant", "ghost");
    cancel.textContent = __("Cancel");
    cancel.addEventListener("click", () => {
      editor.destroy();
      host.remove();
    });
    const send = document.createElement("wpd-button");
    send.setAttribute("variant", "primary");
    send.textContent = __("Send reply");
    send.addEventListener("click", async () => {
      const value = editor.getValue();
      if (!value) {
        showToast(__("Reply is empty."));
        return;
      }
      try {
        await postReply(cfg, id, value);
        showToast(__("Reply posted."));
        publish("desktop-mode-comments/replied", {
          parentId: id,
          postId: row.post
        });
        editor.destroy();
        host.remove();
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : __("Reply failed.")
        );
      }
    });
    actions.append(cancel, send);
    host.appendChild(actions);
    editor.focus();
  }
  function openEditFor(state, id, cfg, refresh) {
    const row = state.rows.find((r) => r.id === id);
    if (!row || !row.desktop_mode_can_edit) {
      showToast(__("You can't edit this comment."));
      return;
    }
    const tr = state.tableHost?.querySelector(
      `tr[data-row-id="${id}"]`
    );
    if (!tr) {
      return;
    }
    const host = document.createElement("div");
    host.className = "desktop-mode-comments__inline-host";
    tr.after(host);
    const editor = mountReplyEditor(cfg.replyEditor, __("Edit comment…"));
    host.appendChild(editor.root);
    const editable = editor.root.querySelector(
      ".desktop-mode-comments__reply-input"
    );
    if (editable) {
      if (editable instanceof HTMLTextAreaElement) {
        editable.value = row.content?.raw ?? "";
      } else {
        editable.innerHTML = row.content?.rendered ?? "";
      }
    }
    const actions = document.createElement("div");
    actions.className = "desktop-mode-comments__inline-actions";
    const cancel = document.createElement("wpd-button");
    cancel.setAttribute("variant", "ghost");
    cancel.textContent = __("Cancel");
    cancel.addEventListener("click", () => {
      editor.destroy();
      host.remove();
    });
    const save = document.createElement("wpd-button");
    save.setAttribute("variant", "primary");
    save.textContent = __("Save");
    save.addEventListener("click", async () => {
      try {
        await updateCommentContent(cfg, id, editor.getValue());
        showToast(__("Comment updated."));
        publish("desktop-mode-comments/edited", { id });
        editor.destroy();
        host.remove();
        await refresh(state.tab);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : __("Edit failed.")
        );
      }
    });
    actions.append(cancel, save);
    host.appendChild(actions);
    editor.focus();
  }
  async function runBulk(ids, action, state, refresh, cfg) {
    try {
      const result = await bulkModerate(cfg, ids, action);
      const inverse = inverseAction(action);
      if (inverse && result.processed.length > 0) {
        undoStack.push({
          action,
          ids: result.processed,
          inverse,
          expiresAt: Date.now() + 8e3
        });
        showToast(
          actionPastTense(action, result.processed.length),
          8e3,
          [
            {
              label: __("Undo"),
              onClick: () => {
                void undoLast(cfg, refresh, state.tab);
              }
            }
          ]
        );
      } else {
        showToast(actionPastTense(action, result.processed.length));
      }
      publish(`desktop-mode-comments/${action}d`, {
        ids: result.processed,
        counts: result.counts
      });
      updateDockBadge(result.counts.pending);
      await refresh(state.tab, { force: true });
    } catch (err) {
      const fallback = sprintf(__("Bulk %s failed."), action);
      showToast(err instanceof Error ? err.message : fallback);
    }
  }
  async function undoLast(cfg, refresh, currentTab) {
    const last = undoStack.pop();
    if (!last || !last.inverse || Date.now() > last.expiresAt) {
      return;
    }
    try {
      await bulkModerate(cfg, last.ids, last.inverse);
      showToast(__("Undone."));
      await refresh(currentTab, { force: true });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : __("Undo failed.")
      );
    }
  }
  function moveFocus(state, direction) {
    if (!state.table || state.rows.length === 0) {
      return;
    }
    const selected = Array.from(state.table.selection).map((v) => Number(v)).filter(Boolean);
    const currentIndex = selected.length > 0 ? state.rows.findIndex((r) => r.id === selected[0]) : -1;
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) {
      nextIndex = 0;
    }
    if (nextIndex >= state.rows.length) {
      nextIndex = state.rows.length - 1;
    }
    const nextId = state.rows[nextIndex]?.id;
    if (!nextId) {
      return;
    }
    state.table.selection = [nextId];
    const tr = state.tableHost?.querySelector(
      `tr[data-row-id="${nextId}"]`
    );
    tr?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const registry = window.desktopModeNativeWindows ?? (window.desktopModeNativeWindows = {});
  registry["desktop-mode-comments"] = (body) => {
    setActiveWindowId("desktop-mode-comments");
    return renderCommentsWindow(body).catch((err) => {
      console.error("[comments-window] render failed:", err);
    });
  };
})();
