document.addEventListener('DOMContentLoaded', function () {

    // ==========================================
    // MODALES
    // ==========================================

    const alertModal = document.getElementById('alertModal');
    const detailModal = document.getElementById('detailModal');

    const btnCreateAlert = document.getElementById('btnCreateAlert');

    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');

    const detailClose = document.getElementById('detailClose');

    const detailEdit = document.getElementById('detailEdit');
    const detailDelete = document.getElementById('detailDelete');

    const alertForm = document.getElementById('alertForm');

    // ==========================================
    // CAMPOS DEL FORMULARIO
    // ==========================================

    const alertId = document.getElementById('alertId');
    const alertRuta = document.getElementById('alertRuta');
    const alertTipo = document.getElementById('alertTipo');
    const alertDescripcion = document.getElementById('alertDescripcion');
    const alertEstado = document.getElementById('alertEstado');

    const modalTitle = document.getElementById('modalTitle');
    const modalSubmit = document.getElementById('modalSubmit');

    // ==========================================
    // DATOS DEL MODAL DE DETALLE
    // ==========================================

    const detailRuta = document.getElementById('detailRuta');
    const detailTipo = document.getElementById('detailTipo');
    const detailDescripcion = document.getElementById('detailDescripcion');
    const detailEstado = document.getElementById('detailEstado');
    const detailFecha = document.getElementById('detailFecha');

    // Alerta seleccionada actualmente
    let alertaSeleccionada = null;


    // ==========================================
    // ABRIR MODAL CREAR
    // ==========================================

    if (btnCreateAlert) {

        btnCreateAlert.addEventListener('click', function () {

            alertForm.reset();

            alertId.value = '';

            modalTitle.textContent = 'Crear Nueva Alerta';

            modalSubmit.textContent = 'Crear Alerta';

            alertForm.action = '/crearAlerta/';

            alertModal.classList.add('active');

        });

    }


    // ==========================================
    // CERRAR MODAL CREAR
    // ==========================================

    if (modalClose) {

        modalClose.addEventListener('click', function () {

            alertModal.classList.remove('active');

        });

    }


    if (modalCancel) {

        modalCancel.addEventListener('click', function () {

            alertModal.classList.remove('active');

        });

    }


    // ==========================================
    // HACER CLICK EN UNA TARJETA
    // ==========================================

    const alertCards = document.querySelectorAll('.alert-card');

    alertCards.forEach(function (card) {

        card.addEventListener('click', function () {

            alertaSeleccionada = this;

            // Obtener datos de la tarjeta
            const id = this.dataset.id;
            const ruta = this.dataset.ruta;
            const tipo = this.dataset.tipo;
            const descripcion = this.dataset.descripcion;
            const estado = this.dataset.estado;
            const fecha = this.dataset.fecha;

            // Guardar ID
            detailModal.dataset.id = id;

            // Mostrar información
            detailRuta.textContent =
                ruta + ' (' +
                this.dataset.origen +
                ' → ' +
                this.dataset.destino +
                ')';

            detailTipo.textContent = convertirTipo(tipo);

            detailDescripcion.textContent = descripcion;

            detailEstado.textContent = convertirEstado(estado);

            detailFecha.textContent = fecha;

            // Abrir modal
            detailModal.classList.add('active');

        });

    });


    // ==========================================
    // CERRAR MODAL DETALLE
    // ==========================================

    if (detailClose) {

        detailClose.addEventListener('click', function () {

            detailModal.classList.remove('active');

        });

    }


    // ==========================================
    // EDITAR ALERTA
    // ==========================================

    if (detailEdit) {

        detailEdit.addEventListener('click', function () {

            if (!alertaSeleccionada) {
                return;
            }

            const id = alertaSeleccionada.dataset.id;

            const ruta = alertaSeleccionada.dataset.rutaId;
            const tipo = alertaSeleccionada.dataset.tipo;
            const descripcion = alertaSeleccionada.dataset.descripcion;
            const estado = alertaSeleccionada.dataset.estado;

            // Llenar formulario
            alertId.value = id;

            alertRuta.value = ruta;

            alertTipo.value = tipo;

            alertDescripcion.value = descripcion;

            alertEstado.value = estado;

            // Cambiar título
            modalTitle.textContent = 'Editar Alerta';

            // Cambiar botón
            modalSubmit.textContent = 'Guardar Cambios';

            // Cambiar URL del formulario
            alertForm.action = '/editarAlerta/' + id + '/';

            // Cerrar detalle
            detailModal.classList.remove('active');

            // Abrir formulario
            alertModal.classList.add('active');

        });

    }


    // ==========================================
    // ELIMINAR ALERTA
    // ==========================================

    if (detailDelete) {

        detailDelete.addEventListener('click', function () {

            if (!alertaSeleccionada) {
                return;
            }

            const id = alertaSeleccionada.dataset.id;

            const confirmar = confirm(
                '¿Está seguro de que desea eliminar esta alerta?'
            );

            if (!confirmar) {
                return;
            }

            // Crear formulario temporal
            const form = document.createElement('form');

            form.method = 'POST';

            form.action = '/eliminarAlerta/' + id + '/';

            // CSRF
            const csrfToken = document.querySelector(
                '[name=csrfmiddlewaretoken]'
            );

            if (csrfToken) {

                const csrfInput = document.createElement('input');

                csrfInput.type = 'hidden';

                csrfInput.name = 'csrfmiddlewaretoken';

                csrfInput.value = csrfToken.value;

                form.appendChild(csrfInput);

            }

            document.body.appendChild(form);

            form.submit();

        });

    }


    // ==========================================
    // CERRAR MODALES AL HACER CLICK AFUERA
    // ==========================================

    window.addEventListener('click', function (event) {

        if (event.target === alertModal) {

            alertModal.classList.remove('active');

        }

        if (event.target === detailModal) {

            detailModal.classList.remove('active');

        }

    });


    // ==========================================
    // CONVERTIR TIPO
    // ==========================================

    function convertirTipo(tipo) {

        switch (tipo) {

            case 'delay':
                return 'DEMORA';

            case 'bus-arriving':
                return 'PRÓXIMO BUS';

            case 'warning':
                return 'ADVERTENCIA';

            case 'info':
                return 'INFORMACIÓN';

            default:
                return tipo;

        }

    }


    // ==========================================
    // CONVERTIR ESTADO
    // ==========================================

    function convertirEstado(estado) {

        switch (estado) {

            case 'activa':
                return 'Activa';

            case 'resuelta':
                return 'Resuelta';

            case 'cancelada':
                return 'Cancelada';

            default:
                return estado;

        }

    }

});
// ==========================================
// FILTROS DE ALERTAS
// ==========================================

const filterButtons = document.querySelectorAll('.filter-btn');
const alertCards = document.querySelectorAll('.alert-card');

filterButtons.forEach(function (button) {

    button.addEventListener('click', function () {

        // Quitar active de todos
        filterButtons.forEach(function (btn) {
            btn.classList.remove('active');
        });

        // Activar el botón seleccionado
        this.classList.add('active');

        const filtro = this.dataset.filter;

        alertCards.forEach(function (card) {

            const tipo = card.classList;

            if (filtro === 'all') {
                card.style.display = '';
            }

            else if (filtro === 'delay' && tipo.contains('delay')) {
                card.style.display = '';
            }

            else if (filtro === 'bus-arriving' && tipo.contains('bus-arriving')) {
                card.style.display = '';
            }

            else if (filtro === 'warning' && tipo.contains('warning')) {
                card.style.display = '';
            }

            else if (filtro === 'info' && tipo.contains('info')) {
                card.style.display = '';
            }

            else {
                card.style.display = 'none';
            }

        });

    });

});
