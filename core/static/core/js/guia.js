// guia.js: guía paso a paso de cada página (botón "Guía", arriba a la derecha).
//
// Cada plantilla declara sus pasos en el bloque {% block guia %} de base.html:
//
//   <template id="guiaPagina" data-titulo="Guía de Rutas">
//     <section data-paso="#btnNuevaRuta | .otro-selector" data-titulo="Nueva ruta">
//       <p>Explicación…</p>
//     </section>
//   </template>
//
// - data-paso: dónde apunta el paso. Con "|" se dan alternativas en orden de preferencia (se usa la
//   primera que se vea en la pantalla). Sin data-paso (o vacío), el paso sale centrado, sin resaltar nada.
// - Los pasos cuyo elemento no existe o no se ve ahora (vacío, otra vista, otro rol) se saltan solos.
// - El texto lo escribimos nosotros en la plantilla: se copia tal cual (no lleva datos de la base).
// - Con #guia en la dirección, la guía empieza sola al abrir la página.
(function () {
    'use strict';

    const plantilla = document.getElementById('guiaPagina');
    const boton = document.getElementById('guiaBoton');
    if (!plantilla || !boton) return;

    const definiciones = Array.from(plantilla.content.querySelectorAll('section'));
    if (!definiciones.length) return;

    const tituloGuia = plantilla.dataset.titulo || 'Guía de esta página';
    boton.hidden = false;
    boton.setAttribute('aria-label', tituloGuia + ': recorrido por lo que hay en esta página');

    const movimientoReducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    const celular = window.matchMedia('(max-width: 768px)');
    const MARGEN = 12;       // separación del globo con el borde de la pantalla y con el elemento
    const RELLENO = 6;       // cuánto sobresale el recuadro alrededor del elemento

    let pasos = [];          // los que se pueden mostrar ahora: { elemento, titulo, contenido }
    let actual = -1;
    let capas = null;        // { fondo, foco, globo, ... }
    let cuadro = null;       // id del requestAnimationFrame que sigue al elemento
    let ultimo = '';         // última posición dibujada (para no tocar el DOM si no cambió)
    let enfocadoAntes = null;

    // ---------- Qué pasos se pueden mostrar ----------
    function seVe(el) {
        if (!el || !el.isConnected) return false;
        if (el.closest('[hidden], template')) return false;
        const estilo = getComputedStyle(el);
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function buscarElemento(selectores) {
        for (const sel of selectores) {
            let candidatos;
            try {
                candidatos = document.querySelectorAll(sel);
            } catch (e) {
                continue; // selector mal escrito: se salta, no rompe la guía
            }
            for (const el of candidatos) {
                if (!el.closest('.gu-capa') && seVe(el)) return el;
            }
        }
        return null;
    }

    function prepararPasos() {
        return definiciones.map(function (def) {
            const selectores = (def.dataset.paso || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
            const elemento = selectores.length ? buscarElemento(selectores) : null;
            if (selectores.length && !elemento) return null;
            return { elemento: elemento, titulo: def.dataset.titulo || '', contenido: def };
        }).filter(Boolean);
    }

    // ---------- Capas: fondo que bloquea la página, recuadro y globo ----------
    function crear(etiqueta, clase, texto) {
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    function crearCapas() {
        const fondo = crear('div', 'gu-capa gu-fondo');
        fondo.setAttribute('aria-hidden', 'true');
        const foco = crear('div', 'gu-capa gu-foco');
        foco.setAttribute('aria-hidden', 'true');

        const globo = crear('div', 'gu-capa gu-globo');
        globo.setAttribute('role', 'dialog');
        globo.setAttribute('aria-modal', 'true');
        globo.setAttribute('aria-labelledby', 'guTitulo');
        globo.setAttribute('aria-describedby', 'guTexto');

        const cabeza = crear('div', 'gu-cabeza');
        const nombre = crear('p', 'gu-nombre', tituloGuia);
        const cuenta = crear('p', 'gu-cuenta');
        cuenta.setAttribute('aria-live', 'polite');
        const cerrar = crear('button', 'gu-cerrar');
        cerrar.type = 'button';
        cerrar.setAttribute('aria-label', 'Salir de la guía');
        cerrar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        const textos = crear('div', 'gu-textos-cabeza');
        textos.append(nombre, cuenta);
        cabeza.append(textos, cerrar);

        const titulo = crear('h2', 'gu-titulo');
        titulo.id = 'guTitulo';
        titulo.tabIndex = -1;
        const texto = crear('div', 'gu-texto');
        texto.id = 'guTexto';

        const progreso = crear('div', 'gu-progreso');
        progreso.setAttribute('aria-hidden', 'true');
        const barra = crear('span', 'gu-progreso-barra');
        progreso.appendChild(barra);

        const acciones = crear('div', 'gu-acciones');
        const anterior = crear('button', 'gu-boton gu-boton--secundario', 'Anterior');
        anterior.type = 'button';
        const siguiente = crear('button', 'gu-boton', 'Siguiente');
        siguiente.type = 'button';
        const ayuda = crear('p', 'gu-teclas', 'Usa las flechas del teclado para avanzar o volver, y Escape para salir.');
        acciones.append(anterior, siguiente);

        globo.append(cabeza, titulo, texto, progreso, acciones, ayuda);
        document.body.append(fondo, foco, globo);

        cerrar.addEventListener('click', terminar);
        anterior.addEventListener('click', function () { ir(actual - 1); });
        siguiente.addEventListener('click', function () {
            if (actual >= pasos.length - 1) terminar();
            else ir(actual + 1);
        });
        // Tocar fuera del globo no hace nada: la página queda quieta mientras dura la guía
        fondo.addEventListener('click', function () { titulo.focus(); });

        return { fondo, foco, globo, cuenta, titulo, texto, barra, anterior, siguiente };
    }

    // ---------- Recorrido ----------
    function empezar() {
        if (capas) return;
        pasos = prepararPasos();
        if (!pasos.length) return;
        // El menú del sitio tapa la página: se cierra antes de empezar
        if (typeof window.closeHeader === 'function') window.closeHeader();
        enfocadoAntes = document.activeElement;
        capas = crearCapas();
        document.documentElement.classList.add('gu-activa');
        document.addEventListener('keydown', teclas, true);
        requestAnimationFrame(function () { capas.globo.classList.add('gu-visible'); });
        ir(0);
        seguir();
    }

    function terminar() {
        if (!capas) return;
        cancelAnimationFrame(cuadro);
        document.removeEventListener('keydown', teclas, true);
        limpiarElemento();
        [capas.fondo, capas.foco, capas.globo].forEach(function (c) { c.remove(); });
        capas = null;
        actual = -1;
        ultimo = '';
        document.documentElement.classList.remove('gu-activa');
        if (location.hash === '#guia') history.replaceState(null, '', location.pathname + location.search);
        const volver = enfocadoAntes && enfocadoAntes !== document.body && enfocadoAntes.isConnected && seVe(enfocadoAntes)
            ? enfocadoAntes : boton;
        volver.focus({ preventScroll: true });
    }

    function limpiarElemento() {
        const paso = pasos[actual];
        if (paso && paso.elemento) {
            paso.elemento.style.removeProperty('scroll-margin-top');
            paso.elemento.style.removeProperty('scroll-margin-bottom');
        }
    }

    function ir(indice) {
        if (!capas || indice < 0 || indice >= pasos.length) return;
        limpiarElemento();
        actual = indice;
        const paso = pasos[indice];

        capas.titulo.textContent = paso.titulo;
        capas.texto.replaceChildren(...Array.from(paso.contenido.childNodes, function (n) { return n.cloneNode(true); }));
        capas.cuenta.textContent = 'Paso ' + (indice + 1) + ' de ' + pasos.length;
        capas.barra.style.width = ((indice + 1) / pasos.length * 100) + '%';
        capas.anterior.disabled = indice === 0;
        capas.siguiente.textContent = indice === pasos.length - 1 ? 'Terminar' : 'Siguiente';
        capas.globo.classList.toggle('gu-centrado', !paso.elemento);

        if (paso.elemento) llevarAPantalla(paso.elemento);
        ultimo = '';
        colocar();
        capas.titulo.focus({ preventScroll: true });
    }

    // Lleva el elemento a la vista. En el celular el globo va abajo: el elemento queda arriba.
    function llevarAPantalla(el) {
        const r = el.getBoundingClientRect();
        const alto = window.innerHeight;
        const espacioGlobo = celular.matches ? capas.globo.offsetHeight + MARGEN * 2 : 0;
        const cabe = r.top >= 76 && r.bottom <= alto - espacioGlobo - MARGEN;
        if (cabe) return;
        el.style.setProperty('scroll-margin-top', '84px');
        el.style.setProperty('scroll-margin-bottom', (espacioGlobo + MARGEN) + 'px');
        el.scrollIntoView({
            block: celular.matches || r.height > alto * 0.6 ? 'start' : 'center',
            inline: 'nearest',
            behavior: movimientoReducido && movimientoReducido.matches ? 'auto' : 'smooth',
        });
    }

    // Sigue al elemento mientras dura la guía (desplazamientos, cambios de tamaño, animaciones)
    function seguir() {
        colocar();
        cuadro = requestAnimationFrame(seguir);
    }

    function colocar() {
        if (!capas) return;
        const paso = pasos[actual];
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        const globo = capas.globo;
        const gw = globo.offsetWidth;
        const gh = globo.offsetHeight;

        if (!paso || !paso.elemento || !paso.elemento.isConnected) {
            const clave = 'centro' + vw + 'x' + vh + 'x' + gh;
            if (clave === ultimo) return;
            ultimo = clave;
            capas.foco.classList.add('gu-sin-foco');
            globo.style.left = Math.max(MARGEN, (vw - gw) / 2) + 'px';
            globo.style.top = Math.max(MARGEN, (vh - gh) / 2) + 'px';
            return;
        }

        const r = paso.elemento.getBoundingClientRect();
        // El recuadro no pasa de la pantalla (una tabla larga se resalta solo en lo que se ve)
        const f = {
            left: Math.max(4, r.left - RELLENO),
            top: Math.max(4, r.top - RELLENO),
            right: Math.min(vw - 4, r.right + RELLENO),
            bottom: Math.min(vh - 4, r.bottom + RELLENO),
        };
        const clave = [f.left, f.top, f.right, f.bottom, vw, vh, gw, gh].map(Math.round).join(',');
        if (clave === ultimo) return;
        ultimo = clave;

        capas.foco.classList.toggle('gu-sin-foco', f.bottom <= f.top || f.right <= f.left);
        Object.assign(capas.foco.style, {
            left: f.left + 'px', top: f.top + 'px',
            width: Math.max(0, f.right - f.left) + 'px', height: Math.max(0, f.bottom - f.top) + 'px',
        });

        let left;
        let top;
        if (celular.matches) {
            // En el celular el globo ocupa el ancho: abajo, o arriba si el elemento está en la mitad de abajo
            left = MARGEN;
            top = (r.top + r.bottom) / 2 > vh / 2 && f.top > gh + MARGEN * 2 ? MARGEN : vh - gh - MARGEN;
        } else if (vh - f.bottom >= gh + MARGEN * 2) {
            top = f.bottom + MARGEN;                     // debajo
            left = f.left;
        } else if (f.top >= gh + MARGEN * 2) {
            top = f.top - gh - MARGEN;                   // encima
            left = f.left;
        } else if (vw - f.right >= gw + MARGEN * 2) {
            left = f.right + MARGEN;                     // a la derecha
            top = f.top;
        } else if (f.left >= gw + MARGEN * 2) {
            left = f.left - gw - MARGEN;                 // a la izquierda
            top = f.top;
        } else {
            left = vw - gw - MARGEN;                     // no cabe al lado: esquina inferior derecha
            top = vh - gh - MARGEN;
        }
        globo.style.left = Math.min(Math.max(MARGEN, left), Math.max(MARGEN, vw - gw - MARGEN)) + 'px';
        globo.style.top = Math.min(Math.max(MARGEN, top), Math.max(MARGEN, vh - gh - MARGEN)) + 'px';
    }

    // ---------- Teclado: flechas, Escape y el foco queda dentro del globo ----------
    function teclas(e) {
        if (!capas) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            terminar();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (actual < pasos.length - 1) ir(actual + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            ir(actual - 1);
        } else if (e.key === 'Tab') {
            const enfocables = Array.from(capas.globo.querySelectorAll('button:not([disabled]), a[href]'));
            if (!enfocables.length) return;
            const primero = enfocables[0];
            const final = enfocables[enfocables.length - 1];
            const dentro = capas.globo.contains(document.activeElement);
            if (e.shiftKey && (document.activeElement === primero || !dentro)) {
                e.preventDefault();
                final.focus();
            } else if (!e.shiftKey && (document.activeElement === final || !dentro)) {
                e.preventDefault();
                primero.focus();
            }
        }
    }

    boton.addEventListener('click', empezar);
    window.addEventListener('resize', function () { ultimo = ''; });

    // #guia en la dirección: empieza sola cuando la página ya se dibujó
    if (location.hash === '#guia') {
        window.addEventListener('load', function () { setTimeout(empezar, 300); });
    }
})();
