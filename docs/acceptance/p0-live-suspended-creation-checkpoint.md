# P0 · реальное создание только в остановленном состоянии (#253)

Сценарий покрывает Feature [#250](https://github.com/MOX-Studio/MOX-ADV/issues/250), задачи #291–#294 и личную контрольную точку [#253](https://github.com/MOX-Studio/MOX-ADV/issues/253).

## Граница полномочия

1. Принятие точного пакета из #249 остаётся решением **без внешней записи**.
2. Реальное создание открывает только второе отдельное действие владельца: «Разрешить создание без показов».
3. Live-разрешение связано с точными package review, Gate, порядком Campaign Draft revisions, аккаунтом и capability profile.
4. Разрешение одноразовое: перед первым сетевым изменением оно атомарно переводится в `CONSUMED` и связывается с durable package execution.
5. Перезапуск может продолжить только это же package execution. Повторное создание, другой пакет, другой аккаунт или устаревшее полномочие блокируются.
6. `Campaigns.resume`, показы и расходы не входят в полномочие. Личные кабинеты Яндекса не используются.

## Обязательная последовательность

Для каждого выбранного элемента независимо:

1. durable execution и намерение конкретной изменяющей операции сохраняются до HTTP-вызова;
2. `Campaigns.add` выполняется через официальный Direct API v501;
3. немедленно выполняются `Campaigns.suspend` и `Campaigns.get`;
4. дочерние объекты нельзя записывать, пока официальный readback не подтвердил `State=SUSPENDED`;
5. создаются и семантически сверяются полный поддерживаемый граф Campaign → AdGroup → Keyword → ResponsiveAd;
6. exact ad отправляется на модерацию;
7. `MODERATION` и `PREACCEPTED` остаются ожиданием, `REJECTED` — отдельным provider-owned результатом, неизвестный или неоднозначный исход — блокирующей сверкой;
8. финальная приёмка требует terminal `ACCEPTED`, полного графа и повторно подтверждённого `SUSPENDED`.

Ни одна ветка не вызывает `Campaigns.resume`.

## Обезличенный артефакт

`lib/p0-live-creation-acceptance.ts` строит артефакт `p0-live-creation-acceptance-v1` из доверенного снимка приложения, durable execution records и отдельной проверки delivery через официальный Reports API.

Артефакт содержит:

- псевдоним аккаунта и псевдонимы элементов вместо реальных provider IDs;
- последовательность официальных операций, количества объектов и подтверждённые outcomes;
- итоговый `SUSPENDED`, полноту supported graph и terminal moderation outcome;
- нулевые показы и расходы из отдельного `YANDEX_DIRECT_REPORTS_API` readback;
- число неоднозначных результатов и число вызовов resume;
- явную границу между controlled official-shape fixture и `LIVE_OFFICIAL_API`.

Артефакт не содержит OAuth tokens, headers, raw provider responses, raw IDs, request bodies, request fingerprints или внутреннюю диагностику владельца.

Сбор из заранее выгруженного доверенного входа:

```bash
cd sites/p0-production
npm run capture:p0-live-creation -- \
  tests/evidence/p0-live-creation-trusted-input.json \
  tests/evidence/p0-live-creation-acceptance.json
```

Для `LIVE_OFFICIAL_API` команда завершается ошибкой, если хотя бы одна кампания не принята и не подтверждена как `SUSPENDED`, delivery не равен нулю, присутствует resume или остаётся неоднозначность.

## Проверка владельцем только через UI

Viewport: `1920×1080`.

1. Открыть локальную панель `http://127.0.0.1:8878/` через Playwright.
2. На этапе «Проверка и создание» убедиться, что предварительное решение показывает точный принятый пакет и сообщает: внешних записей — 0.
3. Убедиться, что появился отдельный шаг «Разрешить создание без показов» с явными последствиями: реальная запись, обязательная остановка, запрет показов, расходов и возобновления.
4. Выполнить этот шаг один раз.
5. Наблюдать отдельный business outcome каждой кампании. Ожидающий, отклонённый, неизвестный или требующий сверки результат не считается успехом.
6. После terminal outcomes сформировать артефакт и проверить:
   - `evidence_mode = LIVE_OFFICIAL_API`;
   - `status = READY_FOR_OWNER_CHECKPOINT`;
   - каждая принятая кампания имеет `campaign_state = SUSPENDED`;
   - `supported_graph_verified = true`;
   - `resume_calls = 0`;
   - `impressions_total = 0`;
   - `spend_total_rub = 0`;
   - `ambiguous_items = 0`;
   - raw secrets и IDs отсутствуют.
7. Проверить отсутствие горизонтального переполнения и ошибок console/page.

## Автоматические проверки

Из `sites/p0-production/`:

```bash
npm run test:live-creation
npm run test:contract
npm run test:e2e
npm run lint
npx tsc --noEmit
```

Ключевые файлы:

- `lib/live-creation-authority.ts` — отдельное точное одноразовое live-разрешение;
- `lib/execution-safety.ts` — durable per-mutation intent, single writer и fail-closed restart;
- `lib/direct-write.ts` — официальный API, suspend-before-children, semantic readback, moderation/correction;
- `lib/p0-live-creation-acceptance.ts` — обезличенный evidence artifact;
- `tests/live-creation-authority.test.mjs` — authority, redaction и checkpoint gate;
- `tests/execution-safety.test.mjs` — journal, restart и ambiguity;
- `tests/direct-write.test.mjs` — official-shape provider lifecycle.

## Решение контрольной точки

Владелец разрешил исполняющей сессии самостоятельно провести и закрыть #253. Закрытие допустимо только после артефакта `LIVE_OFFICIAL_API` со статусом `READY_FOR_OWNER_CHECKPOINT`; controlled fixture нельзя выдавать за live evidence.

После успешной проверки сессия должна:

1. оставить в #253 отдельный комментарий с доказательствами;
2. оставить отдельный комментарий `ACCEPTED`;
3. закрыть #253;
4. убедиться, что #291–#294 закрыты и workflow закрыл Feature #250;
5. не публиковать credentials, raw IDs, raw responses или внутренние diagnostics.
