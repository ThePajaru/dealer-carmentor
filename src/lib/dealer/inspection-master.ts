// Master guided-inspection template for the runner wizard.
// Every step is shown one at a time; the runner can't miss a point because the
// wizard walks him through photos and checks in physical order around the car.
// Model-specific items (endemic faults) get merged in from the AI checklist at
// render time — this file is the universal base that applies to any car.

export interface GuidedPhoto {
  key: string;
  label: string;
  hint?: string;
  /**
   * Parte del expediente que la gestoria necesita para la ficha tecnica
   * reducida. El runner las saca en la MISMA pasada que la inspeccion — un
   * formulario aparte no se rellenaria — y el gestor se lleva este subconjunto,
   * asi que la ficha se tramita con el coche todavia en Alemania.
   * Ver FICHA_PHOTOS al final del fichero.
   */
  ficha?: boolean;
  /**
   * Solo aplica a coches que lleven la pieza (enganche, techo solar...). Nunca
   * cuenta como pendiente: un coche que no la lleva tiene que poder cerrar la
   * inspeccion igual. Ver pendingInStep en el runner.
   */
  optional?: boolean;
}

export interface GuidedItem {
  id: string;
  title: string;
  hint?: string;
  // Present only on AI-merged model items:
  badSignal?: string;
  discount?: number;
}

export interface GuidedStep {
  id: string;
  title: string;
  short: string; // progress label
  intro?: string;
  tool?: string; // highlighted tool for this step
  photos?: GuidedPhoto[];
  items?: GuidedItem[];
}

export const INSPECTION_TOOLS: { name: string; why: string }[] = [
  { name: 'Espesímetro de pintura', why: 'Detecta repintados y masilla. Normal: 80–150 µm. Repintado: 200–400. Masilla: >400.' },
  { name: 'Equipo de diagnosis OBD2', why: 'Códigos de error y kilometraje real en las centralitas (motor, cambio, freno).' },
  { name: 'Linterna LED potente', why: 'Bajos, vano motor, interior de pasos de rueda.' },
  { name: 'Imán de neodimio + paño', why: 'La masilla no atrae el imán. Pásalo con paño para no rayar.' },
  { name: 'Medidor de profundidad de neumático', why: 'O una moneda de 1€: si se ve el borde dorado, queda poco dibujo.' },
  { name: 'Guantes finos y paño', why: 'Vas a tocar bajos, varilla de aceite y escape.' },
  { name: 'Móvil cargado + batería externa', why: 'Todas las fotos se suben desde esta ficha. Sin batería no hay inspección.' },
  { name: 'Coche en llano y en frío', why: 'Pide al vendedor que NO arranque el coche antes de que llegues. Un motor caliente esconde fallos de arranque.' },
];

export const GUIDED_STEPS: GuidedStep[] = [
  {
    id: 'docs',
    title: 'Documentación y llaves',
    short: 'Documentos',
    intro: 'Antes de tocar el coche, papeles en mano. Si aquí algo no cuadra, no sigas.',
    photos: [
      { key: 'doc_permiso', label: 'Documentación', hint: 'Permiso de circulación / Zulassungsbescheinigung con el VIN visible.', ficha: true },
      { key: 'doc_vin', label: 'VIN', hint: 'El VIN físico: base del parabrisas, marco de la puerta del conductor o vano motor.' },
      { key: 'doc_placa_fab', label: 'Placa del fabricante', hint: 'La placa remachada o pegada, en el marco de la puerta del conductor o en el vano motor. Tienen que leerse la homologación y las masas máximas por eje. La foto del VIN NO vale: son cosas distintas.', ficha: true },
    ],
    items: [
      { id: 'doc_vin_match', title: 'VIN del coche = VIN de la documentación', hint: 'Compara carácter a carácter. Raspado, pegatina encima o un solo dígito distinto = fuera.' },
      { id: 'doc_titular', title: 'El vendedor es el titular', hint: 'DNI del vendedor contra el titular del permiso. Si no coincide, que justifique por qué (herencia, autorización…).' },
      { id: 'doc_itv', title: 'ITV / TÜV vigente y sin defectos pendientes', hint: 'Mira fecha de validez y la lista de defectos del último informe.' },
      { id: 'doc_libro', title: 'Libro de mantenimiento con sellos coherentes', hint: 'Cuenta sellos e intervalos. Saltos de >40.000 km entre revisiones son mala señal.' },
      { id: 'doc_facturas', title: 'Facturas de mantenimiento disponibles', hint: 'Pide ver las últimas. Sellos sin factura del mismo taller = sospechoso.' },
      { id: 'doc_coc', title: 'COC disponible', hint: 'Certificado de conformidad europeo. Si lo tiene, pídelo: nos ahorra la ficha reducida. Si no lo tiene, NO es un problema — la ficha sale igual con las fotos de esta inspección.' },
      { id: 'doc_llaves', title: 'Número de llaves y que todas funcionan', hint: 'Mínimo 2. Prueba mando y hoja de cada una.' },
      { id: 'doc_km', title: 'Km del anuncio = cuadro = libro', hint: 'Anota el km del cuadro nada más dar contacto y compáralo con la última entrada del libro y el anuncio.' },
    ],
  },
  {
    id: 'fotos_ext',
    title: 'Fotos exteriores',
    short: 'Fotos',
    intro: 'Da la vuelta completa al coche. Una foto por posición, a 2–3 metros, con el coche entero en el encuadre.',
    photos: [
      { key: 'ext_frontal', label: 'Frontal', hint: 'De frente, matrícula visible.', ficha: true },
      { key: 'ext_34_del_izq', label: '3/4 delantero izquierdo', hint: 'Esquina delantera izquierda, se ven frontal y lateral.' },
      { key: 'ext_lat_izq', label: 'Lateral izquierdo', hint: 'Perpendicular al coche, las dos puertas enteras.', ficha: true },
      { key: 'ext_34_tras_izq', label: '3/4 trasero izquierdo', hint: 'Esquina trasera izquierda.' },
      { key: 'ext_trasera', label: 'Trasera', hint: 'Desde atrás, matrícula y portón enteros.', ficha: true },
      { key: 'ext_34_tras_dcha', label: '3/4 trasero derecho', hint: 'Esquina trasera derecha.' },
      { key: 'ext_lat_dcho', label: 'Lateral derecho', hint: 'Perpendicular, lado del copiloto entero.', ficha: true },
      { key: 'ext_34_del_dcha', label: '3/4 delantero derecho', hint: 'Esquina delantera derecha.' },
      { key: 'ext_techo', label: 'Techo', hint: 'Desde arriba o en ángulo. El granizo se ve aquí.' },
      { key: 'ext_enganche', label: 'Placa del enganche', hint: 'Solo si el coche lleva enganche: la placa con la homologación y los pesos de arrastre. Si no lleva, pasa a la siguiente.', ficha: true, optional: true },
      { key: 'ext_extras', label: 'Techo solar, alerón, kit', hint: 'Solo si lleva algo que no sea de serie: techo solar, alerón, kit aerodinámico, barras. Una foto general si se ven todos. Si va de serie, pasa a la siguiente.', ficha: true, optional: true },
    ],
  },
  {
    id: 'paneles',
    title: 'Carrocería panel a panel',
    short: 'Paneles',
    intro: 'Recorre el coche en el sentido de las agujas del reloj. En cada panel: arañazos, golpes, abolladuras, ondulaciones a contraluz.',
    tool: 'Imán de neodimio',
    items: [
      { id: 'pan_parag_del', title: 'Paragolpes delantero', hint: 'Arañazos de aparcamiento, soportes rotos, holguras.' },
      { id: 'pan_capo', title: 'Capó', hint: 'Impactos de piedra, pintura saltada, ondulaciones.' },
      { id: 'pan_aleta_del_izq', title: 'Aleta delantera izquierda' },
      { id: 'pan_puerta_del_izq', title: 'Puerta delantera izquierda' },
      { id: 'pan_puerta_tras_izq', title: 'Puerta trasera izquierda' },
      { id: 'pan_aleta_tras_izq', title: 'Aleta trasera izquierda' },
      { id: 'pan_porton', title: 'Portón / tapa de maletero' },
      { id: 'pan_parag_tras', title: 'Paragolpes trasero', hint: 'Mira también por debajo: roces de rampa.' },
      { id: 'pan_aleta_tras_dcha', title: 'Aleta trasera derecha' },
      { id: 'pan_puerta_tras_dcha', title: 'Puerta trasera derecha' },
      { id: 'pan_puerta_del_dcha', title: 'Puerta delantera derecha' },
      { id: 'pan_aleta_del_dcha', title: 'Aleta delantera derecha' },
      { id: 'pan_techo', title: 'Techo', hint: 'Pasa la mano: el granizo se nota antes de verse.' },
    ],
  },
  {
    id: 'pintura',
    title: 'Espesor de pintura',
    short: 'Pintura',
    intro: 'Espesímetro en mano: 3–4 medidas por panel. Normal 80–150 µm. 200–400 = repintado. >400 = masilla (golpe). Foto a cualquier lectura rara.',
    tool: 'Espesímetro',
    items: [
      { id: 'pin_parag_del', title: 'Paragolpes delantero (visual)', hint: 'El plástico no mide bien: busca diferencias de tono y gotelé.' },
      { id: 'pin_capo', title: 'Capó' },
      { id: 'pin_aleta_del_izq', title: 'Aleta delantera izquierda' },
      { id: 'pin_puerta_del_izq', title: 'Puerta delantera izquierda' },
      { id: 'pin_montante_b_izq', title: 'Montante B izquierdo', hint: 'Zona estructural: aquí un repintado es señal de accidente serio.' },
      { id: 'pin_puerta_tras_izq', title: 'Puerta trasera izquierda' },
      { id: 'pin_aleta_tras_izq', title: 'Aleta trasera izquierda' },
      { id: 'pin_porton', title: 'Portón / tapa de maletero' },
      { id: 'pin_parag_tras', title: 'Paragolpes trasero (visual)' },
      { id: 'pin_aleta_tras_dcha', title: 'Aleta trasera derecha' },
      { id: 'pin_puerta_tras_dcha', title: 'Puerta trasera derecha' },
      { id: 'pin_montante_b_dcho', title: 'Montante B derecho' },
      { id: 'pin_puerta_del_dcha', title: 'Puerta delantera derecha' },
      { id: 'pin_aleta_del_dcha', title: 'Aleta delantera derecha' },
      { id: 'pin_techo', title: 'Techo' },
    ],
  },
  {
    id: 'franquicias',
    title: 'Holguras entre paneles',
    short: 'Holguras',
    intro: 'Las franquicias (separación entre paneles) deben ser uniformes y simétricas respecto al lado contrario. Una holgura desigual delata un panel desmontado o un golpe.',
    items: [
      { id: 'fra_capo_parag', title: 'Capó – paragolpes delantero' },
      { id: 'fra_capo_aleta_izq', title: 'Aleta izquierda – capó – paragolpes', hint: 'Compárala con el mismo punto del lado derecho.' },
      { id: 'fra_puertas_izq', title: 'Puerta delantera izq. – puerta trasera izq.' },
      { id: 'fra_puerta_aleta_izq', title: 'Puerta trasera izq. – aleta trasera' },
      { id: 'fra_aleta_porton_izq', title: 'Aleta trasera izq. – portón – paragolpes' },
      { id: 'fra_porton_parag', title: 'Portón – paragolpes trasero' },
      { id: 'fra_aleta_porton_dcha', title: 'Aleta trasera dcha. – portón – paragolpes' },
      { id: 'fra_puertas_dcha', title: 'Puerta trasera dcha. – puerta delantera dcha.' },
      { id: 'fra_puerta_aleta_dcha', title: 'Puerta delantera dcha. – aleta derecha – capó' },
      { id: 'fra_aleta_capo_dcha', title: 'Aleta derecha – capó – paragolpes' },
    ],
  },
  {
    id: 'tornilleria',
    title: 'Tornillería y sujeciones',
    short: 'Tornillería',
    intro: 'Un tornillo con la pintura saltada o marcas de llave = ese panel se ha desmontado. Pregunta por qué.',
    tool: 'Linterna',
    items: [
      { id: 'tor_aleta_izq', title: 'Tornillería aleta izquierda' },
      { id: 'tor_aleta_dcha', title: 'Tornillería aleta derecha' },
      { id: 'tor_capo', title: 'Tornillería y bisagras del capó' },
      { id: 'tor_copela_izq', title: 'Copela izquierda', hint: 'Torre de suspensión: soldaduras y pintura originales, sin arrugas en la chapa.' },
      { id: 'tor_copela_dcha', title: 'Copela derecha' },
      { id: 'tor_piloto_izq', title: 'Tornillería piloto trasero izquierdo' },
      { id: 'tor_piloto_dcho', title: 'Tornillería piloto trasero derecho' },
      { id: 'tor_puerta_del_izq', title: 'Bisagras puerta delantera izquierda' },
      { id: 'tor_puerta_tras_izq', title: 'Bisagras puerta trasera izquierda' },
      { id: 'tor_puerta_del_dcha', title: 'Bisagras puerta delantera derecha' },
      { id: 'tor_puerta_tras_dcha', title: 'Bisagras puerta trasera derecha' },
    ],
  },
  {
    id: 'cristales',
    title: 'Cristales',
    short: 'Cristales',
    intro: 'Todos los cristales llevan grabado el logo del fabricante y la fecha. Un cristal distinto al resto = repuesto (pregunta por qué).',
    items: [
      { id: 'cri_luna_del', title: 'Luna delantera', hint: 'Impactos, fisuras, restos de adhesivos. Un impacto en zona de visión no pasa ITV.' },
      { id: 'cri_puerta_del_izq', title: 'Ventanilla delantera izquierda', hint: '¿Mismo fabricante y año que el resto?' },
      { id: 'cri_puerta_tras_izq', title: 'Ventanilla trasera izquierda' },
      { id: 'cri_luna_tras', title: 'Luna trasera', hint: 'Hilos del térmico intactos.' },
      { id: 'cri_puerta_tras_dcha', title: 'Ventanilla trasera derecha' },
      { id: 'cri_puerta_del_dcha', title: 'Ventanilla delantera derecha' },
    ],
  },
  {
    id: 'opticas',
    title: 'Ópticas',
    short: 'Ópticas',
    intro: 'Estado del plástico y — clave — la fecha de fabricación grabada en cada faro. Un faro más nuevo que el coche = golpe en esa esquina.',
    items: [
      { id: 'opt_del_izq', title: 'Óptica delantera izquierda', hint: 'Amarilleo, condensación interior, grietas, sujeciones rotas.' },
      { id: 'opt_del_dcha', title: 'Óptica delantera derecha' },
      { id: 'opt_tras_izq', title: 'Piloto trasero izquierdo' },
      { id: 'opt_tras_dcha', title: 'Piloto trasero derecho' },
      { id: 'opt_fecha_izq', title: 'Fecha de fabricación faro izquierdo coherente', hint: 'Grabada en el plástico (ej. 12/22). Debe ser anterior o igual a la fecha del coche.' },
      { id: 'opt_fecha_dcha', title: 'Fecha de fabricación faro derecho coherente' },
    ],
  },
  {
    id: 'ruedas',
    title: 'Ruedas y neumáticos',
    short: 'Ruedas',
    intro: 'Dibujo, desgaste irregular, medida y fecha DOT de cada rueda. Desgaste solo por dentro o por fuera = alineación o suspensión tocada. La MEDIDA del flanco va a la ficha técnica: tiene que leerse.',
    tool: 'Medidor de profundidad',
    photos: [
      { key: 'rueda_detalle', label: 'Rueda delantera', hint: 'De cerca: el dibujo, y el flanco con la MEDIDA y el DOT legibles. La medida es lo que va a la ficha (ej. 205/55 R16 91V); el DOT son las 4 cifras de la fecha.', ficha: true },
      { key: 'rueda_detalle_tras', label: 'Rueda trasera', hint: 'Igual que la delantera. Muchos coches calzan distinto por eje y la ficha necesita las dos medidas.', ficha: true },
    ],
    items: [
      { id: 'rue_neum_del', title: 'Neumáticos delanteros', hint: 'Profundidad (mínimo legal 1,6 mm; <3 mm = cámbialos ya), desgaste uniforme, misma marca por eje.' },
      { id: 'rue_neum_tras', title: 'Neumáticos traseros' },
      { id: 'rue_dot', title: 'Fecha DOT de los 4 neumáticos', hint: '4 cifras en el flanco (ej. 2223 = semana 22 de 2023). >6 años = sustituir aunque tengan dibujo.' },
      { id: 'rue_llanta_del', title: 'Llantas delanteras', hint: 'Roces de bordillo, grietas, reparaciones.' },
      { id: 'rue_llanta_tras', title: 'Llantas traseras' },
      { id: 'rue_antirrobo', title: 'Tornillería antirrobo y su llave', hint: 'Si hay tornillos antirrobo, la llave adaptadora tiene que estar en el coche.' },
      { id: 'rue_repuesto', title: 'Rueda de repuesto o kit antipinchazos', hint: 'Presente, con presión / sin caducar.' },
    ],
  },
  {
    id: 'frenos',
    title: 'Frenos',
    short: 'Frenos',
    intro: 'Mira discos y pastillas a través de la llanta (linterna). Labio marcado en el borde del disco = disco gastado.',
    tool: 'Linterna',
    items: [
      { id: 'fre_disco_del', title: 'Discos delanteros', hint: 'Surcos profundos, labio exterior, óxido en la banda de fricción.' },
      { id: 'fre_past_del', title: 'Pastillas delanteras', hint: 'Menos de 4 mm de ferodo = sustitución inmediata.' },
      { id: 'fre_pinza_del', title: 'Pinzas delanteras', hint: 'Fugas de líquido, guardapolvos rotos, óxido excesivo.' },
      { id: 'fre_disco_tras', title: 'Discos traseros' },
      { id: 'fre_past_tras', title: 'Pastillas traseras' },
      { id: 'fre_pinza_tras', title: 'Pinzas traseras' },
    ],
  },
  {
    id: 'interior',
    title: 'Interior y desgastes',
    short: 'Interior',
    intro: 'El desgaste interior no miente: tiene que ser coherente con los km. Volante liso y pedales gastados con 60.000 km = km trucados.',
    photos: [
      { key: 'int_cuadro', label: 'Cuadro (km)', hint: 'Contacto dado, kilometraje legible. Anota los km reales abajo.' },
      { key: 'int_delante', label: 'Interior delantero', hint: 'Desde la puerta del conductor: asientos, volante y consola.' },
      { key: 'int_palanca', label: 'Palanca de cambio', hint: 'De cerca, con la maneta y la guía visibles: tiene que verse si es manual o automático. Va a la ficha técnica.', ficha: true },
      { key: 'int_detras', label: 'Interior trasero', hint: 'Banqueta trasera completa.' },
      { key: 'int_maletero', label: 'Maletero', hint: 'Levanta la moqueta: aquí se ve óxido y reparaciones de golpe trasero.' },
    ],
    items: [
      { id: 'int_volante', title: 'Volante', hint: 'Brillo y cuero liso = muchos km. Compara con el km del cuadro.' },
      { id: 'int_pedales', title: 'Pedales', hint: 'Gomas gastadas hasta el metal con pocos km = sospecha.' },
      { id: 'int_pomo', title: 'Pomo / leva de cambio' },
      { id: 'int_asiento_piloto', title: 'Asiento del conductor', hint: 'Rotura del aro lateral izquierdo: el clásico de coche con muchos km.' },
      { id: 'int_asiento_copiloto', title: 'Asiento del copiloto' },
      { id: 'int_banqueta', title: 'Banqueta y plazas traseras', hint: 'Anclajes isofix, tapicería, quemaduras.' },
      { id: 'int_cuadro_estado', title: 'Cuadro de instrumentos', hint: 'Píxeles muertos, arañazos, testigos tapados.' },
      { id: 'int_mandos', title: 'Mandos de ventanillas y puertas' },
      { id: 'int_techo_int', title: 'Techo interior y parasoles', hint: 'Cielo descolgado, manchas de agua (entrada por techo solar o juntas).' },
      { id: 'int_olor', title: 'Olor del habitáculo', hint: 'Humedad = entrada de agua. Tabaco denso baja el valor de venta.' },
      { id: 'int_tapa_comb', title: 'Tapa de combustible / puerto de carga', hint: 'Apertura correcta, interior sin óxido ni golpes.' },
    ],
  },
  {
    id: 'funciones',
    title: 'Funcionalidades',
    short: 'Funciones',
    intro: 'Contacto dado: prueba TODO botón que veas. Lo que no funciona hoy, lo pagas tú mañana.',
    items: [
      { id: 'fun_retro_plegado', title: 'Plegado de retrovisores' },
      { id: 'fun_retro_ajuste', title: 'Ajuste eléctrico de retrovisores' },
      { id: 'fun_vent_piloto', title: 'Ventanilla conductor', hint: 'Subida/bajada completa, one-touch, sin ruidos de arrastre.' },
      { id: 'fun_vent_copiloto', title: 'Ventanilla copiloto' },
      { id: 'fun_vent_tras_izq', title: 'Ventanilla trasera izquierda' },
      { id: 'fun_vent_tras_dcha', title: 'Ventanilla trasera derecha' },
      { id: 'fun_asientos_calef', title: 'Asientos calefactables', hint: 'Dales 2 minutos, toca la banqueta.' },
      { id: 'fun_asientos_vent', title: 'Asientos ventilados (si equipa)' },
      { id: 'fun_pantalla', title: 'Pantalla de infoentretenimiento', hint: 'Táctil en toda la superficie, CarPlay/Android Auto, sin reinicios.' },
      { id: 'fun_luces_int', title: 'Luces interiores' },
      { id: 'fun_cint_piloto', title: 'Cinturón conductor y pretensor', hint: 'Tira fuerte y seco: debe bloquear. Recogida completa.' },
      { id: 'fun_cint_copiloto', title: 'Cinturón copiloto' },
      { id: 'fun_cint_traseros', title: 'Cinturones traseros (los 3)' },
      { id: 'fun_clima', title: 'Climatizador: frío y calor', hint: 'AC al mínimo → aire frío de verdad en <2 min. Luego calor.' },
      { id: 'fun_camara', title: 'Sensores y cámara de marcha atrás', hint: 'Imagen limpia, líneas de guía, sensores pitan al acercar la mano.' },
      { id: 'fun_altavoces', title: 'Altavoces', hint: 'Volumen alto un momento: distorsión o vibración = cono roto.' },
      { id: 'fun_limpia', title: 'Limpiaparabrisas con líquido', hint: 'Todas las velocidades + eyectores delante y detrás.' },
      { id: 'fun_techo_solar', title: 'Techo solar (si equipa)', hint: 'Apertura completa y cierre. Mira las juntas y los desagües.' },
      { id: 'fun_cierre', title: 'Cierre centralizado', hint: 'Con el mando y con la llave física. Todas las puertas.' },
      { id: 'fun_porton_el', title: 'Portón eléctrico (si equipa)' },
    ],
  },
  {
    id: 'luces',
    title: 'Luces exteriores',
    short: 'Luces',
    intro: 'Con ayuda del vendedor o contra una pared/escaparate. Todas, una a una.',
    items: [
      { id: 'luz_drl', title: 'Luces diurnas (DRL)' },
      { id: 'luz_cortas', title: 'Cruce (cortas)', hint: 'Ambas encienden con la misma intensidad y color.' },
      { id: 'luz_largas', title: 'Carretera (largas)' },
      { id: 'luz_intermitentes', title: 'Intermitentes y warning', hint: 'Los 4 + laterales/retrovisores. Parpadeo rápido = bombilla fundida.' },
      { id: 'luz_antiniebla', title: 'Antinieblas delanteras y trasera' },
      { id: 'luz_freno', title: 'Luces de freno', hint: 'Las 3, incluida la tercera luz. Pide al vendedor que pise el freno.' },
      { id: 'luz_atras', title: 'Luz de marcha atrás' },
      { id: 'luz_matricula', title: 'Luces de matrícula' },
    ],
  },
  {
    id: 'motor',
    title: 'Vano motor y arranque en frío',
    short: 'Motor',
    intro: 'IMPORTANTE: el motor debe estar frío (toca el capó). Primero todo en parado, luego el arranque — es el momento que más fallos delata.',
    tool: 'Linterna + guantes',
    photos: [
      { key: 'motor_vano', label: 'Motor', hint: 'Vano motor completo con buena luz.' },
    ],
    items: [
      { id: 'mot_fuga_balancines', title: 'Fugas en tapa de balancines', hint: 'Aceite fresco o sellador nuevo alrededor de la junta.' },
      { id: 'mot_fuga_combustible', title: 'Fugas en sistema de combustible', hint: 'Olor a gasolina/gasóleo, manchas húmedas en rail e inyectores.' },
      { id: 'mot_tapon_aceite', title: 'Tapón de aceite', hint: 'Ábrelo: crema blanquecina (mayonesa) = agua en el aceite → junta de culata.' },
      { id: 'mot_varilla', title: 'Varilla / cánula de aceite', hint: 'Nivel y color. Negro muy denso = mantenimiento dejado.' },
      { id: 'mot_pcv', title: 'Válvula PCV / respiradero', hint: 'Suciedad extraña o aceite alrededor.' },
      { id: 'mot_bloque_culata', title: 'Unión bloque – culata', hint: 'Rezumes de aceite en la junta, restos secos.' },
      { id: 'mot_refrigerante', title: 'Nivel y color del refrigerante', hint: 'EN FRÍO. Rosa/azul/verde limpio = bien. Marrón o aceitoso = mezcla con aceite.' },
      { id: 'mot_liquido_frenos', title: 'Nivel líquido de frenos', hint: 'Entre MIN y MAX. Bajo = pastillas gastadas o fuga.' },
      { id: 'mot_correa', title: 'Correa auxiliar', hint: 'Grietas transversales o deshilachada = sustitución.' },
      { id: 'mot_soportes', title: 'Soportes de motor (visual)', hint: 'Gomas agrietadas o hundidas.' },
      { id: 'mot_bateria', title: 'Batería 12V', hint: 'Fecha en la etiqueta, bornes sin sulfatar. >5 años = próxima a morir.' },
      { id: 'mot_arranque_frio', title: 'Arranque en frío', hint: 'Arranca a la primera, sin traqueteo largo. Mira el escape: humo azul = aceite, blanco persistente = culata, negro = inyección.' },
      { id: 'mot_testigos', title: 'Testigos del cuadro', hint: 'Con contacto todos encienden; tras arrancar todos se apagan. Si falta alguno al dar contacto, han quitado la bombilla.' },
      { id: 'mot_ralenti_frio', title: 'Ralentí en frío estable', hint: 'Sin oscilaciones de revoluciones ni vibración anormal los primeros minutos.' },
    ],
  },
  {
    id: 'bajos',
    title: 'Bajos, óxidos y fugas',
    short: 'Bajos',
    intro: 'Agáchate con la linterna (o pide elevador). Busca óxido perforante, soldaduras nuevas y cualquier gota fresca.',
    tool: 'Linterna + guantes',
    photos: [
      { key: 'bajos_foto', label: 'Bajos', hint: 'La mejor foto que puedas de los bajos: cárter y tren delantero.' },
    ],
    items: [
      { id: 'baj_oxido_del', title: 'Óxido en tren delantero', hint: 'Superficial es normal en importación; perforante o escamado no.' },
      { id: 'baj_oxido_tras', title: 'Óxido en tren trasero' },
      { id: 'baj_oxido_escape', title: 'Óxido en el escape', hint: 'Golpea suave con el puño: sonido a lata rota = podrido por dentro.' },
      { id: 'baj_susp_del', title: 'Suspensión delantera', hint: 'Amortiguadores llorados (aceite), silentblocks agrietados, guardapolvos rotos.' },
      { id: 'baj_susp_tras', title: 'Suspensión trasera' },
      { id: 'baj_carter', title: 'Aceite en cubrecárter', hint: 'Quita/mira el cubrecárter si puedes: acumulación de aceite = fuga activa.' },
      { id: 'baj_palier', title: 'Grasa de palier', hint: 'Grasa centrifugada alrededor de los fuelles = fuelle roto.' },
      { id: 'baj_fuga_frenos', title: 'Fugas de líquido de frenos', hint: 'Latiguillos y racores húmedos.' },
      { id: 'baj_estructura', title: 'Soldaduras y estructura', hint: 'Soldaduras irregulares o chapa arrugada en largueros = accidente reparado.' },
    ],
  },
  {
    id: 'diagnosis',
    title: 'Diagnosis OBD',
    short: 'Diagnosis',
    intro: 'Conecta la máquina y lee TODAS las centralitas, no solo motor. El km guardado en las unidades destapa cuentakilómetros trucados.',
    tool: 'Equipo OBD2',
    photos: [
      { key: 'diag_pantalla', label: 'Diagnosis', hint: 'Pantalla del equipo con el resumen de errores visible.' },
    ],
    items: [
      { id: 'dia_dtc', title: 'Códigos de error (DTC)', hint: 'Activos y memorizados en todas las centralitas. Memoria borrada hace poco también es señal.' },
      { id: 'dia_km_motor', title: 'Km en unidad de motor', hint: 'Debe cuadrar con el cuadro (±1.000 km).' },
      { id: 'dia_km_cambio', title: 'Km en unidad de transmisión' },
      { id: 'dia_km_freno', title: 'Km en unidad de frenado / ABS' },
      { id: 'dia_airbag', title: 'Centralita de airbag sin errores', hint: 'Errores de crash guardados = accidente con airbags.' },
    ],
  },
  {
    id: 'dinamica',
    title: 'Prueba dinámica',
    short: 'Prueba',
    intro: 'Mínimo 20 minutos con tramo urbano y vía rápida. Radio apagada, ventanillas bajadas al principio para oír.',
    items: [
      { id: 'din_ralenti_caliente', title: 'Ralentí en caliente estable', hint: 'Tras la prueba, con el motor a temperatura: sin oscilaciones.' },
      { id: 'din_embrague', title: 'Embrague / convertidor', hint: 'Manual: acelera en 4ª a bajas vueltas — si las revoluciones suben sin empujar, patina. Automático: salidas suaves.' },
      { id: 'din_cambio', title: 'Caja de cambios', hint: 'Todas las marchas + atrás. Tirones, chasquidos o marchas que rascan = caro.' },
      { id: 'din_frenada', title: 'Frenada recta y sin vibración', hint: 'Frenada firme desde 80: sin irse de lado ni vibrar el volante (discos alabeados).' },
      { id: 'din_direccion', title: 'Dirección centrada en recta', hint: 'En recta llana, afloja las manos 2 segundos: no debe irse a un lado.' },
      { id: 'din_suspension', title: 'Ruidos de suspensión', hint: 'Pasa por badenes despacio: toc-toc = rótulas/bieletas.' },
      { id: 'din_120', title: 'Comportamiento a 100–120 km/h', hint: 'Vibraciones en volante (equilibrado), ruidos de rodamiento (zumbido que cambia al girar levemente).' },
      { id: 'din_freno_mano', title: 'Freno de mano / eléctrico retiene', hint: 'En cuesta si es posible.' },
      { id: 'din_adas', title: 'ADAS: crucero, carril, frenada auto (si equipa)', hint: 'Actívalos un momento en vía adecuada: sin errores en pantalla.' },
      { id: 'din_temp', title: 'Temperatura del motor estable', hint: 'La aguja clavada en el centro; nunca debe pasar de ahí.' },
    ],
  },
];

// Photo labels that the customer-facing gallery already understands — the
// wizard keeps these exact labels for continuity with old reports.
export const PHOTO_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  GUIDED_STEPS.flatMap(s => (s.photos || []).map(p => [p.key, p.label])),
);

// El expediente de la ficha técnica reducida, DERIVADO del propio checklist —
// no es una lista aparte que pueda quedarse desincronizada. El runner las saca
// dentro de su pasada normal y la gestoría se lleva justo estas.
export const FICHA_PHOTOS: GuidedPhoto[] =
  GUIDED_STEPS.flatMap(s => (s.photos || []).filter(p => p.ficha));

export const FICHA_PHOTO_KEYS: string[] = FICHA_PHOTOS.map(p => p.key);
