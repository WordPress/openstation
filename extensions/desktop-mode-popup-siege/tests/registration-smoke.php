<?php
/**
 * Framework-free registration and score-contract smoke test.
 *
 * @package OpenStationPopupSiege
 */

define( 'ABSPATH', __DIR__ . '/' );

$popup_siege_actions    = array();
$popup_siege_filters    = array();
$popup_siege_scripts    = array();
$popup_siege_registered = array();

/**
 * Minimal WP_Error stand-in.
 */
class WP_Error {
	/**
	 * Error code.
	 *
	 * @var string
	 */
	public $code;

	/**
	 * Error message.
	 *
	 * @var string
	 */
	public $message;

	/**
	 * Constructor.
	 *
	 * @param string $code Error code.
	 * @param string $message Error message.
	 */
	public function __construct( $code, $message ) {
		$this->code    = $code;
		$this->message = $message;
	}
}

/**
 * Record action registration.
 *
 * @param string   $hook Hook name.
 * @param callable $callback Callback.
 * @param int      $priority Priority.
 */
function add_action( $hook, $callback, $priority = 10 ) {
	global $popup_siege_actions;
	$popup_siege_actions[ $hook ][] = array( $callback, $priority );
}

/**
 * Record filter registration.
 *
 * @param string   $hook Hook name.
 * @param callable $callback Callback.
 * @param int      $priority Priority.
 * @param int      $accepted_args Accepted arguments.
 */
function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	global $popup_siege_filters;
	$popup_siege_filters[ $hook ][] = array(
		$callback,
		$priority,
		$accepted_args,
	);
}

/**
 * Return a plugin directory path.
 *
 * @param string $file Plugin file.
 * @return string
 */
function plugin_dir_path( $file ) {
	return trailingslashit( dirname( $file ) );
}

/**
 * Return a stable fake plugin URL.
 *
 * @param string $file Plugin file.
 * @return string
 */
function plugin_dir_url( $file ) {
	unset( $file );
	return 'https://example.test/wp-content/plugins/desktop-mode-popup-siege/';
}

/**
 * Build a fake plugin asset URL.
 *
 * @param string $path Relative asset path.
 * @param string $file Plugin file.
 * @return string
 */
function plugins_url( $path, $file ) {
	unset( $file );
	return plugin_dir_url( '' ) . ltrim( $path, '/' );
}

/**
 * Add a trailing slash.
 *
 * @param string $value Path.
 * @return string
 */
function trailingslashit( $value ) {
	return rtrim( $value, '/\\' ) . '/';
}

/**
 * Return a translated string unchanged.
 *
 * @param string $text Source text.
 * @param string $domain Text domain.
 * @return string
 */
function __( $text, $domain ) {
	unset( $domain );
	return $text;
}

/**
 * Record lazy script registration.
 *
 * @param string $handle Handle.
 * @param string $src Source URL.
 * @param array  $dependencies Dependencies.
 * @param string $version Version.
 * @param bool   $footer Footer flag.
 */
function wp_register_script( $handle, $src, $dependencies, $version, $footer ) {
	global $popup_siege_scripts;
	$popup_siege_scripts[ $handle ] = compact(
		'src',
		'dependencies',
		'version',
		'footer'
	);
}

/**
 * Record game registration.
 *
 * @param string $id Game id.
 * @param array  $args Registration arguments.
 */
function open_station_register_game( $id, $args ) {
	global $popup_siege_registered;
	$popup_siege_registered[ $id ] = $args;
}

/**
 * Fail the test unless a condition is true.
 *
 * @param bool   $condition Condition.
 * @param string $message Failure message.
 */
function popup_siege_test_assert( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

require dirname( __DIR__ ) . '/desktop-mode-popup-siege.php';

popup_siege_test_assert(
	isset( $popup_siege_actions['init'][0] ) &&
		20 === $popup_siege_actions['init'][0][1],
	'Popup Siege must register on init at priority 20.'
);
popup_siege_test_assert(
	isset( $popup_siege_filters['open_station_game_score_pre_save'][0] ) &&
		5 === $popup_siege_filters['open_station_game_score_pre_save'][0][2],
	'Popup Siege must inspect all five score filter arguments.'
);

popup_siege_register_game();

popup_siege_test_assert(
	isset( $popup_siege_registered['popup-siege'] ),
	'Popup Siege was not registered.'
);
popup_siege_test_assert(
	isset( $popup_siege_scripts['desktop-mode-popup-siege'] ),
	'Popup Siege runtime was not registered.'
);

$popup_siege_game   = $popup_siege_registered['popup-siege'];
$popup_siege_script = $popup_siege_scripts['desktop-mode-popup-siege'];
popup_siege_test_assert(
	array( 'openstation' ) === $popup_siege_script['dependencies'],
	'The runtime must depend on OpenStation.'
);
popup_siege_test_assert(
	'0.7.0' === $popup_siege_script['version'] &&
		true === $popup_siege_script['footer'],
	'The runtime version or loading position is wrong.'
);
popup_siege_test_assert(
	false !== strpos( $popup_siege_script['src'], 'openstation-adapter.js' ),
	'The registered runtime must be the OpenStation adapter.'
);
popup_siege_test_assert(
	'desktop-mode-popup-siege' === $popup_siege_game['script'],
	'The game must use the registered lazy script handle.'
);
popup_siege_test_assert(
	false !== strpos( $popup_siege_game['config']['assetBaseUrl'], '/assets/' ) &&
		false !== strpos( $popup_siege_game['config']['sdkBaseUrl'], '/sdk/' ) &&
		false !== strpos( $popup_siege_game['config']['cssUrl'], 'popup-breaker.css' ),
	'The game asset URLs are incomplete.'
);
popup_siege_test_assert(
	5 === count( $popup_siege_game['score_columns'] ),
	'The unified scoreboard must expose all five columns.'
);

$popup_siege_valid_meta = array(
	'brick_points'                 => 3960,
	'bricks_destroyed'             => 30,
	'bricks_total'                 => 30,
	'clear_bonus'                  => 1560,
	'closed_popup_ids'             => 'download,toolbar,casino,malware-boss',
	'end_reason'                   => 'archive-sweep',
	'first_unfinished_objective_id' => '',
	'lives_remaining'              => 3,
	'mode'                         => 'Free Play',
	'objective_states'             => 'download-trap:complete:1/1|toolbar-swarm:complete:2/2|malware-boss:complete:1/1|archive-sweep:complete:0/1',
	'popup_points'                 => 3350,
	'popups_closed'                => 4,
	'popups_total'                 => 4,
	'purge_points'                 => 4500,
	'restored'                     => 100,
	'result'                       => 'rescued',
	'rules_version'                => 3,
	'seconds_remaining'            => 3,
	'terminal_schema_version'      => 1,
	'time'                         => 87,
);
$popup_siege_valid_score = 13370;

popup_siege_test_assert(
	null === popup_siege_validate_score(
		null,
		'popup-siege',
		7,
		$popup_siege_valid_score,
		$popup_siege_valid_meta
	),
	'A valid Free Play rescue should pass.'
);

$popup_siege_challenge_meta         = $popup_siege_valid_meta;
$popup_siege_challenge_meta['mode'] = 'Challenge';
popup_siege_test_assert(
	null === popup_siege_validate_score(
		null,
		'popup-siege',
		7,
		$popup_siege_valid_score,
		$popup_siege_challenge_meta
	),
	'A valid challenge rescue should pass.'
);

$popup_siege_extra_meta          = $popup_siege_valid_meta;
$popup_siege_extra_meta['extra'] = true;
popup_siege_test_assert(
	popup_siege_validate_score(
		null,
		'popup-siege',
		7,
		$popup_siege_valid_score,
		$popup_siege_extra_meta
	) instanceof WP_Error,
	'Unexpected metadata keys must be rejected.'
);
popup_siege_test_assert(
	popup_siege_validate_score(
		null,
		'popup-siege',
		7,
		$popup_siege_valid_score + 1,
		$popup_siege_valid_meta
	) instanceof WP_Error,
	'Mismatched score arithmetic must be rejected.'
);

$popup_siege_invalid_mode         = $popup_siege_valid_meta;
$popup_siege_invalid_mode['mode'] = 'Practice';
popup_siege_test_assert(
	popup_siege_validate_score(
		null,
		'popup-siege',
		7,
		$popup_siege_valid_score,
		$popup_siege_invalid_mode
	) instanceof WP_Error,
	'Unknown modes must be rejected.'
);

$popup_siege_prior_error = new WP_Error( 'earlier_filter', 'Stop.' );
popup_siege_test_assert(
	$popup_siege_prior_error === popup_siege_validate_score(
		$popup_siege_prior_error,
		'popup-siege',
		7,
		$popup_siege_valid_score,
		$popup_siege_valid_meta
	),
	'An earlier filter error must be preserved.'
);
popup_siege_test_assert(
	null === popup_siege_validate_score(
		null,
		'another-game',
		7,
		999999,
		array()
	),
	'Other games must be left untouched.'
);

echo "Popup Siege registration and score-contract smoke test passed.\n";
