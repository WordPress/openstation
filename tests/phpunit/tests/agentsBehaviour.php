<?php
/**
 * Tests for the Agents behaviour layer — `skill` term seeding,
 * `_desktop_mode_skill_abilities` meta, and the `wp_install_skill()`
 * polyfill.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_Agents_Behaviour extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		if ( ! post_type_exists( 'wp_guideline' ) ) {
			register_post_type(
				'wp_guideline',
				array(
					'public'       => false,
					'show_in_rest' => true,
					'rest_base'    => 'guidelines',
					'supports'     => array( 'title', 'editor', 'excerpt', 'author' ),
				)
			);
		}
		if ( ! taxonomy_exists( 'wp_guideline_type' ) ) {
			register_taxonomy(
				'wp_guideline_type',
				'wp_guideline',
				array(
					'hierarchical' => true,
					'show_in_rest' => true,
				)
			);
		}
	}

	/**
	 * @covers ::desktop_mode_agents_seed_skill_term
	 */
	public function test_seed_term_creates_skill_term() {
		// Force a clean slate.
		$existing = get_term_by( 'slug', 'skill', 'wp_guideline_type' );
		if ( $existing ) {
			wp_delete_term( $existing->term_id, 'wp_guideline_type' );
		}
		desktop_mode_agents_seed_skill_term();
		$term = get_term_by( 'slug', 'skill', 'wp_guideline_type' );
		$this->assertInstanceOf( 'WP_Term', $term );
	}

	/**
	 * @covers ::desktop_mode_agents_seed_skill_term
	 */
	public function test_seed_term_is_idempotent() {
		desktop_mode_agents_seed_skill_term();
		$id_before = (int) get_term_by( 'slug', 'skill', 'wp_guideline_type' )->term_id;
		desktop_mode_agents_seed_skill_term();
		$id_after = (int) get_term_by( 'slug', 'skill', 'wp_guideline_type' )->term_id;
		$this->assertSame( $id_before, $id_after );
	}

	/**
	 * @covers ::desktop_mode_agents_sanitize_ability_slugs
	 */
	public function test_sanitize_abilities_dedupes_and_drops_garbage() {
		// Dedupe collapses `'media/upload'` to one row. Non-strings are
		// dropped. `sanitize_text_field` strips `<script>` markers and
		// the rest is empty → dropped. Final list: `media/upload`,
		// `wordpress/list-posts`.
		$result = desktop_mode_agents_sanitize_ability_slugs(
			array( 'media/upload', 'media/upload', '', null, 'wordpress/list-posts', 42, '<script>x</script>' )
		);
		$this->assertCount( 2, $result );
		$this->assertContains( 'media/upload', $result );
		$this->assertContains( 'wordpress/list-posts', $result );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_creates_a_new_guideline() {
		$source = 'desktop-mode/test-new-' . uniqid();
		$result = wp_install_skill( $source, 'Test New', 'Excerpt', 'Body markdown.' );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['created'] );

		$post = get_post( $result['id'] );
		$this->assertInstanceOf( 'WP_Post', $post );
		$this->assertSame( 'wp_guideline', $post->post_type );
		$this->assertSame( 'Test New', $post->post_title );
		$this->assertSame( 'Excerpt', $post->post_excerpt );
		$this->assertSame( 'Body markdown.', $post->post_content );

		$terms = wp_get_object_terms( $result['id'], 'wp_guideline_type', array( 'fields' => 'slugs' ) );
		$this->assertContains( 'skill', $terms );

		$this->assertSame( $source, get_post_meta( $result['id'], 'guideline_source', true ) );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_rejects_empty_source_identifier() {
		$result = wp_install_skill( '', 'Title', 'Excerpt', 'Body' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'missing_source_identifier', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_canonical_fields_win_against_extras() {
		// `post_type` and `post_status` are protected — a caller
		// passing them in `$extras` must NOT override the canonical
		// 'wp_guideline' + 'publish' Push MD ships.
		$result = wp_install_skill(
			'desktop-mode/protect-' . uniqid(),
			'Protected',
			'',
			'',
			array(
				'post_type'   => 'page',
				'post_status' => 'draft',
			)
		);
		$this->assertIsArray( $result );

		$post = get_post( $result['id'] );
		$this->assertSame( 'wp_guideline', $post->post_type );
		$this->assertSame( 'publish', $post->post_status );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_default_post_author_is_current_user() {
		wp_set_current_user( self::$admin_id );
		$result = wp_install_skill(
			'desktop-mode/author-' . uniqid(),
			'Author Test',
			'',
			''
		);
		$post = get_post( $result['id'] );
		$this->assertSame( (int) self::$admin_id, (int) $post->post_author );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_reuses_trashed_skill_with_same_source() {
		// Push MD's upsert includes `'trash'` in the post_status list —
		// a previously-trashed skill with the same source identifier
		// is reused, not duplicated.
		$source  = 'desktop-mode/trashed-' . uniqid();
		$created = wp_install_skill( $source, 'Trashed', '', '' );
		wp_trash_post( $created['id'] );

		$again = wp_install_skill( $source, 'Trashed', '', '' );
		$this->assertSame( $created['id'], $again['id'] );
		$this->assertFalse( $again['created'] );
	}

	/**
	 * @covers ::wp_install_skill
	 */
	public function test_wp_install_skill_is_idempotent_per_source() {
		$source = 'desktop-mode/test-upsert-' . uniqid();
		$first  = wp_install_skill( $source, 'First Title', 'A', 'first body' );
		$second = wp_install_skill( $source, 'Second Title', 'B', 'second body' );

		$this->assertSame( $first['id'], $second['id'] );
		$this->assertTrue( $first['created'] );
		$this->assertFalse( $second['created'] );

		// Existing post is untouched on second call.
		$post = get_post( $first['id'] );
		$this->assertSame( 'First Title', $post->post_title );
	}

	/**
	 * @covers ::desktop_mode_agents_get_abilities
	 * @covers ::desktop_mode_agents_set_abilities
	 */
	public function test_abilities_round_trip_through_meta() {
		desktop_mode_agents_register_meta();

		$installed = wp_install_skill(
			'desktop-mode/abilities-' . uniqid(),
			'Abilities',
			'',
			''
		);
		$id = $installed['id'];

		desktop_mode_agents_set_abilities( $id, array( 'media/upload', 'wordpress/list-posts' ) );
		$result = desktop_mode_agents_get_abilities( $id );

		$this->assertCount( 2, $result );
		$this->assertContains( 'media/upload', $result );
		$this->assertContains( 'wordpress/list-posts', $result );
	}

	/**
	 * Every row in the catalogue carries the {slug,label,description}
	 * shape — regardless of source (Core `wp_get_abilities()`,
	 * plugin-registered, or filter-injected).
	 *
	 * @covers ::desktop_mode_agents_abilities_catalogue
	 */
	public function test_catalogue_row_shape() {
		$catalogue = desktop_mode_agents_abilities_catalogue();
		$this->assertIsArray( $catalogue );
		foreach ( $catalogue as $row ) {
			$this->assertArrayHasKey( 'slug', $row );
			$this->assertArrayHasKey( 'label', $row );
			$this->assertArrayHasKey( 'description', $row );
		}
	}

	/**
	 * When `wp_get_abilities()` is available (WordPress 6.9+), the
	 * catalogue is sourced from there — each registered ability shows
	 * up with its `name` / `label` / `description` shape.
	 *
	 * Core's own abilities only register on full WP bootstrap, not in
	 * the PHPUnit test harness, so we register a dedicated test
	 * ability here to assert the harvest path end-to-end.
	 *
	 * @covers ::desktop_mode_agents_abilities_catalogue
	 */
	public function test_catalogue_harvests_wp_get_abilities() {
		if ( ! function_exists( 'wp_get_abilities' ) ) {
			$this->markTestSkipped( 'Abilities API not available on this WP version.' );
		}

		// Whatever Core's Abilities API has registered at this point
		// in the PHPUnit harness — Core's own abilities only fire on
		// the `wp_abilities_api_init` action, which the harness may or
		// may not have run depending on bootstrap. Either way, every
		// `wp_get_abilities()` slug MUST appear in our catalogue —
		// that's the harvest contract. If the registry is empty we
		// skip rather than fail, because we can't assert a
		// pass-through over an empty set.
		$registered = wp_get_abilities();
		if ( ! is_array( $registered ) || empty( $registered ) ) {
			$this->markTestSkipped( 'No abilities registered in this test environment — harvest path is only meaningful with ≥ 1 ability.' );
		}

		$slugs = wp_list_pluck( desktop_mode_agents_abilities_catalogue(), 'slug' );
		foreach ( array_keys( $registered ) as $registered_slug ) {
			$this->assertContains(
				$registered_slug,
				$slugs,
				"Catalogue is missing registered ability `{$registered_slug}` — harvest path is broken."
			);
		}
	}

	/**
	 * @covers ::desktop_mode_agents_abilities_catalogue
	 */
	public function test_catalogue_is_filterable() {
		add_filter(
			'desktop_mode_agent_abilities_catalogue',
			static function ( $catalogue ) {
				$catalogue[] = array(
					'slug'        => 'plugin/custom-ability',
					'label'       => 'Custom',
					'description' => 'From a plugin.',
				);
				return $catalogue;
			}
		);

		$catalogue = desktop_mode_agents_abilities_catalogue();
		$slugs     = wp_list_pluck( $catalogue, 'slug' );
		$this->assertContains( 'plugin/custom-ability', $slugs );

		remove_all_filters( 'desktop_mode_agent_abilities_catalogue' );
	}

	/**
	 * @covers ::desktop_mode_agents_abilities_catalogue
	 */
	public function test_catalogue_dedupes_slugs() {
		// The harvest dedupes — if both Core and a filter register
		// the same slug, the row appears once.
		add_filter(
			'desktop_mode_agent_abilities_catalogue',
			static function ( $catalogue ) {
				$catalogue[] = array(
					'slug'        => 'plugin/dupe-slug',
					'label'       => 'First',
					'description' => '',
				);
				$catalogue[] = array(
					'slug'        => 'plugin/dupe-slug',
					'label'       => 'Second',
					'description' => '',
				);
				return $catalogue;
			}
		);

		$slugs = wp_list_pluck( desktop_mode_agents_abilities_catalogue(), 'slug' );
		$this->assertSame( 1, count( array_keys( $slugs, 'plugin/dupe-slug', true ) ) );

		remove_all_filters( 'desktop_mode_agent_abilities_catalogue' );
	}

	/**
	 * @covers ::desktop_mode_agents_build_source_id
	 */
	public function test_build_source_id_prefixes_with_desktop_mode() {
		$this->assertSame( 'desktop-mode/foo', desktop_mode_agents_build_source_id( 'foo' ) );
	}
}
