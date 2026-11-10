// ============================================================
// FONDO_3D.JS - Ciudad en 3D real (Three.js r186) para el fondo del login.
// Reemplaza al fondo SVG (fondo_login.js) cuando el navegador tiene WebGL. Si no, el SVG sigue igual.
//
// Lo que se ve:
//   - La ciudad: manzanas, parques y edificios con luz de sol, sombras y niebla.
//   - La cámara gira despacio alrededor de la ciudad y se acerca y aleja.
//   - Al entrar, los edificios crecen desde el suelo, del centro hacia afuera.
//   - 5 historias desfasadas, cada una con su color: aparece la persona, cae el pin de llegada,
//     se traza la ruta y el bus sale, la recoge y la lleva al destino.
// Rendimiento (skill threejs-performance): edificios, árboles y rayas son InstancedMesh (pocas
// llamadas de dibujo); en el celular no hay sombras y la resolución se limita.
// Con movimiento reducido se dibuja una sola imagen quieta.
// ============================================================
import * as THREE from 'three';

const fondo = document.getElementById('fondoMapa');

function iniciar() {
    if (!fondo) return;

    // ---------- Renderizador ----------
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
        return; // sin WebGL: se queda el fondo SVG
    }
    window.LB_FONDO_3D = true;

    const celular = window.innerWidth < 700;
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, celular ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !celular;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'mapa-3d';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    fondo.appendChild(renderer.domElement);

    // ---------- Escena, niebla y cámara ----------
    const CIELO = 0xEEF1F4;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CIELO);
    scene.fog = new THREE.Fog(CIELO, 90, 210);

    const camera = new THREE.PerspectiveCamera(36, 1, 1, 500);

    // ---------- Luces: cielo + sol con sombras ----------
    scene.add(new THREE.HemisphereLight(0xffffff, 0xaab4bd, 1.7));
    const sol = new THREE.DirectionalLight(0xfff4e6, 2.6);
    sol.position.set(60, 110, 40);
    if (!celular) {
        sol.castShadow = true;
        sol.shadow.mapSize.set(2048, 2048);
        const sc = sol.shadow.camera;
        sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 20; sc.far = 260;
        sc.updateProjectionMatrix();
        sol.shadow.bias = -0.0004;
        sol.shadow.normalBias = 0.03;
    }
    scene.add(sol);

    // ---------- Medidas de la ciudad ----------
    const N = 14;              // manzanas por lado
    const PASO = 10;           // de una calle a la siguiente
    const LADO = 6.6;          // lado de la manzana
    const MARGEN = (PASO - LADO) / 2;
    const MUNDO = N * PASO;
    const H = MUNDO / 2;       // la ciudad queda centrada en el origen
    const calle = (g) => g * PASO - H;

    // Azar con semilla: la ciudad sale siempre igual
    let semilla = 20261110;
    function azar() {
        semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
        let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const COLORES = [0x7B3FB0, 0x0F8A80, 0xD9730D, 0xC2185B, 0x2E7D32, 0x014CAB];
    const AZUL = 0x014CAB;
    const ROJO = 0xD62828;

    // Suelo (asfalto)
    const suelo = new THREE.Mesh(
        new THREE.PlaneGeometry(MUNDO * 3, MUNDO * 3),
        new THREE.MeshStandardMaterial({ color: 0xD3D9DF, roughness: 0.95 })
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.receiveShadow = true;
    scene.add(suelo);

    // ---------- Manzanas (andenes), parques y edificios ----------
    const manzanas = [];
    const edificios = [];
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cx = calle(i) + MARGEN + LADO / 2;
            const cz = calle(j) + MARGEN + LADO / 2;
            const parque = azar() < 0.08;
            manzanas.push({ cx, cz, parque });
            if (parque) continue;
            // 1 a 4 edificios por manzana, de alturas distintas
            const partes = azar() < 0.55 ? 1 : (azar() < 0.6 ? 2 : 4);
            const lado = partes === 4 ? LADO / 2 - 0.35 : (partes === 2 ? LADO - 0.7 : LADO - 0.7);
            for (let k = 0; k < partes; k++) {
                let x = cx, z = cz, ancho = lado, fondoB = lado;
                if (partes === 2) { fondoB = LADO / 2 - 0.35; z = cz + (k ? 1 : -1) * (LADO / 4); }
                if (partes === 4) { x = cx + (k % 2 ? 1 : -1) * (LADO / 4); z = cz + (k > 1 ? 1 : -1) * (LADO / 4); }
                const alto = 1.5 + Math.pow(azar(), 2.2) * (Math.hypot(cx, cz) < 30 ? 15 : 9);
                edificios.push({ x, z, ancho, fondo: fondoB, alto, dist: Math.hypot(x, z), color: [0xF5F7F9, 0xF5F7F9, 0xE7EDF5, 0xF2ECE1, 0xE9ECEF][Math.floor(azar() * 5)] });
            }
        }
    }

    const anden = new THREE.InstancedMesh(new THREE.BoxGeometry(LADO, 0.3, LADO),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), manzanas.length);
    const aux = new THREE.Object3D();
    const colorAux = new THREE.Color();
    manzanas.forEach((m, n) => {
        aux.position.set(m.cx, 0.15, m.cz);
        aux.scale.set(1, 1, 1);
        aux.updateMatrix();
        anden.setMatrixAt(n, aux.matrix);
        anden.setColorAt(n, colorAux.set(m.parque ? 0xCFE6D4 : 0xFFFFFF));
    });
    anden.receiveShadow = true;
    scene.add(anden);

    // Árboles en los parques
    const arbolesPos = [];
    manzanas.filter((m) => m.parque).forEach((m) => {
        for (let k = 0; k < 5; k++) arbolesPos.push([m.cx + (azar() - 0.5) * (LADO - 1.5), m.cz + (azar() - 0.5) * (LADO - 1.5), 0.8 + azar() * 0.7]);
    });
    if (arbolesPos.length) {
        const arboles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
            new THREE.MeshStandardMaterial({ color: 0x5FA36E, roughness: 0.8, flatShading: true }), arbolesPos.length);
        arbolesPos.forEach((a, n) => {
            aux.position.set(a[0], 0.3 + a[2], a[1]);
            aux.scale.setScalar(a[2]);
            aux.updateMatrix();
            arboles.setMatrixAt(n, aux.matrix);
        });
        arboles.castShadow = !celular;
        scene.add(arboles);
    }

    // Edificios: un solo InstancedMesh; la base de la caja queda en el suelo para poder "crecer"
    const cajaEdificio = new THREE.BoxGeometry(1, 1, 1);
    cajaEdificio.translate(0, 0.5, 0);
    const torres = new THREE.InstancedMesh(cajaEdificio,
        new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.02 }), edificios.length);
    function colocarEdificio(n, crecimiento) {
        const e = edificios[n];
        aux.position.set(e.x, 0.3, e.z);
        aux.rotation.set(0, 0, 0);
        aux.scale.set(e.ancho, Math.max(0.001, e.alto * crecimiento), e.fondo);
        aux.updateMatrix();
        torres.setMatrixAt(n, aux.matrix);
    }
    edificios.forEach((e, n) => {
        colocarEdificio(n, quieto ? 1 : 0);
        torres.setColorAt(n, colorAux.set(e.color));
    });
    torres.castShadow = !celular;
    torres.receiveShadow = !celular;
    scene.add(torres);

    // Rayas blancas del centro de las calles
    const rayas = [];
    for (let g = 0; g <= N; g++) {
        for (let s = -H; s < H; s += 3) {
            rayas.push([calle(g), s + 1, false]);
            rayas.push([s + 1, calle(g), true]);
        }
    }
    const raya = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.04, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xffffff }), rayas.length);
    rayas.forEach((r, n) => {
        aux.position.set(r[0], 0.02, r[1]);
        aux.rotation.set(0, r[2] ? Math.PI / 2 : 0, 0);
        aux.scale.set(1, 1, 1);
        aux.updateMatrix();
        raya.setMatrixAt(n, aux.matrix);
    });
    scene.add(raya);

    // ---------- Recorridos: cinta en el suelo que se dibuja de a poco ----------
    function crearRecorrido(esquinas, color, ancho, altura) {
        const pts = esquinas.map((e) => new THREE.Vector3(calle(e[0]), altura, calle(e[1])));
        const largos = [0];
        for (let k = 1; k < pts.length; k++) largos.push(largos[k - 1] + pts[k].distanceTo(pts[k - 1]));
        const total = largos[largos.length - 1];
        const punto = (d, destino) => {
            d = Math.min(Math.max(d, 0), total);
            let k = 1;
            while (k < largos.length - 1 && largos[k] < d) k++;
            const a = pts[k - 1], b = pts[k];
            const f = (d - largos[k - 1]) / Math.max(largos[k] - largos[k - 1], 1e-6);
            return destino.copy(a).lerp(b, f);
        };
        // Cinta: muestras cada 0,5 unidades, dos triángulos por tramo
        const PASOS = Math.ceil(total / 0.5);
        const pos = new Float32Array(PASOS * 18);
        const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), lado = new THREE.Vector3();
        for (let s = 0; s < PASOS; s++) {
            punto((s / PASOS) * total, p0);
            punto(((s + 1) / PASOS) * total, p1);
            lado.subVectors(p1, p0).normalize();
            lado.set(-lado.z, 0, lado.x).multiplyScalar(ancho / 2);
            const q = [p0.x + lado.x, p0.z + lado.z, p0.x - lado.x, p0.z - lado.z, p1.x + lado.x, p1.z + lado.z, p1.x - lado.x, p1.z - lado.z];
            const v = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[2], q[3]], [q[6], q[7]], [q[4], q[5]]];
            v.forEach((xz, n) => { pos[s * 18 + n * 3] = xz[0]; pos[s * 18 + n * 3 + 1] = altura; pos[s * 18 + n * 3 + 2] = xz[1]; });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        const cinta = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        cinta.renderOrder = 1;
        scene.add(cinta);
        return {
            total, punto, cinta,
            // Muestra la cinta desde la fracción "desde" hasta "hasta" (para dibujarla y borrarla)
            tramo(desde, hasta) {
                const a = Math.floor(Math.max(0, desde) * PASOS), b = Math.ceil(Math.min(1, hasta) * PASOS);
                geo.setDrawRange(a * 6, Math.max(0, b - a) * 6);
            },
        };
    }

    // Bus: caja con techo blanco, ventanas oscuras y su color de ruta
    function crearBus(color) {
        const g = new THREE.Group();
        const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 1.4), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
        cuerpo.position.y = 1.05;
        const ventanas = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.45, 1.45), new THREE.MeshStandardMaterial({ color: 0x1D2730, roughness: 0.3 }));
        ventanas.position.y = 1.35;
        const techo = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        techo.position.y = 1.86;
        [cuerpo, ventanas, techo].forEach((m) => { m.castShadow = !celular; g.add(m); });
        scene.add(g);
        return g;
    }

    const adelante = new THREE.Vector3();
    function moverBus(bus, recorrido, d) {
        recorrido.punto(d, bus.position);
        recorrido.punto(d + 0.6, adelante);
        bus.position.y = 0;
        adelante.y = 0;
        if (adelante.distanceToSquared(bus.position) > 1e-6) bus.lookAt(adelante);
        bus.rotateY(-Math.PI / 2); // el largo del bus va en x
    }

    // ---------- Historias: la persona, su destino, la ruta y el bus que la recoge ----------
    // Cada historia repite lo mismo, con su color y su recorrido, desfasada de las demás.
    function crearPersona(color) {
        const g = new THREE.Group();
        const borde = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const punto = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 32), new THREE.MeshBasicMaterial({ color }));
        const onda = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.8, 40),
            new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        onda.rotation.x = -Math.PI / 2;
        borde.position.y = 0.36; punto.position.y = 0.42; onda.position.y = 0.4;
        const figura = new THREE.Group();
        const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), new THREE.MeshStandardMaterial({ color: 0x1A1A1A }));
        cabeza.position.y = 2.6;
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 12), new THREE.MeshStandardMaterial({ color: 0x1A1A1A }));
        torso.position.y = 1.4;
        figura.add(cabeza, torso);
        figura.traverse((m) => { if (m.isMesh) m.castShadow = !celular; });
        g.add(borde, punto, onda, figura);
        scene.add(g);
        return { g, onda, figura };
    }

    function crearPin() {
        const g = new THREE.Group();
        const punta = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.8, 24), new THREE.MeshStandardMaterial({ color: ROJO, roughness: 0.4 }));
        punta.rotation.x = Math.PI;
        punta.position.y = 1.4;
        const bola = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 18), new THREE.MeshStandardMaterial({ color: ROJO, roughness: 0.4 }));
        bola.position.y = 3.1;
        const ojo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ojo.position.y = 3.1;
        ojo.scale.set(1, 1, 1.9);
        g.add(punta, bola, ojo);
        g.traverse((m) => { if (m.isMesh) m.castShadow = !celular; });
        scene.add(g);
        return g;
    }

    // La persona espera en la 3.ª esquina de cada recorrido; el destino es la última
    const RECORRIDOS = [
        { esquinas: [[2, 14], [2, 10], [5, 10], [5, 7], [9, 7], [9, 4]], color: AZUL },
        { esquinas: [[0, 3], [4, 3], [4, 6], [10, 6], [10, 1]], color: COLORES[0] },
        { esquinas: [[14, 12], [10, 12], [10, 9], [7, 9], [7, 13], [3, 13]], color: COLORES[1] },
        { esquinas: [[12, 14], [12, 8], [13, 8], [13, 2], [7, 2]], color: COLORES[2] },
        { esquinas: [[1, 1], [1, 6], [3, 6], [3, 9], [0, 9]], color: COLORES[3] },
    ];
    const CICLO = 20;            // lo que dura cada historia, de principio a fin
    const historias = RECORRIDOS.map((r, k) => {
        const rec = crearRecorrido(r.esquinas, r.color, 1.2, 0.32 + k * 0.004);
        const e = r.esquinas;
        const dPersona = Math.abs(e[1][0] - e[0][0]) * PASO + Math.abs(e[1][1] - e[0][1]) * PASO
            + Math.abs(e[2][0] - e[1][0]) * PASO + Math.abs(e[2][1] - e[1][1]) * PASO;
        const posPersona = rec.punto(dPersona, new THREE.Vector3());
        const posDestino = rec.punto(rec.total, new THREE.Vector3());
        const persona = crearPersona(r.color);
        persona.g.position.set(posPersona.x + 1.6, 0, posPersona.z + 1.6);
        const pin = crearPin();
        pin.position.set(posDestino.x, 0, posDestino.z);
        return { rec, dPersona, persona, pin, bus: crearBus(r.color), desfase: k * (CICLO / RECORRIDOS.length) };
    });

    // Una historia en el segundo c de su vuelta (0 a CICLO):
    //  0,0-0,8  aparece la persona (baja del aire)       1,4-2,0  cae el pin del destino
    //  2,6-4,6  se traza la ruta                         5,0-8,4  sale el bus y llega hasta la persona
    //  8,4      la persona se sube                       9,2-15   el bus sigue hasta el destino
    //  15-15,6  el pin da un salto y el bus se va        16,5-18  todo se borra; luego espera
    function historia(h, c, t) {
        const activa = c >= 0 && c < 18;
        // Persona
        const bajada = facil(c / 0.8);
        h.persona.g.visible = activa && c >= 0;
        h.persona.figura.position.y = (1 - bajada) * 8;
        h.persona.onda.scale.setScalar(1 + ((t * 0.8) % 1) * 1.6);
        h.persona.onda.material.opacity = (1 - ((t * 0.8) % 1)) * bajada;
        // Pin
        const caida = facil((c - 1.4) / 0.6);
        h.pin.visible = activa && c >= 1.4;
        h.pin.position.y = 0.3 + (1 - caida) * 14 + (c > 15 && c < 15.6 ? Math.sin(((c - 15) / 0.6) * Math.PI) * 1.8 : 0);
        h.pin.rotation.y = t * 0.8;
        // Ruta: se dibuja y al final se borra
        h.rec.tramo(facil((c - 16.5) / 1.5), facil((c - 2.6) / 2));
        // Bus
        let d = 0;
        if (c >= 5 && c < 8.4) d = facil((c - 5) / 3.4) * h.dPersona;
        else if (c >= 8.4 && c < 9.2) d = h.dPersona;
        else if (c >= 9.2) d = h.dPersona + (h.rec.total - h.dPersona) * facil((c - 9.2) / 5.8);
        h.bus.visible = c >= 5 && c < 15.6;
        moverBus(h.bus, h.rec, d);
        // La persona desaparece cuando el bus la recoge
        if (c >= 8.4) h.persona.g.visible = false;
    }

    // ---------- Tamaño ----------
    function ajustar() {
        const w = fondo.clientWidth || window.innerWidth;
        const h = fondo.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // En pantallas angostas la cámara se aleja para que quepa la ciudad
        camera.fov = camera.aspect < 0.8 ? 50 : 36;
        camera.updateProjectionMatrix();
    }
    ajustar();
    if (window.ResizeObserver) new ResizeObserver(ajustar).observe(fondo);
    else window.addEventListener('resize', ajustar);

    // ---------- Cuadro por cuadro ----------
    const CRECER = 3.2;          // segundos que tardan los edificios en crecer
    const distMax = edificios.reduce((m, e) => Math.max(m, e.dist), 1);
    let crecidos = quieto;
    const timer = new THREE.Timer();
    timer.connect(document);
    const facil = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

    function cuadro(t, dt) {
        // Cámara: gira despacio, se acerca y se aleja
        const angulo = 0.75 + t * 0.045;
        // En pantallas angostas (celular) se mira más desde arriba: así no queda medio fondo en niebla
        const angosta = camera.aspect < 0.8;
        const radio = (angosta ? 62 : 98) + Math.sin(t * 0.16) * (angosta ? 6 : 12) + (1 - facil(t / 4)) * 40;
        const alto = (angosta ? 150 : 86) + Math.sin(t * 0.11) * 8 + (1 - facil(t / 4)) * 25;
        camera.position.set(Math.cos(angulo) * radio, alto, Math.sin(angulo) * radio);
        camera.lookAt(0, 0, 0);
        // La niebla empieza un poco más allá del centro, sea cual sea la distancia de la cámara
        const distancia = Math.hypot(radio, alto);
        scene.fog.near = distancia * 0.7;
        scene.fog.far = distancia * 1.7;

        // Los edificios crecen del centro hacia afuera
        if (!crecidos) {
            for (let n = 0; n < edificios.length; n++) {
                const inicio = (edificios[n].dist / distMax) * (CRECER - 0.9);
                const x = (t - inicio) / 0.9;
                // Sube con un pequeño rebote al final
                colocarEdificio(n, x <= 0 ? 0 : (x >= 1 ? 1 : facil(x) + Math.sin(x * Math.PI) * 0.06));
            }
            torres.instanceMatrix.needsUpdate = true;
            if (t > CRECER + 0.2) {
                edificios.forEach((e, n) => colocarEdificio(n, 1));
                torres.instanceMatrix.needsUpdate = true;
                crecidos = true;
            }
        }

        // Las 5 historias, cada una desfasada
        // (la primera empieza cuando la ciudad ya casi terminó de crecer)
        historias.forEach((h) => {
            const c = t - 2.5 - h.desfase;
            historia(h, c < 0 ? -1 : c % CICLO, t);
        });
    }

    function animar() {
        timer.update();
        const dt = Math.min(timer.getDelta(), 0.1);
        cuadro(timer.getElapsed(), dt);
        renderer.render(scene, camera);
    }

    // Con movimiento reducido: una sola imagen, con todo armado
    if (quieto) {
        cuadro(8, 0);
        renderer.render(scene, camera);
    } else {
        renderer.setAnimationLoop(animar);
        // Pestaña oculta: se detiene el ciclo para no gastar batería
        document.addEventListener('visibilitychange', () => {
            renderer.setAnimationLoop(document.hidden ? null : animar);
        });
    }

    // El fondo SVG ya no hace falta: se oculta y se detiene
    fondo.classList.add('con-3d');
    if (window.LB_fondoSVG) window.LB_fondoSVG.detener();
}

try {
    iniciar();
} catch (e) {
    // Si algo falla, el fondo SVG sigue funcionando
    window.LB_FONDO_3D = false;
    if (fondo) fondo.classList.remove('con-3d');
}