<?php
/**
 * Tests for the Content Graph group-by payload fields.
 *
 * Covers the per-node (author_id, year, category_ids, tag_ids) +
 * top-level (groups: { authors, categories, tags }) extensions
 * landed alongside the toolbar group-by selector.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group content-graph
 */
class Tests_OpenStation_ContentGraphGroupBy extends WP_UnitTestCase {

	protected static $author_a_id;
	protected static $author_b_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$author_a_id = $factory->user->create(
			array(
				'role'         => 'author',
				'display_name' => 'Alice Example',
			)
		);
		self::$author_b_id = $factory->user->create(
			array(
				'role'         => 'author',
				'display_name' => 'Bob Example',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		// Each test starts from a clean transient cache so we exercise
		// the build path and not a cached payload from a prior test.
		open_station_content_graph_flush_cache();
	}

	public function test_per_node_fields_populated() {
		$cat_id = self::factory()->category->create( array( 'name' => 'News' ) );
		$tag_id = self::factory()->tag->create( array( 'name' => 'Featured' ) );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_date'   => '2024-03-15 10:00:00',
				'post_type'   => 'post',
			)
		);
		wp_set_object_terms( $post_id, array( $cat_id ), 'category' );
		wp_set_object_terms( $post_id, array( $tag_id ), 'post_tag' );

		$payload = open_station_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame( self::$author_a_id, $node['author_id'] );
		$this->assertSame( 2024, $node['year'] );
		$this->assertSame( '2024-03', $node['year_month'] );
		$this->assertSame( array( $cat_id ), $node['category_ids'] );
		$this->assertSame( array( $tag_id ), $node['tag_ids'] );
		$this->assertSame( array(), $node['contributor_ids'] );
	}

	public function test_contributors_from_revision_authors() {
		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		// Insert a revision authored by user B directly. The
		// `wp_save_post_revision` path WP uses on `wp_update_post`
		// captures the CURRENT user as the revision author — in unit
		// tests no current user is set, so we'd get a revision
		// authored by `0`. Inserting the revision row explicitly
		// avoids that and matches the shape `open_station_content_
		// graph_collect_post_contributors` reads from.
		wp_insert_post(
			array(
				'post_type'    => 'revision',
				'post_status'  => 'inherit',
				'post_parent'  => $post_id,
				'post_author'  => self::$author_b_id,
				'post_title'   => 'Revision by B',
				'post_content' => 'edit content',
				'post_name'    => $post_id . '-revision-v1',
			)
		);

		$payload = open_station_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame( self::$author_a_id, $node['author_id'] );
		$this->assertContains( self::$author_b_id, $node['contributor_ids'] );
		// Primary author must NOT appear in the contributor list —
		// the server filters it out so the client can double-weight
		// the primary without also double-counting them via the
		// contributors array.
		$this->assertNotContains( self::$author_a_id, $node['contributor_ids'] );
		// The contributor's display name must be in the catalog so
		// the client can resolve "Bob Example" without a round-trip.
		$this->assertSame(
			'Bob Example',
			$payload['groups']['authors'][ self::$author_b_id ]['name']
		);
	}

	public function test_post_with_no_category_falls_back_to_default_category() {
		// Pin the option so the test is self-contained regardless of
		// whatever default_category the test-suite DB was seeded with.
		update_option( 'default_category', 1 );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		// The factory hook auto-assigns "Uncategorized" (term 1); clear
		// it so we exercise the builder's own fallback rather than
		// inheriting the factory-side assignment.
		wp_set_object_terms( $post_id, array(), 'category' );
		wp_set_object_terms( $post_id, array(), 'post_tag' );

		$payload = open_station_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame(
			array( 1 ),
			$node['category_ids'],
			'A post that supports category but has no terms must fall back to the default category.'
		);
		$this->assertSame( array(), $node['tag_ids'] );
	}

	public function test_default_category_appears_in_groups_catalog_after_fallback() {
		update_option( 'default_category', 1 );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_object_terms( $post_id, array(), 'category' );

		$payload = open_station_content_graph_build( array( 'post' ) );

		// The client resolves cluster labels from groups.categories;
		// the fallback ID must be present there so the label renders.
		$this->assertArrayHasKey(
			1,
			$payload['groups']['categories'],
			'The default category must be in the groups catalog when it is used as a fallback.'
		);
	}

	public function test_post_type_not_supporting_category_keeps_empty_category_ids() {
		// Register a minimal public CPT so the graph builder includes it,
		// and clean it up afterwards so it does not bleed into other tests.
		register_post_type(
			'dm_test_no_cat',
			array(
				'public'     => true,
				'taxonomies' => array( 'post_tag' ),
			)
		);

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'dm_test_no_cat',
			)
		);

		$payload = open_station_content_graph_build( array( 'dm_test_no_cat' ) );
		$node    = $this->find_node( $payload, $post_id );

		// Clean up BEFORE asserting so the CPT never leaks into other
		// tests even when an assertion fails.
		unregister_post_type( 'dm_test_no_cat' );
		open_station_content_graph_flush_cache();

		// category is not registered for this type — the default
		// category fallback must NOT be injected.
		$this->assertSame(
			array(),
			$node['category_ids'],
			'The default category must not be injected for a post type that does not support category.'
		);
	}

	public function test_post_in_two_categories_lists_both() {
		$cat_a = self::factory()->category->create( array( 'name' => 'Engineering' ) );
		$cat_b = self::factory()->category->create( array( 'name' => 'Product' ) );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_object_terms( $post_id, array( $cat_a, $cat_b ), 'category' );

		$payload = open_station_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		sort( $node['category_ids'] );
		$expected = array( $cat_a, $cat_b );
		sort( $expected );
		$this->assertSame( $expected, $node['category_ids'] );
	}

	public function test_groups_catalog_only_contains_referenced_ids() {
		$cat_used   = self::factory()->category->create( array( 'name' => 'Used' ) );
		$cat_unused = self::factory()->category->create( array( 'name' => 'Unused' ) );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_object_terms( $post_id, array( $cat_used ), 'category' );

		$payload = open_station_content_graph_build( array( 'post' ) );

		$this->assertArrayHasKey( $cat_used, $payload['groups']['categories'] );
		$this->assertArrayNotHasKey(
			$cat_unused,
			$payload['groups']['categories'],
			'Group catalog must not list terms no in-scope post belongs to.'
		);
		$this->assertSame( 'Used', $payload['groups']['categories'][ $cat_used ]['name'] );
	}

	public function test_authors_catalog_resolves_names() {
		self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);

		$payload = open_station_content_graph_build( array( 'post' ) );

		$this->assertSame(
			'Alice Example',
			$payload['groups']['authors'][ self::$author_a_id ]['name']
		);
		$this->assertSame(
			'Bob Example',
			$payload['groups']['authors'][ self::$author_b_id ]['name']
		);
	}

	public function test_retagging_busts_cache() {
		$cat_old = self::factory()->category->create( array( 'name' => 'Old' ) );
		$cat_new = self::factory()->category->create( array( 'name' => 'New' ) );

		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_object_terms( $post_id, array( $cat_old ), 'category' );

		// Prime the cache.
		open_station_content_graph_build( array( 'post' ) );

		// Retag without re-saving the post.
		wp_set_object_terms( $post_id, array( $cat_new ), 'category' );

		$payload = open_station_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame(
			array( $cat_new ),
			$node['category_ids'],
			'set_object_terms must invalidate the graph cache so per-node category_ids stay fresh.'
		);
	}

	public function test_post_types_normalizes_legacy_filtered_descriptors() {
		$filter_callback = function( $types ) {
			// Use a slug that is NOT in the default list — the built-in
			// entries already carry `taxonomies`, so asserting on one of
			// them would pass even without the normalization pass.
			$types[] = array(
				'slug'  => 'dm_legacy',
				'label' => 'Legacy',
				'icon'  => 'dashicons-admin-page',
				// Omit 'taxonomies' to simulate a legacy filter callback.
			);
			return $types;
		};

		add_filter( 'open_station_content_graph_post_types', $filter_callback );
		$post_types = open_station_content_graph_post_types();
		remove_filter( 'open_station_content_graph_post_types', $filter_callback );

		$legacy_entry = null;
		foreach ( $post_types as $entry ) {
			if ( 'dm_legacy' === $entry['slug'] ) {
				$legacy_entry = $entry;
				break;
			}
		}

		$this->assertNotNull( $legacy_entry, 'Filtered post type entry must be present.' );
		$this->assertArrayHasKey( 'taxonomies', $legacy_entry, 'Post type entry must be normalized with taxonomies key.' );
		$this->assertFalse( $legacy_entry['taxonomies']['category'], 'Unregistered legacy slug must derive category support = false.' );
		$this->assertFalse( $legacy_entry['taxonomies']['post_tag'], 'Unregistered legacy slug must derive post_tag support = false.' );
	}

	/**
	 * @param array $payload
	 * @param int   $post_id
	 * @return array
	 */
	protected function find_node( $payload, $post_id ) {
		foreach ( $payload['nodes'] as $node ) {
			if ( (int) $node['id'] === (int) $post_id ) {
				return $node;
			}
		}
		$this->fail( "No node for post {$post_id} in payload." );
	}
}
