<?php
/**
 * Comments app — the model: what the rail and the conversation read,
 * and what each dispatched action does to the state.
 *
 * Reads go through the in-process REST proxy against `wp/v2/comments`
 * — the same collection, the same `openstation_*` fields and the same
 * filterable `_fields` projection the old bundle fetched over HTTP —
 * so a row here is byte-identical to a row there. Writes go through
 * the operations in `rest.php`, shared with the public routes.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Comments;

use OpenStation\App\Os;
use OpenStation\App\State;

defined( 'ABSPATH' ) || exit;

/** Rows per rail page, the old bundle's `defaultPerPage`. */
const PER_PAGE = 20;

/**
 * Fields the conversation pane renders for a thread message —
 * narrower than the rail's projection: a thread message needs no
 * `openstation_replies_count` (one `get_comments()` COUNT per row) and
 * at up to 100 rows per thread that is the difference between one
 * cheap query and a hundred.
 */
const THREAD_FIELDS = 'id,post,parent,author,author_name,author_avatar_urls,date_gmt,content,status,'
	. 'openstation_post_title,openstation_post_link,openstation_can_edit,openstation_can_moderate';

/**
 * `tab` → `wp/v2/comments` `status`. Single values only: the collection
 * declares `status` as a `sanitize_key` string, which silently STRIPS
 * commas, so a comma list reaches `WP_Comment_Query` as one nonsense
 * status and returns an empty list with a 200. `all` is approved AND
 * pending (not spam/trash); `any` is every status.
 *
 * @param string $tab Tab value.
 * @return string
 */
function status_for_tab( $tab ) {
	switch ( (string) $tab ) {
		case 'all':
			return 'all';
		case 'spam':
			return 'spam';
		case 'trash':
			return 'trash';
		case 'mine':
			// Every status the viewer authored on; the author filter
			// is applied by the caller.
			return 'any';
		default:
			return 'hold';
	}
}

/**
 * The rail's query: the filtered default args, then the tab, page,
 * search, viewer (Mine), post scope, and `parent=0` — the rail lists
 * conversations, so it asks the server for roots rather than
 * client-filtering a mixed page (a page of nothing but replies used to
 * render an empty rail while the badge still counted them).
 *
 * @param State $state State.
 * @return array<string,mixed>
 */
function rail_query( State $state ) {
	$query = \openstation_comments_window_default_query_args();
	unset( $query['status'] );
	$tab             = (string) $state->get( 'tab' );
	$query['status'] = status_for_tab( $tab );
	$query['page']   = max( 1, (int) $state->get( 'page' ) );
	$per_page        = (int) $state->get( 'perPage' );
	$query['per_page'] = $per_page > 0 ? $per_page : PER_PAGE;
	$search          = trim( (string) $state->get( 'search' ) );
	if ( '' !== $search ) {
		$query['search'] = $search;
	}
	// `author`, `post` and `parent` are array params on the collection
	// (`author__in`, `post__in`, `parent__in`); `parent = [0]` is a
	// non-empty array, so the `comment_parent IN (0)` clause applies.
	if ( 'mine' === $tab && get_current_user_id() > 0 ) {
		$query['author'] = array( get_current_user_id() );
	}
	$post = (int) $state->get( 'post' );
	if ( $post > 0 ) {
		$query['post'] = array( $post );
	}
	$query['parent'] = array( 0 );
	return $query;
}

/**
 * The identity of the rail's result set — what the client's page
 * accumulation is keyed on. `gen` is bumped by every mutation, so a
 * moderation or a reply starts the accumulation clean the way the old
 * bundle's silent page-1 reload did.
 *
 * @param State $state State.
 * @return string
 */
function rail_key( State $state ) {
	return implode(
		'|',
		array(
			(string) $state->get( 'tab' ),
			trim( (string) $state->get( 'search' ) ),
			(string) (int) $state->get( 'post' ),
			(string) (int) $state->get( 'gen' ),
		)
	);
}

/**
 * The rail page for a state, memoised per request so an action that
 * needs the rows (to auto-select) and `data()` share one query.
 *
 * @param State $state State.
 * @return array{items:array<int,mixed>,total:int,pages:int,page:int,perPage:int,error:string}
 */
function rail( State $state ) {
	static $memo = array();
	$query = rail_query( $state );
	$key   = (string) wp_json_encode( $query );
	if ( ! isset( $memo[ $key ] ) ) {
		$memo[ $key ] = \openstation_app_rest_page( 'wp/v2/comments', $query );
	}
	return $memo[ $key ];
}

/**
 * Every comment on the selected conversation's post (all depths, all
 * statuses) — the conversation pane builds the nested tree from it.
 * `status=any` is the vocabulary for "no status clause at all", so a
 * spam or trashed reply still renders in context; it is a protected
 * collection param requiring `edit_posts`, the cap the app is gated
 * on. Null when nothing is selected or the read failed (the client
 * then paints the root alone, as the old bundle did).
 *
 * @param int $selected Selected root comment id.
 * @return array<int,mixed>|null
 */
function thread( $selected ) {
	$selected = (int) $selected;
	if ( $selected <= 0 ) {
		return null;
	}
	$root = get_comment( $selected );
	if ( ! $root instanceof \WP_Comment ) {
		return null;
	}
	$query = \openstation_comments_window_default_query_args();
	unset( $query['status'], $query['parent'], $query['_fields'] );
	$query['post']     = array( (int) $root->comment_post_ID );
	$query['per_page'] = 100;
	$query['orderby']  = 'date';
	$query['order']    = 'asc';
	$query['status']   = 'any';
	$query['_fields']  = THREAD_FIELDS;

	$result = \openstation_app_rest( 'GET', 'wp/v2/comments', $query );
	if ( ! $result['ok'] || ! is_array( $result['data'] ) ) {
		return null;
	}
	$rows = array_values( $result['data'] );
	// The tree build relies on sibling order being chronological —
	// make that a property of this function rather than of the query.
	usort(
		$rows,
		static function ( $a, $b ) {
			return strcmp( (string) ( $a['date_gmt'] ?? '' ), (string) ( $b['date_gmt'] ?? '' ) );
		}
	);
	return $rows;
}

/**
 * Everything the client view paints from.
 *
 * @param State $state State.
 * @return array<string,mixed>
 */
function data( State $state ) {
	return array(
		'rail'    => rail( $state ),
		'railKey' => rail_key( $state ),
		'thread'  => thread( (int) $state->get( 'selected' ) ),
		'counts'  => \openstation_comments_window_counts(),
	);
}

// ---------------------------------------------------------------- actions

/**
 * Start a fresh result set: page 1, a new accumulation key.
 *
 * @param State $state State.
 */
function restart( State $state ) {
	$state->set( 'page', 1 );
	$state->set( 'gen', (int) $state->get( 'gen' ) + 1 );
}

/**
 * Keep the selection honest against page 1: a conversation that left
 * the view gives way to the first one still in it, and an empty view
 * clears it — what the old rail did after every reload.
 *
 * @param State $state State.
 */
function auto_select( State $state ) {
	if ( 1 !== (int) $state->get( 'page' ) ) {
		return;
	}
	$items    = rail( $state )['items'];
	$selected = (int) $state->get( 'selected' );
	foreach ( $items as $row ) {
		if ( isset( $row['id'] ) && (int) $row['id'] === $selected ) {
			return;
		}
	}
	$first = isset( $items[0]['id'] ) ? (int) $items[0]['id'] : 0;
	$state->set( 'selected', $first );
}

/**
 * Scope the rail to the `post` open-time param — the
 * `edit-comments.php?p=<id>` deep link. A scoped open starts on "All"
 * so the post's whole thread is visible, not just its pending
 * comments; `0` (a plain open) clears the scope.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 */
function scope_from_params( State $state, Os $os ) {
	$post = max( 0, (int) $os->param( 'post', 0 ) );
	$state->set( 'post', $post );
	if ( $post > 0 ) {
		$state->set( 'tab', 'all' );
	}
	restart( $state );
	auto_select( $state );
}

/**
 * `mount` — the first render.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 */
function mount( State $state, Os $os ) {
	scope_from_params( $state, $os );
}

/**
 * `reopen` — a live window asked to open again, possibly on another post.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 */
function reopen_action( State $state, Os $os ) {
	scope_from_params( $state, $os );
}

/**
 * `filter` — the tab, the search or the post scope changed (the bound
 * value already rode up with the state; `post` may also arrive as an
 * argument, from the scope banner's Show all).
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Args.
 */
function filter_action( State $state, Os $os, array $args ) {
	if ( array_key_exists( 'post', $args ) ) {
		$state->set( 'post', max( 0, (int) $args['post'] ) );
	}
	restart( $state );
	auto_select( $state );
}

/**
 * `page` — Load more: the next rail page joins the accumulation.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `page`.
 */
function page_action( State $state, Os $os, array $args ) {
	$state->set( 'page', max( 1, (int) ( $args['page'] ?? 1 ) ) );
}

/**
 * `select` — read this conversation.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `id`.
 */
function select_action( State $state, Os $os, array $args ) {
	$state->set( 'selected', max( 0, (int) ( $args['id'] ?? 0 ) ) );
}

/**
 * `moderate` — approve / unapprove / spam / unspam / trash / untrash.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `ids` (or `id`), `action`.
 * @throws \RuntimeException When refused or nothing could be processed.
 */
function moderate_action( State $state, Os $os, array $args ) {
	if ( ! $os->can( 'moderate_comments' ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to moderate comments.', 'desktop-mode' ) );
	}
	$ids = isset( $args['ids'] ) ? (array) $args['ids'] : array( $args['id'] ?? 0 );
	$verb = (string) ( $args['action'] ?? '' );
	$result = \openstation_comments_window_moderate( $ids, $verb );
	if ( is_wp_error( $result ) ) {
		throw new \RuntimeException( esc_html( $result->get_error_message() ) );
	}
	if ( array() === $result['processed'] ) {
		throw new \RuntimeException( esc_html__( 'Action failed.', 'desktop-mode' ) );
	}
	$changes = array(
		'trash'   => 'trashed',
		'spam'    => 'trashed',
		'untrash' => 'untrashed',
		'unspam'  => 'untrashed',
	);
	$os->announce( 'comment', $changes[ $verb ] ?? 'updated', $result['processed'] );
	restart( $state );
	auto_select( $state );
}

/**
 * `reply` — post a reply under a comment.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `parent`, `content`.
 * @throws \RuntimeException When refused.
 */
function reply_action( State $state, Os $os, array $args ) {
	if ( ! $os->can( 'edit_posts' ) ) {
		throw new \RuntimeException( esc_html__( 'You must be logged in to reply.', 'desktop-mode' ) );
	}
	$result = \openstation_comments_window_create_reply( (int) ( $args['parent'] ?? 0 ), (string) ( $args['content'] ?? '' ) );
	if ( is_wp_error( $result ) ) {
		throw new \RuntimeException( esc_html( $result->get_error_message() ) );
	}
	$os->announce( 'comment', 'created', array( (int) $result['id'] ) );
	restart( $state );
	auto_select( $state );
}

/**
 * `edit` — rewrite a comment's body, through the core controller so
 * its sanitisation and its per-target permission stay the truth.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `id`, `content`.
 * @throws \RuntimeException When refused or the write failed.
 */
function edit_action( State $state, Os $os, array $args ) {
	$id      = (int) ( $args['id'] ?? 0 );
	$content = (string) ( $args['content'] ?? '' );
	if ( $id <= 0 || ! $os->can( 'edit_comment', $id ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to edit this comment.', 'desktop-mode' ) );
	}
	if ( '' === trim( wp_strip_all_tags( $content ) ) ) {
		throw new \RuntimeException( esc_html__( 'A comment cannot be empty.', 'desktop-mode' ) );
	}
	$result = \openstation_app_rest( 'POST', 'wp/v2/comments/' . $id, array(), array( 'content' => $content ) );
	if ( ! $result['ok'] ) {
		throw new \RuntimeException( esc_html( '' !== $result['error'] ? $result['error'] : __( 'Edit failed.', 'desktop-mode' ) ) );
	}
	$os->announce( 'comment', 'updated', array( $id ) );
	$state->set( 'gen', (int) $state->get( 'gen' ) + 1 );
}
