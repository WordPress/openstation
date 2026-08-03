# Example: native window with tabs

Two ways to add tabs to a native window:

1. **[PHP-only (zero template boilerplate)](#option-a-php-only-registration)** — register the window, then register extra tabs with `open_station_register_window_tab()`. The shell emits the `<os-tabs>` + `<os-tabpanel>` markup for you. Matches the legacy iframe-window DX where submenus auto-become tabs.
2. **[Hand-rolled markup (still supported)](#option-b-hand-rolled-os-tabpanel)** — write the `<os-tabs>` + `<os-tabpanel>` elements directly in your template callback. Auto-swap via `<os-tabpanel>` (from `0.5.0`) still handles pane visibility — you just author the tab strip yourself.

Pick option A for the common case (static tab list, one plugin owns the window). Pick option B when you need dynamic tabs, conditional panes, or custom layouts the auto-wrap can't express.

## Option A: PHP-only registration

`jorvy/jorvy.php`:

```php
<?php
/**
 * Plugin Name: Jorvy with tabs
 */
defined( 'ABSPATH' ) || exit;

open_station_register_window( 'jorvy', array(
    'title'          => __( 'Jorvy', 'jorvy' ),
    'main_tab_label' => __( 'Quotes', 'jorvy' ),  // first tab label; falls back to `title`
    'icon'           => 'dashicons-star-filled',
    'width'          => 340,
    'height'         => 240,
    'script'         => 'jorvy-main',
    'template'       => function () {
        ?>
        <p class="jorvy__quote"></p>
        <cite class="jorvy__attr"></cite>
        <?php
    },
) );

open_station_register_window_tab( 'jorvy', array(
    'value'    => 'about',
    'label'    => __( 'About', 'jorvy' ),
    'position' => 10,
    'template' => function () {
        ?>
        <os-stack gap="6">
            <p><?php esc_html_e( 'A random Marvel quote, rotated every 10 seconds.', 'jorvy' ); ?></p>
            <p><?php esc_html_e( 'Quotes are hard-coded — no network calls.', 'jorvy' ); ?></p>
        </os-stack>
        <?php
    },
) );
```

That's the entire tab-strip wiring. The shell produces this rendered template automatically:

```html
<template id="os-native-window-jorvy">
    <os-stack gap="12" padding="16">
        <os-tabs value="main">
            <os-tab value="main">Quotes</os-tab>
            <os-tab value="about">About</os-tab>
        </os-tabs>
        <os-tabpanel for="main">
            <p class="jorvy__quote"></p>
            <cite class="jorvy__attr"></cite>
        </os-tabpanel>
        <os-tabpanel for="about" hidden>
            <!-- About pane markup -->
        </os-tabpanel>
    </os-stack>
</template>
```

`<os-tabpanel>` auto-swap handles visibility — non-active panels arrive with `hidden` pre-stamped so first paint is correct regardless of upgrade order. `role="tablist"` / `role="tab"` / `role="tabpanel"` wired by the components. The wrap's `padding="16"` is configurable via the `main_tab_padding` registration arg or the `open_station_native_window_tab_wrap_padding` filter.

### Companion-plugin extension

Another plugin can attach tabs to Jorvy's window without coordinating — a good test case is a Stats tab that only exists when an analytics plugin is active:

```php
// jorvy-stats/jorvy-stats.php
open_station_register_window_tab( 'jorvy', array(
    'value'    => 'stats',
    'label'    => __( 'Stats', 'jorvy-stats' ),
    'position' => 20,
    'script'   => 'jorvy-stats',
    'template' => function () {
        ?>
        <os-stack gap="8">
            <os-display size="xl" data-hook="quote-count">—</os-display>
            <p><?php esc_html_e( 'Quotes shown this session.', 'jorvy-stats' ); ?></p>
        </os-stack>
        <?php
    },
) );
```

Deactivate the analytics plugin → the Stats tab disappears on the next window open. No shell reload. No coordination between the two plugins.

### The single JS render callback still owns behaviour

The shell still calls `window.openStationNativeWindows.jorvy(body)` once per window open — `body` contains the whole auto-generated tab tree. The plugin's JS scopes per-pane work via `body.querySelector`:

```js
window.openStationNativeWindows.jorvy = function ( body ) {
    const quote = body.querySelector( 'os-tabpanel[for="main"] .jorvy__quote' );
    const attr  = body.querySelector( 'os-tabpanel[for="main"] .jorvy__attr' );

    const QUOTES = [
        { q: 'I am Iron Man.',  by: 'Tony Stark' },
        { q: 'On your left.',   by: 'Captain America' },
        { q: 'I love you 3000.', by: 'Morgan Stark' },
    ];
    const render = () => {
        const pick = QUOTES[ Math.floor( Math.random() * QUOTES.length ) ];
        quote.textContent = '"' + pick.q + '"';
        attr.textContent  = '— ' + pick.by;
    };
    render();
    const timer = setInterval( render, 10000 );
    return () => clearInterval( timer );
};
```

Tabs that ship static markup need no JS at all — the About pane in the example above is pure HTML.

### When a tab needs its own JS module

Pass `script` on the tab registration. The shell enqueues the handle whenever the desktop shell loads (alongside the window's own script):

```php
open_station_register_window_tab( 'jorvy', array(
    'value'    => 'stats',
    'label'    => __( 'Stats', 'jorvy-stats' ),
    'template' => 'jorvy_stats_template',
    'script'   => 'jorvy-stats',  // enqueued when the shell loads
) );
```

The stats script can then wire its own pane in isolation (it only looks inside `os-tabpanel[for="stats"]`).

---

## Option B: hand-rolled `<os-tabpanel>`

Useful when Option A is too prescriptive — e.g. you want panels wrapped in a custom card, or dynamic tabs that change based on server state the shell doesn't know about.

Earlier versions of the kit shipped `<os-tabs>` + `<os-tab>` but left pane management as homework — every multi-tab native window ended up copying the same `os-tab-change` listener and `panel.hidden = …` ladder. The `<os-tabpanel>` auto-swap (from `0.5.0`) removes that half.

## The pattern

```html
<os-stack gap="12">
    <os-tabs value="calc" label="Calculator mode">
        <os-tab value="calc">Calc</os-tab>
        <os-tab value="convert">Convert</os-tab>
    </os-tabs>
    <os-tabpanel for="calc">
        <!-- calculator UI -->
    </os-tabpanel>
    <os-tabpanel for="convert">
        <!-- converter UI -->
    </os-tabpanel>
</os-stack>
```

That is the whole wiring. Clicking a tab flips `hidden` on the matching `<os-tabpanel>` for you. The inactive pane gets `aria-hidden="true"`, the active one is focusable (`tabindex="0"`).

## What the shell does for you

| Concern | Handled by | Notes |
|---|---|---|
| `aria-selected` mirroring | `<os-tabs>` | Active tab gets `true`, others `false`. |
| `role="tab"` / `role="tablist"` | `<os-tabs>` / `<os-tab>` | Applied in the component's `connectedCallback`. |
| `role="tabpanel"` | `<os-tabpanel>` | Set on connect. |
| `hidden` toggling | `<os-tabpanel>` | On every `value` change of the sibling `<os-tabs>`. |
| `aria-hidden` mirroring | `<os-tabpanel>` | Matches `hidden`. |
| Focus ring when panel gains keyboard focus | `<os-tabpanel>` | `tabindex="0"` + accent outline. |
| `os-tab-change` event | `<os-tabs>` | Still fires — use it for side effects (telemetry, URL sync). |

## Full native-window example

`my-plugin/my-plugin.php`:

```php
<?php
/**
 * Plugin Name: Two-tab Demo
 */
defined( 'ABSPATH' ) || exit;

open_station_register_window( 'two-tab-demo', array(
    'title'  => __( 'Two-tab Demo', 'my-plugin' ),
    'icon'   => 'dashicons-layout',
    'width'  => 480,
    'height' => 360,
    'script' => 'two-tab-demo',
    'template' => function () {
        ?>
        <os-stack gap="12" style="padding:16px;">
            <os-tabs value="hello" label="Demo mode">
                <os-tab value="hello">Hello</os-tab>
                <os-tab value="form">Form</os-tab>
            </os-tabs>

            <os-tabpanel for="hello">
                <os-display size="xl">Hello, world.</os-display>
            </os-tabpanel>

            <os-tabpanel for="form">
                <os-stack gap="10">
                    <os-text-field
                        label="<?php esc_attr_e( 'Name', 'my-plugin' ); ?>"
                        placeholder="<?php esc_attr_e( 'Who are you?', 'my-plugin' ); ?>"
                        autocomplete="name"
                    ></os-text-field>
                    <os-number-field
                        label="<?php esc_attr_e( 'Favourite number', 'my-plugin' ); ?>"
                        value="42"
                        min="0"
                        max="999"
                    ></os-number-field>
                    <os-select label="<?php esc_attr_e( 'Favourite colour', 'my-plugin' ); ?>" value="blue">
                        <os-option value="blue"><?php esc_html_e( 'Blue', 'my-plugin' ); ?></os-option>
                        <os-option value="green"><?php esc_html_e( 'Green', 'my-plugin' ); ?></os-option>
                        <os-option value="red"><?php esc_html_e( 'Red', 'my-plugin' ); ?></os-option>
                    </os-select>
                    <os-checkbox label="<?php esc_attr_e( 'Subscribe', 'my-plugin' ); ?>" value="subscribe"></os-checkbox>
                </os-stack>
            </os-tabpanel>
        </os-stack>
        <?php
    },
) );

add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'open_station_is_enabled' ) || ! open_station_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'two-tab-demo',
        plugin_dir_url( __FILE__ ) . 'two-tab-demo.js',
        array( 'openstation' ),
        '1.0.0',
        true
    );
} );
```

`my-plugin/two-tab-demo.js`:

```js
( function () {
    window.openStationNativeWindows = window.openStationNativeWindows || {};
    window.openStationNativeWindows[ 'two-tab-demo' ] = function ( body ) {
        // The shell has already rendered tabs + panels from the PHP
        // template. You only write JS for the per-pane behaviour you
        // actually care about — NOT the tab/pane wiring.

        body.querySelector( 'os-text-field' )
            .addEventListener( 'os-input-commit', ( e ) => {
                console.log( 'name:', e.detail.value );
            } );

        body.querySelector( 'os-number-field' )
            .addEventListener( 'os-input-commit', ( e ) => {
                console.log( 'fav number:', e.detail.value );
            } );

        // Optional: react to tab changes for telemetry, URL sync,
        // whatever. The auto-swap already happened by the time this
        // event fires.
        body.querySelector( 'os-tabs' )
            .addEventListener( 'os-tab-change', ( e ) => {
                console.log( 'tab →', e.detail.value );
            } );
    };
} )();
```

## Before → after

### Before (hand-wired panes)

```php
open_station_component( 'os-tabs', [ 'value' => 'calc' ], $tab_children );
open_station_component( 'os-stack', [ 'data-pane' => 'calc', 'gap' => 8 ], $calc_children );
open_station_component( 'os-stack', [ 'data-pane' => 'convert', 'gap' => 6, 'hidden' => true ], $convert_children );
```

```js
var activeTab = 'calc';
tabs.addEventListener( 'os-tab-change', function ( e ) {
    activeTab = e.detail.value || 'calc';
    calcPane.hidden = 'calc' !== activeTab;
    convPane.hidden = 'convert' !== activeTab;
} );
```

`data-pane="…"` was every plugin's private invention — three plugins picked three different conventions. ARIA roles had to be remembered and wired by hand.

### After (registered window tabs)

```html
<os-tabs value="calc">
    <os-tab value="calc">Calc</os-tab>
    <os-tab value="convert">Convert</os-tab>
</os-tabs>
<os-tabpanel for="calc">…</os-tabpanel>
<os-tabpanel for="convert">…</os-tabpanel>
```

Zero JS for the tabs. Zero private conventions. `role="tablist"` / `role="tab"` / `role="tabpanel"` wired for free.

## When the manual path still makes sense

The auto-swap is opt-in — using `<os-tabpanel>` is what activates it. If you have an unusual layout (panels nested multiple levels deep, conditional pane types, a custom transition), keep listening for `os-tab-change` and swap whatever-you-like by hand. `<os-tabs>` fires the event in both modes.

## Related docs

- [`<os-tabs>`, `<os-tab>`, `<os-tabpanel>`](../components-reference.md#tabs--navigation) — component reference (props/events via each class's `static help`).
- [`<os-text-field>`, `<os-number-field>`](../components-reference.md#form-controls) — the form primitives used in the example.
- [`docs/examples/register-icon.md`](./register-icon.md) — companion-plugin pattern for adding a wallpaper shortcut that opens the native window.
