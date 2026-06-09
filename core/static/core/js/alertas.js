// Alertas - Sistema Metropolitano del Valle de Aburrá

let alerts = [
    {
        id: 1,
        type: "delay",
        title: "Demora en Línea A",
        message: "Tráfico vehicular en la Autopista Norte sentido sur. Buses con retraso de 12 minutos entre estaciones Niquía y Caribe.",
        time: "Hace 8 minutos",
        busRoute: "Metroplús Línea 1",
        location: "Autopista Norte - Bello",
        timestamp: Date.now() - 8 * 60 * 1000
    },
    {
        id: 2,
        type: "bus-arriving",
        title: "Bus próximo a estación Itagüí",
        message: "Unidad con destino Sabaneta se encuentra a 400 metros. Abordaje en 2 minutos.",
        time: "Hace 3 minutos",
        busRoute: "Ruta Metropolitana 301",
        location: "Estación Itagüí",
        timestamp: Date.now() - 3 * 60 * 1000
    },
    {
        id: 3,
        type: "warning",
        title: "Cierre parcial en Av. Las Vegas",
        message: "Trabajos de mantenimiento entre Envigado y Sabaneta. Reducción de carriles. Tome rutas alternas.",
        time: "Hace 25 minutos",
        busRoute: "Rutas 302, 303, 315",
        location: "Av. Las Vegas - Envigado",
        timestamp: Date.now() - 25 * 60 * 1000
    },
    {
        id: 4,
        type: "info",
        title: "Nuevo horario nocturno",
        message: "A partir del lunes, buses metropolitanos operarán hasta las 10:30 PM desde Sabaneta y Bello.",
        time: "Hace 1 hora",
        busRoute: "Todas las rutas metropolitanas",
        location: "Valle de Aburrá",
        timestamp: Date.now() - 60 * 60 * 1000
    },
    {
        id: 5,
        type: "delay",
        title: "Congestión en la Regional",
        message: "Alta afluencia de vehículos en la Carrera 50. Buses metropolitanos con demora de 10 minutos.",
        time: "Hace 12 minutos",
        busRoute: "Rutas 310, 311, 312",
        location: "La 50 - Centro de Medellín",
        timestamp: Date.now() - 12 * 60 * 1000
    },
    {
        id: 6,
        type: "bus-arriving",
        title: "Llegada a Estación Poblado",
        message: "Bus Ruta Metropolitana 305 aproximándose. Destino final Envigado.",
        time: "Hace 1 minuto",
        busRoute: "Ruta 305",
        location: "Estación Poblado",
        timestamp: Date.now() - 1 * 60 * 1000
    }
];

let currentFilter = "all";
let nextId = 7;

const alertsGrid = document.getElementById("alertsGrid");
const totalAlertsSpan = document.getElementById("totalAlertsCount");
const delayCountSpan = document.getElementById("delayCount");
const arrivingCountSpan = document.getElementById("arrivingCount");
const warningCountSpan = document.getElementById("warningCount");

function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (minutes < 1) return "Hace unos segundos";
    if (minutes < 60) return `Hace ${minutes} min`;
    if (hours < 24) return `Hace ${hours} h`;
    return `Hace ${days} días`;
}

function updateTimes() {
    alerts = alerts.map(alert => ({
        ...alert,
        time: formatRelativeTime(alert.timestamp)
    }));
    renderAlerts();
}

function getBadge(type) {
    const badges = {
        delay: { class: "delay", text: "DEMORA" },
        "bus-arriving": { class: "bus-arriving", text: "PRÓXIMO" },
        warning: { class: "warning", text: "ADVERTENCIA" },
        info: { class: "info", text: "INFORMACIÓN" }
    };
    return badges[type] || badges.info;
}

function renderAlerts() {
    const filtered = currentFilter === "all" 
        ? alerts 
        : alerts.filter(a => a.type === currentFilter);
    
    if (filtered.length === 0) {
        alertsGrid.innerHTML = `
            <div class="no-alerts" style="grid-column: 1/-1;">
                No hay alertas en esta categoría
            </div>
        `;
        updateStats();
        return;
    }
    
    alertsGrid.innerHTML = filtered.map(alert => {
        const badge = getBadge(alert.type);
        return `
            <div class="alert-card ${alert.type}" data-id="${alert.id}">
                <div class="alert-type-indicator"></div>
                <div class="alert-content">
                    <div class="alert-header">
                        <span class="alert-badge ${badge.class}">${badge.text}</span>
                        <span class="alert-time">${alert.time}</span>
                    </div>
                    <div class="alert-title">${alert.title}</div>
                    <div class="alert-message">${alert.message}</div>
                    <div class="alert-bus-info">
                        <span class="bus-route">${alert.busRoute}</span>
                        <span class="bus-location">${alert.location}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
    
    updateStats();
}

function updateStats() {
    totalAlertsSpan.textContent = alerts.length;
    delayCountSpan.textContent = alerts.filter(a => a.type === "delay").length;
    arrivingCountSpan.textContent = alerts.filter(a => a.type === "bus-arriving").length;
    warningCountSpan.textContent = alerts.filter(a => a.type === "warning").length;
}

function addAlert(type, title, message, busRoute, location) {
    const newAlert = {
        id: nextId++,
        type: type,
        title: title,
        message: message,
        time: "Recién ahora",
        busRoute: busRoute,
        location: location,
        timestamp: Date.now()
    };
    
    alerts.unshift(newAlert);
    
    if (alerts.length > 20) {
        alerts = alerts.slice(0, 20);
    }
    
    renderAlerts();
    showNotificationToast(title);
}

function showNotificationToast(title) {
    const toast = document.createElement("div");
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.background = "var(--blue)";
    toast.style.color = "var(--white)";
    toast.style.padding = "0.75rem 1.25rem";
    toast.style.borderRadius = "40px";
    toast.style.fontSize = "0.875rem";
    toast.style.fontWeight = "500";
    toast.style.boxShadow = "var(--shadow-lg)";
    toast.style.zIndex = "1000";
    toast.style.animation = "fadeInUp 0.3s ease-out";
    toast.textContent = `Nueva alerta: ${title}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function simulateRandomAlert() {
    const types = ["delay", "bus-arriving", "warning", "info"];
    const randomType = types[Math.floor(Math.random() * types.length)];
    
    const alertsData = {
        delay: {
            title: "Demora en Autopista Sur",
            message: "Vehículo varado en el sector de Industriales. Buses con retraso de 8 minutos hacia Itagüí.",
            busRoute: "Metroplús Línea 1 y Línea 2",
            location: "Autopista Sur - Industriales"
        },
        "bus-arriving": {
            title: "Aproximación a Estación Bello",
            message: "Bus con dirección Niquía a 3 minutos de la estación.",
            busRoute: `Ruta ${Math.floor(Math.random() * 30) + 300}`,
            location: "Estación Bello"
        },
        warning: {
            title: "Manifestación en La Alpujarra",
            message: "Movilización ciudadana en el centro administrativo. Desvíos en rutas alimentadoras.",
            busRoute: "Rutas 301, 302, 310",
            location: "La Alpujarra - Medellín"
        },
        info: {
            title: "Nueva frecuencia en Ruta 315",
            message: "La ruta Envigado - Sabaneta ahora pasa cada 12 minutos en horas pico.",
            busRoute: "Ruta 315",
            location: "Corredor Envigado - Sabaneta"
        }
    };
    
    const data = alertsData[randomType];
    addAlert(randomType, data.title, data.message, data.busRoute, data.location);
}

function clearAllAlerts() {
    if (alerts.length === 0) return;
    if (confirm("¿Eliminar todas las alertas del historial?")) {
        alerts = [];
        renderAlerts();
    }
}

document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.getAttribute("data-filter");
        renderAlerts();
    });
});

document.getElementById("simulateAlertBtn").addEventListener("click", simulateRandomAlert);
document.getElementById("clearAlertsBtn").addEventListener("click", clearAllAlerts);

setInterval(updateTimes, 60000);

let autoInterval = setInterval(() => {
    simulateRandomAlert();
}, 30000);

renderAlerts();

window.addEventListener("beforeunload", () => {
    if (autoInterval) clearInterval(autoInterval);
});