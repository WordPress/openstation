<?php
/**
 * OpenStation App Framework — effects.
 *
 * What an action wants the shell to do besides repainting the body:
 * show a toast, retitle the window, close it, open another one, set
 * a badge, pop a context menu. An action calls `$os->toast( … )`; the
 * runtime ships the list to the client, which performs each one
 * after the morph.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Queue of shell effects for one dispatch.
 */
final class Effects {

	/**
	 * @var array<int,array<string,mixed>>
	 */
	private $items = array();

	/**
	 * Show a toast.
	 *
	 * There is no tone: the shell renders every toast the same way
	 * (`wp.os.showToast()` takes no severity), so a `$tone` argument
	 * here would be a promise the platform cannot keep. Say what
	 * happened in the message, and use `<os-notice tone="…">` in the
	 * body when a state needs a colour.
	 *
	 * @param string $message Text.
	 * @return self
	 */
	public function toast( $message ) {
		return $this->add( 'toast', array( 'message' => (string) $message ) );
	}

	/**
	 * Retitle the window for this session.
	 *
	 * @param string $title New title.
	 * @return self
	 */
	public function title( $title ) {
		return $this->add( 'title', array( 'title' => (string) $title ) );
	}

	/**
	 * Close the window once the response lands.
	 *
	 * @return self
	 */
	public function close() {
		return $this->add( 'close', array() );
	}

	/**
	 * Open (or focus) another registered window.
	 *
	 * @param string $window_id Native window id.
	 * @return self
	 */
	public function open( $window_id ) {
		return $this->add( 'open', array( 'window' => (string) $window_id ) );
	}

	/**
	 * Open an admin URL in an iframe window (an edit screen, a
	 * settings page).
	 *
	 * @param string $url   Admin URL.
	 * @param string $title Window title; the page's own title when ''.
	 * @param string $icon  Window icon (a Dashicons class or an image
	 *                      URL); the shell's generic glyph when ''.
	 * @return self
	 */
	public function open_url( $url, $title = '', $icon = '' ) {
		return $this->add(
			'open_url',
			array(
				'url'   => (string) $url,
				'title' => (string) $title,
				'icon'  => (string) $icon,
			)
		);
	}

	/**
	 * Set (or clear with 0) the badge on the app's dock tile and
	 * desktop icon.
	 *
	 * @param int $count Count; 0 clears.
	 * @return self
	 */
	public function badge( $count ) {
		return $this->add( 'badge', array( 'count' => max( 0, (int) $count ) ) );
	}

	/**
	 * Swap the art on every rail hosting the app's tile — dock,
	 * taskbar, desktop icon. State-driven icons (the Recycle Bin's
	 * empty/full bin is the canonical case).
	 *
	 * @param string $icon SVG data URI or image URL.
	 * @return self
	 */
	public function icon( $icon ) {
		return $this->add( 'icon', array( 'icon' => (string) $icon ) );
	}

	/**
	 * Announce a content change so every window showing that content
	 * refreshes (`wp.os.announceContentChange`).
	 *
	 * @param string    $type   Content type, e.g. `post`, `comment`, `user`.
	 * @param string    $action `created` | `updated` | `trashed` | `untrashed` | `deleted`.
	 * @param int|int[] $ids    Affected ids.
	 * @return self
	 */
	public function announce( $type, $action, $ids ) {
		return $this->add(
			'announce',
			array(
				'contentType' => (string) $type,
				'action'      => (string) $action,
				'ids'         => array_values( array_map( 'intval', (array) $ids ) ),
			)
		);
	}

	/**
	 * Pop a context menu at the pointer. Each item dispatches an
	 * action when picked.
	 *
	 * @param array<int,array<string,mixed>> $items Each: `label`, `action` (required), `args`, `icon`, `danger`, `disabled`.
	 * @return self
	 */
	public function menu( array $items ) {
		$clean = array();
		foreach ( $items as $index => $item ) {
			if ( empty( $item['label'] ) || empty( $item['action'] ) ) {
				continue;
			}
			$clean[] = array(
				'id'       => isset( $item['id'] ) ? (string) $item['id'] : 'item-' . $index,
				'label'    => (string) $item['label'],
				'action'   => (string) $item['action'],
				'args'     => isset( $item['args'] ) && is_array( $item['args'] ) ? $item['args'] : array(),
				'icon'     => isset( $item['icon'] ) ? (string) $item['icon'] : '',
				'danger'   => ! empty( $item['danger'] ),
				'disabled' => ! empty( $item['disabled'] ),
			);
		}
		return $this->add( 'menu', array( 'items' => $clean ) );
	}

	/**
	 * Publish on the window's channel bus (`ctx.window.send`), for
	 * peers connected with `wp.os.connect( id )`.
	 *
	 * @param string $channel Channel name.
	 * @param mixed  $payload Serialisable payload.
	 * @return self
	 */
	public function send( $channel, $payload = null ) {
		return $this->add(
			'send',
			array(
				'channel' => (string) $channel,
				'payload' => $payload,
			)
		);
	}

	/**
	 * Queue a custom effect for a runtime extension to handle.
	 *
	 * @param string              $type Effect type.
	 * @param array<string,mixed> $data Payload.
	 * @return self
	 */
	public function add( $type, array $data = array() ) {
		$this->items[] = array_merge( array( 'type' => (string) $type ), $data );
		return $this;
	}

	/**
	 * Everything queued, in order.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function all() {
		return $this->items;
	}
}
