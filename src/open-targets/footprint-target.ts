const WINDOW_ID = 'my-wordpress';

interface SharedStoreApi< T > {
	state: T;
	notify(): void;
	subscribe( cb: ( state: T ) => void ): () => void;
}

export interface FootprintTarget {

	userId: number | null;

	userName: string;

	requestedAt: number;
}

interface DesktopFacade {
	createSharedStore?: < T >(
		key: string,
		initial: () => T,
	) => SharedStoreApi< T >;
	openWindow?: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean | undefined;
}

const _initial: Readonly< FootprintTarget > = Object.freeze( {
	userId: null,
	userName: '',
	requestedAt: 0,
} );

function getDesktop(): DesktopFacade | undefined {
	return ( window as unknown as { wp?: { os?: DesktopFacade } } ).wp
		?.os;
}

let _store: SharedStoreApi< FootprintTarget > | null = null;

function getStore(): SharedStoreApi< FootprintTarget > | null {
	if ( _store ) {
		return _store;
	}
	const factory = getDesktop()?.createSharedStore;
	if ( typeof factory !== 'function' ) {
		return null;
	}
	_store = factory< FootprintTarget >(
		'desktop-mode/my-wordpress/footprint-target',
		() => ( { ..._initial } ),
	);
	return _store;
}

export function setFootprintTarget( userId: number, userName = '' ): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = userId;
		store.state.userName = userName;
		store.state.requestedAt = Date.now();

		store.notify();
		return;
	}

	(
		window as unknown as { _wpdFootprintTarget?: FootprintTarget }
	)._wpdFootprintTarget = {
		userId,
		userName,
		requestedAt: Date.now(),
	};
}

export function readFootprintTarget(): FootprintTarget {
	const store = getStore();
	if ( store ) {
		return { ...store.state };
	}
	return (
		( window as unknown as { _wpdFootprintTarget?: FootprintTarget } )
			._wpdFootprintTarget ?? { ..._initial }
	);
}

export function clearFootprintTarget(): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = null;
		store.state.userName = '';
		store.state.requestedAt = 0;
		store.notify();
	}
	const w = window as unknown as { _wpdFootprintTarget?: FootprintTarget };
	if ( w._wpdFootprintTarget ) {
		w._wpdFootprintTarget = { ..._initial };
	}
}

export function subscribeFootprintTarget(
	cb: ( target: FootprintTarget ) => void,
): () => void {
	const store = getStore();
	if ( ! store ) {
		return () => {};
	}
	return store.subscribe( ( state ) => cb( { ...state } ) );
}

export function openUserFootprintWindow( args: {
	userId: number;
	userName?: string;
} ): void {
	const userId = Number( args.userId );
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return;
	}
	const userName = args.userName ?? '';
	setFootprintTarget( userId, userName );
	getDesktop()?.openWindow?.( WINDOW_ID, {
		source: 'my-wordpress/open-user-footprint',
		params: { footprint: userId, fpName: userName },
	} );
}
