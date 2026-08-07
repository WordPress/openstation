<?php
/**
 * PHPUnit bootstrap for the WP OpenStation plugin.
 *
 * Loads the WordPress test framework and activates the plugin before
 * each run so the plugin's hooks are wired in the test environment.
 *
 * Designed to run inside the dedicated wp-env tests instance
 * (`.wp-env.tests.json`), whose `cli` container ships WordPress' test
 * library at /wordpress-phpunit and exposes it via WP_TESTS_DIR.
 *
 * @package OpenStation
 */

// Composer autoload brings in phpunit-polyfills (required by modern
// WordPress test suites on PHPUnit 9).
$_autoload = dirname( __DIR__, 2 ) . '/vendor/autoload.php';
if ( file_exists( $_autoload ) ) {
	require_once $_autoload;
}

$_tests_dir = getenv( 'WP_TESTS_DIR' );
if ( ! $_tests_dir ) {
	$_tests_dir = getenv( 'WP_PHPUNIT__DIR' );
}
if ( ! $_tests_dir ) {
	$_tests_dir = '/wordpress-phpunit';
}

if ( ! file_exists( "{$_tests_dir}/includes/functions.php" ) ) {
	echo "Could not find {$_tests_dir}/includes/functions.php." . PHP_EOL;
	echo "Run tests inside wp-env — see README for `npm run test:php` setup." . PHP_EOL;
	exit( 1 );
}

require_once "{$_tests_dir}/includes/functions.php";

tests_add_filter(
	'muplugins_loaded',
	static function () {
		require dirname( __DIR__, 2 ) . '/desktop-mode.php';

		// The games framework is opt-in (off by default) and only
		// loads on `plugins_loaded` when enabled — force it on so the
		// games test classes have the module available. Tests that
		// exercise the disabled state remove this filter locally (the
		// test framework restores hooks after every test).
		add_filter( 'openstation_games_enabled', '__return_true' );

		// Same deal for the agents framework — force it on so the
		// agents test classes have the module available.
		add_filter( 'openstation_agents_enabled', '__return_true' );
	}
);

require "{$_tests_dir}/includes/bootstrap.php";
