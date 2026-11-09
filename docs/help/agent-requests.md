# Agent requests

In a direct chat, type @ to choose an existing agent by name or stable handle. A guest answers under its own identity in the original chat. With “ask Researcher…”, the current agent can consult Researcher and synthesize the returned findings. Neither path creates Work or changes membership. Direct-chat @everyone stays local; it never addresses all installed agents.

Requests share the question and selected context, not private transcripts or automatic memory recall. The request status offers Cancel and receipt links. Busy agents are refused; interrupted or uncertain actions are not replayed. Guest findings can include proposed artifact text; the requesting agent can save it with save_result in the original conversation. See docs/notes/agent-requests.md for scope, limits and recovery.

Agents use agent_list to discover stable handles, agent_consult to request findings, and agent_request_cancel to stop their active requests in this conversation. Omitting requestId cancels all of their active requests here. These are OpenAg tools; Codex collaboration tools are separate.

Specialist action reviews and provider input prompts appear in your original chat. Existing Work cancellation also stops its consultations. A paused initiating turn cancels pending dispatch. Requests have no fixed overall deadline; cancellation preserves findings and never undoes effects.
