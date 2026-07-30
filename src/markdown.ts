/**
 * Desktop Mode — minimal shared Markdown renderer.
 *
 * Extracted from the AI assistant so every conversation surface (the
 * assistant overlay, the Agent chat window) formats model output the
 * same way. Pure string → safe-HTML; no dependencies.
 */

// ---------------------------------------------------------------------------
// Minimal Markdown renderer
// ---------------------------------------------------------------------------
//
// AI responses arrive with basic markdown — **bold**, *italic*, `code`,
// headings, thematic breaks, bullet / ordered lists, and [link](url)
// tokens. WordPress has no built-in JS markdown parser and pulling in
// a library just for this would add ~40 kB, so we hand-roll a minimal
// subset that covers the shapes the agent actually emits.
//
// Safety: every input passes through HTML escaping FIRST, then markdown
// tokens are re-interpreted into safe HTML. URLs are filtered to
// http/https only — no javascript:, data:, or vbscript: links reach
// the DOM. Result is safe to set as innerHTML. Inline tokens are
// applied per line, so a stray `*` can never pair up across lines.
//
// Intentionally NOT supported (to keep it minimal):
//   - fenced code blocks (```)
//   - tables, blockquotes, images, nested lists
//
// If the agent produces any of those they'll appear as literal text —
// harmless. The system prompt steers toward short, conversational
// responses where these don't typically appear.

/** HTML-escape text for safe interpolation into innerHTML contexts. */
function escapeHtmlForMd( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

/** Apply inline markdown tokens to an already-escaped string. */
function renderInlineMd( s: string ): string {
	return s
		// Links [text](url) — must run first so URLs don't get
		// interpreted as other tokens. Reject non-http(s) schemes.
		.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			( _m, label: string, url: string ) => {
				if ( ! /^https?:\/\//i.test( url.trim() ) ) {
					return label;
				}
				return `<a href="${ url.trim() }" target="_blank" rel="noopener noreferrer">${ label }</a>`;
			},
		)
		// Bold **text** — run before italic so ** doesn't partially match *.
		.replace( /\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>' )
		// Italic *text* (single asterisk, word-boundary guarded).
		.replace( /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>' )
		// Italic _text_.
		.replace( /(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>' )
		// Inline code `snippet`.
		.replace( /`([^`\n]+?)`/g, '<code>$1</code>' );
}

/**
 * Render a short markdown string to safe HTML.
 *
 * @param md Raw markdown-ish text (typically an AI response).
 * @return HTML string, safe to set via innerHTML.
 */
export function renderMarkdown( md: string ): string {
	if ( ! md ) {
		return '';
	}

	// Escape first so user / model text can't inject markup.
	const safe = escapeHtmlForMd( md );

	// Line-stream state machine rather than blank-line block splitting:
	// model output routinely packs a heading, bullets, and prose into
	// one block with no blank lines between them.
	const out: string[] = [];
	let para: string[] = [];
	let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

	const flushPara = () => {
		if ( para.length > 0 ) {
			// Single \n inside a paragraph becomes <br>.
			out.push( `<p>${ para.join( '<br>' ) }</p>` );
			para = [];
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

	for ( const rawLine of safe.split( /\n/ ) ) {
		const line = rawLine.trim();
		if ( line === '' ) {
			flushPara();
			flushList();
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec( line );
		if ( heading ) {
			flushPara();
			flushList();
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
			flushPara();
			flushList();
			out.push( '<hr>' );
			continue;
		}

		const ulItem = /^[-*]\s+(.*)$/.exec( line );
		const olItem = /^\d+\.\s+(.*)$/.exec( line );
		if ( ulItem || olItem ) {
			flushPara();
			const tag = ulItem ? 'ul' : 'ol';
			if ( ! list || list.tag !== tag ) {
				flushList();
				list = { tag, items: [] };
			}
			list.items.push(
				`<li>${ renderInlineMd( ( ulItem ?? olItem )![ 1 ] ) }</li>`,
			);
			continue;
		}

		flushList();
		para.push( renderInlineMd( line ) );
	}
	flushPara();
	flushList();

	return out.join( '' );
}
