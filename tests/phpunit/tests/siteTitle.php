<?php
/**
 * Tests for `open_station_site_title()` — the string the desktop uses
 * to label the site's own objects instead of naming the software.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-site-title
 */
class Tests_OpenStation_SiteTitle extends WP_UnitTestCase {

	protected $original_blogname;

	public function set_up() {
		parent::set_up();
		$this->original_blogname = get_option( 'blogname' );
	}

	public function tear_down() {
		update_option( 'blogname', $this->original_blogname );
		remove_all_filters( 'open_station_site_title' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_site_title
	 */
	public function test_returns_the_site_name() {
		update_option( 'blogname', "Izzi's Gym" );

		$this->assertSame( "Izzi's Gym", open_station_site_title() );
	}

	/**
	 * Titles land in `title=` attributes and JS-rendered text nodes,
	 * so the display-filtered entities `get_bloginfo()` returns have
	 * to be decoded — otherwise the desktop reads `Ben &amp; Jerry`.
	 *
	 * @covers ::open_station_site_title
	 */
	public function test_decodes_html_entities() {
		update_option( 'blogname', 'Ben & Jerry' );

		$this->assertSame( 'Ben & Jerry', open_station_site_title() );
	}

	/**
	 * @covers ::open_station_site_title
	 */
	public function test_trims_surrounding_whitespace() {
		update_option( 'blogname', '   Spaced Out   ' );

		$this->assertSame( 'Spaced Out', open_station_site_title() );
	}

	/**
	 * A nameless site still needs a label on its folder.
	 *
	 * @covers ::open_station_site_title
	 */
	public function test_falls_back_when_the_site_has_no_name() {
		update_option( 'blogname', '' );

		$this->assertSame( 'WordPress', open_station_site_title() );
	}

	/**
	 * @covers ::open_station_site_title
	 */
	public function test_filter_overrides_the_title() {
		update_option( 'blogname', 'Ignored' );
		add_filter(
			'open_station_site_title',
			static function () {
				return 'Network Brand';
			}
		);

		$this->assertSame( 'Network Brand', open_station_site_title() );
	}

	/**
	 * A filter returning junk must not blank out every window title.
	 *
	 * @covers ::open_station_site_title
	 */
	public function test_filter_returning_a_non_string_is_discarded() {
		update_option( 'blogname', 'Real Title' );
		add_filter(
			'open_station_site_title',
			static function () {
				return array( 'nope' );
			}
		);

		$this->assertSame( 'Real Title', open_station_site_title() );
	}

	/**
	 * @covers ::open_station_site_title
	 */
	public function test_filter_returning_an_empty_string_is_discarded() {
		update_option( 'blogname', 'Real Title' );
		add_filter( 'open_station_site_title', '__return_empty_string' );

		$this->assertSame( 'Real Title', open_station_site_title() );
	}
}
