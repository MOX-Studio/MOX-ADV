from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "sites" / "p0-production"
VIEWPORT = {"width": 1920, "height": 1080}
PRODUCT_MVP_SOURCE = SOURCE / "tests" / "fixtures" / "product-mvp" / "product-mvp-source.json"
TECHNICAL_NOISE_DENYLIST = json.loads(PRODUCT_MVP_SOURCE.read_text(encoding="utf-8"))["browser"]["technical_noise_denylist"]


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _copy_candidate(target: Path, scenario: str) -> None:
    ignored = shutil.ignore_patterns(
        "node_modules",
        "dist",
        ".next",
        ".wrangler",
        ".vinext",
        ".env",
        ".env.*",
        "tsconfig.tsbuildinfo",
    )
    shutil.copytree(SOURCE, target, ignore=ignored)
    (target / "node_modules").symlink_to(SOURCE / "node_modules", target_is_directory=True)
    (target / ".env.local").write_text(
        f"P0_E2E_FIXTURE_SCENARIO={scenario}\n",
        encoding="utf-8",
    )


def _wait_until_ready(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, _ = process.communicate(timeout=5)
            raise AssertionError(f"P0 fixture server exited early:\n{stdout}")
        try:
            with urlopen(base_url, timeout=2) as response:  # noqa: S310 - loopback fixture only
                if response.status == 200:
                    return
        except (URLError, TimeoutError):
            time.sleep(0.25)
    raise AssertionError("P0 fixture server did not become ready within 90 seconds")


@contextmanager
def production_candidate_server(scenario: str = "mixed-correction"):
    with tempfile.TemporaryDirectory(prefix="mox-p0-e2e-") as temporary:
        target = Path(temporary) / "candidate"
        _copy_candidate(target, scenario)
        port = _available_port()
        base_url = f"http://localhost:{port}"
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("YANDEX_")
        }
        environment["P0_E2E_FIXTURE_SCENARIO"] = scenario
        process = subprocess.Popen(
            ["npm", "run", "dev", "--", "--port", str(port)],
            cwd=target,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            _wait_until_ready(base_url, process)
            yield base_url
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            if process.stdout is not None:
                process.stdout.close()


def assert_no_horizontal_overflow(test: unittest.TestCase, page: Page) -> None:
    dimensions = page.evaluate(
        """() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          overflowing: [...document.querySelectorAll('main, section, article, aside, form')]
            .filter((element) => {
              const style = getComputedStyle(element);
              return element.scrollWidth > element.clientWidth + 1
                && !['auto', 'scroll'].includes(style.overflowX);
            })
            .slice(0, 10)
            .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
        })"""
    )
    test.assertEqual(VIEWPORT["width"], dimensions["innerWidth"])
    test.assertEqual(VIEWPORT["height"], dimensions["innerHeight"])
    test.assertLessEqual(dimensions["scrollWidth"], dimensions["clientWidth"])
    test.assertEqual([], dimensions["overflowing"])


def assert_owner_accessibility_and_hierarchy(
    test: unittest.TestCase,
    page: Page,
    expected_stage: str,
) -> None:
    audit = page.evaluate(
        """() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
              && rect.width > 0 && rect.height > 0;
          };
          const controls = [...document.querySelectorAll('button, input, textarea, select')]
            .filter(visible);
          const missingNames = controls.filter((control) => {
            if (control.tagName === 'BUTTON') return !control.textContent.trim() && !control.getAttribute('aria-label');
            const label = control.closest('label')?.querySelector(':scope > span')?.textContent
              || (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent)
              || control.getAttribute('aria-label');
            return !String(label || '').trim();
          }).map((control) => control.outerHTML.slice(0, 180));
          const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
          const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
          const headings = [...document.querySelectorAll('h1, h2, h3, h4')].filter(visible)
            .map((heading) => ({ level: Number(heading.tagName.slice(1)), text: heading.textContent.trim() }));
          const skippedHeading = headings.slice(1).find((heading, index) => heading.level > headings[index].level + 1) || null;
          const unavailableControls = controls.filter((control) => /(?:retry|poll|checkpoint|reconcil|повторить запрос|опросить провайдера)/iu.test(control.textContent || control.getAttribute('aria-label') || ''))
            .map((control) => control.textContent.trim());
          return {
            lang: document.documentElement.lang,
            h1Count: headings.filter((heading) => heading.level === 1).length,
            firstHeading: headings[0] || null,
            skippedHeading,
            missingNames,
            duplicateIds,
            unavailableControls,
            disabledControls: controls.filter((control) => control.disabled).length,
          };
        }"""
    )
    test.assertEqual("ru", audit["lang"])
    if expected_stage == "Цель":
        test.assertEqual(1, audit["h1Count"])
        test.assertEqual(1, audit["firstHeading"]["level"])
    else:
        test.assertEqual(0, audit["h1Count"])
        test.assertEqual(2, audit["firstHeading"]["level"])
    test.assertIsNone(audit["skippedHeading"])
    test.assertEqual([], audit["missingNames"])
    test.assertEqual([], audit["duplicateIds"])
    test.assertEqual([], audit["unavailableControls"])
    test.assertEqual(0, audit["disabledControls"])
    current = page.locator('[aria-current="step"] strong')
    test.assertEqual(1, current.count())
    test.assertEqual(expected_stage, current.inner_text())
    primary = page.locator(".owner-action button[type='submit']")
    if primary.count():
        test.assertEqual(1, primary.count())
        test.assertTrue(primary.is_visible())
        primary.focus()
        test.assertTrue(primary.evaluate("element => document.activeElement === element"))
    visible_copy = page.locator("body").inner_text().lower()
    for forbidden in TECHNICAL_NOISE_DENYLIST:
        test.assertNotIn(forbidden.lower(), visible_copy)


def advance_owner_to_findings(page: Page, base_url: str) -> None:
    page.goto(base_url, wait_until="networkidle")
    page.get_by_label("Исходная ситуация").select_option("existing")
    page.get_by_role("button", name="Продолжить", exact=True).click()
    page.get_by_role("button", name="Предоставить доступ на чтение", exact=True).click()
    page.get_by_label("Рекламируемый бизнес").select_option(index=1)
    page.get_by_label("Сайт и аналитика").select_option(index=1)
    page.get_by_role("button", name="Подтвердить выбранный бизнес", exact=True).click()
    page.get_by_role("button", name="Подтвердить готовность доступа", exact=True).click()
    page.get_by_label("Сайт или адрес компании").fill("https://owner.example/")
    page.get_by_role("button", name="Исследовать бизнес и предложить цель", exact=True).click()
    page.get_by_role("heading", name="Бизнес-цель подготовлена", exact=True).wait_for()
    interview = page.get_by_role(
        "region", name="Цель кампании и модель бизнеса", exact=True
    )
    interview.get_by_role(
        "button", name="Показать рекомендованный ответ", exact=True
    ).click()
    interview.locator("textarea").press("Control+Enter")
    interview.get_by_role("button", name="Подтвердить ответ", exact=True).click()
    interview.get_by_role("button", name="Продолжить опрос", exact=True).click()
    interview.get_by_role(
        "button", name="Показать рекомендованный ответ", exact=True
    ).click()
    interview.locator("textarea").press("Control+Enter")
    interview.get_by_role("button", name="Подтвердить ответ", exact=True).click()
    page.get_by_role("heading", name="Агент собрал понимание бизнеса", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"Что узнал агент")).click()


class P0ProductionCandidateE2ETests(unittest.TestCase):
    def test_wordstat_partial_quota_and_unavailable_are_visible_without_zero_demand(self) -> None:
        scenarios = [
            (
                "mixed-correction-wordstat-partial",
                "Частично",
                "Ответ Wordstat для части формулировок неполон.",
                "Повторить только недоступные формулировки",
            ),
            (
                "mixed-correction-wordstat-quota-exhausted",
                "Недоступно",
                "Квота Wordstat исчерпана.",
                "Повторить сбор после восстановления квоты",
            ),
            (
                "mixed-correction-wordstat-unavailable",
                "Недоступно",
                "Доступ к Wordstat недоступен.",
                "Восстановить доступ к Wordstat",
            ),
        ]
        for scenario, expected_status, expected_gap, expected_action in scenarios:
            with self.subTest(scenario=scenario):
                with production_candidate_server(scenario) as base_url:
                    with sync_playwright() as playwright:
                        browser = playwright.chromium.launch(headless=True)
                        page = browser.new_page(viewport=VIEWPORT)
                        advance_owner_to_findings(page, base_url)
                        demand_cost = page.locator(".owner-demand-cost")
                        self.assertTrue(demand_cost.is_visible())
                        self.assertEqual(expected_status, demand_cost.locator(":scope > header > strong").inner_text())
                        text = demand_cost.inner_text()
                        self.assertIn(expected_gap, text)
                        self.assertIn(expected_action, text)
                        self.assertIn("Частота недоступна", text)
                        self.assertNotRegex(text, r"(?:^|\s)0 запрос")
                        self.assertNotIn("WORDSTAT_", text)
                        self.assertNotIn("seed_id", text)
                        assert_no_horizontal_overflow(self, page)
                        browser.close()

    def test_owner_completes_the_typed_five_stage_journey_through_the_ui(self) -> None:
        with production_candidate_server() as base_url:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport=VIEWPORT)
                console_errors: list[str] = []
                page_errors: list[str] = []
                nonlocal_requests: list[str] = []
                visible_copy_samples: list[str] = []

                page.on(
                    "console",
                    lambda message: console_errors.append(message.text)
                    if message.type == "error"
                    else None,
                )
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on(
                    "request",
                    lambda request: nonlocal_requests.append(request.url)
                    if not request.url.startswith(base_url)
                    else None,
                )

                def checkpoint(expected_stage: str) -> None:
                    assert_no_horizontal_overflow(self, page)
                    assert_owner_accessibility_and_hierarchy(self, page, expected_stage)
                    visible_copy_samples.append(page.locator("body").inner_text())

                page.goto(base_url, wait_until="networkidle")
                self.assertEqual("Стратегия и рекламные кампании — MOX-ADV", page.title())
                navigation = page.get_by_role("navigation", name="Основная навигация")
                self.assertEqual(
                    ["Стратегия", "Управление", "Мониторинг", "SEO", "Каналы"],
                    navigation.locator(":scope > *").evaluate_all(
                        "elements => elements.map(element => element.childNodes[0].textContent.trim())"
                    ),
                )
                self.assertEqual(0, navigation.get_by_text("Обзор", exact=True).count())
                self.assertTrue(page.get_by_role("complementary", name="Контекст работы агента").is_visible())
                steps = page.get_by_label("Путь подготовки рекламных кампаний").locator("li")
                self.assertEqual(5, steps.count())
                self.assertEqual(
                    [
                        "Цель",
                        "Что узнал агент",
                        "Стратегия",
                        "Кампании",
                        "Проверка и создание",
                    ],
                    steps.locator("strong").all_inner_texts(),
                )
                self.assertTrue(
                    page.locator(".owner-outcome h2").get_by_text(
                        "Выберите исходную ситуацию", exact=True
                    ).is_visible()
                )
                self.assertTrue(page.get_by_text("Яндекс Директ", exact=True).is_visible())
                self.assertTrue(page.get_by_text("Яндекс Метрика", exact=True).is_visible())
                self.assertTrue(page.get_by_text("Яндекс Wordstat", exact=True).is_visible())
                self.assertTrue(navigation.get_by_role("link", name="Стратегия", exact=True).is_visible())
                self.assertEqual(1, navigation.locator('[aria-current="page"]').count())
                self.assertEqual(0, navigation.get_by_role("button").count())
                checkpoint("Цель")

                page.get_by_label("Исходная ситуация").select_option("existing")
                page.get_by_role("button", name="Продолжить", exact=True).click()
                page.locator(".owner-outcome h2").get_by_text(
                    "Нужно разрешение на чтение данных", exact=True
                ).wait_for()
                page.get_by_role(
                    "button", name="Предоставить доступ на чтение", exact=True
                ).click()
                page.locator(".owner-outcome h2").get_by_text(
                    "Выберите понятный бизнес-аккаунт и счётчик", exact=True
                ).wait_for()
                page.get_by_label("Рекламируемый бизнес").select_option(index=1)
                page.get_by_label("Сайт и аналитика").select_option(index=1)
                page.get_by_role(
                    "button", name="Подтвердить выбранный бизнес", exact=True
                ).click()
                page.locator(".owner-outcome h2").get_by_text(
                    "Доступ подтверждён", exact=True
                ).wait_for()
                page.get_by_role(
                    "button", name="Подтвердить готовность доступа", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Исследовать бизнес и предложить цель", exact=True
                ).wait_for()
                checkpoint("Цель")

                page.get_by_label("Сайт или адрес компании").fill("https://owner.example/")
                page.get_by_role(
                    "button", name="Исследовать бизнес и предложить цель", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Бизнес-цель подготовлена", exact=True
                ).wait_for()
                self.assertEqual(
                    1,
                    page.locator(".owner-interview-action button[type='submit']").count(),
                )
                checkpoint("Цель")

                interview = page.get_by_role(
                    "region", name="Цель кампании и модель бизнеса", exact=True
                )
                self.assertTrue(interview.is_visible(), page.locator("body").inner_text())
                interview.get_by_role(
                    "button", name="Показать рекомендованный ответ", exact=True
                ).click()
                recommended_goal = interview.locator("textarea")
                self.assertTrue(recommended_goal.input_value())
                corrected_goal = "Получать квалифицированные заявки на участие от компаний"
                recommended_goal.fill(corrected_goal)
                interview.get_by_role("button", name="Проверить ответ", exact=True).click()
                interview.get_by_role(
                    "button", name="Проверить исправление", exact=True
                ).wait_for()
                self.assertTrue(
                    interview.get_by_text("Исправление владельца", exact=True).is_visible(),
                    interview.inner_text(),
                )
                interview.get_by_role(
                    "button", name="Проверить исправление", exact=True
                ).click()
                self.assertTrue(
                    interview.get_by_text(corrected_goal, exact=True).first.is_visible()
                )
                interview.get_by_role("button", name="Подтвердить ответ", exact=True).click()
                interview.get_by_role("button", name="Продолжить опрос", exact=True).wait_for()

                page.reload(wait_until="networkidle")
                interview = page.get_by_role(
                    "region", name="Цель кампании и модель бизнеса", exact=True
                )
                self.assertTrue(
                    interview.get_by_text(corrected_goal, exact=True).is_visible()
                )
                self.assertTrue(
                    interview.get_by_text("Исправление владельца", exact=True).is_visible()
                )
                self.assertTrue(
                    page.get_by_text(corrected_goal, exact=True).first.is_visible()
                )
                assert_no_horizontal_overflow(self, page)

                interview.get_by_role("button", name="Продолжить опрос", exact=True).click()
                interview.get_by_role(
                    "button", name="Показать рекомендованный ответ", exact=True
                ).click()
                audience_answer = interview.locator("textarea")
                self.assertTrue(audience_answer.input_value())
                audience_answer.press("Control+Enter")
                interview.get_by_role("button", name="Подтвердить ответ", exact=True).click()
                page.get_by_role(
                    "button", name="Подтвердить понимание бизнеса", exact=True
                ).wait_for()
                page.get_by_role(
                    "heading", name="Агент собрал понимание бизнеса", exact=True
                ).wait_for()
                self.assertEqual(
                    0,
                    page.get_by_role(
                        "heading", name="От бизнес-цели до готовых кампаний", exact=True
                    ).count(),
                )
                demand_cost = page.locator(".owner-demand-cost")
                self.assertTrue(
                    demand_cost.get_by_role(
                        "heading", name="Исследование нескольких формулировок", exact=True
                    ).is_visible()
                )
                frequency_rows = demand_cost.locator(".owner-demand-formulations article")
                self.assertGreaterEqual(frequency_rows.count(), 3)
                self.assertGreaterEqual(
                    demand_cost.locator('.owner-demand-formulations article[data-frequency-state="available"]').count(), 3
                )
                frequency_text = demand_cost.inner_text()
                self.assertIn("Яндекс Wordstat", frequency_text)
                self.assertIn("нижняя граница", frequency_text.lower())
                self.assertIn("Популярные запросы Wordstat · /v1/topRequests", frequency_text)
                self.assertIn("Широкая формулировка", frequency_text)
                self.assertIn("Москва · все устройства", frequency_text)
                self.assertIn("Яндекс Wordstat · официальное API", frequency_text)
                self.assertRegex(frequency_text, r"\d+ запрос(?:ов|а)?")
                self.assertIn("Сравнить формулировки", frequency_text)
                self.assertIn("110–170 RUB", demand_cost.inner_text())
                self.assertIn("НДС включён", demand_cost.inner_text())
                self.assertIn("42 clicks", demand_cost.inner_text())
                self.assertNotIn("keyword_id", demand_cost.inner_text())
                direct_report = page.get_by_role(
                    "region", name="Отчёт о текущем продвижении", exact=True
                )
                self.assertTrue(direct_report.is_visible())
                self.assertEqual("filled", direct_report.get_attribute("data-report-state"))
                self.assertTrue(
                    direct_report.get_by_text("Данные получены", exact=True).is_visible()
                )
                self.assertEqual(
                    ["КАМПАНИИ\n1\nТекущие кампании в выбранном рекламном аккаунте", "ГРУППЫ ОБЪЯВЛЕНИЙ\n2\nСвязанные группы в том же снимке", "ОБЪЯВЛЕНИЯ\n3\nОбъявления без внутренних идентификаторов", "УСЛОВИЯ ПОКАЗА\n6\nКлючевые фразы и автотаргетинги вместе"],
                    direct_report.locator(".owner-direct-inventory article").all_inner_texts(),
                )
                self.assertTrue(
                    direct_report.get_by_text(
                        "Поиск · участие в выставке", exact=True
                    ).is_visible()
                )
                self.assertTrue(
                    direct_report.get_by_text("6 строк за период", exact=True).is_visible()
                )
                self.assertTrue(
                    direct_report.get_by_text("4 достижения цели", exact=True).is_visible()
                )
                self.assertIn("30 визитов", direct_report.inner_text())
                self.assertIn("не доказывает причинную эффективность", direct_report.inner_text())
                for hidden_detail in [
                    "9007199254740993123",
                    "UNIFIED_CAMPAIGN",
                    "direct-audit",
                    "schema_version",
                    "Campaigns.get",
                    "SEARCH_QUERY_PERFORMANCE_REPORT",
                ]:
                    self.assertNotIn(hidden_detail, direct_report.inner_text())
                competitor_matrix = page.locator(".owner-competitor-matrix")
                self.assertTrue(
                    competitor_matrix.get_by_role(
                        "heading", name="Матрица конкурентов", exact=True
                    ).is_visible()
                )
                self.assertEqual(2, competitor_matrix.locator(".owner-competitor-candidates article").count())
                self.assertEqual(1, competitor_matrix.locator(".owner-competitor-rows > article").count())
                self.assertTrue(competitor_matrix.get_by_text("от 120 000 ₽", exact=True).is_visible())
                self.assertTrue(competitor_matrix.get_by_text("Наблюдалось: 1 из 2 (50%).", exact=True).first.is_visible())
                self.assertIn("Знаменатель: 2", competitor_matrix.inner_text())
                self.assertIn("Публичные наблюдения не показывают расходы, CPC, конверсии, CPA, ROI, прибыльность", competitor_matrix.inner_text())
                checkpoint("Что узнал агент")

                page.get_by_label("Кто и как принимает решение о покупке").fill(
                    "Руководитель выбирает поставщика и согласует участие"
                )
                page.get_by_label("Модель выручки").fill("Разовая продажа пакета участия")
                page.get_by_label("Цикл продажи").fill("От 14 до 30 дней")
                page.get_by_label("Средняя ценность продажи, ₽").fill("500000")
                page.get_by_label("Валовая маржа, %").fill("40")
                page.get_by_label(
                    "Доля обращений, переходящих в продажу, %"
                ).fill("20")
                page.get_by_label("Мощность обработки новых результатов").fill(
                    "До 20 заявок в месяц"
                )
                page.get_by_label("Сезонность").fill("Спрос растёт перед выставкой")
                page.get_by_label("География обслуживания").fill(
                    "Москва и Московская область"
                )
                page.get_by_label("Ключевые ограничения").fill(
                    "Не обещать гарантированный результат"
                )
                page.get_by_role(
                    "button", name="Подтвердить понимание бизнеса", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Стратегия подготовлена", exact=True
                ).wait_for()
                checkpoint("Стратегия")

                strategy_recommendation = page.get_by_role(
                    "region", name="Полная рекомендация агента", exact=True
                )
                self.assertIn("Квалифицированный результат", strategy_recommendation.inner_text())
                self.assertIn("Максимум переходов в недельном бюджете", strategy_recommendation.inner_text())
                self.assertIn("Поиск", strategy_recommendation.inner_text())
                self.assertIn("Точная основная цель Метрики", strategy_recommendation.inner_text())
                self.assertTrue(page.get_by_label("Рекламный фокус").input_value())
                page.get_by_label("География").fill("Москва")
                page.get_by_label("Начало периода").fill("2026-09-01")
                page.get_by_label("Окончание периода").fill("2026-10-01")
                page.get_by_label("Бюджет на неделю, ₽").fill("50000")
                self.assertEqual(
                    "40000",
                    page.get_by_label("Целевая стоимость результата, ₽").input_value(),
                )
                page.get_by_role(
                    "button", name="Перейти к проверке стратегии", exact=True
                ).click()
                strategy_review = page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                )
                strategy_review.wait_for()
                review_text = strategy_review.inner_text()
                for expected in [
                    "ЦЕЛЬ",
                    "БЮДЖЕТ",
                    "ИЗМЕРЕНИЕ",
                    "НЕОПРЕДЕЛЁННОСТЬ",
                    "Полная стратегия рядом с основаниями",
                    "Альтернативы",
                    "Ограничения и доказательства",
                ]:
                    self.assertIn(expected, review_text)
                self.assertIn("Москва", review_text)
                self.assertRegex(review_text, r"50[\s\u00a0]000 ₽")
                self.assertIn("Точная основная цель Метрики", review_text)
                self.assertIn("Подтверждение стратегии не разрешает публикацию", review_text)
                self.assertEqual(12, strategy_review.locator(".owner-strategy-review-decisions article").count())
                checkpoint("Стратегия")

                strategy_review.get_by_role(
                    "button", name="Вернуться к редактированию", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить исправленную стратегию", exact=True
                ).wait_for()
                self.assertEqual("50000", page.get_by_label("Бюджет на неделю, ₽").input_value())
                page.get_by_role(
                    "button", name="Проверить исправленную стратегию", exact=True
                ).click()
                strategy_review = page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                )
                strategy_review.get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).wait_for()

                stale_page = browser.new_page(viewport=VIEWPORT)
                stale_page.goto(base_url, wait_until="networkidle")
                stale_review = stale_page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                )
                stale_review.get_by_role(
                    "button", name="Вернуться к редактированию", exact=True
                ).click()
                stale_page.get_by_role(
                    "button", name="Проверить исправленную стратегию", exact=True
                ).wait_for()
                strategy_review.get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).click()
                stale_error = page.locator(".owner-error")
                stale_error.wait_for()
                self.assertIn("Обновите страницу и повторите текущее бизнес-решение", stale_error.inner_text())
                page.wait_for_timeout(100)
                self.assertTrue(any("Failed to load resource" in message for message in console_errors))
                console_errors.clear()
                stale_page.close()

                page.reload(wait_until="networkidle")
                page.get_by_role(
                    "button", name="Проверить исправленную стратегию", exact=True
                ).click()
                strategy_review = page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                )
                strategy_review.get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).wait_for()
                strategy_review.get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Пока нет честно жизнеспособных кампаний", exact=True
                ).wait_for()
                self.assertGreaterEqual(page.locator(".owner-campaigns article").count(), 2)

                page.get_by_label("Путь подготовки рекламных кампаний").get_by_role(
                    "button", name=re.compile(r"^Стратегия")
                ).click()
                approved_review = page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                )
                self.assertIn("Подтверждена", approved_review.inner_text())
                approved_review.get_by_role(
                    "button", name="Изменить стратегию", exact=True
                ).click()
                approved_review.get_by_label("Главное сообщение").fill(
                    "Приглашаем промышленные компании обсудить участие и получить расчёт"
                )
                approved_review.get_by_role(
                    "button", name="Сохранить и проверить новую версию", exact=True
                ).click()
                page.locator('[aria-current="step"] strong').get_by_text(
                    "Стратегия", exact=True
                ).wait_for()
                page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                ).get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).wait_for()
                page.get_by_label("Путь подготовки рекламных кампаний").get_by_role(
                    "button", name=re.compile(r"^Кампании")
                ).click()
                self.assertTrue(page.get_by_text("ЭТАП ЕЩЁ НЕ ОТКРЫТ", exact=True).is_visible())
                self.assertEqual(0, page.locator(".owner-campaigns").count())
                page.get_by_label("Путь подготовки рекламных кампаний").get_by_role(
                    "button", name=re.compile(r"^Стратегия")
                ).click()
                page.get_by_role(
                    "region", name="Проверка точной версии стратегии", exact=True
                ).get_by_role(
                    "button", name="Подтвердить точную версию", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Пока нет честно жизнеспособных кампаний", exact=True
                ).wait_for()
                self.assertTrue(page.get_by_text(re.compile(r"TESTABLE_WITH_GAPS")).first.is_visible())
                self.assertTrue(page.get_by_text(re.compile(r"только сравнительный приоритет, не прогноз")).first.is_visible())
                protocol_previews = page.get_by_label("Заранее зафиксированный протокол теста")
                self.assertGreaterEqual(protocol_previews.count(), 2)
                self.assertIn("Условие успеха", protocol_previews.first.inner_text())
                self.assertIn("Условие остановки", protocol_previews.first.inner_text())
                self.assertIn("Предположение теста отделено", protocol_previews.first.inner_text())
                checkpoint("Кампании")

                campaign_cards = page.locator(".owner-campaigns > div > article")
                first_campaign = campaign_cards.nth(0)
                second_campaign = campaign_cards.nth(1)
                second_preview_before = second_campaign.get_by_label(
                    "Точный предпросмотр публикации"
                ).inner_text()
                first_campaign.get_by_role(
                    "button", name="Редактировать черновик", exact=True
                ).click()
                editor = first_campaign.locator(".owner-draft-editor")
                self.assertTrue(editor.is_visible())
                contract = editor.locator(".owner-draft-contract")
                contract.locator("summary").click()
                self.assertIn("Доступно после отдельной проверки", contract.inner_text())
                self.assertIn("Не поддерживается", contract.inner_text())
                self.assertIn("Показы в сетях", contract.inner_text())
                ad_title = editor.get_by_label(re.compile(r"^Заголовки объявления"))
                original_ad_title = ad_title.input_value()
                ad_title.fill("Несохранённый заголовок")
                editor.get_by_role(
                    "button", name="Отменить правки", exact=True
                ).click()
                self.assertEqual(0, first_campaign.locator(".owner-draft-editor").count())
                first_campaign.get_by_role(
                    "button", name="Редактировать черновик", exact=True
                ).click()
                editor = first_campaign.locator(".owner-draft-editor")
                self.assertEqual(
                    original_ad_title,
                    editor.get_by_label(re.compile(r"^Заголовки объявления")).input_value(),
                )

                comparator_share = editor.get_by_label(re.compile(r"^Доля сравнения, %"))
                comparator_share.fill("101")
                editor.get_by_role(
                    "button", name="Сохранить протокол", exact=True
                ).click()
                self.assertTrue(comparator_share.evaluate("element => Boolean(element.validationMessage)"))
                self.assertEqual(0, page.locator(".owner-error").count())
                editor.get_by_role(
                    "button", name="Отменить правки протокола", exact=True
                ).click()

                edited_ad_title = "Заявка на промышленную выставку"
                first_campaign.get_by_role(
                    "button", name="Редактировать черновик", exact=True
                ).click()
                editor = first_campaign.locator(".owner-draft-editor")
                editor.get_by_label(re.compile(r"^Заголовки объявления")).fill(
                    edited_ad_title
                )
                editor.get_by_role(
                    "button", name="Сохранить новую версию", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Повторно проверить изменённую кампанию", exact=True
                ).wait_for()
                self.assertIn(
                    edited_ad_title,
                    first_campaign.get_by_label("Точный предпросмотр публикации").inner_text(),
                )
                self.assertEqual(
                    second_preview_before,
                    second_campaign.get_by_label("Точный предпросмотр публикации").inner_text(),
                )
                self.assertIn("РЕДАКЦИЯ 2", first_campaign.locator(".owner-draft-version").inner_text())
                self.assertIn(
                    "Требуется повторная проверка",
                    first_campaign.locator(".owner-draft-version").inner_text(),
                )
                self.assertIn(
                    "Балл, предварительная проверка, короткий список и прежнее полномочие не действуют",
                    first_campaign.locator(".owner-draft-version").inner_text(),
                )

                page.reload(wait_until="networkidle")
                first_campaign = page.locator(".owner-campaigns > div > article").nth(0)
                second_campaign = page.locator(".owner-campaigns > div > article").nth(1)
                self.assertIn(
                    edited_ad_title,
                    first_campaign.get_by_label("Точный предпросмотр публикации").inner_text(),
                )
                self.assertEqual(
                    second_preview_before,
                    second_campaign.get_by_label("Точный предпросмотр публикации").inner_text(),
                )
                page.get_by_role(
                    "button", name="Повторно проверить изменённую кампанию", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()
                checkpoint("Кампании")

                test_budget = page.get_by_label(re.compile(r"бюджет теста, ₽")).first
                original_test_budget = int(test_budget.input_value())
                test_budget.fill(str(original_test_budget - 1))
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Повторно проверить изменённый тест", exact=True
                ).wait_for()
                self.assertEqual(0, page.get_by_text("9/9 бизнес-проверок пройдено", exact=True).count())
                checkpoint("Кампании")
                page.get_by_role(
                    "button", name="Повторно проверить изменённый тест", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()

                selection_form = page.locator("form.owner-action")
                order_inputs = selection_form.locator('input[name^="campaign_"]')
                campaign_count = order_inputs.count()
                self.assertGreaterEqual(campaign_count, 2)
                campaign_names = [
                    order_inputs.nth(index).locator("xpath=ancestor::label").locator("span").inner_text()
                    for index in range(campaign_count)
                ]

                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()

                order_inputs = page.locator('form.owner-action input[name^="campaign_"]')
                order_inputs.nth(0).fill("0")
                for index in range(1, campaign_count):
                    order_inputs.nth(index).fill(str(index))
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()
                self.assertEqual(
                    "0",
                    page.locator('form.owner-action input[name="campaign_1"]').input_value(),
                )
                checkpoint("Кампании")

                order_inputs = page.locator('form.owner-action input[name^="campaign_"]')
                for index in range(campaign_count):
                    order_inputs.nth(index).fill(str(campaign_count - index))
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()
                for index in range(campaign_count):
                    self.assertEqual(
                        str(campaign_count - index),
                        page.locator(f'form.owner-action input[name="campaign_{index + 1}"]').input_value(),
                    )
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "heading", name=re.compile(r"\d+ кампании к созданию")
                ).wait_for()
                self.assertTrue(page.get_by_text("9/9 бизнес-проверок пройдено", exact=True).is_visible())
                package_campaigns = page.get_by_role(
                    "heading", name="Бюджеты и периоды выбранных тестов", exact=True
                ).locator("xpath=following-sibling::ol[1]").locator("li strong")
                self.assertEqual(campaign_count, package_campaigns.count())
                self.assertEqual(
                    list(reversed(campaign_names)),
                    [package_campaigns.nth(index).inner_text() for index in range(campaign_count)],
                )
                checkpoint("Проверка и создание")

                page.get_by_role(
                    "button", name="Подтвердить точный пакет", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Подтвердить исправление", exact=True
                ).wait_for(timeout=20_000)
                self.assertTrue(
                    page.get_by_text("Создана и оставлена без показов", exact=True).is_visible()
                )
                self.assertTrue(
                    page.get_by_text("Нужно исправить формулировку", exact=True).is_visible()
                )
                self.assertTrue(
                    page.get_by_text(
                        re.compile(r"Подайте заявку на участие без гарантии результата")
                    ).first.is_visible()
                )
                checkpoint("Проверка и создание")

                page.get_by_role(
                    "button", name="Подтвердить исправление", exact=True
                ).wait_for()
                page.get_by_role(
                    "button", name="Подтвердить исправление", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Создание завершено без запуска показов", exact=True
                ).wait_for(timeout=20_000)
                checkpoint("Проверка и создание")

                visible_copy = "\n".join(visible_copy_samples)
                for forbidden in [
                    "schema_version",
                    "contract_version",
                    "publish_fingerprint",
                    "provider_ids",
                    "campaigns.get",
                    "campaigns.add",
                    "adgroups.add",
                    "keywords.add",
                    "ads.add",
                    "sha256:",
                    "error_code",
                    "tool_trace",
                ]:
                    self.assertNotIn(forbidden, visible_copy.lower())

                self.assertEqual([], console_errors)
                self.assertEqual([], page_errors)
                self.assertEqual([], nonlocal_requests)
                assert_no_horizontal_overflow(self, page)
                browser.close()


if __name__ == "__main__":
    unittest.main()
