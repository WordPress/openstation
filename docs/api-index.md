# API Index

One table per surface. Use this to grep for a method, see its status at a glance, and jump to its full reference.

**Status legend** — same as the rest of the docs:
- **Stable** — shipping, backwards-compatible inside the current major.
- **Experimental** — shipping but signature may still change.
- **Planned** — reserved name, not yet fired.

---

## `wp.desktop.*` — JavaScript API

The full surface is documented in [`javascript-reference.md`](./javascript-reference.md). This table is the inventory.

### Bootstrap & lifecycle

| Member | Signature | Status |
|---|---|---|
| `whenReady` | `( cb: () => void ) => void` | Stable *(0.6.1)* |
| `ready` | `( cb: () => void ) => void` *(alias of `whenReady`, idiomatic)* | Stable *(0.17.0)* |
| `isReady` | `() => boolean` | Stable *(0.6.1)* |
| `isActive` | `() => boolean` *(true iff the desktop shell is mounted)* | Stable |
| `config` | `DesktopConfig` *(shell config blob)* | Stable |
| `HOOKS` | `typeof HOOKS` *(typed hook-name constants)* | Stable |
| `hooks` | `wp.hooks` bridge | Stable |
| `saveSession` | `() => void` | Stable |

### HTTP & UI primitives — must-know

| Member | Signature | Status |
|---|---|---|
| [`fetch`](./javascript-reference.md#wpdesktopfetch-input-init-opts---stable-since-080) | `( input, init?, opts? ) => Promise<Response>` *(routed fetch — pulses title-bar dot)* | **Stable** *(0.8.0)* |
| `confirm` | `( opts: WpdConfirmOptions ) => Promise<boolean>` *(replaces `window.confirm`)* | Stable *(0.9.0)* |
| `notify` | `( opts: NotifyOptions ) => Promise<NotifyHandle>` *(local notification w/ fallback)* | Stable *(0.8.0)* |

### Window management

| Member | Signature | Status |
|---|---|---|
| `windowManager` | `WindowManager` instance | Stable |
| `openWindow` | `( id: string, opts?: { source?: string } ) => boolean` | Stable *(0.18.0)* |
| `registerWindow` | `( def: NativeWindowDef ) => Window` | Stable *(0.10.0)* |
| `onWindow` | `( id, handlers, opts? ) => () => void` | Stable *(0.10.0)* |
| `connect` | `( windowId, opts? ) => ConnectionHandle` | Stable *(0.5.5)* |
| `getWindowConfig` | `<T>( id: string ) => T \| undefined` | Stable *(0.6.0)* |
| `setDefaultWindow` | `( id: string \| null ) => void` | Stable |
| `deriveWindowId` | `( url: string, adminUrl?: string ) => string` | Stable *(0.18.0)* |
| `debug.window` | `( id: string ) => DesktopDebugWindow \| null` | Stable *(0.6.0)* |

### Surfaces — dock, taskbar, icons, layout

| Member | Signature | Status |
|---|---|---|
| `dock` | `Dock \| null` *(primary / bottom rail)* | Stable |
| `sideDock` | `Dock \| null` *(left rail; classic only)* | Stable *(0.18.0)* |
| `desktopLayout` | `'classic' \| 'unified' \| 'spatial'` | Stable *(0.18.0)* |
| `Dock.setBadge` | `( id: string, count: number ) => void` | Stable *(0.22.0)* |
| `Dock.removeSystemItem` | `( id: string ) => void` | Stable *(0.24.0)* |
| `icons` | `IconsApi` *(see `icons.setBadge`)* | Stable *(0.24.0)* |
| `icons.setBadge` | `( iconId: string, count: number ) => void` | Stable *(0.24.0)* |
| `taskbar.setBadge` | `( id: string, count: number ) => void` | Stable *(0.24.0)* |
| `registerSystemTile` | `( item: SystemDockItem ) => void` | Stable |
| `widgetLayer` | `WidgetLayer \| null` | Stable |
| `registerWidget` | `( def: WidgetDef ) => void` | Stable |
| `registerWallpaper` | `( def: WallpaperDef ) => void` | Stable |

### Cross-bundle / cross-window state

| Member | Signature | Status |
|---|---|---|
| `createSharedStore` | `<T>( key: string, init: () => T ) => SharedStore<T>` | Stable *(0.5.5)* |
| `activity` | `ActivityApi` *(typed pub/sub bus)* | Stable *(0.5.5)* |
| `heartbeat` | `HeartbeatBus` *(WordPress Heartbeat bridge)* | Stable *(0.5.5)* |
| `broadcast` | `<T>( topic: string, payload: T ) => void` *(cross-window)* | Stable *(0.5.5)* |
| `subscribe` | `( topic: string, cb ) => () => void` *(cross-window)* | Stable *(0.5.5)* |
| `presence` | `PresenceApi` | Stable *(0.5.5)* |

### Commands, palettes, AI, settings

| Member | Signature | Status |
|---|---|---|
| `registerCommand` | `( def: CommandDef ) => void` | Stable *(0.15.0)* |
| `unregisterCommand` | `( id: string ) => void` | Stable *(0.15.0)* |
| `listCommands` | `() => CommandDef[]` | Stable *(0.15.0)* |
| `runCommand` | `( id: string, args? ) => unknown` | Stable *(0.15.0)* |
| `registerPalette` | `( def: PaletteDef ) => void` | Experimental *(0.16.0)* |
| `ai.ask` | `( prompt: string, opts? ) => Promise<AiAnswer>` | Experimental *(0.17.0)* |
| `ai.registerProvider` | `( def: AiProviderDef ) => void` | Experimental *(0.17.0)* |
| `registerSettingsTab` | `( def: SettingsTabDef ) => void` | Stable *(0.17.0)* |
| `subscribeOsSettings` | `( cb ) => () => void` | Stable *(0.8.0)* |
| `updateOsSettings` | `( patch, opts? ) => void` | Stable *(0.8.0)* |

### Title-bar buttons, themes, controls, slots, chrome

| Member | Signature | Status |
|---|---|---|
| `registerTitleBarButton` | `( def: TitleBarButtonDef ) => void` | Stable *(0.17.0)* |
| `unregisterTitleBarButton` | `( id: string ) => void` | Stable *(0.17.0)* |
| `registerWindowTheme` | `( def: WindowThemeDef ) => void` | Stable *(0.6.0)* |
| `registerWindowControl` | `( def: WindowControlDef ) => void` | Stable *(0.6.0)* |
| `registerWindowSlot` | `( def: WindowSlotDef ) => void` | Stable *(0.6.0)* |
| `registerWindowChrome` | `( def: WindowChromeDef ) => void` | Experimental *(0.6.0)* |

### Files on the desktop

| Member | Signature | Status |
|---|---|---|
| `files.registerType` | `( def: FileTypeDef ) => void` | Experimental *(0.9.0)* |
| `files.resolve` | `( serialized ) => DesktopFile \| null` | Experimental *(0.9.0)* |
| `files.getTypes` | `() => FileTypeDef[]` | Experimental *(0.9.0)* |
| `files.open` | `( file: DesktopFile ) => void` | Experimental *(0.9.0)* |
| `files.registerOpener` | `( def: FileOpenerDef ) => void` | Experimental *(0.9.0)* |

### PWA

| Member | Signature | Status |
|---|---|---|
| `pwa.promptInstall` | `() => Promise<boolean>` | Stable *(0.8.0)* |
| `pwa.canInstall` | `() => boolean` | Stable *(0.8.0)* |

### Drag bridge

| Member | Signature | Status |
|---|---|---|
| `dragManager` | `DragManager` *(in-shell drag)* | Stable *(0.18.0)* |
| `dragBridge` | `DragBridge` *(cross-iframe drag)* | Stable *(0.14.0)* |

### Iframe-side bridge — `wp.desktop.iframe.*`

Inside an iframe window, after the chromeless bridge installs the API:

| Member | Signature | Status |
|---|---|---|
| `iframe.publish` | `( channel: string, payload? ) => void` | Stable *(0.5.5)* |
| `iframe.subscribe` | `( channel, cb ) => () => void` | Stable *(0.5.5)* |
| `iframe.requestConnection` | `( windowId, opts ) => ConnectionHandle` | Stable *(0.5.5)* |
| `iframe.onConnection` | `( cb ) => () => void` | Stable *(0.5.5)* |

### Module loader

| Member | Signature | Status |
|---|---|---|
| `registerModule` | `( def: ModuleDef ) => void` | Stable |
| `loadModules` | `( ids: string[] ) => Promise<void>` | Stable |
| `loadVendorScript` | `( url: string, extras? ) => Promise<void>` | Stable |
| `createInfiniteList` | `<T>( opts: InfiniteListOptions<T> ) => InfiniteList` *(IntersectionObserver + AbortController + dedup-by-id + cursor pagination)* | Stable *(0.8.2)* |
| `startOAuth` | `( service: string, opts? ) => Promise<{ ok: true, service }>` *(framework owns state nonce + popup + postMessage round-trip)* | Stable *(0.8.2)* |

---

## CustomEvents on `document`

Every event bubbles from `document`. See [`javascript-reference.md`](./javascript-reference.md#1-customevents) for `detail` shapes.

| Event | Status |
|---|---|
| `desktop-mode-init` | Stable |
| `desktop-mode-window-opened` | Stable |
| `desktop-mode-window-reopened` | Stable *(0.5.5)* |
| `desktop-mode-window-content-loading` | Stable *(0.6.0)* |
| `desktop-mode-window-content-loaded` | Stable *(0.6.0)* |
| `desktop-mode-window-focused` | Stable |
| `desktop-mode-window-blurred` | Stable *(0.5.5)* |
| `desktop-mode-window-closing` | Stable |
| `desktop-mode-window-closed` | Stable |
| `desktop-mode-window-changed` | Experimental |
| `desktop-mode-presence-changed` | Stable *(0.5.5)* |
| `desktop-mode-layout-changed` | Stable *(0.18.0)* |
| `desktop-mode-registry-changed` | Stable *(0.18.1)* |
| `desktop-mode.drag.start` / `.move` / `.enter` / `.leave` / `.rejected` / `.commit` / `.cancel` / `.end` | Stable *(0.18.0)* |
| `wp-desktop-drag-*` *(cross-iframe drag bridge)* | Stable *(0.14.0)* |

---

## `postMessage` bridge

Typed messages between the parent shell and iframe windows. Full shapes in [`bridge-protocol.md`](./bridge-protocol.md) and [`javascript-reference.md`](./javascript-reference.md).

| Message type | Direction | Status |
|---|---|---|
| `desktop-mode-ready` | iframe → parent | Stable |
| `desktop-mode-window-publish` | iframe → parent | Stable *(0.5.5)* |
| `desktop-mode-window-send` | parent → iframe | Stable *(0.5.5)* |
| `desktop-mode-bridge-*` *(connection-bridge family)* | both | Stable *(0.5.5)* |
| `desktop-mode-plugins-changed` | iframe → parent | Stable *(0.18.1)* |
| `desktop-mode-code-open` | parent → iframe | Stable *(0.17.0)* |
| `wp-desktop-drag-start` / `-over` / `-drop` | both | Stable *(0.14.0)* |

---

## Where status labels live

- `wp.desktop.*` methods — JSDoc on each member, plus this table.
- CustomEvents — section heading in `javascript-reference.md`, plus this table.
- PHP hooks — `hooks-reference.md`.
- Web Components — `static help` block on each `<wpd-*>` class, plus `components-reference.md`.

When a status changes (Experimental → Stable, or anything → removed), update **all three** of: the JSDoc, this table, and the relevant per-doc reference. The doc lint guidance in `AGENTS.md` enforces this rule of thumb: a hook change without a doc update ships a lie.
