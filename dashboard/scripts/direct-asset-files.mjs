import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { imageSize } from "image-size";

export async function inspectDirectImage(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > 10_000_000) throw new Error("Изображение должно быть файлом до 10 МБ.");
  const bytes = await readFile(path), measured = imageSize(bytes);
  const format = { png: "PNG", jpg: "JPEG", jpeg: "JPEG", gif: "GIF" }[measured.type];
  if (!format) throw new Error("Для Директа нужен фактический PNG, JPEG или GIF, а не переименованный исходник.");
  return { format, width: measured.width, height: measured.height, bytes: bytes.length, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

export async function verifyLocalFormationAssets(portfolio, publicDirectory) {
  const used = new Set(portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads.flatMap(a => a.image_ids))));
  for (const image of portfolio.images) {
    if (!used.has(image.id) || !image.url.startsWith("/campaign-assets/")) continue;
    const file = image.url.slice("/campaign-assets/".length);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(file)) throw new Error("Недопустимый путь изображения кампании.");
    const actual = await inspectDirectImage(join(publicDirectory, "campaign-assets", file));
    if (!image.asset || Object.entries(actual).some(([key, value]) => image.asset[key] !== value)) throw new Error(`${image.id}: фактическое изображение не совпадает с размерами, форматом или SHA-256 кандидата. Проверьте файл и пересоберите результат.`);
  }
}
