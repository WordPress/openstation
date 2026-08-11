<?php
/**
 * Plugin Name:       OpenStation — Electron Adapter
 * Description:       Lets any OpenStation window be set free into a real OS window when the desktop is opened through the OpenStation Desktop app. Adds nothing to the browser experience.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            OpenStation Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       openstation-electron-adapter
 *
 * @package OpenStationElectronAdapter
 */

/**
 * OpenStation stays a web application. This adapter is the *only*
 * place that knows Electron exists.
 *
 * Core gained two generic things to make it possible — a registry for
 * rows in a window's ⋯ menu (`wp.os.registerWindowAction`) and a
 * single-window rendering mode (`?openstation_solo=`) — and neither
 * mentions Electron or this plugin. Everything Electron-specific
 * lives here and in `app/`:
 *
 *     OpenStation core
 *     ├── Window Manager          ← untouched
 *     ├── App Registry            ← untouched
 *     └── extensions
 *           └── Electron Adapter  ← this plugin
 *                 ├── IPC             (app/lib/protocol.js)
 *                 ├── Native windows  (app/lib/free-windows.js)
 *                 ├── OS integration  (app/main.js)
 *                 └── Host contract   (this plugin's REST routes)
 *
 * Deactivate it and OpenStation is exactly the browser experience it
 * was; the desktop app then finds no host contract and degrades to
 * a plain window onto the site.
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_ELECTRON_FILE', __FILE__ );
define( 'OPENSTATION_ELECTRON_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_ELECTRON_URL', plugin_dir_url( __FILE__ ) );
define( 'OPENSTATION_ELECTRON_VERSION', '1.0.0' );

require_once OPENSTATION_ELECTRON_DIR . 'includes/host.php';
require_once OPENSTATION_ELECTRON_DIR . 'includes/assets.php';
