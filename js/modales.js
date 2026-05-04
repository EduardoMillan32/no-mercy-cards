// js/modales.js
// Responsabilidad: Crear, mostrar y destruir todos los modales del juego
import { seleccionarColor, resolverRuleta, intercambiarMano, iniciarPartidaOficial } from './logica.js';

// ==========================================
// CERRAR TODOS LOS MODALES ACTIVOS
// ==========================================
export function cerrarModales() {
    ['modal-color', 'modal-intercambio', 'modal-ruleta', 'modal-fin', 'modal-reglas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
}

// ==========================================
// MODAL: REGLAS DEL JUEGO
// ==========================================
export function mostrarModalReglas() {
    if (document.getElementById('modal-reglas')) return;

    const modal = document.createElement('div');
    modal.id        = 'modal-reglas';
    modal.className = 'modal-overlay';
    
    // Contenido extraído del manual oficial
    modal.innerHTML = `
        <div class="modal-caja scrollable">
            <span id="cerrar-reglas" style="float: right; font-size: 2.2rem; cursor: pointer; color: #e74c3c; line-height: 0.5;">&times;</span>
            <h2 style="color: var(--gold); text-align: center; margin-top: 0;">📜 Reglas NO MERCY</h2>
            
            <h3 style="color: #3498db;">Reglas Especiales</h3>
            <ul style="font-size: 0.9rem; color: #ecf0f1; padding-left: 15px;">
                <li><strong style="color: #e74c3c;">Apilar:</strong> Si te tiran una carta de tomar (+2, +4, +6, +10), puedes pasar el castigo tirando una igual o mayor. ¡El último que no tenga carta, se lleva todo!</li>
                <li><strong style="color: #e74c3c;">Regla Piedad:</strong> Si un jugador acumula 25 cartas o más en su mano, queda eliminado de la partida.</li>
            </ul>

            <h3 style="color: #2ecc71;">Cartas de Acción</h3>
            <ul style="font-size: 0.9rem; color: #ecf0f1; padding-left: 15px; line-height: 1.4;">
                <li><strong>Carta 7:</strong> DEBES intercambiar tu mano con el jugador que elijas.</li>
                <li><strong>Carta 0:</strong> TODOS pasan su mano al siguiente jugador en el sentido actual.</li>
                <li><strong>Tira Color (Cartas cayendo):</strong> Descartas todas las cartas de tu mano que coincidan con el color de esta carta.</li>
                <li><strong>Salta a Todos (Flecha circular):</strong> Te saltas a todos los jugadores y vuelves a jugar de inmediato.</li>
            </ul>

            <h3 style="color: #9b59b6;">Comodines Oscuros</h3>
            <ul style="font-size: 0.9rem; color: #ecf0f1; padding-left: 15px; line-height: 1.4;">
                <li><strong>Reversa +4:</strong> Cambia el sentido y el siguiente roba 4. (En 1v1, el castigo te rebota a ti).</li>
                <li><strong>Toma 6 y Toma 10:</strong> Obligan al siguiente jugador a tomar esa cantidad y pierden turno.</li>
                <li><strong>Ruleta de Color:</strong> Pasa el turno. El afectado elige un color y debe robar cartas del mazo hasta encontrar una de ese color.</li>
            </ul>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('cerrar-reglas').addEventListener('click', () => {
        modal.remove();
    });

    // Cerrar también al hacer clic en el overlay (fuera de la caja)
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// ==========================================
// MODAL: SELECTOR DE COLOR (comodín)
// ==========================================
export function mostrarSelectorColor(cartaComodin) {
    if (document.getElementById('modal-color')) return;

    const modal = document.createElement('div');
    modal.id        = 'modal-color';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-caja">
            <h2>Elige un color</h2>
            <div class="selector-colores">
                <button class="btn-color rojo"      data-color="rojo">🔴 Rojo</button>
                <button class="btn-color azul"      data-color="azul">🔵 Azul</button>
                <button class="btn-color verde"     data-color="verde">🟢 Verde</button>
                <button class="btn-color amarillo"  data-color="amarillo">🟡 Amarillo</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // FIX: usar event delegation en lugar de window.elegirColor global
    modal.querySelectorAll('.btn-color').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            modal.remove();
            seleccionarColor(color, cartaComodin);
        });
    });
}

// ==========================================
// MODAL: SELECTOR DE INTERCAMBIO (carta 7)
// ==========================================
// BUG #2 FIX: función async para poder usar await cuando no hay rivales activos
export async function mostrarSelectorIntercambio(data, nombreUsuario) {
    if (document.getElementById('modal-intercambio')) return;

    const orden          = data.orden_jugadores || Object.keys(data.jugadores);
    const rivalesActivos = orden.filter(n => n !== nombreUsuario && !data.jugadores[n]?.eliminado);

    // BUG #2 FIX: si no hay rivales activos, resolver el pendiente y pasar turno
    if (rivalesActivos.length === 0) {
        const { db }              = await import('./firebase-config.js');
        const { ref, get, update } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
        const { siguienteJugadorActivo } = await import('./logica.js');
        const idSala  = sessionStorage.getItem('idSala');
        const salaRef = ref(db, `no_mercy/salas/${idSala}`);
        const snap    = await get(salaRef);
        const d       = snap.val();
        const ordenActual = d.orden_jugadores || Object.keys(d.jugadores);
        const idx     = ordenActual.indexOf(nombreUsuario);
        const idxSig  = siguienteJugadorActivo(ordenActual, idx, d.sentido, d.jugadores);
        await update(salaRef, {
            'intercambio_pendiente': null,
            'turno_actual': ordenActual[idxSig]
        });
        window.mostrarToast("No hay rivales activos para intercambiar. Turno pasado.", "warning");
        return;
    }

    const modal = document.createElement('div');
    modal.id        = 'modal-intercambio';
    modal.className = 'modal-overlay';

    const botonesHTML = rivalesActivos.map(n => {
        const mano     = data.jugadores[n]?.mano;
        const numCartas = mano
            ? (Array.isArray(mano) ? mano : Object.values(mano)).filter(Boolean).length
            : 0;
        return `<button class="btn-rival-intercambio" data-nombre="${n}">
            ${n} (${numCartas} cartas)
        </button>`;
    }).join('');

    modal.innerHTML = `
        <div class="modal-caja">
            <h2>¡Carta 7! ¿Con quién intercambias?</h2>
            <div class="lista-rivales">${botonesHTML}</div>
        </div>
    `;
    document.body.appendChild(modal);

    // FIX: event delegation, sin funciones globales
    modal.querySelectorAll('.btn-rival-intercambio').forEach(btn => {
        btn.addEventListener('click', () => {
            const nombreObjetivo = btn.dataset.nombre;
            modal.remove();
            // FIX: usar intercambiarMano centralizado (ya incluye pasar turno)
            intercambiarMano(nombreObjetivo);
        });
    });
}

// ==========================================
// MODAL: SELECTOR DE RULETA (elegir color)
// ==========================================
export function mostrarSelectorRuleta() {
    if (document.getElementById('modal-ruleta')) return;

    const modal = document.createElement('div');
    modal.id        = 'modal-ruleta';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-caja">
            <h2>🎰 Ruleta de Color</h2>
            <p>Elige un color. Robarás cartas hasta encontrar una de ese color.</p>
            <div class="selector-colores">
                <button class="btn-color rojo"     data-color="rojo">🔴 Rojo</button>
                <button class="btn-color azul"     data-color="azul">🔵 Azul</button>
                <button class="btn-color verde"    data-color="verde">🟢 Verde</button>
                <button class="btn-color amarillo" data-color="amarillo">🟡 Amarillo</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // FIX: event delegation, sin funciones globales
    modal.querySelectorAll('.btn-color').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            modal.remove();
            resolverRuleta(color);
        });
    });
}

// ==========================================
// PANTALLA FIN DE MANO / FIN DE JUEGO
// ==========================================
export function mostrarPantallaFin(data, esFinJuego, nombreUsuario, idSala) {
    if (document.getElementById('modal-fin')) return;

    const ganador      = data.ganador || data.campeon || '?';
    const puntosGanados = data.puntos_ganados_mano || 0;
    const orden        = data.orden_jugadores || Object.keys(data.jugadores || {});

    const tablaHTML = orden.map(n => {
        const j = data.jugadores?.[n] || {};
        return `<tr>
            <td>${n === ganador ? '🏆 ' : ''}${n}</td>
            <td>${j.puntos || 0} pts</td>
        </tr>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id        = 'modal-fin';
    modal.className = 'modal-overlay';

    const esHost = data.host === nombreUsuario;

    if (esFinJuego) {
        modal.innerHTML = `
            <div class="modal-caja modal-fin">
                <h1>🎉 ¡FIN DEL JUEGO!</h1>
                <h2>🏆 Campeón: ${data.campeon}</h2>
                <table class="tabla-puntos">
                    <thead><tr><th>Jugador</th><th>Puntos</th></tr></thead>
                    <tbody>${tablaHTML}</tbody>
                </table>
                ${esHost
                    ? `<button class="btn-principal" id="btn-nueva-partida">Nueva Partida</button>`
                    : `<p style="color:#bdc3c7">Esperando al host...</p>`
                }
            </div>
        `;
    } else {
        modal.innerHTML = `
            <div class="modal-caja modal-fin">
                <h2>🃏 ¡Fin de la mano!</h2>
                <h3>Ganó: <span style="color:#f1c40f">${ganador}</span></h3>
                <p>Puntos ganados esta mano: <strong>+${puntosGanados}</strong></p>
                <table class="tabla-puntos">
                    <thead><tr><th>Jugador</th><th>Puntos</th></tr></thead>
                    <tbody>${tablaHTML}</tbody>
                </table>
                ${esHost
                    ? `<button class="btn-principal" id="btn-nueva-partida">Siguiente mano</button>`
                    : `<p style="color:#bdc3c7">Esperando al host para la siguiente mano...</p>`
                }
            </div>
        `;
    }

    document.body.appendChild(modal);

    // FIX: listener directo, sin window.nuevaPartida global
    const btnNueva = modal.querySelector('#btn-nueva-partida');
    if (btnNueva) {
        btnNueva.addEventListener('click', () => {
            modal.remove();
            iniciarPartidaOficial(idSala);
        });
    }
}
