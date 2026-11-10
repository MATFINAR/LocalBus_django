// ============================================================
// ACERCA_DE.JS - Video promocional animado de la página "Acerca de" (GSAP + MotionPath).
// Una sola línea de tiempo con 8 escenas, como un video: la espera en el paradero, el problema, aparece
// LocalBus, los tres pasos (elegir ruta, verlo llegar, enterarse de novedades), la ciudad y el cierre.
// Controles: pausar / reproducir, saltar a una escena y ver otra vez. Se reproduce solo cuando está a la
// vista. Con movimiento reducido no arranca solo: muestra el cierre y se puede ir escena por escena.
// Sin GSAP, la página muestra el cierre (lo hace el CSS).
// ============================================================
(function () {
    'use strict';

    const pantalla = document.getElementById('pvPantalla');
    if (!pantalla || typeof gsap === 'undefined') return;
    const conRecorrido = typeof MotionPathPlugin !== 'undefined';
    if (conRecorrido) gsap.registerPlugin(MotionPathPlugin);
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const escenas = Array.from(pantalla.querySelectorAll('.pv-escena'));
    const capitulos = Array.from(document.querySelectorAll('#pvCapitulos button'));
    const botonPlay = document.getElementById('pvPlay');
    const botonOtraVez = document.getElementById('pvOtraVez');
    const css = function (nombre, defecto) {
        return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
    };
    const amarillo = css('--amarillo', '#F7C600');

    pantalla.classList.add('pv-js');
    gsap.set(escenas, { autoAlpha: 0 });
    const ruta = pantalla.querySelector('.pv-ruta');
    if (ruta) {
        ruta.setAttribute('pathLength', '1');
        gsap.set(ruta, { strokeDasharray: 1, strokeDashoffset: 1 });
    }

    // Separa un texto en palabras para que entren una por una
    function enPalabras(el) {
        const texto = el.textContent.trim();
        el.setAttribute('aria-label', texto);
        el.textContent = '';
        texto.split(/\s+/).forEach(function (p, i) {
            if (i) el.append(' ');
            const s = document.createElement('span');
            s.className = 'pv-palabra';
            s.setAttribute('aria-hidden', 'true');
            s.textContent = p;
            el.appendChild(s);
        });
        return el.querySelectorAll('.pv-palabra');
    }

    const q = function (i, sel) { return escenas[i].querySelectorAll(sel); };
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

    // ---------- 1. La espera ----------
    tl.addLabel('e0')
        .set(escenas[0], { autoAlpha: 1 })
        .from(q(0, '.pv-hora'), { y: -20, autoAlpha: 0, duration: 0.5 })
        .from(q(0, '.pv-poste'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6 }, '-=0.2')
        .from(q(0, '.pv-senal'), { scale: 0, duration: 0.4, ease: 'back.out(3)' }, '-=0.1')
        .from(q(0, '.pv-persona'), { y: '120%', duration: 0.7, ease: 'back.out(1.4)' }, '-=0.3')
        .from(q(0, '.pv-reloj'), { scale: 0, rotate: -90, duration: 0.6, ease: 'back.out(2)' }, '-=0.3')
        .to(q(0, '.pv-reloj-aguja'), { rotate: 720, svgOrigin: '20 20', duration: 3.4, ease: 'none' }, '<')
        .from(enPalabras(escenas[0].querySelector('.pv-palabras')), {
            y: 60, autoAlpha: 0, rotate: 6, duration: 0.6, stagger: 0.12, ease: 'back.out(2)',
        }, '-=3.0')
        .from(q(0, '.pv-duda'), { scale: 0, autoAlpha: 0, duration: 0.5, stagger: 0.25, ease: 'back.out(3)' }, '-=2.4')
        .to(q(0, '.pv-duda'), { y: -10, duration: 0.6, yoyo: true, repeat: 3, ease: 'sine.inOut', stagger: 0.15 }, '-=1.2')
        .to({}, { duration: 0.4 })
        // Salida: la cámara se mete en el reloj
        .to(escenas[0], { scale: 1.5, autoAlpha: 0, duration: 0.7, ease: 'power2.in', transformOrigin: '75% 30%' });

    // ---------- 2. El problema ----------
    const minutos = { n: 0 };
    const numeroMinutos = document.getElementById('pvMinutos');
    tl.addLabel('e1')
        .set(escenas[1], { autoAlpha: 1 })
        .from(q(1, '.pv-linea'), { y: 80, autoAlpha: 0, duration: 0.7, stagger: 0.35, ease: 'power4.out' })
        .from(q(1, '.pv-contador'), { x: 60, autoAlpha: 0, duration: 0.6 }, '-=0.2')
        .fromTo(minutos, { n: 0 }, {
            n: 15, duration: 1.6, ease: 'power2.out',
            onUpdate: function () { numeroMinutos.textContent = Math.round(minutos.n); },
        }, '<')
        .to(q(1, '.pv-resalta'), { scale: 1.08, duration: 0.25, yoyo: true, repeat: 1, transformOrigin: '0% 50%' }, '-=0.4')
        .to({}, { duration: 1.2 })
        .to(escenas[1], { xPercent: -30, autoAlpha: 0, duration: 0.6, ease: 'power2.in' });

    // ---------- 3. Aparece LocalBus ----------
    tl.addLabel('e2')
        .set(escenas[2], { autoAlpha: 1, xPercent: 0 })
        .fromTo(q(2, '.pv-barrido'), { scaleX: 0, transformOrigin: '0% 50%' },
            { scaleX: 1, duration: 0.45, ease: 'power3.inOut' })
        .set(q(2, '.pv-barrido'), { transformOrigin: '100% 50%' })
        .to(q(2, '.pv-barrido'), { scaleX: 0, duration: 0.5, ease: 'power3.inOut' })
        .from(q(2, '.pv-marca-local, .pv-marca-bus'), {
            yPercent: 110, autoAlpha: 0, duration: 0.7, stagger: 0.15, ease: 'back.out(2)',
        }, '-=0.25')
        .from(q(2, '.pv-lema'), { y: 30, autoAlpha: 0, duration: 0.6 }, '-=0.2')
        .to(q(2, '.pv-marca-bus'), { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1, transformOrigin: '50% 80%' })
        .to({}, { duration: 1.2 })
        .to(escenas[2], { scale: 0.85, autoAlpha: 0, duration: 0.5, ease: 'power2.in' });

    // ---------- 4. Elige tu ruta ----------
    const elegida = escenas[3].querySelector('.pv-item--elegida');
    const cursor = escenas[3].querySelector('.pv-cursor');
    tl.addLabel('e3')
        .set(escenas[3], { autoAlpha: 1 })
        .fromTo(escenas[3], { clipPath: 'circle(0% at 50% 50%)' },
            { clipPath: 'circle(150% at 50% 50%)', duration: 0.8, ease: 'power2.inOut' })
        .from(q(3, '.pv-paso'), { scale: 0, duration: 0.5, ease: 'back.out(3)' }, '-=0.3')
        .from(q(3, '.pv-titulo, .pv-detalle'), { x: -40, autoAlpha: 0, duration: 0.6, stagger: 0.15 }, '-=0.2')
        .from(q(3, '.pv-item'), { x: 80, autoAlpha: 0, duration: 0.5, stagger: 0.12 }, '-=0.4')
        // El cursor va hasta la ruta y la elige
        .fromTo(cursor, { autoAlpha: 0, scale: 1.6 }, {
            autoAlpha: 1, scale: 1, duration: 0.3,
            x: function () { return elegida.offsetWidth * 0.5; },
            y: function () { return -cursor.offsetHeight; },
        })
        .to(cursor, {
            x: function () { return elegida.offsetLeft + elegida.offsetWidth - cursor.offsetWidth * 1.4; },
            y: function () { return elegida.offsetTop + elegida.offsetHeight * 0.5 - cursor.offsetHeight / 2; },
            duration: 0.8, ease: 'power2.inOut',
        })
        .to(cursor, { scale: 0.7, duration: 0.12, yoyo: true, repeat: 1 })
        .to(elegida, { scale: 1.06, borderLeftColor: amarillo, backgroundColor: amarillo, duration: 0.3, ease: 'back.out(3)' }, '-=0.1')
        .to(q(3, '.pv-item:not(.pv-item--elegida)'), { autoAlpha: 0.35, duration: 0.3 }, '<')
        .to({}, { duration: 1.1 })
        .to(escenas[3], { xPercent: -100, duration: 0.6, ease: 'power3.in' });

    // ---------- 5. Míralo llegar ----------
    const llega = escenas[4].querySelector('.pv-llega');
    const llegaTexto = document.getElementById('pvLlegaTexto');
    const llegaMin = document.getElementById('pvLlegaMin');
    const viaje = { p: 0 };
    const PARADERO = 360 / 480;
    const moverBus = function () {
        if (!conRecorrido) return;
        gsap.set('#pvBus', { motionPath: { path: '#pvRuta', align: '#pvRuta', alignOrigin: [0.5, 0.5],
            autoRotate: true, start: viaje.p, end: viaje.p } });
    };
    tl.addLabel('e4')
        .set(escenas[4], { autoAlpha: 1, xPercent: 100 })
        .to(escenas[4], { xPercent: 0, duration: 0.6, ease: 'power3.out' })
        .from(q(4, '.pv-paso'), { scale: 0, duration: 0.5, ease: 'back.out(3)' }, '-=0.2')
        .from(q(4, '.pv-titulo, .pv-detalle'), { x: -40, autoAlpha: 0, duration: 0.6, stagger: 0.15 }, '-=0.3')
        .to(ruta, { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut' }, '-=0.5')
        .from(q(4, '.pv-tu'), { scale: 0, transformOrigin: '50% 50%', duration: 0.5, ease: 'back.out(3)' }, '-=0.3')
        .from(llega, { y: -20, autoAlpha: 0, duration: 0.4 }, '<')
        .add(function () {
            llega.classList.remove('llego');
            llegaTexto.textContent = 'Llega en';
        })
        .fromTo(viaje, { p: 0 }, {
            p: PARADERO, duration: 3, ease: 'power1.inOut',
            onUpdate: function () {
                moverBus();
                const n = Math.max(1, Math.ceil((1 - viaje.p / PARADERO) * 4));
                llegaMin.textContent = n + ' min';
            },
        })
        .add(function () { llega.classList.add('llego'); llegaTexto.textContent = 'Tu bus'; llegaMin.textContent = 'ya llegó'; })
        .to(llega, { scale: 1.15, duration: 0.18, yoyo: true, repeat: 1, transformOrigin: '0% 0%' })
        .to(q(4, '.pv-tu-onda'), { attr: { r: 26 }, autoAlpha: 0, duration: 0.8, ease: 'power1.out' }, '<')
        .to({}, { duration: 1 })
        .to(escenas[4], { yPercent: -100, duration: 0.6, ease: 'power3.in' });

    // ---------- 6. Novedades ----------
    tl.addLabel('e5')
        .set(escenas[5], { autoAlpha: 1, yPercent: 100 })
        .to(escenas[5], { yPercent: 0, duration: 0.6, ease: 'power3.out' })
        .from(q(5, '.pv-paso'), { scale: 0, duration: 0.5, ease: 'back.out(3)' }, '-=0.2')
        .from(q(5, '.pv-titulo, .pv-detalle'), { x: -40, autoAlpha: 0, duration: 0.6, stagger: 0.15 }, '-=0.3')
        .from(q(5, '.pv-aviso'), { x: 120, autoAlpha: 0, rotate: 4, duration: 0.7, stagger: 0.5, ease: 'back.out(1.6)' }, '-=0.2')
        .to(q(5, '.pv-aviso--1'), { x: -8, duration: 0.07, yoyo: true, repeat: 5, ease: 'none' })
        .to({}, { duration: 1.3 });

    // ---------- 7. La ciudad ----------
    const cifras = Array.from(escenas[6].querySelectorAll('[data-contar]'));
    tl.addLabel('e6')
        .set(escenas[6], { autoAlpha: 1 }, 'e6')
        .fromTo(escenas[6], { clipPath: 'inset(100% 0% 0% 0%)' },
            { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'power3.inOut' }, 'e6')
        .set(escenas[5], { autoAlpha: 0 }, 'e6+=0.7')
        // El tráfico fluye de fondo durante toda la escena
        .fromTo(q(6, '.pv-trafico span'), { x: 0 }, {
            x: function () { return pantalla.offsetWidth * 1.6; }, duration: 3.2, ease: 'none', stagger: 0.25,
        }, 'e6')
        .from(q(6, '.pv-golpe'), { scale: 2.6, autoAlpha: 0, duration: 0.5, stagger: 0.5, ease: 'power4.out' }, 'e6+=0.6')
        .from(q(6, '.pv-cifras > span'), { y: 40, autoAlpha: 0, duration: 0.5, stagger: 0.15 }, 'e6+=1.7')
        .add(function () {
            cifras.forEach(function (el) {
                const meta = parseInt(el.dataset.contar, 10) || 0;
                const v = { n: 0 };
                gsap.to(v, { n: meta, duration: 1.1, ease: 'power2.out',
                    onUpdate: function () { el.textContent = Math.round(v.n); } });
            });
        }, 'e6+=1.7')
        .to(escenas[6], { autoAlpha: 0, duration: 0.5 }, 'e6+=4.6');

    // ---------- 8. Cierre ----------
    tl.addLabel('e7')
        .set(escenas[7], { autoAlpha: 1 })
        .from(q(7, '.pv-marca-local, .pv-marca-bus'), { yPercent: 100, autoAlpha: 0, duration: 0.6, stagger: 0.12, ease: 'back.out(2)' })
        .from(q(7, '.pv-cierre-texto'), { y: 30, autoAlpha: 0, duration: 0.6 }, '-=0.2')
        .from(q(7, '.pv-acciones .ac-boton'), { y: 20, autoAlpha: 0, scale: 0.8, duration: 0.5, stagger: 0.12, ease: 'back.out(2)' }, '-=0.2')
        .addLabel('fin');

    // Al saltar a una escena, las cifras de la ciudad muestran su valor real si no se van a contar
    cifras.forEach(function (el) { el.textContent = el.dataset.contar; });
    moverBus();

    // ---------- Controles ----------
    const inicios = escenas.map(function (_, i) { return tl.labels['e' + i]; });
    const finales = inicios.slice(1).concat(tl.duration());

    function pintarAvance() {
        const t = tl.time();
        capitulos.forEach(function (b, i) {
            const avance = gsap.utils.clamp(0, 1, (t - inicios[i]) / (finales[i] - inicios[i]));
            b.firstElementChild.style.setProperty('--avance', avance);
            b.setAttribute('aria-current', t >= inicios[i] && t < finales[i] ? 'step' : 'false');
        });
    }
    tl.eventCallback('onUpdate', pintarAvance);

    let pausadoPorUsuario = false;
    function ponerIcono() {
        const enPausa = tl.paused() || tl.progress() === 1;
        botonPlay.firstElementChild.className = 'pv-icono ' + (enPausa ? 'pv-icono--play' : 'pv-icono--pausa');
        botonPlay.setAttribute('aria-label', enPausa ? 'Reproducir la presentación' : 'Pausar la presentación');
    }
    tl.eventCallback('onComplete', ponerIcono);

    function reproducir() {
        if (tl.progress() === 1) tl.restart();
        else tl.play();
        ponerIcono();
    }

    botonPlay.addEventListener('click', function () {
        if (tl.paused() || tl.progress() === 1) { pausadoPorUsuario = false; reproducir(); }
        else { pausadoPorUsuario = true; tl.pause(); ponerIcono(); }
    });

    botonOtraVez.addEventListener('click', function () {
        pausadoPorUsuario = false;
        if (reducido) { tl.pause(0); tl.seek('e0').pause(); }
        else tl.restart();
        ponerIcono();
        pintarAvance();
    });

    capitulos.forEach(function (b) {
        b.addEventListener('click', function () {
            const etiqueta = 'e' + b.dataset.ir;
            if (reducido) {
                // Sin movimiento: se muestra cómo queda la escena, sin animarla
                const i = Number(b.dataset.ir);
                tl.seek(finales[i] - 0.001).pause();
            } else {
                tl.seek(etiqueta);
                if (!pausadoPorUsuario) tl.play();
            }
            ponerIcono();
            pintarAvance();
        });
    });

    // ---------- Arranca solo cuando el video está a la vista ----------
    if (reducido) {
        tl.seek('fin').pause();
        pintarAvance();
        ponerIcono();
        return;
    }

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (e.isIntersecting && e.intersectionRatio >= 0.4) {
                    if (!pausadoPorUsuario && tl.progress() < 1) tl.play();
                } else if (!e.isIntersecting || e.intersectionRatio < 0.2) {
                    tl.pause();
                }
                ponerIcono();
            });
        }, { threshold: [0, 0.2, 0.4] }).observe(pantalla);
    } else {
        tl.play();
    }
    ponerIcono();
    pintarAvance();
})();
