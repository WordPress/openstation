<?php
/**
 * Tests for the AI assistant's native-keyword content search.
 *
 * The `search_posts` / `search_pages` / `search_comments` /
 * `search_comments_by_post` tools run WordPress's native search
 * (`WP_Query` `s=` / `get_comments` `search=`) instead of filtering on the
 * `_desktop_mode_ai_analysis` meta. These tests prove content that was
 * NEVER AI-analyzed is still findable, and that the keyword actually
 * filters the result set.
 *
 * The dispatcher is a pure DB query — no OpenAI call — so it runs offline.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiNativeSearch extends WP_UnitTestCase {

	/**
	 * A published post with no analysis meta is found by a title keyword.
	 *
	 * @covers ::desktop_mode_ai_search_dispatch_tool
	 * @covers ::desktop_mode_ai_search_fetch_posts
	 */
	public function test_search_posts_finds_unanalyzed_post_by_keyword() {
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'How to cook paella',
				'post_content' => 'A Valencian rice dish with saffron and rabbit.',
			)
		);

		// Sanity: the post carries no AI analysis meta.
		$this->assertSame(
			'',
			get_post_meta( $post_id, DESKTOP_MODE_AI_META_KEY, true ),
			'Fixture must have no analysis meta — that is the whole point.'
		);

		$result = desktop_mode_ai_search_dispatch_tool(
			'search_posts',
			array( 'query' => 'paella', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $post_id, $ids, 'Keyword search should find the unanalyzed post.' );

		// The model-facing payload exposes a real excerpt, not a precomputed summary.
		$match = $result['items'][ array_search( $post_id, $ids, true ) ];
		$this->assertArrayHasKey( 'excerpt', $match );
		$this->assertArrayNotHasKey( 'ai_summary', $match );
	}

	/**
	 * A keyword that matches nothing returns an empty, well-formed batch.
	 *
	 * @covers ::desktop_mode_ai_search_fetch_posts
	 */
	public function test_search_posts_keyword_excludes_non_matches() {
		self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Tomato soup',
				'post_content' => 'Roasted tomatoes, basil, cream.',
			)
		);

		$result = desktop_mode_ai_search_dispatch_tool(
			'search_posts',
			array( 'query' => 'paella', 'offset' => 0 )
		);

		$this->assertSame( 0, $result['count'], 'A non-matching keyword should return no items.' );
		$this->assertFalse( $result['has_more'] );
	}

	/**
	 * Comments are found by their text with native comment search, with no
	 * analysis meta present.
	 *
	 * @covers ::desktop_mode_ai_search_fetch_comments
	 */
	public function test_search_comments_finds_unanalyzed_comment_by_keyword() {
		$post_id    = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Loved the Alcazaba at sunset, magical views.',
			)
		);

		$result = desktop_mode_ai_search_dispatch_tool(
			'search_comments',
			array( 'query' => 'Alcazaba', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $comment_id, $ids, 'Keyword search should find the unanalyzed comment.' );
	}

	/**
	 * `search_comments_by_post` scopes results to the given post.
	 *
	 * @covers ::desktop_mode_ai_search_fetch_comments_by_post
	 */
	public function test_search_comments_by_post_is_scoped_to_the_post() {
		$post_a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$post_b = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$on_a = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_a,
				'comment_approved' => '1',
				'comment_content'  => 'Question about the night tour please.',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_b,
				'comment_approved' => '1',
				'comment_content'  => 'Another question about the night tour.',
			)
		);

		$result = desktop_mode_ai_search_dispatch_tool(
			'search_comments_by_post',
			array( 'post_id' => $post_a, 'query' => 'night tour', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $on_a, $ids );
		$this->assertCount( 1, $ids, 'Only the target post\'s comments should be returned.' );
	}

	/**
	 * The entity-detail builder no longer requires analysis meta — a plain
	 * published post resolves to a full record built from core fields.
	 *
	 * @covers ::desktop_mode_ai_search_build_entity
	 */
	public function test_build_entity_works_without_analysis_meta() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_title' => 'Plain post' )
		);

		$entity = desktop_mode_ai_search_build_entity( 'post', $post_id );

		$this->assertIsArray( $entity );
		$this->assertSame( $post_id, $entity['id'] );
		$this->assertSame( 'Plain post', $entity['title'] );
		$this->assertArrayHasKey( 'excerpt', $entity );
		$this->assertArrayNotHasKey( 'ai_summary', $entity );
	}
}
