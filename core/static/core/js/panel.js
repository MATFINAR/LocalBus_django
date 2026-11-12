// ============================================================
// PANEL.JS - Gráficas con selector de periodo (7 o 15 días), mapa de rutas y ventana "Personalizar el panel"
// (abrir y cerrar, y subir o bajar gráficas). El orden que se guarda es el de las casillas marcadas en la
// lista; el servidor valida todo.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni confirm().
// ============================================================

// ---------- Selector de periodo: muestra solo las últimas N columnas ----------
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const CLAVE = 'localbus-panel-periodo-';
    const reporte = document.getElementById('paReporte');
    // El PDF dibuja «Alertas por día» con el mismo periodo (7 o 15 días) que se está viendo
    function periodoDelReporte(dias) {
        if (reporte) reporte.href = '/panel/reporte/?dias=' + dias;
    }

    document.querySelectorAll('.pa-graf').forEach(function (graf) {
        const botones = Array.from(graf.querySelectorAll('.pa-periodo'));
        const lista = graf.querySelector('.pa-columnas');
        if (!botones.length || !lista) return;
        const nota = graf.querySelector('[data-nota-periodo]');
        const columnas = Array.from(lista.children);

        function mostrar(dias) {
            const visibles = columnas.slice(-dias);
            const maximo = Math.max.apply(null, visibles.map(function (c) { return Number(c.dataset.valor); }).concat([0]));
            columnas.forEach(function (c) {
                const visible = visibles.indexOf(c) !== -1;
                c.hidden = !visible;
                const barra = c.querySelector('.pa-col-barra');
                if (visible && barra) barra.style.height = (maximo ? Math.round(Number(c.dataset.valor) * 100 / maximo) : 0) + '%';
            });
            lista.style.setProperty('--columnas', visibles.length);
            periodoDelReporte(dias);
            botones.forEach(function (b) {
                const activo = Number(b.dataset.periodo) === dias;
                b.classList.toggle('pa-periodo--activo', activo);
                b.setAttribute('aria-pressed', activo ? 'true' : 'false');
                if (activo && nota) nota.textContent = b.dataset.nota;
            });
        }

        botones.forEach(function (b) {
            b.addEventListener('click', function () {
                const dias = Number(b.dataset.periodo);
                mostrar(dias);
                try { localStorage.setItem(CLAVE + graf.dataset.grafica, String(dias)); } catch (e) { /* sin almacenamiento */ }
            });
        });

        let guardado = null;
        try { guardado = Number(localStorage.getItem(CLAVE + graf.dataset.grafica)); } catch (e) { /* sin almacenamiento */ }
        if (guardado && botones.some(function (b) { return Number(b.dataset.periodo) === guardado; })) mostrar(guardado);
    });
});

// ---------- Mapa de rutas: las mismas líneas, colores y globos que el mapa de Rutas ----------
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const caja = document.getElementById('paMapa');
    const cargando = document.getElementById('paMapaCargando');
    const datos = document.getElementById('paMapaDatos');
    if (!caja || !datos) return;

    function fallo() {
        cargando.textContent = 'No se pudo cargar el mapa. Revisa tu conexión y recarga la página.';
        cargando.classList.add('error');
    }
    if (typeof L === 'undefined') { fallo(); return; }

    let rutas = [];
    try { rutas = JSON.parse(datos.textContent); } catch (e) { fallo(); return; }

    function crear(etiqueta, clase, texto) {
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    function dato(caja, etiqueta, valor) {
        const p = crear('p', 'pa-globo-dato');
        p.appendChild(crear('span', '', etiqueta));
        p.appendChild(document.createTextNode(valor));
        caja.appendChild(p);
    }

    // Globo de cada ruta: código, nombre, estado, recorrido y medidas
    function globo(r) {
        const g = crear('div', 'pa-globo');
        g.style.setProperty('--ruta', r.color);
        const nombre = crear('p', 'pa-globo-nombre');
        nombre.appendChild(crear('span', 'pa-globo-codigo', r.codigo));
        nombre.appendChild(document.createTextNode(r.nombre));
        g.appendChild(nombre);
        dato(g, 'Estado', r.estado);
        dato(g, 'Recorrido', r.origen + ' → ' + r.destino);
        if (r.distancia_km) dato(g, 'Distancia', r.distancia_km.toFixed(1).replace('.', ',') + ' km');
        if (r.duracion_minutos) dato(g, 'Duración', r.duracion_minutos + ' min');
        if (r.frecuencia_minutos) dato(g, 'Frecuencia', 'Cada ' + r.frecuencia_minutos + ' min');
        return g;
    }

    const mapa = L.map(caja, { zoomControl: false, minZoom: 10, zoomSnap: 0.25 }).setView([6.2442, -75.5812], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);
    const capa = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        minZoom: 10,
        referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(mapa);
    capa.once('tileload', function () { cargando.hidden = true; });

    const lineas = rutas.map(function (r) {
        const puntos = r.coordenadas.map(function (c) { return [c[1], c[0]]; });
        const linea = L.polyline(puntos, r.habilitado
            ? { color: r.color, weight: 5, opacity: 0.85 }
            : { color: '#5B646B', weight: 4, opacity: 0.7, dashArray: '6 8' }).addTo(mapa);
        const etiqueta = r.codigo + ' ' + r.nombre;
        linea.bindPopup(function () { return globo(r); }, { minWidth: 240, maxWidth: 320 });
        linea.bindTooltip(etiqueta, { sticky: true });
        // Con el globo abierto la etiqueta flotante sobra (lo tapaba)
        linea.on('popupopen', function () { linea.closeTooltip(); linea.unbindTooltip(); });
        linea.on('popupclose', function () { linea.bindTooltip(etiqueta, { sticky: true }); });
        linea.on('mouseover', function () { linea.setStyle({ weight: 8 }); });
        linea.on('mouseout', function () { linea.setStyle({ weight: r.habilitado ? 5 : 4 }); });
        return linea;
    });

    // Se encuadra cuando la caja ya tiene su tamaño
    requestAnimationFrame(function () {
        mapa.invalidateSize();
        if (lineas.length) mapa.fitBounds(L.featureGroup(lineas).getBounds(), { padding: [30, 30], maxZoom: 15 });
    });
});

// ---------- Ventana Personalizar ----------
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const modal = document.getElementById('paPersonalizar');
    const form = document.getElementById('paPersonalizarForm');
    const lista = document.getElementById('paOpciones');
    const anuncio = document.getElementById('paAnuncio');
    if (!modal || !form || !lista) return;

    let focoPrevio = null;
    let guardado = [];   // [li, marcada] al abrir: cancelar vuelve exactamente a eso
    let enviando = false;

    function abrir() {
        focoPrevio = document.activeElement;
        guardado = Array.from(lista.querySelectorAll('.pa-opcion')).map(function (li) { return [li, li.querySelector('input').checked, li.parentNode]; });
        if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
        actualizarFlechas();
        const primera = lista.querySelector('input');
        if (primera) primera.focus();
    }

    function cerrar() {
        if (modal.open) modal.close(); else modal.removeAttribute('open');
    }

    // Cerrar sin guardar (Cancelar, X, Esc o clic fuera) deja la lista como estaba al abrir
    modal.addEventListener('close', function () {
        if (enviando) return;
        guardado.forEach(function (par) {
            par[2].appendChild(par[0]);
            par[0].querySelector('input').checked = par[1];
        });
        anuncio.textContent = '';
        if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
    });

    document.querySelectorAll('#btnPersonalizar, [data-personalizar]').forEach(function (b) {
        b.addEventListener('click', abrir);
    });
    modal.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrar); });
    // Clic en el fondo oscuro (fuera de la caja) cierra
    modal.addEventListener('click', function (e) { if (e.target === modal) cerrar(); });

    // ---------- Marcar o quitar todas (de un módulo o de todo el panel) ----------
    modal.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-marcar]');
        if (!boton) return;
        const marcar = boton.dataset.marcar === 'todas';
        const grupo = boton.closest('.pa-grupo');
        const cajas = Array.from((grupo || lista).querySelectorAll('input[type="checkbox"]'));
        cajas.forEach(function (c) { c.checked = marcar; });
        const donde = grupo ? 'en ' + grupo.querySelector('.pa-grupo-titulo').textContent : 'en todos los módulos';
        anuncio.textContent = (marcar ? 'Marcaste ' : 'Quitaste ') + cajas.length + ' gráficas ' + donde + '.';
    });

    // ---------- Subir y bajar ----------
    function actualizarFlechas() {
        // Cada módulo es su propia lista: las flechas mueven dentro de él
        lista.querySelectorAll('.pa-opciones').forEach(function (ul) {
            const items = Array.from(ul.children);
            items.forEach(function (li, i) {
                li.querySelector('[data-mover="-1"]').disabled = i === 0;
                li.querySelector('[data-mover="1"]').disabled = i === items.length - 1;
            });
        });
    }

    lista.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-mover]');
        if (!boton || boton.disabled) return;
        const li = boton.closest('li');
        const ul = li.parentNode;
        const paso = Number(boton.dataset.mover);
        const vecino = paso < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (!vecino) return;
        if (paso < 0) ul.insertBefore(li, vecino); else ul.insertBefore(vecino, li);
        actualizarFlechas();
        const titulo = li.querySelector('.pa-opcion-titulo').textContent;
        const posicion = Array.from(ul.children).indexOf(li) + 1;
        anuncio.textContent = titulo + ': posición ' + posicion + ' de ' + ul.children.length + ' en ' + ul.closest('.pa-grupo').querySelector('.pa-grupo-titulo').textContent + '.';
        // El foco sigue en la flecha que se usó; si quedó desactivada (llegó al borde), pasa a la otra
        (boton.disabled ? li.querySelector('[data-mover="' + (-paso) + '"]') : boton).focus();
    });

    // Mientras se guarda, el botón no se puede pulsar dos veces
    form.addEventListener('submit', function (e) {
        if (enviando) { e.preventDefault(); return; }
        enviando = true;
        const boton = e.submitter;
        if (boton) {
            boton.setAttribute('aria-disabled', 'true');
            if (boton.value === 'guardar') boton.textContent = 'Guardando…';
        }
    });

    // Al volver con el botón del navegador, la ventana no debe quedar "guardando"
    window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        enviando = false;
        form.querySelectorAll('[aria-disabled]').forEach(function (b) { b.removeAttribute('aria-disabled'); });
        const guardar = form.querySelector('[value="guardar"]');
        if (guardar) guardar.textContent = 'Guardar';
    });
});
