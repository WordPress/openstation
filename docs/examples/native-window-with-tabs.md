# Example: native window with tabs

Two ways to add tabs to a native window:

1. **[PHP-only (zero template boilerplate)](#option-a-php-only-registration)** — register the window, then register extra tabs with `desktop_mode_register_window_tab()`. The shell emits the `<wpd-tabs>` + `<wpd-tabpanel>` markup for you. Matches the legacy iframe-window DX where submenus auto-become tabs.
2. **[Hand-rolled markup (still supported)](#option-b-hand-rolled-wpd-tabpanel)** — write the `<wpd-tabs>` + `<wpd-tabpanel>` elements directly in your template callback. Auto-swap via `<wpd-tabpanel>` (from `0.5.0`) still handles pane visibility — you just author the tab strip yourself.

Pick option A for the common case (static tab list, one plugin owns the window). Pick option B when you need dynamic tabs, conditional panes, or custom layouts the auto-wrap can't express.

## Option A: PHP-only registration

`jorvy/jorvy.php`:

```php
<?php
/**
 * Plugin Name: Jorvy with tabs
 */
defined( 'ABSPATH' ) || exit;

desktop_mode_register_window( 'jorvy', array(
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

desktop_mode_register_window_tab( 'jorvy', array(
    'value'    => 'about',
    'label'    => __( 'About', 'jorvy' ),
    'position' => 10,
    'template' => function () {
        ?>
        <wpd-stack gap="6">
            <p><?php esc_html_e( 'A random Marvel quote, rotated every 10 seconds.', 'jorvy' ); ?></p>
            <p><?php esc_html_e( 'Quotes are hard-coded — no network calls.', 'jorvy' ); ?></p>
        </wpd-stack>
        <?php
    },
) );
```

That's the entire tab-strip wiring. The shell produces this rendered template automatically:

```html
<template id="desktop-mode-native-window-jorvy">
    <wpd-stack gap="12" padding="16">
        <wpd-tabs value="main">
            <wpd-tab value="main">Quotes</wpd-tab>
            <wpd-tab value="about">About</wpd-tab>
        </wpd-tabs>
        <wpd-tabpanel for="main">
            <p class="jorvy__quote"></p>
            <cite class="jorvy__attr"></cite>
        </wpd-tabpanel>
        <wpd-tabpanel for="about" hidden>
            <!-- About pane markup -->
        </wpd-tabpanel>
    </wpd-stack>
</template>
```

`<wpd-tabpanel>` auto-swap handles visibility — non-active panels arrive with `hidden` pre-stamped so first paint is correct regardless of upgrade order. `role="tablist"` / `role="tab"` / `role="tabpanel"` wired by the components. The wrap's `padding="16"` is configurable via the `main_tab_padding` registration arg or the `desktop_mode_native_window_tab_wrap_padding` filter.

### Companion-plugin extension

Another plugin can attach tabs to Jorvy's window without coordinating — a good test case is a Stats tab that only exists when an analytics plugin is active:

```php
// jorvy-stats/jorvy-stats.php
desktop_mode_register_window_tab( 'jorvy', array(
    'value'    => 'stats',
    'label'    => __( 'Stats', 'jorvy-stats' ),
    'position' => 20,
    'script'   => 'jorvy-stats',
    'template' => function () {
        ?>
        <wpd-stack gap="8">
            <wpd-display size="xl" data-hook="quote-count">—</wpd-display>
            <p><?php esc_html_e( 'Quotes shown this session.', 'jorvy-stats' ); ?></p>
        </wpd-stack>
        <?php
    },
) );
```

Deactivate the analytics plugin → the Stats tab disappears on the next window open. No shell reload. No coordination between the two plugins.

### The single JS render callback still owns behaviour

The shell still calls `window.desktopModeNativeWindows.jorvy(body)` once per window open — `body` contains the whole auto-generated tab tree. The plugin's JS scopes per-pane work via `body.querySelector`:

```js
window.desktopModeNativeWindows.jorvy = function ( body ) {
    const quote = body.querySelector( 'wpd-tabpanel[for="main"] .jorvy__quote' );
    const attr  = body.querySelector( 'wpd-tabpanel[for="main"] .jorvy__attr' );

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
desktop_mode_register_window_tab( 'jorvy', array(
    'value'    => 'stats',
    'label'    => __( 'Stats', 'jorvy-stats' ),
    'template' => 'jorvy_stats_template',
    'script'   => 'jorvy-stats',  // enqueued when the shell loads
) );
```

The stats script can then wire its own pane in isolation (it only looks inside `wpd-tabpanel[for="stats"]`).

---

## Option B: hand-rolled `<wpd-tabpanel>`

Useful when Option A is too prescriptive — e.g. you want panels wrapped in a custom card, or dynamic tabs that change based on server state the shell doesn't know about.

Earlier versions of the kit shipped `<wpd-tabs>` + `<wpd-tab>` but left pane management as homework — every multi-tab native window ended up copying the same `wpd-tab-change` listener and `panel.hidden = …` ladder. The `<wpd-tabpanel>` auto-swap (from `0.5.0`) removes that half.

## The pattern

```html
<wpd-stack gap="12">
    <wpd-tabs value="calc" label="Calculator mode">
        <wpd-tab value="calc">Calc</wpd-tab>
        <wpd-tab value="convert">Convert</wpd-tab>
    </wpd-tabs>
    <wpd-tabpanel for="calc">
        <!-- calculator UI -->
    </wpd-tabpanel>
    <wpd-tabpanel for="convert">
        <!-- converter UI -->
    </wpd-tabpanel>
</wpd-stack>
```

That is the whole wiring. Clicking a tab flips `hidden` on the matching `<wpd-tabpanel>` for you. The inactive pane gets `aria-hidden="true"`, the active one is focusable (`tabindex="0"`).

## What the shell does for you

| Concern | Handled by | Notes |
|---|---|---|
| `aria-selected` mirroring | `<wpd-tabs>` | Active tab gets `true`, others `false`. |
| `role="tab"` / `role="tablist"` | `<wpd-tabs>` / `<wpd-tab>` | Applied in the component's `connectedCallback`. |
| `role="tabpanel"` | `<wpd-tabpanel>` | Set on connect. |
| `hidden` toggling | `<wpd-tabpanel>` | On every `value` change of the sibling `<wpd-tabs>`. |
| `aria-hidden` mirroring | `<wpd-tabpanel>` | Matches `hidden`. |
| Focus ring when panel gains keyboard focus | `<wpd-tabpanel>` | `tabindex="0"` + accent outline. |
| `wpd-tab-change` event | `<wpd-tabs>` | Still fires — use it for side effects (telemetry, URL sync). |

## Full native-window example

`my-plugin/my-plugin.php`:

```php
<?php
/**
 * Plugin Name: Two-tab Demo
 */
defined( 'ABSPATH' ) || exit;

desktop_mode_register_window( 'two-tab-demo', array(
    'title'  => __( 'Two-tab Demo', 'my-plugin' ),
    'icon'   => 'dashicons-layout',
    'width'  => 480,
    'height' => 360,
    'script' => 'two-tab-demo',
    'template' => function () {
        ?>
        <wpd-stack gap="12" style="padding:16px;">
            <wpd-tabs value="hello" label="Demo mode">
                <wpd-tab value="hello">Hello</wpd-tab>
                <wpd-tab value="form">Form</wpd-tab>
            </wpd-tabs>

            <wpd-tabpanel for="hello">
                <wpd-display size="xl">Hello, world.</wpd-display>
            </wpd-tabpanel>

            <wpd-tabpanel for="form">
                <wpd-stack gap="10">
                    <wpd-text-field
                        label="<?php esc_attr_e( 'Name', 'my-plugin' ); ?>"
                        placeholder="<?php esc_attr_e( 'Who are you?', 'my-plugin' ); ?>"
                        autocomplete="name"
                    ></wpd-text-field>
                    <wpd-number-field
                        label="<?php esc_attr_e( 'Favourite number', 'my-plugin' ); ?>"
                        value="42"
                        min="0"
                        max="999"
                    ></wpd-number-field>
                    <wpd-select label="<?php esc_attr_e( 'Favourite colour', 'my-plugin' ); ?>" value="blue">
                        <wpd-option value="blue"><?php esc_html_e( 'Blue', 'my-plugin' ); ?></wpd-option>
                        <wpd-option value="green"><?php esc_html_e( 'Green', 'my-plugin' ); ?></wpd-option>
                        <wpd-option value="red"><?php esc_html_e( 'Red', 'my-plugin' ); ?></wpd-option>
                    </wpd-select>
                    <wpd-checkbox label="<?php esc_attr_e( 'Subscribe', 'my-plugin' ); ?>" value="subscribe"></wpd-checkbox>
                </wpd-stack>
            </wpd-tabpanel>
        </wpd-stack>
        <?php
    },
) );

add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'two-tab-demo',
        plugin_dir_url( __FILE__ ) . 'two-tab-demo.js',
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
} );
```

`my-plugin/two-tab-demo.js`:

```js
( function () {
    window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
    window.desktopModeNativeWindows[ 'two-tab-demo' ] = function ( body ) {
        // The shell has already rendered tabs + panels from the PHP
        // template. You only write JS for the per-pane behaviour you
        // actually care about — NOT the tab/pane wiring.

        body.querySelector( 'wpd-text-field' )
            .addEventListener( 'wpd-input-commit', ( e ) => {
                console.log( 'name:', e.detail.value );
            } );

        body.querySelector( 'wpd-number-field' )
            .addEventListener( 'wpd-input-commit', ( e ) => {
                console.log( 'fav number:', e.detail.value );
            } );

        // Optional: react to tab changes for telemetry, URL sync,
        // whatever. The auto-swap already happened by the time this
        // event fires.
        body.querySelector( 'wpd-tabs' )
            .addEventListener( 'wpd-tab-change', ( e ) => {
                console.log( 'tab →', e.detail.value );
            } );
    };
} )();
```

## Before → after

### Before (hand-wired panes)

```php
desktop_mode_component( 'wpd-tabs', [ 'value' => 'calc' ], $tab_children );
desktop_mode_component( 'wpd-stack', [ 'data-pane' => 'calc', 'gap' => 8 ], $calc_children );
desktop_mode_component( 'wpd-stack', [ 'data-pane' => 'convert', 'gap' => 6, 'hidden' => true ], $convert_children );
```

```js
var activeTab = 'calc';
tabs.addEventListener( 'wpd-tab-change', function ( e ) {
    activeTab = e.detail.value || 'calc';
    calcPane.hidden = 'calc' !== activeTab;
    convPane.hidden = 'convert' !== activeTab;
} );
```

`data-pane="…"` was every plugin's private invention — three plugins picked three different conventions. ARIA roles had to be remembered and wired by hand.

### After (registered window tabs)

```html
<wpd-tabs value="calc">
    <wpd-tab value="calc">Calc</wpd-tab>
    <wpd-tab value="convert">Convert</wpd-tab>
</wpd-tabs>
<wpd-tabpanel for="calc">…</wpd-tabpanel>
<wpd-tabpanel for="convert">…</wpd-tabpanel>
```

Zero JS for the tabs. Zero private conventions. `role="tablist"` / `role="tab"` / `role="tabpanel"` wired for free.

## When the manual path still makes sense

The auto-swap is opt-in — using `<wpd-tabpanel>` is what activates it. If you have an unusual layout (panels nested multiple levels deep, conditional pane types, a custom transition), keep listening for `wpd-tab-change` and swap whatever-you-like by hand. `<wpd-tabs>` fires the event in both modes.

## Related docs

- [`<wpd-tabs>`, `<wpd-tab>`, `<wpd-tabpanel>`](../components-reference.md#tabs--navigation) — component reference (props/events via each class's `static help`).
- [`<wpd-text-field>`, `<wpd-number-field>`](../components-reference.md#form-controls) — the form primitives used in the example.
- [`docs/examples/register-icon.md`](./register-icon.md) — companion-plugin pattern for adding a wallpaper shortcut that opens the native window.
