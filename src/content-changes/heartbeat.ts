import { broadcast } from '../broadcast';
import { heartbeat } from '../heartbeat';

interface ContentChangeEntry {
	ts: number;
	type: string;
	action: string;
	ids: number[];
}

interface ContentChangesBlock {
	ts: number;
	entries: ContentChangeEntry[];
}

let seenTs: number | null = null;

export function bootContentChangesHeartbeat(): void {
	heartbeat.contribute( 'openstation_content_changes_seen_ts', () =>
		seenTs === null ? 0 : seenTs,
	);

	heartbeat.subscribe< ContentChangesBlock >(
		'openstation_content_changes',
		( block ) => {
			if ( ! block || typeof block.ts !== 'number' ) {
				return;
			}

			const handshake = seenTs === null;
			const floor = seenTs ?? 0;
			let maxTs = Math.max( floor, block.ts );

			if ( ! handshake && Array.isArray( block.entries ) ) {
				for ( const entry of block.entries ) {
					if (
						! entry ||
						typeof entry.ts !== 'number' ||
						entry.ts <= floor ||
						typeof entry.type !== 'string' ||
						entry.type === ''
					) {
						continue;
					}
					broadcast( `os.${ entry.type }.changed`, {
						source: 'heartbeat',
						action:
							typeof entry.action === 'string' && entry.action !== ''
								? entry.action
								: 'updated',
						ids: Array.isArray( entry.ids )
							? entry.ids.map( Number ).filter( ( id ) => id > 0 )
							: [],
					} );
					if ( entry.ts > maxTs ) {
						maxTs = entry.ts;
					}
				}
			}

			seenTs = maxTs;
		},
	);
}

export function _resetContentChangesHeartbeatForTests(): void {
	seenTs = null;
}
