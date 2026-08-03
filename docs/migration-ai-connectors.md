# Migration: AI Copilot moves to WordPress 7.0 Connectors

**Status:** shipped in 0.9.4. Affects plugins that integrated with the AI Copilot's provider or credential surface.

## What changed

The AI Copilot no longer ships its own provider or stores credentials. WordPress 7.0 owns both:

- **Credentials** live in **Settings → Connectors**. Configure a provider (OpenAI, Anthropic, Google, …) once there and every plugin — including this Copilot — uses it. The Copilot never handles an API key.
- **Generation** routes through the Core **AI Client** (`wp_ai_client_prompt()`), which injects the configured Connector credentials automatically and picks a suitable model.

The Copilot is available only on sites where the Connectors API, the Abilities API, and `wp_supports_ai()` are all present (WordPress 7.0+). On older WordPress the assistant is hidden; the rest of OpenStation is unaffected — **there is no minimum-version bump**.

## Removed — PHP

| Removed | Replacement |
|---|---|
| `open_station_register_ai_provider()` / `open_station_unregister_ai_provider()` | Configure providers in **Settings → Connectors**. Provider plugins register with the Core AI Client / Connectors. |
| `open_station_ai_register_providers` action, `open_station_ai_active_provider` / `open_station_ai_model` filters, `open_station_ai_provider_registered` action | — (no per-plugin provider registry) |
| The provider callable contract (`make_turn_input` / `agentic_call` / `structured_request`) and the `$api_key` argument | The Copilot builds `wp_ai_client_prompt()` internally. |
| Platform key option `desktop_mode_ai_platform` + `desktop-mode/v1/ai/platform-settings` REST route | Keys are stored + validated by Core in Settings → Connectors. |
| `open_station_ai_get_api_key()`, `open_station_ai_resolve_key_for_provider()`, `open_station_ai_get_platform_settings()`, `open_station_ai_get_providers*()` | New capability helpers: `open_station_ai_is_available()`, `open_station_ai_provider_configured()` (baseline text generation) and `open_station_ai_assistant_provider_configured()` (text generation + function calling). |

**Preserved:** the `/ai/search` loop's extensibility surface — `open_station_ai_{system_prompt,system_prompt_appendix,system_prompt_replace_capability,tools,tool_result,answer,request}` filters and the `open_station_ai_{search_started,tool_called,search_completed,search_error}` observability actions.

**Tools → Abilities (0.9.4):** the built-in Copilot tools are now [WordPress Abilities](https://developer.wordpress.org/apis/abilities-api/) (category `openstation`, listed at `GET /wp-abilities/v1/abilities`) and generation runs through the AI Client. `open_station_register_ai_tool()` and the `open_station_ai_tool_registered` action were **removed**. To give the assistant a server-dispatched tool, register a **read-only** ability with `wp_register_ability()` on `wp_abilities_api_init` — it's picked up automatically (see [`examples/ai-ask.md`](examples/ai-ask.md)). `open_station_ai_search_completed` now also carries `usage` + `model`.

## Removed — JavaScript

- The **OS Settings → AI** tab is gone. The per-user **AI assistant** toggle (opt-in, off by default; enable-able only once a provider is configured in Settings → Connectors) now lives in **OS Settings → Features**, alongside **Score new comments with AI**. There is no provider or model picker — provider + model selection is delegated entirely to the Core AI Client.
- `wp.os.getOsSettings().ai` shape change (**breaking**): now `{ enabled }` only. The `apiKey`, `transport`, `provider` and `model` fields were removed — credentials are Core's responsibility, progress streaming is on by default, and provider/model routing is the AI Client's.
- `openStationConfig.aiProviders` / `aiPlatformSettings` were removed; a new `openStationConfig.aiAssistant` (`{ available, providerConfigured, assistantProviderConfigured, enabled, connectorsUrl }`) drives assistant gating. Capability detection follows the [AI Client feature-detection guidance](https://make.wordpress.org/core/2026/03/24/introducing-the-ai-client-in-wordpress-7-0/#ai-feature-detection) and reports two gates: `providerConfigured` is the baseline `is_supported_for_text_generation()` probe (what comment scoring needs), and `assistantProviderConfigured` runs the same probe with a function declaration attached, so it only passes when a model supports text generation *and* function calling (what the agentic assistant needs). Both are no-network, deterministic checks.

## Stored data cleanup

On upgrade, a one-time migration deletes the `desktop_mode_ai_platform` option and strips the `apiKey` / `apiKeys` / legacy `provider` / `transport` fields from every user's stored OS settings, so no provider secret is left in the database.

## What you need to do

- **Site owners:** add a provider in **Settings → Connectors**. Until then the assistant opens with a setup prompt and comment scoring stays inert.
- **Plugin authors** who registered a custom provider: register it with the Core AI Client / Connectors instead.
- **Plugin authors** who registered a server-dispatched tool via `open_station_register_ai_tool()`: that function was removed. Register a **read-only** ability with `wp_register_ability()` on `wp_abilities_api_init` (with `input_schema`, `permission_callback`, `execute_callback`, and `meta.annotations.readonly = true`) — the assistant picks it up automatically. See [`examples/ai-ask.md`](examples/ai-ask.md).
