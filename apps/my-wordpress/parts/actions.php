<?php
/**
 * My WordPress — the content actions.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. This part owns everything a
 * dispatch DOES to the content surface: navigation (go / back / into /
 * relation), list controls (search / sort / paging), and the mutations
 * (open-in-editor, trash, bulk trash, quick edit) with their per-item
 * authorization. The agent actions live in `parts/agents.php`.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/** The two ways a section lists. */
const VIEWS = array( 'icons', 'list' );

/**
 * The storage key of the per-section hidden-column map.
 */
const COLUMNS_KEY = 'hidden-columns';

/**
 * Mount: restore the remembered view mode. The client's first
 * dispatch carries the schema default; the stored preference wins.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
function mount( State $state, Os $os ) {
	$stored = (string) $os->stored( 'view', 'icons' );
	$state->set( 'view', in_array( $stored, VIEWS, true ) ? $stored : 'icons' );
}

/**
 * `view`: the mode switch. The bound value already arrived with the
 * state (the client flips locally first, so the switch is instant);
 * this validates it and remembers it for the next window.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
function view_action( State $state, Os $os ) {
	$view = (string) $state->get( 'view' );
	if ( ! in_array( $view, VIEWS, true ) ) {
		$view = 'icons';
		$state->set( 'view', $view );
	}
	$os->store( 'view', $view );
}

/**
 * The per-section map of hidden list columns, as stored: section id
 * → column ids. Columns are declared client-side (plugins add their
 * own through the `os.my-wordpress.list-columns` filter), so the
 * server keeps the user's choice as opaque, sanitised keys.
 *
 * @param Os $os Host handle.
 * @return array<string,string[]>
 */
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

/**
 * `set-columns`: remember which columns the current section hides.
 * The client sends the whole hidden list (`hidden`), because only it
 * knows the default set — a column a plugin added last week is not
 * something the server can name. An empty list is a choice too
 * ("show everything"); `reset` is what forgets the section.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args (`hidden` | `reset`).
 * @return void
 */
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
	// A bounded map: the sections a person actually tuned, never a
	// growing log of every folder they ever opened.
	$map = array_slice( $map, -40, 40, true );
	if ( array() === $map ) {
		$os->forget( COLUMNS_KEY );
	} else {
		$os->store( COLUMNS_KEY, $map );
	}
}

/**
 * `go`: open a root folder or a section, resetting the whole trail.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
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

/**
 * `back`: one step up — wizard, relation, folder, pane, section, group.
 *
 * @param State $state State.
 * @return void
 */
function back_action( State $state ) {
	if ( true === $state->get( 'casting' ) ) {
		// The window's back is the wizard's cancel.
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

/**
 * `open`: select an item into the detail pane (0 closes it).
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function open_action( State $state, Os $os, array $args ) {
	$state->set( 'item', (int) ( $args['item'] ?? 0 ) )
		->set( 'pane', 'define' )->set( 'agentNotice', '' );
}

/**
 * `into`: navigate INTO a post's detail folder.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function into_action( State $state, Os $os, array $args ) {
	$state->set( 'into', (int) ( $args['item'] ?? 0 ) )
		->set( 'relation', '' )->set( 'item', 0 );
}

/**
 * `relation`: open one relation sub-folder inside the detail folder.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function relation_action( State $state, Os $os, array $args ) {
	$relation = (string) ( $args['relation'] ?? '' );
	$allowed  = array( 'author', 'contributors', 'comments', 'categories', 'tags', 'media', 'revisions' );
	$state->set( 'relation', in_array( $relation, $allowed, true ) ? $relation : '' )
		->set( 'item', 0 );
}

/**
 * `footprint`: open a user's activity footprint over the body — the
 * full-width surface WP Explorer answered "open this person" with.
 * The id is validated (the payload route re-checks the viewer), the
 * name is only ever a breadcrumb placeholder.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args (`user`, `name`).
 * @return void
 */
function footprint_action( State $state, Os $os, array $args ) {
	$user = (int) ( $args['user'] ?? 0 );
	if ( $user <= 0 || false === get_userdata( $user ) ) {
		return;
	}
	$state->set( 'footprint', $user )
		->set( 'fpName', sanitize_text_field( (string) ( $args['name'] ?? '' ) ) )
		->set( 'item', 0 )->set( 'into', 0 )->set( 'relation', '' );
}

/**
 * `sub-open-post`: a recent-posts row in a stats pane → its editor.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function sub_open_post_action( State $state, Os $os, array $args ) {
	$id = (int) ( $args['post'] ?? 0 );
	if ( $id > 0 && $os->can( 'edit_post', $id ) ) {
		$os->open_url( admin_url( 'post.php?post=' . $id . '&action=edit' ) );
	}
}

/**
 * `edit`: open one item's editor, re-checking the capability here.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function edit_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	$id      = (int) ( $args['item'] ?? 0 );
	if ( $section && allowed( $os, $section, $id, 'edit' ) ) {
		$os->open_url( edit_url( $section, $id ) );
	}
}

/**
 * `trash`: move one post to the Trash.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
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

/**
 * `sub-open`: open a sub-list row's editor. The URL is recomputed
 * here from the row id — never taken from the client — so it carries
 * the same capability gates the sub-list applied.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
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

/**
 * `quick-edit`: apply the Edit… modal's picks over the selection.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function quick_edit_action( State $state, Os $os, array $args ) {
	$section = section_of( $os, (string) $state->get( 'section' ) );
	// A `flat` section's rows are not posts (an order id may collide
	// with a real post id under legacy storage) — never mutate them.
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
			/* translators: %s: updated count. */
			_n( '%s entry updated.', '%s entries updated.', count( $updated ), 'desktop-mode' ),
			number_format_i18n( count( $updated ) )
		)
	);
	$os->announce( (string) $section['post_type'], 'updated', $updated );
}

/**
 * `bulk-trash`: trash the selection, item by item, capability-gated.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
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
			/* translators: %s: trashed count. */
			_n( 'Moved %s item to the Trash.', 'Moved %s items to the Trash.', count( $trashed ), 'desktop-mode' ),
			number_format_i18n( count( $trashed ) )
		)
	);
	$os->announce( (string) $section['post_type'], 'trashed', $trashed );
}
