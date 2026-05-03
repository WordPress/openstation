<?php
/**
 * Desktop Mode — Routines module bootstrap.
 *
 * **What it is.** A visual automation engine: "when X happens, do Y".
 * Triggers come from broadcast topics or WP hooks; actions come from
 * registered slash-commands, AI tools, or built-in steps (email,
 * http, branch, log, …). Every routine is a stored CPT entry plus a
 * JSON definition; the engine reads the definition, listens to the
 * trigger, and executes the steps when it fires.
 *
 * **Why a CPT for definitions, custom table for runs.** Definitions
 * benefit from revisions, authorship, and the existing capability
 * machinery; they're sparse and infrequently mutated. Run history
 * is the opposite — append-heavy, queried by timestamp, never edited
 * by a human; a custom table keeps the wp_posts index lean.
 *
 * **Public PHP surface** (all stable from 0.22.0):
 *
 *   - `wp_register_desktop_routine_trigger( $args )`
 *   - `wp_register_desktop_routine_action( $args )`
 *   - `wp_register_desktop_routine_template( $args )`
 *   - filters: `wp_desktop_routine_payload`, `_can_run`, `_http_allowlist`
 *   - actions: `wp_desktop_routine_before_run`, `_after_run`, `_step_failed`,
 *              `_trigger_registered`, `_action_registered`,
 *              `_template_registered`, `_seeded`
 *
 * **Security model.** Routines run as their *author*, not the user
 * whose action triggered them. Every step's capability is checked
 * against the author at execute time. `run_as: "system"` is the
 * escape hatch for routines that must mutate other users' data —
 * it requires `manage_options` to set and is visibly badged in the
 * UI.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

const WPDM_ROUTINE_CPT          = 'wpdm_routine';
const WPDM_ROUTINE_DEF_META     = '_wpd_routine_def';
const WPDM_ROUTINE_ENABLED_META = '_wpd_routine_enabled';
const WPDM_ROUTINE_STATS_META   = '_wpd_routine_stats';
const WPDM_ROUTINE_RUNS_TABLE   = 'wpdm_routine_runs';
const WPDM_ROUTINE_DB_VERSION   = '1';
const WPDM_ROUTINE_DB_OPTION    = 'wpdm_routine_db_version';
const WPDM_ROUTINE_DEF_VERSION  = 1;

require_once __DIR__ . '/registry.php';
require_once __DIR__ . '/api.php';
require_once __DIR__ . '/cpt.php';
require_once __DIR__ . '/run-history.php';
require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/steps.php';
require_once __DIR__ . '/executor.php';
require_once __DIR__ . '/triggers.php';
require_once __DIR__ . '/seed.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/ai-generate.php';
require_once __DIR__ . '/window.php';

/**
 * One-shot DB schema sync. Cheap when up-to-date — a single
 * `get_option` round-trip per request.
 *
 * @since 0.22.0
 */
function wpdm_routine_maybe_install() {
	$installed = (string) get_option( WPDM_ROUTINE_DB_OPTION, '' );
	if ( WPDM_ROUTINE_DB_VERSION === $installed ) {
		return;
	}
	wpdm_routine_install_runs_table();
	update_option( WPDM_ROUTINE_DB_OPTION, WPDM_ROUTINE_DB_VERSION, false );
}
add_action( 'init', 'wpdm_routine_maybe_install', 5 );

register_activation_hook( DESKTOP_MODE_FILE, 'wpdm_routine_install_runs_table' );
