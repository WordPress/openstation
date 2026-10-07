<?php

defined( 'ABSPATH' ) || exit;

use OpenStation\App\Os;
use OpenStation\App\State;

function openstation_posts_window_default_query_args() {
	$args = array(

		'_embed'  => 'author,wp:term,wp:featuredmedia',

		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,openstation_lock,_links,_embedded',
	);

	return (array) apply_filters( 'openstation_posts_window_query_args', $args );
}

function openstation_posts_app_state( $orderby = 'date', $order = 'desc' ) {
	return array(
		'page'       => 1,
		'feedAppend' => false,
		'perPage'    => 20,
		'search'     => '',

		'status'     => '',
		'orderby'    => (string) $orderby,
		'order'      => (string) $order,

		'author'     => array(),
		'tag'        => array(),
	);
}

function openstation_posts_app_allowed_orderby() {
	return array( 'date', 'title', 'author', 'modified', 'comment_count', 'menu_order' );
}

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

function openstation_posts_app_query( array $defaults, State $state ) {
	$query = array();

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

function openstation_posts_app_data( $route, array $defaults, State $state ) {
	$query  = openstation_posts_app_query( $defaults, $state );
	$append = (bool) $state->get( 'feedAppend' );
	$state->set( 'feedAppend', false );

	if ( ! $append && $query['page'] > 1 ) {
		$wanted              = $query['page'] * $query['per_page'];
		$refresh             = $query;
		$refresh['page']     = 1;
		$refresh['per_page'] = min( 100, $wanted );
		$list                = openstation_app_rest_page( $route, $refresh );
		$wanted              = min( $wanted, $list['total'] );
		$received            = count( $list['items'] );
		while ( empty( $list['error'] ) && $received < $wanted ) {
			++$refresh['page'];
			$batch = openstation_app_rest_page( $route, $refresh );
			if ( ! empty( $batch['error'] ) ) {
				$list = $batch;
				break;
			}
			if ( empty( $batch['items'] ) ) {
				break;
			}
			$list['items'] = array_merge( $list['items'], $batch['items'] );
			$received      = count( $list['items'] );
		}
		$list['items']   = array_slice( $list['items'], 0, $wanted );
		$list['perPage'] = $query['per_page'];
		$list['pages']   = (int) ceil( $list['total'] / $query['per_page'] );
		$list['page']    = empty( $list['error'] ) ? min( $query['page'], max( 1, $list['pages'] ) ) : $query['page'];
		$state->set( 'page', $list['page'] );
		$list['replace'] = true;
	} else {
		$list = openstation_app_rest_page( $route, $query );
	}

	if ( openstation_app_rest_page_is_out_of_range( $list ) ) {
		$state->set( 'page', 1 );
		$query['page'] = 1;
		$list          = openstation_app_rest_page( $route, $query );
	}
	if ( 0 === $list['total'] ) {

		$list['pages'] = 0;
	}
	$identity = array();
	foreach ( array( 'search', 'status', 'orderby', 'order', 'author', 'tag', 'perPage' ) as $key ) {
		$identity[ $key ] = $state->get( $key );
	}
	return array(
		'list'  => $list,
		'query' => $identity,
	);
}

function openstation_posts_app_filter( State $state ) {
	$state->set( 'page', 1 );
}

function openstation_posts_app_page( State $state, array $args ) {
	$state->set( 'page', max( 1, isset( $args['page'] ) ? (int) $args['page'] : 1 ) );
	$state->set( 'feedAppend', true );
}

function openstation_posts_app_sort( State $state, array $args, $default_orderby = 'date', $default_order = 'desc' ) {
	$orderby = isset( $args['orderby'] ) ? sanitize_key( (string) $args['orderby'] ) : '';
	if ( ! in_array( $orderby, openstation_posts_app_allowed_orderby(), true ) ) {
		$orderby = (string) $default_orderby;
	}
	$order = isset( $args['order'] ) ? strtolower( (string) $args['order'] ) : (string) $default_order;
	$state->set( 'page', 1 );
	$state->set( 'orderby', $orderby );
	$state->set( 'order', 'asc' === $order ? 'asc' : 'desc' );
}

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

				_n( '%d item could not be moved to the trash.', '%d items could not be moved to the trash.', $failed, 'desktop-mode' ),
				$failed
			)
		);
	}
}
