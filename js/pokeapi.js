// Metadatos de texto (nombre, tipos, evolución) desde PokeAPI, cacheados en localStorage.
// Los sprites NUNCA vienen de aquí: siempre se usan los locales de sprites/.
const CACHE_KEY = 'pokegotchi-pokeapi-cache-v1';
const BASESTAGE_CACHE_KEY = 'pokegotchi-basestage-cache-v1';

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignorar si no hay almacenamiento disponible */
  }
}

function loadBaseStageCache() {
  try {
    return JSON.parse(localStorage.getItem(BASESTAGE_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveBaseStageCache(cache) {
  try {
    localStorage.setItem(BASESTAGE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignorar si no hay almacenamiento disponible */
  }
}

// true/false si se sabe, null si no hay conexión para averiguarlo.
export async function isBaseStage(id) {
  const cache = loadBaseStageCache();
  if (typeof cache[id] === 'boolean') return cache[id];
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
    if (!res.ok) throw new Error('pokeapi fetch failed');
    const data = await res.json();
    const result = data.evolves_from_species === null;
    cache[id] = result;
    saveBaseStageCache(cache);
    return result;
  } catch {
    return null;
  }
}

function idFromUrl(url) {
  const m = url.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : null;
}

function findInChain(node, id) {
  if (idFromUrl(node.species.url) === id) return node;
  for (const child of node.evolves_to || []) {
    const found = findInChain(child, id);
    if (found) return found;
  }
  return null;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Devuelve { id, name, types, evolvesTo, evoMinLevel, offline }
export async function getSpeciesInfo(id) {
  const cache = loadCache();
  if (cache[id]) return cache[id];

  try {
    const [pokeRes, speciesRes] = await Promise.all([
      fetch(`https://pokeapi.co/api/v2/pokemon/${id}`),
      fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`),
    ]);
    if (!pokeRes.ok || !speciesRes.ok) throw new Error('pokeapi fetch failed');
    const poke = await pokeRes.json();
    const species = await speciesRes.json();

    let evolvesTo = null;
    let evoMinLevel = null;
    try {
      const chainRes = await fetch(species.evolution_chain.url);
      if (chainRes.ok) {
        const chainData = await chainRes.json();
        const node = findInChain(chainData.chain, id);
        const next = node && node.evolves_to && node.evolves_to[0];
        if (next) {
          evolvesTo = idFromUrl(next.species.url);
          const detail = next.evolution_details && next.evolution_details[0];
          evoMinLevel = (detail && detail.min_level) || null;
        }
      }
    } catch {
      /* sin cadena de evolución disponible; se reintentará más tarde */
    }

    const nameEntry =
      species.names.find((n) => n.language.name === 'es') ||
      species.names.find((n) => n.language.name === 'en');

    const info = {
      id,
      name: nameEntry ? nameEntry.name : capitalize(poke.name),
      types: poke.types.map((t) => t.type.name),
      evolvesTo,
      evoMinLevel,
    };

    cache[id] = info;
    saveCache(cache);
    return info;
  } catch {
    return { id, name: '???', types: [], evolvesTo: null, evoMinLevel: null, offline: true };
  }
}
