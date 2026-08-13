<?php
/**
 * Tests for the OS settings REST write path — specifically its merge
 * semantics.
 *
 * The route accepts a PARTIAL payload: a key the request omits keeps
 * whatever is stored for the user. That is what keeps two open
 * sessions of the same account from overwriting each other. Before it,
 * every save carried the client's complete snapshot, so a session that
 * booted an hour ago could undo another session's wallpaper change
 * just by toggling its own accent.
 *
 * The client half of the deal — send only the fields that changed —
 * lives in `tests/vitest/os-settings-partial-save.test.ts`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-settings
 */
class Tests_OpenStation_OsSettingsRest extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$user_id );
	}

	/** POST the given settings array through the REST handler. */
	private function post( array $settings ) {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/os-settings' );
		$req->set_param( 'settings', $settings );
		return openstation_rest_save_os_settings( $req );
	}

	/**
	 * The reported scenario, end to end: session A changes the
	 * wallpaper, session B — which never saw that change — saves only
	 * its accent. B's save must not carry an opinion about the
	 * wallpaper, so A's change survives.
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_partial_payload_keeps_fields_it_omits() {
		$this->post(
			array(
				'wallpaper' => 'dark',
				'accent'    => 'pulse',
			)
		);

		// Session B, stale, changing one unrelated field.
		$this->post( array( 'accent' => 'nebula' ) );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'nebula', $loaded['accent'], 'The field the request sent must win.' );
		$this->assertSame( 'dark', $loaded['wallpaper'], 'A field the request omitted must survive.' );
	}

	/**
	 * An omitted key must resolve to the STORED value, not to the
	 * shipped default — the distinction the bug turned on, since
	 * every non-default setting the user had reverted to default.
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_omitted_key_does_not_fall_back_to_the_default() {
		$defaults = openstation_default_os_settings();
		$this->assertNotSame( 'compact', $defaults['dockSize'], 'Fixture assumes a non-default value.' );

		$this->post( array( 'dockSize' => 'compact' ) );
		$this->post( array( 'accent' => 'nebula' ) );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'compact', $loaded['dockSize'] );
	}

	/**
	 * Booleans are the trap case: `false` and "absent" look alike to a
	 * naive merge, so an explicit `false` must still turn the setting
	 * off rather than being treated as "no opinion".
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_explicit_false_still_turns_a_setting_off() {
		$this->post( array( 'nativePostsEnabled' => true ) );
		$this->assertTrue( openstation_get_os_settings( self::$user_id )['nativePostsEnabled'] );

		$this->post( array( 'nativePostsEnabled' => false ) );
		$this->assertFalse( openstation_get_os_settings( self::$user_id )['nativePostsEnabled'] );
	}

	/**
	 * Backwards compatibility: a client that still posts the complete
	 * snapshot behaves exactly as it always did, because every key is
	 * present and every key therefore wins.
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_full_payload_replaces_every_field() {
		$this->post( array( 'wallpaper' => 'dark' ) );

		$full              = openstation_default_os_settings();
		$full['accent']    = 'nebula';
		$this->post( $full );

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'nebula', $loaded['accent'] );
		$this->assertSame(
			$full['wallpaper'],
			$loaded['wallpaper'],
			'A full payload still overrides a previously stored value.'
		);
	}

	/**
	 * The response is the merged truth, not the echo of the request —
	 * it is what a client would use to reconcile.
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_response_returns_the_merged_settings() {
		$this->post( array( 'wallpaper' => 'dark' ) );
		$res = $this->post( array( 'accent' => 'nebula' ) );

		$data = $res->get_data();
		$this->assertSame( 'nebula', $data['accent'] );
		$this->assertSame( 'dark', $data['wallpaper'] );
	}

	/**
	 * The merge belongs to the REST route, NOT to the saver.
	 * `openstation_save_os_settings()` is contractually a REPLACE, and
	 * `includes/migrations.php` depends on it: migration 1 `unset()`s
	 * keys and re-saves precisely so the sanitizer backfills the new
	 * defaults. Give the saver merge semantics and that migration
	 * silently becomes a no-op — invisible to a test suite that builds
	 * fresh meta every run, and visible on real installs as a
	 * migration that did nothing.
	 *
	 * @covers ::openstation_save_os_settings
	 */
	public function test_the_saver_itself_still_replaces() {
		openstation_save_os_settings( self::$user_id, array( 'dockSize' => 'compact' ) );
		openstation_save_os_settings( self::$user_id, array( 'accent' => 'nebula' ) );

		$loaded   = openstation_get_os_settings( self::$user_id );
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'nebula', $loaded['accent'] );
		$this->assertSame(
			$defaults['dockSize'],
			$loaded['dockSize'],
			'Direct saves must keep resetting omitted keys to the default.'
		);
	}

	/**
	 * A payload that isn't an object says nothing about any field, so
	 * it must change nothing.
	 *
	 * The route declares `'settings' => object`, so schema validation
	 * rejects a scalar before the callback runs and this is
	 * unreachable over real REST traffic. It is pinned anyway because
	 * the sanitizer resolves a non-array to the full defaults: the
	 * one way to reach this handler with a bad payload was the one
	 * way to wipe a user's settings, and a future direct PHP caller
	 * bypassing REST validation would have found it.
	 *
	 * @covers ::openstation_rest_save_os_settings
	 */
	public function test_non_array_payload_changes_nothing() {
		$this->post( array( 'wallpaper' => 'dark' ) );

		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/os-settings' );
		$req->set_param( 'settings', 'not-an-array' );
		$res = openstation_rest_save_os_settings( $req );

		$this->assertSame( 'dark', $res->get_data()['wallpaper'] );
		$this->assertSame(
			'dark',
			openstation_get_os_settings( self::$user_id )['wallpaper'],
			'A junk payload must not reset stored settings to the defaults.'
		);
	}
}
