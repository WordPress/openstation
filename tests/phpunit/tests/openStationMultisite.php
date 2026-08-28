<?php
/**
 * Nothing multisite leaking into an install with no network. Both
 * assertions guard a silent failure — a session key that gained a suffix
 * would empty every desktop on upgrade, and `settings.php` counting as
 * Core would file a plugin's own menu in the dock's Core zone.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @covers ::openstation_session_meta_key
 * @covers ::openstation_multisite_payload
 * @covers ::openstation_is_core_menu_slug
 */
class Tests_OpenStation_Multisite extends WP_UnitTestCase {

	public function test_nothing_multisite_leaks_into_a_single_site_install() {
		$this->assertSame( OPENSTATION_SESSION_META_KEY, openstation_session_meta_key() );
		$this->assertNull( openstation_multisite_payload() );
		$this->assertFalse( openstation_is_core_menu_slug( 'settings.php' ) );
		$this->assertFalse( openstation_is_core_menu_slug( 'sites.php' ) );
		// The site admin's own Settings is unaffected either way.
		$this->assertTrue( openstation_is_core_menu_slug( 'options-general.php' ) );
	}
}
