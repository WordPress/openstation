import { runClock } from '../ui/util/run-clock';

const NODE_ID = 'wp-admin-bar-os-clock';

let stopClock: ( () => void ) | null = null;

export function syncToolbarClock( on: boolean ): void {
	if ( typeof document === 'undefined' ) {
		return;
	}
	const existing = document.getElementById( NODE_ID );
	if ( ! on ) {
		stopClock?.();
		stopClock = null;
		existing?.remove();
		return;
	}
	const group = document.getElementById( 'wp-admin-bar-top-secondary' );
	if ( existing || ! group ) {
		return;
	}
	const node = document.createElement( 'li' );
	node.id = NODE_ID;
	const item = document.createElement( 'div' );
	item.className = 'ab-item ab-empty-item';
	const time = document.createElement( 'time' );
	item.append( time );
	node.append( item );
	group.insertBefore( node, document.getElementById( 'wp-admin-bar-my-account' ) );
	stopClock = runClock( time );
}
