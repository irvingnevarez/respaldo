/* ============================================================
   Conexión a Supabase
   ------------------------------------------------------------
   La clave publicable es pública por diseño: va en el navegador
   y no da acceso a nada por sí sola. Quien protege los datos es
   el Row Level Security de la base, que solo deja a cada usuario
   leer y escribir sus propias fragancias.

   Si algún día mueves el proyecto, cambia estos dos valores.
   ============================================================ */

window.CONFIG = {
  SUPABASE_URL: "https://gvvzvxbsbetbmrzsenuo.supabase.co",
  SUPABASE_KEY: "sb_publishable_waXXgRaWLA_SIvnau5rHxw_Tmqoe_FK"
};
