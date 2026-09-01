<?php
/**
 * My WordPress — the data payload.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. One function: everything the
 * client view is a function of, recomputed on every dispatch.
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

/**
 * The whole data payload for one render, and the state repairs that
 * go with it (a vanished section falls back to the root rather than a
 * dead end).
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return array<string,mixed>
 */
function payload( State $state, Os $os ) {
	$sections = sections( $os );
	$section  = section_of( $os, (string) $state->get( 'section' ) );
	if ( ! $section && '' !== (string) $state->get( 'section' ) ) {
		// A section that vanished (deactivated plugin, lost cap):
		// fall back to the root rather than a dead end.
		$state->set( 'section', '' )->set( 'item', 0 );
	}
	$group_list = groups( $sections );
	$group_ids  = array_column( $group_list, 'id' );
	if ( '' !== (string) $state->get( 'group' ) && ! in_array( (string) $state->get( 'group' ), $group_ids, true ) ) {
		$state->set( 'group', '' );
	}

	$with_counts = array();
	foreach ( $sections as $entry ) {
		$entry['count'] = count_of( $entry );
		unset( $entry['capability'] );
		$with_counts[] = $entry;
	}

	$item = (int) $state->get( 'item' );
	$into = (int) $state->get( 'into' );
	if ( $into > 0 && ( ! $section || 'post' !== $section['kind'] ) ) {
		$state->set( 'into', 0 )->set( 'relation', '' );
		$into = 0;
	}
	$relation  = (string) $state->get( 'relation' );
	$is_post   = $section && 'post' === $section['kind'];
	$is_agents = $section && 'agent' === $section['kind'];
	$choices   = $is_post ? edit_choices() : array(
		'authors'    => array(),
		'categories' => array(),
	);
	return array(
		'siteName'       => (string) get_bloginfo( 'name' ),
		'sections'       => $with_counts,
		'groups'         => $group_list,
		'sortOptions'    => $section
			? array_map(
				static function ( $row ) {
					return $row[0];
				},
				sort_options( $section )
			)
			: (object) array(),
		'list'           => $section && ! $is_agents && 0 === $into ? fetch( $os, $section, $state ) : null,
		'detail'         => $section && ! $is_agents && 0 === $into && $item > 0 ? detail( $os, $section, $item ) : null,
		'agents'         => $is_agents ? agents_payload( $os, $state ) : null,
		'folder'         => $section && $into > 0 ? folder( $os, $section, $into ) : null,
		'sub'            => $section && $into > 0 && '' !== $relation ? sub( $os, $section, $into, $relation ) : null,
		'subDetail'      => $section && $into > 0 && '' !== $relation && $item > 0
			? sub_detail( $os, $section, $into, $relation, $item )
			: null,
		'authors'        => $choices['authors'],
		'categories'     => $choices['categories'],
		'previewActions' => preview_actions( $os ),
	);
}
