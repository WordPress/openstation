var openStationApp_codeBlue = function(exports) {
  "use strict";
  const TEXT_DOMAIN = "desktop-mode";
  function i18n() {
    return window.wp?.i18n;
  }
  function __(text, domain = TEXT_DOMAIN) {
    return i18n()?.__(text, domain) ?? text;
  }
  function _n(single, plural, number, domain = TEXT_DOMAIN) {
    return i18n()?._n(single, plural, number, domain) ?? (number === 1 ? single : plural);
  }
  function sprintf(format, ...args) {
    const impl = i18n()?.sprintf;
    if (impl) {
      return impl(format, ...args);
    }
    let i = 0;
    return format.replace(/%(?:(\d+)\$)?[sd]/g, (_match, pos) => {
      const idx = pos ? Number.parseInt(pos, 10) - 1 : i++;
      return String(args[idx] ?? "");
    });
  }
  function html(strings, ...values) {
    return { __wpdHtml: true, strings, values };
  }
  function isTemplateResult(v) {
    return !!v && v.__wpdHtml === true;
  }
  const MARKER_PREFIX = "$$wpd$$";
  const MARKER_RE = /\$\$wpd\$\$(\d+)\$\$/g;
  function joinWithMarkers(strings) {
    let out = strings[0];
    for (let i = 1; i < strings.length; i++) {
      out += `${MARKER_PREFIX}${i - 1}$$` + strings[i];
    }
    return out;
  }
  const compiledCache = /* @__PURE__ */ new WeakMap();
  function compile(strings) {
    const cached = compiledCache.get(strings);
    if (cached) {
      return cached;
    }
    const template = document.createElement("template");
    template.innerHTML = joinWithMarkers(strings);
    const recipes = [];
    const walk = (node, path) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        for (const attr of Array.from(el.attributes)) {
          const rawName = attr.name;
          const rawValue = attr.value;
          const prefix = rawName[0];
          if (MARKER_RE.test(rawValue)) {
            MARKER_RE.lastIndex = 0;
            if (prefix === "@") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "event",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else if (prefix === ".") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "prop",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else if (prefix === "?") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "bool",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else {
              const fragments = [];
              const indices = [];
              let lastEnd = 0;
              let m;
              MARKER_RE.lastIndex = 0;
              while ((m = MARKER_RE.exec(rawValue)) !== null) {
                fragments.push(rawValue.slice(lastEnd, m.index));
                indices.push(Number(m[1]));
                lastEnd = m.index + m[0].length;
              }
              fragments.push(rawValue.slice(lastEnd));
              recipes.push({
                path,
                kind: "attr",
                name: rawName,
                template: fragments,
                valueIndices: indices
              });
              el.setAttribute(rawName, "");
            }
          }
        }
      }
      const children = Array.from(node.childNodes);
      let shift = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const liveIndex = i + shift;
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent || "";
          if (!MARKER_RE.test(text)) {
            MARKER_RE.lastIndex = 0;
            continue;
          }
          MARKER_RE.lastIndex = 0;
          const parent = child.parentNode;
          let lastEnd = 0;
          let m;
          const newNodes = [];
          const newRecipes = [];
          MARKER_RE.lastIndex = 0;
          while ((m = MARKER_RE.exec(text)) !== null) {
            if (m.index > lastEnd) {
              newNodes.push(document.createTextNode(text.slice(lastEnd, m.index)));
            }
            const placeholder = document.createTextNode("");
            newNodes.push(placeholder);
            newRecipes.push({
              path: [...path, liveIndex + newNodes.length - 1],
              kind: "node",
              valueIndex: Number(m[1])
            });
            lastEnd = m.index + m[0].length;
          }
          if (lastEnd < text.length) {
            newNodes.push(document.createTextNode(text.slice(lastEnd)));
          }
          for (const nn of newNodes) {
            parent.insertBefore(nn, child);
          }
          parent.removeChild(child);
          shift += newNodes.length - 1;
          recipes.push(...newRecipes);
        } else {
          walk(child, [...path, liveIndex]);
        }
      }
    };
    walk(template.content, []);
    const buildParts = (fragment) => {
      const out = [];
      for (const r of recipes) {
        let node = fragment;
        for (const idx of r.path) {
          node = node.childNodes[idx];
        }
        if (r.kind === "node") {
          out.push({
            kind: "node",
            valueIndex: r.valueIndex,
            child: {
              anchor: node,
              state: null
            }
          });
        } else if (r.kind === "attr") {
          out.push({
            kind: "attr",
            element: node,
            name: r.name,
            template: r.template,
            valueIndices: r.valueIndices
          });
        } else if (r.kind === "event") {
          out.push({
            kind: "event",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        } else if (r.kind === "prop") {
          out.push({
            kind: "prop",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        } else if (r.kind === "bool") {
          out.push({
            kind: "bool",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        }
      }
      return out;
    };
    const entry = { template, buildParts };
    compiledCache.set(strings, entry);
    return entry;
  }
  const mountState = /* @__PURE__ */ new WeakMap();
  function mountIntact(state, container) {
    for (const node of state.nodes) {
      if (node.parentNode !== container) {
        return false;
      }
    }
    return true;
  }
  function render(result, container) {
    const existing = mountState.get(container);
    if (existing && existing.strings === result.strings && mountIntact(existing, container)) {
      applyValues(existing.parts, result.values);
      return;
    }
    const compiled = compile(result.strings);
    const fragment = compiled.template.content.cloneNode(true);
    const parts = compiled.buildParts(fragment);
    const nodes = Array.from(fragment.childNodes);
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(fragment);
    applyValues(parts, result.values);
    mountState.set(container, { strings: result.strings, parts, nodes });
  }
  function applyValues(parts, values) {
    for (const part of parts) {
      if (part.kind === "node") {
        updateChildPart(part.child, values[part.valueIndex]);
      } else if (part.kind === "attr") {
        let composed = part.template[0];
        for (let i = 0; i < part.valueIndices.length; i++) {
          composed += formatText(values[part.valueIndices[i]]);
          composed += part.template[i + 1];
        }
        if (composed !== part.last) {
          part.last = composed;
          if (composed === "") {
            part.element.removeAttribute(part.name);
          } else {
            part.element.setAttribute(part.name, composed);
          }
        }
      } else if (part.kind === "event") {
        const next = values[part.valueIndex];
        if (next !== part.current) {
          if (part.current) {
            part.element.removeEventListener(part.name, part.current);
          }
          if (next) {
            part.element.addEventListener(part.name, next);
          }
          part.current = next;
        }
      } else if (part.kind === "prop") {
        const next = values[part.valueIndex];
        if (next !== part.last) {
          part.last = next;
          part.element[part.name] = next;
        }
      } else if (part.kind === "bool") {
        const next = !!values[part.valueIndex];
        if (next !== part.last) {
          part.last = next;
          if (next) {
            part.element.setAttribute(part.name, "");
          } else {
            part.element.removeAttribute(part.name);
          }
        }
      }
    }
  }
  function updateChildPart(child, value) {
    if (value === null || value === void 0 || value === false) {
      if (child.state) {
        disposeChildState(child.state);
        child.state = null;
      }
      return;
    }
    if (Array.isArray(value)) {
      updateArrayChild(child, value);
      return;
    }
    if (isTemplateResult(value)) {
      updateTemplateChild(child, value);
      return;
    }
    if (value instanceof Node) {
      updateNodeChild(child, value);
      return;
    }
    updateTextChild(child, formatText(value));
  }
  function updateNodeChild(child, node) {
    const old = child.state;
    if (old?.shape === "node" && old.node === node) {
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    insertBeforeAnchor(child, [node]);
    child.state = { shape: "node", node };
  }
  function updateTextChild(child, text) {
    const old = child.state;
    if (old?.shape === "text") {
      if (old.text !== text) {
        old.node.textContent = text;
        old.text = text;
      }
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const node = document.createTextNode(text);
    insertBeforeAnchor(child, [node]);
    child.state = { shape: "text", node, text };
  }
  function updateTemplateChild(child, result) {
    const old = child.state;
    if (old?.shape === "template" && old.strings === result.strings) {
      applyValues(old.parts, result.values);
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const compiled = compile(result.strings);
    const fragment = compiled.template.content.cloneNode(true);
    const parts = compiled.buildParts(fragment);
    const topNodes = Array.from(fragment.childNodes);
    insertBeforeAnchor(child, [fragment]);
    applyValues(parts, result.values);
    child.state = {
      shape: "template",
      strings: result.strings,
      parts,
      nodes: topNodes
    };
  }
  function updateArrayChild(child, arr) {
    const old = child.state;
    if (old?.shape === "array" && old.entries.length === arr.length) {
      for (let i = 0; i < arr.length; i++) {
        updateChildPart(old.entries[i], arr[i]);
      }
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const entries = [];
    for (const v of arr) {
      const entryAnchor = document.createTextNode("");
      insertBeforeAnchor(child, [entryAnchor]);
      const entry = { anchor: entryAnchor, state: null };
      updateChildPart(entry, v);
      entries.push(entry);
    }
    child.state = { shape: "array", entries };
  }
  function insertBeforeAnchor(child, nodes) {
    const parent = child.anchor.parentNode;
    if (!parent) {
      return;
    }
    for (const node of nodes) {
      parent.insertBefore(node, child.anchor);
    }
  }
  function disposeChildState(state) {
    if (state.shape === "text") {
      state.node.remove();
      return;
    }
    if (state.shape === "template") {
      for (const part of state.parts) {
        if (part.kind === "node" && part.child.state) {
          disposeChildState(part.child.state);
          part.child.state = null;
        }
      }
      for (const node of state.nodes) {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
      return;
    }
    if (state.shape === "node") {
      if (state.node.parentNode) {
        state.node.parentNode.removeChild(state.node);
      }
      return;
    }
    for (const entry of state.entries) {
      if (entry.state) {
        disposeChildState(entry.state);
      }
      entry.anchor.remove();
    }
  }
  function formatText(v) {
    if (v === null || v === void 0 || v === false) {
      return "";
    }
    return String(v);
  }
  function defineApp(id, def) {
    const local = def.local ?? {};
    const app = {
      id,
      hasLocal: (action) => Object.prototype.hasOwnProperty.call(local, action),
      runLocal: (action, state, args, data) => {
        const reducer = local[action];
        if (!reducer) {
          return state;
        }
        const draft = { ...state };
        const next = reducer(draft, args, data);
        return next === void 0 ? draft : next;
      },
      render: (ctx) => {
        render(def.view(ctx), ctx.root);
        def.updated?.(ctx);
      },
      mounted: (ctx) => def.mounted?.(ctx)
    };
    const globals = window;
    (globals.openStationApps ?? (globals.openStationApps = {}))[id] = app;
    return app;
  }
  const BUCKETS = ["error", "warning", "deprecated", "info"];
  const BUCKET_OF = {
    fatal: "error",
    error: "error",
    warning: "warning",
    deprecated: "deprecated",
    notice: "info",
    info: "info"
  };
  const RANK = { fatal: 0, error: 1, warning: 2, deprecated: 3, notice: 4, info: 5 };
  const TONES = { error: "danger", warning: "warning", deprecated: "neutral", info: "info" };
  const RANGE_SECONDS = { "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592e3, all: 0 };
  const bucketOf = (level) => BUCKET_OF[level] ?? "info";
  const rank = (level) => RANK[level] ?? 6;
  function filterEntries(entries, since, query, hidden) {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (hidden.length > 0 && hidden.includes(bucketOf(e.level))) {
        return false;
      }
      if (since !== null && (e.timestamp === null || e.timestamp < since)) {
        return false;
      }
      return q === "" || `${e.message}
${e.label}
${e.file}`.toLowerCase().includes(q);
    });
  }
  function countBuckets(entries) {
    const totals = { error: 0, warning: 0, deprecated: 0, info: 0 };
    for (const e of entries) {
      totals[bucketOf(e.level)]++;
    }
    return totals;
  }
  function groupEntries(entries) {
    const byKey = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const g = byKey.get(e.signature);
      if (!g) {
        byKey.set(e.signature, {
          signature: e.signature,
          level: e.level,
          bucket: bucketOf(e.level),
          label: e.label,
          message: e.message,
          file: e.file,
          line: e.line,
          count: 1,
          firstTs: e.timestamp,
          lastTs: e.timestamp,
          trace: e.trace,
          occurrences: e.timestamp === null ? [] : [e.timestamp]
        });
        continue;
      }
      g.count++;
      if (rank(e.level) < rank(g.level)) {
        g.level = e.level;
        g.bucket = bucketOf(e.level);
        g.label = e.label;
      }
      g.message = e.message;
      g.file = e.file;
      g.line = e.line;
      if (e.trace.length > g.trace.length) {
        g.trace = e.trace;
      }
      if (e.timestamp !== null) {
        g.firstTs = g.firstTs === null ? e.timestamp : Math.min(g.firstTs, e.timestamp);
        g.lastTs = g.lastTs === null ? e.timestamp : Math.max(g.lastTs, e.timestamp);
        g.occurrences.unshift(e.timestamp);
        g.occurrences.length = Math.min(g.occurrences.length, 20);
      }
    }
    return Array.from(byKey.values());
  }
  function sortGroups(groups, mode) {
    return groups.slice().sort(
      (a, b) => mode === "frequent" ? b.count - a.count || rank(a.level) - rank(b.level) || (b.lastTs ?? 0) - (a.lastTs ?? 0) : (b.lastTs ?? -1) - (a.lastTs ?? -1) || rank(a.level) - rank(b.level) || b.count - a.count
    );
  }
  function bucketize(entries, since, now, count) {
    const stamps = entries.map((e) => e.timestamp).filter((t) => t !== null);
    if (stamps.length === 0) {
      return { start: 0, end: 0, columns: [] };
    }
    const start = since ?? Math.min(...stamps);
    const end = Math.max(now, start + count);
    const width = Math.max(1, Math.ceil((end - start) / count));
    const columns = Array.from({ length: count }, () => BUCKETS.map(() => 0));
    for (const e of entries) {
      if (e.timestamp === null || e.timestamp < start || e.timestamp > end) {
        continue;
      }
      columns[Math.min(count - 1, Math.floor((e.timestamp - start) / width))][BUCKETS.indexOf(bucketOf(e.level))]++;
    }
    return { start, end, columns };
  }
  function formatBytes(bytes) {
    let v = Math.max(0, bytes);
    let i = 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }
  const rowKey = (g) => g.signature;
  const envTone = (on) => {
    if (on === null) {
      return "info";
    }
    return on ? "success" : "neutral";
  };
  const emptyCopy = (hasSource, filtered) => {
    if (!hasSource) {
      return [__("No readable log files found"), __("Define WP_DEBUG and WP_DEBUG_LOG in wp-config.php (or point the error_log PHP directive at a file) and errors will start collecting here.")];
    }
    if (filtered) {
      return [__("Nothing matches the filters"), __("Try widening the time range or clearing the search.")];
    }
    return [__("The log is clean"), __("No entries were recorded in this time range.")];
  };
  const fullTime = (sec) => new Date(sec * 1e3).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fileBase = (path) => path.split(/[\\/]/).pop() || path;
  const iso = (sec) => new Date(sec * 1e3).toISOString();
  const codeBlue_os = defineApp("openstation-code-blue", {
    local: {
      toggle: (state, args) => {
        const key = String(args.key ?? "");
        state.expanded = state.expanded.includes(key) ? state.expanded.filter((k) => k !== key) : [...state.expanded, key];
      },
      series: (state, args) => {
        state.hidden = (Array.isArray(args.hidden) ? args.hidden : []).map(String);
      }
    },
    view: ({ state, data }) => {
      const labels = { error: __("Errors"), warning: __("Warnings"), deprecated: __("Deprecated"), info: __("Info") };
      const span = RANGE_SECONDS[state.range] ?? 86400;
      const since = span > 0 ? data.now - span : null;
      const inRange = filterEntries(data.entries, since, state.query, []);
      const visible = filterEntries(inRange, null, "", state.hidden);
      const totals = countBuckets(inRange);
      const groups = sortGroups(groupEntries(visible), state.sort);
      const chart = bucketize(inRange, since, data.now, 48);
      const filtered = state.query !== "" || state.hidden.length > 0;
      const error = state.error !== "" ? state.error : data.readError;
      const source = data.source;
      const series = BUCKETS.map((b) => ({ key: b, label: labels[b], tone: TONES[b] }));
      const clearDisabled = !source || source.exists && !source.writable;
      const empty = emptyCopy(!!source, filtered);
      const issue = (g) => {
        const key = rowKey(g);
        const open = state.expanded.includes(key);
        return html`
				<li class="os-cb-issue" data-tone=${TONES[g.bucket]}>
					<button type="button" class="os-cb-issue__row" os-action="toggle" os-arg-key=${key} aria-expanded=${open ? "true" : "false"}>
						<span class="os-cb-issue__level"><span class="os-cb-swatch" data-tone=${TONES[g.bucket]}></span><span class="os-cb-issue__label">${g.label}</span></span>
						<span class="os-cb-issue__message" title=${g.message}>${g.message}</span>
						<span class="os-cb-issue__meta">
							${g.file !== "" ? html`<span class="os-cb-issue__file">${g.line > 0 ? `${fileBase(g.file)}:${g.line}` : fileBase(g.file)}</span>` : ""}
							<os-badge no-dot>×${g.count.toLocaleString()}</os-badge>
							${g.lastTs !== null ? html`<os-relative-time compact class="os-cb-issue__when" datetime=${iso(g.lastTs)}></os-relative-time>` : ""}
						</span>
					</button>
					${open ? html`
							<div class="os-cb-issue__detail">
								<dl class="os-cb-issue__facts">
									${g.file !== "" ? html`<dt>${__("File")}</dt><dd>${g.line > 0 ? `${g.file}:${g.line}` : g.file}</dd>` : ""}
									${g.firstTs !== null ? html`<dt>${__("First seen")}</dt><dd>${fullTime(g.firstTs)}</dd>` : ""}
									${g.lastTs !== null ? html`<dt>${__("Last seen")}</dt><dd>${fullTime(g.lastTs)}</dd>` : ""}
									<dt>${__("Occurrences")}</dt><dd>${g.count.toLocaleString()}</dd>
								</dl>
								${g.occurrences.length > 1 ? html`<os-cluster gap="8" align="baseline" class="os-cb-issue__times">
										<span class="os-cb-issue__times-label">${__("Latest occurrences")}</span>
										${g.occurrences.slice(0, 8).map((ts) => html`<os-badge no-dot tone="neutral">${fullTime(ts)}</os-badge>`)}
									</os-cluster>` : ""}
								${g.trace !== "" ? html`<os-code block class="os-cb-issue__trace">${g.trace}</os-code>` : ""}
							</div>` : ""}
				</li>`;
      };
      return html`
			<os-stack gap="12" class="os-cb">
				<os-cluster gap="10" align="end" class="os-cb__toolbar">
					<os-select label=${__("Log source")} class="os-cb__source" os-bind="source" os-action="source" value=${state.source}>
						${data.sources.map((s) => html`<os-option value=${s.id} ?disabled=${s.exists && !s.readable}>${s.exists ? `${s.label} (${formatBytes(s.size)})` : sprintf(
        /* translators: %s: log source label. */
        __("%s (empty)"),
        s.label
      )}</os-option>`)}
					</os-select>
					<os-segmented label=${__("Time range")} os-bind="range" value=${state.range}>
						${Object.keys(RANGE_SECONDS).map((k) => html`<os-segment value=${k}>${k === "all" ? __("All") : k}</os-segment>`)}
					</os-segmented>
					<os-text-field type="search" class="os-cb__search" label=${__("Search")} placeholder=${__("Filter messages…")} os-bind="query"></os-text-field>
					<span class="os-cb__spacer"></span>
					<os-segmented label=${__("Sort issues")} os-bind="sort" value=${state.sort}>
						<os-segment value="recent">${__("Recent")}</os-segment>
						<os-segment value="frequent">${__("Frequent")}</os-segment>
					</os-segmented>
					<os-switch class="os-cb__auto" label=${__("Auto")} os-bind="auto" ?checked=${state.auto}></os-switch>
					<os-button variant="secondary" os-action="refresh">${__("Refresh")}</os-button>
					<os-button variant="danger" os-action="clear" os-confirm-danger
						os-confirm-title=${__("Clear this log?")} os-confirm-label=${__("Clear log")}
						os-confirm=${sprintf(
        /* translators: %s: log file path. */
        __("Every entry in %s will be deleted from disk. This cannot be undone."),
        source?.path ?? ""
      )}
						?disabled=${clearDisabled}>${__("Clear log")}</os-button>
				</os-cluster>

				${state.auto ? html`<span os-poll="30000" os-action="refresh" hidden></span>` : ""}
				${error !== "" ? html`<os-notice tone="error" not-dismissible>${error}</os-notice>` : ""}

				<os-grid gap="10" class="os-cb__stats">
					<os-card compact class="os-cb-tile"><span class="os-cb-tile__label">${__("Events")}</span><span class="os-cb-tile__value">${inRange.length.toLocaleString()}</span></os-card>
					${BUCKETS.map((b) => html`<os-card compact class="os-cb-tile"><span class="os-cb-tile__label"><span class="os-cb-swatch" data-tone=${TONES[b]}></span>${labels[b]}</span><span class="os-cb-tile__value">${totals[b].toLocaleString()}</span></os-card>`)}
				</os-grid>

				<os-cluster gap="6" class="os-cb__env">
					${data.environment.map((r) => html`<os-badge tone=${envTone(r.on)}>${r.label}: ${r.value}</os-badge>`)}
				</os-cluster>

				<os-histogram class="os-cb__card os-cb__chart" legend os-action="series"
					heading=${__("Events over time")}
					series=${JSON.stringify(series)} columns=${JSON.stringify(chart.columns)}
					start=${String(chart.start)} end=${String(chart.end)}
					hidden-series=${state.hidden.join(",")}
					empty=${__("No events in this range.")}></os-histogram>

				<section class="os-cb__card os-cb__issues">
					<div class="os-cb__card-head"><h2 class="os-cb__card-title">${sprintf(
        /* translators: %s: number of grouped issues. */
        _n("Issues (%s)", "Issues (%s)", groups.length),
        groups.length.toLocaleString()
      )}</h2></div>
					<ul class="os-cb__list">
						${groups.length === 0 ? html`<li class="os-cb__list-empty"><os-empty-state heading=${empty[0]} description=${empty[1]}></os-empty-state></li>` : groups.map(issue)}
					</ul>
				</section>

				${source ? html`<os-cluster justify="space-between" class="os-cb__footer">
						<span>${[
        sprintf(
          /* translators: 1: bytes scanned, 2: total file size. */
          __("Scanned %1$s of %2$s"),
          formatBytes(data.scanned),
          formatBytes(source.size)
        ),
        sprintf(
          /* translators: %s: number of parsed log entries. */
          _n("%s entry", "%s entries", data.entries.length),
          data.entries.length.toLocaleString()
        ),
        data.truncated ? __("older entries not shown") : ""
      ].filter(Boolean).join(" · ")}</span>
						<span>${__("Updated")} <os-relative-time datetime=${iso(data.now)}></os-relative-time></span>
					</os-cluster>` : ""}
			</os-stack>
		`;
    }
  });
  exports.BUCKETS = BUCKETS;
  exports.bucketOf = bucketOf;
  exports.bucketize = bucketize;
  exports.countBuckets = countBuckets;
  exports.default = codeBlue_os;
  exports.filterEntries = filterEntries;
  exports.formatBytes = formatBytes;
  exports.groupEntries = groupEntries;
  exports.sortGroups = sortGroups;
  Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
  return exports;
}({});
