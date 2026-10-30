// Quarto andavel: o quarto modelado no Blender, com a luz do Cycles assada nas
// texturas, num glb que o three.js desenha sem luz em tempo real (material
// unlit). O visitante olha arrastando, anda tocando no chao e pula para os
// pontos de interesse pelos botoes do rodape.
//
// Decisoes:
// - Nada pesa antes do toque: three.js, GLTFLoader, decoder do meshopt e o glb
//   entram por import dinamico dentro do clique.
// - Dois glb com a mesma geometria: atlas de 2048 para celular e de 4096 so em
//   tela grande com memoria sobrando. Dois 4096 descompactados passam de 170 MB
//   na GPU, o bastante para o celular recarregar a aba.
// - Tela cheia num overlay fixo: no celular o quarto num retangulo da pagina
//   briga com a rolagem. O overlay trava a rolagem, prende o foco e devolve o
//   foco ao botao quando fecha.
// - Colisao pelo nav.json do Blender: a camera so pisa nos retangulos livres.
//   O toque no chao vira um caminho numa grade de 2,5 cm (A*), alisado por
//   linha de visada, para contornar a cama em vez de atravessar.
// - Render sob demanda: parado nao desenha, nao gasta bateria.
// - Alternativas ao arraste (WCAG 2.2, 2.5.7): botoes de girar, pontos de
//   interesse e teclado (WASD e setas).

const raiz = document.querySelector('[data-andavel]');
const ov = document.querySelector('[data-andavel-overlay]');
if (raiz && ov) iniciar();

function iniciar() {
  const tipo = raiz.dataset.andavel;
  const botao = raiz.querySelector('[data-andavel-abrir]');
  const aviso = raiz.querySelector('[data-andavel-aviso]');
  const canvas = ov.querySelector('[data-andavel-canvas]');
  const dica = ov.querySelector('[data-andavel-dica]');
  const carga = ov.querySelector('[data-andavel-carga]');
  const barra = ov.querySelector('[data-andavel-barra]');
  const progresso = ov.querySelector('[data-andavel-progresso]');
  const fecharBtn = ov.querySelector('[data-andavel-fechar]');
  const estado = ov.querySelector('[data-andavel-status]');
  const pasta = new URL('../assets/3d/', import.meta.url);

  const FRASES = (() => {
    try { return JSON.parse(document.getElementById('i18n').textContent); }
    catch (e) { return {}; }
  })();
  const fr = (chave, reserva) => FRASES[chave] || reserva;
  const anunciar = (t) => { if (estado) estado.textContent = t; };
  const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toque = matchMedia('(pointer: coarse)').matches;

  let app = null;
  let carregando = false;
  let inertes = [];

  const temWebgl = () => {
    try {
      const t = document.createElement('canvas');
      return !!(t.getContext('webgl2') || t.getContext('webgl'));
    } catch (e) {
      return false;
    }
  };

  function mostrarAviso(texto) {
    if (!aviso) return;
    if (texto) aviso.textContent = texto;
    aviso.hidden = false;
  }

  // ------------------------------------------------------ abrir e fechar
  function abrir() {
    if (ov.parentElement !== document.body) document.body.append(ov);
    ov.hidden = false;
    document.documentElement.classList.add('andavel-aberto');
    inertes = [...document.body.children].filter((el) => el !== ov && !el.inert);
    inertes.forEach((el) => { el.inert = true; });
    document.addEventListener('keydown', teclado);
    fecharBtn.focus();
    if (app) app.retomar();
    else if (!carregando) carregar();
  }

  function fechar() {
    if (ov.hidden) return;
    ov.hidden = true;
    document.documentElement.classList.remove('andavel-aberto');
    inertes.forEach((el) => { el.inert = false; });
    inertes = [];
    document.removeEventListener('keydown', teclado);
    if (app) app.pausar();
    if (botao) botao.focus();
  }

  function focaveis() {
    return [...ov.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent !== null);
  }

  function teclado(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
    if (e.key === 'Tab') {
      // O inert ja tira o resto da pagina da ordem de foco; isto fecha o
      // ciclo dentro do overlay tambem onde o inert nao existe.
      const lista = focaveis();
      if (!lista.length) return;
      const i = lista.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); lista[lista.length - 1].focus(); }
      else if (!e.shiftKey && i === lista.length - 1) { e.preventDefault(); lista[0].focus(); }
      return;
    }
    if (app) app.tecla(e, true);
  }
  document.addEventListener('keyup', (e) => { if (app) app.tecla(e, false); });

  fecharBtn.addEventListener('click', fechar);

  // ------------------------------------------------------------ carga
  function progredir(f) {
    const v = Math.max(0, Math.min(1, f));
    if (progresso) progresso.style.transform = `scaleX(${v})`;
    if (barra) barra.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }

  async function carregar() {
    carregando = true;
    carga.hidden = false;
    ov.removeAttribute('data-pronto');
    progredir(0.04);
    let THREE;
    try {
      const mods = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
        fetch(new URL(`${tipo}-nav.json`, pasta)).then((r) => {
          if (!r.ok) throw new Error('nav');
          return r.json();
        }),
      ]);
      THREE = mods[0];
      const { GLTFLoader } = mods[1];
      const { MeshoptDecoder } = mods[2];
      progredir(0.1);
      app = montar(THREE, mods[3]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const nome = `${tipo}-${app.atlas}.glb`;
      const estimado = app.atlas === 4096 ? 9e5 : 5.6e5;
      const gltf = await new Promise((ok, erro) => {
        loader.load(new URL(nome, pasta).href, ok, (ev) => {
          const total = ev.lengthComputable && ev.total ? ev.total : estimado;
          progredir(0.1 + 0.85 * Math.min(1, ev.loaded / total));
        }, erro);
      });
      app.receber(gltf.scene, nome);
      progredir(1);
      carga.hidden = true;
      ov.setAttribute('data-pronto', 'true');
      anunciar(fr('andavelAberto', 'Quarto aberto. Arraste para olhar, toque no chão para andar ou use os pontos abaixo.'));
    } catch (e) {
      if (app) { app.descartar(); app = null; }
      fechar();
      mostrarAviso(fr('andavelFalhou', 'Não foi possível carregar o quarto'));
      if (botao) botao.textContent = fr('andavelTentar', 'Tentar de novo');
    } finally {
      carregando = false;
    }
  }

  const dicaTexto = ov.querySelector('[data-andavel-dica-texto]');
  if (dicaTexto) {
    // No toque, dois itens curtos: o joystick anda, o arraste na tela olha.
    if (toque) {
      dicaTexto.replaceChildren(...[fr('andavelDicaJoy', 'Joystick: andar'), fr('andavelDicaOlhar', 'Arraste a tela: olhar')]
        .map((t) => { const s = document.createElement('span'); s.className = 'andavel__dica-item'; s.textContent = t; return s; }));
    } else {
      dicaTexto.textContent = fr('andavelDicaMouse', 'Arraste para olhar · clique no chão ou use WASD');
    }
  }
  const tirarDica = () => { if (dica) dica.setAttribute('data-some', 'true'); };

  if (botao) {
    if (!temWebgl()) {
      botao.hidden = true;
      mostrarAviso();
    } else {
      botao.addEventListener('click', abrir);
    }
  }

  // ========================================================== o quarto
  function montar(THREE, nav) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    // Atlas grande so com tela grande de verdade, ponteiro fino e memoria.
    // Safari e Firefox nao informam a memoria: ai vale a tela.
    const mem = navigator.deviceMemory;
    const dpr = window.devicePixelRatio || 1;
    const grande = matchMedia('(min-width: 64em) and (hover: hover) and (pointer: fine)').matches
      && window.innerWidth * dpr >= 1400
      && (mem === undefined || mem >= 4)
      && renderer.capabilities.maxTextureSize >= 4096;
    const atlas = grande ? 4096 : 2048;

    const cor = (v) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#000');
    const cena = new THREE.Scene();
    cena.background = cor('--color-text');
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
    camera.rotation.order = 'YXZ';

    // ------------------------------------------------------ navegacao
    const OLHO = nav.alturaOlhos || 1.6;
    const EPS = 0.002;
    const rets = nav.andavel;
    // Retangulo fino (menos de 15 cm) serve para ligar areas e para a
    // colisao, mas nunca como destino de toque: parar ali e parar espremido.
    const largos = rets.filter((r) => Math.min(r.x1 - r.x0, r.z1 - r.z0) >= 0.145);
    const livre = (x, z) => rets.some((r) => x >= r.x0 - EPS && x <= r.x1 + EPS && z >= r.z0 - EPS && z <= r.z1 + EPS);

    function destino(x, z) {
      if (largos.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) return [x, z];
      let melhor = null;
      let dm = Infinity;
      for (const r of largos) {
        const mx = Math.min(0.15, (r.x1 - r.x0) / 2);
        const mz = Math.min(0.15, (r.z1 - r.z0) / 2);
        const px = Math.max(r.x0 + mx, Math.min(r.x1 - mx, x));
        const pz = Math.max(r.z0 + mz, Math.min(r.z1 - mz, z));
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < dm) { dm = d; melhor = [px, pz]; }
      }
      return melhor;
    }

    // Grade de 2,5 cm sobre o quarto: as tiras de ligacao do nav tem 3 cm,
    // e uma grade mais grossa deixaria areas sem caminho entre si.
    const P = 0.025;
    const q = nav.quarto;
    const nx = Math.ceil((q.x1 - q.x0) / P);
    const nz = Math.ceil((q.z1 - q.z0) / P);
    const ok = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) ok[j * nx + i] = livre(q.x0 + (i + 0.5) * P, q.z0 + (j + 0.5) * P) ? 1 : 0;
    }
    const centro = (k) => [q.x0 + ((k % nx) + 0.5) * P, q.z0 + (Math.floor(k / nx) + 0.5) * P];
    function celula(x, z) {
      const i = Math.max(0, Math.min(nx - 1, Math.floor((x - q.x0) / P)));
      const j = Math.max(0, Math.min(nz - 1, Math.floor((z - q.z0) / P)));
      const k = j * nx + i;
      if (ok[k]) return k;
      let melhor = -1;
      let dm = Infinity;
      for (let c = 0; c < ok.length; c += 1) {
        if (!ok[c]) continue;
        const [cx, cz] = centro(c);
        const d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d < dm) { dm = d; melhor = c; }
      }
      return melhor;
    }
    const visada = (a, b) => {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02);
      for (let s = 1; s <= n; s += 1) {
        const t = s / n;
        if (!livre(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
      }
      return true;
    };

    function caminho(a, b) {
      if (visada(a, b)) return [a, b];
      const s = celula(a[0], a[1]);
      const t = celula(b[0], b[1]);
      if (s < 0 || t < 0) return [a];
      const g = new Float32Array(ok.length).fill(Infinity);
      const de = new Int32Array(ok.length).fill(-1);
      const fechado = new Uint8Array(ok.length);
      const heap = [];
      const h = (k) => { const [x, z] = centro(k); const [tx, tz] = centro(t); return Math.hypot(x - tx, z - tz); };
      const por = (f, k) => {
        heap.push([f, k]);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const tirar = () => {
        const topo = heap[0];
        const ult = heap.pop();
        if (heap.length) {
          heap[0] = ult;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return topo[1];
      };
      g[s] = 0;
      por(h(s), s);
      while (heap.length) {
        const k = tirar();
        if (k === t) break;
        if (fechado[k]) continue;
        fechado[k] = 1;
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            if (!di && !dj) continue;
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
            const v = jj * nx + ii;
            if (!ok[v] || fechado[v]) continue;
            // diagonal so com os dois lados livres: nao corta quina
            if (di && dj && (!ok[j * nx + ii] || !ok[jj * nx + i])) continue;
            const custo = g[k] + (di && dj ? Math.SQRT2 : 1) * P;
            if (custo < g[v]) { g[v] = custo; de[v] = k; por(custo + h(v), v); }
          }
        }
      }
      if (de[t] < 0 && s !== t) return [a];
      const celulas = [];
      for (let k = t; k >= 0; k = de[k]) { celulas.push(centro(k)); if (k === s) break; }
      celulas.reverse();
      const pts = [a, ...celulas, b];
      // Alisa: de cada ponto, pula para o mais distante que ainda se ve.
      const saida = [a];
      let i = 0;
      while (i < pts.length - 1) {
        let j = i + 1;
        while (j + 1 < pts.length && visada(pts[i], pts[j + 1])) j += 1;
        saida.push(pts[j]);
        i = j;
      }
      return saida;
    }

    // ------------------------------------------------------ camera
    const pos = { x: 0, z: 0 };
    let yaw = 0;
    let pitch = 0;
    const LIM = THREE.MathUtils.degToRad(75);
    const mirarPara = (x, y, z, de) => {
      const dx = x - de.x;
      const dy = y - OLHO;
      const dz = z - de.z;
      return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
    };
    const trilha = [];
    function aplicar() {
      pitch = Math.max(-LIM, Math.min(LIM, pitch));
      camera.position.set(pos.x, OLHO, pos.z);
      camera.rotation.set(pitch, yaw, 0);
      if (trilha.length < 20000) trilha.push([pos.x, pos.z]);
    }
    function irInicio() {
      const i = nav.inicio;
      pos.x = i.posicao[0];
      pos.z = i.posicao[2];
      [yaw, pitch] = mirarPara(i.olharPara[0], i.olharPara[1], i.olharPara[2], pos);
    }
    irInicio();

    // ------------------------------------------------------ cena
    let alvos = [];
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.17, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: cor('--color-bg'), transparent: true, opacity: 0.9, depthWrite: false }));
    anel.position.y = 0.006;
    anel.visible = false;
    anel.renderOrder = 2;
    cena.add(anel);

    // ------------------------------------------------------ desenho
    let pedido = 0;
    let pausado = false;
    let quadros = 0;
    let ultimo = 0;
    let viagem = null;
    let giro = null;
    let inercia = 0;
    const teclas = new Set();
    // joystick: frente (+) e lado (+ direita), de -1 a 1
    const joy = { f: 0, s: 0 };
    let medindo = 0;

    function pedir() {
      if (!pedido && !pausado) pedido = requestAnimationFrame(quadro);
    }

    function ajustar() {
      const l = canvas.clientWidth;
      const a = canvas.clientHeight;
      if (!l || !a) return;
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.floor(l * pr) || canvas.height !== Math.floor(a * pr)) {
        renderer.setSize(l, a, false);
        camera.aspect = l / a;
        // Celular em pe: abre o campo vertical para o horizontal nao virar
        // um tubo de 36 graus.
        camera.fov = camera.aspect >= 1 ? 70 : Math.min(90, 70 + (1 - camera.aspect) * 37);
        camera.updateProjectionMatrix();
      }
    }

    const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

    function quadro(agora) {
      pedido = 0;
      const dt = Math.min(0.05, ultimo ? (agora - ultimo) / 1000 : 0.016);
      ultimo = agora;
      let continuar = false;
      ajustar();

      if (viagem) {
        const t = Math.min(1, (agora - viagem.t0) / viagem.dur);
        const e = suave(t);
        const alvo = e * viagem.total;
        let k = 1;
        while (k < viagem.pts.length - 1 && viagem.acc[k] < alvo) k += 1;
        const a = viagem.pts[k - 1];
        const b = viagem.pts[k];
        const seg = viagem.acc[k] - viagem.acc[k - 1] || 1;
        const u = Math.max(0, Math.min(1, (alvo - viagem.acc[k - 1]) / seg));
        pos.x = a[0] + (b[0] - a[0]) * u;
        pos.z = a[1] + (b[1] - a[1]) * u;
        if (viagem.olhar) {
          yaw = viagem.y0 + viagem.dy * e;
          pitch = viagem.p0 + (viagem.olhar[1] - viagem.p0) * e;
        }
        if (t >= 1) {
          const fim = viagem.fim;
          viagem = null;
          anel.visible = false;
          if (fim) fim();
        } else continuar = true;
      }

      if (giro) {
        const t = Math.min(1, (agora - giro.t0) / giro.dur);
        yaw = giro.y0 + giro.dy * suave(t);
        if (t >= 1) giro = null; else continuar = true;
      }

      if (inercia) {
        yaw += inercia * dt * 1000;
        inercia *= Math.exp(-dt / 0.12);
        if (Math.abs(inercia) < 2e-5) inercia = 0; else continuar = true;
      }

      if (teclas.size) {
        let f = 0;
        let s = 0;
        let r = 0;
        if (teclas.has('w') || teclas.has('arrowup')) f += 1;
        if (teclas.has('s') || teclas.has('arrowdown')) f -= 1;
        if (teclas.has('d')) s += 1;
        if (teclas.has('a')) s -= 1;
        if (teclas.has('arrowleft') || teclas.has('q')) r += 1;
        if (teclas.has('arrowright') || teclas.has('e')) r -= 1;
        yaw += r * dt * 1.6;
        if (f || s) passo(f, s, (1.4 * dt) / Math.hypot(f, s));
        continuar = true;
      }

      // Joystick: velocidade proporcional ao deslocamento do pino, ate 1,2 m/s
      if (joy.f || joy.s) {
        passo(joy.f, joy.s, 1.2 * dt);
        continuar = true;
      }

      if (medindo && agora < medindo) { yaw += dt * 0.6; continuar = true; }

      aplicar();
      renderer.render(cena, camera);
      quadros += 1;
      if (continuar) pedir(); else ultimo = 0;
    }

    // Anda f para a frente e s para o lado, escalados por v. Desliza na
    // parede: se o passo inteiro sai do livre, tenta cada eixo.
    function passo(f, s, v) {
      viagem = null;
      anel.visible = false;
      const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * v;
      const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * v;
      if (livre(pos.x + dx, pos.z + dz)) { pos.x += dx; pos.z += dz; }
      else if (livre(pos.x + dx, pos.z)) pos.x += dx;
      else if (livre(pos.x, pos.z + dz)) pos.z += dz;
    }

    function andarAte(x, z, olhar, fim) {
      const d = destino(x, z);
      if (!d) return false;
      const pts = caminho([pos.x, pos.z], d);
      if (pts.length < 2) return false;
      const acc = [0];
      for (let i = 1; i < pts.length; i += 1) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = acc[acc.length - 1];
      anel.position.x = d[0];
      anel.position.z = d[1];
      anel.visible = true;
      inercia = 0;
      giro = null;
      let dy = 0;
      if (olhar) {
        dy = olhar[0] - yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      }
      if (reduzido() || (total < 0.01 && !olhar)) {
        pos.x = d[0];
        pos.z = d[1];
        if (olhar) [yaw, pitch] = olhar;
        anel.visible = false;
        viagem = null;
        if (fim) fim();
        pedir();
        return true;
      }
      const dur = Math.max(600, Math.min(1600, 450 + total * 380));
      viagem = { pts, acc, total, dur, t0: performance.now(), olhar, y0: yaw, dy, p0: pitch, fim };
      pedir();
      return true;
    }

    // ------------------------------------------------------ ponteiro
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function chao(cx, cy) {
      if (!alvos.length) return null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(alvos, false)[0];
      // Teto nao leva a lugar nenhum; parede e movel levam ao ponto livre
      // mais perto do pe deles.
      if (!hit || hit.point.y > q.peDireito - 0.05) return null;
      return destino(hit.point.x, hit.point.z);
    }

    let ativo = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (ativo || !alvos.length) return;
      ativo = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), arrastou: false, v: 0, tv: performance.now() };
      canvas.setPointerCapture(e.pointerId);
      inercia = 0;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!ativo) {
        // Mouse parado sobre o chao: o anel mostra para onde o clique leva.
        if (e.pointerType === 'mouse' && !viagem && alvos.length) {
          const d = chao(e.clientX, e.clientY);
          anel.visible = !!d;
          if (d) { anel.position.x = d[0]; anel.position.z = d[1]; }
          pedir();
        }
        return;
      }
      if (e.pointerId !== ativo.id) return;
      if (!ativo.arrastou && Math.hypot(e.clientX - ativo.x0, e.clientY - ativo.y0) < 6) return;
      if (!ativo.arrastou) {
        ativo.arrastou = true;
        canvas.setAttribute('data-arrastando', '');
        tirarDica();
        if (!viagem) anel.visible = false;
      }
      const k = (1.2 * THREE.MathUtils.degToRad(camera.fov)) / (canvas.clientHeight || 1);
      const dx = e.clientX - ativo.x;
      const agora = performance.now();
      yaw += dx * k;
      pitch += (e.clientY - ativo.y) * k;
      if (viagem) viagem.olhar = null;
      giro = null;
      ativo.v = (dx * k) / Math.max(8, agora - ativo.tv);
      ativo.tv = agora;
      ativo.x = e.clientX;
      ativo.y = e.clientY;
      pedir();
    });
    const soltar = (e, cancelado) => {
      if (!ativo || e.pointerId !== ativo.id) return;
      const a = ativo;
      ativo = null;
      canvas.removeAttribute('data-arrastando');
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (cancelado) return;
      if (a.arrastou) {
        if (!reduzido() && performance.now() - a.tv < 80) { inercia = a.v; pedir(); }
        return;
      }
      if (performance.now() - a.t > 600) return;
      const d = chao(e.clientX, e.clientY);
      if (!d) return;
      tirarDica();
      andarAte(d[0], d[1], null, null);
    };
    canvas.addEventListener('pointerup', (e) => soltar(e, false));
    canvas.addEventListener('pointercancel', (e) => soltar(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !ativo && !viagem && anel.visible) { anel.visible = false; pedir(); }
    });

    // ------------------------------------------------------ joystick
    // Base no canto inferior direito (so no toque; o CSS o esconde com
    // pointer fine). Tem o proprio pointerId: o polegar anda aqui enquanto
    // outro dedo olha no canvas.
    const base = ov.querySelector('[data-andavel-joy]');
    const pino = ov.querySelector('[data-andavel-pino]');
    let polegar = null;
    const pinoEm = (x, y) => { if (pino) pino.style.transform = `translate(${x}px, ${y}px)`; };
    function moverPino(e) {
      const raio = polegar.raio;
      let dx = e.clientX - polegar.cx;
      let dy = e.clientY - polegar.cy;
      const d = Math.hypot(dx, dy);
      if (d > raio) { dx *= raio / d; dy *= raio / d; }
      pinoEm(dx, dy);
      // zona morta de 12% para o polegar parado nao arrastar a camera
      const m = Math.min(1, d / raio);
      joy.f = m < 0.12 ? 0 : -dy / raio;
      joy.s = m < 0.12 ? 0 : dx / raio;
      if (joy.f || joy.s) { tirarDica(); inercia = 0; pedir(); }
    }
    function soltarPino(e) {
      if (!polegar || e.pointerId !== polegar.id) return;
      polegar = null;
      joy.f = 0;
      joy.s = 0;
      if (base) { base.removeAttribute('data-ativo'); if (base.hasPointerCapture(e.pointerId)) base.releasePointerCapture(e.pointerId); }
      pinoEm(0, 0);
    }
    if (base) {
      base.addEventListener('pointerdown', (e) => {
        if (polegar || !alvos.length) return;
        e.preventDefault();
        const r = base.getBoundingClientRect();
        polegar = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, raio: r.width / 2 };
        base.setPointerCapture(e.pointerId);
        base.setAttribute('data-ativo', '');
        moverPino(e);
      });
      base.addEventListener('pointermove', (e) => { if (polegar && e.pointerId === polegar.id) moverPino(e); });
      base.addEventListener('pointerup', soltarPino);
      base.addEventListener('pointercancel', soltarPino);
      base.addEventListener('lostpointercapture', soltarPino);
    }

    // ------------------------------------------------------ botoes
    ov.querySelectorAll('[data-ponto]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = nav.pontos.find((x) => x.id === b.dataset.ponto);
        if (!p) return;
        tirarDica();
        const de = { x: p.posicao[0], z: p.posicao[2] };
        const olhar = mirarPara(p.olharPara[0], p.olharPara[1], p.olharPara[2], de);
        andarAte(de.x, de.z, olhar, () => anunciar(fr('andavelChegou', 'Você está em: {p}').replace('{p}', b.textContent.trim())));
      });
    });
    ov.querySelectorAll('[data-girar]').forEach((b) => {
      b.addEventListener('click', () => {
        tirarDica();
        const esq = b.dataset.girar === 'esq';
        const dy = THREE.MathUtils.degToRad(esq ? 30 : -30);
        inercia = 0;
        if (reduzido()) yaw += dy;
        else giro = { y0: yaw, dy, t0: performance.now(), dur: 280 };
        anunciar(esq ? fr('andavelGirouEsq', 'Virou para a esquerda') : fr('andavelGirouDir', 'Virou para a direita'));
        pedir();
      });
    });
    const recomecar = ov.querySelector('[data-andavel-recomecar]');
    if (recomecar) {
      recomecar.addEventListener('click', () => {
        const i = nav.inicio;
        const de = { x: i.posicao[0], z: i.posicao[2] };
        andarAte(de.x, de.z, mirarPara(i.olharPara[0], i.olharPara[1], i.olharPara[2], de),
          () => anunciar(fr('andavelInicio', 'De volta à porta')));
      });
    }
    // No toque o recomecar vai para o canto de cima (o CSS o posiciona) e a
    // linha dos pontos so esmaece na borda quando ha mais pontos para rolar.
    const toque = matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (toque && recomecar) ov.appendChild(recomecar);
    const pontos = ov.querySelector('.andavel__pontos');
    if (toque && pontos) {
      const borda = () => pontos.toggleAttribute('data-transborda',
        pontos.scrollLeft + pontos.clientWidth < pontos.scrollWidth - 4);
      pontos.addEventListener('scroll', borda, { passive: true });
      new ResizeObserver(borda).observe(pontos);
    }

    function tecla(e, desce) {
      const k = (e.key || '').toLowerCase();
      if (!['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      if (!desce) { teclas.delete(k); return; }
      if (!alvos.length || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      tirarDica();
      teclas.add(k);
      pedir();
    }
    window.addEventListener('blur', () => teclas.clear());

    window.addEventListener('resize', pedir);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pedir(); });
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', pedir);

    // Gancho para os testes (tools/site-qa/testar_andavel.mjs): estado e
    // trilha da camera, e um giro continuo para medir quadros por segundo.
    ov.andavel = {
      estado: () => ({ x: pos.x, z: pos.z, y: OLHO, yaw, pitch, quadros, andando: !!viagem, atlas, arquivo: ov.dataset.arquivo || '' }),
      trilha,
      medir: (ms) => new Promise((ok) => {
        const q0 = quadros;
        const t0 = performance.now();
        const y0 = yaw;
        medindo = t0 + ms;
        pedir();
        setTimeout(() => {
          const fps = ((quadros - q0) * 1000) / (performance.now() - t0);
          yaw = y0;
          pedir();
          ok(fps);
        }, ms + 30);
      }),
    };

    return {
      atlas,
      receber(raizCena, nome) {
        const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        raizCena.traverse((o) => {
          if (!o.isMesh) return;
          o.matrixAutoUpdate = false;
          o.updateMatrix();
          const m = o.material;
          if (m.map) { m.map.anisotropy = aniso; renderer.initTexture(m.map); }
          if (!/fora/i.test(m.name || '')) alvos.push(o);
        });
        raizCena.updateMatrixWorld(true);
        cena.add(raizCena);
        ov.dataset.arquivo = nome;
        ajustar();
        aplicar();
        renderer.compile(cena, camera);
        pedir();
      },
      tecla,
      pausar() {
        pausado = true;
        teclas.clear();
        joy.f = 0;
        joy.s = 0;
        polegar = null;
        pinoEm(0, 0);
        if (pedido) { cancelAnimationFrame(pedido); pedido = 0; }
      },
      retomar() { pausado = false; ultimo = 0; pedir(); },
      descartar() {
        this.pausar();
        alvos = [];
        renderer.dispose();
      },
    };
  }
}
