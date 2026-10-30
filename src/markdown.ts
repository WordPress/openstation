/**
 * OpenStation — minimal shared Markdown renderer.
 *
 * Extracted from the AI assistant so every surface that shows
 * Markdown-ish text (the assistant overlay, the Agent chat window,
 * pinned notes) formats it the same way. Pure string → safe-HTML; no
 * dependencies.
 */

// ---------------------------------------------------------------------------
// Minimal Markdown renderer
// ---------------------------------------------------------------------------
//
// Covers the shapes people and models actually write: **bold**,
// *italic*, ~~strike~~, `code`, fenced code blocks, headings, thematic
// breaks, > quotes, bullet / ordered lists, task items (`- [ ]`,
// `- [x]`), [link](url) tokens and bare http(s) URLs. WordPress has no
// built-in JS markdown parser and pulling in a library just for this
// would add ~40 kB, so we hand-roll the subset.
//
// Safety: every input passes through HTML escaping FIRST, then markdown
// tokens are re-interpreted into safe HTML. URLs are filtered to
// http/https only — no javascript:, data:, or vbscript: links reach
// the DOM. Result is safe to set as innerHTML. Inline tokens are
// applied per line, so a stray `*` can never pair up across lines, and
// code spans and link URLs are set aside before emphasis runs, so an
// underscore in a URL or an asterisk in `code` stays literal.
//
// Intentionally NOT supported (to keep it minimal):
//   - tables, images, nested lists (indentation is flattened)
//
// Those appear as literal text — harmless.

/** HTML-escape text for safe interpolation into innerHTML contexts. */
function escapeHtmlForMd( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

/**
 * Placeholder delimiter for spans set aside during inline rendering: a
 * private-use code point, which no keyboard types and no model emits,
 * so it never collides with content.
 */
const STASH = '\uE000';

/** Characters a bare URL must not end on (sentence punctuation). */
const URL_TRAILING_PUNCT = /[.,;:!?)\]'*_~]+$/;

/** Render `[label](url)` as an anchor, or just the label when unsafe. */
function linkHtml( label: string, url: string ): string {
	const href = url.trim();
	if ( ! /^https?:\/\//i.test( href ) ) {
		return label;
	}
	return `<a href="${ href }" target="_blank" rel="noopener noreferrer">${ label }</a>`;
}

/** Emphasis tokens on an already-escaped string with no links or code. */
function renderEmphasis( s: string ): string {
	return s
		// Bold **text** — run before italic so ** doesn't partially match *.
		.replace( /\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>' )
		// Italic *text* (single asterisk, word-boundary guarded).
		.replace( /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>' )
		// Italic _text_.
		.replace( /(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>' )
		// Strikethrough ~~text~~.
		.replace( /~~([^~\n]+?)~~/g, '<del>$1</del>' );
}

/** Apply inline markdown tokens to an already-escaped string. */
function renderInlineMd( s: string ): string {
	const stash: string[] = [];
	const keep = ( htmlFragment: string ): string => {
		stash.push( htmlFragment );
		return `${ STASH }${ stash.length - 1 }${ STASH }`;
	};

	const out = s
		// Inline code `snippet` first: nothing inside it is markdown.
		.replace( /`([^`\n]+?)`/g, ( _m, code: string ) => keep( `<code>${ code }</code>` ) )
		// Links [text](url). The label still gets emphasis; the URL
		// never does.
		.replace(
			/\[([^\]]+)\]\(([^)\s]+)\)/g,
			( _m, label: string, url: string ) => keep( linkHtml( renderEmphasis( label ), url ) ),
		)
		// Bare http(s) URLs. `&amp;` is the only entity a URL may carry
		// (a query string); any other escaped character ends it.
		.replace(
			/\bhttps?:\/\/(?:&amp;|[^\s<>&\uE000])+/gi,
			( match: string ) => {
				const trailing = URL_TRAILING_PUNCT.exec( match )?.[ 0 ] ?? '';
				const url = match.slice( 0, match.length - trailing.length );
				return keep( linkHtml( url, url ) ) + trailing;
			},
		);

	// A link's label can hold a code span, so a restored span can carry
	// another placeholder; each index is earlier than its container's.
	const placeholder = new RegExp( `${ STASH }(\\d+)${ STASH }`, 'g' );
	const restore = ( htmlFragment: string ): string =>
		htmlFragment.replace( placeholder, ( _m, index: string ) =>
			restore( stash[ Number( index ) ] ?? '' ),
		);
	return restore( renderEmphasis( out ) );
}

/** Options for {@link renderMarkdown}. */
export interface RenderMarkdownOptions {
	/**
	 * Render `- [ ]` / `- [x]` list items as `<os-checkbox>` task items
	 * instead of literal brackets. Each box carries the source line it
	 * came from as its `value` (0-based, split on `\n`), which is what
	 * {@link setTaskChecked} takes to write a toggle back. The caller
	 * must have `<os-checkbox>` registered.
	 */
	tasks?: {
		/** Paint the boxes read-only (someone else's note). */
		disabled?: boolean;
	};
}

/** A list item's text that is a task: `[ ] text` / `[x] text`. */
const TASK_ITEM = /^\[([ xX])\](?:\s+(.*))?$/;

/** A source line that is a task item, split around its mark. */
const TASK_LINE = /^(\s*(?:[-*+]|\d+\.)\s+\[)[ xX](\])/;

/**
 * Render a short markdown string to safe HTML.
 *
 * @param md      Raw markdown-ish text (an AI response, a note).
 * @param options See {@link RenderMarkdownOptions}.
 * @return HTML string, safe to set via innerHTML.
 */
export function renderMarkdown( md: string, options: RenderMarkdownOptions = {} ): string {
	if ( ! md ) {
		return '';
	}

	// Escape first so user / model text can't inject markup. Escaping
	// never adds or removes a newline, so line N here is line N of the
	// source — the task boxes depend on that.
	const safe = escapeHtmlForMd( md );

	// Line-stream state machine rather than blank-line block splitting:
	// model output routinely packs a heading, bullets, and prose into
	// one block with no blank lines between them.
	const out: string[] = [];
	let para: string[] = [];
	let quote: string[] = [];
	let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
	let code: string[] | null = null;

	const flushPara = () => {
		if ( para.length > 0 ) {
			// Single \n inside a paragraph becomes <br>.
			out.push( `<p>${ para.join( '<br>' ) }</p>` );
			para = [];
		}
	};
	const flushQuote = () => {
		if ( quote.length > 0 ) {
			out.push( `<blockquote><p>${ quote.join( '<br>' ) }</p></blockquote>` );
			quote = [];
		}
	};
	const flushList = () => {
		if ( list ) {
			out.push(
				`<${ list.tag }>${ list.items.join( '' ) }</${ list.tag }>`,
			);
			list = null;
		}
	};
	const flushBlocks = () => {
		flushPara();
		flushQuote();
		flushList();
	};
	const taskItem = ( content: string, lineIndex: number ): string | null => {
		if ( ! options.tasks ) {
			return null;
		}
		const task = TASK_ITEM.exec( content );
		if ( ! task ) {
			return null;
		}
		const checked = task[ 1 ] !== ' ' ? ' checked' : '';
		const disabled = options.tasks.disabled ? ' disabled' : '';
		// One wrapping span: the slotted label is a single flex item,
		// so its words and emphasis don't pick up the box's gap.
		return `<li class="os-md-task"><os-checkbox value="${ lineIndex }"${ checked }${ disabled }><span>${ renderInlineMd( task[ 2 ] ?? '' ) }</span></os-checkbox></li>`;
	};

	const lines = safe.split( /\n/ );
	for ( let index = 0; index < lines.length; index++ ) {
		const rawLine = lines[ index ];
		const line = rawLine.trim();

		// Fenced code: verbatim (already escaped) until the closing
		// fence, or to the end when it never closes.
		if ( code ) {
			if ( /^(`{3,}|~{3,})$/.test( line ) ) {
				out.push( `<pre><code>${ code.join( '\n' ) }</code></pre>` );
				code = null;
			} else {
				code.push( rawLine.replace( /\r$/, '' ) );
			}
			continue;
		}
		if ( /^(`{3,}|~{3,})/.test( line ) ) {
			flushBlocks();
			code = [];
			continue;
		}

		if ( line === '' ) {
			flushBlocks();
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec( line );
		if ( heading ) {
			flushBlocks();
			// Clamp to h3–h6 so a model's "# Title" can't out-shout
			// the window chrome it renders inside.
			const level = Math.min( 6, heading[ 1 ].length + 2 );
			out.push(
				`<h${ level }>${ renderInlineMd( heading[ 2 ] ) }</h${ level }>`,
			);
			continue;
		}

		// Thematic break (--- / *** / ___) → rule, not a literal.
		if ( /^(-{3,}|\*{3,}|_{3,})$/.test( line ) ) {
			flushBlocks();
			out.push( '<hr>' );
			continue;
		}

		// `>` arrived escaped.
		const quoteLine = /^&gt;\s?(.*)$/.exec( line );
		if ( quoteLine ) {
			flushPara();
			flushList();
			quote.push( renderInlineMd( quoteLine[ 1 ] ) );
			continue;
		}
		flushQuote();

		const ulItem = /^[-*+]\s+(.*)$/.exec( line );
		const olItem = /^\d+\.\s+(.*)$/.exec( line );
		if ( ulItem || olItem ) {
			flushPara();
			const tag = ulItem ? 'ul' : 'ol';
			if ( ! list || list.tag !== tag ) {
				flushList();
				list = { tag, items: [] };
			}
			const content = ( ulItem ?? olItem )![ 1 ];
			list.items.push(
				taskItem( content, index ) ?? `<li>${ renderInlineMd( content ) }</li>`,
			);
			continue;
		}

		flushList();
		para.push( renderInlineMd( line ) );
	}
	if ( code ) {
		out.push( `<pre><code>${ ( code as string[] ).join( '\n' ) }</code></pre>` );
	}
	flushBlocks();

	return out.join( '' );
}

/**
 * Write a task item's state back into the Markdown source.
 *
 * @param md        The source text.
 * @param lineIndex 0-based line, as carried by the rendered box.
 * @param checked   The state to write.
 * @return The new source, or `null` when that line is not a task item
 *         (the text changed underneath the rendered box).
 */
export function setTaskChecked( md: string, lineIndex: number, checked: boolean ): string | null {
	const lines = md.split( '\n' );
	const line = lines[ lineIndex ];
	if ( line === undefined || ! TASK_LINE.test( line ) ) {
		return null;
	}
	lines[ lineIndex ] = line.replace( TASK_LINE, `$1${ checked ? 'x' : ' ' }$2` );
	return lines.join( '\n' );
}
