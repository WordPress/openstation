# Window themes

A **theme** is a named bag of CSS custom properties applied per-window. Two windows can carry different themes simultaneously — variables are written inline on each window's outer element, never to a global stylesheet, so they don't leak across windows.

Themes are part of the four-layer window-chrome customization framework:

| Layer | Surface | Status |
|-------|---------|--------|
| 1 | Themes (this doc) | Stable since 0.6.0 |
| 2 | Controls — `registerWindowControl` | Stable since 0.6.0 |
| 3 | Slots — `registerWindowSlot` | Stable since 0.6.0 |
| 4 | Custom chrome render — `registerWindowChrome` | Experimental since 0.6.0 |

This doc covers Layer 1 only.

---

## Recipe 1 — A stylesheet-only theme (no JS)

Designers can ship a theme with PHP alone. Register the theme with `desktop_mode_register_window_theme()` and the shell applies the tokens to every window without further plumbing.

**my-theme.php**

```php
<?php
/** Plugin Name: Midnight theme */
defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    desktop_mode_register_window_theme( array(
        'id'       => 'my-theme/midnight',
        'label'    => __( 'Midnight', 'my-theme' ),
        'tokens'   => array(
            '--desktop-mode-window-bg'             => '#11131b',
            '--desktop-mode-window-border'         => '#2d3142',
            '--desktop-mode-window-radius'         => '14px',
            '--desktop-mode-titlebar-bg'           => '#1a1a2e',
            '--desktop-mode-titlebar-bg-focused'   => '#252540',
            '--desktop-mode-titlebar-color'        => '#a0a0b0',
            '--desktop-mode-titlebar-color-focused' => '#fafafa',
            '--wpd-btn-color'                    => '#fafafa',
            '--wpd-btn-bg-hover'                 => 'rgba(255,255,255,0.08)',
        ),
        'priority' => 50,
    ) );
} );
```

That's the entire plugin. The theme applies to every window, no JS round-trip needed.

---

## Recipe 2 — Per-window theme via JS predicate

When a theme should apply only to specific windows (the post editor, a single plugin's window, …), register it from JS with a `match` predicate.

**my-theme.php**

```php
<?php
/** Plugin Name: Gutenberg neon */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'gutenberg-neon-theme',
        plugins_url( 'theme.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'gutenberg-neon-theme' );
} );
desktop_mode_register_window_theme_script( 'gutenberg-neon-theme' );
```

**theme.js**

```js
wp.desktop.whenReady( () => {
    wp.desktop.registerWindowTheme( {
        id:    'gutenberg-neon/post-editor',
        label: 'Neon Post Editor',
        tokens: {
            '--desktop-mode-titlebar-bg-focused': '#ff00aa',
            '--desktop-mode-titlebar-color-focused': '#ffffff',
        },
        match: ( win ) => win.config.url?.includes( 'post.php' ) ?? false,
        owner: 'gutenberg-neon-theme', // for live unregister on deactivation
    } );
} );
```

The `owner` field is the WP script handle. When the plugin deactivates, the chrome server-sync drops this theme without requiring a page reload.

---

## Recipe 3 — Per-window theme at registration time

When the window registrant owns the theme, declare it inline via `WindowConfig.appearance.theme` instead of registering globally:

```js
wp.desktop.registerWindow( {
    id:     'my-plugin/dashboard',
    title:  'Dashboard',
    icon:   'dashicons-dashboard',
    width:  640,
    height: 480,
    minWidth: 320,
    minHeight: 200,
    appearance: {
        theme: {
            tokens: {
                '--desktop-mode-titlebar-bg-focused': '#0066cc',
                '--desktop-mode-titlebar-color-focused': '#ffffff',
            },
        },
    },
    render: ( body ) => { body.textContent = 'Hello'; },
} );
```

Or pin a registered theme by id:

```js
appearance: { theme: { themeId: 'my-theme/midnight' } }
```

---

## Recipe 4 — Runtime theme swap

`wp.desktop.applyWindowTheme()` re-themes a live window. Useful for theme pickers, dark-mode toggles, or onboarding tours that flash a window highlight.

```js
wp.desktop.applyWindowTheme( 'edit-post', {
    tokens: { '--desktop-mode-titlebar-bg-focused': '#ff8800' },
} );

// Or pin a registered theme by id:
wp.desktop.applyWindowTheme( 'edit-post', 'my-theme/midnight' );

// Or clear the override and fall back to the registry:
wp.desktop.applyWindowTheme( 'edit-post', null );
```

The override is also written into the window's `config.appearance.theme` so subsequent registry-driven re-applies preserve the runtime choice.

---

## Hooks

### PHP

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `desktop_mode_window_theme_script_registered` | action | `( string $handle )` | Fires after `desktop_mode_register_window_theme_script()` succeeds. |
| `desktop_mode_window_theme_registered` | action | `( string $id, array $entry )` | Fires after `desktop_mode_register_window_theme()` stores metadata. |

### JavaScript

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `desktop-mode.window.chrome.theme` | filter | `( tokens, { windowId, themeId, config } ) => tokens` | Mutate the resolved CSS-variable map for any window before it's written to the element. Stable. |
| `desktop-mode.window.chrome.theme-changed` | action | `( { windowId, themeId, tokens } )` | Fires after each successful apply. Stable. |

### Token reference

CSS-variable contract that themes can override: see `assets/css/window-chrome.css` for the canonical list. The most commonly themed:

- `--desktop-mode-window-bg`, `--desktop-mode-window-border`, `--desktop-mode-window-radius`, `--desktop-mode-window-shadow`, `--desktop-mode-window-shadow-focused`
- `--desktop-mode-titlebar-bg`, `--desktop-mode-titlebar-bg-focused`, `--desktop-mode-titlebar-color`, `--desktop-mode-titlebar-color-focused`, `--desktop-mode-titlebar-height`
- `--wpd-btn-color`, `--wpd-btn-bg-hover`, `--wpd-btn-outline`, `--wpd-btn-danger-hover`

A non-CSS-variable key (one that doesn't start with `--`) is rejected at registration time with a `RegistrationError` — the framework refuses to write anything to the element that isn't a custom property.

---

## Live unregistration on deactivation

When the plugin's WordPress script handle leaves the next live-refresh payload (deactivation), the chrome server-sync tears down the plugin's themes:

- Themes registered via PHP metadata (`desktop_mode_register_window_theme()`) are dropped automatically — their handle ↔ id mapping is captured in the previous payload snapshot.
- Themes registered from JS with `owner: '<script-handle>'` are also dropped automatically.
- Themes registered from JS without `owner` survive until the next page reload (graceful backwards-compat).

Open windows repaint live via the registry's subscribe fan-out — no F5 required.
