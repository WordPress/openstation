var desktopModePostsWindow = function(exports) {
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
  const WINDOW_ID = "desktop-mode-posts";
  function getConfig() {
    const store = window.desktopModeWindowConfig;
    const cfg = store ? store[WINDOW_ID] : void 0;
    if (!cfg) {
      throw new Error(
        "[desktop-mode-posts] config blob is missing — was the window opened without registration? See `desktop_mode_register_window()` in `includes/posts-window/window.php`."
      );
    }
    return cfg;
  }
  function shellFetch(input, init) {
    const api = window.wp?.desktop;
    if (api && typeof api.fetch === "function") {
      return api.fetch(input, init, { windowId: "desktop-mode-posts" });
    }
    return fetch(input, init);
  }
  async function request(url, init = {}) {
    const cfg = getConfig();
    const response = await shellFetch(url, {
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
    const data = init.expectJson === false ? null : await response.json();
    return { data, headers: response.headers };
  }
  async function fetchPosts(params = {}) {
    const cfg = getConfig();
    const url = new URL(cfg.postsUrl);
    for (const [key, value] of Object.entries(cfg.queryArgs ?? {})) {
      if (typeof value === "string" && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    if (params.page) {
      url.searchParams.set("page", String(params.page));
    }
    if (params.perPage) {
      url.searchParams.set("per_page", String(params.perPage));
    }
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    if (params.status) {
      url.searchParams.set("status", params.status);
    } else {
      url.searchParams.set("status", "any");
    }
    if (params.orderby) {
      url.searchParams.set("orderby", params.orderby);
    }
    if (params.order) {
      url.searchParams.set("order", params.order);
    }
    const joinIds = (v) => Array.isArray(v) ? v.filter((n) => Number.isFinite(n) && n > 0).join(",") : String(v);
    if (params.author) {
      const v = joinIds(params.author);
      if (v) {
        url.searchParams.set("author", v);
      }
    }
    if (params.tag) {
      const v = joinIds(params.tag);
      if (v) {
        url.searchParams.set("tags", v);
        if (Array.isArray(params.tag) && params.tag.length > 1) {
          url.searchParams.set("desktop_mode_tags_match", "all");
        }
      }
    }
    const { data, headers } = await request(url.toString(), {
      method: "GET"
    });
    return {
      items: Array.isArray(data) ? data : [],
      total: parseInt(headers.get("X-WP-Total") ?? "0", 10) || 0,
      totalPages: parseInt(headers.get("X-WP-TotalPages") ?? "0", 10) || 0
    };
  }
  async function trashPost(id) {
    const cfg = getConfig();
    try {
      await request(`${cfg.postsUrl}/${id}`, {
        method: "DELETE"
      });
      return { id, ok: true };
    } catch (err) {
      return {
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
  function buildEditPostUrl(id) {
    const cfg = getConfig();
    const sep = cfg.editPostUrlBase.includes("?") ? "&" : "?";
    return `${cfg.editPostUrlBase}${sep}post=${id}&action=edit`;
  }
  async function searchTags(query, signal) {
    const cfg = getConfig();
    const url = new URL(`${cfg.restRoot.replace(/\/$/, "")}/wp/v2/tags`);
    url.searchParams.set("per_page", "20");
    url.searchParams.set("_fields", "id,name,slug,count");
    url.searchParams.set("orderby", "count");
    url.searchParams.set("order", "desc");
    if (query) {
      url.searchParams.set("search", query);
      url.searchParams.set("orderby", "name");
      url.searchParams.set("order", "asc");
    }
    const { data } = await request(url.toString(), {
      method: "GET",
      signal
    });
    return Array.isArray(data) ? data : [];
  }
  async function createTag(name) {
    const cfg = getConfig();
    const url = `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/tags`;
    try {
      const { data } = await request(url, {
        method: "POST",
        body: JSON.stringify({ name })
      });
      broadcastTermChange("post_tag", "created", data.id);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/term[\s_]?exists/i.test(message)) {
        const matches = await searchTags(name);
        const exact = matches.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        );
        if (exact) {
          return exact;
        }
      }
      throw err;
    }
  }
  async function updatePostTags(postId, tagIds) {
    const cfg = getConfig();
    const url = `${cfg.postsUrl}/${postId}`;
    const { data } = await request(url, {
      method: "POST",
      body: JSON.stringify({ tags: tagIds })
    });
    return data;
  }
  async function fetchAllCategories(signal) {
    const cfg = getConfig();
    const url = new URL(`${cfg.restRoot.replace(/\/$/, "")}/wp/v2/categories`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("_fields", "id,name,slug,parent");
    url.searchParams.set("orderby", "name");
    url.searchParams.set("order", "asc");
    const { data } = await request(url.toString(), {
      method: "GET",
      signal
    });
    return Array.isArray(data) ? data : [];
  }
  async function fetchAuthorOptions(signal) {
    const cfg = getConfig();
    const url = new URL(`${cfg.restRoot.replace(/\/$/, "")}/wp/v2/users`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("who", "authors");
    url.searchParams.set("_fields", "id,name");
    url.searchParams.set("orderby", "name");
    url.searchParams.set("order", "asc");
    try {
      const { data } = await request(url.toString(), {
        method: "GET",
        signal
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  async function fetchTagOptions(page = 1, perPage = 50, signal) {
    const cfg = getConfig();
    const url = new URL(`${cfg.restRoot.replace(/\/$/, "")}/wp/v2/tags`);
    url.searchParams.set("per_page", String(Math.max(1, perPage)));
    url.searchParams.set("page", String(Math.max(1, page)));
    url.searchParams.set("_fields", "id,name,count");
    url.searchParams.set("orderby", "count");
    url.searchParams.set("order", "desc");
    try {
      const { data, headers } = await request(
        url.toString(),
        { method: "GET", signal }
      );
      return {
        items: Array.isArray(data) ? data : [],
        totalPages: parseInt(headers.get("X-WP-TotalPages") ?? "0", 10) || 0
      };
    } catch {
      return { items: [], totalPages: 0 };
    }
  }
  async function createCategory(name, parent = 0, opts = {}) {
    const cfg = getConfig();
    const url = `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/categories`;
    const body = { name, parent };
    if (opts.slug) {
      body.slug = opts.slug;
    }
    if (opts.description) {
      body.description = opts.description;
    }
    try {
      const { data } = await request(url, {
        method: "POST",
        body: JSON.stringify(body)
      });
      broadcastTermChange("category", "created", data.id);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/term[\s_]?exists/i.test(message)) {
        const matches = await fetchAllCategories();
        const exact = matches.find(
          (t) => t.name.toLowerCase() === name.toLowerCase() && t.parent === parent
        );
        if (exact) {
          return exact;
        }
      }
      throw err;
    }
  }
  function broadcastTermChange(taxonomy, action, id) {
    const api = window.wp?.desktop;
    if (api && typeof api.broadcast === "function") {
      api.broadcast("desktop-mode.term.changed", {
        source: "posts-window",
        taxonomy,
        action,
        id
      });
    }
  }
  async function updatePostCategories(postId, categoryIds) {
    const cfg = getConfig();
    const url = `${cfg.postsUrl}/${postId}`;
    const { data } = await request(url, {
      method: "POST",
      body: JSON.stringify({ categories: categoryIds })
    });
    return data;
  }
  async function fetchTerms(taxonomy, params = {}) {
    const cfg = getConfig();
    const url = new URL(
      `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/${taxonomy}`
    );
    url.searchParams.set("per_page", String(params.perPage ?? 50));
    url.searchParams.set("page", String(params.page ?? 1));
    url.searchParams.set(
      "_fields",
      "id,name,slug,parent,count,description,desktop_mode_count,desktop_mode_is_default"
    );
    url.searchParams.set("orderby", params.orderby ?? "name");
    url.searchParams.set("order", params.order ?? "asc");
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    if (typeof params.parent === "number" && params.parent >= 0) {
      url.searchParams.set("parent", String(params.parent));
    }
    const { data, headers } = await request(
      url.toString(),
      { method: "GET" }
    );
    const items = Array.isArray(data) ? data.map((t) => {
      const anyCount = t.desktop_mode_count;
      const isDefault = t.desktop_mode_is_default === true;
      return {
        id: t.id ?? 0,
        name: t.name ?? "",
        slug: t.slug ?? "",
        parent: t.parent ?? 0,
        count: typeof anyCount === "number" ? anyCount : t.count ?? 0,
        description: t.description ?? "",
        isDefault
      };
    }) : [];
    return {
      items,
      total: parseInt(headers.get("X-WP-Total") ?? "0", 10) || 0,
      totalPages: parseInt(headers.get("X-WP-TotalPages") ?? "0", 10) || 0
    };
  }
  async function updateTerm(taxonomy, id, patch) {
    const cfg = getConfig();
    const url = `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/${taxonomy}/${id}`;
    const { data } = await request(url, {
      method: "POST",
      body: JSON.stringify(patch)
    });
    broadcastTermChange(
      taxonomy === "categories" ? "category" : "post_tag",
      "updated",
      id
    );
    return {
      id: data.id ?? id,
      name: data.name ?? "",
      slug: data.slug ?? "",
      parent: data.parent ?? 0,
      count: data.count ?? 0,
      description: data.description ?? "",
      isDefault: data.isDefault ?? false
    };
  }
  async function deleteTerm(taxonomy, id) {
    const cfg = getConfig();
    const url = new URL(
      `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/${taxonomy}/${id}`
    );
    url.searchParams.set("force", "true");
    await request(url.toString(), { method: "DELETE" });
    broadcastTermChange(
      taxonomy === "categories" ? "category" : "post_tag",
      "deleted",
      id
    );
  }
  const ROOT = "[data-desktop-mode-posts-root]";
  const STATUS = "[data-desktop-mode-posts-status]";
  const SEARCH = "[data-desktop-mode-posts-search]";
  const REFRESH = "[data-desktop-mode-posts-refresh]";
  const NEW_BTN = "[data-desktop-mode-posts-new]";
  const TABLE = "[data-desktop-mode-posts-table]";
  const BULK = "[data-desktop-mode-posts-bulk]";
  const COUNT = "[data-desktop-mode-posts-count]";
  const PAGE_INDICATOR = "[data-desktop-mode-posts-page-indicator]";
  const PREV = "[data-desktop-mode-posts-prev]";
  const NEXT = "[data-desktop-mode-posts-next]";
  const PER_PAGE = "[data-desktop-mode-posts-per-page]";
  const TOOLBAR_TRAILING_EXTRAS = "[data-desktop-mode-posts-toolbar-extras]";
  const BULK_ACTIONS_HOST = "[data-desktop-mode-posts-bulk-actions]";
  const HOOK_FILTER_COLUMNS = "desktop_mode.postsWindow.columns";
  const HOOK_FILTER_STATUS_SEGMENTS = "desktop_mode.postsWindow.statusSegments";
  const HOOK_FILTER_BULK_ACTIONS = "desktop_mode.postsWindow.bulkActions";
  const HOOK_FILTER_TOOLBAR_TRAILING = "desktop_mode.postsWindow.toolbarTrailing";
  const HOOK_ACTION_OPENED = "desktop_mode.postsWindow.opened";
  const HOOK_ACTION_DATA_LOADED = "desktop_mode.postsWindow.dataLoaded";
  const SEARCH_DEBOUNCE_MS = 250;
  const STATUS_LABELS = {
    publish: __("Published"),
    future: __("Scheduled"),
    draft: __("Draft"),
    pending: __("Pending"),
    private: __("Private"),
    trash: __("Trash")
  };
  function statusBadgeColor(status) {
    switch (status) {
      case "publish":
        return { bg: "#e6f4ea", fg: "#1d6f42" };
      case "draft":
        return { bg: "#fdecea", fg: "#a02622" };
      case "pending":
        return { bg: "#fef7e0", fg: "#8a6d00" };
      case "private":
        return { bg: "#e8f0fe", fg: "#1a52a8" };
      case "future":
        return { bg: "#ede7f6", fg: "#5b3aa0" };
      case "trash":
        return { bg: "#f1f1f2", fg: "#50575e" };
      default:
        return { bg: "#f1f1f2", fg: "#50575e" };
    }
  }
  function decodeTitle(raw) {
    const ta = document.createElement("textarea");
    ta.innerHTML = raw;
    return ta.value;
  }
  function authorOf(row) {
    const embedded = row._embedded?.author?.[0];
    if (embedded) {
      const avatars = embedded.avatar_urls ?? {};
      return {
        id: embedded.id,
        name: embedded.name,
        avatar: avatars["48"] ?? avatars["96"] ?? avatars["24"]
      };
    }
    return { id: row.author, name: __("Unknown") };
  }
  function termRecordsOf(row, taxonomy) {
    const groups = row._embedded?.["wp:term"] ?? [];
    for (const group of groups) {
      if (group.length === 0) {
        continue;
      }
      if (group[0].taxonomy === taxonomy) {
        return group.map((t) => ({ id: t.id, name: t.name }));
      }
    }
    return [];
  }
  function featuredMediaOf(row) {
    const media = row._embedded?.["wp:featuredmedia"]?.[0];
    if (!media) {
      return null;
    }
    const sizes = media.media_details?.sizes ?? {};
    const small = sizes.thumbnail?.source_url ?? sizes.medium?.source_url ?? media.source_url;
    return { url: small, alt: media.alt_text ?? "" };
  }
  function cacheKey(rowId, columnKey) {
    return `${rowId}|${columnKey}`;
  }
  function memoCell(cache, rowId, columnKey, build) {
    const key = cacheKey(rowId, columnKey);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const built = build();
    cache.set(key, built);
    return built;
  }
  const REQUIRED_COLUMN_KEYS = /* @__PURE__ */ new Set(["title"]);
  function getHiddenColumns() {
    try {
      const api = window.wp?.desktop;
      if (api && typeof api.getOsSettings === "function") {
        const snap = api.getOsSettings();
        if (Array.isArray(snap.nativePostsHiddenColumns)) {
          return new Set(snap.nativePostsHiddenColumns);
        }
      }
    } catch {
    }
    return /* @__PURE__ */ new Set();
  }
  const EMPTY_FILTER_DATA = { authors: [], tags: [] };
  function buildAllColumns(cache, filterData = EMPTY_FILTER_DATA) {
    const cols = _buildBaseColumns(cache, filterData);
    const hooks = window.wp?.hooks;
    return hooks && typeof hooks.applyFilters === "function" ? hooks.applyFilters(
      HOOK_FILTER_COLUMNS,
      cols
    ) : cols;
  }
  function buildColumns(cache, filterData = EMPTY_FILTER_DATA) {
    const all = buildAllColumns(cache, filterData);
    const hidden = getHiddenColumns();
    if (hidden.size === 0) {
      return all;
    }
    return all.filter(
      (col) => REQUIRED_COLUMN_KEYS.has(col.key) || !hidden.has(col.key)
    );
  }
  function _buildBaseColumns(cache, filterData) {
    return [
      {
        key: "title",
        label: __("Title"),
        sortable: true,
        sticky: true,
        render: (_v, row) => memoCell(cache, row.id, "title", () => buildTitleCell(row))
      },
      {
        key: "author",
        label: __("Author"),
        sortable: true,
        width: "180px",
        filterRender: (host, ctx) => renderMultiSelectFilter(host, ctx, filterData.authors, {
          label: __("All authors"),
          ariaLabel: __("Filter by author")
        }),
        render: (_v, row) => memoCell(cache, row.id, "author", () => buildAuthorCell(row))
      },
      {
        key: "categories",
        label: __("Categories"),
        width: "260px",
        render: (_v, row) => memoCell(
          cache,
          row.id,
          "categories",
          () => buildCategoriesCell(row)
        )
      },
      {
        key: "tags",
        label: __("Tags"),
        // Drop the fixed width so the column flexes with the
        // available space; pin a minimum that comfortably holds
        // ~4 chips on one line so the cell doesn't collapse the
        // tags into a vertical stack on narrow tables.
        minWidth: "360px",
        filterRender: (host, ctx) => renderMultiSelectFilter(
          host,
          ctx,
          filterData.tags.map((t) => ({ id: t.id, name: t.name })),
          {
            label: __("All tags"),
            ariaLabel: __("Filter by tag"),
            dataKey: "tags",
            hasMore: !!filterData.tagsHasMore,
            onLoadMore: filterData.loadMoreTags
          }
        ),
        render: (_v, row) => memoCell(cache, row.id, "tags", () => buildTagsCell(row))
      },
      {
        key: "date",
        label: __("Date"),
        sortable: true,
        width: "170px",
        sortValue: (row) => Date.parse(row.date_gmt + "Z") || 0,
        render: (_v, row) => memoCell(cache, row.id, "date", () => buildDateCell(row))
      }
    ];
  }
  function renderMultiSelectFilter(host, ctx, all, opts) {
    const HOST_KEY = "wpdPostsFilterMounted";
    const tagged = host;
    const optionsForPicker = all.map((o) => ({
      value: String(o.id),
      label: o.name
    }));
    const nextSig = optionsForPicker.map((o) => `${o.value}:${o.label}`).join("|");
    if (tagged[HOST_KEY]) {
      const state = tagged[HOST_KEY];
      if (state.listSig !== nextSig) {
        state.picker.items = optionsForPicker;
        state.listSig = nextSig;
      }
      if (state.picker.getAttribute("value") !== ctx.value) {
        state.picker.setAttribute("value", ctx.value);
      }
      state.picker.hasMore = !!opts.hasMore;
      return;
    }
    const picker = document.createElement("wpd-multiselect");
    picker.setAttribute("placeholder", opts.label);
    picker.setAttribute("aria-label", opts.ariaLabel);
    picker.setAttribute("data-noclick", "");
    picker.setAttribute("value", ctx.value);
    if (opts.dataKey) {
      picker.setAttribute("data-key", opts.dataKey);
    }
    host.appendChild(picker);
    picker.items = optionsForPicker;
    picker.hasMore = !!opts.hasMore;
    picker.addEventListener("wpd-pick", (e) => {
      const detail = e.detail;
      const next = detail?.value ?? "";
      ctx.value = next;
      ctx.setValue(next);
    });
    if (opts.onLoadMore) {
      const onLoadMore = opts.onLoadMore;
      picker.addEventListener("wpd-multiselect-load-more", () => {
        picker.loadingMore = true;
        onLoadMore();
      });
    }
    tagged[HOST_KEY] = { picker, listSig: nextSig };
  }
  function mountKebabColumnToggles(body, cache, repaintColumns) {
    const winEl = body.closest(".desktop-mode-window");
    const panel = winEl?.querySelector(
      ".desktop-mode-window__menu-panel"
    );
    if (!panel) {
      return null;
    }
    const SECTION_CLASS = "desktop-mode-posts-window__menu-columns";
    const ITEM_CLASS = "desktop-mode-posts-window__menu-column-item";
    const VALUE_PREFIX = "desktop-mode-posts-column:";
    panel.querySelectorAll(`.${SECTION_CLASS}, .${ITEM_CLASS}`).forEach((n) => n.remove());
    const allCols = buildAllColumns(cache);
    const togglable = allCols.filter(
      (c) => !REQUIRED_COLUMN_KEYS.has(c.key)
    );
    if (togglable.length === 0) {
      return null;
    }
    const sectionLabel = document.createElement("div");
    sectionLabel.className = SECTION_CLASS;
    sectionLabel.setAttribute("role", "presentation");
    sectionLabel.textContent = __("Show columns");
    panel.appendChild(sectionLabel);
    const itemEls = /* @__PURE__ */ new Map();
    for (const col of togglable) {
      const item = document.createElement("wpd-menu-item");
      item.setAttribute("role", "menuitemcheckbox");
      item.setAttribute("value", VALUE_PREFIX + col.key);
      item.classList.add("desktop-mode-window__menu-item");
      item.classList.add(ITEM_CLASS);
      item.textContent = col.label || col.key;
      panel.appendChild(item);
      itemEls.set(col.key, item);
    }
    const paintChecked = () => {
      const hidden = getHiddenColumns();
      for (const [key, el] of itemEls) {
        if (hidden.has(key)) {
          el.removeAttribute("checked");
        } else {
          el.setAttribute("checked", "");
        }
      }
    };
    paintChecked();
    const onClick = (e) => {
      const detail = e.detail;
      const value = detail?.value;
      if (typeof value !== "string" || !value.startsWith(VALUE_PREFIX)) {
        return;
      }
      const key = value.slice(VALUE_PREFIX.length);
      if (!itemEls.has(key) || REQUIRED_COLUMN_KEYS.has(key)) {
        return;
      }
      const hidden = getHiddenColumns();
      if (hidden.has(key)) {
        hidden.delete(key);
      } else {
        hidden.add(key);
      }
      const next = Array.from(hidden).sort();
      const api = window.wp?.desktop;
      if (api && typeof api.updateOsSettings === "function") {
        api.updateOsSettings(
          { nativePostsHiddenColumns: next },
          { windowId: "desktop-mode-posts" }
        );
      }
      paintChecked();
      repaintColumns();
    };
    panel.addEventListener("wpd-menu-item-click", onClick);
    return {
      refresh: paintChecked,
      dispose: () => {
        panel.removeEventListener("wpd-menu-item-click", onClick);
        sectionLabel.remove();
        for (const el of itemEls.values()) {
          el.remove();
        }
        itemEls.clear();
      }
    };
  }
  function defaultStatusSegments() {
    return [
      { value: "", label: __("All") },
      { value: "publish", label: __("Published") },
      { value: "draft", label: __("Drafts") },
      { value: "pending", label: __("Pending") },
      { value: "future", label: __("Scheduled") },
      { value: "trash", label: __("Trash") }
    ];
  }
  function defaultBulkActions() {
    return [
      {
        id: "trash",
        label: __("Move to trash"),
        icon: "dashicons-trash",
        variant: "danger",
        /* translators: %d: row count. */
        confirm: __("Move %d post(s) to the trash?"),
        run: async (ids, ctx) => {
          const data = ctx.table.data ?? [];
          const trashable = ids.filter((id) => {
            const row = data.find((r) => r.id === id);
            return row && row.status !== "trash";
          });
          if (trashable.length === 0) {
            return;
          }
          const results = await Promise.all(
            trashable.map((id) => trashPost(id))
          );
          const errors = results.filter((r) => !r.ok);
          if (errors.length > 0) {
            console.error("[posts-window] some trashes failed", errors);
          }
          const okIds = results.filter((r) => r.ok).map((r) => r.id);
          const api = window.wp?.desktop;
          if (api && typeof api.broadcast === "function") {
            api.broadcast("desktop-mode.post.changed", {
              source: "posts-window",
              action: "trashed",
              ids: okIds
            });
          }
        }
      }
    ];
  }
  function resolveBulkActions() {
    const hooks = window.wp?.hooks;
    const defaults = defaultBulkActions();
    if (!hooks || typeof hooks.applyFilters !== "function") {
      return defaults;
    }
    try {
      const out = hooks.applyFilters(HOOK_FILTER_BULK_ACTIONS, defaults);
      return Array.isArray(out) ? out : defaults;
    } catch (err) {
      console.error(
        "[posts-window] bulk-actions filter threw; falling back to defaults:",
        err
      );
      return defaults;
    }
  }
  function resolveStatusSegments() {
    const hooks = window.wp?.hooks;
    const defaults = defaultStatusSegments();
    if (!hooks || typeof hooks.applyFilters !== "function") {
      return defaults;
    }
    try {
      const out = hooks.applyFilters(HOOK_FILTER_STATUS_SEGMENTS, defaults);
      return Array.isArray(out) && out.length > 0 ? out : defaults;
    } catch (err) {
      console.error(
        "[posts-window] status-segments filter threw; falling back to defaults:",
        err
      );
      return defaults;
    }
  }
  function resolveToolbarTrailing(ctx) {
    const hooks = window.wp?.hooks;
    if (!hooks || typeof hooks.applyFilters !== "function") {
      return [];
    }
    try {
      const out = hooks.applyFilters(HOOK_FILTER_TOOLBAR_TRAILING, [], ctx);
      if (!Array.isArray(out)) {
        return [];
      }
      return out.filter((el) => el instanceof HTMLElement);
    } catch (err) {
      console.error(
        "[posts-window] toolbar-trailing filter threw; ignoring:",
        err
      );
      return [];
    }
  }
  function buildTitleCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
    const titleRow = document.createElement("span");
    titleRow.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;";
    const link = document.createElement("a");
    link.href = buildEditPostUrl(row.id);
    link.setAttribute("data-noclick", "");
    const title = decodeTitle(row.title.rendered) || __("(no title)");
    link.textContent = title;
    link.title = title;
    link.style.cssText = "font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;";
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAdminUrl(link.href, {
        title,
        icon: "dashicons-admin-post"
      });
    });
    titleRow.appendChild(link);
    if (row.status && row.status !== "publish") {
      const badge = document.createElement("span");
      const colors = statusBadgeColor(row.status);
      badge.textContent = STATUS_LABELS[row.status] ?? row.status;
      badge.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "padding:2px 8px",
        "border-radius:10px",
        "font-size:11px",
        "font-weight:600",
        "text-transform:uppercase",
        "letter-spacing:0.04em",
        `background:${colors.bg}`,
        `color:${colors.fg}`,
        "white-space:nowrap",
        "flex-shrink:0"
      ].join(";");
      titleRow.appendChild(badge);
    }
    cell.appendChild(titleRow);
    return cell;
  }
  function buildAuthorCell(row) {
    const a = authorOf(row);
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:inline-flex;align-items:center;gap:8px;min-width:0;";
    if (a.avatar) {
      const img = document.createElement("img");
      img.src = a.avatar;
      img.alt = "";
      img.loading = "eager";
      img.decoding = "sync";
      img.style.cssText = "width:24px;height:24px;border-radius:50%;flex-shrink:0;";
      wrap.appendChild(img);
    }
    const name = document.createElement("span");
    name.textContent = a.name;
    name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    wrap.appendChild(name);
    return wrap;
  }
  function buildTagsCell(row) {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:inline-flex;align-items:center;width:100%;min-width:0;";
    const picker = document.createElement("wpd-tag-input");
    picker.setAttribute("creatable", "");
    picker.setAttribute("removable", "");
    picker.setAttribute("min-query", "0");
    picker.setAttribute("placeholder", __("Add tag…"));
    picker.setAttribute("add-label", __("Tag"));
    picker.setAttribute("data-noclick", "");
    const seed = termRecordsOf(row, "post_tag").map((t) => ({
      id: t.id,
      label: t.name
    }));
    picker.value = seed;
    const cellState = {
      // Mirror of `picker.value` we mutate optimistically. Keeping
      // it here (rather than reading back from the picker) avoids
      // double-source-of-truth bugs when two events fire in the
      // same tick.
      tags: seed.slice(),
      // AbortController for the in-flight suggest fetch.
      suggestAbort: null,
      suggestDebounce: null,
      // Last query the user typed — used to drop stale responses
      // even after AbortController has fired.
      lastQuery: ""
    };
    const setValue = (next) => {
      cellState.tags = next.slice();
      picker.value = next;
    };
    picker.addEventListener("wpd-tag-suggest", (e) => {
      const detail = e.detail;
      const query = detail?.query ?? "";
      cellState.lastQuery = query;
      if (cellState.suggestDebounce !== null) {
        window.clearTimeout(cellState.suggestDebounce);
        cellState.suggestDebounce = null;
      }
      cellState.suggestDebounce = window.setTimeout(async () => {
        cellState.suggestDebounce = null;
        if (cellState.suggestAbort) {
          cellState.suggestAbort.abort();
        }
        const ac = new AbortController();
        cellState.suggestAbort = ac;
        try {
          const matches = await searchTags(query, ac.signal);
          if (cellState.lastQuery !== query) {
            return;
          }
          const existingIds = new Set(cellState.tags.map((t) => t.id));
          picker.suggestions = matches.filter((m) => !existingIds.has(m.id)).map((m) => ({ id: m.id, label: m.name }));
        } catch (err) {
          if (err?.name === "AbortError") {
            return;
          }
          picker.suggestions = [];
          console.warn(
            "[posts-window] tag search failed",
            err
          );
        } finally {
          picker.suggestionsLoading = false;
        }
      }, 200);
    });
    picker.addEventListener("wpd-tag-add", async (e) => {
      const detail = e.detail;
      if (!detail?.tag) {
        return;
      }
      const optimistic = {
        id: detail.tag.id,
        label: detail.tag.label,
        pending: true
      };
      const next = [...cellState.tags, optimistic];
      setValue(next);
      try {
        let resolvedTag = null;
        if (detail.isNew || typeof detail.tag.id !== "number") {
          resolvedTag = await createTag(detail.tag.label);
        } else {
          resolvedTag = {
            id: Number(detail.tag.id),
            name: detail.tag.label,
            slug: ""
          };
        }
        const desiredIds = [
          ...cellState.tags.filter((t) => !t.pending).map((t) => Number(t.id)),
          resolvedTag.id
        ];
        await updatePostTags(row.id, desiredIds);
        setValue(
          cellState.tags.map((t) => {
            if (t.label.toLowerCase() === detail.tag.label.toLowerCase()) {
              return {
                id: resolvedTag.id,
                label: resolvedTag.name
              };
            }
            return t;
          })
        );
        const api = window.wp?.desktop;
        if (api && typeof api.broadcast === "function") {
          api.broadcast("desktop-mode.post.changed", {
            source: "posts-window",
            action: "tagged",
            ids: [row.id]
          });
        }
      } catch (err) {
        setValue(
          cellState.tags.filter(
            (t) => t.label.toLowerCase() !== detail.tag.label.toLowerCase()
          )
        );
        showTagError(
          sprintf(
            /* translators: %s: tag label */
            __('Couldn’t add tag "%s".'),
            detail.tag.label
          ),
          err
        );
      }
    });
    picker.addEventListener("wpd-tag-remove", async (e) => {
      const detail = e.detail;
      if (!detail?.tag) {
        return;
      }
      const removed = detail.tag;
      const previous = cellState.tags.slice();
      setValue(
        cellState.tags.map(
          (t) => t.label === removed.label ? { ...t, pending: true } : t
        )
      );
      try {
        const desiredIds = previous.filter((t) => t.label !== removed.label).map((t) => Number(t.id)).filter((n) => Number.isFinite(n));
        await updatePostTags(row.id, desiredIds);
        setValue(
          previous.filter((t) => t.label !== removed.label)
        );
        const api = window.wp?.desktop;
        if (api && typeof api.broadcast === "function") {
          api.broadcast("desktop-mode.post.changed", {
            source: "posts-window",
            action: "untagged",
            ids: [row.id]
          });
        }
      } catch (err) {
        setValue(previous);
        showTagError(
          sprintf(
            /* translators: %s: tag label */
            __('Couldn’t remove tag "%s".'),
            removed.label
          ),
          err
        );
      }
    });
    wrap.appendChild(picker);
    return wrap;
  }
  function showTagError(title, err) {
    const reason = err instanceof Error ? err.message : String(err);
    const api = window.wp?.desktop;
    if (api && typeof api.showToast === "function") {
      api.showToast({
        message: `${title} ${reason}`.trim(),
        duration: 6e3
      });
      return;
    }
    console.error(title, err);
  }
  function buildCategoriesCell(row) {
    const wrap = document.createElement("span");
    wrap.className = "wpd-cat-cell-dropzone";
    wrap.style.cssText = "display:inline-flex;align-items:center;width:100%;min-width:0;border-radius:6px;transition:background-color 0.12s ease, box-shadow 0.12s ease;";
    const picker = document.createElement(
      "wpd-category-picker"
    );
    picker.setAttribute("placeholder", __("Search categories…"));
    picker.setAttribute("add-label", __("Categorize"));
    picker.setAttribute("data-noclick", "");
    _activePickers.add(picker);
    picker.value = row.categories ?? [];
    const seedItems = termRecordsOf(row, "category").map(
      (t) => ({ id: t.id, name: t.name, parent: 0 })
    );
    picker.items = seedItems;
    const cellState = {
      categoryIds: (row.categories ?? []).slice()
    };
    const setValue = (next) => {
      cellState.categoryIds = next.slice();
      picker.value = next;
    };
    void getCategoriesTree().then((tree) => {
      if (!picker.isConnected) {
        return;
      }
      picker.items = tree;
    }).catch((err) => {
      console.warn("[posts-window] category tree fetch failed", err);
    });
    picker.addEventListener("wpd-categories-open", () => {
      void primePickerFromCache(picker);
    });
    picker.addEventListener(
      "wpd-categories-create",
      async (e) => {
        const detail = e.detail;
        const parent = detail?.parent ?? 0;
        if (!detail || !detail.name) {
          picker.failCreating(parent);
          return;
        }
        try {
          const created = await createCategory(detail.name, parent);
          _categoryTreePromise = null;
          const nextItems = [
            ...picker.items,
            {
              id: created.id,
              name: created.name,
              parent: created.parent
            }
          ];
          picker.items = nextItems;
          const nextValue = [...cellState.categoryIds, created.id];
          setValue(nextValue);
          picker.endCreating(parent);
          try {
            await updatePostCategories(row.id, nextValue);
            const api = window.wp?.desktop;
            if (api && typeof api.broadcast === "function") {
              api.broadcast("desktop-mode.post.changed", {
                source: "posts-window",
                action: "categorized",
                ids: [row.id]
              });
            }
          } catch (err) {
            setValue(cellState.categoryIds.filter((id) => id !== created.id));
            showTagError(__("Couldn’t assign new category."), err);
          }
        } catch (err) {
          picker.failCreating(
            parent,
            err instanceof Error ? err.message : String(err)
          );
          showTagError(__("Couldn’t create category."), err);
        }
      }
    );
    picker.addEventListener("wpd-categories-change", async (e) => {
      const detail = e.detail;
      if (!detail || !Array.isArray(detail.value)) {
        return;
      }
      const previous = cellState.categoryIds.slice();
      const next = detail.value.slice();
      setValue(next);
      try {
        await updatePostCategories(row.id, next);
        const api = window.wp?.desktop;
        if (api && typeof api.broadcast === "function") {
          api.broadcast("desktop-mode.post.changed", {
            source: "posts-window",
            action: "categorized",
            ids: [row.id]
          });
        }
      } catch (err) {
        setValue(previous);
        showTagError(__("Couldn’t update categories."), err);
      }
    });
    picker.addEventListener("wpd-categories-delete", async (e) => {
      const detail = e.detail;
      if (!detail || typeof detail.id !== "number") {
        return;
      }
      const ok = window.confirm(
        sprintf(
          /* translators: %s: category name. */
          __(
            'Delete the category "%s"? Posts assigned only to it will fall back to Uncategorized.'
          ),
          detail.name
        )
      );
      if (!ok) {
        return;
      }
      try {
        await deleteTerm("categories", detail.id);
        if (cellState.categoryIds.includes(detail.id)) {
          const next = cellState.categoryIds.filter(
            (id) => id !== detail.id
          );
          setValue(next);
          try {
            await updatePostCategories(row.id, next);
          } catch (err) {
            showTagError(
              __("Couldn’t update post categories after delete."),
              err
            );
          }
        }
      } catch (err) {
        showTagError(__("Couldn’t delete category."), err);
      }
    });
    picker.addEventListener("wpd-chain-segment-dragstart", (e) => {
      const detail = e.detail;
      if (!detail || !detail.dragEvent || !detail.dragEvent.dataTransfer) {
        return;
      }
      const ids = [];
      for (const seg of detail.segments) {
        if (typeof seg.id === "number") {
          ids.push(seg.id);
        }
      }
      if (ids.length === 0) {
        return;
      }
      const dt = detail.dragEvent.dataTransfer;
      dt.setData(
        "application/x-desktop-mode-categories",
        JSON.stringify({
          ids,
          source: "posts-window",
          sourcePostId: row.id
        })
      );
      dt.setData("text/plain", ids.join(","));
      dt.effectAllowed = "copy";
    });
    let dropEnterCount = 0;
    const setDropTargetActive = (on) => {
      if (on) {
        wrap.style.backgroundColor = "color-mix(in srgb, var(--wp-admin-theme-color, #2271b1) 12%, transparent)";
        wrap.style.boxShadow = "inset 0 0 0 2px var(--wp-admin-theme-color, #2271b1)";
      } else {
        wrap.style.backgroundColor = "";
        wrap.style.boxShadow = "";
      }
    };
    const acceptsCategoriesDrag = (e) => {
      const types = e.dataTransfer?.types;
      if (!types) {
        return false;
      }
      return Array.from(types).includes(
        "application/x-desktop-mode-categories"
      );
    };
    wrap.addEventListener("dragenter", (e) => {
      if (!acceptsCategoriesDrag(e)) {
        return;
      }
      e.preventDefault();
      dropEnterCount++;
      setDropTargetActive(true);
    });
    wrap.addEventListener("dragover", (e) => {
      if (!acceptsCategoriesDrag(e)) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    });
    wrap.addEventListener("dragleave", () => {
      if (dropEnterCount > 0) {
        dropEnterCount--;
      }
      if (dropEnterCount === 0) {
        setDropTargetActive(false);
      }
    });
    wrap.addEventListener("drop", async (e) => {
      dropEnterCount = 0;
      setDropTargetActive(false);
      if (!acceptsCategoriesDrag(e)) {
        return;
      }
      e.preventDefault();
      const json = e.dataTransfer?.getData(
        "application/x-desktop-mode-categories"
      );
      if (!json) {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch {
        return;
      }
      const payload = parsed;
      if (!payload || !Array.isArray(payload.ids)) {
        return;
      }
      const incoming = [];
      for (const v of payload.ids) {
        if (typeof v === "number" && Number.isFinite(v)) {
          incoming.push(v);
        }
      }
      if (incoming.length === 0) {
        return;
      }
      if (payload.sourcePostId === row.id && incoming.every((id) => cellState.categoryIds.includes(id))) {
        return;
      }
      const merged = Array.from(
        /* @__PURE__ */ new Set([...cellState.categoryIds, ...incoming])
      );
      if (merged.length === cellState.categoryIds.length) {
        return;
      }
      const previous = cellState.categoryIds.slice();
      setValue(merged);
      try {
        await updatePostCategories(row.id, merged);
        const api = window.wp?.desktop;
        if (api && typeof api.broadcast === "function") {
          api.broadcast("desktop-mode.post.changed", {
            source: "posts-window",
            action: "categorized",
            ids: [row.id]
          });
        }
      } catch (err) {
        setValue(previous);
        showTagError(__("Couldn’t add category."), err);
      }
    });
    wrap.appendChild(picker);
    return wrap;
  }
  let _categoryTreePromise = null;
  function getCategoriesTree() {
    if (!_categoryTreePromise) {
      _categoryTreePromise = fetchAllCategories().then(
        (terms) => terms.map((t) => ({
          id: t.id,
          name: t.name,
          parent: t.parent
        }))
      );
    }
    return _categoryTreePromise;
  }
  function clearCategoryTreeCache() {
    _categoryTreePromise = null;
  }
  const _activePickers = /* @__PURE__ */ new Set();
  function broadcastFreshCategoryTreeToPickers() {
    void getCategoriesTree().then((tree) => {
      for (const picker of _activePickers) {
        if (picker.isConnected) {
          picker.items = tree;
        } else {
          _activePickers.delete(picker);
        }
      }
    }).catch(() => {
    });
  }
  async function primePickerFromCache(picker) {
    if (!_categoryTreePromise) {
      return;
    }
    try {
      picker.items = await _categoryTreePromise;
    } catch {
    }
  }
  function buildDateCell(row) {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:flex;flex-direction:column;line-height:1.2;";
    const time = document.createElement("wpd-relative-time");
    time.setAttribute("datetime", row.date);
    wrap.appendChild(time);
    if (row.modified_gmt && row.modified_gmt !== row.date_gmt) {
      const meta = document.createElement("span");
      meta.textContent = __("modified");
      meta.style.cssText = "font-size:11px;color:#646970;";
      wrap.appendChild(meta);
    }
    return wrap;
  }
  function buildSubRow(row) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:16px;padding:12px 16px;background:#fafafa;align-items:flex-start;";
    const featured = featuredMediaOf(row);
    if (featured) {
      const img = document.createElement("img");
      img.src = featured.url;
      img.alt = featured.alt;
      img.loading = "lazy";
      img.style.cssText = "width:96px;height:96px;border-radius:6px;object-fit:cover;flex-shrink:0;";
      wrap.appendChild(img);
    }
    const text = document.createElement("div");
    text.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;";
    const heading = document.createElement("div");
    heading.style.cssText = "font-size:13px;color:#646970;text-transform:uppercase;letter-spacing:0.04em;";
    heading.textContent = __("Excerpt");
    text.appendChild(heading);
    const excerpt = document.createElement("div");
    excerpt.style.cssText = "color:#1d2327;line-height:1.5;";
    const raw = row.excerpt?.rendered ?? "";
    if (raw) {
      const stripped = raw.replace(/<[^>]+>/g, "").trim();
      excerpt.textContent = stripped || __("(no excerpt)");
    } else {
      excerpt.textContent = __("(no excerpt)");
      excerpt.style.color = "#a7aaad";
    }
    text.appendChild(excerpt);
    wrap.appendChild(text);
    return wrap;
  }
  async function renderPostsWindow(body) {
    const root = body.querySelector(ROOT);
    const table = body.querySelector(TABLE);
    if (!root || !table) {
      return;
    }
    const catsHost = body.querySelector(
      "[data-desktop-mode-posts-cats-host]"
    );
    const tagsHost = body.querySelector(
      "[data-desktop-mode-posts-tags-host]"
    );
    let catsTeardown = null;
    let tagsTeardown = null;
    const tabsEl = body.querySelector(".desktop-mode-posts__tabs");
    if (tabsEl) {
      tabsEl.addEventListener("wpd-tab-change", (e) => {
        const detail = e.detail;
        const value = detail?.value;
        if (value === "categories" && catsHost && !catsTeardown) {
          void Promise.resolve().then(() => categoriesMindmap).then(
            async ({ mountCategoriesMindmap: mountCategoriesMindmap2 }) => {
              catsTeardown = await mountCategoriesMindmap2(catsHost);
            }
          );
        }
        if (value === "tags" && tagsHost && !tagsTeardown) {
          void Promise.resolve().then(() => tagsCloud).then(
            async ({ mountTagsCloud: mountTagsCloud2 }) => {
              tagsTeardown = await mountTagsCloud2(tagsHost);
            }
          );
        }
      });
    }
    const cfg = getConfig();
    const view = {
      page: 1,
      perPage: Math.max(1, cfg.defaultPerPage || 20),
      search: "",
      status: "",
      orderby: "date",
      order: "desc",
      author: [],
      tag: [],
      searchDebounce: null
    };
    const cellCache = /* @__PURE__ */ new Map();
    const filterData = { authors: [], tags: [] };
    table.columns = buildColumns(cellCache, filterData);
    table.getRowId = (row) => row.id;
    table.subTable = (row) => buildSubRow(row);
    table.sort = { key: "date", direction: "desc" };
    let totalPages = 0;
    let totalRows = 0;
    let refreshSeq = 0;
    const perPageEl = root.querySelector(PER_PAGE);
    if (perPageEl) {
      perPageEl.value = String(view.perPage);
    }
    const indicator = root.querySelector(PAGE_INDICATOR);
    const prevBtn = root.querySelector(PREV);
    const nextBtn = root.querySelector(NEXT);
    const bulkBar = root.querySelector(BULK);
    const countEl = root.querySelector(COUNT);
    const bulkActionsHost = root.querySelector(BULK_ACTIONS_HOST);
    const trailingExtras = root.querySelector(
      TOOLBAR_TRAILING_EXTRAS
    );
    const statusHost = root.querySelector(STATUS);
    const statusSegments = resolveStatusSegments();
    if (statusHost) {
      statusHost.replaceChildren();
      for (const seg of statusSegments) {
        const el = document.createElement("wpd-segment");
        el.setAttribute("value", seg.value);
        el.textContent = seg.label;
        statusHost.appendChild(el);
      }
      statusHost.setAttribute("value", view.status);
    }
    const updatePager = () => {
      if (indicator) {
        if (totalRows === 0) {
          indicator.textContent = __("No posts");
        } else {
          indicator.textContent = sprintf(
            /* translators: 1: current page, 2: total pages, 3: total posts. */
            __("Page %1$d of %2$d · %3$d posts"),
            view.page,
            Math.max(totalPages, 1),
            totalRows
          );
        }
      }
      if (prevBtn) {
        prevBtn.toggleAttribute("disabled", view.page <= 1);
      }
      if (nextBtn) {
        nextBtn.toggleAttribute("disabled", view.page >= totalPages);
      }
    };
    const updateBulkBar = () => {
      if (!bulkBar || !countEl) {
        return;
      }
      const sel = Array.from(table.selection ?? []);
      if (sel.length === 0) {
        bulkBar.hidden = true;
        return;
      }
      bulkBar.hidden = false;
      countEl.textContent = sprintf(
        /* translators: %d: selected row count. */
        __("%d selected"),
        sel.length
      );
    };
    const buildParams = () => ({
      page: view.page,
      perPage: view.perPage,
      search: view.search || void 0,
      status: view.status || void 0,
      orderby: view.orderby,
      order: view.order,
      author: view.author.length > 0 ? view.author : void 0,
      tag: view.tag.length > 0 ? view.tag : void 0
    });
    const ctx = {
      body,
      table,
      refresh: () => refresh(),
      getSelectedIds: () => Array.from(table.selection ?? []).map((id) => Number(id)),
      getSelectedRows: () => {
        const ids = new Set(ctx.getSelectedIds());
        return (table.data ?? []).filter((r) => ids.has(r.id));
      },
      getCurrentParams: () => buildParams()
    };
    const refresh = async () => {
      const mySeq = ++refreshSeq;
      table.toggleAttribute("loading", true);
      try {
        const result = await fetchPosts(buildParams());
        if (mySeq !== refreshSeq) {
          return;
        }
        if (result.items.length === 0 && view.page > 1 && result.totalPages > 0 && view.page > result.totalPages) {
          view.page = 1;
          await refresh();
          return;
        }
        cellCache.clear();
        table.data = result.items;
        totalRows = result.total;
        totalPages = result.totalPages;
        updatePager();
        const hooks2 = window.wp?.hooks;
        if (hooks2 && typeof hooks2.doAction === "function") {
          hooks2.doAction(HOOK_ACTION_DATA_LOADED, {
            items: result.items,
            total: result.total,
            totalPages: result.totalPages,
            page: view.page
          });
        }
        document.dispatchEvent(
          new CustomEvent("desktop-mode-posts-window-data-loaded", {
            detail: {
              items: result.items,
              total: result.total,
              totalPages: result.totalPages,
              page: view.page
            }
          })
        );
      } catch (err) {
        if (mySeq !== refreshSeq) {
          return;
        }
        console.error("[posts-window] list failed", err);
        table.data = [];
        totalRows = 0;
        totalPages = 0;
        updatePager();
      } finally {
        if (mySeq === refreshSeq) {
          table.toggleAttribute("loading", false);
          updateBulkBar();
        }
      }
    };
    const goToFirstPage = () => {
      if (view.page !== 1) {
        view.page = 1;
      }
    };
    root.querySelector(STATUS)?.addEventListener("wpd-pick", (e) => {
      const value = e.detail?.value ?? "";
      view.status = value;
      goToFirstPage();
      void refresh();
    });
    root.querySelector(SEARCH)?.addEventListener(
      "wpd-input-change",
      (e) => {
        const value = e.detail?.value ?? "";
        view.search = value;
        if (view.searchDebounce !== null) {
          window.clearTimeout(view.searchDebounce);
        }
        view.searchDebounce = window.setTimeout(() => {
          goToFirstPage();
          void refresh();
        }, SEARCH_DEBOUNCE_MS);
      }
    );
    body.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      if (target.closest(REFRESH)) {
        void refresh();
        return;
      }
      if (target.closest(NEW_BTN)) {
        openAdminUrl(cfg.newPostUrl, {
          title: __("Add New Post"),
          icon: "dashicons-admin-post"
        });
        return;
      }
      if (target.closest(PREV)) {
        if (view.page > 1) {
          view.page -= 1;
          void refresh();
        }
        return;
      }
      if (target.closest(NEXT)) {
        if (view.page < totalPages) {
          view.page += 1;
          void refresh();
        }
      }
    });
    const bulkActions = resolveBulkActions();
    if (bulkActionsHost) {
      bulkActionsHost.replaceChildren();
      for (const action of bulkActions) {
        bulkActionsHost.appendChild(buildBulkActionButton(action, ctx));
      }
    }
    if (trailingExtras) {
      const extras = resolveToolbarTrailing(ctx);
      trailingExtras.replaceChildren(...extras);
    }
    perPageEl?.addEventListener("change", () => {
      const next = parseInt(perPageEl.value, 10);
      if (!Number.isFinite(next) || next < 1) {
        return;
      }
      view.perPage = next;
      goToFirstPage();
      void refresh();
    });
    table.addEventListener("wpd-table-selection-change", () => {
      updateBulkBar();
    });
    table.addEventListener("wpd-table-sort-change", (e) => {
      const detail = e.detail;
      if (!detail || !detail.sort) {
        view.orderby = "date";
        view.order = "desc";
      } else {
        view.orderby = mapColumnToOrderby(detail.sort.key);
        view.order = detail.sort.direction;
      }
      void refresh();
    });
    const parseIds = (raw) => raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    table.addEventListener("wpd-table-filter-change", (e) => {
      const detail = e.detail;
      const filters = detail?.filters ?? {};
      const nextAuthor = parseIds(filters.author ?? "");
      const nextTag = parseIds(filters.tags ?? "");
      const changed = !sameIds(nextAuthor, view.author) || !sameIds(nextTag, view.tag);
      if (!changed) {
        return;
      }
      view.author = nextAuthor;
      view.tag = nextTag;
      view.page = 1;
      void refresh();
    });
    activeRunBulkAction = async (action, actionCtx) => {
      const ids = actionCtx.getSelectedIds();
      if (ids.length === 0) {
        return;
      }
      if (action.confirm) {
        const ok = window.confirm(
          sprintf(
            /* translators: %d: row count. */
            action.confirm,
            ids.length
          )
        );
        if (!ok) {
          return;
        }
      }
      try {
        const result = await action.run(ids, actionCtx);
        if (result === false) {
          return;
        }
      } catch (err) {
        console.error(
          `[posts-window] bulk action "${action.id}" failed`,
          err
        );
      }
      table.clearSelection();
      await refresh();
    };
    const broadcastUnsubs = [];
    if (window.wp?.desktop && typeof window.wp.desktop.subscribe === "function") {
      const onChange = (payload) => {
        const detail = payload;
        if (detail?.source === "posts-window") {
          return;
        }
        void refresh();
      };
      broadcastUnsubs.push(
        window.wp.desktop.subscribe("desktop-mode.post.changed", onChange)
      );
      const onTermChange = (payload) => {
        const detail = payload;
        if (detail?.taxonomy === "category") {
          clearCategoryTreeCache();
          broadcastFreshCategoryTreeToPickers();
        }
      };
      broadcastUnsubs.push(
        window.wp.desktop.subscribe(
          "desktop-mode.term.changed",
          onTermChange
        )
      );
    }
    const repaintColumns = () => {
      cellCache.clear();
      table.columns = buildColumns(cellCache, filterData);
    };
    void fetchAuthorOptions().then((authors) => {
      filterData.authors = authors;
      repaintColumns();
    });
    let tagPage = 0;
    let tagTotalPages = 1;
    let tagFetching = false;
    const TAG_PAGE_SIZE = 50;
    const fetchNextTagPage = async () => {
      if (tagFetching || tagPage >= tagTotalPages) {
        return;
      }
      tagFetching = true;
      try {
        const next = tagPage + 1;
        const res = await fetchTagOptions(next, TAG_PAGE_SIZE);
        tagPage = next;
        tagTotalPages = Math.max(tagTotalPages, res.totalPages || next);
        const seen = new Set(filterData.tags.map((t) => t.id));
        for (const item of res.items) {
          if (!seen.has(item.id)) {
            filterData.tags.push(item);
            seen.add(item.id);
          }
        }
        filterData.tagsHasMore = tagPage < tagTotalPages;
        repaintColumns();
      } finally {
        tagFetching = false;
      }
    };
    filterData.loadMoreTags = () => {
      void fetchNextTagPage();
    };
    void fetchNextTagPage();
    const teardownKebabColumns = mountKebabColumnToggles(
      body,
      cellCache,
      repaintColumns
    );
    let unsubOsSettings = null;
    if (window.wp?.desktop && typeof window.wp.desktop.subscribeOsSettings === "function") {
      let lastHidden = JSON.stringify(
        Array.from(getHiddenColumns()).sort()
      );
      unsubOsSettings = window.wp.desktop.subscribeOsSettings(() => {
        const next = JSON.stringify(
          Array.from(getHiddenColumns()).sort()
        );
        if (next === lastHidden) {
          return;
        }
        lastHidden = next;
        repaintColumns();
        teardownKebabColumns?.refresh();
      });
    }
    const onWindowClosed = (e) => {
      const detail = e.detail;
      if (detail?.windowId !== "desktop-mode-posts") {
        return;
      }
      document.removeEventListener("desktop-mode-window-closed", onWindowClosed);
      for (const unsub of broadcastUnsubs) {
        try {
          unsub();
        } catch {
        }
      }
      broadcastUnsubs.length = 0;
      teardownKebabColumns?.dispose();
      unsubOsSettings?.();
      catsTeardown?.();
      catsTeardown = null;
      tagsTeardown?.();
      tagsTeardown = null;
      if (view.searchDebounce !== null) {
        window.clearTimeout(view.searchDebounce);
        view.searchDebounce = null;
      }
      clearCategoryTreeCache();
    };
    document.addEventListener("desktop-mode-window-closed", onWindowClosed);
    await refresh();
    const hooks = window.wp?.hooks;
    if (hooks && typeof hooks.doAction === "function") {
      hooks.doAction(HOOK_ACTION_OPENED, ctx);
    }
    document.dispatchEvent(
      new CustomEvent("desktop-mode-posts-window-opened", {
        detail: ctx
      })
    );
  }
  function buildBulkActionButton(action, ctx) {
    const btn = document.createElement("wpd-button");
    btn.setAttribute("variant", action.variant ?? "secondary");
    btn.setAttribute("data-desktop-mode-posts-bulk-action", action.id);
    if (action.icon) {
      const icon = document.createElement("span");
      icon.className = `dashicons ${action.icon}`;
      icon.setAttribute("aria-hidden", "true");
      btn.appendChild(icon);
    }
    btn.appendChild(document.createTextNode(" " + action.label));
    btn.addEventListener("click", () => {
      void runBulkActionFor(action, ctx);
    });
    return btn;
  }
  let activeRunBulkAction = async () => {
  };
  async function runBulkActionFor(action, ctx) {
    await activeRunBulkAction(action, ctx);
  }
  function openAdminUrl(url, opts = {}) {
    const api = window.wp?.desktop;
    if (!api || !api.windowManager || !api.deriveWindowId) {
      window.location.href = url;
      return;
    }
    const id = api.deriveWindowId(url);
    api.windowManager.open({
      id,
      baseId: id,
      url,
      title: opts.title ?? url,
      icon: opts.icon ?? "dashicons-admin-generic"
    });
  }
  function mapColumnToOrderby(key) {
    switch (key) {
      case "title":
        return "title";
      case "author":
        return "author";
      case "date":
        return "date";
      case "modified":
        return "modified";
      case "comments":
        return "comment_count";
      default:
        return "date";
    }
  }
  const registry = window.desktopModeNativeWindows ?? (window.desktopModeNativeWindows = {});
  registry["desktop-mode-posts"] = (body) => {
    return renderPostsWindow(body).catch((err) => {
      console.error("[posts-window] render failed:", err);
    });
  };
  const REPULSION_K = 5500;
  const SPRING_K = 0.05;
  const SPRING_LEN = 130;
  const MIN_RADIUS = 22;
  const MAX_RADIUS = 48;
  const POST_PER_PAGE$1 = 10;
  const POST_RING_RADIUS$1 = 170;
  async function mountCategoriesMindmap(host) {
    const api = window.wp?.desktop;
    if (!api || typeof api.loadModules !== "function") {
      host.textContent = __("Mindmap unavailable: shell modules API missing.");
      return () => {
      };
    }
    try {
      await api.loadModules(["pixijs"]);
    } catch {
      host.textContent = __("Mindmap unavailable.");
      return () => {
      };
    }
    const pixiMaybe = window.PIXI;
    if (!pixiMaybe) {
      host.textContent = __("Mindmap unavailable.");
      return () => {
      };
    }
    const pixi = pixiMaybe;
    host.replaceChildren();
    host.classList.add("wpd-mindmap");
    const toolbar = document.createElement("div");
    toolbar.className = "wpd-mindmap__toolbar";
    const addRootBtn = document.createElement("button");
    addRootBtn.type = "button";
    addRootBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--primary";
    addRootBtn.innerHTML = '<span class="dashicons dashicons-plus" aria-hidden="true"></span>' + __("Add root category");
    const recenterBtn = document.createElement("button");
    recenterBtn.type = "button";
    recenterBtn.className = "wpd-mindmap__btn";
    recenterBtn.innerHTML = '<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>' + __("Recenter");
    const hint = document.createElement("span");
    hint.className = "wpd-mindmap__hint";
    hint.textContent = __(
      "Click a node to focus + edit · drag onto another to reparent · wheel to zoom"
    );
    toolbar.appendChild(addRootBtn);
    toolbar.appendChild(recenterBtn);
    toolbar.appendChild(hint);
    host.appendChild(toolbar);
    const layout = document.createElement("div");
    layout.className = "wpd-mindmap__layout";
    host.appendChild(layout);
    const stage = document.createElement("div");
    stage.className = "wpd-mindmap__stage";
    stage.classList.add("is-loading");
    layout.appendChild(stage);
    const sidebar = document.createElement("aside");
    sidebar.className = "wpd-mindmap__sidebar";
    layout.appendChild(sidebar);
    const app = new pixi.Application();
    await app.init({
      resizeTo: stage,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    stage.appendChild(app.canvas);
    app.canvas.classList.add("wpd-mindmap__canvas");
    const world = new pixi.Container();
    world.x = stage.clientWidth / 2;
    world.y = stage.clientHeight / 2;
    app.stage.addChild(world);
    const edgeLayer = new pixi.Container();
    const nodeLayer = new pixi.Container();
    const postEdgeLayer = new pixi.Container();
    const postLayer = new pixi.Container();
    const chipLayer = new pixi.Container();
    const postChipLayer = new pixi.Container();
    world.addChild(edgeLayer);
    world.addChild(postEdgeLayer);
    world.addChild(postLayer);
    world.addChild(nodeLayer);
    world.addChild(chipLayer);
    world.addChild(postChipLayer);
    const edgeGfx = new pixi.Graphics();
    edgeLayer.addChild(edgeGfx);
    const postEdgeGfx = new pixi.Graphics();
    postEdgeLayer.addChild(postEdgeGfx);
    const pager = new pixi.Container();
    pager.eventMode = "passive";
    pager.visible = false;
    postLayer.addChild(pager);
    const pagerPrev = new pixi.Graphics();
    const pagerNext = new pixi.Graphics();
    const pagerLabel = new pixi.Text({
      text: "1 / 1",
      style: {
        fill: 5265246,
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: "600"
      }
    });
    pagerLabel.anchor.set(0.5);
    pagerPrev.eventMode = "static";
    pagerPrev.cursor = "pointer";
    pagerNext.eventMode = "static";
    pagerNext.cursor = "pointer";
    pagerPrev.hitArea = new pixi.Circle(0, 0, 16);
    pagerNext.hitArea = new pixi.Circle(0, 0, 16);
    pager.addChild(pagerPrev);
    pager.addChild(pagerLabel);
    pager.addChild(pagerNext);
    const stopBubble = (e) => {
      e.stopPropagation?.();
      pixiInteractionAt = performance.now();
    };
    pagerPrev.on("pointerdown", stopBubble);
    pagerNext.on("pointerdown", stopBubble);
    pagerPrev.on("pointertap", (e) => {
      stopBubble(e);
      lastFocusChange = performance.now();
      if (focusPage <= 1) {
        return;
      }
      focusPage--;
      void loadPostsForFocus();
    });
    pagerNext.on("pointertap", (e) => {
      stopBubble(e);
      lastFocusChange = performance.now();
      if (focusPage >= focusTotalPages) {
        return;
      }
      focusPage++;
      void loadPostsForFocus();
    });
    const nodes = /* @__PURE__ */ new Map();
    const chips = /* @__PURE__ */ new Map();
    const postChips = /* @__PURE__ */ new Map();
    const postNodes = /* @__PURE__ */ new Map();
    let focusId = null;
    let focusPage = 1;
    let focusTotalPages = 1;
    let loadSeq = 0;
    let pixiInteractionAt = 0;
    let dragNode = null;
    let dragHover = null;
    let panActive = false;
    let panStart = null;
    let panMovedDist = 0;
    let raf = null;
    let lastTick = performance.now();
    let targetScale = world.scale.x;
    let targetWorldX = world.x;
    let targetWorldY = world.y;
    let nudgeAwayFrom = null;
    const pinnedTargetBackup = /* @__PURE__ */ new Map();
    let prevView = null;
    let draft = null;
    const themeHue = readAdminThemeHue$1();
    const clusterColor = (idx) => hslToInt$1((themeHue + idx * 47) % 360, 55, 52);
    let terms = [];
    try {
      const all = [];
      let page = 1;
      while (page <= 5) {
        const res = await fetchTerms("categories", { page, perPage: 100 });
        all.push(...res.items);
        if (page >= res.totalPages) {
          break;
        }
        page++;
      }
      terms = all;
    } catch (err) {
      showToast$1(__("Couldn’t load categories:"), err);
    }
    const showError = (title, err) => showToast$1(title, err);
    function isUncategorized(term) {
      if (term.isDefault) {
        return true;
      }
      return term.id === 1 || term.slug === "uncategorized" || term.name.toLowerCase() === "uncategorized";
    }
    function buildTree() {
      const childMap = /* @__PURE__ */ new Map();
      for (const t of terms) {
        const list = childMap.get(t.parent) ?? [];
        list.push(t);
        childMap.set(t.parent, list);
      }
      const allRoots = childMap.get(0) ?? [];
      const roots = allRoots.filter((r) => !isUncategorized(r));
      const uncategorized = allRoots.find(isUncategorized);
      const place = (term, depth, rootIdx, angle, angleSpan) => {
        const rootRing = roots.length > 1 ? 110 + roots.length * 28 : 0;
        const baseRadius = depth === 0 ? rootRing : rootRing + 160 + (depth - 1) * 150;
        const tx = baseRadius * Math.cos(angle);
        const ty = baseRadius * Math.sin(angle);
        const radius = nodeRadius(term.count, terms);
        const color = depth === 0 ? clusterColor(rootIdx) : nodes.get(term.parent)?.color ?? clusterColor(rootIdx);
        let node = nodes.get(term.id);
        if (!node) {
          const gfx = new pixi.Graphics();
          gfx.eventMode = "static";
          gfx.cursor = "pointer";
          node = {
            id: term.id,
            parent: term.parent,
            name: term.name,
            description: term.description,
            count: term.count,
            x: tx,
            y: ty,
            tx,
            ty,
            radius,
            depth,
            color,
            gfx,
            pinned: depth === 0
          };
          nodeLayer.addChild(gfx);
          gfx.on("pointerdown", (e) => onNodePointerDown(e, node));
          nodes.set(term.id, node);
        } else {
          node.parent = term.parent;
          node.name = term.name;
          node.description = term.description;
          node.count = term.count;
          node.depth = depth;
          node.color = color;
          node.radius = radius;
          node.tx = tx;
          node.ty = ty;
          node.pinned = depth === 0;
        }
        drawNodeDisc(node, false);
        const kids = childMap.get(term.id) ?? [];
        if (kids.length > 0) {
          const sub = angleSpan / kids.length;
          kids.forEach((child, i) => {
            place(
              child,
              depth + 1,
              rootIdx,
              angle - angleSpan / 2 + sub * (i + 0.5),
              sub * 0.85
            );
          });
        }
      };
      const liveIds = new Set(terms.map((t) => t.id));
      for (const [id, node] of nodes) {
        if (!liveIds.has(id)) {
          nodeLayer.removeChild(node.gfx);
          node.gfx.destroy();
          nodes.delete(id);
          destroyChip(id);
        }
      }
      const rootCount = Math.max(1, roots.length);
      roots.forEach((root, idx) => {
        const angle = 2 * Math.PI / rootCount * idx;
        place(root, 0, idx, angle, 2 * Math.PI / rootCount);
      });
      if (uncategorized) {
        placeIsolated(uncategorized);
      }
    }
    function placeIsolated(term) {
      const tx = 360;
      const ty = -240;
      const radius = nodeRadius(term.count, terms);
      const color = 9211796;
      let node = nodes.get(term.id);
      if (!node) {
        const gfx = new pixi.Graphics();
        gfx.eventMode = "static";
        gfx.cursor = "pointer";
        node = {
          id: term.id,
          parent: 0,
          name: term.name,
          description: term.description,
          count: term.count,
          x: tx,
          y: ty,
          tx,
          ty,
          radius,
          depth: 0,
          color,
          gfx,
          pinned: true
        };
        nodeLayer.addChild(gfx);
        gfx.on("pointerdown", (e) => onNodePointerDown(e, node));
        nodes.set(term.id, node);
      } else {
        node.parent = 0;
        node.name = term.name;
        node.description = term.description;
        node.count = term.count;
        node.depth = 0;
        node.color = color;
        node.radius = radius;
        node.tx = tx;
        node.ty = ty;
        node.pinned = true;
      }
      drawNodeDisc(node, false);
    }
    function drawCurvedEdge(g, x1, y1, x2, y2, color, opts = {}) {
      const dx = x2 - x1;
      const cp1x = x1 + dx * 0.5;
      const cp1y = y1;
      const cp2x = x2 - dx * 0.5;
      const cp2y = y2;
      const alpha = opts.alpha ?? 0.5;
      const width = opts.width ?? 1.5;
      if (!opts.dashed) {
        g.moveTo(x1, y1);
        g.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
        g.stroke({ color, width, alpha });
        return;
      }
      const sampleAt = (t) => {
        const omt = 1 - t;
        const px = omt * omt * omt * x1 + 3 * omt * omt * t * cp1x + 3 * omt * t * t * cp2x + t * t * t * x2;
        const py = omt * omt * omt * y1 + 3 * omt * omt * t * cp1y + 3 * omt * t * t * cp2y + t * t * t * y2;
        return { x: px, y: py };
      };
      const STEPS = 32;
      const phase = opts.dashPhase ?? 0;
      const stride = Math.max(1, opts.dashStride ?? 1);
      let lastX = x1;
      let lastY = y1;
      for (let i = 1; i <= STEPS; i++) {
        const p = sampleAt(i / STEPS);
        const groupIdx = Math.floor((i - 1 + phase) / stride);
        const visible = groupIdx % 2 === 0;
        if (visible) {
          g.moveTo(lastX, lastY);
          g.lineTo(p.x, p.y);
          g.stroke({ color, width, alpha });
        }
        lastX = p.x;
        lastY = p.y;
      }
    }
    function drawNodeDisc(node, highlighted) {
      const g = node.gfx;
      g.clear();
      const r = node.radius;
      if (!highlighted) {
        g.circle(0, 5, r);
        g.fill({ color: 0, alpha: 0.18 });
      }
      if (highlighted) {
        g.circle(0, 0, r + 10);
        g.fill({ color: node.color, alpha: 0.22 });
      }
      g.circle(0, 0, r);
      g.fill(shadeColor(node.color, -0.18));
      g.circle(0, -r * 0.1, r * 0.94);
      g.fill(node.color);
      g.circle(-r * 0.32, -r * 0.42, r * 0.3);
      g.fill({ color: 16777215, alpha: 0.32 });
      g.circle(0, 0, r);
      g.stroke({
        color: 16777215,
        width: highlighted ? 3 : 2
      });
      g.x = node.x;
      g.y = node.y;
      g.zIndex = 10;
      g.hitArea = new pixi.Circle(0, 0, r + 4);
    }
    function drawDropTarget(hover, sourceColor) {
      drawNodeDisc(hover, false);
      const g = hover.gfx;
      const t = performance.now();
      const pulse = Math.sin(t / 280) * 0.5 + 0.5;
      const ringR = hover.radius + 6 + pulse * 5;
      g.circle(0, 0, ringR);
      g.stroke({
        color: sourceColor,
        width: 3,
        alpha: 0.6 + pulse * 0.35
      });
      g.circle(0, 0, hover.radius * 0.42);
      g.fill({ color: sourceColor, alpha: 0.85 });
      g.hitArea = new pixi.Circle(0, 0, hover.radius + 12);
    }
    function drawEdges() {
      edgeGfx.clear();
      for (const node of nodes.values()) {
        if (!node.parent) {
          continue;
        }
        const parent = nodes.get(node.parent);
        if (!parent) {
          continue;
        }
        const isOldLink = dragNode !== null && node === dragNode;
        const isFocusEdge = focusId !== null && (node.id === focusId || node.parent === focusId);
        const dimMul = focusId !== null && !isFocusEdge ? 0.35 : 1;
        drawCurvedEdge(
          edgeGfx,
          parent.x,
          parent.y,
          node.x,
          node.y,
          parent.color,
          isOldLink ? { dashed: true, alpha: 0.28 * dimMul } : { alpha: 0.5 * dimMul }
        );
      }
      if (dragNode && dragHover) {
        const x1 = dragNode.x;
        const y1 = dragNode.y;
        const x2 = dragHover.x;
        const y2 = dragHover.y;
        const targetColor = dragHover.color;
        drawCurvedEdge(edgeGfx, x1, y1, x2, y2, targetColor, {
          alpha: 0.22,
          width: 9
        });
        const dashPhase = Math.floor(performance.now() / 70);
        drawCurvedEdge(edgeGfx, x1, y1, x2, y2, targetColor, {
          alpha: 0.95,
          width: 2.5,
          dashed: true,
          dashStride: 2,
          dashPhase
        });
        const pt = performance.now() % 1300 / 1300;
        const omt = 1 - pt;
        const dx = x2 - x1;
        const cp1x = x1 + dx * 0.5;
        const cp1y = y1;
        const cp2x = x2 - dx * 0.5;
        const cp2y = y2;
        const px = omt * omt * omt * x1 + 3 * omt * omt * pt * cp1x + 3 * omt * pt * pt * cp2x + pt * pt * pt * x2;
        const py = omt * omt * omt * y1 + 3 * omt * omt * pt * cp1y + 3 * omt * pt * pt * cp2y + pt * pt * pt * y2;
        edgeGfx.circle(px, py, 5);
        edgeGfx.fill({ color: 16777215, alpha: 0.95 });
        edgeGfx.stroke({ color: targetColor, width: 2, alpha: 1 });
      }
      postEdgeGfx.clear();
      if (focusId !== null) {
        const center = nodes.get(focusId);
        if (center) {
          for (const post of postNodes.values()) {
            postEdgeGfx.moveTo(center.x, center.y);
            postEdgeGfx.lineTo(post.x, post.y);
            postEdgeGfx.stroke({
              color: center.color,
              width: 1,
              alpha: 0.35
            });
          }
        }
      }
    }
    const FONT_FAMILY2 = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const CHIP_TEXT_RES2 = 3;
    const CHIP_NAME_MAX_CHARS2 = 18;
    const POST_TITLE_MAX_CHARS2 = 22;
    function truncateChipName2(name) {
      return name.length > CHIP_NAME_MAX_CHARS2 ? name.slice(0, CHIP_NAME_MAX_CHARS2 - 1) + "…" : name;
    }
    function ensureChip(node) {
      const existing = chips.get(node.id);
      if (existing) {
        return existing;
      }
      const container = new pixi.Container();
      container.eventMode = "static";
      container.cursor = "pointer";
      const bg = new pixi.Graphics();
      container.addChild(bg);
      const nameText = new pixi.Text({
        text: truncateChipName2(node.name),
        style: {
          fill: 1909543,
          fontSize: 12,
          fontFamily: FONT_FAMILY2,
          fontWeight: "600"
        },
        resolution: CHIP_TEXT_RES2
      });
      container.addChild(nameText);
      const countBg = new pixi.Graphics();
      container.addChild(countBg);
      const countText = new pixi.Text({
        text: String(node.count),
        style: {
          fill: 16777215,
          fontSize: 10,
          fontFamily: FONT_FAMILY2,
          fontWeight: "700"
        },
        resolution: CHIP_TEXT_RES2
      });
      container.addChild(countText);
      const chip = {
        container,
        bg,
        nameText,
        countBg,
        countText,
        width: 0,
        height: 0,
        cachedName: "",
        cachedCount: -1,
        cachedFocused: false,
        cachedHover: false,
        cachedColor: -1
      };
      chips.set(node.id, chip);
      chipLayer.addChild(container);
      container.on("pointerdown", (e) => {
        e.stopPropagation?.();
        pixiInteractionAt = performance.now();
      });
      container.on("pointertap", () => {
        void focusNode(node.id);
      });
      container.on("pointerover", () => {
        chip.cachedHover = true;
        layoutChip(chip, node);
      });
      container.on("pointerout", () => {
        chip.cachedHover = false;
        layoutChip(chip, node);
      });
      return chip;
    }
    function layoutChip(chip, node) {
      const focused = focusId === node.id;
      const displayName = truncateChipName2(node.name);
      const countStr = String(node.count);
      if (chip.nameText.text !== displayName) {
        chip.nameText.text = displayName;
      }
      if (chip.countText.text !== countStr) {
        chip.countText.text = countStr;
      }
      chip.cachedName = displayName;
      chip.cachedCount = node.count;
      chip.cachedFocused = focused;
      chip.cachedColor = node.color;
      const padX = 9;
      const padY = 3;
      const gap = 5;
      const countPadX = 5;
      const countPadY = 2;
      const minBadgeW = 18;
      const nameW = chip.nameText.width;
      const nameH = chip.nameText.height;
      const countW = chip.countText.width;
      const countH = chip.countText.height;
      const badgeW = Math.max(minBadgeW, countW + countPadX * 2);
      const badgeH = countH + countPadY * 2;
      const totalW = padX + nameW + gap + badgeW + padX;
      const totalH = Math.max(nameH, badgeH) + padY * 2;
      chip.width = totalW;
      chip.height = totalH;
      const left = -totalW / 2;
      chip.bg.clear();
      chip.bg.roundRect(left, 0, totalW, totalH, totalH / 2);
      if (focused) {
        chip.bg.fill(node.color);
      } else if (chip.cachedHover) {
        chip.bg.fill({ color: 16777215, alpha: 0.96 });
        chip.bg.stroke({
          color: node.color,
          width: 1.5,
          alpha: 1
        });
      } else {
        chip.bg.fill({ color: 16777215, alpha: 0.88 });
        chip.bg.stroke({
          color: 0,
          width: 1,
          alpha: 0.06
        });
      }
      chip.nameText.x = left + padX;
      chip.nameText.y = (totalH - nameH) / 2;
      chip.nameText.style.fill = focused ? 16777215 : 1909543;
      const badgeX = left + padX + nameW + gap;
      const badgeY = (totalH - badgeH) / 2;
      chip.countBg.clear();
      chip.countBg.roundRect(
        badgeX,
        badgeY,
        badgeW,
        badgeH,
        badgeH / 2
      );
      chip.countBg.fill(
        focused ? { color: 16777215, alpha: 0.25 } : node.color
      );
      chip.countText.x = badgeX + (badgeW - countW) / 2;
      chip.countText.y = badgeY + (badgeH - countH) / 2;
    }
    function destroyChip(id) {
      const chip = chips.get(id);
      if (!chip) {
        return;
      }
      chipLayer.removeChild(chip.container);
      chip.container.destroy({ children: true });
      chips.delete(id);
    }
    function syncChipPositions() {
      const activeIds = new Set(nodes.keys());
      for (const id of [...chips.keys()]) {
        if (!activeIds.has(id)) {
          destroyChip(id);
        }
      }
      const chipCounterScale = 1 / Math.max(0.01, world.scale.x);
      const anyFocus = focusId !== null;
      for (const node of nodes.values()) {
        const chip = ensureChip(node);
        chip.container.x = node.x;
        chip.container.y = node.y + node.radius + 6;
        chip.container.scale.set(chipCounterScale);
        const focused = focusId === node.id;
        const targetAlpha = !anyFocus || focused ? 1 : 0.4;
        if (Math.abs(chip.container.alpha - targetAlpha) > 5e-3) {
          chip.container.alpha += (targetAlpha - chip.container.alpha) * 0.18;
        } else {
          chip.container.alpha = targetAlpha;
        }
        if (Math.abs(node.gfx.alpha - targetAlpha) > 5e-3) {
          node.gfx.alpha += (targetAlpha - node.gfx.alpha) * 0.18;
        } else {
          node.gfx.alpha = targetAlpha;
        }
        const displayName = truncateChipName2(node.name);
        if (chip.cachedName !== displayName || chip.cachedCount !== node.count || chip.cachedFocused !== focused || chip.cachedColor !== node.color) {
          layoutChip(chip, node);
        }
      }
      for (const post of postNodes.values()) {
        const chip = postChips.get(post.id);
        if (!chip) {
          continue;
        }
        chip.container.x = post.x;
        chip.container.y = post.y;
        chip.container.scale.set(chipCounterScale);
        if (chip.container.alpha < 1) {
          chip.container.alpha = Math.min(
            1,
            chip.container.alpha + 0.18
          );
        }
      }
    }
    function physicsStep(dt) {
      const list = Array.from(nodes.values());
      for (const a of list) {
        if (a.pinned) {
          a.x += (a.tx - a.x) * 0.12;
          a.y += (a.ty - a.y) * 0.12;
          a.gfx.x = a.x;
          a.gfx.y = a.y;
          continue;
        }
        let fx = 0;
        let fy = 0;
        for (const b of list) {
          if (a === b) {
            continue;
          }
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 1;
          const f = REPULSION_K / d2;
          const d = Math.sqrt(d2);
          fx += dx / d * f;
          fy += dy / d * f;
        }
        const parent = nodes.get(a.parent);
        if (parent) {
          const dx = parent.x - a.x;
          const dy = parent.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const stretch = d - SPRING_LEN;
          fx += dx / d * stretch * SPRING_K;
          fy += dy / d * stretch * SPRING_K;
        } else {
          fx += -a.x * 8e-4;
          fy += -a.y * 8e-4;
        }
        if (nudgeAwayFrom && a.id !== focusId) {
          const ndx = a.x - nudgeAwayFrom.x;
          const ndy = a.y - nudgeAwayFrom.y;
          const nd = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
          const limit = nudgeAwayFrom.radius + a.radius;
          if (nd < limit) {
            const pushK = 18;
            fx += ndx / nd * pushK * (limit - nd);
            fy += ndy / nd * pushK * (limit - nd);
          }
        }
        if (a !== dragNode) {
          a.x += fx * dt * 1e-3 + (a.tx - a.x) * 0.02;
          a.y += fy * dt * 1e-3 + (a.ty - a.y) * 0.02;
        }
        a.gfx.x = a.x;
        a.gfx.y = a.y;
      }
    }
    function preSettlePhysics(iterations) {
      for (let i = 0; i < iterations; i++) {
        physicsStep(16);
      }
      for (const n of nodes.values()) {
        n.tx = n.x;
        n.ty = n.y;
      }
    }
    function tick() {
      const now = performance.now();
      const dt = Math.min(50, now - lastTick);
      lastTick = now;
      const ZOOM_EASE = 0.22;
      const ds = targetScale - world.scale.x;
      const dwx = targetWorldX - world.x;
      const dwy = targetWorldY - world.y;
      if (Math.abs(ds) > 5e-4 || Math.abs(dwx) > 0.5 || Math.abs(dwy) > 0.5) {
        world.scale.set(world.scale.x + ds * ZOOM_EASE);
        world.x += dwx * ZOOM_EASE;
        world.y += dwy * ZOOM_EASE;
      }
      physicsStep(dt);
      for (const p of postNodes.values()) {
        p.x += (p.tx - p.x) * 0.18;
        p.y += (p.ty - p.y) * 0.18;
        p.gfx.x = p.x;
        p.gfx.y = p.y;
      }
      drawEdges();
      if (dragNode && dragHover) {
        drawDropTarget(dragHover, dragNode.color);
      }
      syncChipPositions();
      raf = requestAnimationFrame(tick);
    }
    let dragStartPos = null;
    let dragOffset = { x: 0, y: 0 };
    function onNodePointerDown(e, node) {
      const ev = e;
      ev.stopPropagation?.();
      pixiInteractionAt = performance.now();
      dragNode = node;
      node.pinned = true;
      node.tx = node.x;
      node.ty = node.y;
      dragStartPos = { x: ev.global.x, y: ev.global.y };
      const local = stageToWorld({ x: ev.global.x, y: ev.global.y });
      dragOffset = { x: node.x - local.x, y: node.y - local.y };
    }
    function stageToWorld(global) {
      return {
        x: (global.x - world.x) / world.scale.x,
        y: (global.y - world.y) / world.scale.y
      };
    }
    function onStagePointerDown(e) {
      const ev = e;
      panActive = true;
      panStart = { x: ev.global.x, y: ev.global.y };
      panMovedDist = 0;
    }
    function onStagePointerMove(e) {
      const ev = e;
      if (dragNode) {
        const cursorWorld = stageToWorld(ev.global);
        const nx = cursorWorld.x + dragOffset.x;
        const ny = cursorWorld.y + dragOffset.y;
        dragNode.x = nx;
        dragNode.y = ny;
        dragNode.tx = nx;
        dragNode.ty = ny;
        dragNode.gfx.x = nx;
        dragNode.gfx.y = ny;
        let hover = null;
        for (const c of nodes.values()) {
          if (c === dragNode) {
            continue;
          }
          const dx = c.x - cursorWorld.x;
          const dy = c.y - cursorWorld.y;
          if (dx * dx + dy * dy < c.radius * c.radius) {
            hover = c;
            break;
          }
        }
        if (hover !== dragHover) {
          if (dragHover) {
            drawNodeDisc(dragHover, focusId === dragHover.id);
          }
          dragHover = hover;
          if (hover && dragNode) {
            drawDropTarget(hover, dragNode.color);
          }
        }
        return;
      }
      if (panActive && panStart) {
        const dx = ev.global.x - panStart.x;
        const dy = ev.global.y - panStart.y;
        world.x += dx;
        world.y += dy;
        targetWorldX += dx;
        targetWorldY += dy;
        panMovedDist += Math.sqrt(dx * dx + dy * dy);
        panStart = { x: ev.global.x, y: ev.global.y };
      }
    }
    async function onStagePointerUp(e) {
      if (dragNode) {
        const node = dragNode;
        const target = dragHover;
        const startPos = dragStartPos;
        dragNode = null;
        dragHover = null;
        dragStartPos = null;
        node.pinned = node.depth === 0;
        let movement = Infinity;
        const ev = e;
        if (startPos && ev && ev.global) {
          const dx = ev.global.x - startPos.x;
          const dy = ev.global.y - startPos.y;
          movement = Math.sqrt(dx * dx + dy * dy);
        }
        if (!target && movement < 2) {
          focusNode(node.id);
          panActive = false;
          panStart = null;
          return;
        }
        if (target && target.id !== node.parent && !isAncestor(node.id, target.id)) {
          try {
            await updateTerm("categories", node.id, {
              parent: target.id
            });
            node.parent = target.id;
            terms = terms.map(
              (t) => t.id === node.id ? { ...t, parent: target.id } : t
            );
            buildTree();
          } catch (err) {
            showError(__("Reparent failed:"), err);
          }
        } else {
          drawNodeDisc(node, focusId === node.id);
          if (target) {
            drawNodeDisc(target, focusId === target.id);
          }
        }
      }
      panActive = false;
      panStart = null;
    }
    app.stage.eventMode = "static";
    app.stage.hitArea = new pixi.Rectangle(
      0,
      0,
      stage.clientWidth,
      stage.clientHeight
    );
    app.stage.on("pointerdown", onStagePointerDown);
    app.stage.on("pointermove", onStagePointerMove);
    app.stage.on("pointerup", (e) => void onStagePointerUp(e));
    app.stage.on("pointerupoutside", (e) => void onStagePointerUp(e));
    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const prev = targetScale;
      const next = Math.max(0.3, Math.min(2.5, prev * factor));
      if (next === prev) {
        return;
      }
      const r = stage.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const wx = (sx - targetWorldX) / prev;
      const wy = (sy - targetWorldY) / prev;
      targetScale = next;
      targetWorldX = sx - wx * next;
      targetWorldY = sy - wy * next;
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    let firstFitDone = false;
    function onResize() {
      const r = stage.getBoundingClientRect();
      app.renderer.resize(r.width, r.height);
      app.stage.hitArea = new pixi.Rectangle(0, 0, r.width, r.height);
      if (!firstFitDone && r.width > 0 && r.height > 0) {
        firstFitDone = true;
        fitToView();
        stage.classList.remove("is-loading");
      }
      app.render();
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(stage);
    function isAncestor(ancestor, descendant) {
      let cur = nodes.get(descendant);
      let safety = 32;
      while (cur && safety-- > 0) {
        if (cur.id === ancestor) {
          return true;
        }
        if (!cur.parent) {
          return false;
        }
        cur = nodes.get(cur.parent);
      }
      return false;
    }
    let lastFocusChange = 0;
    const SPOTLIGHT_RADIUS2 = POST_RING_RADIUS$1 + 130;
    async function focusNode(id) {
      if (focusId === id) {
        closeFocus();
        return;
      }
      const wasFocused = focusId !== null;
      focusId = id;
      focusPage = 1;
      lastFocusChange = performance.now();
      const focused = nodes.get(id);
      if (focused) {
        if (!wasFocused) {
          prevView = {
            scale: targetScale,
            x: targetWorldX,
            y: targetWorldY
          };
        }
        const r = stage.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const half = POST_RING_RADIUS$1 + 70;
          const sx = r.width * 0.85 / (2 * half);
          const sy = r.height * 0.85 / (2 * half);
          const newScale = Math.max(
            0.5,
            Math.min(1.6, Math.min(sx, sy))
          );
          targetScale = newScale;
          targetWorldX = r.width / 2 - focused.x * newScale;
          targetWorldY = r.height / 2 - focused.y * newScale;
        }
        nudgeAwayFrom = {
          x: focused.x,
          y: focused.y,
          radius: SPOTLIGHT_RADIUS2
        };
        pinnedTargetBackup.clear();
        for (const n of nodes.values()) {
          if (n.id === id || !n.pinned) {
            continue;
          }
          const dx = n.x - focused.x;
          const dy = n.y - focused.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d >= SPOTLIGHT_RADIUS2 + n.radius) {
            continue;
          }
          pinnedTargetBackup.set(n.id, { tx: n.tx, ty: n.ty });
          const push = SPOTLIGHT_RADIUS2 + n.radius + 20;
          n.tx = focused.x + dx / d * push;
          n.ty = focused.y + dy / d * push;
        }
      }
      for (const n of nodes.values()) {
        drawNodeDisc(n, focusId === n.id);
      }
      paintSidebar();
      await loadPostsForFocus();
    }
    function closeFocus() {
      focusId = null;
      lastFocusChange = performance.now();
      loadSeq++;
      nudgeAwayFrom = null;
      for (const [id, t] of pinnedTargetBackup) {
        const n = nodes.get(id);
        if (n) {
          n.tx = t.tx;
          n.ty = t.ty;
        }
      }
      pinnedTargetBackup.clear();
      if (prevView) {
        targetScale = prevView.scale;
        targetWorldX = prevView.x;
        targetWorldY = prevView.y;
        prevView = null;
      }
      paintSidebar();
      clearPosts();
      for (const n of nodes.values()) {
        drawNodeDisc(n, false);
      }
    }
    function clearPosts() {
      for (const post of postNodes.values()) {
        postLayer.removeChild(post.gfx);
        post.gfx.destroy();
      }
      postNodes.clear();
      for (const chip of postChips.values()) {
        postChipLayer.removeChild(chip.container);
        chip.container.destroy({ children: true });
      }
      postChips.clear();
      postEdgeGfx.clear();
      pager.visible = false;
    }
    function ensurePostChip(post) {
      const existing = postChips.get(post.id);
      if (existing) {
        return existing;
      }
      const container = new pixi.Container();
      container.eventMode = "static";
      container.cursor = "pointer";
      container.alpha = 0;
      const bg = new pixi.Graphics();
      container.addChild(bg);
      const dot = new pixi.Graphics();
      container.addChild(dot);
      const titleText = new pixi.Text({
        text: post.title,
        style: {
          fill: 1909543,
          // Matches category chip fontSize so the two read at
          // the same weight when both are deployed. Base size
          // is the on-screen size since the post chip's
          // container counter-scales with `1/world.scale.x`
          // in `syncChipPositions`.
          fontSize: 12,
          fontFamily: FONT_FAMILY2,
          fontWeight: "500"
        },
        resolution: CHIP_TEXT_RES2
      });
      container.addChild(titleText);
      const chip = {
        container,
        bg,
        dot,
        titleText,
        width: 0,
        height: 0,
        cachedTitle: "",
        cachedHover: false
      };
      postChips.set(post.id, chip);
      postChipLayer.addChild(container);
      container.on("pointerdown", (e) => {
        e.stopPropagation?.();
        pixiInteractionAt = performance.now();
      });
      container.on("pointertap", () => {
        openInPostsTab(post.id, post.editUrl, post.title);
      });
      container.on("pointerover", () => {
        chip.cachedHover = true;
        layoutPostChip(chip, post);
      });
      container.on("pointerout", () => {
        chip.cachedHover = false;
        layoutPostChip(chip, post);
      });
      layoutPostChip(chip, post);
      return chip;
    }
    function layoutPostChip(chip, post) {
      const displayTitle = post.title.length > POST_TITLE_MAX_CHARS2 ? post.title.slice(0, POST_TITLE_MAX_CHARS2 - 1) + "…" : post.title;
      if (chip.titleText.text !== displayTitle) {
        chip.titleText.text = displayTitle;
      }
      chip.cachedTitle = displayTitle;
      const padX = 9;
      const padY = 3;
      const dotR = 4;
      const gap = 6;
      const titleW = chip.titleText.width;
      const titleH = chip.titleText.height;
      const totalW = padX + dotR * 2 + gap + titleW + padX;
      const totalH = Math.max(titleH, dotR * 2) + padY * 2;
      chip.width = totalW;
      chip.height = totalH;
      const left = -totalW / 2;
      const top = -totalH / 2;
      chip.bg.clear();
      chip.bg.roundRect(left, top, totalW, totalH, totalH / 2);
      if (chip.cachedHover) {
        chip.bg.fill({ color: 16777215, alpha: 1 });
        chip.bg.stroke({
          color: post.tone,
          width: 1.5,
          alpha: 1
        });
      } else {
        chip.bg.fill({ color: 16777215, alpha: 0.95 });
        chip.bg.stroke({
          color: 0,
          width: 1,
          alpha: 0.12
        });
      }
      chip.dot.clear();
      chip.dot.circle(left + padX + dotR, 0, dotR);
      chip.dot.fill({ color: post.tone, alpha: 0.85 });
      chip.dot.stroke({ color: 16777215, width: 1 });
      chip.titleText.x = left + padX + dotR * 2 + gap;
      chip.titleText.y = -titleH / 2;
    }
    async function loadPostsForFocus() {
      if (focusId === null) {
        return;
      }
      const mySeq = ++loadSeq;
      const myFocusId = focusId;
      const cfg = getConfig();
      const url = new URL(cfg.postsUrl);
      url.searchParams.set("categories", String(focusId));
      url.searchParams.set("per_page", String(POST_PER_PAGE$1));
      url.searchParams.set("page", String(focusPage));
      url.searchParams.set("status", "any");
      url.searchParams.set("_fields", "id,title,status");
      try {
        const response = await fetchShellJson$1(url.toString());
        if (mySeq !== loadSeq || focusId !== myFocusId) {
          return;
        }
        const items = response.json ?? [];
        focusTotalPages = Math.max(
          1,
          parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10) || 1
        );
        const realTotal = parseInt(response.headers.get("X-WP-Total") ?? "", 10);
        if (Number.isFinite(realTotal) && focusId !== null) {
          const node = nodes.get(focusId);
          if (node && node.count !== realTotal) {
            node.count = realTotal;
            terms = terms.map(
              (t) => t.id === node.id ? { ...t, count: realTotal } : t
            );
            layoutChip(ensureChip(node), node);
          }
        }
        renderPosts(
          items.map((p) => ({
            id: p.id,
            title: stripTags$1(p.title?.rendered || `#${p.id}`),
            editUrl: `${cfg.editPostUrlBase}?post=${p.id}&action=edit`
          }))
        );
      } catch (err) {
        showError(__("Couldn’t load posts:"), err);
      }
    }
    function renderPosts(items) {
      clearPosts();
      if (focusId === null) {
        return;
      }
      const center = nodes.get(focusId);
      if (!center) {
        return;
      }
      const count = items.length;
      const ringR = POST_RING_RADIUS$1 + Math.max(0, count - 8) * 6;
      items.forEach((item, idx) => {
        const angle = 2 * Math.PI / Math.max(1, count) * idx - Math.PI / 2;
        const tx = center.x + Math.cos(angle) * ringR;
        const ty = center.y + Math.sin(angle) * ringR;
        const tone = center.color;
        const gfx = new pixi.Graphics();
        postLayer.addChild(gfx);
        const post = {
          id: item.id,
          title: item.title,
          editUrl: item.editUrl,
          angle,
          r: ringR,
          x: center.x,
          y: center.y,
          tx,
          ty,
          gfx,
          tone
        };
        postNodes.set(item.id, post);
        ensurePostChip(post);
      });
      repaintPager();
    }
    function repaintPager() {
      if (focusId === null || focusTotalPages <= 1) {
        pager.visible = false;
        return;
      }
      pager.visible = true;
      const center = nodes.get(focusId);
      if (!center) {
        pager.visible = false;
        return;
      }
      const prevDisabled = focusPage <= 1;
      const nextDisabled = focusPage >= focusTotalPages;
      drawPagerButton(pagerPrev, "◀", prevDisabled);
      drawPagerButton(pagerNext, "▶", nextDisabled);
      pagerPrev.cursor = prevDisabled ? "default" : "pointer";
      pagerNext.cursor = nextDisabled ? "default" : "pointer";
      pagerLabel.text = `${focusPage} / ${focusTotalPages}`;
      pagerPrev.x = -38;
      pagerPrev.y = 0;
      pagerNext.x = 38;
      pagerNext.y = 0;
      pagerLabel.x = 0;
      pagerLabel.y = 0;
      pager.x = center.x;
      pager.y = center.y + POST_RING_RADIUS$1 + 60;
    }
    function drawPagerButton(gfx, glyph, disabled) {
      gfx.clear();
      gfx.circle(0, 0, 14);
      gfx.fill({
        color: disabled ? 15921906 : 16777215,
        alpha: disabled ? 0.7 : 1
      });
      gfx.stroke({
        color: 0,
        width: 1,
        alpha: 0.12
      });
      const children = gfx.children;
      const label = children?.[0] ?? null;
      if (!label) {
        const t = new pixi.Text({
          text: glyph,
          style: {
            fill: disabled ? 11580344 : 5265246,
            fontSize: 14,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: "600"
          }
        });
        t.anchor.set(0.5);
        gfx.addChild(t);
      } else {
        label.text = glyph;
        label.style.fill = disabled ? 11580344 : 5265246;
      }
    }
    function openInPostsTab(_id, editUrl, title) {
      const wm = api?.windowManager;
      const derive = api?.deriveWindowId;
      if (wm && typeof derive === "function") {
        const id = derive(editUrl);
        wm.open({
          id,
          baseId: id,
          url: editUrl,
          title: title ?? editUrl,
          icon: "dashicons-admin-post"
        });
        return;
      }
      try {
        window.open(editUrl, "_blank");
      } catch {
        window.location.assign(editUrl);
      }
    }
    function paintDraftSidebar(d) {
      const parentNode = d.parent !== 0 ? nodes.get(d.parent) : null;
      const header = document.createElement("div");
      header.className = "wpd-mindmap__sidebar-header";
      const dot = document.createElement("span");
      dot.className = "wpd-mindmap__sidebar-dot";
      const color = parentNode ? parentNode.color : clusterColor(terms.length);
      dot.style.background = `#${color.toString(16).padStart(6, "0")}`;
      const label = document.createElement("code");
      label.className = "wpd-mindmap__sidebar-slug";
      label.textContent = parentNode ? sprintf(
        /* translators: %s: parent category name. */
        __("New child of %s"),
        parentNode.name
      ) : __("New root category");
      header.appendChild(dot);
      header.appendChild(label);
      sidebar.appendChild(header);
      const nameLabel = document.createElement("label");
      nameLabel.className = "wpd-mindmap__sidebar-label";
      nameLabel.textContent = __("Name");
      sidebar.appendChild(nameLabel);
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "wpd-mindmap__editor-name";
      nameInput.placeholder = __("e.g. Recipes");
      sidebar.appendChild(nameInput);
      requestAnimationFrame(() => nameInput.focus());
      const slugLabel = document.createElement("label");
      slugLabel.className = "wpd-mindmap__sidebar-label";
      slugLabel.textContent = __("Slug");
      sidebar.appendChild(slugLabel);
      const slugInput = document.createElement("input");
      slugInput.type = "text";
      slugInput.className = "wpd-mindmap__editor-name";
      slugInput.placeholder = __("auto-from-name");
      slugInput.spellcheck = false;
      slugInput.autocapitalize = "off";
      slugInput.addEventListener("input", () => {
        const v = slugInput.value;
        const norm = v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        if (v !== norm) {
          const sel = slugInput.selectionStart ?? norm.length;
          slugInput.value = norm;
          slugInput.setSelectionRange(sel, sel);
        }
      });
      sidebar.appendChild(slugInput);
      const descLabel = document.createElement("label");
      descLabel.className = "wpd-mindmap__sidebar-label";
      descLabel.textContent = __("Description");
      sidebar.appendChild(descLabel);
      const descInput = document.createElement("textarea");
      descInput.className = "wpd-mindmap__editor-desc";
      descInput.placeholder = __("Description (optional)");
      descInput.rows = 4;
      sidebar.appendChild(descInput);
      const actions = document.createElement("div");
      actions.className = "wpd-mindmap__editor-actions";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--primary";
      createBtn.textContent = __("Create");
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--danger";
      cancelBtn.textContent = __("Cancel");
      const handleCreate = async () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        createBtn.disabled = true;
        try {
          const created = await createCategory(name, d.parent, {
            slug: slugInput.value.trim() || void 0,
            description: descInput.value || void 0
          });
          const next = {
            id: created.id,
            name: created.name,
            slug: created.slug || "",
            parent: created.parent,
            count: 0,
            description: created.description || "",
            isDefault: false
          };
          if (!terms.some((t) => t.id === next.id)) {
            terms = terms.concat(next);
          }
          draft = null;
          buildTree();
          focusId = created.id;
          paintSidebar();
          await loadPostsForFocus();
        } catch (err) {
          createBtn.disabled = false;
          showError(__("Couldn’t create:"), err);
        }
      };
      createBtn.addEventListener("click", () => {
        void handleCreate();
      });
      cancelBtn.addEventListener("click", () => {
        draft = null;
        paintSidebar();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void handleCreate();
        } else if (e.key === "Escape") {
          draft = null;
          paintSidebar();
        }
      });
      actions.appendChild(createBtn);
      actions.appendChild(cancelBtn);
      sidebar.appendChild(actions);
    }
    function paintSidebar() {
      sidebar.replaceChildren();
      if (draft !== null) {
        paintDraftSidebar(draft);
        return;
      }
      if (focusId === null) {
        const empty = document.createElement("div");
        empty.className = "wpd-mindmap__sidebar-empty";
        const icon = document.createElement("span");
        icon.className = "dashicons dashicons-admin-tools";
        icon.setAttribute("aria-hidden", "true");
        empty.appendChild(icon);
        const title = document.createElement("h3");
        title.textContent = __("No category selected");
        empty.appendChild(title);
        const help = document.createElement("p");
        help.textContent = __(
          "Click a node on the mindmap to edit its name, description, and posts."
        );
        empty.appendChild(help);
        sidebar.appendChild(empty);
        return;
      }
      const node = nodes.get(focusId);
      if (!node) {
        focusId = null;
        paintSidebar();
        return;
      }
      const id = node.id;
      const header = document.createElement("div");
      header.className = "wpd-mindmap__sidebar-header";
      const dot = document.createElement("span");
      dot.className = "wpd-mindmap__sidebar-dot";
      dot.style.background = `#${node.color.toString(16).padStart(6, "0")}`;
      const term = terms.find((t) => t.id === id);
      const idLabel = document.createElement("code");
      idLabel.className = "wpd-mindmap__sidebar-slug";
      idLabel.textContent = `#${id}`;
      header.appendChild(dot);
      header.appendChild(idLabel);
      sidebar.appendChild(header);
      const nameLabel = document.createElement("label");
      nameLabel.className = "wpd-mindmap__sidebar-label";
      nameLabel.textContent = __("Name");
      sidebar.appendChild(nameLabel);
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "wpd-mindmap__editor-name";
      nameInput.value = node.name;
      nameInput.placeholder = __("Name");
      sidebar.appendChild(nameInput);
      const slugLabel = document.createElement("label");
      slugLabel.className = "wpd-mindmap__sidebar-label";
      slugLabel.textContent = __("Slug");
      sidebar.appendChild(slugLabel);
      const slugInput = document.createElement("input");
      slugInput.type = "text";
      slugInput.className = "wpd-mindmap__editor-name";
      slugInput.value = term?.slug || "";
      slugInput.placeholder = __("auto-from-name");
      slugInput.spellcheck = false;
      slugInput.autocapitalize = "off";
      slugInput.addEventListener("input", () => {
        const v = slugInput.value;
        const norm = v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        if (v !== norm) {
          const sel = slugInput.selectionStart ?? norm.length;
          slugInput.value = norm;
          slugInput.setSelectionRange(sel, sel);
        }
      });
      sidebar.appendChild(slugInput);
      const descLabel = document.createElement("label");
      descLabel.className = "wpd-mindmap__sidebar-label";
      descLabel.textContent = __("Description");
      sidebar.appendChild(descLabel);
      const descInput = document.createElement("textarea");
      descInput.className = "wpd-mindmap__editor-desc";
      descInput.value = node.description || "";
      descInput.placeholder = __("Description (optional)");
      descInput.rows = 4;
      sidebar.appendChild(descInput);
      const meta = document.createElement("p");
      meta.className = "wpd-mindmap__sidebar-meta";
      meta.textContent = sprintf(
        /* translators: %d: post count. */
        __("%d posts in this category."),
        node.count
      );
      sidebar.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "wpd-mindmap__editor-actions";
      const addChildBtn = document.createElement("button");
      addChildBtn.type = "button";
      addChildBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--secondary";
      addChildBtn.textContent = __("+ Child");
      addChildBtn.addEventListener("click", () => {
        startDraft(id);
      });
      const makeRootBtn = node.parent && node.parent !== 0 ? document.createElement("button") : null;
      if (makeRootBtn) {
        makeRootBtn.type = "button";
        makeRootBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--secondary";
        makeRootBtn.textContent = __("Make root");
        makeRootBtn.title = __(
          "Promote this category to a top-level root (no parent)."
        );
        makeRootBtn.addEventListener("click", async () => {
          try {
            await updateTerm("categories", node.id, { parent: 0 });
            node.parent = 0;
            terms = terms.map(
              (t) => t.id === node.id ? { ...t, parent: 0 } : t
            );
            buildTree();
            paintSidebar();
          } catch (err) {
            showError(__("Couldn’t reparent:"), err);
          }
        });
      }
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--primary";
      saveBtn.textContent = __("Save");
      saveBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) {
          return;
        }
        const description = descInput.value;
        const slugRaw = slugInput.value.trim();
        const currentSlug = term?.slug ?? "";
        if (name === node.name && description === (node.description || "") && slugRaw === currentSlug) {
          return;
        }
        const patch = { name, description };
        if (slugRaw !== currentSlug) {
          patch.slug = slugRaw;
        }
        try {
          const updated = await updateTerm(
            "categories",
            node.id,
            patch
          );
          node.name = updated.name;
          node.description = updated.description;
          terms = terms.map(
            (t) => t.id === node.id ? {
              ...t,
              name: updated.name,
              description: updated.description,
              slug: updated.slug ?? t.slug
            } : t
          );
          layoutChip(ensureChip(node), node);
          paintSidebar();
        } catch (err) {
          showError(__("Couldn’t save:"), err);
        }
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "wpd-mindmap__btn wpd-mindmap__btn--danger";
      delBtn.textContent = __("Delete");
      let armResetTimer = null;
      const armDelete = () => {
        delBtn.textContent = __("Click again to delete");
        delBtn.classList.add("is-armed");
        if (armResetTimer !== null) {
          window.clearTimeout(armResetTimer);
        }
        armResetTimer = window.setTimeout(() => {
          delBtn.textContent = __("Delete");
          delBtn.classList.remove("is-armed");
          armResetTimer = null;
        }, 2500);
      };
      delBtn.addEventListener("click", async () => {
        if (!delBtn.classList.contains("is-armed")) {
          armDelete();
          return;
        }
        if (armResetTimer !== null) {
          window.clearTimeout(armResetTimer);
          armResetTimer = null;
        }
        try {
          await deleteTerm("categories", node.id);
          terms = terms.filter((t) => t.id !== node.id);
          focusId = null;
          clearPosts();
          buildTree();
          paintSidebar();
        } catch (err) {
          showError(__("Couldn’t delete:"), err);
        }
      });
      actions.appendChild(addChildBtn);
      if (makeRootBtn) {
        actions.appendChild(makeRootBtn);
      }
      actions.appendChild(saveBtn);
      actions.appendChild(delBtn);
      sidebar.appendChild(actions);
    }
    function startDraft(parent) {
      if (parent !== 0 && !nodes.get(parent)) {
        return;
      }
      draft = { parent };
      paintSidebar();
    }
    addRootBtn.addEventListener("click", () => {
      startDraft(0);
    });
    function fitToView(padding = 90) {
      const r = stage.getBoundingClientRect();
      if (nodes.size === 0 || r.width === 0 || r.height === 0) {
        world.x = r.width / 2;
        world.y = r.height / 2;
        world.scale.set(1);
        targetScale = 1;
        targetWorldX = world.x;
        targetWorldY = world.y;
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const LABEL_OVERHANG = 30;
      for (const n of nodes.values()) {
        const rad = n.radius;
        minX = Math.min(minX, n.tx - rad);
        minY = Math.min(minY, n.ty - rad);
        maxX = Math.max(maxX, n.tx + rad);
        maxY = Math.max(maxY, n.ty + rad + LABEL_OVERHANG);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const sx = (r.width - padding * 2) / w;
      const sy = (r.height - padding * 2) / h;
      const scale = Math.max(0.2, Math.min(1.5, Math.min(sx, sy)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      world.scale.set(scale);
      world.x = r.width / 2 - cx * scale;
      world.y = r.height / 2 - cy * scale;
      targetScale = scale;
      targetWorldX = world.x;
      targetWorldY = world.y;
    }
    recenterBtn.addEventListener("click", () => fitToView());
    app.canvas.addEventListener("click", (e) => {
      const now = performance.now();
      if (now - lastFocusChange < 250 || now - pixiInteractionAt < 250) {
        return;
      }
      if (panMovedDist > 4) {
        return;
      }
      const target = e.target;
      if (target === app.canvas && !dragNode && focusId !== null) {
        closeFocus();
      }
    });
    async function refreshCountsViaBulk() {
      if (terms.length === 0) {
        return;
      }
      const cfg = getConfig();
      const url = new URL(
        `${cfg.restRoot.replace(/\/$/, "")}/desktop-mode/v1/term-counts`
      );
      url.searchParams.set("taxonomy", "category");
      url.searchParams.set(
        "ids",
        terms.map((t) => t.id).join(",")
      );
      try {
        const response = await fetchShellJson$1(url.toString());
        const map = response.json;
        let dirty = false;
        terms = terms.map((t) => {
          const fresh = map[String(t.id)];
          if (typeof fresh === "number" && fresh !== t.count) {
            dirty = true;
            const node = nodes.get(t.id);
            if (node) {
              node.count = fresh;
              layoutChip(ensureChip(node), node);
            }
            return { ...t, count: fresh };
          }
          return t;
        });
        if (dirty) {
          buildTree();
          fitToView();
        }
      } catch {
      }
    }
    buildTree();
    paintSidebar();
    preSettlePhysics(80);
    raf = requestAnimationFrame(tick);
    void refreshCountsViaBulk();
    if (terms.length <= 1) {
      const empty = document.createElement("div");
      empty.className = "wpd-mindmap__empty";
      empty.textContent = __(
        'No custom categories yet. Click "Add root category" to start branching.'
      );
      stage.appendChild(empty);
    }
    return () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      ro.disconnect();
      stage.removeEventListener("wheel", onWheel);
      try {
        app.destroy(true, { children: true, texture: true });
      } catch {
      }
      host.replaceChildren();
      host.classList.remove("wpd-mindmap");
    };
  }
  function nodeRadius(count, all) {
    const max = Math.max(1, ...all.map((t) => t.count));
    const ratio = Math.sqrt(count / max);
    return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * ratio;
  }
  function readAdminThemeHue$1() {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--wp-admin-theme-color").trim();
      if (!value) {
        return 210;
      }
      const c = document.createElement("span");
      c.style.color = value;
      document.body.appendChild(c);
      const rgb = getComputedStyle(c).color;
      c.remove();
      const m = rgb.match(/\d+/g);
      if (!m || m.length < 3) {
        return 210;
      }
      return rgbToHue$1(
        parseInt(m[0], 10),
        parseInt(m[1], 10),
        parseInt(m[2], 10)
      );
    } catch {
      return 210;
    }
  }
  function rgbToHue$1(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    if (d === 0) {
      return 210;
    }
    let h;
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    return Math.round(h * 60);
  }
  function hslToInt$1(h, s, l) {
    const sn = s / 100;
    const ln = l / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const hp = h / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    const m = ln - c / 2;
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    return ri * 65536 + gi * 256 + bi;
  }
  function shadeColor(color, delta) {
    const r = Math.floor(color / 65536) % 256;
    const g = Math.floor(color / 256) % 256;
    const b = color % 256;
    const adj = (ch) => {
      return Math.round(ch * (1 + delta));
    };
    return adj(r) * 65536 + adj(g) * 256 + adj(b);
  }
  function stripTags$1(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }
  function showToast$1(title, err) {
    const reason = err instanceof Error ? err.message : String(err);
    const api = window.wp?.desktop;
    if (api && typeof api.showToast === "function") {
      api.showToast({
        message: `${title} ${reason}`.trim(),
        duration: 6e3
      });
      return;
    }
    console.error(title, err);
  }
  async function fetchShellJson$1(url) {
    const cfg = getConfig();
    const api = window.wp?.desktop;
    const init = {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": cfg.restNonce,
        Accept: "application/json"
      }
    };
    let response;
    if (api && typeof api.fetch === "function") {
      response = await api.fetch(url, init, {
        windowId: "desktop-mode-posts"
      });
    } else {
      response = await fetch(url, init);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    return { json, headers: response.headers };
  }
  const categoriesMindmap = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    mountCategoriesMindmap
  }, Symbol.toStringTag, { value: "Module" }));
  const POST_PER_PAGE = 10;
  const POST_RING_RADIUS = 170;
  const MIN_FONT_SIZE = 11;
  const MAX_FONT_SIZE = 28;
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const CHIP_TEXT_RES = 3;
  const CHIP_NAME_MAX_CHARS = 22;
  const POST_TITLE_MAX_CHARS = 22;
  const CHIP_PAD_X = 11;
  const CHIP_PAD_Y = 6;
  const CHIP_GAP_HASH = 4;
  const CHIP_GAP_COUNT = 8;
  const SPIRAL_PADDING = 14;
  const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;
  async function mountTagsCloud(host) {
    const api = window.wp?.desktop;
    if (!api || typeof api.loadModules !== "function") {
      host.textContent = __("Tag cloud unavailable: shell modules API missing.");
      return () => {
      };
    }
    try {
      await api.loadModules(["pixijs"]);
    } catch {
      host.textContent = __("Tag cloud unavailable.");
      return () => {
      };
    }
    const pixiMaybe = window.PIXI;
    if (!pixiMaybe) {
      host.textContent = __("Tag cloud unavailable.");
      return () => {
      };
    }
    const pixi = pixiMaybe;
    host.replaceChildren();
    host.classList.add("wpd-tagcloud");
    const toolbar = document.createElement("div");
    toolbar.className = "wpd-tagcloud__toolbar";
    const addTagBtn = document.createElement("button");
    addTagBtn.type = "button";
    addTagBtn.className = "wpd-tagcloud__btn wpd-tagcloud__btn--primary";
    addTagBtn.innerHTML = '<span class="dashicons dashicons-plus" aria-hidden="true"></span>' + __("Add tag");
    const recenterBtn = document.createElement("button");
    recenterBtn.type = "button";
    recenterBtn.className = "wpd-tagcloud__btn";
    recenterBtn.innerHTML = '<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>' + __("Recenter");
    const reflowBtn = document.createElement("button");
    reflowBtn.type = "button";
    reflowBtn.className = "wpd-tagcloud__btn";
    reflowBtn.innerHTML = '<span class="dashicons dashicons-grid-view" aria-hidden="true"></span>' + __("Reflow");
    reflowBtn.title = __(
      "Recompute the chip layout from scratch — discards manual repositioning."
    );
    const hint = document.createElement("span");
    hint.className = "wpd-tagcloud__hint";
    hint.textContent = __(
      "Click a tag to focus + edit · drag to reposition · wheel to zoom"
    );
    toolbar.appendChild(addTagBtn);
    toolbar.appendChild(recenterBtn);
    toolbar.appendChild(reflowBtn);
    toolbar.appendChild(hint);
    host.appendChild(toolbar);
    const layout = document.createElement("div");
    layout.className = "wpd-tagcloud__layout";
    host.appendChild(layout);
    const stage = document.createElement("div");
    stage.className = "wpd-tagcloud__stage";
    stage.classList.add("is-loading");
    layout.appendChild(stage);
    const sidebar = document.createElement("aside");
    sidebar.className = "wpd-tagcloud__sidebar";
    layout.appendChild(sidebar);
    const app = new pixi.Application();
    await app.init({
      resizeTo: stage,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    stage.appendChild(app.canvas);
    app.canvas.classList.add("wpd-tagcloud__canvas");
    const world = new pixi.Container();
    world.x = stage.clientWidth / 2;
    world.y = stage.clientHeight / 2;
    app.stage.addChild(world);
    const chipLayer = new pixi.Container();
    const postEdgeLayer = new pixi.Container();
    const postLayer = new pixi.Container();
    const postChipLayer = new pixi.Container();
    world.addChild(chipLayer);
    world.addChild(postEdgeLayer);
    world.addChild(postLayer);
    world.addChild(postChipLayer);
    const postEdgeGfx = new pixi.Graphics();
    postEdgeLayer.addChild(postEdgeGfx);
    const pager = new pixi.Container();
    pager.eventMode = "passive";
    pager.visible = false;
    postLayer.addChild(pager);
    const pagerPrev = new pixi.Graphics();
    const pagerNext = new pixi.Graphics();
    const pagerLabel = new pixi.Text({
      text: "1 / 1",
      style: {
        fill: 5265246,
        fontSize: 12,
        fontFamily: FONT_FAMILY,
        fontWeight: "600"
      }
    });
    pagerLabel.anchor.set(0.5);
    pagerPrev.eventMode = "static";
    pagerPrev.cursor = "pointer";
    pagerNext.eventMode = "static";
    pagerNext.cursor = "pointer";
    pagerPrev.hitArea = new pixi.Circle(0, 0, 16);
    pagerNext.hitArea = new pixi.Circle(0, 0, 16);
    pager.addChild(pagerPrev);
    pager.addChild(pagerLabel);
    pager.addChild(pagerNext);
    const stopBubble = (e) => {
      e.stopPropagation?.();
      pixiInteractionAt = performance.now();
    };
    pagerPrev.on("pointerdown", stopBubble);
    pagerNext.on("pointerdown", stopBubble);
    pagerPrev.on("pointertap", (e) => {
      stopBubble(e);
      lastFocusChange = performance.now();
      if (focusPage <= 1) {
        return;
      }
      focusPage--;
      void loadPostsForFocus();
    });
    pagerNext.on("pointertap", (e) => {
      stopBubble(e);
      lastFocusChange = performance.now();
      if (focusPage >= focusTotalPages) {
        return;
      }
      focusPage++;
      void loadPostsForFocus();
    });
    const tags = /* @__PURE__ */ new Map();
    const postChips = /* @__PURE__ */ new Map();
    const postNodes = /* @__PURE__ */ new Map();
    let focusId = null;
    let focusPage = 1;
    let focusTotalPages = 1;
    let loadSeq = 0;
    let pixiInteractionAt = 0;
    let dragChip = null;
    let dragOffset = { x: 0, y: 0 };
    let dragStart = null;
    let panActive = false;
    let panStart = null;
    let panMovedDist = 0;
    let raf = null;
    let lastTick = performance.now();
    let targetScale = world.scale.x;
    let targetWorldX = world.x;
    let targetWorldY = world.y;
    let nudgeAwayFrom = null;
    let prevView = null;
    let lastFocusChange = 0;
    let draft = null;
    let terms = [];
    const positionsKey = computePositionsKey();
    const persistedPositions = readPersistedPositions(positionsKey);
    const themeHue = readAdminThemeHue();
    try {
      const all = [];
      let page = 1;
      while (page <= 5) {
        const res = await fetchTerms("tags", { page, perPage: 100 });
        all.push(...res.items);
        if (page >= res.totalPages) {
          break;
        }
        page++;
      }
      terms = all;
    } catch (err) {
      showToast(__("Couldn’t load tags:"), err);
    }
    const showError = (title, err) => showToast(title, err);
    function buildCloud() {
      const liveIds = new Set(terms.map((t) => t.id));
      for (const [id, box] of tags) {
        if (!liveIds.has(id)) {
          chipLayer.removeChild(box.chip.container);
          box.chip.container.destroy({ children: true });
          tags.delete(id);
        }
      }
      const maxCount = Math.max(1, ...terms.map((t) => t.count));
      const fresh = [];
      for (const term of terms) {
        const fontSize = fontSizeFor(term.count, maxCount);
        const hue = tagHue(term.slug || term.name, themeHue);
        const rotation = tagRotation(term.slug || term.name);
        const existing = tags.get(term.id);
        if (existing) {
          existing.name = term.name;
          existing.slug = term.slug;
          existing.description = term.description;
          existing.count = term.count;
          existing.fontSize = fontSize;
          existing.hue = hue;
          existing.rotation = rotation;
          layoutChip(existing);
        } else {
          const chip = createTagChip(pixi, chipLayer, term, fontSize, hue);
          const persisted = persistedPositions.get(term.id);
          const box = {
            id: term.id,
            name: term.name,
            slug: term.slug,
            description: term.description,
            count: term.count,
            fontSize,
            hue,
            rotation,
            x: persisted ? persisted.x : 0,
            y: persisted ? persisted.y : 0,
            tx: persisted ? persisted.x : 0,
            ty: persisted ? persisted.y : 0,
            width: 0,
            height: 0,
            chip
          };
          tags.set(term.id, box);
          layoutChip(box);
          wireChipPointer(box);
          if (!persisted) {
            fresh.push(box);
          }
        }
      }
      const placed = [];
      for (const box of tags.values()) {
        if (!fresh.includes(box)) {
          placed.push({
            x: box.tx - box.width / 2,
            y: box.ty - box.height / 2,
            w: box.width,
            h: box.height
          });
        }
      }
      fresh.sort((a, b) => b.count - a.count);
      for (const box of fresh) {
        const slot = findSpiralSlot(box.width, box.height, placed);
        box.tx = slot.x;
        box.ty = slot.y;
        box.x = slot.x;
        box.y = slot.y;
        placed.push({
          x: slot.x - box.width / 2,
          y: slot.y - box.height / 2,
          w: box.width,
          h: box.height
        });
      }
    }
    function wireChipPointer(box) {
      const c = box.chip.container;
      c.on("pointerdown", (e) => {
        const ev = e;
        ev.stopPropagation?.();
        pixiInteractionAt = performance.now();
        dragChip = box;
        dragStart = { x: ev.global.x, y: ev.global.y };
        const local = stageToWorld({ x: ev.global.x, y: ev.global.y });
        dragOffset = { x: box.x - local.x, y: box.y - local.y };
      });
      c.on("pointerover", () => {
        box.chip.cachedHover = true;
        paintChip(box);
      });
      c.on("pointerout", () => {
        box.chip.cachedHover = false;
        paintChip(box);
      });
    }
    function layoutChip(box) {
      const chip = box.chip;
      const displayName = truncateChipName(box.name);
      const countStr = String(box.count);
      if (chip.nameText.text !== displayName) {
        chip.nameText.text = displayName;
      }
      if (chip.countText.text !== countStr) {
        chip.countText.text = countStr;
      }
      chip.nameText.style.fontSize = box.fontSize;
      chip.hashText.style.fontSize = box.fontSize;
      chip.countText.style.fontSize = Math.max(
        10,
        Math.round(box.fontSize * 0.55)
      );
      chip.cachedName = displayName;
      chip.cachedCount = box.count;
      chip.cachedHue = box.hue;
      const hashW = chip.hashText.width;
      const nameW = chip.nameText.width;
      const nameH = chip.nameText.height;
      const countW = chip.countText.width;
      const countH = chip.countText.height;
      const countBadgeW = Math.max(18, countW + 10);
      const countBadgeH = Math.max(14, countH + 4);
      const totalW = CHIP_PAD_X + hashW + CHIP_GAP_HASH + nameW + CHIP_GAP_COUNT + countBadgeW + CHIP_PAD_X;
      const totalH = Math.max(nameH, countBadgeH) + CHIP_PAD_Y * 2;
      box.width = totalW;
      box.height = totalH;
      paintChip(box);
    }
    function paintChip(box) {
      const chip = box.chip;
      const focused = focusId === box.id;
      chip.cachedFocused = focused;
      const totalW = box.width;
      const totalH = box.height;
      const left = -totalW / 2;
      const top = -totalH / 2;
      const radius = totalH / 2;
      let fillBg;
      if (focused) {
        fillBg = hslToInt(box.hue, 70, 48);
      } else if (chip.cachedHover) {
        fillBg = hslToInt(box.hue, 70, 92);
      } else {
        fillBg = hslToInt(box.hue, 60, 95);
      }
      const borderColor = focused ? hslToInt(box.hue, 70, 38) : hslToInt(box.hue, 50, 70);
      const textColor = focused ? 16777215 : 1909543;
      const hashColor = focused ? 16777215 : hslToInt(box.hue, 65, 42);
      const countBg = focused ? hslToInt(box.hue, 80, 30) : hslToInt(box.hue, 70, 50);
      chip.shadow.clear();
      chip.shadow.roundRect(
        left - 1,
        top + 3,
        totalW + 2,
        totalH + 2,
        radius + 1
      );
      let shadowAlpha = 0.1;
      if (focused) {
        shadowAlpha = 0.18;
      } else if (chip.cachedHover) {
        shadowAlpha = 0.16;
      }
      chip.shadow.fill({
        color: 0,
        alpha: shadowAlpha
      });
      chip.bg.clear();
      chip.bg.roundRect(left, top, totalW, totalH, radius);
      chip.bg.fill(fillBg);
      chip.bg.stroke({
        color: borderColor,
        width: focused ? 2 : 1.25,
        alpha: focused ? 1 : 0.85
      });
      const hashW = chip.hashText.width;
      const nameW = chip.nameText.width;
      const nameH = chip.nameText.height;
      const countW = chip.countText.width;
      const countH = chip.countText.height;
      const countBadgeW = Math.max(18, countW + 10);
      const countBadgeH = Math.max(14, countH + 4);
      chip.hashText.x = left + CHIP_PAD_X;
      chip.hashText.y = (totalH - nameH) / 2 + top;
      chip.hashText.style.fill = hashColor;
      chip.nameText.x = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH;
      chip.nameText.y = (totalH - nameH) / 2 + top;
      chip.nameText.style.fill = textColor;
      const badgeX = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH + nameW + CHIP_GAP_COUNT;
      const badgeY = (totalH - countBadgeH) / 2 + top;
      chip.bg.roundRect(
        badgeX,
        badgeY,
        countBadgeW,
        countBadgeH,
        countBadgeH / 2
      );
      chip.bg.fill(countBg);
      chip.countText.x = badgeX + (countBadgeW - countW) / 2;
      chip.countText.y = badgeY + (countBadgeH - countH) / 2;
      chip.countText.style.fill = 16777215;
    }
    function findSpiralSlot(w, h, placed) {
      if (placed.length === 0) {
        return { x: 0, y: 0 };
      }
      const padding = SPIRAL_PADDING;
      let theta = 0;
      const maxIter = 1e4;
      for (let i = 0; i < maxIter; i++) {
        theta += 0.18;
        const r = theta * 5;
        const cx = r * Math.cos(theta);
        const cy = r * Math.sin(theta) * 0.7;
        const aabb = {
          x: cx - w / 2 - padding,
          y: cy - h / 2 - padding,
          w: w + padding * 2,
          h: h + padding * 2
        };
        let overlap = false;
        for (const p of placed) {
          if (aabbIntersect(aabb, p)) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          return { x: cx, y: cy };
        }
      }
      return { x: 0, y: (placed.length + 1) * (h + padding) };
    }
    function syncChipPositions() {
      const chipCounterScale = 1 / Math.max(0.01, world.scale.x);
      const anyFocus = focusId !== null;
      for (const box of tags.values()) {
        const c = box.chip.container;
        c.x = box.x;
        c.y = box.y;
        const counter = Math.max(1, chipCounterScale);
        c.scale.set(counter);
        c.rotation = box.rotation;
        const focused = focusId === box.id;
        const targetAlpha = !anyFocus || focused ? 1 : 0.32;
        if (Math.abs(c.alpha - targetAlpha) > 5e-3) {
          c.alpha += (targetAlpha - c.alpha) * 0.18;
        } else {
          c.alpha = targetAlpha;
        }
      }
      for (const post of postNodes.values()) {
        const chip = postChips.get(post.id);
        if (!chip) {
          continue;
        }
        chip.container.x = post.x;
        chip.container.y = post.y;
        chip.container.scale.set(chipCounterScale);
        if (chip.container.alpha < 1) {
          chip.container.alpha = Math.min(
            1,
            chip.container.alpha + 0.18
          );
        }
      }
    }
    function tick() {
      const now = performance.now();
      const dt = Math.min(50, now - lastTick);
      lastTick = now;
      const ZOOM_EASE = 0.22;
      const ds = targetScale - world.scale.x;
      const dwx = targetWorldX - world.x;
      const dwy = targetWorldY - world.y;
      if (Math.abs(ds) > 5e-4 || Math.abs(dwx) > 0.5 || Math.abs(dwy) > 0.5) {
        world.scale.set(world.scale.x + ds * ZOOM_EASE);
        world.x += dwx * ZOOM_EASE;
        world.y += dwy * ZOOM_EASE;
      }
      for (const box of tags.values()) {
        if (box === dragChip) {
          continue;
        }
        let tx = box.tx;
        let ty = box.ty;
        if (nudgeAwayFrom && box.id !== focusId) {
          const dx = box.tx - nudgeAwayFrom.x;
          const dy = box.ty - nudgeAwayFrom.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const limit = nudgeAwayFrom.radius + Math.max(box.width, box.height) / 2;
          if (d < limit) {
            const push = limit + 12;
            tx = nudgeAwayFrom.x + dx / d * push;
            ty = nudgeAwayFrom.y + dy / d * push;
          }
        }
        const ease = 1 - Math.exp(-dt * 0.012);
        box.x += (tx - box.x) * ease;
        box.y += (ty - box.y) * ease;
      }
      for (const p of postNodes.values()) {
        p.x += (p.tx - p.x) * 0.18;
        p.y += (p.ty - p.y) * 0.18;
        p.gfx.x = p.x;
        p.gfx.y = p.y;
      }
      drawPostEdges();
      syncChipPositions();
      raf = requestAnimationFrame(tick);
    }
    function drawPostEdges() {
      postEdgeGfx.clear();
      if (focusId === null) {
        return;
      }
      const center = tags.get(focusId);
      if (!center) {
        return;
      }
      for (const post of postNodes.values()) {
        postEdgeGfx.moveTo(center.x, center.y);
        postEdgeGfx.lineTo(post.x, post.y);
        postEdgeGfx.stroke({
          color: hslToInt(center.hue, 60, 50),
          width: 1,
          alpha: 0.35
        });
      }
    }
    function stageToWorld(global) {
      return {
        x: (global.x - world.x) / world.scale.x,
        y: (global.y - world.y) / world.scale.y
      };
    }
    function onStagePointerDown(e) {
      const ev = e;
      panActive = true;
      panStart = { x: ev.global.x, y: ev.global.y };
      panMovedDist = 0;
    }
    function onStagePointerMove(e) {
      const ev = e;
      if (dragChip) {
        const cursorWorld = stageToWorld(ev.global);
        const nx = cursorWorld.x + dragOffset.x;
        const ny = cursorWorld.y + dragOffset.y;
        dragChip.x = nx;
        dragChip.y = ny;
        dragChip.tx = nx;
        dragChip.ty = ny;
        return;
      }
      if (panActive && panStart) {
        const dx = ev.global.x - panStart.x;
        const dy = ev.global.y - panStart.y;
        world.x += dx;
        world.y += dy;
        targetWorldX += dx;
        targetWorldY += dy;
        panMovedDist += Math.sqrt(dx * dx + dy * dy);
        panStart = { x: ev.global.x, y: ev.global.y };
      }
    }
    function onStagePointerUp(e) {
      if (dragChip) {
        const box = dragChip;
        const startPos = dragStart;
        dragChip = null;
        dragStart = null;
        let movement = Infinity;
        const ev = e;
        if (startPos && ev && ev.global) {
          const dx = ev.global.x - startPos.x;
          const dy = ev.global.y - startPos.y;
          movement = Math.sqrt(dx * dx + dy * dy);
        }
        if (movement < 3) {
          void focusTag(box.id);
        } else {
          persistedPositions.set(box.id, { x: box.tx, y: box.ty });
          writePersistedPositions(positionsKey, persistedPositions);
        }
      }
      panActive = false;
      panStart = null;
    }
    app.stage.eventMode = "static";
    app.stage.hitArea = new pixi.Rectangle(
      0,
      0,
      stage.clientWidth,
      stage.clientHeight
    );
    app.stage.on("pointerdown", onStagePointerDown);
    app.stage.on("pointermove", onStagePointerMove);
    app.stage.on("pointerup", (e) => onStagePointerUp(e));
    app.stage.on("pointerupoutside", (e) => onStagePointerUp(e));
    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const prev = targetScale;
      const next = Math.max(0.3, Math.min(2.5, prev * factor));
      if (next === prev) {
        return;
      }
      const r = stage.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const wx = (sx - targetWorldX) / prev;
      const wy = (sy - targetWorldY) / prev;
      targetScale = next;
      targetWorldX = sx - wx * next;
      targetWorldY = sy - wy * next;
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    let firstFitDone = false;
    function onResize() {
      const r = stage.getBoundingClientRect();
      app.renderer.resize(r.width, r.height);
      app.stage.hitArea = new pixi.Rectangle(0, 0, r.width, r.height);
      if (!firstFitDone && r.width > 0 && r.height > 0) {
        firstFitDone = true;
        fitToView();
        stage.classList.remove("is-loading");
      }
      app.render();
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(stage);
    async function focusTag(id) {
      if (focusId === id) {
        closeFocus();
        return;
      }
      const wasFocused = focusId !== null;
      focusId = id;
      focusPage = 1;
      lastFocusChange = performance.now();
      const focused = tags.get(id);
      if (focused) {
        if (!wasFocused) {
          prevView = {
            scale: targetScale,
            x: targetWorldX,
            y: targetWorldY
          };
        }
        const r = stage.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const half = POST_RING_RADIUS + 70;
          const sx = r.width * 0.85 / (2 * half);
          const sy = r.height * 0.85 / (2 * half);
          const newScale = Math.max(
            0.5,
            Math.min(1.6, Math.min(sx, sy))
          );
          targetScale = newScale;
          targetWorldX = r.width / 2 - focused.x * newScale;
          targetWorldY = r.height / 2 - focused.y * newScale;
        }
        nudgeAwayFrom = {
          x: focused.x,
          y: focused.y,
          radius: SPOTLIGHT_RADIUS
        };
      }
      for (const box of tags.values()) {
        paintChip(box);
      }
      paintSidebar();
      await loadPostsForFocus();
    }
    function closeFocus() {
      focusId = null;
      lastFocusChange = performance.now();
      loadSeq++;
      nudgeAwayFrom = null;
      if (prevView) {
        targetScale = prevView.scale;
        targetWorldX = prevView.x;
        targetWorldY = prevView.y;
        prevView = null;
      }
      paintSidebar();
      clearPosts();
      for (const box of tags.values()) {
        paintChip(box);
      }
    }
    function clearPosts() {
      for (const post of postNodes.values()) {
        postLayer.removeChild(post.gfx);
        post.gfx.destroy();
      }
      postNodes.clear();
      for (const chip of postChips.values()) {
        postChipLayer.removeChild(chip.container);
        chip.container.destroy({ children: true });
      }
      postChips.clear();
      postEdgeGfx.clear();
      pager.visible = false;
    }
    function ensurePostChip(post) {
      const existing = postChips.get(post.id);
      if (existing) {
        return existing;
      }
      const container = new pixi.Container();
      container.eventMode = "static";
      container.cursor = "pointer";
      container.alpha = 0;
      const bg = new pixi.Graphics();
      container.addChild(bg);
      const dot = new pixi.Graphics();
      container.addChild(dot);
      const titleText = new pixi.Text({
        text: post.title,
        style: {
          fill: 1909543,
          fontSize: 12,
          fontFamily: FONT_FAMILY,
          fontWeight: "500"
        },
        resolution: CHIP_TEXT_RES
      });
      container.addChild(titleText);
      const chip = {
        container,
        bg,
        dot,
        titleText,
        width: 0,
        height: 0,
        cachedTitle: "",
        cachedHover: false
      };
      postChips.set(post.id, chip);
      postChipLayer.addChild(container);
      container.on("pointerdown", (e) => {
        e.stopPropagation?.();
        pixiInteractionAt = performance.now();
      });
      container.on("pointertap", () => {
        openInPostsTab(post.id, post.editUrl, post.title);
      });
      container.on("pointerover", () => {
        chip.cachedHover = true;
        layoutPostChip(chip, post);
      });
      container.on("pointerout", () => {
        chip.cachedHover = false;
        layoutPostChip(chip, post);
      });
      layoutPostChip(chip, post);
      return chip;
    }
    function layoutPostChip(chip, post) {
      const displayTitle = post.title.length > POST_TITLE_MAX_CHARS ? post.title.slice(0, POST_TITLE_MAX_CHARS - 1) + "…" : post.title;
      if (chip.titleText.text !== displayTitle) {
        chip.titleText.text = displayTitle;
      }
      chip.cachedTitle = displayTitle;
      const padX = 9;
      const padY = 3;
      const dotR = 4;
      const gap = 6;
      const titleW = chip.titleText.width;
      const titleH = chip.titleText.height;
      const totalW = padX + dotR * 2 + gap + titleW + padX;
      const totalH = Math.max(titleH, dotR * 2) + padY * 2;
      chip.width = totalW;
      chip.height = totalH;
      const left = -totalW / 2;
      const top = -totalH / 2;
      chip.bg.clear();
      chip.bg.roundRect(left, top, totalW, totalH, totalH / 2);
      if (chip.cachedHover) {
        chip.bg.fill({ color: 16777215, alpha: 1 });
        chip.bg.stroke({
          color: post.tone,
          width: 1.5,
          alpha: 1
        });
      } else {
        chip.bg.fill({ color: 16777215, alpha: 0.95 });
        chip.bg.stroke({
          color: 0,
          width: 1,
          alpha: 0.12
        });
      }
      chip.dot.clear();
      chip.dot.circle(left + padX + dotR, 0, dotR);
      chip.dot.fill({ color: post.tone, alpha: 0.85 });
      chip.dot.stroke({ color: 16777215, width: 1 });
      chip.titleText.x = left + padX + dotR * 2 + gap;
      chip.titleText.y = -titleH / 2;
    }
    async function loadPostsForFocus() {
      if (focusId === null) {
        return;
      }
      const mySeq = ++loadSeq;
      const myFocusId = focusId;
      const cfg = getConfig();
      const url = new URL(cfg.postsUrl);
      url.searchParams.set("tags", String(focusId));
      url.searchParams.set("per_page", String(POST_PER_PAGE));
      url.searchParams.set("page", String(focusPage));
      url.searchParams.set("status", "any");
      url.searchParams.set("_fields", "id,title,status");
      try {
        const response = await fetchShellJson(url.toString());
        if (mySeq !== loadSeq || focusId !== myFocusId) {
          return;
        }
        const items = response.json ?? [];
        focusTotalPages = Math.max(
          1,
          parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10) || 1
        );
        const realTotal = parseInt(response.headers.get("X-WP-Total") ?? "", 10);
        if (Number.isFinite(realTotal) && focusId !== null) {
          const box = tags.get(focusId);
          if (box && box.count !== realTotal) {
            box.count = realTotal;
            terms = terms.map(
              (t) => t.id === box.id ? { ...t, count: realTotal } : t
            );
            layoutChip(box);
          }
        }
        renderPosts(
          items.map((p) => ({
            id: p.id,
            title: stripTags(p.title?.rendered || `#${p.id}`),
            editUrl: `${cfg.editPostUrlBase}?post=${p.id}&action=edit`
          }))
        );
      } catch (err) {
        showError(__("Couldn’t load posts:"), err);
      }
    }
    function renderPosts(items) {
      clearPosts();
      if (focusId === null) {
        return;
      }
      const center = tags.get(focusId);
      if (!center) {
        return;
      }
      const count = items.length;
      const ringR = POST_RING_RADIUS + Math.max(0, count - 8) * 6;
      const tone = hslToInt(center.hue, 70, 48);
      items.forEach((item, idx) => {
        const angle = 2 * Math.PI / Math.max(1, count) * idx - Math.PI / 2;
        const tx = center.x + Math.cos(angle) * ringR;
        const ty = center.y + Math.sin(angle) * ringR;
        const gfx = new pixi.Graphics();
        postLayer.addChild(gfx);
        const post = {
          id: item.id,
          title: item.title,
          editUrl: item.editUrl,
          angle,
          r: ringR,
          x: center.x,
          y: center.y,
          tx,
          ty,
          gfx,
          tone
        };
        postNodes.set(item.id, post);
        ensurePostChip(post);
      });
      repaintPager();
    }
    function repaintPager() {
      if (focusId === null || focusTotalPages <= 1) {
        pager.visible = false;
        return;
      }
      pager.visible = true;
      const center = tags.get(focusId);
      if (!center) {
        pager.visible = false;
        return;
      }
      const prevDisabled = focusPage <= 1;
      const nextDisabled = focusPage >= focusTotalPages;
      drawPagerButton(pagerPrev, "◀", prevDisabled);
      drawPagerButton(pagerNext, "▶", nextDisabled);
      pagerPrev.cursor = prevDisabled ? "default" : "pointer";
      pagerNext.cursor = nextDisabled ? "default" : "pointer";
      pagerLabel.text = `${focusPage} / ${focusTotalPages}`;
      pagerPrev.x = -38;
      pagerPrev.y = 0;
      pagerNext.x = 38;
      pagerNext.y = 0;
      pagerLabel.x = 0;
      pagerLabel.y = 0;
      pager.x = center.x;
      pager.y = center.y + POST_RING_RADIUS + 60;
    }
    function drawPagerButton(gfx, glyph, disabled) {
      gfx.clear();
      gfx.circle(0, 0, 14);
      gfx.fill({
        color: disabled ? 15921906 : 16777215,
        alpha: disabled ? 0.7 : 1
      });
      gfx.stroke({
        color: 0,
        width: 1,
        alpha: 0.12
      });
      const children = gfx.children;
      const label = children?.[0] ?? null;
      if (!label) {
        const t = new pixi.Text({
          text: glyph,
          style: {
            fill: disabled ? 11580344 : 5265246,
            fontSize: 14,
            fontFamily: FONT_FAMILY,
            fontWeight: "600"
          }
        });
        t.anchor.set(0.5);
        gfx.addChild(t);
      } else {
        label.text = glyph;
        label.style.fill = disabled ? 11580344 : 5265246;
      }
    }
    function openInPostsTab(_id, editUrl, title) {
      const wm = api?.windowManager;
      const derive = api?.deriveWindowId;
      if (wm && typeof derive === "function") {
        const id = derive(editUrl);
        wm.open({
          id,
          baseId: id,
          url: editUrl,
          title: title ?? editUrl,
          icon: "dashicons-admin-post"
        });
        return;
      }
      try {
        window.open(editUrl, "_blank");
      } catch {
        window.location.assign(editUrl);
      }
    }
    function paintDraftSidebar() {
      const header = document.createElement("div");
      header.className = "wpd-tagcloud__sidebar-header";
      const dot = document.createElement("span");
      dot.className = "wpd-tagcloud__sidebar-dot";
      dot.style.background = `hsl( ${themeHue}deg 60% 55% )`;
      const label = document.createElement("code");
      label.className = "wpd-tagcloud__sidebar-slug";
      label.textContent = __("New tag");
      header.appendChild(dot);
      header.appendChild(label);
      sidebar.appendChild(header);
      const nameLabel = document.createElement("label");
      nameLabel.className = "wpd-tagcloud__sidebar-label";
      nameLabel.textContent = __("Name");
      sidebar.appendChild(nameLabel);
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "wpd-tagcloud__editor-name";
      nameInput.placeholder = __("e.g. featured");
      sidebar.appendChild(nameInput);
      requestAnimationFrame(() => nameInput.focus());
      const descLabel = document.createElement("label");
      descLabel.className = "wpd-tagcloud__sidebar-label";
      descLabel.textContent = __("Description");
      sidebar.appendChild(descLabel);
      const descInput = document.createElement("textarea");
      descInput.className = "wpd-tagcloud__editor-desc";
      descInput.placeholder = __("Description (optional)");
      descInput.rows = 4;
      sidebar.appendChild(descInput);
      const actions = document.createElement("div");
      actions.className = "wpd-tagcloud__editor-actions";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "wpd-tagcloud__btn wpd-tagcloud__btn--primary";
      createBtn.textContent = __("Create");
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "wpd-tagcloud__btn wpd-tagcloud__btn--danger";
      cancelBtn.textContent = __("Cancel");
      const handleCreate = async () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        createBtn.disabled = true;
        try {
          const created = await createTag(name);
          const next = {
            id: created.id,
            name: created.name,
            slug: created.slug || "",
            parent: 0,
            count: 0,
            description: created.description || "",
            isDefault: false
          };
          if (!terms.some((t) => t.id === next.id)) {
            terms = terms.concat(next);
          }
          const desc = descInput.value.trim();
          if (desc) {
            try {
              const updated = await updateTerm(
                "tags",
                created.id,
                { description: desc }
              );
              terms = terms.map(
                (t) => t.id === updated.id ? {
                  ...t,
                  description: updated.description ?? desc
                } : t
              );
            } catch {
              showError(
                __("Tag created but description failed:"),
                null
              );
            }
          }
          draft = null;
          buildCloud();
          focusId = created.id;
          paintSidebar();
          await loadPostsForFocus();
        } catch (err) {
          createBtn.disabled = false;
          showError(__("Couldn’t create:"), err);
        }
      };
      createBtn.addEventListener("click", () => {
        void handleCreate();
      });
      cancelBtn.addEventListener("click", () => {
        draft = null;
        paintSidebar();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void handleCreate();
        } else if (e.key === "Escape") {
          draft = null;
          paintSidebar();
        }
      });
      actions.appendChild(createBtn);
      actions.appendChild(cancelBtn);
      sidebar.appendChild(actions);
    }
    function paintSidebar() {
      sidebar.replaceChildren();
      if (draft !== null) {
        paintDraftSidebar();
        return;
      }
      if (focusId === null) {
        const empty = document.createElement("div");
        empty.className = "wpd-tagcloud__sidebar-empty";
        const icon = document.createElement("span");
        icon.className = "dashicons dashicons-tag";
        icon.setAttribute("aria-hidden", "true");
        empty.appendChild(icon);
        const title = document.createElement("h3");
        title.className = "wpd-tagcloud__sidebar-empty-title";
        title.textContent = __("No tag selected");
        empty.appendChild(title);
        const help = document.createElement("p");
        help.className = "wpd-tagcloud__sidebar-empty-hint";
        help.textContent = __(
          "Click a tag on the cloud to edit it, or click + Add tag to create a new one."
        );
        empty.appendChild(help);
        sidebar.appendChild(empty);
        return;
      }
      const box = tags.get(focusId);
      if (!box) {
        focusId = null;
        paintSidebar();
        return;
      }
      const id = box.id;
      const header = document.createElement("div");
      header.className = "wpd-tagcloud__sidebar-header";
      const dot = document.createElement("span");
      dot.className = "wpd-tagcloud__sidebar-dot";
      dot.style.background = `hsl( ${box.hue}deg 60% 55% )`;
      const term = terms.find((t) => t.id === id);
      const idLabel = document.createElement("code");
      idLabel.className = "wpd-tagcloud__sidebar-slug";
      idLabel.textContent = `#${id}`;
      header.appendChild(dot);
      header.appendChild(idLabel);
      sidebar.appendChild(header);
      const nameLabel = document.createElement("label");
      nameLabel.className = "wpd-tagcloud__sidebar-label";
      nameLabel.textContent = __("Name");
      sidebar.appendChild(nameLabel);
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "wpd-tagcloud__editor-name";
      nameInput.value = box.name;
      nameInput.placeholder = __("Name");
      sidebar.appendChild(nameInput);
      const slugLabel = document.createElement("label");
      slugLabel.className = "wpd-tagcloud__sidebar-label";
      slugLabel.textContent = __("Slug");
      sidebar.appendChild(slugLabel);
      const slugInput = document.createElement("input");
      slugInput.type = "text";
      slugInput.className = "wpd-tagcloud__editor-name";
      slugInput.value = term?.slug || "";
      slugInput.placeholder = __("auto-from-name");
      slugInput.spellcheck = false;
      slugInput.autocapitalize = "off";
      slugInput.addEventListener("input", () => {
        const v = slugInput.value;
        const norm = v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        if (v !== norm) {
          const sel = slugInput.selectionStart ?? norm.length;
          slugInput.value = norm;
          slugInput.setSelectionRange(sel, sel);
        }
      });
      sidebar.appendChild(slugInput);
      const descLabel = document.createElement("label");
      descLabel.className = "wpd-tagcloud__sidebar-label";
      descLabel.textContent = __("Description");
      sidebar.appendChild(descLabel);
      const descInput = document.createElement("textarea");
      descInput.className = "wpd-tagcloud__editor-desc";
      descInput.value = box.description || "";
      descInput.placeholder = __("Description (optional)");
      descInput.rows = 4;
      sidebar.appendChild(descInput);
      const meta = document.createElement("p");
      meta.className = "wpd-tagcloud__sidebar-meta";
      meta.textContent = sprintf(
        /* translators: %d: post count. */
        __("%d posts tagged with this."),
        box.count
      );
      sidebar.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "wpd-tagcloud__editor-actions";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "wpd-tagcloud__btn wpd-tagcloud__btn--primary";
      saveBtn.textContent = __("Save");
      saveBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) {
          return;
        }
        const description = descInput.value;
        const slugRaw = slugInput.value.trim();
        const currentSlug = term?.slug ?? "";
        if (name === box.name && description === (box.description || "") && slugRaw === currentSlug) {
          return;
        }
        const patch = { name, description };
        if (slugRaw !== currentSlug) {
          patch.slug = slugRaw;
        }
        try {
          const updated = await updateTerm("tags", box.id, patch);
          box.name = updated.name;
          box.description = updated.description;
          box.slug = updated.slug ?? box.slug;
          box.hue = tagHue(box.slug || box.name, themeHue);
          box.rotation = tagRotation(box.slug || box.name);
          terms = terms.map(
            (t) => t.id === box.id ? {
              ...t,
              name: updated.name,
              description: updated.description,
              slug: updated.slug ?? t.slug
            } : t
          );
          layoutChip(box);
          paintSidebar();
        } catch (err) {
          showError(__("Couldn’t save:"), err);
        }
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "wpd-tagcloud__btn wpd-tagcloud__btn--danger";
      delBtn.textContent = __("Delete");
      let armResetTimer = null;
      const armDelete = () => {
        delBtn.textContent = __("Click again to delete");
        delBtn.classList.add("is-armed");
        if (armResetTimer !== null) {
          window.clearTimeout(armResetTimer);
        }
        armResetTimer = window.setTimeout(() => {
          delBtn.textContent = __("Delete");
          delBtn.classList.remove("is-armed");
          armResetTimer = null;
        }, 2500);
      };
      delBtn.addEventListener("click", async () => {
        if (!delBtn.classList.contains("is-armed")) {
          armDelete();
          return;
        }
        if (armResetTimer !== null) {
          window.clearTimeout(armResetTimer);
          armResetTimer = null;
        }
        try {
          await deleteTerm("tags", box.id);
          terms = terms.filter((t) => t.id !== box.id);
          persistedPositions.delete(box.id);
          writePersistedPositions(positionsKey, persistedPositions);
          focusId = null;
          clearPosts();
          buildCloud();
          paintSidebar();
        } catch (err) {
          showError(__("Couldn’t delete:"), err);
        }
      });
      actions.appendChild(saveBtn);
      actions.appendChild(delBtn);
      sidebar.appendChild(actions);
    }
    function startDraft() {
      draft = true;
      paintSidebar();
    }
    addTagBtn.addEventListener("click", () => {
      startDraft();
    });
    function fitToView(padding = 90) {
      const r = stage.getBoundingClientRect();
      if (tags.size === 0 || r.width === 0 || r.height === 0) {
        world.x = r.width / 2;
        world.y = r.height / 2;
        world.scale.set(1);
        targetScale = 1;
        targetWorldX = world.x;
        targetWorldY = world.y;
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const box of tags.values()) {
        minX = Math.min(minX, box.tx - box.width / 2);
        minY = Math.min(minY, box.ty - box.height / 2);
        maxX = Math.max(maxX, box.tx + box.width / 2);
        maxY = Math.max(maxY, box.ty + box.height / 2);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const sx = (r.width - padding * 2) / w;
      const sy = (r.height - padding * 2) / h;
      const scale = Math.max(0.2, Math.min(1.5, Math.min(sx, sy)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      world.scale.set(scale);
      world.x = r.width / 2 - cx * scale;
      world.y = r.height / 2 - cy * scale;
      targetScale = scale;
      targetWorldX = world.x;
      targetWorldY = world.y;
    }
    recenterBtn.addEventListener("click", () => fitToView());
    reflowBtn.addEventListener("click", () => {
      persistedPositions.clear();
      writePersistedPositions(positionsKey, persistedPositions);
      for (const box of tags.values()) {
        box.tx = 0;
        box.ty = 0;
      }
      const allBoxes = Array.from(tags.values());
      const placed = [];
      allBoxes.sort((a, b) => b.count - a.count);
      for (const box of allBoxes) {
        const slot = findSpiralSlot(box.width, box.height, placed);
        box.tx = slot.x;
        box.ty = slot.y;
        placed.push({
          x: slot.x - box.width / 2,
          y: slot.y - box.height / 2,
          w: box.width,
          h: box.height
        });
      }
      fitToView();
    });
    app.canvas.addEventListener("click", (e) => {
      const now = performance.now();
      if (now - lastFocusChange < 250 || now - pixiInteractionAt < 250) {
        return;
      }
      if (panMovedDist > 4) {
        return;
      }
      const target = e.target;
      if (target === app.canvas && !dragChip && focusId !== null) {
        closeFocus();
      }
    });
    async function refreshCountsViaBulk() {
      if (terms.length === 0) {
        return;
      }
      const cfg = getConfig();
      const url = new URL(
        `${cfg.restRoot.replace(/\/$/, "")}/desktop-mode/v1/term-counts`
      );
      url.searchParams.set("taxonomy", "post_tag");
      url.searchParams.set(
        "ids",
        terms.map((t) => t.id).join(",")
      );
      try {
        const response = await fetchShellJson(url.toString());
        const map = response.json;
        let dirty = false;
        terms = terms.map((t) => {
          const fresh = map[String(t.id)];
          if (typeof fresh === "number" && fresh !== t.count) {
            dirty = true;
            const box = tags.get(t.id);
            if (box) {
              box.count = fresh;
            }
            return { ...t, count: fresh };
          }
          return t;
        });
        if (dirty) {
          const maxCount = Math.max(
            1,
            ...terms.map((t) => t.count)
          );
          for (const t of terms) {
            const box = tags.get(t.id);
            if (!box) {
              continue;
            }
            box.count = t.count;
            box.fontSize = fontSizeFor(t.count, maxCount);
            layoutChip(box);
          }
          if (focusId !== null) {
            paintSidebar();
          }
        }
      } catch {
      }
    }
    buildCloud();
    paintSidebar();
    raf = requestAnimationFrame(tick);
    void refreshCountsViaBulk();
    if (terms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wpd-tagcloud__empty";
      empty.textContent = __(
        'No tags yet. Click "Add tag" to start building the cloud.'
      );
      stage.appendChild(empty);
    }
    return () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      ro.disconnect();
      stage.removeEventListener("wheel", onWheel);
      try {
        app.destroy(true, { children: true, texture: true });
      } catch {
      }
      host.replaceChildren();
      host.classList.remove("wpd-tagcloud");
    };
  }
  function fontSizeFor(count, max) {
    const ratio = Math.sqrt(count / Math.max(1, max));
    return Math.round(
      MIN_FONT_SIZE + (MAX_FONT_SIZE - MIN_FONT_SIZE) * ratio
    );
  }
  function truncateChipName(name) {
    return name.length > CHIP_NAME_MAX_CHARS ? name.slice(0, CHIP_NAME_MAX_CHARS - 1) + "…" : name;
  }
  function aabbIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function slugHash(slug) {
    let h = 0;
    for (let i = 0; i < slug.length; i++) {
      h = (h * 31 + slug.charCodeAt(i)) % 2147483647;
    }
    return h;
  }
  function tagHue(slug, baseHue) {
    const h = slugHash(slug);
    return ((baseHue + h % 256 * 1.4) % 360 + 360) % 360;
  }
  function tagRotation(slug) {
    const h = slugHash(slug);
    const sign = h % 2 === 0 ? -1 : 1;
    const mag = Math.floor(h / 2) % 4 * 0.011;
    return sign * mag;
  }
  function readAdminThemeHue() {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--wp-admin-theme-color").trim();
      if (!value) {
        return 210;
      }
      const c = document.createElement("span");
      c.style.color = value;
      document.body.appendChild(c);
      const rgb = getComputedStyle(c).color;
      c.remove();
      const m = rgb.match(/\d+/g);
      if (!m || m.length < 3) {
        return 210;
      }
      return rgbToHue(
        parseInt(m[0], 10),
        parseInt(m[1], 10),
        parseInt(m[2], 10)
      );
    } catch {
      return 210;
    }
  }
  function rgbToHue(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    if (d === 0) {
      return 210;
    }
    let h;
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    return Math.round(h * 60);
  }
  function hslToInt(h, s, l) {
    const sn = s / 100;
    const ln = l / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const hp = h / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    const m = ln - c / 2;
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    return ri * 65536 + gi * 256 + bi;
  }
  function stripTags(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }
  function showToast(title, err) {
    const reason = err instanceof Error ? err.message : String(err);
    const api = window.wp?.desktop;
    if (api && typeof api.showToast === "function") {
      api.showToast({
        message: `${title} ${reason}`.trim(),
        duration: 6e3
      });
      return;
    }
    console.error(title, err);
  }
  async function fetchShellJson(url) {
    const cfg = getConfig();
    const api = window.wp?.desktop;
    const init = {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": cfg.restNonce,
        Accept: "application/json"
      }
    };
    let response;
    if (api && typeof api.fetch === "function") {
      response = await api.fetch(url, init, {
        windowId: "desktop-mode-posts"
      });
    } else {
      response = await fetch(url, init);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    return { json, headers: response.headers };
  }
  function computePositionsKey() {
    try {
      const host = window.location.host || "unknown";
      const path = window.location.pathname.replace(/\/?wp-admin\/?.*$/, "");
      return `wpd-tagcloud-positions:${host}${path}`;
    } catch {
      return "wpd-tagcloud-positions:fallback";
    }
  }
  function readPersistedPositions(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return /* @__PURE__ */ new Map();
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return /* @__PURE__ */ new Map();
      }
      const out = /* @__PURE__ */ new Map();
      for (const [k, v] of Object.entries(
        parsed
      )) {
        const id = parseInt(k, 10);
        if (!Number.isFinite(id)) {
          continue;
        }
        const pos = v;
        if (typeof pos?.x === "number" && typeof pos?.y === "number") {
          out.set(id, { x: pos.x, y: pos.y });
        }
      }
      return out;
    } catch {
      return /* @__PURE__ */ new Map();
    }
  }
  function writePersistedPositions(key, positions) {
    try {
      const obj = {};
      for (const [id, pos] of positions) {
        obj[String(id)] = pos;
      }
      window.localStorage.setItem(key, JSON.stringify(obj));
    } catch {
    }
  }
  function createTagChip(pixi, chipLayer, term, fontSize, hue) {
    const container = new pixi.Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    const shadow = new pixi.Graphics();
    container.addChild(shadow);
    const bg = new pixi.Graphics();
    container.addChild(bg);
    const hashText = new pixi.Text({
      text: "#",
      style: {
        fill: hslToInt(hue, 65, 42),
        fontSize,
        fontFamily: FONT_FAMILY,
        fontWeight: "700"
      },
      resolution: CHIP_TEXT_RES
    });
    container.addChild(hashText);
    const nameText = new pixi.Text({
      text: truncateChipName(term.name),
      style: {
        fill: 1909543,
        fontSize,
        fontFamily: FONT_FAMILY,
        fontWeight: "600"
      },
      resolution: CHIP_TEXT_RES
    });
    container.addChild(nameText);
    const countText = new pixi.Text({
      text: String(term.count),
      style: {
        fill: 16777215,
        fontSize: Math.max(10, Math.round(fontSize * 0.55)),
        fontFamily: FONT_FAMILY,
        fontWeight: "700"
      },
      resolution: CHIP_TEXT_RES
    });
    container.addChild(countText);
    chipLayer.addChild(container);
    return {
      container,
      shadow,
      bg,
      hashText,
      nameText,
      countText,
      width: 0,
      height: 0,
      cachedName: "",
      cachedCount: -1,
      cachedFocused: false,
      cachedHover: false,
      cachedHue: -1
    };
  }
  const tagsCloud = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    mountTagsCloud
  }, Symbol.toStringTag, { value: "Module" }));
  exports.renderPostsWindow = renderPostsWindow;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
