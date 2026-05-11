<?php
/**
 * Tests for Content Graph per-user preferences (introduced in 0.9.0).
 *
 * Covers `desktop_mode_content_graph_default_prefs()`,
 * `desktop_mode_content_graph_sanitize_prefs()`, and the
 * GET/POST round-trip through the meta key.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-content-graph
 */
class Tests_DesktopMode_ContentGraphPreferences extends WP_UnitTestCase {

	/**
	 * @covers ::desktop_mode_content_graph_default_prefs
	 */
	public function test_defaults_have_expected_shape() {
		$d = desktop_mode_content_graph_default_prefs();
		$this->assertSame( 'constellation', $d['lens'] );
		$this->assertSame( array( 'link' ), $d['byLens']['constellation']['edges'] );
		$this->assertSame( array( 'link', 'co_tag' ), $d['byLens']['galaxy']['edges'] );
		$this->assertSame( 'category', $d['byLens']['galaxy']['taxonomy'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_get_prefs
	 */
	public function test_get_prefs_returns_defaults_for_user_with_nothing_stored() {
		$user_id = self::factory()->user->create();
		$got     = desktop_mode_content_graph_get_prefs( $user_id );
		$this->assertSame( desktop_mode_content_graph_default_prefs(), $got );
	}

	/**
	 * @covers ::desktop_mode_content_graph_save_prefs
	 * @covers ::desktop_mode_content_graph_get_prefs
	 */
	public function test_full_round_trip() {
		$user_id = self::factory()->user->create();
		$patch   = array(
			'lens'   => 'galaxy',
			'byLens' => array(
				'galaxy' => array(
					'taxonomy' => 'post_tag',
					'edges'    => array( 'link', 'co_tag', 'co_author' ),
					'types'    => array( 'post' ),
				),
			),
		);
		$saved = desktop_mode_content_graph_save_prefs( $user_id, $patch );
		$this->assertSame( 'galaxy', $saved['lens'] );
		$this->assertSame( 'post_tag', $saved['byLens']['galaxy']['taxonomy'] );
		$this->assertSame( array( 'link', 'co_tag', 'co_author' ), $saved['byLens']['galaxy']['edges'] );
		$this->assertSame( array( 'post' ), $saved['byLens']['galaxy']['types'] );

		// Reload from storage; should match.
		$reloaded = desktop_mode_content_graph_get_prefs( $user_id );
		$this->assertSame( $saved, $reloaded );
	}

	/**
	 * @covers ::desktop_mode_content_graph_save_prefs
	 */
	public function test_partial_save_merges_without_clobbering_other_lens() {
		$user_id = self::factory()->user->create();

		// Seed Galaxy state.
		desktop_mode_content_graph_save_prefs(
			$user_id,
			array(
				'byLens' => array(
					'galaxy' => array(
						'taxonomy' => 'post_tag',
						'edges'    => array( 'link', 'co_tag', 'menu' ),
					),
				),
			)
		);

		// Now patch only the Constellation lens edge selection.
		$saved = desktop_mode_content_graph_save_prefs(
			$user_id,
			array(
				'byLens' => array(
					'constellation' => array(
						'edges' => array( 'link', 'co_author' ),
					),
				),
			)
		);

		// Galaxy state must survive intact.
		$this->assertSame( 'post_tag', $saved['byLens']['galaxy']['taxonomy'] );
		$this->assertSame( array( 'link', 'co_tag', 'menu' ), $saved['byLens']['galaxy']['edges'] );
		// Constellation edges updated.
		$this->assertSame( array( 'link', 'co_author' ), $saved['byLens']['constellation']['edges'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_sanitize_prefs
	 */
	public function test_sanitize_drops_unknown_lens() {
		$out = desktop_mode_content_graph_sanitize_prefs(
			array( 'lens' => 'sitemap' )
		);
		$this->assertSame( 'constellation', $out['lens'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_sanitize_prefs
	 */
	public function test_sanitize_drops_unknown_edge_kind() {
		$out = desktop_mode_content_graph_sanitize_prefs(
			array(
				'byLens' => array(
					'galaxy' => array(
						'edges' => array( 'link', 'no_such_kind', 'co_author' ),
					),
				),
			)
		);
		$this->assertSame( array( 'link', 'co_author' ), $out['byLens']['galaxy']['edges'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_sanitize_prefs
	 */
	public function test_sanitize_drops_private_taxonomy() {
		// Register a private taxonomy on the fly.
		register_taxonomy(
			'private_tax_' . substr( md5( uniqid() ), 0, 6 ),
			'post',
			array( 'public' => false )
		);
		$out = desktop_mode_content_graph_sanitize_prefs(
			array(
				'byLens' => array(
					'galaxy' => array(
						// A real taxonomy that's not public.
						'taxonomy' => 'nav_menu',
					),
				),
			)
		);
		// Default falls back to "category" (or whatever default is).
		$this->assertSame( 'category', $out['byLens']['galaxy']['taxonomy'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_sanitize_prefs
	 */
	public function test_sanitize_drops_unknown_post_type() {
		$out = desktop_mode_content_graph_sanitize_prefs(
			array(
				'byLens' => array(
					'galaxy' => array(
						'types' => array( 'post', 'no_such_type' ),
					),
				),
			)
		);
		$this->assertSame( array( 'post' ), $out['byLens']['galaxy']['types'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_taxonomies
	 */
	public function test_taxonomies_descriptor_includes_category() {
		$taxes = desktop_mode_content_graph_taxonomies();
		$slugs = wp_list_pluck( $taxes, 'slug' );
		$this->assertContains( 'category', $slugs );
		$this->assertContains( 'post_tag', $slugs );
	}

	/**
	 * @covers ::desktop_mode_content_graph_edge_kind_descriptors
	 */
	public function test_edge_kind_descriptors_cover_all_kinds() {
		$slugs = wp_list_pluck( desktop_mode_content_graph_edge_kind_descriptors(), 'slug' );
		$this->assertEqualSets(
			desktop_mode_content_graph_edge_kinds(),
			$slugs
		);
	}

	/**
	 * @covers ::desktop_mode_content_graph_save_prefs
	 */
	public function test_save_for_nonexistent_user_returns_defaults() {
		$got = desktop_mode_content_graph_save_prefs( 0, array( 'lens' => 'galaxy' ) );
		$this->assertSame( desktop_mode_content_graph_default_prefs(), $got );
	}
}
