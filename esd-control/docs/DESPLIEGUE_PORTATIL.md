# Servidor en un portátil con Tailscale Funnel

La aplicación se ejecuta en un ordenador propio (Linux, macOS o Windows) y Tailscale Funnel la
publica en una dirección HTTPS fija, `https://<equipo>.<red>.ts.net`, accesible desde cualquier
sitio mientras el ordenador esté encendido, con la aplicación y Tailscale en marcha.

Funnel la hace **pública en internet** (no solo dentro de su red Tailscale): use contraseñas
fuertes y no cargue datos de demostración. Si solo la van a usar dispositivos de su red Tailscale,
use `tailscale serve` en lugar de `tailscale funnel` (Paso 6).

## Windows paso a paso (PowerShell)

Abra **PowerShell** (no hace falta como administrador salvo donde se indica). Sustituya las
contraseñas: solo letras, dígitos y `. _ ~ -`.

**1. Programas**

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Tailscale.Tailscale
```

PostgreSQL: descargue el instalador de Windows desde postgresql.org (versión 16 o superior) y
ejecútelo. Anote la contraseña que elija para el usuario `postgres`; deje el puerto 5432. Cierre y
vuelva a abrir PowerShell para que reconozca los programas nuevos. Inicie sesión en Tailscale
desde su icono junto al reloj.

**2. Código**

```powershell
cd $HOME
git clone https://github.com/Sento79/mi-campito.git
cd mi-campito\esd-control
npm ci
```

**3. Base de datos** (pide la contraseña del usuario `postgres`):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "create role esd_owner login createrole password 'CONTRASEÑA_PROPIETARIO'" -c "create database esd owner esd_owner"
```

(Si instaló otra versión, cambie `16` en la ruta.)

**4. Variables**

```powershell
Copy-Item .env.example .env
notepad .env
```

Ajuste las líneas del apartado 4 de abajo (`DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`APP_DB_PASSWORD`, `APP_URL`, `COOKIE_SECURE=true`, `DEMO_SEED_ENABLED=false`) y rellene las
`BOOTSTRAP_*` del primer administrador. Su dirección `*.ts.net` aparece en `tailscale status`
(columna del nombre del equipo) o en el panel de Tailscale, en *Machines*.

**5. Preparar y probar**

```powershell
npm run db:migrate
npm run db:bootstrap
npm run build
npm run start:local
```

`start:local` escucha solo en este equipo (`127.0.0.1`): ni otros equipos de su red local ni nadie
más puede entrar directamente al puerto 3000; solo a través de Tailscale. Si Windows pregunta por el
cortafuegos para Node.js, **deniéguelo**. En el navegador del portátil, `http://127.0.0.1:3000/api/health` debe responder
`{"ok":true}`. Después borre `BOOTSTRAP_ADMIN_PASSWORD` de `.env`.

**6. Publicar** (en otra ventana de PowerShell; si responde *access denied*, ábrala como
administrador):

```powershell
tailscale funnel --bg 3000
```

La primera vez muestra un enlace para activar HTTPS y Funnel en su red: ábralo, actívelo y repita
el comando. Al final indica la dirección `https://<equipo>.<red>.ts.net`: ábrala en el móvil.

**7. Que arranque sola al encender** (PowerShell como administrador, desde `esd-control`):

```powershell
$dir = (Get-Location).Path
New-Item -ItemType Directory -Force "$dir\logs" | Out-Null
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$dir`" && npm run start:local >> logs\servidor.log 2>&1"
$inicio = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "ESD Control" -Action $accion -Trigger $inicio -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1))

$alertas = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$dir`" && npm run jobs:alerts >> logs\alertas.log 2>&1"
Register-ScheduledTask -TaskName "ESD Control alertas" -Action $alertas -Trigger (New-ScheduledTaskTrigger -Daily -At 6:17am)

powercfg /change standby-timeout-ac 0
```

La aplicación arranca al iniciar sesión en Windows; Funnel (con `--bg`) se mantiene mientras
Tailscale esté en marcha. `powercfg` evita la suspensión con el cargador conectado; revise también
en *Opciones de energía* qué hace el equipo al **cerrar la tapa** (elija «No hacer nada» si lo
quiere cerrado y encendido).

**Actualizar a una versión nueva:** detenga la tarea (`Stop-ScheduledTask "ESD Control"`), y en
`esd-control`: `git pull`, `npm ci`, `npm run db:migrate`, `npm run build`, y
`Start-ScheduledTask "ESD Control"`.

Los apartados siguientes explican lo mismo de forma general (también para Linux y macOS).

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
npm run start:local           # puerto 3000, solo en este equipo (127.0.0.1)
```

Tras `db:bootstrap`, borre `BOOTSTRAP_ADMIN_PASSWORD` de `.env`. Compruebe en el propio portátil
`http://127.0.0.1:3000/api/health` → `{"ok":true}`.

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

- `npm run start:local` debe estar en marcha (escucha solo en `127.0.0.1`: Tailscale es la única
  entrada; no use `npm start`, que escucha en todas las interfaces de red). Para que arranque solo y se reinicie si falla, use un gestor de
  procesos: `npm install -g pm2`, después `pm2 start npm --name esd-control -- run start:local` y
  `pm2 save`; en Linux y macOS, `pm2 startup` indica cómo arrancarlo con el equipo.
- Desactive la suspensión del portátil mientras deba estar accesible.
- La alerta diaria de vencimientos: programe `npm run jobs:alerts` una vez al día (cron en
  Linux/macOS, Programador de tareas en Windows).
- Copias de seguridad: ver el apartado siguiente.

## Actualizar a una versión nueva

```bash
git pull
npm ci
npm run db:migrate
npm run build
pm2 restart esd-control       # o pare y vuelva a lanzar npm run start:local
```

## Copias de seguridad

Copie la base de datos y la carpeta `storage/` (planos, fotos, documentos) **a la vez**, con la
aplicación parada, y guarde las dos juntas fuera del portátil (disco externo o nube). Los comandos
leen la conexión de `.env`, así que funcionan en una terminal nueva. Ejecútelos en `esd-control`.

**Windows (PowerShell):**

```powershell
Stop-ScheduledTask "ESD Control"     # o cierre la ventana de npm run start:local
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like "*next*start*" | ForEach-Object { Stop-Process -Id $_.ProcessId }
$url = (Select-String -Path .env -Pattern '^MIGRATION_DATABASE_URL=(.+)$').Matches[0].Groups[1].Value
$fecha = Get-Date -Format "yyyyMMdd-HHmm"
New-Item -ItemType Directory -Force copias | Out-Null
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" --format=custom --file "copias\esd-$fecha.dump" $url
Compress-Archive -Path storage -DestinationPath "copias\storage-$fecha.zip"
Start-ScheduledTask "ESD Control"
```

**Linux y macOS:**

```bash
pm2 stop esd-control
url="$(grep '^MIGRATION_DATABASE_URL=' .env | cut -d= -f2-)"
fecha="$(date +%Y%m%d-%H%M)"; mkdir -p copias
pg_dump --format=custom --file "copias/esd-$fecha.dump" "$url"
tar czf "copias/storage-$fecha.tar.gz" storage
pm2 start esd-control
```

Para restaurar, con la aplicación parada: `pg_restore --clean --if-exists --dbname "<MIGRATION_DATABASE_URL>" copias/esd-<fecha>.dump`
y sustituya `storage/` por la del mismo par.
