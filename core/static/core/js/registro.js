// ============================================================
// REGISTRO.JS - Validaciones completas del formulario
// ============================================================

// ================= FUNCIÓN GLOBAL: obtener CSRF =================
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

document.addEventListener('DOMContentLoaded', function () {

    // ==================== TOGGLE PASSWORD ====================
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const passwordInput = document.getElementById(targetId);
            if (!passwordInput) return;
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.textContent = type === 'password' ? '👁️' : '🙈';
        });
    });

    // ==================== VALIDACIÓN DE CONTRASEÑA ====================
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
        if (!strengthBar || !strengthText) return;
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

    // ==================== VALIDACIÓN DE CONFIRMACIÓN ====================
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

    // ==================== VALIDACIÓN DE EMAIL (básica) ====================
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

    // ==================== VALIDACIÓN DE EMAIL EN TIEMPO REAL ====================
    const emailFeedback = document.getElementById('emailFeedback');
    let emailDebounceTimer = null;
    let ultimoEmailVerificado = '';

    if (emailInput && emailFeedback) {
        emailInput.addEventListener('input', function () {
            const email = this.value.trim();
            clearTimeout(emailDebounceTimer);

            // Limpiar estados
            emailInput.classList.remove('input-error', 'input-success', 'input-loading');
            emailFeedback.textContent = '';
            emailFeedback.classList.remove('error', 'success');

            if (email === '') {
                ultimoEmailVerificado = '';
                return;
            }

            if (!validateEmail(email)) {
                emailInput.classList.add('input-error');
                emailFeedback.textContent = '⚠️ Ingresa un correo válido';
                emailFeedback.classList.add('error');
                ultimoEmailVerificado = '';
                return;
            }

            emailDebounceTimer = setTimeout(function () {
                if (email.toLowerCase() === ultimoEmailVerificado) return;
                ultimoEmailVerificado = email.toLowerCase();

                emailInput.classList.add('input-loading');

                const fd = new FormData();
                fd.append('email', email.toLowerCase());
                fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));

                fetch('/verificar_email/', {
                    method: 'POST',
                    body: fd,
                    headers: { 'X-CSRFToken': getCookie('csrftoken') }
                })
                .then(r => r.json())
                .then(data => {
                    emailInput.classList.remove('input-loading');
                    if (data.existe) {
                        emailInput.classList.add('input-error');
                        emailFeedback.textContent = '❌ Este correo ya está registrado';
                        emailFeedback.classList.add('error');
                    } else {
                        emailInput.classList.add('input-success');
                        emailFeedback.textContent = '✓ Correo disponible';
                        emailFeedback.classList.add('success');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    emailInput.classList.remove('input-loading');
                    ultimoEmailVerificado = '';
                });
            }, 500);
        });

        emailInput.addEventListener('blur', function () {
            const email = this.value.trim();
            if (email !== '' && validateEmail(email)) {
                clearTimeout(emailDebounceTimer);
                if (email.toLowerCase() === ultimoEmailVerificado) return;
                ultimoEmailVerificado = email.toLowerCase();

                const fd = new FormData();
                fd.append('email', email.toLowerCase());
                fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));

                fetch('/verificar_email/', {
                    method: 'POST',
                    body: fd,
                    headers: { 'X-CSRFToken': getCookie('csrftoken') }
                })
                .then(r => r.json())
                .then(data => {
                    if (data.existe) {
                        emailInput.classList.add('input-error');
                        emailFeedback.textContent = '❌ Este correo ya está registrado';
                        emailFeedback.classList.add('error');
                    } else {
                        emailInput.classList.add('input-success');
                        emailFeedback.textContent = '✓ Correo disponible';
                        emailFeedback.classList.add('success');
                    }
                });
            }
        });
    }

    // ==================== VALIDACIÓN DE USERNAME EN TIEMPO REAL ====================
    const usernameInput = document.getElementById('username');
    const usernameFeedback = document.getElementById('usernameFeedback');
    const usernameSuggestions = document.getElementById('usernameSuggestions');
    let usernameDebounceTimer = null;
    let ultimoUsernameVerificado = '';

    function limpiarEstadosUsername() {
        usernameInput.classList.remove('input-error', 'input-success', 'input-loading');
        usernameFeedback.textContent = '';
        usernameFeedback.classList.remove('error', 'success');
        if (usernameSuggestions) {
            usernameSuggestions.classList.remove('visible');
            usernameSuggestions.innerHTML = '';
        }
    }

    function esUsernameValido(username) {
        return /^[a-zA-Z0-9._]{3,30}$/.test(username);
    }

    function renderizarSugerencias(sugerencias) {
        if (!usernameSuggestions) return;
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
                verificarUsername(sugerencia.toLowerCase());
            });

            usernameSuggestions.appendChild(chip);
        });

        usernameSuggestions.classList.add('visible');
    }

    function verificarUsername(username) {
        if (username === ultimoUsernameVerificado) return;
        ultimoUsernameVerificado = username;

        usernameInput.classList.remove('input-error', 'input-success');
        usernameInput.classList.add('input-loading');
        usernameFeedback.textContent = '';
        usernameFeedback.classList.remove('error', 'success');

        const fd = new FormData();
        fd.append('nickname', username);
        fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));

        fetch('/verificar_nickname/', {
            method: 'POST',
            body: fd,
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        })
        .then(r => r.json())
        .then(data => {
            usernameInput.classList.remove('input-loading');

            if (data.existe) {
                usernameInput.classList.add('input-error');
                usernameFeedback.textContent = '❌ Este nombre de usuario ya está en uso';
                usernameFeedback.classList.add('error');
                if (data.sugerencias && data.sugerencias.length > 0) {
                    renderizarSugerencias(data.sugerencias);
                }
            } else {
                usernameInput.classList.add('input-success');
                usernameFeedback.textContent = '✓ Nombre de usuario disponible';
                usernameFeedback.classList.add('success');
                if (usernameSuggestions) {
                    usernameSuggestions.classList.remove('visible');
                    usernameSuggestions.innerHTML = '';
                }
            }
        })
        .catch(err => {
            console.error('Error:', err);
            usernameInput.classList.remove('input-loading');
            ultimoUsernameVerificado = '';
        });
    }

    if (usernameInput && usernameFeedback) {
        usernameInput.addEventListener('input', function () {
            const username = this.value.trim();
            clearTimeout(usernameDebounceTimer);

            if (username === '') {
                limpiarEstadosUsername();
                ultimoUsernameVerificado = '';
                return;
            }

            if (!esUsernameValido(username)) {
                limpiarEstadosUsername();
                usernameInput.classList.add('input-error');
                usernameFeedback.textContent = '⚠️ Solo letras, números, puntos y guiones (3-30 caracteres)';
                usernameFeedback.classList.add('error');
                ultimoUsernameVerificado = '';
                return;
            }

            usernameDebounceTimer = setTimeout(function () {
                verificarUsername(username.toLowerCase());
            }, 500);
        });

        usernameInput.addEventListener('blur', function () {
            const username = this.value.trim();
            if (username !== '' && esUsernameValido(username)) {
                clearTimeout(usernameDebounceTimer);
                verificarUsername(username.toLowerCase());
            }
        });
    }

    // ==================== VALIDACIÓN DE TELÉFONO ====================
    const telefonoInput = document.getElementById('telefono');
    const telefonoFeedback = document.getElementById('telefonoFeedback');
    let telefonoDebounceTimer = null;
    let ultimoTelefonoVerificado = '';

    if (telefonoInput && telefonoFeedback) {
        // Solo números
        telefonoInput.addEventListener('input', function () {
            const cursorPos = this.selectionStart;
            const valorOriginal = this.value;

            this.value = this.value.replace(/\D/g, '');

            if (valorOriginal !== this.value) {
                const diferencia = valorOriginal.length - this.value.length;
                this.setSelectionRange(cursorPos - diferencia, cursorPos - diferencia);
            }

            if (this.value.length > 15) {
                this.value = this.value.slice(0, 15);
            }

            // ====== VALIDACIÓN EN TIEMPO REAL ======
            const telefono = this.value.trim();
            clearTimeout(telefonoDebounceTimer);

            // Limpiar estados
            telefonoInput.classList.remove('input-error', 'input-success', 'input-loading');
            telefonoFeedback.textContent = '';
            telefonoFeedback.classList.remove('error', 'success');

            if (telefono === '') {
                ultimoTelefonoVerificado = '';
                return;
            }

            if (telefono.length < 7) {
                telefonoInput.classList.add('input-error');
                telefonoFeedback.textContent = '⚠️ Mínimo 7 dígitos';
                telefonoFeedback.classList.add('error');
                ultimoTelefonoVerificado = '';
                return;
            }

            telefonoDebounceTimer = setTimeout(function () {
                if (telefono === ultimoTelefonoVerificado) return;
                ultimoTelefonoVerificado = telefono;

                telefonoInput.classList.add('input-loading');

                const fd = new FormData();
                fd.append('telefono', telefono);
                fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));

                fetch('/verificar_telefono/', {
                    method: 'POST',
                    body: fd,
                    headers: { 'X-CSRFToken': getCookie('csrftoken') }
                })
                .then(r => r.json())
                .then(data => {
                    telefonoInput.classList.remove('input-loading');

                    if (data.existe) {
                        telefonoInput.classList.add('input-error');
                        telefonoFeedback.textContent = '❌ Este teléfono ya está registrado';
                        telefonoFeedback.classList.add('error');
                    } else {
                        telefonoInput.classList.add('input-success');
                        telefonoFeedback.textContent = '✓ Teléfono disponible';
                        telefonoFeedback.classList.add('success');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    telefonoInput.classList.remove('input-loading');
                    ultimoTelefonoVerificado = '';
                });
            }, 500);
        });

        // Bloquear teclas que no sean números
        telefonoInput.addEventListener('keypress', function (e) {
            const teclasPermitidas = [
                'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
                'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                'Home', 'End'
            ];
            if (teclasPermitidas.includes(e.key)) return;
            if (e.ctrlKey || e.metaKey) return;
            if (!/^\d$/.test(e.key)) e.preventDefault();
        });

        // Bloquear pegado de texto no numérico
        telefonoInput.addEventListener('paste', function (e) {
            e.preventDefault();
            const textoPegado = (e.clipboardData || window.clipboardData).getData('text');
            const soloNumeros = textoPegado.replace(/\D/g, '').slice(0, 15);

            const inicio = this.selectionStart;
            const fin = this.selectionEnd;
            const valorActual = this.value;

            this.value = valorActual.slice(0, inicio) + soloNumeros + valorActual.slice(fin);

            const nuevaPos = inicio + soloNumeros.length;
            this.setSelectionRange(nuevaPos, nuevaPos);

            this.dispatchEvent(new Event('input'));
        });

        // Verificar al perder el foco
        telefonoInput.addEventListener('blur', function () {
            const telefono = this.value.trim();
            if (telefono.length >= 7) {
                clearTimeout(telefonoDebounceTimer);
                if (telefono === ultimoTelefonoVerificado) return;
                ultimoTelefonoVerificado = telefono;

                const fd = new FormData();
                fd.append('telefono', telefono);
                fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));

                fetch('/verificar_telefono/', {
                    method: 'POST',
                    body: fd,
                    headers: { 'X-CSRFToken': getCookie('csrftoken') }
                })
                .then(r => r.json())
                .then(data => {
                    if (data.existe) {
                        telefonoInput.classList.add('input-error');
                        telefonoFeedback.textContent = '❌ Este teléfono ya está registrado';
                        telefonoFeedback.classList.add('error');
                    } else {
                        telefonoInput.classList.add('input-success');
                        telefonoFeedback.textContent = '✓ Teléfono disponible';
                        telefonoFeedback.classList.add('success');
                    }
                });
            }
        });
    }

    // ==================== VALIDACIÓN ANTES DE ENVIAR ====================
    const registroForm = document.getElementById('registroForm');

    if (registroForm) {
        registroForm.addEventListener('submit', function (e) {
            const password = document.getElementById('password').value;
            const password2 = document.getElementById('password2').value;
            const terms = document.getElementById('terms');
            const email = document.getElementById('email').value;

            // Email inválido
            if (!validateEmail(email)) {
                e.preventDefault();
                alert('Por favor, ingresa un correo electrónico válido');
                return;
            }

            // Email ya registrado
            if (emailInput && emailInput.classList.contains('input-error')) {
                e.preventDefault();
                alert('Corrige el correo electrónico antes de continuar');
                emailInput.focus();
                return;
            }

            // Username ya registrado
            if (usernameInput && usernameInput.classList.contains('input-error')) {
                e.preventDefault();
                alert('Corrige el nombre de usuario antes de continuar');
                usernameInput.focus();
                return;
            }

            // Teléfono ya registrado
            if (telefonoInput && telefonoInput.classList.contains('input-error')) {
                e.preventDefault();
                alert('Corrige el teléfono antes de continuar');
                telefonoInput.focus();
                return;
            }

            // Contraseñas
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

            // Términos
            if (!terms.checked) {
                e.preventDefault();
                alert('Debes aceptar los Términos y Condiciones');
                return;
            }
        });
    }
});