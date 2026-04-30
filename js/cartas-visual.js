// js/cartas-visual.js
// Responsabilidad: Crear el elemento DOM visual de una carta

import {
    svgSalta, svgReversa, svgSaltaTodos, svgTiraColor, svgRuleta,
    svgToma2, svgToma4, svgToma6, svgToma10,
    svgWildToma6, svgWildToma10, svgWildReversaToma4,
    svgWild, svgWildToma4
} from './iconos.js';

const diccionarioCentro = {
    'salta':              svgSalta,
    'reversa':            svgReversa,
    'salta_todos':        svgSaltaTodos,
    'tira_color':         svgTiraColor,
    'toma2':              svgToma2,
    'toma4':              svgToma4,
    'toma6':              svgToma6,
    'toma10':             svgToma10,
    'wild':               svgWild,
    'wild_toma4':         svgWildToma4,
    'wild_reversa_toma4': svgWildReversaToma4,
    'wild_toma6':         svgWildToma6,
    'wild_toma10':        svgWildToma10,
    'wild_ruleta':        svgRuleta
};

const diccionarioEsquina = {
    'salta':              svgSalta,
    'reversa':            svgReversa,
    'salta_todos':        svgSaltaTodos,
    'tira_color':         svgTiraColor,
    'toma2':              '+2',
    'toma4':              '+4',
    'toma6':              '+6',
    'toma10':             '+10',
    'wild':               '🌈',
    'wild_toma4':         '+4',
    'wild_reversa_toma4': '🔃<br>+4',
    'wild_toma6':         '+6',
    'wild_toma10':        '+10',
    'wild_ruleta':        svgRuleta
};

/**
 * Crea y devuelve el elemento DIV visual de una carta.
 * @param {Object} carta - Objeto con { color, valor, tipo, color_elegido? }
 * @returns {HTMLDivElement}
 */
export function crearCartaVisual(carta) {
    const div = document.createElement('div');

    let claseColor = carta.color;
    if (carta.tipo === 'comodin') {
        claseColor = carta.color_elegido ? carta.color_elegido : 'comodin';
    }

    div.className = `carta ${claseColor}`;

    const contenidoCentro  = diccionarioCentro[carta.valor]  || carta.valor;
    const contenidoEsquina = diccionarioEsquina[carta.valor] || carta.valor;

    div.innerHTML = `
        <div class="esquina-sup">${contenidoEsquina}</div>
        <div class="centro-ovalo"></div>
        <div class="centro-carta">${contenidoCentro}</div>
        <div class="esquina-inf">${contenidoEsquina}</div>
    `;

    return div;
}
