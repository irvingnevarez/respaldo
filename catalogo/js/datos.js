/* ============================================================
   Capa de datos — Supabase
   ------------------------------------------------------------
   Todo lo que toca la red vive aquí. El resto de la aplicación
   solo llama funciones de window.DATOS y recibe objetos limpios.

   La seguridad real no está en este archivo sino en las políticas
   de Row Level Security de la base: aunque alguien manipule este
   código desde el navegador, Postgres solo le devuelve las filas
   cuyo usuario_id coincide con su sesión.
   ============================================================ */

(function(){
  "use strict";

  /* Si la librería no llegó a cargar, no reventamos con un error de consola
     y una pantalla en blanco: dejamos DATOS en null y app.js muestra el aviso. */
  if(!window.supabase || typeof window.supabase.createClient !== "function"){
    window.DATOS = null;
    return;
  }

  const cliente = window.supabase.createClient(
    window.CONFIG.SUPABASE_URL,
    window.CONFIG.SUPABASE_KEY
  );

  /* ---------- columnas que viajan a la base ---------- */

  const COLUMNAS = [
    "nombre","casa","anio","familia","genero","jugo",
    "notas_salida","notas_corazon","notas_fondo",
    "est_primavera","est_verano","est_otono","est_invierno",
    "meses","duracion","estela","ocasion",
    "nota_local","aviso","posicion"
  ];

  /* Deja el objeto con exactamente las columnas de la tabla, con
     los tipos correctos. Evita mandar campos de más (id, creado_en)
     en un update y que Postgres los rechace. */
  function depurar(f){
    const limpio = {};
    for(const c of COLUMNAS){
      if(f[c] === undefined) continue;
      limpio[c] = f[c];
    }
    if(limpio.anio === "" || limpio.anio === null) limpio.anio = null;
    else if(limpio.anio !== undefined) limpio.anio = Number(limpio.anio);
    return limpio;
  }

  /* ---------- traducción de errores ---------- */

  const MENSAJES = {
    "Invalid login credentials":"Correo o contraseña incorrectos.",
    "Email not confirmed":"Falta confirmar tu correo. Revisa la bandeja de entrada y la carpeta de spam.",
    "User already registered":"Ese correo ya tiene una cuenta. Entra con tu contraseña o pide una nueva.",
    "Password should be at least 6 characters":"La contraseña necesita al menos 6 caracteres.",
    "Unable to validate email address: invalid format":"Ese correo no tiene un formato válido.",
    "For security purposes, you can only request this after 60 seconds":"Espera un minuto antes de volver a intentarlo.",
    "Signup requires a valid password":"Escribe una contraseña.",
    "Failed to fetch":"No se pudo conectar. Revisa tu conexión a internet."
  };

  function traducir(error){
    if(!error) return "Ocurrió un error inesperado.";
    const bruto = error.message || String(error);
    if(MENSAJES[bruto]) return MENSAJES[bruto];
    for(const clave in MENSAJES){
      if(bruto.includes(clave)) return MENSAJES[clave];
    }
    if(/rate limit|too many/i.test(bruto)) return "Demasiados intentos seguidos. Espera un momento.";
    if(/network|fetch/i.test(bruto))      return "No se pudo conectar. Revisa tu conexión a internet.";
    return bruto;
  }

  /* Lanza un error ya traducido si la respuesta trae uno. */
  function revisar({ data, error }){
    if(error) throw new Error(traducir(error));
    return data;
  }

  /* ============================================================
     Sesión
     ============================================================ */

  async function registrar(correo, contrasena, nombre){
    const data = revisar(await cliente.auth.signUp({
      email: correo,
      password: contrasena,
      options:{ data:{ nombre: nombre || "" } }
    }));
    // Con confirmación de correo activada no llega sesión de inmediato.
    return { usuario: data.user, sesion: data.session };
  }

  async function entrar(correo, contrasena){
    const data = revisar(await cliente.auth.signInWithPassword({
      email: correo,
      password: contrasena
    }));
    return data.session;
  }

  async function salir(){
    const { error } = await cliente.auth.signOut();
    if(error) throw new Error(traducir(error));
  }

  async function recuperar(correo){
    const destino = location.origin + location.pathname;
    const { error } = await cliente.auth.resetPasswordForEmail(correo, { redirectTo: destino });
    if(error) throw new Error(traducir(error));
  }

  async function cambiarContrasena(nueva){
    revisar(await cliente.auth.updateUser({ password: nueva }));
  }

  async function sesionActual(){
    const { data } = await cliente.auth.getSession();
    return data.session;
  }

  function alCambiarSesion(callback){
    cliente.auth.onAuthStateChange((evento, sesion) => callback(evento, sesion));
  }

  /* ============================================================
     Perfil
     ============================================================ */

  async function leerPerfil(){
    const data = revisar(await cliente
      .from("perfiles")
      .select("id,nombre,ciudad")
      .maybeSingle());
    return data;
  }

  async function guardarPerfil(cambios){
    const sesion = await sesionActual();
    if(!sesion) throw new Error("Tu sesión expiró. Vuelve a entrar.");
    const data = revisar(await cliente
      .from("perfiles")
      .upsert({ id: sesion.user.id, ...cambios })
      .select("id,nombre,ciudad")
      .single());
    return data;
  }

  /* ============================================================
     Fragancias
     ============================================================ */

  async function listar(){
    const data = revisar(await cliente
      .from("fragancias")
      .select("*")
      .order("posicion", { ascending:true })
      .order("creado_en", { ascending:true }));
    return data || [];
  }

  async function crear(fragancia){
    const sesion = await sesionActual();
    if(!sesion) throw new Error("Tu sesión expiró. Vuelve a entrar.");
    const data = revisar(await cliente
      .from("fragancias")
      .insert({ ...depurar(fragancia), usuario_id: sesion.user.id })
      .select()
      .single());
    return data;
  }

  async function actualizar(id, cambios){
    const data = revisar(await cliente
      .from("fragancias")
      .update(depurar(cambios))
      .eq("id", id)
      .select()
      .single());
    return data;
  }

  async function borrar(id){
    const { error } = await cliente.from("fragancias").delete().eq("id", id);
    if(error) throw new Error(traducir(error));
  }

  /* Inserta un lote completo. Se usa al importar el catálogo de muestra. */
  async function crearVarias(lista){
    const sesion = await sesionActual();
    if(!sesion) throw new Error("Tu sesión expiró. Vuelve a entrar.");
    const filas = lista.map((f, i) => ({
      ...depurar(f),
      posicion: f.posicion ?? i,
      usuario_id: sesion.user.id
    }));
    const data = revisar(await cliente.from("fragancias").insert(filas).select());
    return data || [];
  }

  window.DATOS = {
    registrar, entrar, salir, recuperar, cambiarContrasena,
    sesionActual, alCambiarSesion,
    leerPerfil, guardarPerfil,
    listar, crear, actualizar, borrar, crearVarias,
    traducir
  };
})();
