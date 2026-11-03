#!/usr/bin/env node
/**
 * make-photo-fixtures.mjs: draw "photos" of printed pages for the OCR and scan tests.
 *
 *   node scripts/make-photo-fixtures.mjs
 *
 * Pages in Arabic, French, English and mixed, some tilted, dark or grainy, plus one very
 * large image. They are rendered by Chromium, so they are cleaner than real phone photos:
 * add real photos to tests/fixtures/photos/ when you have them. Output is committed so
 * tests do not depend on this script.
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('tests/fixtures/photos');
fs.mkdirSync(OUT, {recursive: true});
const font = fs.readFileSync(path.resolve('public/fonts/noto-arabic.ttf')).toString('base64');
const AR = `بسم الله الرحمن الرحيم. هذه صفحة اختبار لتطبيق العدسة. يحتوي هذا المستند على فقرة عربية طويلة لقياس جودة التعرف الضوئي على الحروف. الرقم المرجعي: ٢٠٢٦-١١-٠٣. العنوان: شارع الحرية، الرباط. المبلغ الإجمالي: 1250 درهم.`;
const FR = `Facture n° 2026-1103. Société Exemple SARL, 12 rue de la Liberté, 75011 Paris. Désignation : prestation de conseil, quantité 3, prix unitaire 400,00 €, total HT 1 200,00 €, TVA 20 % 240,00 €, total TTC 1 440,00 €. Échéance : 30 novembre 2026. Merci de votre confiance.`;
const EN = `Rental agreement. This document confirms that the tenant agrees to pay 850 EUR per month, due on the first day of each month. Signed in Rabat on 3 November 2026. Reference LN-4471.`;
function page(body, {rot = 0, bright = 1, dir = 'ltr', noise = false, skew = 0}) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Noto;src:url(data:font/ttf;base64,${font})}
    html,body{margin:0;background:#3a3630;width:1600px;height:2200px;overflow:hidden}
    .paper{position:absolute;left:170px;top:220px;width:1240px;height:1700px;background:#f6f2e8;padding:90px;box-sizing:border-box;
      transform:rotate(${rot}deg) skewY(${skew}deg);box-shadow:0 30px 60px rgba(0,0,0,.5);font-family:Noto,'Noto Naskh Arabic','DejaVu Serif',serif;color:#1a1a1a;direction:${dir}}
    h1{font-size:46px;margin:0 0 30px} p{font-size:34px;line-height:1.7;margin:0 0 26px;text-align:justify}
    .shade{position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,0,0,${1 - bright}) 0%,rgba(0,0,0,${(1 - bright) * 0.4}) 60%,rgba(0,0,0,${1 - bright}) 100%)}
    ${noise ? '.grain{position:absolute;inset:0;background-image:repeating-radial-gradient(circle at 30% 20%,rgba(0,0,0,.06) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}' : ''}
    </style></head><body><div class="paper">${body}</div><div class="shade"></div>${noise ? '<div class="grain"></div>' : ''}</body></html>`;
}
const fixtures = [
    ['arabic-clean', page(`<h1>وثيقة اختبار</h1><p>${AR}</p><p>${AR}</p>`, {dir: 'rtl', bright: .95})],
    ['french-invoice', page(`<h1>Facture</h1><p>${FR}</p><p>${FR}</p>`, {bright: .95})],
    ['mixed-ar-fr-tilted', page(`<h1>عقد / Contrat</h1><p dir="rtl">${AR}</p><p dir="ltr">${FR}</p><p dir="ltr">${EN}</p>`, {rot: 7, skew: 2, bright: .85})],
    ['english-dark-lowlight', page(`<h1>Agreement</h1><p>${EN}</p><p>${EN}</p><p>${EN}</p>`, {rot: -3, bright: .45, noise: true})],
    ['arabic-dark-tilted', page(`<h1>إيصال</h1><p>${AR}</p><p>${AR}</p><p>${AR}</p>`, {dir: 'rtl', rot: 9, bright: .5, noise: true})],
];
const browser = await chromium.launch();
const pg = await browser.newPage({viewport: {width: 1600, height: 2200}});
for (const [name, html] of fixtures) {
    await pg.setContent(html);
    await pg.waitForTimeout(200);
    await pg.screenshot({path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 88});
    console.log('wrote', name);
}
// Very large image (6000x8000) for memory test
await pg.setViewportSize({width: 6000, height: 8000});
await pg.setContent(page(`<h1 style="font-size:160px">Large</h1><p style="font-size:120px">${EN}</p>`, {bright: .9}).replace('width:1600px;height:2200px', 'width:6000px;height:8000px').replace('left:170px;top:220px;width:1240px;height:1700px', 'left:500px;top:600px;width:5000px;height:6800px'));
await pg.screenshot({path: `${OUT}/huge-6000x8000.jpg`, type: 'jpeg', quality: 92});
await browser.close();
