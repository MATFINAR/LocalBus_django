// desplazamiento.js: cómo se mueve el mapa en el celular ("barra" lateral o "dos_dedos").
// La preferencia vive en <html data-desplazamiento>; el mapa escucha el evento "desplazamiento-cambiado".
(function () {
    const raiz = document.documentElement;
    const celular = window.matchMedia('(max-width: 768px) and (pointer: coarse)');

    function csrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function guardar(modo) {
        return fetch('/perfil/desplazamiento_mapa/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'modo=' + encodeURIComponent(modo),
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
                if (!r.ok || !d.ok) throw new Error(d.error || 'No pudimos guardar tu elección. Revisa tu conexión e inténtalo de nuevo.');
                return d;
            });
        });
    }

    function aplicar(modo) {
        raiz.dataset.desplazamiento = modo;
        document.querySelectorAll('input[name="desplazamiento_mapa"]').forEach(function (r) { r.checked = r.value === modo; });
        document.dispatchEvent(new CustomEvent('desplazamiento-cambiado', { detail: { modo: modo } }));
    }

    // ---------- Pregunta de la primera vez ----------
    const pregunta = document.getElementById('dzPregunta');
    if (pregunta) {
        const opciones = Array.from(pregunta.querySelectorAll('.dz-opcion'));
        const error = document.getElementById('dzError');

        function abrir() {
            if (!celular.matches || !pregunta.hidden || !pregunta.isConnected) return;
            pregunta.hidden = false;
            requestAnimationFrame(function () { pregunta.classList.add('abierto'); });
            document.body.style.overflow = 'hidden';
            opciones[0].focus();
        }

        function cerrar() {
            pregunta.classList.remove('abierto');
            document.body.style.overflow = '';
            setTimeout(function () { pregunta.remove(); }, 250);
        }

        // Tab no sale de la pregunta mientras está abierta
        pregunta.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            const i = opciones.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); opciones[opciones.length - 1].focus(); }
            else if (!e.shiftKey && i === opciones.length - 1) { e.preventDefault(); opciones[0].focus(); }
        });

        opciones.forEach(function (boton) {
            boton.addEventListener('click', function () {
                const modo = boton.dataset.modo;
                opciones.forEach(function (b) { b.disabled = true; });
                boton.classList.add('elegida');
                error.hidden = true;
                guardar(modo).then(function () {
                    aplicar(modo);
                    cerrar();
                }).catch(function (e) {
                    error.textContent = e.message;
                    error.hidden = false;
                    boton.classList.remove('elegida');
                    opciones.forEach(function (b) { b.disabled = false; });
                    boton.focus();
                });
            });
        });

        // Si se inició sesión en el computador, se pregunta la primera vez que se use el celular
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', abrir);
        else abrir();
        if (celular.addEventListener) celular.addEventListener('change', abrir);
    }

    // ---------- Ajustes en Mi perfil ----------
    const estado = document.getElementById('dzAjusteEstado');
    document.querySelectorAll('input[name="desplazamiento_mapa"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            if (!radio.checked) return;
            const anterior = raiz.dataset.desplazamiento;
            const radios = document.querySelectorAll('input[name="desplazamiento_mapa"]');
            radios.forEach(function (r) { r.disabled = true; });
            if (estado) { estado.className = 'dz-ajuste-estado'; estado.textContent = 'Guardando…'; }
            guardar(radio.value).then(function () {
                aplicar(radio.value);
                // Si cambió el ajuste antes de responder la pregunta, ya no hace falta preguntar
                if (pregunta && pregunta.isConnected) pregunta.remove();
                if (estado) { estado.className = 'dz-ajuste-estado ok'; estado.textContent = 'Guardado.'; }
            }).catch(function (e) {
                aplicar(anterior);
                if (estado) { estado.className = 'dz-ajuste-estado error'; estado.textContent = e.message; }
            }).finally(function () {
                radios.forEach(function (r) { r.disabled = false; });
            });
        });
    });
})();
