// js/logica.js
import { db } from './firebase-config.js';
import { ref, get, update, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const COLORES = ['rojo', 'azul', 'verde', 'amarillo'];

export function generarMazoOficial() {
    let mazo = [];
    COLORES.forEach(color => {
        // Un 0 por color
        mazo.push({ color, valor: '0', tipo: 'numero' });
        // Dos de cada número 1-9
        for (let n = 1; n <= 9; n++) {
            mazo.push({ color, valor: n.toString(), tipo: 'numero' });
            mazo.push({ color, valor: n.toString(), tipo: 'numero' });
        }
        // Dos de cada acción de color
        const acciones = ['toma2', 'toma4', 'salta', 'reversa', 'tira_color', 'salta_todos'];
        acciones.forEach(act => {
            mazo.push({ color, valor: act, tipo: 'accion' });
            mazo.push({ color, valor: act, tipo: 'accion' });
        });
    });

    // 4 de cada comodín negro (No Mercy exclusivos)
    for (let i = 0; i < 4; i++) {
        mazo.push({ color: 'negro', valor: 'wild_reversa_toma4', tipo: 'comodin' });
        mazo.push({ color: 'negro', valor: 'wild_toma6',         tipo: 'comodin' });
        mazo.push({ color: 'negro', valor: 'wild_toma10',        tipo: 'comodin' });
        mazo.push({ color: 'negro', valor: 'wild_ruleta',        tipo: 'comodin' });
    }
    // DETALLE: comodines estándar de UNO clásico (4 de cada uno → +8 cartas → total 168)
    for (let i = 0; i < 4; i++) {
        mazo.push({ color: 'negro', valor: 'wild',       tipo: 'comodin' }); // Comodín normal (elige color)
        mazo.push({ color: 'negro', valor: 'wild_toma4', tipo: 'comodin' }); // Comodín +4 clásico
    }
    return barajar(mazo);
}

export function barajar(mazo) {
    for (let i = mazo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazo[i], mazo[j]] = [mazo[j], mazo[i]];
    }
    return mazo;
}

// ==========================================
// HELPERS
// ==========================================
export function limpiarMano(mano) {
    if (!mano) return [];
    if (Array.isArray(mano)) return mano.filter(c => c !== null && c !== undefined);
    return Object.values(mano).filter(c => c !== null && c !== undefined);
}

export function siguienteJugadorActivo(orden, indexActual, sentido, jugadores, saltos = 1) {
    const total = orden.length;
    let idx = indexActual;

    const hayActivos = orden.some(n => !jugadores[n]?.eliminado);
    if (!hayActivos) return indexActual;

    for (let s = 0; s < saltos; s++) {
        let intentos = 0;
        do {
            idx = sentido === 'derecha'
                ? (idx + 1) % total
                : (idx - 1 + total) % total;
            intentos++;
            if (intentos > total) break;
        } while (jugadores[orden[idx]]?.eliminado === true);
    }
    return idx;
}

// ==========================================
// ELIMINAR JUGADOR POR PIEDAD
// BUG 1 FIX: Descarte Clonador
// Si en este mismo turno ya se vació el descarte (actualizaciones['pila_descarte'] = []),
// leer de actualizaciones en lugar de data para no clonar cartas ya barajadas.
// ==========================================
function eliminarJugadorPorPiedad(nombreUsuario, miMano, data, actualizaciones) {
    actualizaciones[`jugadores/${nombreUsuario}/eliminado`] = true;
    actualizaciones[`jugadores/${nombreUsuario}/mano`]     = [];

    // Priorizar el descarte ya actualizado en este turno; si no existe, usar el de data
    const descarteBase = 'pila_descarte' in actualizaciones
        ? (actualizaciones['pila_descarte'] || [])
        : (data.pila_descarte ? limpiarMano(data.pila_descarte) : []);

    actualizaciones['pila_descarte'] = [...descarteBase, ...miMano];

    window.mostrarToast(`¡${nombreUsuario} fue eliminado por Piedad! (${miMano.length} cartas devueltas al mazo)`, "error");
}

function calcularPuntosCartas(mano) {
    let puntos = 0;
    mano.forEach(carta => {
        if (carta.tipo === 'numero') {
            puntos += parseInt(carta.valor) || 0;
        } else if (carta.tipo === 'accion') {
            puntos += 20;
        } else if (carta.tipo === 'comodin') {
            puntos += 50;
        }
    });
    return puntos;
}

// ==========================================
// INICIAR PARTIDA
// ==========================================
export async function iniciarPartidaOficial(idSala) {
    const salaRef = ref(db, `no_mercy/salas/${idSala}`);
    const snapshot = await get(salaRef);
    const data = snapshot.val();

    if (!data || !data.jugadores) return alert("Error: No hay jugadores.");

    const nombresJugadores = Object.keys(data.jugadores);

    if (nombresJugadores.length < 2) {
        return window.mostrarToast("Mínimo 2 jugadores para empezar.", "warning");
    }

    const mazo = generarMazoOficial();
    let actualizaciones = {};

    nombresJugadores.forEach(nombre => {
        const manoJugador = mazo.splice(0, 7);
        const puntosAnteriores = data.jugadores[nombre]?.puntos || 0;
        actualizaciones[`jugadores/${nombre}/mano`]        = manoJugador;
        actualizaciones[`jugadores/${nombre}/eliminado`]   = false;
        actualizaciones[`jugadores/${nombre}/uno_gritado`] = false;
        actualizaciones[`jugadores/${nombre}/puntos`]      = puntosAnteriores;
    });

    let cartaInicial = mazo.pop();
    while (cartaInicial.tipo !== 'numero') {
        mazo.unshift(cartaInicial);
        cartaInicial = mazo.pop();
    }

    actualizaciones['mazo']                  = mazo;
    actualizaciones['pila_tirar']            = cartaInicial;
    actualizaciones['pila_descarte']         = [];
    actualizaciones['estado']                = 'jugando';
    actualizaciones['turno_actual']          = nombresJugadores[0];
    actualizaciones['sentido']               = 'derecha';
    actualizaciones['stack']                 = 0;
    actualizaciones['stack_tipo']            = null;
    actualizaciones['orden_jugadores']       = nombresJugadores;
    actualizaciones['ganador']               = null;
    actualizaciones['color_activo']          = cartaInicial.color;
    actualizaciones['comodin_pendiente']     = null;
    actualizaciones['intercambio_pendiente'] = null;
    actualizaciones['ruleta_pendiente']      = null;
    actualizaciones['tira_color_pendiente']  = null;

    await update(salaRef, actualizaciones);
}

// ==========================================
// ROBAR CARTA DEL MAZO (una por una para generar tensión)
// ==========================================
export async function robarCartaMazo() {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    if (data.turno_actual !== nombreUsuario) {
        return window.mostrarToast("¡No es tu turno!", "error");
    }

    if (data.stack > 0) {
        return window.mostrarToast("¡Debes apilar o aceptar el castigo!", "warning");
    }

    if (data.robo_activo && data.robo_activo.jugador === nombreUsuario) {
        return await robarSiguienteCarta(salaRef, data, nombreUsuario, idSala);
    }

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let mazo          = limpiarMano(data.mazo);
    let actualizaciones = {};

    if (mazo.length === 0) {
        const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
        if (descarte.length === 0) {
            const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
            await update(salaRef, { 'turno_actual': orden[indexSig] });
            window.mostrarToast("¡No hay más cartas! Turno pasado.", "warning");
            return;
        }
        mazo = barajar(descarte);
        actualizaciones['pila_descarte'] = [];
    }

    actualizaciones['robo_activo'] = { jugador: nombreUsuario };
    actualizaciones['mazo']        = mazo;
    await update(salaRef, actualizaciones);

    const snapActualizado = await get(salaRef);
    await robarSiguienteCarta(salaRef, snapActualizado.val(), nombreUsuario, idSala);
}

async function robarSiguienteCarta(salaRef, data, nombreUsuario, idSala) {
    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let mazo          = limpiarMano(data.mazo);
    let miMano        = limpiarMano(data.jugadores[nombreUsuario].mano);
    let actualizaciones = {};

    if (mazo.length === 0) {
        const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
        if (descarte.length === 0) {
            const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
            await update(salaRef, {
                'robo_activo':  null,
                'turno_actual': orden[indexSig]
            });
            window.mostrarToast("¡No hay más cartas! Turno pasado.", "warning");
            return;
        }
        mazo = barajar(descarte);
        actualizaciones['pila_descarte'] = [];
    }

    const carta = mazo.pop();
    miMano = [...miMano, carta];

    const cartaMesa   = data.pila_tirar;
    const colorActivo = data.color_activo || cartaMesa.color;
    const esJugable   =
        carta.color === colorActivo ||
        carta.valor  === cartaMesa.valor ||
        carta.tipo   === 'comodin';

    actualizaciones[`jugadores/${nombreUsuario}/mano`] = miMano;
    actualizaciones['mazo'] = mazo;

    // BUG FIX: Inmortalidad del UNO
    // Si tras robar la mano tiene más de 1 carta, apagar uno_gritado/uno_pregritado.
    if (miMano.length > 1) {
        actualizaciones[`jugadores/${nombreUsuario}/uno_gritado`]    = false;
        actualizaciones[`jugadores/${nombreUsuario}/uno_pregritado`] = false;
    }

    if (miMano.length >= 25) {
        eliminarJugadorPorPiedad(nombreUsuario, miMano, data, actualizaciones);
        actualizaciones['robo_activo'] = null;

        const jugadoresActivos = orden.filter(n =>
            n !== nombreUsuario && !data.jugadores[n]?.eliminado
        );
        if (jugadoresActivos.length === 1) {
            await terminarMano(idSala, jugadoresActivos[0], data, actualizaciones);
            return;
        }
        const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, {
            ...data.jugadores,
            [nombreUsuario]: { eliminado: true }
        });
        actualizaciones['turno_actual'] = orden[indexSig];
        await update(salaRef, actualizaciones);
        return;
    }

    if (esJugable) {
        actualizaciones['robo_activo']  = null;
        actualizaciones['turno_actual'] = nombreUsuario;
        window.mostrarToast(`¡Carta jugable encontrada! Puedes jugarla o seguir robando.`, "info");
    } else {
        actualizaciones['robo_activo']  = { jugador: nombreUsuario };
        actualizaciones['turno_actual'] = nombreUsuario;
        window.mostrarToast(`Robaste 1 carta. Haz clic al mazo para seguir o juega si puedes.`, "info");
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// ACEPTAR CASTIGO DE STACK
// ==========================================
export async function aceptarCastigoStack() {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    if (data.turno_actual !== nombreUsuario) return;
    if (!data.stack || data.stack === 0) return;

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let mazo          = limpiarMano(data.mazo);
    let miMano        = limpiarMano(data.jugadores[nombreUsuario].mano);
    let actualizaciones = {};

    const cantidadARobar = data.stack;

    if (mazo.length < cantidadARobar) {
        const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
        mazo = [...mazo, ...barajar(descarte)];
        actualizaciones['pila_descarte'] = [];
    }

    for (let i = 0; i < cantidadARobar && mazo.length > 0; i++) {
        miMano.push(mazo.pop());
    }

    actualizaciones[`jugadores/${nombreUsuario}/mano`] = miMano;
    actualizaciones['mazo']       = mazo;
    actualizaciones['stack']      = 0;
    actualizaciones['stack_tipo'] = null;

    // BUG FIX: Inmortalidad del UNO
    // Si tras recibir el castigo la mano tiene más de 1 carta,
    // apagar uno_gritado y uno_pregritado para que el jugador vuelva a ser acusable.
    if (miMano.length > 1) {
        actualizaciones[`jugadores/${nombreUsuario}/uno_gritado`]    = false;
        actualizaciones[`jugadores/${nombreUsuario}/uno_pregritado`] = false;
    }

    if (miMano.length >= 25) {
        eliminarJugadorPorPiedad(nombreUsuario, miMano, data, actualizaciones);

        const jugadoresActivos = orden.filter(n =>
            n !== nombreUsuario && !data.jugadores[n]?.eliminado
        );

        if (jugadoresActivos.length === 1) {
            await terminarMano(idSala, jugadoresActivos[0], data, actualizaciones);
            return;
        }

        const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, {
            ...data.jugadores,
            [nombreUsuario]: { eliminado: true }
        });
        actualizaciones['turno_actual'] = orden[indexSig];
        await update(salaRef, actualizaciones);
        return;
    }

    const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
    actualizaciones['turno_actual'] = orden[indexSig];

    window.mostrarToast(`Tomaste ${cantidadARobar} cartas de castigo.`, "warning");
    await update(salaRef, actualizaciones);
}

// ==========================================
// TERMINAR MANO (calcular puntos)
// ==========================================
export async function terminarMano(idSala, ganadorNombre, data, actualizacionesExtra = {}) {
    const salaRef = ref(db, `no_mercy/salas/${idSala}`);
    const orden   = data.orden_jugadores || Object.keys(data.jugadores);
    let actualizaciones = { ...actualizacionesExtra };

    let puntosGanados             = 0;
    let jugadoresEliminadosEnMano = 0;

    orden.forEach(nombre => {
        if (nombre === ganadorNombre) return;
        const jugador = data.jugadores[nombre];

        const eliminadoEnEstaMano =
            actualizacionesExtra[`jugadores/${nombre}/eliminado`] === true;
        const yaEliminadoAntes =
            jugador.eliminado === true &&
            actualizacionesExtra[`jugadores/${nombre}/eliminado`] !== false;

        if (eliminadoEnEstaMano) {
            jugadoresEliminadosEnMano++;
        } else if (yaEliminadoAntes) {
            // No contar: ya fue contado en manos anteriores
        } else {
            const mano = limpiarMano(jugador.mano);
            puntosGanados += calcularPuntosCartas(mano);
        }
    });

    puntosGanados += jugadoresEliminadosEnMano * 250;

    const puntosAnteriores = data.jugadores[ganadorNombre]?.puntos || 0;
    const puntosNuevos     = puntosAnteriores + puntosGanados;

    actualizaciones[`jugadores/${ganadorNombre}/puntos`] = puntosNuevos;
    actualizaciones['estado']              = 'fin_mano';
    actualizaciones['ganador']             = ganadorNombre;
    actualizaciones['puntos_ganados_mano'] = puntosGanados;
    actualizaciones['tira_color_pendiente'] = null;

    if (puntosNuevos >= 1000) {
        actualizaciones['estado']  = 'fin_juego';
        actualizaciones['campeon'] = ganadorNombre;
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// GRITAR UNO (con soporte preventivo para 2 cartas)
// ==========================================
export async function gritarUno() {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    const miMano = limpiarMano(data.jugadores[nombreUsuario]?.mano);

    if (miMano.length === 1) {
        await update(salaRef, {
            [`jugadores/${nombreUsuario}/uno_gritado`]:    true,
            [`jugadores/${nombreUsuario}/uno_pregritado`]: false
        });
        window.mostrarToast("¡UNO! 🎉", "success");
    } else if (miMano.length === 2) {
        await update(salaRef, {
            [`jugadores/${nombreUsuario}/uno_pregritado`]: true
        });
        window.mostrarToast("¡UNO preventivo! 🛡️ Estás protegido al tirar tu penúltima carta.", "success");
    } else {
        window.mostrarToast("No puedes gritar UNO ahora.", "warning");
    }
}

// ==========================================
// ACUSAR UNO (otro jugador no gritó UNO)
// ==========================================
export async function acusarUno(nombreAcusado) {
    const idSala  = sessionStorage.getItem('idSala');
    const salaRef = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    const jugadorAcusado = data.jugadores[nombreAcusado];
    const manoAcusado    = limpiarMano(jugadorAcusado?.mano);

    const estaProtegido = jugadorAcusado.uno_gritado || jugadorAcusado.uno_pregritado;
    if (manoAcusado.length === 1 && !estaProtegido) {
        let mazo     = limpiarMano(data.mazo);
        let manoNueva = [...manoAcusado];

        for (let i = 0; i < 2 && mazo.length > 0; i++) {
            manoNueva.push(mazo.pop());
        }

        await update(salaRef, {
            [`jugadores/${nombreAcusado}/mano`]: manoNueva,
            'mazo': mazo
        });
        window.mostrarToast(`¡${nombreAcusado} no gritó UNO! Toma 2 cartas. 😈`, "success");
    } else {
        window.mostrarToast("No puedes acusar a ese jugador.", "warning");
    }
}

// ==========================================
// SELECCIONAR COLOR (para comodines excepto Ruleta)
// ==========================================
export async function seleccionarColor(color, cartaComodin) {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    let actualizaciones = {};
    actualizaciones['pila_tirar']        = { ...cartaComodin, color_elegido: color };
    actualizaciones['color_activo']      = color;
    actualizaciones['comodin_pendiente'] = null;

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let sentido       = data.sentido;
    const numActivos  = orden.filter(n => !data.jugadores[n]?.eliminado).length;

    if (cartaComodin.valor === 'wild') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = 0;
        actualizaciones['stack_tipo']   = null;
        actualizaciones['turno_actual'] = orden[indexSig];

    } else if (cartaComodin.valor === 'wild_toma4') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = (data.stack || 0) + 4;
        actualizaciones['stack_tipo']   = 'wild_toma4';
        actualizaciones['turno_actual'] = orden[indexSig];

    } else if (cartaComodin.valor === 'wild_toma6') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = (data.stack || 0) + 6;
        actualizaciones['stack_tipo']   = 'wild_toma6';
        actualizaciones['turno_actual'] = orden[indexSig];

    } else if (cartaComodin.valor === 'wild_toma10') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = (data.stack || 0) + 10;
        actualizaciones['stack_tipo']   = 'wild_toma10';
        actualizaciones['turno_actual'] = orden[indexSig];

    } else if (cartaComodin.valor === 'wild_reversa_toma4') {
        if (numActivos === 2) {
            actualizaciones['stack']        = (data.stack || 0) + 4;
            actualizaciones['stack_tipo']   = 'wild_reversa_toma4';
            actualizaciones['turno_actual'] = nombreUsuario;
        } else {
            sentido = sentido === 'derecha' ? 'izquierda' : 'derecha';
            actualizaciones['sentido'] = sentido;
            const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
            actualizaciones['stack']        = (data.stack || 0) + 4;
            actualizaciones['stack_tipo']   = 'wild_reversa_toma4';
            actualizaciones['turno_actual'] = orden[indexSig];
        }
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// RESOLVER RULETA DE COLOR (robo uno a uno para generar tensión)
// ==========================================
export async function resolverRuleta(colorElegido) {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    if (data.ruleta_activa && data.ruleta_activa.jugador === nombreUsuario) {
        return await robarSiguienteCartaRuleta(salaRef, data, nombreUsuario, idSala);
    }

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let mazo          = limpiarMano(data.mazo);
    let actualizaciones = {};

    if (mazo.length === 0) {
        const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
        if (descarte.length === 0) {
            const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
            await update(salaRef, {
                'ruleta_pendiente': null,
                'color_activo':     colorElegido,
                'turno_actual':     orden[indexSig]
            });
            window.mostrarToast("¡No hay cartas en el mazo! Ruleta terminada.", "warning");
            return;
        }
        mazo = barajar(descarte);
        actualizaciones['pila_descarte'] = [];
    }

    actualizaciones['ruleta_activa']    = { jugador: nombreUsuario, color: colorElegido, reciclajes: 0 };
    actualizaciones['ruleta_pendiente'] = null;
    actualizaciones['color_activo']     = colorElegido;
    actualizaciones['mazo']             = mazo;
    await update(salaRef, actualizaciones);

    const snapActualizado = await get(salaRef);
    await robarSiguienteCartaRuleta(salaRef, snapActualizado.val(), nombreUsuario, idSala);
}

async function robarSiguienteCartaRuleta(salaRef, data, nombreUsuario, idSala) {
    const orden        = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual  = orden.indexOf(nombreUsuario);
    const colorElegido = data.ruleta_activa?.color;
    let mazo           = limpiarMano(data.mazo);
    let miMano         = limpiarMano(data.jugadores[nombreUsuario].mano);
    let reciclajes     = data.ruleta_activa?.reciclajes || 0;
    const MAX_RECICLAJES = 2;
    let actualizaciones = {};

    if (mazo.length === 0) {
        const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
        if (descarte.length === 0 || reciclajes >= MAX_RECICLAJES) {
            const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
            await update(salaRef, {
                'ruleta_activa': null,
                'turno_actual':  orden[indexSig]
            });
            window.mostrarToast(`Ruleta: no había más cartas de ${colorElegido}. Turno pasado.`, "warning");
            return;
        }
        reciclajes++;
        mazo = barajar(descarte);
        actualizaciones['pila_descarte'] = [];
        actualizaciones['ruleta_activa'] = { jugador: nombreUsuario, color: colorElegido, reciclajes };
    }

    const carta = mazo.pop();
    miMano = [...miMano, carta];

    const esDelColor = carta.tipo !== 'comodin' && carta.color === colorElegido;

    actualizaciones[`jugadores/${nombreUsuario}/mano`] = miMano;
    actualizaciones['mazo'] = mazo;

    if (miMano.length >= 25) {
        eliminarJugadorPorPiedad(nombreUsuario, miMano, data, actualizaciones);
        actualizaciones['ruleta_activa'] = null;

        const jugadoresActivos = orden.filter(n =>
            n !== nombreUsuario && !data.jugadores[n]?.eliminado
        );
        if (jugadoresActivos.length === 1) {
            await terminarMano(idSala, jugadoresActivos[0], data, actualizaciones);
            return;
        }
        const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, {
            ...data.jugadores,
            [nombreUsuario]: { eliminado: true }
        });
        actualizaciones['turno_actual'] = orden[indexSig];
        await update(salaRef, actualizaciones);
        return;
    }

    if (esDelColor) {
        const indexSig = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
        actualizaciones['ruleta_activa'] = null;
        actualizaciones['turno_actual']  = orden[indexSig];
        window.mostrarToast(`¡Ruleta! Encontraste ${colorElegido}. Turno pasado.`, "success");
    } else {
        actualizaciones['ruleta_activa'] = { jugador: nombreUsuario, color: colorElegido, reciclajes };
        actualizaciones['turno_actual']  = nombreUsuario;
        window.mostrarToast(`Robaste 1 carta. Haz clic al mazo para seguir buscando ${colorElegido}...`, "warning");
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// INTERCAMBIAR MANO CON CARTA 7
// BUG 3 FIX: Necromancia del 7
// Verificar que el objetivo no haya sido eliminado JUSTO ANTES de hacer el update.
// Si fue eliminado mientras el modal estaba abierto, cancelar el intercambio.
// ==========================================
export async function intercambiarMano(nombreObjetivo) {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    // Leer el estado FRESCO de Firebase justo antes de ejecutar el intercambio
    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    // BUG 3 FIX: si el objetivo fue eliminado mientras el modal estaba abierto, cancelar
    if (data.jugadores[nombreObjetivo]?.eliminado === true) {
        const orden       = data.orden_jugadores || Object.keys(data.jugadores);
        const indexActual = orden.indexOf(nombreUsuario);
        const indexSig    = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);
        await update(salaRef, {
            'intercambio_pendiente': null,
            'turno_actual': orden[indexSig]
        });
        window.mostrarToast(`¡${nombreObjetivo} acaba de huir! Intercambio cancelado.`, "warning");
        return;
    }

    const miMano       = limpiarMano(data.jugadores[nombreUsuario].mano);
    const manoObjetivo = limpiarMano(data.jugadores[nombreObjetivo].mano);

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    const indexSig    = siguienteJugadorActivo(orden, indexActual, data.sentido, data.jugadores);

    await update(salaRef, {
        [`jugadores/${nombreUsuario}/mano`]:         manoObjetivo,
        [`jugadores/${nombreUsuario}/uno_gritado`]:  false,
        [`jugadores/${nombreObjetivo}/mano`]:        miMano,
        [`jugadores/${nombreObjetivo}/uno_gritado`]: false,
        'intercambio_pendiente': null,
        'turno_actual': orden[indexSig]
    });

    window.mostrarToast(`¡Intercambiaste tu mano con ${nombreObjetivo}!`, "success");
}

// ==========================================
// LÓGICA PRINCIPAL: INTENTAR JUGAR UNA CARTA
// ==========================================
export async function intentarJugarCarta(cartaSeleccionada) {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    const salaRef       = ref(db, `no_mercy/salas/${idSala}`);

    const snapshot = await get(salaRef);
    const data     = snapshot.val();

    if (data.turno_actual !== nombreUsuario) {
        return window.mostrarToast("¡Paciencia! Aún no es tu turno.", "error");
    }

    if (data.jugadores[nombreUsuario]?.eliminado) {
        return window.mostrarToast("Estás eliminado de esta mano.", "error");
    }

    // ==========================================
    // BUG 1 FIX: Ninja Exploit
    // Si hay cualquier acción pendiente que le pertenece a este jugador
    // (comodín esperando color, intercambio de 7, tira_color, ruleta),
    // bloquear el juego de nuevas cartas hasta que se resuelva el pendiente.
    // ==========================================
    if (data.comodin_pendiente?.jugador === nombreUsuario) {
        return window.mostrarToast("¡Primero elige un color para tu comodín!", "warning");
    }
    if (data.intercambio_pendiente?.jugador === nombreUsuario) {
        return window.mostrarToast("¡Primero elige con quién intercambiar tu mano!", "warning");
    }
    if (data.tira_color_pendiente?.jugador === nombreUsuario) {
        return window.mostrarToast("¡Primero termina de descartar tus cartas de color!", "warning");
    }
    if (data.ruleta_pendiente?.jugador === nombreUsuario || data.ruleta_activa?.jugador === nombreUsuario) {
        return window.mostrarToast("¡Primero resuelve la ruleta de color!", "warning");
    }

    const cartaEnMesa = data.pila_tirar;
    const colorActivo = data.color_activo || cartaEnMesa.color;

    const mismoColor = cartaSeleccionada.color === colorActivo;
    const mismoValor = cartaSeleccionada.valor  === cartaEnMesa.valor;
    const esComodin  = cartaSeleccionada.tipo   === 'comodin';

    // ==========================================
    // REGLA DE APILAMIENTO
    // FIX: Las cartas de castigo (+2, +4, etc.) se pueden apilar sin importar el color,
    // solo importa que el valor sea igual o mayor al del stack actual.
    // ==========================================
    const stackActual = data.stack || 0;
    const stackTipo   = data.stack_tipo;
    const VALORES_STACK = {
        'toma2':              2,
        'toma4':              4,
        'wild_toma4':         4,
        'wild_toma6':         6,
        'wild_toma10':        10,
        'wild_reversa_toma4': 4
    };
    const esCartaStack    = VALORES_STACK[cartaSeleccionada.valor] !== undefined;
    const valorCartaStack = VALORES_STACK[cartaSeleccionada.valor] || 0;
    const valorStackActual = stackTipo ? (VALORES_STACK[stackTipo] || 0) : (stackActual > 0 ? Infinity : 0);

    if (stackActual > 0) {
        // Con stack activo: SOLO se puede apilar con carta de castigo de igual o mayor valor.
        // El color NO importa para el apilamiento.
        if (!esCartaStack || valorCartaStack < valorStackActual) {
            const minRequerido = stackTipo ? `+${valorStackActual}` : 'una carta de castigo válida';
            return window.mostrarToast(
                `¡Debes apilar con ${minRequerido} o mayor, o aceptar el castigo!`,
                "warning"
            );
        }
        // Si es carta de stack válida, se permite jugar sin importar el color
    } else {
        // Sin stack: validación normal de color/valor/comodín
        if (!mismoColor && !mismoValor && !esComodin) {
            return window.mostrarToast("Esa carta no coincide con el color ni con el número.", "warning");
        }
    }

    // ---- CARTA VÁLIDA: procesar ----
    let actualizaciones = {};

    let miMano = limpiarMano(data.jugadores[nombreUsuario].mano);
    const indiceCarta = miMano.findIndex(c =>
        c.color === cartaSeleccionada.color && c.valor === cartaSeleccionada.valor
    );
    if (indiceCarta !== -1) miMano.splice(indiceCarta, 1);

    actualizaciones[`jugadores/${nombreUsuario}/mano`]        = miMano;
    actualizaciones[`jugadores/${nombreUsuario}/uno_gritado`] = false;

    // UNO PREVENTIVO
    if (miMano.length === 1 && data.jugadores[nombreUsuario]?.uno_pregritado) {
        actualizaciones[`jugadores/${nombreUsuario}/uno_gritado`]    = true;
        actualizaciones[`jugadores/${nombreUsuario}/uno_pregritado`] = false;
    } else {
        actualizaciones[`jugadores/${nombreUsuario}/uno_pregritado`] = false;
    }

    const descarte = data.pila_descarte ? limpiarMano(data.pila_descarte) : [];
    descarte.push(cartaEnMesa);
    actualizaciones['pila_descarte'] = descarte;

    actualizaciones['pila_tirar']   = cartaSeleccionada;
    actualizaciones['color_activo'] = cartaSeleccionada.color !== 'negro'
        ? cartaSeleccionada.color
        : (colorActivo || 'rojo');

    const orden       = data.orden_jugadores || Object.keys(data.jugadores);
    const indexActual = orden.indexOf(nombreUsuario);
    let sentido       = data.sentido;

    const valor = cartaSeleccionada.valor;

    // --- CARTA 0: rotar manos ---
    if (valor === '0') {
        const jugadoresActivos = orden.filter(n => !data.jugadores[n]?.eliminado);
        let manosTmp = {};
        jugadoresActivos.forEach(n => {
            manosTmp[n] = limpiarMano(data.jugadores[n].mano);
        });
        manosTmp[nombreUsuario] = miMano;

        const numActivos = jugadoresActivos.length;
        for (let i = 0; i < numActivos; i++) {
            const actual    = jugadoresActivos[i];
            const siguiente = sentido === 'derecha'
                ? jugadoresActivos[(i + 1) % numActivos]
                : jugadoresActivos[(i - 1 + numActivos) % numActivos];
            actualizaciones[`jugadores/${siguiente}/mano`] = manosTmp[actual];
        }

        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['turno_actual'] = orden[indexSig];
        actualizaciones['stack']        = 0;
        actualizaciones['stack_tipo']   = null;
        jugadoresActivos.forEach(n => {
            actualizaciones[`jugadores/${n}/uno_gritado`] = false;
        });
        window.mostrarToast("¡Carta 0! Todos pasan su mano al siguiente.", "info");

    // --- CARTA 7: intercambiar mano ---
    } else if (valor === '7') {
        actualizaciones['intercambio_pendiente'] = { jugador: nombreUsuario };
        actualizaciones['turno_actual']          = nombreUsuario;
        actualizaciones['stack']                 = 0;
        actualizaciones['stack_tipo']            = null;
        window.mostrarToast("¡Carta 7! Elige con quién intercambiar tu mano.", "info");

    // --- SALTA ---
    } else if (valor === 'salta') {
        const jugadoresActivos = orden.filter(n => !data.jugadores[n]?.eliminado);
        if (jugadoresActivos.length === 2) {
            actualizaciones['turno_actual'] = nombreUsuario;
        } else {
            const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores, 2);
            actualizaciones['turno_actual'] = orden[indexSig];
        }
        actualizaciones['stack']      = 0;
        actualizaciones['stack_tipo'] = null;
        window.mostrarToast("¡Salta! El siguiente jugador pierde su turno.", "info");

    // --- REVERSA ---
    } else if (valor === 'reversa') {
        const jugadoresActivos = orden.filter(n => !data.jugadores[n]?.eliminado);
        if (jugadoresActivos.length === 2) {
            actualizaciones['turno_actual'] = nombreUsuario;
        } else {
            sentido = sentido === 'derecha' ? 'izquierda' : 'derecha';
            actualizaciones['sentido']      = sentido;
            const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
            actualizaciones['turno_actual'] = orden[indexSig];
        }
        actualizaciones['stack']      = 0;
        actualizaciones['stack_tipo'] = null;
        window.mostrarToast("¡Reversa! El sentido del juego cambió.", "info");

    // --- TOMA 2 ---
    } else if (valor === 'toma2') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = stackActual + 2;
        actualizaciones['stack_tipo']   = 'toma2';
        actualizaciones['turno_actual'] = orden[indexSig];
        window.mostrarToast("¡Toma 2! El siguiente jugador debe tomar 2 cartas.", "info");

    // --- TOMA 4 ---
    } else if (valor === 'toma4') {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['stack']        = stackActual + 4;
        actualizaciones['stack_tipo']   = 'toma4';
        actualizaciones['turno_actual'] = orden[indexSig];
        window.mostrarToast("¡Toma 4! El siguiente jugador debe tomar 4 cartas.", "info");

    // --- SALTA A TODOS ---
    } else if (valor === 'salta_todos') {
        actualizaciones['turno_actual'] = nombreUsuario;
        actualizaciones['stack']        = 0;
        actualizaciones['stack_tipo']   = null;
        window.mostrarToast("¡Salta a todos! Juegas de nuevo.", "info");

    // --- TIRA UN COLOR (nuevo flujo: carta por carta, el jugador elige el orden) ---
    } else if (valor === 'tira_color') {
        const colorCarta = cartaSeleccionada.color;
        // Activar el modal interactivo en renderizado.js
        // La carta tira_color ya fue quitada de la mano arriba.
        actualizaciones['tira_color_pendiente'] = {
            jugador:     nombreUsuario,
            color:       colorCarta,
            descartadas: []
        };
        actualizaciones['turno_actual'] = nombreUsuario;
        actualizaciones['stack']        = 0;
        actualizaciones['stack_tipo']   = null;
        window.mostrarToast(`¡Tira un color! Elige el orden en que descartas tus cartas ${colorCarta}.`, "info");

    // --- COMODINES ---
    } else if (esComodin) {
        if (valor === 'wild_ruleta') {
            const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
            actualizaciones['ruleta_pendiente'] = { jugador: orden[indexSig] };
            actualizaciones['turno_actual']     = orden[indexSig];
            actualizaciones['stack']            = 0;
            actualizaciones['stack_tipo']       = null;
            actualizaciones['color_activo']     = colorActivo;
        } else if (valor === 'wild') {
            actualizaciones['color_activo']      = null;
            actualizaciones['comodin_pendiente'] = { jugador: nombreUsuario, carta: cartaSeleccionada };
            actualizaciones['turno_actual']      = nombreUsuario;
            actualizaciones['stack']             = 0;
            actualizaciones['stack_tipo']        = null;
        } else if (valor === 'wild_toma4') {
            actualizaciones['color_activo']      = null;
            actualizaciones['comodin_pendiente'] = { jugador: nombreUsuario, carta: cartaSeleccionada };
            actualizaciones['turno_actual']      = nombreUsuario;
        } else {
            // wild_toma6, wild_toma10, wild_reversa_toma4
            actualizaciones['color_activo']      = null;
            actualizaciones['comodin_pendiente'] = { jugador: nombreUsuario, carta: cartaSeleccionada };
            actualizaciones['turno_actual']      = nombreUsuario;
        }

    // --- CARTA NORMAL ---
    } else {
        const indexSig = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
        actualizaciones['turno_actual'] = orden[indexSig];
        actualizaciones['stack']        = 0;
        actualizaciones['stack_tipo']   = null;
    }

    // BUG 2 FIX: si la mano quedó vacía con una carta de castigo,
    // inyectar las cartas al siguiente jugador ANTES de terminar la mano.
    // BUG A FIX: Comodín Indultado
    // Los comodines negros (wild_toma6, wild_toma10, wild_reversa_toma4) no suman al stack
    // en este punto porque esperan al modal de color. Si la mano quedó vacía, el modal
    // nunca se abrirá, así que calculamos el castigo directamente aquí.
    const CASTIGO_DIRECTO = {
        'wild_toma6':         6,
        'wild_toma10':        10,
        'wild_reversa_toma4': 4
    };
    const CARTAS_CASTIGO_FINALES = ['toma2', 'toma4', 'wild_toma4', 'wild_toma6', 'wild_toma10', 'wild_reversa_toma4'];
    if (miMano.length === 0 && CARTAS_CASTIGO_FINALES.includes(valor)) {
        // Para comodines negros que aún no sumaron al stack, calcular el castigo directo.
        // Para el resto, leer el stack ya acumulado en actualizaciones.
        const castigo = CASTIGO_DIRECTO[valor] !== undefined
            ? (stackActual + CASTIGO_DIRECTO[valor])
            : (actualizaciones['stack'] || 0);
        if (castigo > 0) {
            const indexVictima  = siguienteJugadorActivo(orden, indexActual, sentido, data.jugadores);
            const nombreVictima = orden[indexVictima];
            let mazo            = limpiarMano(data.mazo);
            let manoVictima     = limpiarMano(data.jugadores[nombreVictima]?.mano);

            if (mazo.length < castigo) {
                const descarteActual = limpiarMano(actualizaciones['pila_descarte'] || data.pila_descarte);
                mazo = [...mazo, ...barajar(descarteActual)];
                actualizaciones['pila_descarte'] = [];
            }
            for (let i = 0; i < castigo && mazo.length > 0; i++) {
                manoVictima.push(mazo.pop());
            }
            actualizaciones[`jugadores/${nombreVictima}/mano`] = manoVictima;
            actualizaciones['mazo']       = mazo;
            actualizaciones['stack']      = 0;
            actualizaciones['stack_tipo'] = null;
            window.mostrarToast(`¡${nombreVictima} recibió ${castigo} cartas de castigo antes del fin de mano!`, "warning");
        }
        await terminarMano(idSala, nombreUsuario, data, actualizaciones);
        return;
    }

    // BUG 2 FIX: Victoria Fantasma
    // Si la mano quedó vacía al jugar una carta con pendiente (comodín, 7, 0, tira_color, ruleta),
    // terminar la mano INMEDIATAMENTE, limpiando cualquier estado pendiente.
    // El modal ya no importa porque el jugador ganó.
    if (miMano.length === 0) {
        actualizaciones['comodin_pendiente']     = null;
        actualizaciones['intercambio_pendiente'] = null;
        actualizaciones['ruleta_pendiente']      = null;
        actualizaciones['ruleta_activa']         = null;
        actualizaciones['tira_color_pendiente']  = null;
        await terminarMano(idSala, nombreUsuario, data, actualizaciones);
        return;
    }

    await update(salaRef, actualizaciones);
}

// ==========================================
// TESTAMENTO FIREBASE (onDisconnect)
// ==========================================
export async function registrarTestamento() {
    const nombreUsuario = sessionStorage.getItem('usuarioNombre');
    const idSala        = sessionStorage.getItem('idSala');
    if (!nombreUsuario || !idSala) return;

    const salaRef      = ref(db, `no_mercy/salas/${idSala}`);
    const presenciaRef = ref(db, `no_mercy/salas/${idSala}/presencia/${nombreUsuario}`);

    await update(salaRef, { [`presencia/${nombreUsuario}`]: true });
    onDisconnect(presenciaRef).remove();
}
