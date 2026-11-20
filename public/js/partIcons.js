/** Inline SVG icon generator for parts, color-coded by stat category and grade. */

export const CATEGORY_COLORS = {
  attack: { primary: "#ff8c42", soft: "rgba(255, 140, 66, 0.22)", bg: "#2b170d" },
  defense: { primary: "#7ec8e3", soft: "rgba(126, 200, 227, 0.22)", bg: "#0e2430" },
  mobility: { primary: "#f0d878", soft: "rgba(240, 216, 120, 0.22)", bg: "#2b240e" },
  balanced: { primary: "#7be0a8", soft: "rgba(123, 224, 168, 0.22)", bg: "#0f281c" },
};

export const GRADE_COLORS = {
  low: { ring: "#7d90a3", pip: "#8fa3b5", pips: 1 },
  medium: { ring: "#89d4f5", pip: "#9be2ff", pips: 2 },
  high: { ring: "#f4d35e", pip: "#ffe082", pips: 3 },
};

function slotSilhouette(slot, stroke, fill, gradeRing) {
  if (slot === "layer") {
    // Bladed outer crown ring
    return `
      <path d="M18 3 L22 7 L29 6 L28 13 L33 18 L28 23 L29 30 L22 29 L18 33 L14 29 L7 30 L8 23 L3 18 L8 13 L7 6 L14 7 Z"
            fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="18" cy="18" r="9.5" fill="none" stroke="${gradeRing}" stroke-width="1.1" stroke-opacity="0.75"/>
    `;
  }
  if (slot === "disk") {
    // Weighted flywheel ring with radial cutouts
    return `
      <circle cx="18" cy="18" r="13.5" fill="${fill}" stroke="${stroke}" stroke-width="2.1"/>
      <circle cx="18" cy="18" r="8.8" fill="none" stroke="${gradeRing}" stroke-width="1.2" stroke-dasharray="6 3.2" stroke-opacity="0.85"/>
      <line x1="18" y1="5" x2="18" y2="9.2" stroke="${stroke}" stroke-width="1.5"/>
      <line x1="29.3" y1="24.5" x2="25.6" y2="22.4" stroke="${stroke}" stroke-width="1.5"/>
      <line x1="6.7" y1="24.5" x2="10.4" y2="22.4" stroke="${stroke}" stroke-width="1.5"/>
    `;
  }
  // driver: stabilizer cone / precision tip
  return `
    <polygon points="18,4 31,13 26,29 18,33 10,29 5,13"
             fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>
    <polygon points="18,8.5 26.5,14.5 23,25.5 18,28.5 13,25.5 9.5,14.5"
             fill="none" stroke="${gradeRing}" stroke-width="1.1" stroke-opacity="0.75"/>
  `;
}

function focusEmblem(focus, color) {
  if (focus === "col0") {
    // Sharp impact chevron (Burst / Armor / Launch / Vanguard)
    return `
      <polygon points="18,11.5 23.5,22 18,19.2 12.5,22" fill="${color}"/>
    `;
  }
  if (focus === "col1") {
    // Precision cross / twin-edge (Edge / Stability / Grip / Pulse)
    return `
      <path d="M13 13 L23 23 M23 13 L13 23" stroke="${color}" stroke-width="2.1" stroke-linecap="round"/>
      <circle cx="18" cy="18" r="2.2" fill="${color}"/>
    `;
  }
  if (focus === "col2") {
    // Core / orbit ring (Max Spin / Mass / Bank / Apex)
    return `
      <circle cx="18" cy="18" r="5" fill="none" stroke="${color}" stroke-width="1.9"/>
      <circle cx="18" cy="18" r="2" fill="${color}"/>
    `;
  }
  // balanced: 4-point star
  return `
    <polygon points="18,11 20.2,15.8 25,18 20.2,20.2 18,25 15.8,20.2 11,18 15.8,15.8" fill="${color}"/>
  `;
}

function gradePipsSvg(grade) {
  const g = GRADE_COLORS[grade] ?? GRADE_COLORS.low;
  const count = g.pips;
  const spacing = 4.6;
  const startX = 18 - ((count - 1) * spacing) / 2;
  let circles = "";
  for (let i = 0; i < count; i++) {
    const cx = (startX + i * spacing).toFixed(1);
    circles += `<circle cx="${cx}" cy="33.2" r="1.5" fill="${g.pip}"/>`;
  }
  return circles;
}

/**
 * Returns an inline SVG markup string for the given part.
 * @param {{ slot: string, category: string, focus: string, grade: string }} part
 * @param {{ showPips?: boolean }} [opts]
 */
export function renderPartIconSvg(part, opts = {}) {
  const cat = CATEGORY_COLORS[part.category] ?? CATEGORY_COLORS.balanced;
  const grade = GRADE_COLORS[part.grade] ?? GRADE_COLORS.low;
  const showPips = opts.showPips ?? true;

  return `<svg class="part-svg" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    ${slotSilhouette(part.slot, cat.primary, cat.bg, grade.ring)}
    ${focusEmblem(part.focus, cat.primary)}
    ${showPips ? gradePipsSvg(part.grade) : ""}
  </svg>`;
}
