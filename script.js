// ============================================================
// SIMULADOR ROBOT-COCHE — Motor Principal
// Base: autoObstaculos (funcional) + Estética Neón + Obstáculos sueltos
// ============================================================

// --- VARIABLES GLOBALES ---
var robot;
var estado = "AVANZAR";
var ultimoGiroEscape = 0;
var contadorEscapes = 0;
var margen = 0;
var tControl = 0;
var tDuracion = Infinity;

var sensor_frontal = 0;
var sensor_derecho = 0;
var sensor_izquierdo = 0;

var chocoMsg = 0; // Temporizador del popup de choque
var tiempoInicio = 0;    // Timestamp de cuando se reanudó por última vez
var tiempoAcumulado = 0; // Segundos ya corridos antes de la última pausa
var tiempoChoque = 0;    // Tiempo que duró antes de chocar

// --- MAPA: Objetos tirados en el piso de un aula ---
var walls = [
  // Paredes del aula (marcos)
  { type: 'rect', x: 0, y: 0, w: 1200, h: 10 },
  { type: 'rect', x: 0, y: 890, w: 1200, h: 10 },
  { type: 'rect', x: 0, y: 0, w: 10, h: 900 },
  { type: 'rect', x: 1190, y: 0, w: 10, h: 900 },

  // Cajas (libros, mochilas, bases)
  { type: 'rect', x: 300, y: 200, w: 90, h: 90 },
  { type: 'rect', x: 700, y: 350, w: 140, h: 60 },
  { type: 'rect', x: 950, y: 150, w: 70, h: 180 },
  { type: 'rect', x: 150, y: 550, w: 160, h: 50 },
  { type: 'rect', x: 550, y: 650, w: 100, h: 100 },
  { type: 'rect', x: 900, y: 600, w: 110, h: 110 },

  // Objetos redondos (tachos, macetas, columnas)
  { type: 'circle', x: 500, y: 450, r: 40 },
  { type: 'circle', x: 850, y: 780, r: 50 },
  { type: 'circle', x: 1080, y: 300, r: 30 },
  { type: 'circle', x: 200, y: 800, r: 35 },
  { type: 'circle', x: 700, y: 170, r: 45 }
];

// --- CONSTANTES DE ESTADO (compatibles con Arduino) ---
const AVANZAR = "AVANZAR";
const GIRAR_D = "GIRAR_D";
const GIRAR_I = "GIRAR_I";
const RETROCEDER = "RETROCEDER";
const GIRAR_ESTRAT_I = "GIRAR_ESTRAT_I";
const GIRAR_ESTRAT_D = "GIRAR_ESTRAT_D";

let studentControl = () => {};
let ejecutando = false;

// --- FUNCIONES DE MOVIMIENTO (API del alumno) ---
function createRobot() {
  return { x: 70, y: 70, theta: 0, vL: 0, vR: 0 };
}

function avanzar()    { robot.vL = 4;  robot.vR = 4;  }
function retroceder() { robot.vL = -4; robot.vR = -4; }
function parar()      { robot.vL = 0;  robot.vR = 0;  }
function girarDer()   { robot.vL = 2;  robot.vR = -2; }
function girarIzq()   { robot.vL = -2; robot.vR = 2;  }

function randomArduino(min, max) {
  if (max === undefined) { max = min; min = 0; }
  return Math.floor(Math.random() * (max - min)) + min;
}

// --- COMPILADOR DEL CÓDIGO DEL ALUMNO ---
function runCode() {
  let code = document.getElementById("code").value;
  try {
    studentControl = new Function(
      "AVANZAR", "GIRAR_D", "GIRAR_I", "RETROCEDER",
      "GIRAR_ESTRAT_I", "GIRAR_ESTRAT_D", "millis", "random", code
    );
    ejecutando = true;
    // Solo reseteamos el tiempo si no había nada acumulado (primera vez o tras reiniciar)
    tiempoChoque = 0;
    tiempoInicio = Date.now(); // Marcamos el momento en que se reanuda
    document.getElementById('btn-play').disabled = true;
  } catch (e) {
    alert("Error de sintaxis: " + e.message);
    document.getElementById('btn-play').disabled = false;
  }
}

function reiniciar() {
  robot = createRobot();
  estado = AVANZAR;
  ejecutando = false;
  parar();
  tiempoInicio = 0;
  tiempoAcumulado = 0;
  tiempoChoque = 0;
  chocoMsg = 0;
  document.getElementById('btn-play').disabled = false;
}

// --- FÍSICA ---
function updateRobot() {
  let v = (robot.vL + robot.vR) / 2;
  let w = (robot.vL - robot.vR) / 40;
  robot.x += v * Math.cos(robot.theta);
  robot.y += v * Math.sin(robot.theta);
  robot.theta += w;
  if (robot.theta > Math.PI * 2) robot.theta -= Math.PI * 2;
  if (robot.theta < -Math.PI * 2) robot.theta += Math.PI * 2;
}

// --- DETECCIÓN DE COLISIÓN DEL CUERPO ---
function puntoChocaConObstaculos(px, py) {
  if (px < 0 || px > 1200 || py < 0 || py > 900) return true;
  for (let w of walls) {
    if (w.type === 'rect') {
      if (px > w.x && px < w.x + w.w && py > w.y && py < w.y + w.h) return true;
    } else if (w.type === 'circle') {
      let dx = px - w.x, dy = py - w.y;
      if (dx * dx + dy * dy < w.r * w.r) return true;
    }
  }
  return false;
}

function robotChoca() {
  // Chequeamos 8 puntos del contorno del chasis (32x22)
  let puntos = [
    { lx: 16, ly: 0 },   // Frente centro
    { lx: 16, ly: 11 },  // Frente derecho
    { lx: 16, ly: -11 }, // Frente izquierdo
    { lx: -16, ly: 0 },  // Atrás centro
    { lx: -16, ly: 11 }, // Atrás derecho
    { lx: -16, ly: -11 },// Atrás izquierdo
    { lx: 0, ly: 11 },   // Lateral derecho
    { lx: 0, ly: -11 }   // Lateral izquierdo
  ];
  let cosT = Math.cos(robot.theta);
  let sinT = Math.sin(robot.theta);
  for (let p of puntos) {
    let wx = robot.x + p.lx * cosT - p.ly * sinT;
    let wy = robot.y + p.lx * sinT + p.ly * cosT;
    if (puntoChocaConObstaculos(wx, wy)) return true;
  }
  return false;
}

// --- SENSORES ULTRASÓNICOS (Cono de 15° con offset frontal) ---
function medirDistanciaCono(thetaOffset, offsetFrontal) {
  let maxDist = 250;
  let minDist = maxDist;
  let angApertura = Math.PI / 24;
  let numRayos = 7;
  let pasoApertura = (angApertura * 2) / (numRayos - 1);

  let ox = robot.x + Math.cos(robot.theta) * offsetFrontal;
  let oy = robot.y + Math.sin(robot.theta) * offsetFrontal;

  for (let r = 0; r < numRayos; r++) {
    let angRayo = robot.theta + thetaOffset - angApertura + (pasoApertura * r);
    let distRayo = maxDist;

    for (let d = 0; d < maxDist; d += 2) {
      let x = ox + Math.cos(angRayo) * d;
      let y = oy + Math.sin(angRayo) * d;

      if (x < 0 || x > 1200 || y < 0 || y > 900) { distRayo = d; break; }

      let choca = false;
      for (let w of walls) {
        if (w.type === 'rect') {
          if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) { choca = true; break; }
        } else if (w.type === 'circle') {
          let dx = x - w.x, dy = y - w.y;
          if (dx * dx + dy * dy < w.r * w.r) { choca = true; break; }
        }
      }
      if (choca) { distRayo = d; break; }
    }
    if (distRayo < minDist) minDist = distRayo;
  }
  return minDist;
}

function medirSensores() {
  sensor_frontal    = medirDistanciaCono(0, 15);
  sensor_izquierdo  = medirDistanciaCono(-Math.PI / 2, 15);
  sensor_derecho    = medirDistanciaCono(Math.PI / 2, 15);
}

// --- DIBUJO ---
function drawRobot() {
  push();
  translate(robot.x, robot.y);
  rotate(robot.theta);
  rectMode(CENTER);
  // Chasis
  fill(30, 40, 50); stroke(88, 166, 255); strokeWeight(2);
  rect(0, 0, 32, 22, 4);
  // Ruedas
  fill(20); noStroke();
  rect(-8, -13, 14, 4);
  rect(-8, 13, 14, 4);
  // LED delantero
  fill(255, 80, 80); noStroke();
  ellipse(12, 0, 7, 7);
  pop();
}

function drawSensorCono(dist, angOffset, offsetFrontal) {
  let ang = robot.theta + angOffset;
  let angApertura = Math.PI / 24;
  let ox = robot.x + Math.cos(robot.theta) * offsetFrontal;
  let oy = robot.y + Math.sin(robot.theta) * offsetFrontal;

  if (dist < 50)       { fill(255, 0, 0, 80);    stroke(255, 0, 0, 120);   }
  else if (dist < 250) { fill(255, 255, 0, 60);   stroke(255, 255, 0, 100); }
  else                 { fill(0, 100, 255, 40);    stroke(0, 100, 255, 60);  }
  arc(ox, oy, dist * 2, dist * 2, ang - angApertura, ang + angApertura, PIE);
}

function drawSensors() {
  drawSensorCono(sensor_frontal, 0, 15);
  drawSensorCono(sensor_izquierdo, -Math.PI / 2, 15);
  drawSensorCono(sensor_derecho, Math.PI / 2, 15);
}

function drawWalls() {
  for (let w of walls) {
    fill(22, 27, 34);
    stroke(88, 166, 255);
    strokeWeight(2);
    if (w.type === 'rect') {
      rectMode(CORNER);
      rect(w.x, w.y, w.w, w.h);
    } else if (w.type === 'circle') {
      ellipse(w.x, w.y, w.r * 2);
    }
  }
}

function drawDebug() {
  fill(200); noStroke(); textSize(13);
  text("Estado: " + estado, 15, 25);
  text("F: " + sensor_frontal.toFixed(0) + "  |  I: " + sensor_izquierdo.toFixed(0) + "  |  D: " + sensor_derecho.toFixed(0), 15, 45);

  // Cronómetro arriba a la derecha
  let segs = 0;
  if (tiempoChoque > 0) {
    segs = tiempoChoque;
  } else if (tiempoInicio > 0) {
    // Acumulado de sesiones anteriores + lo que lleva corriendo ahora
    segs = tiempoAcumulado + (ejecutando ? (Date.now() - tiempoInicio) / 1000 : 0);
  } else {
    segs = tiempoAcumulado;
  }
  let tiempoStr = formatTime(segs);
  
  textAlign(RIGHT, TOP);
  textSize(20);
  fill(tiempoChoque > 0 ? color(255, 80, 80) : color(88, 166, 255));
  text('⏱ ' + tiempoStr, 1185, 15);
  textAlign(LEFT, BASELINE);
}

function detenerEjecucion() {
  if (ejecutando) {
    // Guardar el tiempo corrido hasta ahora antes de pausar
    tiempoAcumulado += (Date.now() - tiempoInicio) / 1000;
  }
  ejecutando = false;
  parar();
  document.getElementById('btn-play').disabled = false;
}

function control() {
  if (!ejecutando) return;
  try {
    studentControl(AVANZAR, GIRAR_D, GIRAR_I, RETROCEDER, GIRAR_ESTRAT_I, GIRAR_ESTRAT_D, millis, randomArduino);
  } catch (e) { console.error(e); }
}

// --- P5.JS LIFECYCLE ---
function setup() {
  let canvas = createCanvas(1200, 900);
  canvas.parent('canvas-container');
  robot = createRobot();
  renderRecords(); // Cargar la lista al inicio
}

function draw() {
  clear();
  drawWalls();

  // Si está en estado de choque, mostrar popup y no hacer nada más
  if (chocoMsg > 0) {
    drawRobot();
    drawPopupChoque();
    chocoMsg--;
    if (chocoMsg <= 0) {
      reiniciar();
    }
    return;
  }

  medirSensores();
  control();
  updateRobot();

  // Chequear colisión del cuerpo
  if (ejecutando && robotChoca()) {
    // El tiempo total es lo acumulado + lo que corrió desde el último play
    tiempoChoque = tiempoAcumulado + (Date.now() - tiempoInicio) / 1000;
    tiempoAcumulado = 0; // Reset para el próximo intento
    chocoMsg = 120; // ~2 segundos a 60fps
    parar();
    guardarRecord(tiempoChoque); // Guardar en persistencia
  }

  drawRobot();
  drawSensors();
  drawDebug();
}

function drawPopupChoque() {
  // Fondo oscuro semi-transparente
  fill(0, 0, 0, 180);
  noStroke();
  rectMode(CENTER);
  rect(600, 450, 1200, 900);
  
  // Caja del mensaje (más alta para que entre el tiempo)
  fill(218, 54, 51, 240);
  stroke(255, 80, 80);
  strokeWeight(3);
  rect(600, 400, 420, 200, 16);
  
  // Texto principal
  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(36);
  text("💥 ¡CHOCASTE!", 600, 355);
  
  // Tiempo sobrevivido
  let tiempoStr = formatTime(tiempoChoque);
  
  textSize(22);
  fill(255, 255, 150); // Amarillo suave para destacar
  text("Tiempo aguantado: " + tiempoStr, 600, 410);

  // Mensaje secundario
  textSize(15);
  fill(255, 200, 200);
  text("Reiniciando en un momento...", 600, 460);
  
  textAlign(LEFT, BASELINE);
  rectMode(CORNER);
}

function millis() { return Date.now(); }

// --- SISTEMA DE RECORDS (LOCALSTORAGE) ---
function formatTime(segs) {
  let mins = Math.floor(segs / 60);
  let secs = Math.floor(segs % 60);
  let ms = Math.floor((segs % 1) * 10);
  return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs + '.' + ms;
}

function guardarRecord(segs) {
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  let fecha = new Date();
  let horaStr = fecha.getHours().toString().padStart(2, '0') + ':' + fecha.getMinutes().toString().padStart(2, '0');
  
  // Agregamos al final (orden cronológico)
  records.push({ tiempo: segs, string: formatTime(segs), hora: horaStr });
  
  // Guardamos hasta los ultimos 50 intentos en la sesión
  if(records.length > 50) records.shift();
  
  localStorage.setItem('robotRecords', JSON.stringify(records));
  renderRecords();
}

function limpiarRecords() {
  localStorage.removeItem('robotRecords');
  renderRecords();
}

function renderRecords() {
  let listEl = document.getElementById('records-list');
  if(!listEl) return;
  
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  if (records.length === 0) {
    listEl.innerHTML = '<span style="color:#484f58; font-style:italic;">Sin tiempos registrados aún. ¡A rodar!</span>';
    return;
  }
  
  // Buscamos los 3 mejores tiempos históricos para destacarlos en la lista general
  let clonRecords = [...records];
  clonRecords.sort((a, b) => b.tiempo - a.tiempo);
  let top1 = clonRecords.length > 0 ? clonRecords[0].tiempo : -1;
  let top2 = clonRecords.length > 1 ? clonRecords[1].tiempo : -1;
  let top3 = clonRecords.length > 2 ? clonRecords[2].tiempo : -1;
  
  let html = '<ul style="padding: 0; margin: 0; list-style: none; color:#e6edf3; font-family: \'Fira Code\', monospace;">';
  
  // Iteramos en reversa: los intentos más recientes primero (arriba) y los iniciales abajo
  for(let i = records.length - 1; i >= 0; i--) {
    let r = records[i];
    let icon = '🔹';
    let colorT = 'color:#58a6ff;';
    
    // Asignamos trofeo una única vez a los 3 mejores (por si hay empates)
    if (r.tiempo === top1 && top1 > 0) { icon = '🏆'; colorT = 'color:#e3b341;'; top1 = -1; }
    else if (r.tiempo === top2 && top2 > 0) { icon = '🥈'; colorT = 'color:#d2a8ff;'; top2 = -1; }
    else if (r.tiempo === top3 && top3 > 0) { icon = '🥉'; colorT = 'color:#ff7b72;'; top3 = -1; }
    else { colorT = 'color:#8b949e;'; } // Tiempos normales, un tono gris/azulado suave
    
    html += `<li style="margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">
              <span style="display:inline-block; width:22px; text-align:center;">${icon}</span> 
              <span style="${colorT} font-weight:bold;">${r.string}</span> 
              <span style="color:#484f58; font-size:11px; float:right; margin-top:2px;">#${i+1} - ${r.hora}</span>
             </li>`;
  }
  html += '</ul>';
  listEl.innerHTML = html;
}
