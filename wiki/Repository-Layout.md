# Repository Layout

A tour of what's where in [github.com/WordPress/desktop-mode](https://github.com/WordPress/desktop-mode).

```
.
├── wp-desktop-mode.php    # bootstrap: header, constants, require_once of includes/
├── includes/              # PHP subsystems
│   ├── helpers.php              admin-bar.php       ajax.php
│   ├── assets.php               render.php          portal.php
│   ├── session.php              default-window.php  components.php
│   ├── os-settings.php          extended-options.php
│   ├── accents.php              wallpapers.php      toast-types.php
│   ├── menu.php                 media-query.php
│   └── ai-copilot/              # AI assistant (OpenAI client, analysis, search, jobs)
├── assets/                # compiled CSS + JS (Vite output; tracked in git)
│   ├── css/  desktop.css, windows.css, dock.css, chromeless.css, variables.css
│   └── js/   desktop.js, desktop.min.js, chromeless bridge, media-library enhancements
├── src/                   # TypeScript source — compiled by Vite
│   ├── desktop.ts / dock.ts / hooks.ts / commands.ts / palette-registry.ts
│   ├── ai-assistant.ts / drag-bridge.ts / toast.ts / desktop-icons.ts
│   ├── native-windows.ts / built-in-commands.ts / public-api.ts / types.ts
│   ├── window/          # Window class — DOM, pointer, tabs, iframe bridge
│   ├── window-manager/  # stack, desktops, arrange, snap, overview
│   ├── wallpapers/      # registry, layer, surfaces, server sync, vendor loader
│   ├── widgets/         # registry, layer, frame, picker, storage
│   ├── settings/        # OS Settings panel sections
│   ├── ui/              # <wpd-*> web components
│   ├── modules/         # vendor-script lazy-loader
│   └── plugins/         # built-in demos (animated-logo-wallpaper)
├── docs/                  # developer-facing docs (source of truth for plugin authors)
├── wiki/                  # staging mirror of the GitHub Wiki (this file lives there)
├── tests/                 # PHPUnit + Vitest
├── languages/             # .po / .mo (es shipped)
├── bin/                   # package-zip helpers
├── package.json           # devDeps (vite, typescript, vitest)
├── vite.config.js         # Vite lib-mode: src/desktop.ts → assets/js/desktop[.min].js (IIFE)
├── vitest.config.ts
└── tsconfig.json
```

For the deeper module map (what's in `src/public-api.ts`, how `window/` talks to `window-manager/`, etc.) see [DEVELOPMENT.md](https://github.com/WordPress/desktop-mode/blob/trunk/DEVELOPMENT.md).
