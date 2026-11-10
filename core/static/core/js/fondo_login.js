// ============================================================
// FONDO_LOGIN.JS - Ciudad en cuadrícula con edificios en 3D, para el fondo del login
// Se dibuja en SVG con una proyección isométrica. Con GSAP, cada vuelta (unos 22 s) cuenta esto:
//   1. los edificios crecen desde el suelo;
//   2. aparece la persona con su ubicación;
//   3. aparece el punto adonde quiere ir;
//   4. se traza la ruta (pasa por la persona y llega al destino);
//   5. sale un bus, para donde está la persona, ella desaparece (se sube) y el bus sigue hasta el destino.
// Además, todo el tiempo: tráfico por las calles, otras rutas con su bus, avisos que laten y techos que se
// iluminan con los colores de las rutas; la cámara se acerca y se pasea más.
// Sin GSAP o con movimiento reducido la ciudad queda armada y quieta.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const camara = document.getElementById('mapaCamara');
    const fondo = document.getElementById('fondoMapa');
    if (!camara || !fondo) return;
    // Si la ciudad en 3D (fondo_3d.js) ya está, este fondo no hace falta
    if (window.LB_FONDO_3D) return;

    // ---------- Proyección isométrica ----------
    const N = 18;          // manzanas por lado
    const PASO = 110;      // de una calle a la siguiente
    const LADO = 64;       // lado de cada manzana (el resto es calle)
    const MARGEN = (PASO - LADO) / 2;
    const COS = 0.866;
    const MUNDO = N * PASO;
    // El centro del mundo queda en el centro del mapa (800, 500)
    function proyectar(wx, wy, z) {
        return [(wx - wy) * COS + 800, (wx + wy) * 0.5 - (z || 0) + 500 - MUNDO / 2];
    }
    function puntos(lista) {
        return lista.map(function (p) { const q = proyectar(p[0], p[1], p[2]); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ');
    }

    // Generador de números al azar con semilla: la ciudad es siempre la misma
    let semilla = 20261107;
    function azar() {
        semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
        let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // ---------- Ciudad ----------
    let html = '';
    html += '<polygon class="mapa-suelo" points="' + puntos([[-60, -60], [MUNDO + 60, -60], [MUNDO + 60, MUNDO + 60], [-60, MUNDO + 60]]) + '"/>';
    // Rayas del centro de cada calle
    for (let g = 0; g <= N; g++) {
        html += '<polyline class="mapa-linea-calle" points="' + puntos([[g * PASO, -60], [g * PASO, MUNDO + 60]]) + '"/>';
        html += '<polyline class="mapa-linea-calle" points="' + puntos([[-60, g * PASO], [MUNDO + 60, g * PASO]]) + '"/>';
    }

    let parques = '';
    let edificios = '';
    const tonos = ['', '', '', 't2', 't3'];
    // De atrás hacia adelante, para que los de adelante tapen a los de atrás
    for (let d = 0; d <= 2 * N - 2; d++) {
        for (let i = 0; i < N; i++) {
            const j = d - i;
            if (j < 0 || j >= N) continue;
            const x0 = i * PASO + MARGEN;
            const y0 = j * PASO + MARGEN;
            const x1 = x0 + LADO;
            const y1 = y0 + LADO;
            if (azar() < 0.07) {
                parques += '<polygon class="edif-parque" points="' + puntos([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]) + '"/>';
                continue;
            }
            const h = Math.round(12 + Math.pow(azar(), 2) * 85);
            const base = proyectar(x1, y1, 0);
            const dist = Math.hypot(i - N / 2, j - N / 2);
            edificios += '<g class="edificio" data-h="' + h + '" data-d="' + dist.toFixed(2) + '" data-ox="' + base[0].toFixed(1) + '" data-oy="' + base[1].toFixed(1) + '">'
                + '<g class="lados">'
                + '<polygon class="edif-izq" points="' + puntos([[x0, y1, h], [x1, y1, h], [x1, y1, 0], [x0, y1, 0]]) + '"/>'
                + '<polygon class="edif-der" points="' + puntos([[x1, y0, h], [x1, y1, h], [x1, y1, 0], [x1, y0, 0]]) + '"/>'
                + '</g>'
                + '<polygon class="edif-techo ' + tonos[Math.floor(azar() * tonos.length)] + '" points="' + puntos([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]]) + '"/>'
                + '</g>';
        }
    }
    html += parques + '<g class="mapa-edificios">' + edificios + '</g>';
    // Capas del movimiento continuo (se llenan abajo, solo si hay animación)
    html += '<g id="mapaRutasExtra"></g><g id="mapaTrafico"></g><g id="mapaPings"></g>';

    // ---------- Ruta por las calles ----------
    // Cada punto es una esquina: [calle en x, calle en y]. La persona está en la 3.ª; el destino, en la última.
    const esquinas = [[2, 18], [2, 13], [6, 13], [6, 9], [10, 9], [10, 5]];
    const INDICE_PERSONA = 2;
    const trazo = esquinas.map(function (e) { return proyectar(e[0] * PASO, e[1] * PASO, 0); });
    const dRuta = trazo.map(function (p, k) { return (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    const persona = trazo[INDICE_PERSONA];
    const destino = trazo[trazo.length - 1];
    const paradas = [trazo[3], trazo[4]];

    // Qué parte del recorrido (de 0 a 1) está la persona
    let largoTotal = 0;
    let largoHastaPersona = 0;
    for (let k = 1; k < trazo.length; k++) {
        largoTotal += Math.hypot(trazo[k][0] - trazo[k - 1][0], trazo[k][1] - trazo[k - 1][1]);
        if (k === INDICE_PERSONA) largoHastaPersona = largoTotal;
    }
    const progresoPersona = largoHastaPersona / largoTotal;

    function f(n) { return n.toFixed(1); }
    html += '<path class="mapa-ruta-borde" pathLength="1" d="' + dRuta + '"/>';
    html += '<path id="mapaRuta" class="mapa-ruta" pathLength="1" d="' + dRuta + '"/>';
    paradas.forEach(function (p) {
        html += '<circle class="mapa-parada" cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="11"/>';
    });

    // Destino: pin rojo sobre su sombra en el suelo
    html += '<ellipse class="mapa-sombra-pin" cx="' + f(destino[0]) + '" cy="' + f(destino[1]) + '" rx="26" ry="11"/>';
    html += '<g class="mapa-pin" transform="translate(' + f(destino[0]) + ',' + f(destino[1]) + ')"><g class="mapa-pin-cuerpo">'
        + '<path d="M0 0 C -26 -34 -34 -52 -34 -66 A 34 34 0 1 1 34 -66 C 34 -52 26 -34 0 0 Z"/><circle cx="0" cy="-66" r="13"/>'
        + '</g></g>';

    // Persona: círculo de precisión, punto de ubicación e icono encima
    html += '<ellipse class="mapa-precision" cx="' + f(persona[0]) + '" cy="' + f(persona[1]) + '" rx="78" ry="40"/>';
    html += '<circle class="mapa-punto" cx="' + f(persona[0]) + '" cy="' + f(persona[1]) + '" r="15"/>';
    html += '<g class="mapa-usuario" transform="translate(' + f(persona[0]) + ',' + f(persona[1] - 70) + ')"><g class="mapa-usuario-icono">'
        + '<path class="usuario-globo" d="M0 40 L-11 26 L11 26 Z"/>'
        + '<circle class="usuario-fondo" cx="0" cy="0" r="32"/>'
        + '<circle class="usuario-cabeza" cx="0" cy="-9" r="9"/>'
        + '<path class="usuario-cuerpo" d="M-17 19 C -17 3 17 3 17 19 Z"/>'
        + '</g></g>';

    html += '<g class="mapa-bus" id="mapaBus"><rect x="-30" y="-15" width="60" height="30" rx="3"/><text x="0" y="7" text-anchor="middle">R22</text></g>';

    camara.innerHTML = html;

    // ---------- Animación ----------
    if (!window.gsap) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const suelo = camara.querySelectorAll('.mapa-suelo, .mapa-linea-calle, .edif-parque');
    const casas = gsap.utils.toArray('.edificio', camara);
    const lados = casas.map(function (c) { return c.querySelector('.lados'); });
    const techos = casas.map(function (c) { return c.querySelector('.edif-techo'); });
    const ruta = document.getElementById('mapaRuta');
    const borde = camara.querySelector('.mapa-ruta-borde');
    const marcas = gsap.utils.toArray('.mapa-parada', camara);
    const usuario = camara.querySelector('.mapa-usuario-icono');
    const precision = camara.querySelector('.mapa-precision');
    const punto = camara.querySelector('.mapa-punto');
    const pin = camara.querySelector('.mapa-pin-cuerpo');
    const sombraPin = camara.querySelector('.mapa-sombra-pin');
    const bus = document.getElementById('mapaBus');

    // El bus sigue la ruta según un progreso de 0 a 1
    const avance = { v: 0 };
    function colocarBus() {
        const p = ruta.getPointAtLength(avance.v * ruta.getTotalLength());
        bus.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
    }
    function centro(i, el) { return el.getAttribute('cx') + ' ' + el.getAttribute('cy'); }

    const tl = gsap.timeline({ repeat: -1 });

    // Estado inicial (se reaplica en cada vuelta)
    tl.set(fondo, { autoAlpha: 1 }, 0)
      .set(suelo, { autoAlpha: 0 }, 0)
      .set(lados, { scaleY: 0, svgOrigin: function (i) { return casas[i].dataset.ox + ' ' + casas[i].dataset.oy; } }, 0)
      .set(techos, { y: function (i) { return Number(casas[i].dataset.h); }, autoAlpha: 0 }, 0)
      .set([ruta, borde], { strokeDashoffset: 1 }, 0)
      .set(marcas, { scale: 0, svgOrigin: centro }, 0)
      .set(usuario, { y: -70, autoAlpha: 0 }, 0)
      .set(precision, { scale: 0.2, autoAlpha: 0, svgOrigin: centro }, 0)
      .set(punto, { scale: 0, autoAlpha: 1, svgOrigin: centro }, 0)
      .set(pin, { y: -150, autoAlpha: 0 }, 0)
      .set(sombraPin, { autoAlpha: 0 }, 0)
      .set(bus, { autoAlpha: 0 }, 0)
      .set(avance, { v: 0 }, 0)
      .set(camara, { scale: 1.3, x: -10, y: 30, svgOrigin: '800 500' }, 0);

    // Cámara: entra acercándose, se pasea por la ciudad y se aleja al final
    tl.to(camara, { scale: 1.12, x: 50, y: 10, duration: 7, ease: 'sine.inOut' }, 0)
      .to(camara, { scale: 1.05, x: 90, y: -10, duration: 8, ease: 'sine.inOut' }, 7)
      .to(camara, { scale: 0.98, x: 110, y: -30, duration: 7, ease: 'sine.inOut' }, 15);

    // 1) El suelo y los edificios crecen, empezando por el centro
    const espera = function (i) { return Number(casas[i].dataset.d) * 0.17; };
    tl.to(suelo, { autoAlpha: 1, duration: 1, ease: 'power1.out' }, 0.1)
      .to(lados, { scaleY: 1, duration: 0.8, ease: 'power2.out', delay: espera }, 0.5)
      .to(techos, { y: 0, autoAlpha: 1, duration: 0.8, ease: 'power2.out', delay: espera }, 0.5);

    // 2) Primero aparece la persona: baja su icono y se marca su ubicación
    tl.to(usuario, { y: 0, autoAlpha: 1, duration: 0.8, ease: 'power3.out' }, 3.4)
      .to(punto, { scale: 1, duration: 0.5, ease: 'power2.out' }, 4.1)
      .to(precision, { scale: 1, autoAlpha: 1, duration: 0.9, ease: 'power2.out' }, 4.1);

    // 3) Después, el punto adonde quiere ir
    tl.to(sombraPin, { autoAlpha: 1, duration: 0.4 }, 5.7)
      .to(pin, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.in' }, 5.5);

    // 4) Se traza la ruta: pasa por la persona y llega al destino
    tl.to([borde, ruta], { strokeDashoffset: 0, duration: 3.2, ease: 'power2.inOut' }, 6.8)
      .to(marcas, { scale: 1, duration: 0.5, ease: 'power2.out', stagger: 0.8 }, 8.4);

    // 5) Sale el bus, frena donde está la persona, ella desaparece (se sube) y el bus sigue al destino
    const salida = 10.4;
    const hastaPersona = 3.4;
    tl.set(bus, { autoAlpha: 1 }, salida)
      .fromTo(avance, { v: 0 }, { v: progresoPersona, duration: hastaPersona, ease: 'power2.out', onUpdate: colocarBus }, salida)
      .to([usuario, punto, precision], { autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, salida + hastaPersona + 0.1)
      .to(usuario, { y: -30, duration: 0.5, ease: 'power1.in' }, salida + hastaPersona + 0.1)
      .fromTo(avance, { v: progresoPersona }, { v: 1, duration: 5.4, ease: 'power1.inOut', onUpdate: colocarBus }, salida + hastaPersona + 0.9);

    // 6) Llega al destino: el pin da un saltito y todo se desvanece para volver a empezar
    const llegada = salida + hastaPersona + 0.9 + 5.4;
    tl.to(bus, { autoAlpha: 0, duration: 0.4 }, llegada + 0.2)
      .to(pin, { y: -14, duration: 0.25, ease: 'power2.out', yoyo: true, repeat: 1 }, llegada)
      .to(fondo, { autoAlpha: 0, duration: 1.2, ease: 'power1.inOut' }, llegada + 1.6)
      .set({}, {}, llegada + 3);

    // ============================================================
    // Movimiento continuo: tráfico, otras rutas con su bus, avisos que laten y luces en los techos.
    // Corre en paralelo a la historia y no se reinicia con ella.
    // ============================================================
    const continuos = [];
    const pocos = window.innerWidth < 700;          // en el celular, menos elementos
    const origen = proyectar(0, 0, 0);
    function rel(wx, wy, z) {                       // punto relativo al vehículo, en pantalla
        const q = proyectar(wx, wy, z);
        return f(q[0] - origen[0]) + ',' + f(q[1] - origen[1]);
    }
    function nodo(tag, attrs, padre) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
        if (padre) padre.appendChild(el);
        return el;
    }
    const COLORES = ['#7B3FB0', '#0F8A80', '#D9730D', '#C2185B', '#2E7D32', '#014CAB'];

    // ---- Tráfico: carros y buses que van y vienen por las calles ----
    const capaTrafico = document.getElementById('mapaTrafico');
    const CANTIDAD = pocos ? 12 : 26;
    for (let k = 0; k < CANTIDAD; k++) {
        const esBus = k % 3 === 0;
        const enX = Math.random() < 0.5;            // avanza a lo largo de x o de y
        const calle = 1 + Math.floor(Math.random() * (N - 1));
        const sentido = Math.random() < 0.5 ? 1 : -1;
        const carril = sentido * 10;
        const largo = esBus ? 34 : 18, ancho = esBus ? 13 : 10, alto = esBus ? 12 : 8;
        const color = esBus ? COLORES[k % COLORES.length] : ['#FFFFFF', '#8A949C', '#2B2F33', '#C9D2D9'][k % 4];
        // Caja en isométrico: techo y dos lados, orientada según la calle
        const L = enX ? [largo, 0] : [0, largo], A = enX ? [0, ancho] : [ancho, 0];
        const p = function (a, b, z) { return rel(a * L[0] + b * A[0] - (L[0] + A[0]) / 2, a * L[1] + b * A[1] - (L[1] + A[1]) / 2, z); };
        const g = nodo('g', { 'class': 'trafico-vehiculo' }, capaTrafico);
        nodo('polygon', { 'class': 'trafico-lado', points: [p(0, 1, 0), p(1, 1, 0), p(1, 1, alto), p(0, 1, alto)].join(' ') }, g);
        nodo('polygon', { 'class': 'trafico-lado2', points: [p(1, 0, 0), p(1, 1, 0), p(1, 1, alto), p(1, 0, alto)].join(' ') }, g);
        nodo('polygon', { 'class': 'trafico-techo', points: [p(0, 0, alto), p(1, 0, alto), p(1, 1, alto), p(0, 1, alto)].join(' '), fill: color }, g);

        const desde = sentido > 0 ? -80 : MUNDO + 80, hasta = sentido > 0 ? MUNDO + 80 : -80;
        const pos = { v: desde };
        const colocar = function () {
            const q = enX ? proyectar(pos.v, calle * PASO + carril, 0) : proyectar(calle * PASO + carril, pos.v, 0);
            g.setAttribute('transform', 'translate(' + f(q[0]) + ',' + f(q[1]) + ')');
        };
        const tw = gsap.to(pos, { v: hasta, duration: (esBus ? 16 : 10) + Math.random() * 8, ease: 'none', repeat: -1, onUpdate: colocar });
        tw.progress(Math.random());                 // cada uno empieza en un punto distinto
        continuos.push(tw);
    }

    // ---- Otras rutas: se trazan, su bus las recorre y se borran, una tras otra ----
    const capaRutas = document.getElementById('mapaRutasExtra');
    const rutasExtra = [
        { codigo: 'R05', color: COLORES[0], esquinas: [[0, 4], [5, 4], [5, 8], [12, 8], [12, 1]] },
        { codigo: 'R11', color: COLORES[1], esquinas: [[18, 15], [13, 15], [13, 11], [8, 11], [8, 16], [3, 16]] },
        { codigo: 'R17', color: COLORES[2], esquinas: [[14, 18], [14, 12], [17, 12], [17, 3], [9, 3]] },
        { codigo: 'R08', color: COLORES[3], esquinas: [[1, 1], [1, 7], [4, 7], [4, 11], [0, 11]] },
    ].slice(0, pocos ? 2 : 4);
    rutasExtra.forEach(function (r, k) {
        const d = r.esquinas.map(function (e, n) { const q = proyectar(e[0] * PASO, e[1] * PASO, 0); return (n ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1]); }).join(' ');
        const bordeR = nodo('path', { 'class': 'extra-ruta-borde', pathLength: 1, d: d }, capaRutas);
        const lineaR = nodo('path', { 'class': 'extra-ruta', pathLength: 1, d: d, stroke: r.color }, capaRutas);
        const busR = nodo('g', { 'class': 'extra-bus' }, capaRutas);
        nodo('rect', { x: -26, y: -13, width: 52, height: 26, rx: 3, fill: r.color }, busR);
        const texto = nodo('text', { x: 0, y: 6, 'text-anchor': 'middle' }, busR);
        texto.textContent = r.codigo;
        const av = { v: 0 };
        const mover = function () {
            const q = lineaR.getPointAtLength(av.v * lineaR.getTotalLength());
            busR.setAttribute('transform', 'translate(' + f(q.x) + ',' + f(q.y) + ')');
        };
        const t = gsap.timeline({ repeat: -1, delay: k * 2.6, repeatDelay: 1.5 });
        t.set([lineaR, bordeR], { strokeDashoffset: 1 })
         .set(busR, { autoAlpha: 0 })
         .set(av, { v: 0 })
         .to([bordeR, lineaR], { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut' })
         .set(busR, { autoAlpha: 1 })
         .to(av, { v: 1, duration: 6.5, ease: 'power1.inOut', onUpdate: mover })
         .to(busR, { autoAlpha: 0, duration: 0.3 })
         .to([bordeR, lineaR], { strokeDashoffset: -1, duration: 1.2, ease: 'power2.in' }, '<');
        continuos.push(t);
    });

    // ---- Avisos: ondas que laten en algunas esquinas, como buses que reportan su ubicación ----
    const capaPings = document.getElementById('mapaPings');
    for (let k = 0; k < (pocos ? 5 : 10); k++) {
        const q = proyectar((2 + Math.floor(Math.random() * (N - 3))) * PASO, (2 + Math.floor(Math.random() * (N - 3))) * PASO, 0);
        const color = COLORES[k % COLORES.length];
        const cen = f(q[0]) + ' ' + f(q[1]);
        const onda = nodo('ellipse', { 'class': 'mapa-ping', cx: f(q[0]), cy: f(q[1]), rx: 30, ry: 15, stroke: color }, capaPings);
        const centroP = nodo('circle', { cx: f(q[0]), cy: f(q[1]), r: 6, fill: color }, capaPings);
        const t = gsap.timeline({ repeat: -1, delay: Math.random() * 3, repeatDelay: 0.6 + Math.random() * 2 });
        t.fromTo(onda, { scale: 0.2, autoAlpha: 0.9, svgOrigin: cen }, { scale: 2.6, autoAlpha: 0, duration: 1.6, ease: 'power2.out' })
         .fromTo(centroP, { scale: 0.6, svgOrigin: cen }, { scale: 1.3, duration: 0.3, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0);
        continuos.push(t);
    }

    // ---- Luces: algunos techos se encienden con los colores de las rutas y se apagan ----
    const luces = gsap.utils.shuffle(techos.slice()).slice(0, pocos ? 20 : 45);
    luces.forEach(function (techo, k) {
        const t = gsap.to(techo, { fill: COLORES[k % COLORES.length], duration: 0.5, ease: 'power1.inOut', yoyo: true, repeat: -1,
            repeatDelay: 1.5 + Math.random() * 4, delay: 2 + Math.random() * 6 });
        continuos.push(t);
    });

    // Pestaña oculta: detener para no gastar batería
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { tl.pause(); continuos.forEach(function (t) { t.pause(); }); }
        else { tl.resume(); continuos.forEach(function (t) { t.resume(); }); }
    });

    // Si la ciudad en 3D llega después, detiene este fondo para no gastar batería
    window.LB_fondoSVG = {
        detener: function () {
            tl.kill();
            continuos.forEach(function (t) { t.kill(); });
        },
    };
});
