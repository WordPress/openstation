/** Keep a conversation anchor in the same coordinate space as its window. */
import type { MioHandle } from './types';

export function followMioChat( frame: HTMLElement, panel: HTMLElement, handle: () => MioHandle | null ) {
	const bounds = frame.getBoundingClientRect();
	const position = handle()?.getPosition();
	const resting = position ? { x: position.x - bounds.left, y: position.y - bounds.top } : null;
	const observer = new ResizeObserver( move );
	function move(): void {
		if ( ! frame.isConnected || frame.hidden ) {
			return;
		}
		const currentBounds = frame.getBoundingClientRect();
		const rect = panel.getBoundingClientRect();
		// A narrow window has no room beside the panel. Keep the original home.
		let target = resting ? { x: currentBounds.left + resting.x, y: currentBounds.top + resting.y } : null;
		if ( rect.left - currentBounds.left >= 140 ) {
			target = { x: rect.left - 70, y: Math.min( rect.top + 70, currentBounds.bottom - 70 ) };
		}
		handle()?.setAnchor?.( target, true );
	}
	observer.observe( panel );
	observer.observe( frame );
	move();
	return {
		close: ( restore: boolean ) => {
			observer.disconnect();
			const currentBounds = frame.getBoundingClientRect();
			handle()?.setAnchor?.( restore && resting
				? { x: currentBounds.left + resting.x, y: currentBounds.top + resting.y } : null, false );
		},
	};
}
