// ============================================================
// MENSAJES.JS - Chat de la empresa con sus conductores: lista (búsqueda y filtros), conversación (enviar sin
// recargar y traer lo nuevo cada pocos segundos) y la ventana "Mensaje a un grupo" (vista previa de quiénes
// lo recibirán). Sin JavaScript todo sigue funcionando con formularios normales.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni confirm(); los errores salen junto al campo.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const raiz = document.getElementById('mensajes');
    if (!raiz) return;
    const idConductor = raiz.dataset.conductor || '';
    let ultimoId = Number(raiz.dataset.ultimo || 0);
    const CADA_MS = 8000;

    function csrf(form) {
        const campo = form.querySelector('[name=csrfmiddlewaretoken]');
        return campo ? campo.value : '';
    }

    function crear(etiqueta, clase, texto) {
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    // ---------- Lista: búsqueda y filtros ----------
    const items = Array.from(document.querySelectorAll('.me-conv-item'));
    const buscar = document.getElementById('meBuscar');
    const filtros = Array.from(document.querySelectorAll('.me-filtro'));
    const listaVacia = document.getElementById('meListaVacia');
    let filtro = 'todos';

    function aplicarLista() {
        const q = (buscar ? buscar.value : '').trim().toLowerCase();
        let visibles = 0;
        items.forEach(function (li) {
            const pasa = (!q || li.dataset.nombre.indexOf(q) !== -1)
                && (filtro !== 'sin_leer' || Number(li.dataset.sinLeer) > 0)
                && (filtro !== 'en_turno' || li.dataset.enTurno === '1');
            li.hidden = !pasa;
            if (pasa) visibles++;
        });
        if (listaVacia) {
            listaVacia.textContent = filtro === 'sin_leer' && !q ? 'No tienes mensajes sin leer.'
                : filtro === 'en_turno' && !q ? 'Ningún conductor está en turno ahora.' : 'Ningún conductor coincide.';
            listaVacia.hidden = visibles > 0;
        }
    }
    if (buscar) buscar.addEventListener('input', aplicarLista);
    filtros.forEach(function (b) {
        b.addEventListener('click', function () {
            filtro = b.dataset.filtro;
            filtros.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            aplicarLista();
        });
    });

    function ponerSinLeer(mapa) {
        let total = 0;
        items.forEach(function (li) {
            const n = Number(mapa[li.dataset.id] || 0);
            total += n;
            li.dataset.sinLeer = n;
            const insignia = li.querySelector('[data-sin-leer-de]');
            if (insignia) {
                insignia.hidden = !n;
                insignia.firstChild.nodeValue = String(n);
            }
        });
        const filtroSinLeer = document.querySelector('.me-filtro[data-filtro="sin_leer"]');
        if (filtroSinLeer) filtroSinLeer.textContent = 'Sin leer' + (total ? ' (' + total + ')' : '');
        const nav = document.getElementById('navMensajesSinLeer');
        if (nav) {
            nav.firstChild.nodeValue = String(total);
            nav.hidden = !total;
        }
        if (filtro === 'sin_leer') aplicarLista();
    }

    // ---------- Conversación ----------
    const hilo = document.getElementById('meHilo');
    const form = document.getElementById('meRedactar');
    const texto = document.getElementById('meTexto');
    const error = document.getElementById('meTextoError');
    const enviar = document.getElementById('meEnviar');

    function alFinal() {
        if (hilo) hilo.scrollTop = hilo.scrollHeight;
    }
    alFinal();

    function cercaDelFinal() {
        return !hilo || hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 120;
    }

    function pintarMensaje(m) {
        if (!hilo || hilo.querySelector('[data-id="' + m.id + '"]')) return;
        const vacio = document.getElementById('meHiloVacio');
        if (vacio) vacio.remove();
        const li = crear('li', 'me-msj ' + (m.de_empresa ? 'me-msj--empresa' : 'me-msj--conductor'));
        li.dataset.id = m.id;
        if (m.grupo) li.appendChild(crear('span', 'me-msj-grupo', 'Para: ' + m.grupo));
        li.appendChild(crear('span', 'me-msj-texto', m.texto));   // textContent: nada de HTML del mensaje
        const meta = crear('span', 'me-msj-meta', m.hora + (m.de_empresa ? ' · ' + (m.leido ? 'Leído' : 'Enviado') : ''));
        li.appendChild(meta);
        hilo.appendChild(li);
        ultimoId = Math.max(ultimoId, m.id);
    }

    function marcarLeidos(hasta) {
        if (!hilo || !hasta) return;
        hilo.querySelectorAll('.me-msj--empresa').forEach(function (li) {
            if (Number(li.dataset.id) <= hasta) {
                const meta = li.querySelector('.me-msj-meta');
                const ultimo = meta.lastChild;
                if (ultimo && ultimo.nodeType === 3 && /Enviado$/.test(ultimo.nodeValue)) {
                    ultimo.nodeValue = ultimo.nodeValue.replace(/Enviado$/, 'Leído');
                }
            }
        });
    }

    function mostrarError(mensaje) {
        if (!error) return;
        error.textContent = mensaje;
        error.hidden = !mensaje;
    }

    function ajustarAlto() {
        texto.style.height = 'auto';
        texto.style.height = Math.min(texto.scrollHeight, 160) + 'px';
    }

    if (form && texto) {
        texto.addEventListener('input', function () { ajustarAlto(); mostrarError(''); });
        texto.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });

        let enviando = false;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (enviando) return;
            const valor = texto.value.trim();
            if (!valor) { mostrarError('Escribe el mensaje antes de enviarlo.'); texto.focus(); return; }
            enviando = true;
            enviar.setAttribute('aria-disabled', 'true');
            enviar.textContent = 'Enviando…';
            const datos = new FormData(form);
            fetch(form.action, { method: 'POST', body: datos, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
                .then(function (r) { return r.json().then(function (j) { return [r.ok, j]; }); })
                .then(function (res) {
                    if (!res[0]) { mostrarError(res[1].error || 'No se pudo enviar. Inténtalo de nuevo.'); return; }
                    pintarMensaje(res[1].mensaje);
                    texto.value = '';
                    ajustarAlto();
                    alFinal();
                })
                .catch(function () { mostrarError('No se pudo enviar: revisa tu conexión e inténtalo de nuevo. El texto sigue aquí.'); })
                .finally(function () {
                    enviando = false;
                    enviar.removeAttribute('aria-disabled');
                    enviar.textContent = 'Enviar';
                    texto.focus();
                });
        });
        if (window.matchMedia('(min-width: 861px)').matches) texto.focus();
    }

    // ---------- Traer lo nuevo cada pocos segundos (solo con la pestaña visible) ----------
    let temporizador = null;
    function consultar() {
        const url = '/mensajes/' + (idConductor || '0') + '/nuevos/?desde=' + ultimoId;
        fetch(url, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (!j) return;
                const abajo = cercaDelFinal();
                (j.mensajes || []).forEach(pintarMensaje);
                marcarLeidos(j.leidos_hasta);
                if (abajo && (j.mensajes || []).length) alFinal();
                ponerSinLeer(j.sin_leer || {});
            })
            .catch(function () { /* sin conexión: se reintenta en la próxima vuelta */ })
            .finally(programar);
    }
    function programar() {
        clearTimeout(temporizador);
        if (!document.hidden) temporizador = setTimeout(consultar, CADA_MS);
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimeout(temporizador); else consultar();
    });
    programar();

    // ---------- Mensaje a un grupo ----------
    const modal = document.getElementById('meGrupo');
    const formGrupo = document.getElementById('meGrupoForm');
    if (!modal || !formGrupo) return;
    const camposRuta = document.getElementById('meCamposRuta');
    const campoFecha = document.getElementById('meCampoFecha');
    const ruta = document.getElementById('meRuta');
    const fecha = document.getElementById('meFecha');
    const textoGrupo = document.getElementById('meGrupoTexto');
    const contador = document.getElementById('meGrupoContador');
    const destinatarios = document.getElementById('meDestinatarios');
    const errorGrupo = document.getElementById('meGrupoError');
    const enviarGrupo = document.getElementById('meGrupoEnviar');
    const maximo = Number(textoGrupo.getAttribute('maxlength'));
    let focoPrevio = null;
    let totalGrupo = null;
    let consulta = 0;

    function grupo() {
        const marcado = formGrupo.querySelector('[name=grupo]:checked');
        return marcado ? marcado.value : '';
    }

    function errorDeGrupo(mensaje, campo) {
        errorGrupo.textContent = mensaje;
        errorGrupo.hidden = !mensaje;
        if (mensaje && campo) campo.focus();
    }

    function vistaPrevia() {
        const g = grupo();
        const conRuta = g === 'ruta_ahora' || g === 'ruta_dia';
        camposRuta.hidden = !conRuta;
        campoFecha.hidden = g !== 'ruta_dia';
        totalGrupo = null;
        if (conRuta && !ruta.value) { destinatarios.textContent = 'Elige la ruta para ver quiénes lo recibirán.'; return; }
        if (g === 'ruta_dia' && !fecha.value) { destinatarios.textContent = 'Elige el día.'; return; }
        const params = new URLSearchParams({ grupo: g, ruta: ruta.value, fecha: fecha.value });
        const esta = ++consulta;
        destinatarios.textContent = 'Buscando conductores…';
        fetch('/mensajes/destinatarios/?' + params, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (esta !== consulta) return;   // llegó tarde: ya se eligió otra cosa
                if (j.error) { destinatarios.textContent = j.error; return; }
                totalGrupo = j.total;
                destinatarios.classList.toggle('me-destinatarios--nadie', !j.total);
                if (!j.total) { destinatarios.textContent = 'Nadie lo recibiría: no hay conductores habilitados en este grupo.'; return; }
                const nombres = j.nombres.slice(0, 6).join(', ') + (j.total > 6 ? ' y ' + (j.total - 6) + ' más' : '');
                destinatarios.textContent = 'Lo recibirán ' + j.total + ' conductor' + (j.total !== 1 ? 'es' : '') + ': ' + nombres + '.';
            })
            .catch(function () { if (esta === consulta) destinatarios.textContent = 'No se pudo calcular el grupo; se calculará al enviar.'; });
    }

    formGrupo.addEventListener('change', function (e) {
        if (e.target.name === 'grupo' || e.target === ruta || e.target === fecha) { errorDeGrupo(''); vistaPrevia(); }
    });
    textoGrupo.addEventListener('input', function () {
        contador.textContent = textoGrupo.value.length + ' de ' + maximo + ' caracteres';
        errorDeGrupo('');
    });

    function abrirGrupo() {
        focoPrevio = document.activeElement;
        if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
        vistaPrevia();
        formGrupo.querySelector('[name=grupo]:checked').focus();
    }
    function cerrarGrupo() {
        if (modal.open) modal.close(); else modal.removeAttribute('open');
    }
    modal.addEventListener('close', function () {
        if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
    });
    document.getElementById('btnGrupo').addEventListener('click', abrirGrupo);
    modal.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrarGrupo); });
    modal.addEventListener('click', function (e) { if (e.target === modal) cerrarGrupo(); });

    let enviandoGrupo = false;
    formGrupo.addEventListener('submit', function (e) {
        const g = grupo();
        if (enviandoGrupo) { e.preventDefault(); return; }
        if ((g === 'ruta_ahora' || g === 'ruta_dia') && !ruta.value) { e.preventDefault(); errorDeGrupo('Elige la ruta.', ruta); return; }
        if (g === 'ruta_dia' && !fecha.value) { e.preventDefault(); errorDeGrupo('Elige el día.', fecha); return; }
        if (!textoGrupo.value.trim()) { e.preventDefault(); errorDeGrupo('Escribe el mensaje antes de enviarlo.', textoGrupo); return; }
        if (totalGrupo === 0) { e.preventDefault(); errorDeGrupo('Nadie recibiría este mensaje. Elige otro grupo.'); return; }
        enviandoGrupo = true;
        enviarGrupo.setAttribute('aria-disabled', 'true');
        enviarGrupo.textContent = 'Enviando…';
    });
    window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        enviandoGrupo = false;
        enviarGrupo.removeAttribute('aria-disabled');
        enviarGrupo.textContent = 'Enviar';
    });
});
