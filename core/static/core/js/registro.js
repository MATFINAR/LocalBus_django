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

    // ==================== FONDO EN ESCENAS (GSAP) ====================
    // Texto, rutas con buses y otro texto, unidos por cortinas e iris. Dura unos 17 s y se repite.
    // Sin GSAP o con movimiento reducido no se anima: queda la escena de rutas fija (ver CSS).
    ajustarTextosFondo();
    iniciarFondo();

    // El texto grande se acomoda en el espacio libre de arriba y de abajo de la tarjeta,
    // para que el formulario nunca lo tape. Si no hay espacio suficiente, se oculta.
    function ajustarTextosFondo() {
        const fondo = document.getElementById('registroFondo');
        const tarjeta = document.querySelector('.registro-card');
        if (!fondo || !tarjeta) return;

        function calcular() {
            const caja = fondo.getBoundingClientRect();
            const t = tarjeta.getBoundingClientRect();
            const arriba = t.top - caja.top;
            const abajo = caja.bottom - t.bottom;
            const libre = Math.min(arriba, abajo);
            // Alto de letra: cabe en el espacio libre con aire, y la frase más larga cabe a lo ancho
            const tam = Math.min(libre * 0.8, caja.width / 6.2, 176);
            if (tam < 36) {
                fondo.classList.add('sin-texto');
                return;
            }
            fondo.classList.remove('sin-texto');
            fondo.style.setProperty('--txt-size', tam + 'px');
            fondo.style.setProperty('--txt-top', Math.max(0, (arriba - tam) / 2) + 'px');
            fondo.style.setProperty('--txt-bottom', Math.max(0, (abajo - tam) / 2) + 'px');
        }

        calcular();
        window.addEventListener('resize', calcular);
        if (window.ResizeObserver) new ResizeObserver(calcular).observe(tarjeta);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(calcular);
    }

    function iniciarFondo() {
        const fondo = document.getElementById('registroFondo');
        if (!fondo || !window.gsap) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const A = document.getElementById('escTextoA');
        const B = document.getElementById('escTextoB');
        const R = document.getElementById('escRutas');
        const iris = fondo.querySelector('.iris');
        const contenedorTelones = fondo.querySelector('.telones');
        const telones = gsap.utils.toArray('.telon', fondo);
        const lineasA = A.querySelectorAll('.linea span');
        const lineasB = B.querySelectorAll('.linea span');
        const rutas = R.querySelectorAll('.fondo-ruta');
        const flujo = R.querySelectorAll('.fondo-flujo');
        const paradas = R.querySelectorAll('.fondo-parada');
        const ondas = R.querySelector('.fondo-ondas');
        const buses = Array.from(R.querySelectorAll('.fondo-bus'));

        // Cada bus avanza según un progreso de 0 a 1 sobre su ruta
        const progreso = buses.map(function () { return { v: 0 }; });
        function colocar(i) {
            const ruta = document.getElementById(buses[i].dataset.ruta);
            const punto = ruta.getPointAtLength(progreso[i].v * ruta.getTotalLength());
            buses[i].setAttribute('transform', 'translate(' + punto.x + ',' + punto.y + ')');
        }

        const salidaCortinas = telones.slice().reverse();
        const tl = gsap.timeline({ repeat: -1 });

        // Estado inicial (se reaplica en cada vuelta)
        tl.set([B, R], { autoAlpha: 0 }, 0)
          .set(A, { autoAlpha: 1 }, 0)
          .set(contenedorTelones, { visibility: 'visible' }, 0)
          .set(telones, { xPercent: -130, skewX: -14 }, 0)
          .set([lineasA, lineasB], { yPercent: 115 }, 0)
          .set(iris, { clipPath: 'circle(0% at 50% 50%)' }, 0)
          .set(rutas, { strokeDasharray: 1, strokeDashoffset: 1 }, 0)
          .set(flujo, { autoAlpha: 0 }, 0)
          .set(ondas, { autoAlpha: 0 }, 0)
          .set(paradas, { scale: 0 }, 0)
          .set(buses, { autoAlpha: 0 }, 0);

        // Escena 1: "Tu ruta / en tiempo real"
        tl.to(lineasA, { yPercent: 0, duration: 1, ease: 'power4.out', stagger: 0.15 }, 0.3)
          .to(lineasA, { yPercent: -115, duration: 0.7, ease: 'power3.in', stagger: 0.1 }, 3.6);

        // Transición 1: cortinas
        tl.to(telones, { xPercent: 0, duration: 0.8, ease: 'power3.inOut', stagger: 0.12 }, 3.9)
          .set(A, { autoAlpha: 0 }, 4.9)
          .set(R, { autoAlpha: 1 }, 4.9)
          .to(salidaCortinas, { xPercent: 130, duration: 0.8, ease: 'power3.inOut', stagger: 0.12 }, 4.9);

        // Escena 2: las rutas se dibujan, aparecen las paradas y salen los buses
        tl.to(rutas, { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut', stagger: 0.2 }, 5.6)
          .to(paradas, { scale: 1, duration: 0.5, ease: 'power2.out', stagger: 0.1 }, 6.8)
          .to(flujo, { autoAlpha: 1, duration: 0.6 }, 7.4)
          .to(ondas, { autoAlpha: 1, duration: 0.6 }, 7.6);
        buses.forEach(function (bus, i) {
            const inicio = 5.8 + i * 0.9;
            tl.set(bus, { autoAlpha: 1 }, inicio)
              .fromTo(progreso[i], { v: 0 }, {
                  v: 1, duration: 4.6 - i * 0.2, ease: 'none',
                  onUpdate: function () { colocar(i); }
              }, inicio);
        });

        // Transición 2: iris azul que se abre y se cierra
        tl.to(iris, { clipPath: 'circle(80% at 50% 50%)', duration: 0.9, ease: 'power3.inOut' }, 10.4)
          .set(R, { autoAlpha: 0 }, 11.3)
          .set(B, { autoAlpha: 1 }, 11.3)
          .to(iris, { clipPath: 'circle(0% at 50% 50%)', duration: 0.9, ease: 'power3.inOut' }, 11.3);

        // Escena 3: "Crea tu cuenta / y sube a bordo"
        tl.to(lineasB, { yPercent: 0, duration: 1, ease: 'power4.out', stagger: 0.15 }, 11.8)
          .to(lineasB, { yPercent: -115, duration: 0.7, ease: 'power3.in', stagger: 0.1 }, 14.8);

        // Transición 3: cortinas de vuelta a la escena 1
        tl.to(telones, { xPercent: 0, duration: 0.8, ease: 'power3.inOut', stagger: 0.12 }, 15.1)
          .set(B, { autoAlpha: 0 }, 16.1)
          .set(A, { autoAlpha: 1 }, 16.1)
          .to(salidaCortinas, { xPercent: 130, duration: 0.8, ease: 'power3.inOut', stagger: 0.12 }, 16.1);
        tl.set({}, {}, 17.2); // fin de la vuelta

        // Pestaña oculta: detener para no gastar batería
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) tl.pause(); else tl.resume();
        });
    }

    // ==================== TOGGLE PASSWORD ====================
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const passwordInput = document.getElementById(targetId);
            if (!passwordInput) return;
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.textContent = type === 'password' ? 'Mostrar' : 'Ocultar';
            this.setAttribute('aria-pressed', type === 'password' ? 'false' : 'true');
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
            strengthBar.style.width = '';
            strengthText.textContent = '';
            return;
        }

        const strength = checkPasswordStrength(password);

        switch (strength) {
            case 1:
                strengthBar.className = 'strength-bar weak';
                strengthText.textContent = 'Contraseña débil';
                break;
            case 2:
                strengthBar.className = 'strength-bar medium';
                strengthText.textContent = 'Contraseña media';
                break;
            case 3:
                strengthBar.className = 'strength-bar strong';
                strengthText.textContent = 'Contraseña fuerte';
                break;
            case 4:
                strengthBar.className = 'strength-bar very-strong';
                strengthText.textContent = 'Contraseña muy fuerte';
                break;
        }
    }

    if (passwordInput) {
        passwordInput.addEventListener('input', updateStrengthBar);
    }

    // ==================== REGLAS DE LA CONTRASEÑA (las mismas que aplica el servidor) ====================
    // El servidor rechaza contraseñas comunes, solo números o parecidas a tus datos. Se consulta mientras
    // escribes para avisar antes de enviar, y de nuevo al enviar.
    const passwordFeedback = document.getElementById('passwordFeedback');
    let passwordTimer = null;
    let passwordConsulta = 0;

    function consultarReglasContrasena() {
        const fd = new FormData();
        ['password', 'first_name', 'last_name', 'email', 'username'].forEach(function (id) {
            const campo = document.getElementById(id);
            fd.append(id, campo ? campo.value : '');
        });
        fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));
        return fetch('/verificar_contrasena/', {
            method: 'POST',
            body: fd,
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.error || null; });
    }

    function pintarReglasContrasena(error) {
        if (!passwordFeedback || !passwordInput) return;
        passwordInput.classList.remove('input-loading');
        if (error) {
            passwordInput.classList.add('input-error');
            passwordFeedback.textContent = error;
            passwordFeedback.classList.add('error');
        } else {
            passwordInput.classList.remove('input-error');
            passwordFeedback.textContent = '';
            passwordFeedback.classList.remove('error');
        }
    }

    function programarReglasContrasena() {
        if (!passwordInput) return;
        clearTimeout(passwordTimer);
        // Mientras se escribe se quita el aviso anterior; el nuevo llega tras una pausa
        pintarReglasContrasena(null);
        if (passwordInput.value === '') return;
        const turno = ++passwordConsulta;
        passwordTimer = setTimeout(function () {
            passwordInput.classList.add('input-loading');
            consultarReglasContrasena()
                .then(function (error) { if (turno === passwordConsulta) pintarReglasContrasena(error); })
                .catch(function () { if (turno === passwordConsulta) pintarReglasContrasena(null); });
        }, 500);
    }

    if (passwordInput) {
        passwordInput.addEventListener('input', programarReglasContrasena);
        // Si cambian el nombre, el correo o el usuario, "parecida a tus datos" puede cambiar
        ['first_name', 'last_name', 'email', 'username'].forEach(function (id) {
            const campo = document.getElementById(id);
            if (campo) campo.addEventListener('change', function () {
                if (passwordInput.value !== '') programarReglasContrasena();
            });
        });
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
                emailFeedback.textContent = 'Escribe un correo válido, por ejemplo tu@correo.com';
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
                        emailFeedback.textContent = 'Este correo ya tiene una cuenta. Inicia sesión o usa otro.';
                        emailFeedback.classList.add('error');
                    } else {
                        emailInput.classList.add('input-success');
                        emailFeedback.textContent = 'Correo disponible';
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
                        emailFeedback.textContent = 'Este correo ya tiene una cuenta. Inicia sesión o usa otro.';
                        emailFeedback.classList.add('error');
                    } else {
                        emailInput.classList.add('input-success');
                        emailFeedback.textContent = 'Correo disponible';
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
        label.textContent = 'Estos nombres están disponibles:';
        usernameSuggestions.appendChild(label);

        sugerencias.forEach(function (sugerencia) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'suggestion-chip';
            chip.textContent = sugerencia;

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
                usernameFeedback.textContent = 'Este nombre de usuario ya está en uso. Prueba con otro.';
                usernameFeedback.classList.add('error');
                if (data.sugerencias && data.sugerencias.length > 0) {
                    renderizarSugerencias(data.sugerencias);
                }
            } else {
                usernameInput.classList.add('input-success');
                usernameFeedback.textContent = 'Nombre de usuario disponible';
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
                usernameFeedback.textContent = 'Usa entre 3 y 30 caracteres: letras, números, puntos o guiones bajos.';
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
                telefonoFeedback.textContent = 'Escribe al menos 7 dígitos.';
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
                        telefonoFeedback.textContent = 'Este teléfono ya tiene una cuenta. Usa otro.';
                        telefonoFeedback.classList.add('error');
                    } else {
                        telefonoInput.classList.add('input-success');
                        telefonoFeedback.textContent = 'Teléfono disponible';
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
                        telefonoFeedback.textContent = 'Este teléfono ya tiene una cuenta. Usa otro.';
                        telefonoFeedback.classList.add('error');
                    } else {
                        telefonoInput.classList.add('input-success');
                        telefonoFeedback.textContent = 'Teléfono disponible';
                        telefonoFeedback.classList.add('success');
                    }
                });
            }
        });
    }

    // ==================== VALIDACIÓN ANTES DE ENVIAR ====================
    const registroForm = document.getElementById('registroForm');

    if (registroForm) {
        const errorForm = document.getElementById('registroErrorForm');
        const botonEnviar = document.getElementById('registroEnviar');

        // Si se vuelve a esta página con el botón del navegador, el botón no debe quedar "enviando"
        window.addEventListener('pageshow', function () {
            comprobando = false;
            estadoBoton(null);
        });

        // Muestra el error en la tarjeta (en vez de un alert) y lleva el foco al campo con el problema
        function mostrarError(e, texto, campo) {
            e.preventDefault();
            if (errorForm) {
                errorForm.textContent = texto;
                errorForm.focus();
            }
            if (campo) campo.focus();
        }

        registroForm.addEventListener('submit', function (e) {
            const password = document.getElementById('password').value;
            const password2 = document.getElementById('password2').value;
            const terms = document.getElementById('terms');
            const email = document.getElementById('email').value;

            if (errorForm) errorForm.textContent = '';

            if (!validateEmail(email)) {
                return mostrarError(e, 'Escribe un correo válido, por ejemplo tu@correo.com.', emailInput);
            }
            if (emailInput && emailInput.classList.contains('input-error')) {
                return mostrarError(e, 'Ese correo ya tiene una cuenta. Inicia sesión o usa otro.', emailInput);
            }
            if (usernameInput && usernameInput.classList.contains('input-error')) {
                return mostrarError(e, 'Corrige el nombre de usuario: está en uso o tiene caracteres no permitidos.', usernameInput);
            }
            if (telefonoInput && telefonoInput.classList.contains('input-error')) {
                return mostrarError(e, 'Corrige el teléfono: ya tiene una cuenta o tiene menos de 7 dígitos.', telefonoInput);
            }
            if (password !== password2) {
                return mostrarError(e, 'Las contraseñas no coinciden. Escríbelas de nuevo.', password2Input);
            }
            if (password.length < 8) {
                return mostrarError(e, 'La contraseña debe tener al menos 8 caracteres.', passwordInput);
            }
            if (passwordInput.classList.contains('input-error')) {
                return mostrarError(e, 'Cambia la contraseña: ' + (passwordFeedback.textContent || 'no cumple las reglas.'), passwordInput);
            }
            if (!terms.checked) {
                return mostrarError(e, 'Para crear tu cuenta, acepta los términos y condiciones.', terms);
            }

            // Lo anterior es lo que ya se sabe en el navegador. Antes de enviar se comprueba todo
            // contra el servidor (correo, usuario, teléfono y contraseña): así no se manda nada con errores,
            // aunque la persona haya enviado antes de que terminaran las comprobaciones en vivo.
            e.preventDefault();
            if (comprobando) return;
            comprobando = true;
            estadoBoton('Comprobando tus datos…');

            comprobarEnServidor()
                .then(function (problema) {
                    if (problema) {
                        comprobando = false;
                        estadoBoton(null);
                        mostrarError({ preventDefault: function () {} }, problema.texto, problema.campo);
                        return;
                    }
                    estadoBoton('Creando cuenta…');
                    registroForm.submit();
                })
                .catch(function () {
                    // Sin conexión con las consultas: el servidor vuelve a validar todo y conserva lo escrito
                    estadoBoton('Creando cuenta…');
                    registroForm.submit();
                });
        });

        let comprobando = false;

        // El botón avisa lo que pasa y no admite un segundo clic; con null vuelve a ser el de siempre
        function estadoBoton(texto) {
            if (!botonEnviar) return;
            if (texto) {
                botonEnviar.classList.add('loading');
                botonEnviar.textContent = texto;
                botonEnviar.setAttribute('aria-disabled', 'true');
            } else {
                botonEnviar.classList.remove('loading');
                botonEnviar.textContent = 'Crear cuenta';
                botonEnviar.removeAttribute('aria-disabled');
            }
        }

        if (botonEnviar) {
            botonEnviar.addEventListener('click', function (ev) {
                if (comprobando) ev.preventDefault();
            });
        }

        function consultar(url, campos) {
            const fd = new FormData();
            Object.keys(campos).forEach(function (k) { fd.append(k, campos[k]); });
            fd.append('csrfmiddlewaretoken', getCookie('csrftoken'));
            return fetch(url, { method: 'POST', body: fd, headers: { 'X-CSRFToken': getCookie('csrftoken') } })
                .then(function (r) { return r.json(); });
        }

        // Devuelve { texto, campo } con el primer problema (en el orden de la pantalla) o null si todo está bien
        function comprobarEnServidor() {
            const email = emailInput.value.trim().toLowerCase();
            const usuario = usernameInput.value.trim();
            const telefono = telefonoInput.value.trim();

            return Promise.all([
                consultar('/verificar_email/', { email: email }),
                consultar('/verificar_nickname/', { nickname: usuario.toLowerCase() }),
                telefono.length >= 7 ? consultar('/verificar_telefono/', { telefono: telefono }) : Promise.resolve({ existe: false }),
                consultarReglasContrasena().then(function (error) { return { error: error }; })
            ]).then(function (r) {
                if (r[0].existe) {
                    emailInput.classList.add('input-error');
                    emailFeedback.textContent = 'Este correo ya tiene una cuenta. Inicia sesión o usa otro.';
                    emailFeedback.classList.add('error');
                    return { texto: 'Ese correo ya tiene una cuenta. Inicia sesión o usa otro.', campo: emailInput };
                }
                if (r[1].existe) {
                    usernameInput.classList.add('input-error');
                    usernameFeedback.textContent = 'Este nombre de usuario ya está en uso. Prueba con otro.';
                    usernameFeedback.classList.add('error');
                    if (r[1].sugerencias && r[1].sugerencias.length) renderizarSugerencias(r[1].sugerencias);
                    return { texto: 'Ese nombre de usuario ya está en uso. Elige otro.', campo: usernameInput };
                }
                if (r[2].existe) {
                    telefonoInput.classList.add('input-error');
                    telefonoFeedback.textContent = 'Este teléfono ya tiene una cuenta. Usa otro.';
                    telefonoFeedback.classList.add('error');
                    return { texto: 'Ese teléfono ya tiene una cuenta. Usa otro.', campo: telefonoInput };
                }
                if (r[3].error) {
                    pintarReglasContrasena(r[3].error);
                    return { texto: 'Cambia la contraseña: ' + r[3].error, campo: passwordInput };
                }
                return null;
            });
        }
    }
});