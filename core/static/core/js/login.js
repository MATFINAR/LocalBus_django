// ============================================================
// LOGIN.JS - Inicio de sesión único: usuario (pasajero) o empresa
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('loginForm');
    const usuario = document.getElementById('email');
    const clave = document.getElementById('password');
    const boton = document.getElementById('loginEnviar');
    const errorForm = document.getElementById('loginErrorForm');
    const toggle = document.getElementById('togglePassword');
    if (!form || !usuario || !clave) return;

    // ---------- Usuario o empresa: cambia textos y qué se muestra; el servidor revisa la cuenta del tipo elegido ----------
    const tipos = Array.from(form.querySelectorAll('input[name="tipo"]'));
    const subtitulo = document.getElementById('loginSubtitulo');
    const etiqueta = document.getElementById('loginEtiquetaUsuario');

    function tipoElegido() {
        const marcado = tipos.find(function (t) { return t.checked; });
        return marcado ? marcado.value : 'usuario';
    }

    function aplicarTipo(cambio) {
        const tipo = tipoElegido();
        form.classList.toggle('login--empresa', tipo === 'empresa');
        form.classList.toggle('login--usuario', tipo !== 'empresa');
        if (subtitulo && subtitulo.dataset[tipo]) subtitulo.textContent = subtitulo.dataset[tipo];
        if (etiqueta && etiqueta.dataset[tipo]) etiqueta.textContent = etiqueta.dataset[tipo];
        usuario.placeholder = tipo === 'empresa' ? usuario.dataset.placeholderEmpresa : usuario.dataset.placeholderUsuario;
        if (cambio) {
            // Un error del intento anterior era de la otra cuenta: ya no aplica
            form.querySelectorAll('.registro-error').forEach(function (el) {
                if (el.id === 'loginErrorForm') el.textContent = '';
                else el.hidden = true;
            });
            usuario.classList.remove('input-error');
            clave.classList.remove('input-error');
            // La dirección recuerda el tipo: al recargar o volver se mantiene
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('tipo', tipo);
                window.history.replaceState(null, '', url);
            } catch (e) { /* sin historial: no pasa nada */ }
        }
    }

    tipos.forEach(function (t) {
        t.addEventListener('change', function () { aplicarTipo(true); });
    });
    aplicarTipo(false);

    // Mostrar u ocultar la contraseña
    if (toggle) {
        toggle.addEventListener('click', function () {
            const visible = clave.getAttribute('type') === 'password';
            clave.setAttribute('type', visible ? 'text' : 'password');
            this.textContent = visible ? 'Ocultar' : 'Mostrar';
            this.setAttribute('aria-pressed', visible ? 'true' : 'false');
        });
    }

    // Al escribir de nuevo, se quitan los avisos anteriores
    [usuario, clave].forEach(function (campo) {
        campo.addEventListener('input', function () {
            campo.classList.remove('input-error');
            if (errorForm) errorForm.textContent = '';
        });
    });

    let enviando = false;

    function estadoBoton(texto) {
        if (!boton) return;
        if (texto) {
            boton.classList.add('loading');
            boton.textContent = texto;
            boton.setAttribute('aria-disabled', 'true');
        } else {
            boton.classList.remove('loading');
            boton.textContent = 'Iniciar sesión';
            boton.removeAttribute('aria-disabled');
        }
    }

    function fallar(e, texto, campo) {
        e.preventDefault();
        campo.classList.add('input-error');
        if (errorForm) {
            errorForm.textContent = texto;
            errorForm.focus();
        }
        campo.focus();
    }

    form.addEventListener('submit', function (e) {
        if (enviando) {
            e.preventDefault();
            return;
        }
        if (errorForm) errorForm.textContent = '';
        if (usuario.value.trim() === '') {
            return fallar(e, tipoElegido() === 'empresa' ? usuario.dataset.vacioEmpresa : usuario.dataset.vacioUsuario, usuario);
        }
        if (clave.value === '') {
            return fallar(e, 'Escribe tu contraseña.', clave);
        }
        // El botón avisa que está entrando y evita un segundo envío (cada intento fallido cuenta para el bloqueo)
        enviando = true;
        estadoBoton('Ingresando…');
    });

    // Si se vuelve a esta página con el botón del navegador, el botón no debe quedar "ingresando"
    window.addEventListener('pageshow', function () {
        enviando = false;
        estadoBoton(null);
    });

    // Si el servidor devolvió un error, el foco va a la contraseña (el usuario ya viene escrito)
    if (document.querySelector('.registro-error[role="alert"]:not(:empty):not(#loginErrorForm)')) {
        clave.focus();
    }
});
