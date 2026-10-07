<?php

<<<'OPENSTATION_PLUGIN_METADATA'
Plugin Name:       OpenStation — Electron Adapter
Description:       Lets any OpenStation window be set free into a real OS window when the desktop is opened through the OpenStation Desktop app. Adds nothing to the browser experience.
Version:           1.0.0
Requires at least: 6.0
Requires PHP:      7.4
Requires Plugins:  desktop-mode
Author:            OpenStation Contributors
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html
Text Domain:       openstation-electron-adapter

@package OpenStationElectronAdapter
OPENSTATION_PLUGIN_METADATA;

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_ELECTRON_FILE', __FILE__ );
define( 'OPENSTATION_ELECTRON_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_ELECTRON_URL', plugin_dir_url( __FILE__ ) );
define( 'OPENSTATION_ELECTRON_VERSION', '1.0.0' );

require_once OPENSTATION_ELECTRON_DIR . 'includes/host.php';
require_once OPENSTATION_ELECTRON_DIR . 'includes/assets.php';
