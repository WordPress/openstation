import { createSharedStore } from '../shared-store';
import {
	clampRevealDurationOverride,
	getWindowReveal,
	REVEAL_DURATION_AUTO,
	WINDOW_REVEAL_NONE,
} from './registry';
import type { WindowRevealDef } from './types';
import type { OsSettings } from '../settings';

interface ActiveRevealStore {
	id: string;
	duration: number;
}

const store = createSharedStore< ActiveRevealStore >(
	'desktop-mode/window-reveal-active',
	() => ( { id: WINDOW_REVEAL_NONE, duration: REVEAL_DURATION_AUTO } ),
);

export function setActiveWindowRevealId( id: string ): void {
	store.state.id = typeof id === 'string' && id !== '' ? id : WINDOW_REVEAL_NONE;
}

export function getActiveWindowRevealId(): string {
	return store.state.id;
}

export function getActiveWindowReveal(): WindowRevealDef | null {
	const id = store.state.id;
	if ( ! id || id === WINDOW_REVEAL_NONE ) {
		return null;
	}
	return getWindowReveal( id ) ?? null;
}

export function setActiveWindowRevealDuration( ms: number ): void {
	store.state.duration = clampRevealDurationOverride( ms );
}

export function getActiveWindowRevealDuration(): number {
	return store.state.duration;
}

export interface WindowRevealEngineDeps {
	osSettings: OsSettings;
}

export function startWindowRevealEngine( {
	osSettings,
}: WindowRevealEngineDeps ): void {
	const seed = osSettings.getOsSettingsSnapshot();
	setActiveWindowRevealId( seed.windowReveal );
	setActiveWindowRevealDuration( seed.windowRevealDuration );
	osSettings.subscribeOsSettings( ( snapshot ) => {
		setActiveWindowRevealId( snapshot.windowReveal );
		setActiveWindowRevealDuration( snapshot.windowRevealDuration );
	} );
}
