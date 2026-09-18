<?php
/**
 * Plugin Name: OpenStation Feedback Intake
 * Description: Receives the anonymous deactivation feedback OpenStation sites send, stores it in one table and shows it under Tools. Not for distribution: this runs on openstation.blog only.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Author: OpenStation
 * License: GPLv2 or later
 * Text Domain: openstation-feedback-intake
 *
 * What the table holds, and what it never holds, is in README.md.
 * In one line: the answer a site admin chose to send, a few version
 * and locale strings, some bucketed counts, and nothing that
 * identifies the site or the person. No IP, no user agent, no
 * referer, no URL.
 *
 * @package OpenStationFeedbackIntake
 */

defined( 'ABSPATH' ) || exit;

define( 'OSFI_VERSION', '0.1.0' );
define( 'OSFI_FILE', __FILE__ );
define( 'OSFI_DIR', plugin_dir_path( __FILE__ ) );

require_once OSFI_DIR . 'includes/schema.php';
require_once OSFI_DIR . 'includes/rest.php';
require_once OSFI_DIR . 'includes/admin.php';

register_activation_hook( __FILE__, 'osfi_install_schema' );
