<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const VIEWS = array( 'icons', 'list' );

const COLUMNS_KEY = 'hidden-columns';

function mount( State $state, Os $os ) {
	$stored = (string) $os->stored( 'view', 'icons' );
	$state->set( 'view', in_array( $stored, VIEWS, true ) ? $stored : 'icons' );
	footprint_from_params( $state, $os );
}

function reopen_action( State $state, Os $os ) {
	footprint_from_params( $state, $os );
}

function footprint_from_params( State $state, Os $os ) {
	open_footprint( $state, (int) $os->param( 'footprint', 0 ), (string) $os->param( 'fpName', '' ) );
}

function open_footprint( State $state, $user, $name ) {
	if ( $user <= 0 || false === get_userdata( $user ) ) {
		return;
	}
	$state->set( 'footprint', $user )
		->set( 'fpName', openstation_plain_text_title( sanitize_text_field( $name ) ) )
		->set( 'item', 0 )->set( 'into', 0 )->set( 'relation', '' );
}

function view_action( State $state, Os $os ) {
	$view = (string) $state->get( 'view' );
	if ( ! in_array( $view, VIEWS, true ) ) {
		$view = 'icons';
		$state->set( 'view', $view );
	}
	$os->store( 'view', $view );
}

function hidden_columns( Os $os ) {
	$stored = $os->stored( COLUMNS_KEY, array() );
	$map    = array();
	foreach ( is_array( $stored ) ? $stored : array() as $section => $ids ) {
		$section = sanitize_key( (string) $section );
		if ( '' === $section || ! is_array( $ids ) ) {
			continue;
		}
		$map[ $section ] = array_values( array_unique( array_filter( array_map( 'sanitize_key', array_map( 'strval', $ids ) ) ) ) );
	}
	return $map;
}

function set_columns_action( State $state, Os $os, array $args ) {
	$section = sanitize_key( (string) $state->get( 'section' ) );
	if ( '' === $section ) {
		return;
	}
	$map = hidden_columns( $os );
	if ( ! empty( $args['reset'] ) ) {
		unset( $map[ $section ] );
	} else {
		$map[ $section ] = array_values(
			array_unique(
				array_filter(
					array_map( 'sanitize_key', array_map( 'strval', array_slice( (array) ( $args['hidden'] ?? array() ), 0, 40 ) ) ),
					'strlen'
				)
			)
		);
	}

	$map = array_slice( $map, -40, 40, true );
	if ( array() === $map ) {
		$os->forget( COLUMNS_KEY );
	} else {
		$os->store( COLUMNS_KEY, $map );
	}
}

function go_action( State $state, Os $os, array $args ) {
	$state->set( 'group', isset( $args['group'] ) ? (string) $args['group'] : '' );
	$state->set( 'section', isset( $args['section'] ) ? (string) $args['section'] : '' );
	$state->set( 'item', 0 )->set( 'into', 0 )->set( 'relation', '' )
		->set( 'footprint', 0 )->set( 'fpName', '' )
		->set( 'query', '' )->set( 'page', 1 )
		->set( 'sort', '' )->reset( 'selected' )
		->set( 'pane', 'define' )->set( 'casting', false )->set( 'wstep', 0 )
		->reset( 'cast' )->set( 'agentNotice', '' )->set( 'briefError', '' );
}

function back_action( State $state ) {
	if ( true === $state->get( 'casting' ) ) {

		$state->set( 'casting', false )->set( 'wstep', 0 )
			->reset( 'cast' )->set( 'agentNotice', '' )->set( 'briefError', '' );
		return;
	}
	if ( (int) $state->get( 'footprint' ) > 0 ) {
		$state->set( 'footprint', 0 )->set( 'fpName', '' );
		return;
	}
	if ( '' !== (string) $state->get( 'relation' ) ) {
		$state->set( 'relation', '' );
		return;
	}
	if ( (int) $state->get( 'into' ) > 0 ) {
		$state->set( 'into', 0 );
		return;
	}
	if ( (int) $state->get( 'item' ) > 0 ) {
		$state->set( 'item', 0 )->set( 'pane', 'define' )->set( 'agentNotice', '' );
		return;
	}
	if ( '' !== (string) $state->get( 'section' ) ) {
		$state->set( 'section', '' )->set( 'query', '' )->set( 'page', 1 )
			->set( 'sort', '' )->reset( 'selected' );
		return;
	}
	$state->set( 'group', '' );
}

function open_action( State $state, Os $os, array $args ) {
	$state->set( 'item', (int) ( $args['item'] ?? 0 ) )
		->set( 'pane', 'define' )->set( 'agentNotice', '' );
}

function into_action( State $state, Os $os, array $args ) {
	$state->set( 'into', (int) ( $args['item'] ?? 0 ) )
		->set( 'relation', '' )->set( 'item', 0 );
}

function relation_action( State $state, Os $os, array $args ) {
	$relation = (string) ( $args['relation'] ?? '' );
	$allowed  = array( 'author', 'contributors', 'comments', 'categories', 'tags', 'media', 'revisions' );
	$state->set( 'relation', in_array( $relation, $allowed, true ) ? $relation : '' )
		->set( 'item', 0 );
}

function footprint_action( State $state, Os $os, array $args ) {
	open_footprint( $state, (int) ( $args['user'] ?? 0 ), (string) ( $args['name'] ?? '' ) );
}

function sub_open_post_action( State $state, Os $os, array $args ) {
	$id = (int) ( $args['post'] ?? 0 );
	if ( $id > 0 && $os->can( 'edit_post', $id ) ) {
		$os->open_url(
			admin_url( 'post.php?post=' . $id . '&action=edit' ),
			edit_title( array( 'kind' => 'post' ), $id )
		);
	}
}

function edit_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	$id      = (int) ( $args['item'] ?? 0 );
	if ( $section && allowed( $os, $section, $id, 'edit' ) ) {
		$os->open_url( edit_url( $section, $id ), edit_title( $section, $id ), (string) ( $section['icon'] ?? '' ) );
	}
}

function add_user_action( State $state, Os $os ) {
	unset( $state );
	if ( $os->can( 'create_users' ) || ( is_multisite() && $os->can( 'promote_users' ) ) ) {
		$os->open_url( admin_url( 'user-new.php' ), __( 'Add User', 'desktop-mode' ), 'dashicons-admin-users' );
	}
}

function trash_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	$id      = (int) ( $args['item'] ?? 0 );
	if ( ! $section || 'post' !== $section['kind'] || ! empty( $section['flat'] )
		|| ! allowed( $os, $section, $id, 'delete' ) ) {
		$os->toast( __( 'You cannot trash this item.', 'desktop-mode' ) );
		return;
	}
	if ( ! wp_trash_post( $id ) ) {
		$os->toast( __( 'Trashing failed.', 'desktop-mode' ) );
		return;
	}
	if ( $id === (int) $state->get( 'item' ) ) {
		$state->set( 'item', 0 );
	}
	if ( $state->contains( 'selected', $id ) ) {
		$state->toggle_item( 'selected', $id );
	}
	$os->toast( __( 'Moved to the Trash.', 'desktop-mode' ) );
	$os->announce( (string) $section['post_type'], 'trashed', $id );
}

function sub_open_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	$into    = (int) $state->get( 'into' );
	$rel     = (string) $state->get( 'relation' );
	if ( ! $section || $into <= 0 || '' === $rel ) {
		return;
	}
	$payload = sub( $os, $section, $into, $rel );
	$wanted  = (int) ( $args['row'] ?? 0 );
	foreach ( (array) ( $payload['rows'] ?? array() ) as $row ) {
		if ( $wanted === (int) $row['id'] && '' !== $row['editUrl'] ) {
			$os->open_url( (string) $row['editUrl'], (string) $row['title'] );
			return;
		}
	}
}

function quick_edit_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );

	if ( ! $section || 'post' !== $section['kind'] || ! empty( $section['flat'] ) ) {
		return;
	}
	$status   = isset( $args['status'] ) ? (string) $args['status'] : '';
	$comments = isset( $args['comments'] ) ? (string) $args['comments'] : '';
	$author   = (int) ( $args['author'] ?? 0 );
	$sticky   = isset( $args['sticky'] ) ? (string) $args['sticky'] : '';
	$add_cats = array_filter( array_map( 'intval', (array) ( $args['categories'] ?? array() ) ) );
	$add_tags = array_filter( array_map( 'trim', explode( ',', (string) ( $args['tags'] ?? '' ) ) ) );
	if ( ! in_array( $status, array( '', 'publish', 'pending', 'draft', 'private' ), true )
		|| ! in_array( $comments, array( '', 'open', 'closed' ), true )
		|| ! in_array( $sticky, array( '', 'sticky', 'not-sticky' ), true ) ) {
		return;
	}
	if ( '' === $status && '' === $comments && 0 === $author && '' === $sticky
		&& array() === $add_cats && array() === $add_tags ) {
		return;
	}
	$updated = array();
	foreach ( array_map( 'intval', (array) ( $args['items'] ?? array() ) ) as $id ) {
		$post = $id > 0 ? get_post( $id ) : null;
		if ( ! $post || $post->post_type !== $section['post_type'] || ! allowed( $os, $section, $id, 'edit' ) ) {
			continue;
		}
		if ( 'publish' === $status && ! $os->can( 'publish_post', $id ) ) {
			continue;
		}
		if ( $author > 0 && ! $os->can( 'edit_others_posts' ) ) {
			continue;
		}
		$fields = array( 'ID' => $id );
		if ( '' !== $status ) {
			$fields['post_status'] = $status;
		}
		if ( '' !== $comments ) {
			$fields['comment_status'] = $comments;
		}
		if ( $author > 0 && false !== get_userdata( $author ) ) {
			$fields['post_author'] = $author;
		}
		if ( ! wp_update_post( $fields ) ) {
			continue;
		}
		if ( 'post' === $post->post_type ) {
			if ( 'sticky' === $sticky ) {
				stick_post( $id );
			} elseif ( 'not-sticky' === $sticky ) {
				unstick_post( $id );
			}
			if ( array() !== $add_cats && is_object_in_taxonomy( $post->post_type, 'category' ) ) {
				wp_set_post_categories( $id, $add_cats, true );
			}
			if ( array() !== $add_tags && is_object_in_taxonomy( $post->post_type, 'post_tag' ) ) {
				wp_set_post_terms( $id, $add_tags, 'post_tag', true );
			}
		}
		$updated[] = $id;
	}
	if ( array() === $updated ) {
		$os->toast( __( 'Nothing could be updated.', 'desktop-mode' ) );
		return;
	}
	$os->toast(
		sprintf(

			_n( '%s entry updated.', '%s entries updated.', count( $updated ), 'desktop-mode' ),
			number_format_i18n( count( $updated ) )
		)
	);
	$os->announce( (string) $section['post_type'], 'updated', $updated );
}

function bulk_trash_action( State $state, Os $os ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	if ( ! $section || 'post' !== $section['kind'] || ! empty( $section['flat'] ) ) {
		return;
	}
	$trashed = array();
	foreach ( array_map( 'intval', (array) $state->get( 'selected' ) ) as $id ) {
		if ( $id > 0 && allowed( $os, $section, $id, 'delete' ) && wp_trash_post( $id ) ) {
			$trashed[] = $id;
		}
	}
	$state->reset( 'selected' );
	if ( in_array( (int) $state->get( 'item' ), $trashed, true ) ) {
		$state->set( 'item', 0 );
	}
	if ( array() === $trashed ) {
		$os->toast( __( 'Nothing could be trashed.', 'desktop-mode' ) );
		return;
	}
	$os->toast(
		sprintf(

			_n( 'Moved %s item to the Trash.', 'Moved %s items to the Trash.', count( $trashed ), 'desktop-mode' ),
			number_format_i18n( count( $trashed ) )
		)
	);
	$os->announce( (string) $section['post_type'], 'trashed', $trashed );
}
