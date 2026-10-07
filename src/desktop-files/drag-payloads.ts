import type { RestPlacementShape } from './rest';
import type { DragBridgePayload } from '../drag-bridge';

export interface DesktopFileDragData {

	placement: RestPlacementShape;

	placements?: RestPlacementShape[];

	sourceFolderId: number;

	bridgePayload?: DragBridgePayload;
}

export interface ShortcutDragItem {

	kind: string;

	ref: string;

	title?: string;

	icon?: string;

	entityId?: string;

	restPath?: string;

	bridgePayload?: DragBridgePayload;
}

export interface ShortcutDragData extends ShortcutDragItem {

	items?: ShortcutDragItem[];
}

export function dragPlacements(
	data: DesktopFileDragData,
): RestPlacementShape[] {
	const many = data.placements;
	if ( Array.isArray( many ) && many.length > 0 ) {
		return many;
	}
	return data.placement ? [ data.placement ] : [];
}

export function dragShortcutItems(
	data: ShortcutDragData,
): ShortcutDragItem[] {
	const many = data.items;
	if ( Array.isArray( many ) && many.length > 0 ) {
		return many;
	}
	return data.ref ? [ data ] : [];
}

export interface DesktopFileDragPayload {
	type: 'desktop-file';
	source: HTMLElement;
	data: DesktopFileDragData;
}

export interface ShortcutDragPayload {
	type: 'shortcut';
	source: HTMLElement;
	data: ShortcutDragData;
}

export type DesktopFilesDragPayload =
	| DesktopFileDragPayload
	| ShortcutDragPayload;
