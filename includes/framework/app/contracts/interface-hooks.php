<?php
/**
 * OpenStation App Framework — Hooks contract.
 *
 * The extensibility bus. Apps expose their seams through it exactly
 * as WordPress code does — `filter()` to let others reshape a value,
 * `action()` to announce that something happened — and the host
 * decides what those calls mean.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

interface Hooks {

	/**
	 * Run a value through every registered filter callback.
	 *
	 * @param string $hook  Hook name.
	 * @param mixed  $value Value to filter.
	 * @param mixed  ...$args Extra arguments handed to the callbacks.
	 * @return mixed Filtered value.
	 */
	public function filter( $hook, $value, ...$args );

	/**
	 * Fire an action.
	 *
	 * @param string $hook    Hook name.
	 * @param mixed  ...$args Arguments handed to the callbacks.
	 * @return void
	 */
	public function action( $hook, ...$args );
}
