/**
 * mio-js — `@xmldom/xmldom` stand-in.
 *
 * A 166 kB XML parser, and the largest single thing in an untrimmed
 * build after the renderer itself. It arrives through exactly one
 * import in the whole of PixiJS:
 *
 *     // lib/environment-webworker/WebWorkerAdapter.mjs
 *     import { DOMParser } from '@xmldom/xmldom';
 *     …
 *     parseXML: ( xml ) => new DOMParser().parseFromString( xml, 'text/xml' )
 *
 * A Web Worker has no `DOMParser`, so Pixi's *worker* environment
 * adapter carries its own. A document has one built in, which is why
 * the browser adapter — the one that wins here, and the only one that
 * can win in a page — has no such dependency. (This is not the SVG
 * parser. That one uses the platform's `DOMParser` and is untouched.)
 *
 * So the class below is unreachable, and it throws rather than
 * pretending: if a future PixiJS reaches this code in a document, a
 * clear error naming the trim beats an XML parse that silently
 * returns nothing.
 */

export class DOMParser {
	public parseFromString(): never {
		throw new Error(
			'[mio-js] @xmldom/xmldom was trimmed from this bundle — it is ' +
				"reachable only from PixiJS's Web Worker environment " +
				'adapter, and this library runs in a document. See ' +
				'PIXI_UNUSED in vite.config.js.',
		);
	}
}
