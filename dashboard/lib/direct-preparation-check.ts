import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";
import type { FormationViolation } from "./campaign-formation-method.ts";

export const DIRECT_PREPARATION_RULES = {
  version: "direct-preparation-2026-09-10",
  adType: "RESPONSIVE_AD",
  groupType: "UNIFIED_AD_GROUP",
  maximumNewAdsPerGroup: 3,
  weeklyMaxClicksMinimumRub: 300,
  imageFormats: ["PNG", "JPEG", "GIF"],
  maximumImageBytes: 10_000_000,
  sources: ["https://yandex.ru/dev/direct/doc/ru/objects/ad", "https://yandex.ru/dev/direct/doc/en/ads/add", "https://yandex.ru/support/direct/ru/efficiency/images", "https://yandex.ru/support/direct/ru/strategies/average-cpc"],
  scope: "STATIC_PREPARATION_CHECKS_ONLY",
} as const;

export type FormationImageAsset = { format: "PNG" | "JPEG" | "GIF"; width: number; height: number; bytes: number; sha256: string };

/** Preparation checks, separate from account-specific API mapping, moderation and launch authority. */
export function directPreparationIssues(portfolio: FormationPortfolio): FormationViolation[] {
  const issues: FormationViolation[] = [];
  for (const [index, campaign] of portfolio.campaigns.entries()) {
    if (campaign.bidding.type === "MAX_CLICKS" && campaign.weekly_budget_rub < DIRECT_PREPARATION_RULES.weeklyMaxClicksMinimumRub) issues.push({ code: "DIRECT_WEEKLY_BUDGET_BELOW_MINIMUM", pointer: `/campaigns/${index}/weekly_budget_rub`, message: "Для «Максимум кликов» недельный бюджет в рублях должен быть не менее 300 ₽. Исправьте распределение внутри общего бюджета, не увеличивая его." });
    for (const [groupIndex, group] of campaign.groups.entries()) if (group.ads.length > DIRECT_PREPARATION_RULES.maximumNewAdsPerGroup) issues.push({ code: "DIRECT_RESPONSIVE_ADS_PER_GROUP_EXCEEDED", pointer: `/campaigns/${index}/groups/${groupIndex}/ads`, message: "В одной группе можно создать до трёх неархивных комбинаторных объявлений. Объедините совместимые исполнения либо обоснуйте отдельную группу; старые примеры аккаунта не отменяют правило создания." });
  }
  const used = new Set(portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads.flatMap(a => a.image_ids))));
  for (const [index, image] of portfolio.images.entries()) {
    if (!used.has(image.id)) continue;
    const pointer = `/images/${index}`, asset = image.asset;
    const extension = new URL(image.url, "https://local.invalid").pathname.split(".").at(-1)?.toLowerCase();
    if (["svg", "webp", "avif", "heic", "pdf"].includes(extension ?? "") || (asset && !DIRECT_PREPARATION_RULES.imageFormats.includes(asset.format))) issues.push({ code: "DIRECT_IMAGE_FORMAT_UNSUPPORTED", pointer, message: "Для переноса нужны PNG, JPEG или GIF. SVG может оставаться исходником макета, но не загружаемым изображением объявления." });
    if (!asset) { issues.push({ code: "DIRECT_IMAGE_ASSET_UNVERIFIED", pointer, message: "Подготовьте изображение и сохраните его проверенные формат, размеры, объём и SHA-256." }); continue; }
    const ratio = asset.width / asset.height;
    const regular = asset.width >= 450 && asset.height >= 450 && asset.width <= 5000 && asset.height <= 5000 && ratio >= 3 / 4 && ratio <= 4 / 3;
    const wide = asset.width >= 1080 && asset.width <= 5000 && asset.height >= 607 && asset.height <= 2812 && Math.abs(asset.height - asset.width * 9 / 16) <= 1;
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || (!regular && !wide)) issues.push({ code: "DIRECT_IMAGE_DIMENSIONS_INVALID", pointer, message: "Нужны стандартные пропорции от 3:4 до 4:3, стороны 450–5000 px, либо 16:9 от 1080×607 до 5000×2812 px." });
    if (!Number.isInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > DIRECT_PREPARATION_RULES.maximumImageBytes || !/^sha256:[a-f0-9]{64}$/u.test(asset.sha256)) issues.push({ code: "DIRECT_IMAGE_ASSET_INVALID", pointer, message: "Укажите фактический размер файла до 10 МБ и его SHA-256. Эти значения повторно проверяются при упаковке локального материала." });
  }
  return issues;
}
