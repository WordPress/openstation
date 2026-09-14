/** Browser QA fixture, isolated from WordPress and any real provider or save. */
import '../../../src/ui/components/os-button/os-button';
import { mountMioChat, type MioChatHandle } from '../../../src/mio/assistant/chat';
import { MioSession } from '../../../src/mio/assistant/session';
import type { MioTurn } from '../../../src/mio/assistant/types';

const host = document.getElementById( 'chat' )!;
const preview = document.getElementById( 'preview' )!;
let chat: MioChatHandle | null = null;
let allowed = true; let calls = 0; let saves = 0; let previews = 0;
const counts = () => { document.getElementById( 'counts' )!.textContent = `Provider calls: ${ calls }; saves: ${ saves }; previews: ${ previews }`; };
const receipts = new Map<string, number>();
const session = new MioSession( {
	host, title: 'Form editor', prompt: () => 'Edit a form', documents: [],
	abilities: () => [ {
		name: 'save_form', effect: 'write', description: 'Simulated save', parameters: {}, validate: () => true,
		run: () => { saves++; const receipt = `save-${ saves }`; receipts.set( receipt, 42 ); counts(); return { effect: 'write', status: 'confirmed', receipt }; },
	} ],
	responseActions: ( { summary, operations } ) => {
		const saved = operations.find( op => op.status === 'confirmed' && op.receipt && receipts.has( op.receipt ) );
		if ( summary.status !== 'completed' || summary.unknownWrites || ! saved?.receipt ) { return []; }
		const id = receipts.get( saved.receipt );
		return [ {
			id: 'preview', label: 'Preview', ariaLabel: 'Preview the saved Contact us form', icon: 'dashicons-visibility', effect: 'navigate', emphasis: 'primary',
			allowed: () => allowed,
			run: async ( { signal } ) => {
				await new Promise<void>( ( resolve, reject ) => { const timer = setTimeout( resolve, 700 ); signal.addEventListener( 'abort', () => { clearTimeout( timer ); reject( new DOMException( 'Stopped', 'AbortError' ) ); }, { once: true } ); } );
				signal.throwIfAborted(); previews++; counts(); preview.hidden = false; preview.textContent = `Contact us — latest saved definition of form ${ id }. Existing preview reused.`; preview.focus();
			},
		}, {
			id: 'details', label: 'Read saved form details', effect: 'read',
			run: async () => { throw new Error( 'Example local error: the saved form is unavailable. You can retry.' ); },
		} ];
	},
}, async (): Promise<MioTurn> => { calls++; counts(); return calls % 2 ? { message: '', calls: [ { name: 'save_form', arguments: '{}' } ] } : { message: 'Your **Contact us** form is saved as a draft. The Other option reveals a required text area.\n\nPreview opens the latest saved definition without another save.', calls: [] }; }, () => true );
function open() { if ( ! chat ) { chat = mountMioChat( host, 'Form editor', session, () => { chat?.destroy(); chat = null; } ); } }
document.getElementById( 'reopen' )!.addEventListener( 'click', open );
document.getElementById( 'permission' )!.addEventListener( 'click', () => { allowed = ! allowed; document.getElementById( 'permission' )!.textContent = allowed ? 'Revoke preview access' : 'Restore preview access'; } );
document.getElementById( 'theme' )!.addEventListener( 'click', () => { document.body.classList.toggle( 'qa-light' ); } );
document.getElementById( 'direction' )!.addEventListener( 'click', () => { document.documentElement.dir = document.documentElement.dir === 'rtl' ? 'ltr' : 'rtl'; } );
document.getElementById( 'narrow' )!.addEventListener( 'click', () => { host.style.maxWidth = host.style.maxWidth ? '' : '260px'; } );
counts(); open();
