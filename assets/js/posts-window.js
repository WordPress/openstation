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
  const ROOT_ID = "__root__";
  const PALETTE = [
    2257329,
    // wp blue
    8141549,
    // violet
    366185,
    // emerald
    14362487,
    // pink
    15357964,
    // orange
    561586
    // cyan
  ];
  function buildSeedTree() {
    const seeds = [
      { id: "science", name: __("Science"), parent: ROOT_ID },
      { id: "biology", name: __("Biology"), parent: "science" },
      { id: "astronomy", name: __("Astronomy"), parent: "science" },
      { id: "physics", name: __("Physics"), parent: "science" },
      { id: "society", name: __("Society"), parent: ROOT_ID },
      { id: "economics", name: __("Economics"), parent: "society" },
      { id: "politics", name: __("Politics"), parent: "society" },
      { id: "culture", name: __("Culture"), parent: ROOT_ID },
      { id: "music", name: __("Music"), parent: "culture" },
      { id: "cinema", name: __("Cinema"), parent: "culture" }
    ];
    const map = /* @__PURE__ */ new Map();
    seeds.forEach((s, i) => {
      map.set(s.id, {
        id: s.id,
        name: s.name,
        parent: s.parent,
        color: PALETTE[i % PALETTE.length],
        radius: s.parent === ROOT_ID ? 34 : 24,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        tx: 0,
        ty: 0,
        gfx: null,
        label: null,
        dragging: false,
        ...makeFloatPhase(i, 4, 3.5)
      });
    });
    return map;
  }
  function makeFloatPhase(seed, ampX, ampY) {
    const r = (n) => {
      const x = Math.sin(seed * 9301 + n * 49297) * 233280;
      return x - Math.floor(x);
    };
    return {
      phaseX: r(1) * Math.PI * 2,
      phaseY: r(2) * Math.PI * 2,
      // 0.0006–0.0012 rad/ms ≈ 5–10 second periods.
      freqX: 6e-4 + r(3) * 6e-4,
      freqY: 6e-4 + r(4) * 6e-4,
      ampX,
      ampY
    };
  }
  const TAG_SEEDS = [
    { id: "t-wp", name: "wordpress", count: 42, hue: 210 },
    { id: "t-design", name: "design", count: 28, hue: 280 },
    { id: "t-code", name: "code", count: 33, hue: 145 },
    { id: "t-photo", name: "photo", count: 22, hue: 320 },
    { id: "t-news", name: "news", count: 19, hue: 10 }
  ];
  const TAG_FONT_MIN = 11;
  const TAG_FONT_MAX = 16;
  const TAG_PAD_X = 9;
  const TAG_PAD_Y = 4;
  const TAG_GAP_HASH = 3;
  const TAG_GAP_COUNT = 6;
  function fontSizeFor$1(count, max) {
    if (max <= 0) {
      return TAG_FONT_MIN;
    }
    const t = Math.min(1, count / max);
    return TAG_FONT_MIN + (TAG_FONT_MAX - TAG_FONT_MIN) * t;
  }
  function darkenColor(color, factor) {
    const r = Math.round(Math.floor(color / 65536) * factor);
    const g = Math.round(Math.floor(color % 65536 / 256) * factor);
    const b = Math.round(color % 256 * factor);
    return r * 65536 + g * 256 + b;
  }
  function hslToInt$2(h, s, l) {
    const sat = s / 100;
    const lig = l / 100;
    const c = (1 - Math.abs(2 * lig - 1)) * sat;
    const hp = (h % 360 + 360) % 360 / 60;
    const xCol = c * (1 - Math.abs(hp % 2 - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) {
      r = c;
      g = xCol;
    } else if (hp < 2) {
      r = xCol;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = xCol;
    } else if (hp < 4) {
      g = xCol;
      b = c;
    } else if (hp < 5) {
      r = xCol;
      b = c;
    } else {
      r = c;
      b = xCol;
    }
    const m = lig - c / 2;
    const R = Math.round((r + m) * 255);
    const G = Math.round((g + m) * 255);
    const B = Math.round((b + m) * 255);
    return R * 65536 + G * 256 + B;
  }
  function isDescendant(nodes, candidateId, targetId) {
    if (candidateId === targetId) {
      return true;
    }
    let cur = candidateId;
    const visited = /* @__PURE__ */ new Set();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const n = nodes.get(cur);
      if (!n) {
        return false;
      }
      if (n.parent === targetId) {
        return true;
      }
      cur = n.parent;
    }
    return false;
  }
  function layoutTree(nodes, width, height) {
    const cx = width / 2;
    const cy = height * 0.4;
    const roots = Array.from(nodes.values()).filter((n) => n.parent === ROOT_ID);
    const mindmapH = height * 0.62;
    const rootR = Math.min(width, mindmapH) * 0.22;
    roots.forEach((root, i) => {
      const angle = i / Math.max(1, roots.length) * Math.PI * 2 - Math.PI / 2;
      root.tx = cx + Math.cos(angle) * rootR;
      root.ty = cy + Math.sin(angle) * rootR;
      layoutChildren(nodes, root, angle);
    });
  }
  function layoutTags(tags, width, height) {
    const bandTop = height * 0.72;
    const bandH = height * 0.26;
    const bandCy = bandTop + bandH / 2;
    const gap = 8;
    const rows = [[]];
    let rowW = 0;
    tags.forEach((t) => {
      const w = t.width || 60;
      if (rowW + w + gap > width - 24 && rows[rows.length - 1].length > 0) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(t);
      rowW += w + gap;
    });
    const rowSpacing = 38;
    const totalRowsH = rows.length * rowSpacing - rowSpacing;
    const startY = bandCy - totalRowsH / 2;
    rows.forEach((row, rIdx) => {
      const total = row.reduce((acc, t) => acc + (t.width || 60), 0) + gap * Math.max(0, row.length - 1);
      let cursor = (width - total) / 2;
      row.forEach((t) => {
        const w = t.width || 60;
        t.tx = cursor + w / 2;
        t.ty = startY + rIdx * rowSpacing;
        cursor += w + gap;
      });
    });
  }
  function layoutChildren(nodes, parent, parentAngle) {
    const children = Array.from(nodes.values()).filter(
      (n) => n.parent === parent.id
    );
    if (children.length === 0) {
      return;
    }
    const spread = Math.PI * 0.9;
    const baseAngle = parentAngle;
    const step = children.length === 1 ? 0 : spread / (children.length - 1);
    const start = baseAngle - spread / 2;
    const r = 95;
    children.forEach((child, i) => {
      const a = children.length === 1 ? baseAngle : start + step * i;
      child.tx = parent.tx + Math.cos(a) * r;
      child.ty = parent.ty + Math.sin(a) * r;
      layoutChildren(nodes, child, a);
    });
  }
  function layoutTagChip(chip) {
    chip.hashText.style.fontSize = chip.fontSize;
    chip.nameText.style.fontSize = chip.fontSize;
    chip.countText.style.fontSize = Math.max(9, Math.round(chip.fontSize * 0.6));
    const hashW = chip.hashText.width;
    const nameW = chip.nameText.width;
    const nameH = chip.nameText.height;
    const countW = chip.countText.width;
    const countH = chip.countText.height;
    const countBadgeW = Math.max(16, countW + 8);
    const countBadgeH = Math.max(13, countH + 3);
    chip.width = TAG_PAD_X + hashW + TAG_GAP_HASH + nameW + TAG_GAP_COUNT + countBadgeW + TAG_PAD_X;
    chip.height = Math.max(nameH, countBadgeH) + TAG_PAD_Y * 2;
  }
  function paintTagChip(chip) {
    const totalW = chip.width;
    const totalH = chip.height;
    const left = -totalW / 2;
    const top = -totalH / 2;
    const radius = totalH / 2;
    const fillBg = chip.hover ? hslToInt$2(chip.hue, 70, 88) : hslToInt$2(chip.hue, 60, 95);
    const borderColor = hslToInt$2(chip.hue, 50, 70);
    const textColor = 1909543;
    const hashColor = hslToInt$2(chip.hue, 65, 42);
    const countBg = hslToInt$2(chip.hue, 70, 50);
    chip.bg.clear();
    chip.bg.roundRect(left, top, totalW, totalH, radius);
    chip.bg.fill(fillBg);
    chip.bg.stroke({
      color: borderColor,
      width: chip.hover ? 1.6 : 1.2,
      alpha: 0.85
    });
    const hashW = chip.hashText.width;
    const nameW = chip.nameText.width;
    const nameH = chip.nameText.height;
    const countW = chip.countText.width;
    const countH = chip.countText.height;
    const countBadgeW = Math.max(16, countW + 8);
    const countBadgeH = Math.max(13, countH + 3);
    chip.hashText.x = left + TAG_PAD_X;
    chip.hashText.y = (totalH - nameH) / 2 + top;
    chip.hashText.style.fill = hashColor;
    chip.nameText.x = left + TAG_PAD_X + hashW + TAG_GAP_HASH;
    chip.nameText.y = (totalH - nameH) / 2 + top;
    chip.nameText.style.fill = textColor;
    const badgeX = left + TAG_PAD_X + hashW + TAG_GAP_HASH + nameW + TAG_GAP_COUNT;
    const badgeY = (totalH - countBadgeH) / 2 + top;
    chip.bg.roundRect(badgeX, badgeY, countBadgeW, countBadgeH, countBadgeH / 2);
    chip.bg.fill(countBg);
    chip.countText.x = badgeX + (countBadgeW - countW) / 2;
    chip.countText.y = badgeY + (countBadgeH - countH) / 2;
  }
  function renderFallback(stage) {
    stage.replaceChildren();
    const note = document.createElement("p");
    note.className = "wpd-intro__fallback";
    note.textContent = __(
      "A new visual editor for Categories and Tags awaits inside — drag, drop, and reorganize your taxonomy in seconds."
    );
    stage.appendChild(note);
  }
  async function showPostsIntroDialog() {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "wpd-intro-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "wpd-intro";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "wpd-intro-title");
      dialog.tabIndex = -1;
      backdrop.appendChild(dialog);
      const titleEl = document.createElement("h2");
      titleEl.id = "wpd-intro-title";
      titleEl.className = "wpd-intro__title";
      titleEl.textContent = __("Welcome to the new Posts");
      dialog.appendChild(titleEl);
      const lede = document.createElement("p");
      lede.className = "wpd-intro__lede";
      lede.textContent = __(
        "A redesigned Posts experience built around how you actually work. Try the new Categories canvas — grab a node and drop it on another to reparent it."
      );
      dialog.appendChild(lede);
      const stage = document.createElement("div");
      stage.className = "wpd-intro__stage";
      dialog.appendChild(stage);
      const escape = document.createElement("p");
      escape.className = "wpd-intro__escape";
      escape.textContent = __(
        "Prefer the classic Posts list? You can switch back any time from OS Settings → Features."
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
      confirmBtn.textContent = __("Got it");
      actions.appendChild(settingsBtn);
      actions.appendChild(confirmBtn);
      dialog.appendChild(actions);
      document.body.appendChild(backdrop);
      let teardownPixi = null;
      const cleanup = (result) => {
        document.removeEventListener("keydown", onKey);
        teardownPixi?.();
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
      void mountPixi(stage).then((teardown) => {
        teardownPixi = teardown;
      }).catch(() => {
        renderFallback(stage);
      });
    });
  }
  async function mountPixi(stage) {
    const api = window.wp?.desktop;
    if (!api || typeof api.loadModules !== "function") {
      renderFallback(stage);
      return () => {
      };
    }
    try {
      await api.loadModules(["pixijs"]);
    } catch {
      renderFallback(stage);
      return () => {
      };
    }
    const pixiMaybe = window.PIXI;
    if (!pixiMaybe) {
      renderFallback(stage);
      return () => {
      };
    }
    const pixi = pixiMaybe;
    const app = new pixi.Application();
    await app.init({
      resizeTo: stage,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    stage.appendChild(app.canvas);
    app.canvas.classList.add("wpd-intro__canvas");
    const world = new pixi.Container();
    world.sortableChildren = true;
    world.scale.set(1);
    app.stage.addChild(world);
    const edgeLayer = new pixi.Container();
    const nodeLayer = new pixi.Container();
    const tagLayer = new pixi.Container();
    const postLayer = new pixi.Container();
    edgeLayer.zIndex = 1;
    nodeLayer.zIndex = 2;
    tagLayer.zIndex = 3;
    postLayer.zIndex = 5;
    world.addChild(edgeLayer);
    world.addChild(postLayer);
    world.addChild(nodeLayer);
    world.addChild(tagLayer);
    const nodes = buildSeedTree();
    nodes.forEach((n) => {
      const gfx = new pixi.Graphics();
      gfx.eventMode = "static";
      gfx.cursor = "grab";
      const label = new pixi.Text({
        text: n.name,
        style: { fill: 16777215, fontSize: 12, fontWeight: "600", fontFamily: "system-ui, -apple-system, sans-serif" },
        resolution: 3,
        anchor: { x: 0.5, y: 0.5 }
      });
      gfx.addChild(label);
      n.gfx = gfx;
      n.label = label;
      nodeLayer.addChild(gfx);
    });
    const tags = [];
    const maxTagCount = TAG_SEEDS.reduce((m, t) => Math.max(m, t.count), 0);
    TAG_SEEDS.forEach((seed, i) => {
      const container = new pixi.Container();
      container.eventMode = "static";
      container.cursor = "grab";
      const bg = new pixi.Graphics();
      const fontSize = fontSizeFor$1(seed.count, maxTagCount);
      const hashText = new pixi.Text({
        text: "#",
        style: { fill: 1909543, fontSize, fontWeight: "600", fontFamily: "system-ui, -apple-system, sans-serif" },
        resolution: 3,
        anchor: { x: 0, y: 0 }
      });
      const nameText = new pixi.Text({
        text: seed.name,
        style: { fill: 1909543, fontSize, fontWeight: "600", fontFamily: "system-ui, -apple-system, sans-serif" },
        resolution: 3,
        anchor: { x: 0, y: 0 }
      });
      const countText = new pixi.Text({
        text: String(seed.count),
        style: { fill: 16777215, fontSize: Math.max(9, Math.round(fontSize * 0.6)), fontWeight: "700", fontFamily: "system-ui, -apple-system, sans-serif" },
        resolution: 3,
        anchor: { x: 0, y: 0 }
      });
      container.addChild(bg, hashText, nameText, countText);
      tagLayer.addChild(container);
      const chip = {
        id: seed.id,
        name: seed.name,
        count: seed.count,
        hue: seed.hue,
        fontSize,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        tx: 0,
        ty: 0,
        bg,
        hashText,
        nameText,
        countText,
        container,
        dragging: false,
        hover: false,
        ...makeFloatPhase(100 + i, 5, 4)
      };
      layoutTagChip(chip);
      paintTagChip(chip);
      tags.push(chip);
    });
    let stageW = stage.clientWidth || 600;
    let stageH = stage.clientHeight || 360;
    layoutTree(nodes, stageW, stageH);
    layoutTags(tags, stageW, stageH);
    const cx0 = stageW / 2;
    const cy0 = stageH * 0.4;
    nodes.forEach((n) => {
      n.x = cx0;
      n.y = cy0;
    });
    tags.forEach((t) => {
      t.x = t.tx;
      t.y = stageH + 40;
    });
    const drawNode = (n, hovered, dropTarget) => {
      n.gfx.clear();
      const r = n.radius * (hovered ? 1.08 : 1);
      if (dropTarget) {
        n.gfx.circle(0, 0, r + 10).fill({ color: n.color, alpha: 0.18 });
      }
      n.gfx.circle(0, 0, r).fill({ color: n.color, alpha: 0.95 }).stroke({ color: 16777215, width: dropTarget ? 3 : 1.5, alpha: 0.9 });
      const labelW = n.label.width;
      const labelH = n.label.height;
      if (labelW + 6 > r * 2) {
        const padX = 8;
        const padY = 3;
        const capW = labelW + padX * 2;
        const capH = labelH + padY * 2;
        n.gfx.roundRect(-capW / 2, -capH / 2, capW, capH, capH / 2).fill({ color: darkenColor(n.color, 0.55), alpha: 0.92 });
      }
      n.gfx.x = n.x;
      n.gfx.y = n.y;
    };
    const drawEdges = () => {
      const edgeLayerWithChildren = edgeLayer;
      const previousChildren = edgeLayerWithChildren.children.slice();
      previousChildren.forEach((c) => edgeLayer.removeChild(c));
      const edge = new pixi.Graphics();
      nodes.forEach((n) => {
        if (!n.parent || n.parent === ROOT_ID) {
          return;
        }
        const parent = nodes.get(n.parent);
        if (!parent) {
          return;
        }
        const dx = n.x - parent.x;
        const cp1x = parent.x + dx * 0.5;
        const cp1y = parent.y;
        const cp2x = parent.x + dx * 0.5;
        const cp2y = n.y;
        edge.moveTo(parent.x, parent.y);
        edge.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, n.x, n.y);
      });
      edge.stroke({ color: 9741240, width: 1.6, alpha: 0.55 });
      edgeLayer.addChild(edge);
    };
    const POSTS_BY_TAG = {
      "t-wp": [{ node: "politics", title: __("WordPress at scale") }, { node: "economics", title: __("Plugins economy") }, { node: "astronomy", title: __("Open-source orbits") }],
      "t-design": [{ node: "cinema", title: __("Title cards reborn") }, { node: "music", title: __("Album art trends") }, { node: "culture", title: __("Type as identity") }],
      "t-code": [{ node: "physics", title: __("Sim notebooks") }, { node: "astronomy", title: __("Pixel pipelines") }, { node: "science", title: __("Code as method") }],
      "t-photo": [{ node: "cinema", title: __("Anamorphic notes") }, { node: "biology", title: __("Field portraits") }, { node: "culture", title: __("Sunday playlist") }],
      "t-news": [{ node: "politics", title: __("Weekly briefing") }, { node: "economics", title: __("Markets recap") }]
    };
    let fakePosts = [];
    const POSTS_BY_CATEGORY = {
      science: [__("What we learned"), __("Open questions"), __("Methodology notes"), __("Replication study")],
      biology: [__("Fieldwork log"), __("Cell shapes"), __("Microscope diary")],
      botany: [__("Pressed leaves"), __("Greenhouse notes"), __("Native species")],
      zoology: [__("Migration map"), __("Birding weekend"), __("Tracks at dawn")],
      astronomy: [__("Comet schedule"), __("Backyard telescope"), __("Lunar tides")],
      physics: [__("Lab notebook"), __("Toy models"), __("Phase transitions")],
      society: [__("Sunday digest"), __("Local elections"), __("Reader letters")],
      economics: [__("Macro recap"), __("Numbers I noticed"), __("Market mood")],
      macro: [__("Inflation trail"), __("Central banks")],
      micro: [__("Pricing tactics"), __("Coffee shop economics")],
      politics: [__("Campaign trail"), __("Town hall notes"), __("Policy explainer")],
      culture: [__("Type as identity"), __("Sunday playlist"), __("City walks")],
      music: [__("Liner notes"), __("Live this week"), __("Album re-listen")],
      cinema: [__("Title cards reborn"), __("Director cut"), __("Set on the road")],
      drama: [__("Three-act notes"), __("Stage to screen")],
      "sci-fi": [__("Anamorphic notes"), __("Future-proof tropes"), __("Worldbuilding 101")]
    };
    const clearFakePosts = () => {
      fakePosts.forEach((p) => {
        try {
          postLayer.removeChild(p.container);
          p.container.destroy({ children: true });
        } catch {
        }
      });
      fakePosts = [];
    };
    const buildPostChip = (title, anchorKind, anchorId, accentColor, angle, orbit, originX, originY, spawnedAt) => {
      const container = new pixi.Container();
      container.alpha = 0;
      container.x = originX;
      container.y = originY;
      const bg = new pixi.Graphics();
      const text = new pixi.Text({
        text: title,
        style: {
          fill: 1909543,
          fontSize: 10,
          fontFamily: "system-ui, -apple-system, sans-serif"
        },
        resolution: 3,
        anchor: { x: 0, y: 0 }
      });
      container.addChild(bg, text);
      postLayer.addChild(container);
      return {
        title,
        anchorKind,
        anchorId,
        accentColor,
        angle,
        orbit,
        originX,
        originY,
        container,
        bg,
        text,
        spawnedAt
      };
    };
    const spawnFakePostsFromTag = (tag) => {
      clearFakePosts();
      const list = POSTS_BY_TAG[tag.id];
      if (!list) {
        return;
      }
      const now = performance.now();
      const ox = tag.container.x;
      const oy = tag.container.y;
      const accent = hslToInt$2(tag.hue, 70, 50);
      const titles = list.map((p) => p.title);
      const spread = Math.PI * 1.2;
      const baseAngle = -Math.PI / 2;
      const step = titles.length === 1 ? 0 : spread / (titles.length - 1);
      const start = baseAngle - spread / 2;
      const orbitR = 56 + Math.min(16, titles.length * 2);
      titles.forEach((title, i) => {
        const angle = titles.length === 1 ? baseAngle : start + step * i;
        fakePosts.push(
          buildPostChip(
            title,
            "tag",
            tag.id,
            accent,
            angle,
            orbitR + i % 2 * 6,
            ox,
            oy,
            now
          )
        );
      });
    };
    const spawnFakePostsFromCategory = (node) => {
      clearFakePosts();
      const titles = POSTS_BY_CATEGORY[node.id];
      if (!titles || titles.length === 0) {
        return;
      }
      const now = performance.now();
      const ox = node.gfx.x;
      const oy = node.gfx.y;
      const spread = Math.PI * 1.6;
      const start = -Math.PI / 2 - spread / 2;
      const step = titles.length === 1 ? 0 : spread / (titles.length - 1);
      titles.forEach((title, i) => {
        const angle = titles.length === 1 ? -Math.PI / 2 : start + step * i;
        fakePosts.push(
          buildPostChip(
            title,
            "node",
            node.id,
            node.color,
            angle,
            78 + i % 3 * 8,
            ox,
            oy,
            now
          )
        );
      });
    };
    let dragging = null;
    let pointerStart = { x: 0, y: 0 };
    let nodeStart = { x: 0, y: 0 };
    let hoverDrop = null;
    let dragTag = null;
    let tagDragStart = { x: 0, y: 0 };
    let tagStart = { x: 0, y: 0 };
    nodes.forEach((n) => {
      n.gfx.on("pointerdown", (raw) => {
        const e = raw;
        dragging = n;
        n.dragging = true;
        pointerStart = { x: e.global.x, y: e.global.y };
        nodeStart = { x: n.x, y: n.y };
        n.gfx.cursor = "grabbing";
        n.gfx.zIndex = 1e3;
        drawNode(n, true, false);
      });
      n.gfx.on("pointerover", () => {
        if (dragging || dragTag) {
          return;
        }
        drawNode(n, true, false);
        spawnFakePostsFromCategory(n);
      });
      n.gfx.on("pointerout", () => {
        if (dragging !== n) {
          drawNode(n, false, hoverDrop === n);
        }
        clearFakePosts();
      });
    });
    tags.forEach((t) => {
      t.container.on("pointerdown", (raw) => {
        const e = raw;
        dragTag = t;
        t.dragging = true;
        tagDragStart = { x: e.global.x, y: e.global.y };
        tagStart = { x: t.x, y: t.y };
        t.container.cursor = "grabbing";
        t.container.zIndex = 5e3;
      });
      t.container.on("pointerover", () => {
        if (dragTag || dragging) {
          return;
        }
        t.hover = true;
        paintTagChip(t);
        spawnFakePostsFromTag(t);
      });
      t.container.on("pointerout", () => {
        t.hover = false;
        paintTagChip(t);
        clearFakePosts();
      });
    });
    const onMove = (e) => {
      const rect = app.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (dragTag) {
        dragTag.x = tagStart.x + (px - tagDragStart.x);
        dragTag.y = tagStart.y + (py - tagDragStart.y);
        dragTag.container.x = dragTag.x;
        dragTag.container.y = dragTag.y;
        return;
      }
      if (!dragging) {
        return;
      }
      const dx = px - pointerStart.x;
      const dy = py - pointerStart.y;
      dragging.x = nodeStart.x + dx;
      dragging.y = nodeStart.y + dy;
      let hit = null;
      nodes.forEach((other) => {
        if (other === dragging) {
          return;
        }
        if (isDescendant(nodes, other.id, dragging.id)) {
          return;
        }
        const ddx = other.x - dragging.x;
        const ddy = other.y - dragging.y;
        if (Math.hypot(ddx, ddy) < other.radius + dragging.radius * 0.6) {
          hit = other;
        }
      });
      if (hit !== hoverDrop) {
        if (hoverDrop) {
          drawNode(hoverDrop, false, false);
        }
        hoverDrop = hit;
        if (hoverDrop) {
          drawNode(hoverDrop, false, true);
        }
      }
      drawNode(dragging, true, false);
    };
    const onUp = () => {
      if (dragTag) {
        dragTag.container.cursor = "grab";
        dragTag.container.zIndex = 0;
        dragTag.dragging = false;
        dragTag = null;
        return;
      }
      if (!dragging) {
        return;
      }
      const drop = hoverDrop;
      if (drop && drop.id !== dragging.parent) {
        dragging.parent = drop.id;
        layoutTree(nodes, stageW, stageH);
      }
      dragging.gfx.cursor = "grab";
      dragging.gfx.zIndex = 0;
      dragging.dragging = false;
      const dragged = dragging;
      dragging = null;
      if (hoverDrop) {
        drawNode(hoverDrop, false, false);
        hoverDrop = null;
      }
      drawNode(dragged, false, false);
    };
    app.canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const tick = () => {
      const now = performance.now();
      const REPULSION_K2 = 6500;
      const SPRING_K2 = 0.05;
      const SPRING_LEN2 = 110;
      const ANCHOR_K = 0.012;
      const DAMPING = 0.82;
      const MAX_V = 8;
      const list = Array.from(nodes.values());
      const fxArr = new Array(list.length).fill(0);
      const fyArr = new Array(list.length).fill(0);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a === dragging) {
          continue;
        }
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b === dragging) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const minD = a.radius + b.radius;
          if (d > minD * 4) {
            continue;
          }
          const f = REPULSION_K2 / d2;
          const fx = dx / d * f;
          const fy = dy / d * f;
          fxArr[i] -= fx;
          fyArr[i] -= fy;
          fxArr[j] += fx;
          fyArr[j] += fy;
        }
      }
      list.forEach((c, idx) => {
        if (!c.parent || c.parent === ROOT_ID) {
          return;
        }
        if (c === dragging) {
          return;
        }
        const parent = nodes.get(c.parent);
        if (!parent || parent === dragging) {
          return;
        }
        const pIdx = list.indexOf(parent);
        const dx = parent.x - c.x;
        const dy = parent.y - c.y;
        const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const diff = d - SPRING_LEN2;
        const sx = dx / d * diff * SPRING_K2;
        const sy = dy / d * diff * SPRING_K2;
        fxArr[idx] += sx;
        fyArr[idx] += sy;
        if (pIdx >= 0) {
          fxArr[pIdx] -= sx;
          fyArr[pIdx] -= sy;
        }
      });
      list.forEach((n, idx) => {
        fxArr[idx] += (n.tx - n.x) * ANCHOR_K;
        fyArr[idx] += (n.ty - n.y) * ANCHOR_K;
      });
      list.forEach((n, idx) => {
        if (n === dragging) {
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx = (n.vx + fxArr[idx]) * DAMPING;
        n.vy = (n.vy + fyArr[idx]) * DAMPING;
        if (n.vx > MAX_V) {
          n.vx = MAX_V;
        } else if (n.vx < -MAX_V) {
          n.vx = -MAX_V;
        }
        if (n.vy > MAX_V) {
          n.vy = MAX_V;
        } else if (n.vy < -MAX_V) {
          n.vy = -MAX_V;
        }
        n.x += n.vx;
        n.y += n.vy;
      });
      drawEdges();
      nodes.forEach((n) => {
        const fx = n === dragging ? n.x : n.x + Math.sin(now * n.freqX + n.phaseX) * n.ampX;
        const fy = n === dragging ? n.y : n.y + Math.sin(now * n.freqY + n.phaseY) * n.ampY;
        drawNode(n, false, hoverDrop === n);
        n.gfx.x = fx;
        n.gfx.y = fy;
      });
      tags.forEach((t) => {
        if (t === dragTag) {
          return;
        }
        t.x += (t.tx - t.x) * 0.16;
        t.y += (t.ty - t.y) * 0.16;
        const fx = t.x + Math.sin(now * t.freqX + t.phaseX) * t.ampX;
        const fy = t.y + Math.sin(now * t.freqY + t.phaseY) * t.ampY * 0.6;
        t.container.x = fx;
        t.container.y = fy;
      });
      fakePosts.forEach((p, idx) => {
        let anchorX = 0;
        let anchorY = 0;
        if (p.anchorKind === "tag") {
          const t2 = tags.find((tg) => tg.id === p.anchorId);
          if (!t2) {
            return;
          }
          anchorX = t2.container.x;
          anchorY = t2.container.y;
        } else {
          const node = nodes.get(p.anchorId);
          if (!node) {
            return;
          }
          anchorX = node.gfx.x;
          anchorY = node.gfx.y;
        }
        const elapsed = now - p.spawnedAt;
        const t = Math.min(1, elapsed / 320);
        p.container.alpha = t;
        const wobble = Math.sin(now * 15e-4 + idx) * 4;
        const tx = anchorX + Math.cos(p.angle) * (p.orbit + wobble);
        const ty = anchorY + Math.sin(p.angle) * (p.orbit + wobble);
        p.container.x += (tx - p.container.x) * 0.16;
        p.container.y += (ty - p.container.y) * 0.16;
        const padX = 7;
        const padY = 3;
        const textW = p.text.width;
        const textH = p.text.height;
        const w = textW + padX * 2;
        const h = textH + padY * 2;
        p.text.x = -w / 2 + padX;
        p.text.y = -h / 2 + padY;
        p.bg.clear();
        p.bg.roundRect(-w / 2, -h / 2, w, h, h / 2);
        p.bg.fill({ color: 16777215, alpha: 0.95 });
        p.bg.stroke({
          color: p.accentColor,
          width: 1.2,
          alpha: 0.85
        });
      });
      const FIT_MARGIN = 24;
      const FIT_EASE = 0.08;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      nodes.forEach((n) => {
        const dx = n.gfx.x;
        const dy = n.gfx.y;
        const r = n.radius + 8;
        if (dx - r < minX) {
          minX = dx - r;
        }
        if (dy - r < minY) {
          minY = dy - r;
        }
        if (dx + r > maxX) {
          maxX = dx + r;
        }
        if (dy + r > maxY) {
          maxY = dy + r;
        }
      });
      tags.forEach((tg) => {
        const dx = tg.container.x;
        const dy = tg.container.y;
        const w = tg.width / 2 + 4;
        const h = tg.height / 2 + 4;
        if (dx - w < minX) {
          minX = dx - w;
        }
        if (dy - h < minY) {
          minY = dy - h;
        }
        if (dx + w > maxX) {
          maxX = dx + w;
        }
        if (dy + h > maxY) {
          maxY = dy + h;
        }
      });
      const bw = maxX - minX;
      const bh = maxY - minY;
      if (bw > 0 && bh > 0 && Number.isFinite(bw) && Number.isFinite(bh)) {
        const sx = (stageW - FIT_MARGIN * 2) / bw;
        const sy = (stageH - FIT_MARGIN * 2) / bh;
        const targetScale = Math.max(0.55, Math.min(1, sx, sy));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const targetX = stageW / 2 - cx * targetScale;
        const targetY = stageH / 2 - cy * targetScale;
        world.x += (targetX - world.x) * FIT_EASE;
        world.y += (targetY - world.y) * FIT_EASE;
        const curScale = world.scale.x;
        world.scale.set(curScale + (targetScale - curScale) * FIT_EASE);
      }
    };
    app.ticker.add(tick);
    const ro = new ResizeObserver(() => {
      stageW = stage.clientWidth || stageW;
      stageH = stage.clientHeight || stageH;
      layoutTree(nodes, stageW, stageH);
      layoutTags(tags, stageW, stageH);
    });
    ro.observe(stage);
    return () => {
      ro.disconnect();
      app.ticker.remove(tick);
      app.canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      clearFakePosts();
      try {
        app.destroy(true, { children: true });
      } catch {
      }
    };
  }
  let _mountsPromise = null;
  function loadMounts() {
    if (!_mountsPromise) {
      _mountsPromise = Promise.resolve().then(() => userEditRender);
    }
    return _mountsPromise;
  }
  class WpdUserProfile extends HTMLElement {
    constructor() {
      super(...arguments);
      this._initialized = false;
      this._mountedFor = null;
    }
    static get observedAttributes() {
      return ["user-id"];
    }
    connectedCallback() {
      if (!this._initialized) {
        this._initialized = true;
        this._renderShell();
      }
      void this._mountIfNeeded();
    }
    attributeChangedCallback(name, oldValue, newValue) {
      if (name !== "user-id" || oldValue === newValue) {
        return;
      }
      if (this._initialized) {
        void this._mountIfNeeded();
      }
    }
    /**
     * Build the layout shell (sidebar + main column + activity
     * region). Same class names as the inline Profile tab in the
     * Users window so the existing posts-window.css rules style
     * both contexts identically.
     */
    _renderShell() {
      this.classList.add("desktop-mode-user-profile");
      this.innerHTML = `
			<div class="desktop-mode-users__edit-layout" data-wpd-user-profile-layout>
				<aside class="desktop-mode-users__edit-aside" data-wpd-user-profile-aside></aside>
				<main class="desktop-mode-users__edit-main">
					<div data-wpd-user-profile-form></div>
					<div class="desktop-mode-users__edit-activity" data-wpd-user-profile-activity></div>
				</main>
			</div>
		`;
    }
    async _mountIfNeeded() {
      const userIdAttr = this.getAttribute("user-id");
      const userId = userIdAttr ? parseInt(userIdAttr, 10) : 0;
      if (!Number.isFinite(userId) || userId <= 0) {
        return;
      }
      if (userId === this._mountedFor) {
        return;
      }
      this._mountedFor = userId;
      const formHost = this.querySelector(
        "[data-wpd-user-profile-form]"
      );
      const asideHost = this.querySelector(
        "[data-wpd-user-profile-aside]"
      );
      const activityHost = this.querySelector(
        "[data-wpd-user-profile-activity]"
      );
      if (!formHost || !asideHost || !activityHost) {
        return;
      }
      const mounts = await loadMounts();
      void mounts.mountProfileFormAt(formHost, userId);
      void mounts.mountProfileAsideAt(asideHost, userId, false);
      void mounts.mountProfileActivityAt(activityHost, userId, false);
    }
  }
  if (typeof customElements !== "undefined" && !customElements.get("wpd-user-profile")) {
    customElements.define("wpd-user-profile", WpdUserProfile);
  }
  let _activeWindowId = "desktop-mode-posts";
  function setActiveWindowId(id) {
    _activeWindowId = id;
  }
  function getActiveWindowId() {
    return _activeWindowId;
  }
  function getConfig() {
    const store = window.desktopModeWindowConfig;
    const cfg = store ? store[_activeWindowId] : void 0;
    if (!cfg) {
      throw new Error(
        `[${_activeWindowId}] config blob is missing — was the window opened without registration? See the matching \`desktop_mode_register_window()\` call in \`includes/{posts,pages}-window/window.php\`.`
      );
    }
    return cfg;
  }
  function shellFetch$2(input, init) {
    return trackedFetch(input, init, { windowId: "desktop-mode-posts" });
  }
  async function request(url, init = {}) {
    const cfg = getConfig();
    const response = await shellFetch$2(url, {
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
    const appendIds = (key, v) => {
      const list = Array.isArray(v) ? v : [v];
      for (const id of list) {
        if (Number.isFinite(id) && id > 0) {
          url.searchParams.append(`${key}[]`, String(id));
        }
      }
    };
    if (params.author) {
      appendIds("author", params.author);
    }
    if (params.tag) {
      appendIds("tags", params.tag);
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
  function wpdConfirmGlobal$1(options) {
    const fn = window.wp?.desktop?.confirm;
    if (typeof fn !== "function") {
      return Promise.reject(
        new Error(
          "[desktop-mode] wp.desktop.confirm is missing — the main desktop bundle must load before the posts-window script."
        )
      );
    }
    return fn(options);
  }
  const _introShown = /* @__PURE__ */ Object.create(null);
  function maybeShowIntro() {
    let cfg;
    try {
      cfg = getConfig();
    } catch {
      return;
    }
    const slug = cfg.introSlug || cfg.mode || "posts";
    if (_introShown[slug]) {
      return;
    }
    if (cfg.introSeen) {
      return;
    }
    _introShown[slug] = true;
    const dialogPromise = slug === "pages" ? Promise.resolve().then(() => pagesIntroDialog).then(
      (m) => m.showPagesIntroDialog()
    ) : showPostsIntroDialog();
    void dialogPromise.then((result) => {
      if (result === "cancel") {
        _introShown[slug] = false;
        return;
      }
      void markIntroSeen(cfg, slug);
      if (result === "settings") {
        openOsSettingsFeatures();
      }
    }).catch(() => {
      _introShown[slug] = false;
    });
  }
  async function markIntroSeen(cfg, slug) {
    if (!cfg.introUrl) {
      return;
    }
    try {
      await trackedFetch(
        cfg.introUrl,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": cfg.restNonce
          },
          body: JSON.stringify({ slug })
        },
        {
          windowId: getActiveWindowId(),
          source: `${slug}-window/intro`
        }
      );
      cfg.introSeen = true;
    } catch {
    }
  }
  function openOsSettingsFeatures() {
    const api = window.wp?.desktop;
    api?.openOsSettings?.();
  }
  const ROOT$1 = "[data-desktop-mode-posts-root]";
  const STATUS$1 = "[data-desktop-mode-posts-status]";
  const SEARCH$1 = "[data-desktop-mode-posts-search]";
  const REFRESH$1 = "[data-desktop-mode-posts-refresh]";
  const NEW_BTN$1 = "[data-desktop-mode-posts-new]";
  const TABLE$1 = "[data-desktop-mode-posts-table]";
  const BULK$1 = "[data-desktop-mode-posts-bulk]";
  const COUNT$1 = "[data-desktop-mode-posts-count]";
  const PAGE_INDICATOR$1 = "[data-desktop-mode-posts-page-indicator]";
  const PREV$1 = "[data-desktop-mode-posts-prev]";
  const NEXT$1 = "[data-desktop-mode-posts-next]";
  const PER_PAGE$1 = "[data-desktop-mode-posts-per-page]";
  const TOOLBAR_TRAILING_EXTRAS = "[data-desktop-mode-posts-toolbar-extras]";
  const BULK_ACTIONS_HOST$1 = "[data-desktop-mode-posts-bulk-actions]";
  const HOOK_FILTER_COLUMNS = "desktop_mode.postsWindow.columns";
  const HOOK_FILTER_STATUS_SEGMENTS = "desktop_mode.postsWindow.statusSegments";
  const HOOK_FILTER_BULK_ACTIONS = "desktop_mode.postsWindow.bulkActions";
  const HOOK_FILTER_TOOLBAR_TRAILING = "desktop_mode.postsWindow.toolbarTrailing";
  const HOOK_ACTION_OPENED = "desktop_mode.postsWindow.opened";
  const HOOK_ACTION_DATA_LOADED = "desktop_mode.postsWindow.dataLoaded";
  const SEARCH_DEBOUNCE_MS$1 = 250;
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
  function buildColumns$1(cache, filterData = EMPTY_FILTER_DATA) {
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
    let mode = "posts";
    try {
      const cfg = getConfig();
      if (cfg.mode === "pages") {
        mode = "pages";
      }
    } catch {
    }
    const titleCol = {
      key: "title",
      label: __("Title"),
      sortable: true,
      sticky: true,
      render: (_v, row) => memoCell(cache, row.id, "title", () => buildTitleCell(row))
    };
    const authorCol = {
      key: "author",
      label: __("Author"),
      sortable: true,
      width: "180px",
      filterRender: (host, ctx) => renderMultiSelectFilter(host, ctx, filterData.authors, {
        label: __("All authors"),
        ariaLabel: __("Filter by author")
      }),
      render: (_v, row) => memoCell(cache, row.id, "author", () => buildAuthorCell(row))
    };
    const dateCol = {
      key: "date",
      label: __("Date"),
      sortable: true,
      width: "170px",
      sortValue: (row) => Date.parse(row.date_gmt + "Z") || 0,
      render: (_v, row) => memoCell(cache, row.id, "date", () => buildDateCell(row))
    };
    if (mode === "pages") {
      const parentCol = {
        key: "parent",
        label: __("Parent"),
        width: "200px",
        render: (_v, row) => memoCell(cache, row.id, "parent", () => buildParentCell(row))
      };
      const templateCol = {
        key: "template",
        label: __("Template"),
        width: "180px",
        render: (_v, row) => memoCell(cache, row.id, "template", () => buildTemplateCell(row))
      };
      const slugCol = {
        key: "slug",
        label: __("Slug"),
        width: "200px",
        render: (_v, row) => memoCell(cache, row.id, "slug", () => buildSlugCell(row))
      };
      const commentsCol = {
        key: "comments",
        label: __("Comments"),
        width: "110px",
        sortValue: (row) => typeof row.desktop_mode_comment_count === "number" ? row.desktop_mode_comment_count : 0,
        render: (_v, row) => memoCell(
          cache,
          row.id,
          "comments",
          () => buildCommentsCell(row)
        )
      };
      return [
        titleCol,
        authorCol,
        parentCol,
        templateCol,
        slugCol,
        commentsCol,
        dateCol
      ];
    }
    return [
      titleCol,
      authorCol,
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
        // Drop the fixed width so the column flexes with the
        // available space; pin a minimum that comfortably holds
        // ~4 chips on one line so the cell doesn't collapse the
        // tags into a vertical stack on narrow tables.
        label: __("Tags"),
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
      dateCol
    ];
  }
  const _parentTitleByPageRoster = /* @__PURE__ */ new Map();
  function buildParentCell(row) {
    const cell = document.createElement("span");
    cell.className = "desktop-mode-posts__parent";
    const pid = typeof row.parent === "number" ? row.parent : 0;
    if (pid === 0) {
      cell.classList.add("desktop-mode-posts__parent--top");
      cell.textContent = "—";
      cell.setAttribute("aria-label", __("Top-level page"));
      return cell;
    }
    cell.classList.add("desktop-mode-posts__parent--child");
    const titleFromRoster = _parentTitleByPageRoster.get(pid);
    if (titleFromRoster) {
      cell.textContent = `↳ ${titleFromRoster}`;
    } else {
      cell.textContent = sprintf(__("↳ #%d"), pid);
    }
    return cell;
  }
  function refreshParentTitleRoster(rows) {
    _parentTitleByPageRoster.clear();
    for (const row of rows) {
      _parentTitleByPageRoster.set(row.id, decodeTitle(row.title.rendered));
    }
  }
  function buildTemplateCell(row) {
    const cell = document.createElement("span");
    cell.className = "desktop-mode-posts__template";
    const slug = typeof row.template === "string" ? row.template : "";
    let label = slug;
    try {
      const cfg = getConfig();
      const map = cfg.pageTemplates ?? {};
      label = map[slug] ?? (slug === "" ? __("Default template") : slug);
    } catch {
      label = slug === "" ? __("Default template") : slug;
    }
    cell.textContent = label;
    if (slug !== "") {
      cell.title = slug;
    }
    return cell;
  }
  function buildSlugCell(row) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "desktop-mode-posts__slug";
    const slug = typeof row.slug === "string" ? row.slug : "";
    cell.textContent = slug || "—";
    cell.disabled = slug === "";
    cell.title = slug ? __("Click to copy slug") : "";
    Object.assign(cell.style, {
      appearance: "none",
      background: "transparent",
      border: "none",
      padding: "2px 6px",
      font: "inherit",
      color: "inherit",
      cursor: slug ? "copy" : "default",
      textAlign: "left",
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: "12px",
      borderRadius: "4px",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    });
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!slug) {
        return;
      }
      void navigator.clipboard?.writeText(slug).then(() => {
        cell.textContent = __("Copied!");
        cell.style.color = "var(--wp-admin-theme-color, #2271b1)";
        setTimeout(() => {
          cell.textContent = slug;
          cell.style.color = "";
        }, 1200);
      }).catch(() => {
      });
    });
    return cell;
  }
  function buildCommentsCell(row) {
    const cell = document.createElement("span");
    cell.className = "desktop-mode-posts__comments";
    Object.assign(cell.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      fontVariantNumeric: "tabular-nums"
    });
    const count = typeof row.desktop_mode_comment_count === "number" ? row.desktop_mode_comment_count : null;
    if (count === null) {
      cell.textContent = "—";
      cell.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      return cell;
    }
    const icon = document.createElement("span");
    icon.className = "dashicons dashicons-admin-comments";
    icon.setAttribute("aria-hidden", "true");
    Object.assign(icon.style, {
      fontSize: "16px",
      width: "16px",
      height: "16px",
      color: count > 0 ? "var(--wp-admin-theme-color, #2271b1)" : "var(--wp-admin-theme-fg-muted, #8c8f94)"
    });
    const label = document.createElement("span");
    label.textContent = String(count);
    if (count === 0) {
      label.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
    }
    cell.appendChild(icon);
    cell.appendChild(label);
    cell.setAttribute(
      "aria-label",
      // translators: %d is the comment count for a row.
      `${sprintf(__("%d comments"), count)}`
    );
    return cell;
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
  function defaultStatusSegments$1() {
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
    const defaults = defaultStatusSegments$1();
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
    const lock = row.desktop_mode_lock ?? null;
    if (lock) {
      const lockBadge = document.createElement("span");
      lockBadge.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "gap:4px",
        "padding:2px 8px",
        "border-radius:10px",
        "font-size:11px",
        "font-weight:600",
        "background:rgba(179, 45, 46, 0.1)",
        "color:#b32d2e",
        "white-space:nowrap",
        "flex-shrink:0"
      ].join(";");
      const lockIcon = document.createElement("span");
      lockIcon.setAttribute("aria-hidden", "true");
      lockIcon.style.cssText = [
        "font-family:dashicons",
        "font-size:14px",
        "line-height:1",
        "display:inline-block",
        "speak:none",
        "-webkit-font-smoothing:antialiased"
      ].join(";");
      lockIcon.textContent = "";
      lockBadge.appendChild(lockIcon);
      const lockText = document.createElement("span");
      lockText.textContent = lock.userName;
      lockBadge.appendChild(lockText);
      const tipFmt = __("%s is currently editing", "desktop-mode");
      lockBadge.title = sprintf(tipFmt, lock.userName);
      titleRow.appendChild(lockBadge);
    }
    let cfgForBadges = null;
    try {
      cfgForBadges = getConfig();
    } catch {
      cfgForBadges = null;
    }
    if (cfgForBadges && cfgForBadges.mode === "pages") {
      if (typeof cfgForBadges.frontPageId === "number" && cfgForBadges.frontPageId === row.id) {
        titleRow.appendChild(
          buildAssignmentBadge(
            __("Front page"),
            "dashicons-admin-home",
            "#0a4b78",
            "rgba(34,113,177,0.12)"
          )
        );
      }
      if (typeof cfgForBadges.postsPageId === "number" && cfgForBadges.postsPageId === row.id) {
        titleRow.appendChild(
          buildAssignmentBadge(
            __("Posts page"),
            "dashicons-admin-post",
            "#5b3aa0",
            "rgba(91,58,160,0.12)"
          )
        );
      }
    }
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
    if (cfgForBadges?.mode === "pages" && typeof row.link === "string" && row.link && row.status === "publish") {
      const view = document.createElement("a");
      view.href = row.link;
      view.target = "_blank";
      view.rel = "noreferrer noopener";
      view.textContent = __("View");
      view.title = row.link;
      view.setAttribute("data-noclick", "");
      view.style.cssText = [
        "font-size:11px",
        "color:var(--wp-admin-theme-color, #2271b1)",
        "text-decoration:none",
        "flex-shrink:0"
      ].join(";");
      view.addEventListener("click", (e) => e.stopPropagation());
      view.addEventListener("mouseenter", () => {
        view.style.textDecoration = "underline";
      });
      view.addEventListener("mouseleave", () => {
        view.style.textDecoration = "none";
      });
      titleRow.appendChild(view);
    }
    cell.appendChild(titleRow);
    return cell;
  }
  function buildAssignmentBadge(label, dashicon, fg, bg) {
    const badge = document.createElement("span");
    badge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:4px",
      "padding:2px 8px",
      "border-radius:10px",
      "font-size:11px",
      "font-weight:600",
      `background:${bg}`,
      `color:${fg}`,
      "white-space:nowrap",
      "flex-shrink:0"
    ].join(";");
    const icon = document.createElement("span");
    icon.className = `dashicons ${dashicon}`;
    icon.setAttribute("aria-hidden", "true");
    icon.style.cssText = "font-size:13px;width:13px;height:13px;line-height:1;";
    const text = document.createElement("span");
    text.textContent = label;
    badge.appendChild(icon);
    badge.appendChild(text);
    return badge;
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
      const ok = await wpdConfirmGlobal$1({
        title: __("Delete category?"),
        message: sprintf(
          /* translators: %s: category name. */
          __(
            'Delete the category "%s"? Posts assigned only to it will fall back to Uncategorized.'
          ),
          detail.name
        ),
        confirmLabel: __("Delete"),
        danger: true
      });
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
    const root = body.querySelector(ROOT$1);
    const table = body.querySelector(TABLE$1);
    if (!root || !table) {
      return;
    }
    maybeShowIntro();
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
    table.columns = buildColumns$1(cellCache, filterData);
    table.getRowId = (row) => row.id;
    table.subTable = (row) => buildSubRow(row);
    table.sort = { key: "date", direction: "desc" };
    let totalPages = 0;
    let totalRows = 0;
    let refreshSeq = 0;
    const perPageEl = root.querySelector(PER_PAGE$1);
    if (perPageEl) {
      perPageEl.value = String(view.perPage);
    }
    const indicator = root.querySelector(PAGE_INDICATOR$1);
    const prevBtn = root.querySelector(PREV$1);
    const nextBtn = root.querySelector(NEXT$1);
    const bulkBar = root.querySelector(BULK$1);
    const countEl = root.querySelector(COUNT$1);
    const bulkActionsHost = root.querySelector(BULK_ACTIONS_HOST$1);
    const trailingExtras = root.querySelector(
      TOOLBAR_TRAILING_EXTRAS
    );
    const statusHost = root.querySelector(STATUS$1);
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
        refreshParentTitleRoster(result.items);
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
    root.querySelector(STATUS$1)?.addEventListener("wpd-pick", (e) => {
      const value = e.detail?.value ?? "";
      view.status = value;
      goToFirstPage();
      void refresh();
    });
    root.querySelector(SEARCH$1)?.addEventListener(
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
        }, SEARCH_DEBOUNCE_MS$1);
      }
    );
    body.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      if (target.closest(REFRESH$1)) {
        void refresh();
        return;
      }
      if (target.closest(NEW_BTN$1)) {
        openAdminUrl(cfg.newPostUrl, {
          title: __("Add New Post"),
          icon: "dashicons-admin-post"
        });
        return;
      }
      if (target.closest(PREV$1)) {
        if (view.page > 1) {
          view.page -= 1;
          void refresh();
        }
        return;
      }
      if (target.closest(NEXT$1)) {
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
        const ok = await wpdConfirmGlobal$1({
          message: sprintf(
            /* translators: %d: row count. */
            action.confirm,
            ids.length
          ),
          danger: true
        });
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
      table.columns = buildColumns$1(cellCache, filterData);
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
    setActiveWindowId("desktop-mode-posts");
    return renderPostsWindow(body).catch((err) => {
      console.error("[posts-window] render failed:", err);
    });
  };
  registry["desktop-mode-pages"] = (body) => {
    setActiveWindowId("desktop-mode-pages");
    return renderPostsWindow(body).catch((err) => {
      console.error("[pages-window] render failed:", err);
    });
  };
  registry["desktop-mode-users"] = (body) => {
    setActiveWindowId("desktop-mode-users");
    return Promise.resolve().then(() => usersRender).then((m) => m.renderUsersWindow(body)).catch((err) => {
      console.error("[users-window] render failed:", err);
    });
  };
  registry["desktop-mode-user-edit"] = (body) => {
    setActiveWindowId("desktop-mode-user-edit");
    const profile = body.querySelector(
      "wpd-user-profile[data-wpd-user-profile-host]"
    );
    if (!profile) {
      return;
    }
    void Promise.resolve().then(() => userEditTarget).then((target) => {
      const pending = target.readUserEditTarget();
      let userId = pending.userId && pending.userId > 0 ? pending.userId : 0;
      if (userId <= 0) {
        try {
          userId = window.desktopModeWindowConfig?.["desktop-mode-user-edit"]?.currentUserId ?? 0;
        } catch {
          userId = 0;
        }
      }
      if (userId > 0) {
        profile.setAttribute("user-id", String(userId));
      }
      target.clearUserEditTarget();
      target.subscribeUserEditTarget((next) => {
        if (!profile.isConnected) {
          return;
        }
        if (next.userId && next.userId > 0 && next.userId !== userId) {
          userId = next.userId;
          setActiveWindowId("desktop-mode-user-edit");
          profile.setAttribute("user-id", String(userId));
          target.clearUserEditTarget();
        }
      });
    });
  };
  function shellFetch$1(input, init, source) {
    return trackedFetch(input, init, {
      windowId: getActiveWindowId(),
      source: source ?? "user-edit-window/rest"
    });
  }
  async function fetchUser(id) {
    const cfg = getConfig();
    const base = cfg.usersUrl ?? `${cfg.restRoot}wp/v2/users`;
    const url = `${base}/${id}?context=edit`;
    const res = await shellFetch$1(
      url,
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-WP-Nonce": cfg.restNonce
        }
      },
      "user-edit-window/load"
    );
    if (!res.ok) {
      throw new Error(`[user-edit] load failed: ${res.status}`);
    }
    return await res.json();
  }
  async function saveUser(id, patch) {
    const cfg = getConfig();
    const base = cfg.usersUrl ?? `${cfg.restRoot}wp/v2/users`;
    const res = await shellFetch$1(
      `${base}/${id}?context=edit`,
      {
        method: "POST",
        // PUT == POST for WP REST when X-HTTP-Method-Override is unsupported.
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": cfg.restNonce,
          "X-HTTP-Method-Override": "PUT"
        },
        body: JSON.stringify(patch)
      },
      "user-edit-window/save"
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = {};
      const params = data.data?.params;
      if (params && typeof params === "object") {
        for (const [k, v] of Object.entries(params)) {
          fieldErrors[k] = String(v);
        }
      }
      return {
        ok: false,
        error: data.code ?? `http_${res.status}`,
        message: data.message,
        fieldErrors
      };
    }
    const user = await res.json();
    return { ok: true, user };
  }
  async function fetchInsights(id, opts = {}) {
    const cfg = getConfig();
    const base = cfg.insightsUrlBase ?? `${cfg.restRoot}desktop-mode/v1/users/`;
    const url = new URL(`${base}${id}/insights`);
    if (opts.fresh) {
      url.searchParams.set("fresh", "1");
    }
    const res = await shellFetch$1(
      url.toString(),
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-WP-Nonce": cfg.restNonce
        }
      },
      "user-edit-window/insights"
    );
    if (!res.ok) {
      throw new Error(`[user-edit] insights failed: ${res.status}`);
    }
    return await res.json();
  }
  function notifyToast$1(body, kind = "info") {
    const api = window.wp?.desktop;
    if (api?.notify) {
      api.notify({ body, kind });
      return;
    }
    console.info("[user-edit-window]", body);
  }
  async function mountProfileFormAt(host, userId) {
    return loadAndMountProfile(host, userId);
  }
  async function mountProfileAsideAt(host, userId, fresh) {
    return renderInsightsAside(host, userId, fresh);
  }
  async function mountProfileActivityAt(host, userId, fresh) {
    return renderInsightsActivity(host, userId, fresh);
  }
  async function loadAndMountProfile(host, userId) {
    host.replaceChildren();
    const skeleton = document.createElement("div");
    skeleton.className = "desktop-mode-user-edit__skeleton";
    skeleton.style.cssText = "display:flex;align-items:center;justify-content:center;padding:48px;color:var(--desktop-mode-muted, #50575e);font-size:13px;";
    skeleton.textContent = __("Loading profile…");
    host.appendChild(skeleton);
    let user;
    try {
      user = await fetchUser(userId);
    } catch (err) {
      host.replaceChildren();
      const msg = document.createElement("p");
      msg.style.cssText = "padding:32px;color:#b32d2e;font-size:13px;text-align:center;";
      msg.textContent = sprintf(
        // translators: %s is an error message.
        __("Could not load profile (%s)."),
        String(err.message ?? err)
      );
      host.appendChild(msg);
      throw err;
    }
    host.replaceChildren();
    mountProfileForm(host, user, userId);
    return user;
  }
  function resolveProfileConfig() {
    const current = getConfig();
    const store = window.desktopModeWindowConfig;
    const userEdit = store?.["desktop-mode-user-edit"];
    const users = store?.["desktop-mode-users"];
    return {
      ...users ?? {},
      ...userEdit ?? {},
      ...current
    };
  }
  function mountProfileForm(host, user, userId) {
    const cfg = resolveProfileConfig();
    const wrap = document.createElement("div");
    wrap.className = "desktop-mode-user-edit__profile";
    const form = document.createElement("wpd-form");
    form.setAttribute("submit-label", __("Save changes"));
    form.setAttribute("reset-label", __("Revert"));
    form.setAttribute("columns", "auto");
    const header = document.createElement("div");
    header.setAttribute("slot", "header");
    header.appendChild(buildProfileHeader(user));
    form.appendChild(header);
    form.appendChild(textField("username", __("Username"), user.username, {
      readonly: true
    }));
    form.appendChild(textField("first_name", __("First name"), user.first_name));
    form.appendChild(textField("last_name", __("Last name"), user.last_name));
    form.appendChild(
      textField("nickname", __("Nickname"), user.nickname ?? "", {
        required: true,
        fullWidth: false
      })
    );
    const displaySelect = document.createElement("wpd-select");
    displaySelect.setAttribute("name", "name");
    displaySelect.setAttribute("label", __("Display name publicly as"));
    displaySelect.items = displayNameCandidates(user);
    displaySelect.value = user.name;
    form.appendChild(displaySelect);
    form.appendChild(
      textField("email", __("Email (required)"), user.email, {
        required: true,
        type: "email"
      })
    );
    form.appendChild(textField("url", __("Website"), user.url, { type: "url" }));
    const contactMethods = cfg.contactMethods ?? {};
    for (const [slug, label] of Object.entries(contactMethods)) {
      const value = typeof user.meta === "object" && user.meta !== null ? String(
        user.meta[slug] ?? ""
      ) : "";
      form.appendChild(
        textField(`meta.${slug}`, label, value, {
          dataset: { meta: slug }
        })
      );
    }
    const bio = document.createElement("wpd-textarea");
    bio.setAttribute("name", "description");
    bio.setAttribute("label", __("Biographical info"));
    bio.setAttribute(
      "placeholder",
      __("Share a little about yourself — visible on author archives.")
    );
    bio.setAttribute("rows", "4");
    bio.setAttribute("full-width", "");
    bio.value = user.description;
    bio.setAttribute("value", user.description);
    form.appendChild(bio);
    const localeSelect = document.createElement("wpd-select");
    localeSelect.setAttribute("name", "locale");
    localeSelect.setAttribute("label", __("Language"));
    const locales = cfg.locales ?? { "": __("Site default") };
    localeSelect.items = Object.entries(locales).map(([value, label]) => ({
      value,
      label
    }));
    localeSelect.value = String(user.locale ?? "");
    form.appendChild(localeSelect);
    const isSelfEdit = userId === (cfg.currentUserId ?? 0);
    const roleMap = (() => {
      const assignable = cfg.assignableRoles;
      if (assignable && Object.keys(assignable).length > 0) {
        return assignable;
      }
      return cfg.allRoles ?? {};
    })();
    if (!isSelfEdit) {
      const roleSelect = document.createElement("wpd-select");
      roleSelect.setAttribute("name", "roles[0]");
      roleSelect.setAttribute("label", __("Role"));
      roleSelect.items = Object.entries(roleMap).map(([value, label]) => ({
        value,
        label
      }));
      const currentRole = Array.isArray(user.roles) ? user.roles[0] ?? "" : "";
      roleSelect.value = currentRole;
      form.appendChild(roleSelect);
    }
    {
      const optsHeading = document.createElement("h3");
      optsHeading.setAttribute("full-width", "");
      optsHeading.textContent = __("Personal options");
      optsHeading.style.cssText = "margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);";
      form.appendChild(optsHeading);
      const meta = user.meta ?? {};
      const richEditing = String(meta.rich_editing ?? "") !== "false";
      const syntaxHighlighting = String(meta.syntax_highlighting ?? "") !== "false";
      const commentShortcuts = String(meta.comment_shortcuts ?? "false") === "true";
      const adminBarFront = String(meta.show_admin_bar_front ?? "true") !== "false";
      form.appendChild(
        checkboxField(
          "meta.rich_editing",
          __("Disable the visual editor when writing"),
          !richEditing,
          { trueValue: "false", falseValue: "true", fullWidth: true }
        )
      );
      form.appendChild(
        checkboxField(
          "meta.syntax_highlighting",
          __("Disable syntax highlighting when editing code"),
          !syntaxHighlighting,
          { trueValue: "false", falseValue: "true", fullWidth: true }
        )
      );
      form.appendChild(
        checkboxField(
          "meta.comment_shortcuts",
          __("Enable keyboard shortcuts for comment moderation"),
          commentShortcuts,
          { trueValue: "true", falseValue: "false", fullWidth: true }
        )
      );
      form.appendChild(
        checkboxField(
          "meta.show_admin_bar_front",
          __("Show toolbar when viewing site"),
          adminBarFront,
          { trueValue: "true", falseValue: "false", fullWidth: true }
        )
      );
      const colorSchemes = cfg.colorSchemes ?? {};
      const currentScheme = String(meta.admin_color ?? "fresh");
      form.appendChild(
        buildAdminColorPicker(colorSchemes, currentScheme, {
          livePreview: isSelfEdit
        })
      );
    }
    const pwdHeading = document.createElement("h3");
    pwdHeading.setAttribute("full-width", "");
    pwdHeading.textContent = __("Account management");
    pwdHeading.style.cssText = "margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);";
    form.appendChild(pwdHeading);
    const pwdRow = document.createElement("div");
    pwdRow.setAttribute("full-width", "");
    pwdRow.style.cssText = "display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;";
    const pwd = document.createElement("wpd-text-field");
    pwd.setAttribute("name", "password");
    pwd.setAttribute("type", "password");
    pwd.setAttribute("reveal", "");
    pwd.setAttribute("label", __("New password"));
    pwd.setAttribute(
      "placeholder",
      __("Leave blank to keep the current password.")
    );
    pwd.setAttribute("autocomplete", "new-password");
    pwd.style.flex = "1 1 280px";
    pwdRow.appendChild(pwd);
    const genBtn = document.createElement("wpd-button");
    genBtn.setAttribute("variant", "ghost");
    genBtn.setAttribute("type", "button");
    const genIcon = document.createElement("wpd-icon");
    genIcon.setAttribute("name", "randomize");
    genIcon.setAttribute("size", "14");
    genBtn.appendChild(genIcon);
    genBtn.appendChild(document.createTextNode(__("Generate strong")));
    genBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const next = generateStrongPassword$1(18);
      pwd.value = next;
      pwd.setAttribute("value", next);
      const pwdConfirmEl = form.querySelector(
        'wpd-text-field[name="password_confirm"]'
      );
      if (pwdConfirmEl) {
        pwdConfirmEl.value = next;
        pwdConfirmEl.setAttribute("value", next);
      }
      void navigator.clipboard?.writeText(next).catch(() => {
      });
      notifyToast$1(__("Password generated and copied to clipboard."), "success");
    });
    pwdRow.appendChild(genBtn);
    form.appendChild(pwdRow);
    const pwdConfirm = document.createElement("wpd-text-field");
    pwdConfirm.setAttribute("name", "password_confirm");
    pwdConfirm.setAttribute("type", "password");
    pwdConfirm.setAttribute("reveal", "");
    pwdConfirm.setAttribute("label", __("Confirm new password"));
    pwdConfirm.setAttribute(
      "placeholder",
      __("Type the new password again.")
    );
    pwdConfirm.setAttribute("autocomplete", "new-password");
    pwdConfirm.setAttribute("full-width", "");
    form.appendChild(pwdConfirm);
    form.appendChild(
      buildSessionsRow(userId, isSelfEdit)
    );
    form.appendChild(buildAppPasswordsRow(userId));
    if (!isSelfEdit && cfg.isMultisite && user.meta?.is_super_admin !== void 0) {
      form.appendChild(
        checkboxField(
          "meta.is_super_admin",
          __("Grant super admin privileges for the network"),
          Boolean(
            user.meta?.is_super_admin
          ),
          { trueValue: "true", falseValue: "false", fullWidth: true }
        )
      );
    }
    let pending = false;
    form.addEventListener("wpd-form-submit", (e) => {
      const detail = e.detail;
      void onSubmit(detail.values);
    });
    const onSubmit = async (values) => {
      if (pending) {
        return;
      }
      pending = true;
      form.setBusy(true);
      form.clearErrors();
      const patch = {
        first_name: values.first_name,
        last_name: values.last_name,
        nickname: values.nickname,
        name: values.name,
        email: values.email,
        url: values.url,
        description: values.description,
        locale: values.locale ?? ""
      };
      if (typeof values.password === "string" && values.password !== "") {
        const confirm = String(values.password_confirm ?? "");
        if (confirm !== values.password) {
          form.setError(__("The two password fields do not match."));
          form.setFieldInvalid("password_confirm");
          pending = false;
          form.setBusy(false);
          return;
        }
        patch.password = values.password;
      }
      if (typeof values["roles[0]"] === "string" && values["roles[0]"]) {
        patch.roles = [values["roles[0]"]];
      }
      const meta = {};
      for (const [k, v] of Object.entries(values)) {
        if (k.startsWith("meta.")) {
          meta[k.slice(5)] = v;
        }
      }
      if (Object.keys(meta).length > 0) {
        patch.meta = meta;
      }
      const result = await saveUser(userId, patch);
      pending = false;
      form.setBusy(false);
      if (!result.ok) {
        const summary = result.message ?? mapErrorCode(result.error) ?? __("Save failed.");
        form.setError(summary);
        notifyToast$1(summary, "error");
        if (result.fieldErrors) {
          for (const field of Object.keys(result.fieldErrors)) {
            form.setFieldInvalid(field);
          }
        }
        console.warn("[user-edit] save failed", {
          code: result.error,
          message: result.message
        });
        return;
      }
      notifyToast$1(__("Profile saved."), "success");
      pwd.value = "";
      pwd.setAttribute("value", "");
      pwdConfirm.value = "";
      pwdConfirm.setAttribute("value", "");
      if (result.user) {
        Object.assign(user, result.user);
        header.replaceChildren(buildProfileHeader(user));
        const aside = host.ownerDocument?.querySelector(
          "[data-wpd-user-profile-aside]"
        );
        if (aside) {
          void mountProfileAsideAt(aside, userId, true);
        }
      }
    };
    wrap.appendChild(form);
    host.appendChild(wrap);
  }
  function buildProfileHeader(user) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-mode-user-edit__header";
    wrap.style.cssText = "display:flex;align-items:center;gap:16px;margin:0 0 12px;";
    const avatar = document.createElement("img");
    const avatars = user.avatar_urls ?? {};
    avatar.src = avatars["96"] ?? avatars["48"] ?? "";
    avatar.alt = "";
    avatar.style.cssText = "width:64px;height:64px;border-radius:50%;flex-shrink:0;";
    wrap.appendChild(avatar);
    const text = document.createElement("div");
    text.style.cssText = "min-width:0;display:flex;flex-direction:column;gap:4px;";
    const name = document.createElement("div");
    name.style.cssText = "font-size:18px;font-weight:600;letter-spacing:-0.01em;";
    name.textContent = user.name || user.username || `#${user.id}`;
    text.appendChild(name);
    const sub = document.createElement("div");
    sub.style.cssText = "display:flex;align-items:center;gap:6px;font-size:12px;color:var(--desktop-mode-muted, #50575e);flex-wrap:wrap;";
    const handle = document.createElement("span");
    handle.textContent = `@${user.username}`;
    sub.appendChild(handle);
    const dot = document.createElement("span");
    dot.textContent = "·";
    dot.setAttribute("aria-hidden", "true");
    sub.appendChild(dot);
    const roleStr = Array.isArray(user.roles) ? user.roles.join(", ") : "";
    const roleSpan = document.createElement("span");
    roleSpan.textContent = roleStr || __("No role");
    sub.appendChild(roleSpan);
    text.appendChild(sub);
    wrap.appendChild(text);
    return wrap;
  }
  async function loadInsightsInto(host, userId, fresh) {
    host.replaceChildren();
    const skeleton = document.createElement("div");
    skeleton.style.cssText = "display:flex;align-items:center;justify-content:center;padding:32px;color:var(--desktop-mode-muted, #50575e);font-size:13px;";
    skeleton.textContent = __("Loading insights…");
    host.appendChild(skeleton);
    try {
      return await fetchInsights(userId, { fresh });
    } catch (err) {
      host.replaceChildren();
      const msg = document.createElement("p");
      msg.style.cssText = "padding:24px;color:#b32d2e;font-size:13px;text-align:center;";
      msg.textContent = sprintf(
        // translators: %s is an error message.
        __("Could not load insights (%s)."),
        String(err.message ?? err)
      );
      host.appendChild(msg);
      return null;
    }
  }
  async function renderInsightsAside(host, userId, fresh) {
    const data = await loadInsightsInto(host, userId, fresh);
    if (!data) {
      return;
    }
    host.replaceChildren();
    host.appendChild(buildAsideSummary(data));
    host.appendChild(buildAsideStatGrid(data));
    host.appendChild(buildContentSparkline(data));
  }
  async function renderInsightsActivity(host, userId, fresh) {
    const data = await loadInsightsInto(host, userId, fresh);
    if (!data) {
      return;
    }
    host.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "desktop-mode-user-edit__activity";
    const heading = document.createElement("h3");
    heading.textContent = __("Recent activity");
    heading.style.cssText = "margin:24px 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);";
    wrap.appendChild(heading);
    wrap.appendChild(buildRecentLists(data));
    wrap.appendChild(buildSecurityPanel(data));
    host.appendChild(wrap);
  }
  function buildAsideSummary(data) {
    const card = document.createElement("div");
    card.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "text-align:center",
      "gap:6px",
      "padding:16px",
      "border:1px solid var(--desktop-mode-border, #dcdcde)",
      "border-radius:12px",
      "background:var(--wp-admin-theme-bg-elevated, #f6f7f7)"
    ].join(";");
    const avatar = document.createElement("img");
    avatar.src = data.avatarUrl;
    avatar.alt = "";
    avatar.style.cssText = "width:72px;height:72px;border-radius:50%;flex-shrink:0;";
    card.appendChild(avatar);
    const name = document.createElement("div");
    name.style.cssText = "font-size:15px;font-weight:600;letter-spacing:-0.01em;";
    name.textContent = data.displayName || `#${data.userId}`;
    card.appendChild(name);
    const roles = document.createElement("div");
    roles.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;justify-content:center;";
    for (const role of data.roles) {
      const chip = document.createElement("span");
      chip.textContent = role;
      chip.style.cssText = [
        "display:inline-flex",
        "padding:2px 8px",
        "border-radius:10px",
        "background:rgba(34,113,177,0.10)",
        "color:#0a4b78",
        "font-size:11px",
        "font-weight:600"
      ].join(";");
      roles.appendChild(chip);
    }
    if (data.roles.length === 0) {
      const noRole = document.createElement("span");
      noRole.textContent = __("No role");
      noRole.style.cssText = "font-size:11px;color:var(--desktop-mode-muted, #8c8f94);";
      roles.appendChild(noRole);
    }
    card.appendChild(roles);
    const completeness = data.profileCompleteness;
    if (completeness && completeness.total > 0) {
      const cwrap = document.createElement("div");
      cwrap.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;margin-top:6px;";
      const top = document.createElement("div");
      top.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--desktop-mode-muted, #50575e);";
      const lbl = document.createElement("span");
      lbl.textContent = __("Profile completeness");
      const pct = document.createElement("span");
      pct.style.cssText = "font-variant-numeric:tabular-nums;font-weight:600;";
      pct.textContent = `${completeness.percent}%`;
      top.appendChild(lbl);
      top.appendChild(pct);
      cwrap.appendChild(top);
      const track = document.createElement("div");
      track.style.cssText = [
        "height:4px",
        "border-radius:999px",
        "background:rgba(0,0,0,0.06)",
        "position:relative",
        "overflow:hidden"
      ].join(";");
      const bar = document.createElement("div");
      bar.style.cssText = [
        "position:absolute",
        "inset:0",
        `width:${completeness.percent}%`,
        "background:var(--wp-admin-theme-color, #2271b1)",
        "transition:width 360ms ease"
      ].join(";");
      track.appendChild(bar);
      cwrap.appendChild(track);
      card.appendChild(cwrap);
    }
    return card;
  }
  function buildAsideStatGrid(data) {
    const grid = document.createElement("div");
    grid.style.cssText = [
      "display:grid",
      "grid-template-columns:1fr 1fr",
      "gap:8px",
      "margin-top:12px"
    ].join(";");
    const tile = (label, value, sub) => {
      const card = document.createElement("div");
      card.style.cssText = [
        "border:1px solid var(--desktop-mode-border, #dcdcde)",
        "border-radius:8px",
        "padding:8px 10px",
        "display:flex",
        "flex-direction:column",
        "gap:1px",
        "min-width:0"
      ].join(";");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);font-weight:600;";
      lbl.textContent = label;
      const val = document.createElement("div");
      val.style.cssText = "font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;";
      val.textContent = value;
      card.appendChild(lbl);
      card.appendChild(val);
      if (sub) {
        const subEl = document.createElement("div");
        subEl.style.cssText = "font-size:10px;color:var(--desktop-mode-muted, #8c8f94);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        subEl.title = sub;
        subEl.textContent = sub;
        card.appendChild(subEl);
      }
      return card;
    };
    const stats = data.stats;
    grid.appendChild(
      tile(
        __("Posts"),
        String(stats.posts),
        // translators: %d is a count of pages.
        stats.pages > 0 ? sprintf(__("+ %d pages"), stats.pages) : void 0
      )
    );
    let commentsSub;
    if (stats.commentsReceived > 0) {
      commentsSub = sprintf(
        // translators: %d is a count of received comments.
        __("%d received"),
        stats.commentsReceived
      );
    }
    grid.appendChild(
      tile(__("Comments"), String(stats.commentsAuthored), commentsSub)
    );
    grid.appendChild(
      tile(
        __("Last login"),
        stats.lastLoginAt ? relativeTime$1(stats.lastLoginAt) : __("Never"),
        stats.lastLoginAt ? new Date(stats.lastLoginAt * 1e3).toLocaleDateString() : void 0
      )
    );
    let memberValue = "—";
    if (stats.daysSinceRegistration !== null) {
      memberValue = sprintf(
        // translators: %d is a number of days.
        __("%d days"),
        stats.daysSinceRegistration
      );
    }
    grid.appendChild(
      tile(
        __("Member"),
        memberValue,
        stats.registeredAt ? new Date(stats.registeredAt * 1e3).toLocaleDateString() : void 0
      )
    );
    return grid;
  }
  function buildContentSparkline(data) {
    const wrap = document.createElement("div");
    wrap.style.cssText = [
      "border:1px solid var(--desktop-mode-border, #dcdcde)",
      "border-radius:10px",
      "padding:14px 16px",
      "margin:0 0 22px"
    ].join(";");
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;margin:0 0 8px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:13px;font-weight:600;";
    title.textContent = __("Posts published — last 12 months");
    head.appendChild(title);
    const total = data.contentByMonth.reduce((s, m) => s + m.count, 0);
    const sub = document.createElement("div");
    sub.style.cssText = "font-size:11px;color:var(--desktop-mode-muted, #50575e);";
    sub.textContent = sprintf(
      // translators: %d is a count of posts.
      __("%d total"),
      total
    );
    head.appendChild(sub);
    wrap.appendChild(head);
    if (data.contentByMonth.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "margin:0;color:var(--desktop-mode-muted, #50575e);font-size:12px;";
      empty.textContent = __("No activity in the last 12 months.");
      wrap.appendChild(empty);
      return wrap;
    }
    const max = Math.max(1, ...data.contentByMonth.map((m) => m.count));
    const bars = document.createElement("div");
    bars.style.cssText = [
      "display:grid",
      `grid-template-columns:repeat(${data.contentByMonth.length}, 1fr)`,
      "gap:4px",
      "align-items:end",
      "height:60px"
    ].join(";");
    for (const month of data.contentByMonth) {
      const col = document.createElement("div");
      col.style.cssText = "display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;";
      const bar = document.createElement("div");
      const heightPct = Math.round(month.count / max * 100);
      bar.style.cssText = [
        "width:100%",
        `height:${Math.max(3, heightPct)}%`,
        "background:var(--wp-admin-theme-color, #2271b1)",
        month.count === 0 ? "opacity:0.18" : "opacity:1",
        "border-radius:3px 3px 0 0",
        "transition:height 360ms ease"
      ].join(";");
      bar.title = sprintf(
        // translators: %1$s is a YYYY-MM month, %2$d is post count.
        __("%1$s — %2$d posts"),
        month.month,
        month.count
      );
      col.appendChild(bar);
      wrap.appendChild(col);
      bars.appendChild(col);
    }
    wrap.appendChild(bars);
    const labels = document.createElement("div");
    labels.style.cssText = [
      "display:grid",
      `grid-template-columns:repeat(${data.contentByMonth.length}, 1fr)`,
      "gap:4px",
      "margin-top:4px",
      "font-size:10px",
      "color:var(--desktop-mode-muted, #8c8f94)",
      "text-align:center"
    ].join(";");
    for (const month of data.contentByMonth) {
      const span = document.createElement("span");
      const parts = month.month.split("-");
      span.textContent = parts.length === 2 ? parts[1] : month.month;
      labels.appendChild(span);
    }
    wrap.appendChild(labels);
    return wrap;
  }
  function buildRecentLists(data) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;margin:0 0 22px;";
    wrap.appendChild(
      buildRecentList(
        __("Recent posts"),
        __("No recent posts."),
        data.recentPosts.map((p) => ({
          primary: p.title,
          secondary: relativeFromIso(p.dateGmt),
          tag: p.status !== "publish" ? p.status : null,
          badge: p.commentCount > 0 ? sprintf(
            // translators: %d is a count of comments.
            __("%d 💬"),
            p.commentCount
          ) : null
        }))
      )
    );
    wrap.appendChild(
      buildRecentList(
        __("Recent comments"),
        __("No recent comments."),
        data.recentComments.map((c) => {
          const when = relativeFromIso(c.dateGmt);
          return {
            primary: c.excerpt || __("(empty comment)"),
            secondary: c.postTitle ? `${__("on")} "${c.postTitle}" · ${when}` : when,
            tag: c.approved ? null : __("pending"),
            badge: null
          };
        })
      )
    );
    return wrap;
  }
  function buildRecentList(title, emptyText, items) {
    const card = document.createElement("div");
    card.style.cssText = [
      "border:1px solid var(--desktop-mode-border, #dcdcde)",
      "border-radius:10px",
      "padding:14px 16px",
      "min-width:0"
    ].join(";");
    const head = document.createElement("div");
    head.style.cssText = "font-size:13px;font-weight:600;margin:0 0 10px;";
    head.textContent = title;
    card.appendChild(head);
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "margin:0;color:var(--desktop-mode-muted, #50575e);font-size:12px;";
      empty.textContent = emptyText;
      card.appendChild(empty);
      return card;
    }
    const list = document.createElement("ul");
    list.style.cssText = "list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;";
    for (const item of items) {
      const li = document.createElement("li");
      li.style.cssText = "min-width:0;";
      const top = document.createElement("div");
      top.style.cssText = "display:flex;align-items:baseline;gap:6px;min-width:0;";
      const primary = document.createElement("span");
      primary.style.cssText = "font-size:13px;line-height:1.35;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      primary.textContent = item.primary;
      primary.title = item.primary;
      top.appendChild(primary);
      if (item.tag) {
        const tag = document.createElement("span");
        tag.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.04em;background:rgba(0,0,0,0.06);padding:1px 6px;border-radius:8px;flex-shrink:0;";
        tag.textContent = item.tag;
        top.appendChild(tag);
      }
      if (item.badge) {
        const badge = document.createElement("span");
        badge.style.cssText = "font-size:11px;color:var(--desktop-mode-muted, #50575e);flex-shrink:0;";
        badge.textContent = item.badge;
        top.appendChild(badge);
      }
      li.appendChild(top);
      const sub = document.createElement("div");
      sub.style.cssText = "font-size:11px;color:var(--desktop-mode-muted, #8c8f94);";
      sub.textContent = item.secondary;
      li.appendChild(sub);
      list.appendChild(li);
    }
    card.appendChild(list);
    return card;
  }
  function buildSecurityPanel(data) {
    const card = document.createElement("div");
    card.style.cssText = [
      "border:1px solid var(--desktop-mode-border, #dcdcde)",
      "border-radius:10px",
      "padding:14px 16px"
    ].join(";");
    const head = document.createElement("div");
    head.style.cssText = "font-size:13px;font-weight:600;margin:0 0 10px;";
    head.textContent = __("Active sessions & app access");
    card.appendChild(head);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;";
    const sessionTile = document.createElement("div");
    sessionTile.style.cssText = "display:flex;flex-direction:column;gap:2px;font-size:12px;";
    const sessionLabel = document.createElement("div");
    sessionLabel.style.cssText = "color:var(--desktop-mode-muted, #50575e);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;";
    sessionLabel.textContent = __("Active sessions");
    const sessionValue = document.createElement("div");
    sessionValue.style.cssText = "font-size:18px;font-weight:600;";
    sessionValue.textContent = String(data.sessions.length);
    const sessionSub = document.createElement("div");
    sessionSub.style.cssText = "color:var(--desktop-mode-muted, #8c8f94);";
    const currentCount = data.sessions.filter((s) => s.current).length;
    sessionSub.textContent = currentCount > 0 ? __("Includes the current device.") : __("Logged in across multiple devices.");
    sessionTile.appendChild(sessionLabel);
    sessionTile.appendChild(sessionValue);
    sessionTile.appendChild(sessionSub);
    grid.appendChild(sessionTile);
    const appTile = document.createElement("div");
    appTile.style.cssText = "display:flex;flex-direction:column;gap:2px;font-size:12px;";
    const appLabel = document.createElement("div");
    appLabel.style.cssText = "color:var(--desktop-mode-muted, #50575e);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;";
    appLabel.textContent = __("Application passwords");
    const appValue = document.createElement("div");
    appValue.style.cssText = "font-size:18px;font-weight:600;";
    appValue.textContent = String(data.applicationPasswords.total);
    const appSub = document.createElement("div");
    appSub.style.cssText = "color:var(--desktop-mode-muted, #8c8f94);";
    if (data.applicationPasswords.lastUsedAt && data.applicationPasswords.lastUsedName) {
      appSub.textContent = sprintf(
        // translators: %1$s is the app password name, %2$s is a relative time.
        __('"%1$s" last used %2$s'),
        data.applicationPasswords.lastUsedName,
        relativeTime$1(data.applicationPasswords.lastUsedAt)
      );
    } else {
      appSub.textContent = data.applicationPasswords.total ? __("No recent use.") : __("No app passwords issued yet.");
    }
    appTile.appendChild(appLabel);
    appTile.appendChild(appValue);
    appTile.appendChild(appSub);
    grid.appendChild(appTile);
    card.appendChild(grid);
    return card;
  }
  function textField(formName, label, value, opts = {}) {
    const el = document.createElement("wpd-text-field");
    el.setAttribute("name", formName);
    el.setAttribute("label", label);
    el.setAttribute("value", value);
    el.value = value;
    if (opts.required) {
      el.setAttribute("required", "");
    }
    if (opts.readonly) {
      el.setAttribute("readonly", "");
    }
    if (opts.type) {
      el.setAttribute("type", opts.type);
    }
    if (opts.fullWidth !== false && opts.fullWidth) {
      el.setAttribute("full-width", "");
    }
    if (opts.dataset) {
      for (const [k, v] of Object.entries(opts.dataset)) {
        el.dataset[k] = v;
      }
    }
    return el;
  }
  function displayNameCandidates(user) {
    const candidates = /* @__PURE__ */ new Set();
    const add = (s) => {
      const t = s.trim();
      if (t !== "") {
        candidates.add(t);
      }
    };
    add(user.username);
    add(user.nickname ?? "");
    add(user.first_name);
    add(user.last_name);
    if (user.first_name || user.last_name) {
      add(`${user.first_name} ${user.last_name}`.trim());
      add(`${user.last_name} ${user.first_name}`.trim());
    }
    if (user.name) {
      add(user.name);
    }
    return Array.from(candidates).map((name) => ({
      value: name,
      label: name
    }));
  }
  function relativeFromIso(iso) {
    const ms = msFromIso(iso);
    if (!Number.isFinite(ms)) {
      return "—";
    }
    return relativeTime$1(Math.floor(ms / 1e3));
  }
  function relativeTime$1(ts) {
    if (!Number.isFinite(ts)) {
      return "—";
    }
    const now = Math.floor(Date.now() / 1e3);
    const delta = now - ts;
    if (delta < 60) {
      return __("just now");
    }
    if (delta < 3600) {
      return sprintf(__("%d min ago"), Math.floor(delta / 60));
    }
    if (delta < 86400) {
      return sprintf(__("%d h ago"), Math.floor(delta / 3600));
    }
    if (delta < 86400 * 30) {
      return sprintf(__("%d d ago"), Math.floor(delta / 86400));
    }
    if (delta < 86400 * 365) {
      return sprintf(__("%d mo ago"), Math.floor(delta / (86400 * 30)));
    }
    return sprintf(__("%d y ago"), Math.floor(delta / (86400 * 365)));
  }
  function msFromIso(iso) {
    if (!iso) {
      return NaN;
    }
    if (iso.startsWith("0000-00-00")) {
      return NaN;
    }
    let normalized = iso;
    if (normalized.includes(" ")) {
      normalized = normalized.replace(" ", "T");
    }
    if (!/Z$/.test(normalized) && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized += "Z";
    }
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function generateStrongPassword$1(length) {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%^&*-_=+";
    const all = upper + lower + digits + symbols;
    const buf = new Uint32Array(length);
    crypto.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += all[buf[i] % all.length];
    }
    return out;
  }
  function mapErrorCode(code) {
    switch (code) {
      case "rest_user_invalid_email":
      case "invalid_email":
        return __("Email address is not valid.");
      case "rest_user_email_exists":
      case "existing_user_email":
        return __("That email is already in use.");
      case "rest_user_invalid_role":
        return __("You are not allowed to assign that role.");
      default:
        return null;
    }
  }
  function applyColorSchemePreview(slug, info) {
    if (!info.url) {
      flipBodyClass(slug);
      return;
    }
    let link = document.getElementById(
      "colors-css"
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.id = "colors-css";
      document.head.appendChild(link);
    }
    link.href = info.url;
    flipBodyClass(slug);
  }
  function flipBodyClass(slug) {
    const body = document.body;
    const next = `admin-color-${slug}`;
    for (const cls of Array.from(body.classList)) {
      if (cls.startsWith("admin-color-") && cls !== next) {
        body.classList.remove(cls);
      }
    }
    body.classList.add(next);
  }
  function buildAdminColorPicker(schemes, current, opts = {}) {
    const wrap = document.createElement("div");
    wrap.setAttribute("full-width", "");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    const label = document.createElement("span");
    label.style.cssText = "font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);font-weight:600;";
    label.textContent = __("Admin colour scheme");
    wrap.appendChild(label);
    const hidden = document.createElement("wpd-text-field");
    hidden.setAttribute("name", "meta.admin_color");
    hidden.setAttribute("value", current);
    hidden.value = current;
    hidden.style.display = "none";
    wrap.appendChild(hidden);
    const grid = document.createElement("div");
    grid.style.cssText = [
      "display:grid",
      "grid-template-columns:repeat(auto-fill, minmax(140px, 1fr))",
      "gap:8px"
    ].join(";");
    wrap.appendChild(grid);
    let selected = current;
    const updateSelected = (slug) => {
      selected = slug;
      hidden.value = slug;
      hidden.setAttribute("value", slug);
      for (const t of Array.from(grid.children)) {
        const tile = t;
        const v = tile.dataset.scheme;
        tile.style.borderColor = v === slug ? "var(--wp-admin-theme-color, #2271b1)" : "var(--desktop-mode-border, #dcdcde)";
        tile.style.boxShadow = v === slug ? "0 0 0 1px var(--wp-admin-theme-color, #2271b1) inset" : "none";
        tile.setAttribute("aria-checked", v === slug ? "true" : "false");
      }
    };
    for (const [slug, info] of Object.entries(schemes)) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.setAttribute("role", "radio");
      tile.setAttribute("aria-checked", slug === selected ? "true" : "false");
      tile.dataset.scheme = slug;
      tile.style.cssText = [
        "appearance:none",
        "border:1px solid var(--desktop-mode-border, #dcdcde)",
        "background:var(--wp-admin-theme-bg, #fff)",
        "color:inherit",
        "border-radius:8px",
        "padding:10px 10px 8px",
        "cursor:pointer",
        "display:flex",
        "flex-direction:column",
        "gap:6px",
        "text-align:left",
        "min-width:0",
        "transition:border-color 120ms ease, box-shadow 120ms ease"
      ].join(";");
      const swatchRow = document.createElement("span");
      swatchRow.style.cssText = "display:flex;height:18px;border-radius:4px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);";
      const colors = (info.colors ?? []).slice(0, 4);
      if (colors.length === 0) {
        colors.push("#dcdcde", "#dcdcde", "#dcdcde");
      }
      for (const color of colors) {
        const swatch = document.createElement("span");
        swatch.style.cssText = `flex:1 1 auto;background:${color};`;
        swatchRow.appendChild(swatch);
      }
      tile.appendChild(swatchRow);
      const name = document.createElement("span");
      name.style.cssText = "font-size:12px;font-weight:500;";
      name.textContent = info.name;
      tile.appendChild(name);
      tile.addEventListener("click", () => {
        updateSelected(slug);
        if (opts.livePreview) {
          applyColorSchemePreview(slug, info);
        }
      });
      grid.appendChild(tile);
    }
    updateSelected(selected);
    return wrap;
  }
  function checkboxField(name, label, checked, opts = {}) {
    const trueValue = opts.trueValue ?? "true";
    const falseValue = opts.falseValue ?? "false";
    const wrap = document.createElement("span");
    if (opts.fullWidth) {
      wrap.setAttribute("full-width", "");
    }
    const cb = document.createElement("wpd-checkbox-label");
    cb.setAttribute("label", label);
    cb.setAttribute("name", name);
    cb.setAttribute("value", checked ? trueValue : falseValue);
    cb.value = checked ? trueValue : falseValue;
    if (checked) {
      cb.setAttribute("checked", "");
    }
    cb.addEventListener("wpd-checkbox-change", (e) => {
      const detail = e.detail;
      const v = detail?.checked ? trueValue : falseValue;
      cb.value = v;
      cb.setAttribute("value", v);
    });
    wrap.appendChild(cb);
    return wrap;
  }
  function buildSessionsRow(userId, isSelfEdit) {
    const wrap = document.createElement("div");
    wrap.setAttribute("full-width", "");
    wrap.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;";
    const label = document.createElement("span");
    label.style.cssText = "font-size:13px;color:var(--desktop-mode-fg, inherit);";
    label.textContent = __("Active sessions");
    wrap.appendChild(label);
    const btn = document.createElement("wpd-button");
    btn.setAttribute("variant", "ghost");
    btn.setAttribute("type", "button");
    btn.textContent = isSelfEdit ? __("Log out everywhere else") : __("Log this user out everywhere");
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const cfg = getConfig();
        const base = cfg.insightsUrlBase ?? `${cfg.restRoot}desktop-mode/v1/users/`;
        const res = await trackedFetch(
          `${base}${userId}/destroy-sessions`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-WP-Nonce": cfg.restNonce
            },
            body: JSON.stringify({
              scope: isSelfEdit ? "others" : "all"
            })
          },
          { source: "user-edit-window/destroy-sessions" }
        );
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        notifyToast$1(__("Sessions destroyed."), "success");
      } catch (err) {
        notifyToast$1(
          sprintf(
            // translators: %s is an error message.
            __("Could not destroy sessions (%s)."),
            String(err.message ?? err)
          ),
          "error"
        );
      }
    });
    wrap.appendChild(btn);
    return wrap;
  }
  function buildAppPasswordsRow(userId) {
    const wrap = document.createElement("div");
    wrap.setAttribute("full-width", "");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;border:1px solid var(--desktop-mode-border, #dcdcde);border-radius:8px;padding:12px 14px;";
    const heading = document.createElement("div");
    heading.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const headLabel = document.createElement("span");
    headLabel.textContent = __("Application passwords");
    headLabel.style.cssText = "font-size:13px;font-weight:600;";
    heading.appendChild(headLabel);
    wrap.appendChild(heading);
    const cfg = getConfig();
    const base = cfg.insightsUrlBase ?? `${cfg.restRoot}desktop-mode/v1/users/`;
    const list = document.createElement("ul");
    list.style.cssText = "list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;";
    wrap.appendChild(list);
    const createRow = document.createElement("div");
    createRow.style.cssText = "display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:6px;";
    const nameInput = document.createElement("wpd-text-field");
    nameInput.setAttribute("label", __("New application password name"));
    nameInput.setAttribute(
      "placeholder",
      __("e.g. iPhone, WP-CLI, Backup tool")
    );
    nameInput.style.flex = "1 1 220px";
    createRow.appendChild(nameInput);
    const createBtn = document.createElement("wpd-button");
    createBtn.setAttribute("variant", "primary");
    createBtn.setAttribute("type", "button");
    createBtn.textContent = __("Create");
    createRow.appendChild(createBtn);
    wrap.appendChild(createRow);
    const renderItems = (items) => {
      list.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement("li");
        empty.style.cssText = "font-size:12px;color:var(--desktop-mode-muted, #50575e);";
        empty.textContent = __("No application passwords issued yet.");
        list.appendChild(empty);
        return;
      }
      for (const item of items) {
        const row = document.createElement("li");
        row.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;";
        const nameSpan = document.createElement("span");
        nameSpan.style.cssText = "flex:1 1 auto;font-weight:500;";
        nameSpan.textContent = item.name;
        row.appendChild(nameSpan);
        const meta = document.createElement("span");
        meta.style.cssText = "color:var(--desktop-mode-muted, #8c8f94);";
        meta.textContent = item.last_used ? sprintf(
          // translators: %s is a relative time.
          __("last used %s"),
          relativeTime$1(item.last_used)
        ) : __("never used");
        row.appendChild(meta);
        const revoke = document.createElement("wpd-button");
        revoke.setAttribute("variant", "ghost");
        revoke.setAttribute("type", "button");
        revoke.textContent = __("Revoke");
        revoke.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            const res = await trackedFetch(
              `${base}${userId}/application-passwords/${item.uuid}`,
              {
                method: "DELETE",
                credentials: "same-origin",
                headers: { "X-WP-Nonce": cfg.restNonce }
              },
              { source: "user-edit-window/app-pw-revoke" }
            );
            if (!res.ok) {
              throw new Error(`http_${res.status}`);
            }
            row.remove();
            notifyToast$1(__("Application password revoked."), "success");
          } catch (err) {
            notifyToast$1(
              String(err.message ?? err),
              "error"
            );
          }
        });
        row.appendChild(revoke);
        list.appendChild(row);
      }
    };
    const refresh = async () => {
      try {
        const res = await trackedFetch(
          `${base}${userId}/application-passwords`,
          {
            credentials: "same-origin",
            headers: { "X-WP-Nonce": cfg.restNonce }
          },
          { source: "user-edit-window/app-pw-list", silent: true }
        );
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        renderItems(data.items ?? []);
      } catch {
      }
    };
    void refresh();
    createBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const name = String(nameInput.value ?? "").trim();
      if (!name) {
        notifyToast$1(__("Application password name is required."), "error");
        return;
      }
      try {
        const res = await trackedFetch(
          `${base}${userId}/application-passwords`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-WP-Nonce": cfg.restNonce
            },
            body: JSON.stringify({ name })
          },
          { source: "user-edit-window/app-pw-create" }
        );
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
        const data = await res.json();
        notifyToast$1(
          sprintf(
            // translators: %s is an application password.
            __("Created. Copy the password now: %s"),
            data.password
          ),
          "success"
        );
        void navigator.clipboard?.writeText(data.password).catch(() => {
        });
        nameInput.value = "";
        nameInput.setAttribute("value", "");
        void refresh();
      } catch (err) {
        notifyToast$1(
          String(err.message ?? err),
          "error"
        );
      }
    });
    return wrap;
  }
  const userEditRender = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    mountProfileActivityAt,
    mountProfileAsideAt,
    mountProfileFormAt
  }, Symbol.toStringTag, { value: "Module" }));
  async function showPagesIntroDialog() {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "desktop-mode-pages-intro__backdrop";
      backdrop.setAttribute("role", "presentation");
      Object.assign(backdrop.style, {
        position: "fixed",
        inset: "0",
        background: "color-mix(in srgb, var(--wp-admin-theme-color, #1d2327) 60%, transparent)",
        backdropFilter: "blur(2px)",
        zIndex: "100000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px"
      });
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "desktop-mode-pages-intro-title");
      dialog.className = "desktop-mode-pages-intro";
      Object.assign(dialog.style, {
        background: "var(--wp-admin-theme-bg, #fff)",
        color: "var(--wp-admin-theme-fg, #1d2327)",
        borderRadius: "14px",
        boxShadow: "0 24px 60px rgba(0,0,0,.28)",
        maxWidth: "520px",
        width: "100%",
        maxHeight: "90vh",
        overflow: "auto",
        padding: "28px 32px 24px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      });
      dialog.innerHTML = renderDialogMarkup$1();
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      const primaryBtn = dialog.querySelector(
        '[data-action="confirm"]'
      );
      const settingsBtn = dialog.querySelector(
        '[data-action="settings"]'
      );
      primaryBtn?.focus();
      let resolved = false;
      const cleanup = (result) => {
        if (resolved) {
          return;
        }
        resolved = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup("cancel");
        }
      };
      document.addEventListener("keydown", onKey, true);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          cleanup("cancel");
        }
      });
      primaryBtn?.addEventListener("click", () => cleanup("confirm"));
      settingsBtn?.addEventListener("click", () => cleanup("settings"));
    });
  }
  function renderDialogMarkup$1() {
    const title = __("Welcome to the new Pages window");
    const lede = __(
      "You're looking at the redesigned Pages list — same data you already manage, with a UX tuned for how Desktop Mode wants you to work."
    );
    const highlights = [
      __("Sticky header and sticky title column so long lists stay readable as you scroll."),
      __('Front page and Posts page badges right on the title — no more "wait, which one is the homepage?".'),
      __("Page Template column so you can spot which template each page uses at a glance."),
      __("Slug column with one-click copy — perfect when configuring redirects or sharing canonical URLs."),
      __("Comments column, Parent column, View link, lock indicator, multi-select bulk actions, inline search, status segments. All in one screen, no reloads.")
    ];
    const li = (arr) => arr.map(
      (s) => `<li><span class="dot" aria-hidden="true"></span>${escapeHtml$1(s)}</li>`
    ).join("");
    return `
		<style>
			.desktop-mode-pages-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.desktop-mode-pages-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-pages-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-pages-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.desktop-mode-pages-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.desktop-mode-pages-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.desktop-mode-pages-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.desktop-mode-pages-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.desktop-mode-pages-intro__footer button:hover { filter: brightness(1.05); }
			.desktop-mode-pages-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="desktop-mode-pages-intro-title">${escapeHtml$1(title)}</h2>
		<p class="lede">${escapeHtml$1(lede)}</p>
		<ul class="desktop-mode-pages-intro__list">${li(highlights)}</ul>
		<div class="desktop-mode-pages-intro__footer">
			<button type="button" data-action="settings">${escapeHtml$1(
      __("Take me to settings")
    )}</button>
			<button type="button" class="primary" data-action="confirm">${escapeHtml$1(
      __("Got it")
    )}</button>
		</div>
	`;
  }
  function escapeHtml$1(s) {
    const t = document.createElement("div");
    t.textContent = s;
    return t.innerHTML;
  }
  const pagesIntroDialog = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    showPagesIntroDialog
  }, Symbol.toStringTag, { value: "Module" }));
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
    const CHIP_TEXT_RES2 = 4;
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
        fontSize: 14,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: "600"
      },
      resolution: CHIP_TEXT_RES2
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
    function syncEmptyHint() {
      const existing = stage.querySelector(".wpd-mindmap__empty");
      if (terms.length <= 1) {
        if (!existing) {
          const empty = document.createElement("div");
          empty.className = "wpd-mindmap__empty";
          empty.textContent = __(
            'No custom categories yet. Click "Add root category" to start branching.'
          );
          stage.appendChild(empty);
        }
      } else if (existing) {
        existing.remove();
      }
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
        const rootRingByCount = roots.length > 1 ? 110 + roots.length * 28 : 0;
        const rootRing = uncategorized ? Math.max(rootRingByCount, 140) : rootRingByCount;
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
      syncEmptyHint();
    }
    function placeIsolated(term) {
      const tx = 0;
      const ty = 0;
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
      g.circle(0, -r * 0.06, r * 0.94);
      g.fill(node.color);
      g.circle(-r * 0.32, -r * 0.42, r * 0.3);
      g.fill({ color: 16777215, alpha: 0.32 });
      g.circle(0, 0, r);
      g.stroke({
        color: 16777215,
        width: highlighted ? 3 : 2,
        alignment: 0
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
          fontSize: 14,
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
          fontSize: 12,
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
      const SENSITIVITY = 8e-4;
      const factor = Math.exp(-e.deltaY * SENSITIVITY);
      const prev = targetScale;
      const next = Math.max(0.3, Math.min(2.5, prev * factor));
      if (Math.abs(next - prev) < 5e-4) {
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
    let settledW = 0;
    let settledH = 0;
    const SETTLE_THRESHOLD_PX = 24;
    const SETTLE_DEBOUNCE_MS = 80;
    let settleTimer = null;
    function onResize() {
      const r = stage.getBoundingClientRect();
      app.renderer.resize(r.width, r.height);
      app.stage.hitArea = new pixi.Rectangle(0, 0, r.width, r.height);
      if (!firstFitDone && r.width > 0 && r.height > 0) {
        firstFitDone = true;
        settledW = r.width;
        settledH = r.height;
        fitToView();
        stage.classList.remove("is-loading");
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const cur = stage.getBoundingClientRect();
        const dw = Math.abs(cur.width - settledW);
        const dh = Math.abs(cur.height - settledH);
        if (dw >= SETTLE_THRESHOLD_PX || dh >= SETTLE_THRESHOLD_PX) {
          settledW = cur.width;
          settledH = cur.height;
          recenterCamera();
        }
      }, SETTLE_DEBOUNCE_MS);
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
          fontSize: 14,
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
        closeFocus();
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
    const POSTS_CACHE_TTL_MS = 6e4;
    const postsCache = /* @__PURE__ */ new Map();
    function applyPostsResult(entry, focusedNodeId) {
      focusTotalPages = entry.totalPages;
      if (Number.isFinite(entry.realTotal)) {
        const node = nodes.get(focusedNodeId);
        if (node && node.count !== entry.realTotal) {
          node.count = entry.realTotal;
          terms = terms.map(
            (t) => t.id === node.id ? { ...t, count: entry.realTotal } : t
          );
          layoutChip(ensureChip(node), node);
        }
      }
      renderPosts(entry.items);
    }
    async function loadPostsForFocus() {
      if (focusId === null) {
        return;
      }
      const mySeq = ++loadSeq;
      const myFocusId = focusId;
      const cacheKey2 = `${focusId}:${focusPage}`;
      const cached = postsCache.get(cacheKey2);
      if (cached && performance.now() - cached.fetchedAt < POSTS_CACHE_TTL_MS) {
        applyPostsResult(cached, myFocusId);
        return;
      }
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
        const raw = response.json ?? [];
        const totalPages = Math.max(
          1,
          parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10) || 1
        );
        const realTotalParsed = parseInt(response.headers.get("X-WP-Total") ?? "", 10);
        const realTotal = Number.isFinite(realTotalParsed) ? realTotalParsed : -1;
        const items = raw.map((p) => ({
          id: p.id,
          title: stripTags$1(p.title?.rendered || `#${p.id}`),
          editUrl: `${cfg.editPostUrlBase}?post=${p.id}&action=edit`
        }));
        const entry = {
          items,
          totalPages,
          realTotal,
          fetchedAt: performance.now()
        };
        postsCache.set(cacheKey2, entry);
        applyPostsResult(entry, myFocusId);
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
            fontSize: 16,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: "600"
          },
          resolution: CHIP_TEXT_RES2
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
      const postsWin = wm && typeof wm.getById === "function" ? wm.getById("desktop-mode-posts") : void 0;
      if (postsWin && typeof postsWin.isFullscreen === "function" && typeof postsWin.toggleFullscreen === "function" && postsWin.isFullscreen()) {
        postsWin.toggleFullscreen();
      }
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
    function fitToView(opts = {}) {
      const padding = opts.padding ?? 90;
      const animate = opts.animate ?? false;
      const r = stage.getBoundingClientRect();
      if (nodes.size === 0 || r.width === 0 || r.height === 0) {
        const cx2 = r.width / 2;
        const cy2 = r.height / 2;
        targetScale = 1;
        targetWorldX = cx2;
        targetWorldY = cy2;
        if (!animate) {
          world.x = cx2;
          world.y = cy2;
          world.scale.set(1);
        }
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
      const newWorldX = r.width / 2 - cx * scale;
      const newWorldY = r.height / 2 - cy * scale;
      targetScale = scale;
      targetWorldX = newWorldX;
      targetWorldY = newWorldY;
      if (!animate) {
        world.scale.set(scale);
        world.x = newWorldX;
        world.y = newWorldY;
      }
    }
    function recenterCamera() {
      if (focusId !== null) {
        const focused = nodes.get(focusId);
        const r = stage.getBoundingClientRect();
        if (focused && r.width > 0 && r.height > 0) {
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
          return;
        }
      }
      fitToView({ animate: true });
    }
    recenterBtn.addEventListener("click", () => recenterCamera());
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
          fitToView({ animate: true });
        }
      } catch {
      }
    }
    buildTree();
    paintSidebar();
    preSettlePhysics(80);
    raf = requestAnimationFrame(tick);
    void refreshCountsViaBulk();
    return () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
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
    const init = {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": cfg.restNonce,
        Accept: "application/json"
      }
    };
    const response = await trackedFetch(url, init, {
      windowId: "desktop-mode-posts"
    });
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
    world.addChild(postEdgeLayer);
    world.addChild(chipLayer);
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
      const SENSITIVITY = 8e-4;
      const factor = Math.exp(-e.deltaY * SENSITIVITY);
      const prev = targetScale;
      const next = Math.max(0.3, Math.min(2.5, prev * factor));
      if (Math.abs(next - prev) < 5e-4) {
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
    let settledW = 0;
    let settledH = 0;
    const SETTLE_THRESHOLD_PX = 24;
    const SETTLE_DEBOUNCE_MS = 80;
    let settleTimer = null;
    function onResize() {
      const r = stage.getBoundingClientRect();
      app.renderer.resize(r.width, r.height);
      app.stage.hitArea = new pixi.Rectangle(0, 0, r.width, r.height);
      if (!firstFitDone && r.width > 0 && r.height > 0) {
        firstFitDone = true;
        settledW = r.width;
        settledH = r.height;
        fitToView();
        stage.classList.remove("is-loading");
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const cur = stage.getBoundingClientRect();
        const dw = Math.abs(cur.width - settledW);
        const dh = Math.abs(cur.height - settledH);
        if (dw >= SETTLE_THRESHOLD_PX || dh >= SETTLE_THRESHOLD_PX) {
          settledW = cur.width;
          settledH = cur.height;
          recenterCamera();
        }
      }, SETTLE_DEBOUNCE_MS);
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
        closeFocus();
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
    const POSTS_CACHE_TTL_MS = 6e4;
    const postsCache = /* @__PURE__ */ new Map();
    function applyPostsResult(entry, focusedTagId) {
      focusTotalPages = entry.totalPages;
      if (Number.isFinite(entry.realTotal)) {
        const box = tags.get(focusedTagId);
        if (box && box.count !== entry.realTotal) {
          box.count = entry.realTotal;
          terms = terms.map(
            (t) => t.id === box.id ? { ...t, count: entry.realTotal } : t
          );
          layoutChip(box);
        }
      }
      renderPosts(entry.items);
    }
    async function loadPostsForFocus() {
      if (focusId === null) {
        return;
      }
      const mySeq = ++loadSeq;
      const myFocusId = focusId;
      const cacheKey2 = `${focusId}:${focusPage}`;
      const cached = postsCache.get(cacheKey2);
      if (cached && performance.now() - cached.fetchedAt < POSTS_CACHE_TTL_MS) {
        applyPostsResult(cached, myFocusId);
        return;
      }
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
        const raw = response.json ?? [];
        const totalPages = Math.max(
          1,
          parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10) || 1
        );
        const realTotalParsed = parseInt(response.headers.get("X-WP-Total") ?? "", 10);
        const realTotal = Number.isFinite(realTotalParsed) ? realTotalParsed : -1;
        const items = raw.map((p) => ({
          id: p.id,
          title: stripTags(p.title?.rendered || `#${p.id}`),
          editUrl: `${cfg.editPostUrlBase}?post=${p.id}&action=edit`
        }));
        const entry = {
          items,
          totalPages,
          realTotal,
          fetchedAt: performance.now()
        };
        postsCache.set(cacheKey2, entry);
        applyPostsResult(entry, myFocusId);
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
      const postsWin = wm && typeof wm.getById === "function" ? wm.getById("desktop-mode-posts") : void 0;
      if (postsWin && typeof postsWin.isFullscreen === "function" && typeof postsWin.toggleFullscreen === "function" && postsWin.isFullscreen()) {
        postsWin.toggleFullscreen();
      }
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
    function fitToView(opts = {}) {
      const padding = opts.padding ?? 90;
      const animate = opts.animate ?? false;
      const r = stage.getBoundingClientRect();
      if (tags.size === 0 || r.width === 0 || r.height === 0) {
        const cx2 = r.width / 2;
        const cy2 = r.height / 2;
        targetScale = 1;
        targetWorldX = cx2;
        targetWorldY = cy2;
        if (!animate) {
          world.x = cx2;
          world.y = cy2;
          world.scale.set(1);
        }
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
      const newWorldX = r.width / 2 - cx * scale;
      const newWorldY = r.height / 2 - cy * scale;
      targetScale = scale;
      targetWorldX = newWorldX;
      targetWorldY = newWorldY;
      if (!animate) {
        world.scale.set(scale);
        world.x = newWorldX;
        world.y = newWorldY;
      }
    }
    function recenterCamera() {
      if (focusId !== null) {
        const focused = tags.get(focusId);
        const r = stage.getBoundingClientRect();
        if (focused && r.width > 0 && r.height > 0) {
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
          return;
        }
      }
      fitToView({ animate: true });
    }
    recenterBtn.addEventListener("click", () => recenterCamera());
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
      fitToView({ animate: true });
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
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
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
    const init = {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": cfg.restNonce,
        Accept: "application/json"
      }
    };
    const response = await trackedFetch(url, init, {
      windowId: "desktop-mode-posts"
    });
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
  function shellFetch(input, init, options) {
    return trackedFetch(input, init, {
      windowId: getActiveWindowId(),
      source: options?.source ?? "users-window/rest",
      silent: options?.silent
    });
  }
  async function fetchUsers(params) {
    const cfg = getConfig();
    const url = new URL(cfg.postsUrl);
    for (const [key, value] of Object.entries(cfg.queryArgs ?? {})) {
      if (typeof value === "string" && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set("page", String(Math.max(1, params.page)));
    url.searchParams.set("per_page", String(Math.max(1, params.perPage)));
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    if (params.roles && params.roles.length > 0) {
      for (const r of params.roles) {
        url.searchParams.append("roles", r);
      }
    }
    if (params.orderby) {
      url.searchParams.set("orderby", params.orderby);
    }
    if (params.order) {
      url.searchParams.set("order", params.order);
    }
    const init = {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-WP-Nonce": cfg.restNonce
      }
    };
    const res = await shellFetch(url.toString(), init, {
      source: "users-window/list"
    });
    if (!res.ok) {
      throw new Error(`[users-window] list fetch failed: ${res.status}`);
    }
    const items = await res.json();
    const total = parseInt(res.headers.get("X-WP-Total") ?? "0", 10);
    const totalPages = parseInt(
      res.headers.get("X-WP-TotalPages") ?? "0",
      10
    );
    return { items, total, totalPages };
  }
  async function bulkSetRole(ids, role) {
    const cfg = getConfig();
    const url = cfg.bulkRoleUrl ?? `${cfg.restRoot}desktop-mode/v1/users/bulk-role`;
    const res = await shellFetch(
      url,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": cfg.restNonce
        },
        body: JSON.stringify({ ids, role })
      },
      { source: "users-window/bulk-role" }
    );
    if (!res.ok) {
      throw new Error(`[users-window] bulk-role failed: ${res.status}`);
    }
    return await res.json();
  }
  async function sendPasswordReset(id) {
    const cfg = getConfig();
    const base = cfg.sendResetUrlBase ?? `${cfg.restRoot}desktop-mode/v1/users/`;
    const res = await shellFetch(
      `${base}${id}/send-password-reset`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": cfg.restNonce
        }
      },
      { source: "users-window/send-password-reset" }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: typeof body.code === "string" ? body.code : `http_${res.status}`
      };
    }
    const data = await res.json();
    return { ok: data.ok === true, email: data.email };
  }
  async function resendWelcome(id) {
    const cfg = getConfig();
    const base = cfg.sendResetUrlBase ?? `${cfg.restRoot}desktop-mode/v1/users/`;
    const res = await shellFetch(
      `${base}${id}/resend-welcome`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": cfg.restNonce
        }
      },
      { source: "users-window/resend-welcome" }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: typeof body.code === "string" ? body.code : `http_${res.status}`
      };
    }
    const data = await res.json();
    return { ok: data.ok === true, email: data.email };
  }
  async function createUser(body) {
    const cfg = getConfig();
    const url = cfg.createUserUrl ?? `${cfg.restRoot}desktop-mode/v1/users`;
    const res = await shellFetch(
      url,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": cfg.restNonce
        },
        body: JSON.stringify(body)
      },
      { source: "users-window/create" }
    );
    if (!res.ok) {
      const data2 = await res.json().catch(() => ({}));
      const code = data2.code;
      const message = data2.message;
      return {
        ok: false,
        error: typeof code === "string" ? code : `http_${res.status}`,
        message: typeof message === "string" ? message : void 0
      };
    }
    const data = await res.json();
    return {
      ok: data.ok === true,
      user_id: data.user_id,
      email: data.email
    };
  }
  async function showUsersIntroDialog() {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "desktop-mode-users-intro__backdrop";
      backdrop.setAttribute("role", "presentation");
      Object.assign(backdrop.style, {
        position: "fixed",
        inset: "0",
        background: "color-mix(in srgb, var(--wp-admin-theme-color, #1d2327) 60%, transparent)",
        backdropFilter: "blur(2px)",
        zIndex: "100000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px"
      });
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute(
        "aria-labelledby",
        "desktop-mode-users-intro-title"
      );
      dialog.className = "desktop-mode-users-intro";
      Object.assign(dialog.style, {
        background: "var(--wp-admin-theme-bg, #fff)",
        color: "var(--wp-admin-theme-fg, #1d2327)",
        borderRadius: "14px",
        boxShadow: "0 24px 60px rgba(0,0,0,.28)",
        maxWidth: "520px",
        width: "100%",
        maxHeight: "90vh",
        overflow: "auto",
        padding: "28px 32px 24px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      });
      dialog.innerHTML = renderDialogMarkup();
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      const primaryBtn = dialog.querySelector(
        '[data-action="confirm"]'
      );
      const settingsBtn = dialog.querySelector(
        '[data-action="settings"]'
      );
      primaryBtn?.focus();
      let resolved = false;
      const cleanup = (result) => {
        if (resolved) {
          return;
        }
        resolved = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup("cancel");
        }
      };
      document.addEventListener("keydown", onKey, true);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          cleanup("cancel");
        }
      });
      primaryBtn?.addEventListener("click", () => cleanup("confirm"));
      settingsBtn?.addEventListener("click", () => cleanup("settings"));
    });
  }
  function renderDialogMarkup() {
    const title = __("Welcome to the new Users window");
    const lede = __(
      "Same data you already manage, with the polish the Users list has been waiting for."
    );
    const highlights = [
      __("Live online indicator on every row — see who is around right now."),
      __("Last-login column so you finally know who is actually using the site."),
      __("Bulk role change with strict role-permission enforcement — never accidentally promote anyone above your own level."),
      __("One-click password reset and resend-welcome buttons, with sensible rate-limiting."),
      __("Click-to-copy email and a long-overdue search that matches name, username, AND email."),
      __("Per-user content stats: posts, pages, comments at a glance.")
    ];
    const li = (arr) => arr.map(
      (s) => `<li><span class="dot" aria-hidden="true"></span>${escapeHtml(s)}</li>`
    ).join("");
    return `
		<style>
			.desktop-mode-users-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.desktop-mode-users-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-users-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-users-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.desktop-mode-users-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.desktop-mode-users-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.desktop-mode-users-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.desktop-mode-users-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.desktop-mode-users-intro__footer button:hover { filter: brightness(1.05); }
			.desktop-mode-users-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="desktop-mode-users-intro-title">${escapeHtml(title)}</h2>
		<p class="lede">${escapeHtml(lede)}</p>
		<ul class="desktop-mode-users-intro__list">${li(highlights)}</ul>
		<div class="desktop-mode-users-intro__footer">
			<button type="button" data-action="settings">${escapeHtml(
      __("Take me to settings")
    )}</button>
			<button type="button" class="primary" data-action="confirm">${escapeHtml(
      __("Got it")
    )}</button>
		</div>
	`;
  }
  function escapeHtml(s) {
    const t = document.createElement("div");
    t.textContent = s;
    return t.innerHTML;
  }
  const _initial = {
    userId: null,
    requestedAt: 0,
    tabRequested: false
  };
  let _store = null;
  function getStore() {
    if (_store) {
      return _store;
    }
    const w = window;
    const factory = w.wp?.desktop?.createSharedStore;
    if (typeof factory !== "function") {
      return null;
    }
    _store = factory(
      "desktop-mode/user-edit/target",
      () => ({ ..._initial })
    );
    return _store;
  }
  function setUserEditTarget(userId) {
    const store = getStore();
    if (store) {
      store.state.userId = userId;
      store.state.requestedAt = Date.now();
      store.state.tabRequested = true;
      store.notify();
      return;
    }
    const w = window;
    w._wpdUserEditTarget = {
      userId,
      requestedAt: Date.now(),
      tabRequested: true
    };
  }
  function readUserEditTarget() {
    const store = getStore();
    if (store) {
      return { ...store.state };
    }
    const w = window;
    return w._wpdUserEditTarget ?? { ..._initial };
  }
  function clearUserEditTarget() {
    const store = getStore();
    if (store) {
      store.state.userId = null;
      store.state.requestedAt = 0;
      store.state.tabRequested = false;
      store.notify();
    }
    const w = window;
    if (w._wpdUserEditTarget) {
      w._wpdUserEditTarget = {
        userId: null,
        requestedAt: 0,
        tabRequested: false
      };
    }
  }
  function setUserEditTabRequested(requested) {
    const store = getStore();
    if (store) {
      store.state.tabRequested = requested;
      store.notify();
      return;
    }
    const w = window;
    const prev = w._wpdUserEditTarget ?? { ..._initial };
    w._wpdUserEditTarget = { ...prev, tabRequested: requested };
  }
  function subscribeUserEditTarget(cb) {
    const store = getStore();
    if (!store) {
      return () => {
      };
    }
    return store.subscribe((state) => cb({ ...state }));
  }
  const userEditTarget = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    clearUserEditTarget,
    readUserEditTarget,
    setUserEditTabRequested,
    setUserEditTarget,
    subscribeUserEditTarget
  }, Symbol.toStringTag, { value: "Module" }));
  function wpdConfirmGlobal(options) {
    const w = window;
    const fn = w.wp?.desktop?.confirm;
    if (typeof fn !== "function") {
      return Promise.resolve(window.confirm(options.message));
    }
    return fn(options);
  }
  function notifyToast(body, opts = {}) {
    const w = window;
    const api = w.wp?.desktop;
    if (api?.notify) {
      api.notify({ body, kind: opts.kind });
      return;
    }
    console.info("[users-window]", body);
  }
  function openUserEditWindow(userId) {
    if (!Number.isFinite(userId) || userId <= 0) {
      return;
    }
    setUserEditTarget(userId);
    console.info(
      "[users-window] opening user-edit window for user",
      userId
    );
    const w = window;
    const fn = w.wp?.desktop?.openWindow;
    if (typeof fn !== "function") {
      console.error(
        "[users-window] wp.desktop.openWindow is missing — desktop shell may not be ready."
      );
      notifyToast(
        __("Could not open profile window — desktop shell unavailable."),
        { kind: "error" }
      );
      return;
    }
    const opened = fn("desktop-mode-user-edit", {
      source: "users-window/row-click"
    });
    if (!opened) {
      console.error(
        '[users-window] openWindow("desktop-mode-user-edit") returned false — window not registered server-side. Check includes/user-edit-window/window.php.'
      );
      notifyToast(
        __("Profile window not registered — see console."),
        { kind: "error" }
      );
    }
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
  const BULK_ACTIONS_HOST = "[data-desktop-mode-posts-bulk-actions]";
  const SEARCH_DEBOUNCE_MS = 250;
  function userCellKey(id, key) {
    return `${id}::${key}`;
  }
  function memoUserCell(cache, id, key, build) {
    const k = userCellKey(id, key);
    const cached = cache.get(k);
    if (cached) {
      return cached;
    }
    const node = build();
    cache.set(k, node);
    return node;
  }
  const _usersIntroShown = { v: false };
  function maybeShowUsersIntro() {
    if (_usersIntroShown.v) {
      return;
    }
    let cfg;
    try {
      cfg = getConfig();
    } catch {
      return;
    }
    if (cfg.introSeen) {
      return;
    }
    _usersIntroShown.v = true;
    void showUsersIntroDialog().then((result) => {
      if (result === "cancel") {
        _usersIntroShown.v = false;
        return;
      }
      void markUsersIntroSeen(cfg);
      if (result === "settings") {
        const w = window;
        w.wp?.desktop?.openOsSettings?.();
      }
    }).catch(() => {
      _usersIntroShown.v = false;
    });
  }
  async function markUsersIntroSeen(cfg) {
    if (!cfg.introUrl) {
      return;
    }
    try {
      await trackedFetch(
        cfg.introUrl,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": cfg.restNonce
          },
          body: JSON.stringify({ slug: "users" })
        },
        {
          windowId: getActiveWindowId(),
          source: "users-window/intro"
        }
      );
      cfg.introSeen = true;
    } catch {
    }
  }
  function buildIdentityCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "display:flex;align-items:center;gap:10px;min-width:0;";
    const avatar = document.createElement("img");
    const avatars = row.avatar_urls ?? {};
    avatar.src = avatars["48"] ?? avatars["96"] ?? avatars["24"] ?? "";
    avatar.alt = "";
    avatar.loading = "eager";
    avatar.decoding = "sync";
    avatar.style.cssText = "width:32px;height:32px;border-radius:50%;flex-shrink:0;";
    cell.appendChild(avatar);
    const presence = row.desktop_mode_presence ?? "offline";
    const dot = document.createElement("span");
    let presenceLabel = __("Offline");
    let presenceColor = "#8c8f94";
    if (presence === "online") {
      presenceLabel = __("Online now");
      presenceColor = "#1d6f42";
    } else if (presence === "inactive") {
      presenceLabel = __("Idle");
      presenceColor = "#d4a017";
    }
    dot.title = presenceLabel;
    dot.setAttribute("aria-label", presenceLabel);
    dot.style.cssText = [
      "display:inline-block",
      "width:8px",
      "height:8px",
      "border-radius:50%",
      "flex-shrink:0",
      `background:${presenceColor}`
    ].join(";");
    cell.appendChild(dot);
    const text = document.createElement("span");
    text.style.cssText = "display:flex;flex-direction:column;min-width:0;line-height:1.25;";
    const nameRow = document.createElement("span");
    const name = document.createElement("a");
    const cfg = getConfig();
    name.href = `${cfg.editPostUrlBase}?user_id=${row.id}`;
    name.textContent = row.name || `#${row.id}`;
    name.title = name.textContent;
    name.setAttribute("data-noclick", "");
    name.style.cssText = "font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;";
    name.addEventListener("mouseenter", () => {
      name.style.textDecoration = "underline";
    });
    name.addEventListener("mouseleave", () => {
      name.style.textDecoration = "none";
    });
    name.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openUserEditWindow(row.id);
    });
    nameRow.appendChild(name);
    text.appendChild(nameRow);
    if (row.slug) {
      const sub = document.createElement("span");
      sub.textContent = `@${row.slug}`;
      sub.style.cssText = "font-size:11px;color:var(--wp-admin-theme-fg-muted, #8c8f94);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;";
      text.appendChild(sub);
    }
    cell.appendChild(text);
    return cell;
  }
  function buildEmailCell(row) {
    const cell = document.createElement("button");
    cell.type = "button";
    const email = typeof row.email === "string" ? row.email : "";
    cell.textContent = email || "—";
    cell.disabled = email === "";
    cell.title = email ? __("Click to copy email") : "";
    Object.assign(cell.style, {
      appearance: "none",
      background: "transparent",
      border: "none",
      padding: "2px 6px",
      font: "inherit",
      color: "inherit",
      cursor: email ? "copy" : "default",
      textAlign: "left",
      fontSize: "13px",
      borderRadius: "4px",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    });
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!email) {
        return;
      }
      void navigator.clipboard?.writeText(email).then(() => {
        const orig = cell.textContent;
        cell.textContent = __("Copied!");
        cell.style.color = "var(--wp-admin-theme-color, #2271b1)";
        setTimeout(() => {
          cell.textContent = orig;
          cell.style.color = "";
        }, 1200);
      }).catch(() => {
      });
    });
    return cell;
  }
  function buildRoleCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "display:inline-flex;flex-wrap:wrap;gap:4px;min-width:0;";
    const roles = Array.isArray(row.roles) ? row.roles : [];
    let labels = {};
    try {
      labels = getConfig().allRoles ?? {};
    } catch {
      labels = {};
    }
    if (roles.length === 0) {
      const none = document.createElement("span");
      none.textContent = __("No role");
      none.style.cssText = "color:var(--wp-admin-theme-fg-muted, #8c8f94);font-style:italic;";
      cell.appendChild(none);
      return cell;
    }
    for (const slug of roles) {
      const chip = document.createElement("span");
      chip.textContent = labels[slug] ?? slug;
      chip.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "padding:2px 8px",
        "border-radius:10px",
        "font-size:11px",
        "font-weight:600",
        "background:rgba(34,113,177,0.10)",
        "color:#0a4b78",
        "white-space:nowrap"
      ].join(";");
      cell.appendChild(chip);
    }
    return cell;
  }
  function buildStatsCell(row) {
    const stats = row.desktop_mode_user_stats ?? {
      posts: 0,
      pages: 0,
      comments: 0
    };
    const cell = document.createElement("span");
    cell.style.cssText = "display:inline-flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;";
    const mk = (dashicon, count, label) => {
      const span = document.createElement("span");
      span.style.cssText = "display:inline-flex;align-items:center;gap:3px;";
      span.title = label;
      const ic = document.createElement("wpd-icon");
      ic.setAttribute("name", dashicon);
      ic.setAttribute("size", "14");
      ic.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      span.appendChild(ic);
      const txt = document.createElement("span");
      txt.textContent = String(count);
      if (count === 0) {
        txt.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      }
      span.appendChild(txt);
      return span;
    };
    cell.appendChild(mk("admin-post", stats.posts, __("Posts")));
    cell.appendChild(mk("admin-page", stats.pages, __("Pages")));
    cell.appendChild(
      mk("admin-comments", stats.comments, __("Comments"))
    );
    return cell;
  }
  function relativeTime(ts) {
    const now = Math.floor(Date.now() / 1e3);
    const delta = now - ts;
    if (delta < 60) {
      return __("just now");
    }
    if (delta < 3600) {
      const m = Math.floor(delta / 60);
      return sprintf(__("%d min ago"), m);
    }
    if (delta < 86400) {
      const h = Math.floor(delta / 3600);
      return sprintf(__("%d h ago"), h);
    }
    if (delta < 86400 * 30) {
      const d = Math.floor(delta / 86400);
      return sprintf(__("%d d ago"), d);
    }
    if (delta < 86400 * 365) {
      const mo = Math.floor(delta / (86400 * 30));
      return sprintf(__("%d mo ago"), mo);
    }
    const y = Math.floor(delta / (86400 * 365));
    return sprintf(__("%d y ago"), y);
  }
  function buildLastLoginCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "font-size:13px;font-variant-numeric:tabular-nums;";
    const ts = row.desktop_mode_last_login;
    if (!ts || typeof ts !== "number") {
      cell.textContent = __("Never");
      cell.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      return cell;
    }
    cell.textContent = relativeTime(ts);
    const dt = new Date(ts * 1e3);
    cell.title = dt.toLocaleString();
    return cell;
  }
  function buildRegisteredCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "font-size:13px;font-variant-numeric:tabular-nums;";
    const raw = typeof row.registered_date === "string" ? row.registered_date : "";
    if (!raw) {
      cell.textContent = "—";
      cell.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      return cell;
    }
    const ts = Math.floor(Date.parse(raw + "Z") / 1e3);
    if (!Number.isFinite(ts)) {
      cell.textContent = raw;
      return cell;
    }
    cell.textContent = relativeTime(ts);
    cell.title = new Date(ts * 1e3).toLocaleString();
    return cell;
  }
  function buildActionsCell(row) {
    const cell = document.createElement("span");
    cell.style.cssText = "display:inline-flex;gap:4px;align-items:center;";
    let canEditViewer = false;
    try {
      canEditViewer = getConfig().canEdit === true;
    } catch {
      canEditViewer = false;
    }
    const canEditRow = row.desktop_mode_can_edit === true;
    if (!canEditViewer || !canEditRow) {
      cell.textContent = "—";
      cell.style.color = "var(--wp-admin-theme-fg-muted, #8c8f94)";
      return cell;
    }
    const mk = (label, dashicon, fn) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      Object.assign(btn.style, {
        appearance: "none",
        border: "1px solid var(--wp-admin-theme-border, #dcdcde)",
        background: "var(--wp-admin-theme-bg, #fff)",
        color: "inherit",
        padding: "4px 6px",
        borderRadius: "4px",
        cursor: "pointer",
        lineHeight: "1"
      });
      const ic = document.createElement("wpd-icon");
      ic.setAttribute("name", dashicon);
      ic.setAttribute("size", "14");
      btn.appendChild(ic);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return btn;
    };
    cell.appendChild(
      mk(
        __("Send password reset"),
        "email-alt",
        async () => {
          const ok = await wpdConfirmGlobal({
            title: __("Send password reset email?"),
            message: sprintf(
              // translators: %s is a user name.
              __("WordPress will email %s a password-reset link."),
              row.name
            ),
            confirmLabel: __("Send reset email")
          });
          if (!ok) {
            return;
          }
          const result = await sendPasswordReset(row.id);
          if (result.ok) {
            notifyToast(
              sprintf(
                // translators: %s is the user's email address.
                __("Reset email sent to %s."),
                result.email ?? row.email ?? ""
              ),
              { kind: "success" }
            );
          } else {
            notifyToast(
              sprintf(
                // translators: %s is an error code.
                __("Could not send reset email (%s)."),
                result.error ?? "unknown"
              ),
              { kind: "error" }
            );
          }
        }
      )
    );
    cell.appendChild(
      mk(
        __("Resend welcome email"),
        "megaphone",
        async () => {
          const ok = await wpdConfirmGlobal({
            title: __("Resend welcome email?"),
            message: sprintf(
              // translators: %s is a user name.
              __(
                "WordPress will resend the original welcome email to %s."
              ),
              row.name
            ),
            confirmLabel: __("Resend")
          });
          if (!ok) {
            return;
          }
          const result = await resendWelcome(row.id);
          if (result.ok) {
            notifyToast(
              sprintf(
                // translators: %s is the user's email address.
                __("Welcome email resent to %s."),
                result.email ?? row.email ?? ""
              ),
              { kind: "success" }
            );
          } else {
            notifyToast(
              sprintf(
                // translators: %s is an error code.
                __("Could not resend welcome (%s)."),
                result.error ?? "unknown"
              ),
              { kind: "error" }
            );
          }
        }
      )
    );
    return cell;
  }
  function buildColumns(cache) {
    const cols = [
      {
        key: "identity",
        label: __("Name"),
        sortable: false,
        sticky: true,
        minWidth: "260px",
        render: (_v, row) => memoUserCell(
          cache,
          row.id,
          "identity",
          () => buildIdentityCell(row)
        )
      },
      {
        key: "email",
        label: __("Email"),
        minWidth: "220px",
        render: (_v, row) => memoUserCell(cache, row.id, "email", () => buildEmailCell(row))
      },
      {
        key: "role",
        label: __("Role"),
        width: "180px",
        render: (_v, row) => memoUserCell(cache, row.id, "role", () => buildRoleCell(row))
      },
      {
        key: "stats",
        label: __("Content"),
        width: "160px",
        sortValue: (row) => {
          const s = row.desktop_mode_user_stats;
          return s ? s.posts + s.pages + s.comments : 0;
        },
        render: (_v, row) => memoUserCell(cache, row.id, "stats", () => buildStatsCell(row))
      },
      {
        key: "last_login",
        label: __("Last login"),
        width: "140px",
        sortable: false,
        sortValue: (row) => typeof row.desktop_mode_last_login === "number" ? row.desktop_mode_last_login : 0,
        render: (_v, row) => memoUserCell(
          cache,
          row.id,
          "last_login",
          () => buildLastLoginCell(row)
        )
      },
      {
        key: "registered",
        label: __("Registered"),
        width: "140px",
        sortable: true,
        render: (_v, row) => memoUserCell(
          cache,
          row.id,
          "registered",
          () => buildRegisteredCell(row)
        )
      }
    ];
    let canEdit = false;
    try {
      canEdit = getConfig().canEdit === true;
    } catch {
      canEdit = false;
    }
    if (canEdit) {
      cols.push({
        key: "actions",
        label: __("Actions"),
        width: "110px",
        sortable: false,
        render: (_v, row) => (
          // Actions cell is intentionally NOT memoized — its closure
          // captures `row` and the row payload changes between
          // fetches. Cheap to rebuild, fewer surprises.
          buildActionsCell(row)
        )
      });
    }
    return cols;
  }
  function defaultStatusSegments() {
    return [
      { value: "", label: __("All") },
      { value: "online", label: __("Online") },
      { value: "recent", label: __("Active 30d") },
      { value: "never", label: __("Never logged in") }
    ];
  }
  function applyClientStatusFilter(rows, status) {
    if (!status) {
      return rows;
    }
    if (status === "online") {
      return rows.filter((r) => r.desktop_mode_presence === "online");
    }
    if (status === "recent") {
      const now = Math.floor(Date.now() / 1e3);
      return rows.filter((r) => {
        const ts = r.desktop_mode_last_login;
        return typeof ts === "number" && ts > 0 && now - ts < 86400 * 30;
      });
    }
    if (status === "never") {
      return rows.filter(
        (r) => !r.desktop_mode_last_login || typeof r.desktop_mode_last_login !== "number"
      );
    }
    return rows;
  }
  async function renderUsersWindow(body) {
    const root = body.querySelector(ROOT);
    const table = body.querySelector(TABLE);
    if (!root || !table) {
      return;
    }
    table.addEventListener("wpd-table-row-click", (e) => {
      const detail = e.detail;
      const id = detail?.row?.id;
      if (typeof id !== "number" || id <= 0) {
        return;
      }
      void openUserEditWindow(id);
    });
    maybeShowUsersIntro();
    const cfg = getConfig();
    const view = {
      page: 1,
      perPage: Math.max(1, cfg.defaultPerPage || 20),
      search: "",
      status: "",
      orderby: "name",
      order: "asc",
      roles: [],
      searchDebounce: null
    };
    const cellCache = /* @__PURE__ */ new Map();
    table.columns = buildColumns(cellCache);
    table.getRowId = (row) => row.id;
    table.sort = { key: "name", direction: "asc" };
    if (!cfg.canEdit && !cfg.canPromote && !cfg.canDelete) {
      table.removeAttribute("selectable");
    }
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
    const statusHost = root.querySelector(STATUS);
    if (statusHost) {
      statusHost.replaceChildren();
      for (const seg of defaultStatusSegments()) {
        const el = document.createElement("wpd-segment");
        el.setAttribute("value", seg.value);
        el.textContent = seg.label;
        statusHost.appendChild(el);
      }
      statusHost.addEventListener("wpd-segmented-change", (e) => {
        const detail = e.detail;
        view.status = detail?.value ?? "";
        view.page = 1;
        void refresh();
      });
    }
    const searchEl = root.querySelector(SEARCH);
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        if (view.searchDebounce !== null) {
          clearTimeout(view.searchDebounce);
        }
        view.searchDebounce = window.setTimeout(() => {
          view.search = searchEl.value.trim();
          view.page = 1;
          void refresh();
        }, SEARCH_DEBOUNCE_MS);
      });
    }
    const refreshBtn = root.querySelector(REFRESH);
    refreshBtn?.addEventListener("click", () => {
      void refresh();
    });
    const newBtn = root.querySelector(NEW_BTN);
    if (newBtn) {
      if (!cfg.canCreate) {
        newBtn.style.display = "none";
      } else {
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          const tabs = body.querySelector(
            "[data-desktop-mode-users-tabs]"
          );
          if (!tabs) {
            return;
          }
          tabs.value = "add-new";
          tabs.setAttribute("value", "add-new");
        });
      }
    }
    perPageEl?.addEventListener("change", () => {
      const n = parseInt(perPageEl.value, 10);
      if (Number.isFinite(n) && n > 0) {
        view.perPage = n;
        view.page = 1;
        void refresh();
      }
    });
    const renderBulkBar = () => {
      if (!bulkBar || !bulkActionsHost) {
        return;
      }
      const sel = table.selection;
      const ids = sel ? Array.from(sel) : [];
      if (ids.length === 0) {
        bulkBar.hidden = true;
        return;
      }
      bulkBar.hidden = false;
      if (countEl) {
        countEl.textContent = sprintf(
          // translators: %d is a count of selected users.
          __("%d selected"),
          ids.length
        );
      }
      bulkActionsHost.replaceChildren();
      const assignable = cfg.assignableRoles ?? {};
      const assignableKeys = Object.keys(assignable);
      if (cfg.canPromote && assignableKeys.length > 0) {
        const wrap = document.createElement("span");
        wrap.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
        const roleDropdown = document.createElement("select");
        Object.assign(roleDropdown.style, {
          padding: "4px 8px",
          borderRadius: "4px",
          border: "1px solid var(--wp-admin-theme-border, #dcdcde)",
          background: "var(--wp-admin-theme-bg, #fff)",
          color: "inherit",
          font: "inherit",
          fontSize: "13px"
        });
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = __("Set role to…");
        roleDropdown.appendChild(placeholder);
        for (const slug of assignableKeys) {
          const opt = document.createElement("option");
          opt.value = slug;
          opt.textContent = assignable[slug];
          roleDropdown.appendChild(opt);
        }
        const apply = document.createElement("wpd-button");
        apply.setAttribute("variant", "primary");
        apply.textContent = __("Apply");
        apply.addEventListener("click", async (e) => {
          e.preventDefault();
          const role = roleDropdown.value;
          if (!role) {
            return;
          }
          const ok = await wpdConfirmGlobal({
            title: __("Change role for selected users?"),
            message: sprintf(
              // translators: %1$d is a user count, %2$s is a role label.
              __("Set %1$d user(s)' role to %2$s?"),
              ids.length,
              assignable[role]
            ),
            confirmLabel: __("Set role")
          });
          if (!ok) {
            return;
          }
          const out = await bulkSetRole(ids, role).catch((err) => {
            notifyToast(
              String(err.message ?? err),
              { kind: "error" }
            );
            return null;
          });
          if (!out) {
            return;
          }
          const successes = Object.values(out.results).filter(
            (r) => r.ok
          ).length;
          const failures = ids.length - successes;
          if (successes > 0) {
            notifyToast(
              sprintf(
                // translators: %1$d users updated, %2$d failed.
                __("Role updated for %1$d user(s) (%2$d skipped)."),
                successes,
                failures
              ),
              { kind: failures > 0 ? "info" : "success" }
            );
          } else {
            notifyToast(__("No users updated."), { kind: "error" });
          }
          void refresh();
        });
        wrap.appendChild(roleDropdown);
        wrap.appendChild(apply);
        bulkActionsHost.appendChild(wrap);
      }
    };
    table.addEventListener("wpd-table-selection-change", renderBulkBar);
    prevBtn?.addEventListener("click", () => {
      if (view.page > 1) {
        view.page -= 1;
        void refresh();
      }
    });
    nextBtn?.addEventListener("click", () => {
      if (view.page < totalPages) {
        view.page += 1;
        void refresh();
      }
    });
    const updatePager = () => {
      if (indicator) {
        indicator.textContent = sprintf(
          // translators: %1$d current page, %2$d total pages, %3$d total rows.
          __("Page %1$d of %2$d · %3$d users"),
          view.page,
          Math.max(1, totalPages),
          totalRows
        );
      }
      if (prevBtn) {
        prevBtn.disabled = view.page <= 1;
      }
      if (nextBtn) {
        nextBtn.disabled = view.page >= totalPages;
      }
    };
    const buildParams = () => {
      return {
        page: view.page,
        perPage: view.perPage,
        search: view.search || void 0,
        roles: view.roles.length > 0 ? view.roles : void 0,
        orderby: view.orderby,
        order: view.order
      };
    };
    const refresh = async () => {
      const mySeq = ++refreshSeq;
      table.toggleAttribute("loading", true);
      try {
        const result = await fetchUsers(buildParams());
        if (mySeq !== refreshSeq) {
          return;
        }
        if (result.items.length === 0 && view.page > 1 && result.totalPages > 0 && view.page > result.totalPages) {
          view.page = 1;
          await refresh();
          return;
        }
        cellCache.clear();
        const filtered = applyClientStatusFilter(result.items, view.status);
        table.data = filtered;
        totalRows = result.total;
        totalPages = result.totalPages;
        updatePager();
        renderBulkBar();
      } catch (err) {
        console.error("[users-window] fetch failed:", err);
        notifyToast(
          __("Could not load users. Try Refresh."),
          { kind: "error" }
        );
      } finally {
        table.toggleAttribute("loading", false);
      }
    };
    mountAddUserForm(body, {
      afterCreate: () => {
        const tabs = body.querySelector(
          "[data-desktop-mode-users-tabs]"
        );
        if (tabs) {
          tabs.value = "all";
          tabs.setAttribute("value", "all");
        }
        view.page = 1;
        void refresh();
      }
    });
    wireProfileSubTab(body);
    void refresh();
  }
  function wireProfileSubTab(body) {
    const profile = body.querySelector(
      "wpd-user-profile[data-wpd-user-profile-self]"
    );
    if (!profile) {
      return;
    }
    const cfg = getConfig();
    const viewerId = cfg.currentUserId;
    if (typeof viewerId === "number" && viewerId > 0) {
      profile.setAttribute("user-id", String(viewerId));
    }
  }
  function mountAddUserForm(body, opts) {
    const formNullable = body.querySelector(
      "[data-desktop-mode-users-add-form]"
    );
    if (!formNullable) {
      return;
    }
    const form = formNullable;
    const cfg = getConfig();
    const defaultRole = cfg.defaultRole ?? "subscriber";
    const assignableRoles = cfg.assignableRoles && Object.keys(cfg.assignableRoles).length > 0 ? cfg.assignableRoles : { [defaultRole]: defaultRole };
    mountSelect(form, "role", __("Role"), assignableRoles, defaultRole);
    mountSelect(
      form,
      "locale",
      __("Language"),
      cfg.locales ?? { "": __("Site default") },
      ""
    );
    const generateBtn = form.querySelector(
      '[data-action="generate-password"]'
    );
    generateBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pwd = generateStrongPassword(18);
      const pwdField = form.querySelector(
        'wpd-text-field[name="password"]'
      );
      if (pwdField) {
        pwdField.value = pwd;
        pwdField.setAttribute("value", pwd);
      }
      void navigator.clipboard?.writeText(pwd).catch(() => {
      });
      notifyToast(__("Generated password copied to clipboard."), {
        kind: "success"
      });
    });
    let pending = false;
    form.addEventListener("wpd-form-submit", (e) => {
      const detail = e.detail;
      void onSubmit(detail.values);
    });
    async function onSubmit(values) {
      if (pending) {
        return;
      }
      pending = true;
      form.setBusy(true);
      form.clearErrors();
      const payload = {
        username: String(values.username ?? "").trim(),
        email: String(values.email ?? "").trim(),
        first_name: optionalString(values.first_name),
        last_name: optionalString(values.last_name),
        url: optionalString(values.url),
        locale: String(values.locale ?? ""),
        password: optionalString(values.password),
        role: optionalString(values.role),
        send_notification: Boolean(values.send_notification)
      };
      const result = await createUser(payload);
      pending = false;
      form.setBusy(false);
      if (!result.ok) {
        handleCreateError(form, result.error, result.message, payload);
        return;
      }
      notifyToast(
        sprintf(
          // translators: %s is the user's email address.
          __("User created — welcome email sent to %s."),
          result.email ?? payload.email
        ),
        { kind: "success" }
      );
      opts.afterCreate();
    }
  }
  function mountSelect(form, name, _label, optionsMap, initialValue) {
    const select = form.querySelector(
      `wpd-select[name="${name}"]`
    );
    if (!select) {
      return;
    }
    const items = Object.entries(optionsMap).map(([value, label]) => ({
      value,
      label
    }));
    select.items = items;
    if (initialValue && optionsMap[initialValue] !== void 0) {
      select.value = initialValue;
      select.setAttribute("value", initialValue);
    }
  }
  function handleCreateError(form, code, message, payload) {
    let summary = message;
    if (!summary) {
      switch (code) {
        case "desktop_mode_users_username_exists":
        case "existing_user_login":
          summary = __("That username is already in use.");
          break;
        case "desktop_mode_users_email_exists":
        case "existing_user_email":
          summary = __("That email is already in use.");
          break;
        case "desktop_mode_users_username_invalid":
          summary = __("Username is not valid.");
          break;
        case "desktop_mode_users_email_invalid":
          summary = __("A valid email address is required.");
          break;
        case "desktop_mode_users_role_forbidden":
          summary = __("You are not allowed to assign that role.");
          break;
        default:
          summary = __("Could not create the user.");
      }
    }
    form.setError(summary);
    if (code === "desktop_mode_users_username_exists" || code === "existing_user_login" || code === "desktop_mode_users_username_invalid") {
      form.setFieldInvalid("username");
    }
    if (code === "desktop_mode_users_email_exists" || code === "existing_user_email" || code === "desktop_mode_users_email_invalid") {
      form.setFieldInvalid("email");
    }
    if (code === "desktop_mode_users_role_forbidden") {
      form.setFieldInvalid("role");
    }
    notifyToast(summary, { kind: "error" });
    console.warn("[users-window] create failed", { code, payload });
  }
  function optionalString(value) {
    if (typeof value !== "string") {
      return void 0;
    }
    const trimmed = value.trim();
    return trimmed === "" ? void 0 : trimmed;
  }
  function generateStrongPassword(length) {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%^&*-_=+";
    const all = upper + lower + digits + symbols;
    const buf = new Uint32Array(length);
    crypto.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += all[buf[i] % all.length];
    }
    return out;
  }
  const usersRender = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    renderUsersWindow
  }, Symbol.toStringTag, { value: "Module" }));
  exports.renderPostsWindow = renderPostsWindow;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
