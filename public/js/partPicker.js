import {
  CATALOG,
  SLOT_KEYS,
  SLOT_META,
  CATEGORY_KEYS,
  CATEGORY_META,
  getPartById,
} from "./shared/parts.js";
import { renderPartIconSvg } from "./partIcons.js";

const CATEGORY_COL_HINTS = {
  attack: ["Burst", "Edge", "Spin", "Bal"],
  defense: ["Armor", "Stab", "Mass", "Bal"],
  mobility: ["Launch", "Grip", "Bank", "Bal"],
  balanced: ["B·A·L", "E·S·G", "S·M·B", "All"],
};

/**
 * Mounts an inline tabbed 4x3 category-grouped part picker into rootEl.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   player: number,
 *   getLoadout: () => { layer: string, disk: string, driver: string },
 *   getOwnedParts?: () => Record<string, number>,
 *   onHover: (player: number, slot: string | null, partId: string | null) => void,
 *   onEquip: (player: number, slot: string, partId: string) => void,
 * }} opts
 */
export function createPartPicker(rootEl, { player, getLoadout, getOwnedParts, onHover, onEquip }) {
  let activeSlot = "layer";
  let enabled = true;
  let hoveredPartId = null;

  function getOwnedQty(partId) {
    if (!getOwnedParts) return 1;
    const map = getOwnedParts();
    return map ? Number(map[partId] || 0) : 0;
  }

  function isOwned(partId) {
    return getOwnedQty(partId) > 0;
  }

  rootEl.innerHTML = "";
  rootEl.classList.add("part-picker");

  const tabsEl = document.createElement("div");
  tabsEl.className = "part-tabs";
  tabsEl.setAttribute("role", "tablist");
  tabsEl.setAttribute("aria-label", `Player ${player + 1} part slots`);

  const readoutEl = document.createElement("div");
  readoutEl.className = "part-readout";

  const categoriesEl = document.createElement("div");
  categoriesEl.className = "part-categories";

  rootEl.append(tabsEl, readoutEl, categoriesEl);

  /** @type {Record<string, HTMLButtonElement>} */
  const tabButtons = {};

  for (const slot of SLOT_KEYS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "part-tab";
    btn.dataset.slot = slot;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => {
      if (activeSlot === slot) return;
      activeSlot = slot;
      clearHover();
      renderTabs();
      renderGrid();
      renderReadout(null);
    });
    tabButtons[slot] = btn;
    tabsEl.appendChild(btn);
  }

  function clearHover() {
    if (hoveredPartId !== null) {
      hoveredPartId = null;
      onHover(player, null, null);
      renderReadout(null);
    }
  }

  function renderTabs() {
    const loadout = getLoadout();
    for (const slot of SLOT_KEYS) {
      const btn = tabButtons[slot];
      const part = getPartById(loadout[slot]) ?? CATALOG[slot][0];
      const isActive = slot === activeSlot;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
      btn.dataset.cat = part.category;
      btn.dataset.grade = part.grade;
      btn.innerHTML = `
        <span class="part-tab-slot">${SLOT_META[slot].label}</span>
        <span class="part-tab-equipped">
          <span class="part-tab-icon">${renderPartIconSvg(part, { showPips: false })}</span>
          <span class="part-tab-name">${part.name}</span>
        </span>
      `;
    }
  }

  function renderReadout(part) {
    const loadout = getLoadout();
    const displayPart = part ?? getPartById(loadout[activeSlot]) ?? CATALOG[activeSlot][0];
    const isPreview = Boolean(part && part.id !== loadout[activeSlot]);
    const qty = getOwnedQty(displayPart.id);
    const locked = qty <= 0;

    readoutEl.dataset.cat = displayPart.category;
    readoutEl.dataset.grade = displayPart.grade;
    readoutEl.classList.toggle("is-preview", isPreview);
    readoutEl.classList.toggle("is-locked", locked);
    readoutEl.innerHTML = `
      <span class="part-readout-name">${displayPart.name}</span>
      <span class="part-readout-meta">
        <span class="part-readout-focus">${displayPart.focusLabel}</span>
        ${locked ? `<span class="part-readout-lock">Locked</span>` : qty > 1 ? `<span class="part-readout-qty">×${qty}</span>` : ""}
      </span>
    `;
  }

  function renderGrid() {
    const loadout = getLoadout();
    const equippedId = loadout[activeSlot];
    const slotParts = CATALOG[activeSlot];

    categoriesEl.innerHTML = "";

    for (const category of CATEGORY_KEYS) {
      const section = document.createElement("section");
      section.className = "part-cat-section";
      section.dataset.cat = category;

      const head = document.createElement("div");
      head.className = "part-cat-head";
      head.innerHTML = `<span class="part-cat-title">${CATEGORY_META[category].label}</span>`;

      const colHints = document.createElement("div");
      colHints.className = "part-col-hints";
      for (const hint of CATEGORY_COL_HINTS[category]) {
        const span = document.createElement("span");
        span.textContent = hint;
        colHints.appendChild(span);
      }

      const grid = document.createElement("div");
      grid.className = "part-grid";

      const catParts = slotParts
        .filter((p) => p.category === category)
        .sort((a, b) => a.gradeOrder - b.gradeOrder || a.focusIndex - b.focusIndex);

      for (const part of catParts) {
        const qty = getOwnedQty(part.id);
        const owned = qty > 0;
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "part-tile";
        if (part.id === equippedId) tile.classList.add("is-equipped");
        if (!owned) tile.classList.add("is-locked");
        tile.disabled = !enabled;
        tile.dataset.partId = part.id;
        tile.dataset.cat = part.category;
        tile.dataset.grade = part.grade;
        tile.dataset.focus = part.focus;
        tile.setAttribute(
          "aria-label",
          `${part.name} — ${CATEGORY_META[part.category].label} (${part.focusLabel}), ${part.gradeLabel} grade${owned ? (qty > 1 ? `, owned x${qty}` : "") : ", locked"}`
        );
        tile.setAttribute("aria-pressed", String(part.id === equippedId));
        tile.setAttribute("aria-disabled", String(!enabled || !owned));
        tile.innerHTML = `
          ${renderPartIconSvg(part)}
          <span class="part-tile-tier">${part.gradeShort}</span>
          ${qty > 1 ? `<span class="part-tile-qty">×${qty}</span>` : ""}
        `;
        grid.appendChild(tile);
      }

      section.append(head, colHints, grid);
      categoriesEl.appendChild(section);
    }
  }

  categoriesEl.addEventListener("mouseover", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const tile = target.closest(".part-tile");
    if (!(tile instanceof HTMLButtonElement)) return;
    const partId = tile.dataset.partId;
    if (!partId || partId === hoveredPartId) return;
    hoveredPartId = partId;
    const part = getPartById(partId);
    renderReadout(part);
    onHover(player, activeSlot, partId);
  });

  categoriesEl.addEventListener("mouseleave", () => {
    clearHover();
  });

  categoriesEl.addEventListener("focusin", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const tile = target.closest(".part-tile");
    if (!(tile instanceof HTMLButtonElement)) return;
    const partId = tile.dataset.partId;
    if (!partId || partId === hoveredPartId) return;
    hoveredPartId = partId;
    const part = getPartById(partId);
    renderReadout(part);
    onHover(player, activeSlot, partId);
  });

  categoriesEl.addEventListener("focusout", (e) => {
    if (!categoriesEl.contains(e.relatedTarget)) {
      clearHover();
    }
  });

  categoriesEl.addEventListener("click", (e) => {
    if (!enabled) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const tile = target.closest(".part-tile");
    if (!(tile instanceof HTMLButtonElement)) return;
    const partId = tile.dataset.partId;
    if (!partId || !isOwned(partId)) return;
    onEquip(player, activeSlot, partId);
  });

  function sync() {
    renderTabs();
    const loadout = getLoadout();
    const equippedId = loadout[activeSlot];
    const tiles = categoriesEl.querySelectorAll(".part-tile");
    for (const tile of tiles) {
      if (!(tile instanceof HTMLButtonElement)) continue;
      const partId = tile.dataset.partId;
      const isEq = partId === equippedId;
      const qty = partId ? getOwnedQty(partId) : 0;
      const owned = qty > 0;
      tile.classList.toggle("is-equipped", isEq);
      tile.classList.toggle("is-locked", !owned);
      tile.setAttribute("aria-pressed", String(isEq));
      tile.setAttribute("aria-disabled", String(!enabled || !owned));

      let qtyEl = tile.querySelector(".part-tile-qty");
      if (qty > 1) {
        if (!qtyEl) {
          qtyEl = document.createElement("span");
          qtyEl.className = "part-tile-qty";
          tile.appendChild(qtyEl);
        }
        qtyEl.textContent = `×${qty}`;
      } else if (qtyEl) {
        qtyEl.remove();
      }
    }
    const hovered = hoveredPartId ? getPartById(hoveredPartId) : null;
    renderReadout(hovered);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    rootEl.classList.toggle("is-disabled", !enabled);
    const tiles = categoriesEl.querySelectorAll(".part-tile");
    for (const tile of tiles) {
      if (tile instanceof HTMLButtonElement) {
        tile.disabled = !enabled;
        const partId = tile.dataset.partId;
        tile.setAttribute("aria-disabled", String(!enabled || !(partId && isOwned(partId))));
      }
    }
    if (!enabled) {
      clearHover();
    }
  }

  renderTabs();
  renderGrid();
  renderReadout(null);

  return { sync, setEnabled };
}
