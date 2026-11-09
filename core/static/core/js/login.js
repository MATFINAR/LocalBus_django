// ============================================================
// LOGIN.JS - Inicio de sesión de usuarios
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('loginForm');
    const usuario = document.getElementById('email');
    const clave = document.getElementById('password');
    const boton = document.getElementById('loginEnviar');
    const errorForm = document.getElementById('loginErrorForm');
    const toggle = document.getElementById('togglePassword');
    if (!form || !usuario || !clave) return;

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
            return fallar(e, 'Escribe tu usuario o tu correo.', usuario);
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
