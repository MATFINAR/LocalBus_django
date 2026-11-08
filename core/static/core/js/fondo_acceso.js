// ============================================================
// FONDO_ACCESO.JS - Fondo animado de las pantallas de acceso (registro, verificar registro)
// Escenas (texto, rutas con buses) unidas por transiciones (cortinas e iris), con GSAP.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    ajustarTextosFondo();
    iniciarFondo();

    // ==================== FONDO EN ESCENAS (GSAP) ====================
    // Texto, rutas con buses y otro texto, unidos por cortinas e iris. Dura unos 17 s y se repite.
    // Sin GSAP o con movimiento reducido no se anima: queda la escena de rutas fija (ver CSS).

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
});
