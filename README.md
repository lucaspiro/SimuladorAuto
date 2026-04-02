# Simulador — Robot Esquiva Obstáculos

🚀 **Probalo en vivo acá:** [https://lucaspiro.github.io/SimuladorAuto/](https://lucaspiro.github.io/SimuladorAuto/)

Simulador web interactivo para programar y probar la lógica de un robot autónomo sin necesidad del hardware físico. El código que el alumno escribe en el simulador es **el mismo switch/case** que se carga en el Arduino real, sin cambios.

---

## 📁 Estructura del proyecto

```
auto/
├── index.html      # Interfaz principal del simulador
├── script.js       # Motor del simulador (física, sensores, render, records)
└── ejemplo.html    # Guía de referencia y ejemplo de uso para el alumno
```

---

## 🚀 Cómo usarlo

1. Abrí `index.html` en el navegador (sin servidor, funciona directo desde el archivo).
2. En el editor del panel derecho, pegá tu lógica de control usando el patrón `switch (estado)`.
3. Presioná **▶ Ejecutar** para correr la simulación.
4. Si el robot choca, aparece el tiempo que sobrevivió y se reinicia automáticamente.
5. Para referencia de API, hacé clic en _"Ver ejemplo de uso →"_ dentro del simulador.

---

## 🧠 Cómo funciona el simulador

El motor (`script.js`) ejecuta el código del alumno **60 veces por segundo** usando `new Function(...)`. Cada iteración equivale a un ciclo de `void loop()` en Arduino.

El alumno escribe un `switch (estado)` que controla el robot a través de:

### 🚗 Funciones de movimiento

| Función        | Descripción                     |
| -------------- | ------------------------------- |
| `avanzar()`    | Ambas ruedas hacia adelante     |
| `retroceder()` | Ambas ruedas hacia atrás        |
| `girarDer()`   | Giro en el lugar a la derecha   |
| `girarIzq()`   | Giro en el lugar a la izquierda |
| `parar()`      | Detiene los motores             |

### 📡 Sensores (variables globales)

| Variable           | Descripción                                         |
| ------------------ | --------------------------------------------------- |
| `sensor_frontal`   | Distancia al obstáculo más cercano adelante (0–250) |
| `sensor_izquierdo` | Distancia al obstáculo a la izquierda (0–250)       |
| `sensor_derecho`   | Distancia al obstáculo a la derecha (0–250)         |

Los sensores usan un cono de 15° con 7 rayos — se devuelve la mínima distancia del cono.

### 🏷️ Estados disponibles

| Constante        | Tipo               | Cuándo sale                                                      |
| ---------------- | ------------------ | ---------------------------------------------------------------- |
| `AVANZAR`        | Normal             | Al detectar obstáculo                                            |
| `GIRAR_D`        | Corrección suave   | Cuando el **sensor** confirma espacio libre                      |
| `GIRAR_I`        | Corrección suave   | Cuando el **sensor** confirma espacio libre                      |
| `RETROCEDER`     | Escape             | Al cumplirse el timer                                            |
| `GIRAR_ESTRAT_D` | Escape estratégico | Al cumplirse el **timer** (sale siempre, aunque no haya espacio) |
| `GIRAR_ESTRAT_I` | Escape estratégico | Al cumplirse el **timer** (sale siempre, aunque no haya espacio) |

> **Diferencia clave**: `GIRAR_D/I` dependen del sensor para salir — pueden quedar en loop si el robot está encerrado. `GIRAR_ESTRAT_D/I` salen por timer y garantizan la salida en cualquier situación.

### 🔧 Variables de control de tiempo

| Variable    | Descripción                                      |
| ----------- | ------------------------------------------------ |
| `estado`    | Estado actual de la FSM                          |
| `tControl`  | `millis()` del momento en que se entró al estado |
| `tDuracion` | Tiempo en ms que debe durar el estado actual     |

### ⏱️ Utilidades

| Función            | Descripción                                                    |
| ------------------ | -------------------------------------------------------------- |
| `millis()`         | Milisegundos transcurridos desde el inicio (igual que Arduino) |
| `random(min, max)` | Número entero aleatorio entre `min` y `max-1`                  |

---

## 📐 Patrón de tiempo no bloqueante

En el simulador **no se puede usar `delay()`** porque bloquearía el navegador. El patrón equivalente es:

```cpp
// Al entrar al estado:
tControl  = millis();
tDuracion = 500;  // 500ms

// En cada frame, chequear si ya pasó:
if (millis() - tControl >= tDuracion) {
    estado = AVANZAR;  // o lo que corresponda
}
```

---

## 💡 Ejemplo mínimo

```cpp
switch (estado) {

case AVANZAR:
  avanzar();
  if (sensor_frontal < 60) {
    estado    = RETROCEDER;
    tControl  = millis();
    tDuracion = 200;
  }
  break;

case RETROCEDER:
  retroceder();
  if (millis() - tControl >= tDuracion) {
    if (random(0, 2) === 0) estado = GIRAR_ESTRAT_I;
    else                    estado = GIRAR_ESTRAT_D;
    tDuracion = 200 + random(0, 300);
    tControl  = millis();
  }
  break;

case GIRAR_ESTRAT_I:
  girarIzq();
  if (millis() - tControl >= tDuracion) estado = AVANZAR;
  break;

case GIRAR_ESTRAT_D:
  girarDer();
  if (millis() - tControl >= tDuracion) estado = AVANZAR;
  break;
}
```

---

## 🔌 Compatibilidad con Arduino

El código del simulador y el del Arduino son **idénticos**. La única diferencia está en el entorno:

|                  | Simulador                            | Arduino real                                    |
| ---------------- | ------------------------------------ | ----------------------------------------------- |
| `avanzar()` etc. | Modifica `vL`/`vR` del robot virtual | Llama a `aplicar_PWM()` con los motores físicos |
| `millis()`       | `Date.now()` del navegador           | Registro interno del microcontrolador           |
| `random()`       | `Math.floor(Math.random() * ...)`    | `random()` de Arduino                           |
| Sensores         | Raycast geométrico en el canvas      | Ultrasonido HC-SR04                             |

> Los valores numéricos (distancias en cm, tiempos en ms) **deben calibrarse empíricamente** en el hardware real — el simulador valida la lógica de estados, no los valores exactos.

---

## 🗺️ Mapa del simulador

El entorno simula el piso de un aula con objetos dispersos:

- **Paredes del aula**: bordes rectangulares del canvas (1200×900px)
- **Cajas** (libros, mochilas): obstáculos rectangulares
- **Objetos redondos** (tachos, columnas): obstáculos circulares

Todo está definido en el array `walls` de `script.js` y es fácilmente modificable.

---

## 🏆 Sistema de records

El simulador guarda automáticamente el tiempo de sobrevivencia de cada intento en `localStorage`. Se muestran los últimos 50 intentos con los 3 mejores destacados con 🏆🥈🥉.
