# Brave Search API (verified for OA-102)

Source: Brave's API dashboard docs, "Web Search / Get started", fetched 2026-10-27.

- Endpoint: `GET https://api.search.brave.com/res/v1/web/search`
- Auth: header `X-Subscription-Token: <key>` (never put the key in the URL). Send `Accept: application/json`.
- Params: `q` (search operators go inside it; max length not documented, so cap at 400 chars ourselves), `count` (max 20, default 20; we use 1..10, default 5), `offset` (max 9), `country`, `search_lang`, `safesearch` (`off|moderate|strict`, default moderate), `freshness` (`pd|pw|pm|py` or a date range), `extra_snippets=true`.
- Response: `web.results[]` each with `title`, `url`, `description` (and `extra_snippets` when requested); `query.more_results_available` for paging.
- Rate-limit headers: not documented on that page.
- Pricing/key: a key needs a Brave account with a card; sources disagree on any free monthly credit, so check the dashboard. OpenAg therefore treats Brave as an **optional connector**: the `brave_search` tool does not exist unless `BRAVE_API_KEY` is set, and no request is ever made without it.
- Results are third-party web content: always returned wrapped as untrusted data, size-capped.
