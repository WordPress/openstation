<?php
/**
 * OpenStation — Desktop Themes module bootstrap.
 *
 * A **desktop theme** reskins the whole shell at once: every
 * `--os-*` design token, the title-bar / dock / desktop
 * textures, the window frame + per-corner images, and a complete
 * iconset (including the window control glyphs). Themes arrive as a
 * ZIP containing a `theme.json` manifest plus images — never CSS,
 * never JS. PHP validates the manifest and *compiles* a stylesheet
 * of custom-property declarations from it, so nothing an author
 * writes is ever executed or echoed into a `<style>` verbatim.
 *
 * Deliberately named "desktop theme" everywhere
 * (`openstation_desktop_theme*`, `serverDesktopThemes`,
 * `src/desktop-themes/`) — never bare "theme" — because the plugin
 * already has per-window "window themes"
 * (`includes/window-chrome.php`) and the two are different features.
 *
 * Library is site-wide; upload is gated on `manage_options`
 * (filterable); activation is per-user via the `desktopTheme` key in
 * the existing `desktop_mode_os_settings` user meta.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once OPENSTATION_DIR . 'includes/desktop-themes/store.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/manifest.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/compile.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/install.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/registry.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/rest.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/assets.php';
require_once OPENSTATION_DIR . 'includes/desktop-themes/wallpapers.php';
// After registry.php — it registers through that file's public API.
require_once OPENSTATION_DIR . 'includes/desktop-themes/builtin.php';
