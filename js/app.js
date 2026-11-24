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
  piggybank: "tma_piggybank", // array of PiggybankEntry
  selectedDate: "tma_selected_date", // YYYY-MM-DD
  habits: "tma_habits", // array of Habit
};

const MAX_PIGGYBANK_AMOUNT = 10_000_000; // BYN — разумный верхний порог операции
const SAKURA_PETAL_COUNT = 40;
const COMET_COUNT = 15;
const HABIT_FAIL_THRESHOLD = 2; // подряд пропущенных дней до сброса стрика

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// Таймер тоста отмены удаления
let undoTimeoutId = null;

// ---------------- Types (documentation only, vanilla JS) ----------------
/*
Task  = { id: string, title: string, done: boolean, date: string, weekdays: number[], createdAt: string }
Item  = { id: string, title: string, done: boolean, createdAt: string }
Wish  = { id: string, title: string, priority: string, url: string, price: number | null, createdAt: string }
Theme = "light" | "dark"
Habit = { id: string, title: string, streak: number, lastDoneDate: string | null, consecutiveMisses: number, createdAt: string }
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
      render();
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
// Инкрементный счётчик без Date.now/Math.random (ограничение среды).
let idCounter = 0;

function initIdCounter() {
  const all = [
    ...Storage.read(STORAGE_KEYS.tasks, []),
    ...Storage.read(STORAGE_KEYS.shopping, []),
    ...Storage.read(STORAGE_KEYS.wishlist, []),
    ...Storage.read(STORAGE_KEYS.piggybank, []),
    ...Storage.read(STORAGE_KEYS.habits, []),
  ];
  const maxNum = all.reduce((max, item) => {
    const m = String(item.id || "").match(/^item-(\d+)$/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  idCounter = maxNum;
}

const Id = {
  next() {
    idCounter += 1;
    return `item-${idCounter}`;
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

  price(value) {
    if (!value || String(value).trim() === "") return { ok: true, value: null };
    const num = Number(String(value).trim());
    if (!Number.isFinite(num) || num < 0) {
      return { ok: false, error: "Цена должна быть неотрицательным числом" };
    }
    return { ok: true, value: num };
  },

};

// ---------------- App state ----------------
const State = {
  theme: "light",
  tasks: [],
  shopping: [],
  wishlist: [],
  piggybank: [],
  activeTab: "tasks",
  selectedDate: "", // ISO date YYYY-MM-DD
  repeatWeekdays: [], // 0-6
  repeatEnabled: false,
  habits: [], // array of Habit (изолированный модуль)
};

// ---------------- DOM refs ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const refs = {
  app: $("#app"),
  btnTheme: $("#btnTheme"),
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
  undoToast: $("#undo-toast"),
  undoMessage: $("#undo-message"),
  undoBtn: $("#undo-btn"),
  shoppingTitle: $("#shoppingTitle"),
  btnAddShopping: $("#btnAddShopping"),
  btnClearAllShopping: $("#btnClearAllShopping"),
  btnDeleteCompletedShopping: $("#btnDeleteCompletedShopping"),
  shoppingList: $("#shoppingList"),
  emptyShopping: $("#emptyShopping"),
  wishTitle: $("#wishTitle"),
  wishPriority: $("#wishPriority"),
  wishUrl: $("#wishUrl"),
  wishPrice: $("#wishPrice"),
  btnAddWish: $("#btnAddWish"),
  wishlistList: $("#wishlistList"),
  emptyWishlist: $("#emptyWishlist"),
  // Копилка
  piggybankAmount: $("#piggybankAmount"),
  btnAddPiggybank: $("#btnAddPiggybank"),
  piggybankList: $("#piggybankList"),
  emptyPiggybank: $("#emptyPiggybank"),
  piggybankTotal: $("#piggybankTotal"),
  piggybankError: $("#piggybankError"),
  // Привычки
  habitTitle: $("#habitTitle"),
  habitAddBtn: $("#habitAddBtn"),
  habitList: $("#habitList"),
  emptyHabits: $("#emptyHabits"),
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
  else if (State.activeTab === "piggybank") renderPiggybank();
  else if (State.activeTab === "habits") renderHabits();
}

function filterTasksForDate(date) {
  const weekday = new Date(date).getDay();
  return State.tasks.filter((t) => {
    if (t.date === date) return true;
    if (t.weekdays && t.weekdays.includes(weekday)) return true;
    return false;
  });
}

function isTaskDoneOn(task, date) {
  const doneDates = task.doneDates || [];
  return task.doneDates ? doneDates.includes(date) : task.done;
}

function renderTaskItem(task, date) {
  const li = document.createElement("li");
  const isDone = isTaskDoneOn(task, date);
  li.className = `task-item ${isDone ? "done" : ""}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.dataset.id = task.id;
  checkbox.checked = isDone;
  if (isDone) checkbox.classList.add("task-checkbox--checked");

  const title = document.createElement("div");
  title.className = "task-title";
  title.dataset.id = task.id;
  title.textContent = escapeHtml(task.title);
  if (task.weekdays && task.weekdays.length > 0) {
    const badge = document.createElement("span");
    badge.className = "repeat-badge";
    badge.textContent = "↻";
    title.appendChild(document.createTextNode(" "));
    title.appendChild(badge);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "btn-delete";
  delBtn.dataset.id = task.id;
  delBtn.title = "Удалить";
  delBtn.textContent = "×";

  li.appendChild(checkbox);
  li.appendChild(title);
  li.appendChild(delBtn);

  return li;
}

function renderTasks() {
  const date = State.selectedDate || "";
  refs.taskDate.value = date;

  // Repeat weekday UI
  refs.taskRepeat.checked = State.repeatEnabled;
  refs.weekdaysContainer.style.display = State.repeatEnabled ? "flex" : "none";
  refs.weekdays.forEach((cb) => {
    cb.checked = State.repeatWeekdays.includes(Number(cb.value));
  });

  const relevant = filterTasksForDate(date);
  refs.taskList.innerHTML = "";
  refs.emptyTasks.classList.toggle("show", relevant.length === 0);

  relevant.forEach((task) => {
    refs.taskList.appendChild(renderTaskItem(task, date));
  });

  // Suggestions from other days
  renderSuggestions(date);
}

function renderSuggestions(currentDate) {
  // Не предлагаем повторяющиеся задачи из других дней — они уже на своих датах.
  const other = State.tasks.filter((t) => t.date !== currentDate && !t.done && (!t.weekdays || t.weekdays.length === 0));
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

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.dataset.id = item.id;
    checkbox.checked = item.done;
    if (item.done) checkbox.classList.add("task-checkbox--checked");

    const title = document.createElement("div");
    title.className = "task-title";
    title.dataset.id = item.id;
    title.textContent = escapeHtml(item.title);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.dataset.id = item.id;
    delBtn.title = "Удалить";
    delBtn.textContent = "×";

    li.appendChild(checkbox);
    li.appendChild(title);
    li.appendChild(delBtn);
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
    const priceText = w.price != null ? ` ${Number(w.price).toFixed(2)} BYN` : "";
    metaEl.textContent = `${w.priority}${priceText}`;

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
    const date = e.target.value;
    State.selectedDate = date;
    State.repeatWeekdays = [];
    State.repeatEnabled = false;
    safeStorage(() => Storage.write(STORAGE_KEYS.selectedDate, date));
    render();
  });

  refs.taskRepeat.addEventListener("change", (e) => {
    State.repeatEnabled = e.target.checked;
    if (!State.repeatEnabled) {
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
  initPiggybankControls();
  initHabitListeners();

  if (refs.btnClearAllShopping) {
    refs.btnClearAllShopping.addEventListener("click", clearAllShopping);
  }
  if (refs.btnDeleteCompletedShopping) {
    refs.btnDeleteCompletedShopping.addEventListener("click", deleteCompletedShopping);
  }

  if (refs.undoBtn) {
    refs.undoBtn.addEventListener("click", () => {
      restoreUndoTask();
    });
  }
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
  const date = State.selectedDate || "";
  if (!date) {
    alert("Выберите дату");
    return;
  }

  const exists = State.tasks.some(
    (t) => t.title.toLowerCase() === title.toLowerCase() && t.date === date
  );
  if (exists) {
    alert("Задача с таким названием уже есть на этот день");
    return;
  }

  const task = {
    id: Id.next(),
    title,
    done: false,
    date,
    weekdays: [...State.repeatWeekdays],
    doneDates: [],
    createdAt: date,
  };

  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.tasks, task));
  if (next === null) return;
  State.tasks = next;
  refs.taskTitle.value = "";
  State.repeatEnabled = false;
  State.repeatWeekdays = [];
  render();
  Tg.haptic("impact_light");
}

function toggleTask(id) {
  const task = State.tasks.find((t) => t.id === id);
  if (!task) return;

  const date = State.selectedDate || "";

  if (task.weekdays && task.weekdays.length > 0) {
    // Повторяющаяся задача — отметка выполнения только для конкретной даты,
    // чтобы не затрагивать другие дни недели, где задача тоже показывается.
    const doneDates = task.doneDates || [];
    const isDone = doneDates.includes(date);
    const nextDoneDates = isDone
      ? doneDates.filter((d) => d !== date)
      : [...doneDates, date];

    const next = safeStorage(() => Storage.replaceItem(STORAGE_KEYS.tasks, id, { doneDates: nextDoneDates }));
    if (next === null) return;
    State.tasks = next;
  } else {
    // Разовая задача — инвертируем done целиком
    const next = safeStorage(() => Storage.toggleItem(STORAGE_KEYS.tasks, id));
    if (next === null) return;
    State.tasks = next;
  }

  render();
  Tg.haptic("impact_light");
}

function removeTaskWeekday(id, task) {
  const date = State.selectedDate || "";
  const weekday = date ? new Date(date).getDay() : -1;
  const nextWeekdays = task.weekdays.filter((d) => d !== weekday);
  if (nextWeekdays.length === 0) return null; // не осталось дней — удаляем полностью

  // Сбрасываем date, чтобы задача не показывалась в renderTasks() (фильтрация по t.date === date),
  // и уменьшаем weekdays.
  const next = safeStorage(() => Storage.replaceItem(STORAGE_KEYS.tasks, id, {
    weekdays: nextWeekdays,
    date: null,
  }));
  if (next === null) return false;
  State.tasks = next;
  render();
  Tg.haptic("impact_light");
  return true; // удалён только день, полного удаления не было
}

function deleteTask(id) {
  const task = State.tasks.find((t) => t.id === id);
  if (!task) return;

  // Если задача повторяющаяся — спрашиваем, что удалять
  let targetTask = task;
  if (task.weekdays && task.weekdays.length > 0) {
    const choice = confirm(
      `Удалить задачу "${task.title}"?\n\nНажмите "ОК" — удалить на все дни.\nНажмите "Отмена" — удалить только на этот день.`
    );
    if (choice) {
      targetTask = task; // удаляем полностью
    } else {
      const removedDay = removeTaskWeekday(id, task);
      if (removedDay === true) return; // удалён только день
      // removedDay === null: не осталось дней — удаляем полностью ниже
    }
  }

  // Отменяем предыдущий таймер тоста, если был
  if (undoTimeoutId !== null) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
    hideUndoToast();
  }

  // Удаляем задачу из стейта и стора
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.tasks, id));
  if (next === null) return;
  State.tasks = next;

  // Показываем тост с отменой
  showUndoToast(targetTask);
  render();
  Tg.haptic("impact_heavy");
}

function showUndoToast(task) {
  if (!refs.undoToast || !refs.undoMessage || !refs.undoBtn) return;

  refs.undoMessage.textContent = `Задача "${escapeHtml(task.title)}" удалена`;
  refs.undoToast.style.display = "flex";
  refs.undoToast.setAttribute("aria-hidden", "false");

  // Запоминаем задачу для восстановления
  refs.undoBtn.dataset.undoTask = JSON.stringify(task);

  // Автоскрытие через 5 секунд
  undoTimeoutId = setTimeout(() => {
    hideUndoToast();
    refs.undoBtn.dataset.undoTask = "";
  }, 5000);
}

function hideUndoToast() {
  if (!refs.undoToast) return;
  refs.undoToast.style.display = "none";
  refs.undoToast.setAttribute("aria-hidden", "true");
  if (undoTimeoutId !== null) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }
}

function restoreUndoTask() {
  if (!refs.undoBtn || !refs.undoBtn.dataset.undoTask) return;
  const taskJson = refs.undoBtn.dataset.undoTask;
  if (!taskJson) return;

  const task = JSON.parse(taskJson);
  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.tasks, task));
  if (next === null) return;
  State.tasks = next;
  refs.undoBtn.dataset.undoTask = "";
  hideUndoToast();
  render();
  Tg.haptic("impact_light");
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

  const exists = State.shopping.some(
    (i) => i.title.toLowerCase() === result.value.toLowerCase()
  );
  if (exists) {
    alert("Товар с таким названием уже есть в списке");
    return;
  }

  const item = {
    id: Id.next(),
    title: result.value,
    done: false,
    createdAt: "",
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

function clearAllShopping() {
  if (State.shopping.length === 0) return;
  if (!confirm("Очистить весь список покупок?")) return;
  const next = safeStorage(() => Storage.write(STORAGE_KEYS.shopping, []));
  if (next === null) return;
  State.shopping = next;
  render();
  Tg.haptic("impact_heavy");
}

function deleteCompletedShopping() {
  const completed = State.shopping.filter((i) => i.done);
  if (completed.length === 0) return;
  if (!confirm(`Удалить ${completed.length} купленн${completed.length === 1 ? "ое" : "ых"}?`)) return;
  const next = safeStorage(() => {
    const remaining = State.shopping.filter((i) => !i.done);
    Storage.write(STORAGE_KEYS.shopping, remaining);
    return remaining;
  });
  if (next === null) return;
  State.shopping = next;
  render();
  Tg.haptic("impact_heavy");
}

// Wishlist
function addWish() {
  const titleRes = Validate.nonEmptyString(refs.wishTitle.value);
  if (!titleRes.ok) {
    alert(titleRes.error);
    return;
  }

  const exists = State.wishlist.some(
    (w) => w.title.toLowerCase() === titleRes.value.toLowerCase()
  );
  if (exists) {
    alert("Виш с таким названием уже есть в списке");
    return;
  }
  const urlRes = Validate.url(refs.wishUrl.value);
  if (!urlRes.ok) {
    alert(urlRes.error);
    return;
  }
  const priceRes = Validate.price(refs.wishPrice.value);
  if (!priceRes.ok) {
    alert(priceRes.error);
    return;
  }

  const wish = {
    id: Id.next(),
    title: titleRes.value,
    priority: refs.wishPriority.value,
    url: urlRes.value,
    price: priceRes.value,
    createdAt: "",
  };
  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.wishlist, wish));
  if (next === null) return;
  State.wishlist = next;
  refs.wishTitle.value = "";
  refs.wishUrl.value = "";
  refs.wishPrice.value = "";
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
  initSakura();
  initComets();
  if (saved === null) return;
  if (typeof Tg !== "undefined" && typeof Tg.haptic === "function") {
    Tg.haptic("impact_light");
  }
}

// ---------------- Helpers ----------------
function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadState() {
  const savedTheme = Storage.read(STORAGE_KEYS.theme, "light");
  State.theme = savedTheme === "dark" ? "dark" : "light";

  State.tasks = Storage.read(STORAGE_KEYS.tasks, []);
  State.shopping = Storage.read(STORAGE_KEYS.shopping, []);
  State.wishlist = Storage.read(STORAGE_KEYS.wishlist, []);
  State.piggybank = Storage.read(STORAGE_KEYS.piggybank, []);
  State.habits = Storage.read(STORAGE_KEYS.habits, []);

  initIdCounter();

  // Default selected date — сегодняшняя дата при первом запуске
  const savedDate = Storage.read(STORAGE_KEYS.selectedDate, "");
  const todayStr = new Date().toISOString().slice(0, 10);
  State.selectedDate = savedDate || todayStr;
  // Сохраняем сегодняшнюю дату, если её еще не было в хранилище
  if (!savedDate) {
    Storage.write(STORAGE_KEYS.selectedDate, todayStr);
  }
}

// ---------------- Bootstrap ----------------
function init() {
  loadState();
  Tg.init();
  initEventListeners();
  render();
  initSakura();
  initComets();

}

// Start when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ---------------- Копилка (Piggybank) ----------------
// Неизменяемые обновления через Storage (localStorage, синхронно)

function formatPiggybankAmount(amount) {
  const value = Number(amount) || 0;
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${formattedInt},${decPart} BYN`;
}

function getPiggybankTotal() {
  return State.piggybank.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function renderPiggybank() {
  if (!refs.piggybankTotal || !refs.piggybankList || !refs.emptyPiggybank) return;

  refs.piggybankTotal.textContent = formatPiggybankAmount(getPiggybankTotal());
  refs.piggybankList.innerHTML = "";

  const hasEntries = State.piggybank.length > 0;
  refs.emptyPiggybank.classList.toggle("show", !hasEntries);

  // Новые записи сверху
  const entries = [...State.piggybank].sort((a, b) => {
    const da = new Date(a.date || a.createdAt || 0).getTime();
    const db = new Date(b.date || b.createdAt || 0).getTime();
    return db - da;
  });

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = `task-item ${entry.done ? "done" : ""}`;

    const dateDiv = document.createElement("div");
    dateDiv.style.flex = "1";

    const dateText = document.createElement("div");
    dateText.className = "task-title";
    dateText.style.fontSize = "var(--font-size-body)";
    dateText.style.color = "var(--color-text-primary)";
    dateText.textContent = entry.date || entry.createdAt || "";

    dateDiv.appendChild(dateText);

    const amountDiv = document.createElement("div");
    amountDiv.style.fontSize = "var(--font-size-body)";
    amountDiv.style.fontWeight = "var(--font-weight-semibold)";
    amountDiv.style.color = "var(--color-text-pink)";
    amountDiv.textContent = formatPiggybankAmount(entry.amount);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.dataset.id = entry.id;
    delBtn.title = "Удалить";
    delBtn.textContent = "×";

    li.appendChild(dateDiv);
    li.appendChild(amountDiv);
    li.appendChild(delBtn);

    refs.piggybankList.appendChild(li);
  });
}

function addPiggybankEntry() {
  if (!refs.piggybankAmount || !refs.piggybankError || !refs.btnAddPiggybank) return;

  const raw = refs.piggybankAmount.value.trim().replace(",", ".");
  const amount = Number(raw);

  if (!raw) {
    refs.piggybankError.textContent = "Введите сумму";
    refs.piggybankError.style.display = "block";
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    refs.piggybankError.textContent = "Сумма должна быть больше 0";
    refs.piggybankError.style.display = "block";
    return;
  }
  if (amount > MAX_PIGGYBANK_AMOUNT) {
    refs.piggybankError.textContent = `Сумма слишком большая (макс. ${MAX_PIGGYBANK_AMOUNT.toLocaleString("ru-RU")} BYN)`;
    refs.piggybankError.style.display = "block";
    return;
  }

  const entry = {
    id: Id.next(),
    amount,
    currency: "BYN",
    date: "",
    createdAt: "",
  };

  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.piggybank, entry), "Не удалось сохранить в копилку");
  if (next === null) return;

  State.piggybank = next;
  refs.piggybankAmount.value = "";
  refs.piggybankError.style.display = "none";
  renderPiggybank();
  Tg.haptic("impact_light");
}

function deletePiggybankEntry(id) {
  if (!confirm("Удалить запись из копилки?")) return;
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.piggybank, id), "Не удалось удалить запись");
  if (next === null) return;
  State.piggybank = next;
  renderPiggybank();
  Tg.haptic("impact_heavy");
}

function initPiggybankControls() {
  if (!refs.btnAddPiggybank || !refs.piggybankAmount) return;

  refs.btnAddPiggybank.addEventListener("click", addPiggybankEntry);

  refs.piggybankAmount.addEventListener("input", () => {
    const raw = refs.piggybankAmount.value.trim().replace(",", ".");
    const amount = Number(raw);
    const valid = raw !== "" && Number.isFinite(amount) && amount > 0;
    refs.btnAddPiggybank.disabled = !valid;
    refs.piggybankError.style.display = "none";
  });

  refs.piggybankAmount.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPiggybankEntry();
  });

  refs.piggybankList.addEventListener("click", (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains("btn-delete")) {
      e.stopPropagation();
      deletePiggybankEntry(id);
    }
  });
}

// ================================================================
// МОДУЛЬ «ПРИВЫЧКИ» (Habits) — изолированный раздел
// НЕ зависит от задач, покупок, вишлиста, копилки
// Хранилище: tma_habits
// ================================================================

/**
 * Возвращает сегодняшнюю дату в формате YYYY-MM-DD.
 * Единственное место, где используется new Date() без аргументов (для today).
 */
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Проверяет статус привычки на сегодня и обновляет consecutiveMisses.
 * Если consecutiveMisses > HABIT_FAIL_THRESHOLD (более 2 дней пропуска),
 * автоматически сбрасывает streak в 0, consecutiveMisses в 0, lastDoneDate в null.
 * Не мутирует привычку — возвращает новый объект (или тот же, если изменений нет).
 */
function checkHabitStatus(habit) {
  const today = todayString();
  let consecutiveMisses = habit.consecutiveMisses || 0;
  let streak = habit.streak || 0;
  let lastDoneDate = habit.lastDoneDate || null;

  if (!lastDoneDate) {
    // Новая или сброшенная привычка — стрик 0
    return { ...habit, streak: 0, consecutiveMisses: 0, lastDoneDate: null };
  }

  if (lastDoneDate === today) {
    // Уже выполнена сегодня — ничего не меняем
    return habit;
  }

  // Считаем разрыв дней между последним выполнением и сегодня
  const diffDays = dateDiffDays(lastDoneDate, today);
  if (diffDays > 1) {
    consecutiveMisses += diffDays - 1;
    if (consecutiveMisses > HABIT_FAIL_THRESHOLD) {
      // Автосброс стрика при превышении лимита пропусков
      streak = 0;
      consecutiveMisses = 0;
      lastDoneDate = null;
    }
  }

  return { ...habit, consecutiveMisses, streak, lastDoneDate };
}

/**
 * Разница в календарных днях между двумя строками YYYY-MM-DD (today - from).
 */
function dateDiffDays(from, to) {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  const ms = b - a;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Добавить новую привычку.
 */
function addHabit() {
  const result = Validate.nonEmptyString(refs.habitTitle.value, 100);
  if (!result.ok) {
    alert(result.error);
    return;
  }
  const title = result.value;

  const exists = State.habits.some((h) => h.title.toLowerCase() === title.toLowerCase());
  if (exists) {
    alert("Привычка с таким названием уже есть");
    return;
  }

  const habit = {
    id: Id.next(),
    title,
    streak: 0,
    lastDoneDate: null,
    consecutiveMisses: 0,
    createdAt: todayString(),
  };

  const next = safeStorage(() => Storage.addItem(STORAGE_KEYS.habits, habit));
  if (next === null) return;
  State.habits = next;
  refs.habitTitle.value = "";
  renderHabits();
  Tg.haptic("impact_light");
}

/**
 * Отметить привычку выполненной / снять отметку на сегодня.
 */
function toggleHabit(id) {
  const habit = State.habits.find((h) => h.id === id);
  if (!habit) return;

  const today = todayString();
  if (habit.lastDoneDate === today) return; // уже выполнено сегодня

  const next = safeStorage(() =>
    Storage.replaceItem(STORAGE_KEYS.habits, id, {
      streak: (habit.streak || 0) + 1,
      lastDoneDate: today,
      consecutiveMisses: 0,
    })
  );
  if (next === null) return;
  State.habits = next;
  renderHabits();
  Tg.haptic("impact_light");
}

/**
 * Удалить привычку.
 */
function deleteHabit(id) {
  if (!confirm("Удалить привычку?")) return;
  const next = safeStorage(() => Storage.removeItem(STORAGE_KEYS.habits, id));
  if (next === null) return;
  State.habits = next;
  renderHabits();
  Tg.haptic("impact_heavy");
}

/**
 * Рендерить карточку одной привычки.
 */
function renderHabitItem(habit) {
  const checked = habit.lastDoneDate === todayString();
  const fire = checked ? "🔥" : "";

  const li = document.createElement("li");
  li.className = `habit-item ${checked ? "done" : ""}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "habit-checkbox";
  checkbox.dataset.id = habit.id;
  checkbox.checked = checked;

  const fireEl = document.createElement("span");
  fireEl.className = "habit-fire";
  fireEl.textContent = fire;
  fireEl.setAttribute("aria-hidden", "true");

  const streak = document.createElement("span");
  streak.className = "habit-streak";
  streak.textContent = habit.streak > 0 ? String(habit.streak || 0) : "";

  const title = document.createElement("div");
  title.className = "habit-title";
  title.textContent = escapeHtml(habit.title);

  const delBtn = document.createElement("button");
  delBtn.className = "habit-delete-btn";
  delBtn.dataset.id = habit.id;
  delBtn.title = "Удалить привычку";
  delBtn.textContent = "×";

  li.appendChild(checkbox);
  li.appendChild(fireEl);
  li.appendChild(streak);
  li.appendChild(title);
  li.appendChild(delBtn);

  return li;
}

/**
 * Рендерить весь список привычек.
 */
function renderHabits() {
  if (!refs.habitList || !refs.emptyHabits) return;

  const today = todayString();
  const checked = State.habits.map((h) => checkHabitStatus(h));
  // Обновляем стейт, если статус изменился (провалы)
  const changed = checked.some((h, i) => h.consecutiveMisses !== State.habits[i]?.consecutiveMisses || h.streak !== State.habits[i]?.streak || h.lastDoneDate !== State.habits[i]?.lastDoneDate);
  if (changed) {
    State.habits = checked;
    safeStorage(() => Storage.write(STORAGE_KEYS.habits, checked));
  }

  refs.habitList.innerHTML = "";
  refs.emptyHabits.classList.toggle("show", State.habits.length === 0);

  State.habits.forEach((habit) => {
    refs.habitList.appendChild(renderHabitItem(habit));
  });
}

/**
 * Подписаться на события раздела Привычки.
 */
function initHabitListeners() {
  if (!refs.habitAddBtn || !refs.habitTitle || !refs.habitList) return;

  refs.habitAddBtn.addEventListener("click", addHabit);
  refs.habitTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addHabit();
  });

  refs.habitList.addEventListener("click", (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains("habit-checkbox")) {
      toggleHabit(id);
    } else if (e.target.classList.contains("habit-delete-btn")) {
      e.stopPropagation();
      deleteHabit(id);
    }
  });
}

// ---------------- Сакура (Sakura petals) ----------------
function createSakuraPetal() {
  const petal = document.createElement("div");
  petal.className = "sakura-petal";

  const left = Math.random() * 100;
  const size = 6 + Math.random() * 10; // 6–16 px
  const duration = 10 + Math.random() * 15; // 10–25 s
  const delay = 0; // лепестки стартуют сразу при загрузке
  const opacity = 0.6 + Math.random() * 0.3;

  petal.style.left = `${left}%`;
  petal.style.top = `${-10 - Math.random() * 20}%`;
  petal.style.width = `${size}px`;
  petal.style.height = `${size * 0.7}px`;
  petal.style.opacity = opacity;
  petal.style.animationDuration = `${duration}s`;

  return petal;
}

function initSakura() {
  const container = document.getElementById("sakura-container");
  if (!container) return;

  container.innerHTML = "";

  const isLight = State.theme === "light";
  if (!isLight) return;

  for (let i = 0; i < SAKURA_PETAL_COUNT; i++) {
    container.appendChild(createSakuraPetal());
  }
}

// ---------------- Кометы (стреляющие звёзды, только тёмная тема) ----------------
function createComet() {
  const comet = document.createElement("div");
  const colors = ["cyan", "pink", "blue", "purple"];
  comet.className = `comet ${colors[Math.floor(Math.random() * colors.length)]}`;

  const left = Math.random() * 100;
  const top = Math.random() * 100;
  const duration = 3 + Math.random() * 5; // 3–8 с
  const delay = Math.random() * 10; // 0–10 с между комет

  const angle = Math.random() * 360; // случайное направление
  const distance = 50 + Math.random() * 60; // 50–120 vh
  const tx = Math.cos((angle * Math.PI) / 180) * distance;
  const ty = -Math.sin((angle * Math.PI) / 180) * distance;

  comet.style.left = `${left}%`;
  comet.style.top = `${top}%`;
  comet.style.setProperty("--comet-angle", `${angle}deg`);
  comet.style.setProperty("--comet-tx", `${tx}vh`);
  comet.style.setProperty("--comet-ty", `${ty}vh`);
  comet.style.animationDuration = `${duration}s`;
  comet.style.animationDelay = `${delay}s`;

  return comet;
}

function initComets() {
  const container = document.getElementById("comet-container");
  if (!container) return;

  container.innerHTML = "";

  const isDark = State.theme === "dark";
  if (!isDark) return;

  for (let i = 0; i < COMET_COUNT; i++) {
    container.appendChild(createComet());
  }
}

