// Barcode lookup and camera scanning.
// Lookup: Open Food Facts first (free, worldwide), then USDA Branded foods by UPC as a fallback.
// Scanning: the browser's built-in BarcodeDetector where it exists (Chrome on Android), otherwise
// the ZXing library loaded on demand from a CDN (iPhone Safari has no BarcodeDetector).

import { searchUSDA } from './usda.js';

const OFF = 'https://world.openfoodfacts.org/api/v2/product/';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';

export function cleanCode(text) {
  const code = String(text || '').replace(/\D/g, '');
  return code.length >= 8 && code.length <= 14 ? code : null;
}

// Open Food Facts product → our food shape (per 100 g). Returns null if it has no usable nutrition.
export function offToFood(code, p) {
  const n = p?.nutriments || {};
  const num = (k) => (typeof n[k] === 'number' ? n[k] : Number(n[k]) || 0);
  let kcal = num('energy-kcal_100g');
  if (!kcal && num('energy_100g')) kcal = num('energy_100g') / 4.184; // kJ → kcal
  const protein = num('proteins_100g');
  const carbs = num('carbohydrates_100g');
  const fat = num('fat_100g');
  if (!kcal && !protein && !carbs && !fat) return null;
  if (!kcal) kcal = protein * 4 + carbs * 4 + fat * 9;
  const brand = (p.brands || '').split(',')[0].trim();
  const name = (p.product_name || p.generic_name || 'Scanned product').trim() + (brand ? ` (${brand})` : '');
  const units = {};
  let show = 'g';
  const sq = Number(p.serving_quantity);
  if (sq > 0) {
    units.serving = sq;
    show = 'serving';
  }
  return {
    id: 'off_' + code, name, role: 'other', meals: '',
    kcal, protein, carbs, fat,
    fiber: num('fiber_100g'),
    sodium: num('sodium_100g') * 1000, // g → mg
    tags: [], units, show,
    source: 'Open Food Facts', barcode: code,
    servingText: p.serving_size || '',
  };
}

export async function lookupBarcode(code, usdaKey) {
  try {
    const res = await fetch(`${OFF}${code}.json?fields=product_name,generic_name,brands,nutriments,serving_quantity,serving_size`);
    if (res.ok) {
      const data = await res.json();
      const food = data.status === 1 || data.product ? offToFood(code, data.product) : null;
      if (food) return food;
    }
  } catch {
    // fall through to USDA
  }
  try {
    const strip = (s) => String(s || '').replace(/^0+/, '');
    const hits = await searchUSDA(code, usdaKey);
    const hit = hits.find((f) => strip(f.gtinUpc) === strip(code));
    if (hit) return { ...hit, barcode: code };
  } catch {
    // no match
  }
  return null;
}

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('Could not load the scanner. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

// Starts the camera in `video` and calls onCode(code) once for the first barcode seen.
// Returns a stop() function. Throws with a readable message if the camera can't start.
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera. Type the number under the barcode instead.');
  let done = false;
  const finish = (code) => {
    if (done) return;
    done = true;
    onCode(code);
  };

  const native = 'BarcodeDetector' in window
    ? await window.BarcodeDetector.getSupportedFormats().then((f) => f.includes('ean_13')).catch(() => false)
    : false;

  if (native) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    let timer = setInterval(async () => {
      if (done || video.readyState < 2) return;
      try {
        const found = await detector.detect(video);
        const code = found.map((b) => cleanCode(b.rawValue)).find(Boolean);
        if (code) finish(code);
      } catch {
        // keep trying
      }
    }, 250);
    return () => {
      done = true;
      clearInterval(timer);
      timer = null;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }

  const ZXing = await loadZXing();
  const reader = new ZXing.BrowserMultiFormatReader();
  await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (result) => {
    const code = result && cleanCode(result.getText());
    if (code) finish(code);
  });
  return () => {
    done = true;
    reader.reset();
  };
}
