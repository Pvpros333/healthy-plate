// Food search against USDA FoodData Central (https://fdc.nal.usda.gov/api-guide).
// DEMO_KEY works but is rate-limited; a free personal key can be entered in Profile.

const API = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// nutrientNumber → our field
const MAP = { '208': 'kcal', '203': 'protein', '205': 'carbs', '204': 'fat', '291': 'fiber', '307': 'sodium' };

export function toFood(item) {
  const n = { kcal: null, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 };
  for (const fn of item.foodNutrients || []) {
    const field = MAP[String(fn.nutrientNumber)];
    if (field && typeof fn.value === 'number') {
      if (field === 'kcal' && fn.unitName && fn.unitName.toUpperCase() !== 'KCAL') continue;
      n[field] = fn.value;
    }
  }
  if (n.kcal == null) n.kcal = n.protein * 4 + n.carbs * 4 + n.fat * 9;

  const units = {};
  let show = 'g';
  const unit = (item.servingSizeUnit || '').toLowerCase();
  if (item.servingSize && (unit === 'g' || unit === 'grm' || unit === 'ml')) {
    units.serving = item.servingSize;
    show = 'serving';
  }
  const brand = item.brandName || item.brandOwner;
  const name = titleCase(item.description) + (brand ? ` (${titleCase(brand)})` : '');
  return {
    id: 'fdc_' + item.fdcId,
    name,
    role: 'other',
    meals: '',
    ...n,
    tags: [],
    units,
    show,
    source: item.dataType,
    servingText: item.householdServingFullText || '',
  };
}

function titleCase(s = '') {
  return s.toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

export async function searchUSDA(query, apiKey) {
  const params = new URLSearchParams({
    api_key: apiKey || 'DEMO_KEY',
    query,
    pageSize: '20',
    dataType: 'Foundation,SR Legacy,Branded',
  });
  const res = await fetch(`${API}?${params}`);
  if (res.status === 429) throw new Error('USDA search limit reached for now. Try again later, or add your own free API key in Profile.');
  if (!res.ok) throw new Error(`USDA search failed (${res.status}).`);
  const data = await res.json();
  return (data.foods || []).map(toFood);
}
