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
