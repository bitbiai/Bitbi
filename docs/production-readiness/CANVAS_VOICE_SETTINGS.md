# Canvas Voice configuration contract

Observed provider documentation: **2026-10-27**. This is a configuration and
integration matrix, not a live-provider acceptance report. `grok-voice-3.0` is
pinned independently of the existing text-assistant model. Account eligibility,
credentials, tariffs and a paid-test allowance require separate evidence.

Sources: [speech-to-speech guide][guide], [Realtime API][api],
[machine-readable Realtime schema][schema], [ephemeral tokens][tokens],
[prompting guide][prompt], [Voice pricing][pricing], [billing semantics][billing].
Private copies, observation timestamps and hashes remain outside the repository.

## Integration boundaries

`js/shared/canvas-voice-settings.mjs` contains public preference validation and
bilingual field descriptors. It contains no Canvas system prompt, credentials,
external service URLs, collection identifiers or function definitions.
`canvasVoiceSettings()` rejects unknown fields, normalizes defaults and never
grants execution authority. `assertCanvasVoiceSettingsCapabilities()` additionally
checks **server-derived** voices, codecs, tools and resource allowances. Neither
function replaces session admission, ownership, revision or spending checks.

The normalized, versioned object is stored per owned project in
`canvas_voice_settings`, through the existing authenticated Canvas router.
Do not put it in creative graph data or reuse the
text-assistant model preference. Saving is not microphone or provider admission.
All changed settings request a controlled session restart in this product
contract. Until restart succeeds, display the previous active configuration.
The provider's ability to update some fields in place is documented below;
it is not a claim that a saved preference is already active.

API defaults below are only those explicitly stated by the cited sources.
“Unspecified” must not be turned into an assumed API default. Limits labelled
“product” are bounded application-input limits, not claimed provider limits.

## Settings matrix

All rows are persisted presentation settings unless marked server-owned or
protocol-only. Every editable row has EN/DE labels in `CANVAS_VOICE_SETTING_FIELDS`.
Current pure checks: `node --test tests/canvas-voice-settings.test.mjs`.
Provider application, durable persistence, audio and UI checks are separate
required caller evidence; the pure tests do not establish those outcomes.

| Public field / native path | Type, allowed values and dependencies | API default → product default | UI / authority / update and test |
| --- | --- | --- | --- |
| `model` / handshake `model`, `session.model` | Pinned string `grok-voice-3.0`; 2.0 deprecated; no alias fallback | latest → 3.0 | Read-only Voice model; server pins; reconnect; defaults/rejection test |
| `voice` / `session.voice` | Built-in ID from authorized inventory or approved custom voice ID | Unspecified → eve | Voice picker; server catalog membership; session update supported, product restart; custom/foreign-ID tests |
| `preferences.language` / compiled instructions | Listed language or auto; output-language preference, not native audio language field | Auto-detection → auto | Voice/language; user preference below Canvas policy; preference test |
| `preferences.tone`, `.instructions` / compiled `session.instructions` | Text, product 300 / 2000 characters | Unspecified → empty | Behaviour; user text remains untrusted preference, cannot replace role or authorize actions; unknown top-level instructions rejected |
| `reasoning.effort` / handshake and session | high or none | high → high | Behaviour; unchanged account access/spending guards; enum test |
| `turn_detection.type` / same session path | server_vad or JSON null; manual commit requires null | server_vad per billing guide → server_vad | Behaviour; automatic versus manual turn controls; null/string-null negative test |
| `turn_detection.idle_timeout_ms` | Integer or null; server_vad only; product 1,000–300,000 ms; native numeric range unspecified | null → null | Optional proactive question; **not** session expiry; type/dependency tests |
| `resumption.enabled` | Boolean; reconnect uses server-owned conversation ID; provider retains replayable history 30 minutes inactive | false → false | Behaviour with data-use notice; separate server allowance; no client-selected conversation ID; denied opt-in test |
| `audio.input.format.type`, `audio.output.format.type` | audio/pcm, audio/pcmu, audio/pcma, audio/opus; independent directions | PCM → PCM | Advanced; enable only verified encoder/decoder/browser combinations; unsupported-codec countercheck |
| `audio.*.format.rate` | PCM: 8,000 / 16,000 / 22,050 / 24,000 / 32,000 / 44,100 / 48,000 Hz; G.711 fixed 8,000; Opus fixed 24,000 mono | PCM24,000 → PCM24,000 | Advanced; dependencies enforced; all rates plus invalid G.711/Opus-rate tests; 11,025 remains a documented conflict below |
| `audio.input.transport`, `audio.output.transport` | json (base64) or binary (raw bytes); each raw Opus payload is exactly one packet | json → json | Advanced; byte-level codec tests still required; provider input accepts both paths, output changes only next response boundary |
| `audio.input.transcription.model` | grok-transcribe for cumulative live captions; not standalone STT model selection | Unspecified → grok-transcribe | Read-only, live proof required; reference/event documentation supports value but schema omits it; unknown model test |
| `audio.input.transcription.language_hint` | Listed BCP-47 code; product auto means omit native hint; bare es/pt invalid | Auto-detection → auto | Voice/language; provider supports live updates; language negative tests |
| `audio.input.transcription.keyterms` | At most100 strings,50 characters each | Unspecified → empty | Voice/language list; provider supports live updates; length tests |
| `audio.output.speed` | Number0.7–1.5 | 1.0 →1.0 | Voice slider/input; adapter must send native setting, not alter browser playback rate; bounds test |
| `replace` / `session.replace` | Phrase→spoken replacement map; null clears; product100 entries,100/128 characters | Unspecified → empty | Voice map editor; audio only, transcript unchanged; matching whole-word/case-insensitive; live update acknowledged; malformed map tests |
| `response.modalities` / `response.create.response.modalities` | Nonempty unique array of text and/or audio | Unspecified → both | Advanced; affects manually created responses, not a fictitious session-modalities setting; adapter/automatic-VAD semantics must be verified |
| `response.instructions` / compiled per-response instructions | Product1000-character communication preference | Unspecified → empty | Advanced; native override replaces whole session prompt, so server must rebuild complete canonical instructions plus preference; never forward user string alone |
| `browser.echoCancellation`, `.noiseSuppression`, `.autoGainControl` | Booleans; browser capture constraints, not xAI fields | Browser-dependent → requested true | Advanced; report effective device support; no silent claim device honored constraint; structural validation |
| `tools.canvas.enabled` / approved function definitions | Boolean; definitions/name/description/JSON schema come from server | Unspecified →false | Tools; scoped Canvas functions only after server permission; no arbitrary function JSON; policy/admission tests |
| `tools.web_search.enabled` | Boolean; native web_search | Unspecified →false | Tools; permission and external-tool spending evidence required; denied by default |
| `tools.web_search.allowed_domains`, `.excluded_domains` | Max5 domain strings each, mutually exclusive; no URL/path | Unspecified →empty | Tools filters; case-normalized duplicates rejected; positive/broken tests |
| `tools.web_search.location.{country,city,region,timezone}` | Strings; product100 chars; timezone IANA | Unspecified →empty | Tools location; never infer private user location; native location alias user_location exists but single public spelling |
| `tools.web_search.enable_image_understanding` | Boolean | Unspecified →false | Tools; potential extra processing/cost; allowed only with tool admission |
| `tools.x_search.enabled` | Boolean | Unspecified →false | Tools; permission and external-tool spending evidence required |
| `tools.x_search.allowed_x_handles`, `.excluded_x_handles` | Max20 names, no@, mutually exclusive; product15 chars/name | Unspecified →empty | Tools filters; bounds/exclusive counterchecks |
| `tools.x_search.from_date`, `.to_date` | Valid ISO date; from≤to | Unspecified →empty | Tools date controls; invalid calendar/inverted-range tests |
| `tools.x_search.enable_image_understanding`, `.enable_video_understanding` | Booleans | Unspecified →false | Tools; processing/cost authorization remains independent |
| `tools.file_search.enabled`, `.resourceIds`, `.max_num_results` | Approved opaque IDs mapped server-side to native vector_store_ids; product20 sources /1–100 results | Unspecified →false /empty /10 | Tools catalog; browser cannot submit collection IDs; foreign/empty resources denied |
| `tools.mcp.enabled`, `.servers[]` | Product8 approved server selections; each resourceId and explicit allowed_tools subset (product50 names) | Unspecified →false /empty | Tools catalog; no unrestricted all-tools default; denied foreign resources/tool names |
| MCP native `server_url`, `server_label`, `server_description`, `authorization`, `headers` | StreamingHTTP/SSE; label has no dot; optional credentials/header configuration | Unspecified | Server-provisioned resource only; no URL/credential entry in member JSON; owner provisioning requires existing protected administration; arbitrary browser values rejected |

## Protocol-only fields and non-applicable APIs

- Authentication is server-side Bearer or a short-lived client token. Token expiry
  (default600s, maximum3600s) is neither maximum call duration nor a spending cap.
  Browser possession does not establish immutable server policy. The source
  discrepancy about initial token-bound configuration is unresolved below.
- `conversation_id`, event/item/response/call IDs, ordering IDs and response
  metadata are correlation/transport state, never arbitrary settings. Response
  metadata supports16 pairs with64-character keys and512-character values; use
  only server-generated safe identifiers.
- `response.cancel` and `conversation.item.truncate` are lifecycle operations.
  Truncate requires the assistant item, content index and actually played
  `audio_end_ms`; the acknowledged truncated transcript replaces displayed text.
- `force_message` produces a scripted synthesized turn, with optional
  interruptible flag (default true). It is not model-authored dialogue. No
  arbitrary scripted-output UI or new authority follows from this API feature;
  a future application-owned announcement must preserve that provenance and cost.
- Custom-voice creation/deletion, phone-number management, SIP call_id/DTMF,
  transfer/hangup, collections management and provider credentials are resource
  administration, not Canvas conversation preferences. No such resource is
  created or activated by this integration.
- Standalone TTS/STT fields (MP3, WAV output containers, diarization, smart-turn
  thresholds, temperature, standalone transcription models) are not imported.
  Their existence in another endpoint does not prove Realtime support.

## Custom voice account boundary

The [official custom-voice guide][custom-voices], observed 2026-10-27, limits
availability to the United States excluding Illinois. Authorization for Bitbi's
German operating context has not been established. Built-in voices therefore
remain available while no custom voice is claimed as account-authorized.
Existing custom IDs use the same Realtime `session.voice` field and require
server-owned catalog membership; they are not unsupported by the protocol.
Team-owned IDs must be verified through `GET /v1/custom-voices` or
`GET /v1/custom-voices/{voice_id}`, not the built-in TTS voice list. Creation via
`POST /v1/custom-voices` requires Enterprise API access. Creation, deletion and
reference-audio management are separate resource administration, not additional
Canvas session settings. No resource API was called or account permission changed.
The bilingual voice-picker notice exposes this account/region restriction.

## Known documentation conflicts and required live proof

1. The [ephemeral guide][tokens] says token creation does not support `session`;
   the [REST reference][api] lists optional model/reasoning session configuration.
   Neither establishes locked tool/policy/budget constraints. Do not rely on that
   binding as a production authorization boundary.
2. The JSON schema lists PCM11,025Hz; the guide's explicit rate table omits it.
   The public contract deliberately exposes the common documented rates. 11,025
   remains **unconfirmed**, not “unsupported by xAI”.
3. Input transcription event docs require model=grok-transcribe, while the session
   properties omit model. The supplied reference sends it. Treat final live
   streaming-caption proof as required; never substitute the standalone STT model.
4. Function definitions appear flat in guide examples and nested under function
   in the schema. The eventual adapter shape needs provider acceptance evidence;
   a permissive synthetic provider cannot resolve the disagreement.
5. The model page and generic speech billing page name different regions.
   Account/route evidence must establish actual processing geography; neither is
   a basis for claiming EU-only processing.
6. Some markdown exports omit dynamically rendered prices/limits. Observed HTML
   pricing states $0.08/minute and $0.004/text input; billing prose distinguishes
   server_vad session-duration billing from manual sent/received-audio billing.
   Seeded user/assistant text items are chargeable; tool outputs are exempt.
   `response.done` token counters are not authoritative billable seconds.

These are documentation observations, not successful calls. No paid call was
made for this matrix. Customer tariffs and allowance cannot be inferred from
upstream prices. External provider tools have separate charges and no documented
Realtime maximum-tool-call budget field; keep them unavailable until enforceable
admission and a reviewed cost allowance exist.

## Reference material and acceptance boundaries

The supplied Markdown reference pins3.0, captures PCM24kHz, prefers AudioWorklet,
has a ScriptProcessor fallback and handles cumulative transcription by replacing
the current text. Its idle-timeout handler ends the session, its quota is a
read/write KV counter and its countdown is browser-owned. Those choices are test
implementation details, not safe product admission or correct native idle
semantics. Its per-chunk stateless resampling also needs independent device-rate
and long-stream validation. The reference was read only, never executed, edited,
deployed or used for a test conversation. Its private source hash is retained
outside public assets.

Pure tests cover strict input rejection, safe defaults, null/manual turns,
codec/rate dependencies, language/speed/phrase boundaries, search filters and
dates, resource/permission/spending denial, controlled restart and complete
EN/DE descriptor coverage. They must be followed by actual settings persistence,
session mapping, codec/audio, native worker and browser callers. Live xAI model,
tool shape, captions, audio and cost evidence remains a distinct acceptance item.

[guide]: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
[api]: https://docs.x.ai/developers/rest-api-reference/inference/voice
[schema]: https://docs.x.ai/voice-realtime.ws.json
[tokens]: https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
[prompt]: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/prompting-guide
[pricing]: https://docs.x.ai/developers/pricing
[billing]: https://docs.x.ai/developers/models/speech-to-speech
[custom-voices]: https://docs.x.ai/developers/model-capabilities/audio/custom-voices

## Implementation status and remaining release boundary

The integration was published through protected run `40582236705`; live speech
acceptance remains incomplete. The authenticated quote/admission routes use the
existing member usage reservation and credit ledger. The owner approved the
existing 20% margin calculation for each started ten-second unit within the
conversation allowance. The provider price is $0.08/minute; the current shared
FX/net-credit conversion produces 9 credits per unit. Quotes pin those inputs,
settings, project/brief/conversation revisions and the maximum duration. No
client-supplied price or new wallet is accepted.

Automatic VAD measures server-observed session time; manual turn mode measures
input plus output audio samples. The maximum reservation covers both directions
in manual mode. Persisted accrued units settle as one idempotent debit when the
server establishes completion; unused reservation is released. An uncertain
provider outcome retains its original identity and commitment. No automatic
reconnection creates a replacement paid call. Text/Voice/production admission
uses shared authoritative commitments; viewing Settings grants no allowance.

A dedicated instance of the existing Auth Durable Object namespace owns the
provider connection, deadlines, checkpoints and shutdown. Dispatch intent is
persisted before the provider connection. Atomic SQL guards enforce wallet,
conversation/project limits and one active session per user. Native provider
acceptance, closure evidence and customer settlement are separate facts; local
metering is not a claim of equality with a future supplier invoice.

Bitbi's `XAI_API_KEY` is an existing encrypted Auth Worker binding, approved by
the owner. Local tests use synthetic credentials only. Keep this secret during
protected deployment; never retrieve/export its value. `CANVAS_VOICE_ENABLED`
is the reviewed activation/kill gate. Paid acceptance has a separately recorded
owner-authorized ceiling; it is not a customer tariff or global free quota.
Model eligibility, actual session acknowledgements, audio/tool protocol and
active deployments still require live evidence after protected publication.

Custom voices and external search/collections/MCP have validated settings and
payload builders, but no approved account resource or bounded external-tool
cost contract is installed. They remain unavailable with explicit reasons, not
claimed to be unsupported by xAI. Official custom-voice documentation currently
restricts availability to the US except Illinois; an API key is not proof of
eligibility or a grant to bypass that restriction. PCM, G.711 and raw Opus are
implemented; the browser additionally checks its actual encoder/decoder support
before admission. Synthetic Chromium/WebKit codec evidence is distinct from the
live provider's framing and account compatibility.

Provider history resumption is opt-in and disabled by default. The server pins
only its own captured conversation ID from a finalized, same-owner/project
session within the documented 30-minute inactivity window. Resuming requires a
new quote, explicit consent and reservation; it never reuses an unknown paid
operation. Historical item replays cannot become new creative actions. No
provider conversation identifier is accepted from or returned to the browser.

### Architecture and safety

The browser uses `voice.js` and one existing conversation observer, not a second
chat instance. Microphone capture starts only after an explicit action. Native
dialog settings, browser audio constraints and xAI options are distinct. The
AudioWorklet pipeline keeps resampling phase across chunks, validates raw Opus
packets and bounds capture/playback queues. Manual commit flushes the final
worklet/resampler/encoder samples before committing a turn. Stop fences pending
microphone/admission/connection promises and releases nodes, tracks and sockets.

`canvas-voice-relay.js` accepts a small browser command vocabulary. The server
builds policy, model, tool definitions and upstream messages. Browser-supplied
session updates, external destinations and spending authority are never
forwarded. A direct browser-to-xAI token cannot establish the required immutable
policy and metering boundaries, so it is not the selected production design.
The socket GET separately requires the exact origin and WebSocket upgrade;
ordinary POST-only CSRF protection is insufficient for a WebSocket handshake.

`canvas-voice-conversation.js` reuses canonical brief/context/capabilities and
ordinary conversation rows. `canvas-voice-tools.js` binds the authenticated
session and source turn outside model arguments. The three narrow functions
read context, propose validated brief changes and describe the existing next
decision. None can start production or authorize spending. Revision guards and
stable provider item/call IDs protect manual edits and duplicate delivery.
Voice transcripts never go through the text assistant's paid `/messages` path.
The text model preference and all accepted production receipts remain separate.

Cumulative transcription replaces the interim value. Late response IDs stay
associated with their original source turn. Interruption preserves original
generated text as evidence and stores the provider-confirmed retained prefix
separately. Unknown audible content is an application-attributed interruption
note, never a fabricated Grok answer. Playback counters are not proof of hearing.

No raw audio, provider key or external resource credential is persisted in the
Voice tables. Transcripts remain private canonical project conversations; Voice
settings and session projections follow ownership and project deletion. This
does not claim a new retention period or a completed provider agreement. The
pre-start UI identifies xAI transmission; before activation, include the actual
approved direct route and retention facts in the existing disclosure inventory.

### Checks and release/recovery

Focused executable callers are `tests/q2-canvas-voice-contract.spec.js`,
`tests/q2-canvas-voice-conversation.spec.js`, `tests/q2-canvas-voice-accounting.spec.js`, the `canvas-voice` suite in
`scripts/test-q2-runtime.mjs`, and the Voice cases registered by
`tests/helpers/canvas-voice-browser.cjs` in `tests/canvas.spec.js`. They cover
synthetic provider/audio behavior, native D1 migration/persistence, the real
Auth fetch route and canonical tools. Existing conversation/provider and Canvas
layout cases remain independent regression controls. Native macOS workerd is
not Linux release evidence; synthetic capture is not a physical microphone or
live xAI conversation. Private logs retain earlier failures and later fixes.
Short windows keep a bounded, independently scrollable Voice track. The existing
budget, immediate-approval and viewport cases protect transcript height and real
click targets; the active Voice fixture also exercises long interim text, Mute,
Stop and the retained composer in Chromium and WebKit.

The native owner fixtures cover normal PCM audio and canonical brief application,
Stop during pending dispatch, missing/late close acknowledgement, concurrent text,
partial transcript projection, successor isolation and opt-in resumption. Timer
cleanup uses receiver-independent wrappers: workerd rejected a borrowed timer
function invoked as a relay method. A cleanup failure must not prevent socket
closure or settlement. Terminal usage replay repairs a missing session projection
without another debit; the native lost-acknowledgement cases exercise that boundary.

The first live handshake at `de87714e` was rejected before audio, with its
reservation released and no debit. The generic code discarded the observed HTTP
status, so the cause of that historical rejection remains unknown. Non-101 HTTP
failures now retain the numeric status in the existing scoped usage error code
and timestamp; response bodies, headers and credentials remain excluded. The
native `canvas_voice_owner_handshake_rejected` case checks this through the real
Auth route, DO and D1, including zero debit and duplicate-delivery protection.
A 101 without a usable socket or an unobserved transport outcome remains unknown;
an HTTP status alone does not prove a particular account or permission defect.
The follow-up live attempt at `4f856428` established HTTP400, still before audio
and with zero debit. A calibrated local HTTP-wire probe verified the actual
workerd upgrade headers and101 path, but cannot establish the upstream cause.
Known provider-reported rejection reasons are reduced to fixed categories after
a maximum 4,096-byte/one-second read; arbitrary body text, keys and identifiers
are discarded. An unknown message remains an unexplained HTTP rejection.

On 2026-10-28, after the owner updated the Auth secret, the provider accepted
connections using the published `d9ffd06e` code. They stopped before activation
with `canvas_voice_provider_not_ready`. The discarded event type is unknown.
Local counterchecks reproduce two startup-contract gaps: configuration waited
only for `session.created`, and documented `conversation.item.added` history
notifications were rejected before acknowledgement. Configure once on the first
valid session/conversation creation event and treat item-added history as inert;
neither event authorizes audio, tools or activation without a verified settings
acknowledgement. Unexpected pre-ack events retain a fixed diagnostic category,
never arbitrary event names, contents, identifiers or credentials.

Protected startup release `5d1823f8` subsequently accepted a live connection but
stopped before configuration confirmation with an unrecognized JSON event
(`canvas_voice_provider_not_ready_unknown_event`); no audio or briefing change
was observed. The historical envelope was not retained. The next bounded
diagnostic records only fixed envelope/type categories, known-key presence,
allowlisted nested event/error categories and a digest of an unknown type. It
does not unwrap unexpected messages, relax the acknowledgement or retain
provider payloads. The subsequent `1a38584a` live receipt identified an object
with string type `ping`: its stored type digest matched SHA-256(`ping`) while
configuration was sent but not acknowledged. This exact heartbeat is inert,
consistent with the reference and official xAI web-agent event handler: it
does not activate the session, extend deadlines, send an invented JSON `pong`,
or authorize audio/tools. Other unknown frames still fail closed. Native
`canvas_voice_owner_startup_ping` exercises the real socket, ACK and settlement
boundary. Passing this repair does not establish live speech acceptance.

The subsequent `b581fbde` live attempt passed that heartbeat boundary and received
`session.updated`, but rejected an absent `voice` echo. The official
[xAI ACK contract](https://docs.x.ai/developers/rest-api-reference/inference/voice)
does not require a complete returned configuration. Its
[interpreter example](https://github.com/xai-org/xai-cookbook/blob/002788b1fe838295a5e0b6adedcc8c216f807926/examples/live-interpreter/typescript/public/index.html#L291)
distinguishes an earlier token-settings ACK by the missing instructions.
Require the pending update's exact pinned model and complete canonical
instructions; compare optional fields when returned, including tool identities
and contradictory nested settings. An omitted echo is not a failed setting or
independent evidence that every option works. Empty/stale-policy ACKs still
fail. `canvas_voice_owner_startup_partial_ack` exercises activation and original
settlement through native sockets with only those two anchors; provider tests
retain explicit mismatched-value, unsafe-tool and missing-anchor counterchecks.

Schema `0119_canvas_voice_sessions.sql` and the Voice frontend are published.
The startup correction requires Auth publication only; compute the complete
unpublished selection before release and retain unchanged frontend provenance.
Use `release:local` with its existing protection, verification and publication
lock. A published component or accepted WebSocket alone is not live speech
acceptance. Preserve the owner's encrypted secret and existing session receipts.

A safe rollout must provide an admission-off switch before enabling Voice. It
must reject new Voice sessions, stop existing Voice transport safely and retain
uncertain billing evidence, without cancelling Canvas production or changing
the text assistant. The reviewed flag is preserved by the protected publisher and verified against
active bindings. Keep the new accounting guards when disabling Voice; an old
Auth build could incorrectly release an unknown Voice reservation. Never undo the additive schema
or remove existing conversation/media data as a rollback shortcut.
