import { db } from './firebase-config.js';
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export async function inicializarSesion(nombre, sala) {
    const salaID = sala.toLowerCase().trim();
    const nombreLimpio = nombre.trim();
    
    sessionStorage.setItem('usuarioNombre', nombreLimpio);
    sessionStorage.setItem('idSala', salaID);

    const salaRef = ref(db, `no_mercy/salas/${salaID}`);
    const snapshot = await get(salaRef);
    
    // El primero en entrar crea la estructura base y se hace anfitrión
    if (!snapshot.exists()) {
        await set(salaRef, { 
            host: nombreLimpio,
            estado: 'esperando',
            stack: 0
        });
    }

    // BUG #6 FIX: conservar puntos y estado si el jugador ya existía en la sala
    // (evita que una recarga o nombre duplicado resetee puntos o reviva eliminados)
    const jugadorRef = ref(db, `no_mercy/salas/${salaID}/jugadores/${nombreLimpio}`);
    const jugadorSnap = await get(jugadorRef);
    const jugadorExistente = jugadorSnap.exists() ? jugadorSnap.val() : null;

    await set(jugadorRef, {
        nombre:    nombreLimpio,
        puntos:    jugadorExistente?.puntos    ?? 0,
        eliminado: jugadorExistente?.eliminado ?? false,
        listo:     true
    });

    window.location.href = 'game.html';
}