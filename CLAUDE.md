# wp-desktop-mode — local gotchas

Short file. Things I've forgotten or hand-waved before. If it's obvious from reading the code, don't add it here.

## ⛔ Source-of-truth rule: NEVER hand-edit JS in `assets/js/`

**`assets/js/*.js` is build output. Treat it as if it were `dist/`.**

Every shipped JS bundle has a TypeScript source under `src/`. The two
bundles today are:

| Built file | TS source | Built by |
|---|---|---|
| `assets/js/desktop[.min].js` | `src/desktop.ts` | `npm run build:desktop` |
| `assets/js/iframe-bridge[.min].js` | `src/iframe-bridge-standalone.ts` | `npm run build:iframe-bridge` |

`npm run build` runs both. Vite's `WPDM_TARGET` env var (`desktop` /
`iframe-bridge`) selects the entry — see `vite.config.js`.

Process:

1. Edit only TS files under `src/` (and CSS under `assets/css/` if
   styling — that's not built).
2. Run `npm run build` (or the per-target script).
3. Run `npm run lint` (or `:fix`) — must pass on EVERYTHING you touched.
4. Run `npm run test:js` — must stay green.
5. Run `./node_modules/.bin/tsc --noEmit` — must stay green.

If you ever find yourself reaching for `assets/js/*.js` directly, stop
and write the TS instead. Hand-edited JS is overwritten by the next
`npm run build` and produces no TS-checked types — silent class of bug.

**Lint scope:** `npm run lint` runs on `src/**/*.ts` only. Test files
under `tests/vitest/` aren't in the lint config (typescript-eslint
project doesn't include them); rely on `tsc --noEmit` + `vitest` to
catch issues there.

## Live-refresh on plugin install/activate — how it actually works

When the user installs or activates a plugin, the **chromeless bridge** inside the `plugins.php` iframe postMessages `wp-desktop-plugins-changed` to the parent shell with a **payload captured in real admin context** (plugins that gate `admin_menu` on `is_admin()` at load time register correctly there; a REST roundtrip from the shell cannot replicate that, so don't try).

Payload shape (`includes/render.php` builds it, `src/desktop.ts` consumes it):

```
{ dockItems, taskbarItems, nativeWindows, serverWidgets, serverWallpapers,
  serverCommandScripts, serverCommands,
  serverSettingsTabScripts, serverSettingsTabs,
  serverTitleBarButtonScripts,
  desktopIcons }
```

- **PHP-declared** things are in the payload: dock, taskbar, native windows, widgets, wallpapers. The shell diffs them and fires `registry.subscribe` listeners → UI repaints. No F5.
- For widgets and wallpapers, the pattern is: PHP payload carries metadata + `scriptUrl`; the `server-sync` module (`src/{widgets,wallpapers}/server-sync.ts`) dynamically loads the plugin's JS, which then publishes a full def on a global (`window.wpDesktopWallpapers[id]` / `window.wpDesktopWidgets[id]`). The sync reads the def and registers it.
- **Commands use the same pattern since 0.15.0** via `wp_desktop_register_command_script( $handle )` (primary, minimum-ceremony) or `wp_register_desktop_command( $args )` (optional, declares metadata server-side). Sync module: `src/commands/server-sync.ts`. Live unregistration on deactivation works for commands that either (a) declare `script` in PHP metadata, or (b) set `owner` on their JS `registerCommand` call. Plugins that do neither still require F5 on deactivate — graceful backwards-compat.
- **OS Settings tabs use the same pattern since 0.17.0** via `wp_desktop_register_settings_tab_script( $handle )` (primary) or `wp_register_desktop_settings_tab( $args )` (optional — id/label/capability/order/script). Sync module: `src/settings/server-sync.ts`; registry: `src/settings/registry.ts`; built-in tabs (appearance=10, ai=20, extended=30, help=40) are interleaved with the registry in `src/settings/index.ts` `renderPanel()` and re-painted live via `subscribeSettingsTabs`. Same (a)/(b) live-unregister rules as commands.
- **AI Copilot extensibility (since 0.17.0)** lives on a different axis from the live-refresh payloads — it's all per-request wiring inside `/ai/search` (`includes/ai-copilot/search.php`) plus a persistent server-tool registry in `includes/ai-copilot/tools-registry.php`. Two distinct registration surfaces: `wp_register_desktop_ai_tool( $args )` for PHP-dispatched tools (handler runs server-side, capability-gated, never visible to users who lack the cap), and client-side `registerCommand({ aiCallable: true })` for JS-dispatched slash-commands the AI can pick via `/ai/search`'s `command_tools` param. The full filter/action surface is `wp_desktop_ai_{system_prompt,system_prompt_appendix,system_prompt_replace_capability,request,tools,command_tools,command_allowed,tool_result,answer}` + observability actions `wp_desktop_ai_{search_started,tool_called,search_completed,search_error,tool_registered}` — every call carries a shared `request_id` UUID for trace correlation. `wp.desktop.ai.ask()` (`src/ai/ask.ts`) is the client-side programmatic entry point; it harvests `aiCallable: true` commands into `command_tools` and handles the server's `answer_type: 'tool_call'` short-circuit by running `run()` locally. The command's `run` function always lives JS-side — the server only emits a slug+args intent; the client invokes.
- **Palettes** (`registerPalette`) are the remaining JS-registered-only gap. No server-side opt-in yet; a new plugin's palette won't appear until F5. Same fix shape as commands if/when needed: `wp_desktop_register_palette_script( $handle )` + payload key + clone the sync module.

**When fixing this kind of "why doesn't X update live?" gap**, match the existing pattern: add server-side registration API (`wp_register_desktop_*`), extend the payload with a `server*` array including `scriptUrl`, add a `src/*/server-sync.ts` module modeled on the wallpaper one, wire it into `applyPayload()` in `desktop.ts`. Don't invent a different mechanism.

## Chromeless admin-bar suppression

`is_admin_bar_showing()` short-circuits to `true` in admin context — the `show_admin_bar` filter alone is NOT sufficient inside chromeless iframes. We pair it with `remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 )` on `admin_init`, AND a CSS rule killing the reserved 32px. Do not remove either half.

## Process reminders to self

- **Read before speculating.** When asked how a mechanism works (refresh flow, hook order, bridge protocol), grep the code first. Hand-waving gets caught.
- **Don't implement architectural changes unilaterally.** PHP API additions, payload shape changes, and new registry-sync modules are all load-bearing for plugin authors. Propose, get the green light, then code.

## Developer docs — read before, update after

`docs/` is the public contract with third-party plugin authors. Two rules, no exceptions:

1. **Before any task that touches a documented surface, read the relevant doc first.** It's the ground truth for what plugins depend on — reading it tells you whether a change is a bug fix, a backwards-compatible extension, or a breaking change that needs a different approach.
2. **Update the relevant doc in the same change.** A hook change without a doc update ships a lie. A new example code path without an example entry is invisible to the people who need it.

### Doc tree — what lives where

```
docs/
├── README.md                   Index + status legend (Stable / Experimental / Planned).
│                               UPDATE WHEN: adding a new top-level doc, changing status labels.
│                               READ BEFORE: getting oriented for any doc change.
│
├── getting-started.md          5-minute quickstart: dock icon + native window.
│                               UPDATE WHEN: the minimum viable plugin skeleton changes,
│                                            or the bootstrap hook names / timings change.
│                               READ BEFORE: onboarding-related changes, first-run flows.
│
├── architecture.md             High-level design: shell vs iframe, bridge, lifecycle.
│                               UPDATE WHEN: a new rendering path, persistence layer, REST
│                                            route, or payload shape lands; build tooling shifts.
│                               READ BEFORE: changes to render.php, desktop.ts bootstrap,
│                                            bridge, session, or payload plumbing.
│
├── hooks-reference.md          Every PHP action + filter, with Stable/Experimental/Planned
│                               status + signatures + examples.
│                               UPDATE WHEN: adding/renaming/removing any apply_filters() or
│                                            do_action(), or changing a signature/default,
│                                            or changing a hook's status label.
│                               READ BEFORE: any PHP hook work — this is the contract.
│
├── javascript-reference.md     CustomEvents, window.wp.desktop API, postMessage bridge.
│                               UPDATE WHEN: adding/changing a CustomEvent detail shape, a
│                                            postMessage bridge message, any wp.desktop.*
│                                            method/property, user meta keys, query flags.
│                               READ BEFORE: any shell-JS or bridge change.
│
├── bridge-protocol.md          End-to-end wiring of the connection bridge — postMessage
│                               types, lifecycle walkthrough, sniff points for debugging.
│                               UPDATE WHEN: bridge protocol message catalog changes,
│                                            new lifecycle steps, new internal sniff points.
│                               READ BEFORE: changes to src/connection/, src/window/iframe-bridge.ts,
│                                            assets/js/iframe-bridge.js, the chromeless inline
│                                            bridge in includes/render.php, or
│                                            src/native-windows.ts buildIframeContentRender.
│
├── native-windows-proposal.md  Contract for native windows + framework interop.
│                               UPDATE WHEN: the native-window API, tab system, or framework
│                                            integration story changes.
│                               READ BEFORE: changes under src/native-windows/ or
│                                            wp_register_desktop_window* / window-tab APIs.
│
└── examples/                   Copy-paste recipes — ONE per surface.
    ├── README.md               Index of examples.
    ├── arrange-action.md       UPDATE/READ WHEN: window-arrange behavior or hook changes.
    ├── chromeless-style-override.md
    │                            UPDATE/READ WHEN: chromeless.css contract or wp_desktop_chromeless_*
    │                            hooks change.
    ├── dock-badge.md           UPDATE/READ WHEN: dock item shape / badge rendering changes.
    ├── gate-by-role.md         UPDATE/READ WHEN: wp_desktop_mode_enabled semantics change.
    ├── inject-shell-config.md  UPDATE/READ WHEN: wp_desktop_shell_config keys change.
    ├── layout-primitives.md    UPDATE/READ WHEN: <wpd-*> component kit contract changes.
    ├── native-windows.md       UPDATE/READ WHEN: wp_register_desktop_window() contract changes.
    ├── native-window-with-tabs.md
    │                            UPDATE/READ WHEN: wp_register_desktop_window_tab() changes.
    ├── react-to-window-events.md
    │                            UPDATE/READ WHEN: window-lifecycle CustomEvent shape changes.
    ├── register-command.md     UPDATE/READ WHEN: command registry API (JS or PHP) changes.
    ├── register-ai-provider.md  UPDATE/READ WHEN: wp_register_desktop_ai_provider() contract,
    │                            provider callback shapes, or active-provider resolution rules change.
    ├── ai-ask.md                UPDATE/READ WHEN: wp.desktop.ai.ask() contract, AI-tool-calling
    │                            protocol, or wp_register_desktop_ai_tool() signature changes.
    ├── connect-to-window.md     UPDATE/READ WHEN: registerTitleBarButton, Window.setHighlight,
    │                            wp.desktop.connect, or wp.desktop.iframe.* contract changes;
    │                            wp-desktop-bridge-* postMessage protocol changes.
    ├── register-icon.md        UPDATE/READ WHEN: wp_register_desktop_icon() contract changes.
    ├── register-wallpaper.md   UPDATE/READ WHEN: WallpaperDef or wp_register_desktop_wallpaper() changes.
    └── window-lifecycle.md     UPDATE/READ WHEN: window state machine / lifecycle hooks change.
```

**Rules of thumb:**
- If an example stops working because the hook it uses changed, update the example in the same PR. Never leave a broken example.
- A documented "Stable" signature changing in a backwards-incompatible way is a breaking change — surface it to the user before shipping.
- If a change spans a surface that doesn't yet have an example (new public API), add one under `docs/examples/` and index it in `examples/README.md`.
- If a change adds a whole new surface with no doc yet, ask whether it deserves its own `docs/*.md` or fits as an example. Default to an example unless the surface has meaningful architectural weight.
