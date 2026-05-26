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