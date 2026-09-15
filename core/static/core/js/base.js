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
document.addEventListener('DOMContentLoaded', function() {
    const profileModal = document.getElementById('profileModal');
    const openBtn = document.getElementById('openProfileModal');
    const closeBtn = document.getElementById('profileClose');
    const viewMode = document.getElementById('profileViewMode');
    const editForm = document.getElementById('profileEditForm');
    const passwordForm = document.getElementById('passwordChangeForm');
    const btnEdit = document.getElementById('btnEditProfile');
    const btnPassword = document.getElementById('btnChangePassword');
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    const btnCancelPassword = document.getElementById('btnCancelPassword');
    const avatarChangeBtn = document.getElementById('avatarChangeBtn');
    
    if (!profileModal || !openBtn) return;
    
    const data = window.USUARIO_DATA || { nombre: '', email: '', nickName: '', telefono: '' };
    
    // ============ ABRIR MODAL ============
    openBtn.addEventListener('click', function() {
        document.getElementById('viewNombre').textContent = data.nombre || 'No especificado';
        document.getElementById('viewEmail').textContent = data.email || 'No especificado';
        document.getElementById('viewNickName').textContent = data.nickName || 'No especificado';
        document.getElementById('viewTelefono').textContent = data.telefono || 'No especificado';
        
        document.getElementById('editNombre').value = data.nombre || '';
        document.getElementById('editEmail').value = data.email || '';
        document.getElementById('editNickName').value = data.nickName || '';
        document.getElementById('editTelefono').value = data.telefono || '';
        
        viewMode.style.display = 'block';
        editForm.style.display = 'none';
        passwordForm.style.display = 'none';
        if (avatarChangeBtn) avatarChangeBtn.style.display = 'none';
        
        profileModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
    
    function closeModal() {
        profileModal.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    closeBtn.addEventListener('click', closeModal);
    profileModal.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && profileModal.classList.contains('active')) {
            closeModal();
        }
    });
    
    // ============ EDITAR PERFIL ============
    btnEdit.addEventListener('click', function() {
        viewMode.style.display = 'none';
        editForm.style.display = 'block';
        passwordForm.style.display = 'none';
        if (avatarChangeBtn) avatarChangeBtn.style.display = 'flex';
    });
    
    btnCancelEdit.addEventListener('click', function() {
        viewMode.style.display = 'block';
        editForm.style.display = 'none';
        if (avatarChangeBtn) avatarChangeBtn.style.display = 'none';
    });
    
    // ============ CAMBIAR CONTRASEÑA ============
    btnPassword.addEventListener('click', function() {
        viewMode.style.display = 'none';
        passwordForm.style.display = 'block';
        editForm.style.display = 'none';
        if (avatarChangeBtn) avatarChangeBtn.style.display = 'none';
    });
    
    btnCancelPassword.addEventListener('click', function() {
        viewMode.style.display = 'block';
        passwordForm.style.display = 'none';
    });
    
    // ============ FOTO DE PERFIL ============
    const fotoInput = document.getElementById('editFotoPerfil');
    const fotoPreviewImg = document.getElementById('fotoPreviewImg');
    const fotoPreviewIniciales = document.getElementById('fotoPreviewIniciales');
    const fotoPreview = document.getElementById('fotoPreview');
    
    if (fotoInput) {
        fotoInput.addEventListener('change', function(e) {
            const archivo = e.target.files[0];
            if (!archivo) return;
            
            // Validar tipo
            if (!archivo.type.startsWith('image/')) {
                alert('Solo se permiten imágenes.');
                this.value = '';
                return;
            }
            
            // Validar tamaño (5MB)
            if (archivo.size > 5 * 1024 * 1024) {
                alert('La imagen no puede superar los 5MB.');
                this.value = '';
                return;
            }
            
            // Preview con FileReader
            const reader = new FileReader();
            reader.onload = function(event) {
                // Limpiar el contenedor del preview
                fotoPreview.innerHTML = '';
                const img = document.createElement('img');
                img.src = event.target.result;
                img.alt = 'Preview';
                fotoPreview.appendChild(img);
            };
            reader.readAsDataURL(archivo);
        });
    }
    
    // ============ ELIMINAR FOTO ============
    const btnRemoveFoto = document.getElementById('btnRemoveFoto');
    if (btnRemoveFoto) {
        btnRemoveFoto.addEventListener('click', function() {
            if (confirm('¿Eliminar tu foto de perfil?')) {
                document.getElementById('deleteFotoForm').submit();
            }
        });
    }
    
    // ============ VALIDACIONES ============
    const telefonoInput = document.getElementById('editTelefono');
    if (telefonoInput) {
        telefonoInput.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').slice(0, 15);
        });
    }
    
    // Toggle password
    document.querySelectorAll('.password-toggle').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                this.textContent = '🙈';
            } else {
                input.type = 'password';
                this.textContent = '👁️';
            }
        });
    });
    
    // Match password
    const nuevaPass = document.getElementById('contrasenaNueva');
    const confirmarPass = document.getElementById('contrasenaConfirmar');
    const matchFeedback = document.getElementById('passwordMatchFeedback');
    
    if (confirmarPass && matchFeedback) {
        confirmarPass.addEventListener('input', function() {
            if (this.value.length === 0) {
                matchFeedback.textContent = '';
                return;
            }
            if (this.value === nuevaPass.value) {
                matchFeedback.textContent = '✓ Las contraseñas coinciden';
                matchFeedback.style.color = '#2E7D32';
            } else {
                matchFeedback.textContent = '❌ Las contraseñas no coinciden';
                matchFeedback.style.color = '#E63946';
            }
        });
    }
});