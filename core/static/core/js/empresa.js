// ============================================================
// EMPRESA.JS - Modal "Mi empresa": igual que el de perfil (ver / editar / contraseña), pero en vez de editar
// datos personales se carga el logo de la empresa. Se abre desde el botón del encabezado y desde el menú.
// El servidor vuelve a comprobar todo (tipo real, peso y tamaño) y convierte la imagen a PNG; aquí solo se avisa antes.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert(); los errores salen junto al campo.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const modal = document.getElementById('empresaModal');
    if (!modal) return;

    const abrirBotones = Array.from(document.querySelectorAll('#openEmpresaModal, [data-abrir-empresa]'));
    const cerrarBoton = document.getElementById('empresaClose');
    const vista = document.getElementById('empresaViewMode');
    const formLogo = document.getElementById('empresaLogoForm');
    const formClave = document.getElementById('empresaPasswordForm');
    const btnEditar = document.getElementById('btnEditEmpresa');
    const btnClave = document.getElementById('btnEmpresaPassword');
    const btnCancelarLogo = document.getElementById('btnCancelLogo');
    const btnCancelarClave = document.getElementById('btnCancelEmpresaPassword');

    const marco = document.getElementById('empresaLogoMarco');
    const img = document.getElementById('empresaLogoImg');
    const iniciales = document.getElementById('empresaLogoIniciales');
    const archivo = document.getElementById('empresaLogoArchivo');
    const nombre = document.getElementById('empresaLogoNombre');
    const error = document.getElementById('empresaLogoError');
    const guardar = document.getElementById('empresaLogoGuardar');
    const quitar = document.getElementById('empresaLogoQuitar');

    const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
    const MAX_BYTES = 2 * 1024 * 1024;   // el mismo límite que el servidor
    const original = { src: img.getAttribute('src'), oculto: img.hidden, alt: img.alt };
    let urlPrevia = null;
    let focoPrevio = null;

    // ---------- Abrir y cerrar ----------
    function mostrar(modo) {
        vista.style.display = modo === 'vista' ? 'block' : 'none';
        formLogo.style.display = modo === 'logo' ? 'block' : 'none';
        formClave.style.display = modo === 'clave' ? 'block' : 'none';
    }

    function abrir() {
        focoPrevio = document.activeElement;
        restaurarLogo();
        mostrar('vista');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        cerrarBoton.focus();
    }

    function cerrar() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        restaurarLogo();
        if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
    }

    abrirBotones.forEach(function (b) {
        b.addEventListener('click', function (e) { e.preventDefault(); abrir(); });
    });
    cerrarBoton.addEventListener('click', cerrar);
    modal.addEventListener('click', function (e) { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) cerrar();
    });

    // ---------- Logo: vista previa antes de guardar ----------
    function mostrarError(texto) {
        error.textContent = texto;
        error.hidden = !texto;
    }

    function restaurarLogo() {
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        urlPrevia = null;
        archivo.value = '';
        img.setAttribute('src', original.src || '');
        img.hidden = original.oculto;
        img.alt = original.alt;
        if (iniciales) iniciales.hidden = !original.oculto;
        marco.classList.remove('em-logo--nuevo');
        nombre.hidden = true;
        mostrarError('');
    }

    archivo.addEventListener('change', function () {
        mostrarError('');
        const elegido = archivo.files && archivo.files[0];
        if (!elegido) { restaurarLogo(); return; }
        if (TIPOS.indexOf(elegido.type) === -1) {
            restaurarLogo();
            mostrarError('El logo debe ser una imagen PNG, JPG o WEBP.');
            return;
        }
        if (elegido.size > MAX_BYTES) {
            restaurarLogo();
            mostrarError('La imagen pesa más de 2 MB. Elige una más liviana o redúcela.');
            return;
        }
        // Vista previa en el círculo grande de arriba: se ve como quedará antes de guardar
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        urlPrevia = URL.createObjectURL(elegido);
        img.src = urlPrevia;
        img.alt = 'Vista previa del logo nuevo';
        img.hidden = false;
        if (iniciales) iniciales.hidden = true;
        marco.classList.add('em-logo--nuevo');
        nombre.textContent = 'Vista previa: ' + elegido.name + '. Aún no se ha guardado.';
        nombre.hidden = false;
    });

    btnEditar.addEventListener('click', function () {
        mostrar('logo');
        archivo.focus();
    });
    btnCancelarLogo.addEventListener('click', function () {
        restaurarLogo();
        mostrar('vista');
    });

    formLogo.addEventListener('submit', function (e) {
        // "Quitar logo" no lleva archivo: se envía tal cual
        if (e.submitter && e.submitter === quitar) return;
        if (guardar.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
        const elegido = archivo.files && archivo.files[0];
        const problema = !elegido ? 'Elige una imagen para el logo.'
            : TIPOS.indexOf(elegido.type) === -1 ? 'El logo debe ser una imagen PNG, JPG o WEBP.'
            : elegido.size > MAX_BYTES ? 'La imagen pesa más de 2 MB. Elige una más liviana o redúcela.' : '';
        if (problema) {
            e.preventDefault();
            mostrarError(problema);
            archivo.focus();
            return;
        }
        guardar.setAttribute('aria-disabled', 'true');
        guardar.textContent = 'Guardando…';
    });

    // ---------- Cambiar contraseña ----------
    btnClave.addEventListener('click', function () {
        mostrar('clave');
        document.getElementById('empresaContrasenaActual').focus();
    });
    btnCancelarClave.addEventListener('click', function () {
        formClave.reset();
        mostrar('vista');
    });
    formClave.addEventListener('submit', function (e) {
        const nueva = document.getElementById('empresaContrasenaNueva').value;
        const confirmar = document.getElementById('empresaContrasenaConfirmar').value;
        if (nueva !== confirmar) {
            e.preventDefault();
            document.getElementById('empresaContrasenaConfirmar').setCustomValidity('Las contraseñas nuevas no coinciden.');
            document.getElementById('empresaContrasenaConfirmar').reportValidity();
        }
    });
    document.getElementById('empresaContrasenaConfirmar').addEventListener('input', function () {
        this.setCustomValidity('');
    });

    // Si se vuelve con el botón del navegador, el botón no debe quedar "guardando"
    window.addEventListener('pageshow', function () {
        guardar.removeAttribute('aria-disabled');
        guardar.textContent = 'Guardar logo';
    });
});
