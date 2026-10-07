import type { HarvestedCommand } from '../types';
import type { WindowContentRef } from '../window-links/types';

export type BridgeEventFromIframe =
	| { type: 'os-title-change'; title: string }
	| { type: 'os-navigate'; url: string; target: 'self' | 'new' }
	| { type: 'os-notification'; title: string; body: string }
	| { type: 'os-ready' }
	| { type: 'os-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
	| {
		type: 'os-screen-meta-state';
		open: 'screen-options' | 'help' | null;
	}
	| { type: 'os-commands-list'; commands: HarvestedCommand[] }

	| {
		type: 'os-content-identity';
		identity: WindowContentRef | null;
	}

	| {
		type: 'os-open-user-footprint';
		userId: number;
		userName: string;
	}

	| {
		type: 'os-editor-autosave-response';
		requestId: string;
		status: 'saved' | 'no-editor' | 'not-dirty' | 'error';
		previewUrl?: string;
	}

	| {
		type: 'os-editor-live-saved';
		watchId: string;
		previewUrl?: string;
	}

	| {
		type: 'os-bridge-handshake-ack';
		connectionId: string;
	}
	| {
		type: 'os-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'os-bridge-disconnect';
		connectionId: string;
	}

	| {
		type: 'os-pointer-move';
		x: number;
		y: number;
	};

export type BridgeEventToIframe =
	| { type: 'os-focus' }

	| { type: 'os-window-active'; active: boolean }
	| { type: 'os-color-scheme'; scheme: string }
	| { type: 'os-toggle-panel'; panel: 'screen-options' | 'help' }
	| { type: 'os-commands-subscribe' }
	| { type: 'os-commands-unsubscribe' }
	| { type: 'os-commands-invoke'; name: string }

	| {
		type: 'os-editor-autosave-request';
		requestId: string;
	}

	| {
		type: 'os-editor-live-watch';
		watchId: string;
		debounceMs: number;
	}
	| {
		type: 'os-editor-live-unwatch';
		watchId: string;
	}
	| {
		type: 'os-bridge-handshake';
		connectionId: string;
		targetWindowId?: string;
		topics: string[];
	}
	| {
		type: 'os-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'os-bridge-disconnect';
		connectionId: string;
	}

	| {
		type: 'os-pointer-track';
		enabled: boolean;
	};

export type BridgeEvent = BridgeEventFromIframe | BridgeEventToIframe;

export type BridgeEventType = BridgeEvent[ 'type' ];

export const BRIDGE_EVENT_TYPES: ReadonlySet< BridgeEventType > = new Set( [

	'os-title-change',
	'os-navigate',
	'os-notification',
	'os-ready',
	'os-screen-meta',
	'os-screen-meta-state',
	'os-commands-list',
	'os-content-identity',
	'os-open-user-footprint',
	'os-editor-autosave-response',
	'os-editor-live-saved',
	'os-bridge-handshake-ack',
	'os-pointer-move',

	'os-focus',
	'os-window-active',
	'os-color-scheme',
	'os-toggle-panel',
	'os-commands-subscribe',
	'os-commands-unsubscribe',
	'os-commands-invoke',
	'os-editor-autosave-request',
	'os-editor-live-watch',
	'os-editor-live-unwatch',
	'os-bridge-handshake',
	'os-pointer-track',

	'os-bridge-publish',
	'os-bridge-disconnect',
] );
