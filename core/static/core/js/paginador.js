// ============================================================
// PAGINADOR.JS - Paginador de las listas (alertas, rutas, buses, conductores y turnos).
// Se carga desde base.html y lo usa cada página así:
//
//   const paginador = LocalBusPaginador.crear({
//       clave: 'buses',                        // recuerda cuántos registros eligió el usuario en esta lista
//       despuesDe: document.querySelector('.bu-tabla-caja'),   // el paginador se pone justo debajo
//       elementos: function () { return filas; },              // filas o tarjetas, en el orden en que se ven
//       nombres: ['bus', 'buses']
//   });
//   paginador.actualizar();        // después de filtrar u ordenar (vuelve a la página 1)
//
// Los filtros de cada página siguen usando el atributo `hidden` para decir qué filas coinciden; el paginador
// no lo toca (el mapa, la matriz y las gráficas siguen leyéndolo) y solo marca con la clase `pag-fuera` las
// que quedan en otra página.
// ============================================================
(function () {
    'use strict';

    const TAMANOS = [5, 10, 25, 50];   // el mínimo son 5; además existe "Todos" (sin paginar)
    const PREDETERMINADO = 10;

    function leerTamano(clave) {
        let guardado = null;
        try { guardado = localStorage.getItem('localbus-pag-' + clave); } catch (e) { /* sin almacenamiento */ }
        if (guardado === 'todos') return 'todos';
        const n = parseInt(guardado, 10);
        return TAMANOS.indexOf(n) !== -1 ? n : PREDETERMINADO;
    }

    function guardarTamano(clave, tamano) {
        try { localStorage.setItem('localbus-pag-' + clave, String(tamano)); } catch (e) { /* sin almacenamiento */ }
    }

    function crearEl(etiqueta, clase, texto) {
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    // Números que se ven: la primera, la última y las vecinas de la actual; lo demás, "…"
    function numerosVisibles(actual, total) {
        const lista = [];
        for (let p = 1; p <= total; p++) {
            if (p === 1 || p === total || Math.abs(p - actual) <= 1) lista.push(p);
            else if (lista[lista.length - 1] !== '…') lista.push('…');
        }
        return lista;
    }

    let contador = 0;

    function crear(opciones) {
        const sitio = opciones.despuesDe;
        // Sin dónde ponerlo no hay nada que paginar: una versión vacía evita revisar cada llamada
        if (!sitio) return { actualizar: function () {}, irA: function () {} };

        const nombres = opciones.nombres || ['registro', 'registros'];
        const id = 'pag' + (++contador);
        let tamano = leerTamano(opciones.clave);
        let pagina = 1;
        let sinElementos = true;

        // ----- Estructura -----
        const pie = crearEl('div', 'pag');
        pie.hidden = true;
        const info = crearEl('p', 'pag-info');
        info.setAttribute('role', 'status');
        info.setAttribute('aria-live', 'polite');

        const caja = crearEl('div', 'pag-tamano');
        const etiqueta = crearEl('label', null, 'Por página');
        etiqueta.htmlFor = id + '-tamano';
        const selector = crearEl('select');
        selector.id = id + '-tamano';
        TAMANOS.concat(['todos']).forEach(function (t) {
            const o = crearEl('option', null, t === 'todos' ? 'Todos' : String(t));
            o.value = String(t);
            selector.appendChild(o);
        });
        selector.value = String(tamano);
        caja.append(etiqueta, selector);

        const nav = crearEl('nav', 'pag-nav');
        nav.setAttribute('aria-label', 'Páginas de ' + nombres[1]);

        pie.append(info, caja, nav);
        sitio.insertAdjacentElement('afterend', pie);

        // El paginador acompaña a su lista: si la página oculta la lista (otra vista), él también se oculta
        function sincronizarVisibilidad() { pie.hidden = sitio.hidden || sinElementos; }
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(sincronizarVisibilidad).observe(sitio, { attributes: true, attributeFilter: ['hidden'] });
        }

        // ----- Navegación -----
        function boton(texto, etiquetaAria, destino, foco) {
            const b = crearEl('button', 'pag-boton', texto);
            b.type = 'button';
            b.setAttribute('aria-label', etiquetaAria);
            b.dataset.foco = foco;
            b.addEventListener('click', function () { irA(destino, foco); });
            return b;
        }

        function dibujarNav(paginas, foco) {
            nav.textContent = '';
            nav.hidden = paginas <= 1;
            if (paginas <= 1) return;
            const ant = boton('Anterior', 'Página anterior', pagina - 1, 'ant');
            ant.disabled = pagina === 1;
            nav.appendChild(ant);
            numerosVisibles(pagina, paginas).forEach(function (n) {
                if (n === '…') {
                    const p = crearEl('span', 'pag-puntos', '…');
                    p.setAttribute('aria-hidden', 'true');
                    nav.appendChild(p);
                    return;
                }
                const b = boton(String(n), 'Página ' + n, n, 'p' + n);
                if (n === pagina) b.setAttribute('aria-current', 'page');
                nav.appendChild(b);
            });
            const sig = boton('Siguiente', 'Página siguiente', pagina + 1, 'sig');
            sig.disabled = pagina === paginas;
            nav.appendChild(sig);

            // Quien navegó con el teclado sigue en el mismo botón (si ya no se puede usar, en la página actual)
            if (foco) {
                let destino = nav.querySelector('[data-foco="' + foco + '"]');
                if (!destino || destino.disabled) destino = nav.querySelector('[aria-current="page"]');
                if (destino) destino.focus();
            }
        }

        // ----- Actualizar -----
        // reiniciar (por defecto sí): vuelve a la página 1, como al cambiar un filtro o el orden
        function actualizar(reiniciar, foco) {
            const todos = opciones.elementos();
            const coinciden = todos.filter(function (e) { return !e.hidden; });
            const total = coinciden.length;
            const porPagina = tamano === 'todos' ? Math.max(total, 1) : tamano;
            const paginas = Math.max(1, Math.ceil(total / porPagina));
            pagina = reiniciar === false ? Math.min(Math.max(pagina, 1), paginas) : 1;
            const desde = (pagina - 1) * porPagina;
            const hasta = desde + porPagina;

            let i = 0;
            todos.forEach(function (e) {
                if (e.hidden) { e.classList.remove('pag-fuera'); return; }
                e.classList.toggle('pag-fuera', i < desde || i >= hasta);
                i++;
            });

            sinElementos = total === 0;
            if (paginas === 1) {
                info.textContent = total === 1 ? '1 ' + nombres[0] : total + ' ' + nombres[1];
            } else {
                info.textContent = 'Mostrando ' + (desde + 1) + '–' + Math.min(hasta, total) + ' de ' + total + ' ' + nombres[1];
            }
            dibujarNav(paginas, foco);
            sincronizarVisibilidad();
            if (typeof opciones.alCambiar === 'function') opciones.alCambiar();
        }

        function irA(destino, foco) {
            pagina = destino;
            actualizar(false, foco);
            // Si la lista quedó más arriba de lo que se ve, se vuelve a su inicio para leer la página nueva
            if (sitio.getBoundingClientRect().top < 0) sitio.scrollIntoView({ block: 'start' });
        }

        selector.addEventListener('change', function () {
            tamano = selector.value === 'todos' ? 'todos' : parseInt(selector.value, 10);
            guardarTamano(opciones.clave, tamano);
            actualizar(true);
        });

        actualizar(true);
        return { actualizar: actualizar, irA: irA };
    }

    window.LocalBusPaginador = { crear: crear };
})();
