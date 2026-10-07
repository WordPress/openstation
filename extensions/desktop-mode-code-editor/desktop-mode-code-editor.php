<?php
/**
 * Plugin Name:       OpenStation — Code Editor
 * Description:       Adds a Monaco-backed Code editor native window to OpenStation for browsing and editing files inside wp-content (capability- and DISALLOW_FILE_EDIT-gated).
 * Version:           0.22.11
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            OpenStation Contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-code-editor
 * Domain Path:       /languages
 *
 * @package OpenStationCodeEditor
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_CODE_EDITOR_FILE', __FILE__ );
define( 'OPENSTATION_CODE_EDITOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'OPENSTATION_CODE_EDITOR_URL', plugin_dir_url( __FILE__ ) );
define( 'OPENSTATION_CODE_EDITOR_VERSION', '0.22.11' );
define( 'OPENSTATION_CODE_EDITOR_REST_NAMESPACE', 'desktop-mode-code-editor/v1' );

require_once OPENSTATION_CODE_EDITOR_DIR . 'includes/filesystem.php';
require_once OPENSTATION_CODE_EDITOR_DIR . 'includes/php-indexer.php';
require_once OPENSTATION_CODE_EDITOR_DIR . 'includes/php-workspace-indexer.php';
require_once OPENSTATION_CODE_EDITOR_DIR . 'includes/rest.php';
require_once OPENSTATION_CODE_EDITOR_DIR . 'includes/window.php';
