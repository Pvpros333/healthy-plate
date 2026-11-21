import { BUILTIN_FOODS, unitsFor, toGrams, nutrientsFor, formatPortion, foodFromLabel } from './foods.js';
import { DIETS, SCHEDULES, getDiet, getSchedule } from './diets.js';
import { dailyTargets, sumNutrients, ACTIVITY_LEVELS, GOALS, bodyFatNavy, composition, waterGoal, coachAdvice } from './nutrition.js';
import { planDay, pickSharedMeal } from './planner.js';
import { load, save, exportJSON, importJSON, newId } from './storage.js';
import { searchUSDA } from './usda.js';
import { recipeTotals, perServing, buildRecipeFood } from './recipes.js';
import { lookupBarcode, startScanner, cleanCode } from './barcode.js';

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
// 'gym' or 'rest' for a date: the person's override for that day, else their usual gym weekdays.
function dayTypeFor(p, date) {
  const o = state.dayType?.[p.id]?.[date];
  if (o) return o;
  const [y, m, d] = date.split('-').map(Number);
  return (p.gymDays || []).includes(new Date(y, m - 1, d).getDay()) ? 'gym' : 'rest';
}
function targetsFor(p, date = ui.date) {
  return dailyTargets(p, getDiet(p.diet), dayTypeFor(p, date));
}

// ---------- daily habits & water ----------
function waterFor(p, date) {
  return state.water?.[p.id]?.[date] || 0;
}
function vegServings(entries) {
  return entries.reduce((s, e) => {
    const f = foodById(e.foodId);
    return s + (f && (f.role === 'veg' || f.role === 'fruit') ? e.grams / 80 : 0);
  }, 0);
}
const HABITS = [
  { id: 'protein', label: 'Hit protein goal', auto: true },
  { id: 'calories', label: 'Stayed within calories', auto: true },
  { id: 'veg', label: '5+ servings of veggies & fruit', auto: true },
  { id: 'water', label: 'Drank my water', auto: true },
  { id: 'steps', label: '8,000+ steps' },
  { id: 'sleep', label: '7+ hours of sleep' },
  { id: 'workout', label: 'Workout or active day' },
];
function habitStatus(p, date) {
  const log = state.logs[p.id]?.[date] || [];
  const t = targetsFor(p, date);
  const eaten = logTotals(log);
  const manual = state.habits?.[p.id]?.[date] || {};
  return {
    protein: log.length > 0 && eaten.protein >= t.protein * 0.9,
    calories: log.length > 0 && eaten.kcal >= t.kcal * 0.7 && eaten.kcal <= t.kcal * 1.05,
    veg: vegServings(log) >= 5,
    water: waterFor(p, date) >= waterGoal(p),
    steps: Boolean(manual.steps),
    sleep: Boolean(manual.sleep),
    workout: Boolean(manual.workout),
  };
}

function habitsCard(p) {
  const today = habitStatus(p, ui.date);
  const week = Array.from({ length: 7 }, (_, i) => habitStatus(p, shiftDate(ui.date, -i)));
  const done = HABITS.filter((h) => today[h.id]).length;
  const water = waterFor(p, ui.date);
  const goal = waterGoal(p);
  return `<div class="card">
    <div class="row spread"><b>💧 Water</b><span class="small muted">${water} / ${goal} oz</span></div>
    <div class="bar"><div class="track"><div class="fill water" style="width:${Math.min(100, (water / goal) * 100)}%"></div></div></div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-action="water" data-oz="8">+ 8 oz glass</button><button class="btn small" data-action="water" data-oz="16">+ 16 oz bottle</button><button class="btn small ghost" data-action="water" data-oz="-8" aria-label="Remove 8 oz">− 8</button></div>
  </div>
  <div class="card">
    <div class="row spread"><b>Daily habits</b><span class="small muted">${done} of ${HABITS.length} today</span></div>
    <ul class="items habits">${HABITS.map((h) => {
      const n = week.filter((d) => d[h.id]).length;
      const box = h.auto
        ? `<span class="check ${today[h.id] ? 'on' : ''}" aria-hidden="true">${today[h.id] ? '✓' : ''}</span>`
        : `<input type="checkbox" data-action="habit" value="${h.id}" ${today[h.id] ? 'checked' : ''} aria-label="${esc(h.label)}">`;
      return `<li><label class="row" style="margin:0;color:inherit">${box} ${esc(h.label)}${h.auto ? ' <span class="small muted">(auto)</span>' : ''}</label><span class="small muted">${n}/7 days</span></li>`;
    }).join('')}</ul>
    <p class="small muted" style="margin:4px 0 0">Habits drive fat loss more than any single meal. Aim for most of these most days.</p>
  </div>`;
}
function dayLog(p, date) {
  return ((state.logs[p.id] ||= {})[date] ||= []);
}
function variants(p, date) {
  return ((state.planVariants[p.id] ||= {})[date] ||= {});
}
// ---------- shared household meals ----------
const SHARE_KEY = '__shared'; // planVariants[SHARE_KEY][date][mealId] = n
function household() {
  return (state.household ||= { meals: ['dinner'], members: null });
}
function sharedMembers() {
  const ids = household().members;
  return state.profiles.filter((p) => !ids || ids.includes(p.id));
}
// Meals this person eats with the household on a date: { dinner: [foodIds] }.
function sharedFoods(p, date) {
  const members = sharedMembers();
  if (members.length < 2 || !members.some((m) => m.id === p.id)) return {};
  const fixed = {};
  for (const mealId of household().meals) {
    const variant = (((state.planVariants[SHARE_KEY] ||= {})[date] ||= {})[mealId]) || 0;
    fixed[mealId] = pickSharedMeal({
      members: members.map((m) => ({ profile: m, diet: getDiet(m.diet) })), foods: allFoods(), date, mealId, variant,
    });
  }
  return fixed;
}
function otherNames(p) {
  const names = sharedMembers().filter((m) => m.id !== p.id).map((m) => m.name);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0] || '';
}

function planFor(p, date) {
  const v = variants(p, date);
  const { all = 0, ...mealVariants } = v;
  return planDay({
    profile: p, diet: getDiet(p.diet), schedule: getSchedule(p.schedule), targets: targetsFor(p, date),
    foods: allFoods(), date, variant: all, mealVariants, fixed: sharedFoods(p, date),
  });
}

// Everyone's portions of a shared meal, for the "cook for everyone" list.
function cookList(mealId, date) {
  const rows = new Map(); // foodId -> { food, total, per: [{ name, grams }] }
  for (const m of sharedMembers()) {
    const meal = planFor(m, date).meals.find((x) => x.id === mealId);
    if (!meal) continue;
    for (const it of meal.items) {
      const row = rows.get(it.food.id) || { food: it.food, total: 0, per: [] };
      row.total += it.grams;
      row.per.push({ name: m.name, grams: it.grams });
      rows.set(it.food.id, row);
    }
  }
  return [...rows.values()];
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
  else if (ui.tab === 'progress') view.innerHTML = progressView(p);
  else if (ui.tab === 'recipe') view.innerHTML = ui.recipe ? recipeView() : foodsView(p);
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
    const cook = m.shared ? cookList(m.id, ui.date) : [];
    const othersToLog = m.shared && sharedMembers().some((x) => x.id !== p.id && !dayLog(x, ui.date).some((e) => e.fromPlan === m.id));
    return `<div class="card">
      <div class="meal-head"><span class="meal-label">${esc(m.label)}${m.shared ? ` <span class="tag">👥 with ${esc(otherNames(p))}</span>` : ''}</span><span class="small muted">${r(m.totals.kcal)} kcal</span></div>
      <h3>${esc(m.title)}</h3>
      ${m.recipe ? `<div class="row small muted" style="gap:6px;margin:2px 0 4px">${m.recipe.minutes ? `<span>⏱ ${m.recipe.minutes} min</span>` : ''}${(m.recipe.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${m.shared ? `<p class="small muted" style="margin:0">Your portion:</p>` : ''}
      <ul class="items">${m.items.map((i) => `<li><span>${esc(i.food.name)}${i.personal ? ' <span class="small muted">(just you)</span>' : i.side ? ' <span class="small muted">(on the side)</span>' : ''}</span><span class="qty">${esc(formatPortion(i.food, i.grams))}</span></li>`).join('')}</ul>
      ${m.recipe && m.recipe.steps?.length ? `<details class="cook"><summary>How to make it</summary>
        ${m.recipe.seasonings?.length ? `<p class="small"><b>Seasonings (no counting needed):</b> ${esc(m.recipe.seasonings.join(', '))}</p>` : ''}
        <ol class="steps">${m.recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
      ${macroLine(m.totals)}
      ${cook.length ? `<details class="cook"><summary>Cook for everyone</summary><ul class="items">${cook.map((c) => `<li><span class="grow">${esc(c.food.name)}<br><span class="small muted">${c.per.map((x) => `${esc(x.name)} ${esc(formatPortion(c.food, x.grams).replace(/ \(.*\)$/, ''))}`).join(' · ')}</span></span><span class="qty">${esc(formatPortion(c.food, c.total))}</span></li>`).join('')}</ul><p class="small muted">Cook the total, then serve each person their amount.</p></details>` : ''}
      <div class="row" style="margin-top:10px">
        ${logged ? '<span class="tag">✓ Logged</span>' : `<button class="btn small primary" data-action="ateMeal" data-meal="${m.id}">I ate this</button>`}
        ${othersToLog ? `<button class="btn small" data-action="ateMealAll" data-meal="${m.id}">Log for everyone</button>` : ''}
        <button class="btn small" data-action="swapMeal" data-meal="${m.id}" data-shared="${m.shared ? 1 : ''}">Swap meal</button>
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
        return `<li><span class="grow linkish" data-action="editLog" data-id="${e.id}" role="button" tabindex="0" title="Change amount">${esc(f.name)}<br><span class="small muted">${esc(formatPortion(f, e.grams))} · ${r(n.kcal)} kcal · ${r(n.protein)}g P · tap to edit</span></span><button class="btn small ghost danger" data-action="removeLog" data-id="${e.id}" aria-label="Remove">✕</button></li>`;
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
    ${p.cycleCalories && (p.gymDays || []).length ? `<div class="row" style="margin-top:8px"><button class="btn small" data-action="toggleDayType" title="Switch between gym day and rest day">${dayTypeFor(p, ui.date) === 'gym' ? '🏋️ Gym day' : '🛋️ Rest day'}${t.shift ? ` (${t.shift > 0 ? '+' : '−'}${Math.abs(t.shift)} kcal)` : ''} · switch</button></div>` : ''}
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
  ${logHtml}

  <h2>Water & habits</h2>
  ${habitsCard(p)}`;
}

function shoppingList(p, everyone) {
  const people = everyone ? state.profiles : [p];
  const totals = new Map();
  for (const person of people) {
    for (let i = 0; i < 7; i++) {
      for (const m of planFor(person, shiftDate(ui.date, i)).meals) {
        for (const it of m.items) totals.set(it.food.id, (totals.get(it.food.id) || 0) + it.grams);
      }
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
  const toggle = state.profiles.length > 1
    ? `<div class="row" style="margin-top:8px"><button class="btn small ${everyone ? 'primary' : ''}" data-action="shopping" data-everyone="1">Everyone</button><button class="btn small ${everyone ? '' : 'primary'}" data-action="shopping" data-everyone="">Just ${esc(p.name)}</button></div>`
    : '';
  return `<div class="row spread"><h2 style="margin:0">Shopping list</h2><button class="btn small" data-action="closeModal">Close</button></div>
    ${toggle}
    <p class="small muted">For ${everyone ? 'everyone' : esc(p.name)}, ${prettyDate(ui.date)} + 6 days. Amounts are cooked weights for meat, rice, pasta and beans.</p>${rows}`;
}

// ---------- lookup ----------
function lookupView() {
  return `<h1>Food lookup</h1>
  <div class="row" style="margin-bottom:12px"><button class="btn primary" data-action="scan">📷 Scan a barcode</button><button class="btn" data-action="newRecipe">🍲 Build a recipe</button></div>
  <p class="muted small">Or type a food, pick it, then enter how much to see the nutrition.</p>
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
  const recent = recentFoods(active());
  box.innerHTML = !q
    ? `${recent.length ? `<h2>Recent</h2><ul class="results">${recent.map(({ food, grams }) => `<li data-action="openFood" data-id="${esc(food.id)}" data-grams="${grams}"><div>${esc(food.name)}</div><div class="small muted">Last time: ${esc(formatPortion(food, grams))} · ${r(nutrientsFor(food, grams).kcal)} kcal</div></li>`).join('')}</ul>` : ''}
       <p class="small muted">Over 90 common foods are built in. Search USDA for anything else, including brand-name products and restaurant foods.</p>`
    : `${local.length ? `<h2>My foods & built-in</h2><ul class="results">${local.slice(0, 30).map((f) => li(f)).join('')}</ul>` : '<p class="muted">No built-in match.</p>'}
       <div class="row" style="margin:12px 0"><button class="btn primary" data-action="usdaSearch">Search USDA for “${esc(ui.lookup.query.trim())}”</button><span class="small muted">${esc(ui.lookup.usdaStatus)}</span></div>
       ${ui.lookup.usda.length ? `<h2>USDA results</h2><ul class="results">${ui.lookup.usda.map((f) => li(f, f.source === 'Branded' ? ' · brand' : '')).join('')}</ul>` : ''}`;
}

// The person's most recently logged foods (newest first), each with the amount they had last time.
function recentFoods(p, limit = 10) {
  if (!p) return [];
  const days = Object.keys(state.logs[p.id] || {}).sort().reverse();
  const seen = new Map();
  for (const d of days) {
    for (const e of [...state.logs[p.id][d]].reverse()) {
      const food = foodById(e.foodId);
      if (food && !seen.has(food.id)) seen.set(food.id, { food, grams: e.grams });
      if (seen.size >= limit) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

let modalFood = null;
let modalEditId = null; // log entry being edited, if any
// opts: { grams } to prefill an amount, { editId } to change an existing log entry
function openFoodModal(food, opts = {}) {
  modalFood = food;
  const p = active();
  const editing = opts.editId ? dayLog(p, ui.date).find((e) => e.id === opts.editId) : null;
  modalEditId = editing ? editing.id : null;
  const grams = editing ? editing.grams : opts.grams;
  const units = Object.keys(unitsFor(food));
  const defUnit = food.show && units.includes(food.show) ? food.show : 'g';
  const defQty = grams ? Math.round((grams / unitsFor(food)[defUnit]) * 100) / 100 : defUnit === 'g' ? 100 : 1;
  const meals = getSchedule(p.schedule).meals;
  const liked = (p.liked || []).includes(food.id);
  const mealSel = editing?.meal;
  modalBody.innerHTML = `
    <div class="row spread"><h2 style="margin:0">${esc(food.name)}</h2><button class="btn small" data-action="closeModal">Close</button></div>
    ${food.servingText ? `<p class="small muted">Label serving: ${esc(food.servingText)}</p>` : ''}
    <div class="grid2">
      <div><label for="fqty">Amount</label><input id="fqty" type="number" inputmode="decimal" min="0" step="any" value="${defQty}"></div>
      <div><label for="funit">Unit</label><select id="funit">${units.map((u) => `<option ${u === defUnit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
    </div>
    <div id="fnut" style="margin-top:12px"></div>
    <label for="fmeal">${editing ? 'Meal' : `Add to ${esc(p.name)}'s log for ${prettyDate(ui.date)}`}</label>
    <div class="row"><select id="fmeal" class="grow" style="width:auto">${meals.map((m) => `<option value="${m.id}" ${m.id === mealSel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}<option value="other" ${mealSel === 'other' ? 'selected' : ''}>Other</option></select>
      <button class="btn primary" data-action="logFood">${editing ? 'Save change' : 'Add'}</button></div>
    <div class="row" style="margin-top:12px">${food.role !== 'other' || food.custom ? `<button class="btn small" data-action="toggleLikeModal">${liked ? '★ Liked — used in plans' : '☆ I like this (use in plans)'}</button>` : ''}${food.recipe ? `<button class="btn small" data-action="editRecipe" data-id="${esc(food.id)}">Edit recipe</button>` : ''}</div>`;
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
  const customs = state.customFoods.filter((f) => !f.recipe);
  const recipes = state.customFoods.filter((f) => f.recipe);
  return `<h1>${esc(p.name)}'s foods</h1>
  <p class="muted">Tap once for <b>★ like</b>, twice for <b>✕ won't eat</b>, three times to clear. Meal plans are built from the foods you like. Faded foods aren't allowed on ${esc(diet.name)}.</p>
  <div class="card row spread"><span>Only plan foods I like<br><span class="small muted">${liked.size} liked · ${disliked.size} won't eat</span></span>
    <label class="row" style="margin:0"><input type="checkbox" data-action="onlyLiked" ${p.onlyLiked !== false ? 'checked' : ''}> On</label></div>
  ${groups}
  <h2>Recipes</h2>
  ${recipes.length ? `<ul class="items">${recipes.map((f) => { const u = f.show; const n = nutrientsFor(f, f.units[u]); return `<li><span class="grow">${esc(f.name)}<br><span class="small muted">1 ${esc(u)}: ${r(n.kcal)} kcal · ${r(n.protein)}g P · ${r(n.carbs)}g C · ${r(n.fat)}g F</span></span><span class="row"><button class="btn small" data-action="editRecipe" data-id="${esc(f.id)}">Edit</button><button class="btn small ghost danger" data-action="deleteCustom" data-id="${esc(f.id)}">Delete</button></span></li>`; }).join('')}</ul>` : '<p class="muted small">Enter a dish you make — chili, a casserole, overnight oats — and the app works out the nutrition per serving.</p>'}
  <div class="row" style="margin-top:8px"><button class="btn" data-action="newRecipe">🍲 Build a recipe</button></div>

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
  <h2>Fat-loss playbook</h2>
  <div class="card playbook">
    <p class="muted small">What every diet above has in common. Get these right and the diet you pick matters much less.</p>
    <ol>
      <li><b>Calories decide fat loss; protein decides what you lose.</b> Stay near your calorie target and hit protein every day so the weight that comes off is fat, not muscle.</li>
      <li><b>Protein at every meal and snack</b> — about a palm or two. It's the most filling nutrient and protects your gym gains.</li>
      <li><b>Half the plate vegetables.</b> Big volume, few calories, lots of fiber. Aim for 5+ servings of veggies and fruit a day.</li>
      <li><b>Measure the calorie-dense stuff.</b> Oil, nut butter, cheese, nuts and dressing are where "healthy" meals quietly double. Use a spoon or the scale for those; eyeball the vegetables.</li>
      <li><b>Don't drink your calories.</b> Water, black coffee, tea and diet drinks. Juice, soda, fancy coffee and alcohol add up fast and don't fill you up. If you drink, log it — a light beer is ~100 kcal, a glass of wine ~125.</li>
      <li><b>Lift 3–4 days a week and walk daily.</b> Lifting keeps muscle; 8,000+ steps burns more than most people's workouts.</li>
      <li><b>Sleep 7+ hours.</b> Short sleep raises hunger and cravings the next day.</li>
      <li><b>Plan and prep.</b> Cook proteins and grains in batches twice a week (the shopping list and "meal-prep" tags help). Decisions made hungry are rarely good ones.</li>
      <li><b>Weigh in weekly, measure your waist every 2 weeks</b> — same time, same conditions. One weigh-in means little; the trend is what counts, and the Progress coach watches it for you.</li>
      <li><b>Plan for weekends and eating out.</b> Pick a protein + vegetable plate, ask for sauces on the side, and log it. One off meal never ruins progress; an off weekend every weekend can.</li>
      <li><b>Expect plateaus.</b> When the scale and waist both stall for 2–3 weeks with honest logging, trim 100–150 kcal. The coach suggests this when the data shows it.</li>
    </ol>
  </div>
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
    <label>Which days do you usually work out?</label>
    <div class="row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label class="row" style="margin:0 10px 0 0"><input type="checkbox" name="gymDay" value="${i}" ${(v.gymDays || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <label class="row" style="margin-top:10px"><input type="checkbox" name="cycleCalories" ${v.cycleCalories ? 'checked' : ''}> Eat a little more on gym days and a little less on rest days (same weekly total)</label>
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
    <div class="kcal-big" style="margin:8px 0">${t.baseKcal} <span class="small muted">kcal / day${p.cycleCalories && (p.gymDays || []).length ? ' on average' : ''}</span></div>
    ${macroLine({ ...t, kcal: t.baseKcal })}
    <p class="small muted">Resting burn (BMR) ${t.bmr} · Maintenance (TDEE) ${t.tdee} · Fiber ${t.fiber}g+ · Sodium under ${t.sodium} mg · Water ${waterGoal(p)} oz</p>
    ${p.kcalAdjust ? `<p class="small">Includes a coach adjustment of ${p.kcalAdjust > 0 ? '+' : '−'}${Math.abs(p.kcalAdjust)} kcal. <a href="#" data-action="resetAdjust">Reset</a></p>` : ''}
    ${p.cycleCalories && (p.gymDays || []).length ? `<p class="small muted">Gym days: ${dailyTargets(p, getDiet(p.diet), 'gym').kcal} kcal · Rest days: ${dailyTargets(p, getDiet(p.diet), 'rest').kcal} kcal</p>` : ''}
  </div>

  <p class="small muted">Weight ${latest} lb${p.goalWeightLb ? ` · Goal ${p.goalWeightLb} lb` : ''} · ${change <= 0 ? '▼' : '▲'} ${Math.abs(change).toFixed(1)} lb since ${start} lb. Log weigh-ins and measurements in <a href="#" data-action="go" data-tab="progress">Progress</a>.</p>

  <h2>Cook together</h2>
  <div class="card">${state.profiles.length < 2
    ? '<p class="small muted">Add another person below and you can share meals: same foods for everyone, with each person\'s portion sized to their own targets.</p>'
    : `<p class="small muted">Shared meals use the same foods for everyone, sized to each person's targets. Foods anyone marked “won't eat” or that someone's diet doesn't allow are skipped. Keto eaters skip the starch side.</p>
      <label>Meals to share</label>
      <div class="row">${[['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']].map(([id, label]) => `<label class="row" style="margin:0 12px 0 0"><input type="checkbox" data-action="shareMeal" value="${id}" ${household().meals.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</div>
      <label>Who eats together</label>
      <div class="row">${state.profiles.map((x) => `<label class="row" style="margin:0 12px 0 0"><input type="checkbox" data-action="shareMember" value="${x.id}" ${sharedMembers().some((m) => m.id === x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>`}
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

// ---------- recipes ----------
// ui.recipe is the draft being edited: { id, name, servings, servingName, role, meals,
// ingredients: [{ foodId, qty, unit, grams }], extra: { foodId: food } (USDA/scanned foods not saved yet), query, usda, usdaStatus }
function draftFood(id) {
  return foodById(id) || ui.recipe?.extra[id];
}

function newDraft(food) {
  const rc = food?.recipe;
  return {
    id: food?.id || null,
    name: food?.name || '',
    servings: rc?.servings || 4,
    servingName: rc?.servingName || '',
    role: food?.role || 'other',
    meals: food?.meals || 'm',
    ingredients: rc ? rc.ingredients.map((i) => ({ ...i })) : [],
    extra: {},
    query: '',
    usda: [],
    usdaStatus: '',
  };
}

function recipeTotalsHtml() {
  const d = ui.recipe;
  const totals = recipeTotals(d.ingredients, draftFood);
  const per = perServing(totals, d.servings);
  const unit = d.servingName.trim() || 'serving';
  if (!d.ingredients.length) return '<p class="small muted">Add ingredients to see nutrition per serving.</p>';
  return `<div class="row spread"><b>Per ${esc(unit)}</b><span class="small muted">${r(per.grams)} g each · ${r(totals.grams)} g total</span></div>
    ${macroLine(per)}
    <p class="small muted" style="margin:6px 0 0">Fiber ${per.fiber.toFixed(1)} g · Sodium ${r(per.sodium)} mg · Whole recipe ${r(totals.kcal)} kcal</p>`;
}

function ingRowHtml(ing, idx) {
  const f = draftFood(ing.foodId);
  if (!f) return '';
  const units = Object.keys(unitsFor(f));
  return `<li class="ing" data-row="${idx}">
    <div class="grow"><div>${esc(f.name)}</div><div class="small muted ing-kcal">${r(nutrientsFor(f, ing.grams).kcal)} kcal</div></div>
    <input type="number" data-ing="${idx}" data-field="qty" value="${ing.qty}" min="0" step="any" inputmode="decimal" aria-label="Amount">
    <select data-ing="${idx}" data-field="unit" aria-label="Unit">${units.map((u) => `<option ${u === ing.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
    <button class="btn small ghost danger" data-action="removeIng" data-idx="${idx}" aria-label="Remove">✕</button>
  </li>`;
}

function recipeView() {
  const d = ui.recipe;
  return `<h1>${d.id ? 'Edit recipe' : 'New recipe'}</h1>
  <div id="recipeMeta" class="card">
    <label>Recipe name</label><input type="text" name="name" value="${esc(d.name)}" placeholder="e.g. Turkey chili">
    <div class="grid2">
      <div><label>Makes how many servings?</label><input type="number" name="servings" min="1" step="any" inputmode="decimal" value="${d.servings}"></div>
      <div><label>Serving name (optional)</label><input type="text" name="servingName" value="${esc(d.servingName)}" placeholder="bowl, slice, cup…"></div>
    </div>
  </div>

  <h2>Ingredients</h2>
  <p class="small muted">Use raw amounts for meat and dry amounts for rice and pasta if that's how you measure them; pick the matching food (e.g. "Oats, rolled (dry)").</p>
  <ul class="items ings" id="ingList">${d.ingredients.map(ingRowHtml).join('') || '<li class="muted small">No ingredients yet.</li>'}</ul>
  <div class="card">
    <div class="row"><input type="search" id="ingQuery" class="grow" style="width:auto" placeholder="Add an ingredient…" value="${esc(d.query)}" autocomplete="off"><button class="btn" data-action="scan" data-for="recipe">📷 Scan</button></div>
    <div id="ingResults"></div>
  </div>

  <div class="card" id="recipeTotals">${recipeTotalsHtml()}</div>

  <div class="card" id="recipePlan">
    <label>Use it in meal plans as</label>
    <select data-field="role" data-recipe="1">${[['other', "Don't plan it (just for logging)"], ['protein', 'Main dish (sized by protein)'], ['carb', 'Side / starch'], ['fat', 'Snack or topping']].map(([v, l]) => `<option value="${v}" ${d.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="row" style="margin-top:8px">${[['b', 'Breakfast'], ['m', 'Lunch/Dinner'], ['s', 'Snack']].map(([v, l]) => `<label class="row" style="margin:0 12px 0 0"><input type="checkbox" data-field="meal" data-recipe="1" value="${v}" ${d.meals.includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
  </div>

  <div class="row"><button class="btn primary" data-action="saveRecipe">Save recipe</button><button class="btn" data-action="cancelRecipe">Cancel</button></div>`;
}

function renderIngResults() {
  const box = $('#ingResults');
  if (!box || !ui.recipe) return;
  const d = ui.recipe;
  const words = d.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return (box.innerHTML = '');
  const local = allFoods().filter((f) => f.id !== d.id && words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 12);
  const li = (f) => `<li data-action="addIng" data-id="${esc(f.id)}"><div>${esc(f.name)}</div><div class="small muted">${r(f.kcal)} kcal · ${r(f.protein)}g P per 100 g</div></li>`;
  box.innerHTML = `<ul class="results">${local.map(li).join('')}</ul>
    <div class="row" style="margin:10px 0"><button class="btn small" data-action="ingUsda">Search USDA for “${esc(d.query.trim())}”</button><span class="small muted">${esc(d.usdaStatus)}</span></div>
    ${d.usda.length ? `<ul class="results">${d.usda.map(li).join('')}</ul>` : ''}`;
}

function refreshRecipe() {
  const list = $('#ingList');
  if (list) list.innerHTML = ui.recipe.ingredients.map(ingRowHtml).join('') || '<li class="muted small">No ingredients yet.</li>';
  const t = $('#recipeTotals');
  if (t) t.innerHTML = recipeTotalsHtml();
}

// Typing in the recipe form updates the draft and the totals without re-rendering (keeps focus).
function recipeInput(el) {
  const d = ui.recipe;
  if (!d) return;
  if (el.dataset.ing != null) {
    const ing = d.ingredients[Number(el.dataset.ing)];
    const f = draftFood(ing.foodId);
    if (el.dataset.field === 'qty') ing.qty = parseFloat(el.value) || 0;
    else ing.unit = el.value;
    ing.grams = toGrams(f, ing.qty, ing.unit);
    const row = el.closest('li');
    row.querySelector('.ing-kcal').textContent = `${r(nutrientsFor(f, ing.grams).kcal)} kcal`;
  } else if (el.dataset.recipe) {
    if (el.dataset.field === 'role') d.role = el.value;
    else d.meals = [...document.querySelectorAll('[data-field=meal][data-recipe]')].filter((x) => x.checked).map((x) => x.value).join('');
    return;
  } else if (el.name === 'name') d.name = el.value;
  else if (el.name === 'servings') d.servings = parseFloat(el.value) || 1;
  else if (el.name === 'servingName') d.servingName = el.value;
  $('#recipeTotals').innerHTML = recipeTotalsHtml();
}

function addIngredient(food) {
  const d = ui.recipe;
  if (!foodById(food.id)) d.extra[food.id] = food;
  const unit = food.show && unitsFor(food)[food.show] ? food.show : 'g';
  const qty = unit === 'g' ? 100 : 1;
  d.ingredients.push({ foodId: food.id, qty, unit, grams: toGrams(food, qty, unit) });
  d.query = '';
  d.usda = [];
  const q = $('#ingQuery');
  if (q) q.value = '';
  renderIngResults();
  refreshRecipe();
  const last = document.querySelector(`#ingList [data-ing="${d.ingredients.length - 1}"][data-field=qty]`);
  if (last) { last.focus(); last.select(); }
}

// ---------- barcode scanning ----------
let stopScanner = null;
let scanTarget = 'lookup'; // 'lookup' opens the food; 'recipe' adds it as an ingredient

function stopScan() {
  if (stopScanner) {
    try { stopScanner(); } catch { /* already stopped */ }
    stopScanner = null;
  }
}

function scanModal() {
  modalFood = null;
  modalBody.innerHTML = `
    <div class="row spread"><h2 style="margin:0">Scan a barcode</h2><button class="btn small" data-action="closeModal">Close</button></div>
    <div class="scanbox"><video id="scanVideo" playsinline muted></video><div class="scanframe"></div></div>
    <p id="scanStatus" class="small muted">Starting camera…</p>
    <form id="barcodeForm" class="row"><input type="text" name="code" inputmode="numeric" pattern="[0-9 ]*" class="grow" style="width:auto" placeholder="Or type the number under the barcode" autocomplete="off"><button class="btn" type="submit">Look up</button></form>`;
  if (!modal.open) modal.showModal();
  const video = $('#scanVideo');
  startScanner(video, (code) => handleBarcode(code))
    .then((stop) => {
      if (!modal.open || !$('#scanVideo')) return stop();
      stopScanner = stop;
      $('#scanStatus').textContent = 'Point the camera at the barcode and hold steady.';
    })
    .catch((err) => {
      const status = $('#scanStatus');
      if (!status) return;
      status.textContent = err?.name === 'NotAllowedError'
        ? 'Camera permission was blocked. Allow the camera for this site in your browser settings, or type the number below.'
        : err?.message || 'Could not start the camera. Type the number below instead.';
      $('.scanbox')?.remove();
    });
}

async function handleBarcode(code) {
  stopScan();
  const status = $('#scanStatus');
  if (status) status.textContent = `Looking up ${code}…`;
  $('.scanbox')?.remove();
  const known = allFoods().find((f) => f.barcode === code);
  const food = known || (await lookupBarcode(code, state.usdaKey));
  if (!food) {
    const s = $('#scanStatus');
    if (s) s.innerHTML = `No nutrition found for barcode ${esc(code)}. <a href="#" data-action="customFood">Add it from the label instead</a>.`;
    return;
  }
  if (scanTarget === 'recipe' && ui.recipe) {
    modal.close();
    addIngredient(food);
    toast(`Added ${food.name}`);
  } else {
    openFoodModal(food);
  }
}

// ---------- progress ----------
function checkins(p) {
  return (state.weights[p.id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
}
// Each check-in plus its body-fat estimate. Weight is carried forward from the latest weigh-in
// so a tape-only check-in still gets fat/lean numbers.
function enriched(p) {
  let lastLb = p.startWeightLb || p.weightLb;
  return checkins(p).map((c) => {
    if (c.lb) lastLb = c.lb;
    const bf = bodyFatNavy({ sex: p.sex, heightIn: p.heightIn, waist: c.waist, neck: c.neck, hip: c.hip });
    return { ...c, weight: lastLb, bf, comp: composition(lastLb, bf) };
  });
}

const fmtDelta = (x, unit, digits = 1) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(digits)}${unit}`;

// Single-series line chart as inline SVG. One axis per chart (weight, waist and body fat each get their own).
function lineChart(points, { title, unit, digits = 1 }) {
  if (points.length < 2) return `<div class="chart-empty small muted">${esc(title)}: log at least two check-ins to see a trend.</div>`;
  const W = 640, H = 200, L = 44, R = 14, T = 14, B = 26;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date) || t0 + 1;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, unit === '%' ? 0.5 : 1);
  lo -= pad; hi += pad;
  const x = (d) => L + ((Date.parse(d) - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const short = (s) => { const [yy, mm, dd] = s.split('-').map(Number); return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const data = esc(JSON.stringify(points.map((p) => [x(p.date), y(p.v), short(p.date), p.v.toFixed(digits)])));
  return `<figure class="chart" data-points="${data}" data-unit="${esc(unit)}">
    <figcaption><b>${esc(title)}</b> <span class="small muted">now ${last.v.toFixed(digits)}${esc(unit)} · ${fmtDelta(last.v - points[0].v, unit, digits)} since ${short(points[0].date)}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} over time">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(unit === '%' ? 1 : 0)}</text>`).join('')}
      <text class="axis" x="${L}" y="${H - 6}">${short(points[0].date)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${short(last.date)}</text>
      <path class="line" d="${d}"/>
      ${points.map((p) => `<circle class="pt" cx="${x(p.date)}" cy="${y(p.v)}" r="4"/>`).join('')}
      <line class="cross" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>
      <circle class="hover-pt" r="6" cx="-10" cy="-10"/>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/>
    </svg>
    <div class="tip" hidden></div>
  </figure>`;
}

function progressView(p) {
  const rows = enriched(p);
  const female = p.sex === 'female';
  const withBf = rows.filter((r0) => r0.bf != null);
  const first = withBf[0], last = withBf[withBf.length - 1];
  const weights = rows.filter((r0) => r0.lb);
  const waists = rows.filter((r0) => r0.waist);
  const latest = rows[rows.length - 1];

  let summary = '<p class="muted">Log your weight and tape measurements below. With waist and neck (and hips for women) the app estimates body fat, so you can see fat lost and muscle kept even when the scale stalls.</p>';
  if (rows.length) {
    const wDelta = weights.length > 1 ? weights[weights.length - 1].lb - weights[0].lb : null;
    const waistDelta = waists.length > 1 ? waists[waists.length - 1].waist - waists[0].waist : null;
    const fatDelta = first && last && first !== last ? last.comp.fat - first.comp.fat : null;
    const leanDelta = first && last && first !== last ? last.comp.lean - first.comp.lean : null;
    let read = '';
    if (fatDelta != null && fatDelta < 0 && leanDelta >= 0) read = 'You’re losing fat and keeping (or adding) muscle — exactly the goal.';
    else if (fatDelta != null && fatDelta < 0) read = 'Fat is coming off. Some lean mass dropped too — keep protein high and keep lifting.';
    else if (waistDelta != null && waistDelta < 0 && wDelta != null && wDelta >= -0.5) read = 'The scale is flat but your waist is shrinking — that’s fat loss while you build muscle.';
    else if (fatDelta != null && fatDelta > 0) read = 'Body fat is up a little since you started tracking. Check your logging and portions for a week or two.';
    summary = `<div class="stats">
        <div><div class="stat">${latest.weight ? r(latest.weight * 10) / 10 : '—'}<small> lb</small></div><div class="small muted">Weight${wDelta != null ? ' ' + fmtDelta(wDelta, ' lb') : ''}</div></div>
        <div><div class="stat">${waists.length ? waists[waists.length - 1].waist : '—'}<small> in</small></div><div class="small muted">Waist${waistDelta != null ? ' ' + fmtDelta(waistDelta, ' in') : ''}</div></div>
        <div><div class="stat">${last ? last.bf : '—'}<small> %</small></div><div class="small muted">Body fat (est.)</div></div>
      </div>
      ${fatDelta != null ? `<div class="stats" style="margin-top:12px">
        <div><div class="stat">${fmtDelta(fatDelta, '')}<small> lb</small></div><div class="small muted">Fat since ${prettyDate(first.date).replace(/^.* · /, '')}</div></div>
        <div><div class="stat">${fmtDelta(leanDelta, '')}<small> lb</small></div><div class="small muted">Lean mass (muscle, water, bone)</div></div>
        <div><div class="stat">${r(last.comp.fat)}<small> lb</small></div><div class="small muted">Fat now</div></div>
      </div>` : ''}
      ${read ? `<p style="margin-top:12px">${read}</p>` : ''}`;
  }

  const today = rows.find((r0) => r0.date === todayStr()) || {};
  const loggedDays = Array.from({ length: 14 }, (_, i) => shiftDate(todayStr(), -i)).filter((d) => (state.logs[p.id]?.[d] || []).length).length;
  const advice = coachAdvice(p, checkins(p), loggedDays, todayStr());
  const recentlyApplied = state.coachLog?.[p.id] && Date.parse(todayStr()) - Date.parse(state.coachLog[p.id]) < 14 * 864e5;
  const coach = `<div class="card coach ${advice.status}">
    <div class="row spread"><b>🧭 Weekly coach: ${esc(advice.title)}</b></div>
    <p>${esc(advice.detail)}</p>
    ${advice.adjust && !recentlyApplied ? `<div class="row"><button class="btn primary small" data-action="applyCoach" data-kcal="${advice.adjust}">${advice.adjust > 0 ? 'Add' : 'Cut'} ${Math.abs(advice.adjust)} kcal a day</button><span class="small muted">Now ${targetsFor(p).baseKcal} → ${Math.max(targetsFor(p).baseKcal + advice.adjust, 0)} kcal</span></div>` : ''}
    ${advice.adjust && recentlyApplied ? '<p class="small muted">You changed calories in the last 2 weeks — give it 2 weeks to show before changing again.</p>' : ''}
  </div>`;
  return `<h1>${esc(p.name)}'s progress</h1>
  ${coach}
  <div class="card">${summary}</div>

  <h2>Check in</h2>
  <form id="checkinForm" class="card">
    <div class="grid2">
      <div><label>Weight (lb)</label><input type="number" name="lb" step="0.1" min="70" max="800" inputmode="decimal" value="${today.lb ?? ''}"></div>
      <div><label>Waist (in)</label><input type="number" name="waist" step="0.25" min="15" max="90" inputmode="decimal" value="${today.waist ?? ''}"></div>
      <div><label>Neck (in)</label><input type="number" name="neck" step="0.25" min="8" max="35" inputmode="decimal" value="${today.neck ?? ''}"></div>
      ${female ? `<div><label>Hips (in)</label><input type="number" name="hip" step="0.25" min="20" max="90" inputmode="decimal" value="${today.hip ?? ''}"></div>` : ''}
    </div>
    <details class="small muted" style="margin-top:10px"><summary>How to measure</summary>
      <p>Use a soft tape, snug but not squeezing, first thing in the morning before eating. <b>Waist:</b> ${female ? 'at the narrowest point, usually just above the belly button' : 'around the belly button'}, relaxed — don't suck in. <b>Neck:</b> just below the Adam's apple, tape angled slightly down toward the front.${female ? ' <b>Hips:</b> around the widest part of the buttocks.' : ''} Measure every 1–2 weeks; weigh in weekly, same time of day.</p>
    </details>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save check-in for today</button><span class="small muted">Anything left blank is skipped.</span></div>
  </form>

  <h2>Trends</h2>
  <div class="card charts">
    ${lineChart(weights.map((r0) => ({ date: r0.date, v: r0.lb })), { title: 'Weight', unit: ' lb' })}
    ${lineChart(waists.map((r0) => ({ date: r0.date, v: r0.waist })), { title: 'Waist', unit: ' in', digits: 2 })}
    ${lineChart(withBf.map((r0) => ({ date: r0.date, v: r0.bf })), { title: 'Body fat (estimated)', unit: '%' })}
  </div>
  <p class="small muted">Body fat uses the U.S. Navy tape-measure method. Any single reading can be off by 3–4%, but the trend is reliable when you measure the same way each time.</p>

  <h2>History</h2>
  ${rows.length ? `<div class="card"><table class="nut hist"><thead><tr><td>Date</td><td>Weight</td><td>Waist</td><td>Body fat</td><td></td></tr></thead><tbody>
    ${rows.slice().reverse().map((c) => `<tr><td>${prettyDate(c.date).replace(/^(Today|Yesterday) · /, '$1 ')}</td><td>${c.lb ? c.lb + ' lb' : '—'}</td><td>${c.waist ? c.waist + '"' : '—'}</td><td>${c.bf != null ? c.bf + '%' : '—'}</td><td><button class="btn small ghost danger" data-action="deleteCheckin" data-date="${c.date}" aria-label="Delete check-in">✕</button></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted small">No check-ins yet.</p>'}`;
}

// Hover/tap readout for progress charts: nearest point gets a crosshair and a tooltip.
function chartPointer(e) {
  const fig = e.target.closest('figure.chart');
  if (!fig) return;
  const svg = fig.querySelector('svg');
  const pts = JSON.parse(fig.dataset.points);
  const box = svg.getBoundingClientRect();
  const vx = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[0] - vx) < Math.abs(best[0] - vx)) best = p;
  const [px, py, label, val] = best;
  const cross = svg.querySelector('.cross');
  cross.setAttribute('x1', px); cross.setAttribute('x2', px);
  const dot = svg.querySelector('.hover-pt');
  dot.setAttribute('cx', px); dot.setAttribute('cy', py);
  fig.classList.add('hovering');
  const tip = fig.querySelector('.tip');
  tip.hidden = false;
  tip.textContent = `${label}: ${val}${fig.dataset.unit}`;
  const scale = box.width / svg.viewBox.baseVal.width;
  tip.style.left = Math.min(Math.max(px * scale - 50, 0), box.width - 110) + 'px';
  tip.style.top = Math.max(py * scale - 40, 0) + 'px';
}
document.addEventListener('pointermove', (e) => { if (e.target.matches?.('figure.chart .hit')) chartPointer(e); });
document.addEventListener('pointerdown', (e) => { if (e.target.matches?.('figure.chart .hit')) chartPointer(e); });
document.addEventListener('pointerout', (e) => {
  if (!e.target.matches?.('figure.chart .hit')) return;
  const fig = e.target.closest('figure.chart');
  fig.querySelector('.tip').hidden = true;
  fig.classList.remove('hovering');
});

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
    const id = el.dataset.meal;
    const v = el.dataset.shared ? ((state.planVariants[SHARE_KEY] ||= {})[ui.date] ||= {}) : variants(active(), ui.date);
    v[id] = (v[id] || 0) + 1;
    persist();
    render();
    if (el.dataset.shared) toast(`Swapped for ${otherNames(active())} too`);
  },
  ateMeal(el) {
    logPlannedMeal(active(), el.dataset.meal);
    persist();
    render();
    toast('Logged');
  },
  ateMealAll(el) {
    for (const m of sharedMembers()) logPlannedMeal(m, el.dataset.meal);
    persist();
    render();
    toast('Logged for everyone');
  },
  scan(el) {
    scanTarget = el.dataset.for === 'recipe' ? 'recipe' : 'lookup';
    scanModal();
  },
  newRecipe() {
    ui.recipe = newDraft(null);
    ui.tab = 'recipe';
    if (modal.open) modal.close();
    render();
    window.scrollTo(0, 0);
  },
  editRecipe(el) {
    const f = foodById(el.dataset.id);
    if (!f) return;
    ui.recipe = newDraft(f);
    ui.tab = 'recipe';
    if (modal.open) modal.close();
    render();
    window.scrollTo(0, 0);
  },
  addIng(el) {
    const id = el.dataset.id;
    const food = foodById(id) || ui.recipe.usda.find((f) => f.id === id);
    if (food) addIngredient(food);
  },
  removeIng(el) {
    ui.recipe.ingredients.splice(Number(el.dataset.idx), 1);
    refreshRecipe();
  },
  async ingUsda() {
    const d = ui.recipe;
    const q = d.query.trim();
    if (!q) return;
    d.usdaStatus = 'Searching…';
    renderIngResults();
    try {
      d.usda = await searchUSDA(q, state.usdaKey);
      d.usdaStatus = d.usda.length ? '' : 'No USDA results.';
    } catch (e) {
      d.usda = [];
      d.usdaStatus = e.message;
    }
    renderIngResults();
  },
  saveRecipe() {
    const d = ui.recipe;
    if (!d.name.trim()) return toast('Give the recipe a name');
    let food;
    try {
      food = buildRecipeFood({ ...d, ingredients: d.ingredients.filter((i) => i.grams > 0) }, draftFood);
    } catch (e) {
      return toast(e.message);
    }
    // Ingredients found through USDA or a barcode are saved too, so the recipe can be edited later.
    for (const i of d.ingredients) if (!foodById(i.foodId) && d.extra[i.foodId]) state.customFoods.push(d.extra[i.foodId]);
    const at = state.customFoods.findIndex((f) => f.id === food.id);
    if (at >= 0) state.customFoods[at] = food;
    else state.customFoods.push(food);
    const p = active();
    if (food.role !== 'other' && !(p.liked || []).includes(food.id)) toggleLike(p, food.id);
    persist();
    ui.recipe = null;
    ui.tab = 'foods';
    render();
    window.scrollTo(0, 0);
    toast(`Saved ${food.name}`);
  },
  cancelRecipe() {
    ui.recipe = null;
    ui.tab = 'foods';
    render();
  },
  deleteCheckin(el) {
    const p = active();
    if (!confirm(`Delete the check-in from ${prettyDate(el.dataset.date)}?`)) return;
    state.weights[p.id] = (state.weights[p.id] || []).filter((w) => w.date !== el.dataset.date);
    const lbs = checkins(p).filter((c) => c.lb);
    if (lbs.length) p.weightLb = lbs[lbs.length - 1].lb;
    persist();
    render();
  },
  shareMeal(el) {
    const h = household();
    h.meals = el.checked ? [...new Set([...h.meals, el.value])] : h.meals.filter((x) => x !== el.value);
    persist();
    render();
  },
  shareMember(el) {
    const h = household();
    const ids = h.members || state.profiles.map((p) => p.id);
    h.members = el.checked ? [...new Set([...ids, el.value])] : ids.filter((x) => x !== el.value);
    persist();
    render();
  },
  removeLog(el) {
    const p = active();
    const log = dayLog(p, ui.date);
    const i = log.findIndex((e) => e.id === el.dataset.id);
    if (i >= 0) log.splice(i, 1);
    persist();
    render();
  },
  shopping(el) {
    const everyone = el.dataset.everyone === undefined ? state.profiles.length > 1 : Boolean(el.dataset.everyone);
    modalBody.innerHTML = shoppingList(active(), everyone);
    if (!modal.open) modal.showModal();
  },
  closeModal() {
    modal.close();
  },
  openFood(el) {
    const id = el.dataset.id;
    const food = foodById(id) || ui.lookup.usda.find((f) => f.id === id);
    if (food) openFoodModal(food, { grams: Number(el.dataset.grams) || undefined });
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
    const grams = toGrams(f, qty, $('#funit').value);
    const existing = modalEditId && dayLog(p, ui.date).find((e) => e.id === modalEditId);
    if (existing) Object.assign(existing, { grams, meal: $('#fmeal').value, fromPlan: undefined });
    else dayLog(p, ui.date).push({ id: newId('log'), foodId: f.id, grams, meal: $('#fmeal').value });
    persist();
    modal.close();
    toast(existing ? 'Amount updated' : `Added to ${p.name}'s log`);
    render();
  },
  editLog(el) {
    const e = dayLog(active(), ui.date).find((x) => x.id === el.dataset.id);
    const f = e && foodById(e.foodId);
    if (f) openFoodModal(f, { editId: e.id });
  },
  water(el) {
    const p = active();
    const day = ((state.water ||= {})[p.id] ||= {});
    day[ui.date] = Math.max(0, (day[ui.date] || 0) + Number(el.dataset.oz));
    persist();
    render();
  },
  habit(el) {
    const p = active();
    const day = (((state.habits ||= {})[p.id] ||= {})[ui.date] ||= {});
    day[el.value] = el.checked;
    persist();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  toggleDayType() {
    const p = active();
    const next = dayTypeFor(p, ui.date) === 'gym' ? 'rest' : 'gym';
    ((state.dayType ||= {})[p.id] ||= {})[ui.date] = next;
    persist();
    render();
    toast(next === 'gym' ? 'Gym day — a bit more food today' : 'Rest day — a bit less food today');
  },
  applyCoach(el) {
    const p = active();
    p.kcalAdjust = Math.max(-500, Math.min(500, (p.kcalAdjust || 0) + Number(el.dataset.kcal)));
    (state.coachLog ||= {})[p.id] = todayStr();
    persist();
    render();
    toast(`Daily calories are now ${targetsFor(p).kcal}`);
  },
  resetAdjust() {
    const p = active();
    p.kcalAdjust = 0;
    persist();
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

function logPlannedMeal(p, mealId) {
  const log = dayLog(p, ui.date);
  if (log.some((e) => e.fromPlan === mealId)) return;
  const meal = planFor(p, ui.date).meals.find((m) => m.id === mealId);
  if (!meal) return;
  for (const it of meal.items) log.push({ id: newId('log'), foodId: it.food.id, grams: it.grams, meal: meal.id, fromPlan: meal.id });
}

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
  if (e.key === 'Enter' && e.target.id === 'ingQuery') { e.preventDefault(); actions.ingUsda(); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (['onlyLiked', 'schedule', 'shareMeal', 'shareMember', 'habit'].includes(el.dataset.action)) actions[el.dataset.action](el);
  else if (el.id === 'funit') updateFoodModal();
  else if (el.dataset.ing != null || el.dataset.recipe || el.closest?.('#recipeMeta')) recipeInput(el);
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
  else if (e.target.id === 'ingQuery') {
    ui.recipe.query = e.target.value;
    ui.recipe.usda = [];
    ui.recipe.usdaStatus = '';
    renderIngResults();
  } else if (e.target.dataset.ing != null || e.target.closest?.('#recipeMeta')) recipeInput(e.target);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  const fd = new FormData(form);
  const num = (k) => (fd.get(k) === '' || fd.get(k) == null ? null : Number(fd.get(k)));

  if (form.id === 'barcodeForm') {
    const code = cleanCode(fd.get('code'));
    if (!code) return toast('Barcodes are 8–14 digits');
    return handleBarcode(code);
  }
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
      gymDays: fd.getAll('gymDay').map(Number),
      cycleCalories: fd.get('cycleCalories') === 'on',
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
  } else if (form.id === 'checkinForm') {
    const p = active();
    const entry = { date: todayStr() };
    for (const k of ['lb', 'waist', 'neck', 'hip']) if (num(k)) entry[k] = num(k);
    if (Object.keys(entry).length === 1) return toast('Enter at least one number');
    const list = (state.weights[p.id] ||= []).filter((w) => w.date !== entry.date);
    list.push(entry);
    state.weights[p.id] = list;
    if (entry.lb) p.weightLb = entry.lb; // targets follow the latest weight
    persist();
    render();
    toast(entry.lb ? 'Check-in saved — targets updated' : 'Check-in saved');
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

modal.addEventListener('close', () => stopScan());

modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close(); // tap outside to close
});

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
