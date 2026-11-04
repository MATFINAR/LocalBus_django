// habilitacion.js - Botones Inhabilitar / Habilitar de rutas, conductores y buses.
// Nada se borra: el registro se marca como inhabilitado y su historial se conserva.
// Cada botón .hab-boton lleva data-url, data-que ("la ruta"), data-nombre y data-habilitado (1 o 0).
// Usa el modal #deleteModal de la página (se cierra con su closeDeleteModal()).
(function () {
    function abrir(boton) {
        const modal = document.getElementById('deleteModal');
        if (!modal) return;
        const habilitado = boton.dataset.habilitado === '1';
        const que = boton.dataset.que || '';
        const accion = habilitado ? 'Inhabilitar' : 'Habilitar';

        document.getElementById('habTitulo').textContent = (habilitado ? '🚫 ' : '✅ ') + accion + ' ' + que.split(' ').pop();

        const texto = document.getElementById('habTexto');
        texto.textContent = '¿' + (habilitado ? 'Inhabilitar ' : 'Volver a habilitar ') + que + ' ';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre || '';
        texto.append(nombre, '?');

        document.getElementById('habNota').textContent = habilitado
            ? (modal.dataset.efecto || '') + ' Su historial se conserva y puedes volver a habilitarlo cuando quieras.'
            : 'Volverá a estar disponible para asignarle turnos.';

        document.getElementById('habForm').action = boton.dataset.url;
        document.getElementById('habValor').value = habilitado ? '0' : '1';
        document.getElementById('habConfirmar').textContent = (habilitado ? '🚫 ' : '✅ ') + accion;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    document.addEventListener('click', function (e) {
        const boton = e.target.closest('.hab-boton');
        if (boton) {
            e.preventDefault();
            abrir(boton);
        }
    });
})();
