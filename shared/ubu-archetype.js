/* Deterministic 81-adjective × 90-noun Ubu archetype naming. See docs/ububall.md. */
(function(root) {
  'use strict';
  const STATS = Object.freeze(["impulse", "traction", "spin", "curve", "size", "mass", "bounciness", "grip", "power", "reach", "strength", "stability", "efficiency", "synergy", "chemistry"]);
  const PERSONALITY_KEYS = Object.freeze(['aggression', 'creativity', 'teamwork', 'clutch']);
  const LEVELS = Object.freeze(['Low', 'Medium', 'High']);
  const SCORING = Object.freeze({ salienceBoost: 1.5, worstStatWeight: 0.45, offAxisWeight: 0.15, neutralStat: 127.5 });

  const ADJECTIVES = Object.freeze([
    "Skittish", "Mellow", "Stoic", "Wary", "Cagey", "Coolheaded", "Mercurial", "Quirky", "Wily",
    "Fretful", "Prudent", "Steadfast", "Shy", "Handy", "Poised", "Frazzled", "Curious", "Shrewd",
    "Meek", "Dutiful", "Constant", "Sensitive", "Attentive", "Devoted", "Fluttery", "Encouraging", "Visionary",
    "Petulant", "Stubborn", "Adamant", "Prickly", "Independent", "Resolute", "Erratic", "Unorthodox", "Audacious",
    "Nervy", "Crisp", "Disciplined", "Jumpy", "Balanced", "Grounded", "Haphazard", "Versatile", "Astute",
    "Overeager", "Solid", "Loyal", "Fussy", "Chummy", "Valiant", "Overzealous", "Resourceful", "Charismatic",
    "Bombastic", "Obstinate", "Ironclad", "Hotheaded", "Defiant", "Dauntless", "Chaotic", "Devious", "Brazen",
    "Blustering", "Belligerent", "Tenacious", "Volatile", "Driven", "Fearless", "Frenzied", "Dashing", "Maverick",
    "Bossy", "Fierce", "Staunch", "Agitated", "Vigorous", "Heroic", "Frantic", "Peppy", "Electrifying"
  ]);

  const RAW_PROFILES = [
    [1, 1, "Curler", [0, 1, 2, 3], [45, 210, 35, 40], -2529.761752],
    [2, 1, "Coaster", [0, 1, 2, 3], [55, 50, 125, 115], -4996.488999],
    [3, 1, "Whirler", [0, 1, 2, 3], [60, 140, 220, 215], -3794.417303],
    [4, 1, "Strider", [0, 1, 2, 3], [130, 205, 40, 35], -1074.326371],
    [5, 1, "Cruiser", [0, 1, 2, 3], [130, 125, 125, 125], -4051.143749],
    [6, 1, "Carver", [0, 1, 2, 3], [130, 170, 220, 215], -2462.145043],
    [7, 1, "Bullet", [0, 1, 2, 3], [225, 40, 35, 35], 546.473435],
    [8, 1, "Dart", [0, 1, 2, 3], [225, 210, 120, 120], -3611.139016],
    [9, 1, "Cyclone", [0, 1, 2, 3], [230, 70, 220, 220], -2279.606901],
    [10, 2, "Grasshopper", [4, 5, 6, 7], [45, 50, 230, 35], -957.824304],
    [11, 2, "Marble", [4, 5, 6, 7], [55, 55, 125, 125], -4313.575641],
    [12, 2, "Gecko", [4, 5, 6, 7], [50, 60, 35, 230], -2832.952033],
    [13, 2, "Pinball", [4, 5, 6, 7], [130, 125, 230, 45], -2806.311249],
    [14, 2, "Keystone", [4, 5, 6, 7], [127, 127, 127, 127], -4033.296781],
    [15, 2, "Grappler", [4, 5, 6, 7], [130, 135, 45, 225], -2062.023355],
    [16, 2, "Ricochet", [4, 5, 6, 7], [225, 220, 230, 45], -3188.592890],
    [17, 2, "Boulder", [4, 5, 6, 7], [225, 225, 125, 130], -2122.431860],
    [18, 2, "Anvil", [4, 5, 6, 7], [225, 230, 40, 230], -959.590528],
    [19, 3, "Scout", [8, 9, 10, 11], [55, 225, 50, 45], -3243.587904],
    [20, 3, "Decoy", [8, 9, 10, 11], [60, 125, 55, 125], -4518.362839],
    [21, 3, "Anchor", [8, 9, 10, 11], [55, 45, 55, 230], -4164.057881],
    [22, 3, "Fencer", [8, 9, 10, 11], [140, 225, 140, 45], -3823.673427],
    [23, 3, "Skirmisher", [8, 9, 10, 11], [130, 130, 130, 130], -4092.691990],
    [24, 3, "Sentinel", [8, 9, 10, 11], [140, 45, 140, 225], -3527.887978],
    [25, 3, "Lancer", [8, 9, 10, 11], [225, 230, 220, 50], -3486.943931],
    [26, 3, "Bruiser", [8, 9, 10, 11], [225, 130, 225, 130], -3888.426093],
    [27, 3, "Fortress", [8, 9, 10, 11], [225, 45, 230, 230], -2388.882695],
    [28, 4, "Mascot", [12, 13, 14], [50, 230, 45], -4892.654917],
    [29, 4, "Cinder", [12, 13, 14], [50, 45, 45], -6363.087671],
    [30, 4, "Sponge", [12, 13, 14], [50, 45, 230], -4807.863775],
    [31, 4, "Conduit", [12, 13, 14], [130, 225, 50], -4088.056434],
    [32, 4, "Circuit", [12, 13, 14], [130, 130, 130], -5742.981823],
    [33, 4, "Vessel", [12, 13, 14], [130, 50, 225], -4164.238446],
    [34, 4, "Catalyst", [12, 13, 14], [225, 230, 50], -4337.516402],
    [35, 4, "Dynamo", [12, 13, 14], [225, 230, 230], -5491.009200],
    [36, 4, "Harvester", [12, 13, 14], [225, 50, 230], -4453.123276],
    [37, 5, "Torpedo", [0, 1, 2, 3, 4, 5, 6, 7], [230, 45, 35, 40, 225, 225, 120, 110], 4623.003641],
    [38, 5, "Jackrabbit", [0, 1, 2, 3, 4, 5, 6, 7], [230, 55, 50, 45, 65, 70, 235, 45], 4777.121283],
    [39, 5, "Pouncer", [0, 1, 2, 3, 4, 5, 6, 7], [230, 70, 55, 45, 85, 90, 40, 230], 3774.068603],
    [40, 5, "Bulldozer", [0, 1, 2, 3, 4, 5, 6, 7], [145, 230, 45, 40, 225, 225, 110, 135], 3510.088960],
    [41, 5, "Skipper", [0, 1, 2, 3, 4, 5, 6, 7], [135, 230, 60, 70, 85, 80, 225, 50], 2714.604799],
    [42, 5, "Grinder", [0, 1, 2, 3, 4, 5, 6, 7], [140, 230, 55, 40, 110, 125, 35, 230], 3249.926054],
    [43, 5, "Flywheel", [0, 1, 2, 3, 4, 5, 6, 7], [170, 115, 225, 225, 220, 225, 95, 135], 2603.767668],
    [44, 5, "Acrobat", [0, 1, 2, 3, 4, 5, 6, 7], [155, 120, 230, 225, 70, 85, 230, 55], 2714.563852],
    [45, 5, "Corkscrew", [0, 1, 2, 3, 4, 5, 6, 7], [165, 165, 230, 230, 105, 120, 45, 235], 2595.263633],
    [46, 6, "Striker", [0, 1, 2, 3, 8, 9, 10, 11], [230, 55, 45, 40, 230, 80, 80, 105], 3725.930158],
    [47, 6, "Hawk", [0, 1, 2, 3, 8, 9, 10, 11], [225, 70, 65, 50, 90, 235, 75, 80], 2924.424266],
    [48, 6, "Rammer", [0, 1, 2, 3, 8, 9, 10, 11], [235, 95, 40, 40, 95, 65, 235, 215], 4731.858530],
    [49, 6, "Deadeye", [0, 1, 2, 3, 8, 9, 10, 11], [145, 235, 55, 45, 230, 95, 90, 145], 2517.057176],
    [50, 6, "Pickpocket", [0, 1, 2, 3, 8, 9, 10, 11], [145, 230, 65, 60, 90, 235, 85, 135], 2097.145265],
    [51, 6, "Warden", [0, 1, 2, 3, 8, 9, 10, 11], [150, 230, 45, 40, 100, 80, 235, 230], 4166.252241],
    [52, 6, "Slinger", [0, 1, 2, 3, 8, 9, 10, 11], [170, 110, 235, 230, 230, 75, 90, 115], 1926.279209],
    [53, 6, "Swooper", [0, 1, 2, 3, 8, 9, 10, 11], [175, 140, 225, 230, 85, 235, 85, 110], 1966.994942],
    [54, 6, "Marauder", [0, 1, 2, 3, 8, 9, 10, 11], [185, 155, 230, 225, 105, 80, 230, 225], 2918.271682],
    [55, 7, "Sparkplug", [0, 1, 2, 3, 12, 13, 14], [230, 50, 45, 40, 235, 60, 55], 3799.731508],
    [56, 7, "Courier", [0, 1, 2, 3, 12, 13, 14], [225, 70, 45, 50, 145, 235, 45], 2983.236181],
    [57, 7, "Vacuum", [0, 1, 2, 3, 12, 13, 14], [230, 65, 55, 40, 140, 45, 235], 3190.697761],
    [58, 7, "Piston", [0, 1, 2, 3, 12, 13, 14], [145, 230, 45, 40, 230, 65, 65], 2494.316372],
    [59, 7, "Relay", [0, 1, 2, 3, 12, 13, 14], [140, 235, 50, 45, 145, 230, 45], 2438.959927],
    [60, 7, "Lodestone", [0, 1, 2, 3, 12, 13, 14], [150, 230, 40, 55, 135, 45, 235], 2406.930180],
    [61, 7, "Turbine", [0, 1, 2, 3, 12, 13, 14], [175, 130, 235, 225, 235, 60, 65], 1735.615302],
    [62, 7, "Beacon", [0, 1, 2, 3, 12, 13, 14], [180, 145, 230, 220, 145, 235, 45], 1678.284928],
    [63, 7, "Satellite", [0, 1, 2, 3, 12, 13, 14], [170, 135, 235, 230, 140, 45, 235], 1916.482941],
    [64, 8, "Howitzer", [4, 5, 6, 7, 8, 9, 10, 11], [230, 235, 80, 125, 235, 85, 100, 155], 2291.191197],
    [65, 8, "Roadblock", [4, 5, 6, 7, 8, 9, 10, 11], [235, 225, 90, 140, 80, 235, 90, 170], 2170.132294],
    [66, 8, "Juggernaut", [4, 5, 6, 7, 8, 9, 10, 11], [230, 240, 60, 160, 95, 75, 235, 230], 4455.651885],
    [67, 8, "Catapult", [4, 5, 6, 7, 8, 9, 10, 11], [80, 75, 235, 55, 230, 85, 85, 85], 1917.079229],
    [68, 8, "Flycatcher", [4, 5, 6, 7, 8, 9, 10, 11], [75, 70, 235, 60, 80, 235, 80, 60], 2619.496008],
    [69, 8, "Boxer", [4, 5, 6, 7, 8, 9, 10, 11], [90, 85, 230, 55, 95, 90, 230, 110], 1344.833102],
    [70, 8, "Hammer", [4, 5, 6, 7, 8, 9, 10, 11], [130, 145, 45, 235, 235, 80, 95, 160], 1647.011137],
    [71, 8, "Lasso", [4, 5, 6, 7, 8, 9, 10, 11], [115, 130, 45, 235, 80, 235, 95, 155], 1579.402540],
    [72, 8, "Lockjaw", [4, 5, 6, 7, 8, 9, 10, 11], [140, 150, 40, 240, 95, 85, 235, 225], 3116.541919],
    [73, 9, "Furnace", [4, 5, 6, 7, 12, 13, 14], [230, 235, 65, 135, 235, 55, 65], 2478.265141],
    [74, 9, "Reactor", [4, 5, 6, 7, 12, 13, 14], [235, 225, 75, 135, 145, 235, 45], 2217.522121],
    [75, 9, "Monolith", [4, 5, 6, 7, 12, 13, 14], [230, 230, 70, 120, 135, 45, 235], 2074.645797],
    [76, 9, "Pogo", [4, 5, 6, 7, 12, 13, 14], [70, 75, 230, 45, 235, 65, 55], 2062.093177],
    [77, 9, "Booster", [4, 5, 6, 7, 12, 13, 14], [80, 80, 230, 55, 140, 235, 50], 1673.834615],
    [78, 9, "Bouncer", [4, 5, 6, 7, 12, 13, 14], [75, 70, 235, 50, 140, 45, 235], 2109.046828],
    [79, 9, "Firestarter", [4, 5, 6, 7, 12, 13, 14], [115, 130, 40, 235, 235, 55, 60], 1502.779513],
    [80, 9, "Conductor", [4, 5, 6, 7, 12, 13, 14], [135, 140, 45, 230, 145, 235, 50], 1371.233729],
    [81, 9, "Barnacle", [4, 5, 6, 7, 12, 13, 14], [120, 135, 40, 240, 140, 45, 235], 1681.666701],
    [82, 10, "Blaster", [8, 9, 10, 11, 12, 13, 14], [235, 70, 95, 120, 235, 55, 60], 261.744379],
    [83, 10, "Arsenal", [8, 9, 10, 11, 12, 13, 14], [225, 90, 90, 135, 140, 235, 50], 114.367725],
    [84, 10, "Finisher", [8, 9, 10, 11, 12, 13, 14], [235, 80, 100, 135, 140, 50, 235], 342.151031],
    [85, 10, "Prospector", [8, 9, 10, 11, 12, 13, 14], [85, 235, 85, 100, 235, 60, 60], 522.955574],
    [86, 10, "Playmaker", [8, 9, 10, 11, 12, 13, 14], [90, 235, 90, 145, 140, 235, 45], 498.621511],
    [87, 10, "Trapper", [8, 9, 10, 11, 12, 13, 14], [90, 230, 85, 125, 135, 45, 235], 461.316669],
    [88, 10, "Berserker", [8, 9, 10, 11, 12, 13, 14], [90, 85, 235, 210, 235, 60, 55], 1326.585513],
    [89, 10, "Vanguard", [8, 9, 10, 11, 12, 13, 14], [95, 90, 230, 230, 140, 235, 50], 1397.008666],
    [90, 10, "Gladiator", [8, 9, 10, 11, 12, 13, 14], [95, 80, 235, 225, 135, 45, 235], 1586.145960]
  ];

  const NOUN_PROFILES = Object.freeze(RAW_PROFILES.map(([slot, family, noun, statIndices, values, bias]) => {
    const weights = values.map(v => 1 + SCORING.salienceBoost * (Math.abs(v - SCORING.neutralStat) / SCORING.neutralStat));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const normWeights = Object.freeze(weights.map(w => w / weightSum));
    const inSubset = new Set(statIndices);
    const offIndices = [];
    for (let j = 0; j < 15; j++) if (!inSubset.has(j)) offIndices.push(j);
    return Object.freeze({
      slot,
      family,
      noun,
      stats: Object.freeze(statIndices.map(i => STATS[i])),
      statIndices: Object.freeze(statIndices),
      offIndices: Object.freeze(offIndices),
      values: Object.freeze(values),
      weights: normWeights,
      bias
    });
  }));

  const rawVec = new Int32Array(15);
  const offSqVec = new Float64Array(15);

  function personalityTier(value) {
    if (!Number.isInteger(value) || value < 0 || value > 63) {
      throw new RangeError(`Personality trait must be an integer from 0 to 63: ${value}`);
    }
    return value <= 20 ? 0 : value <= 42 ? 1 : 2;
  }

  function chooseAdjective(personality) {
    if (!personality || typeof personality !== 'object') {
      throw new TypeError('Expected decoded personality object.');
    }
    const agg = personalityTier(personality.aggression);
    const cre = personalityTier(personality.creativity);
    const tmw = personalityTier(personality.teamwork);
    const clu = personalityTier(personality.clutch);
    const family = agg * 3 + tmw + 1;
    const slot = (family - 1) * 9 + cre * 3 + clu + 1;
    return {
      slot,
      family,
      adjective: ADJECTIVES[slot - 1],
      tiers: {
        aggression: LEVELS[agg],
        creativity: LEVELS[cre],
        teamwork: LEVELS[tmw],
        clutch: LEVELS[clu]
      }
    };
  }

  function chooseNoun(stats, useBias = true) {
    if (!stats || typeof stats !== 'object') {
      throw new TypeError('Expected decoded gameplay stats object.');
    }
    for (let j = 0; j < 15; j++) {
      const key = STATS[j];
      const v = stats[key];
      if (!Number.isInteger(v) || v < 0 || v > 255) {
        throw new RangeError(`Gameplay stat ${key} must be an integer from 0 to 255: ${v}`);
      }
      rawVec[j] = v;
      const d = v - SCORING.neutralStat;
      offSqVec[j] = d * d;
    }
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < 90; i++) {
      const p = NOUN_PROFILES[i];
      const idx = p.statIndices, vals = p.values, wts = p.weights, off = p.offIndices;
      let weightedMse = 0;
      let maxSq = 0;
      for (let k = 0; k < idx.length; k++) {
        const diff = rawVec[idx[k]] - vals[k];
        const sq = diff * diff;
        weightedMse += wts[k] * sq;
        if (sq > maxSq) maxSq = sq;
      }
      let offSum = 0;
      for (let k = 0; k < off.length; k++) offSum += offSqVec[off[k]];
      const rawCost = weightedMse + SCORING.worstStatWeight * maxSq + SCORING.offAxisWeight * (offSum / off.length);
      const score = useBias ? rawCost - p.bias : rawCost;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const rawCost = useBias ? bestScore + best.bias : bestScore;
    return { slot: best.slot, family: best.family, noun: best.noun, rawCost, score: bestScore };
  }

  function describe(source) {
    if (!source || typeof source !== 'object') {
      throw new TypeError('Expected decoded ubu object with stats and personality.');
    }
    const adj = chooseAdjective(source.personality);
    const noun = chooseNoun(source.stats, true);
    return {
      fullName: `${adj.adjective} ${noun.noun}`,
      adjective: adj.adjective,
      noun: noun.noun,
      adjectiveSlot: adj.slot,
      adjectiveFamily: adj.family,
      tiers: adj.tiers,
      nounSlot: noun.slot,
      nounFamily: noun.family,
      rawCost: noun.rawCost,
      score: noun.score
    };
  }

  function format(source) {
    if (!source || typeof source !== 'object' || !source.stats || !source.personality) return '';
    try {
      return describe(source).fullName;
    } catch {
      return '';
    }
  }

  const api = Object.freeze({
    STATS,
    PERSONALITY_KEYS,
    LEVELS,
    SCORING,
    ADJECTIVES,
    NOUN_PROFILES,
    personalityTier,
    chooseAdjective,
    chooseNoun,
    describe,
    format
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubuArchetype = api;
})(globalThis);
