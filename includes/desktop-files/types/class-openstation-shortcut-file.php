<?php
/**
 * OpenStation — `shortcut` file type.
 *
 * Wraps a plugin shortcut registered via
 * `openstation_register_icon()` so it lives on the same grid
 * as folders, posts, and the rest. Reference shape: the
 * registered icon id.
 *
 * The merge unifies two previously-separate rails — the plugin
 * shortcut rail (`os-icons`) and the file layer
 * (`os-files-layer`) — into one surface. Drag, sort,
 * right-click, clean-up: everything works uniformly because
 * everything is now a placement.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `shortcut` desktop file type.
 */
class OpenStation_Shortcut_File extends OpenStation_File {

	/**
	 * The resolved registration entry: `false` until asked for, then
	 * the entry or null.
	 *
	 * One placement asks five times (exists, can_read, title, icon,
	 * serialize) and every answer runs the whole `openstation_icons`
	 * filter chain, so a desk of shortcuts paid for the chain five
	 * times over per tile. An instance is one placement in one
	 * listing; it resolves once.
	 *
	 * @var array|null|false
	 */
	private $resolved_entry = false;

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'shortcut';
	}

	/**
	 * Whether the shortcut's registration entry still exists.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return null !== $this->entry();
	}

	/**
	 * Get the shortcut title from the registration entry.
	 *
	 * @return string
	 */
	public function title(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return __( '(missing shortcut)', 'desktop-mode' );
		}
		return (string) $entry['title'];
	}

	/**
	 * Get the Dashicon class from the registration entry.
	 *
	 * @return string
	 */
	public function icon(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return 'dashicons-warning';
		}
		return (string) $entry['icon'];
	}

	/**
	 * Shortcut visibility is determined at registration time;
	 * if the entry is in the registry for this request, it's visible.
	 *
	 * @param int $user_id
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		// Shortcut visibility = registration visibility. The
		// `openstation_register_icon` capability gate already
		// filters per user at registration time; if the entry is
		// in the registry for this request, it's visible.
		return null !== $this->entry();
	}

	/**
	 * Augment the base serialized shape with the open target
	 * (window id or URL) and pinned flag.
	 *
	 * @return array
	 */
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

	/**
	 * Lazily resolve the registration entry, through the `openstation_icons`
	 * filter the placement that points here was minted from. The raw
	 * registry would not know a filter-injected icon, and its placement
	 * would serialize as a missing file.
	 *
	 * @return array|null Null when the entry is gone or the ref is invalid.
	 */
	private function entry(): ?array {
		if ( false !== $this->resolved_entry ) {
			return $this->resolved_entry;
		}
		$id                   = (string) $this->ref;
		$this->resolved_entry = ( '' !== $id && function_exists( 'openstation_desktop_icon_entry' ) )
			? openstation_desktop_icon_entry( $id )
			: null;
		return $this->resolved_entry;
	}
}
