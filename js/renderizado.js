// js/renderizado.js
// Responsabilidad: Listener de Firebase + orquestación del DOM del tablero

import { db } from './firebase-config.js';
import { ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import {
    iniciarPartidaOficial,
    intentarJugarCarta,
    robarCartaMazo,
    aceptarCastigoStack,
    gritarUno,
    acusarUno,
    registrarTestamento,
    resolverRuleta,
    siguienteJugadorActivo,
    limpiarMano
} from './logica.js';
import { crearCartaVisual } from './cartas-visual.js';
import {
    cerrarModales,
    mostrarSelectorColor,
    mostrarSelectorIntercambio,
    mostrarSelectorRuleta,
    mostrarPantallaFin,
    mostrarModalReglas
} from './modales.js';

// ==========================================
// SESIÓN
// ==========================================
const nombreUsuario = sessionStorage.getItem('usuarioNombre');
const idSala        = sessionStorage.getItem('idSala');

if (!nombreUsuario || !idSala) window.location.href = 'index.html';

// ==========================================
// REFERENCIAS DOM
// ==========================================
const contenedorMano    = document.getElementById('mis-cartas');
const contenedorMesa    = document.getElementById('pila-tirar');
const infoTurno         = document.getElementById('turno-actual');
const infoStack         = document.getElementById('stack-castigo');
const zonaInicio        = document.getElementById('controles-inicio');
const btnComenzar       = document.getElementById('btn-comenzar');
const txtEsperando      = document.getElementById('esperando-host');
const btnUno            = document.getElementById('btn-uno');
const footerMano        = document.getElementById('mi-zona');
const pilaTomar         = document.getElementById('pila-tomar');
const zonaRivales       = document.getElementById('zona-rivales');
const btnAceptarCastigo = document.getElementById('btn-aceptar-castigo');
const infoSentido       = document.getElementById('info-sentido');

// Tamaño total del mazo oficial (para calcular porcentaje restante)
const MAZO_TOTAL = 108;

// Último tamaño conocido del mazo y descarte (para detectar reciclaje)
let ultimoTamanioMazo     = MAZO_TOTAL;
let ultimoTamanioDescarte = 0;

// ==========================================
// BUG 5 FIX: Spam de Robo (Race Condition en mazo)
// Flag que bloquea clics al mazo mientras Firebase procesa el robo anterior.
// Se libera en el finally de pilaTomar.onclick.
// ==========================================
let robandoCarta = false;

// ==========================================
// BUG 6 FIX: Metralleta de Cartas (Race Condition en mano)
// Flag que bloquea clics en cartas de la mano mientras Firebase procesa
// la jugada anterior. Se libera en el finally de renderizarMiMano.
// ==========================================
let jugandoCarta = false;

// ==========================================
// TOAST (expuesto globalmente para logica.js)
// ==========================================
window.mostrarToast = function(mensaje, tipo = "info") {
    const contenedor = document.getElementById('contenedor-toast');
    const toast      = document.createElement('div');
    toast.className  = `toast toast-${tipo}`;
    toast.innerText  = mensaje;
    contenedor.appendChild(toast);
    toast.offsetHeight; // forzar reflow para activar transición
    toast.classList.add('toast-visible');
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3500);
};

// ==========================================
// BOTONES FIJOS
// ==========================================
btnComenzar.onclick = () => {
    btnComenzar.innerText = "Barajando...";
    iniciarPartidaOficial(idSala);
};

btnUno.onclick = () => gritarUno();

const btnReglas = document.getElementById('btn-reglas');
if (btnReglas) {
    btnReglas.onclick = () => mostrarModalReglas();
}

if (btnAceptarCastigo) {
    btnAceptarCastigo.onclick = () => aceptarCastigoStack();
}

// ==========================================
// REFERENCIA PRINCIPAL DE FIREBASE
// (debe declararse antes de los listeners que la usan)
// ==========================================
const salaRef = ref(db, `no_mercy/salas/${idSala}`);

// BUG 5 FIX: Spam de Robo
// El flag robandoCarta bloquea cualquier clic adicional al mazo
// hasta que Firebase confirme el robo anterior (try/finally garantiza la liberación).
pilaTomar.onclick = async () => {
    if (robandoCarta) return;
    robandoCarta = true;
    try {
        const snap = await get(salaRef);
        const data = snap.val();
        if (data?.ruleta_activa && data.ruleta_activa.jugador === nombreUsuario) {
            await resolverRuleta(data.ruleta_activa.color);
            return;
        }
        await robarCartaMazo();
    } finally {
        robandoCarta = false;
    }
};

// Acusar UNO: expuesto globalmente para los botones generados dinámicamente
window.acusarJugador = (nombre) => acusarUno(nombre);

// ==========================================
// BUG 3: TESTAMENTO onDisconnect
// Registrar presencia y testamento al cargar la página
// ==========================================
registrarTestamento();

// Listener de presencia: detectar cuando un jugador se desconecta
// y pasar el turno si era su turno
const presenciaRef = ref(db, `no_mercy/salas/${idSala}/presencia`);
onValue(presenciaRef, async (snap) => {
    const presencia = snap.val() || {};
    const salaSnap  = await get(salaRef);
    const data      = salaSnap.val();
    if (!data) return;

    const orden = data.orden_jugadores || Object.keys(data.jugadores);

    // ==========================================
    // BUG 7 FIX: Prisión del Lobby
    // El listener antes ignoraba todo si el estado no era 'jugando'.
    // Ahora también actúa en estado 'esperando' para migrar el host
    // si se fue antes de que la partida comenzara.
    // ==========================================
    if (data.estado === 'esperando') {
        // Solo actuar si el host se desconectó
        if (presencia[data.host]) return; // el host sigue presente, nada que hacer

        // Encontrar el primer jugador presente que no sea el host actual
        const nuevoHost = orden.find(n => presencia[n] === true && n !== data.host);
        if (!nuevoHost) return; // nadie más está conectado, no hay a quién migrar

        // Solo el nuevo host ejecuta la migración (evitar que todos escriban a la vez)
        if (nuevoHost !== nombreUsuario) return;

        await update(salaRef, { 'host': nombreUsuario });
        window.mostrarToast("¡El host se fue! Ahora eres el anfitrión de la sala. 👑", "info");
        return;
    }

    // Para cualquier estado que no sea 'jugando', no hacer nada más
    if (data.estado !== 'jugando') return;

    // ==========================================
    // BUG 1 FIX: HOST MIGRATION
    // En lugar de que solo el host actúe, el primer jugador ACTIVO Y PRESENTE
    // de la lista asume la responsabilidad de limpiar desconexiones.
    // Esto cubre el caso en que el host mismo se desconecta.
    // ==========================================
    const primerJugadorActivo = orden.find(n =>
        !data.jugadores[n]?.eliminado && presencia[n] === true
    );
    const soyElResponsable = primerJugadorActivo === nombreUsuario;
    if (!soyElResponsable) return; // solo un jugador ejecuta la limpieza

    // Detectar jugadores desconectados (presentes en la sala pero sin presencia activa)
    const desconectados = orden.filter(n =>
        !data.jugadores[n]?.eliminado && !presencia[n]
    );

    if (desconectados.length === 0) return; // nadie se desconectó

    const actualizaciones = {};

    for (const nombreDesconectado of desconectados) {
        // Marcar como eliminado
        actualizaciones[`jugadores/${nombreDesconectado}/eliminado`] = true;

        // BUG 2 FIX: MODALES FANTASMA
        // Limpiar cualquier estado pendiente que le pertenecía al jugador que huyó.
        // Si se fue con un modal abierto (comodín, intercambio, ruleta), limpiar Firebase.
        if (data.comodin_pendiente?.jugador === nombreDesconectado) {
            actualizaciones['comodin_pendiente'] = null;
            // Restaurar color_activo al color de la carta en mesa para no dejar estado corrupto
            actualizaciones['color_activo'] = data.pila_tirar?.color || data.color_activo || 'rojo';
        }
        if (data.intercambio_pendiente?.jugador === nombreDesconectado) {
            actualizaciones['intercambio_pendiente'] = null;
        }
        if (data.ruleta_pendiente?.jugador === nombreDesconectado) {
            actualizaciones['ruleta_pendiente'] = null;
        }
        if (data.ruleta_activa?.jugador === nombreDesconectado) {
            actualizaciones['ruleta_activa'] = null;
        }
        // BUG C FIX: Fantasma del Tira-Color
        // El host migration no limpiaba tira_color_pendiente cuando el jugador
        // abandonaba con el modal abierto, dejando basura permanente en Firebase.
        if (data.tira_color_pendiente?.jugador === nombreDesconectado) {
            actualizaciones['tira_color_pendiente'] = null;
        }
        if (data.robo_activo?.jugador === nombreDesconectado) {
            actualizaciones['robo_activo'] = null;
        }

        window.mostrarToast(`${nombreDesconectado} se desconectó y fue eliminado.`, "warning");
    }

    // Construir jugadores actualizados (con los desconectados ya marcados como eliminados)
    const jugadoresActualizados = { ...data.jugadores };
    desconectados.forEach(n => {
        jugadoresActualizados[n] = { ...jugadoresActualizados[n], eliminado: true };
    });

    // BUG 3 FIX: Sala del Eco
    // Verificar si tras eliminar a los desconectados queda solo 1 jugador activo.
    // Si es así, ese jugador gana la mano automáticamente.
    const activosTrasEliminar = orden.filter(n => !jugadoresActualizados[n]?.eliminado);
    if (activosTrasEliminar.length === 1) {
        const { terminarMano } = await import('./logica.js');
        await terminarMano(idSala, activosTrasEliminar[0], data, actualizaciones);
        return;
    }

    // Pasar turno si el jugador actual era uno de los desconectados
    const turnoActual = data.turno_actual;
    if (desconectados.includes(turnoActual)) {
        const indexActual = orden.indexOf(turnoActual);
        const indexSig    = siguienteJugadorActivo(orden, indexActual, data.sentido, jugadoresActualizados);
        actualizaciones['turno_actual'] = orden[indexSig];
    }

    // Si el host se desconectó, migrar el host al primer jugador activo presente
    if (!presencia[data.host]) {
        actualizaciones['host'] = nombreUsuario; // soy el primer activo presente
        window.mostrarToast("¡Eres el nuevo anfitrión de la sala!", "info");
    }

    await update(salaRef, actualizaciones);
});

// ==========================================
// LISTENER PRINCIPAL DE FIREBASE
// ==========================================

onValue(salaRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    const numJugadores = data.jugadores ? Object.keys(data.jugadores).length : 0;

    // ---- FIN DE JUEGO ----
    if (data.estado === 'fin_juego') {
        cerrarModales();
        mostrarPantallaFin(data, true, nombreUsuario, idSala);
        return;
    }

    // ---- FIN DE MANO ----
    if (data.estado === 'fin_mano') {
        cerrarModales();
        mostrarPantallaFin(data, false, nombreUsuario, idSala);
        return;
    }

    // ---- SALA DE ESPERA ----
    if (data.estado !== 'jugando') {
        zonaInicio.style.display = 'flex';
        contenedorMesa.innerHTML = '';
        contenedorMano.innerHTML = '';
        infoTurno.innerText      = `Sala: ${idSala.toUpperCase()}`;
        if (zonaRivales) zonaRivales.innerHTML = '';

        if (data.host === nombreUsuario) {
            btnComenzar.style.display  = 'inline-block';
            txtEsperando.style.display = 'none';
            btnComenzar.innerText      = `Empezar (${numJugadores} conectados)`;
        } else {
            btnComenzar.style.display  = 'none';
            txtEsperando.style.display = 'block';
            txtEsperando.innerText     = `Esperando al host... (${numJugadores} conectados)`;
        }
        return;
    }

    // ---- JUEGO EN CURSO ----
    zonaInicio.style.display = 'none';

    // FIX BUG 2: Cerrar modal-fin cuando el estado vuelve a 'jugando'
    // (para rivales que no son el host y no tienen el botón de siguiente mano)
    const modalFin = document.getElementById('modal-fin');
    if (modalFin) modalFin.remove();

    // Cerrar modales que ya no aplican
    if (!data.comodin_pendiente)    { const m = document.getElementById('modal-color');       if (m) m.remove(); }
    if (!data.intercambio_pendiente){ const m = document.getElementById('modal-intercambio'); if (m) m.remove(); }
    if (!data.ruleta_pendiente)     { const m = document.getElementById('modal-ruleta');      if (m) m.remove(); }
    if (!data.tira_color_pendiente) { const m = document.getElementById('modal-tira-color'); if (m) m.remove(); }

    // Tamaños actuales del mazo y descarte
    const mazoArr     = data.mazo
        ? (Array.isArray(data.mazo) ? data.mazo : Object.values(data.mazo)).filter(Boolean)
        : [];
    const descarteArr = data.pila_descarte
        ? (Array.isArray(data.pila_descarte) ? data.pila_descarte : Object.values(data.pila_descarte)).filter(Boolean)
        : [];

    const tamanioMazoActual     = mazoArr.length;
    const tamanioDescarteActual = descarteArr.length;

    // Detectar reciclaje: el mazo creció Y el descarte bajó drásticamente
    const huboReciclaje =
        tamanioMazoActual > ultimoTamanioMazo + 5 &&
        tamanioDescarteActual < ultimoTamanioDescarte - 5;

    if (huboReciclaje) {
        animarBarajeo();
    }

    ultimoTamanioMazo     = tamanioMazoActual;
    ultimoTamanioDescarte = tamanioDescarteActual;

    // Actualizar grosor visual del mazo
    actualizarGrusorMazo(tamanioMazoActual);

    // Carta en mesa + capas de descarte
    if (data.pila_tirar) {
        contenedorMesa.innerHTML = '';
        actualizarCapasDescarte(tamanioDescarteActual);
        const cartaMesa = { ...data.pila_tirar };
        if (data.color_activo && cartaMesa.tipo === 'comodin') {
            cartaMesa.color_elegido = data.color_activo;
        }
        contenedorMesa.appendChild(crearCartaVisual(cartaMesa));
    }

    // Indicador de sentido
    if (infoSentido) {
        infoSentido.innerText = data.sentido === 'derecha' ? '→' : '←';
    }

    // Mi mano
    const miJugador  = data.jugadores?.[nombreUsuario];
    const miManoBruta = miJugador?.mano ?? null;
    const miMano     = miManoBruta
        ? (Array.isArray(miManoBruta) ? miManoBruta : Object.values(miManoBruta)).filter(Boolean)
        : [];

    const estoyEliminado = miJugador?.eliminado === true;

    renderizarMiMano(miMano, estoyEliminado);
    actualizarContadorCartas(miMano.length, estoyEliminado);

    // Botón UNO: visible con 1 carta (UNO normal) o 2 cartas (UNO preventivo)
    // Con 2 cartas muestra el escudo para indicar que es preventivo
    const puedeGritarUno = (miMano.length === 1 || miMano.length === 2) && !estoyEliminado;
    btnUno.classList.toggle('oculta', !puedeGritarUno);
    if (miMano.length === 2 && !estoyEliminado) {
        btnUno.textContent = '🛡️UNO';
        btnUno.title = 'UNO preventivo: protégete antes de tirar tu penúltima carta';
    } else {
        btnUno.textContent = '¡UNO!';
        btnUno.title = '';
    }

    // Info de turno
    const esMiTurno = data.turno_actual === nombreUsuario && !estoyEliminado;
    if (estoyEliminado) {
        infoTurno.innerText  = "😵 Eliminado esta mano";
        infoTurno.style.color = "#e74c3c";
        footerMano.classList.remove('mi-turno');
    } else if (esMiTurno) {
        infoTurno.innerText  = "¡ES TU TURNO!";
        infoTurno.style.color = "#2ecc71";
        footerMano.classList.add('mi-turno');
    } else {
        infoTurno.innerText  = `Turno de ${data.turno_actual || '...'}`;
        infoTurno.style.color = "white";
        footerMano.classList.remove('mi-turno');
    }

    // Stack / castigo
    if (data.stack > 0) {
        infoStack.innerText = `+${data.stack} ☠️`;
        infoStack.classList.remove('oculta');
        if (btnAceptarCastigo) {
            btnAceptarCastigo.classList.toggle('oculta', !esMiTurno);
        }
    } else {
        infoStack.classList.add('oculta');
        if (btnAceptarCastigo) btnAceptarCastigo.classList.add('oculta');
    }

    // Rivales
    renderizarRivales(data);

    // ---- MODALES ESPECIALES ----
    if (data.comodin_pendiente && data.comodin_pendiente.jugador === nombreUsuario) {
        mostrarSelectorColor(data.comodin_pendiente.carta);
    }
    if (data.intercambio_pendiente && data.intercambio_pendiente.jugador === nombreUsuario) {
        mostrarSelectorIntercambio(data, nombreUsuario);
    }
    if (data.ruleta_pendiente && data.ruleta_pendiente.jugador === nombreUsuario) {
        mostrarSelectorRuleta();
    }
    if (data.tira_color_pendiente && data.tira_color_pendiente.jugador === nombreUsuario) {
        mostrarModalTiraColor(data.tira_color_pendiente, miMano, data);
    }
});

// ==========================================
// SCROLL CON ARRASTRE EN LA MANO (mouse + touch)
// ==========================================
let isDragging   = false;
let startX       = 0;
let scrollLeft   = 0;
let dragMoved    = false; // para distinguir clic de arrastre

contenedorMano.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragMoved  = false;
    startX     = e.pageX - contenedorMano.offsetLeft;
    scrollLeft = contenedorMano.scrollLeft;
    contenedorMano.style.cursor = 'grabbing';
    contenedorMano.style.userSelect = 'none';
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    contenedorMano.style.cursor = 'grab';
    contenedorMano.style.userSelect = '';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x    = e.pageX - contenedorMano.offsetLeft;
    const walk = (x - startX) * 1.5; // velocidad de arrastre
    if (Math.abs(walk) > 5) dragMoved = true;
    contenedorMano.scrollLeft = scrollLeft - walk;
});

// Touch: soporte nativo (ya funciona con overflow-x: auto en móvil)
// Pero bloqueamos el clic si hubo arrastre
contenedorMano.addEventListener('click', (e) => {
    if (dragMoved) {
        e.stopPropagation();
        dragMoved = false;
    }
}, true);

// ==========================================
// RENDERIZAR MI MANO
// ==========================================
function renderizarMiMano(mano, estoyEliminado) {
    contenedorMano.innerHTML = '';
    if (estoyEliminado) {
        contenedorMano.innerHTML = '<p style="color:#e74c3c; text-align:center; padding:1rem;">Eliminado esta mano 😵</p>';
        return;
    }
    mano.forEach(carta => {
        if (!carta) return;
        const cartaDiv = crearCartaVisual(carta);
        // BUG 6 FIX: Metralleta de Cartas
        // El flag jugandoCarta bloquea cualquier clic adicional en la mano
        // hasta que Firebase confirme la jugada anterior (try/finally garantiza la liberación).
        cartaDiv.onclick = async () => {
            if (dragMoved) return;    // ignorar clic si fue arrastre
            if (jugandoCarta) return; // bloquear si ya hay una jugada en vuelo
            jugandoCarta = true;
            try {
                await intentarJugarCarta(carta);
            } finally {
                jugandoCarta = false;
            }
        };
        contenedorMano.appendChild(cartaDiv);
    });
}

// ==========================================
// BUG 4 FIX: Doble Clic Nervioso
// Flag global que bloquea cualquier clic en el modal Tira Color
// hasta que Firebase confirme que la carta anterior ya fue procesada.
// ==========================================
let procesandoCartaTiraColor = false;

// ==========================================
// MODAL TIRA COLOR (descarte carta por carta en orden elegido)
// ==========================================
function mostrarModalTiraColor(pendiente, miMano, data) {
    if (document.getElementById('modal-tira-color')) return;

    const colorCarta    = pendiente.color;
    const cartasColor   = miMano.filter(c => c.color === colorCarta);
    // BUG B FIX: Tira-Color Corrupto
    // Antes se guardaban índices numéricos en 'descartadas'. Al descartar una carta
    // la mano se encoge en Firebase, así que los índices se desfasan tras un F5/recarga.
    // Solución: guardar la carta completa (objeto {color, valor}) en 'descartadas'
    // y filtrar por identidad de valor, no por posición.
    const yaDescartadas = pendiente.descartadas || [];

    // Construir una copia mutable de las ya descartadas para consumirlas una a una
    // (permite manejar duplicados: si hay dos "rojo-5", solo se oculta el que ya se tiró)
    const pendientesDeConsumir = [...yaDescartadas];
    const cartasRestantes = cartasColor.filter(c => {
        const idxEnPendientes = pendientesDeConsumir.findIndex(
            d => d && typeof d === 'object' && d.color === c.color && d.valor === c.valor
        );
        if (idxEnPendientes !== -1) {
            pendientesDeConsumir.splice(idxEnPendientes, 1); // consumir una sola instancia
            return false; // esta carta ya fue descartada
        }
        return true; // esta carta aún está disponible
    });

    if (cartasRestantes.length === 0) {
        // No quedan cartas del color: finalizar automáticamente
        finalizarTiraColor(pendiente, data);
        return;
    }

    const modal = document.createElement('div');
    modal.id        = 'modal-tira-color';
    modal.className = 'modal-overlay';

    const cartasHTML = cartasRestantes.map((carta, i) => {
        const colorClass = carta.color || 'negro';
        const valorLabel = carta.valor || '';
        return `<button class="btn-carta-tira carta-${colorClass}" data-index="${i}">
            ${valorLabel}
        </button>`;
    }).join('');

    modal.innerHTML = `
        <div class="modal-caja">
            <h2>🎨 Tira Color: <span style="color:var(--color-${colorCarta}, #fff)">${colorCarta}</span></h2>
            <p style="font-size:0.85rem; color:#bdc3c7;">
                Elige el orden en que descartas tus cartas ${colorCarta}.<br>
                La última que tires quedará encima de la pila.
            </p>
            <div class="lista-cartas-tira" id="lista-tira-color">
                ${cartasHTML}
            </div>
            <button class="btn-castigo" id="btn-terminar-tira" style="margin-top:12px;">
                ✅ Terminar (quedan ${cartasRestantes.length})
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    // Clic en carta: descartarla una por una
    // BUG 4 FIX: usar la flag procesandoCartaTiraColor para bloquear dobles clics.
    // El flag se activa al primer clic y solo se libera cuando Firebase confirma el update.
    modal.querySelectorAll('.btn-carta-tira').forEach((btn, i) => {
        btn.addEventListener('click', async () => {
            if (procesandoCartaTiraColor) return; // bloquear si ya hay una operación en curso
            procesandoCartaTiraColor = true;

            // Deshabilitar visualmente TODOS los botones de carta mientras se procesa
            modal.querySelectorAll('.btn-carta-tira').forEach(b => {
                b.disabled = true;
                b.style.opacity = '0.3';
            });

            try {
                await descartarCartaTiraColor(cartasRestantes[i], pendiente, data);
            } finally {
                // Liberar el flag siempre, incluso si hubo error
                procesandoCartaTiraColor = false;
            }
        });
    });

    // Botón terminar: finalizar aunque queden cartas (el jugador elige cuántas descartar)
    document.getElementById('btn-terminar-tira').addEventListener('click', () => {
        if (procesandoCartaTiraColor) return; // no terminar si hay una carta en vuelo
        modal.remove();
        finalizarTiraColor(pendiente, data);
    });
}

// Descarta UNA carta del tira_color y actualiza Firebase
async function descartarCartaTiraColor(carta, pendiente, data) {
    const idSala = sessionStorage.getItem('idSala');
    const snap   = await get(salaRef);
    const d      = snap.val();

    const miManoActual = limpiarMano(d.jugadores[nombreUsuario]?.mano);
    const descarte     = limpiarMano(d.pila_descarte);

    // Quitar UNA instancia de esta carta de la mano
    const idx = miManoActual.findIndex(c => c.color === carta.color && c.valor === carta.valor);
    if (idx !== -1) miManoActual.splice(idx, 1);

    // Mover la carta actual a la pila de descarte (la anterior pila_tirar va al descarte)
    const cartaAnterior = d.pila_tirar;
    if (cartaAnterior) descarte.push(cartaAnterior);

    // BUG B FIX: guardar la carta completa (objeto) en 'descartadas', NO el índice numérico.
    // Si guardamos el índice, al recargar la página la mano ya se encogió en Firebase
    // y el índice apunta a una carta diferente, ocultando la carta equivocada.
    const actualizaciones = {
        [`jugadores/${nombreUsuario}/mano`]: miManoActual,
        'pila_tirar':    carta,
        'color_activo':  carta.color,
        'pila_descarte': descarte,
        'tira_color_pendiente': {
            ...pendiente,
            descartadas: [...(pendiente.descartadas || []), { color: carta.color, valor: carta.valor }]
        }
    };

    // Si la mano quedó vacía: terminar mano
    if (miManoActual.length === 0) {
        const modalTira = document.getElementById('modal-tira-color');
        if (modalTira) modalTira.remove();
        const { terminarMano } = await import('./logica.js');
        actualizaciones['tira_color_pendiente'] = null;
        await terminarMano(idSala, nombreUsuario, d, actualizaciones);
        return;
    }

    await update(salaRef, actualizaciones);

    // Actualizar el botón de terminar con el conteo restante
    const btnTerminar = document.getElementById('btn-terminar-tira');
    if (btnTerminar) {
        const restantes = miManoActual.filter(c => c.color === pendiente.color).length;
        btnTerminar.textContent = `✅ Terminar (quedan ${restantes})`;
        if (restantes === 0) btnTerminar.click(); // auto-terminar si no quedan
    }
}

// ==========================================
// BUG 2 FIX: Tira Color Amnésico
// Finaliza el tira_color leyendo la ÚLTIMA carta descartada (pila_tirar actual)
// y aplicando su efecto si es una carta de acción (salta, reversa, toma2, toma4, salta_todos).
// Antes solo pasaba el turno a ciegas, ignorando el poder de la última carta.
// ==========================================
async function finalizarTiraColor(pendiente, data) {
    const idSala = sessionStorage.getItem('idSala');
    const snap   = await get(salaRef);
    const d      = snap.val();
    const orden  = d.orden_jugadores || Object.keys(d.jugadores);
    const idx    = orden.indexOf(nombreUsuario);
    let sentido  = d.sentido;

    // Leer la última carta que quedó en la pila (la que el jugador tiró al final)
    const ultimaCarta = d.pila_tirar;
    const valorUltima = ultimaCarta?.valor;

    const actualizaciones = {
        'tira_color_pendiente': null,
        'stack':                0,
        'stack_tipo':           null
    };

    const jugadoresActivos = orden.filter(n => !d.jugadores[n]?.eliminado);

    // Aplicar el efecto de la última carta descartada
    if (valorUltima === 'salta') {
        // Salta: el siguiente jugador pierde su turno
        if (jugadoresActivos.length === 2) {
            // En 1v1 el salta actúa como "vuelves a jugar"
            actualizaciones['turno_actual'] = nombreUsuario;
        } else {
            const idxSig = siguienteJugadorActivo(orden, idx, sentido, d.jugadores, 2);
            actualizaciones['turno_actual'] = orden[idxSig];
        }
        window.mostrarToast("¡Última carta: Salta! El siguiente jugador pierde su turno.", "info");

    } else if (valorUltima === 'reversa') {
        // Reversa: cambia el sentido
        if (jugadoresActivos.length === 2) {
            actualizaciones['turno_actual'] = nombreUsuario;
        } else {
            sentido = sentido === 'derecha' ? 'izquierda' : 'derecha';
            actualizaciones['sentido']      = sentido;
            const idxSig = siguienteJugadorActivo(orden, idx, sentido, d.jugadores);
            actualizaciones['turno_actual'] = orden[idxSig];
        }
        window.mostrarToast("¡Última carta: Reversa! El sentido del juego cambió.", "info");

    } else if (valorUltima === 'toma2') {
        // Toma 2: el siguiente jugador debe tomar 2 cartas (se suma al stack)
        const idxSig = siguienteJugadorActivo(orden, idx, sentido, d.jugadores);
        actualizaciones['stack']        = (d.stack || 0) + 2;
        actualizaciones['stack_tipo']   = 'toma2';
        actualizaciones['turno_actual'] = orden[idxSig];
        window.mostrarToast("¡Última carta: Toma 2! El siguiente jugador debe tomar 2 cartas.", "info");

    } else if (valorUltima === 'toma4') {
        // Toma 4: el siguiente jugador debe tomar 4 cartas (se suma al stack)
        const idxSig = siguienteJugadorActivo(orden, idx, sentido, d.jugadores);
        actualizaciones['stack']        = (d.stack || 0) + 4;
        actualizaciones['stack_tipo']   = 'toma4';
        actualizaciones['turno_actual'] = orden[idxSig];
        window.mostrarToast("¡Última carta: Toma 4! El siguiente jugador debe tomar 4 cartas.", "info");

    } else if (valorUltima === 'salta_todos') {
        // Salta a todos: el jugador vuelve a jugar
        actualizaciones['turno_actual'] = nombreUsuario;
        window.mostrarToast("¡Última carta: Salta a Todos! Juegas de nuevo.", "info");

    } else {
        // Carta normal (número): simplemente pasar el turno
        const idxSig = siguienteJugadorActivo(orden, idx, sentido, d.jugadores);
        actualizaciones['turno_actual'] = orden[idxSig];
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// GROSOR VISUAL DEL MAZO
// Simula el grosor de la baraja usando box-shadow apiladas.
// A más cartas → más capas de sombra hacia abajo-izquierda.
// ==========================================
function actualizarGrusorMazo(cantidadCartas) {
    // Niveles: 0-10 cartas = muy delgado, 11-30 = delgado, 31-60 = medio, 61-90 = grueso, 91+ = lleno
    const porcentaje = Math.min(cantidadCartas / MAZO_TOTAL, 1);

    // Número de capas de sombra (0 a 8)
    const capas = Math.round(porcentaje * 8);

    // Construir box-shadow apiladas (cada capa desplazada 2px hacia abajo-izquierda)
    let sombras = [];
    for (let i = 1; i <= capas; i++) {
        sombras.push(`-${i * 2}px ${i * 2}px 0px #111`);
    }
    // Sombra de profundidad final
    sombras.push(`-${(capas + 1) * 2}px ${(capas + 1) * 2}px 15px rgba(0,0,0,0.7)`);

    pilaTomar.style.boxShadow = sombras.join(', ');

    // Actualizar o crear el contador de cartas
    let contador = pilaTomar.querySelector('.mazo-contador');
    if (!contador) {
        contador = document.createElement('div');
        contador.className = 'mazo-contador';
        pilaTomar.appendChild(contador);
    }
    contador.textContent = cantidadCartas > 0 ? `${cantidadCartas} cartas` : 'Vacío';
    contador.style.color = cantidadCartas <= 10
        ? 'rgba(231,76,60,0.8)'   // rojo si quedan pocas
        : 'rgba(255,255,255,0.6)';
}

// ==========================================
// CAPAS VISUALES DE LA PILA DE DESCARTE
// Muestra capas fantasma detrás de la carta superior
// para simular que la pila va creciendo.
// ==========================================
function actualizarCapasDescarte(cantidadCartas) {
    // Eliminar capas anteriores
    contenedorMesa.querySelectorAll('.descarte-capa').forEach(c => c.remove());
    const contadorViejo = contenedorMesa.querySelector('.descarte-contador');
    if (contadorViejo) contadorViejo.remove();

    if (cantidadCartas === 0) return;

    // Número de capas visibles (máximo 5)
    const numCapas = Math.min(Math.ceil(cantidadCartas / 8), 5);

    // Insertar capas ANTES de la carta (para que queden detrás)
    for (let i = numCapas; i >= 1; i--) {
        const capa = document.createElement('div');
        capa.className = 'descarte-capa';
        // Cada capa desplazada ligeramente con rotación aleatoria fija
        const rotaciones = [3, -5, 7, -3, 5];
        const desplazX   = [3, -4, 6, -2, 4];
        const desplazY   = [-2, 3, -4, 2, -3];
        const rot  = rotaciones[(i - 1) % rotaciones.length];
        const dx   = desplazX[(i - 1) % desplazX.length];
        const dy   = desplazY[(i - 1) % desplazY.length];
        capa.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
        capa.style.zIndex    = -i;
        capa.style.opacity   = 0.6 + (i / numCapas) * 0.3;
        contenedorMesa.insertBefore(capa, contenedorMesa.firstChild);
    }

    // Contador de cartas en el descarte
    const contador = document.createElement('div');
    contador.className   = 'descarte-contador';
    contador.textContent = `${cantidadCartas} descartadas`;
    contenedorMesa.appendChild(contador);
}

// ==========================================
// ANIMACIÓN DE BARAJEO
// Cuando el descarte se recicla al mazo, varias cartas
// "vuelan" desde la pila de descarte hacia el mazo.
// ==========================================
function animarBarajeo() {
    const rectDescarte = contenedorMesa.getBoundingClientRect();
    const rectMazo     = pilaTomar.getBoundingClientRect();

    // Vector de desplazamiento desde descarte → mazo
    const dx = rectMazo.left - rectDescarte.left + (rectMazo.width  - rectDescarte.width)  / 2;
    const dy = rectMazo.top  - rectDescarte.top  + (rectMazo.height - rectDescarte.height) / 2;

    const numCartas = 6; // cartas animadas
    const rotaciones = [-20, 15, -10, 25, -15, 10];

    for (let i = 0; i < numCartas; i++) {
        const carta = document.createElement('div');
        carta.className = 'carta-barajeo';
        carta.innerHTML = `<div class="logo-reverso">NO<br><span style="color:#ff3b30">MERCY</span></div>`;

        // Posición inicial: encima de la pila de descarte
        carta.style.left = `${rectDescarte.left + window.scrollX}px`;
        carta.style.top  = `${rectDescarte.top  + window.scrollY}px`;

        // Variables CSS para la animación
        const jitter = (Math.random() - 0.5) * 30;
        carta.style.setProperty('--dx',  `${dx + jitter}px`);
        carta.style.setProperty('--dy',  `${dy + jitter}px`);
        carta.style.setProperty('--rot', `${rotaciones[i % rotaciones.length]}deg`);

        // Retraso escalonado para efecto de barajeo
        carta.style.animationDelay = `${i * 70}ms`;

        document.body.appendChild(carta);

        // Eliminar la carta del DOM al terminar la animación
        carta.addEventListener('animationend', () => carta.remove(), { once: true });
    }

    // Pulso en el mazo al recibir las cartas
    setTimeout(() => {
        pilaTomar.classList.add('mazo-barajeo-pulso');
        pilaTomar.addEventListener('animationend', () => {
            pilaTomar.classList.remove('mazo-barajeo-pulso');
        }, { once: true });
    }, numCartas * 70 + 300);

    window.mostrarToast("¡Se barajó la pila de descarte! 🔀", "info");
}

// ==========================================
// CONTADOR DE CARTAS EN MANO (con colores de peligro/emoción)
// ==========================================
let ultimaCantidadCartas = -1;

function actualizarContadorCartas(cantidad, estoyEliminado) {
    const contenedor = document.getElementById('contador-cartas');
    const numSpan    = document.getElementById('num-cartas');
    if (!contenedor || !numSpan) return;

    // Animación de rebote solo cuando cambia el número
    if (cantidad !== ultimaCantidadCartas) {
        numSpan.classList.remove('num-cartas-rebote');
        // Forzar reflow para reiniciar la animación
        void numSpan.offsetWidth;
        numSpan.classList.add('num-cartas-rebote');
        ultimaCantidadCartas = cantidad;
    }

    numSpan.textContent = cantidad;

    // Quitar todas las clases de estado anteriores
    contenedor.classList.remove(
        'estado-uno', 'estado-seguro', 'estado-medio',
        'estado-alerta', 'estado-peligro', 'estado-critico'
    );

    if (estoyEliminado) return; // sin estado si está eliminado

    // Asignar clase según cantidad
    if (cantidad === 1)              contenedor.classList.add('estado-uno');
    else if (cantidad <= 4)          contenedor.classList.add('estado-seguro');
    else if (cantidad <= 9)          contenedor.classList.add('estado-medio');
    else if (cantidad <= 14)         contenedor.classList.add('estado-alerta');
    else if (cantidad <= 19)         contenedor.classList.add('estado-peligro');
    else                             contenedor.classList.add('estado-critico');
}

// ==========================================
// RENDERIZAR RIVALES
// ==========================================
function renderizarRivales(data) {
    if (!zonaRivales) return;
    zonaRivales.innerHTML = '';

    const orden = data.orden_jugadores || Object.keys(data.jugadores);
    orden.forEach(nombre => {
        if (nombre === nombreUsuario) return;

        const jugador  = data.jugadores[nombre];
        const mano     = jugador?.mano
            ? (Array.isArray(jugador.mano) ? jugador.mano : Object.values(jugador.mano)).filter(Boolean)
            : [];
        const esTurno  = data.turno_actual === nombre;
        const eliminado = jugador?.eliminado === true;
        const tieneUno = mano.length === 1 && !eliminado;

        const div = document.createElement('div');
        div.className = `rival-card ${esTurno ? 'rival-turno' : ''} ${eliminado ? 'rival-eliminado' : ''}`;
        div.innerHTML = `
            <div class="rival-nombre">${nombre} ${eliminado ? '💀' : ''} ${esTurno ? '▶' : ''}</div>
            <div class="rival-cartas">${mano.length} carta${mano.length !== 1 ? 's' : ''}</div>
            <div class="rival-puntos">⭐ ${jugador?.puntos || 0} pts</div>
            ${tieneUno ? `<button class="btn-acusar" data-nombre="${nombre}">¡UNO! 😈</button>` : ''}
        `;

        // FIX: event listener directo en lugar de onclick inline con window.acusarJugador
        if (tieneUno) {
            div.querySelector('.btn-acusar').addEventListener('click', () => acusarUno(nombre));
        }

        zonaRivales.appendChild(div);
    });
}
