// login.js - Interacciones profesionales

document.addEventListener('DOMContentLoaded', function() {
    // Toggle de visibilidad de contraseña
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function() {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.textContent = type === 'password' ? '👁️' : '🙈';
        });
    }
    
    // Manejo del formulario
    const loginForm = document.getElementById('loginForm');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const submitBtn = document.querySelector('.btn-login-submit');
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const remember = document.getElementById('remember')?.checked || false;
            
            // Validación básica
            if (!email || !password) {
                showMessage('Por favor complete todos los campos', 'error');
                return;
            }
            
            if (!isValidEmail(email)) {
                showMessage('Por favor ingrese un correo electrónico válido', 'error');
                return;
            }
            
            // Estado de carga
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
            
            try {
                // Aquí iría tu llamada a la API
                // const response = await fetch('/api/login/', {
                //     method: 'POST',
                //     headers: { 'Content-Type': 'application/json' },
                //     body: JSON.stringify({ email, password, remember })
                // });
                
                // Simular petición (eliminar en producción)
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Redirigir al dashboard en caso de éxito
                // if (response.ok) {
                //     window.location.href = '/';
                // } else {
                //     const error = await response.json();
                //     showMessage(error.message || 'Credenciales incorrectas', 'error');
                // }
                
                // Demo: mostrar mensaje de éxito
                showMessage('¡Inicio de sesión exitoso! Redirigiendo...', 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
                
            } catch (error) {
                showMessage('Error de conexión. Intente nuevamente', 'error');
            } finally {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
        });
    }
    
    // Recordar último correo (si existe)
    const savedEmail = localStorage.getItem('savedEmail');
    if (savedEmail && document.getElementById('email')) {
        document.getElementById('email').value = savedEmail;
        if (document.getElementById('remember')) {
            document.getElementById('remember').checked = true;
        }
    }
    
    // Link de recuperación de contraseña
    const forgotLink = document.querySelector('.forgot-link');
    if (forgotLink) {
        forgotLink.addEventListener('click', function() {
            showMessage('Se enviará un enlace de recuperación a su correo', 'success');
            // Aquí redirigir a la página de recuperación
            // window.location.href = '/recuperar-password';
        });
    }
});

// Función para validar email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
    return emailRegex.test(email);
}

// Función para mostrar mensajes
function showMessage(message, type) {
    // Eliminar mensajes existentes
    const existingMessages = document.querySelectorAll('.error-message, .success-message');
    existingMessages.forEach(msg => msg.remove());
    
    // Crear nuevo mensaje
    const messageDiv = document.createElement('div');
    messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.textContent = message;
    
    // Insertar al inicio del formulario
    const form = document.querySelector('.login-form');
    if (form) {
        form.insertBefore(messageDiv, form.firstChild);
        
        // Auto-ocultar después de 5 segundos
        setTimeout(() => {
            messageDiv.style.opacity = '0';
            setTimeout(() => messageDiv.remove(), 300);
        }, 5000);
    }
}