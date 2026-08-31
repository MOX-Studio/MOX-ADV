from __future__ import annotations

import json
import os
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
        "node_modules", "dist", ".next", ".wrangler", ".vinext", ".env", ".env.*", "tsconfig.tsbuildinfo"
    )
    shutil.copytree(SOURCE, target, ignore=ignored)
    (target / "node_modules").symlink_to(SOURCE / "node_modules", target_is_directory=True)
    (target / ".env.local").write_text(f"P0_E2E_FIXTURE_SCENARIO={scenario}\n", encoding="utf-8")


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
        environment = {key: value for key, value in os.environ.items() if not key.startswith("YANDEX_")}
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


class P0ProductionCandidateE2ETests(unittest.TestCase):
    def test_owner_starts_stops_and_restarts_the_authoritative_five_stage_run(self) -> None:
        with production_candidate_server() as base_url:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport=VIEWPORT)
                console_errors: list[str] = []
                page_errors: list[str] = []
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                page.on("pageerror", lambda error: page_errors.append(str(error)))

                page.goto(base_url, wait_until="networkidle")
                pipeline = page.locator(".owner-pipeline-control")
                stages = page.get_by_label("Путь подготовки рекламных кампаний").locator("li")
                self.assertEqual(
                    ["Цель кампании", "Сбор сведений", "Стратегия", "Кампании", "Проверка публикации"],
                    stages.locator("strong").all_inner_texts(),
                )
                self.assertEqual(["Ожидает"] * 5, stages.locator("small").all_inner_texts())
                self.assertTrue(pipeline.get_by_role("button", name="Запустить", exact=True).is_visible())
                readonly_boundary = page.locator(".pipeline-readonly-boundary")
                self.assertFalse(readonly_boundary.evaluate("element => element.disabled"))
                assert_no_horizontal_overflow(self, page)

                with page.expect_response(lambda response: response.url.endswith("/api/p0") and response.request.method == "POST") as started_response:
                    pipeline.get_by_role("button", name="Запустить", exact=True).click()
                started = started_response.value.json()
                first_run_id = started["pipeline"]["runId"]
                pipeline.get_by_role("button", name="Остановить", exact=True).wait_for()
                self.assertTrue(readonly_boundary.evaluate("element => element.disabled"))

                with page.expect_response(lambda response: response.url.endswith("/api/p0") and response.request.method == "POST") as stopped_response:
                    pipeline.get_by_role("button", name="Остановить", exact=True).click()
                stopped = stopped_response.value.json()
                self.assertEqual(first_run_id, stopped["pipeline"]["runId"])
                pipeline.get_by_role("button", name="Запустить", exact=True).wait_for()
                self.assertIn("Следующий запуск будет новым", pipeline.inner_text())

                with page.expect_response(lambda response: response.url.endswith("/api/p0") and response.request.method == "POST") as restarted_response:
                    pipeline.get_by_role("button", name="Запустить", exact=True).click()
                restarted = restarted_response.value.json()
                self.assertNotEqual(first_run_id, restarted["pipeline"]["runId"])
                assert_no_horizontal_overflow(self, page)
                self.assertEqual([], console_errors)
                self.assertEqual([], page_errors)
                browser.close()

    def test_controlled_agents_complete_the_new_pipeline_without_external_writes(self) -> None:
        with production_candidate_server("pipeline-acceptance") as base_url:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport=VIEWPORT)
                console_errors: list[str] = []
                page_errors: list[str] = []
                nonlocal_requests: list[str] = []
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("request", lambda request: nonlocal_requests.append(request.url) if not request.url.startswith(base_url) else None)

                page.goto(base_url, wait_until="networkidle")
                with page.expect_response(lambda response: response.url.endswith("/api/p0") and response.request.method == "POST") as completed_response:
                    page.locator(".owner-pipeline-control").get_by_role("button", name="Запустить", exact=True).click()
                completed = completed_response.value.json()
                self.assertEqual("COMPLETED", completed["pipeline"]["status"])
                self.assertEqual("review", completed["pipeline"]["currentStage"])
                self.assertEqual([], completed["campaignOptions"])
                self.assertIsNone(completed["packageSummary"])
                self.assertNotIn("dispatch_package", json.dumps(completed).lower())

                stages = page.get_by_label("Путь подготовки рекламных кампаний").locator("li")
                self.assertEqual(["Завершён"] * 5, stages.locator("small").all_inner_texts())
                self.assertTrue(page.locator(".publication-review-boundary").is_visible())
                self.assertIn("не создаёт и не изменяет кампании", page.locator(".publication-review-boundary").inner_text())
                page.locator(".owner-result-provenance summary").click()
                provenance = page.locator(".owner-result-provenance")
                self.assertEqual(2, provenance.locator(".owner-result-pairs article").count())
                self.assertIn("Непроверенный результат отброшен", provenance.inner_text())
                self.assertIn("Повтор с попытки 2", provenance.inner_text())
                self.assertIn("Внешняя запись не выполнялась", page.locator("body").inner_text())

                visible_copy = page.locator("body").inner_text().lower()
                for forbidden in [*TECHNICAL_NOISE_DENYLIST, "sha256:", "provider_ids", "campaigns.add", "oauth", "cookie"]:
                    self.assertNotIn(forbidden.lower(), visible_copy)
                assert_no_horizontal_overflow(self, page)
                self.assertEqual([], console_errors)
                self.assertEqual([], page_errors)
                self.assertEqual([], nonlocal_requests)
                browser.close()


if __name__ == "__main__":
    unittest.main()
