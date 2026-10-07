import './styles.css';
import { trackedFetch } from '../../tracked-fetch';
import { restErrorFromResponse } from '../../core/api-client';
import { describeRestFailure } from '../../core/rest-failure';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { decodeHTML } from '../../utils';

const WIDGET_ID = 'desktop-mode/starter';

const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {
	let destroyed = false;

	const root = document.createElement( 'div' );
	root.className = 'dm-starter';

	const header = document.createElement( 'div' );
	header.className = 'dm-starter__header';
	header.textContent = 'Starter Widget';

	const body = document.createElement( 'div' );
	body.className = 'dm-starter__body';
	body.textContent = 'Loading\u2026';

	root.appendChild( header );
	root.appendChild( body );
	container.appendChild( root );

	const clickCount = ctx.storage.get< number >( 'clicks' ) ?? 0;

	const counter = document.createElement( 'button' );
	counter.className = 'dm-starter__counter';
	counter.textContent = `Clicked ${ clickCount } ${ clickCount === 1 ? 'time' : 'times' }`;

	const onClick = (): void => {
		const current = ctx.storage.get< number >( 'clicks' ) ?? 0;
		const next = current + 1;
		ctx.storage.set( 'clicks', next );
		counter.textContent = `Clicked ${ next } ${ next === 1 ? 'time' : 'times' }`;
	};
	counter.addEventListener( 'click', onClick );
	root.appendChild( counter );

	const rootUrl = ( window as unknown as { wpApiSettings?: { root?: string } } )
		.wpApiSettings?.root ?? '/wp-json/';

	const loadData = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const res = await trackedFetch(
				rootUrl.replace( /\/$/, '' ) +
					'/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=id,title',
				{ credentials: 'same-origin' },
				{ source: 'desktop-mode/starter', silent: true },
			);

			if ( destroyed ) {
				return;
			}
			if ( ! res.ok ) {
				throw await restErrorFromResponse( res );
			}
			const posts = await res.json() as Array< { title: { rendered: string } } >;

			if ( destroyed ) {
				return;
			}
			body.textContent = posts.length > 0
				? 'Latest post: ' + decodeHTML( posts[ 0 ].title.rendered )
				: 'No posts found.';
		} catch ( err ) {
			if ( ! destroyed ) {
				body.textContent = describeRestFailure( err, {
					fallback: 'Could not load posts.',
				} ).message;
			}
		}
	};

	await loadData();

	const POLL_MS = 60_000;
	let intervalId: ReturnType< typeof setInterval > | null = null;
	let lastLoadMs = Date.now();
	const poll = () => {
		lastLoadMs = Date.now();
		void loadData();
	};
	const startPolling = () => {
		if ( intervalId === null ) {
			intervalId = setInterval( poll, POLL_MS );
		}
	};
	const stopPolling = () => {
		if ( intervalId !== null ) {
			clearInterval( intervalId );
			intervalId = null;
		}
	};
	const onVisibilityChange = () => {
		if ( document.hidden ) {
			stopPolling();
			return;
		}
		if ( Date.now() - lastLoadMs >= POLL_MS ) {
			poll();
		}
		startPolling();
	};
	document.addEventListener( 'visibilitychange', onVisibilityChange );
	if ( ! document.hidden ) {
		startPolling();
	}

	return () => {
		destroyed = true;
		stopPolling();
		document.removeEventListener( 'visibilitychange', onVisibilityChange );
		counter.removeEventListener( 'click', onClick );
	};
};

const w = window as unknown as {
	openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
