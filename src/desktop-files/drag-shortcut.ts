export const DROP_MIME = 'application/x-os-shortcut+json';

export interface DesktopShortcutDragPayload {
	type: string;
	ref: string;
	title: string;
	icon?: string;
}

export function setShortcutDragPayload(
	dt: DataTransfer,
	payload: DesktopShortcutDragPayload,
): void {
	try {
		dt.setData( DROP_MIME, JSON.stringify( payload ) );
		dt.setData( 'text/plain', payload.title );
		dt.effectAllowed = 'copy';
	} catch {

	}
}

export function hasShortcutPayload( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	for ( let i = 0; i < types.length; i += 1 ) {
		if ( types[ i ] === DROP_MIME ) {
			return true;
		}
	}
	return false;
}

export function readShortcutPayload(
	e: DragEvent,
): DesktopShortcutDragPayload | null {
	const raw = e.dataTransfer?.getData( DROP_MIME );
	if ( ! raw ) {
		return null;
	}
	try {
		const parsed = JSON.parse( raw );
		if (
			parsed &&
			typeof parsed.type === 'string' &&
			typeof parsed.ref === 'string'
		) {
			return parsed as DesktopShortcutDragPayload;
		}
	} catch {

	}
	return null;
}
