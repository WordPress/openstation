<?php

namespace OpenStation\Apps\Comments;

use OpenStation\App\Os;
use OpenStation\App\State;

defined( 'ABSPATH' ) || exit;

const THREAD_FIELDS = 'id,post,parent,author,author_name,author_avatar_urls,date_gmt,content,status,'
	. 'openstation_post_title,openstation_post_link,openstation_can_edit';

const THREAD_MAX_PAGES = 10;

function status_for_tab( $tab ) {
	switch ( (string) $tab ) {
		case 'all':
			return 'all';
		case 'spam':
			return 'spam';
		case 'trash':
			return 'trash';
		case 'mine':

			return 'any';
		default:
			return 'hold';
	}
}

function rail_query( State $state ) {
	$query = \openstation_comments_window_default_query_args();
	unset( $query['status'] );
	$tab             = (string) $state->get( 'tab' );
	$query['status'] = status_for_tab( $tab );
	$query['page']   = max( 1, (int) $state->get( 'page' ) );
	$search          = trim( (string) $state->get( 'search' ) );
	if ( '' !== $search ) {
		$query['search'] = $search;
	}

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

function reply_counts( array $ids ) {
	global $wpdb;
	$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
	$out = array_fill_keys( $ids, 0 );
	if ( array() === $ids ) {
		return $out;
	}
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$rows         = $wpdb->get_results(

		$wpdb->prepare(
			"SELECT comment_parent, COUNT(*) AS n FROM {$wpdb->comments} WHERE comment_parent IN ( $placeholders ) AND comment_approved IN ( '1', '0' ) GROUP BY comment_parent",
			$ids
		),
		ARRAY_A
	);
	foreach ( (array) $rows as $row ) {
		$out[ (int) $row['comment_parent'] ] = (int) $row['n'];
	}
	return $out;
}

function rail( ?State $state ) {
	static $memo = array();
	if ( null === $state ) {
		$memo = array();
		return array();
	}
	$query = rail_query( $state );
	$key   = (string) wp_json_encode( $query );
	if ( ! isset( $memo[ $key ] ) ) {
		$page   = \openstation_app_rest_page( 'wp/v2/comments', $query );
		$counts = reply_counts( array_map( 'intval', wp_list_pluck( $page['items'], 'id' ) ) );
		foreach ( $page['items'] as $i => $row ) {
			$page['items'][ $i ]['openstation_replies_count'] = $counts[ (int) ( $row['id'] ?? 0 ) ] ?? 0;
		}
		$memo[ $key ] = $page;
	}
	return $memo[ $key ];
}

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

	$rows  = array();
	$pages = 1;
	for ( $page = 1; $page <= $pages && $page <= THREAD_MAX_PAGES; $page++ ) {
		$query['page'] = $page;
		$result        = \openstation_app_rest( 'GET', 'wp/v2/comments', $query );
		if ( ! $result['ok'] || ! is_array( $result['data'] ) ) {
			return 1 === $page
				? null
				: array(
					'rows'      => $rows,
					'truncated' => true,
				);
		}
		$rows  = array_merge( $rows, array_values( $result['data'] ) );
		$pages = max( 1, (int) $result['pages'] );
	}

	usort(
		$rows,
		static function ( $a, $b ) {
			return strcmp( (string) ( $a['date_gmt'] ?? '' ), (string) ( $b['date_gmt'] ?? '' ) );
		}
	);
	return array(
		'rows'      => $rows,
		'truncated' => $pages > THREAD_MAX_PAGES,
	);
}

function skipped( $half = null ) {
	static $skip = array();
	if ( 'take' === $half ) {
		$taken = $skip;
		$skip  = array();
		return $taken;
	}
	if ( null !== $half ) {
		$skip[ $half ] = true;
	}
	return $skip;
}

function data( State $state ) {
	$skip = skipped( 'take' );
	$out  = array( 'counts' => \openstation_comments_window_counts() );
	if ( empty( $skip['rail'] ) ) {
		$out['rail']    = rail( $state );
		$out['railKey'] = rail_key( $state );
	}
	if ( empty( $skip['thread'] ) ) {
		$out['thread'] = thread( (int) $state->get( 'selected' ) );
	}
	rail( null );
	return $out;
}

function restart( State $state ) {
	$state->set( 'page', 1 );
	$state->set( 'gen', (int) $state->get( 'gen' ) + 1 );
}

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

function scope_from_params( State $state, Os $os ) {
	$post = max( 0, (int) $os->param( 'post', 0 ) );
	$state->set( 'post', $post );
	if ( $post > 0 ) {
		$state->set( 'tab', 'all' );
	}
	restart( $state );
	auto_select( $state );
}

function mount( State $state, Os $os ) {
	scope_from_params( $state, $os );
}

function reopen_action( State $state, Os $os ) {
	if ( max( 0, (int) $os->param( 'post', 0 ) ) === (int) $state->get( 'post' ) ) {
		return;
	}
	scope_from_params( $state, $os );
}

function filter_action( State $state, Os $os, array $args ) {
	if ( array_key_exists( 'post', $args ) ) {
		$state->set( 'post', max( 0, (int) $args['post'] ) );
	}
	restart( $state );
	auto_select( $state );
}

function page_action( State $state, Os $os, array $args ) {
	$state->set( 'page', max( 1, (int) ( $args['page'] ?? 1 ) ) );
	skipped( 'thread' );
}

function select_action( State $state, Os $os, array $args ) {
	$state->set( 'selected', max( 0, (int) ( $args['id'] ?? 0 ) ) );
	skipped( 'rail' );
}

function moderate_action( State $state, Os $os, array $args ) {
	if ( ! $os->can( 'moderate_comments' ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to moderate comments.', 'desktop-mode' ) );
	}
	$verb   = (string) ( $args['action'] ?? '' );
	$result = \openstation_comments_window_moderate( (array) ( $args['ids'] ?? array() ), $verb );
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

function reply_action( State $state, Os $os, array $args ) {
	if ( ! $os->can( 'edit_posts' ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to reply.', 'desktop-mode' ) );
	}
	$result = \openstation_comments_window_create_reply( (int) ( $args['parent'] ?? 0 ), (string) ( $args['content'] ?? '' ) );
	if ( is_wp_error( $result ) ) {
		throw new \RuntimeException( esc_html( $result->get_error_message() ) );
	}
	$os->announce( 'comment', 'created', array( (int) $result['id'] ) );
	restart( $state );
	auto_select( $state );
}

function edit_action( State $state, Os $os, array $args ) {
	$id      = (int) ( $args['id'] ?? 0 );
	$content = (string) ( $args['content'] ?? '' );
	if ( $id <= 0 || ! $os->can( 'edit_comment', $id ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to edit this comment.', 'desktop-mode' ) );
	}
	if ( \openstation_comments_window_is_blank( $content ) ) {
		throw new \RuntimeException( esc_html__( 'A comment cannot be empty.', 'desktop-mode' ) );
	}
	$result = \openstation_app_rest( 'POST', 'wp/v2/comments/' . $id, array(), array( 'content' => $content ) );
	if ( ! $result['ok'] ) {
		throw new \RuntimeException( esc_html( '' !== $result['error'] ? $result['error'] : __( 'Edit failed.', 'desktop-mode' ) ) );
	}
	$os->announce( 'comment', 'updated', array( $id ) );
}
