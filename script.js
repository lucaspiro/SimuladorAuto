// ============================================================
// SIMULADOR ROBOT-COCHE — Motor Principal
// Base: autoObstaculos (funcional) + Estética Neón + Obstáculos sueltos
// + Sistema de Replay: graba los 10 segundos antes del choque
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

// --- SISTEMA DE REPLAY ---
const REPLAY_FPS = 60;
const REPLAY_SEGUNDOS = 10;
const REPLAY_MAX_FRAMES = REPLAY_FPS * REPLAY_SEGUNDOS; // 600 frames

// Buffer circular que graba posiciones continuamente
var replayBuffer = [];      // Array of {x, y, theta}
var replayBufferIdx = 0;    // Índice de escritura circular
var replayBufferFull = false; // Si ya llenamos el buffer al menos una vez

// Para el modo de reproducción
var enReplay = false;
var replayFrames = [];      // Snapshot lineal del buffer al momento del choque
var replayFrameActual = 0;
var replayVelocidad = 1;    // Multiplicador de velocidad del replay

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
  // Si estamos en replay, cancelarlo
  if (enReplay) {
    detenerReplay();
  }

  robot = createRobot();
  estado = AVANZAR;
  ejecutando = false;
  parar();
  tiempoInicio = 0;
  tiempoAcumulado = 0;
  tiempoChoque = 0;
  chocoMsg = 0;
  document.getElementById('btn-play').disabled = false;

  // Reiniciar buffer de replay
  replayBuffer = [];
  replayBufferIdx = 0;
  replayBufferFull = false;
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

// --- BUFFER DE REPLAY: Grabar frame actual ---
function grabarFrameReplay() {
  if (!ejecutando) return;
  let frame = { x: robot.x, y: robot.y, theta: robot.theta };
  if (replayBuffer.length < REPLAY_MAX_FRAMES) {
    replayBuffer.push(frame);
  } else {
    // Buffer circular: reemplazamos el frame más antiguo
    replayBuffer[replayBufferIdx] = frame;
    replayBufferFull = true;
  }
  replayBufferIdx = (replayBufferIdx + 1) % REPLAY_MAX_FRAMES;
}

// Extrae el buffer circular como array lineal (del más antiguo al más nuevo)
function capturarReplayActual() {
  if (!replayBufferFull) {
    // El buffer aún no está lleno: retornar todo lo grabado
    return [...replayBuffer];
  } else {
    // Buffer circular lleno: reordenar desde el más antiguo
    let parte1 = replayBuffer.slice(replayBufferIdx); // desde el más antiguo
    let parte2 = replayBuffer.slice(0, replayBufferIdx);
    return parte1.concat(parte2);
  }
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
function drawRobot(rx, ry, rtheta, alpha) {
  // Parámetros opcionales: si no se pasan, usa el robot actual
  let px = (rx !== undefined) ? rx : robot.x;
  let py = (ry !== undefined) ? ry : robot.y;
  let pt = (rtheta !== undefined) ? rtheta : robot.theta;
  let al = (alpha !== undefined) ? alpha : 255;

  push();
  translate(px, py);
  rotate(pt);
  rectMode(CENTER);
  // Chasis
  fill(30, 40, 50, al); stroke(88, 166, 255, al); strokeWeight(2);
  rect(0, 0, 32, 22, 4);
  // Ruedas
  fill(20, 20, 20, al); noStroke();
  rect(-8, -13, 14, 4);
  rect(-8, 13, 14, 4);
  // LED delantero
  fill(255, 80, 80, al); noStroke();
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
    tiempoAcumulado += (Date.now() - tiempoInicio) / 1000;
  }
  ejecutando = false;
  parar();
  document.getElementById('btn-play').disabled = false;
  // Actualizar botones de replay en el historial
  renderRecords();
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

  // -------- MODO REPLAY --------
  if (enReplay) {
    drawReplay();
    return;
  }

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

  // Grabar posición actual antes de actualizar (solo si está ejecutando)
  grabarFrameReplay();

  medirSensores();
  control();
  updateRobot();

  // Chequear colisión del cuerpo
  if (ejecutando && robotChoca()) {
    tiempoChoque = tiempoAcumulado + (Date.now() - tiempoInicio) / 1000;
    tiempoAcumulado = 0;
    chocoMsg = 120; // ~2 segundos a 60fps
    parar();
    // Capturar el replay antes de reiniciar
    let framesGuardados = capturarReplayActual();
    guardarRecord(tiempoChoque, framesGuardados);
  }

  drawRobot();
  drawSensors();
  drawDebug();
}

// ============================================================
// SISTEMA DE REPLAY
// ============================================================

function iniciarReplay(frames) {
  if (ejecutando) {
    alert("Pausá la simulación primero para ver el replay.");
    return;
  }
  if (!frames || frames.length === 0) {
    alert("No hay frames de replay guardados.");
    return;
  }
  enReplay = true;
  replayFrames = frames;
  replayFrameActual = 0;
  replayVelocidad = 1;

  // Mostrar overlay de controles de replay
  document.getElementById('replay-overlay').style.display = 'flex';
  actualizarUIReplay();
}

function detenerReplay() {
  enReplay = false;
  replayFrames = [];
  replayFrameActual = 0;
  document.getElementById('replay-overlay').style.display = 'none';
}

function drawReplay() {
  let totalFrames = replayFrames.length;
  if (totalFrames === 0 || replayFrameActual >= totalFrames) {
    // Replay terminó
    if (replayFrameActual >= totalFrames && totalFrames > 0) {
      // permanecer en el último frame
      replayFrameActual = totalFrames - 1;
    }
  }

  // Calcular el tiempo del replay (en segundos) desde el inicio del array
  let segsDesdeInicio = (replayFrameActual / REPLAY_FPS);
  let segsTotal = (totalFrames / REPLAY_FPS);
  
  // Dibujar "fantasma" de la trayectoria (trail)
  drawReplayTrail(replayFrameActual);

  // Dibujar robot en la posición actual del replay
  let f = replayFrames[replayFrameActual];
  drawRobot(f.x, f.y, f.theta, 255);

  // HUD del replay
  drawReplayHUD(segsDesdeInicio, segsTotal, totalFrames);

  // Avanzar frame
  for (let i = 0; i < replayVelocidad; i++) {
    if (replayFrameActual < totalFrames - 1) {
      replayFrameActual++;
    }
  }

  actualizarBarraReplay(replayFrameActual, totalFrames);
}

function drawReplayTrail(frameActual) {
  // Dibujar los últimos 60 frames como trail semitransparente
  let trailLen = 60;
  let desde = Math.max(0, frameActual - trailLen);
  for (let i = desde; i <= frameActual; i++) {
    let f = replayFrames[i];
    let progresso = (i - desde) / trailLen;
    let al = progresso * 120; // más opaco cerca del frame actual
    
    // Solo puntos del trail (sin dibujar todo el robot)
    push();
    noStroke();
    fill(255, 200, 0, al);
    ellipse(f.x, f.y, 5, 5);
    pop();
  }
}

function drawReplayHUD(segsActual, segsTotal, totalFrames) {
  // Banner superior "REPLAY"
  rectMode(CORNER);
  fill(0, 0, 0, 160);
  noStroke();
  rect(0, 0, 1200, 60);

  // Texto REPLAY
  fill(255, 200, 0);
  textAlign(LEFT, CENTER);
  textSize(22);
  text("⏮ REPLAY — Últimos " + min(segsTotal, REPLAY_SEGUNDOS).toFixed(0) + "s antes del choque", 20, 30);

  // Tiempo actual
  textAlign(RIGHT, CENTER);
  textSize(18);
  fill(200, 200, 200);
  text(formatTime(segsActual) + " / " + formatTime(segsTotal), 1180, 30);

  // Velocidad
  textAlign(CENTER, CENTER);
  textSize(14);
  fill(150, 255, 150);
  text("Velocidad: " + replayVelocidad + "x", 600, 30);

  // Barra de progreso
  let progresoX = totalFrames > 1 ? replayFrameActual / (totalFrames - 1) : 0;
  fill(40, 40, 40, 200);
  noStroke();
  rect(20, 48, 1160, 8, 4);
  fill(255, 200, 0);
  rect(20, 48, progresoX * 1160, 8, 4);

  // Indicador choque (al final)
  fill(255, 80, 80);
  ellipse(20 + 1160, 52, 12, 12);

  textAlign(LEFT, BASELINE);
  rectMode(CORNER);
}

function actualizarBarraReplay(frame, total) {
  let pct = total > 1 ? (frame / (total - 1)) * 100 : 0;
  let barraEl = document.getElementById('replay-barra');
  if (barraEl) barraEl.value = pct;

  let tiempoEl = document.getElementById('replay-tiempo');
  if (tiempoEl) tiempoEl.textContent = formatTime(frame / REPLAY_FPS) + ' / ' + formatTime(total / REPLAY_FPS);
}

function actualizarUIReplay() {
  let barraEl = document.getElementById('replay-barra');
  if (barraEl) barraEl.value = 0;
}

// Saltar a un punto específico de la barra de progreso
function seekReplay(valor) {
  if (!enReplay || replayFrames.length === 0) return;
  replayFrameActual = Math.floor((valor / 100) * (replayFrames.length - 1));
}

function cambiarVelocidadReplay(delta) {
  replayVelocidad = Math.max(1, Math.min(8, replayVelocidad + delta));
  let velEl = document.getElementById('replay-vel');
  if (velEl) velEl.textContent = replayVelocidad + 'x';
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
  fill(255, 255, 150);
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

function guardarRecord(segs, frames) {
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  let fecha = new Date();
  let horaStr = fecha.getHours().toString().padStart(2, '0') + ':' + fecha.getMinutes().toString().padStart(2, '0');
  
  // Comprimir frames para almacenamiento (reducir precisión decimal)
  let framesComprimidos = frames.map(f => ({
    x: Math.round(f.x * 10) / 10,
    y: Math.round(f.y * 10) / 10,
    t: Math.round(f.theta * 1000) / 1000
  }));

  records.push({ 
    tiempo: segs, 
    string: formatTime(segs), 
    hora: horaStr, 
    replay: framesComprimidos 
  });
  
  // Guardamos hasta los últimos 20 intentos (con replay los datos son más grandes)
  if (records.length > 20) records.shift();
  
  localStorage.setItem('robotRecords', JSON.stringify(records));
  renderRecords();
}

function limpiarRecords() {
  localStorage.removeItem('robotRecords');
  renderRecords();
}

function renderRecords() {
  let listEl = document.getElementById('records-list');
  if (!listEl) return;
  
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  if (records.length === 0) {
    listEl.innerHTML = '<span style="color:#484f58; font-style:italic;">Sin tiempos registrados aún. ¡A rodar!</span>';
    return;
  }
  
  // Buscamos los 3 mejores tiempos históricos para destacarlos
  let clonRecords = [...records];
  clonRecords.sort((a, b) => b.tiempo - a.tiempo);
  let top1 = clonRecords.length > 0 ? clonRecords[0].tiempo : -1;
  let top2 = clonRecords.length > 1 ? clonRecords[1].tiempo : -1;
  let top3 = clonRecords.length > 2 ? clonRecords[2].tiempo : -1;
  
  let html = '<ul style="padding: 0; margin: 0; list-style: none; color:#e6edf3; font-family: \'Fira Code\', monospace;">';
  
  for (let i = records.length - 1; i >= 0; i--) {
    let r = records[i];
    let icon = '🔹';
    let colorT = 'color:#58a6ff;';
    
    if (r.tiempo === top1 && top1 > 0) { icon = '🏆'; colorT = 'color:#e3b341;'; top1 = -1; }
    else if (r.tiempo === top2 && top2 > 0) { icon = '🥈'; colorT = 'color:#d2a8ff;'; top2 = -1; }
    else if (r.tiempo === top3 && top3 > 0) { icon = '🥉'; colorT = 'color:#ff7b72;'; top3 = -1; }
    else { colorT = 'color:#8b949e;'; }

    // Botón de replay (solo visible si hay frames guardados)
    let replayBtn = '';
    if (r.replay && r.replay.length > 0) {
      replayBtn = `<button 
        id="replay-btn-${i}"
        onclick="verReplayDelHistorial(${i})" 
        title="Ver los últimos ${Math.min(REPLAY_SEGUNDOS, (r.replay.length / REPLAY_FPS).toFixed(0))}s antes del choque"
        style="
          flex:none; 
          background: linear-gradient(135deg, rgba(255,200,0,0.15), rgba(255,130,0,0.15)); 
          color: #ffa500; 
          border: 1px solid rgba(255,165,0,0.4); 
          padding: 2px 7px; 
          border-radius: 4px; 
          font-size: 11px; 
          cursor: pointer; 
          font-weight: bold;
          transition: all 0.2s;
          margin-left: 4px;
          vertical-align: middle;
        "
        onmouseover="this.style.background='linear-gradient(135deg,rgba(255,200,0,0.35),rgba(255,130,0,0.35))'; this.style.borderColor='rgba(255,165,0,0.8)';"
        onmouseout="this.style.background='linear-gradient(135deg,rgba(255,200,0,0.15),rgba(255,130,0,0.15))'; this.style.borderColor='rgba(255,165,0,0.4)';"
      >⏮ Replay</button>`;
    }
    
    html += `<li style="margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px; display:flex; align-items:center; justify-content:space-between;">
              <span>
                <span style="display:inline-block; width:22px; text-align:center;">${icon}</span> 
                <span style="${colorT} font-weight:bold;">${r.string}</span>
              </span>
              <span style="display:flex; align-items:center; gap:4px;">
                ${replayBtn}
                <span style="color:#484f58; font-size:11px;">#${i+1} ${r.hora}</span>
              </span>
             </li>`;
  }
  html += '</ul>';
  listEl.innerHTML = html;

  // Actualizar estado de botones según si la sim está pausada
  actualizarBotonesReplay();
}

// Actualizar estado habilitado/deshabilitado de todos los botones de replay
function actualizarBotonesReplay() {
  if (typeof ejecutando === 'undefined') return;
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  for (let i = 0; i < records.length; i++) {
    let btn = document.getElementById('replay-btn-' + i);
    if (!btn) continue;
    if (ejecutando || enReplay) {
      btn.disabled = true;
      btn.style.opacity = '0.3';
      btn.title = 'Pausá la simulación para ver el replay';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.title = 'Ver replay del choque';
      btn.style.cursor = 'pointer';
    }
  }
}

function verReplayDelHistorial(idx) {
  if (ejecutando) {
    alert("⏸ Pausá la simulación primero para ver el replay.");
    return;
  }
  if (enReplay) {
    detenerReplay();
    return;
  }
  let records = JSON.parse(localStorage.getItem('robotRecords')) || [];
  let r = records[idx];
  if (!r || !r.replay || r.replay.length === 0) {
    alert("No hay datos de replay para este intento.");
    return;
  }
  // Descomprimir frames
  let frames = r.replay.map(f => ({ x: f.x, y: f.y, theta: f.t }));
  iniciarReplay(frames);
}
