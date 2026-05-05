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
  async function createCategory(name, parent = 0) {
    const cfg = getConfig();
    const url = `${cfg.restRoot.replace(/\/$/, "")}/wp/v2/categories`;
    try {
      const { data } = await request(url, {
        method: "POST",
        body: JSON.stringify({ name, parent })
      });
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
  async function updatePostCategories(postId, categoryIds) {
    const cfg = getConfig();
    const url = `${cfg.postsUrl}/${postId}`;
    const { data } = await request(url, {
      method: "POST",
      body: JSON.stringify({ categories: categoryIds })
    });
    return data;
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
    wrap.style.cssText = "display:inline-flex;align-items:center;width:100%;min-width:0;";
    const picker = document.createElement(
      "wpd-category-picker"
    );
    picker.setAttribute("placeholder", __("Search categories…"));
    picker.setAttribute("add-label", __("Categorize"));
    picker.setAttribute("data-noclick", "");
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
  exports.renderPostsWindow = renderPostsWindow;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
