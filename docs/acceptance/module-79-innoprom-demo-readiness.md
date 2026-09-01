# Module #79 — готовность демо ИННОПРОМ

Дата проверки: 2026-09-01

## Итог

**Готово для безопасного демонстрационного прохода до Publication Review.**

Текущий production run завершил canonical five-stage path. Current material pair содержит Campaign Hypothesis `campaign-hypothesis:5356fed39df57d4fa18eca38a22e481d` и Campaign Draft `campaign-draft:21421a02b0a14b8a960c2d8d837b0136:rfbd7df512423d0e354ee4d01`. Пакет сформирован, но намеренно не принят: пройдено **7/9** предпубликационных проверок, ещё две требуют подтверждённого evidence.

Демо не включает создание объектов в Директе, публикацию, показы или расходы.

## Что проверено

1. Владелец прошёл через production Dashboard `http://127.0.0.1:19243/` от бизнес-входов до Campaign Draft и Publication Review.
2. Historical Strategy 52 переработана Strategy Agent в current immutable revision `campaign-strategy:d095d32ce2c9fa2a98950fa0` без повторного owner approval:
   - период: `2027-01-15` — `2027-06-30`;
   - недельный бюджет: `30 000 ₽`;
   - принятие не даёт authority на публикацию или расходы.
3. Campaign Draft сохраняет:
   - название: «Участие со стендом в выставке ИННОПРОМ»;
   - бюджет теста: `30 000 ₽`;
   - посадочную страницу: `https://expo.innoprom.com/`;
   - точный Auction Protocol и frozen publish preview.
4. Wordstat собран только через изолированный headless Playwright UI:
   - batch: `eaa25525ee761f32e0c634a05fba4f8d809984c12c69a5dcd2ad9eb4d6945ca4`;
   - статус: `COMPLETE`;
   - наблюдаемая нижняя граница: `34 086`;
   - покрытие: `1 из 6` формулировок;
   - полный CSV остаётся protected artifact вне репозитория.
5. Посадочная проверена read-only изолированным Playwright bridge для desktop и mobile; оба scope имеют статус «Готово».
6. Direct и Metrika использовались только для чтения. Внешние записи, публикация, показы и расходы отсутствуют.
7. Dashboard после перезапроса возвращает `GET /api/p0 → 200`, показывает этап Publication Review и не пишет ошибок в browser console.
8. Целевой production run через Dashboard фактически вызвал Goal Agent, Evidence Analyst, Strategy Agent и Campaign Design Agent. Именованные `AGENT` events сохранены в audit trail; Campaign Design прошёл `CAMPAIGN_DESIGN_AGENT_DIRECT_COMPILER_VERIFIED`; внешняя запись осталась запрещена.
9. Typed technical correction проверена через Dashboard UI: Campaign Hypothesis revision осталась неизменной, Campaign Draft получила новую immutable revision, exact Direct projection была заново скомпилирована, dossier остался полным, а исходное business-название восстановлено отдельной revision.
10. Current-product D1 CAS проверен с production-семантикой `meta.changes`, включающей history trigger: history создаётся только после успешной current-row mutation, stale CAS не резервирует revision slot.

## Подтверждённые границы

- Wordstat: только `YANDEX_WORDSTAT_UI` / headless Playwright; API fallback отсутствует.
- Destination: только bounded public HTTPS inspection через loopback bridge; private DNS, redirect drift и scope drift fail closed.
- Direct/Metrika: read-only evidence.
- `TESTABLE_WITH_GAPS` допускается к точному review, но не означает готовность к публикации.
- Comparative score/rank не используется как admission gate.
- Принятие пакета не выполнено. `APPROVED_FOR_PUBLICATION`, запуск показов и расходы запрещены.

## Остаточные блокеры — показывать честно

1. **Измерение**
   - точная техническая привязка найдена;
   - смысловое соответствие выбранному квалифицированному результату: `0%`;
   - этап воронки не подтверждён;
   - свежий отчёт содержит `0` достижений при минимуме `3`.
2. **Рыночная стоимость и competitor provenance**
   - квалифицированный comparable-cost источник недоступен;
   - недоступное значение остаётся evidence gap и не превращается в ноль;
   - закрытые competitor budgets, CPC, conversions и account state не выводятся.

Следствие: package preflight остаётся **7/9**, а точное принятие пакета недоступно до устранения этих доказательных пробелов.

## Чек-лист демо без помощи разработчика

### Перед началом

- [ ] Открыть браузер в viewport `1920×1080`.
- [ ] Убедиться, что Dashboard слушает `127.0.0.1:19243`.
- [ ] Убедиться, что Wordstat bridge слушает `127.0.0.1:19246`.
- [ ] Убедиться, что destination bridge слушает `127.0.0.1:19247`.
- [ ] Не подключаться к пользовательскому Chrome profile и не открывать кабинеты Direct/Metrika вручную.

### Демонстрационный проход

1. Открыть `http://127.0.0.1:19243/?stage=review`.
2. Раскрыть «Агенты и проверяемый след» и показать Goal Agent, Evidence Analyst, Strategy Agent и Campaign Design Agent с их работой, основанием и результатом.
3. Показать завершённые этапы «Цель кампании», «Сбор сведений», «Стратегия», «Кампании».
4. На этапе «Проверка публикации» показать точный Campaign Draft, период, бюджет, посадочную и Auction Protocol.
5. Показать provenance Wordstat: «Яндекс Wordstat · авторизованный интерфейс · headless Playwright».
6. Показать desktop/mobile destination readiness.
7. Показать честный measurement blocker и 7/9 preflight.
8. Завершить демо без принятия пакета, без изменения пакета и без попытки обхода заблокированных проверок. Кнопка «Запустить» запускает только новый внутренний zero-write agent run; для короткого демо достаточно уже сохранённого проверяемого следа.

### Запрещённые действия

- Не подтверждать публикацию.
- Не создавать и не изменять кампании в Директе.
- Не запускать показы и расходы.
- Не подменять measurement goal произвольной целью.
- Не вводить synthetic/mock/fixture evidence в production document.

## Техническая проверка

- Production cutover: `e64dd28 feat(p0): reach production publication review safely`.
- Contract reconciliation: `03e26c9 test(p0): align contracts with material campaign pairs`.
- Проходят targeted checks:
  - 41/41 Module #79 completion, stage-agent, current provenance, dossier, executor, route и rendered-Dashboard checks;
  - 14/14 current-edit, D1-trigger, fixed-field preservation и Yandex access checks;
  - отдельно повторены и пройдены 2 legacy Draft/correction regressions: owner edit больше не ребейзит неизменённые Strategy/capability-owned Direct fields;
  - semantic и technical pair edits повторно проходят exact Direct Compiler; protocol-only edit сохраняет canonical publish fingerprint;
  - TypeScript `--noEmit`;
  - ESLint всех изменённых TypeScript/TSX/MJS файлов;
  - `git diff --check` и отсутствие временной диагностики.
- Playwright `1920×1080` подтвердил: completed five-stage run, `7/9`, два evidence gap, полную current pair, exact Draft revision, ноль browser warnings/errors, отсутствие raw `sha256:`, routine Strategy confirmation и `APPROVED_FOR_PUBLICATION`.

## Решение для демо

**Демонстрировать можно**, если цель — показать безопасную подготовку и честный fail-closed Publication Review. Нельзя представлять пакет как готовый к публикации или обещать, что текущая Metrika goal измеряет квалифицированный результат.
