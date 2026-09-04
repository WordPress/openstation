# Mobile — the phone layer

*Experimental.* On a phone the desktop becomes a phone: a home screen of app tiles, one full-screen app at a time under a slim top bar, an app switcher of swipeable cards, a five-slot tab bar, and an edge-swipe Back. Nothing is forked. The windows are the same `Window` objects the desktop manages, the tiles are the same navigation items the dock renders, and the session is the same session — a phone visit never rearranges what the desktop had open.

This document is the contract: how the mode is decided, what the phone layer does with the window manager, which hooks shape it, and what it costs.

## The mode

`wp.os.mode` answers one question — which experience is the shell rendering — with one of three values:

| Mode | Viewport | Renders |
|---|---|---|
| `desktop` | wider than 1024 px | the desktop |
| `tablet` | 768 – 1024 px | the desktop, for now — the value is reported so plugins can prepare; the tablet layout is a later phase |
| `mobile` | up to 767 px | the phone layer |

The mode is a pure function of the viewport width and the user's preference, `mobileLayout` in OpenStation Preferences → Mobile: `auto` follows the viewport, `desktop` forces the desktop on a phone (the escape hatch), `mobile` forces the phone layer anywhere (how a developer previews it). `resolveMode()` in `src/mode/index.ts` is that function; the PHP head stamp runs the same rule.

The breakpoints are inclusive at the top of each band and filterable server-side (`openstation_mode_breakpoints`), with the invariant `0 < mobile < tablet` enforced after the filter.

### Three ways to read it

```js
wp.os.mode.get();            // 'desktop' | 'tablet' | 'mobile'
wp.os.mode.isMobile();       // boolean
wp.os.mode.getPreference();  // 'auto' | 'desktop' | 'mobile'
wp.os.mode.getBreakpoints(); // { mobile: 767, tablet: 1024 }

const stop = wp.os.mode.subscribe( ( { mode, previous, preference } ) => {
    // …
}, { immediate: true } );
```

Every transition also fires the `os.mode.changed` action on the hook bus and the `os-mode-changed` CustomEvent on `document`, both with `{ mode, previous, preference }`. Detection is `matchMedia`, so a resize inside a band costs nothing; only a crossing notifies.

The effective mode is stamped on the root element as `data-os-mode`. That attribute is the one selector every mode-aware stylesheet keys on: `html[data-os-mode="mobile"] .my-plugin-panel { … }`. It is written twice — by a few bytes of inline script PHP prints in `<head>` (`openstation_print_mode_stamp()`), so the first paint on a phone is already the phone layer and never a flash of desktop, and by the mode controller once the bundle boots. The two agree by construction.

The framework only reports the mode. It never decides what an app does about it — see [event-driven-framework.md](./event-driven-framework.md).

### The display

Orthogonal to the mode, `wp.os.mode.getDisplay()` answers how the document is displayed: `standalone` as an installed app — a home-screen web app on iOS, an installed PWA in Chromium; the `display-mode: standalone` media query, or Safari's `navigator.standalone` — and `browser` in a tab. `isStandalone()` is the predicate. A phone in Safari is `mobile` + `browser`; the same phone with the app on its home screen is `mobile` + `standalone`, and that is the case in which `env( safe-area-inset-* )` describes real edges. The value is stamped on the root as `data-os-display`, by the same head stamp and the same controller as the mode, and re-stamped when the query flips (Chromium moves a tab into an app window on install). It carries no event; nothing in the shell needs to react to it, only to lay out under it.

## Under the status bar, and over the home indicator

An installed app on a phone is laid out against two system edges. The **status bar** is opaque (`apple-mobile-web-app-status-bar-style` = `black`, filterable through `openstation_pwa_status_bar_style`; see [pwa.md](./pwa.md#the-installed-app-on-a-phone)): the page starts below it, `env( safe-area-inset-top )` is 0, and the home grid's search sits a few pixels under the bar. The phone layer still pads every top surface by the inset, so a site that switches the bar to `black-translucent` gets the wallpaper under it and the content out from under it, with no other change. The **home indicator** is the bottom edge: `viewport-fit=cover` runs the page under it, and the tab bar carries `env( safe-area-inset-bottom )` as its bottom padding.

The tab bar is **fixed to the viewport's bottom edge**, not laid out as the shell's last child. The shell is a viewport-sized fixed box, and a box of that shape is exactly what mobile Safari has, more than once, ended short of the screen's bottom edge (an installed app under one iOS release drew a band of nothing under the bar). A bar fixed to the edge is right whatever the shell's box does; the shell's body keeps the bar's footprint (`--_m-tabs-total`: the items, plus the inset) clear below it, so the window card and the home grid end where the bar begins. The admin-bar height token (`--wp-admin--admin-bar--height`) is 0 on a phone, so anything that still reads it measures against a bar that is not there.

## The phone does not zoom

A pinch, a double-tap or a focused control must never scale the page: the dock, the tab bar and the window are chrome, and a zoomed shell is a shell half off screen with no way back. Three layers say so, each covering what the others cannot:

- **The viewport meta** on a shell request (`openstation_mode_viewport_meta()`) carries `maximum-scale=1` and `user-scalable=no`. Mobile Safari honours the pair for the focus zoom and, in a home-screen app, for the pinch; in a tab it has ignored them since iOS 10. Desktop browsers ignore both and keep their own zoom.
- **The zoom guard** (`src/mode/zoom-guard.ts`, installed once at boot) cancels Safari's `gesture*` events, a two-finger `touchmove` and a control-key `wheel` while the document is stamped `mobile` or `standalone`. It reads the stamps at event time, so it follows the mode and the display without a subscription, and it never runs on a desktop in a tab, where pinch-to-zoom is an accessibility affordance.
- **The stylesheet** sets `touch-action: pan-x pan-y` on the root (scroll, and nothing else, goes to the browser: no pinch, no double-tap) and raises every kit field to 16px through `--os-ui-field-font-size` / `--os-ui-field-font-size-compact` — under 16px iOS zooms the page into a focused control and never zooms back out. A plugin's own `<input>` inside a native window should be 16px on a phone for the same reason; WordPress's own admin forms inside an iframe window already are under 782px.

## What the phone layer does

The layer ships as its own bundle, `mobile[.min].js`, fetched only when the mode resolves to `mobile` (at boot on a phone, or on the first crossing into the band later). A desktop never loads it.

**Every window is full-screen.** One `os.window.geometry` filter forces `state: 'maximized'` on every open, session restore, prewarm and child open while the mode is `mobile`. On screen it is a card: inset from the edges by a few pixels, rounded and shadowed, so the desk shows around it and the app reads as something sitting on something (the switcher draws it the same way). The inset is CSS alone; the geometry the manager holds is the full work area. The window's own title bar and resize handles are hidden; drag and the double-tap-to-float are refused. The tab strip under the title (All Posts / Add New / Categories) stays and scrolls sideways: on a phone it is the in-app navigation. The geometry the filter displaces is kept, and given back to the desktop through the session (below).

**Home is `minimizeAll()`.** The layer holds no window state of its own. Its surface is *derived* from the window manager on every change: `switcher` when the sheet is open, `app` when some window on the active desktop is not minimized, `home` otherwise. Back minimizes the app; a home tile or a tab opens (or restores and focuses) its window exactly as a dock click would, through the same window id.

**The home screen** is a grid of tiles from `wp.os.getNav()` — the rails, the sidebar and the wallpaper icons folded together, deduplicated, in the user's own order, minus the entries that are on a rail only because their window is open (those belong to the switcher). A search field above it filters by title; Enter opens the first match. Badges are the dock's badges, and a tile wears the art its rail tile wears (`setArt` — the Trash tile is drawn full while the bin holds something, on the phone as on the desk; the grid repaints on `os/art-changed`). The grid always scrolls by at least one pixel: a phone only rubber-bands a surface that can scroll, so a home screen that fits its screen would otherwise be a dead surface under the thumb. The overflow is structural (`.os-mobile-home__content`), and the bounce is the platform's own.

**The tab bar** has five slots: Home, up to three pinned apps, and the switcher, labelled *Open apps* (the same words as the sheet it opens, so it is not confused with the Apps section of the home grid) with the number of open apps drawn inside a rounded square, the browser tab-switcher glyph, or the windows icon when nothing is open. The pins come from the user's `mobileTabs` setting, else from the `openstation_mobile_tab_bar` filter's default (Posts, Media, Comments). A pin that resolves is the whole answer — one pin is one tab, the bar never pads it — and only when no pin resolves at all does the navigation's own order fill the bar. Preferences → Mobile shows the effective pins ticked, defaults included, so unticking one keeps the others. The Exit control and ephemeral entries are never tabs. A flick up on the bar opens the switcher.

**The switcher** is also the phone's Overview: the desktop's zoom-out grid has no desk to zoom out of here. The Overview tile is not shown on a phone (the switcher is already in the tab bar), and any remaining route into it — a plugin calling `windowManager.enterOverview()` — opens the switcher instead. The bare-arrow desktop shortcuts (previous and next desktop, Overview, Show Desktop) are off on a phone too: one screen, no virtual desktops, and a hardware keyboard's arrows belong to the page. It is a sheet holding every open window as a card in a deck: each card is drawn as a small window (a title bar over a body) and the deck is laid out bottom-up, the app on screen in front and nearest the thumb, the others behind it peeking out above with their titles showing, so the pile is the picture of what the switcher holds. Tap a card to go to it, swipe it sideways to close it (the window's unsaved-changes guard still applies), × does the same for keyboards and screen readers, *Close all* at the bottom asks first. It is a dialog: focus moves in, returns on close, Escape closes. Closing the last card closes the sheet too — an empty switcher over a hidden home is a dead end — while opening it from an empty home still shows its empty message, since nothing emptied.

**No drag and drop.** A phone has no floating windows to drag between and no file manager to drag from, and a finger on a tile, a row or a card is a tap or a scroll. `DragManager.start()` refuses the phone, which covers every shell drag at once — wallpaper tiles, `<os-tile drag-kind>`, WP Explorer's rows and agent cards, the plugin cards, the notes, the cross-window bridge — and the three gestures that are not manager sessions refuse it themselves: the dock's reorder, the OS file-drop sentinel and manager (the lazy bundle is never fetched; the no-op still cancels the browser's open-file navigation), and WP Explorer's marquee. Drop targets stay registered; nothing reaches them. The window's own drag was already refused.

**Narrow apps.** Native windows that were laid out for a desktop's width fold under a narrow container (`@container` on the app root, so a desktop window pulled in folds the same way):

- **Every list is a card per row.** A table on a phone is a scroll under a thumb in two directions with a pinned column fighting one of them, so the five list windows do not show one: `<os-table stacked>` lays each row out as a card — the title, then the other columns as captioned lines, then the row's actions as full-size buttons — with the checkbox a 44px target along the leading edge (`src/ui/components/os-table/stack-on-phone.ts` makes the decision from the mode stamp; the desk keeps its grid). The selection's actions move out of the toolbar into a **bar along the bottom** of the window, where the thumb is and where they stay while the list scrolls, clearing the home indicator on an installed app.
- **Trash** (`apps/trash/`) is that card list with the search leading the toolbar and the type chips scrolling under it; the row buttons print their labels (Restore, Delete forever), the title may take two lines, and Pin to desktop is not offered — a phone has no desktop. In a narrow *desk* window the table now scrolls sideways inside its own frame, where it used to be clipped by the body (the flex minimum that did that is 0).
- **Posts, Pages and Users** show the title with the author and the date (a page: its parent), and a person with their email, role, last login and actions, as captioned lines under the name — more than the grid could fit, because a line needs no width. The narrowing still runs after the user's hidden-column list and the columns filter, so a phone's rule hides nothing on the desk. The status filter is an `<os-select>` in place of the pill bar (same data attribute, same `os-pick`; `src/posts-window/status-control.ts`), and the toolbar gives it and the search a row each. The Categories mind map and the Tags cloud fold their 320px editor **under** the stage, as a sheet of at most half the height that is there only while a term is focused — the stage has the whole screen until then.
- **Plugins** shows the name, the status, the version, the author and the actions; the size and the auto-update switch stay in the row's detail panel, which still opens on a tap.
- **WP Explorer**'s opened item is a **page of its own** on a phone, pushed over the list, with Back in the header closing it and the trail one step longer (site › Posts › the item); its actions stack full width. On a desk it is the pane beside the list as before. That is what *Navigate into* on the context menu opens for a person, a media item or a flat section's row (a post's *Navigate into* is the detail folder, on both); a preview sheet along the bottom read as a look at the thing rather than the thing. On a phone (the mode stamp), and under any coarse primary pointer, **one tap opens**: a row or tile opens its editor (a person, their footprint), a row that cannot be edited opens its page, a folder tile opens the folder. The Finder semantics — click selects, double click opens — stay everywhere a pointer can double click. **A long press is the right-click**: a finger (or pen) held still for half a second on a row, a tile or the empty canvas opens the same context menu a right-click does, where the finger is, and the release is not a tap (`apps/my-wordpress/parts/long-press.ts`; iOS never turns a held finger into a `contextmenu` event, so the press is read from Pointer Events). The browser's own callout and text selection are off on those surfaces under a coarse pointer.
- **Code Blue** page-scrolls as one surface instead of pinning its toolbar, tiles and chart and leaving the issue list a 120px scroller of its own.
- **OpenStation Preferences** replaces the sidebar with an `<os-select>` of the same pages across the top (both bind the same `tab` state; the strip stays in the DOM to drive the panes) and tightens the pane's inset.
- **Comments** shows one pane at a time: the list of conversations, then — on a tap — the conversation, with a Back control in its head. The five status tabs become an `<os-select>` with the counts in the labels. The list's own auto-select of the first thread never switches panes; only a tap does. The window stamps the pane on its root as `data-os-comments-pane`; at a wide width the stamp changes nothing.
- **Corkboard** pinches: two fingers on the board zoom about their midpoint and pan with it (`src/content-graph/pinch.ts`), the same anchoring the wheel uses. The canvas takes `touch-action: none`, so the gesture is the board's rather than the browser's; a finger lifting off a pinch is not a tap on the node it rested on.

**Gestures.** A drag in from the left edge is Back; the zone is a thin strip the shell owns over the iframe's edge, which is why it works over a frame the shell cannot otherwise hear. A matching strip on the right edge does nothing of its own; both cancel the `touchstart` that would begin the **browser's** history swipe (`bindHistorySwipeGuard`), which mobile Safari and Chrome for Android otherwise read as "leave this page", and both stay up on the home screen for the same reason. The hardware Back button is Back too, through one `history` entry the layer pushes when an app opens. A flick up on the tab bar opens the switcher. The gestures use Pointer Events, so a pen or a mouse drag behaves the same as a finger; the swipe guard alone listens to `touchstart`, because that is the only event the browser's gesture can be cancelled from.

**The top bar** is the app's identity, icon and title, drawn on the desk rather than on the window (no fill of its own; the window card starts below it), and one round control: ×, which closes the app. It morphs the app back into its tile and acts in the same frame: the window is minimized first and the close handshake (an iframe page may be asked about unsaved changes) finishes behind the transition, so the screen never waits on it. There is no minimize, no Back and no menu: leaving an app with its window kept is the system's job on a phone (the tab bar's Home, the edge swipe, the hardware Back, a flick down on the bar), closing lives in the switcher, and reload is the pull-to-refresh that is still to come. The window's own title bar, its controls and its plugin-registered buttons are not shown.

## The session on a phone

Restoring a desktop's worth of windows on a phone would mean a desktop's worth of iframes. A phone boot restores **one** window, the session's focused one, and parks the rest. The phone does not list them: they belong to the desktop, and the switcher shows only what is open on the phone.

**A phone has one desk.** Virtual desktops and workspaces are a desktop's way of putting things side by side, and a phone has no side. While the mode is `mobile`, every window is on the active desk: a window that arrives carrying another desk — the session's focused window restored from the desk it was on, a parked recent reopened from the switcher — is moved onto the active one as it opens (`manager.moveWindowToDesktop()`, which fires `os.os.window-moved`), and everything already open is moved on the crossing into the band. Nothing else a workspace does happens on a phone: its narrowed app list is not applied (the home grid shows every app whatever desk is active), its look is not painted over the user's settings, its widget column is not put up, and its launch list is not opened. The desk each window came from is remembered and written back into every session save, and on the crossing out every window goes back to its desk, the desk's look and launch list are applied, and the rails narrow again — so the desktop finds its desks exactly as it left them, and a desk that never had its launch list opened on the phone gets it on arrival.

The desktop is not degraded by this. `WindowManager.snapshot()` runs the `os.session.snapshot` filter last, and the phone layer uses it to hand the desktop its own numbers back: a window the phone forced full-screen is written with the geometry and state it had before, and the parked windows are folded back into every save. A window the phone opened itself has no desktop geometry to keep (a fresh open on a 390px viewport gets phone-sized defaults), so it is saved as `unplaced` and the desktop places it as it would a fresh open: its own default size, cascaded. Widening a phone-sized browser back past the breakpoint does the same. A desktop reload after a phone visit finds exactly what it left, plus what the phone opened, at desktop sizes.

The filter is public. A plugin can use it to redact a window it owns from the saved session, or to pin one it never wants restored:

```js
wp.hooks.addFilter( 'os.session.snapshot', 'my-plugin/session', ( session ) => ( {
    ...session,
    windows: session.windows.filter( ( w ) => w.id !== 'my-plugin-scratch' ),
} ) );
```

## What it costs

The always-on bundle gains the mode primitive, the constraints and the loader — a few kilobytes. On a phone:

- the phone layer bundle loads once (a `prefetch` hint is emitted when the server guesses a phone from the user agent, never as a decision);
- the wallpaper is suspended through `wp.os.wallpaper.suspend( 'openstation/mobile' )` for as long as the layer is mounted — the frozen frame stays under the home grid, the ticker stops;
- widgets are not hydrated (the column is hidden; the first crossing into the desktop band hydrates them);
- only the topmost window paints (`content-visibility: hidden` on the rest; a minimized window already hides its iframe);
- one iframe on boot, not the saved session's.

## Hooks

PHP — see [hooks-reference.md](./hooks-reference.md#responsive-mode--experimental):

| Hook | What it shapes |
|---|---|
| `openstation_mode_preference` | the user's `auto` / `desktop` / `mobile` before it reaches the shell and the head stamp |
| `openstation_mode_breakpoints` | `{ mobile, tablet }` in CSS px |
| `openstation_mobile_tab_bar` | the default pins, as navigation ids |

JavaScript — see [javascript-reference.md](./javascript-reference.md):

| Surface | Kind |
|---|---|
| `wp.os.mode` | API |
| `os.mode.changed` | action |
| `os-mode-changed` | CustomEvent |
| `os.session.snapshot` | filter |
| `os.os.window-moved` | action — a window folded onto the phone's one desk, or handed back |
| `data-os-mode` on `<html>` | the CSS hook |
| `data-os-display` on `<html>` | the CSS hook for `standalone` / `browser` |

PHP, the installed app — see [hooks-reference.md](./hooks-reference.md#progressive-web-app): `openstation_pwa_status_bar_style`.

Settings: `mobileLayout`, `mobileTabs` — both through `wp.os.updateOsSettings()` like every other key.

## Not yet

- **Tablet.** Reported, not laid out. Split view and slide-over are the next phase on the same primitive.
- **Pull-to-refresh.** Needs the chromeless bridge to report overscroll from inside the iframe. Until then a reload is a close and a reopen. (A new *release* needs no reload at all: the installed app checks for a new service worker every time it comes to the front — see [pwa.md](./pwa.md#how-a-release-reaches-an-installed-app).)
- The layer closes nothing on its own; the switcher makes closing one gesture.

## Files

`src/mode/` (the primitive, `stamp.ts` is the import-free leaf other bundles read, `zoom-guard.ts` the pinch guard), `src/mobile/` (`constraints.ts`, `loader.ts`, `open-nav-item.ts` in the main bundle; `entry.ts`, `layer.ts`, `home.ts`, `tab-bar.ts`, `switcher.ts`, `top-bar.ts`, `gestures.ts` in the phone bundle), `assets/css/mobile.css`, `includes/mobile.php`, `apps/os-settings/parts/mobile.ts`. Tests: `tests/vitest/mode.test.ts`, `tests/vitest/mode-display.test.ts`, `tests/vitest/zoom-guard.test.ts`, `tests/vitest/mobile-*.test.ts` (`mobile-viewport.test.ts` is the stylesheet contract above), `tests/phpunit/tests/mobileMode.php`, `tests/phpunit/tests/openStationPwaStatusBarStyle.php`.
