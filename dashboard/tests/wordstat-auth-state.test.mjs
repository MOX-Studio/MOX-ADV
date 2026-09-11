import assert from "node:assert/strict";
import test from "node:test";
import { wordstatChallengeText, hasWordstatChallenge } from "../scripts/wordstat-auth-state.mjs";

test("industrial robotics queries are not a security challenge", () => {
  for (const value of ["выставка роботов", "выставка промышленной робототехники", "робототехника и автоматизация", "робот", "captcha recognition software"]) assert.equal(wordstatChallengeText(value), false, value);
  for (const value of ["Подтвердите, что вы не робот", "Я не робот", "Проверка безопасности", "Verify that you are not a robot", "Confirm you are human"]) assert.equal(wordstatChallengeText(value), true, value);
});
test("real challenge routes and visible verification forms still stop collection", async () => {
  assert.equal(await hasWordstatChallenge({ url: () => "https://wordstat.yandex.com/showcaptcha?retpath=/" }), true);
  const empty = { count: async () => 0 };
  assert.equal(await hasWordstatChallenge({ url: () => "https://wordstat.yandex.com/", locator: () => ({ count: async () => 1, nth: () => ({ isVisible: async () => true }) }), getByText: () => empty }), true);
  assert.equal(await hasWordstatChallenge({ url: () => "https://wordstat.yandex.com/?words=робот", locator: () => empty, getByText: () => empty }), false);
});
