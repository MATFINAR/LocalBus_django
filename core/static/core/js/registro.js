// ================= TOGGLE PASSWORD =================
document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', function () {
        const targetId = this.getAttribute('data-target');
        const passwordInput = document.getElementById(targetId);
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.textContent = type === 'password' ? '👁️' : '🙈';
    });
});

// ================= VALIDACIÓN DE CONTRASEÑA =================
const passwordInput = document.getElementById('password');
const password2Input = document.getElementById('password2');
const strengthBar = document.querySelector('.strength-bar');
const strengthText = document.querySelector('.strength-text');

function checkPasswordStrength(password) {
    let strength = 0;

    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/\d/)) strength++;
    if (password.match(/[^a-zA-Z\d]/)) strength++;

    return strength;
}

function updateStrengthBar() {
    const password = passwordInput.value;

    if (password.length === 0) {
        strengthBar.className = 'strength-bar';
        strengthBar.style.width = '0%';
        strengthText.textContent = '';
        return;
    }

    const strength = checkPasswordStrength(password);

    switch (strength) {
        case 1:
            strengthBar.className = 'strength-bar weak';
            strengthText.textContent = '🔴 Contraseña débil';
            break;
        case 2:
            strengthBar.className = 'strength-bar medium';
            strengthText.textContent = '🟠 Contraseña media';
            break;
        case 3:
            strengthBar.className = 'strength-bar strong';
            strengthText.textContent = '🟢 Contraseña fuerte';
            break;
        case 4:
            strengthBar.className = 'strength-bar very-strong';
            strengthText.textContent = '✅ Contraseña muy fuerte';
            break;
    }
}

if (passwordInput) {
    passwordInput.addEventListener('input', updateStrengthBar);
}

// ================= VALIDACIÓN DE CONFIRMACIÓN =================
function checkPasswordsMatch() {
    if (password2Input && password2Input.value.length > 0) {
        if (passwordInput.value !== password2Input.value) {
            password2Input.setCustomValidity('Las contraseñas no coinciden');
            password2Input.style.borderColor = 'var(--rojo)';
        } else {
            password2Input.setCustomValidity('');
            password2Input.style.borderColor = 'var(--azul)';
        }
    }
}

if (password2Input) {
    password2Input.addEventListener('input', checkPasswordsMatch);
    passwordInput.addEventListener('input', checkPasswordsMatch);
}

// ================= VALIDACIÓN DE EMAIL =================
const emailInput = document.getElementById('email');

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

if (emailInput) {
    emailInput.addEventListener('change', function () {
        if (!validateEmail(this.value)) {
            this.setCustomValidity('Ingresa un correo electrónico válido');
            this.style.borderColor = 'var(--rojo)';
        } else {
            this.setCustomValidity('');
            this.style.borderColor = 'var(--azul)';
        }
    });
}

// ================= VALIDACIÓN ANTES DE ENVIAR =================
const registroForm = document.getElementById('registroForm');

if (registroForm) {
    registroForm.addEventListener('submit', function (e) {
        const password = document.getElementById('password').value;
        const password2 = document.getElementById('password2').value;
        const terms = document.getElementById('terms');
        const email = document.getElementById('email').value;

        if (!validateEmail(email)) {
            e.preventDefault();
            alert('Por favor, ingresa un correo electrónico válido');
            return;
        }

        if (password !== password2) {
            e.preventDefault();
            alert('Las contraseñas no coinciden');
            return;
        }

        if (password.length < 8) {
            e.preventDefault();
            alert('La contraseña debe tener al menos 8 caracteres');
            return;
        }

        if (!terms.checked) {
            e.preventDefault();
            alert('Debes aceptar los Términos y Condiciones');
            return;
        }
    });
}
// ================= VALIDACIÓN DE EMAIL EN TIEMPO REAL =================
document.addEventListener('DOMContentLoaded', function () {
    const emailInput = document.getElementById('email');
    const emailFeedback = document.getElementById('emailFeedback');

    if (!emailInput || !emailFeedback) return;

    let debounceTimer = null;
    let ultimoEmailVerificado = '';

    // Función para obtener el token CSRF
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    // Limpiar estados
    function limpiarEstados() {
        emailInput.classList.remove('input-error', 'input-success', 'input-loading');
        emailFeedback.textContent = '';
        emailFeedback.classList.remove('error', 'success');
    }

    // Validar formato del email
    function esEmailValido(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    // Verificar email en el servidor
    function verificarEmail(email) {
        if (email === ultimoEmailVerificado) return;
        ultimoEmailVerificado = email;

        emailInput.classList.remove('input-error', 'input-success');
        emailInput.classList.add('input-loading');
        emailFeedback.textContent = '';
        emailFeedback.classList.remove('error', 'success');

        const formData = new FormData();
        formData.append('email', email);
        formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

        fetch('/verificar_email/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
            .then(response => response.json())
            .then(data => {
                emailInput.classList.remove('input-loading');

                if (data.existe) {
                    // El email ya está registrado
                    emailInput.classList.add('input-error');
                    emailFeedback.textContent = '❌ Este correo ya está registrado';
                    emailFeedback.classList.add('error');
                } else {
                    // El email está disponible
                    emailInput.classList.add('input-success');
                    emailFeedback.textContent = '✓ Correo disponible';
                    emailFeedback.classList.add('success');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                emailInput.classList.remove('input-loading');
                ultimoEmailVerificado = '';
            });
    }

    // Evento input con debounce (espera 500ms después de dejar de escribir)
    emailInput.addEventListener('input', function () {
        const email = this.value.trim();

        clearTimeout(debounceTimer);

        if (email === '') {
            limpiarEstados();
            ultimoEmailVerificado = '';
            return;
        }

        if (!esEmailValido(email)) {
            limpiarEstados();
            emailInput.classList.add('input-error');
            emailFeedback.textContent = '⚠️ Ingresa un correo válido';
            emailFeedback.classList.add('error');
            ultimoEmailVerificado = '';
            return;
        }

        debounceTimer = setTimeout(function () {
            verificarEmail(email.toLowerCase());
        }, 500);
    });

    // Validar también al perder el foco
    emailInput.addEventListener('blur', function () {
        const email = this.value.trim();
        if (email !== '' && esEmailValido(email)) {
            clearTimeout(debounceTimer);
            verificarEmail(email.toLowerCase());
        }
    });

    // Prevenir envío si el email ya existe
    const form = emailInput.closest('form');
    if (form) {
        form.addEventListener('submit', function (e) {
            if (emailInput.classList.contains('input-error')) {
                e.preventDefault();
                emailFeedback.textContent = '❌ Corrige el correo antes de continuar';
                emailFeedback.classList.add('error');
                emailInput.focus();
                return false;
            }
        });
    }
});
// ================= VALIDACIÓN DE USERNAME EN TIEMPO REAL =================
document.addEventListener('DOMContentLoaded', function () {
    const usernameInput = document.getElementById('username');
    const usernameFeedback = document.getElementById('usernameFeedback');
    const usernameSuggestions = document.getElementById('usernameSuggestions');

    if (!usernameInput || !usernameFeedback) return;

    let debounceTimer = null;
    let ultimoUsernameVerificado = '';

    // Función para obtener el token CSRF
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    // Limpiar estados
    function limpiarEstados() {
        usernameInput.classList.remove('input-error', 'input-success', 'input-loading');
        usernameFeedback.textContent = '';
        usernameFeedback.classList.remove('error', 'success');
        usernameSuggestions.classList.remove('visible');
        usernameSuggestions.innerHTML = '';
    }

    // Validar formato del username (solo letras, números, guión bajo y punto)
    function esUsernameValido(username) {
        const regex = /^[a-zA-Z0-9._]{3,30}$/;
        return regex.test(username);
    }

    // Renderizar sugerencias
    function renderizarSugerencias(sugerencias) {
        usernameSuggestions.innerHTML = '';

        if (!sugerencias || sugerencias.length === 0) {
            usernameSuggestions.classList.remove('visible');
            return;
        }

        const label = document.createElement('div');
        label.className = 'username-suggestions-label';
        label.textContent = '💡 Estos nombres están disponibles:';
        usernameSuggestions.appendChild(label);

        sugerencias.forEach(function (sugerencia) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'suggestion-chip';
            chip.innerHTML = '<span class="chip-icon">✨</span>' + sugerencia;

            chip.addEventListener('click', function () {
                usernameInput.value = sugerencia;
                ultimoUsernameVerificado = '';
                // Verificar automáticamente al hacer clic
                verificarUsername(sugerencia.toLowerCase());
            });

            usernameSuggestions.appendChild(chip);
        });

        usernameSuggestions.classList.add('visible');
    }

    // Verificar username en el servidor
    function verificarUsername(username) {
        if (username === ultimoUsernameVerificado) return;
        ultimoUsernameVerificado = username;

        usernameInput.classList.remove('input-error', 'input-success');
        usernameInput.classList.add('input-loading');
        usernameFeedback.textContent = '';
        usernameFeedback.classList.remove('error', 'success');

        const formData = new FormData();
        formData.append('nickname', username);
        formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

        fetch('/verificar_nickname/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
            .then(response => response.json())
            .then(data => {
                usernameInput.classList.remove('input-loading');

                if (data.existe) {
                    // El username ya está registrado
                    usernameInput.classList.add('input-error');
                    usernameFeedback.textContent = '❌ Este nombre de usuario ya está en uso';
                    usernameFeedback.classList.add('error');

                    // Mostrar sugerencias si las hay
                    if (data.sugerencias && data.sugerencias.length > 0) {
                        renderizarSugerencias(data.sugerencias);
                    } else {
                        usernameSuggestions.classList.remove('visible');
                    }
                } else {
                    // El username está disponible
                    usernameInput.classList.add('input-success');
                    usernameFeedback.textContent = '✓ Nombre de usuario disponible';
                    usernameFeedback.classList.add('success');
                    usernameSuggestions.classList.remove('visible');
                    usernameSuggestions.innerHTML = '';
                }
            })
            .catch(error => {
                console.error('Error:', error);
                usernameInput.classList.remove('input-loading');
                ultimoUsernameVerificado = '';
            });
    }

    // Evento input con debounce
    usernameInput.addEventListener('input', function () {
        const username = this.value.trim();

        clearTimeout(debounceTimer);

        if (username === '') {
            limpiarEstados();
            ultimoUsernameVerificado = '';
            return;
        }

        if (!esUsernameValido(username)) {
            limpiarEstados();
            usernameInput.classList.add('input-error');
            usernameFeedback.textContent = '⚠️ Solo letras, números, puntos y guiones (3-30 caracteres)';
            usernameFeedback.classList.add('error');
            ultimoUsernameVerificado = '';
            return;
        }

        debounceTimer = setTimeout(function () {
            verificarUsername(username.toLowerCase());
        }, 500);
    });

    // Validar también al perder el foco
    usernameInput.addEventListener('blur', function () {
        const username = this.value.trim();
        if (username !== '' && esUsernameValido(username)) {
            clearTimeout(debounceTimer);
            verificarUsername(username.toLowerCase());
        }
    });

    // Prevenir envío si el username ya existe
    const form = usernameInput.closest('form');
    if (form) {
        form.addEventListener('submit', function (e) {
            if (usernameInput.classList.contains('input-error')) {
                e.preventDefault();
                usernameFeedback.textContent = '❌ Corrige el nombre de usuario antes de continuar';
                usernameFeedback.classList.add('error');
                usernameInput.focus();
                return false;
            }
        });
    }
});
// ================= VALIDACIÓN DE TELÉFONO =================
document.addEventListener('DOMContentLoaded', function () {
    const telefonoInput = document.getElementById('telefono');
    if (!telefonoInput) return;

    // 1. Bloquear cualquier caracter que no sea número al escribir
    telefonoInput.addEventListener('input', function () {
        // Guardar posición del cursor
        const cursorPos = this.selectionStart;
        const valorOriginal = this.value;

        // Solo números
        this.value = this.value.replace(/\D/g, '');

        // Ajustar posición del cursor si se borraron caracteres
        if (valorOriginal !== this.value) {
            const diferencia = valorOriginal.length - this.value.length;
            this.setSelectionRange(cursorPos - diferencia, cursorPos - diferencia);
        }

        // Límite de 15 caracteres
        if (this.value.length > 15) {
            this.value = this.value.slice(0, 15);
        }
    });

    // 2. Bloquear teclas que no sean números (backspace, delete, etc. sí se permiten)
    telefonoInput.addEventListener('keypress', function (e) {
        const teclasPermitidas = [
            'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End'
        ];

        // Permitir teclas especiales
        if (teclasPermitidas.includes(e.key)) return;

        // Permitir Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z
        if (e.ctrlKey || e.metaKey) return;

        // Bloquear cualquier cosa que no sea número
        if (!/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    });

    // 3. Bloquear pegado de texto no numérico
    telefonoInput.addEventListener('paste', function (e) {
        e.preventDefault();
        const textoPegado = (e.clipboardData || window.clipboardData).getData('text');
        const soloNumeros = textoPegado.replace(/\D/g, '').slice(0, 15);

        // Insertar solo los números en la posición del cursor
        const inicio = this.selectionStart;
        const fin = this.selectionEnd;
        const valorActual = this.value;

        this.value = valorActual.slice(0, inicio) + soloNumeros + valorActual.slice(fin);

        // Colocar cursor después del texto pegado
        const nuevaPos = inicio + soloNumeros.length;
        this.setSelectionRange(nuevaPos, nuevaPos);

        // Disparar evento input para que se actualice el estado
        this.dispatchEvent(new Event('input'));
    });

    // 4. Validación adicional: al perder el foco, verificar longitud mínima
    telefonoInput.addEventListener('blur', function () {
        const valor = this.value.trim();

        if (valor.length > 0 && valor.length < 7) {
            // Marcar como error (opcional)
            this.classList.add('input-error');
            this.classList.remove('input-success');
        } else if (valor.length >= 7) {
            this.classList.remove('input-error');
            this.classList.add('input-success');
        } else {
            this.classList.remove('input-error', 'input-success');
        }
    });
}); 