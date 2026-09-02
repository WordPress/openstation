<?php
/**
 * Lazy-window config must attach before the payload harvest.
 *
 * `openstation_enqueue_assets()` (admin_enqueue_scripts, default priority 10)
 * harvests every lazy native window's `wp_localize_script` data into the
 * shell payload via `openstation_resolve_script_payload()`. A module that
 * attaches its config later than that ships its bundle with no config at
 * all on the lazy path — the browser-side "…Config is missing" failure —
 * while looking perfectly healthy on any code path that still enqueues the
 * bundle eagerly.
 *
 * The recycle bin shipped exactly that bug (config at priority 30, harvest
 * at 10) after bundles went lazy in #613: the Trash window opened, listed
 * nothing, and logged `openStationRecycleBinConfig is missing`. This test
 * pins the ordering for every module that localizes config onto a lazy
 * window handle, so the next module copies a working pattern.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_LazyWindowConfigPriority extends WP_UnitTestCase {

	/**
	 * Modules that attach `wp_localize_script` config to a lazy window
	 * handle on `admin_enqueue_scripts`.
	 *
	 * @return array[]
	 */
	public function data_lazy_window_config_localizers() {
		return array(
			// The Recycle Bin left this list when it became an App
			// Framework app — its config ships in the window config
			// blob, not via wp_localize_script.
			'games' => array( 'openstation_games_localize_config' ),
		);
	}

	/**
	 * Each localizer runs strictly before the payload harvest.
	 *
	 * @dataProvider data_lazy_window_config_localizers
	 *
	 * @param string $localizer Hooked function that calls `wp_localize_script`.
	 */
	public function test_config_attaches_before_the_payload_harvest( $localizer ) {
		$harvest = has_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' );

		$this->assertNotFalse( $harvest, 'The payload harvest must be hooked.' );

		if ( ! function_exists( $localizer ) ) {
			$this->markTestSkipped( "The {$localizer} module is not loaded in this environment." );
		}

		$priority = has_action( 'admin_enqueue_scripts', $localizer );

		$this->assertNotFalse( $priority, "{$localizer} must be hooked." );
		$this->assertLessThan(
			$harvest,
			$priority,
			"{$localizer} attaches config after the payload harvest at priority {$harvest}: on the lazy path its bundle ships with no config."
		);
	}
}
