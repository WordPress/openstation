import { setRegion } from '../nav/config';
import type { RestPlacementShape } from './rest';

export function readSynthSource( placement: RestPlacementShape ): string | null {
	const meta = placement.meta;
	if ( ! meta || typeof meta !== 'object' ) {
		return null;
	}
	const v = ( meta as Record< string, unknown > ).__synthFromDockItem;
	return typeof v === 'string' && v !== '' ? v : null;
}

export function isSyntheticPlacement( placement: RestPlacementShape ): boolean {
	return placement.id <= 0 || readSynthSource( placement ) !== null;
}

export function hideFromDesktop( ids: readonly string[] ): void {
	if ( ids.length === 0 ) {
		return;
	}
	setRegion( ids, 'desktop', false );
}
