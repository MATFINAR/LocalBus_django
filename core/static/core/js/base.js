// base.js - Control del header (abrir/cerrar con el mismo botón)
const menuFabBtn = document.getElementById('menuFabBtn');
const mainHeader = document.getElementById('mainHeader');
const headerOverlay = document.getElementById('headerOverlay');
const closeHeaderBtn = document.getElementById('closeHeaderBtn');

// Función para abrir el header
function openHeader() {
    mainHeader.classList.add('open');
    headerOverlay.classList.add('open');
    if (menuFabBtn) menuFabBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Función para cerrar el header
function closeHeader() {
    mainHeader.classList.remove('open');
    headerOverlay.classList.remove('open');
    if (menuFabBtn) menuFabBtn.classList.remove('active');
    document.body.style.overflow = '';
}

// Alternar header (abrir/cerrar con el mismo botón)
function toggleHeader() {
    if (mainHeader.classList.contains('open')) {
        closeHeader();
    } else {
        openHeader();
    }
}

// Evento del botón flotante (abre/cierra)
if (menuFabBtn) {
    menuFabBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleHeader();
    });
}

// Cerrar con el botón X
if (closeHeaderBtn) {
    closeHeaderBtn.addEventListener('click', closeHeader);
}

// Cerrar al hacer clic en el overlay
if (headerOverlay) {
    headerOverlay.addEventListener('click', closeHeader);
}

// Cerrar con tecla ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && mainHeader && mainHeader.classList.contains('open')) {
        closeHeader();
    }
});

// Reloj en tiempo real
function updateClock() {
    const clock = document.getElementById('realTimeClock');
    if (clock) {
        const now = new Date();
        clock.textContent = now.toLocaleTimeString('es-CO');
    }
}
setInterval(updateClock, 1000);
updateClock();

// Función de emergencia
function reportarEmergencia() {
    alert("🆘 Emergencia reportada. Un operador se comunicará contigo.");
}
// ================= MODAL SESIÓN =================

document.addEventListener('DOMContentLoaded', function () {

    const modal = document.getElementById('userWelcomeModal');
    const closeButton = document.getElementById('closeUserModal');
    const continueButton = document.getElementById('continueUserModal');
    const openButton = document.getElementById('openUserModal');

    function closeUserModal() {

        if (modal) {
            modal.classList.add('hidden');
        }

    }

    if (closeButton) {
        closeButton.addEventListener('click', closeUserModal);
    }

    if (continueButton) {
        continueButton.addEventListener('click', closeUserModal);
    }

    if (openButton && modal) {

        openButton.addEventListener('click', function () {

            modal.classList.remove('hidden');

        });

    }

    if (modal) {

        modal.addEventListener('click', function (event) {

            if (event.target === modal) {
                closeUserModal();
            }

        });

    }

});
// ================= MENSAJES =================

function cerrarMensaje(id) {
    const mensaje = document.getElementById(id);

    if (mensaje) {
        mensaje.classList.add('saliendo');

        setTimeout(() => {
            mensaje.remove();
        }, 400);
    }
}

// Los mensajes desaparecen automáticamente después de 5 segundos
document.addEventListener('DOMContentLoaded', function () {

    const mensajes = document.querySelectorAll('.base-message');

    mensajes.forEach(function (mensaje) {

        setTimeout(function () {
            mensaje.classList.add('saliendo');

            setTimeout(function () {
                mensaje.remove();
            }, 400);

        }, 5000);

    });

});