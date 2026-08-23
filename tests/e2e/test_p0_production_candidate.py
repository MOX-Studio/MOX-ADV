from __future__ import annotations

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


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _copy_candidate(target: Path) -> None:
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
        "P0_E2E_FIXTURE_SCENARIO=mixed-correction\n",
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
def production_candidate_server():
    with tempfile.TemporaryDirectory(prefix="mox-p0-e2e-") as temporary:
        target = Path(temporary) / "candidate"
        _copy_candidate(target)
        port = _available_port()
        base_url = f"http://localhost:{port}"
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("YANDEX_")
        }
        environment["P0_E2E_FIXTURE_SCENARIO"] = "mixed-correction"
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
        })"""
    )
    test.assertEqual(VIEWPORT["width"], dimensions["innerWidth"])
    test.assertEqual(VIEWPORT["height"], dimensions["innerHeight"])
    test.assertLessEqual(dimensions["scrollWidth"], dimensions["clientWidth"])


class P0ProductionCandidateE2ETests(unittest.TestCase):
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

                def checkpoint() -> None:
                    assert_no_horizontal_overflow(self, page)
                    visible_copy_samples.append(page.locator("body").inner_text())

                page.goto(base_url, wait_until="networkidle")
                self.assertEqual("Путь владельца — MOX-ADV", page.title())
                steps = page.get_by_label("Путь владельца").locator("li")
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
                    page.get_by_role(
                        "heading", name="Честный старт с доступными данными", exact=True
                    ).is_visible()
                )
                self.assertTrue(page.get_by_text("Яндекс Директ", exact=True).is_visible())
                self.assertTrue(page.get_by_text("Яндекс Метрика", exact=True).is_visible())
                self.assertTrue(page.get_by_text("Яндекс Wordstat", exact=True).is_visible())
                roadmap = page.get_by_label("Дорожная карта")
                self.assertEqual(["Управление", "Мониторинг", "SEO", "VK"], roadmap.locator("li span").all_inner_texts())
                self.assertEqual(0, roadmap.get_by_role("button").count())
                checkpoint()

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
                    "heading", name="От бизнес-цели до готовых кампаний", exact=True
                ).wait_for()
                checkpoint()

                page.get_by_label("Сайт или адрес компании").fill("https://owner.example/")
                page.get_by_role(
                    "button", name="Исследовать бизнес и предложить цель", exact=True
                ).click()
                page.get_by_role(
                    "heading", name="Бизнес-цель подготовлена", exact=True
                ).wait_for()
                self.assertEqual(
                    1,
                    page.locator(".owner-action button[type='submit']").count(),
                )
                checkpoint()

                page.get_by_role(
                    "button", name="Подтвердить цель и продолжить", exact=True
                ).click()
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
                self.assertGreaterEqual(
                    demand_cost.locator(".owner-demand-formulations article").count(), 5
                )
                self.assertIn("Яндекс Wordstat", demand_cost.inner_text())
                self.assertIn("нижняя граница", demand_cost.inner_text().lower())
                self.assertIn("110–170 RUB", demand_cost.inner_text())
                self.assertIn("НДС включён", demand_cost.inner_text())
                self.assertIn("42 clicks", demand_cost.inner_text())
                self.assertNotIn("keyword_id", demand_cost.inner_text())
                competitor_matrix = page.locator(".owner-competitor-matrix")
                self.assertTrue(
                    competitor_matrix.get_by_role(
                        "heading", name="Матрица конкурентов", exact=True
                    ).is_visible()
                )
                self.assertEqual(2, competitor_matrix.locator(".owner-competitor-candidates article").count())
                self.assertEqual(1, competitor_matrix.locator(".owner-competitor-rows > article").count())
                self.assertTrue(competitor_matrix.get_by_text("от 120 000 ₽", exact=True).is_visible())
                self.assertTrue(competitor_matrix.get_by_text("Наблюдалось: 1.", exact=True).first.is_visible())
                self.assertIn("Знаменатель: 2", competitor_matrix.inner_text())
                self.assertIn("Публичные наблюдения не показывают расходы, CPC, конверсии, CPA, ROI, прибыльность", competitor_matrix.inner_text())
                checkpoint()

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
                checkpoint()

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
                page.get_by_role("button", name="Утвердить стратегию", exact=True).click()
                page.get_by_role(
                    "heading", name="Пока нет честно жизнеспособных кампаний", exact=True
                ).wait_for()
                self.assertGreaterEqual(page.locator(".owner-campaigns article").count(), 2)
                self.assertTrue(page.get_by_text(re.compile(r"TESTABLE_WITH_GAPS")).first.is_visible())
                self.assertTrue(page.get_by_text(re.compile(r"только сравнительный приоритет, не прогноз")).first.is_visible())
                protocol_previews = page.get_by_label("Заранее зафиксированный протокол теста")
                self.assertGreaterEqual(protocol_previews.count(), 2)
                self.assertIn("Условие успеха", protocol_previews.first.inner_text())
                self.assertIn("Условие остановки", protocol_previews.first.inner_text())
                self.assertIn("Предположение теста отделено", protocol_previews.first.inner_text())
                checkpoint()

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
                checkpoint()
                page.get_by_role(
                    "button", name="Повторно проверить изменённый тест", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).wait_for()

                page.get_by_role(
                    "button", name="Проверить состав и порядок набора", exact=True
                ).click()
                page.get_by_role(
                    "heading", name=re.compile(r"\d+ кампании к созданию")
                ).wait_for()
                self.assertTrue(page.get_by_text("9/9 бизнес-проверок пройдено", exact=True).is_visible())
                checkpoint()

                page.get_by_role(
                    "button", name="Подтвердить точный пакет", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Подготовить исправление", exact=True
                ).wait_for(timeout=20_000)
                self.assertTrue(
                    page.get_by_text("Создана и оставлена без показов", exact=True).is_visible()
                )
                self.assertTrue(
                    page.get_by_text("Нужно исправить формулировку", exact=True).is_visible()
                )
                checkpoint()

                page.get_by_role("button", name="Подготовить исправление", exact=True).click()
                correction = page.get_by_label("Исправленный текст")
                correction.wait_for()
                correction.fill("Подайте заявку на участие без гарантии результата.")
                page.get_by_role(
                    "button", name="Сохранить исправленную формулировку", exact=True
                ).click()
                page.get_by_role(
                    "button", name="Подтвердить исправление", exact=True
                ).wait_for()
                page.get_by_role(
                    "button", name="Подтвердить исправление", exact=True
                ).click()
                page.wait_for_timeout(5_000)
                self.assertTrue(
                    page.get_by_text(
                        "Создание завершено без запуска показов", exact=True
                    ).is_visible(),
                    page.locator("body").inner_text(),
                )
                checkpoint()

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
