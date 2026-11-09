# Hermes memory providers and OpenAg

Researched 2 November 2026. Scope: primary-source documentation and selected source contracts. No installation, model/provider call, test runner, live configuration or OpenAg runtime change was performed. Scoped local installation checks were read-only and did not identify which “MEM…” product Alex recalled.

## Main finding

A better memory system could improve OpenAg, but replacing SQLite does not define that improvement. Memory quality depends on what is captured, how facts are distinguished from guesses, how corrections supersede old information, what is retrieved for the current task, and how it reaches the model. Several richer memory products also use SQLite. The right comparison is the complete memory lifecycle, with retrieval quality and retained user control as acceptance criteria.

The strongest “MEM…” name candidates are **Mem0**, **MemOS**, **Memori** and **memsearch**. They are different projects. Installation, active configuration, successful writes, useful retrieval and successful model recall are five different claims.

## Scoped local findings

Read-only host inspection in this session found a Hermes executable and its Python environment. Its parsed configuration had no external memory provider selected and no enabled plugins. Candidate memory packages were not present in that Hermes environment's installed-distribution metadata, and no installed provider plugin directories were found. This supports **no active external memory provider confirmed in the inspected Hermes installation**. It does not establish absence from Docker, another Python environment, another application or another Mac. No private settings or credential values are recorded here.

## What current Hermes actually provides

Hermes retains built-in MEMORY.md and USER.md alongside at most one external provider. Current documentation says only RetainDB and ByteRover are bundled; formerly bundled providers, including Mem0 and Supermemory, moved to a plugin catalog. Older summaries listing eight bundled providers are stale. The external integration supplies recall, capture hooks and tools rather than replacing the built-in notes. Hermes applies a secret scrub before provider delivery, but explicitly acknowledges that arbitrary unrecognizable secrets can escape detection. [Current provider guide](https://github.com/NousResearch/hermes-agent/blob/5aa8df742c81ca7d993d94a0bc80b27edd65dc0c/website/docs/user-guide/features/memory-providers.md).

Built-in memory is deliberately small and curated, with a frozen prompt snapshot at session start. In-session writes persist but enter that prompt on a later session; live tool results expose the updated state. Past-session search supplements the notes. The docs warn against sharing one Hermes home between agent processes. These are deliberate boundaries, not evidence that every external backend provides stronger memory. [Built-in memory](https://github.com/NousResearch/hermes-agent/blob/5aa8df742c81ca7d993d94a0bc80b27edd65dc0c/website/docs/user-guide/features/memory.md).

The provider interface separates availability/configuration, initialization, static instructions, prefetch, completed-turn synchronization, tools and shutdown. It explicitly requires profile-bound instances and propagated background-thread context, so shared-process plugins cannot accidentally reuse another profile's store. This is a useful integration contract to study, not a reason to implement a generic provider framework before selecting a requirement. [Provider interface](https://github.com/NousResearch/hermes-agent/blob/5aa8df742c81ca7d993d94a0bc80b27edd65dc0c/agent/memory_provider.py).

## Candidate comparison

| Candidate | What the inspected primary source establishes | OpenAg fit and important limit |
| --- | --- | --- |
| Mem0 | Maintainer-owned Hermes plugin with managed Cloud, self-hosted HTTP server and in-process OSS modes | Focused candidate for extracted facts and semantic recall; extraction and embedding still require configured models |
| MemOS | Maintainer-owned external Hermes adapter and agent-independent TypeScript memory core | Particularly relevant to execution traces, feedback and learned workflows; larger integration and policy surface |
| Memori | Maintainer-owned Hermes memory provider using Memori Cloud | Execution-aware structured recall and post-compaction briefs; does not establish a local-only Hermes backend |
| memsearch | Markdown memory with a derived Milvus index, hybrid/progressive retrieval and multiple coding-agent integrations | Close to human-readable memory goals; inspected README does not establish a released Hermes provider |
| Supermemory | Maintainer-owned Hermes plugin, hosted or local server endpoint | Profile recall, explicit search/forget and conversation capture; still another service/namespace authority to operate |

### Mem0: extracted facts, three deployment modes

Mem0's Hermes plugin combines bounded current-question recall with background fact extraction from completed user/assistant turns. Its docs specify a three-second recall wait, best-effort capture and default 450-character truncation per message. It exposes explicit search/add/update/delete tools. OSS mode uses a separately selected LLM, embedder and vector store; the configured chat model is not automatically the extraction model. Local persistence alone does not keep data local when those models are remote. Scope user and agent identifiers deliberately rather than pooling all bot knowledge. [Mem0 Hermes integration](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/docs/integrations/hermes.mdx).

This is a plausible first candidate for a controlled fact-recall comparison. Its automatic extraction is not compatible by default with OpenAg's approval requirement for canonical memory writes; an integration must preserve that boundary.

### MemOS: memory of execution and learning

MemOS's local plugin organizes memory into grounded execution traces, induced strategies, environmental understanding and skills. Retrieval and feedback operate across these layers. The architecture lists SQLite storage, local/remote embedding options and several LLM paths. Its promise is a richer learning lifecycle rather than a new database technology. These mechanisms and benchmark marketing do not prove benefit on OpenAg's actual tasks. [Plugin overview](https://github.com/MemTensor/MemOS/blob/64388b50e2a15528bcdf032e65a1ac792bcf63ee/apps/memos-local-plugin/README.md), [architecture](https://github.com/MemTensor/MemOS/blob/64388b50e2a15528bcdf032e65a1ac792bcf63ee/apps/memos-local-plugin/ARCHITECTURE.md).

The Hermes adapter bridges Python to a shared Node subprocess through JSON-RPC, retaining separate logical sessions. The TypeScript core could be a relevant seam for OpenAg, but there is no verified OpenAg adapter. Automatic strategy/skill promotion needs particular care: inferred success cannot silently become a standing instruction or an approved skill. [Hermes adapter](https://github.com/MemTensor/MemOS/blob/64388b50e2a15528bcdf032e65a1ac792bcf63ee/apps/memos-local-plugin/adapters/hermes/README.md).

### Memori, memsearch and Supermemory

Memori documents background capture of conversation plus execution context, project-scoped recall, summaries and post-compaction briefs. Its inspected Hermes integration uses Memori Cloud and leaves built-in files intact. Generic statements about Memori's broader deployment options do not prove that this Hermes route runs locally. [Memori Hermes overview](https://github.com/MemoriLabs/Memori/blob/574b1ea3e876f100ef82c37817d603eb7e258e59/docs/memori-cloud/hermes/overview.mdx).

memsearch makes Markdown authoritative and Milvus a rebuildable index. It documents hybrid search, progressive expansion into source transcripts, automatic capture and optional background note/skill maintenance. Its current README lists Claude Code, Codex, DeepSeek Harness, OpenClaw and OpenCode; a Hermes-related pull request alone would not establish a released integration. Sharing memories across agents is a feature only where the owner has authorized that scope. [memsearch README](https://github.com/zilliztech/memsearch/blob/65d8b220d4265f70441785aa22203f0e85ea3ec6/README.md).

Supermemory's maintainer plugin supports hosted and self-hosted endpoints, namespace tags, automatic recall/capture, profile retrieval and explicit forget tools. Defaults enable capture/recall; extraction modes can consume additional operations. The configured endpoint and namespace must be verified before any real transcript is sent. A forget operation does not establish deletion of every source, backup or artifact. [Plugin README](https://github.com/supermemoryai/hermes-supermemory/blob/a8f360166419958ce77b876c69f7be3bf0716d67/README.md).

## OpenAg baseline and smallest useful next step

OpenAg already has per-bot MEMORY.md, sqlite-vec recall, conversation indexing, versioned skills and approval-controlled reflection. The runner retrieves up to four semantic hits and excludes isolated/noIndex turns from completed-turn indexing. This is more than plain SQL storage, but it does not prove extraction, ranking, correction or context quality. [Runner](../../apps/daemon/src/runtimes/runner.ts), [memory guide](../help/memory-skills.md), [vectors](../../apps/daemon/src/vectors.ts).

Recommended next steps, subject to the existing ticket queue and approval boundaries:

1. Identify the locally installed product and whether it is configured and active; do not reinstall a plausible name.
2. Define the observed failure: missing recent conversation, forgotten durable fact, wrong retrieval, stale fact, or repeated workflow mistake. OA-355's missing hosted conversation history is distinct from long-term memory.
3. Compare the existing pipeline with one candidate. Start with Mem0 for fact extraction or MemOS for execution/feedback learning, depending on that failure. Keep the daemon the authority; do not add several stores at once.
4. Use synthetic facts and controlled transports first: exact decision recall, paraphrased recall, corrected fact replacing an old fact, explicit scope isolation, injected external instructions, unavailable backend, restart and deletion/retention explanation.
5. Measure answer correctness, source traceability, correction persistence, irrelevant recalls, latency and all known extraction/embedding consumption. Avoid rewarding a memory system merely for recalling more text.

Canonical facts and skills must retain approved write paths. Retrieved text remains data, not new instructions or action permission. Preserve redaction, immutable unattended restrictions and isolation. Distinguish an episodic search index from approved standing knowledge; any change to what is indexed or sent externally needs an explicit design. No historical transcript backfill is authorized by this research.

## Limits

This was a focused source study. Package/dependency licensing, performance claims, production reliability and deletion across every store were not fully assessed. No external memory backend was executed. The report establishes candidate mechanisms and design questions, not a winner or permission to install, connect or migrate.
