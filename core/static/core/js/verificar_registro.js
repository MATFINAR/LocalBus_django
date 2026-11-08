// ============================================================
// VERIFICAR_REGISTRO.JS - Código de 6 dígitos del registro
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('codigoForm');
    const codigo = document.getElementById('codigo');
    const boton = document.getElementById('codigoEnviar');
    const errorForm = document.getElementById('codigoErrorForm');
    if (!form || !codigo) return;

    // Solo números, máximo 6 (también al pegar el código desde el correo)
    codigo.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 6);
        this.classList.remove('input-error');
        if (errorForm) errorForm.textContent = '';
    });

    codigo.addEventListener('keypress', function (e) {
        const permitidas = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
                            'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (permitidas.includes(e.key) || e.ctrlKey || e.metaKey) return;
        if (!/^\d$/.test(e.key)) e.preventDefault();
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
            boton.textContent = 'Verificar y crear cuenta';
            boton.removeAttribute('aria-disabled');
        }
    }

    form.addEventListener('submit', function (e) {
        if (enviando) {
            e.preventDefault();
            return;
        }
        // No se envía hasta tener los 6 dígitos: un código incompleto gastaría uno de los 5 intentos
        if (!/^\d{6}$/.test(codigo.value)) {
            e.preventDefault();
            codigo.classList.add('input-error');
            if (errorForm) {
                errorForm.textContent = 'El código tiene 6 dígitos. Revisa tu correo y escríbelo completo.';
                errorForm.focus();
            }
            codigo.focus();
            return;
        }
        enviando = true;
        estadoBoton('Verificando…');
    });

    // Si se vuelve a esta página con el botón del navegador, el botón no debe quedar "verificando"
    window.addEventListener('pageshow', function () {
        enviando = false;
        estadoBoton(null);
    });
});
