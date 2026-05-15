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
 * @group desktop-mode
 * @group content-graph
 */
class Tests_DesktopMode_ContentGraphGroupBy extends WP_UnitTestCase {

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
		desktop_mode_content_graph_flush_cache();
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

		$payload = desktop_mode_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame( self::$author_a_id, $node['author_id'] );
		$this->assertSame( 2024, $node['year'] );
		$this->assertSame( '2024-03', $node['year_month'] );
		$this->assertSame( array( $cat_id ), $node['category_ids'] );
		$this->assertSame( array( $tag_id ), $node['tag_ids'] );
	}

	public function test_post_with_no_terms_emits_empty_arrays() {
		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		// No category, no tag — the default category factory hook can
		// auto-assign "Uncategorized"; clear it for a clean assertion.
		wp_set_object_terms( $post_id, array(), 'category' );
		wp_set_object_terms( $post_id, array(), 'post_tag' );

		$payload = desktop_mode_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame( array(), $node['category_ids'] );
		$this->assertSame( array(), $node['tag_ids'] );
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

		$payload = desktop_mode_content_graph_build( array( 'post' ) );
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

		$payload = desktop_mode_content_graph_build( array( 'post' ) );

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

		$payload = desktop_mode_content_graph_build( array( 'post' ) );

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
		desktop_mode_content_graph_build( array( 'post' ) );

		// Retag without re-saving the post.
		wp_set_object_terms( $post_id, array( $cat_new ), 'category' );

		$payload = desktop_mode_content_graph_build( array( 'post' ) );
		$node    = $this->find_node( $payload, $post_id );

		$this->assertSame(
			array( $cat_new ),
			$node['category_ids'],
			'set_object_terms must invalidate the graph cache so per-node category_ids stay fresh.'
		);
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
