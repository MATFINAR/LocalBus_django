document.addEventListener('DOMContentLoaded', function() {

    // ================= FILTROS =================

    const searchInput = document.getElementById('searchInput');
    const rutaFilter = document.getElementById('rutaFilter');

    function filterTable() {

        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const ruta = rutaFilter ? rutaFilter.value : '';

        const rows = document.querySelectorAll('#conductoresTableBody tr');
        let visibleCount = 0;

        rows.forEach(row => {

            if (row.classList.contains('conductores-empty')) return;

            const nombre = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
            const cedula = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
            const telefono = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
            const email = row.querySelector('td:nth-child(5)')?.textContent?.toLowerCase() || '';

            const rowRuta = row.dataset.id_ruta || '';

            const matchesSearch =
                !term ||
                nombre.includes(term) ||
                cedula.includes(term) ||
                telefono.includes(term) ||
                email.includes(term);

            const matchesRuta = !ruta || rowRuta === ruta;

            if (matchesSearch && matchesRuta) {

                row.style.display = '';
                visibleCount++;

            } else {

                row.style.display = 'none';

            }

        });

        showNoResultsMessage(visibleCount);
    }


    function showNoResultsMessage(visibleCount) {

        let noResults = document.querySelector('.conductores-no-results');
        const tbody = document.getElementById('conductoresTableBody');

        if (!tbody) return;

        if (visibleCount > 0) {

            if (noResults) noResults.remove();

            return;
        }

        if (!noResults) {

            const emptyRow = tbody.querySelector('.conductores-empty');

            if (emptyRow) emptyRow.style.display = 'none';

            noResults = document.createElement('tr');

            noResults.className = 'conductores-no-results';

            noResults.innerHTML = `
                <td colspan="7" style="text-align: center; padding: 3rem 1rem; color: #999;">
                    <p>🔍 No se encontraron conductores</p>
                </td>
            `;

            tbody.appendChild(noResults);

        } else {

            noResults.style.display = '';

        }
    }


    if (searchInput) searchInput.addEventListener('keyup', filterTable);
    if (rutaFilter) rutaFilter.addEventListener('change', filterTable);


    // ================= MODALES =================

    function openCreateModal() {

        const modal = document.getElementById('createModal');

        if (modal) {

            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

        }
    }


    function closeCreateModal() {

        const modal = document.getElementById('createModal');

        if (modal) {

            modal.classList.remove('active');
            document.body.style.overflow = '';

        }
    }


    // ================= EDITAR CONDUCTOR =================

    function editConductor(id) {

        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (!row) return;

        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
        const cedula = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
        const telefono = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '';
        const email = row.querySelector('td:nth-child(5)')?.textContent?.trim() || '';

        document.getElementById('edit_id').value = id;
        document.getElementById('edit_nombre').value = nombre;
        document.getElementById('edit_cedula').value = cedula;
        document.getElementById('edit_telefono').value = telefono;
        document.getElementById('edit_email').value = email;
        document.getElementById('edit_contrasena').value = '';

        document.getElementById('editForm').action = '/EditarConductor/' + id + '/';

        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

            // ✅ Guardar datos originales para comparar después
            setTimeout(() => {
                guardarDatosOriginalesConductor();
            }, 100);
        }
    }


    function closeEditModal() {
        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        datosOriginalesConductor = {};
    }


    // ================= ELIMINAR CONDUCTOR =================

    let conductorIdToDelete = null;


    function confirmDelete(id, nombre) {

        conductorIdToDelete = id;

        document.getElementById('deleteConductorNombre').textContent = nombre;

        const modal = document.getElementById('deleteModal');

        if (modal) {

            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

        }
    }


    function closeDeleteModal() {

        const modal = document.getElementById('deleteModal');

        if (modal) {

            modal.classList.remove('active');
            document.body.style.overflow = '';

        }

        conductorIdToDelete = null;
    }


    function deleteConductor() {

        if (!conductorIdToDelete) return;

        // Redirigir a Django para eliminar el conductor

        window.location.href =
            '/EliminarConductor/' + conductorIdToDelete + '/';

        closeDeleteModal();
    }


    // ================= GUARDAR CONDUCTOR =================

    function saveConductor() {

        const form = document.getElementById('createForm');

        if (form) {

            const nombre = document.getElementById('nombre').value.trim();
            const cedula = document.getElementById('cedula').value.trim();
            const telefono = document.getElementById('telefono').value.trim();
            const email = document.getElementById('email').value.trim();
            const contrasena = document.getElementById('contrasena').value.trim();

            if (!nombre || !cedula || !telefono || !email || !contrasena) {

                alert('⚠️ Por favor complete todos los campos obligatorios');

                return;
            }

            form.submit();
        }
    }


    // ================= ACTUALIZAR CONDUCTOR =================

    function updateConductor() {

        const form = document.getElementById('editForm');

        if (form) {

            const nombre = document.getElementById('edit_nombre').value.trim();
            const cedula = document.getElementById('edit_cedula').value.trim();
            const telefono = document.getElementById('edit_telefono').value.trim();
            const email = document.getElementById('edit_email').value.trim();

            if (!nombre || !cedula || !telefono || !email) {
                alert('⚠️ Por favor complete todos los campos obligatorios');
                return;
            }

            // ✅ Cerrar el modal de editar antes de abrir el de confirmación
            const modalEdit = document.getElementById('editModal');
            if (modalEdit) {
                modalEdit.classList.remove('active');
            }

            // ✅ Mostrar modal de confirmación
            formPendienteConductor = form;
            mostrarConfirmacionCambiosConductor();
        }
    }


    // ================= CERRAR MODALES CON ESC =================

    document.addEventListener('keydown', function(e) {

        if (e.key === 'Escape') {

            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
            closeConfirmChangesModal();

        }
    });


    // ================= CERRAR MODALES CLICKEANDO FUERA =================

    document.querySelectorAll('.conductores-modal').forEach(modal => {

        modal.addEventListener('click', function(e) {

            if (e.target === this) {

                this.classList.remove('active');
                document.body.style.overflow = '';

            }

        });

    });


    // ================= EXPORTAR FUNCIONES GLOBALES =================

    window.openCreateModal = openCreateModal;
    window.closeCreateModal = closeCreateModal;

    window.editConductor = editConductor;
    window.closeEditModal = closeEditModal;

    window.confirmDelete = confirmDelete;
    window.closeDeleteModal = closeDeleteModal;
    window.deleteConductor = deleteConductor;

    window.saveConductor = saveConductor;
    window.updateConductor = updateConductor;


    // ============================================================
    // ================= VALIDACIONES EN TIEMPO REAL =================
    // ============================================================

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


    // ============ FUNCIÓN GENÉRICA DE VALIDACIÓN ============
    function setupValidacion(options) {
        const {
            inputId,
            feedbackId,
            url,
            paramName,
            conductorIdInputId,
            validarFormato,
            mensajeFormato,
            mensajeExiste,
            mensajeDisponible
        } = options;

        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const conductorIdInput = conductorIdInputId ? document.getElementById(conductorIdInputId) : null;

        if (!input || !feedback) return null;

        let debounceTimer = null;
        let ultimoVerificado = '';

        function limpiarEstados() {
            input.classList.remove('conductores-input-error', 'conductores-input-success', 'conductores-input-loading');
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');
        }

        function mostrarError(mensaje) {
            input.classList.add('conductores-input-error');
            input.classList.remove('conductores-input-success', 'conductores-input-loading');
            feedback.textContent = mensaje;
            feedback.classList.add('error');
            feedback.classList.remove('success');
        }

        function mostrarExito(mensaje) {
            input.classList.add('conductores-input-success');
            input.classList.remove('conductores-input-error', 'conductores-input-loading');
            feedback.textContent = mensaje;
            feedback.classList.add('success');
            feedback.classList.remove('error');
        }

        function verificar(valor) {
            if (valor === ultimoVerificado) return;
            ultimoVerificado = valor;

            input.classList.remove('conductores-input-error', 'conductores-input-success');
            input.classList.add('conductores-input-loading');
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');

            const formData = new FormData();
            formData.append(paramName, valor);
            if (conductorIdInput && conductorIdInput.value) {
                formData.append('conductor_id', conductorIdInput.value);
            }
            formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

            fetch(url, {
                method: 'POST',
                body: formData,
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            })
            .then(response => response.json())
            .then(data => {
                input.classList.remove('conductores-input-loading');
                if (data.existe) {
                    mostrarError(mensajeExiste);
                } else {
                    mostrarExito(mensajeDisponible);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                input.classList.remove('conductores-input-loading');
                ultimoVerificado = '';
            });
        }

        input.addEventListener('input', function () {
            const valor = this.value.trim();
            clearTimeout(debounceTimer);

            if (valor === '') {
                limpiarEstados();
                ultimoVerificado = '';
                return;
            }

            if (validarFormato && !validarFormato(valor)) {
                mostrarError(mensajeFormato);
                ultimoVerificado = '';
                return;
            }

            debounceTimer = setTimeout(function () {
                verificar(valor);
            }, 500);
        });

        input.addEventListener('blur', function () {
            const valor = this.value.trim();
            if (valor !== '' && (!validarFormato || validarFormato(valor))) {
                clearTimeout(debounceTimer);
                verificar(valor);
            }
        });

        return {
            limpiar: function () {
                limpiarEstados();
                ultimoVerificado = '';
            }
        };
    }


    // ============ VALIDACIONES MODAL CREAR ============
    const cedulaFormato = v => /^\d{6,15}$/.test(v);
    const telefonoFormato = v => /^\d{7,15}$/.test(v);
    const emailFormato = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

    const valCedulaCrear = setupValidacion({
        inputId: 'cedula',
        feedbackId: 'cedulaFeedback',
        url: '/verificar_cedula_conductor/',
        paramName: 'cedula',
        validarFormato: cedulaFormato,
        mensajeFormato: '⚠️ Solo números (6-15 dígitos)',
        mensajeExiste: '❌ Esta cédula ya está registrada',
        mensajeDisponible: '✓ Cédula disponible'
    });

    const valTelefonoCrear = setupValidacion({
        inputId: 'telefono',
        feedbackId: 'telefonoFeedback',
        url: '/verificar_telefono_conductor/',
        paramName: 'telefono',
        validarFormato: telefonoFormato,
        mensajeFormato: '⚠️ Solo números (7-15 dígitos)',
        mensajeExiste: '❌ Este teléfono ya está registrado',
        mensajeDisponible: '✓ Teléfono disponible'
    });

    const valEmailCrear = setupValidacion({
        inputId: 'email',
        feedbackId: 'emailFeedback',
        url: '/verificar_email_conductor/',
        paramName: 'email',
        validarFormato: emailFormato,
        mensajeFormato: '⚠️ Ingresa un correo válido',
        mensajeExiste: '❌ Este correo ya está registrado',
        mensajeDisponible: '✓ Correo disponible'
    });


    // ============ VALIDACIONES MODAL EDITAR ============
    const valCedulaEditar = setupValidacion({
        inputId: 'edit_cedula',
        feedbackId: 'editCedulaFeedback',
        url: '/verificar_cedula_conductor/',
        paramName: 'cedula',
        conductorIdInputId: 'edit_id',
        validarFormato: cedulaFormato,
        mensajeFormato: '⚠️ Solo números (6-15 dígitos)',
        mensajeExiste: '❌ Esta cédula ya está en uso',
        mensajeDisponible: '✓ Cédula disponible'
    });

    const valTelefonoEditar = setupValidacion({
        inputId: 'edit_telefono',
        feedbackId: 'editTelefonoFeedback',
        url: '/verificar_telefono_conductor/',
        paramName: 'telefono',
        conductorIdInputId: 'edit_id',
        validarFormato: telefonoFormato,
        mensajeFormato: '⚠️ Solo números (7-15 dígitos)',
        mensajeExiste: '❌ Este teléfono ya está en uso',
        mensajeDisponible: '✓ Teléfono disponible'
    });

    const valEmailEditar = setupValidacion({
        inputId: 'edit_email',
        feedbackId: 'editEmailFeedback',
        url: '/verificar_email_conductor/',
        paramName: 'email',
        conductorIdInputId: 'edit_id',
        validarFormato: emailFormato,
        mensajeFormato: '⚠️ Ingresa un correo válido',
        mensajeExiste: '❌ Este correo ya está en uso',
        mensajeDisponible: '✓ Correo disponible'
    });


    // ============ BLOQUEAR CARACTERES NO NUMÉRICOS ============
    ['cedula', 'telefono', 'edit_cedula', 'edit_telefono'].forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').slice(0, 15);
        });

        el.addEventListener('keypress', function(e) {
            const teclasPermitidas = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
                'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
            if (teclasPermitidas.includes(e.key)) return;
            if (e.ctrlKey || e.metaKey) return;
            if (!/^\d$/.test(e.key)) e.preventDefault();
        });

        el.addEventListener('paste', function(e) {
            e.preventDefault();
            const texto = (e.clipboardData || window.clipboardData).getData('text');
            const soloNumeros = texto.replace(/\D/g, '').slice(0, 15);
            const inicio = this.selectionStart;
            const fin = this.selectionEnd;
            const valorActual = this.value;
            this.value = valorActual.slice(0, inicio) + soloNumeros + valorActual.slice(fin);
            this.dispatchEvent(new Event('input'));
        });
    });


    // ============ LIMPIAR AL ABRIR MODALES ============
    const btnNuevoConductor = document.querySelector('.conductores-btn-primary[onclick="openCreateModal()"]');
    if (btnNuevoConductor) {
        btnNuevoConductor.addEventListener('click', function () {
            if (valCedulaCrear) valCedulaCrear.limpiar();
            if (valTelefonoCrear) valTelefonoCrear.limpiar();
            if (valEmailCrear) valEmailCrear.limpiar();
        });
    }

    document.querySelectorAll('.conductores-action-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (valCedulaEditar) valCedulaEditar.limpiar();
            if (valTelefonoEditar) valTelefonoEditar.limpiar();
            if (valEmailEditar) valEmailEditar.limpiar();
        });
    });


    // ============ BLOQUEAR ENVÍO SI HAY ERRORES ============
    const createFormEl = document.getElementById('createForm');
    if (createFormEl) {
        createFormEl.addEventListener('submit', function (e) {
            const cedula = document.getElementById('cedula');
            const telefono = document.getElementById('telefono');
            const email = document.getElementById('email');

            if (cedula && cedula.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige la cédula antes de guardar.');
                cedula.focus();
                return false;
            }
            if (telefono && telefono.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige el teléfono antes de guardar.');
                telefono.focus();
                return false;
            }
            if (email && email.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige el email antes de guardar.');
                email.focus();
                return false;
            }
        });
    }

    const editFormEl = document.getElementById('editForm');
    if (editFormEl) {
        editFormEl.addEventListener('submit', function (e) {
            const cedula = document.getElementById('edit_cedula');
            const telefono = document.getElementById('edit_telefono');
            const email = document.getElementById('edit_email');

            if (cedula && cedula.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige la cédula antes de guardar.');
                cedula.focus();
                return false;
            }
            if (telefono && telefono.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige el teléfono antes de guardar.');
                telefono.focus();
                return false;
            }
            if (email && email.classList.contains('conductores-input-error')) {
                e.preventDefault();
                alert('Corrige el email antes de guardar.');
                email.focus();
                return false;
            }
        });
    }


    // ================= CONFIRMACIÓN DE CAMBIOS =================
    let datosOriginalesConductor = {};
    let formPendienteConductor = null;

    function guardarDatosOriginalesConductor() {
        datosOriginalesConductor = {
            nombre: document.getElementById('edit_nombre')?.value || '',
            cedula: document.getElementById('edit_cedula')?.value || '',
            telefono: document.getElementById('edit_telefono')?.value || '',
            email: document.getElementById('edit_email')?.value || '',
        };
    }

    function obtenerDatosActualesConductor() {
        return {
            nombre: document.getElementById('edit_nombre')?.value || '',
            cedula: document.getElementById('edit_cedula')?.value || '',
            telefono: document.getElementById('edit_telefono')?.value || '',
            email: document.getElementById('edit_email')?.value || '',
        };
    }

    function detectarCambiosConductor() {
        const actuales = obtenerDatosActualesConductor();
        const cambios = [];
        const etiquetas = {
            nombre: 'Nombre',
            cedula: 'Cédula',
            telefono: 'Teléfono',
            email: 'Email',
        };

        for (const campo in datosOriginalesConductor) {
            const anterior = datosOriginalesConductor[campo];
            const nuevo = actuales[campo];

            if (anterior !== nuevo) {
                cambios.push({
                    campo: etiquetas[campo] || campo,
                    anterior: anterior || '(vacío)',
                    nuevo: nuevo || '(vacío)',
                });
            }
        }

        return cambios;
    }

    function mostrarConfirmacionCambiosConductor() {
        const cambios = detectarCambiosConductor();
        const lista = document.getElementById('changesList');
        const nombreConductor = document.getElementById('changesConductorNombre');

        if (!lista) return false;

        if (cambios.length === 0) {
            lista.innerHTML = `
                <div class="no-changes">
                    <span class="no-changes-icon">📝</span>
                    <p>No detectamos cambios en el conductor.</p>
                </div>
            `;
        } else {
            lista.innerHTML = cambios.map(cambio => `
                <div class="change-item">
                    <span class="change-field-label">${cambio.campo}</span>
                    <div class="change-values">
                        <div class="change-old">
                            <span class="change-icon">−</span>
                            <span class="change-text">${escapeHtmlConductor(cambio.anterior)}</span>
                        </div>
                        <div class="change-new">
                            <span class="change-icon">+</span>
                            <span class="change-text">${escapeHtmlConductor(cambio.nuevo)}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        if (nombreConductor) {
            nombreConductor.textContent = document.getElementById('edit_nombre')?.value || 'sin nombre';
        }

        const modal = document.getElementById('confirmChangesModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        return cambios.length > 0;
    }

    function escapeHtmlConductor(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function closeConfirmChangesModal() {
        const modal = document.getElementById('confirmChangesModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        formPendienteConductor = null;
    }

    function confirmarCambios() {
        const form = formPendienteConductor;
        closeConfirmChangesModal();
        if (form) {
            form.submit();
        }
    }

    // ================= EXPORTAR NUEVAS FUNCIONES =================
    window.closeConfirmChangesModal = closeConfirmChangesModal;
    window.confirmarCambios = confirmarCambios;

});