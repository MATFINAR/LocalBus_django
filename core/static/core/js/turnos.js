// ============================================================
// TURNOS.JS - Turnos del día (filtros, búsqueda, vistas y orden) y sus ventanas: programar, editar (con
// alcance de días), finalizar y eliminar. El servidor decide qué se puede hacer; aquí solo se muestra y se envía.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni confirm() ni emojis; los errores salen en la ventana.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ---------- Día: la fecha se aplica al elegirla ----------
    const fechaDia = document.getElementById('tuFecha');
    if (fechaDia) {
        fechaDia.addEventListener('change', function () {
            if (fechaDia.value) fechaDia.form.submit();
        });
    }

    // ---------- Filtros y búsqueda ----------
    const filas = Array.from(document.querySelectorAll('.tu-fila'));
    const pestanas = Array.from(document.querySelectorAll('.tu-pestana'));
    const buscador = document.getElementById('tuBuscar');
    const mensajeFiltro = document.getElementById('tuFiltroMensaje');
    const filtroRuta = document.getElementById('tuRuta');
    const filtros = { estado: 'todos', texto: '', ruta: '' };

    // Sin tildes ni mayúsculas: "ramirez" encuentra "Ramírez"
    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    filas.forEach(function (fila) { fila.dataset.buscar = normalizar(fila.dataset.buscar); });

    function filtrar() {
        let visibles = 0;
        filas.forEach(function (fila) {
            const porEstado = filtros.estado === 'todos' || fila.dataset.estado === filtros.estado;
            const porTexto = !filtros.texto || fila.dataset.buscar.includes(filtros.texto);
            const porRuta = !filtros.ruta || fila.dataset.ruta === filtros.ruta;
            fila.hidden = !(porEstado && porTexto && porRuta);
            if (!fila.hidden) visibles++;
        });
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ningún turno coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por la placa.'
                : 'No hay turnos con esos filtros este día.';
            mensajeFiltro.hidden = false;
        } else {
            mensajeFiltro.hidden = true;
        }
        if (vistaActual) dibujarVista();
    }

    pestanas.forEach(function (p) {
        p.addEventListener('click', function () {
            pestanas.forEach(function (o) {
                o.classList.toggle('activa', o === p);
                o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
            });
            filtros.estado = p.dataset.filtro;
            filtrar();
        });
    });

    if (buscador) {
        buscador.addEventListener('input', function () {
            filtros.texto = normalizar(buscador.value.trim());
            filtrar();
        });
    }
    if (filtroRuta) {
        filtroRuta.addEventListener('change', function () {
            filtros.ruta = filtroRuta.value;
            filtrar();
        });
    }

    // ---------- Ver como: tabla, fichas, por estado, por ruta, línea de tiempo o gráficas ----------
    // Tabla y Fichas usan la misma tabla (Fichas solo cambia su forma); las demás se arman con las filas
    // que dejan ver los filtros, así que filtros, buscador, filtro de ruta y orden sirven para todas.
    const seccion = document.getElementById('turnos');
    const botonesVista = Array.from(document.querySelectorAll('.tu-vista'));
    const tablaCaja = document.querySelector('.tu-tabla-caja');
    const otraVista = document.getElementById('tuOtraVista');
    function leerJson(id, porDefecto) {
        const el = document.getElementById(id);
        try { return el ? JSON.parse(el.textContent) : porDefecto; } catch (e) { return porDefecto; }
    }
    const rutasVista = leerJson('rutasVista', []);
    const diaVista = leerJson('diaVista', null);
    let vistaActual = null;   // una de VISTAS_PROPIAS; null con tabla o fichas

    const ESTADOS = [
        ['En curso', 'En curso', 'Se están cubriendo ahora'],
        ['Programado', 'Programados', 'Empiezan más tarde este día'],
        ['Finalizado', 'Finalizados', 'Ya terminaron']
    ];

    function crear(etiqueta, clase, texto) {
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    function filasVisibles() {
        return filas.filter(function (f) { return !f.hidden; });
    }

    function rutaPorId(id) {
        return rutasVista.find(function (r) { return String(r.id) === String(id); });
    }

    function codigoRuta(ruta, clase) {
        const c = crear('span', 'tu-ruta-codigo' + (clase ? ' ' + clase : ''), ruta.codigo);
        c.style.setProperty('--ruta', ruta.color);
        c.title = ruta.nombre;
        return c;
    }

    function momento(texto) {
        const t = texto ? Date.parse(texto) : NaN;
        return isNaN(t) ? null : t;
    }

    function hora(ms) {
        return new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    // "6:00 a. m. a 2:00 p. m."; si la jornada cruza el día, lo dice
    function horario(fila) {
        const ini = momento(fila.dataset.inicio);
        const fin = momento(fila.dataset.fin);
        if (ini === null) return '';
        return hora(ini) + ' a ' + (fin === null ? 'sin hora de fin' : hora(fin));
    }

    // Botones de la fila (Editar, Finalizar, Eliminar) repetidos en otra vista: pulsan el original,
    // que lleva todos los datos del turno
    function accionesDe(fila) {
        const caja = crear('span', 'tu-mini-acciones');
        fila.querySelectorAll('.tu-celda-acciones [data-accion]').forEach(function (original) {
            const b = crear('button', original.className, original.textContent.trim());
            b.type = 'button';
            b.setAttribute('aria-label', original.textContent.trim() + ' el turno de ' + fila.dataset.conductor);
            b.addEventListener('click', function () { original.click(); });
            caja.appendChild(b);
        });
        return caja;
    }

    function insigniaEstado(fila) {
        const e = fila.dataset.estado;
        const caja = crear('span', 'tu-mini-estado');
        caja.appendChild(crear('span', 'tu-insignia tu-insignia--' + normalizar(e).replace(/\s+/g, '-'), e));
        if (fila.dataset.pausa) caja.appendChild(crear('span', 'tu-insignia tu-insignia--pausa', 'En pausa'));
        return caja;
    }

    // Ficha corta de un turno: conductor, bus, ruta, horario y acciones
    function miniTurno(fila, opciones) {
        const mini = crear('article', 'tu-mini');
        mini.style.setProperty('--ruta', (rutaPorId(fila.dataset.ruta) || {}).color || '');
        mini.appendChild(crear('span', 'tu-mini-nombre', fila.dataset.conductor));
        const linea = crear('span', 'tu-mini-linea');
        linea.appendChild(crear('span', 'tu-placa tu-placa--chica', fila.dataset.placa));
        const ruta = rutaPorId(fila.dataset.ruta);
        if (ruta && !(opciones && opciones.sinRuta)) linea.appendChild(codigoRuta(ruta));
        mini.appendChild(linea);
        mini.appendChild(crear('span', 'tu-mini-hora', horario(fila) + (fila.dataset.fijo ? ' · fijo' : '')));
        if (opciones && opciones.conEstado) mini.appendChild(insigniaEstado(fila));
        else if (fila.dataset.pausa) mini.appendChild(crear('span', 'tu-insignia tu-insignia--pausa', 'En pausa'));
        const acciones = accionesDe(fila);
        if (acciones.children.length) mini.appendChild(acciones);
        return mini;
    }

    function notaVista(texto) {
        return crear('p', 'tu-vista-nota', texto);
    }

    // ----- Por estado: una columna por estado -----
    function vistaPorEstado(visibles) {
        const caja = crear('div', 'tu-columnas');
        ESTADOS.forEach(function (e) {
            const delEstado = visibles.filter(function (f) { return f.dataset.estado === e[0]; });
            const col = crear('section', 'tu-columna tu-columna--' + normalizar(e[0]).replace(/\s+/g, '-'));
            col.setAttribute('aria-label', e[1]);
            const cab = crear('div', 'tu-columna-cabecera');
            cab.appendChild(crear('h2', 'tu-columna-titulo', e[1]));
            cab.appendChild(crear('span', 'tu-cuenta', String(delEstado.length)));
            col.appendChild(cab);
            col.appendChild(crear('p', 'tu-columna-ayuda', e[2]));
            if (!delEstado.length) col.appendChild(crear('p', 'tu-columna-vacia', 'Ninguno'));
            delEstado.forEach(function (fila) { col.appendChild(miniTurno(fila)); });
            caja.appendChild(col);
        });
        return caja;
    }

    // ----- Por ruta: los turnos de cada ruta; las rutas en servicio sin turnos también salen -----
    function vistaPorRuta(visibles) {
        const caja = crear('div', 'tu-grupos');
        rutasVista.forEach(function (r) {
            if (filtros.ruta && filtros.ruta !== String(r.id)) return;
            const deLaRuta = visibles.filter(function (f) { return f.dataset.ruta === String(r.id); });
            // Con búsqueda o filtro de estado, solo las rutas que tienen algo que mostrar
            if (!deLaRuta.length && (filtros.texto || filtros.estado !== 'todos' || !r.en_servicio)) return;
            const sec = crear('section', 'tu-grupo');
            sec.style.setProperty('--ruta', r.color);
            const cab = crear('div', 'tu-grupo-cabecera');
            cab.appendChild(codigoRuta(r, 'tu-ruta-codigo--grande'));
            cab.appendChild(crear('h2', 'tu-grupo-titulo', r.nombre));
            const enCurso = deLaRuta.filter(function (f) { return f.dataset.estado === 'En curso'; }).length;
            cab.appendChild(crear('span', 'tu-grupo-cuenta',
                (deLaRuta.length === 1 ? '1 turno' : deLaRuta.length + ' turnos') + (enCurso ? ' · ' + enCurso + ' en curso' : '')));
            sec.appendChild(cab);
            const lista = crear('div', 'tu-grupo-turnos');
            if (!deLaRuta.length) lista.appendChild(crear('p', 'tu-sin-dato', 'Sin turnos este día: ningún bus la cubre.'));
            deLaRuta.forEach(function (fila) { lista.appendChild(miniTurno(fila, { sinRuta: true, conEstado: true })); });
            sec.appendChild(lista);
            caja.appendChild(sec);
        });
        caja.appendChild(notaVista('Las rutas en servicio sin turnos este día también salen: nadie las está cubriendo.'));
        return caja;
    }

    // ----- Línea de tiempo: una fila por bus con sus turnos sobre las 24 horas del día -----
    function vistaTiempo(visibles) {
        const fragmento = document.createDocumentFragment();
        const desde = diaVista ? Date.parse(diaVista.inicio) : null;
        const hasta = diaVista ? Date.parse(diaVista.fin) : null;
        if (!desde || !hasta) return fragmento;
        const largo = hasta - desde;
        const ahora = diaVista.ahora ? Date.parse(diaVista.ahora) : null;

        // Buses en el orden en que aparecen sus turnos (sigue el orden elegido)
        const buses = [];
        visibles.forEach(function (f) {
            if (!buses.some(function (b) { return b.id === f.dataset.bus; })) buses.push({ id: f.dataset.bus, placa: f.dataset.placa });
        });

        const caja = crear('div', 'tu-tiempo-caja');
        const tabla = crear('div', 'tu-tiempo');
        tabla.setAttribute('role', 'list');
        tabla.setAttribute('aria-label', 'Turnos del día por bus, de 12 a. m. a 12 a. m.');

        // Escala: una marca cada 3 horas
        const escala = crear('div', 'tu-tiempo-fila tu-tiempo-fila--escala');
        escala.setAttribute('aria-hidden', 'true');
        escala.appendChild(crear('span', 'tu-tiempo-bus'));
        const pistaEscala = crear('div', 'tu-tiempo-pista');
        for (let h = 0; h <= 24; h += 3) {
            const marca = crear('span', 'tu-tiempo-marca', h === 24 ? '' : hora(desde + h * 3600000).replace(':00', ''));
            marca.style.setProperty('--x', (h / 24 * 100) + '%');
            pistaEscala.appendChild(marca);
        }
        escala.appendChild(pistaEscala);
        tabla.appendChild(escala);

        const hayAhora = ahora !== null && ahora >= desde && ahora < hasta;
        buses.forEach(function (bus) {
            const fila = crear('div', 'tu-tiempo-fila');
            fila.setAttribute('role', 'listitem');
            fila.appendChild(crear('span', 'tu-tiempo-bus tu-placa tu-placa--chica', bus.placa));
            const pista = crear('div', 'tu-tiempo-pista');
            for (let h = 3; h < 24; h += 3) {
                const linea = crear('span', 'tu-tiempo-guia');
                linea.style.setProperty('--x', (h / 24 * 100) + '%');
                pista.appendChild(linea);
            }
            visibles.filter(function (f) { return f.dataset.bus === bus.id; }).forEach(function (f) {
                const ini = momento(f.dataset.inicio);
                const fin = momento(f.dataset.fin);
                if (ini === null) return;
                const a = Math.max(ini, desde);
                const b = Math.min(fin === null ? hasta : fin, hasta);
                if (b <= a) return;
                const ruta = rutaPorId(f.dataset.ruta) || {};
                const editar = f.querySelector('.tu-celda-acciones [data-accion="editar"]');
                const barra = crear(editar ? 'button' : 'span',
                    'tu-tiempo-barra tu-tiempo-barra--' + normalizar(f.dataset.estado).replace(/\s+/g, '-') + (f.dataset.pausa ? ' tu-tiempo-barra--pausa' : ''));
                if (editar) {
                    barra.type = 'button';
                    barra.addEventListener('click', function () { editar.click(); });
                }
                barra.style.setProperty('--x', ((a - desde) / largo * 100) + '%');
                barra.style.setProperty('--ancho', ((b - a) / largo * 100) + '%');
                barra.style.setProperty('--ruta', ruta.color || '');
                // Si empieza el día anterior o termina el siguiente, el borde cortado lo indica
                if (ini < desde) barra.classList.add('tu-tiempo-barra--antes');
                if (fin === null || fin > hasta) barra.classList.add('tu-tiempo-barra--despues');
                const texto = f.dataset.conductor + ' · ' + (ruta.codigo || '') + ' · ' + horario(f) + ' · ' + f.dataset.estado + (f.dataset.pausa ? ' (en pausa)' : '');
                barra.title = texto + (editar ? '. Toca para editar.' : '');
                barra.setAttribute('aria-label', 'Bus ' + bus.placa + ': ' + texto + (editar ? '. Editar' : ''));
                barra.appendChild(crear('span', 'tu-tiempo-texto', (ruta.codigo ? ruta.codigo + ' · ' : '') + f.dataset.conductor));
                pista.appendChild(barra);
            });
            if (hayAhora) {
                const linea = crear('span', 'tu-tiempo-ahora');
                linea.style.setProperty('--x', ((ahora - desde) / largo * 100) + '%');
                pista.appendChild(linea);
            }
            fila.appendChild(pista);
            tabla.appendChild(fila);
        });
        caja.appendChild(tabla);
        fragmento.appendChild(caja);
        fragmento.appendChild(notaVista('Cada fila es un bus y cada barra un turno, con el color de su ruta. Llena: en curso; con borde: programado; atenuada: finalizado; rayada: en pausa.'
            + (hayAhora ? ' La línea roja marca la hora actual.' : '') + ' Toca un turno que se puede editar para abrirlo.'));
        return fragmento;
    }

    // ----- Gráficas -----
    const SVG = 'http://www.w3.org/2000/svg';

    function bloqueGrafica(titulo, ayuda) {
        const b = crear('section', 'tu-graf');
        b.appendChild(crear('h2', 'tu-graf-titulo', titulo));
        b.appendChild(crear('p', 'tu-columna-ayuda', ayuda));
        return b;
    }

    function dona(partes, total) {
        const R = 15.9155;   // circunferencia de 100: cada punto es un 1 %
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '0 0 40 40');
        svg.setAttribute('class', 'tu-dona');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Turnos por estado: ' + partes.map(function (p) { return p[0][1] + ' ' + p[1]; }).join(', '));
        const fondo = document.createElementNS(SVG, 'circle');
        fondo.setAttribute('cx', '20'); fondo.setAttribute('cy', '20'); fondo.setAttribute('r', String(R));
        fondo.setAttribute('class', 'tu-dona-fondo');
        svg.appendChild(fondo);
        let acumulado = 0;
        partes.forEach(function (p) {
            if (!p[1] || !total) return;
            const pct = p[1] / total * 100;
            const tramo = Math.max(pct - 0.6, 0.1);
            const c = document.createElementNS(SVG, 'circle');
            c.setAttribute('cx', '20'); c.setAttribute('cy', '20'); c.setAttribute('r', String(R));
            c.setAttribute('class', 'tu-dona-arco tu-color--' + normalizar(p[0][0]).replace(/\s+/g, '-'));
            c.setAttribute('stroke-dasharray', tramo + ' ' + (100 - tramo));
            c.setAttribute('stroke-dashoffset', String(25 - acumulado));
            const t = document.createElementNS(SVG, 'title');
            t.textContent = p[0][1] + ': ' + p[1];
            c.appendChild(t);
            svg.appendChild(c);
            acumulado += pct;
        });
        const n = document.createElementNS(SVG, 'text');
        n.setAttribute('x', '20'); n.setAttribute('y', '21.5'); n.setAttribute('class', 'tu-dona-numero');
        n.textContent = String(total);
        const l = document.createElementNS(SVG, 'text');
        l.setAttribute('x', '20'); l.setAttribute('y', '26'); l.setAttribute('class', 'tu-dona-etiqueta');
        l.textContent = total === 1 ? 'turno' : 'turnos';
        svg.append(n, l);
        return svg;
    }

    // Columnas verticales: [etiqueta, valor, clase opcional, color opcional, texto de ayuda opcional]
    function columnas(datos, clase) {
        const maximo = Math.max.apply(null, datos.map(function (d) { return d[1]; }).concat([1]));
        const caja = crear('div', 'tu-columnas-graf' + (clase ? ' ' + clase : ''));
        datos.forEach(function (d) {
            const col = crear('div', 'tu-col-graf');
            if (d[4]) col.title = d[4];
            col.appendChild(crear('span', 'tu-col-valor', String(d[1])));
            const pista = crear('span', 'tu-col-pista');
            const barra = crear('span', 'tu-col-barra ' + (d[2] || ''));
            barra.style.setProperty('--alto', Math.round(d[1] / maximo * 100) + '%');
            if (d[3]) barra.style.setProperty('--ruta', d[3]);
            pista.appendChild(barra);
            col.appendChild(pista);
            col.appendChild(crear('span', 'tu-col-nombre', d[0]));
            caja.appendChild(col);
        });
        return caja;
    }

    function vistaGraficas(visibles) {
        const caja = crear('div', 'tu-graficas');

        // Dona por estado
        const estados = bloqueGrafica('Turnos por estado', 'Cómo van los turnos de este día.');
        const partes = ESTADOS.map(function (e) {
            return [e, visibles.filter(function (f) { return f.dataset.estado === e[0]; }).length];
        });
        const cuerpo = crear('div', 'tu-dona-caja');
        cuerpo.appendChild(dona(partes, visibles.length));
        const leyenda = crear('ul', 'tu-leyenda');
        partes.forEach(function (p) {
            const li = crear('li', 'tu-leyenda-item');
            li.appendChild(crear('span', 'tu-leyenda-marca tu-fondo--' + normalizar(p[0][0]).replace(/\s+/g, '-')));
            const pct = visibles.length ? Math.round(p[1] / visibles.length * 100) : 0;
            li.appendChild(crear('span', '', p[0][1] + ' · ' + p[1] + ' (' + pct + ' %)'));
            leyenda.appendChild(li);
        });
        cuerpo.appendChild(leyenda);
        estados.appendChild(cuerpo);
        caja.appendChild(estados);

        // Turnos por ruta
        const porRuta = bloqueGrafica('Turnos por ruta', 'Cuántos turnos tiene cada ruta este día. En 0, nadie la cubre.');
        if (rutasVista.length) {
            porRuta.appendChild(columnas(rutasVista.map(function (r) {
                const n = visibles.filter(function (f) { return f.dataset.ruta === String(r.id); }).length;
                return [r.codigo, n, n ? 'tu-col-barra--ruta' : '', r.color];
            })));
        } else {
            porRuta.appendChild(crear('p', 'tu-sin-dato', 'Todavía no hay rutas.'));
        }
        caja.appendChild(porRuta);

        // Buses trabajando a cada hora del día
        if (diaVista) {
            const desde = Date.parse(diaVista.inicio);
            const ahora = diaVista.ahora ? Date.parse(diaVista.ahora) : null;
            const porHora = bloqueGrafica('Buses en servicio por hora', 'Cuántos turnos están activos en algún momento de cada hora.');
            porHora.classList.add('tu-graf--ancha');
            const datos = [];
            for (let h = 0; h < 24; h++) {
                const a = desde + h * 3600000;
                const b = a + 3600000;
                const n = visibles.filter(function (f) {
                    const ini = momento(f.dataset.inicio);
                    const fin = momento(f.dataset.fin);
                    return ini !== null && ini < b && (fin === null || fin > a);
                }).length;
                const actual = ahora !== null && ahora >= a && ahora < b;
                const etiqueta = hora(a).replace(':00', '');
                datos.push([h % 3 === 0 ? etiqueta : '', n, actual ? 'tu-col-barra--ahora' : '', '',
                    etiqueta + ': ' + n + (n === 1 ? ' turno' : ' turnos') + (actual ? ' (hora actual)' : '')]);
            }
            porHora.appendChild(columnas(datos, 'tu-columnas-graf--horas'));
            caja.appendChild(porHora);
        }

        const fragmento = document.createDocumentFragment();
        fragmento.appendChild(caja);
        fragmento.appendChild(notaVista('Las gráficas siguen los filtros y la búsqueda de arriba. Pasa el cursor por la dona o por una columna para ver cada cifra.'));
        return fragmento;
    }

    const VISTAS_PROPIAS = {
        estado: vistaPorEstado, ruta: vistaPorRuta, tiempo: vistaTiempo, graficas: vistaGraficas
    };

    function dibujarVista() {
        const visibles = filasVisibles();
        otraVista.textContent = '';
        if (!visibles.length) return;   // el mensaje de los filtros ya lo dice
        otraVista.appendChild(VISTAS_PROPIAS[vistaActual](visibles));
    }

    // En "Por estado" las columnas ya separan los estados: el filtro de estado queda en "Todos" y bloqueado
    const AVISO_ESTADO = 'En la vista Por estado se ven todos los estados, uno por columna.';
    function bloquearFiltroEstado(bloquear) {
        if (bloquear && filtros.estado !== 'todos') {
            pestanas.forEach(function (p) {
                p.classList.toggle('activa', p.dataset.filtro === 'todos');
                p.setAttribute('aria-pressed', p.dataset.filtro === 'todos' ? 'true' : 'false');
            });
            filtros.estado = 'todos';
            filtrar();
        }
        pestanas.forEach(function (p) {
            p.disabled = bloquear;
            if (bloquear) p.title = AVISO_ESTADO;
            else p.removeAttribute('title');
        });
    }

    function cambiarVista(vista) {
        bloquearFiltroEstado(vista === 'estado');
        botonesVista.forEach(function (b) {
            b.classList.toggle('activa', b.dataset.vista === vista);
            b.setAttribute('aria-pressed', b.dataset.vista === vista ? 'true' : 'false');
        });
        seccion.classList.toggle('tu--fichas', vista === 'fichas');
        const propia = Object.prototype.hasOwnProperty.call(VISTAS_PROPIAS, vista);
        vistaActual = propia ? vista : null;
        if (tablaCaja) tablaCaja.hidden = propia;
        otraVista.hidden = !propia;
        if (propia) dibujarVista();
        else otraVista.textContent = '';
        try { localStorage.setItem('localbus-turnos-vista', vista); } catch (e) { /* sin almacenamiento */ }
    }

    botonesVista.forEach(function (b) {
        b.addEventListener('click', function () { cambiarVista(b.dataset.vista); });
    });

    // ----- Orden: sirve para todas las vistas -----
    const selectorOrden = document.getElementById('tuOrden');
    const filasOriginal = filas.slice();
    const ORDEN_ESTADO = ESTADOS.map(function (e) { return e[0]; });
    const ORDENES = {
        lista: function () { return 0; },
        fin: function (a, b) {
            const fa = momento(a.dataset.fin);
            const fb = momento(b.dataset.fin);
            if (fa === fb) return 0;
            if (fa === null) return 1;
            if (fb === null) return -1;
            return fa - fb;
        },
        conductor: function (a, b) { return a.dataset.conductor.localeCompare(b.dataset.conductor, 'es'); },
        placa: function (a, b) { return a.dataset.placa.localeCompare(b.dataset.placa, 'es', { numeric: true }); },
        ruta: function (a, b) {
            const ra = rutaPorId(a.dataset.ruta) || { codigo: '' };
            const rb = rutaPorId(b.dataset.ruta) || { codigo: '' };
            return ra.codigo.localeCompare(rb.codigo, 'es', { numeric: true });
        },
        estado: function (a, b) { return ORDEN_ESTADO.indexOf(a.dataset.estado) - ORDEN_ESTADO.indexOf(b.dataset.estado); }
    };

    function ordenar(clave) {
        const cuerpo = filas.length ? filas[0].parentNode : null;
        if (!cuerpo) return;
        const comparar = ORDENES[clave] || ORDENES.lista;
        // Orden estable: si empatan, quedan por hora de inicio (el orden en que llegan del servidor)
        const base = filasOriginal.slice();
        if (clave !== 'lista') base.sort(function (a, b) { return comparar(a, b) || filasOriginal.indexOf(a) - filasOriginal.indexOf(b); });
        filas.splice(0, filas.length, ...base);
        filas.forEach(function (f) { cuerpo.appendChild(f); });
        if (vistaActual) dibujarVista();
        try { localStorage.setItem('localbus-turnos-orden', clave); } catch (e) { /* sin almacenamiento */ }
    }

    if (selectorOrden) {
        selectorOrden.addEventListener('change', function () { ordenar(selectorOrden.value); });
        let guardado = null;
        try { guardado = localStorage.getItem('localbus-turnos-orden'); } catch (e) { /* sin almacenamiento */ }
        if (guardado && ORDENES[guardado] && guardado !== 'lista') {
            selectorOrden.value = guardado;
            ordenar(guardado);
        }
    }

    if (botonesVista.length && otraVista) {
        let guardada = null;
        try { guardada = localStorage.getItem('localbus-turnos-vista'); } catch (e) { /* sin almacenamiento */ }
        if (botonesVista.some(function (b) { return b.dataset.vista === guardada && guardada !== 'tabla'; })) cambiarVista(guardada);
    }

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    const createModal = document.getElementById('createModal');
    const editModal = document.getElementById('editModal');
    const accionModal = document.getElementById('accionModal');
    const modales = [createModal, editModal, accionModal];
    const focoPrevio = new Map();

    function abrir(modal, foco) {
        focoPrevio.set(modal, document.activeElement);
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        if (foco) setTimeout(function () { foco.focus(); }, 30);
    }

    function cerrar(modal) {
        modal.classList.remove('abierto');
        modal.hidden = true;
        if (!document.querySelector('.tu-modal.abierto')) document.body.style.overflow = '';
        const previo = focoPrevio.get(modal);
        if (previo && document.contains(previo)) previo.focus();
    }

    modales.forEach(function (modal) {
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
        modal.querySelectorAll('[data-cerrar]').forEach(function (b) {
            b.addEventListener('click', function () { cerrar(modal); });
        });
    });

    document.addEventListener('keydown', function (e) {
        const abiertas = modales.filter(function (m) { return m.classList.contains('abierto'); });
        const arriba = abiertas[abiertas.length - 1];
        if (!arriba) return;
        if (e.key === 'Escape') {
            cerrar(arriba);
            return;
        }
        if (e.key !== 'Tab') return;
        // Mantiene el foco dentro de la ventana de arriba
        const enfocables = Array.from(arriba.querySelectorAll('button, select, input:not([type="hidden"]), a[href]'))
            .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!enfocables.length) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });

    function botonCargando(boton, texto) {
        boton.dataset.texto = boton.dataset.texto || boton.textContent;
        boton.classList.add('cargando');
        boton.textContent = texto;
        boton.setAttribute('aria-disabled', 'true');
    }

    function botonListo(boton) {
        if (!boton.dataset.texto) return;
        boton.classList.remove('cargando');
        boton.textContent = boton.dataset.texto;
        boton.removeAttribute('aria-disabled');
        delete boton.dataset.texto;
    }

    function estaCargando(boton) {
        return boton.getAttribute('aria-disabled') === 'true';
    }

    // Si se vuelve con el botón del navegador, nada debe quedar "guardando"
    window.addEventListener('pageshow', function () {
        document.querySelectorAll('.tu-boton.cargando').forEach(botonListo);
    });

    // ---------- Solo se muestran las rutas que el bus elegido puede cubrir ----------
    function prepararFiltroRutas(busSelect, rutaSelect) {
        function filtrarRutas() {
            const opcion = busSelect.options[busSelect.selectedIndex];
            const habilitadas = ((opcion && opcion.dataset.rutas) || '').split(',').filter(Boolean);

            Array.from(rutaSelect.options).forEach(function (option) {
                if (!option.value) {
                    option.textContent = busSelect.value ? 'Elige una ruta' : 'Primero elige un bus';
                    return;
                }
                if (option.dataset.temporal) return;  // opción del turno que se está editando
                option.hidden = !habilitadas.includes(option.value);
                option.disabled = option.hidden;
            });
            if (rutaSelect.selectedOptions[0] && rutaSelect.selectedOptions[0].hidden) rutaSelect.value = '';
            if (habilitadas.length === 1 && !rutaSelect.value) rutaSelect.value = habilitadas[0];
        }
        busSelect.addEventListener('change', filtrarRutas);
        filtrarRutas();
        return filtrarRutas;
    }

    // ---------- Envío sin cerrar la ventana ----------
    // Si el servidor rechaza el turno, la ventana sigue abierta con los datos, dice qué pasó y marca los campos
    // que hay que cambiar.
    function prepararEnvio(form, cajaError, botonGuardar, textoGuardando) {
        function grupoDeCampo(nombre) {
            const grupo = form.querySelector('[data-campo="' + nombre + '"]');
            if (grupo) return grupo;
            const el = form.elements[nombre];
            return el && el.closest ? el.closest('.tu-campo') : null;
        }

        function limpiarErrores() {
            cajaError.hidden = true;
            cajaError.textContent = '';
            form.querySelectorAll('.con-error').forEach(function (g) { g.classList.remove('con-error'); });
        }

        function mostrarError(mensaje, campos) {
            cajaError.textContent = mensaje;
            cajaError.hidden = false;

            let primero = null;
            (campos || []).forEach(function (nombre) {
                const grupo = grupoDeCampo(nombre);
                // Los campos ocultos (p. ej. "Hasta" con asignación fija) no se marcan
                if (!grupo || grupo.offsetParent === null) return;
                grupo.classList.add('con-error');
                primero = primero || grupo.querySelector('input, select') || grupo;
            });

            cajaError.scrollIntoView({ block: 'nearest' });
            if (primero && primero.focus) primero.focus({ preventScroll: true });
            else cajaError.focus();
        }

        // Al cambiar un campo marcado se quita su marca (el mensaje queda hasta volver a guardar)
        form.addEventListener('input', function (e) {
            const grupo = e.target.closest('.con-error');
            if (grupo) grupo.classList.remove('con-error');
        });
        form.addEventListener('change', function (e) {
            const grupo = e.target.closest('.con-error');
            if (grupo) grupo.classList.remove('con-error');
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (estaCargando(botonGuardar)) return;
            limpiarErrores();
            botonCargando(botonGuardar, textoGuardando);

            try {
                const respuesta = await fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form),
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                });
                const tipo = respuesta.headers.get('content-type') || '';
                if (!tipo.includes('application/json')) {
                    // Sesión vencida u otra página (p. ej. el login): se navega a ella
                    window.location.href = respuesta.url;
                    return;
                }
                const datos = await respuesta.json();
                if (respuesta.ok && datos.redirect) {
                    window.location.href = datos.redirect;
                    return;
                }
                botonListo(botonGuardar);
                mostrarError(datos.error || 'No se pudo guardar el turno.', datos.campos);
            } catch (error) {
                botonListo(botonGuardar);
                mostrarError('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', []);
            }
        });

        return limpiarErrores;
    }

    // ---------- Programar turnos ----------
    const fijo = document.getElementById('fijo');

    // Con asignación fija no hay fecha final, pero sí hora de fin y días de la semana
    function alternarFijo() {
        createModal.querySelectorAll('.solo-rotacion').forEach(function (el) {
            el.style.display = fijo.checked ? 'none' : '';
        });
    }

    prepararFiltroRutas(document.getElementById('bus'), document.getElementById('ruta'));
    fijo.addEventListener('change', alternarFijo);
    alternarFijo();
    const limpiarErroresCrear = prepararEnvio(document.getElementById('createForm'),
        document.getElementById('createError'), document.getElementById('createSubmit'), 'Programando…');

    document.getElementById('btnProgramar').addEventListener('click', function () {
        limpiarErroresCrear();
        abrir(createModal, document.getElementById('conductor'));
    });

    // ---------- Editar un turno ----------
    const editForm = document.getElementById('editForm');
    const campo = function (id) { return document.getElementById(id); };
    const filtrarRutasEdicion = prepararFiltroRutas(campo('edit_bus'), campo('edit_ruta'));
    const limpiarErroresEdicion = prepararEnvio(editForm, campo('editError'), campo('editSubmit'), 'Guardando…');

    // Si el valor del turno ya no está en la lista (p. ej. conductor inhabilitado) se agrega
    // una opción temporal para que el formulario muestre el valor real
    function elegir(select, valor, texto) {
        select.querySelectorAll('option[data-temporal]').forEach(function (o) { o.remove(); });
        if (!Array.from(select.options).some(function (o) { return o.value === valor; })) {
            const opcion = new Option(texto, valor);
            opcion.dataset.temporal = '1';
            select.add(opcion);
        }
        select.value = valor;
    }

    const alcanceCaja = campo('editAlcance');
    const radios = Array.from(editForm.querySelectorAll('input[name="alcance"]'));
    const fijoCheck = campo('edit_fijo');
    let actual = null;  // datos del botón del turno que se está editando

    function nota(id, texto) { campo(id).textContent = texto; }

    // Rotación: "Todos los días" cambia solo los días que aún no empiezan; los ya trabajados quedan igual
    function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
    function textoTodos(d) {
        const faltan = Number(d.pendientesTodos) || 0;
        const pasaron = Number(d.serieEmpezados) || 0;
        let texto = 'Los ' + plural(faltan, 'día que aún no empieza', 'días que aún no empiezan') + ' de esta programación.';
        if (faltan === 1) texto = 'El día que aún no empieza de esta programación.';
        if (pasaron) {
            texto += ' ' + (pasaron === 1 ? 'El día que ya empezó no cambia: es historial.'
                : 'Los ' + pasaron + ' días que ya empezaron no cambian: son historial.');
        }
        return texto;
    }

    function opcion(valor, habilitada, motivo) {
        const radio = radios.find(function (r) { return r.value === valor; });
        radio.disabled = !habilitada;
        const etiqueta = radio.closest('label');
        etiqueta.classList.toggle('deshabilitado', !habilitada);
        if (!habilitada) etiqueta.querySelector('.tu-opcion-texto span').textContent = motivo;
    }

    function mostrar(id, visible) {
        const el = campo(id);
        const caja = el.closest('.tu-campo') || el;
        caja.style.display = visible ? '' : 'none';
    }

    function alcanceElegido() {
        if (actual.soloFin === '1') return 'fin';
        const marcado = radios.find(function (r) { return r.checked; });
        return (marcado && marcado.value) || (actual.variosDias === '1' ? null : 'todos');
    }

    // Mismos campos que "Programar"; según el alcance algunos se fijan u ocultan
    function aplicarAlcance() {
        const d = actual;
        const esFijo = d.fijo === '1';
        const alcance = alcanceElegido();
        editForm.classList.toggle('tu-esperando-alcance', !alcance);
        campo('editSubmit').disabled = !alcance;
        if (!alcance) return;

        const fecha = campo('edit_fecha');
        const unDia = alcance === 'dia' || alcance === 'fin';
        const fijoEmpezado = esFijo && d.turnoEmpezo === '1';
        fecha.disabled = alcance === 'fin' || alcance === 'siguientes' || (alcance === 'dia' && esFijo)
            || (alcance === 'todos' && fijoEmpezado);
        campo('edit_fecha_label').textContent = unDia ? 'Fecha' : 'Desde';
        if (alcance === 'siguientes' || (alcance === 'dia' && esFijo)) {
            fecha.value = d.dia;            // parte del día que se está viendo
        } else if (alcance === 'todos') {
            fecha.value = esFijo ? (fijoEmpezado ? d.proximo : d.fecha) : d.serieDesde;
        } else {
            fecha.value = d.fecha;
        }

        // Un solo día no puede ser fijo, ni tener rango ni días de la semana
        mostrar('edit_fijo_grupo', !unDia);
        mostrar('edit_dias_grupo', !unDia);
        mostrar('edit_hasta', !unDia && !fijoCheck.checked);

        const aviso = campo('editAviso');
        aviso.hidden = false;
        aviso.textContent = {
            fin: 'El turno está en curso: solo puedes cambiar la hora de fin (alargarlo o acortarlo).',
            dia: esFijo ? 'Solo cambia el ' + d.diaTexto + '; el turno fijo sigue igual los demás días.'
                        : 'Solo cambia este día.',
            siguientes: 'Desde el ' + d.diaTexto + ' se reemplaza por lo que indiques aquí; los días anteriores quedan como estaban.',
            todos: d.variosDias === '1'
                ? (esFijo
                    ? (fijoEmpezado
                        ? 'Se cambian todos los días que aún no empiezan, desde el ' + d.proximoTexto + '. Los días ya trabajados no cambian: son historial.'
                        : 'Se cambia todo el turno fijo, desde que empieza.')
                    : 'Se cambian ' + textoTodos(d).charAt(0).toLowerCase() + textoTodos(d).slice(1))
                : 'Puedes cambiar todos los datos antes de que el turno empiece.',
        }[alcance];
    }
    radios.forEach(function (r) { r.addEventListener('change', aplicarAlcance); });
    fijoCheck.addEventListener('change', aplicarAlcance);

    function abrirEditar(boton) {
        const d = actual = boton.dataset;
        const soloFin = d.soloFin === '1';
        const esFijo = d.fijo === '1';

        limpiarErroresEdicion();
        botonListo(campo('editSubmit'));
        editForm.reset();
        editForm.action = d.url;
        campo('edit_dia').value = d.dia;

        elegir(campo('edit_conductor'), d.conductor, d.conductorNombre);
        elegir(campo('edit_bus'), d.bus, d.busPlaca);
        filtrarRutasEdicion();
        elegir(campo('edit_ruta'), d.ruta, d.rutaNombre);
        campo('edit_hora_inicio').value = d.horaInicio;
        campo('edit_hora_fin').value = d.horaFin;
        fijoCheck.checked = esFijo;
        campo('edit_hasta').value = esFijo ? '' : (d.serieHasta || d.fecha);
        const dias = (d.serieDias || '').split(',').filter(Boolean);
        editForm.querySelectorAll('input[name="dias"]').forEach(function (c) { c.checked = dias.includes(c.value); });

        // Turno en curso: solo se cambia la hora de fin; lo demás ya es historial
        ['edit_conductor', 'edit_bus', 'edit_ruta', 'edit_hora_inicio'].forEach(function (id) {
            campo(id).disabled = soloFin;
        });

        // Turno de varios días: primero se pregunta a qué días aplicar el cambio
        alcanceCaja.hidden = d.variosDias !== '1';
        radios.forEach(function (r) {
            r.disabled = false;
            r.closest('label').classList.remove('deshabilitado');
        });
        if (d.variosDias === '1') {
            if (esFijo) {
                const yaEmpezo = 'La jornada de este día ya empezó. Usa «Todos los días» para cambiar los que aún no empiezan.';
                nota('alcanceDiaNota', 'Solo el ' + d.diaTexto + '; los demás días siguen igual.');
                nota('alcanceSiguientesNota', 'Desde el ' + d.diaTexto + '; los días anteriores quedan como estaban.');
                // Igual que una rotación: "Todos los días" cambia los que aún no empiezan
                nota('alcanceTodosNota', d.turnoEmpezo === '1'
                    ? 'Todos los días que aún no empiezan, desde el ' + d.proximoTexto + '. Los días ya trabajados no cambian: son historial.'
                    : 'Todo el turno fijo, desde que empieza.');
                opcion('dia', d.jornadaEmpezo !== '1', yaEmpezo);
                opcion('siguientes', d.jornadaEmpezo !== '1', yaEmpezo);
                opcion('todos', d.turnoEmpezo !== '1' || !!d.proximo, 'No le quedan días por delante para cambiar.');
            } else {
                nota('alcanceDiaNota', 'Solo el turno del ' + d.diaTexto + '.');
                nota('alcanceSiguientesNota', plural(Number(d.pendientesSiguientes) || 0, 'día', 'días') + ', desde el ' + d.diaTexto + '.');
                nota('alcanceTodosNota', textoTodos(d));
            }
        }

        aplicarAlcance();
        abrir(editModal, d.variosDias === '1' ? radios.find(function (r) { return !r.disabled; }) : campo('edit_conductor').disabled ? campo('edit_hora_fin') : campo('edit_conductor'));
    }

    // ---------- Finalizar o eliminar un turno ----------
    const accionForm = document.getElementById('accionForm');
    const accionConfirmar = document.getElementById('accionConfirmar');

    function abrirAccion(boton) {
        const finalizar = boton.dataset.accion === 'finalizar';
        const fijo = boton.dataset.fijo === '1';
        document.getElementById('accionTitulo').textContent = finalizar
            ? (fijo ? 'Finalizar asignación fija' : 'Finalizar turno') : 'Eliminar turno';

        const texto = document.getElementById('accionTexto');
        texto.textContent = '';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre;
        texto.append(finalizar ? (fijo ? '¿Finalizar la asignación fija de ' : '¿Finalizar ahora el turno de ')
            : '¿Eliminar el turno programado de ', nombre,
            ' en el bus ' + boton.dataset.bus + '?');

        document.getElementById('accionNota').textContent = finalizar
            ? (fijo
                ? 'La asignación termina ahora: no tendrá más jornadas, ni hoy ni los días siguientes. Las jornadas ya trabajadas quedan en el historial.'
                : 'El turno termina ahora y queda en el historial. El conductor deja de poder usar la app con este turno.')
            : 'Aún no ha empezado, así que se borra. Esto no se puede deshacer.';

        accionForm.action = boton.dataset.url;
        botonListo(accionConfirmar);
        accionConfirmar.textContent = finalizar ? (fijo ? 'Finalizar asignación' : 'Finalizar ahora') : 'Eliminar turno';
        abrir(accionModal, accionModal.querySelector('[data-cerrar].tu-boton'));
    }

    accionForm.addEventListener('submit', function (e) {
        if (estaCargando(accionConfirmar)) { e.preventDefault(); return; }
        botonCargando(accionConfirmar, accionConfirmar.textContent === 'Eliminar turno' ? 'Eliminando…' : 'Finalizando…');
    });

    // ---------- Botones de la lista ----------
    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        if (boton.dataset.accion === 'editar') abrirEditar(boton);
        else abrirAccion(boton);
    });
});
