<?php
/**
 * Posts and Pages apps — the links and labels plugins add to a post's row.
 *
 * Plain PHP part, required by both `posts.os.php` and `pages.os.php`.
 * A plugin's "Clone" or "Edit with <builder>" link is not part of the
 * post resource: Core builds it on `edit.php` from the
 * `page_row_actions` / `post_row_actions` filters. Neither is the
 * "Bricks" or "Elementor" label beside the title, which comes from
 * `display_post_states`. The windows' row menus offer those links and
 * their title rows show those labels too, so this replays the filters
 * for the rows a window has loaded.
 *
 *   wp_ajax_openstation_posts_row_actions — `{ id => { links: [ { key, label, url, admin } ], states: [ label ] } }`
 *
 * On admin-ajax, not a REST field, for the reason the Plugins window's
 * row links are: many plugins only add the filter behind `is_admin()`,
 * which is false on a REST request (and a dispatch is one).
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/permissions.php';
require_once dirname( __DIR__, 2 ) . '/pages/parts/permissions.php';
require_once dirname( __DIR__, 2 ) . '/plugins/parts/action-links.php';

/**
 * Nonce action of the row-actions endpoint, refreshed by the shell's
 * Heartbeat nonce refresh (`includes/nonce-refresh.php`).
 */
const OPENSTATION_POSTS_ROW_ACTIONS_NONCE = 'desktop-mode-posts-row-actions';

/**
 * Keys of the row actions Core adds itself. The windows have their own
 * Edit, View, Move to trash and Restore, so these are dropped from what
 * the filters return, along with whatever a plugin rewrote them into.
 */
const OPENSTATION_POSTS_CORE_ROW_ACTION_KEYS = array( 'edit', 'inline hide-if-no-js', 'trash', 'untrash', 'delete', 'view' );

/**
 * Keys of the post states Core adds itself in `get_post_states()`. The
 * windows paint a row's status, Front page and Posts page with badges
 * of their own, so those would show twice; the other Core states
 * (Password protected, Sticky, Scheduled, Privacy Policy Page) are left
 * out on purpose, so a row shows only the labels a plugin added. Core's
 * "Customization Draft" has no key and is dropped by its text instead.
 */
const OPENSTATION_POSTS_CORE_POST_STATE_KEYS = array( 'protected', 'private', 'draft', 'pending', 'sticky', 'scheduled', 'page_on_front', 'page_for_posts', 'page_for_privacy_policy' );

/**
 * The most ids one request answers for.
 */
const OPENSTATION_POSTS_ROW_ACTIONS_MAX_IDS = 100;

/**
 * The row actions Core starts a post's row with on `edit.php`, as
 * `WP_Posts_List_Table::handle_row_actions()` builds them before its
 * filter runs. Some plugins only add their link next to one of these
 * (an editable row, one that is not in the trash), so the filters get
 * the same starting list Core gives them.
 *
 * @param WP_Post $post The row's post. The caller already holds `edit_post` on it.
 * @return array<string,string> Action key => link HTML.
 */
function openstation_posts_window_core_row_actions( WP_Post $post ) {
	$actions = array();
	if ( 'trash' !== $post->post_status ) {
		$actions['edit']                 = sprintf( '<a href="%s">%s</a>', esc_url( (string) get_edit_post_link( $post->ID ) ), esc_html__( 'Edit', 'desktop-mode' ) );
		$actions['inline hide-if-no-js'] = sprintf( '<button type="button" class="button-link editinline">%s</button>', esc_html__( 'Quick Edit', 'desktop-mode' ) );
	}
	if ( current_user_can( 'delete_post', $post->ID ) ) {
		if ( 'trash' === $post->post_status ) {
			$actions['untrash'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( wp_nonce_url( admin_url( 'post.php?post=' . $post->ID . '&action=untrash' ), 'untrash-post_' . $post->ID ) ),
				esc_html__( 'Restore', 'desktop-mode' )
			);
		} elseif ( EMPTY_TRASH_DAYS ) {
			$actions['trash'] = sprintf( '<a href="%s" class="submitdelete">%s</a>', esc_url( (string) get_delete_post_link( $post->ID ) ), esc_html__( 'Trash', 'desktop-mode' ) );
		}
		if ( 'trash' === $post->post_status || ! EMPTY_TRASH_DAYS ) {
			$actions['delete'] = sprintf( '<a href="%s" class="submitdelete">%s</a>', esc_url( (string) get_delete_post_link( $post->ID, '', true ) ), esc_html__( 'Delete Permanently', 'desktop-mode' ) );
		}
	}
	if ( is_post_type_viewable( $post->post_type ) ) {
		if ( in_array( $post->post_status, array( 'pending', 'draft', 'future' ), true ) ) {
			$actions['view'] = sprintf( '<a href="%s" rel="bookmark">%s</a>', esc_url( get_preview_post_link( $post ) ), esc_html__( 'Preview', 'desktop-mode' ) );
		} elseif ( 'trash' !== $post->post_status ) {
			$actions['view'] = sprintf( '<a href="%s" rel="bookmark">%s</a>', esc_url( (string) get_permalink( $post ) ), esc_html__( 'View', 'desktop-mode' ) );
		}
	}
	return $actions;
}

/**
 * The links a post's row offers on `edit.php`, minus Core's own.
 *
 * Runs the filter `WP_Posts_List_Table::handle_row_actions()` runs for
 * the post's type (`page_row_actions` for a hierarchical type,
 * `post_row_actions` otherwise) with Core's arguments, then keeps each
 * entry that is a link to an http(s) page. A JavaScript-bound entry (a
 * `#` or `javascript:` link, a button) opens nothing outside the list
 * table and is dropped.
 *
 * A wp-admin link carries the post type's classic list as its
 * `_wp_http_referer`, the page the link sits on in `edit.php`. An
 * action that redirects back to `wp_get_referer()` (Duplicate Post's
 * Clone) would otherwise go back to the page the window was opened
 * from, the desktop itself.
 *
 * @param WP_Post $post The row's post.
 * @return array<int,array{key:string,label:string,url:string,admin:bool}>
 */
function openstation_posts_window_row_links( WP_Post $post ) {
	$actions = openstation_posts_window_core_row_actions( $post );
	// phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's own row-action filters, replayed for the window as edit.php runs them.
	if ( is_post_type_hierarchical( $post->post_type ) ) {
		$actions = apply_filters( 'page_row_actions', $actions, $post );
	} else {
		$actions = apply_filters( 'post_row_actions', $actions, $post );
	}
	// phpcs:enable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound

	$links = openstation_plugins_window_links_from_actions( $actions, OPENSTATION_POSTS_CORE_ROW_ACTION_KEYS );
	$list  = wp_make_link_relative( admin_url( 'post' === $post->post_type ? 'edit.php' : 'edit.php?post_type=' . $post->post_type ) );
	foreach ( $links as $index => $link ) {
		if ( $link['admin'] && false === strpos( $link['url'], '_wp_http_referer=' ) ) {
			$links[ $index ]['url'] = add_query_arg( '_wp_http_referer', rawurlencode( $list ), $link['url'] );
		}
	}
	return $links;
}

/**
 * The labels a post's row shows beside its title on `edit.php`, minus
 * Core's own.
 *
 * Runs Core's `get_post_states()`, which builds Core's states and then
 * applies `display_post_states` with Core's arguments. Each label a
 * plugin added comes back as plain text, cleaned the way a row link's
 * label is; an empty or repeated label is dropped. Order is the
 * filter's.
 *
 * @param WP_Post $post The row's post. The caller already holds `edit_post` on it.
 * @return string[]
 */
function openstation_posts_window_row_states( WP_Post $post ) {
	if ( ! function_exists( 'get_post_states' ) ) {
		require_once ABSPATH . 'wp-admin/includes/template.php';
	}
	// phpcs:disable WordPress.WP.I18n.MissingArgDomain -- Core's own strings, in Core's domain: the text of the state Core adds without a key.
	$customization = array( __( 'Customization Draft' ), _x( 'Customization Draft', 'post status' ) );
	// phpcs:enable WordPress.WP.I18n.MissingArgDomain

	$entries = get_post_states( $post );
	$states  = array();
	foreach ( is_array( $entries ) ? $entries : array() as $key => $state ) {
		if ( ! is_string( $state ) || in_array( $key, OPENSTATION_POSTS_CORE_POST_STATE_KEYS, true ) ) {
			continue;
		}
		if ( is_int( $key ) && in_array( $state, $customization, true ) ) {
			continue;
		}
		$label = trim( html_entity_decode( wp_strip_all_tags( $state ), ENT_QUOTES, 'UTF-8' ) );
		if ( '' !== $label && ! in_array( $label, $states, true ) ) {
			$states[] = $label;
		}
	}
	return $states;
}

/**
 * Send a refusal as JSON with HTTP 403, then exit.
 *
 * @param string $code    Error code.
 * @param string $message Human-readable reason.
 * @return void
 */
function openstation_posts_window_row_actions_refuse( $code, $message ) {
	wp_send_json_error(
		array(
			'code'    => $code,
			'message' => $message,
		),
		403
	);
}

/**
 * `wp_ajax_openstation_posts_row_actions` — the plugin links and
 * labels of the rows a Posts or Pages window has loaded.
 *
 * Body params:
 *   - mode  `pages` | `posts` — whose window gate applies
 *   - ids   post ids, comma-separated or as an array; the first 100 count
 *
 * Answers `{ id => { links, states } }`: the row links from
 * `page_row_actions` / `post_row_actions` and the labels from
 * `display_post_states`, both always present for an id in the answer.
 *
 * Gated on the endpoint's nonce, then on the gate of the window that
 * asks (`mode` names it; it does not limit which posts may be asked
 * about), then per post on `edit_post`, the gate that decides: the
 * answer carries only the link labels, URLs and row labels plugins
 * build for a row, and only for rows the caller could edit on
 * `edit.php`. An id that is skipped, or whose row has neither plugin
 * links nor plugin labels, is absent from the answer.
 */
function openstation_posts_window_ajax_row_actions() {
	if ( ! check_ajax_referer( OPENSTATION_POSTS_ROW_ACTIONS_NONCE, '_ajax_nonce', false ) ) {
		openstation_posts_window_row_actions_refuse(
			'openstation_posts_bad_nonce',
			__( 'Security check failed. Refresh the window and try again.', 'desktop-mode' )
		);
		return;
	}

	$mode = isset( $_POST['mode'] ) ? sanitize_key( wp_unslash( $_POST['mode'] ) ) : '';
	$can  = 'pages' === $mode ? openstation_pages_window_user_can_register() : openstation_posts_window_user_can_register();
	if ( ! $can ) {
		openstation_posts_window_row_actions_refuse(
			'openstation_posts_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' )
		);
		return;
	}

	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- every entry is cast to int below.
	$raw = isset( $_POST['ids'] ) ? wp_unslash( $_POST['ids'] ) : array();
	if ( is_string( $raw ) ) {
		$raw = explode( ',', $raw );
	}
	$ids = array_slice( (array) $raw, 0, OPENSTATION_POSTS_ROW_ACTIONS_MAX_IDS );

	$map = array();
	foreach ( $ids as $id ) {
		$id = is_scalar( $id ) ? (int) $id : 0;
		// `get_post( 0 )` is whatever post the globals hold.
		if ( $id <= 0 ) {
			continue;
		}
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || ! current_user_can( 'edit_post', $post->ID ) ) {
			continue;
		}
		$links  = openstation_posts_window_row_links( $post );
		$states = openstation_posts_window_row_states( $post );
		if ( array() !== $links || array() !== $states ) {
			$map[ $post->ID ] = array(
				'links'  => $links,
				'states' => $states,
			);
		}
	}

	wp_send_json_success( (object) $map );
}
add_action( 'wp_ajax_openstation_posts_row_actions', 'openstation_posts_window_ajax_row_actions' );
