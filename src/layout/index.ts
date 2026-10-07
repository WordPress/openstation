import { createSharedStore } from '../shared-store';
import type { DesktopLayoutId } from './types';

interface LayoutState {
	layout: DesktopLayoutId;
}

const store = createSharedStore< LayoutState >( 'desktop-mode/layout', () => ( {

	layout: 'classic',
} ) );

export function getCurrentLayout(): DesktopLayoutId {
	return store.state.layout;
}

export function setCurrentLayout( layout: DesktopLayoutId ): void {
	if ( store.state.layout === layout ) {
		return;
	}
	store.state.layout = layout;
	store.notify();
}

export function subscribeLayout(
	cb: ( layout: DesktopLayoutId ) => void,
): () => void {
	return store.subscribe( ( state ) => cb( state.layout ) );
}

export type { DesktopLayoutId } from './types';
