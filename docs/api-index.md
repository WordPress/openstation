# API Index

One table per surface. Use this to grep for a method, see its status at a glance, and jump to its full reference.

**Status legend** — same as the rest of the docs:
- **Stable** — shipping, backwards-compatible inside the current major.
- **Experimental** — shipping but signature may still change.
- **Planned** — reserved name, not yet fired.

---

## `wp.os.*` — JavaScript API

The full surface is documented in [`javascript-reference.md`](./javascript-reference.md). This table indexes the most-used members — for the exhaustive inventory, use the reference.

### Bootstrap & lifecycle

| Member | Signature | Status |
|---|---|---|
| `whenReady` | `( cb: () => void ) => void` | Stable |
| `ready` | `( cb: () => void ) => void` *(alias of `whenReady`, idiomatic)* | Stable |
| `isReady` | `() => boolean` | Stable |
| `isActive` | `() => boolean` *(true iff the desktop shell is mounted)* | Stable |
| `config` | `DesktopConfig` *(shell config blob)* | Stable |
| `HOOKS` | `typeof HOOKS` *(typed hook-name constants)* | Stable |
| `hooks` | `wp.hooks` bridge | Stable |
| `saveSession` | `() => void` | Stable |
| `registerWindowAction` / `unregisterWindowAction` / `listWindowActions` | `( def: WindowActionDef ) => void` *(rows in every window's ⋯ menu, as verbs or checkboxes; `label`/`icon`/`isVisible`/`checked` may be per-window functions)* | Experimental |
| [`electron`](./desktop-host.md) | `ElectronAdapterApi` *(set a window free into a real OS window; published by the Electron Adapter extension, absent in a browser)* | Experimental |

### HTTP & UI primitives — must-know

| Member | Signature | Status |
|---|---|---|
| [`fetch`](./javascript-reference.md#wposfetch-input-init-opts---stable) | `( input, init?, opts? ) => Promise<Response>` *(routed fetch — pulses title-bar dot)* | **Stable** |
| `confirm` | `( opts: OsConfirmOptions ) => Promise<boolean>` *(replaces `window.confirm`)* | Stable |
| `notify` | `( opts: NotifyOptions ) => () => void` *(local notification w/ fallback; returns a dismiss function)* | Stable |
| [`loadComponents`](./javascript-reference.md#wposloadcomponents-tags---stable) | `( tags?: readonly string[] ) => Promise<void>` *(make `<os-*>` tags upgrade; the runtime route to the kit for plugins that can't import it)* | **Stable** |
| [`getWindowParams`](./javascript-reference.md#wposgetwindowparams-id---stable) | `( id: string ) => Record<string, string \| number \| boolean> \| undefined` *(what an open window is showing now)* | **Stable** |
| [`registerNativeUrlRemap`](./javascript-reference.md#wposregisternativeurlremap-entry---stable) | `( entry: NativeUrlRemap ) => () => void` *(claim an admin URL for a native window)* | **Stable** |

### Window management

| Member | Signature | Status |
|---|---|---|
| `windowManager` | `WindowManager` instance | Stable |
| `openWindow` | `( id: string, opts?: { source?: string } ) => boolean` | Stable |
| `openNewWindow` | `( id: string, opts?: { source?: string } ) => boolean` *(always spawns a new instance)* | Stable |
| `registerWindow` | `( def: NativeWindowDef ) => Promise<Window>` | Stable *(returns a `Promise`)* |
| `cloneTemplate` | `( templateOrId: string \| HTMLTemplateElement ) => DocumentFragment` | Stable |
| `onWindow` | `( id, handlers, opts? ) => () => void` | Stable |
| `connect` | `( windowId, opts? ) => ConnectionHandle` | Stable |
| `getWindowConfig` | `<T>( id: string ) => T \| undefined` | Stable |
| `setDefaultWindow` | `( url: string \| null ) => Promise<void>` | Stable |
| `deriveWindowId` | `( url: string, adminUrl?: string ) => string` | Stable |
| `debug.window` | `( id: string ) => DesktopDebugWindow \| null` | Stable |

### Surfaces — dock, taskbar, icons, layout

| Member | Signature | Status |
|---|---|---|
| `dock` | `Dock \| null` *(primary / bottom rail)* | Stable |
| `sideDock` | `Dock \| null` *(left rail; classic only)* | Stable |
| `desktopLayout` | `'classic' \| 'unified'` | Stable |
| `dockPlacement` | `'bottom' \| 'left' \| 'right'` *(Unified)* | Stable |
| `Dock.setBadge` | `( id: string, count: number ) => void` | Stable |
| `Dock.removeSystemItem` | `( id: string ) => void` | Stable |
| `icons` | `IconsApi` *(see `icons.setBadge`)* | Stable |
| `icons.setBadge` | `( iconId: string, count: number ) => void` | Stable |
| `iconSet` | `OsIconSetApi` *(the thirty-icon set; unrelated to `icons`)* | Stable |
| `iconSet.svg` | `( name: string, options?: OsIconOptions ) => string` | Stable |
| `iconSet.node` | `( name: string, options?: OsIconOptions ) => SVGSVGElement` | Stable |
| `iconSet.dataUri` | `( name: string, options?: OsIconOptions ) => string` | Stable |
| `registerSystemTile` | `( item: SystemDockItem ) => void` | Stable |
| `listSystemTiles` | `() => Array<{ id, title, icon, navKind, placeable, locked }>` | Stable |
| `getSystemTile` | `( id: string ) => SystemDockItem \| null` | Stable |
| `getMenuItems` | `() => DockItem[]` | Stable |
| `getNavItems` | `() => NavItem[]` *(every menu, app and control, with its `kind`)* | Stable |
| `getNav` | `() => NavResult \| null` *(the computed dock zones, sidebar, wallpaper, and running-only ids)* | Stable |
| `widgetLayer` | `WidgetLayer \| null` | Stable |
| `registerWidget` | `( def: WidgetDef ) => void` | Stable |
| `registerWallpaper` | `( def: WallpaperDef ) => void` | Stable |
| `wallpaper` | `WallpaperSuspendApi` *(`suspend( reason )` / `resume( reason )` / `isSuspended()` — refcounted wallpaper pause)* | Experimental |
| `games` | `GamesApi` *(`register` / `unregister` / `list` / `get` / `subscribe` / `launch` / `getPlaytime` — desktop games + unified scoreboard)* | Experimental |
| `mio` | `MioApi` *(`isEnabled` / `enable` / `disable` / `toggle` / `getPosition` / `setPosition` / `getConfig` / `setConfig` / `setStyle` / `getLook` / `commitStyle` / `resetStyle` — the soft-body desk companion; see [`mio.md`](./mio.md))* | Experimental |

### Cross-bundle / cross-window state

| Member | Signature | Status |
|---|---|---|
| `createSharedStore` | `<T>( key: string, init: () => T ) => SharedStore<T>` | Stable |
| `activity` | `ActivityApi` *(typed pub/sub bus)* | Stable |
| `heartbeat` | `HeartbeatBus` *(WordPress Heartbeat bridge)* | Stable |
| `broadcast` | `<T>( topic: string, payload: T ) => void` *(cross-window)* | Stable |
| `subscribe` | `( topic: string, cb ) => () => void` *(cross-window)* | Stable |
| — topic family | `os.<type>.changed` *(content-change realtime; `{ source, action, ids }`)* | Stable |
| `presence` | `PresenceApi` | Stable |
| `workArea` | `WorkAreaApi` *(`get()` / `rectOf( areaEl? )` / `insetsOf( el )` / `subscribe( cb )` — the reachable desktop rectangle, also on `#os-shell` as `--os-work-area-*`)* | Experimental |
| `selection` | `SelectionApi` *(`active()`, `resolveCommonActions()`, `createModel()`)* | Experimental |

### Commands, palettes, AI, settings

| Member | Signature | Status |
|---|---|---|
| `registerCommand` | `( def: CommandDef ) => void` | Stable |
| `unregisterCommand` | `( id: string ) => void` | Stable |
| `listCommands` | `() => CommandDef[]` | Stable |
| `registerPalette` | `( def: PaletteDef ) => void` | Experimental |
| `ai.ask` | `( prompt: string, opts? ) => Promise<AiAnswer>` | Experimental |
| `registerSettingsTab` | `( def: SettingsTabDef ) => void` | Stable |
| `subscribeOsSettings` | `( cb ) => () => void` | Stable |
| `updateOsSettings` | `( patch, opts? ) => void` | Stable |

### Title-bar buttons, themes, controls, slots, chrome

| Member | Signature | Status |
|---|---|---|
| `registerTitleBarButton` | `( def: TitleBarButtonDef ) => void` | Stable |
| `unregisterTitleBarButton` | `( id: string ) => void` | Stable |
| `listTitleBarButtons` | `() => TitleBarButtonDef[]` | Experimental |
| `registerUnfocusEffect` | `( def: UnfocusEffectDef ) => void` | Experimental |
| `unregisterUnfocusEffect` | `( id: string ) => void` | Experimental |
| `listUnfocusEffects` | `() => UnfocusEffectDef[]` | Experimental |
| `registerWindowReveal` | `( def: WindowRevealDef ) => void` | Experimental |
| `unregisterWindowReveal` | `( id: string ) => void` | Experimental |
| `listWindowReveals` | `() => WindowRevealDef[]` | Experimental |
| `registerWindowLinkRenderer` | `( def: WindowLinkRendererDef ) => void` | Experimental |
| `unregisterWindowLinkRenderer` | `( id: string ) => void` | Experimental |
| `listWindowLinkRenderers` | `() => WindowLinkRendererDef[]` | Experimental |
| `relations.get` | `( windowId: string ) => WindowContentRef \| undefined` | Experimental |
| `relations.set` | `( windowId: string, ref: WindowContentRef \| null ) => void` | Experimental |
| `relations.groups` | `() => WindowLinkGroup[]` | Experimental |
| `relations.edges` | `() => WindowLinkEdge[]` | Experimental |
| `relations.groupOf` | `( windowId: string ) => WindowLinkGroup \| undefined` | Experimental |
| `relations.related` | `( windowId: string ) => string[]` | Experimental |
| `relations.subscribe` | `( cb: () => void ) => () => void` | Experimental |
| `registerWindowTheme` | `( def: WindowThemeDef ) => void` | Stable |
| `registerWindowControl` | `( def: WindowControlDef ) => void` | Stable |
| `registerWindowSlot` | `( def: WindowSlotDef ) => void` | Stable |
| `registerWindowChrome` | `( def: WindowChromeDef ) => void` | Experimental |
| `desktopThemes.list` | `() => DesktopThemeEntry[]` | Experimental |
| `desktopThemes.getActive` | `() => string \| null` | Experimental |
| `desktopThemes.setActive` | `( themeId: string ) => void` | Experimental |
| `desktopThemes.ensureFull` | `() => Promise<void>` | Experimental |
| `desktopThemes.subscribe` | `( cb ) => () => void` | Experimental |
| `desktopThemes.resolveIcon` | `( slot: string ) => string \| null` | Experimental |
| `desktopThemes.applyRecommendedOsSettings` | `( themeId?: string ) => RecommendedOsSettings` | Experimental |

### App Framework windows *(Experimental)*

Windows declared in PHP as `.os.php` files — [`app-framework.md`](./app-framework.md). Loaded lazily with the first app window.

| Member | Signature | Status |
|---|---|---|
| `apps.dispatch` | `( windowId: string, action: string, args?: Record<string, unknown>, view?: string ) => Promise<boolean>` | Experimental |
| `apps.local` | `( windowId: string, action: string, args?: Record<string, unknown> ) => void` *(client-view apps; no request)* | Experimental |
| `apps.session` | `( windowId: string, view?: string ) => Session \| undefined` | Experimental |
| `@openstation/app` | `defineApp< State, Data >( id, { local?, view, mounted?, updated? } )`, `html`, `__`/`_n`/`_x`/`sprintf`, `formatBytes` / `formatDate`, `createPagedList` / `applySelection` *(what an `.os.ts` imports)* | Experimental |
| `ViewContext` | `state`, `data`, `root`, `dispatch( action, args?, { confirm }? )`, `local`, `ui( factory )`, `repaint()`, `fetch( path, init? )`, `host` — see [`app-framework.md`](./app-framework.md#the-client-view--osts) | Experimental |
| `apps.refresh` | `() => string[]` | Experimental |

PHP side: `App::define( $id )` fluent definition (`state`, `action` — with `mount` / `set` / `refresh` built in — `view`, `tab`, `title_bar_button`, `window_action`, `on_channel`, `theme` / `controls` / `slot`, `desktop_icon`), the `$os` handle (`auth`, `settings`, `hooks`, `cache`, `env`, `storage`, `param()`, `stored()` / `store()`, the statics `Os::page()` / `Os::facts()`, and the effects `toast` / `title` / `close` / `open` / `open_url` / `badge` / `announce` / `menu` / `send`), `openstation_app( $id )`, `openstation_app_render( $id, $state )`, filters `openstation_apps_directories` / `openstation_app_manifest` / `openstation_app_window_args` / `openstation_app_response`, actions `openstation_apps_loaded` / `openstation_app_registered`, route `POST desktop-mode/v1/apps/<id>/dispatch` — all in [`app-framework.md`](./app-framework.md) and [`hooks-reference.md` → App Framework](./hooks-reference.md#app-framework).

### Files on the desktop

| Member | Signature | Status |
|---|---|---|
| `files.registerType` | `( def: FileTypeDef ) => void` | Experimental |
| `files.resolve` | `( serialized ) => DesktopFile \| null` | Experimental |
| `files.getTypes` | `() => FileTypeDef[]` | Experimental |
| `files.open` | `( file: DesktopFile ) => void` | Experimental |
| `files.registerOpener` | `( def: FileOpenerDef ) => void` | Experimental |

### PWA

| Member | Signature | Status |
|---|---|---|
| `pwa.promptInstall` | `() => Promise<'accepted' \| 'dismissed' \| 'unavailable'>` | Stable |
| `pwa.undismissInstallHint` | `() => void` | Stable |
| `pwa.getState` | `() => { installHintDismissed: boolean, notificationsEnabled: boolean }` | Stable |
| `pwa.subscribe` | `( cb: ( state ) => void ) => () => void` | Stable |
| `pwa.requestNotificationPermission` | `() => Promise<'granted' \| 'denied' \| 'default' \| 'unsupported'>` | Stable |
| `pwa.getNotificationPermission` | `() => 'granted' \| 'denied' \| 'default' \| 'unsupported'` | Stable |

### Drag bridge

| Member | Signature | Status |
|---|---|---|
| `dragManager` | `DragManager` *(in-shell drag)* | Stable |
| `dragBridge` | `DragBridge` *(cross-iframe drag)* | Stable |

### Iframe-side bridge — `wp.os.iframe.*`

Inside an iframe window, after the chromeless bridge installs the API:

| Member | Signature | Status |
|---|---|---|
| `iframe.publish` | `( channel: string, payload? ) => void` | Stable |
| `iframe.subscribe` | `( channel, cb ) => () => void` | Stable |
| `iframe.requestConnection` | `( opts: RequestConnectionOptions ) => Promise<ConnectionRecord>` | Stable |
| `iframe.onConnection` | `( cb ) => () => void` | Stable |

### Module loader

| Member | Signature | Status |
|---|---|---|
| `registerModule` | `( def: ModuleDef ) => void` | Stable |
| `loadModules` | `( ids: string[] ) => Promise<void>` | Stable |
| `loadVendorScript` | `( url: string, extras? ) => Promise<void>` | Stable |
| `createInfiniteList` | `<T>( opts: InfiniteListOptions<T> ) => InfiniteList` *(IntersectionObserver + AbortController + dedup-by-id + cursor pagination)* | Stable |
| `startOAuth` | `( service: string, opts? ) => Promise<{ ok: true, service }>` *(framework owns state nonce + popup + postMessage round-trip)* | Stable |

---

### AI Agents *(Experimental — behind the `agents` extended option)*

No dedicated `wp.os.agents` namespace yet — the surface is REST +
shared-store + registries. Index:

| Surface | Where | Status |
|---|---|---|
| Trust model, capability ceiling, untrusted tool output | [`agents-security.md`](./agents-security.md) | Experimental |
| `/desktop-mode/v1/agents[…]` REST routes | [`includes/rest/README.md`](../includes/rest/README.md) | Experimental |
| `openstation_agent_*` PHP helpers, actions, filters | [`hooks-reference.md`](./hooks-reference.md#ai-agents) | Experimental |
| `desktop-mode/agents-chat` shared-store key + `desktop-mode-agent-run` window | [`javascript-reference.md`](./javascript-reference.md#ai-agents--client-surface-experimental) | Experimental |
| Agents section in the WP Explorer app | `apps/my-wordpress/parts/agents*` | Experimental |

### WooCommerce integration *(Experimental — inert unless WooCommerce is active)*

No `wp.os.woo` namespace. The surface is PHP filters + REST + a
native window, all hanging off WP Explorer. Index:

| Surface | Where | Status |
|---|---|---|
| What the integration renders, and why | [`plugin-compat-layer.md`](./plugin-compat-layer.md#the-site-window-side-woocommerce) | Experimental |
| `openstation_my_wordpress_woo_*` filters (orders, products, coupons, store, summaries, customers) | [`hooks-reference.md`](./hooks-reference.md#woocommerce-integration--experimental-filters) | Experimental |
| `desktop-mode/v1/woocommerce/{orders, store, summary/<type>/<id>, customers, customers/<id>}` | `includes/my-wordpress/integrations/` | Experimental |
| `openstation_woo_customer` REST field on the core `user` resource | [`hooks-reference.md`](./hooks-reference.md#customers) | Experimental |
| `desktop-mode-woo-customer` native window *(retargetable singleton, `customerId` param)* | [`hooks-reference.md`](./hooks-reference.md#the-customer-window) | Experimental |

### Station Home plugin cards *(Experimental)*

| Surface | Signature | Status |
|---|---|---|
| `openstation_register_station_home_card` | `( string $id, array $args ) => true|WP_Error` | Experimental |
| `openstation_unregister_station_home_card` | `( string $id ) => bool` | Experimental |
| `openstation_station_home_cards` | `( array $cards, int $user_id ) => array` | Experimental |
| `openstation_station_home_card_data` | `( array $data, string $id, array $entry, int $user_id ) => array` | Experimental |
| card lifecycle actions | registered, preference-updated, callback-error | Experimental |

See [`station-home.md`](./station-home.md#plugin-cards) and the [complete plugin recipe](./examples/station-home-card.md).

## CustomEvents on `document`

Every event bubbles from `document`. See [`javascript-reference.md`](./javascript-reference.md#1-customevents) for `detail` shapes.

| Event | Status |
|---|---|
| `os-init` | Stable |
| `os-window-opened` | Stable |
| `os-window-reopened` | Stable |
| `os-window-content-loading` | Stable |
| `os-window-content-loaded` | Stable |
| `os-window-focused` | Stable |
| `os-window-blurred` | Stable |
| `os-window-child-blocked` | Stable |
| `os-window-closing` | Stable |
| `os-window-closed` | Stable |
| `os-window-changed` | Experimental |
| `os-window-content-changed` | Experimental |
| `os-window-link-groups-changed` | Experimental |
| `os-presence-changed` | Stable |
| `os-work-area-changed` | Experimental |
| `os-selection-changed` | Experimental |
| `os-layout-changed` | Stable |
| `os-item-menu-opening` | Stable |
| `os-registry-changed` | Stable |
| `os.drag.start` / `.move` / `.enter` / `.leave` / `.rejected` / `.commit` / `.cancel` / `.end` | Stable |
| `os-cross-frame-drag-start` / `-end` *(cross-iframe drag bridge)* | Stable |
| `os-settings-save-lifecycle` | Stable |
| `os-default-window-changed` | Stable |
| `os-open-ai` *(plugin-dispatched; the shell listens)* | Experimental |
| `os-intros-reset` | Experimental |
| `os-note-created` *(pinned-notes hand-off from the Note Pad widget)* | Experimental |
| `os-auth-lost` / `os-auth-restored` *(session expiry / recovery)* | Stable |
| `os-desktop-theme-changed` *(whole-OS reskin activated / cleared)* | Experimental |
| `os-editor-preview-opened` / `-closed` *(editor↔preview pairing lifecycle)* | Experimental |
| `os-revisions-opened` *(revision browser opened beside its editor)* | Experimental |
| `os-desktop-host-freed` / `-docked` / `-connection` *(window set free into a real OS window)* | Experimental |

---

## `postMessage` bridge

Typed messages between the parent shell and iframe windows. Full shapes in [`bridge-protocol.md`](./bridge-protocol.md) and [`javascript-reference.md`](./javascript-reference.md).

| Message type | Direction | Status |
|---|---|---|
| `os-ready` | iframe → parent | Stable |
| `os-window-publish` | iframe → parent | Stable |
| `os-window-send` | parent → iframe | Stable |
| `os-bridge-*` *(connection-bridge family)* | both | Stable |
| `os-plugins-changed` | iframe → shell (top window) | Stable |
| `os-menu-signature` | iframe → shell (top window) | Stable |
| `os-updates-changed` *(shiny-update completion nudge)* | iframe → shell | Stable |
| `os-code-open` *(ships with the `desktop-mode-code-editor` extension)* | iframe → parent | Stable |
| `os-drag-start` / `-end` / `-payload-request` | iframe → parent | Stable |
| `os-drag-payload` *(reply to `-payload-request`)* | parent → iframe | Stable |
| `os-drag-over` / `-leave` / `os-drop` | parent → iframe | Stable |
| `os-reauth-detected` *(session re-auth nudge)* | iframe → parent | Stable |
| `os-pointer-track` *(arm / disarm the pointer forwarder; off by default)* | parent → iframe | Experimental |
| `os-pointer-move` *(cursor position inside the iframe, ~25 Hz, only while armed)* | iframe → parent | Experimental |
| `os-editor-autosave-request` / `-response` *(preview-button autosave query)* | parent → iframe / iframe → parent | Experimental |
| `os-editor-live-watch` / `-unwatch` / `-live-saved` *(typing-driven preview refresh)* | parent → iframe / parent → iframe / iframe → parent | Experimental |

---

## Where status labels live

- `wp.os.*` methods — JSDoc on each member, plus this table.
- CustomEvents — section heading in `javascript-reference.md`, plus this table.
- PHP hooks — `hooks-reference.md`.
- Web Components — `static help` block on each `<os-*>` class, plus `components-reference.md`.

When a status changes (Experimental → Stable, or anything → removed), update **all three** of: the JSDoc, this table, and the relevant per-doc reference. The doc lint guidance in `AGENTS.md` enforces this rule of thumb: a hook change without a doc update ships a lie.
