<?php

class Tests_OpenStation_SiteTitle extends WP_UnitTestCase {

	protected $original_blogname;

	public function set_up() {
		parent::set_up();
		$this->original_blogname = get_option( 'blogname' );
	}

	public function tear_down() {
		update_option( 'blogname', $this->original_blogname );
		remove_all_filters( 'openstation_site_title' );
		parent::tear_down();
	}

	public function test_returns_the_site_name() {
		update_option( 'blogname', "Izzi's Gym" );

		$this->assertSame( "Izzi's Gym", openstation_site_title() );
	}

	public function test_decodes_html_entities() {
		update_option( 'blogname', 'Ben & Jerry' );

		$this->assertSame( 'Ben & Jerry', openstation_site_title() );
	}

	public function test_trims_surrounding_whitespace() {
		update_option( 'blogname', '   Spaced Out   ' );

		$this->assertSame( 'Spaced Out', openstation_site_title() );
	}

	public function test_falls_back_when_the_site_has_no_name() {
		update_option( 'blogname', '' );

		$this->assertSame( 'WordPress', openstation_site_title() );
	}

	public function test_filter_overrides_the_title() {
		update_option( 'blogname', 'Ignored' );
		add_filter(
			'openstation_site_title',
			static function () {
				return 'Network Brand';
			}
		);

		$this->assertSame( 'Network Brand', openstation_site_title() );
	}

	public function test_filter_returning_a_non_string_is_discarded() {
		update_option( 'blogname', 'Real Title' );
		add_filter(
			'openstation_site_title',
			static function () {
				return array( 'nope' );
			}
		);

		$this->assertSame( 'Real Title', openstation_site_title() );
	}

	public function test_filter_returning_an_empty_string_is_discarded() {
		update_option( 'blogname', 'Real Title' );
		add_filter( 'openstation_site_title', '__return_empty_string' );

		$this->assertSame( 'Real Title', openstation_site_title() );
	}
}
