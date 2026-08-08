# Catálogo olfativo

Aplicación web para armar un catálogo de perfumes con cuenta propia. Nace del
archivo estático `catalogoolfativo.html`, donde las fragancias vivían escritas a
mano dentro del script; aquí cada usuario registra las suyas y solo él las ve.

## Qué hace

- **Cuentas.** Registro con correo y contraseña, entrada, salida y recuperación
  de contraseña por enlace.
- **Catálogo propio.** Alta, edición y borrado de fragancias. Cada cuenta ve
  únicamente las suyas.
- **Ficha completa.** Pirámide de notas en tres pisos, ranking estacional de 0 a
  5, franja anual mes a mes, duración, estela, ocasiones, ajuste local y avisos.
- **Lectura por mes.** Se elige un mes de referencia y el catálogo se reordena
  por lo que mejor rinde en ese mes; arranca en el mes en curso.
- **Filtros.** Búsqueda por nombre, casa, familia, nota u ocasión, y filtro por
  estación.
- **Catálogo de muestra.** 35 fragancias ya calibradas que se importan con un
  botón, para empezar con material y ajustarlo en lugar de partir de cero.
- **Exportación.** Descarga del catálogo completo en JSON.
- **Ciudad configurable.** La franja anual se rotula con la ciudad del usuario,
  porque la calibración mes a mes solo tiene sentido contra un clima concreto.

## Estructura

```
catalogo/
├── index.html              Las tres pantallas: acceso, catálogo y editor
├── css/catalogo.css        Estilos; conserva la paleta y tipografía del original
└── js/
    ├── config.js           URL y clave publicable de Supabase
    ├── datos.js            Todo lo que toca la red: sesión y CRUD
    ├── app.js              Interfaz: estado, pintado, editor
    ├── muestra.js          Las 35 fragancias del catálogo de muestra
    └── vendor/supabase.js  Librería de Supabase, servida desde aquí
```

No hay paso de compilación: son archivos estáticos que se sirven tal cual.

## Cómo probarlo en local

```bash
cd catalogo
python3 -m http.server 8000
```

Y abrir <http://localhost:8000>. Hace falta abrirlo por HTTP y no con
`file://`, porque el navegador bloquea la sesión en ese esquema.

## Cómo publicarlo

Al ser estático sirve cualquier hosting. Con GitHub Pages, apuntando a la rama y
a la raíz del repositorio, el catálogo queda en `/catalogo/`.

Después de publicar hay que registrar la dirección en Supabase, en
**Authentication → URL Configuration**, dentro de *Redirect URLs*. Sin eso, el
enlace de recuperación de contraseña devuelve al usuario a otra parte.

## Base de datos

El proyecto de Supabase es `catalogo-olfativo` (`gvvzvxbsbetbmrzsenuo`).

| Tabla | Para qué |
|---|---|
| `perfiles` | Nombre y ciudad. Se crea sola al registrarse un usuario, por disparador sobre `auth.users`. |
| `fragancias` | Una fila por fragancia, con `usuario_id` apuntando a su dueño. |

La protección real está en las políticas de **Row Level Security**: cada
política compara `auth.uid()` contra `usuario_id`, así que Postgres solo
devuelve y solo acepta las filas del usuario de la sesión. Aunque alguien
manipule el JavaScript desde el navegador, no alcanza los datos de otra cuenta.

La clave que viaja en `config.js` es la *publicable*, pública por diseño; no da
acceso a nada por sí sola.

Las validaciones también viven en la base, no solo en el formulario:

- `meses` tiene que traer exactamente doce valores, todos entre 0 y 5 y ninguno
  nulo.
- Las cuatro estaciones y el año tienen rango acotado.
- `jugo` tiene que ser un color hexadecimal de seis dígitos.
- `genero` solo acepta Masculino, Femenino o Unisex.
- `nombre` no puede quedar en blanco.

Borrar un usuario arrastra en cascada su perfil y todas sus fragancias.

## Confirmación de correo

Supabase pide confirmar el correo antes de la primera entrada. Con esa opción
activa, al registrarse llega un correo con un enlace y hasta abrirlo no se puede
entrar; la aplicación ya lo explica en pantalla cuando ocurre.

Si se prefiere que la cuenta quede lista de inmediato, se desactiva en
**Authentication → Providers → Email → Confirm email**. Conviene saber que el
servidor de correo que trae Supabase de fábrica tiene un límite bajo de envíos
por hora, pensado para pruebas; para uso real se conecta un SMTP propio en
**Authentication → SMTP Settings**.

## Actualizar la librería de Supabase

```bash
npm pack @supabase/supabase-js@<versión>
tar -xzOf supabase-supabase-js-<versión>.tgz package/dist/umd/supabase.js \
  > catalogo/js/vendor/supabase.js
```

Va servida desde el propio sitio y no desde un CDN, para que el catálogo abra
igual en redes que bloquean terceros y no dependa de que otro servicio siga en
pie.
