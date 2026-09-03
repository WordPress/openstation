/**
 * Posts app — the REST client for everything the list row and the
 * term canvases mutate on demand: tags and categories (search,
 * create, assign, rename, reparent, delete), the author and tag
 * filter options, and the term-count / co-occurrence routes the
 * canvases read.
 *
 * The list itself no longer lives here — it is the app's `data()`
 * (`parts/query.php`), refreshed by the framework on every dispatch.
 * Every call goes through the framework's `ctx.fetch`, so the nonce
 * rides along and the request is attributed to the window's spinner.
 *
 * @public
 */

import type {
	AuthorOption,
	CategoryTerm,
	TagOptionsPage,
	TagTerm,
	TermNeighbor,
	TermRow,
	TermsListPage,
	TermsListParams,
} from './types';

/** `ctx.fetch` — a relative path resolves against the REST root. */
export type RestFetch = ( path: string, init?: RequestInit ) => Promise< Response >;

interface RequestOptions extends RequestInit {
	/** Set to `false` to skip `response.json()` (a `DELETE` with no body). */
	expectJson?: boolean;
}

interface RequestResult< T > {
	data: T;
	headers: Headers;
}

export interface PostsRestClient {
	searchTags( query: string, signal?: AbortSignal ): Promise< TagTerm[] >;
	createTag( name: string ): Promise< TagTerm >;
	updatePostTags( postId: number, tagIds: number[] ): Promise< { id: number; tags: number[] } >;
	fetchAllCategories( signal?: AbortSignal ): Promise< CategoryTerm[] >;
	fetchAuthorOptions( signal?: AbortSignal ): Promise< AuthorOption[] >;
	fetchTagOptions( page?: number, perPage?: number, signal?: AbortSignal ): Promise< TagOptionsPage >;
	createCategory(
		name: string,
		parent?: number,
		opts?: { slug?: string; description?: string },
	): Promise< CategoryTerm >;
	updatePostCategories(
		postId: number,
		categoryIds: number[],
	): Promise< { id: number; categories: number[] } >;
	fetchTerms( taxonomy: 'categories' | 'tags', params?: TermsListParams ): Promise< TermsListPage >;
	fetchTagCooccurrence(
		taxonomy?: 'tags' | 'categories',
		limit?: number,
	): Promise< Map< number, TermNeighbor[] > >;
	updateTerm(
		taxonomy: 'categories' | 'tags',
		id: number,
		patch: Partial< Pick< TermRow, 'name' | 'slug' | 'description' | 'parent' > >,
	): Promise< TermRow >;
	deleteTerm( taxonomy: 'categories' | 'tags', id: number ): Promise< void >;
	/**
	 * The posts attached to one term — the satellite fan the canvases
	 * deploy around a focused node. `X-WP-Total` is the authoritative
	 * count (the same query the table runs).
	 */
	fetchTermPosts(
		param: 'categories' | 'tags',
		termId: number,
		page: number,
		perPage: number,
	): Promise< { items: Array< { id: number; title: string } >; totalPages: number; total: number } >;
	/** `{ term_id: count }` for a batch of ids — `/desktop-mode/v1/term-counts`. */
	fetchTermCounts( taxonomy: 'category' | 'post_tag', ids: number[] ): Promise< Record< string, number > >;
}

/**
 * Notify other parts of the shell that a term was created, updated
 * or deleted. Subscribers (the post-row category picker caches the
 * full tree per window-open) clear their caches so they pick up the
 * change without an F5.
 *
 * Channel: `os.term.changed`. Payload:
 * `{ source: 'posts-window', taxonomy: 'category' | 'post_tag', action, id }`.
 */
function broadcastTermChange(
	taxonomy: 'category' | 'post_tag',
	action: 'created' | 'updated' | 'deleted',
	id: number,
): void {
	const api = window.wp?.os;
	if ( api && typeof api.broadcast === 'function' ) {
		api.broadcast( 'os.term.changed', { source: 'posts-window', taxonomy, action, id } );
	}
}

function qs( params: Record< string, string | number | undefined > ): string {
	const search = new URLSearchParams();
	for ( const [ key, value ] of Object.entries( params ) ) {
		if ( value !== undefined && value !== '' ) {
			search.set( key, String( value ) );
		}
	}
	const out = search.toString();
	return out ? `?${ out }` : '';
}

/**
 * Build the client over the framework's fetch. A REST error surfaces
 * the `WP_Error` message (not the bare status line) so a toast can
 * say what the server actually complained about.
 */
export function createPostsRestClient( restFetch: RestFetch ): PostsRestClient {
	const request = async < T >( path: string, init: RequestOptions = {} ): Promise< RequestResult< T > > => {
		const response = await restFetch( path, {
			...init,
			headers: {
				...( init.body ? { 'Content-Type': 'application/json' } : {} ),
				...( init.headers ?? {} ),
			},
		} );
		if ( ! response.ok ) {
			let message = `${ response.status } ${ response.statusText }`;
			try {
				const json = ( await response.json() ) as { message?: string };
				if ( json && typeof json.message === 'string' ) {
					message = json.message;
				}
			} catch {
				// Non-JSON body: the status line will do.
			}
			throw new Error( message );
		}
		const data = init.expectJson === false ? ( null as unknown as T ) : ( ( await response.json() ) as T );
		return { data, headers: response.headers };
	};

	const searchTags = async ( q: string, signal?: AbortSignal ): Promise< TagTerm[] > => {
		const params: Record< string, string | number > = {
			per_page: 20,
			_fields: 'id,name,slug,count',
			orderby: 'count',
			order: 'desc',
		};
		if ( q ) {
			params.search = q;
			params.orderby = 'name';
			params.order = 'asc';
		}
		const { data } = await request< TagTerm[] >( `wp/v2/tags${ qs( params ) }`, { method: 'GET', signal } );
		return Array.isArray( data ) ? data : [];
	};

	const fetchAllCategories = async ( signal?: AbortSignal ): Promise< CategoryTerm[] > => {
		const { data } = await request< CategoryTerm[] >(
			`wp/v2/categories${ qs( { per_page: 100, _fields: 'id,name,slug,parent', orderby: 'name', order: 'asc' } ) }`,
			{ method: 'GET', signal },
		);
		return Array.isArray( data ) ? data : [];
	};

	const termRow = ( t: Partial< TermRow >, fallbackId = 0 ): TermRow => {
		// Prefer the any-status count (drafts + pending included) when
		// the server emits it; fall back to core's `count`.
		const anyCount = ( t as { openstation_count?: number } ).openstation_count;
		return {
			id: ( t.id as number ) ?? fallbackId,
			name: ( t.name as string ) ?? '',
			slug: ( t.slug as string ) ?? '',
			parent: ( t.parent as number ) ?? 0,
			count: typeof anyCount === 'number' ? anyCount : ( ( t.count as number ) ?? 0 ),
			description: ( t.description as string ) ?? '',
			isDefault: ( t as { openstation_is_default?: boolean } ).openstation_is_default === true,
		};
	};

	return {
		searchTags,
		fetchAllCategories,

		async createTag( name ) {
			try {
				const { data } = await request< TagTerm >( 'wp/v2/tags', {
					method: 'POST',
					body: JSON.stringify( { name } ),
				} );
				broadcastTermChange( 'post_tag', 'created', data.id );
				return data;
			} catch ( err ) {
				// Core answers `term_exists` with the existing id — recover
				// by finding that term and returning it as the "created" one.
				const message = err instanceof Error ? err.message : String( err );
				if ( /term[\s_]?exists/i.test( message ) ) {
					const exact = ( await searchTags( name ) ).find(
						( t ) => t.name.toLowerCase() === name.toLowerCase(),
					);
					if ( exact ) {
						return exact;
					}
				}
				throw err;
			}
		},

		async updatePostTags( postId, tagIds ) {
			const { data } = await request< { id: number; tags: number[] } >( `wp/v2/posts/${ postId }`, {
				method: 'POST',
				body: JSON.stringify( { tags: tagIds } ),
			} );
			return data;
		},

		async fetchAuthorOptions( signal ) {
			try {
				const { data } = await request< AuthorOption[] >(
					`wp/v2/users${ qs( { per_page: 100, who: 'authors', _fields: 'id,name', orderby: 'name', order: 'asc' } ) }`,
					{ method: 'GET', signal },
				);
				return Array.isArray( data ) ? data : [];
			} catch {
				// A capability-gated 401/403 means "no filter dropdown",
				// never a dead table.
				return [];
			}
		},

		async fetchTagOptions( page = 1, perPage = 50, signal ) {
			try {
				const { data, headers } = await request< TagOptionsPage[ 'items' ] >(
					`wp/v2/tags${ qs( {
						per_page: Math.max( 1, perPage ),
						page: Math.max( 1, page ),
						_fields: 'id,name,count',
						orderby: 'count',
						order: 'desc',
					} ) }`,
					{ method: 'GET', signal },
				);
				return {
					items: Array.isArray( data ) ? data : [],
					totalPages: parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
				};
			} catch {
				return { items: [], totalPages: 0 };
			}
		},

		async createCategory( name, parent = 0, opts = {} ) {
			const body: Record< string, unknown > = { name, parent };
			if ( opts.slug ) {
				body.slug = opts.slug;
			}
			if ( opts.description ) {
				body.description = opts.description;
			}
			try {
				const { data } = await request< CategoryTerm >( 'wp/v2/categories', {
					method: 'POST',
					body: JSON.stringify( body ),
				} );
				broadcastTermChange( 'category', 'created', data.id );
				return data;
			} catch ( err ) {
				const message = err instanceof Error ? err.message : String( err );
				if ( /term[\s_]?exists/i.test( message ) ) {
					const exact = ( await fetchAllCategories() ).find(
						( t ) => t.name.toLowerCase() === name.toLowerCase() && t.parent === parent,
					);
					if ( exact ) {
						return exact;
					}
				}
				throw err;
			}
		},

		async updatePostCategories( postId, categoryIds ) {
			const { data } = await request< { id: number; categories: number[] } >( `wp/v2/posts/${ postId }`, {
				method: 'POST',
				body: JSON.stringify( { categories: categoryIds } ),
			} );
			return data;
		},

		async fetchTerms( taxonomy, params = {} ) {
			const { data, headers } = await request< Array< Partial< TermRow > > >(
				`wp/v2/${ taxonomy }${ qs( {
					per_page: params.perPage ?? 50,
					page: params.page ?? 1,
					_fields: 'id,name,slug,parent,count,description,openstation_count,openstation_is_default',
					orderby: params.orderby ?? 'name',
					order: params.order ?? 'asc',
					search: params.search,
					parent: typeof params.parent === 'number' && params.parent >= 0 ? params.parent : undefined,
				} ) }`,
				{ method: 'GET' },
			);
			return {
				items: Array.isArray( data ) ? data.map( ( t ) => termRow( t ) ) : [],
				total: parseInt( headers.get( 'X-WP-Total' ) ?? '0', 10 ) || 0,
				totalPages: parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
			};
		},

		async fetchTagCooccurrence( taxonomy = 'tags', limit = 8 ) {
			const { data } = await request< { pairs?: Record< string, TermNeighbor[] > } | TermNeighbor[] >(
				// The server speaks WP taxonomy slugs, not the wp/v2 plural.
				`desktop-mode/v1/tag-cooccurrence${ qs( { taxonomy: taxonomy === 'tags' ? 'post_tag' : 'category', limit } ) }`,
				{ method: 'GET' },
			);
			const out = new Map< number, TermNeighbor[] >();
			const pairs = data && typeof data === 'object' && ! Array.isArray( data ) ? data.pairs : undefined;
			if ( ! pairs ) {
				return out;
			}
			for ( const [ key, neighbors ] of Object.entries( pairs ) ) {
				const id = parseInt( key, 10 );
				if ( ! Number.isFinite( id ) || id <= 0 ) {
					continue;
				}
				const clean: TermNeighbor[] = [];
				for ( const raw of neighbors ) {
					const nid = Number( raw?.id );
					const sh = Number( raw?.shared );
					if ( Number.isFinite( nid ) && nid > 0 && Number.isFinite( sh ) && sh > 0 ) {
						clean.push( { id: nid, shared: sh } );
					}
				}
				if ( clean.length > 0 ) {
					out.set( id, clean );
				}
			}
			return out;
		},

		async updateTerm( taxonomy, id, patch ) {
			const { data } = await request< Partial< TermRow > >( `wp/v2/${ taxonomy }/${ id }`, {
				method: 'POST',
				body: JSON.stringify( patch ),
			} );
			broadcastTermChange( taxonomy === 'categories' ? 'category' : 'post_tag', 'updated', id );
			return {
				id: data.id ?? id,
				name: data.name ?? '',
				slug: data.slug ?? '',
				parent: data.parent ?? 0,
				count: data.count ?? 0,
				description: data.description ?? '',
				isDefault: ( data.isDefault as boolean | undefined ) ?? false,
			};
		},

		async deleteTerm( taxonomy, id ) {
			await request( `wp/v2/${ taxonomy }/${ id }?force=true`, { method: 'DELETE' } );
			broadcastTermChange( taxonomy === 'categories' ? 'category' : 'post_tag', 'deleted', id );
		},

		async fetchTermPosts( param, termId, page, perPage ) {
			const { data, headers } = await request< Array< { id: number; title?: { rendered?: string } } > >(
				`wp/v2/posts${ qs( { [ param ]: termId, per_page: perPage, page, status: 'any', _fields: 'id,title,status' } ) }`,
				{ method: 'GET' },
			);
			const totalParsed = parseInt( headers.get( 'X-WP-Total' ) ?? '', 10 );
			return {
				items: ( Array.isArray( data ) ? data : [] ).map( ( p ) => ( {
					id: p.id,
					title: p.title?.rendered || `#${ p.id }`,
				} ) ),
				totalPages: Math.max( 1, parseInt( headers.get( 'X-WP-TotalPages' ) ?? '1', 10 ) || 1 ),
				total: Number.isFinite( totalParsed ) ? totalParsed : -1,
			};
		},

		async fetchTermCounts( taxonomy, ids ) {
			const { data } = await request< Record< string, number > >(
				`desktop-mode/v1/term-counts${ qs( { taxonomy, ids: ids.join( ',' ) } ) }`,
				{ method: 'GET' },
			);
			return data && typeof data === 'object' ? data : {};
		},
	};
}
