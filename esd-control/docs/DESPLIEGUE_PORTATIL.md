# Servidor en un portátil con Tailscale Funnel

La aplicación se ejecuta en un ordenador propio (Linux, macOS o Windows) y Tailscale Funnel la
publica en una dirección HTTPS fija, `https://<equipo>.<red>.ts.net`, accesible desde cualquier
sitio mientras el ordenador esté encendido, con la aplicación y Tailscale en marcha.

Funnel la hace **pública en internet** (no solo dentro de su red Tailscale): use contraseñas
fuertes y no cargue datos de demostración. Si solo la van a usar dispositivos de su red Tailscale,
use `tailscale serve` en lugar de `tailscale funnel` (Paso 6).

## 1 · Requisitos

| Programa | Comprobación | Instalación |
|---|---|---|
| Node.js 20.12 o superior | `node -v` | nodejs.org (LTS) |
| PostgreSQL 16 o superior | `psql --version` | Linux: `sudo apt install postgresql` · macOS: `brew install postgresql@16` · Windows: instalador de postgresql.org |
| Git | `git --version` | git-scm.com |
| Tailscale con sesión iniciada | `tailscale status` | tailscale.com/download |

## 2 · Código

```bash
git clone https://github.com/Sento79/mi-campito.git
cd mi-campito/esd-control
npm ci
```

## 3 · Base de datos

Cree un usuario propietario y la base de datos (sustituya la contraseña; use solo letras, dígitos
y `. _ ~ -`). En Linux, ejecútelo con `sudo -u postgres psql`; en macOS y Windows, con `psql` como
superusuario:

```sql
create role esd_owner login createrole password 'CONTRASEÑA_PROPIETARIO';
create database esd owner esd_owner;
```

## 4 · Variables

Copie `.env.example` a `.env` y ajuste:

```env
DATABASE_URL=postgres://esd_app:CONTRASEÑA_APP@localhost:5432/esd
MIGRATION_DATABASE_URL=postgres://esd_owner:CONTRASEÑA_PROPIETARIO@localhost:5432/esd
APP_DB_PASSWORD=CONTRASEÑA_APP
APP_URL=https://<equipo>.<red>.ts.net
COOKIE_SECURE=true
STORAGE_DIR=./storage
DEMO_SEED_ENABLED=false
```

`APP_URL` es la dirección que mostrará Funnel en el Paso 6 (se ve también en `tailscale status`
o en el panel de Tailscale, como nombre DNS del equipo). Las etiquetas QR la usan: fíjela antes de
imprimir.

## 5 · Preparar y arrancar

```bash
npm run db:migrate            # crea las tablas y el rol esd_app
npm run db:bootstrap          # primer administrador: defina antes las variables BOOTSTRAP_* en .env
npm run build
npm start                     # escucha en el puerto 3000
```

Tras `db:bootstrap`, borre `BOOTSTRAP_ADMIN_PASSWORD` de `.env`. Compruebe en el propio portátil
`http://localhost:3000/api/health` → `{"ok":true}`.

## 6 · Publicar con Tailscale Funnel

```bash
tailscale funnel --bg 3000
```

La primera vez, Tailscale puede pedir que active HTTPS y Funnel para la red (muestra un enlace al
panel). Al terminar, indica la dirección pública. Útil:

```bash
tailscale funnel status       # qué se está publicando
tailscale funnel --https=443 off   # dejar de publicar
```

Con `--bg` la publicación persiste aunque cierre la terminal y tras reiniciar, mientras Tailscale
esté en marcha.

## 7 · Que siga funcionando

- `npm start` debe estar en marcha. Para que arranque solo y se reinicie si falla, use un gestor de
  procesos: `npm install -g pm2`, después `pm2 start npm --name esd-control -- start` y
  `pm2 save`; en Linux y macOS, `pm2 startup` indica cómo arrancarlo con el equipo.
- Desactive la suspensión del portátil mientras deba estar accesible.
- La alerta diaria de vencimientos: programe `npm run jobs:alerts` una vez al día (cron en
  Linux/macOS, Programador de tareas en Windows).
- Copias de seguridad de la base de datos y de `storage/`: ver `docs/OPERACION.md`.

## Actualizar a una versión nueva

```bash
git pull
npm ci
npm run db:migrate
npm run build
pm2 restart esd-control       # o pare y vuelva a lanzar npm start
```
