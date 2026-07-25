# API Index

One table per surface. Use this to grep for a method, see its status at a glance, and jump to its full reference.

**Status legend** — same as the rest of the docs:
- **Stable** — shipping, backwards-compatible inside the current major.
- **Experimental** — shipping but signature may still change.
- **Planned** — reserved name, not yet fired.

---

## `wp.desktop.*` — JavaScript API

The full surface is documented in [`javascript-reference.md`](./javascript-reference.md). This table indexes the most-used members — for the exhaustive inventory, use the reference.

### Bootstrap & lifecycle

| Member | Signature | Status |
|---|---|---|
| `whenReady` | `( cb: () => void ) => void` | Stable *(0.5.0)* |
| `ready` | `( cb: () => void ) => void` *(alias of `whenReady`, idiomatic)* | Stable *(0.5.1)* |
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
| `notify` | `( opts: NotifyOptions ) => () => void` *(local notification w/ fallback; returns a dismiss function)* | Stable *(0.8.0)* |

### Window management

| Member | Signature | Status |
|---|---|---|
| `windowManager` | `WindowManager` instance | Stable |
| `openWindow` | `( id: string, opts?: { source?: string } ) => boolean` | Stable *(0.6.0)* |
| `openNewWindow` | `( id: string, opts?: { source?: string } ) => boolean` *(always spawns a new instance)* | Stable *(0.8.3)* |
| `registerWindow` | `( def: NativeWindowDef ) => Promise<Window>` | Stable *(returns a `Promise` since 0.8.4)* |
| `cloneTemplate` | `( templateOrId: string \| HTMLTemplateElement ) => DocumentFragment` | Stable |
| `onWindow` | `( id, handlers, opts? ) => () => void` | Stable *(0.6.0)* |
| `connect` | `( windowId, opts? ) => ConnectionHandle` | Stable *(0.5.5)* |
| `getWindowConfig` | `<T>( id: string ) => T \| undefined` | Stable *(0.6.0)* |
| `setDefaultWindow` | `( url: string \| null ) => Promise<void>` | Stable |
| `deriveWindowId` | `( url: string, adminUrl?: string ) => string` | Stable *(0.6.0)* |
| `debug.window` | `( id: string ) => DesktopDebugWindow \| null` | Stable *(0.6.0)* |

### Surfaces — dock, taskbar, icons, layout

| Member | Signature | Status |
|---|---|---|
| `dock` | `Dock \| null` *(primary / bottom rail)* | Stable |
| `sideDock` | `Dock \| null` *(left rail; classic only)* | Stable *(0.6.0)* |
| `desktopLayout` | `'classic' \| 'unified' \| 'spatial'` | Stable *(0.6.0)* |
| `Dock.setBadge` | `( id: string, count: number ) => void` | Stable *(0.6.0)* |
| `Dock.removeSystemItem` | `( id: string ) => void` | Stable |
| `icons` | `IconsApi` *(see `icons.setBadge`)* | Stable *(0.6.0)* |
| `icons.setBadge` | `( iconId: string, count: number ) => void` | Stable *(0.6.0)* |
| `registerSystemTile` | `( item: SystemDockItem ) => void` | Stable |
| `widgetLayer` | `WidgetLayer \| null` | Stable |
| `registerWidget` | `( def: WidgetDef ) => void` | Stable |
| `registerWallpaper` | `( def: WallpaperDef ) => void` | Stable |
| `wallpaper` | `WallpaperSuspendApi` *(`suspend( reason )` / `resume( reason )` / `isSuspended()` — refcounted wallpaper pause)* | Experimental *(0.9.6)* |
| `games` | `GamesApi` *(`register` / `unregister` / `list` / `get` / `subscribe` / `launch` / `getPlaytime` — desktop games + unified scoreboard)* | Experimental *(0.9.6)* |

### Cross-bundle / cross-window state

| Member | Signature | Status |
|---|---|---|
| `createSharedStore` | `<T>( key: string, init: () => T ) => SharedStore<T>` | Stable *(0.5.5)* |
| `activity` | `ActivityApi` *(typed pub/sub bus)* | Stable *(0.5.5)* |
| `heartbeat` | `HeartbeatBus` *(WordPress Heartbeat bridge)* | Stable *(0.5.5)* |
| `broadcast` | `<T>( topic: string, payload: T ) => void` *(cross-window)* | Stable *(0.5.5)* |
| `subscribe` | `( topic: string, cb ) => () => void` *(cross-window)* | Stable *(0.5.5)* |
| — topic family | `desktop-mode.<type>.changed` *(content-change realtime; `{ source, action, ids }`)* | Stable *(0.9.7)* |
| `presence` | `PresenceApi` | Stable *(0.5.5)* |

### Commands, palettes, AI, settings

| Member | Signature | Status |
|---|---|---|
| `registerCommand` | `( def: CommandDef ) => void` | Stable *(0.5.0)* |
| `unregisterCommand` | `( id: string ) => void` | Stable *(0.5.0)* |
| `listCommands` | `() => CommandDef[]` | Stable *(0.5.0)* |
| `registerPalette` | `( def: PaletteDef ) => void` | Experimental *(0.5.0)* |
| `ai.ask` | `( prompt: string, opts? ) => Promise<AiAnswer>` | Experimental *(0.5.1)* |
| `registerSettingsTab` | `( def: SettingsTabDef ) => void` | Stable *(0.5.2)* |
| `subscribeOsSettings` | `( cb ) => () => void` | Stable *(0.8.0)* |
| `updateOsSettings` | `( patch, opts? ) => void` | Stable *(0.7.2)* |

### Title-bar buttons, themes, controls, slots, chrome

| Member | Signature | Status |
|---|---|---|
| `registerTitleBarButton` | `( def: TitleBarButtonDef ) => void` | Stable *(0.5.2)* |
| `unregisterTitleBarButton` | `( id: string ) => void` | Stable *(0.5.2)* |
| `listTitleBarButtons` | `() => TitleBarButtonDef[]` | Experimental |
| `registerUnfocusEffect` | `( def: UnfocusEffectDef ) => void` | Experimental *(0.9.1)* |
| `unregisterUnfocusEffect` | `( id: string ) => void` | Experimental *(0.9.1)* |
| `listUnfocusEffects` | `() => UnfocusEffectDef[]` | Experimental *(0.9.1)* |
| `registerWindowLinkRenderer` | `( def: WindowLinkRendererDef ) => void` | Experimental *(0.9.4)* |
| `unregisterWindowLinkRenderer` | `( id: string ) => void` | Experimental *(0.9.4)* |
| `listWindowLinkRenderers` | `() => WindowLinkRendererDef[]` | Experimental *(0.9.4)* |
| `relations.get` | `( windowId: string ) => WindowContentRef \| undefined` | Experimental *(0.9.4)* |
| `relations.set` | `( windowId: string, ref: WindowContentRef \| null ) => void` | Experimental *(0.9.4)* |
| `relations.groups` | `() => WindowLinkGroup[]` | Experimental *(0.9.4)* |
| `relations.edges` | `() => WindowLinkEdge[]` | Experimental *(0.9.4)* |
| `relations.groupOf` | `( windowId: string ) => WindowLinkGroup \| undefined` | Experimental *(0.9.4)* |
| `relations.related` | `( windowId: string ) => string[]` | Experimental *(0.9.4)* |
| `relations.subscribe` | `( cb: () => void ) => () => void` | Experimental *(0.9.4)* |
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
| `pwa.promptInstall` | `() => Promise<'accepted' \| 'dismissed' \| 'unavailable'>` | Stable *(0.8.0)* |
| `pwa.undismissInstallHint` | `() => void` | Stable *(0.8.0)* |
| `pwa.getState` | `() => { installHintDismissed: boolean, notificationsEnabled: boolean }` | Stable *(0.8.0)* |
| `pwa.subscribe` | `( cb: ( state ) => void ) => () => void` | Stable *(0.8.0)* |
| `pwa.requestNotificationPermission` | `() => Promise<'granted' \| 'denied' \| 'default' \| 'unsupported'>` | Stable *(0.8.0)* |
| `pwa.getNotificationPermission` | `() => 'granted' \| 'denied' \| 'default' \| 'unsupported'` | Stable *(0.8.0)* |

### Drag bridge

| Member | Signature | Status |
|---|---|---|
| `dragManager` | `DragManager` *(in-shell drag)* | Stable *(0.8.1)* |
| `dragBridge` | `DragBridge` *(cross-iframe drag)* | Stable *(0.5.0)* |

### Iframe-side bridge — `wp.desktop.iframe.*`

Inside an iframe window, after the chromeless bridge installs the API:

| Member | Signature | Status |
|---|---|---|
| `iframe.publish` | `( channel: string, payload? ) => void` | Stable *(0.5.5)* |
| `iframe.subscribe` | `( channel, cb ) => () => void` | Stable *(0.5.5)* |
| `iframe.requestConnection` | `( opts: RequestConnectionOptions ) => Promise<ConnectionRecord>` | Stable *(0.5.5)* |
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
| `desktop-mode-window-content-changed` | Experimental *(0.9.4)* |
| `desktop-mode-window-link-groups-changed` | Experimental *(0.9.4)* |
| `desktop-mode-presence-changed` | Stable *(0.5.5)* |
| `desktop-mode-layout-changed` | Stable *(0.6.0)* |
| `desktop-mode-registry-changed` | Stable *(0.7.0)* |
| `desktop-mode.drag.start` / `.move` / `.enter` / `.leave` / `.rejected` / `.commit` / `.cancel` / `.end` | Stable *(0.8.1)* |
| `desktop-mode-cross-frame-drag-start` / `-end` *(cross-iframe drag bridge)* | Stable *(0.7.0)* |
| `desktop-mode-os-settings-save-lifecycle` | Stable *(0.7.2)* |
| `desktop-mode-default-window-changed` | Stable *(0.7.0)* |
| `desktop-mode-open-ai` *(plugin-dispatched; the shell listens)* | Experimental *(0.7.0)* |
| `desktop-mode-intros-reset` | Experimental *(0.8.3)* |
| `desktop-mode-my-wordpress-entity-trashed` | Experimental *(0.8.9)* |
| `desktop-mode-note-created` *(pinned-notes hand-off from the Note Pad widget)* | Experimental *(0.9.6)* |
| `desktop-mode-auth-lost` / `desktop-mode-auth-restored` *(session expiry / recovery)* | Stable *(0.9.8)* |
| `desktop-mode-editor-preview-opened` / `-closed` *(editor↔preview pairing lifecycle)* | Experimental *(0.9.8)* |

---

## `postMessage` bridge

Typed messages between the parent shell and iframe windows. Full shapes in [`bridge-protocol.md`](./bridge-protocol.md) and [`javascript-reference.md`](./javascript-reference.md).

| Message type | Direction | Status |
|---|---|---|
| `desktop-mode-ready` | iframe → parent | Stable |
| `desktop-mode-window-publish` | iframe → parent | Stable *(0.5.5)* |
| `desktop-mode-window-send` | parent → iframe | Stable *(0.5.5)* |
| `desktop-mode-bridge-*` *(connection-bridge family)* | both | Stable *(0.5.5)* |
| `desktop-mode-plugins-changed` | iframe → shell (top window since 0.9.7) | Stable *(0.7.0)* |
| `desktop-mode-menu-signature` | iframe → shell (top window since 0.9.7) | Stable *(0.9.4)* |
| `desktop-mode-updates-changed` *(shiny-update completion nudge)* | iframe → shell | Stable *(0.9.7)* |
| `wp-desktop-code-open` *(ships with the `desktop-mode-code-editor` extension)* | iframe → parent | Stable *(0.5.4)* |
| `desktop-mode-drag-start` / `-end` / `-payload-request` | iframe → parent | Stable *(0.7.0)* |
| `desktop-mode-drag-payload` *(reply to `-payload-request`)* | parent → iframe | Stable *(0.7.0)* |
| `desktop-mode-drag-over` / `-leave` / `desktop-mode-drop` | parent → iframe | Stable *(0.8.7)* |
| `desktop-mode-reauth-detected` *(session re-auth nudge)* | iframe → parent | Stable *(0.8.3)* |
| `desktop-mode-editor-autosave-request` / `-response` *(preview-button autosave query)* | parent → iframe / iframe → parent | Experimental *(0.9.8)* |
| `desktop-mode-editor-live-watch` / `-unwatch` / `-live-saved` *(typing-driven preview refresh)* | parent → iframe / parent → iframe / iframe → parent | Experimental *(0.9.8)* |

---

## Where status labels live

- `wp.desktop.*` methods — JSDoc on each member, plus this table.
- CustomEvents — section heading in `javascript-reference.md`, plus this table.
- PHP hooks — `hooks-reference.md`.
- Web Components — `static help` block on each `<wpd-*>` class, plus `components-reference.md`.

When a status changes (Experimental → Stable, or anything → removed), update **all three** of: the JSDoc, this table, and the relevant per-doc reference. The doc lint guidance in `AGENTS.md` enforces this rule of thumb: a hook change without a doc update ships a lie.
