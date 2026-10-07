<?php

class Tests_OpenStation_AiNativeSearch extends WP_UnitTestCase {

	public function test_search_posts_finds_unanalyzed_post_by_keyword() {
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'How to cook paella',
				'post_content' => 'A Valencian rice dish with saffron and rabbit.',
			)
		);

		$this->assertSame(
			'',
			get_post_meta( $post_id, OPENSTATION_AI_META_KEY, true ),
			'Fixture must have no analysis meta — that is the whole point.'
		);

		$result = openstation_ai_search_dispatch_tool(
			'search_posts',
			array( 'query' => 'paella', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $post_id, $ids, 'Keyword search should find the unanalyzed post.' );

		$match = $result['items'][ array_search( $post_id, $ids, true ) ];
		$this->assertArrayHasKey( 'excerpt', $match );
		$this->assertArrayNotHasKey( 'ai_summary', $match );
	}

	public function test_search_posts_keyword_excludes_non_matches() {
		self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Tomato soup',
				'post_content' => 'Roasted tomatoes, basil, cream.',
			)
		);

		$result = openstation_ai_search_dispatch_tool(
			'search_posts',
			array( 'query' => 'paella', 'offset' => 0 )
		);

		$this->assertSame( 0, $result['count'], 'A non-matching keyword should return no items.' );
		$this->assertFalse( $result['has_more'] );
	}

	public function test_search_posts_excludes_password_protected_posts() {
		$public_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Public paella recipe',
				'post_content' => 'A Valencian rice dish, freely readable.',
			)
		);
		$secret_id = self::factory()->post->create(
			array(
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_title'    => 'Secret paella recipe',
				'post_content'  => 'The paella secret nobody should read.',
			)
		);

		$result = openstation_ai_search_dispatch_tool(
			'search_posts',
			array( 'query' => 'paella', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $public_id, $ids, 'The public post should be found.' );
		$this->assertNotContains( $secret_id, $ids, 'The password-protected post must not leak its body.' );

		$this->assertSame( 1, $result['count'], 'Only the public post should be counted in the batch.' );
		$this->assertSame(
			1,
			$result['total'],
			'The protected post must not inflate total — that counter is an oracle for its contents.'
		);
	}

	public function test_search_comments_finds_unanalyzed_comment_by_keyword() {
		$post_id    = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'      => $post_id,
				'comment_approved'     => '1',
				'comment_content'      => 'Loved the Alcazaba at sunset, magical views.',
				'comment_author'       => 'Rocío',
				'comment_author_email' => 'rocio@example.test',
				'comment_author_IP'    => '192.0.2.7',
			)
		);

		$result = openstation_ai_search_dispatch_tool(
			'search_comments',
			array( 'query' => 'Alcazaba', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $comment_id, $ids, 'Keyword search should find the unanalyzed comment.' );

		$match = $result['items'][ array_search( $comment_id, $ids, true ) ];
		$this->assertSame( 'Rocío', $match['author_name'] );
		$payload = wp_json_encode( $result );
		$this->assertStringNotContainsString( 'rocio@example.test', $payload );
		$this->assertStringNotContainsString( '192.0.2.7', $payload );
	}

	public function test_search_comments_by_post_is_scoped_to_the_post() {
		$post_a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$post_b = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$on_a = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_a,
				'comment_approved' => '1',
				'comment_content'  => 'Question about the night tour please.',
				'comment_author'   => 'Jaime',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_b,
				'comment_approved' => '1',
				'comment_content'  => 'Another question about the night tour.',
			)
		);

		$result = openstation_ai_search_dispatch_tool(
			'search_comments_by_post',
			array( 'post_id' => $post_a, 'query' => 'night tour', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $on_a, $ids );
		$this->assertCount( 1, $ids, 'Only the target post\'s comments should be returned.' );
		$this->assertSame( 'Jaime', $result['items'][0]['author_name'] );
	}

	public function test_build_entity_works_without_analysis_meta() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_title' => 'Plain post' )
		);

		$entity = openstation_ai_search_build_entity( 'post', $post_id );

		$this->assertIsArray( $entity );
		$this->assertSame( $post_id, $entity['id'] );
		$this->assertSame( 'Plain post', $entity['title'] );
		$this->assertArrayHasKey( 'excerpt', $entity );
		$this->assertArrayNotHasKey( 'ai_summary', $entity );
	}

	public function test_continue_label_names_the_entity() {
		$this->assertSame(
			'Continue searching in posts (from item 11)',
			openstation_ai_continue_label( 'search_posts', 11 )
		);
		$this->assertSame(
			'Continue searching in pages (from item 11)',
			openstation_ai_continue_label( 'search_pages', 11 )
		);
		$this->assertSame(
			'Continue searching in comments (from item 4)',
			openstation_ai_continue_label( 'search_comments', 4 )
		);
	}

	public function test_every_resumable_tool_gets_its_own_continue_label() {
		$labels = array();
		foreach ( openstation_ai_search_resumable_tools() as $tool ) {
			$labels[ $tool ] = openstation_ai_continue_label( $tool, 11 );
		}

		$this->assertSame(
			count( $labels ),
			count( array_unique( $labels ) ),
			'A duplicate label means a resumable tool fell through to the default post wording.'
		);
	}

	public function test_build_entity_withholds_private_post_from_subscriber() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret plans' )
		);

		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		$this->assertNull(
			openstation_ai_search_build_entity( 'post', $post_id ),
			'A Subscriber must not read a private post through the entity builder.'
		);
	}

	public function test_build_entity_withholds_draft_post_from_subscriber() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_title' => 'Unpublished' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull( openstation_ai_search_build_entity( 'post', $post_id ) );
	}

	public function test_build_entity_returns_private_post_for_administrator() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret plans' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$entity = openstation_ai_search_build_entity( 'post', $post_id );
		$this->assertIsArray( $entity );
		$this->assertSame( 'private', $entity['status'] );
		$this->assertSame( 'Secret plans', $entity['title'] );
	}

	public function test_build_entity_withholds_non_public_cpt_row() {
		register_post_type( 'os_secret_cpt', array( 'public' => false ) );
		$post_id = self::factory()->post->create(
			array(
				'post_type'    => 'os_secret_cpt',
				'post_status'  => 'publish',
				'post_title'   => 'Internal record',
				'post_content' => 'Plugin-private data.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'post', $post_id ),
			'A non-public CPT row must not be readable through the entity builder.'
		);

		_unregister_post_type( 'os_secret_cpt' );
	}

	public function test_build_entity_withholds_unapproved_comment_from_subscriber() {
		$post_id    = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '0',
				'comment_content'  => 'Pending moderation.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'comment', $comment_id ),
			'A Subscriber must not read an unapproved comment through the entity builder.'
		);
	}

	public function test_build_entity_suppresses_moderation_fields_for_non_moderator() {
		$post_id    = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Great write-up.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$entity = openstation_ai_search_build_entity( 'comment', $comment_id );
		$this->assertIsArray( $entity );
		$this->assertArrayNotHasKey( 'harmful', $entity, 'Verdicts are moderator-only.' );
		$this->assertArrayNotHasKey( 'spam', $entity, 'Verdicts are moderator-only.' );
		$this->assertSame( '', $entity['edit_url'], 'The edit link needs edit_comment.' );
	}

	public function test_build_entity_exposes_moderation_fields_to_moderator() {
		$post_id    = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Great write-up.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$entity = openstation_ai_search_build_entity( 'comment', $comment_id );
		$this->assertIsArray( $entity );
		$this->assertArrayHasKey( 'harmful', $entity );
		$this->assertArrayHasKey( 'spam', $entity );
		$this->assertNotSame( '', $entity['edit_url'] );
	}

	public function test_build_entity_withholds_password_protected_post_from_subscriber() {
		$post_id = self::factory()->post->create(
			array(
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_title'    => 'Members only',
				'post_content'  => 'The members-only body.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'post', $post_id ),
			'A Subscriber without the password must not read a protected post.'
		);
	}

	public function test_build_entity_returns_password_protected_post_to_editor() {
		$post_id = self::factory()->post->create(
			array(
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_title'    => 'Members only',
				'post_content'  => 'The members-only body.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$entity = openstation_ai_search_build_entity( 'post', $post_id );
		$this->assertIsArray( $entity );
		$this->assertStringContainsString( 'members-only body', $entity['excerpt'] );
	}

	public function test_build_entity_withholds_comment_on_private_parent() {
		$post_id    = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret plans' )
		);
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Looks good to me.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'comment', $comment_id ),
			'A private parent must not leak its title through an approved comment.'
		);
	}

	public function test_build_entity_withholds_comment_on_draft_parent() {
		$post_id    = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_title' => 'Unpublished' )
		);
		$comment_id = self::factory()->comment->create(
			array( 'comment_post_ID' => $post_id, 'comment_approved' => '1' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull( openstation_ai_search_build_entity( 'comment', $comment_id ) );
	}

	public function test_build_entity_returns_comment_on_private_parent_for_administrator() {
		$post_id    = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret plans' )
		);
		$comment_id = self::factory()->comment->create(
			array( 'comment_post_ID' => $post_id, 'comment_approved' => '1' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$entity = openstation_ai_search_build_entity( 'comment', $comment_id );
		$this->assertIsArray( $entity );
		$this->assertSame( 'Secret plans', $entity['post_title'] );
	}

	public function test_build_entity_withholds_comment_on_non_public_cpt_parent() {
		register_post_type( 'os_secret_cpt', array( 'public' => false ) );
		$post_id    = self::factory()->post->create(
			array(
				'post_type'   => 'os_secret_cpt',
				'post_status' => 'publish',
				'post_title'  => 'Internal record',
			)
		);
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Refunded via gateway, ref 8812.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'comment', $comment_id ),
			'A non-public CPT parent must not leak through its comments.'
		);

		_unregister_post_type( 'os_secret_cpt' );
	}

	public function test_search_comments_by_post_refuses_non_public_cpt_parent() {
		register_post_type( 'os_secret_cpt', array( 'public' => false ) );
		$post_id = self::factory()->post->create(
			array( 'post_type' => 'os_secret_cpt', 'post_status' => 'publish' )
		);
		self::factory()->comment->create(
			array( 'comment_post_ID' => $post_id, 'comment_approved' => '1' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = openstation_ai_search_dispatch_tool(
			'search_comments_by_post',
			array( 'post_id' => $post_id, 'query' => '', 'offset' => 0 )
		);

		$this->assertSame( 0, $result['count'] );
		$this->assertArrayHasKey( 'error', $result );

		_unregister_post_type( 'os_secret_cpt' );
	}

	public function test_search_comments_hides_comments_on_private_posts_from_subscriber() {
		$author_id  = self::factory()->user->create( array( 'role' => 'author' ) );
		$private_id = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_author' => $author_id )
		);
		$public_id  = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$hidden  = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $private_id,
				'comment_approved' => '1',
				'comment_content'  => 'Secret marker paellamarker on a private post.',
			)
		);
		$visible = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $public_id,
				'comment_approved' => '1',
				'comment_content'  => 'Public marker paellamarker on a published post.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = openstation_ai_search_dispatch_tool(
			'search_comments',
			array( 'query' => 'paellamarker', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertNotContains( $hidden, $ids, 'A Subscriber must not see a comment on a private post.' );
		$this->assertContains( $visible, $ids, 'A comment on a published post is still returned.' );
	}

	public function test_search_comments_hides_comments_on_password_posts_from_subscriber() {
		$protected_id = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_password' => 'hunter2' )
		);

		$hidden = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $protected_id,
				'comment_approved' => '1',
				'comment_content'  => 'Secret marker walledgarden behind a password.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = openstation_ai_search_dispatch_tool(
			'search_comments',
			array( 'query' => 'walledgarden', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertNotContains( $hidden, $ids, 'A Subscriber must not see a comment on a password-protected post.' );
	}

	public function test_search_comments_honours_a_satisfied_post_password() {
		$protected_id = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_password' => 'hunter2' )
		);
		$comment_id   = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $protected_id,
				'comment_approved' => '1',
				'comment_content'  => 'Unlocked marker greenhouse behind a password.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		require_once ABSPATH . WPINC . '/class-phpass.php';
		$hasher = new PasswordHash( 8, true );

		$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = $hasher->HashPassword( 'hunter2' );
		try {
			$result = openstation_ai_search_dispatch_tool(
				'search_comments',
				array( 'query' => 'greenhouse', 'offset' => 0 )
			);
			$entity = openstation_ai_search_build_entity( 'comment', $comment_id );
		} finally {
			unset( $_COOKIE[ 'wp-postpass_' . COOKIEHASH ] );
		}

		$this->assertContains(
			$comment_id,
			wp_list_pluck( $result['items'], 'id' ),
			'A caller who entered the post password reads its discussion, as on the front end.'
		);
		$this->assertIsArray( $entity, 'Entity hydration honours the satisfied password too.' );
	}

	public function test_search_comments_still_shows_private_comments_to_admin() {
		$private_id = self::factory()->post->create( array( 'post_status' => 'private' ) );
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $private_id,
				'comment_approved' => '1',
				'comment_content'  => 'Admin-visible marker paellamarker on a private post.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$result = openstation_ai_search_dispatch_tool(
			'search_comments',
			array( 'query' => 'paellamarker', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $comment_id, $ids, 'An administrator can read comments on private posts.' );
	}

	public function test_search_comments_by_post_hides_private_post_from_subscriber() {
		$private_id = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret roadmap' )
		);
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $private_id,
				'comment_approved' => '1',
				'comment_content'  => 'A comment on the secret roadmap.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = openstation_ai_search_dispatch_tool(
			'search_comments_by_post',
			array( 'post_id' => $private_id, 'query' => '', 'offset' => 0 )
		);

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertNotContains( $comment_id, $ids, 'A Subscriber must not read comments on a private post.' );
		$this->assertSame( 0, $result['count'] );
		$this->assertArrayNotHasKey( 'post_title', $result, 'The private parent title must not leak.' );
	}

	public function test_search_comments_hides_orphaned_comments_despite_global_post() {
		$public_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$orphan    = self::factory()->comment->create(
			array(
				'comment_post_ID'  => 0,
				'comment_approved' => '1',
				'comment_content'  => 'Orphan marker driftwood with no parent post.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$GLOBALS['post'] = get_post( $public_id );
		try {
			$result = openstation_ai_search_dispatch_tool(
				'search_comments',
				array( 'query' => 'driftwood', 'offset' => 0 )
			);
		} finally {
			unset( $GLOBALS['post'] );
		}

		$ids = wp_list_pluck( $result['items'], 'id' );
		$this->assertNotContains( $orphan, $ids, 'An orphaned comment must not be judged against the global $post.' );
	}

	public function test_search_comments_hides_comments_on_non_viewable_post_types() {
		register_post_type(
			'os_internal',
			array(
				'public'       => false,
				'map_meta_cap' => true,
			)
		);

		try {
			$cpt_id = self::factory()->post->create(
				array( 'post_type' => 'os_internal', 'post_status' => 'publish' )
			);
			$hidden = self::factory()->comment->create(
				array(
					'comment_post_ID'  => $cpt_id,
					'comment_approved' => '1',
					'comment_content'  => 'Internal marker backstage on an admin-only type.',
				)
			);

			wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
			$result = openstation_ai_search_dispatch_tool(
				'search_comments',
				array( 'query' => 'backstage', 'offset' => 0 )
			);
			$this->assertNotContains(
				$hidden,
				wp_list_pluck( $result['items'], 'id' ),
				'A Subscriber must not see comments on a non-viewable post type.'
			);

			wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
			$result = openstation_ai_search_dispatch_tool(
				'search_comments',
				array( 'query' => 'backstage', 'offset' => 0 )
			);
			$this->assertContains(
				$hidden,
				wp_list_pluck( $result['items'], 'id' ),
				'Someone who can edit the post still sees its discussion.'
			);
		} finally {
			_unregister_post_type( 'os_internal' );
		}
	}

	public function test_build_entity_hides_unreadable_targets_from_subscriber() {
		$private_id     = self::factory()->post->create(
			array( 'post_status' => 'private', 'post_title' => 'Secret roadmap' )
		);
		$hidden_comment = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $private_id,
				'comment_approved' => '1',
				'comment_content'  => 'A comment on the secret roadmap.',
			)
		);
		$password_id    = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_password' => 'hunter2' )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull(
			openstation_ai_search_build_entity( 'comment', $hidden_comment ),
			'A model-supplied comment id on a private post must not hydrate.'
		);
		$this->assertNull(
			openstation_ai_search_build_entity( 'post', $private_id ),
			'A model-supplied private post id must not hydrate.'
		);
		$this->assertNull(
			openstation_ai_search_build_entity( 'post', $password_id ),
			'A model-supplied password-protected post id must not hydrate.'
		);
	}

	public function test_build_entity_hides_unapproved_comments_from_non_moderators() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$pending = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '0',
				'comment_content'  => 'A pending comment awaiting moderation.',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertNull(
			openstation_ai_search_build_entity( 'comment', $pending ),
			'A Subscriber must not hydrate an unapproved comment.'
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->assertIsArray(
			openstation_ai_search_build_entity( 'comment', $pending ),
			'A moderator still hydrates the pending comment.'
		);
	}
}
