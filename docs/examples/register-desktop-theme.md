# Register a desktop theme from a plugin

**Status:** Experimental · **Since:** 0.9.7

A [desktop theme](../desktop-themes.md) reskins the whole shell. Site
admins normally install one by uploading a ZIP in OS Settings →
Themes, but a plugin can ship one directly — same sanitizer, same
compiler, same constraints. The only difference is that your assets
are absolute URLs you already serve instead of files inside an archive.

> Not the same as `desktop_mode_register_window_theme()`, which
> restyles **one window's** chrome. This restyles the entire OS.

---

## The whole plugin

```php
<?php
/**
 * Plugin Name: Acme Neon Glass
 * Description: A desktop theme for Desktop Mode.
 * Requires Plugins: desktop-mode
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    if ( ! function_exists( 'desktop_mode_register_desktop_theme' ) ) {
        return;
    }

    $asset = function ( $file ) {
        return plugins_url( 'theme/' . $file, __FILE__ );
    };

    $result = desktop_mode_register_desktop_theme( 'acme/neon-glass', array(
        'name'        => __( 'Neon Glass', 'acme-neon-glass' ),
        'version'     => '1.0.0',
        'author'      => 'Acme Design',
        'description' => __( 'Deep indigo glass with a neon rim.', 'acme-neon-glass' ),
        'preview'     => $asset( 'preview.png' ),

        // Every `--desktop-mode-*` custom property the shell defines
        // is fair game. See assets/css/variables.css for the full set.
        'tokens'      => array(
            '--desktop-mode-window-bg'           => '#12122a',
            '--desktop-mode-window-border'       => '#2b2b52',
            '--desktop-mode-window-radius'       => '14px',
            '--desktop-mode-titlebar-bg'         => '#171733',
            '--desktop-mode-titlebar-bg-focused' => '#241f4d',
            '--desktop-mode-titlebar-color'      => '#a8a8c0',
            '--desktop-mode-dock-bg'             => 'rgba( 12, 12, 30, 0.72 )',
            '--wp-admin-theme-color'             => '#7c5cff',

            // Typography. `--desktop-mode-font` styles the chrome,
            // `--wpd-font` the window bodies — the classic desktop
            // split. Always end the stack with a generic family.
            '--desktop-mode-font'                => '"Neon Grotesk", system-ui, sans-serif',
            '--wpd-font'                         => '"Neon Grotesk", system-ui, sans-serif',
            '--wpd-font-mono'                    => '"Neon Mono", ui-monospace, monospace',
        ),

        // One entry per @font-face. PHP generates the at-rule; you
        // supply a family name and absolute URLs. Declaring a face
        // does not use it — the tokens above are what point at it.
        'fonts'       => array(
            array(
                'family'       => 'Neon Grotesk',
                'weight'       => '400',
                'style'        => 'normal',
                'display'      => 'swap',
                'unicodeRange' => 'U+0000-00FF',
                'src'          => array(
                    $asset( 'fonts/neon-grotesk-400.woff2' ),
                ),
            ),
            array(
                'family'  => 'Neon Grotesk',
                'weight'  => '700',
                'display' => 'swap',
                'src'     => array( $asset( 'fonts/neon-grotesk-700.woff2' ) ),
            ),
        ),

        // Wallpapers a user can pick in OS Settings → Wallpaper.
        // Activating the theme does NOT switch to them — see the
        // "It is a pick, not an act" note in the theme docs.
        'wallpapers'  => array(
            'dusk' => array(
                'path'  => $asset( 'wallpapers/dusk.jpg' ),
                'label' => __( 'Dusk', 'acme-neon-glass' ),
            ),
            'dawn' => array(
                'path'  => $asset( 'wallpapers/dawn.jpg' ),
                'label' => __( 'Dawn', 'acme-neon-glass' ),
            ),
        ),

        'icons'       => array(
            'WINDOW_CONTROL_CLOSE' => array(
                'type' => 'image',
                'path' => $asset( 'icons/close.svg' ),
            ),
            'OS_SETTINGS'          => array(
                'type' => 'image',
                'path' => $asset( 'icons/settings.svg' ),
            ),
            // A slot can also just point at a different dashicon.
            'APP:edit-php'         => array(
                'type' => 'dashicon',
                'name' => 'dashicons-edit-large',
            ),
        ),

        'textures'    => array(
            'TITLEBAR'     => array(
                'type'   => 'image',
                'path'   => $asset( 'textures/titlebar.png' ),
                'repeat' => 'repeat-x',
                'size'   => 'auto 100%',
            ),
            'WINDOW_FRAME' => array(
                'type'   => 'border-image',
                'path'   => $asset( 'textures/frame.png' ),
                'slice'  => '24 fill',
                'width'  => '12px',
                'repeat' => 'round',
            ),
            // Component-kit slots reach every instance of that
            // component anywhere in the OS. Keep them subtle — these
            // tile across small surfaces.
            'MENU'         => array(
                'type' => 'image',
                'path' => $asset( 'textures/noise.png' ),
            ),
            'BUTTON'       => array(
                'type' => 'image',
                'path' => $asset( 'textures/sheen.png' ),
                'size' => '100% 100%',
            ),
        ),

        // The arrangement this theme was designed against. Seeded into
        // a user's own preferences the FIRST time they activate the
        // theme, and never again — anything they change afterwards is
        // theirs. See "Recommended OS settings" in the theme docs.
        'recommendedOsSettings' => array(
            'dockSize'      => 'large',
            'desktopLayout' => 'unified',
        ),
    ) );

    if ( is_wp_error( $result ) ) {
        // Structural problems (bad id, missing name) fail loudly.
        // Everything else drops the offending entry and installs the
        // rest — see "Fallback semantics" in the theme docs.
        error_log( '[acme-neon-glass] ' . $result->get_error_message() );
    }
} );
```

Drop your images under `theme/` next to the plugin file and you're
done. The theme appears in OS Settings → Themes for every user on the
site the moment the plugin activates — no reload, because the
`serverDesktopThemes` payload rides the existing live-refresh channel.

---

## What you get for free

- **Live activation and deactivation.** Activating your plugin makes
  the theme appear in every open shell. Deactivating removes it, and
  any user currently wearing it falls back to the system default
  without a reload.
- **Sanitization.** Your manifest travels the same validator an
  uploaded ZIP does. If a value doesn't apply, check it against the
  [value grammar](../desktop-themes.md#value-grammar) — the most common
  causes are a `url()` (PHP generates those for you) or a `var()`.
- **Slug precedence.** If a site admin has uploaded a theme with the
  same slug, theirs wins. Namespace your id (`acme/neon-glass`) and
  this won't come up.

---

## Reacting to the active theme

Plugins that paint their own chrome can follow along:

```js
// Repaint when the user switches themes. Fires only on a real change.
document.addEventListener( 'desktop-mode-desktop-theme-changed', ( e ) => {
    const { themeId, previous } = e.detail;
    myToolbar.repaint();
} );

// Ask the active theme for an icon. `null` means "no theme, or this
// slot isn't overridden" — paint your default.
const closeIcon = wp.desktop.desktopThemes.resolveIcon(
    'WINDOW_CONTROL_CLOSE',
);
```

And themes can be extended by other plugins through the icon filter:

```js
wp.hooks.addFilter(
    'desktop-mode.desktop-theme.icon',
    'my-plugin',
    ( icon, { slot, themeId } ) =>
        slot === 'APP:my-plugin' ? myBrandedIconUrl : icon,
);
```

---

## Gotchas

- **Control glyphs are monochrome.** Window control icons paint as a
  `currentColor`-tinted CSS mask so they keep the title bar's
  focused/unfocused tinting. Only the alpha channel of your image is
  used. Design them as solid silhouettes.
- **`preview` is worth shipping.** Without it the theme card in OS
  Settings falls back to two initials on a grey rectangle.
- **Assets must be reachable.** `plugins_url()` output is validated as
  an `http(s)` URL whose extension is on the allowlist for that kind —
  images for `preview` / `icons` / `textures`, fonts for `fonts`.
  Anything else is dropped. The two lists are disjoint, so pointing a
  `TITLEBAR` texture at a `.woff2` fails silently.
- **A declared font is not a used font.** `fonts` defines faces; the
  typography tokens are what reference them. Declare both or nothing
  changes.
- **Recommendations fire once per user.** `recommendedOsSettings` is
  seeded on a user's first activation of your theme and never
  re-asserted. If you're testing it and nothing happens, you have
  already been seeded — use the **Apply recommended layout** button in
  OS Settings → Themes, or
  `wp.desktop.desktopThemes.applyRecommendedOsSettings()`.
- **Licensing is yours.** A bundled font is redistributed to every
  visitor of every site that installs the theme. Ship one whose licence
  permits that.

---

## See also

- [Desktop themes](../desktop-themes.md) — manifest format, slot tables, value grammar
- [Hooks reference](../hooks-reference.md#desktop-themes) — the PHP filters and actions
- [JavaScript reference](../javascript-reference.md#desktop-themes-experimental) — `wp.desktop.desktopThemes`
- [Window themes](./window-theme.md) — the per-window sibling feature
