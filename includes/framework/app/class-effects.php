<?php

namespace OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Effects {

	private $items = array();

	public function toast( $message, $type = '' ) {
		$effect = array( 'message' => (string) $message );
		if ( '' !== (string) $type ) {

			$effect['toastType'] = (string) $type;
		}
		return $this->add( 'toast', $effect );
	}

	public function title( $title ) {
		return $this->add( 'title', array( 'title' => (string) $title ) );
	}

	public function close() {
		return $this->add( 'close', array() );
	}

	public function open( $window_id ) {
		return $this->add( 'open', array( 'window' => (string) $window_id ) );
	}

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

	public function badge( $count ) {
		return $this->add( 'badge', array( 'count' => max( 0, (int) $count ) ) );
	}

	public function icon( $icon ) {
		return $this->add( 'icon', array( 'icon' => (string) $icon ) );
	}

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

	public function send( $channel, $payload = null ) {
		return $this->add(
			'send',
			array(
				'channel' => (string) $channel,
				'payload' => $payload,
			)
		);
	}

	public function refresh_menu() {
		return $this->add( 'refresh_menu', array() );
	}

	public function add( $type, array $data = array() ) {
		$this->items[] = array_merge( array( 'type' => (string) $type ), $data );
		return $this;
	}

	public function all() {
		return $this->items;
	}
}
