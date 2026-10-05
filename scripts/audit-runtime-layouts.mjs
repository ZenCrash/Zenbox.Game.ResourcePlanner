import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
const root = "data/extraction/instance/minecraft/dumps/planner";
const discovery = JSON.parse(fs.readFileSync(root + "/discovery.json"));
const out = "data/research/runtime-discovery";
fs.mkdirSync(out + "/backgrounds", { recursive: true });
const report = [];
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
for (const h of discovery.handlers) {
  const entry = {
    name: h.name,
    class: h.class,
    width: h.width,
    height: h.height,
    recipeCount: h.recipeCount,
    note: [...(h.inputs ?? []), ...(h.outputs ?? []), ...(h.other ?? [])].some(
      (slot) => slot.x < 0 || slot.y < 0,
    )
      ? "Some slots extend outside the capture origin; consult runtime coordinates and handler drawing code."
      : undefined,
    error: h.error ?? h.renderError ?? h.enumerationError,
  };
  report.push(entry);
  if (!h.background) continue;
  const original = path.join(root, "discovery-backgrounds", h.background);
  const { data, info } = await sharp(original)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!data.some((v, i) => i % 4 !== 3 && v > 0 && data[i - (i % 4) + 3] > 0)) {
    entry.error = "Blank capture rejected";
    continue;
  }
  const crop = {
    left: 0,
    top: 0,
    width: Math.min(info.width, h.width * 2),
    height: Math.min(info.height, h.height * 2),
  };
  await sharp(await sharp(original).flip().png().toBuffer())
    .extract(crop)
    .png()
    .toFile(out + "/backgrounds/" + h.background);
  entry.image = "backgrounds/" + h.background;
}
fs.writeFileSync(out + "/layouts.json", JSON.stringify(report, null, 2));
fs.writeFileSync(
  out + "/index.html",
  '<!doctype html><meta charset="utf-8"><title>GTNH runtime recipe backgrounds</title><style>body{font:16px system-ui;background:#141d29;color:#eee;margin:24px}main{display:flex;flex-wrap:wrap;gap:16px}article{background:#243347;padding:16px;width:350px}img{image-rendering:pixelated;max-width:100%;background:#c6c6c6}small{overflow-wrap:anywhere}input{font:inherit;padding:12px;margin-bottom:24px;width:320px}</style><h1>GTNH / Faithful recipe background references</h1><p>Captured from installed NEI handlers. Backgrounds exclude item overlays and dynamic extras; unsuccessful captures remain identified below.</p><input placeholder="Filter recipe types" oninput="document.querySelectorAll(\'article\').forEach(c=>c.hidden=!c.textContent.toLowerCase().includes(this.value.toLowerCase()))"><main>' +
    report
      .map(
        (h) =>
          "<article><h2>" +
          escape(h.name) +
          "</h2><small>" +
          escape(h.class) +
          "</small><p>" +
          escape(h.width) +
          " × " +
          escape(h.height) +
          " GUI pixels</p>" +
          (h.note ? "<p>" + escape(h.note) + "</p>" : "") +
          (h.image
            ? '<img src="' +
              escape(h.image) +
              '" alt="' +
              escape(h.name) +
              ' background">'
            : "<p>" +
              escape(h.error ?? "No enumerable recipe sample") +
              "</p>") +
          "</article>",
      )
      .join("") +
    "</main>",
);
console.log({
  handlers: report.length,
  verifiedNonblank: report.filter((h) => h.image).length,
  withoutCapture: report.filter((h) => !h.image).length,
});
