// cuenta.js: eliminar la cuenta desde Mi perfil. Antes pide otra vez el correo o nombre de usuario
// y la contraseña de esa cuenta; el servidor los comprueba y, si coinciden, la borra y cierra la sesión.
(function () {
    const abrir = document.getElementById('btnEliminarCuenta');
    const form = document.getElementById('accountDeleteForm');
    if (!abrir || !form) return;

    const vista = document.getElementById('profileViewMode');
    const otros = [document.getElementById('profileEditForm'), document.getElementById('passwordChangeForm')];
    const identificador = document.getElementById('cuIdentificador');
    const contrasena = document.getElementById('cuContrasena');
    const error = document.getElementById('cuError');
    const confirmar = document.getElementById('btnConfirmarEliminar');
    const cancelar = document.getElementById('btnCancelEliminar');

    function csrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function mostrarError(texto, campo) {
        error.textContent = texto;
        error.hidden = false;
        if (campo) campo.focus();
    }

    function limpiar() {
        form.reset();
        error.hidden = true;
        error.textContent = '';
        confirmar.disabled = false;
        confirmar.textContent = 'Eliminar mi cuenta';
    }

    function volver() {
        limpiar();
        form.hidden = true;
        vista.style.display = 'block';
        abrir.focus();
    }

    abrir.addEventListener('click', function () {
        limpiar();
        vista.style.display = 'none';
        otros.forEach(function (f) { if (f) f.style.display = 'none'; });
        form.hidden = false;
        form.scrollIntoView({ block: 'start' });
        identificador.focus();
    });

    cancelar.addEventListener('click', volver);

    // Al abrir de nuevo el perfil se vuelve a ver la ficha, no este formulario
    const abrirPerfil = document.getElementById('openProfileModal');
    if (abrirPerfil) abrirPerfil.addEventListener('click', function () { limpiar(); form.hidden = true; });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!identificador.value.trim()) return mostrarError('Escribe tu correo o nombre de usuario.', identificador);
        if (!contrasena.value) return mostrarError('Escribe tu contraseña.', contrasena);

        error.hidden = true;
        confirmar.disabled = true;
        confirmar.textContent = 'Eliminando…';
        const datos = new URLSearchParams({ identificador: identificador.value.trim(), contrasena: contrasena.value });

        fetch('/perfil/eliminar_cuenta/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: datos.toString(),
        }).then(function (r) {
            return r.json().catch(function () { return {}; });
        }).then(function (d) {
            if (d.ok) {
                window.location.href = d.redirigir || '/';
                return;
            }
            confirmar.disabled = false;
            confirmar.textContent = 'Eliminar mi cuenta';
            contrasena.value = '';
            mostrarError(d.error || 'No pudimos eliminar tu cuenta. Inténtalo de nuevo.', contrasena);
        }).catch(function () {
            confirmar.disabled = false;
            confirmar.textContent = 'Eliminar mi cuenta';
            mostrarError('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.');
        });
    });
})();
