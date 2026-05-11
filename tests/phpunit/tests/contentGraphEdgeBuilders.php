<?php
/**
 * Tests for Content Graph edge-type extractors and per-node taxonomy
 * membership emission added in 0.9.0.
 *
 * Covers `desktop_mode_content_graph_build()` with various
 * combinations of `$edge_kinds` and `$taxonomies`, the cache-key hash
 * domain, and the 50-term-per-(post, taxonomy) truncation cap.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-content-graph
 */
class Tests_DesktopMode_ContentGraphEdgeBuilders extends WP_UnitTestCase {

	/**
	 * Force a clean transient namespace before each test so we don't
	 * race against another test's fixture.
	 */
	public function set_up() {
		parent::set_up();
		desktop_mode_content_graph_flush_cache();
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_link_edges_only_when_link_kind_requested() {
		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$b = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_content' => '<a href="' . get_permalink( $a ) . '">link</a>',
			)
		);

		$with_link = desktop_mode_content_graph_build( array( 'post' ), array( 'link' ), array() );
		$this->assertCount( 1, $with_link['edges'], 'link edge expected' );
		$this->assertSame( 'link', $with_link['edges'][0]['kind'] );
		$this->assertSame( $b, $with_link['edges'][0]['from'] );
		$this->assertSame( $a, $with_link['edges'][0]['to'] );

		desktop_mode_content_graph_flush_cache();

		$without_link = desktop_mode_content_graph_build( array( 'post' ), array( 'co_author' ), array() );
		$this->assertSame( 0, $this->edges_with_kind( $without_link['edges'], 'link' ) );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_co_author_edges_pair_posts_sharing_post_author() {
		$author = self::factory()->user->create();
		$other  = self::factory()->user->create();

		$a = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $author,
			)
		);
		$b = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $author,
			)
		);
		$c = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $other,
			)
		);

		$payload = desktop_mode_content_graph_build( array( 'post' ), array( 'co_author' ), array() );
		$pairs   = $this->pairs_with_kind( $payload['edges'], 'co_author' );
		$this->assertCount( 1, $pairs, 'exactly one co-author pair from author' );
		$expected = $a < $b ? array( $a, $b ) : array( $b, $a );
		$this->assertSame( $expected, $pairs[0] );
		// And no spurious edges to the post by the other author.
		foreach ( $pairs as $pair ) {
			$this->assertNotContains( $c, $pair );
		}
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_hierarchy_edges_emit_only_when_parent_in_scope() {
		$parent = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_type'   => 'page',
			)
		);
		$child = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_type'   => 'page',
				'post_parent' => $parent,
			)
		);
		// Out-of-scope child whose parent is also a page but which we
		// won't include in the build's $types.
		$post_child = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_type'   => 'post',
				'post_parent' => $parent,
			)
		);

		$payload = desktop_mode_content_graph_build( array( 'page' ), array( 'hierarchy' ), array() );
		$pairs   = $this->pairs_with_kind( $payload['edges'], 'hierarchy' );
		$this->assertCount( 1, $pairs );
		$this->assertSame( array( $parent, $child ), $pairs[0] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_co_tag_edges_pair_posts_sharing_terms() {
		$cat_news   = self::factory()->category->create( array( 'name' => 'News' ) );
		$tag_breaking = self::factory()->tag->create( array( 'name' => 'Breaking' ) );

		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$b = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$c = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		wp_set_object_terms( $a, array( $cat_news ), 'category' );
		wp_set_object_terms( $b, array( $cat_news ), 'category' );
		wp_set_object_terms( $a, array( $tag_breaking ), 'post_tag' );
		wp_set_object_terms( $c, array( $tag_breaking ), 'post_tag' );

		$payload = desktop_mode_content_graph_build(
			array( 'post' ),
			array( 'co_tag' ),
			array( 'category', 'post_tag' )
		);
		$pairs = $this->pairs_with_kind( $payload['edges'], 'co_tag' );
		// Expect (a,b) on category and (a,c) on post_tag — but NOT
		// (b,c) which share no taxonomy memberships.
		$ab = array( min( $a, $b ), max( $a, $b ) );
		$ac = array( min( $a, $c ), max( $a, $c ) );
		$bc = array( min( $b, $c ), max( $b, $c ) );
		$this->assertContains( $ab, $pairs );
		$this->assertContains( $ac, $pairs );
		$this->assertNotContains( $bc, $pairs );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_per_node_terms_emission_when_taxonomies_in_scope() {
		$cat = self::factory()->category->create( array( 'name' => 'Travel' ) );
		$tag = self::factory()->tag->create( array( 'name' => 'sunset' ) );

		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_set_object_terms( $a, array( $cat ), 'category' );
		wp_set_object_terms( $a, array( $tag ), 'post_tag' );

		$payload = desktop_mode_content_graph_build(
			array( 'post' ),
			array( 'link' ),
			array( 'category', 'post_tag' )
		);
		$node = $this->find_node( $payload['nodes'], $a );
		$this->assertNotNull( $node );
		$this->assertIsArray( $node['terms'] );
		$this->assertSame( array( $cat ), $node['terms']['category'] );
		$this->assertSame( array( $tag ), $node['terms']['post_tag'] );
	}

	/**
	 * Nodes with no in-scope memberships still carry a `terms`
	 * field (empty), so consumers don't need a null-check branch.
	 *
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_node_terms_is_object_when_no_memberships() {
		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		// WP's post factory auto-assigns the default category. Strip
		// every term relationship so the post genuinely has no
		// memberships in any taxonomy.
		wp_set_object_terms( $a, array(), 'category' );
		wp_set_object_terms( $a, array(), 'post_tag' );

		$payload = desktop_mode_content_graph_build(
			array( 'post' ),
			array( 'link' ),
			array( 'category' )
		);
		$node = $this->find_node( $payload['nodes'], $a );
		$this->assertNotNull( $node );
		$this->assertArrayHasKey( 'terms', $node );
		// Empty membership is emitted as an empty object (stdClass) so
		// JSON encoding produces `{}` not `[]`.
		$this->assertInstanceOf( 'stdClass', $node['terms'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_terms_truncation_fires_observability_action() {
		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$tag_ids = array();
		for ( $i = 0; $i < DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP + 5; $i++ ) {
			$tag_ids[] = self::factory()->tag->create( array( 'slug' => 'cap-' . $i ) );
		}
		wp_set_object_terms( $a, $tag_ids, 'post_tag' );

		$captured = array();
		$listener = static function ( $post_id, $taxonomy, $count ) use ( &$captured ) {
			$captured[] = array( $post_id, $taxonomy, $count );
		};
		add_action( 'desktop_mode_content_graph_terms_truncated', $listener, 10, 3 );

		$payload = desktop_mode_content_graph_build(
			array( 'post' ),
			array( 'link' ),
			array( 'post_tag' )
		);

		remove_action( 'desktop_mode_content_graph_terms_truncated', $listener, 10 );

		$node = $this->find_node( $payload['nodes'], $a );
		$this->assertNotNull( $node );
		$this->assertCount(
			DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP,
			$node['terms']['post_tag'],
			'truncation cap applied'
		);
		$this->assertNotEmpty( $captured, 'observability action fired' );
		$this->assertSame( $a, $captured[0][0] );
		$this->assertSame( 'post_tag', $captured[0][1] );
		$this->assertSame( DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP + 5, $captured[0][2] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_edges_param_filters_to_requested_kinds() {
		$author = self::factory()->user->create();
		$cat    = self::factory()->category->create();

		$a = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $author,
			)
		);
		$b = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_author'  => $author,
				'post_content' => '<a href="' . get_permalink( $a ) . '">link</a>',
			)
		);
		wp_set_object_terms( $a, array( $cat ), 'category' );
		wp_set_object_terms( $b, array( $cat ), 'category' );

		$only_link = desktop_mode_content_graph_build( array( 'post' ), array( 'link' ), array( 'category' ) );
		$this->assertSame( 1, $this->edges_with_kind( $only_link['edges'], 'link' ) );
		$this->assertSame( 0, $this->edges_with_kind( $only_link['edges'], 'co_tag' ) );
		$this->assertSame( 0, $this->edges_with_kind( $only_link['edges'], 'co_author' ) );

		desktop_mode_content_graph_flush_cache();

		$link_and_tag = desktop_mode_content_graph_build( array( 'post' ), array( 'link', 'co_tag' ), array( 'category' ) );
		$this->assertSame( 1, $this->edges_with_kind( $link_and_tag['edges'], 'link' ) );
		$this->assertSame( 1, $this->edges_with_kind( $link_and_tag['edges'], 'co_tag' ) );
		$this->assertSame( 0, $this->edges_with_kind( $link_and_tag['edges'], 'co_author' ) );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_unknown_edge_kinds_are_silently_dropped() {
		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		// Should not error; unknown kinds normalise to no-op.
		$payload = desktop_mode_content_graph_build( array( 'post' ), array( 'link', 'no_such_kind' ), array() );
		$this->assertIsArray( $payload['edges'] );
		// Still returns the link edge ecosystem (zero edges in this
		// fixture but the call succeeds).
		$node = $this->find_node( $payload['nodes'], $a );
		$this->assertNotNull( $node );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_unknown_taxonomies_are_silently_dropped() {
		$a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		// Strip auto-assigned default category so the post starts truly
		// memberless.
		wp_set_object_terms( $a, array(), 'category' );
		wp_set_object_terms( $a, array(), 'post_tag' );

		$payload = desktop_mode_content_graph_build( array( 'post' ), array( 'link' ), array( 'category', 'no_such_taxonomy' ) );
		$node    = $this->find_node( $payload['nodes'], $a );
		$this->assertNotNull( $node );
		// The known-but-unmembered taxonomy still yields an empty terms object.
		$this->assertInstanceOf( 'stdClass', $node['terms'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_build
	 */
	public function test_set_object_terms_invalidates_cache() {
		$cat = self::factory()->category->create();
		$a   = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$b   = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		wp_set_object_terms( $a, array( $cat ), 'category' );
		// First call: only A has the category. Expect 0 co_tag edges
		// since no other post shares it.
		$payload_before = desktop_mode_content_graph_build( array( 'post' ), array( 'co_tag' ), array( 'category' ) );
		$this->assertSame( 0, $this->edges_with_kind( $payload_before['edges'], 'co_tag' ) );

		// Now add the same category to B. The set_object_terms hook
		// must have flushed the cache, so the next call recomputes
		// and surfaces the (a, b) co-tag edge.
		wp_set_object_terms( $b, array( $cat ), 'category' );

		$payload_after = desktop_mode_content_graph_build( array( 'post' ), array( 'co_tag' ), array( 'category' ) );
		$this->assertSame( 1, $this->edges_with_kind( $payload_after['edges'], 'co_tag' ) );
	}

	// --- helpers -----------------------------------------------------

	private function edges_with_kind( array $edges, $kind ) {
		$n = 0;
		foreach ( $edges as $e ) {
			if ( $kind === $e['kind'] ) {
				$n++;
			}
		}
		return $n;
	}

	private function pairs_with_kind( array $edges, $kind ) {
		$out = array();
		foreach ( $edges as $e ) {
			if ( $kind === $e['kind'] ) {
				$out[] = array( (int) $e['from'], (int) $e['to'] );
			}
		}
		return $out;
	}

	private function find_node( array $nodes, $id ) {
		foreach ( $nodes as $n ) {
			if ( (int) $n['id'] === (int) $id ) {
				return $n;
			}
		}
		return null;
	}
}
