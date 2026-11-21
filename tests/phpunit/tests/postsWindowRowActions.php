<?php
/**
 * Tests for the Posts and Pages apps' row links
 * (`apps/posts/parts/row-actions.php`): the "Clone" / "Edit with …"
 * links a plugin adds to a row on `edit.php`, offered by the windows'
 * row menus too.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-posts-window
 * @group ajax
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_OpenStation_PostsWindowRowActions extends WP_Ajax_UnitTestCase {

	private $admin_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		remove_all_filters( 'page_row_actions' );
		remove_all_filters( 'post_row_actions' );
		parent::tear_down();
	}

	/**
	 * A page's row runs `page_row_actions`: a relative wp-admin link comes
	 * back resolved and flagged as admin, an outside page as not.
	 *
	 * @covers ::openstation_posts_window_ajax_row_actions
	 */
	public function test_returns_the_links_a_plugin_adds_to_a_page_row() {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );
		add_filter(
			'page_row_actions',
			static function ( $actions, $post ) {
				$actions['clone']  = '<a href="admin.php?action=clone&amp;post=' . $post->ID . '">Clone</a>';
				$actions['bricks'] = '<a href="https://builder.example.test/edit/' . $post->ID . '">Edit with Bricks</a>';
				return $actions;
			},
			10,
			2
		);

		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch( 'pages', array( $page ) );

		$this->assertTrue( $response['success'] );
		$this->assertSame(
			array(
				array(
					'key'   => 'clone',
					'label' => 'Clone',
					'url'   => admin_url( 'admin.php?action=clone&post=' . $page ),
					'admin' => true,
				),
				array(
					'key'   => 'bricks',
					'label' => 'Edit with Bricks',
					'url'   => 'https://builder.example.test/edit/' . $page,
					'admin' => false,
				),
			),
			$response['data'][ $page ]
		);
	}

	/**
	 * Core's own verbs, and entries that open nothing outside the list
	 * table (a `#` or `javascript:` link, a button), stay out. A row left
	 * with no plugin links is absent from the answer.
	 *
	 * @covers ::openstation_posts_window_row_links
	 */
	public function test_drops_core_actions_and_script_links() {
		$page  = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$other = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$seen  = array();
		add_filter(
			'page_row_actions',
			static function ( $actions, $post ) use ( &$seen, $page ) {
				$seen = array_keys( $actions );
				if ( $post->ID === $page ) {
					$actions['survey'] = '<a href="#" onclick="return false">Feedback</a>';
					$actions['script'] = '<a href="javascript:void(0)">Run</a>';
					$actions['edit']   = '<a href="https://elsewhere.example.test/">Edit</a>';
				}
				return $actions;
			},
			10,
			2
		);

		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch( 'pages', array( $page, $other ) );

		$this->assertTrue( $response['success'] );
		$this->assertSame( array(), $response['data'] );
		$this->assertSame( array( 'edit', 'inline hide-if-no-js', 'trash', 'view' ), $seen, 'The filter is seeded with the actions Core gives a published row.' );
	}

	/**
	 * A user who may use the window but cannot edit a given post gets
	 * nothing for that post, while their own post still answers.
	 *
	 * @covers ::openstation_posts_window_ajax_row_actions
	 */
	public function test_skips_posts_the_caller_cannot_edit() {
		$author = self::factory()->user->create( array( 'role' => 'author' ) );
		$theirs = self::factory()->post->create( array( 'post_author' => $this->admin_id ) );
		$own    = self::factory()->post->create( array( 'post_author' => $author ) );
		add_filter(
			'post_row_actions',
			static function ( $actions ) {
				$actions['clone'] = '<a href="admin.php?action=clone">Clone</a>';
				return $actions;
			}
		);

		wp_set_current_user( $author );
		$response = $this->dispatch( 'posts', array( $theirs, $own, 0, -$own ) );

		$this->assertTrue( $response['success'] );
		$this->assertSame( array( $own ), array_keys( $response['data'] ) );
	}

	/**
	 * A Subscriber holds a valid nonce but fails the window's gate.
	 *
	 * @covers ::openstation_posts_window_ajax_row_actions
	 */
	public function test_refuses_a_user_the_window_does_not_admit() {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$response = $this->dispatch( 'pages', array( $page ) );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_posts_forbidden', $response['data']['code'] );
	}

	/**
	 * @covers ::openstation_posts_window_ajax_row_actions
	 */
	public function test_refuses_a_bad_nonce() {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );
		wp_set_current_user( $this->admin_id );

		$response = $this->dispatch( 'pages', array( $page ), 'x' );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_posts_bad_nonce', $response['data']['code'] );
	}

	/**
	 * Dispatch the row-actions AJAX action and return the decoded body.
	 *
	 * @param string      $mode  `pages` | `posts`.
	 * @param int[]       $ids   Post ids.
	 * @param string|null $nonce Nonce to send; a valid one when null.
	 */
	private function dispatch( $mode, array $ids, $nonce = null ) {
		$_POST                = array(
			'_ajax_nonce' => null === $nonce ? wp_create_nonce( 'desktop-mode-posts-row-actions' ) : $nonce,
			'mode'        => $mode,
			'ids'         => implode( ',', $ids ),
		);
		$this->_last_response = '';
		try {
			$this->_handleAjax( 'openstation_posts_row_actions' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected — wp_send_json_* throws this in tests.
		} catch ( WPAjaxDieStopException $e ) {
			// Some Core paths throw this variant instead.
		}
		return json_decode( $this->_last_response, true );
	}
}
