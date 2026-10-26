import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// No package install, network connection or user transaction files are required.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file, encoding = 'utf8') => readFile(path.join(root, file), encoding);
const utf8 = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) {
  throw new Error('Usage: node scripts/build.mjs [--check]');
}

const manifest = JSON.parse(await read('vendor/manifest.json'));
for (const dependency of manifest.dependencies) {
  const bytes = await read(dependency.file, null);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== dependency.sha256) {
    throw new Error(`Vendor integrity mismatch: ${dependency.file}`);
  }
}

const [template, baseStyles, font, chart, data, app, analytics, reports, reportStyles] = await Promise.all([
  read('src/template.html'), read('src/styles.css'),
  read('vendor/vazirmatn/Vazirmatn-variable.woff2', null),
  read('vendor/chart.js/chart.umd.min.js'), read('src/data.js'), read('src/app.js'),
  read('src/analytics.js'), read('src/analytics-view.js'), read('src/analytics.css'),
]);
const styles = `${baseStyles}\n${reportStyles}`;
if (/<\/style/i.test(styles)) throw new Error('Unexpected closing style tag in CSS');

// The browser HTML parser recognizes script end tags even inside JS strings.
const inlineScript = (source) => utf8(source)
  .replace(/^\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
  .replace(/<\/script/gi, (match) => match.replace('/', '\\/'));
const replacements = {
  STYLES: utf8(styles),
  FONT_DATA: font.toString('base64'),
  CHART_JS: inlineScript(chart),
  DATA_JS: inlineScript(data),
  ANALYTICS_JS: inlineScript(analytics),
  REPORTS_JS: inlineScript(reports),
  APP_JS: inlineScript(app),
};
let html = utf8(template);
// FONT_DATA may live in the stylesheet instead of the HTML template.
replacements.STYLES = replacements.STYLES.replaceAll('{{FONT_DATA}}', replacements.FONT_DATA);
for (const key of ['STYLES', 'CHART_JS', 'DATA_JS', 'ANALYTICS_JS', 'REPORTS_JS', 'APP_JS']) {
  if (!html.includes(`{{${key}}}`)) throw new Error(`Missing template token: ${key}`);
}
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => {
  if (!(key in replacements)) throw new Error(`Unknown template token: ${token}`);
  return replacements[key];
});
if (/\{\{(?:STYLES|FONT_DATA|CHART_JS|DATA_JS|ANALYTICS_JS|REPORTS_JS|APP_JS)\}\}/.test(html)) {
  throw new Error('Build contains unresolved template tokens');
}

// Carry the complete licenses with the deliverable, not only the source tree.
const licenses = await Promise.all(manifest.dependencies.map(async (dependency) => ({
  name: dependency.name,
  version: dependency.version,
  license: dependency.license,
  source: dependency.source,
  texts: await Promise.all(dependency.licenseFiles.map(async (file) => utf8(await read(file)))),
})));
const licenseJson = JSON.stringify(licenses).replace(/</g, '\\u003c');
if (!/<\/head>/i.test(html)) throw new Error('Template is missing the closing head tag');
html = html.replace(/<\/head>/i, () => `<script type="application/json" id="third-party-licenses">${licenseJson}</script>\n</head>`);
if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\brel\s*=\s*["']stylesheet/i.test(html)) {
  throw new Error('Deliverable must not depend on external scripts or stylesheets');
}
if (!html.endsWith('\n')) html += '\n';

if (args.includes('--check')) {
  const current = await read('index.html');
  if (current !== html) throw new Error('index.html is stale. Run npm run build.');
  console.log('index.html matches the source and verified vendored dependencies.');
} else {
  await writeFile(path.join(root, 'index.html'), html, 'utf8');
  console.log(`Built index.html (${new Intl.NumberFormat('en').format(Buffer.byteLength(html))} bytes).`);
}
