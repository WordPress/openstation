import { renderGamesHub } from './hub';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const registry = ( window.openStationNativeWindows ??= {} );
registry[ 'desktop-mode-games' ] = renderGamesHub as RenderCallback;
