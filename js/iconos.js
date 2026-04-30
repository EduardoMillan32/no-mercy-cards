// js/iconos.js

// ==========================================
// ICONOS DE ACCIÓN BÁSICOS (SVG)
// ==========================================

// Bloqueo / Salta
export const svgSalta = `
<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round">
    <circle cx="50" cy="50" r="38" />
    <line x1="23" y1="23" x2="77" y2="77" />
</svg>
`;

// Reversa
export const svgReversa = `
<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 35,50 A 20,20 0 0 1 65,30" />
    <polyline points="50,15 65,30 50,45" />
    <path d="M 65,50 A 20,20 0 0 1 35,70" />
    <polyline points="50,85 35,70 50,55" />
</svg>
`;

// Salta a Todos (¡Corregido! Giro perfecto en sentido horario)
export const svgSaltaTodos = `
<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 50,20 A 30,30 0 1 1 20,50" />
    <polyline points="5,65 20,50 35,65" />
</svg>
`;

// Tira Color 
export const svgTiraColor = `
<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round">
    <g fill="#fff" stroke="#222" stroke-width="4">
        <rect x="25" y="20" width="18" height="28" rx="2" transform="rotate(-30 32 32)" />
        <rect x="35" y="15" width="18" height="28" rx="2" transform="rotate(-15 42 27)" />
        <rect x="45" y="15" width="18" height="28" rx="2" />
        <rect x="55" y="20" width="18" height="28" rx="2" transform="rotate(15 62 32)" />
        <rect x="35" y="75" width="30" height="12" rx="2" />
    </g>
    <line x1="35" y1="80" x2="65" y2="80" stroke="#222" stroke-width="4"/>
    <path d="M 65,40 C 85,55 70,75 50,70" stroke-width="8" stroke="currentColor" stroke-linecap="round"/>
    <polyline points="55,55 50,70 65,75" stroke-width="8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

// ==========================================
// GENERADOR DINÁMICO DE PILAS DE CARTAS (+6, +10, Ruleta, etc)
// ==========================================
const crearPila = (cantidad, tipo = 'normal') => {
    let svg = `<svg viewBox="0 0 100 100">
        <defs>
            <filter id="sombra-carta">
                <feDropShadow dx="2" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.6"/>
            </filter>
        </defs>`;
        
    const posiciones = [
        {x: 25, y: 20, r: -10}, {x: 45, y: 25, r: 10},
        {x: 30, y: 35, r: -5},  {x: 50, y: 40, r: 15},
        {x: 20, y: 50, r: -15}, {x: 55, y: 45, r: 5},
        {x: 35, y: 60, r: -5},  {x: 45, y: 55, r: 20},
        {x: 25, y: 65, r: -10}, {x: 50, y: 65, r: 10}
    ];

    const coloresVibrantes = ['#ff3b30', '#007aff', '#34c759', '#ffcc00'];

    for(let i=0; i<cantidad; i++) {
        let p = posiciones[i % 10];
        let colorFondo = '#ffffff'; 
        
        if (tipo === 'comodin' || tipo === 'reversa' || tipo === 'triste') {
            colorFondo = coloresVibrantes[i % 4];
        }

        svg += `<g transform="rotate(${p.r} ${p.x+12} ${p.y+17})" filter="url(#sombra-carta)">
                    <rect x="${p.x}" y="${p.y}" width="26" height="36" rx="3" fill="${colorFondo}" stroke="#222" stroke-width="2"/>`;
        
        if (tipo === 'triste') {
            svg += `
                <circle cx="${p.x + 8}" cy="${p.y + 12}" r="2" fill="#111"/>
                <circle cx="${p.x + 18}" cy="${p.y + 12}" r="2" fill="#111"/>
                <path d="M ${p.x + 6} ${p.y + 24} Q ${p.x + 13} ${p.y + 16} ${p.x + 20} ${p.y + 24}" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>
            `;
        }
        svg += `</g>`;
    }

    if (tipo === 'reversa') {
        svg += `
            <g filter="url(#sombra-carta)">
                <path d="M 30,55 A 20,20 0 0 1 70,35" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
                <polyline points="55,20 70,35 55,50" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
                <path d="M 70,45 A 20,20 0 0 1 30,65" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
                <polyline points="45,80 30,65 45,50" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
            </g>
        `;
    }
    svg += `</svg>`;
    return svg;
};

export const svgToma2 = crearPila(2, 'normal');
export const svgToma4 = crearPila(4, 'normal');
export const svgToma6 = crearPila(6, 'normal'); 
export const svgToma10 = crearPila(10, 'normal'); 

export const svgWildToma6 = crearPila(6, 'comodin');
export const svgWildToma10 = crearPila(10, 'comodin');
export const svgWildReversaToma4 = crearPila(4, 'reversa');

export const svgRuleta = crearPila(4, 'triste');

// Comodín estándar (wild): cuatro cuadrantes de colores
export const svgWild = `
<svg viewBox="0 0 100 100">
    <path d="M50,50 L50,10 A40,40 0 0,1 90,50 Z" fill="#ff3b30"/>
    <path d="M50,50 L90,50 A40,40 0 0,1 50,90 Z" fill="#007aff"/>
    <path d="M50,50 L50,90 A40,40 0 0,1 10,50 Z" fill="#34c759"/>
    <path d="M50,50 L10,50 A40,40 0 0,1 50,10 Z" fill="#ffcc00"/>
    <circle cx="50" cy="50" r="12" fill="#0d0d0d" stroke="white" stroke-width="3"/>
</svg>
`;

// Comodín +4 clásico: cuatro cuadrantes + pila de 4 cartas
export const svgWildToma4 = crearPila(4, 'comodin');
