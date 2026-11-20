/* ================================================================
   Telegram Mini App — Functional skeleton (vanilla JS)
   Sections: daily tasks, shopping list, wishlist
   Storage: localStorage (immutable updates)
   Telegram Web App API: init, expand, ready, MainButton, haptic,
   themeParams, close
   ================================================================ */

"use strict";

// ---------------- Constants & storage keys ----------------
const STORAGE_KEYS = {
  tasks:   "tma_tasks",   // array of Task
  shopping: "tma_shopping", // array of Item
  wishlist: "tma_wishlist", // array of Wish
  theme:   "tma_theme",   // "light" | "dark"
};

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// ---------------- Types (documentation only, vanilla JS) ----------------
/*
Task  = { id: string, title: string, done: boolean, date: string, weekdays: number[], createdAt: string }
Item  = { id: string, title: string, done: boolean, createdAt: string }
Wish  = { id: string, title: string, priority: string, url: string, createdAt: string }
Theme = "light" | "dark"
*/

// ---------------- Telegram Web App integration ----------------
const Tg = {
  /**
   * Применяет themeParams Telegram к CSS-переменным приложения.
   * Белый список имён переменных — совпадает с design-tokens.css.
   * Не мутирует themeParams, не падает вне Telegram.
   */
  applyTheme() {
    const wba = window.Telegram?.WebApp;
    if (!wba) return;

    const tp = wba.themeParams || {};
    const root = document.documentElement;

    // Только ожидаемые переменные (белый список, защита от CSS-инъекций)
    if (tp.background_color) root.style.setProperty("--color-bg", tp.background_color);
    if (tp.secondary_bg_color) root.style.setProperty("--color-surface", tp.secondary_bg_color);
    if (tp.text_color) root.style.setProperty("--color-text-primary", tp.text_color);
    if (tp.hint_color) root.style.setProperty("--color-text-secondary", tp.hint_color);
    if (tp.border_color) root.style.setProperty("--color-border", tp.border_color);
    if (tp.accent_color) root.style.setProperty("--color-accent-pink", tp.accent_color);
    if (!tp.accent_color && tp.button_color) root.style.setProperty("--color-accent-pink", tp.button_color); // фолбэк, если нет accent_color
    if (tp.link_color) root.style.setProperty("--color-accent-blue", tp.link_color);
    if (tp.button_text_color) root.style.setProperty("--color-text-muted", tp.button_text_color);

    // Тёмная/светлая тема: color_scheme — приоритет, яркость фона — fallback
    const scheme = String(wba.color_scheme || "").toLowerCase();
    let isDark;
    if (scheme === "dark") {
      isDark = true;
    } else if (scheme === "light") {
      isDark = false;
    } else {
      isDark = this._isDarkColor(tp.background_color || tp.bg_color || "#ffffff");
    }

    root.setAttribute("data-twa-theme", isDark ? "dark" : "light");

    // Синхронизируем стейт приложения, если он есть
    if (typeof State !== "undefined") {
      State.theme = isDark ? "dark" : "light";
    }
  },

  /**
   * Тактильная обратная связь (вибрация) через Telegram Web App API.
   * Безопасно вне Telegram — метод отсутствует, значит тихо игнорируется.
   */
  haptic(style) {
    const wba = window.Telegram?.WebApp;
    if (!wba || typeof wba.hapticFeedback !== "function") return;
    try {
      wba.hapticFeedback(style);
    } catch (e) {
      console.debug("hapticFeedback skipped:", e);
    }
  },

  /**
   * Эвристика яркости фона: true если тёмный.
   * Не мутирует входную строку.
   */
  _isDarkColor(color) {
    if (!color || typeof color !== "string") return null;
    const c = color.replace("#", "");
    if (c.length === 3) {
      const v = parseInt(c, 16);
      return v > 0x777 ? false : true;
    }
    if (c.length === 6) {
      const r = parseInt(c.substring(0, 2), 16);
      const g = parseInt(c.substring(2, 4), 16);
      const b = parseInt(c.substring(4, 6), 16);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return lum < 140;
    }
    return null;
  },

  init() {
    const wba = window.Telegram?.WebApp;
    if (!wba) {
      console.warn("Telegram WebApp API not available (running outside Telegram)");
      return;
    }

    this.applyTheme();

    // Обработчик смены темы в реальном времени
    try {
      if (typeof wba.onEvent === "function") {
        wba.onEvent("themeChanged", () => {
          this.applyTheme();
        });
      }
      if (typeof wba.ready === "function") wba.ready();
      if (typeof wba.expand === "function") wba.expand();
    } catch (e) {
      console.warn("Telegram WebApp init failed:", e);
    }
  },
};

/**
 * Очищает инлайновые переопределения themeParams, чтобы ручная тема (data-twa-theme) заработала.
 * Вызывать при ручном переключении темы пользователем.
 */
function clearThemeOverrides() {
  const root = document.documentElement;
  [
    "--color-bg",
    "--color-surface",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-accent-pink",
    "--color-border",
    "--color-accent-blue",
    "--color-text-muted",
  ].forEach((v) => root.style.removeProperty(v));
}

// ---------------- Storage layer (immutable) ----------------
const Storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
      console.error(`Storage read error for ${key}:`, e);
      return fallback;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Storage write error for ${key}:`, e);
    }
  },

  // Generic immutable helpers
  addItem(key, item, fallback = []) {
    const current = this.read(key, fallback);
    const next = [...current, item];
    this.write(key, next);
    return next;
  },

  toggleItem(key, id, doneField = "done", fallback = []) {
    const current = this.read(key, fallback);
    const next = current.map((it) =>
      it.id === id ? { ...it, [doneField]: !it[doneField] } : it
    );
    this.write(key, next);
    return next;
  },

  removeItem(key, id, fallback = []) {
    const current = this.read(key, fallback);
    const next = current.filter((it) => it.id !== id);
    this.write(key, next);
    return next;
  },

  replaceItem(key, id, updates, fallback = []) {
    const current = this.read(key, fallback);
    const next = current.map((it) =>
      it.id === id ? { ...it, ...updates } : it
    );
    this.write(key, next);
    return next;
  },
};

// ---------------- ID generation ----------------
const Id = {
  next() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  },
};

// ---------------- Validation ----------------
const Validate = {
  nonEmptyString(value, maxLength = 200) {
    if (typeof value !== "string") return { ok: false, error: "Ожидается текст" };
    const trimmed = value.trim();
    if (trimmed.length === 0) return { ok: false, error: "Поле не может быть пустым" };
    if (trimmed.length > maxLength) return { ok: false, error: `Не более ${maxLength} символов` };
    return { ok: true, value: trimmed };
  },

  url(value) {
    if (!value || value.trim() === "") return { ok: true, value: "" };
    try {
      const u = new URL(value.trim());
      if (!u.protocol.startsWith("http")) throw new Error();
      return { ok: true, value: value.trim() };
    } catch (e) {
      return { ok: false, error: "Некорректная ссылка" };
    }
  },

};

// ---------------- App state ----------------
const State = {
  theme: "light",
  tasks: [],
  shopping: [],
  wishlist: [],
  activeTab: "tasks",
  selectedDate: "", // ISO date YYYY-MM-DD
  repeatWeekdays: [], // 0-6
};

// ---------------- DOM refs ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const refs = {
  app: $("#app"),
  btnTheme: $("#btnTheme"),
  tgStatus: $("#tgStatus"),
  tabs: $$(".tab"),
  views: $$(".view"),
  taskDate: $("#taskDate"),
  taskTitle: $("#taskTitle"),
  weekdaysContainer: $("#weekdays"),
  btnAddTask: $("#btnAddTask"),
  taskRepeat: $("#taskRepeat"),
  weekdays: $$(".weekday"),
  suggestions: $("#suggestions"),
  suggestionsList: $("#suggestionsList"),
  taskList: $("#taskList"),
  emptyTasks: $("#emptyTasks"),
  shoppingTitle: $("#shoppingTitle"),
  btnAddShopping: $("#btnAddShopping"),
  shoppingList: $("#shoppingList"),
  emptyShopping: $("#emptyShopping"),
  wishTitle: $("#wishTitle"),
  wishPriority: $("#wishPriority"),
  wishUrl: $("#wishUrl"),
  btnAddWish: $("#btnAddWish"),
  wishlistList: $("#wishlistList"),
  emptyWishlist: $("#emptyWishlist"),
};

// ---------------- Rendering ----------------
function render() {
  // Tab switching
  refs.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === State.activeTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", isActive);
  });
  refs.views.forEach((view) => {
    view.classList.toggle("active", view.id === `view-${State.activeTab}`);
  });

  // Theme attribute
  document.documentElement.setAttribute("data-twa-theme", State.theme);

  // Theme button label
  refs.btnTheme.textContent = State.theme === "dark" ? "Светлая" : "Тёмная";

  // Render active view
  if (State.activeTab === "tasks") renderTasks();
  else if (State.activeTab === "shopping") renderShopping();
  else if (State.activeTab === "wishlist") renderWishlist();
}

function renderTasks() {
  const date = State.selectedDate || new Date().toISOString().slice(0, 10);
  refs.taskDate.value = date;

  // Repeat weekday UI
  refs.taskRepeat.checked = State.repeatWeekdays.length > 0;
  refs.weekdaysContainer.style.display = State.repeatWeekdays.length ? "block" : "none";
  refs.weekdays.forEach((cb) => {
    cb.checked = State.repeatWeekdays.includes(Number(cb.value));
  });

  // Filter tasks for selected date + repeating weekdays
  const weekday = new Date(date).getDay();
  const relevant = State.tasks.filter((t) => {
    if (t.date === date) return true;
    if (State.repeatWeekdays.length && t.weekdays && t.weekdays.includes(weekday)) return true;
    return false;
  });

  refs.taskList.innerHTML = "";
  refs.emptyTasks.classList.toggle("show", relevant.length === 0);

  relevant.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.done ? "done" : ""}`;
    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${task.done ? "checked" : ""} />
      <div class="task-title" data-id="${task.id}">${escapeHtml(task.title)}</div>
      <button class="btn-delete" data-id="${task.id}" title="Удалить">×</button>
    `;
    refs.taskList.appendChild(li);
  });

  // Suggestions from other days
  renderSuggestions(date);
}

function renderSuggestions(currentDate) {
  const other = State.tasks.filter((t) => t.date !== currentDate && !t.done);
  refs.suggestionsList.innerHTML = "";
  if (other.length === 0) {
    refs.suggestions.style.display = "none";
    return;
  }
  refs.suggestions.style.display = "block";
  other.slice(0, 6).forEach((t) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = `${t.title} (${t.date})`;
    chip.addEventListener("click", () => {
      State.selectedDate = t.date;
      State.repeatWeekdays = [];
      render();
    });
    refs.suggestionsList.appendChild(chip);
  });
}

function renderShopping() {
  refs.shoppingList.innerHTML = "";
  refs.emptyShopping.classList.toggle("show", State.shopping.length === 0);

  State.shopping.forEach((item) => {
    const li = document.createElement("li");
    li.className = `task-item ${item.done ? "done" : ""}`;
    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" data-id="${item.id}" ${item.done ? "checked" : ""} />
      <div class="task-title" data-id="${item.id}">${escapeHtml(item.title)}</div>
      <button class="btn-delete" data-id="${item.id}" title="Удалить">×</button>
    `;
    refs.shoppingList.appendChild(li);
  });
}

function renderWishlist() {
  refs.wishlistList.innerHTML = "";
  refs.emptyWishlist.classList.toggle("show", State.wishlist.length === 0);

  State.wishlist.forEach((w) => {
    const li = document.createElement("li");
    li.className = "task-item wish-item";

    const titleEl = document.createElement("div");
    titleEl.style.flex = "1";
    titleEl.textContent = w.title;

    const metaEl = document.createElement("span");
    metaEl.className = "wish-meta";
    metaEl.textContent = w.priority;

    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.dataset.id = w.id;
    delBtn.title = "Удалить";
    delBtn.textContent = "×";

    li.appendChild(titleEl);
    li.appendChild(metaEl);
    li.appendChild(delBtn);

    // Ссылка добавляем только для http(s) — защита от javascript:/data: протоколов
    if (w.url) {
      try {
        const u = new URL(w.url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          const a = document.createElement("a");
          a.href = w.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.style.cssText = "color:var(--color-accent-pink);font-size:12px;margin-left:6px;";
          a.textContent = "Ссылка";
          metaEl.appendChild(document.createTextNode(" "));
          metaEl.appendChild(a);
        }
      } catch (e) {
        console.debug("Wishlist URL skipped (invalid):", e);
      }
    }

    refs.wishlistList.appendChild(li);
  });
}

// ---------------- Event handlers ----------------
function initThemeListeners() {
  if (!refs.btnTheme) return;
  refs.btnTheme.addEventListener("click", () => {
    const next = State.theme === "light" ? "dark" : "light";
    setTheme(next);
  });
}

function initTabListeners() {
  refs.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      State.activeTab = tab.dataset.tab;
      render();
      Tg.haptic("selection");
    });
  });
}

function initTaskListeners() {
  refs.taskDate.addEventListener("change", (e) => {
    State.selectedDate = e.target.value;
    State.repeatWeekdays = [];
    render();
  });

  refs.taskRepeat.addEventListener("change", (e) => {
    if (!e.target.checked) {
      State.repeatWeekdays = [];
    }
    render();
  });

  refs.weekdays.forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      if (e.target.checked) {
        if (!State.repeatWeekdays.includes(val)) State.repeatWeekdays = [...State.repeatWeekdays, val];
      } else {
        State.repeatWeekdays = State.repeatWeekdays.filter((d) => d !== val);
      }
      render();
    });
  });

  refs.btnAddTask.addEventListener("click", addTask);
  refs.taskTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask();
  });

  refs.taskList.addEventListener("click", (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains("task-checkbox")) {
      toggleTask(id);
    } else if (e.target.classList.contains("btn-delete")) {
      deleteTask(id);
    }
  });
  refs.taskList.addEventListener("dblclick", (e) => {
    if (e.target.classList.contains("task-title")) {
      const id = e.target.dataset.id;
      editTaskTitle(id);
    }
  });
}

function initShoppingListeners() {
  refs.btnAddShopping.addEventListener("click", addShopping);
  refs.shoppingTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addShopping();
  });

  refs.shoppingList.addEventListener("click", (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains("task-checkbox")) toggleShopping(id);
    else if (e.target.classList.contains("btn-delete")) deleteShopping(id);
  });
}

function initWishlistListeners() {
  refs.btnAddWish.addEventListener("click", addWish);
  refs.wishTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addWish();
  });

  refs.wishlistList.addEventListener("click", (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains("btn-delete")) deleteWish(id);
  });
}

function initEventListeners() {
  initThemeListeners();
  initTabListeners();
  initTaskListeners();
  initShoppingListeners();
  initWishlistListeners();
}

// ---------------- Actions (immutable) ----------------
function safeStorage(fn, fallbackMsg = "Не удалось сохранить данные") {
  try {
    return fn();
  } catch (e) {
    console.error("Storage error:", e);
    console.warn(fallbackMsg);
    return null;
  }
}

function addTask() {
  const result = Validate.nonEmptyString(refs.taskTitle.value);
  if (!result.ok) {
    alert(result.error);
    return;
  }
  const title = result.value;
  const date = State.selectedDate || new Date().toISOString().slice(0, 10);

  const task = {
    id: Id.next(),
    title,
    done: false,
    date,
    weekdays: [...State.repeatWeekdays],
    createdAt: new Date().toISOString(),
  };

  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.tasks, task));
  if (next === null) return;
  State.tasks = next;
  refs.taskTitle.value = "";
  render();
  Tg.haptic("impact_light");
}

function toggleTask(id) {
  const next = safeStorage(() => Storage.toggleItem(STORAGE_KEYS.tasks, id));
  if (next === null) return;
  State.tasks = next;
  render();
  Tg.haptic("impact_light");
}

function deleteTask(id) {
  if (!confirm("Удалить задачу?")) return;
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.tasks, id));
  if (next === null) return;
  State.tasks = next;
  render();
  Tg.haptic("impact_heavy");
}

function editTaskTitle(id) {
  const task = State.tasks.find((t) => t.id === id);
  if (!task) return;
  const newTitle = prompt("Новое название:", task.title);
  if (newTitle === null) return;
  const result = Validate.nonEmptyString(newTitle);
  if (!result.ok) {
    alert(result.error);
    return;
  }
  const next = safeStorage(() => Storage.replaceItem(STORAGE_KEYS.tasks, id, { title: result.value }));
  if (next === null) return;
  State.tasks = next;
  render();
}

// Shopping
function addShopping() {
  const result = Validate.nonEmptyString(refs.shoppingTitle.value);
  if (!result.ok) {
    alert(result.error);
    return;
  }
  const item = {
    id: Id.next(),
    title: result.value,
    done: false,
    createdAt: new Date().toISOString(),
  };
  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.shopping, item));
  if (next === null) return;
  State.shopping = next;
  refs.shoppingTitle.value = "";
  render();
  Tg.haptic("impact_light");
}

function toggleShopping(id) {
  const next = safeStorage(() => Storage.toggleItem(STORAGE_KEYS.shopping, id));
  if (next === null) return;
  State.shopping = next;
  render();
}

function deleteShopping(id) {
  if (!confirm("Удалить товар?")) return;
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.shopping, id));
  if (next === null) return;
  State.shopping = next;
  render();
}

// Wishlist
function addWish() {
  const titleRes = Validate.nonEmptyString(refs.wishTitle.value);
  if (!titleRes.ok) {
    alert(titleRes.error);
    return;
  }
  const urlRes = Validate.url(refs.wishUrl.value);
  if (!urlRes.ok) {
    alert(urlRes.error);
    return;
  }

  const wish = {
    id: Id.next(),
    title: titleRes.value,
    priority: refs.wishPriority.value,
    url: urlRes.value,
    createdAt: new Date().toISOString(),
  };
  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.wishlist, wish));
  if (next === null) return;
  State.wishlist = next;
  refs.wishTitle.value = "";
  refs.wishUrl.value = "";
  refs.wishPriority.value = "medium";
  render();
  Tg.haptic("impact_light");
}

function deleteWish(id) {
  if (!confirm("Удалить из вишлиста?")) return;
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.wishlist, id));
  if (next === null) return;
  State.wishlist = next;
  render();
}

// Theme
function setTheme(theme) {
  if (typeof State !== "undefined") {
    State.theme = theme;
  }
  const root = document.documentElement;
  root.setAttribute("data-twa-theme", theme);
  clearThemeOverrides();
  const saved = safeStorage(() => {
    Storage.write(STORAGE_KEYS.theme, theme);
    return theme;
  });
  render();
  if (saved === null) return;
  if (typeof Tg !== "undefined" && typeof Tg.haptic === "function") {
    Tg.haptic("impact_light");
  }
}

// ---------------- Helpers ----------------
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function loadState() {
  const savedTheme = Storage.read(STORAGE_KEYS.theme, "light");
  State.theme = savedTheme === "dark" ? "dark" : "light";

  State.tasks = Storage.read(STORAGE_KEYS.tasks, []);
  State.shopping = Storage.read(STORAGE_KEYS.shopping, []);
  State.wishlist = Storage.read(STORAGE_KEYS.wishlist, []);

  // Default selected date = today
  State.selectedDate = new Date().toISOString().slice(0, 10);
}

// ---------------- Bootstrap ----------------
function init() {
  loadState();
  Tg.init();
  initEventListeners();
  render();

  // Mark Telegram as available
  refs.tgStatus.textContent = window.Telegram?.WebApp ? "Telegram (online)" : "Telegram (offline)";
}

// Start when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
