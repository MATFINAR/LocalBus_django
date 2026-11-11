// ============================================================
// PANEL.JS - Ventana "Personalizar el panel": abrir y cerrar, y subir o bajar gráficas.
// El orden que se guarda es el de las casillas marcadas en la lista; el servidor valida todo.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni confirm().
// ============================================================
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
        guardado = Array.from(lista.children).map(function (li) { return [li, li.querySelector('input').checked]; });
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
            lista.appendChild(par[0]);
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

    // ---------- Subir y bajar ----------
    function actualizarFlechas() {
        const items = Array.from(lista.children);
        items.forEach(function (li, i) {
            li.querySelector('[data-mover="-1"]').disabled = i === 0;
            li.querySelector('[data-mover="1"]').disabled = i === items.length - 1;
        });
    }

    lista.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-mover]');
        if (!boton || boton.disabled) return;
        const li = boton.closest('li');
        const paso = Number(boton.dataset.mover);
        const vecino = paso < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (!vecino) return;
        if (paso < 0) lista.insertBefore(li, vecino); else lista.insertBefore(vecino, li);
        actualizarFlechas();
        const titulo = li.querySelector('.pa-opcion-titulo').textContent;
        const posicion = Array.from(lista.children).indexOf(li) + 1;
        anuncio.textContent = titulo + ': posición ' + posicion + ' de ' + lista.children.length + '.';
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
