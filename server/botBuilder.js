const VALID_ARCHETYPES = ['random', 'attack', 'defense', 'mobility', 'balanced'];
const VALID_GRADES = ['low', 'medium', 'high', 'mixed'];

const ARCHETYPE_LABELS = {
  random: 'Random',
  attack: 'Attack',
  defense: 'Defense',
  mobility: 'Mobility',
  balanced: 'Balanced',
};

const GRADE_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  mixed: 'Mixed',
};

function normalizeBotConfig({ archetype = 'random', grade = 'medium' } = {}) {
  const safeArchetype = VALID_ARCHETYPES.includes(archetype) ? archetype : 'random';
  const safeGrade = VALID_GRADES.includes(grade) ? grade : 'medium';
  return { archetype: safeArchetype, grade: safeGrade };
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildBotLoadout(partsMod, rawConfig = {}) {
  const config = normalizeBotConfig(rawConfig);
  const { CATALOG, SLOT_KEYS } = partsMod;
  const loadout = {};

  for (const slot of SLOT_KEYS) {
    let candidates = CATALOG[slot];
    if (config.archetype !== 'random') {
      candidates = candidates.filter((p) => p.category === config.archetype);
    }
    if (config.grade !== 'mixed') {
      candidates = candidates.filter((p) => p.grade === config.grade);
    }
    if (!candidates.length) {
      candidates = CATALOG[slot];
    }
    loadout[slot] = pickRandom(candidates).id;
  }

  const botName = `${ARCHETYPE_LABELS[config.archetype]} Bot (${GRADE_LABELS[config.grade]})`;
  return { loadout, config, botName };
}

module.exports = {
  VALID_ARCHETYPES,
  VALID_GRADES,
  normalizeBotConfig,
  buildBotLoadout,
};
