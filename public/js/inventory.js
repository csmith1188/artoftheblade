import {
  ALL_PARTS,
  CATALOG,
  SLOT_KEYS,
  SLOT_META,
  CATEGORY_KEYS,
  CATEGORY_META,
  STAT_KEYS,
  getPartById,
} from "./shared/parts.js";
import { renderPartIconSvg } from "./partIcons.js";

const BOOT = window.__INVENTORY_BOOT__ || { chests: 0, inventory: {} };

const CATEGORY_COL_HINTS = {
  attack: ["Burst", "Edge", "Spin", "Bal"],
  defense: ["Armor", "Stab", "Mass", "Bal"],
  mobility: ["Launch", "Grip", "Bank", "Bal"],
  balanced: ["B·A·L", "E·S·G", "S·M·B", "All"],
};

const STAT_LABELS = {
  burst: "Burst",
  edge: "Edge",
  maxSpin: "Max Spin",
  armor: "Armor",
  stability: "Stability",
  mass: "Mass",
  launch: "Launch",
  grip: "Grip",
  bank: "Bank",
};

let chests = Number(BOOT.chests || 0);
/** @type {Record<string, number>} */
const inventory = { ...(BOOT.inventory || {}) };
let activeSlot = "layer";
let ownedOnly = false;
let selectedPartId = "layer-balanced-balanced-low";
let lastOpenedPartId = null;
let opening = false;

const chestCountEl = document.getElementById("chest-count");
const openChestBtn = document.getElementById("open-chest-btn");
const chestErrorEl = document.getElementById("chest-error");
const chestRevealEl = document.getElementById("chest-reveal");
const chestRevealEmptyEl = document.getElementById("chest-reveal-empty");
const chestRevealContentEl = document.getElementById("chest-reveal-content");

const ownedUniqueEl = document.getElementById("owned-unique");
const catalogTotalEl = document.getElementById("catalog-total");
const ownedTotalEl = document.getElementById("owned-total");
const slotTabsEl = document.getElementById("inv-slot-tabs");
const ownedOnlyToggle = document.getElementById("owned-only-toggle");
const inspectorEl = document.getElementById("inv-inspector");
const categoriesEl = document.getElementById("inv-categories");

function formatStatBadges(part) {
  return STAT_KEYS.filter((k) => (part[k] ?? 0) !== 0)
    .map((k) => {
      const val = part[k];
      const cls = val > 0 ? "is-pos" : "is-neg";
      const text = val > 0 ? `+${val}` : String(val);
      return `<span class="inv-stat-chip ${cls}">${STAT_LABELS[k]} ${text}</span>`;
    })
    .join("");
}

function updateSummary() {
  const entries = Object.entries(inventory).filter(([, qty]) => qty > 0);
  const uniqueCount = entries.length;
  const totalCount = entries.reduce((sum, [, qty]) => sum + qty, 0);

  if (ownedUniqueEl) ownedUniqueEl.textContent = String(uniqueCount);
  if (catalogTotalEl) catalogTotalEl.textContent = String(ALL_PARTS.length);
  if (ownedTotalEl) ownedTotalEl.textContent = String(totalCount);

  if (chestCountEl) chestCountEl.textContent = String(chests);
  if (openChestBtn) {
    openChestBtn.disabled = opening || chests <= 0;
    openChestBtn.textContent = opening
      ? "Opening…"
      : chests > 0
        ? "Open Chest"
        : "No Chests";
  }
}

function renderSlotTabs() {
  if (!slotTabsEl) return;
  slotTabsEl.innerHTML = "";
  for (const slot of SLOT_KEYS) {
    const ownedInSlot = CATALOG[slot].filter((p) => (inventory[p.id] || 0) > 0).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `inv-slot-tab ${slot === activeSlot ? "is-active" : ""}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(slot === activeSlot));
    btn.innerHTML = `
      <span>${SLOT_META[slot].label}</span>
      <span class="inv-slot-tab-count">${ownedInSlot}/${CATALOG[slot].length}</span>
    `;
    btn.addEventListener("click", () => {
      if (activeSlot === slot) return;
      activeSlot = slot;
      selectedPartId = `${slot}-balanced-balanced-low`;
      renderSlotTabs();
      renderGrid();
      renderInspector(getPartById(selectedPartId));
    });
    slotTabsEl.appendChild(btn);
  }
}

function renderInspector(part) {
  if (!inspectorEl || !part) return;
  const qty = inventory[part.id] || 0;
  const owned = qty > 0;

  inspectorEl.dataset.cat = part.category;
  inspectorEl.dataset.grade = part.grade;
  inspectorEl.classList.toggle("is-locked", !owned);
  inspectorEl.innerHTML = `
    <div class="inv-inspector-icon">${renderPartIconSvg(part)}</div>
    <div class="inv-inspector-main">
      <div class="inv-inspector-title-row">
        <strong>${part.name}</strong>
        <span class="inv-badge" data-grade="${part.grade}">${part.gradeLabel}</span>
        <span class="inv-badge">${SLOT_META[part.slot].label}</span>
        <span class="inv-badge">${CATEGORY_META[part.category].label} · ${part.focusLabel}</span>
        <span class="inv-own-pill ${owned ? "is-owned" : "is-locked"}">
          ${owned ? `Owned ×${qty}` : "Locked"}
        </span>
      </div>
      <div class="inv-stat-chips">${formatStatBadges(part)}</div>
    </div>
  `;
}

function renderGrid() {
  if (!categoriesEl) return;
  const slotParts = CATALOG[activeSlot];
  categoriesEl.innerHTML = "";

  for (const category of CATEGORY_KEYS) {
    const catParts = slotParts
      .filter((p) => p.category === category)
      .sort((a, b) => a.gradeOrder - b.gradeOrder || a.focusIndex - b.focusIndex);

    const visibleParts = ownedOnly
      ? catParts.filter((p) => (inventory[p.id] || 0) > 0)
      : catParts;

    const section = document.createElement("section");
    section.className = "part-cat-section inv-cat-section";
    section.dataset.cat = category;

    const ownedCatCount = catParts.filter((p) => (inventory[p.id] || 0) > 0).length;
    const head = document.createElement("div");
    head.className = "part-cat-head";
    head.innerHTML = `
      <span class="part-cat-title">${CATEGORY_META[category].label}</span>
      <span class="inv-cat-count">${ownedCatCount}/${catParts.length}</span>
    `;

    section.appendChild(head);

    if (!ownedOnly) {
      const colHints = document.createElement("div");
      colHints.className = "part-col-hints";
      for (const hint of CATEGORY_COL_HINTS[category]) {
        const span = document.createElement("span");
        span.textContent = hint;
        colHints.appendChild(span);
      }
      section.appendChild(colHints);
    }

    if (!visibleParts.length) {
      const empty = document.createElement("p");
      empty.className = "inv-cat-empty";
      empty.textContent = "No parts owned in this category yet.";
      section.appendChild(empty);
      categoriesEl.appendChild(section);
      continue;
    }

    const grid = document.createElement("div");
    grid.className = "part-grid";

    for (const part of visibleParts) {
      const qty = inventory[part.id] || 0;
      const owned = qty > 0;

      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "part-tile inv-tile";
      if (!owned) tile.classList.add("is-locked");
      if (part.id === selectedPartId) tile.classList.add("is-selected");
      if (part.id === lastOpenedPartId) tile.classList.add("is-just-opened");

      tile.dataset.partId = part.id;
      tile.dataset.cat = part.category;
      tile.dataset.grade = part.grade;
      tile.setAttribute(
        "aria-label",
        `${part.name} — ${part.gradeLabel} grade, ${owned ? `owned x${qty}` : "locked"}`
      );
      tile.innerHTML = `
        ${renderPartIconSvg(part)}
        <span class="part-tile-tier">${part.gradeShort}</span>
        ${qty > 1 ? `<span class="part-tile-qty">×${qty}</span>` : ""}
      `;
      tile.addEventListener("click", () => {
        selectedPartId = part.id;
        renderInspector(part);
        for (const el of categoriesEl.querySelectorAll(".inv-tile.is-selected")) {
          el.classList.remove("is-selected");
        }
        tile.classList.add("is-selected");
      });
      tile.addEventListener("mouseenter", () => {
        renderInspector(part);
      });
      grid.appendChild(tile);
    }

    section.appendChild(grid);
    categoriesEl.appendChild(section);
  }
}

function renderReveal(part, quantity, isDuplicate) {
  if (!chestRevealEl || !chestRevealEmptyEl || !chestRevealContentEl) return;

  chestRevealEmptyEl.hidden = true;
  chestRevealContentEl.hidden = false;
  chestRevealEl.dataset.grade = part.grade;
  chestRevealEl.dataset.cat = part.category;
  chestRevealEl.classList.remove("is-pop");
  // Trigger CSS animation restart
  void chestRevealEl.offsetWidth;
  chestRevealEl.classList.add("is-pop");

  chestRevealContentEl.innerHTML = `
    <div class="chest-reveal-icon">${renderPartIconSvg(part)}</div>
    <div class="chest-reveal-info">
      <div class="chest-reveal-tags">
        <span class="inv-badge" data-grade="${part.grade}">${part.gradeLabel} Grade</span>
        <span class="inv-badge">${SLOT_META[part.slot].label}</span>
        <span class="chest-new-pill ${isDuplicate ? "is-dup" : "is-new"}">
          ${isDuplicate ? `Duplicate · Now ×${quantity}` : "New Part!"}
        </span>
      </div>
      <h3 class="chest-reveal-name">${part.name}</h3>
      <p class="chest-reveal-meta">${CATEGORY_META[part.category].label} · ${part.focusLabel}</p>
      <div class="inv-stat-chips">${formatStatBadges(part)}</div>
    </div>
  `;
}

async function handleOpenChest() {
  if (opening || chests <= 0) return;
  opening = true;
  if (chestErrorEl) {
    chestErrorEl.hidden = true;
    chestErrorEl.textContent = "";
  }
  updateSummary();

  try {
    const res = await fetch("/api/chests/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      throw new Error(data.error || "Could not open chest.");
    }

    chests = data.chestsRemaining;
    const part = getPartById(data.item.id);
    if (part) {
      inventory[part.id] = data.quantity;
      lastOpenedPartId = part.id;
      activeSlot = part.slot;
      selectedPartId = part.id;
      renderReveal(part, data.quantity, data.isDuplicate);
      renderSlotTabs();
      renderGrid();
      renderInspector(part);
    }
  } catch (err) {
    if (chestErrorEl) {
      chestErrorEl.textContent = err.message || "Failed to open chest.";
      chestErrorEl.hidden = false;
    }
  } finally {
    opening = false;
    updateSummary();
  }
}

openChestBtn?.addEventListener("click", handleOpenChest);

ownedOnlyToggle?.addEventListener("change", () => {
  ownedOnly = Boolean(ownedOnlyToggle.checked);
  renderGrid();
});

updateSummary();
renderSlotTabs();
renderGrid();
renderInspector(getPartById(selectedPartId) || CATALOG.layer[0]);
