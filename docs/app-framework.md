# The App Framework — a window in one PHP file

*Status: Experimental.*

An OpenStation **app** is a window declared entirely in PHP. One file — an **`.os.php`** — says what the window is called, how big it opens, which buttons sit in its title bar and its ⋯ menu, which tabs it has, what state it keeps, what each action does, and how the body paints from `<os-*>` components. You write no JavaScript. The framework's one shared runtime mounts the window, sends your `os-action` triggers to PHP, and morphs the re-rendered body back in.

```php
<?php
// my-plugin/apps/hello/hello.os.php
use OpenStation\App;
use OpenStation\App\State;
use function OpenStation\App\Html\esc;

return App::define( 'hello' )
	->title( __( 'Hello', 'my-plugin' ) )
	->size( 420, 260 )
	->state( array( 'count' => 0 ) )
	->title_bar_button( 'reset', array( 'label' => 'Reset', 'icon' => 'reload', 'action' => 'reset' ) )
	->action( 'bump', static function ( State $state ) {
		$state->set( 'count', $state->get( 'count' ) + 1 );
	} )
	->action( 'reset', static function ( State $state ) {
		$state->reset( 'count' );
	} )
	->view( static function ( State $state ) { ?>
		<os-panel>
			<os-display size="xl" value="<?php echo esc( $state->get( 'count' ) ); ?>"></os-display>
			<os-button variant="primary" os-action="bump">Bump</os-button>
		</os-panel>
	<?php } );
```

Drop that file in a directory the framework scans (see [Where apps live](#where-apps-live)) and the window exists: a dock tile, a title bar with a Reset button, a body that counts. Ship a `hello.css` beside it and it is styled.

An app has two possible halves. The **`.os.php`** is always there: the window, the state schema, the server actions, the data. A **server view** (`->view()`) paints the body in PHP and re-renders it on every interaction — the right shape for forms, settings, dashboards, lists with actions. When an interaction must be instant — a filter over rows already in the browser — the app adds a **client view**, a **`.os.ts`** beside the `.os.php`, and the same state model moves into the browser: see [The client view](#the-client-view--osts). Either way the window, its chrome, its effects and its dispatch contract are identical.

Four of OpenStation's own windows are apps. **Code Blue** — `apps/code-blue/` — is the error-log reader, rebuilt from a PHP module plus a 1,726-line TypeScript bundle into an `.os.php` (window, actions, data) and an `.os.ts` (the body, with range / search / sort / legend / expand running locally): same features, under half the lines, every filter instant. **Station Home** — `apps/station-home/` — is the native Dashboard, and the one to read for the *server* view: an `.os.php`, a snapshot model and a body painted in PHP, no client script at all — Refresh is the built-in, the Customize picker is one state key, a switch is an action, a restore is the `show` lifecycle. Read one of them after this page.

---

## The idea

A window's body is a **function of its state**. The framework keeps that literally true:

1. The client holds a small, typed **state** bag the app declared (`->state( $defaults )`).
2. A control in the body carries `os-action="name"`. When it fires, the runtime POSTs `{ action, state, args, params, view, client }` to the app's endpoint.
3. PHP rebuilds the `State` from the declared defaults (admitting only declared keys, coercing each to its declared type), runs the action's handler, **re-renders the whole view**, and returns `{ state, html, effects }`.
4. The runtime **morphs** the new HTML into the live body — nodes are kept, attributes synced, keyed lists reordered, `os-prop-*` properties assigned — then performs the effects (a toast, a retitle, a close, a context menu).

Because the server is stateless and re-renders from scratch, there is no client model to keep in sync, no diffing logic to write, no "which paint function do I call" question. The view is the truth. Derived data — query results, parsed rows, computed totals — is computed inside the view on every render and never travels in the state.

The pattern is the one Phoenix LiveView, Laravel Livewire and Hotwire proved: the browser is a projector for server-rendered markup, with a thin, generic runtime that knows nothing about any particular app.

---

## Anatomy of an app

Everything hangs off `OpenStation\App::define( $id )`. Every method returns `$this`.

### Identity

| Method | Meaning |
|---|---|
| `title( $title )` | Window title and default icon label. |
| `icon( $icon )` | A Dashicons class, an image URL, or raw `<svg>` markup drawn in `currentColor`. |
| `size( $w, $h )` / `min_size( $w, $h )` | Initial and minimum size in px. Defaults 520×400 / 280×220. |
| `placement( 'dock' \| 'none' )` | Whether the launcher defaults to a dock tile. |
| `nav_kind( 'app' \| 'control' )`, `dock_order( $n )`, `placeable( $bool )`, `autofocus( $bool_or_selector )` | Forwarded to `openstation_register_window()`. |
| `desktop_icon( array $args )` | Also put a shortcut on the wallpaper: `position`, `pinned`, `title`, `icon`. |

### Access

| Method | Meaning |
|---|---|
| `capabilities( ...$caps )` | Capabilities the user must ALL hold. |
| `can( callable $gate )` | `function ( Os $os ): bool`. Runs after the capability check. |

Both gate the whole surface — window, icon, tabs, and dispatch endpoint. An anonymous user is always refused.

#### The gate is the only authorization there is

Three things follow from that, and all three have bitten someone:

1. **Declaring neither means "any logged-in user."** `allows()` refuses anonymous requests and nothing else, matching `openstation_register_window()`'s own default. On a site with public registration — WooCommerce, BuddyPress, a membership plugin — every customer clears that bar. An app is a REST endpoint that runs your action handlers, so `->action( 'delete_all', … )` on an ungated app is `delete_all` for all of them. **Declare `capabilities()` or `can()` on every app**, and if one action is more dangerous than the window it lives in, check `$os->can()` inside that handler too: the framework gates the app, not the action.
2. **A server view is not filtered.** The HTML an action returns goes to the browser as-is — `wp_kses` never sees it, deliberately, so views can use the whole component kit. The runtime then wires every trigger it finds in that markup, and some triggers need no user: a smuggled `<span os-poll="250" os-action="…">` dispatches on a timer, forever. So escape **everything** that came from a user, a post, an option or a plugin, with `Html\esc()` / `attr()` / `json()` — or build the node with `tag()`, which escapes every attribute it emits. A client view (`.os.ts`) escapes by construction: the `html` tag interpolates values as text, never as markup.
3. **State typing is top-level only.** `State::accept()` coerces scalars against the declared default — `0` → int, `''` → string, `false` → bool. An `array()` default only checks `is_array()`: the client may send a nested map of arbitrary keys and depth, and it is stored verbatim. `toggle_item()` and `contains()` assume a flat list of scalars and will happily be handed something else. If an action indexes into a state array, or passes one to a query, validate its shape yourself.

### State, actions, views

| Method | Meaning |
|---|---|
| `state( array $defaults )` | The schema. Only these keys exist, each with its declared type (`0` → int, `''` → string, `false` → bool, `array()` → list, `null` → anything). |
| `mount( callable )` | `function ( State $state, Os $os )`, runs once before the first render of a view. |
| `action( $name, callable )` | `function ( State $state, Os $os, array $args )`. Mutate the state; the view re-renders after. Throwing surfaces as a toast. |
| `view( callable )` | `function ( State $state, Os $os )`. The main body, rendered on the server. Echo markup (`?> … <?php`) or return a string. Omit it when the app has a client view. |
| `data( callable )` | `function ( State $state, Os $os ): array`. What a client view renders from — rows, options, environment facts. Computed after every server action and shipped as `data` in the response. |
| `client( $path )` | The built client-view script. Not needed for an app inside OpenStation (`<file>.os.ts` beside the `.os.php` is discovered and built by `npm run build:apps`); a third-party plugin passes the absolute path of its own script here — written against the runtime's client API, see below. |
| `tab( $value, array $args )` | An extra tab in the window's tab strip: `label`, `view` (callable), `position`. The main view is the first tab. Each tab panel is its own session — same declared state shape, separate values — and `$os->view` tells an action which tab dispatched it. Tabs are server views. |

> **Third-party client views.** Inside OpenStation a `.os.ts` imports
> `@openstation/app` (a Vite alias onto `src/app-runtime/client.ts`);
> that alias does not exist outside this repo, so an external plugin
> writes its client view against the **runtime's client API** instead.
> The companion script loads *before* the runtime, so it queues:
>
> ```js
> // my-plugin/apps/hello/hello-client.js — no build required.
> ( window.openStationAppsPending ??= [] ).push( ( { defineApp, html } ) => {
> 	defineApp( 'hello', {
> 		local: { pick: ( state, args ) => ( { ...state, choice: String( args.id ) } ) },
> 		view: ( { state, data } ) => html`…`,
> 	} );
> } );
> ```
>
> The runtime drains the queue on load and then replaces it with a live
> object whose `push` runs immediately — the same snippet works in any
> load order. The API handed to the callback is everything an in-repo
> `.os.ts` imports: `defineApp`, `html`, `__`/`_n`/`_x`/`sprintf`,
> `formatBytes`/`formatDate`, `createPagedList`/`applySelection`/
> `createMarquee`, `copyText` — also mirrored on `wp.os.apps` once the
> runtime is up. Register the script with `client( $path )` (absolute path;
> OpenStation serves it as the window's companion). **Server views
> (`view()`) remain the general case** and need none of this; a typed
> npm package for the client half is still tracked work — this global
> API is the supported path until then.

`State` is an `ArrayAccess` bag with `get()`, `set()`, `has()`, `toggle()`, `toggle_item( $key, $item )`, `contains( $key, $item )`, `reset( $key )`, `all()`. Setting an undeclared key is a no-op; declare it.

Three action names are built in: **`mount`** (the first render), **`set`** (a bound control changed; nothing to run, just re-render), and **`refresh`** (recompute `data()` and re-render — the action to point a Refresh button at with no handler declared; declaring one still works and wins, for the app that also resets something on the way). Five more are **lifecycle** names the runtime dispatches only when you declared a handler: **`resize`** (`$args['width']`/`['height']`, debounced), **`show`** / **`hide`** (restore / minimize), **`focus`** / **`blur`**.

### Chrome

| Method | Meaning |
|---|---|
| `title_bar_button( $id, array $args )` | A button in the window's title bar: `label`, `action` (required), `icon` (Dashicons class, inline SVG, or a built-in key such as `reload`), `placement` (`left` \| `right`), `order`, `confirm`, `args`. |
| `window_action( $id, array $args )` | A row in the window's ⋯ menu: `label`, `action`, `icon`, `order`, `confirm`, `args`. |
| `theme( array $tokens )` | Per-window CSS variables (a window theme). |
| `controls( array )` | Reorder or hide the standard window controls (`order`, `hide`). |
| `slot( $slot, $html )` | Static HTML into a title-bar slot (`before-titlebar`, `after-titlebar`, `after-title`, …). |
| `on_channel( $channel, $action )` | Dispatch `$action` (with `$args['payload']`) whenever a peer publishes on the window's channel — `wp.os.connect( id ).send( channel, payload )` or `Window.send()`. |
| `watch( ...$types )` | Re-render whenever the named content changes ANYWHERE on the desktop. The runtime subscribes to the shell's `os.<type>.changed` broadcasts (`wp.os.announceContentChange`) and re-dispatches the built-in `set` — state kept, `data()` recomputed, view repainted. A burst of changes coalesces into one refresh; a minimized window marks itself stale and catches up on restore. Pass `'*'` to watch ANY content change — the choice when the types the app shows are only known at render time (My WordPress's dynamic post-type list). The read half of the pair whose write half is the `$os->announce()` effect. |
| `config( array )` | Extra values for the client, readable as `wp.os.getWindowConfig( id ).extra`. |

`confirm` is a string (the question) or `array( 'title', 'message', 'label', 'danger' )`; the shell asks through `wp.os.confirm` before dispatching.

### Assets

`style( $path )` names a stylesheet for the body. Omit it and the framework looks for `<app dir>/<id>.css`, then `<app dir>/<file>.css` (the definition file's name without `.os.php`). The sheet is injected on the window's first open, after the runtime's own, and never reaches chromeless iframes.

The runtime sheet also carries the **tone contract**: inside an app root, any element with `data-tone` set to `danger`, `warning`, `neutral` or `info` can read the matching status colour back through `var( --os-app-tone, <fallback> )` — a severity swatch, a row's accent border. The mapping is scoped to `.os-app`, so it never retints shell chrome or admin pages outside an app window. It also ships `.os-app__spacer` (`flex: 1`), the toolbar gap filler, so apps stop re-declaring it.

### Readers

`manifest()` returns the whole window as data — every value above, normalised, plus `tabs`, `channels`, `lifecycle` and the action names — which is what the host registers and the client runtime drives from. `render( $state, $os, $view = 'main' )` returns a body. `allows( $os )` answers the gate.

---

## The view vocabulary

Inside `view()` you write ordinary HTML with `<os-*>` components (see [`components-reference.md`](./components-reference.md)) plus a handful of attributes the runtime understands:

| Attribute | Meaning |
|---|---|
| `os-action="name"` | Dispatch `name` on the element's natural event. |
| `os-bind="key"` | Write the event's value into `state[key]` first, then dispatch (`set` when no `os-action`). |
| `os-arg-foo="bar"` | Extra argument `foo` for the handler's `$args`. The event's detail (`value`, `checked`, `open`, …) is merged in too. |
| `os-on="event"` | Override the natural event. Any event a kit component emits works, plus `click`, `dblclick`, `change`, `input`, `submit`, `keydown`, `contextmenu`, `toggle`. |
| `os-keys="Enter Escape"` | With `os-on="keydown"`: only these keys dispatch (`$args['key']`, `['code']`, `['alt']`, `['ctrl']`, `['meta']`, `['shift']`). |
| `os-debounce="250"` | Coalesce rapid triggers. Typing (`os-input-change`) debounces 250 ms by default. |
| `os-confirm="…"` (+ `os-confirm-title`, `os-confirm-label`, `os-confirm-danger`) | Ask before dispatching. |
| `os-poll="30000"` | Dispatch the element's `os-action` every N ms for as long as the element is rendered. Render it conditionally and you have an auto-refresh switch. |
| `os-key="…"` | Identity for the DOM morph — put it on list items so reorders move nodes instead of rebuilding them. |
| `os-preserve` | **Server views only.** The morph never touches this subtree (a canvas a client script owns). A client view never morphs — the kit's renderer keeps identical nodes on a same-template re-render, and imperative content an app injects should be guarded by its own stamp (a `data-*` marker checked in `updated()`), not by this attribute. |
| `os-prop-foo='json'` | After every render, assign the parsed JSON to the element's **`foo` property** (kebab → camelCase). This is how property-driven components are fed from markup: `<os-table os-prop-columns='[…]' os-prop-data='[…]'>`, `<os-log os-prop-entries='[…]'>`. Unchanged values are skipped. |

**Every `<os-*>` component is usable.** Its attributes are plain HTML; its properties come through `os-prop-*`; its events come through `os-on` (the runtime listens for every event the kit emits — `tests/vitest/app-runtime-props-and-events.test.ts` scans the component sources and fails when the list falls behind). Components the shell has not defined yet are loaded on demand after the render via `wp.os.loadComponents()`.

The **natural event** per tag: `os-button`/`button`/`a` → `click`; `os-select`/`os-segmented`/`os-swatch-grid`/`os-multiselect` → `os-pick`; `os-text-field`/`os-textarea`/`os-number-field` → `os-input-change`; `os-switch` → `os-switch-change`; `os-checkbox` → `os-checkbox-change`; `os-disclosure` → `os-disclosure-toggle`; `os-tabs` → `os-tab-change`; `os-card` → `os-card-click`; `os-histogram` → `os-series-toggle`; `os-chip` → `os-chip-dismiss`; `os-table` → `os-table-row-click`; `os-form` → `os-form-submit` (`$args['values']`); `os-menu` → `os-menu-item-click`; `os-context-menu` → `os-context-menu-pick`; `os-tag-input` → `os-tag-add`; `os-category-picker` → `os-categories-change`; `os-role-picker` → `os-role-toggle`; `os-user-search` → `os-user-pick`; `os-color-field` → `os-color-change`; `os-range-field` → `os-range-change`; `os-steps` → `os-step-click`; `os-notice` → `os-notice-dismiss`; `os-modal` → `os-modal-cancel`; `details` → `toggle`; `form` → `submit` (`$args['values']`); native `input`/`select`/`textarea` → `change`; anything else → `click`.

Escape with the host-agnostic helpers in `OpenStation\App\Html`:

```php
use function OpenStation\App\Html\{ esc, attr, json, tag, classes };

<os-badge tone="<?php echo esc( $tone ); ?>"><?php echo esc( $label ); ?></os-badge>
<?php echo tag( 'os-option', array( 'value' => $id, 'disabled' => $off ), esc( $label ) ); ?>
<os-histogram series="<?php echo json( $series ); ?>"></os-histogram>
<os-table os-prop-columns="<?php echo json( $columns ); ?>" os-prop-data="<?php echo json( $rows ); ?>"></os-table>
```

`attr()` renders `true` as a bare boolean attribute, skips `false`/`null`, and JSON-encodes arrays. `tag()` escapes every attribute it emits; its inner HTML is yours to escape. Prefer `tag()` for an element whose attributes are conditional — PHPCBF reflows a multi-line `<?php echo attr( … ) ?>` inside a start tag into something ugly.

---

## `$os` — the host, as a value

Every callback receives an `OpenStation\App\Os`. It is the app's entire view of the host:

| Member | What it is |
|---|---|
| `$os->auth` | `user_id()`, `is_logged_in()`, `can( $capability )` |
| `$os->settings` | `user_preference( $key, $fallback )`, `site_option( $key, $fallback )` |
| `$os->hooks` | `filter( $hook, $value, ...$args )`, `action( $hook, ...$args )` |
| `$os->cache` | `get`, `set( $key, $value, $ttl )`, `delete` — best-effort, a miss is always safe |
| `$os->storage` | `get( $scope, $key )`, `set( $scope, $key, $value )`, `delete` — durable, `user` or `site` scope |
| `$os->env` | `constant( $name )`, `content_dir()`, `platform()`, `environment_type()`, `is_network()`, `format_datetime( $ts, $format )` |
| `$os->client` | `width` / `height` of the mount root at dispatch time |
| `$os->params` / `$os->param( $key, $fallback )` | The window's open-time params (`wp.os.openWindow( id, { params } )`) — a post id, a post type, whatever the opener passed |
| `$os->app_id`, `$os->view` | Which app and which view (`main` or a tab slug) is being dispatched |
| `$os->can()`, `$os->preference()`, `$os->filter()`, `$os->action()`, `$os->remember( $key, $ttl, $compute )` | Sugar over the contracts. `can()` takes a meta-capability's object too — `$os->can( 'delete_post', $id )` forwards to `current_user_can()`; the standalone adapter answers from the capability name alone. |
| `$os->stored( $key, $fallback, $scope = 'user' )`, `$os->store( $key, $value, $scope )`, `$os->forget( $key, $scope )` | Durable storage, keys namespaced by app id |
| `$os->toast()`, `->title()`, `->close()`, `->open( $window_id )`, `->open_url( $url, $title, $icon )`, `->badge( $count )`, `->icon( $art )`, `->announce( $type, $action, $ids )`, `->menu( $items )`, `->send( $channel, $payload )` | **Effects** — things the shell does after the morph (below) |
| `Os::page( $items, $total, $page, $per_page )` | The paged-list envelope (`items` / `total` / `pages` / `page` / `perPage`) — the one shape the client runtime's page accumulation understands. Build every list-shaped `data()` key with it. |
| `Os::facts( $rows )` | Keep only the `array( label, value, tag? )` rows whose value is non-empty, reindexed — the detail-pane facts idiom. |

Six small contracts under `OpenStation\App\Contracts` — `Auth`, `Settings`, `Hooks`, `Cache`, `Env`, `Store` — define those members. On WordPress they are implemented by `OpenStation\App\WordPress\*` (`current_user_can`, `openstation_get_os_settings`, `apply_filters`, the object cache, user meta + options, `wp_date`). On a bare PHP host — a CLI, a test, another CMS — `OpenStation\App\Standalone\*` implement them with plain arrays and an in-process hook bus. `Os::standalone()` builds the latter in one call.

This is the decoupling: the framework core (`includes/framework/` minus `wordpress.php` and `app/wordpress/`) never calls a WordPress function. An app that only talks to `$os` runs unchanged on either host. An app that also calls `__()` or `get_posts()` runs on WordPress, which is fine — it is a WordPress plugin's app — but it should reach for `$os` first.

### Effects

| Call | What the shell does |
|---|---|
| `$os->toast( $message )` | `wp.os.showToast`. There is no tone — the shell renders every toast the same way, so say what happened in the message and use `<os-notice tone="…">` in the body when a state needs a colour. |
| `$os->title( $title )` | Retitles the window |
| `$os->close()` | Closes the window |
| `$os->open( $window_id )` | Opens or focuses another native window |
| `$os->open_url( $url, $title, $icon )` | Opens an admin URL in an iframe window (an edit screen, a settings page). `$title` defaults to the page's own; `$icon` (a Dashicons class or image URL) to the shell's generic glyph |
| `$os->badge( $count )` | Sets (0 clears) the badge on the app's dock tile and desktop icon |
| `$os->icon( $art )` | Swaps the art on every rail hosting the app's tile — dock, taskbar, desktop icon. State-driven icons (the Trash app's empty/full bin); `$art` is an SVG data URI or image URL. Client views can also swap imperatively via `ctx.host.setIcon( appId, art )` — the Trash app does, from `updated()`, with both drawings shipped once through `App::config()` |
| `$os->announce( $type, $action, $ids )` | `wp.os.announceContentChange` — every window showing that content refreshes |
| `$os->menu( $items )` | A context menu at the pointer; each item (`label`, `action`, `args`, `icon`, `danger`, `disabled`) dispatches its action. Pair with `os-on="contextmenu"` on the row. |
| `$os->send( $channel, $payload )` | Publishes on the window's channel bus for `wp.os.connect( id )` peers |
| `$os->effects->add( $type, $data )` | Anything else — re-dispatched client-side as an `os-app-effect` CustomEvent for an extension to handle |

### Standalone host in three lines

```php
define( 'OPENSTATION_STANDALONE', true );
require 'includes/framework/autoload.php';

$registry = new OpenStation\App\Registry();
$registry->load_dir( __DIR__ . '/apps' );

$runtime  = new OpenStation\App\Runtime( $registry );
$response = $runtime->dispatch( 'hello', array( 'action' => 'bump', 'state' => array( 'count' => 2 ) ), OpenStation\App\Os::standalone() );
// $response = [ 'ok' => true, 'state' => [ 'count' => 3 ], 'html' => '<os-panel>…', 'effects' => [] ]

$whole = $runtime->describe( 'hello', array(), OpenStation\App\Os::standalone() );
// $whole = [ 'ok' => true, 'manifest' => [ …the entire window… ], 'state' => …, 'html' => …, 'tabs' => [ slug => html ], 'effects' => … ]
```

`describe()` is the "give me the whole window" call: the manifest plus the body (and every tab) it would paint for a state. The host moves those arrays over whatever wire it has.

**What this is and is not.** The seam is real — `includes/framework/` minus `wordpress.php` and `app/wordpress/` calls no WordPress function, and `Tests_OpenStation_AppFramework` exercises the standalone adapters. What does not exist yet is a shipped bootstrap: nothing in this repo or in CI boots a site that way, so treat the snippet above as the shape of the contract rather than a supported install mode. An app is only as portable as its own code, too — Code Blue calls `__()`, so it runs on WordPress and not on bare PHP. Apps that stay inside `$os` run on both.

---

## The client view — `.os.ts`

A server view pays one WordPress request per interaction (see [Latency](#latency--what-a-round-trip-costs)). When that is too slow for what the window does — re-filtering rows the browser already has, a search box that must answer per keystroke — the app keeps its body in the browser:

```ts
// apps/hello/hello.os.ts
import { defineApp, html, __ } from '@openstation/app';

interface State extends Record< string, unknown > { query: string; open: string[] }
interface Data { rows: Array< { id: string; title: string } > }

export default defineApp< State, Data >( 'hello', {
	// Runs in the browser: reduce the state, re-render, no request.
	local: {
		toggle: ( state, args ) => {
			const id = String( args.id );
			state.open = state.open.includes( id ) ? state.open.filter( ( x ) => x !== id ) : [ ...state.open, id ];
		},
	},
	// The body, as a function of state + data. Same html tag the kit uses.
	view: ( { state, data } ) => html`
		<os-text-field label=${ __( 'Search' ) } os-bind="query"></os-text-field>
		<ul>
			${ data.rows
				.filter( ( r ) => r.title.toLowerCase().includes( state.query.toLowerCase() ) )
				.map( ( r ) => html`<li os-action="toggle" os-arg-id=${ r.id }>${ r.title }${ state.open.includes( r.id ) ? ' ▾' : '' }</li>` ) }
		</ul>
		<os-button os-action="refresh">${ __( 'Reload' ) }</os-button>
	`,
} );
```

And in the `.os.php`, a `data()` in place of (or beside) the `view()`:

```php
->state( array( 'query' => '', 'open' => array() ) )
// No action needed for the Reload button: `refresh` is the built-in
// round trip that re-computes data().
->data( static function ( State $state, Os $os ) {
	return array( 'rows' => my_plugin_rows() );
} )
```

The rules, all of which the runtime enforces:

- **`state` is the same typed bag** the PHP side declared. The client keeps it; every server dispatch sends it and adopts what comes back.
- **`os-bind` writes are local.** Typing in the search box updates `state.query` and re-renders; nothing is sent.
- **An `os-action` that is in `local` runs in the browser; any other dispatches to PHP.** The server runs the handler, re-computes `data()`, and the client re-renders from the fresh `state` + `data`. The Reload button above is just that — the built-in `refresh`, no handler declared.
- **`data` is whatever `App::data()` returned on the last server round trip.** Keep it to what the view reads — it travels on every dispatch response.
- **The view is rendered with the kit's own `html` tag** (`src/ui/core/html.ts`) and diffed in place, so nodes survive re-renders. Triggers keep the attribute vocabulary; `@click=${ fn }` bindings also work for anything purely local.
- **Everything else is unchanged**: effects, `os-poll`, `os-confirm`, title-bar buttons, ⋯ rows, channels, lifecycle actions, `wp.os.apps.dispatch()`. `wp.os.apps.local( windowId, action, args )` runs a local action from outside.
- **`mounted( ctx )` / `updated( ctx )`** hooks exist for the rare imperative need (a `ResizeObserver`, a canvas); `ctx.root` is the mount root.

The context carries the framework's client-side services, so an app never re-implements them. **`ctx.state` and `ctx.data` are live**: reading them always answers with the current values, never a snapshot — a listener installed in `mounted()` can read `ctx.state` a hundred renders later and see the selection as it is now, not as it was at mount.

- **`ctx.dispatch( action, args, { confirm } )`** — an imperative dispatch can ask the shell's confirm dialog first, the same dialog the declarative `os-confirm` attribute uses. An action reached from a context-menu row confirms exactly like its button twin.
- **`ctx.ui( factory )`** — client-only state that must never travel to the server (an open menu, a fetch cache, an `IntersectionObserver`). One bag per mounted view, created on first call; two windows of the same app never share it. Declared state stays the schema for everything the server should echo back — `ctx.ui` is for what it must not.
- **`ctx.repaint()`** — re-render the view from the current `state` + `data`. No action, no request. The pair for `ctx.ui`: mutate the bag, repaint.
- **`ctx.fetch( path, init )`** — REST the framework way: a relative path resolves against the site's REST root, the nonce and a JSON `Accept` header ride along unless the caller set their own, and the request is attributed to the window so its loading spinner shows.
- **`ctx.host`** — the shell surface the runtime itself runs on (`toast`, `confirm`, `menu`, `openWindow`, `setBadge`, `setIcon`, …), already typed.
- **`ctx.extra`** — what the app declared with `App::config()`: static values shipped once with the window config instead of riding `data` on every response (asset URLs, feature flags, the Trash app's empty/full icon pair).

Tests build a context with `mockViewContext()` from `src/app-runtime/testing.ts` instead of hand-writing these members; its `renderedText( node )` reads the text a user would see **through shadow roots and slots**, because `textContent` stops at a shadow boundary and a view painted with kit components (`<os-stat>`'s value lives in its shadow) reads as a hole without it.

### Where does an interaction live?

The one decision every interaction needs, and the one a wrong default makes slow (a server round trip is a full WordPress request — ~235 ms on the local Docker):

| The interaction… | Lives as |
|---|---|
| Re-slices rows the browser already holds (filter, sort, search-as-you-type, expand, select) | A `local` reducer, or `os-bind` alone — never leaves the tab |
| Reads or writes server truth (save, trash, load a different source) | An `->action()` in the `.os.php` |
| Only needs fresh `data()` (a Refresh button, a poll tick) | The built-in `refresh` — no handler to declare |
| Remembers something the server must never see (an open menu, a fetch cache, an observer) | `ctx.ui()` + `ctx.repaint()` — not state at all |
| Reads one REST resource on demand (a heavy payload only one pane needs) | `ctx.fetch()` cached in `ctx.ui()` |

When in doubt: put it in `data()` and slice locally. The framework guards the two wrong turns that used to fail silently — a rendered `os-action` that nothing implements warns in the console at paint time (not at click time), and a write to a state key `App::state()` does not declare warns once with the fix in the message.

### Debugging a dispatch

A dispatch crosses more layers than a click handler ever did — trigger → binding → wire → `State` coercion → `data()` → render — so the runtime carries its own trace. `wp.os.apps.debug( windowId )` (or `debug( '*' )` for every app window) logs one collapsed console group per dispatch: the action, its arguments, the elapsed time, exactly which state keys changed and to what, and the effects that ran; local actions log a single `debug` line; failures log the error with the elapsed time. `debug( windowId, false )` turns it off.

For list windows, `@openstation/app` also ships the machinery every one of them needs:

- **`createPagedList< Row >()`** — the infinitely scrolled, server-paginated list: it accumulates `Os::page()` envelopes (per-page replacement on a watch refresh, a new key starts clean, rows deduped by id), watches a sentinel with an IntersectionObserver, loads **one page per scroll gesture** (firing disarms, a scroll re-arms, a list too short to scroll stays armed so it fills until it overflows), and sizes skeleton ghosts to the incoming page. Keep it in `ctx.ui`, feed `accumulate( key, data.list )` in the view, call `sync( { sentinel, canvas, load, repaint } )` from `updated()`, `dispose()` on teardown.
- **`applySelection( selected, order, id, { ctrl, shift } )`** — Finder-style selection math: plain click replaces, Ctrl/Cmd toggles, Shift extends from the anchor across the visual order.
- **`createMarquee( { root, canvas, select, item?, className? } )`** — the drawn selection box: starts on a press on empty canvas (never on a row), reports the intersected `data-item-id`s on every move, clears first on a plain press, and honours Ctrl/Cmd/Shift. The box wears `.os-app__marquee` from the runtime sheet unless the app passes its own class. Returns the teardown.

Beside `defineApp`, `html` and the i18n functions, `@openstation/app` exports the shared formatting primitives so every app renders the same value shapes the same way: `formatBytes( n )` (`844 B` / `12.4 MB` / `123 MB`) and `formatDate( value, style )` where `value` is an ISO string (a bare `YYYY-MM` reads as that month), epoch milliseconds, or a `Date`, and `style` is `'short' | 'long' | 'month' | 'datetime' | 'iso'`. For "N minutes ago" keep using `<os-relative-time>`.

It also exports **`copyText( text ): Promise< boolean >`** — the clipboard, honestly: the async API first, a selection-and-`execCommand` fallback on a plain-HTTP dev site or an old WebView, and a promise that resolves to whether the text is actually on the clipboard, so the toast can say "could not copy" instead of lying. Every "Copy link" / "Copy ID" in a list window should go through it rather than a bare `navigator.clipboard`, which is `undefined` in exactly the places a copy silently fails. Mirrored on `wp.os.apps.copyText` for third-party client views.

**Tables render.** The `html` tag marks child-position slots with comment nodes, so `<tr>` and `<td>` fragments interpolated inside a `<table>` stay where they are written — the HTML parser foster-parents stray *text* out of a table, and a text marker between two cells used to land the cells after it. Nest row and cell templates freely; `tests/vitest` under `src/ui/core/html-table-slots.test.ts` pins it.

Build: every `apps/<dir>/<name>.os.ts` is discovered by `vite.config.js` as the target `app:<name>` and built by `npm run build:apps` (part of `npm run build`) into `assets/js/apps/<name>[.min].js`; the host registers it as a companion script of the window, so it is in the tab before the runtime mounts. Type-checked and linted with the rest of the TypeScript; tests live beside it (`<name>.test.ts`).

What a client view does **not** change: the app is still declared in PHP, still gated in PHP, still reads and writes through `$os`, and still works with no client view at all — the server view is the general case, the client view is the fast path.

---

## Porting an existing window

The framework covers what OpenStation's native windows do today, so any of them can be rewritten as an app. Map the old pieces like this:

| In a module + bundle | In an `.os.php` |
|---|---|
| `openstation_register_window()` args | `App::define()` → `title`, `icon`, `size`, `placement`, … |
| `openstation_register_window_tab()` | `->tab( $value, … )` |
| `openstation_register_icon()` | `->desktop_icon()` |
| The `template` callback | Not needed — the view is the template |
| A REST route per operation | An `->action()` per operation; reads happen in the view |
| `wp.os.getWindowConfig()` + a REST client + `paintX()` functions | Gone — the view is a function of state |
| `registerTitleBarButton()` / `registerWindowAction()` | `->title_bar_button()` / `->window_action()` |
| `ctx.params` | `$os->param()` |
| `ctx.window.on()` / `ctx.window.send()` | `->on_channel()` / `$os->send()` |
| `ctx.onResize` / `onShow` / `onHide`, `wp.os.onWindow( focused / blurred )` | Actions named `resize` / `show` / `hide` / `focus` / `blur` |
| `wp.os.confirm` | `os-confirm` on the trigger, or `confirm` on a control |
| `showToast`, `announceContentChange`, `icons.setBadge`, context menus | Effects |
| `setInterval` refresh | `os-poll` |
| User meta / options for the window's own preferences | `$os->store()` / `$os->stored()` |
| `<os-table>` with `.columns` / `.data` set from JS | `os-prop-columns` / `os-prop-data` (server view) or `.columns=${ … }` (client view) |
| A bundle's in-memory filtering, sorting, searching over fetched rows | `data()` in PHP + `local` actions and a `view()` in the `.os.ts` |
| A window whose body is a canvas or a third-party editor (Monaco, PixiJS) | A client view whose `mounted( ctx )` hands `ctx.root` to the library; or `os-preserve` on that region under a server view |

---

## Latency — what a round trip costs

A server-view interaction is one WordPress REST request. On a local Docker with `WP_DEBUG` and `SAVEQUERIES` on, an *empty* `desktop-mode/v1` call costs about 235 ms; Code Blue's own work per dispatch — tailing and parsing 1,100 entries — is about 5 ms. The floor is WordPress bootstrap, not the app, and it is the same floor every REST-backed window already pays for its data.

Two things follow. First, the runtime never blocks on it: the current body stays interactive, `aria-busy` marks the root, the pressed `<os-button>` shows `busy`, dispatches are serialised so quick clicks land in order, typing is debounced, and components keep their own state across the morph. Second, and this is the actual answer: **an interaction that only re-slices what the browser already has should not be a request at all** — that is what the [client view](#the-client-view--osts) is for. Code Blue pays one request to read a log and none to filter it.

So the choice is per app, not per framework. Forms, settings, dashboards, lists with actions: a server view, zero JavaScript. Readers and explorers over a fetched dataset: an `.os.ts` beside the `.os.php`. Both are the same app.

---

## Where apps live

On WordPress the host (`includes/framework/wordpress.php`) does three things on `init`:

1. **@5** registers the shared runtime script + stylesheet (`openstation-app-runtime`).
2. **@10** loads every `.os.php` under the app directories — `apps/` inside OpenStation, plus whatever [`openstation_apps_directories`](./hooks-reference.md#openstation_apps_directories--experimental-filter) adds — one level of sub-folders deep, then fires [`openstation_apps_loaded`](./hooks-reference.md#openstation_apps_loaded--experimental-action) so a plugin can `$registry->add()` an `App` built in code.
3. **@20** turns every app the current user may use into a native window through `openstation_register_window()` (plus `openstation_register_window_tab()` per tab and `openstation_register_icon()` for a `desktop_icon`), after running the manifest through [`openstation_app_manifest`](./hooks-reference.md#openstation_app_manifest--experimental-filter) and the built registration args through [`openstation_app_window_args`](./hooks-reference.md#openstation_app_window_args--experimental-filter) — the latter is how a companion plugin appends its own `scripts` / `styles` handles to an app window it doesn't own (the WooCommerce integration rides the My WordPress app this way).

To ship apps from your plugin:

```php
add_filter( 'openstation_apps_directories', static function ( array $dirs ) {
	$dirs[] = __DIR__ . '/apps';
	return $dirs;
} );
```

The window id is the app id. Everything the shell knows about native windows applies: session restore, the ⋯ menu, the tab strip, live registration on plugin activation.

### Splitting a large app

An app is one `.os.php` and (optionally) one `.os.ts` — but neither has to hold everything. When either file outgrows the ~300–600-line comfort zone (the `local-rules/os-file-length` ESLint rule and the `OpenStation.Files.FileLength` PHPCS sniff start nudging at 1,000), split it into a `parts/` directory beside the entries and keep each entry as the *composition*:

```
apps/my-app/
├── my-app.os.php        # App::define(), state schema, action WIRING
├── my-app.os.ts         # defineApp(), locals, the view frame
├── my-app.css
└── parts/
    ├── sections.php     # plain .php — require_once'd from the entry
    ├── actions.php      # named functions: ->action( 'go', __NAMESPACE__ . '\go_action' )
    ├── types.ts         # plain .ts — imported from the entry
    └── views.ts
```

Three rules make this safe:

- **PHP parts are plain `.php` in the app's namespace**, pulled in with `require_once __DIR__ . '/parts/…'` from the entry. Never name a part `*.os.php` — the registry's loader globs one level of sub-folders for that suffix and would register the part as a second app. Actions can be named functions (`->action( 'name', __NAMESPACE__ . '\name_action' )`); `->data()` takes a function name too.
- **TS parts are plain `.ts` imported by the entry**; Vite bundles them into the app's one script. Never name a part `*.os.ts` — every `apps/*/*.os.ts` is its own build entry. Re-export the part's public symbols from the entry so tests (and plugins reading the bundle's types) keep one import path.
- **`parts/` is part of the app's line budget.** A split is for the reader, not for the counter — the worked example (My WordPress, `apps/my-wordpress/`) pins every source file under 1,000 lines in its suite.

### The dispatch route

`POST desktop-mode/v1/apps/<id>/dispatch` with a JSON body `{ action, view, state, args, params, client }`. Permission: logged in, app exists, `App::allows()`. Errors are `WP_Error`s: `openstation_app_not_found` (404), `openstation_app_forbidden` (403), `openstation_app_unknown_action` / `openstation_app_unknown_view` (400), `openstation_app_action_failed` (500, carrying the exception message).

### Helpers

- `openstation_app( $id )` — the registered `App`, or null.
- `openstation_app_render( $id, array $state = array() )` — the whole window as a value (`Runtime::describe()` on the WordPress host).
- `openstation_apps_registry()` / `openstation_apps_runtime()` / `openstation_apps_os()` — the request's registry, runtime and host handle.

---

## The client runtime

One bundle, `assets/js/app-runtime[.min].js`, shared by every app window and loaded on the first open of any of them. It:

- finds every app config the host shipped (`wp.os.getWindowConfig( id )` entries flagged `osApp: true`) and publishes a render callback for each on `window.openStationNativeWindows[ id ]`;
- registers the manifest's title-bar buttons and ⋯ rows through `wp.os.registerTitleBarButton()` / `wp.os.registerWindowAction()`, matched to the app's windows;
- on open, applies the declared appearance, mounts one **session per mount root** (the body, plus one per tab panel), dispatches `mount` for each, and delegates every trigger event on the roots; with a client view (`window.openStationApps[ id ]`, published by the app's `.os.ts` bundle), the main body is rendered from `( state, data )` and `local` actions / `os-bind` writes re-render without a request;
- serialises dispatches, debounces typing, asks `wp.os.confirm` when told to, marks the pressed `<os-button>` `busy`, records the pointer for `menu` effects, and swallows the native context menu on `os-on="contextmenu"` triggers;
- morphs each response (`src/app-runtime/morph.ts`), assigns `os-prop-*` properties, loads any `<os-*>` tag the shell has not defined yet, performs effects, reconciles `os-poll` timers, and pauses polling while the window is minimized or the tab hidden;
- subscribes the declared channels and lifecycle moments, dispatching the mapped actions;
- publishes **`wp.os.apps`** — `dispatch( windowId, action, args?, view? )`, `session( windowId, view? )`, `refresh()`. See [`javascript-reference.md`](./javascript-reference.md#wposapps--experimental).

---

## Files

```
includes/framework/
  autoload.php                  OpenStation\ → this directory, WordPress file naming
  class-app.php                 OpenStation\App — the definition
  app/
    class-state.php             typed, schema-bound state
    class-runtime.php           dispatch( id, request, os ) / describe( id, state, os )
    class-registry.php          apps by id; loads *.os.php
    class-os.php                the host handle
    class-effects.php           toast / title / close / open / open_url / badge / icon / announce / menu / send
    class-view.php              captures a view callable
    html.php                    esc(), attr(), json(), tag(), classes()
    contracts/                  Auth, Settings, Hooks, Cache, Env, Store
    standalone/                 pure-PHP adapters
    wordpress/                  WordPress adapters
  wordpress.php                 the WordPress host: loading, registration, REST
src/app-runtime/                the client runtime (bindings, morph, session, entry)
src/app-runtime/client.ts       what an .os.ts imports as @openstation/app: defineApp(), html, i18n
assets/css/app-runtime.css      the mount root + first-paint spinner
assets/js/apps/<name>[.min].js  built client views (npm run build:apps)
apps/code-blue/                 code-blue.os.php + code-blue.os.ts + log-reader.php + code-blue.css — the client-view reference
apps/station-home/              station-home.os.php + parts/{snapshot,view}.php + station-home.css — the server-view reference
apps/my-wordpress/, apps/trash/ the WP Explorer and Recycle Bin apps
```

Tests: `tests/phpunit/tests/appFramework.php`, `tests/phpunit/tests/codeBlue.php`, `tests/phpunit/tests/stationHomeApp.php`, `tests/vitest/app-runtime-*.test.ts`.
