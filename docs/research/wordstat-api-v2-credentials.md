# Wordstat API v2 credentials for MOX-ADV

Date checked: 2026-08-26.

## Finding

The official Wordstat support page now states that all Wordstat API capabilities are available through the Wordstat API in Yandex Search API:

- [API Вордстата](https://yandex.ru/support2/wordstat/ru/content/api-wordstat)
- [Wordstat API in Yandex Search API](https://yandex.cloud/ru/docs/search-api/concepts/wordstat)

A new integration should therefore use Yandex Cloud Wordstat API v2 rather than registering a new legacy `api.wordstat.yandex.net/v1` OAuth client.

## Credentials required by the current provider

1. A secret API key belonging to a Yandex Cloud service account.
   - Authorization form: `Authorization: Api-Key <API key>`.
   - Restrict the key to the `yc.search-api.execute` scope.
   - Official API-key documentation: [API key](https://yandex.cloud/en/docs/iam/concepts/authorization/api-key), [Managing API keys](https://yandex.cloud/en/docs/iam/operations/authentication/manage-api-keys).
2. The Yandex Cloud folder ID supplied as `folderId` in Wordstat requests. It is an identifier, not a secret.
3. The service account must have the Search API execution role documented for Wordstat, `search-api.webSearch.user`, in the selected folder.
4. MOX-ADV still needs an explicit business evidence scope: region ID `213`, exact name `Москва`, and device value `all` for the current test campaign.

No OAuth client ID, OAuth client secret, or manually issued Yandex OAuth token is required for the new v2 integration.

## Repository gap

The current production adapter is still the legacy v1 contract:

- `dashboard/lib/market-evidence.ts` sends `Authorization: Bearer ...` to `api.wordstat.yandex.net/v1/*` and requires both a token and a registered client ID.
- `dashboard/lib/yandex-access-readiness.ts` verifies the legacy `/v1/getRegionsTree` endpoint.
- `dashboard/lib/p0.ts` reads `YANDEX_WORDSTAT_OAUTH_TOKEN` and `YANDEX_WORDSTAT_CLIENT_ID`.

Modern credentials cannot be inserted into those fields honestly. The adapter and evidence provenance must first be migrated to Yandex Cloud Wordstat API v2. Proposed server-only variables:

```dotenv
YANDEX_WORDSTAT_API_KEY=
YANDEX_WORDSTAT_FOLDER_ID=
YANDEX_WORDSTAT_REGION_IDS=213
YANDEX_WORDSTAT_REGION_NAMES=Москва
YANDEX_WORDSTAT_DEVICE=all
```

The API key must never enter browser state, persisted campaign evidence, logs, or chat.
