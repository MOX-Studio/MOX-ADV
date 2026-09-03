from __future__ import annotations

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
SOURCE = ROOT / "dashboard"
VIEWPORT = {"width": 1920, "height": 1080}


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
    (target / ".env.local").write_text(
        "\n".join(
            [
                f"P0_E2E_FIXTURE_SCENARIO={scenario}",
                "P0_AGENT_PROVIDER=codex-subscription",
                "P0_AGENT_MODEL=gpt-5-mini",
                "P0_CODEX_BRIDGE_URL=http://127.0.0.1:9/",
                "P0_CODEX_BRIDGE_TOKEN=e2e-unused",
                "",
            ]
        ),
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
    def test_owner_dashboard_opens_with_the_five_stages_and_without_removed_top_panels(self) -> None:
        with production_candidate_server() as base_url:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport=VIEWPORT)
                console_errors: list[str] = []
                page_errors: list[str] = []
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                page.on("pageerror", lambda error: page_errors.append(str(error)))

                page.goto(base_url, wait_until="networkidle")
                stage_path = page.get_by_label("Путь подготовки рекламных кампаний")
                stage_path.wait_for(state="visible")
                stages = stage_path.locator("li")
                self.assertEqual(
                    ["Цели", "Сбор сведений", "Стратегия", "Кампании", "Проверка публикации"],
                    stages.locator("strong").all_inner_texts(),
                )
                self.assertEqual(
                    ["Требует уточнения", "Ожидает", "Ожидает", "Ожидает", "Ожидает"],
                    stages.locator("small").all_inner_texts(),
                )
                self.assertEqual(0, page.locator(".owner-pipeline-control").count())
                self.assertEqual(0, page.locator(".owner-result-questions").count())
                self.assertEqual(0, page.locator(".owner-outcome").count())
                self.assertNotIn("P0 · ПРОИЗВОДСТВЕННЫЙ МОДУЛЬ", page.locator("body").inner_text())
                self.assertFalse(page.locator(".pipeline-readonly-boundary").evaluate("element => element.disabled"))
                assert_no_horizontal_overflow(self, page)
                self.assertEqual([], console_errors)
                self.assertEqual([], page_errors)
                browser.close()


if __name__ == "__main__":
    unittest.main()
