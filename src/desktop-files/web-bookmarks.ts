/** Persistent `embed` placement creation + best-effort web metadata. */

import { rest, store } from './layer-deps';
import type { RestPlacementShape } from './rest';
import { normalizeWebUrl } from './web-url';

export interface CreateWebBookmarkOptions {
	folderId: number;
	url: string;
	x: number;
	y: number;
	name?: string;
	repositionExisting?: boolean;
}

export interface CreateWebBookmarkResult {
	placement: RestPlacementShape;
	created: boolean;
}

function metaString(
	placement: RestPlacementShape,
	key: 'name' | 'iconUrl',
): string {
	const value = placement.meta?.[ key ];
	return typeof value === 'string' ? value.trim() : '';
}

function enrichInBackground( placement: RestPlacementShape ): void {
	if ( metaString( placement, 'name' ) && metaString( placement, 'iconUrl' ) ) {
		return;
	}
	void rest
		.enrichWebMetadata( placement.id )
		.then( ( enriched ) => {
			store.upsertPlacement( enriched, 'remote' );
		} )
		.catch( ( err: unknown ) => {
			// Metadata is decoration, not a creation gate. The bookmark
			// remains usable with its hostname + generic icon.
			// eslint-disable-next-line no-console
			console.warn( '[desktop-mode] bookmark metadata lookup failed:', err );
		} );
}

function matchingBookmark(
	placements: readonly RestPlacementShape[],
	url: string,
): RestPlacementShape | undefined {
	return placements.find(
		( placement ) =>
			placement.file.type === 'embed' &&
			normalizeWebUrl( placement.file.ref ) === url,
	);
}

/**
 * Create a web bookmark or reuse the matching placement in the same folder.
 * The database's unique key already encodes this identity; the client-side
 * lookup prevents a repeat paste from wiping saved name/window metadata.
 */
export async function createWebBookmark(
	options: CreateWebBookmarkOptions,
): Promise< CreateWebBookmarkResult > {
	const url = normalizeWebUrl( options.url );
	if ( ! url ) {
		throw new Error( 'Only HTTP and HTTPS URLs can be added as bookmarks.' );
	}

	const peers = store.getState().placementsByFolder.get( options.folderId ) ?? [];
	const existing = matchingBookmark( peers, url );
	if ( existing ) {
		let placement = existing;
		if (
			options.repositionExisting &&
			( existing.x !== options.x || existing.y !== options.y )
		) {
			placement = await rest.updatePlacement(
				existing.id,
				{ x: options.x, y: options.y },
				existing.updatedAtMs,
			);
			store.upsertPlacement( placement, 'remote' );
		}
		enrichInBackground( placement );
		return { placement, created: false };
	}

	const name = options.name?.trim() ?? '';
	let placement: RestPlacementShape;
	try {
		placement = await rest.createPlacement( {
			type: 'embed',
			ref: url,
			parentId: options.folderId,
			x: options.x,
			y: options.y,
			meta: name ? { name } : undefined,
		} );
	} catch ( createError ) {
		// Some SQLite/Playground failures can happen after the INSERT
		// commits but before WordPress serializes the response. Reconcile
		// once before reporting failure so a real row never appears beside
		// a misleading "Could not add" toast.
		try {
			const refreshed = await rest.listPlacements( options.folderId );
			store.setFolderPlacements( options.folderId, refreshed.placements );
			const recovered = matchingBookmark( refreshed.placements, url );
			if ( recovered ) {
				enrichInBackground( recovered );
				return { placement: recovered, created: true };
			}
		} catch ( reconcileError ) {
			// Keep the original create error as the actionable failure.
			// eslint-disable-next-line no-console
			console.warn(
				'[desktop-mode] bookmark reconciliation failed:',
				reconcileError,
			);
		}
		throw createError;
	}
	store.upsertPlacement( placement, 'remote' );
	enrichInBackground( placement );
	return { placement, created: true };
}
