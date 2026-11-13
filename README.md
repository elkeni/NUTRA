# Nutra

Nutra es una aplicación web para registrar comidas, calorías y macronutrientes. El diario reúne tus objetivos diarios y el seguimiento de agua y peso en una interfaz pensada para celulares.

## Qué puedes hacer

- Registrar alimentos por comida, editar porciones y crear alimentos personalizados.
- Consultar productos por código de barras mediante Open Food Facts.
- Guardar recetas en el diario, planificar comidas y generar una lista de compras.
- Revisar el historial de calorías y peso, ajustar objetivos y exportar o importar tus registros en JSON.

El código se puede consultar públicamente. Cada instalación guarda sus cuentas y registros en una base SQLite propia. El registro requiere un correo autorizado, un código de invitación y un CAPTCHA de Cloudflare Turnstile.

## Inicio local

Necesitas **Node.js 24 o superior**. El proyecto usa módulos integrados de Node.js.

1. Copia `.env.example` como `.env`. En PowerShell, puedes ejecutar `Copy-Item .env.example .env` si todavía no tienes el archivo.
2. Configura `ALLOWED_EMAILS` con tu correo. Puedes autorizar varios separándolos por comas.
3. Genera un código de invitación con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y guárdalo en `REGISTRATION_CODE`.
4. Crea un widget de [Cloudflare Turnstile](https://dash.cloudflare.com/) para el hostname de `APP_ORIGIN`. Guarda sus claves en `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`.
5. Ejecuta `npm start` y abre [Nutra](http://127.0.0.1:4173). En Windows también puedes abrir `Iniciar-Nutra.cmd`.

Usa el código de invitación al crear tu cuenta. La aplicación bloquea el acceso mientras falte configurar Turnstile.

## Estructura

| Ruta | Contenido |
|---|---|
| `server.cjs` | Servidor HTTP, API, autenticación y almacenamiento |
| `dist/` | HTML, CSS, JavaScript y recursos que sirve el backend |
| `src/` | Validación de datos del servidor |
| `tests/` | Pruebas de seguridad de la API |
| `.env.example` | Plantilla de configuración con valores de ejemplo |

Ejecuta `npm test` para verificar autenticación, aislamiento de cuentas, validación de datos y controles de seguridad. Las pruebas usan un verificador CAPTCHA simulado y bases temporales.

## Datos y despliegue

SQLite se guarda en `data/` por defecto. Puedes indicar otra ruta mediante `DATA_DIR`. Guarda `.env`, tus bases y las exportaciones personales fuera del repositorio. Para respaldar SQLite, usa su mecanismo de copia de seguridad o detén el servidor antes de copiar la carpeta de datos.

El despliegue actual requiere un servidor Node.js con almacenamiento persistente y un proxy HTTPS que preserve `Host`. Configura `NODE_ENV=production`, establece `APP_ORIGIN` con la URL pública exacta y autoriza el nuevo hostname en Turnstile. Para Vercel, usa los pasos de Supabase que se indican abajo.

El backend protege las contraseñas con scrypt, verifica Turnstile en el servidor y aplica protección CSRF y límites de solicitudes. Para publicar una instancia, protege también el disco y sus copias de seguridad.

## Vercel y Supabase

1. En Supabase, abre **Connect → Transaction pooler** y completa la contraseña en la cadena. Si tiene caracteres reservados, codifica la contraseña para la URL.
2. Ejecuta `npm install`. Luego migra tu cuenta desde PowerShell usando el bloque siguiente. El script crea el esquema privado y evita sobrescribir cuentas existentes.
3. En Vercel Hobby, importa el repositorio con Node.js 24. Nutra usa `server.ts` como entrada. Configura `DATABASE_URL`, `ALLOWED_EMAILS`, `REGISTRATION_CODE`, `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en Production.
4. Nutra usa `VERCEL_PROJECT_PRODUCTION_URL` si `APP_ORIGIN` está vacío. Si Vercel no expone esa variable, configura `APP_ORIGIN` con la URL HTTPS exacta y vuelve a desplegar. Agrega el hostname a Turnstile y prueba iniciar sesión y guardar un alimento desde el celular.

```powershell
$dbSecret = Read-Host 'Pega la cadena privada de Supabase' -AsSecureString
try {
    $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $dbSecret).Password
    node scripts/migrate-sqlite.cjs 'D:\app-registro-calorias\data\nutra.sqlite' 'tu-correo@example.com'
} finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $dbSecret.Dispose()
}
```

La migración lee SQLite en modo de solo lectura. Copia la cuenta seleccionada y sus registros. El primer acceso en la nube crea una sesión nueva.
