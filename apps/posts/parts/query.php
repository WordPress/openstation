<?php
/**
 * Posts app — the list query, the data envelope and the server
 * actions the Posts and Pages apps share.
 *
 * The list is the same `/wp/v2/posts` (or `/wp/v2/pages`) request the
 * legacy bundle fetched from the browser, run in-process through
 * `openstation_app_rest_page()`: the filterable default args
 * (`_embed`, `_fields`, an optional `post_type`) merged with the
 * state's page / per-page / search / status / sort / author / tag
 * values. Every REST field a plugin registers and every
 * `rest_post_query` filter keeps applying, and the row JSON the
 * client view renders is byte-identical to what the old bundle got.
 *
 * Plain PHP part of `apps/posts/posts.os.php`; `apps/pages/pages.os.php`
 * requires it too and hands in its own defaults, route and noun.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

use OpenStation\App\Os;
use OpenStation\App\State;

/**
 * Default REST query args the Posts window uses on every list fetch.
 *
 * Filterable so a plugin can flip the post type to a custom CPT (or
 * a list of CPTs) without forking the app. The app merges these
 * under the page/per-page/search/status/sort args it generates per
 * request.
 *
 * @return array
 */
function openstation_posts_window_default_query_args() {
	$args = array(
		// `_embed` pulls author + taxonomy + featured-media side-loads
		// into `_embedded`, so the table can render avatars, term
		// chips, and thumbnails without N extra round-trips per row.
		'_embed'  => 'author,wp:term,wp:featuredmedia',
		// `openstation_lock` is the REST field registered by My WordPress'
		// `lock.php` on every public post type — it tells us whether
		// another user is currently editing the row, so the title cell
		// can paint a small lock icon without an extra fetch.
		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,openstation_lock,_links,_embedded',
	);

	/**
	 * Filter the default outbound REST query args for the Posts window.
	 *
	 * Drop in a `'post_type' => 'product'` to point the window at a
	 * CPT, or extend `_fields` to ship more columns. The app merges
	 * these under pagination/search/status/sort args.
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'openstation_posts_window_query_args', $args );
}

/**
 * The declared state of a list app — the schema the client keeps.
 *
 * @param string $orderby Default sort column (`date` for posts, `menu_order` for pages).
 * @param string $order   Default direction.
 * @return array<string,mixed>
 */
function openstation_posts_app_state( $orderby = 'date', $order = 'desc' ) {
	return array(
		'page'    => 1,
		'perPage' => 20,
		'search'  => '',
		// `''` is the "All" sentinel — sent as `status=any`.
		'status'  => '',
		'orderby' => (string) $orderby,
		'order'   => (string) $order,
		// Author user ids and tag term ids to filter by; empty = no filter.
		'author'  => array(),
		'tag'     => array(),
	);
}

/**
 * The REST `orderby` values a column click may set. Anything else
 * (a plugin column core cannot sort by) falls back to the declared
 * default rather than reaching `WP_Query` as a stray key.
 *
 * @return string[]
 */
function openstation_posts_app_allowed_orderby() {
	return array( 'date', 'title', 'author', 'modified', 'comment_count', 'menu_order' );
}

/**
 * The static facts the client view reads through `ctx.extra`: the
 * mode, the editor URLs and the declared default sort — what the
 * client returns to when a column sort is cleared. The Pages app
 * layers its own facts on top in `openstation_pages_app_config()`.
 *
 * @param string $mode    `posts` | `pages`.
 * @param string $orderby Default sort column.
 * @param string $order   Default direction.
 * @return array<string,mixed>
 */
function openstation_posts_app_config( $mode, $orderby = 'date', $order = 'desc' ) {
	return array(
		'mode'            => 'pages' === $mode ? 'pages' : 'posts',
		'editPostUrlBase' => esc_url_raw( admin_url( 'post.php' ) ),
		'newPostUrl'      => 'pages' === $mode
			? esc_url_raw( add_query_arg( 'post_type', 'page', admin_url( 'post-new.php' ) ) )
			: esc_url_raw( admin_url( 'post-new.php' ) ),
		'defaultOrderby'  => (string) $orderby,
		'defaultOrder'    => 'asc' === $order ? 'asc' : 'desc',
	);
}

/**
 * Positive integers out of a state list.
 *
 * @param mixed $value State value.
 * @return int[]
 */
function openstation_posts_app_ids( $value ) {
	$out = array();
	foreach ( (array) $value as $id ) {
		$id = (int) $id;
		if ( $id > 0 ) {
			$out[] = $id;
		}
	}
	return $out;
}

/**
 * The REST query for a state — the legacy bundle's `fetchPosts()`
 * URL, as query params.
 *
 * @param array<string,mixed> $defaults Filtered default args.
 * @param State               $state    Declared state.
 * @return array<string,mixed>
 */
function openstation_posts_app_query( array $defaults, State $state ) {
	$query = array();
	// Merge the PHP-declared defaults first so `_fields`, `_embed`,
	// and a custom `post_type` from the filter all flow through.
	foreach ( $defaults as $key => $value ) {
		if ( is_string( $value ) && '' !== $value ) {
			$query[ (string) $key ] = $value;
		}
	}
	$query['page']     = max( 1, (int) $state->get( 'page' ) );
	$query['per_page'] = max( 1, (int) $state->get( 'perPage' ) );
	$search            = trim( (string) $state->get( 'search' ) );
	if ( '' !== $search ) {
		$query['search'] = $search;
	}
	// `status` quirk: omitted, core's handler defaults to `publish`
	// only — drafts / pending / scheduled / private silently vanish
	// from "All". `status=any` makes the All segment mean every
	// status the user can see (trash has its own segment).
	$status          = (string) $state->get( 'status' );
	$query['status'] = '' !== $status ? $status : 'any';
	$orderby         = (string) $state->get( 'orderby' );
	if ( '' !== $orderby ) {
		$query['orderby'] = $orderby;
	}
	$order = (string) $state->get( 'order' );
	if ( in_array( $order, array( 'asc', 'desc' ), true ) ) {
		$query['order'] = $order;
	}
	// Both `author` and `tags` are registered as integer arrays —
	// union (OR) semantics: "rows whose author / tag is ANY of these".
	$author = openstation_posts_app_ids( $state->get( 'author' ) );
	if ( array() !== $author ) {
		$query['author'] = $author;
	}
	$tag = openstation_posts_app_ids( $state->get( 'tag' ) );
	if ( array() !== $tag ) {
		$query['tags'] = $tag;
	}
	return $query;
}

/**
 * The client data: the current page of rows as the paged-list
 * envelope (plus `error`), with the "page out of range → page 1"
 * recovery the legacy bundle did client-side (the typical case is
 * the user on page 7 changing per-page from 10 to 100).
 *
 * @param string              $route    `wp/v2/posts` | `wp/v2/pages`.
 * @param array<string,mixed> $defaults Filtered default args.
 * @param State               $state    Declared state.
 * @return array<string,mixed> `list`.
 */
function openstation_posts_app_data( $route, array $defaults, State $state ) {
	$query = openstation_posts_app_query( $defaults, $state );
	$list  = openstation_app_rest_page( $route, $query );
	// A page past the end — Core's `rest_post_invalid_page_number`
	// refusal, or an empty page on a controller that tolerates it —
	// lands on page 1 silently rather than render an empty table. A
	// refusal for any other reason (a capability, a bad argument) is
	// never retried: the error reaches the client as it is.
	if ( openstation_app_rest_page_is_out_of_range( $list ) ) {
		$state->set( 'page', 1 );
		$query['page'] = 1;
		$list          = openstation_app_rest_page( $route, $query );
	}
	if ( 0 === $list['total'] ) {
		// The legacy pager read "No posts" off a zero page count; the
		// envelope floors `pages` at 1, so hand the client the truth.
		$list['pages'] = 0;
	}
	return array( 'list' => $list );
}

/**
 * `filter` — a query change (status, search, per-page, column
 * filters) replaces the result set from page 1.
 *
 * @param State $state Declared state.
 * @return void
 */
function openstation_posts_app_filter( State $state ) {
	$state->set( 'page', 1 );
}

/**
 * `page` — move to the requested page.
 *
 * @param State               $state Declared state.
 * @param array<string,mixed> $args  `page`.
 * @return void
 */
function openstation_posts_app_page( State $state, array $args ) {
	$state->set( 'page', max( 1, isset( $args['page'] ) ? (int) $args['page'] : 1 ) );
}

/**
 * `sort` — a column header click; the client maps the column key to
 * the REST `orderby` value, and the server only keeps one it knows:
 * anything outside `openstation_posts_app_allowed_orderby()` is the
 * app's declared default.
 *
 * @param State               $state           Declared state.
 * @param array<string,mixed> $args            `orderby`, `order`.
 * @param string              $default_orderby The app's default sort column.
 * @param string              $default_order   The app's default direction.
 * @return void
 */
function openstation_posts_app_sort( State $state, array $args, $default_orderby = 'date', $default_order = 'desc' ) {
	$orderby = isset( $args['orderby'] ) ? sanitize_key( (string) $args['orderby'] ) : '';
	if ( ! in_array( $orderby, openstation_posts_app_allowed_orderby(), true ) ) {
		$orderby = (string) $default_orderby;
	}
	$order = isset( $args['order'] ) ? strtolower( (string) $args['order'] ) : (string) $default_order;
	$state->set( 'orderby', $orderby );
	$state->set( 'order', 'asc' === $order ? 'asc' : 'desc' );
}

/**
 * `trash` — move the selected rows to the trash. Rows already in the
 * trash are skipped (a second delete would remove them for good),
 * every id is checked against `delete_post`, the survivors are
 * announced as one content change (what the Recycle Bin, WP Explorer
 * and every other window showing the type repaint on), and failures
 * become a toast.
 *
 * @param Os                  $os   Host handle.
 * @param array<string,mixed> $args `ids`.
 * @param string              $type Content type announced (`post` | `page`).
 * @return void
 */
function openstation_posts_app_trash( Os $os, array $args, $type ) {
	$ids    = openstation_posts_app_ids( isset( $args['ids'] ) ? $args['ids'] : array() );
	$ok     = array();
	$failed = 0;
	foreach ( $ids as $id ) {
		$post = get_post( $id );
		if ( ! $post || 'trash' === $post->post_status ) {
			continue;
		}
		if ( ! $os->can( 'delete_post', $id ) || ! wp_trash_post( $id ) ) {
			++$failed;
			continue;
		}
		$ok[] = $id;
	}
	if ( array() !== $ok ) {
		$os->announce( $type, 'trashed', $ok );
	}
	if ( $failed > 0 ) {
		$os->toast(
			sprintf(
				/* translators: %d: number of rows that could not be trashed. */
				_n( '%d item could not be moved to the trash.', '%d items could not be moved to the trash.', $failed, 'desktop-mode' ),
				$failed
			)
		);
	}
}
