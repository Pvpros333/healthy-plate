import { BUILTIN_FOODS, unitsFor, toGrams, nutrientsFor, formatPortion, foodFromLabel } from './foods.js';
import { DIETS, SCHEDULES, getDiet, getSchedule } from './diets.js';
import { dailyTargets, sumNutrients, ACTIVITY_LEVELS, GOALS } from './nutrition.js';
import { planDay } from './planner.js';
import { load, save, exportJSON, importJSON, newId } from './storage.js';
import { searchUSDA } from './usda.js';

// ---------- state ----------
let state = load();
const ui = {
  tab: 'today',
  date: todayStr(),
  lookup: { query: '', usda: [], usdaStatus: '' },
  editing: null, // profile id being edited, or 'new'
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const modal = $('#modal');
const modalBody = $('#modalBody');

function persist() {
  if (!save(state)) toast('Could not save — browser storage is full or blocked.');
}

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDate(str, days) {
  const [y, m, d] = str.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + days));
}
function prettyDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (str === todayStr()) return 'Today · ' + label;
  if (str === shiftDate(todayStr(), 1)) return 'Tomorrow · ' + label;
  if (str === shiftDate(todayStr(), -1)) return 'Yesterday · ' + label;
  return label;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r = (x) => Math.round(x || 0);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function allFoods() {
  return [...BUILTIN_FOODS, ...state.customFoods];
}
function foodById(id) {
  return allFoods().find((f) => f.id === id);
}
function active() {
  return state.profiles.find((p) => p.id === state.activeId) || state.profiles[0];
}
function targetsFor(p) {
  return dailyTargets(p, getDiet(p.diet));
}
function dayLog(p, date) {
  return ((state.logs[p.id] ||= {})[date] ||= []);
}
function variants(p, date) {
  return ((state.planVariants[p.id] ||= {})[date] ||= {});
}
function planFor(p, date) {
  const v = variants(p, date);
  const { all = 0, ...mealVariants } = v;
  return planDay({
    profile: p, diet: getDiet(p.diet), schedule: getSchedule(p.schedule), targets: targetsFor(p),
    foods: allFoods(), date, variant: all, mealVariants,
  });
}
function logTotals(entries) {
  return sumNutrients(entries.map((e) => {
    const f = foodById(e.foodId);
    return f ? nutrientsFor(f, e.grams) : {};
  }));
}

// ---------- rendering ----------
function render() {
  const p = active();
  $('#tabbar').hidden = !p;
  $('#userChip').hidden = !p;
  if (p) $('#userChip').textContent = '👤 ' + p.name;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));

  if (!p || ui.editing === 'new') view.innerHTML = profileForm(null);
  else if (ui.tab === 'today') view.innerHTML = todayView(p);
  else if (ui.tab === 'lookup') view.innerHTML = lookupView();
  else if (ui.tab === 'foods') view.innerHTML = foodsView(p);
  else if (ui.tab === 'diets') view.innerHTML = dietsView(p);
  else if (ui.tab === 'profile') view.innerHTML = ui.editing ? profileForm(p) : profileView(p);
  if (ui.tab === 'lookup') renderLookupResults();
}

function macroLine(n) {
  return `<div class="macros"><span><b>${r(n.kcal)}</b> kcal</span><span><i class="dot p"></i><b>${r(n.protein)}</b>g protein</span><span><i class="dot c"></i><b>${r(n.carbs)}</b>g carbs</span><span><i class="dot f"></i><b>${r(n.fat)}</b>g fat</span></div>`;
}

function bar(label, have, want, cls = '', unit = 'g', lowerIsBetter = false) {
  const pct = want ? Math.min(100, (have / want) * 100) : 0;
  const over = lowerIsBetter ? have > want : have > want * 1.1;
  return `<div class="bar ${cls} ${over ? 'over' : ''}"><div class="row spread"><span>${label}</span><span>${r(have)} / ${r(want)}${unit}</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}

function todayView(p) {
  const t = targetsFor(p);
  const plan = planFor(p, ui.date);
  const log = dayLog(p, ui.date);
  const eaten = logTotals(log);
  const left = t.kcal - eaten.kcal;
  const schedule = getSchedule(p.schedule);
  const diet = getDiet(p.diet);

  const mealCards = plan.meals.map((m) => {
    const logged = log.some((e) => e.fromPlan === m.id);
    return `<div class="card">
      <div class="meal-head"><span class="meal-label">${esc(m.label)}</span><span class="small muted">${r(m.totals.kcal)} kcal</span></div>
      <h3>${esc(m.title)}</h3>
      <ul class="items">${m.items.map((i) => `<li><span>${esc(i.food.name)}</span><span class="qty">${esc(formatPortion(i.food, i.grams))}</span></li>`).join('')}</ul>
      ${macroLine(m.totals)}
      <div class="row" style="margin-top:10px">
        ${logged ? '<span class="tag">✓ Logged</span>' : `<button class="btn small primary" data-action="ateMeal" data-meal="${m.id}">I ate this</button>`}
        <button class="btn small" data-action="swapMeal" data-meal="${m.id}">Swap meal</button>
      </div>
    </div>`;
  }).join('');

  const byMeal = {};
  for (const e of log) (byMeal[e.meal] ||= []).push(e);
  const mealLabel = (id) => schedule.meals.find((m) => m.id === id)?.label || (id === 'other' ? 'Other' : id);
  const logHtml = log.length
    ? Object.entries(byMeal).map(([meal, entries]) => `<div class="card"><div class="meal-label">${esc(mealLabel(meal))}</div><ul class="items">${entries.map((e) => {
        const f = foodById(e.foodId);
        if (!f) return '';
        const n = nutrientsFor(f, e.grams);
        return `<li><span class="grow">${esc(f.name)}<br><span class="small muted">${esc(formatPortion(f, e.grams))} · ${r(n.kcal)} kcal · ${r(n.protein)}g P</span></span><button class="btn small ghost danger" data-action="removeLog" data-id="${e.id}" aria-label="Remove">✕</button></li>`;
      }).join('')}</ul></div>`).join('')
    : '<p class="muted">Nothing logged yet. Tap “I ate this” on a meal, or look up a food to add it.</p>';

  return `
  <div class="datebar">
    <button class="btn small" data-action="date" data-delta="-1" aria-label="Previous day">‹</button>
    <strong>${prettyDate(ui.date)}</strong>
    <button class="btn small" data-action="date" data-delta="1" aria-label="Next day">›</button>
  </div>
  <div class="card">
    <div class="row spread">
      <div><div class="kcal-big">${r(Math.abs(left))}</div><div class="small muted">${left >= 0 ? 'calories left' : 'calories over'} of ${t.kcal}</div></div>
      <div class="small muted" style="text-align:right">${esc(diet.name)}<br>${esc(schedule.name)}</div>
    </div>
    <div class="bars" style="margin-top:12px">
      ${bar('Calories', eaten.kcal, t.kcal, '', '')}
      ${bar('Protein', eaten.protein, t.protein, 'p')}
      ${bar('Carbs', eaten.carbs, t.carbs, 'c')}
      ${bar('Fat', eaten.fat, t.fat, 'f')}
      ${bar('Fiber', eaten.fiber, t.fiber)}
      ${bar('Sodium', eaten.sodium, t.sodium, '', 'mg', true)}
    </div>
  </div>

  <div class="row spread"><h2>Meal plan</h2>
    <div class="row"><button class="btn small" data-action="shuffleDay">New plan</button><button class="btn small" data-action="shopping">Shopping list</button></div>
  </div>
  ${schedule.note ? `<p class="small muted">${esc(schedule.note)}</p>` : ''}
  <p class="small muted">Plan total: ${r(plan.totals.kcal)} kcal · ${r(plan.totals.protein)}g protein · ${r(plan.totals.carbs)}g carbs · ${r(plan.totals.fat)}g fat</p>
  ${(p.liked || []).length < 5 ? `<p class="notice">Tip: pick the foods you like in <a href="#" data-action="go" data-tab="foods">My Foods</a> and plans will use only those.</p>` : ''}
  ${mealCards}

  <div class="row spread"><h2>What I ate</h2><button class="btn small" data-action="go" data-tab="lookup">+ Add food</button></div>
  ${logHtml}`;
}

function shoppingList(p) {
  const totals = new Map();
  for (let i = 0; i < 7; i++) {
    for (const m of planFor(p, shiftDate(ui.date, i)).meals) {
      for (const it of m.items) totals.set(it.food.id, (totals.get(it.food.id) || 0) + it.grams);
    }
  }
  const groups = { protein: 'Protein', carb: 'Grains, beans & starches', veg: 'Vegetables', fruit: 'Fruit', fat: 'Fats, nuts & cheese', other: 'Other' };
  const rows = Object.entries(groups).map(([role, label]) => {
    const items = [...totals].map(([id, g]) => ({ food: foodById(id), g })).filter((x) => x.food && x.food.role === role);
    if (!items.length) return '';
    return `<h3 style="margin-top:14px">${label}</h3><ul class="items">${items.map(({ food, g }) => {
      const lb = g / 453.592;
      const amt = food.role === 'protein' && food.show === 'oz' ? `${lb.toFixed(1)} lb` : formatPortion(food, g);
      return `<li><span>${esc(food.name)}</span><span class="qty">${esc(amt)}</span></li>`;
    }).join('')}</ul>`;
  }).join('');
  return `<div class="row spread"><h2 style="margin:0">Shopping list</h2><button class="btn small" data-action="closeModal">Close</button></div>
    <p class="small muted">For ${esc(p.name)}'s plan, ${prettyDate(ui.date)} + 6 days. Amounts are cooked weights for meat, rice, pasta and beans.</p>${rows}`;
}

// ---------- lookup ----------
function lookupView() {
  return `<h1>Food lookup</h1>
  <p class="muted small">Type a food, pick it, then enter how much to see the nutrition.</p>
  <input type="search" id="lookupQuery" placeholder="e.g. chicken breast, oats, banana" value="${esc(ui.lookup.query)}" autocomplete="off">
  <div id="lookupResults"></div>
  <div class="row" style="margin-top:16px"><button class="btn" data-action="customFood">+ Add a food from its nutrition label</button></div>`;
}

function renderLookupResults() {
  const box = $('#lookupResults');
  if (!box) return;
  const q = ui.lookup.query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const local = words.length ? allFoods().filter((f) => words.every((w) => f.name.toLowerCase().includes(w))) : [];
  const li = (f, extra = '') => `<li data-action="openFood" data-id="${esc(f.id)}"><div>${esc(f.name)}</div><div class="small muted">${r(f.kcal)} kcal · ${r(f.protein)}g P · ${r(f.carbs)}g C · ${r(f.fat)}g F per 100 g${extra}</div></li>`;
  box.innerHTML = !q
    ? '<p class="small muted">Over 70 common foods are built in. Search USDA for anything else, including brand-name products.</p>'
    : `${local.length ? `<h2>My foods & built-in</h2><ul class="results">${local.slice(0, 30).map((f) => li(f)).join('')}</ul>` : '<p class="muted">No built-in match.</p>'}
       <div class="row" style="margin:12px 0"><button class="btn primary" data-action="usdaSearch">Search USDA for “${esc(ui.lookup.query.trim())}”</button><span class="small muted">${esc(ui.lookup.usdaStatus)}</span></div>
       ${ui.lookup.usda.length ? `<h2>USDA results</h2><ul class="results">${ui.lookup.usda.map((f) => li(f, f.source === 'Branded' ? ' · brand' : '')).join('')}</ul>` : ''}`;
}

let modalFood = null;
function openFoodModal(food) {
  modalFood = food;
  const units = Object.keys(unitsFor(food));
  const defUnit = food.show && units.includes(food.show) ? food.show : 'g';
  const p = active();
  const meals = getSchedule(p.schedule).meals;
  const liked = (p.liked || []).includes(food.id);
  modalBody.innerHTML = `
    <div class="row spread"><h2 style="margin:0">${esc(food.name)}</h2><button class="btn small" data-action="closeModal">Close</button></div>
    ${food.servingText ? `<p class="small muted">Label serving: ${esc(food.servingText)}</p>` : ''}
    <div class="grid2">
      <div><label for="fqty">Amount</label><input id="fqty" type="number" inputmode="decimal" min="0" step="any" value="${defUnit === 'g' ? 100 : 1}"></div>
      <div><label for="funit">Unit</label><select id="funit">${units.map((u) => `<option ${u === defUnit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
    </div>
    <div id="fnut" style="margin-top:12px"></div>
    <label for="fmeal">Add to ${esc(p.name)}'s log for ${prettyDate(ui.date)}</label>
    <div class="row"><select id="fmeal" class="grow" style="width:auto">${meals.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}<option value="other">Other</option></select>
      <button class="btn primary" data-action="logFood">Add</button></div>
    ${food.role !== 'other' || food.custom ? `<div class="row" style="margin-top:12px"><button class="btn small" data-action="toggleLikeModal">${liked ? '★ Liked — used in plans' : '☆ I like this (use in plans)'}</button></div>` : ''}`;
  updateFoodModal();
  if (!modal.open) modal.showModal();
}

function updateFoodModal() {
  if (!modalFood) return;
  const qty = parseFloat($('#fqty').value) || 0;
  const g = toGrams(modalFood, qty, $('#funit').value);
  const n = nutrientsFor(modalFood, g);
  $('#fnut').innerHTML = `<p class="small muted">${r(g)} g</p><table class="nut">
    <tr><td>Calories</td><td>${r(n.kcal)}</td></tr>
    <tr><td><i class="dot p"></i>Protein</td><td>${n.protein.toFixed(1)} g</td></tr>
    <tr><td><i class="dot c"></i>Carbs</td><td>${n.carbs.toFixed(1)} g</td></tr>
    <tr><td><i class="dot f"></i>Fat</td><td>${n.fat.toFixed(1)} g</td></tr>
    <tr><td>Fiber</td><td>${n.fiber.toFixed(1)} g</td></tr>
    <tr><td>Sodium</td><td>${r(n.sodium)} mg</td></tr></table>`;
}

function customFoodModal() {
  modalFood = null;
  modalBody.innerHTML = `
    <div class="row spread"><h2 style="margin:0">Add a food</h2><button class="btn small" data-action="closeModal">Close</button></div>
    <p class="small muted">Copy the numbers from the package's Nutrition Facts label.</p>
    <form id="customForm">
      <label>Name</label><input type="text" name="name" required placeholder="e.g. Wife's turkey chili">
      <div class="grid2">
        <div><label>Serving size (grams)</label><input type="number" name="servingG" required min="1" step="any" inputmode="decimal"></div>
        <div><label>Serving name (optional)</label><input type="text" name="servingName" placeholder="bowl, bar, cup…"></div>
      </div>
      <div class="grid3">
        <div><label>Calories</label><input type="number" name="kcal" required min="0" step="any" inputmode="decimal"></div>
        <div><label>Protein g</label><input type="number" name="protein" required min="0" step="any" inputmode="decimal"></div>
        <div><label>Carbs g</label><input type="number" name="carbs" required min="0" step="any" inputmode="decimal"></div>
        <div><label>Fat g</label><input type="number" name="fat" required min="0" step="any" inputmode="decimal"></div>
        <div><label>Fiber g</label><input type="number" name="fiber" min="0" step="any" inputmode="decimal"></div>
        <div><label>Sodium mg</label><input type="number" name="sodium" min="0" step="any" inputmode="decimal"></div>
      </div>
      <label>Use it in meal plans as</label>
      <select name="role"><option value="other">Don't plan it (just for logging)</option><option value="protein">Protein</option><option value="carb">Carb / starch</option><option value="veg">Vegetable</option><option value="fruit">Fruit</option><option value="fat">Fat / snack</option></select>
      <label>For which meals</label>
      <div class="row"><label class="row" style="margin:0"><input type="checkbox" name="mb"> Breakfast</label><label class="row" style="margin:0"><input type="checkbox" name="mm" checked> Lunch/Dinner</label><label class="row" style="margin:0"><input type="checkbox" name="ms"> Snack</label></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Save food</button></div>
    </form>`;
  if (!modal.open) modal.showModal();
}

// ---------- my foods ----------
const ROLE_GROUPS = [['protein', 'Proteins'], ['carb', 'Carbs & starches'], ['fruit', 'Fruit'], ['veg', 'Vegetables'], ['fat', 'Fats, nuts, cheese & extras']];

function foodsView(p) {
  const liked = new Set(p.liked || []);
  const disliked = new Set(p.disliked || []);
  const diet = getDiet(p.diet);
  const chip = (f) => {
    const cls = liked.has(f.id) ? 'like' : disliked.has(f.id) ? 'dislike' : '';
    const offDiet = f.tags.some((t) => diet.exclude.includes(t));
    return `<button class="fchip ${cls}" data-action="cycleFood" data-id="${esc(f.id)}" title="${offDiet ? 'Not on ' + esc(diet.name) : ''}" ${offDiet ? 'style="opacity:.55"' : ''}>${esc(f.name.replace(/\s*\((cooked|raw|dry|drained)\)/i, ''))}</button>`;
  };
  const groups = ROLE_GROUPS.map(([role, label]) => {
    const fs = allFoods().filter((f) => f.role === role);
    return fs.length ? `<h2>${label}</h2><div class="chips">${fs.map(chip).join('')}</div>` : '';
  }).join('');
  const customs = state.customFoods;
  return `<h1>${esc(p.name)}'s foods</h1>
  <p class="muted">Tap once for <b>★ like</b>, twice for <b>✕ won't eat</b>, three times to clear. Meal plans are built from the foods you like. Faded foods aren't allowed on ${esc(diet.name)}.</p>
  <div class="card row spread"><span>Only plan foods I like<br><span class="small muted">${liked.size} liked · ${disliked.size} won't eat</span></span>
    <label class="row" style="margin:0"><input type="checkbox" data-action="onlyLiked" ${p.onlyLiked !== false ? 'checked' : ''}> On</label></div>
  ${groups}
  <h2>Foods you added</h2>
  ${customs.length ? `<ul class="items">${customs.map((f) => `<li><span>${esc(f.name)}<br><span class="small muted">${r(f.kcal)} kcal / 100 g${f.role !== 'other' ? ' · planned as ' + esc(f.role) : ''}</span></span><button class="btn small ghost danger" data-action="deleteCustom" data-id="${esc(f.id)}">Delete</button></li>`).join('')}</ul>` : '<p class="muted small">None yet. Add foods from Lookup (USDA search or a nutrition label).</p>'}
  <div class="row" style="margin-top:8px"><button class="btn" data-action="customFood">+ Add a food from its nutrition label</button></div>`;
}

// ---------- diets ----------
function dietsView(p) {
  const t = targetsFor(p);
  return `<h1>Diet & meal schedule</h1>
  <p class="muted">Pick what fits ${esc(p.name)}'s life. Every diet keeps protein high to hold on to muscle while losing fat.</p>
  <label for="schedSel">Meal schedule</label>
  <select id="schedSel" data-action="schedule">${SCHEDULES.map((s) => `<option value="${s.id}" ${s.id === p.schedule ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
  <div class="card"><b>${esc(p.name)}'s daily targets on ${esc(getDiet(p.diet).name)}</b>${macroLine(t)}</div>
  ${DIETS.map((d) => {
    const dt = dailyTargets(p, d);
    return `<div class="card diet ${d.id === p.diet ? 'selected' : ''}" data-action="pickDiet" data-id="${d.id}" role="button" tabindex="0">
      <div class="row spread"><h3>${esc(d.name)}</h3>${d.id === p.diet ? '<span class="tag">Selected</span>' : ''}</div>
      <p>${esc(d.summary)}</p>
      <p class="small muted">${esc(d.why)}</p>
      <div class="small muted">For you: ${r(dt.protein)}g protein · ${r(dt.carbs)}g carbs · ${r(dt.fat)}g fat${d.sodiumMaxMg ? ` · sodium under ${d.sodiumMaxMg} mg` : ''}</div>
    </div>`;
  }).join('')}
  <p class="notice">This app gives general guidance, not medical advice. Check with your doctor before big diet changes, especially keto or fasting if you take medication for blood sugar or blood pressure.</p>`;
}

// ---------- profile ----------
function profileForm(p) {
  const v = p || { name: '', sex: 'male', age: '', heightIn: '', weightLb: '', goalWeightLb: '', activity: 'moderate', liftDays: 3, goal: 'lose', lossRate: 1, diet: 'highprotein', schedule: 'three_snack' };
  const ft = v.heightIn ? Math.floor(v.heightIn / 12) : '';
  const inch = v.heightIn ? Math.round(v.heightIn % 12) : '';
  const opt = (list, cur) => list.map((x) => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.label || x.name)}</option>`).join('');
  const first = !state.profiles.length;
  return `<h1>${p ? 'Edit ' + esc(p.name) : first ? "Welcome! Let's set you up" : 'Add a person'}</h1>
  ${first ? '<p class="muted">Each person gets their own profile, targets, foods and plans. You can add more people later.</p>' : ''}
  <form id="profileForm" data-id="${p ? p.id : ''}">
    <label>Name</label><input type="text" name="name" required value="${esc(v.name)}">
    <div class="grid2">
      <div><label>Sex (for calorie math)</label><select name="sex"><option value="male" ${v.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${v.sex === 'female' ? 'selected' : ''}>Female</option></select></div>
      <div><label>Age</label><input type="number" name="age" required min="14" max="100" inputmode="numeric" value="${esc(v.age)}"></div>
      <div><label>Height (feet)</label><input type="number" name="ft" required min="3" max="8" inputmode="numeric" value="${ft}"></div>
      <div><label>Height (inches)</label><input type="number" name="in" min="0" max="11" inputmode="numeric" value="${inch}"></div>
      <div><label>Weight now (lb)</label><input type="number" name="weightLb" required min="70" max="800" step="0.1" inputmode="decimal" value="${esc(v.weightLb)}"></div>
      <div><label>Goal weight (lb)</label><input type="number" name="goalWeightLb" min="70" max="800" step="0.1" inputmode="decimal" value="${esc(v.goalWeightLb)}"></div>
    </div>
    <label>Activity (outside the gym counts too)</label><select name="activity">${opt(ACTIVITY_LEVELS, v.activity)}</select>
    <div class="grid2">
      <div><label>Strength training days / week</label><input type="number" name="liftDays" min="0" max="7" inputmode="numeric" value="${esc(v.liftDays)}"></div>
      <div><label>Goal</label><select name="goal">${opt(GOALS, v.goal)}</select></div>
    </div>
    <label>Weight loss pace (for “Lose fat”)</label>
    <select name="lossRate">${[0.5, 1, 1.5, 2].map((x) => `<option value="${x}" ${Number(v.lossRate) === x ? 'selected' : ''}>${x} lb per week${x === 1 ? ' (recommended)' : x === 2 ? ' (aggressive)' : ''}</option>`).join('')}</select>
    <div class="grid2">
      <div><label>Diet</label><select name="diet">${opt(DIETS, v.diet)}</select></div>
      <div><label>Meal schedule</label><select name="schedule">${opt(SCHEDULES, v.schedule)}</select></div>
    </div>
    <p class="notice">Calorie targets never go below a safe minimum, and the weekly loss is capped at 25% below maintenance. This is general guidance, not medical advice.</p>
    <div class="row"><button class="btn primary" type="submit">Save</button>${!first ? '<button class="btn" type="button" data-action="cancelEdit">Cancel</button>' : ''}</div>
  </form>`;
}

function profileView(p) {
  const t = targetsFor(p);
  const ws = (state.weights[p.id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const start = p.startWeightLb || (ws[0] && ws[0].lb) || p.weightLb;
  const latest = ws.length ? ws[ws.length - 1].lb : p.weightLb;
  const change = latest - start;
  return `<div class="row spread"><h1>${esc(p.name)}</h1><button class="btn small" data-action="editProfile">Edit</button></div>
  <div class="card">
    <div class="row spread"><b>Daily targets</b><span class="small muted">${esc(getDiet(p.diet).name)}</span></div>
    <div class="kcal-big" style="margin:8px 0">${t.kcal} <span class="small muted">kcal / day</span></div>
    ${macroLine(t)}
    <p class="small muted">Resting burn (BMR) ${t.bmr} · Maintenance (TDEE) ${t.tdee} · Fiber ${t.fiber}g+ · Sodium under ${t.sodium} mg</p>
  </div>

  <h2>Weight</h2>
  <div class="card">
    <div class="row spread"><span>Now <b>${latest} lb</b>${p.goalWeightLb ? ` · Goal ${p.goalWeightLb} lb` : ''}</span><span class="${change <= 0 ? '' : 'muted'}">${change <= 0 ? '▼' : '▲'} ${Math.abs(change).toFixed(1)} lb since ${start} lb</span></div>
    <form id="weightForm" class="row" style="margin-top:10px">
      <input type="number" name="lb" step="0.1" min="70" max="800" inputmode="decimal" placeholder="Today's weight (lb)" class="grow" style="width:auto" required>
      <button class="btn primary" type="submit">Log weight</button>
    </form>
    ${ws.length ? `<ul class="items" style="margin-top:10px">${ws.slice(-8).reverse().map((w) => `<li><span>${prettyDate(w.date)}</span><span class="qty">${w.lb} lb</span></li>`).join('')}</ul>` : '<p class="small muted">Weigh in once a week, same time of day, for the clearest trend. Your targets update with each new weight.</p>'}
  </div>

  <h2>People</h2>
  <div class="card"><ul class="items">${state.profiles.map((x) => `<li><span>${esc(x.name)}${x.id === p.id ? ' <span class="tag">Active</span>' : ''}</span><span class="row">${x.id !== p.id ? `<button class="btn small" data-action="switchProfile" data-id="${x.id}">Switch</button>` : ''}<button class="btn small ghost danger" data-action="deleteProfile" data-id="${x.id}">Delete</button></span></li>`).join('')}</ul>
    <button class="btn" data-action="addProfile">+ Add a person</button></div>

  <h2>Backup & move to another device</h2>
  <div class="card">
    <p class="small muted">Your data is saved only in this browser. To move it to your phone (or back up), download a backup here and restore it on the other device.</p>
    <div class="row"><button class="btn" data-action="exportData">Download backup</button>
      <label class="btn" style="margin:0;color:inherit">Restore backup<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
  </div>

  <h2>USDA food search</h2>
  <div class="card">
    <p class="small muted">Searches use the shared demo key, which has a low hourly limit. For heavy use, get a free key at fdc.nal.usda.gov/api-key-signup and paste it here.</p>
    <form id="usdaForm" class="row"><input type="text" name="key" class="grow" style="width:auto" placeholder="USDA API key (optional)" value="${esc(state.usdaKey)}" autocomplete="off"><button class="btn" type="submit">Save</button></form>
  </div>
  <p class="notice">General guidance, not medical advice. Talk to your doctor before major diet changes.</p>`;
}

// ---------- actions ----------
function updateProfile(p, changes) {
  Object.assign(p, changes);
  persist();
  render();
}

const actions = {
  go(el) {
    ui.tab = el.dataset.tab;
    ui.editing = null;
    render();
    window.scrollTo(0, 0);
  },
  date(el) {
    ui.date = shiftDate(ui.date, Number(el.dataset.delta));
    render();
  },
  shuffleDay() {
    const v = variants(active(), ui.date);
    v.all = (v.all || 0) + 1;
    for (const k of Object.keys(v)) if (k !== 'all') delete v[k];
    persist();
    render();
  },
  swapMeal(el) {
    const v = variants(active(), ui.date);
    v[el.dataset.meal] = (v[el.dataset.meal] || 0) + 1;
    persist();
    render();
  },
  ateMeal(el) {
    const p = active();
    const meal = planFor(p, ui.date).meals.find((m) => m.id === el.dataset.meal);
    if (!meal) return;
    const log = dayLog(p, ui.date);
    for (const it of meal.items) log.push({ id: newId('log'), foodId: it.food.id, grams: it.grams, meal: meal.id, fromPlan: meal.id });
    persist();
    render();
    toast(`${meal.label} logged`);
  },
  removeLog(el) {
    const p = active();
    const log = dayLog(p, ui.date);
    const i = log.findIndex((e) => e.id === el.dataset.id);
    if (i >= 0) log.splice(i, 1);
    persist();
    render();
  },
  shopping() {
    modalBody.innerHTML = shoppingList(active());
    modal.showModal();
  },
  closeModal() {
    modal.close();
  },
  openFood(el) {
    const id = el.dataset.id;
    const food = foodById(id) || ui.lookup.usda.find((f) => f.id === id);
    if (food) openFoodModal(food);
  },
  async usdaSearch() {
    const q = ui.lookup.query.trim();
    if (!q) return;
    ui.lookup.usdaStatus = 'Searching…';
    renderLookupResults();
    try {
      ui.lookup.usda = await searchUSDA(q, state.usdaKey);
      ui.lookup.usdaStatus = ui.lookup.usda.length ? '' : 'No USDA results.';
    } catch (e) {
      ui.lookup.usda = [];
      ui.lookup.usdaStatus = navigator.onLine === false ? "You're offline." : e.message;
    }
    renderLookupResults();
  },
  logFood() {
    const f = modalFood;
    if (!f) return;
    const qty = parseFloat($('#fqty').value) || 0;
    if (qty <= 0) return toast('Enter an amount first');
    if (!foodById(f.id)) state.customFoods.push({ ...f }); // keep USDA foods so the log can find them later
    const p = active();
    dayLog(p, ui.date).push({ id: newId('log'), foodId: f.id, grams: toGrams(f, qty, $('#funit').value), meal: $('#fmeal').value });
    persist();
    modal.close();
    toast(`Added to ${p.name}'s log`);
    render();
  },
  toggleLikeModal() {
    const f = modalFood;
    if (!f) return;
    toggleLike(active(), f.id);
    openFoodModal(f);
  },
  customFood() {
    customFoodModal();
  },
  cycleFood(el) {
    const p = active();
    const id = el.dataset.id;
    p.liked ||= [];
    p.disliked ||= [];
    if (p.liked.includes(id)) {
      p.liked = p.liked.filter((x) => x !== id);
      p.disliked.push(id);
    } else if (p.disliked.includes(id)) {
      p.disliked = p.disliked.filter((x) => x !== id);
    } else {
      p.liked.push(id);
    }
    persist();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  onlyLiked(el) {
    updateProfile(active(), { onlyLiked: el.checked });
  },
  deleteCustom(el) {
    const f = foodById(el.dataset.id);
    if (!f || !confirm(`Delete “${f.name}”? Past log entries using it will disappear from totals.`)) return;
    state.customFoods = state.customFoods.filter((x) => x.id !== f.id);
    persist();
    render();
  },
  pickDiet(el) {
    updateProfile(active(), { diet: el.dataset.id });
    toast(`${active().name} is now on ${getDiet(el.dataset.id).name}`);
  },
  schedule(el) {
    updateProfile(active(), { schedule: el.value });
  },
  editProfile() {
    ui.editing = active().id;
    render();
  },
  addProfile() {
    ui.editing = 'new';
    render();
  },
  cancelEdit() {
    ui.editing = null;
    render();
  },
  switchProfile(el) {
    state.activeId = el.dataset.id;
    persist();
    ui.tab = 'today';
    render();
    toast(`Switched to ${active().name}`);
  },
  deleteProfile(el) {
    const p = state.profiles.find((x) => x.id === el.dataset.id);
    if (!p || !confirm(`Delete ${p.name}'s profile, food log and weight history? This can't be undone (unless you have a backup).`)) return;
    state.profiles = state.profiles.filter((x) => x.id !== p.id);
    delete state.logs[p.id];
    delete state.weights[p.id];
    delete state.planVariants[p.id];
    if (state.activeId === p.id) state.activeId = state.profiles[0]?.id || null;
    persist();
    render();
  },
  exportData() {
    const blob = new Blob([exportJSON(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `healthy-plate-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

function toggleLike(p, id) {
  p.liked ||= [];
  p.disliked = (p.disliked || []).filter((x) => x !== id);
  p.liked = p.liked.includes(id) ? p.liked.filter((x) => x !== id) : [...p.liked, id];
  persist();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.diet[data-action]')) {
    e.preventDefault();
    actions.pickDiet(e.target);
  }
  if (e.key === 'Enter' && e.target.id === 'lookupQuery') actions.usdaSearch();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'onlyLiked') actions.onlyLiked(el);
  else if (el.dataset.action === 'schedule') actions.schedule(el);
  else if (el.id === 'funit') updateFoodModal();
  else if (el.id === 'importFile' && el.files[0]) {
    el.files[0].text().then((text) => {
      try {
        const next = importJSON(text);
        if (!confirm(`Replace all data on this device with the backup (${next.profiles.length} people)?`)) return;
        state = next;
        persist();
        ui.tab = 'today';
        render();
        toast('Backup restored');
      } catch (err) {
        toast(err.message || 'Could not read that file');
      }
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'lookupQuery') {
    ui.lookup.query = e.target.value;
    ui.lookup.usda = [];
    ui.lookup.usdaStatus = '';
    renderLookupResults();
  } else if (e.target.id === 'fqty') updateFoodModal();
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  const fd = new FormData(form);
  const num = (k) => (fd.get(k) === '' || fd.get(k) == null ? null : Number(fd.get(k)));

  if (form.id === 'profileForm') {
    const data = {
      name: fd.get('name').trim(),
      sex: fd.get('sex'),
      age: num('age'),
      heightIn: num('ft') * 12 + (num('in') || 0),
      weightLb: num('weightLb'),
      goalWeightLb: num('goalWeightLb'),
      activity: fd.get('activity'),
      liftDays: num('liftDays') || 0,
      goal: fd.get('goal'),
      lossRate: num('lossRate'),
      diet: fd.get('diet'),
      schedule: fd.get('schedule'),
    };
    const existing = state.profiles.find((x) => x.id === form.dataset.id);
    if (existing) {
      Object.assign(existing, data);
    } else {
      const p = { id: newId('p'), ...data, startWeightLb: data.weightLb, liked: [], disliked: [], onlyLiked: true };
      state.profiles.push(p);
      state.activeId = p.id;
      state.weights[p.id] = [{ date: todayStr(), lb: data.weightLb }];
      ui.tab = 'foods';
      toast('Now tap the foods you like');
    }
    ui.editing = null;
    persist();
    render();
    window.scrollTo(0, 0);
  } else if (form.id === 'weightForm') {
    const p = active();
    const lb = num('lb');
    const list = (state.weights[p.id] ||= []).filter((w) => w.date !== todayStr());
    list.push({ date: todayStr(), lb });
    state.weights[p.id] = list;
    p.weightLb = lb; // targets follow the latest weight
    persist();
    render();
    toast('Weight logged — targets updated');
  } else if (form.id === 'usdaForm') {
    state.usdaKey = fd.get('key').trim();
    persist();
    toast('Saved');
  } else if (form.id === 'customForm') {
    const meals = ['b', 'm', 's'].filter((m) => fd.get('m' + m)).join('');
    const food = foodFromLabel({
      name: fd.get('name').trim(),
      servingG: num('servingG'),
      servingName: fd.get('servingName').trim(),
      kcal: num('kcal'), protein: num('protein'), carbs: num('carbs'), fat: num('fat'),
      fiber: num('fiber') || 0, sodium: num('sodium') || 0,
      role: fd.get('role'),
      meals: fd.get('role') === 'other' ? '' : meals,
    });
    state.customFoods.push(food);
    if (food.role !== 'other') toggleLike(active(), food.id);
    persist();
    openFoodModal(food);
    render();
    toast('Food saved');
  }
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close(); // tap outside to close
});

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
