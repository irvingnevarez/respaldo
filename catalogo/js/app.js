/* ============================================================
   Catálogo olfativo — interfaz
   ------------------------------------------------------------
   Tres pantallas: acceso, catálogo y editor. El estado vive en
   el objeto ESTADO y cualquier cambio termina llamando pintar().
   ============================================================ */

(function(){
  "use strict";

  /* Sin capa de datos no hay nada que hacer: mejor decirlo en pantalla
     que dejar la página muerta sin explicación. */
  if(!window.DATOS){
    document.getElementById("arranque").innerHTML =
      '<strong style="display:block;font-family:Fraunces,Georgia,serif;font-size:22px;' +
      'color:#EFE9DD;margin-bottom:10px;text-transform:none;letter-spacing:0">' +
      'No se pudo cargar el catálogo</strong>' +
      '<span style="text-transform:none;letter-spacing:0;font-family:Karla,sans-serif;font-size:14px">' +
      'Faltó cargar un archivo de la aplicación. Recarga la página; si sigue igual, ' +
      'revisa tu conexión o si alguna extensión del navegador está bloqueando scripts.</span>';
    return;
  }

  /* ============================================================
     Constantes
     ============================================================ */

  const MESES        = ["EN","FE","MR","AB","MY","JN","JL","AG","SP","OC","NV","DC"];
  const MESES_LARGOS = ["enero","febrero","marzo","abril","mayo","junio",
                        "julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const ESTACIONES   = [
    ["est_primavera","Primavera"],
    ["est_verano",   "Verano"],
    ["est_otono",    "Otoño"],
    ["est_invierno", "Invierno"]
  ];
  const GENEROS  = ["Masculino","Femenino","Unisex"];
  const mesActual = new Date().getMonth();

  const ESTADO = {
    sesion:null,
    perfil:null,
    fragancias:[],
    filtroEstacion:"todas",
    consulta:"",
    orden:"captura",
    mesFoco:mesActual,
    editando:null,        // id de la fragancia en el editor, o null si es nueva
    cargando:false
  };

  /* ============================================================
     Utilidades
     ============================================================ */

  const $  = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => [...(raiz || document).querySelectorAll(sel)];

  /* Todo texto que venga del usuario pasa por aquí antes de tocar
     innerHTML. Sin esto, un nombre con etiquetas HTML se ejecutaría
     al pintar la ficha. */
  function esc(valor){
    return String(valor ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function listaDesdeTexto(texto){
    return String(texto || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);
  }

  function limitar(n, min, max){
    n = Number(n);
    if(!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  const avisos = $("#avisos");

  function nota(mensaje, tipo){
    const el = document.createElement("div");
    el.className = "nota" + (tipo ? " nota--" + tipo : "");
    el.setAttribute("role", tipo === "error" ? "alert" : "status");
    el.textContent = mensaje;
    avisos.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, tipo === "error" ? 6500 : 3800);
  }

  /* Envuelve una acción asíncrona: bloquea el botón mientras corre
     y muestra el error traducido si falla. */
  async function conBoton(boton, textoOcupado, accion){
    const original = boton.textContent;
    boton.disabled = true;
    boton.textContent = textoOcupado;
    try{
      return await accion();
    }catch(e){
      nota(e.message, "error");
      return undefined;
    }finally{
      boton.disabled = false;
      boton.textContent = original;
    }
  }

  /* ============================================================
     Widgets reutilizables
     ============================================================ */

  /* Escala de 0 a 5 en botones. Guarda el valor en dataset.valor. */
  function montarEscala(contenedor, valorInicial){
    contenedor.innerHTML = "";
    contenedor.className = "escala";
    contenedor.dataset.valor = String(limitar(valorInicial ?? 0, 0, 5));

    for(let i = 0; i <= 5; i++){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "escala__punto";
      b.textContent = i;
      b.setAttribute("aria-label", i + " de 5");
      b.addEventListener("click", () => {
        contenedor.dataset.valor = String(i);
        pintarEscala(contenedor);
      });
      contenedor.appendChild(b);
    }
    pintarEscala(contenedor);
  }

  function pintarEscala(contenedor){
    const valor = Number(contenedor.dataset.valor);
    $$(".escala__punto", contenedor).forEach((b, i) =>
      b.setAttribute("aria-pressed", String(i === valor)));
  }

  /* Editor de la franja anual: doce columnas de 0 a 5. */
  function montarFranjaEditor(contenedor, meses){
    contenedor.innerHTML = "";
    contenedor.className = "franja-editor";
    const valores = (Array.isArray(meses) && meses.length === 12)
      ? meses.map(v => limitar(v, 0, 5))
      : new Array(12).fill(0);

    contenedor.dataset.valores = JSON.stringify(valores);

    valores.forEach((valor, i) => {
      const col = document.createElement("div");
      col.className = "franja-editor__mes";

      const barra = document.createElement("div");
      barra.className = "franja-editor__barra";
      barra.title = MESES_LARGOS[i];

      const relleno = document.createElement("div");
      relleno.className = "franja-editor__relleno";
      barra.appendChild(relleno);

      const numero = document.createElement("input");
      numero.type = "number";
      numero.className = "franja-editor__numero";
      numero.min = 0;
      numero.max = 5;
      numero.step = 1;
      numero.value = valor;
      numero.setAttribute("aria-label", MESES_LARGOS[i] + ", de 0 a 5");

      const etiqueta = document.createElement("span");
      etiqueta.className = "franja-editor__etiqueta";
      etiqueta.textContent = MESES[i];

      function fijar(nuevo){
        const v = limitar(nuevo, 0, 5);
        const lista = JSON.parse(contenedor.dataset.valores);
        lista[i] = v;
        contenedor.dataset.valores = JSON.stringify(lista);
        numero.value = v;
        relleno.style.height = (v / 5 * 100) + "%";
      }

      // Clic sobre la barra: el valor sale de la altura del clic. Se redondea
      // en vez de truncar para que el cero sea alcanzable en el borde de abajo.
      barra.addEventListener("click", ev => {
        const caja = barra.getBoundingClientRect();
        const proporcion = 1 - (ev.clientY - caja.top) / caja.height;
        fijar(Math.round(proporcion * 5));
      });

      numero.addEventListener("input", () => fijar(numero.value));

      col.append(barra, numero, etiqueta);
      contenedor.appendChild(col);
      fijar(valor);
    });
  }

  /* ============================================================
     Pantalla de acceso
     ============================================================ */

  const pantallaAcceso = $("#pantalla-acceso");
  const pantallaApp    = $("#pantalla-app");

  function mostrarPantalla(cual){
    pantallaAcceso.hidden = cual !== "acceso";
    pantallaApp.hidden    = cual !== "app";
  }

  const formEntrar    = $("#form-entrar");
  const formRegistrar = $("#form-registrar");

  function mostrarPestana(destino){
    $$(".pestana").forEach(o => o.setAttribute("aria-selected", String(o.dataset.panel === destino)));
    formEntrar.hidden    = destino !== "entrar";
    formRegistrar.hidden = destino !== "registrar";
  }

  $$(".pestana").forEach(p => {
    p.addEventListener("click", () => mostrarPestana(p.dataset.panel));
  });

  formEntrar.addEventListener("submit", async ev => {
    ev.preventDefault();
    const boton = $("#btn-entrar");
    await conBoton(boton, "Entrando…", async () => {
      await window.DATOS.entrar(
        $("#entrar-correo").value.trim(),
        $("#entrar-contrasena").value
      );
      // onAuthStateChange se encarga de abrir el catálogo.
    });
  });

  formRegistrar.addEventListener("submit", async ev => {
    ev.preventDefault();
    const contrasena = $("#registrar-contrasena").value;
    const repetida   = $("#registrar-repetir").value;

    if(contrasena.length < 6)  return nota("La contraseña necesita al menos 6 caracteres.", "error");
    if(contrasena !== repetida) return nota("Las dos contraseñas no coinciden.", "error");

    const boton = $("#btn-registrar");
    await conBoton(boton, "Creando…", async () => {
      const { sesion } = await window.DATOS.registrar(
        $("#registrar-correo").value.trim(),
        contrasena,
        $("#registrar-nombre").value.trim()
      );
      if(!sesion){
        nota("Cuenta creada. Te mandamos un correo de confirmación: ábrelo y luego entra.", "ok");
        mostrarPestana("entrar");
        $("#entrar-correo").value = $("#registrar-correo").value.trim();
        formRegistrar.reset();
      }
    });
  });

  $("#btn-olvide").addEventListener("click", async () => {
    const correo = $("#entrar-correo").value.trim();
    if(!correo) return nota("Escribe tu correo arriba y vuelve a tocar el enlace.", "error");
    try{
      await window.DATOS.recuperar(correo);
      nota("Si ese correo tiene cuenta, ya va en camino el enlace para restablecer la contraseña.", "ok");
    }catch(e){
      nota(e.message, "error");
    }
  });

  /* ============================================================
     Barra de sesión
     ============================================================ */

  $("#btn-salir").addEventListener("click", async () => {
    try{
      await window.DATOS.salir();
    }catch(e){
      nota(e.message, "error");
    }
  });

  /* ============================================================
     Controles del catálogo
     ============================================================ */

  const rejilla = $("#rejilla");
  const conteo  = $("#conteo");
  const chips   = $("#chips");
  const selMes  = $("#mes");
  const selOrden = $("#orden");

  [["todas","Todas"],["est_primavera","Primavera"],["est_verano","Verano"],
   ["est_otono","Otoño"],["est_invierno","Invierno"]]
    .forEach(([valor, texto]) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = texto;
      b.setAttribute("aria-pressed", String(valor === "todas"));
      b.addEventListener("click", () => {
        ESTADO.filtroEstacion = valor;
        $$(".chip", chips).forEach(c => c.setAttribute("aria-pressed", String(c === b)));
        pintar();
      });
      chips.appendChild(b);
    });

  MESES_LARGOS.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = m.charAt(0).toUpperCase() + m.slice(1) + (i === mesActual ? " · hoy" : "");
    if(i === mesActual) o.selected = true;
    selMes.appendChild(o);
  });

  function etiquetarOpcionMes(){
    $("#opcionMes").textContent = "Mejor en " + MESES_LARGOS[ESTADO.mesFoco];
  }

  selMes.addEventListener("change", ev => {
    ESTADO.mesFoco = Number(ev.target.value);
    ESTADO.orden = "ahora";
    selOrden.value = "ahora";
    etiquetarOpcionMes();
    pintar();
  });

  selOrden.addEventListener("change", ev => {
    ESTADO.orden = ev.target.value;
    pintar();
  });

  $("#buscador").addEventListener("input", ev => {
    ESTADO.consulta = ev.target.value.trim().toLowerCase();
    pintar();
  });

  /* ============================================================
     Pintado de fichas
     ============================================================ */

  function todasLasNotas(f){
    return [...(f.notas_salida || []), ...(f.notas_corazon || []), ...(f.notas_fondo || [])];
  }

  function puntos(n){
    let s = "";
    for(let i = 0; i < 5; i++) s += i < n ? "●" : "<i>●</i>";
    return s;
  }

  function estacionesOrdenadas(f){
    return ESTACIONES
      .map(([clave, nombre]) => [nombre, Number(f[clave]) || 0])
      .sort((a, b) => b[1] - a[1]);
  }

  function ciudad(){
    return (ESTADO.perfil && ESTADO.perfil.ciudad) || "tu ciudad";
  }

  function ficha(f, indice, retrasoBase){
    const meses = Array.isArray(f.meses) && f.meses.length === 12 ? f.meses : new Array(12).fill(0);
    const pico  = meses.indexOf(Math.max(...meses));

    const franja = meses.map((v, i) =>
      `<div class="mes${i === ESTADO.mesFoco ? " ahora" : ""}" title="${esc(MESES_LARGOS[i])} · ${esc(v)} de 5">
         <b style="--alto:${Math.max(v / 5 * 100, 4)}%;--retraso:${retrasoBase + i * 35}ms"></b>
       </div>`).join("");

    const etiquetas = MESES.map((m, i) =>
      `<span class="${i === ESTADO.mesFoco ? "ahora" : ""}">${esc(m)}</span>`).join("");

    const ranking = estacionesOrdenadas(f).map(([nombre, valor]) =>
      `<li class="puesto"><span>${esc(nombre)}</span><span class="puntos">${puntos(valor)}</span></li>`).join("");

    const el = document.createElement("article");
    el.className = "ficha";
    el.style.setProperty("--jugo", /^#[0-9A-Fa-f]{6}$/.test(f.jugo || "") ? f.jugo : "#C79A3E");
    el.style.animationDelay = retrasoBase + "ms";

    const salida  = (f.notas_salida  || []).map(esc).join(", ") || "—";
    const corazon = (f.notas_corazon || []).map(esc).join(", ") || "—";
    const fondo   = (f.notas_fondo   || []).map(esc).join(", ") || "—";

    const subtitulo = [f.casa, f.anio, f.genero].filter(Boolean).map(esc).join(" · ");

    el.innerHTML = `
      <div class="mancha"></div>
      <span class="indice">${String(indice).padStart(2,"0")}</span>

      <h2 class="nombre">${esc(f.nombre)}</h2>
      ${subtitulo ? `<p class="casa">${subtitulo}</p>` : ""}
      ${f.familia ? `<span class="familia">${esc(f.familia)}</span>` : ""}

      <hr class="division">

      <p class="sub">Pirámide</p>
      <dl class="piramide">
        <div class="piso"><dt>Salida</dt><dd>${salida}</dd></div>
        <div class="piso"><dt>Corazón</dt><dd>${corazon}</dd></div>
        <div class="piso"><dt>Fondo</dt><dd>${fondo}</dd></div>
      </dl>

      <hr class="division">

      <p class="sub">Franja anual · ${esc(ciudad())}</p>
      <div class="franja">${franja}</div>
      <div class="etiquetas-mes">${etiquetas}</div>
      <p class="lectura-mes">
        <strong>${esc(MESES_LARGOS[ESTADO.mesFoco])}: ${esc(meses[ESTADO.mesFoco])} de 5</strong>
        <span>Su mejor mes es ${esc(MESES_LARGOS[pico])}.</span>
      </p>

      <hr class="division">

      <p class="sub">Ranking estacional</p>
      <ul class="ranking">${ranking}</ul>

      <hr class="division">

      <dl class="datos">
        <div><dt>Duración</dt><dd>${esc(f.duracion) || "—"}</dd></div>
        <div><dt>Estela</dt><dd>${esc(f.estela) || "—"}</dd></div>
        <div style="grid-column:1/-1"><dt>Ocasión</dt><dd>${(f.ocasion || []).map(esc).join(" · ") || "—"}</dd></div>
      </dl>

      ${f.nota_local ? `
        <div class="apunte">
          <p class="sub">Ajuste local</p>
          <p>${esc(f.nota_local)}</p>
        </div>` : ""}

      ${f.aviso ? `<p class="aviso">${esc(f.aviso)}</p>` : ""}

      <div class="ficha__acciones">
        <button type="button" class="accion" data-editar="${esc(f.id)}">Editar</button>
        <button type="button" class="accion accion--peligro" data-borrar="${esc(f.id)}">Borrar</button>
      </div>
    `;
    return el;
  }

  function pintar(){
    if(ESTADO.cargando){
      rejilla.innerHTML = `<div class="cargando">Cargando catálogo…</div>`;
      conteo.textContent = "";
      return;
    }

    const total = ESTADO.fragancias.length;

    if(total === 0){
      rejilla.innerHTML = `
        <div class="vacio">
          <strong>Tu catálogo está en blanco</strong>
          <p>Empieza registrando la primera fragancia, o importa el catálogo de muestra
             con 35 perfumes ya calibrados para irlos ajustando a tu gusto y a tu clima.</p>
          <div class="vacio__acciones">
            <button type="button" class="boton boton--primario" data-accion="nueva">Registrar fragancia</button>
            <button type="button" class="boton" data-accion="importar">Importar catálogo de muestra</button>
          </div>
        </div>`;
      conteo.textContent = "00 fragancias";
      return;
    }

    let lista = ESTADO.fragancias.map((f, i) => ({ f, indice: i + 1 }));

    if(ESTADO.filtroEstacion !== "todas"){
      const clave = ESTADO.filtroEstacion;
      lista = lista.filter(({ f }) => (Number(f[clave]) || 0) >= 3);
      lista.sort((a, b) => (Number(b.f[clave]) || 0) - (Number(a.f[clave]) || 0));
    }

    if(ESTADO.consulta){
      lista = lista.filter(({ f }) =>
        [f.nombre, f.casa, f.familia, f.genero, ...todasLasNotas(f), ...(f.ocasion || [])]
          .join(" ").toLowerCase().includes(ESTADO.consulta));
    }

    if(ESTADO.orden === "nombre")      lista.sort((a, b) => a.f.nombre.localeCompare(b.f.nombre, "es"));
    else if(ESTADO.orden === "casa")   lista.sort((a, b) => (a.f.casa || "").localeCompare(b.f.casa || "", "es"));
    else if(ESTADO.orden === "ahora")  lista.sort((a, b) => (b.f.meses?.[ESTADO.mesFoco] || 0) - (a.f.meses?.[ESTADO.mesFoco] || 0));

    rejilla.innerHTML = "";

    if(!lista.length){
      rejilla.innerHTML = `
        <div class="vacio">
          <strong>Nada por aquí todavía</strong>
          <p>Ninguna fragancia de tu catálogo cumple con ese filtro.
             Prueba con otra estación o limpia la búsqueda.</p>
        </div>`;
    }else{
      lista.forEach(({ f, indice }, i) => rejilla.appendChild(ficha(f, indice, i * 90)));
    }

    const n     = lista.length;
    const aptas = ESTADO.fragancias.filter(f => (f.meses?.[ESTADO.mesFoco] || 0) >= 3).length;
    const base  = n === total
      ? `${String(total).padStart(2,"0")} ${total === 1 ? "fragancia" : "fragancias"}`
      : `${String(n).padStart(2,"0")} de ${String(total).padStart(2,"0")}`;
    conteo.textContent = `${base} · ${String(aptas).padStart(2,"0")} para ${MESES_LARGOS[ESTADO.mesFoco]}`;
  }

  /* Un solo escuchador para toda la rejilla: las fichas se repintan
     completas en cada cambio y así no hay que reconectar botones. */
  rejilla.addEventListener("click", ev => {
    const editar = ev.target.closest("[data-editar]");
    if(editar) return abrirEditor(editar.dataset.editar);

    const borrar = ev.target.closest("[data-borrar]");
    if(borrar) return borrarFragancia(borrar.dataset.borrar);

    const accion = ev.target.closest("[data-accion]");
    if(!accion) return;
    if(accion.dataset.accion === "nueva")    abrirEditor(null);
    if(accion.dataset.accion === "importar") importarMuestra(accion);
  });

  /* ============================================================
     Editor de fragancia
     ============================================================ */

  const editor     = $("#editor");
  const formEditor = $("#form-editor");

  $("#btn-nueva").addEventListener("click", () => abrirEditor(null));
  $("#editor-cerrar").addEventListener("click", () => editor.close());
  $("#editor-cancelar").addEventListener("click", () => editor.close());

  const selGenero = $("#f-genero");
  GENEROS.forEach(g => {
    const o = document.createElement("option");
    o.value = g;
    o.textContent = g;
    selGenero.appendChild(o);
  });

  // Escalas de estación, una fila por estación.
  const cajaEstaciones = $("#f-estaciones");
  ESTACIONES.forEach(([clave, nombre]) => {
    const fila = document.createElement("div");
    fila.className = "escala-fila";

    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta";
    etiqueta.id = "et-" + clave;
    etiqueta.textContent = nombre;

    const escala = document.createElement("div");
    escala.dataset.campo = clave;
    escala.setAttribute("role", "group");
    escala.setAttribute("aria-labelledby", etiqueta.id);

    fila.append(etiqueta, escala);
    cajaEstaciones.appendChild(fila);
  });

  function abrirEditor(id){
    ESTADO.editando = id;
    const f = id ? ESTADO.fragancias.find(x => x.id === id) : null;

    $("#editor-titulo").textContent = f ? "Editar fragancia" : "Nueva fragancia";

    $("#f-nombre").value   = f?.nombre   ?? "";
    $("#f-casa").value     = f?.casa     ?? "";
    $("#f-anio").value     = f?.anio     ?? "";
    $("#f-familia").value  = f?.familia  ?? "";
    $("#f-genero").value   = f?.genero   ?? "Unisex";
    $("#f-jugo").value     = /^#[0-9A-Fa-f]{6}$/.test(f?.jugo || "") ? f.jugo : "#C79A3E";
    $("#f-salida").value   = (f?.notas_salida  || []).join(", ");
    $("#f-corazon").value  = (f?.notas_corazon || []).join(", ");
    $("#f-fondo").value    = (f?.notas_fondo   || []).join(", ");
    $("#f-duracion").value = f?.duracion ?? "";
    $("#f-estela").value   = f?.estela   ?? "";
    $("#f-ocasion").value  = (f?.ocasion || []).join(", ");
    $("#f-local").value    = f?.nota_local ?? "";
    $("#f-aviso").value    = f?.aviso    ?? "";

    $("#etiqueta-local").textContent = "Ajuste local · " + ciudad();

    ESTACIONES.forEach(([clave]) => {
      montarEscala($(`[data-campo="${clave}"]`, cajaEstaciones), f?.[clave] ?? 0);
    });

    montarFranjaEditor($("#f-meses"), f?.meses);

    $("#editor-guardar").textContent = f ? "Guardar cambios" : "Agregar al catálogo";
    editor.showModal();
    $("#f-nombre").focus();
  }

  function leerFormulario(){
    const meses = JSON.parse($("#f-meses").dataset.valores);
    const datos = {
      nombre:  $("#f-nombre").value.trim(),
      casa:    $("#f-casa").value.trim(),
      anio:    $("#f-anio").value.trim() === "" ? null : limitar($("#f-anio").value, 1800, 2200),
      familia: $("#f-familia").value.trim(),
      genero:  GENEROS.includes($("#f-genero").value) ? $("#f-genero").value : "Unisex",
      jugo:    $("#f-jugo").value,
      notas_salida:  listaDesdeTexto($("#f-salida").value),
      notas_corazon: listaDesdeTexto($("#f-corazon").value),
      notas_fondo:   listaDesdeTexto($("#f-fondo").value),
      meses:    meses.map(v => limitar(v, 0, 5)),
      duracion: $("#f-duracion").value.trim(),
      estela:   $("#f-estela").value.trim(),
      ocasion:  listaDesdeTexto($("#f-ocasion").value),
      nota_local: $("#f-local").value.trim(),
      aviso:      $("#f-aviso").value.trim()
    };

    ESTACIONES.forEach(([clave]) => {
      datos[clave] = limitar($(`[data-campo="${clave}"]`, cajaEstaciones).dataset.valor, 0, 5);
    });

    return datos;
  }

  formEditor.addEventListener("submit", async ev => {
    ev.preventDefault();
    const datos = leerFormulario();

    if(!datos.nombre) return nota("La fragancia necesita un nombre.", "error");

    const boton = $("#editor-guardar");
    await conBoton(boton, "Guardando…", async () => {
      if(ESTADO.editando){
        const actualizada = await window.DATOS.actualizar(ESTADO.editando, datos);
        const i = ESTADO.fragancias.findIndex(f => f.id === ESTADO.editando);
        if(i >= 0) ESTADO.fragancias[i] = actualizada;
        nota("Fragancia actualizada.", "ok");
      }else{
        const maxima = ESTADO.fragancias.reduce((m, f) => Math.max(m, f.posicion ?? 0), -1);
        const creada = await window.DATOS.crear({ ...datos, posicion: maxima + 1 });
        ESTADO.fragancias.push(creada);
        nota("Fragancia agregada al catálogo.", "ok");
      }
      editor.close();
      pintar();
    });
  });

  async function borrarFragancia(id){
    const f = ESTADO.fragancias.find(x => x.id === id);
    if(!f) return;
    if(!confirm(`¿Borrar "${f.nombre}" de tu catálogo? Esta acción no se puede deshacer.`)) return;

    try{
      await window.DATOS.borrar(id);
      ESTADO.fragancias = ESTADO.fragancias.filter(x => x.id !== id);
      nota("Fragancia borrada.", "ok");
      pintar();
    }catch(e){
      nota(e.message, "error");
    }
  }

  /* ============================================================
     Importar y exportar
     ============================================================ */

  async function importarMuestra(boton){
    const muestra = window.CATALOGO_MUESTRA || [];
    if(!muestra.length) return nota("No se encontró el catálogo de muestra.", "error");

    if(ESTADO.fragancias.length &&
       !confirm(`Se agregarán ${muestra.length} fragancias a las ${ESTADO.fragancias.length} que ya tienes. ¿Continuar?`)){
      return;
    }

    const base = ESTADO.fragancias.reduce((m, f) => Math.max(m, f.posicion ?? 0), -1) + 1;

    await conBoton(boton, "Importando…", async () => {
      const creadas = await window.DATOS.crearVarias(
        muestra.map((f, i) => ({ ...f, posicion: base + i }))
      );
      ESTADO.fragancias.push(...creadas);
      nota(`${creadas.length} fragancias importadas.`, "ok");
      pintar();
    });
  }

  $("#btn-importar").addEventListener("click", ev => importarMuestra(ev.currentTarget));

  $("#btn-exportar").addEventListener("click", () => {
    if(!ESTADO.fragancias.length) return nota("No hay nada que exportar todavía.", "error");

    const limpio = ESTADO.fragancias.map(({ id, usuario_id, creado_en, actualizado_en, ...resto }) => resto);
    const blob = new Blob([JSON.stringify(limpio, null, 2)], { type:"application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `catalogo-olfativo-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    nota("Catálogo descargado en formato JSON.", "ok");
  });

  /* ============================================================
     Ajustes de cuenta
     ============================================================ */

  const ajustes = $("#ajustes");

  $("#btn-ajustes").addEventListener("click", () => {
    $("#a-nombre").value = ESTADO.perfil?.nombre ?? "";
    $("#a-ciudad").value = ESTADO.perfil?.ciudad ?? "";
    $("#a-contrasena").value = "";
    ajustes.showModal();
  });

  $("#ajustes-cerrar").addEventListener("click", () => ajustes.close());
  $("#ajustes-cancelar").addEventListener("click", () => ajustes.close());

  $("#form-ajustes").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nueva = $("#a-contrasena").value;
    if(nueva && nueva.length < 6) return nota("La contraseña necesita al menos 6 caracteres.", "error");

    const boton = $("#ajustes-guardar");
    await conBoton(boton, "Guardando…", async () => {
      ESTADO.perfil = await window.DATOS.guardarPerfil({
        nombre: $("#a-nombre").value.trim(),
        ciudad: $("#a-ciudad").value.trim() || "tu ciudad"
      });
      if(nueva){
        await window.DATOS.cambiarContrasena(nueva);
        nota("Contraseña actualizada.", "ok");
      }
      ajustes.close();
      escribirBarraSesion();
      pintar();
      nota("Ajustes guardados.", "ok");
    });
  });

  /* ============================================================
     Arranque y sesión
     ============================================================ */

  function escribirBarraSesion(){
    const correo = ESTADO.sesion?.user?.email ?? "";
    const nombre = ESTADO.perfil?.nombre;
    $("#usuario").textContent = nombre ? `${nombre} · ${correo}` : correo;
    $("#ciudad-leyenda").textContent = ciudad();
  }

  async function cargarCatalogo(){
    ESTADO.cargando = true;
    pintar();
    try{
      const [perfil, fragancias] = await Promise.all([
        window.DATOS.leerPerfil(),
        window.DATOS.listar()
      ]);
      ESTADO.perfil = perfil || { nombre:"", ciudad:"Culiacán, Sinaloa" };
      ESTADO.fragancias = fragancias;
    }catch(e){
      nota(e.message, "error");
      ESTADO.fragancias = [];
    }finally{
      ESTADO.cargando = false;
      escribirBarraSesion();
      pintar();
    }
  }

  function limpiarEstado(){
    ESTADO.sesion = null;
    ESTADO.perfil = null;
    ESTADO.fragancias = [];
    ESTADO.consulta = "";
    ESTADO.filtroEstacion = "todas";
    $("#buscador").value = "";
    $$(".chip", chips).forEach((c, i) => c.setAttribute("aria-pressed", String(i === 0)));

    // La pantalla de acceso vuelve a su estado inicial: pestaña de entrada
    // y sin credenciales de la sesión anterior en los campos.
    if(editor.open)  editor.close();
    if(ajustes.open) ajustes.close();
    formEntrar.reset();
    formRegistrar.reset();
    mostrarPestana("entrar");
  }

  window.DATOS.alCambiarSesion(async (evento, sesion) => {
    if(evento === "PASSWORD_RECOVERY"){
      nota("Sesión abierta desde el enlace de recuperación. Cambia tu contraseña en Ajustes.", "ok");
    }

    if(sesion){
      const cambioDeUsuario = ESTADO.sesion?.user?.id !== sesion.user.id;
      ESTADO.sesion = sesion;
      mostrarPantalla("app");
      if(cambioDeUsuario) await cargarCatalogo();
      else escribirBarraSesion();
    }else{
      limpiarEstado();
      mostrarPantalla("acceso");
      pintar();
    }
  });

  (async function arrancar(){
    etiquetarOpcionMes();
    const sesion = await window.DATOS.sesionActual();
    if(sesion){
      ESTADO.sesion = sesion;
      mostrarPantalla("app");
      await cargarCatalogo();
    }else{
      mostrarPantalla("acceso");
    }
    $("#arranque").hidden = true;
  })();
})();
