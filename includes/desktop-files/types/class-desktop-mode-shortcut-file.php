<?php
/**
 * Desktop Mode — `shortcut` file type.
 *
 * Wraps a plugin shortcut registered via
 * `desktop_mode_register_icon()` so it lives on the same grid
 * as folders, posts, and the rest. Reference shape: the
 * registered icon id.
 *
 * The merge unifies two previously-separate rails — the plugin
 * shortcut rail (`desktop-mode-icons`) and the file layer
 * (`desktop-mode-files-layer`) — into one surface. Drag, sort,
 * right-click, clean-up: everything works uniformly because
 * everything is now a placement.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `shortcut` desktop file type.
 */
class Desktop_Mode_Shortcut_File extends Desktop_Mode_File {

	public static function type(): string {
		return 'shortcut';
	}

	public function exists(): bool {
		return null !== $this->entry();
	}

	public function title(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return __( '(missing shortcut)', 'desktop-mode' );
		}
		return (string) $entry['title'];
	}

	public function icon(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return 'dashicons-warning';
		}
		return (string) $entry['icon'];
	}

	public function can_read( int $user_id ): bool {
		// Shortcut visibility = registration visibility. The
		// `desktop_mode_register_icon` capability gate already
		// filters per user at registration time; if the entry is
		// in the registry for this request, it's visible.
		return null !== $this->entry();
	}

	public function serialize(): array {
		$shape = parent::serialize();
		$entry = $this->entry();
		// Carry the open target so the JS-side opener can dispatch
		// without round-tripping. Either `window` (a registered
		// native window id) or `url` is set; never both.
		$shape['shortcutWindow'] = $entry ? (string) $entry['window'] : '';
		$shape['shortcutUrl']    = $entry ? (string) $entry['url'] : '';
		// Surface the `pinned` flag through the placement payload so
		// the FilesLayer can anchor the tile to the top-left and skip
		// drag wiring.
		$shape['pinned'] = $entry ? ! empty( $entry['pinned'] ) : false;
		return $shape;
	}

	private function entry(): ?array {
		$id = (string) $this->ref;
		if ( '' === $id ) {
			return null;
		}
		if ( ! function_exists( 'desktop_mode_desktop_icon_registry' ) ) {
			return null;
		}
		$entry = desktop_mode_desktop_icon_registry( $id );
		return is_array( $entry ) ? $entry : null;
	}
}
