/* ════════════════════════════════════════════════════════════════
   MAPA — Casas de apuestas en España
   Dos modos: Scroll (historia guiada) y Mapa Libre (interactivo)
   ════════════════════════════════════════════════════════════════ */

/* ── Archivos de datos (todos en la misma carpeta) ── */
const APUESTAS_FILE   = 'GOOGLEMAPS_ES.pmtiles';   // source-layer: apuestas
const RENTA_FILE      = 'RENTA_CASAS.pmtiles';     // source-layer: renta_casas
const COLEGIOS_FILE   = 'colegios.geojson';        // GeoJSON directo (props: n, t, nat, loc, prov)
const ESPANA_FILE     = 'espana.geojson';
const DISTANCIAS_FILE = 'distancias.json';         // place_id → {d, n, t}

/* ── Escenas del scroll ── */
const SCENES = [
  {
    // 0 — España completa
    center: [-5.7, 36.2], zoom: 4, duration: 0,
    renta: false,
  },
  {
    // 1 — El problema de la proximidad (misma vista, se nombran los colegios)
    center: [-3.7, 40.2], zoom: 5.5, duration: 1200,
    renta: false,
  },
  {
    // 2 — Comunitat Valenciana
    center: [-0.37, 39.47], zoom: 9.5, duration: 2200,
    renta: false,
  },
  {
    // 3 — Madrid + Asturias + Cataluña (vista conjunta)
    center: [-2.0, 41.5], zoom: 6.0, duration: 2000,
    renta: false,
  },
  {
    // 4 — Madrid general
    center: [-3.70, 40.42], zoom: 10.5, duration: 2000,
    renta: false,
  },
  {
    // 5 — Asturias
    center: [-5.85, 43.35], zoom: 9.0, duration: 2000,
    renta: false,
  },
  {
    // 6 — Cataluña
    center: [1.5, 41.8], zoom: 8.5, duration: 2000,
    renta: false,
  },
  {
    // 7 — Costa Adeje / Playa de las Américas (sección más densa)
    center: [-16.732, 28.079], zoom: 14, duration: 2200,
    renta: false, seccion: true,
  },
  {
    // 8 — Puente de Vallecas (mayor aglomeración del país)
    center: [-3.6679, 40.3972], zoom: 16, duration: 2200,
    renta: false, clusterVallecas: true,
  },
];

/* ── Cadenas para el filtro en modo libre ── */
const CADENAS = [
  'Sportium','Codere','Versus','Retabet','Luckia',
  'Cirsa / Toka','William Hill','Bwin','Betsson',
  'bet365','888sport','Kirolbet','ZEbet','PAF',
  'Casino','Salón de juego','Otros',
];

/* ══════════════════════════════════════════
   MAPA
   ══════════════════════════════════════════ */

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: [-3.7, 40.2],
  zoom: 5.5,
  minZoom: 3,
  maxBounds: [[-35, 20], [20, 56]],
  antialias: true,
});

/* En modo historia: rueda hace scroll en la página, no zoom ni arrastre */
map.scrollZoom.disable();
map.dragPan.disable();
map.dragRotate.disable();

/* ── Tooltip hover ── */
const tooltip = document.createElement('div');
tooltip.className = 'map-tooltip';
document.body.appendChild(tooltip);

/* ── Estado global ── */
let modoLibre      = false;
let escenaActual   = -1;
let cadenasActivas = new Set(CADENAS);
let distancias     = {};   // place_id → {d, n, t}

/* ══════════════════════════════════════════
   CARGA
   ══════════════════════════════════════════ */

map.on('load', async () => { try {

  /* ── Carga en paralelo: distancias + colegios + espana ── */
  const [espana, colegiosData] = await Promise.all([
    fetch(ESPANA_FILE).then(r => r.json()),
    fetch(COLEGIOS_FILE).then(r => r.json()).catch(e => {
      console.error('Error cargando colegios.geojson:', e);
      return { type: 'FeatureCollection', features: [] };
    }),
  ]);

  fetch(DISTANCIAS_FILE)
    .then(r => r.json())
    .then(data => { distancias = data; })
    .catch(() => console.warn('distancias.json no disponible'));

  /* ── Mapa base (CartoDB Positron) ── */
  map.addSource('basemap', {
    type: 'raster',
    tiles: ['https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}{r}.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  });
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap',
    paint: { 'raster-opacity': 1 } });

  /* ── Frontera de España ── */
  map.addSource('espana', { type: 'geojson', data: espana });
  map.addLayer({ id: 'espana-border', type: 'line', source: 'espana',
    paint: { 'line-color': '#374151', 'line-width': 1.5, 'line-opacity': 0.6 } });
  map.addLayer({ id: 'espana-glow', type: 'line', source: 'espana',
    paint: { 'line-color': '#374151', 'line-width': 6, 'line-opacity': 0.08, 'line-blur': 5 } });

  /* ── Protocolo PMTiles ── */
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

  /* ── Fuentes ── */
  map.addSource('apuestas', { type: 'vector', url: `pmtiles://${APUESTAS_FILE}` });
  map.addSource('renta',    { type: 'vector', url: `pmtiles://${RENTA_FILE}` });
  map.addSource('colegios', { type: 'geojson', data: colegiosData });

  /* ════════════ CAPAS ════════════ */

  /* Secciones censales — coloreadas por renta (escena 5) */
  map.addLayer({
    id: 'renta-colored',
    type: 'fill',
    source: 'renta',
    'source-layer': 'renta_casas',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': [
        'interpolate', ['linear'],
        ['to-number', ['get', 'TOTAL'], 0],
        0,     '#1e0a3c',
        12000, '#4c1d95',
        20000, '#b45309',
        30000, '#065f46',
        50000, '#0284c7',
      ],
      'fill-opacity': 0.65,
    },
  }, 'espana-border');

  /* Secciones censales — fill invisible para leer renta en el popup */
  map.addLayer({
    id: 'renta-hit',
    type: 'fill',
    source: 'renta',
    'source-layer': 'renta_casas',
    paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.01 },
  }, 'espana-border');

  /* Colegios — siempre visibles en todos los chapters */
  map.addLayer({
    id: 'colegios-circle',
    type: 'circle',
    source: 'colegios',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 2.5, 14, 5],
      'circle-color': '#494949',
      'circle-opacity': 0.8,
      'circle-stroke-width': 0,
    },
  });

  /* Apuestas — heatmap (solo modo libre) */
  map.addLayer({
    id: 'apuestas-heat',
    type: 'heatmap',
    source: 'apuestas',
    'source-layer': 'apuestas',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 10, 1.5],
      'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 4, 8,  10, 20],
      'heatmap-opacity': 0.85,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.2, 'rgba(253,186,116,0.5)',
        0.5, '#f97316',
        0.8, '#dc2626',
        1,   '#7f1d1d',
      ],
    },
  });

  /* Apuestas — puntos (encima de los colegios) */
  map.addLayer({
    id: 'apuestas-circle',
    type: 'circle',
    source: 'apuestas',
    'source-layer': 'apuestas',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 3, 14, 6],
      'circle-color': '#01f3b3',
      'circle-opacity': 0.9,
      'circle-stroke-width': 0,
    },
  });

  /* Sección censal de Adeje — borde destacado (escena 11) */
  const seccionAdeje = await fetch('seccion_adeje.geojson').then(r => r.json());
  map.addSource('seccion-adeje', { type: 'geojson', data: seccionAdeje });
  /* Fill oscuro interior — simula sombra dentro */
  map.addLayer({
    id: 'seccion-adeje-fill',
    type: 'fill',
    source: 'seccion-adeje',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': '#000000',
      'fill-opacity': 0.18,
    },
  });
  /* Borde negro sólido */
  map.addLayer({
    id: 'seccion-adeje-line',
    type: 'line',
    source: 'seccion-adeje',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#000000',
      'line-width': 2,
      'line-opacity': 1,
    },
  });

  /* ── Clúster Vallecas — círculo de 100 m ── */
  const circleVallecas = turf.circle([-3.6679, 40.3972], 0.1, { steps: 64, units: 'kilometers' });
  map.addSource('cluster-vallecas', { type: 'geojson', data: circleVallecas });
  map.addLayer({
    id: 'cluster-vallecas-fill',
    type: 'fill',
    source: 'cluster-vallecas',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#01f3b3', 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: 'cluster-vallecas-line',
    type: 'line',
    source: 'cluster-vallecas',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#01f3b3', 'line-width': 2, 'line-opacity': 0.9 },
  });

  /* ════════════ SCROLL STORY ════════════ */

  const steps = document.querySelectorAll('.step');

  /* Dispara la transición de escena cuando el 55% del step es visible */
  const observer = new IntersectionObserver((entries) => {
    if (modoLibre) return;
    entries.forEach(entry => {
      const card = entry.target.querySelector('.card');
      if (entry.isIntersecting) {
        card.classList.add('visible', 'active');
        const idx = parseInt(entry.target.dataset.scene, 10);
        if (idx !== escenaActual) irAEscena(idx);
        const umbral = entry.target.dataset.umbral;
        if (umbral) aplicarUmbral(parseInt(umbral, 10));
        else resetearColor();
      } else {
        card.classList.remove('active');
      }
    });
  }, { threshold: 0.55 });

  /* Animación de entrada cuando el 15% es visible */
  const observerVisible = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.querySelector('.card').classList.add('visible');
    });
  }, { threshold: 0.15 });

  steps.forEach(step => { observer.observe(step); observerVisible.observe(step); });

  irAEscena(0);

  /* ════════════ TRANSICIÓN DE ESCENA ════════════ */

  function irAEscena(idx) {
    if (idx === escenaActual) return;
    escenaActual = idx;
    const scene = SCENES[idx];
    if (!scene) return;

    map.flyTo({ center: scene.center, zoom: scene.zoom, duration: scene.duration, essential: true });

    map.setLayoutProperty('renta-colored', 'visibility', scene.renta ? 'visible' : 'none');
    map.setLayoutProperty('seccion-adeje-fill', 'visibility', scene.seccion ? 'visible' : 'none');
    map.setLayoutProperty('seccion-adeje-line', 'visibility', scene.seccion ? 'visible' : 'none');
    map.setLayoutProperty('cluster-vallecas-fill', 'visibility', scene.clusterVallecas ? 'visible' : 'none');
    map.setLayoutProperty('cluster-vallecas-line', 'visibility', scene.clusterVallecas ? 'visible' : 'none');
  }

  /* ════════════ COLOR POR UMBRAL ════════════ */

  function aplicarUmbral(metros) {
    const ids = Object.entries(distancias)
      .filter(([, v]) => v.d <= metros)
      .map(([id]) => id);
    if (!ids.length) return;
    map.setPaintProperty('apuestas-circle', 'circle-color',
      ['match', ['get', 'place_id'], ids, '#ff4444', '#01f3b3']
    );
  }

  function resetearColor() {
    map.setPaintProperty('apuestas-circle', 'circle-color', '#01f3b3');
  }

  /* ════════════ POPUP (ambos modos) ════════════ */

  let popup = null;

  map.on('mousemove', 'apuestas-circle', e => {
    map.getCanvas().style.cursor = 'pointer';
    const nombre = e.features?.[0]?.properties?.nombre;
    if (nombre) {
      tooltip.textContent = nombre;
      tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
      tooltip.style.top  = (e.originalEvent.clientY - 40) + 'px';
      tooltip.classList.add('visible');
    }
  });
  map.on('mouseleave', 'apuestas-circle', () => {
    map.getCanvas().style.cursor = '';
    tooltip.classList.remove('visible');
  });

  map.on('click', 'apuestas-circle', e => {
    const p = e.features?.[0]?.properties;
    if (!p) return;

    /* Distancia al colegio más cercano desde distancias.json */
    const info = distancias[p.place_id];
    let distHtml = '';
    if (info?.d != null) {
      const dist   = info.d;
      const nombre = info.n || '—';
      const tipo   = info.t || '';
      const color  = dist < 100 ? '#f87171' : dist < 300 ? '#fbbf24' : '#01f3b3';
      distHtml = `
        <div class="pp-dist-row">
          <div class="pp-dist-header">
            <span class="pp-dist-label">Colegio más cercano</span>
            <span class="pp-dist-val" style="color:${color}">${dist.toLocaleString('es')} m</span>
          </div>
          <span class="pp-dist-nombre">${nombre}</span>
          ${tipo ? `<span class="pp-dist-tipo">${tipo}</span>` : ''}
        </div>`;
    }

    /* Renta desde la capa de secciones censales */
    const rentaFeats = map.queryRenderedFeatures(e.point, { layers: ['renta-hit'] });
    const renta = rentaFeats[0]?.properties;
    const rentaHtml = renta?.TOTAL != null ? `
      <div class="pp-renta-row">
        <span class="pp-renta-label">Renta media del barrio</span>
        <span class="pp-renta-val">${Number(renta.TOTAL).toLocaleString('es')} €</span>
        ${renta.N_CASAS != null ? `<span class="pp-renta-casas">${renta.N_CASAS} locales en esta sección</span>` : ''}
      </div>` : '';


    const html = `
      <div>
        <div class="pp-top-bar"></div>
        <div class="pp-inner">
          <p class="pp-nombre">${p.nombre || '—'}</p>
          <div class="pp-meta">
            ${p.cadena ? `<span class="pp-cadena">${p.cadena}</span>` : ''}
          </div>
          ${p.direccion ? `<p class="pp-dir">${p.direccion}</p>` : ''}
          ${distHtml}
          ${rentaHtml}
        </div>
      </div>`;

    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '300px' });
    }
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.on('click', e => {
    const feats = map.queryRenderedFeatures(e.point, { layers: ['apuestas-circle', 'colegios-circle'] });
    if (!feats.length && popup?.isOpen()) popup.remove();
  });

  /* Tooltip + popup de colegios */
  map.on('mousemove', 'colegios-circle', e => {
    map.getCanvas().style.cursor = 'pointer';
    const nombre = e.features?.[0]?.properties?.n || 'Colegio';
    tooltip.textContent = nombre;
    tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
    tooltip.style.top  = (e.originalEvent.clientY - 40) + 'px';
    tooltip.classList.add('visible');
  });
  map.on('mouseleave', 'colegios-circle', () => {
    map.getCanvas().style.cursor = '';
    tooltip.classList.remove('visible');
  });

  map.on('click', 'colegios-circle', e => {
    const p = e.features?.[0]?.properties;
    if (!p) return;

    const nombre    = p.n    || '—';
    const tipo      = p.t    || '';
    const localidad = p.loc  || '';
    const provincia = p.prov || '';
    const natural   = p.nat  || '';

    const badgeColor = natural.toLowerCase().includes('público') ? '#01f3b3'
                     : natural.toLowerCase().includes('privado') ? '#f97316'
                     : '#d8d8d8';

    const html = `
      <div>
        <div class="pp-top-bar" style="background:${badgeColor}"></div>
        <div class="pp-inner">
          <p class="pp-nombre">${nombre}</p>
          <div class="pp-meta">
            ${natural ? `<span class="pp-cadena" style="background:${badgeColor};color:#000">${natural}</span>` : ''}
          </div>
          ${tipo      ? `<p class="pp-dir">${tipo}</p>` : ''}
          ${localidad ? `<p style="font-size:12px;color:rgba(255,255,255,0.5);margin:0">${localidad}${provincia ? ', ' + provincia : ''}</p>` : ''}
        </div>
      </div>`;

    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '280px' });
    }
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  /* ════════════ MODO LIBRE ════════════ */

  document.getElementById('entrar-ml-btn').addEventListener('click', activarModoLibre);
  document.getElementById('entrar-ml-btn-header').addEventListener('click', activarModoLibre);
  document.getElementById('volver-btn').addEventListener('click', volverAlArticulo);

  function activarModoLibre() {
    modoLibre = true;
    document.getElementById('story').classList.add('hidden');
    document.getElementById('ml-ui').classList.remove('hidden');
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.dragRotate.enable();
    map.setLayoutProperty('renta-colored', 'visibility', 'none');
    map.jumpTo({ center: [-5.7, 36.2], zoom: 4 });

    if (!map._geocoderAdded) {
      map.addControl(new GeocoderControl(), 'top-right');
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map._geocoderAdded = true;
    }

  }

  function volverAlArticulo() {
    modoLibre = false;
    document.getElementById('ml-ui').classList.add('hidden');
    document.getElementById('story').classList.remove('hidden');
    document.getElementById('filtro-panel').classList.add('hidden');
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.dragRotate.disable();
    map.setLayoutProperty('apuestas-heat', 'visibility', 'none');
    map.setLayoutProperty('apuestas-circle', 'visibility', 'visible');
    distanciaSlider.value = 0;
    actualizarSlider(0);
    distanciaPanel.classList.add('hidden');
    escenaActual = -1;
    const activeStep = document.querySelector('.step .card.active')?.closest('.step');
    irAEscena(parseInt(activeStep?.dataset?.scene ?? '0', 10));
  }

  /* ════════════ CONTROLES MODO LIBRE ════════════ */

  /* Reset */
  document.getElementById('reset-btn').addEventListener('click', () =>
    map.flyTo({ center: [-5.7, 36.2], zoom: 4, duration: 1200 }));

  /* Filtro por cadena */
  const filtroBtn   = document.getElementById('filtro-btn');
  const filtroPanel = document.getElementById('filtro-panel');

  function aplicarFiltro() {
    const lista = [...cadenasActivas];
    map.setFilter('apuestas-circle',
      lista.length === CADENAS.length ? null : ['in', ['get', 'cadena'], ['literal', lista]]);
  }

  const contenedorFiltro = document.getElementById('filtro-lista');
  CADENAS.forEach(cadena => {
    const label = document.createElement('label');
    label.className = 'filtro-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      cb.checked ? cadenasActivas.add(cadena) : cadenasActivas.delete(cadena);
      aplicarFiltro();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(cadena));
    contenedorFiltro.appendChild(label);
  });

  document.getElementById('filtro-todos').addEventListener('click', () => {
    cadenasActivas = new Set(CADENAS);
    document.querySelectorAll('#filtro-lista input').forEach(cb => cb.checked = true);
    aplicarFiltro();
  });
  document.getElementById('filtro-ninguno').addEventListener('click', () => {
    cadenasActivas.clear();
    document.querySelectorAll('#filtro-lista input').forEach(cb => cb.checked = false);
    aplicarFiltro();
  });
  filtroBtn.addEventListener('click', e => { e.stopPropagation(); filtroPanel.classList.toggle('hidden'); });
  document.addEventListener('click', e => {
    if (!filtroPanel.contains(e.target) && e.target !== filtroBtn) filtroPanel.classList.add('hidden');
  });

  /* ════════════ SLIDER DISTANCIA ════════════ */

  const distanciaBtn    = document.getElementById('distancia-btn');
  const distanciaPanel  = document.getElementById('distancia-panel');
  const distanciaSlider = document.getElementById('distancia-slider');
  const distanciaValor  = document.getElementById('distancia-valor');
  const distanciaReset  = document.getElementById('distancia-reset');

  function actualizarSlider(val) {
    if (val === 0) {
      distanciaValor.textContent = 'Desactivado';
      distanciaValor.classList.add('distancia-off');
      resetearColor();
    } else {
      distanciaValor.textContent = val + ' m';
      distanciaValor.classList.remove('distancia-off');
      aplicarUmbral(val);
    }
  }

  distanciaSlider.addEventListener('input', () => actualizarSlider(+distanciaSlider.value));

  distanciaReset.addEventListener('click', () => {
    distanciaPanel.classList.add('hidden');
  });

  distanciaBtn.addEventListener('click', e => {
    e.stopPropagation();
    distanciaPanel.classList.toggle('hidden');
  });

  document.addEventListener('click', e => {
    if (!distanciaPanel.contains(e.target) && e.target !== distanciaBtn)
      distanciaPanel.classList.add('hidden');
  });

} catch(err) {
  console.error('Error inicializando el mapa:', err);
}
});

/* ══════════════════════════════════════════
   GEOCODER (se añade al entrar en modo libre)
   ══════════════════════════════════════════ */

class GeocoderControl {
  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl geocoder-ctrl';
    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.placeholder = 'Buscar lugar…';
    this._input.className = 'geocoder-input';
    this._input.setAttribute('autocomplete', 'off');
    this._list = document.createElement('div');
    this._list.className = 'geocoder-results';
    this._list.hidden = true;
    this._container.appendChild(this._input);
    this._container.appendChild(this._list);

    let timer;
    this._input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = this._input.value.trim();
      if (q.length < 3) { this._list.innerHTML = ''; this._list.hidden = true; return; }
      timer = setTimeout(() => this._search(q), 350);
    });
    this._input.addEventListener('keydown', e => { if (e.key === 'Escape') this._list.hidden = true; });
    document.addEventListener('click', e => { if (!this._container.contains(e.target)) this._list.hidden = true; });
    return this._container;
  }

  async _search(q) {
    try {
      const data = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=es&countrycodes=es`
      ).then(r => r.json());
      this._render(data);
    } catch { /* sin red */ }
  }

  _render(items) {
    this._list.innerHTML = '';
    if (!items.length) {
      const el = document.createElement('div');
      el.className = 'geocoder-item geocoder-empty';
      el.textContent = 'Sin resultados';
      this._list.appendChild(el);
    } else {
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'geocoder-item';
        el.textContent = item.display_name;
        el.addEventListener('click', () => {
          this._input.value = item.display_name;
          this._list.hidden = true;
          const bb = item.boundingbox;
          if (bb) {
            this._map.fitBounds(
              [[parseFloat(bb[2]), parseFloat(bb[0])], [parseFloat(bb[3]), parseFloat(bb[1])]],
              { padding: 60, maxZoom: 14 }
            );
          } else {
            this._map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 13 });
          }
        });
        this._list.appendChild(el);
      });
    }
    this._list.hidden = false;
  }

  onRemove() { this._container.parentNode?.removeChild(this._container); }
}
