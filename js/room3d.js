// Maquete do quarto: planta em tres dimensoes, estilizada e honesta.
// Decisoes: geometria procedural (nao ha modelo do quarto real), three.js carregado
// sob demanda, render apenas quando algo muda, orbita propria para nao sequestrar o
// scroll vertical no celular, e botoes de vista como alternativa ao arrastar (WCAG 2.5.7).
// Toda a informacao do quarto tambem existe em texto no HTML: nada mora so no canvas.
(function () {
  'use strict';

  var THREE_SRC = 'js/three.min.js';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Medidas em metros. Fora de escala fina, mas com proporcoes plausiveis.
  var PLANS = {
    solteiro: { w: 3.0, d: 4.0, h: 2.6, janela: 'fundo', itens: [
      { t: 'cama',     x: -0.75, z: -0.6, w: 0.9, d: 2.0, h: 0.5 },
      { t: 'criado',   x: -0.05, z: -1.5, w: 0.4, d: 0.4, h: 0.5 },
      { t: 'mesa',     x:  0.95, z:  0.4, w: 1.0, d: 0.5, h: 0.75 },
      { t: 'armario',  x:  0.95, z: -1.5, w: 1.0, d: 0.6, h: 2.0 },
      { t: 'banheiro', x: -0.75, z:  1.5, w: 1.5, d: 1.0, h: 2.3 }
    ] },
    casal: { w: 3.4, d: 5.3, h: 2.6, janela: 'fundo', itens: [
      { t: 'cama',     x:  0.0,  z: -1.0, w: 1.6, d: 2.0, h: 0.5 },
      { t: 'criado',   x: -1.1,  z: -1.8, w: 0.4, d: 0.4, h: 0.5 },
      { t: 'criado',   x:  1.1,  z: -1.8, w: 0.4, d: 0.4, h: 0.5 },
      { t: 'mesa',     x:  1.1,  z:  0.6, w: 1.0, d: 0.5, h: 0.75 },
      { t: 'armario',  x: -1.15, z:  0.6, w: 1.0, d: 0.6, h: 2.0 },
      { t: 'banheiro', x:  0.6,  z:  2.0, w: 2.0, d: 1.2, h: 2.3 }
    ] },
    superior: { w: 4.0, d: 6.0, h: 2.7, janela: 'fundo', itens: [
      { t: 'cama',     x:  0.0,  z: -1.4, w: 1.8, d: 2.0, h: 0.5 },
      { t: 'criado',   x: -1.3,  z: -2.2, w: 0.45, d: 0.45, h: 0.5 },
      { t: 'criado',   x:  1.3,  z: -2.2, w: 0.45, d: 0.45, h: 0.5 },
      { t: 'poltrona', x: -1.25, z:  0.4, w: 0.8, d: 0.8, h: 0.8 },
      { t: 'mesa',     x:  1.3,  z:  0.3, w: 1.2, d: 0.55, h: 0.75 },
      { t: 'armario',  x:  1.3,  z: -0.9, w: 1.0, d: 0.6, h: 2.1 },
      { t: 'banheiro', x:  0.7,  z:  2.3, w: 2.2, d: 1.3, h: 2.4 }
    ] },
    familia: { w: 4.2, d: 6.7, h: 2.7, janela: 'fundo', itens: [
      { t: 'cama',     x: -1.05, z: -1.6, w: 1.5, d: 2.0, h: 0.5 },
      { t: 'cama',     x:  1.05, z: -1.6, w: 1.5, d: 2.0, h: 0.5 },
      { t: 'criado',   x:  0.0,  z: -2.4, w: 0.4, d: 0.4, h: 0.5 },
      { t: 'armario',  x: -1.5,  z:  0.6, w: 1.2, d: 0.6, h: 2.1 },
      { t: 'banheiro', x:  0.0,  z:  2.7, w: 2.6, d: 1.3, h: 2.4 }
    ] }
  };

  var ROTULOS = {
    cama: 'Cama de casal', solteiro: 'Cama de solteiro', criado: 'Criado mudo',
    mesa: 'Escrivaninha', armario: 'Armário', poltrona: 'Poltrona', banheiro: 'Banheiro'
  };

  var VIEWS = {
    porta:  { az: 0.35,  pol: 0.78, dist: 1.25, nome: 'Vista da porta' },
    janela: { az: Math.PI - 0.35, pol: 0.78, dist: 1.25, nome: 'Vista da janela' },
    planta: { az: 0.0,   pol: 0.12, dist: 1.05, nome: 'Vista de cima, planta do quarto' }
  };

  var loading = null;
  function loadThree() {
    if (window.THREE) { return Promise.resolve(window.THREE); }
    if (loading) { return loading; }
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = THREE_SRC;
      s.onload = function () { resolve(window.THREE); };
      s.onerror = function () { reject(new Error('three')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function build(root, canvas, plan, status) {
    var THREE = window.THREE;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (err) {
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // Sem isto as texturas saem lavadas: o padrao do r128 e espaco linear.
    renderer.outputEncoding = THREE.sRGBEncoding;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    var key = new THREE.DirectionalLight(0xfff4e2, 0.62);
    key.position.set(2.5, 5, 3);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xdfe8ff, 0.28);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    // Texturas geradas na maquina com padding circular nos dois eixos: casam
    // consigo mesmas, entao repetem em grade sem emenda visivel.
    //
    // O repeat de uma textura e em UV, que vai de 0 a 1 em cada face, entao um
    // valor fixo daria tamanho real diferente em cada caixa. Cada combinacao de
    // material e medida ganha a sua textura, com o repeat derivado dos metros.
    // Uma textura por escala, nao um clone: o clone copia a referencia de
    // imagem no momento em que e feito, e feito antes do download ele fica sem
    // imagem para sempre. Carregar de novo nao custa rede, porque o navegador
    // serve o mesmo arquivo do cache.
    var carregador = new THREE.TextureLoader();
    var ARQUIVO = {
      piso: 'tex-piso-madeira.jpg', parede: 'tex-parede.jpg', azulejo: 'tex-azulejo.jpg',
      movel: 'tex-madeira-movel.jpg'
    };
    // Metros que uma repeticao da textura ocupa na superficie.
    var METROS = { piso: 1.2, parede: 1.6, azulejo: 0.35, movel: 0.8 };
    var variantes = {};

    function comEscala(nome, u, v) {
      var passo = METROS[nome];
      if (!passo) { return M[nome]; }
      var ru = Math.max(1, Math.round(u / passo)), rv = Math.max(1, Math.round(v / passo));
      var chave = nome + ru + 'x' + rv;
      if (!variantes[chave]) {
        var t = carregador.load('assets/' + ARQUIVO[nome], function () { needs = true; });
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(ru, rv);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        var m = M[nome].clone();
        m.map = t;
        variantes[chave] = m;
      }
      return variantes[chave];
    }

    // A cor de cada material multiplica a imagem: branco deixa a textura falar,
    // e enquanto ela nao chega a superficie aparece nessa cor em vez de preta.
    var M = {
      piso:     new THREE.MeshStandardMaterial({ color: 0xd8c3a2, roughness: 0.82, metalness: 0 }),
      parede:   new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.95, metalness: 0 }),
      azulejo:  new THREE.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.4, metalness: 0 }),
      movel:    new THREE.MeshStandardMaterial({ color: 0xa98a60, roughness: 0.6, metalness: 0.05 }),
      colchao:  new THREE.MeshStandardMaterial({ color: 0xfaf7f1, roughness: 0.88, metalness: 0 }),
      destaque: new THREE.MeshStandardMaterial({ color: 0x906615, roughness: 0.5, metalness: 0.25 }),
      vidro:    new THREE.MeshStandardMaterial({ color: 0xbcd4e0, roughness: 0.2, metalness: 0.1,
                                                 transparent: true, opacity: 0.55 }),
      pessoa:   new THREE.MeshStandardMaterial({ color: 0x8d9aa2, roughness: 0.8, metalness: 0 })
    };

    var room = new THREE.Group();
    scene.add(room);

    var W = plan.w, D = plan.d, H = plan.h, T = 0.1;

    function box(w, h, d, mat, x, y, z) {
      if (typeof mat === 'string') {
        var dims = [w, h, d], menor = Math.min(w, h, d);
        var face = dims.filter(function (n, i) { return i !== dims.indexOf(menor); });
        mat = comEscala(mat, face[0], face[1]);
      }
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      room.add(m);
      return m;
    }

    box(W, T, D, 'piso', 0, -T / 2, 0);
    box(W, H, T, 'parede', 0, H / 2, -D / 2);          // parede do fundo, com a janela
    box(T, H, D, 'parede', -W / 2, H / 2, 0);          // parede esquerda
    box(T, H, D, 'parede', W / 2, H / 2, 0);           // parede direita

    // janela na parede do fundo
    box(Math.min(1.8, W * 0.55), 1.2, 0.04, M.vidro, 0, 1.35, -D / 2 + 0.07);
    box(Math.min(1.9, W * 0.6), 0.08, 0.1, M.destaque, 0, 0.72, -D / 2 + 0.08);

    // vao da porta na parede da frente, indicado por duas colunas
    box(T, H, T, 'parede', -W / 2 + 0.35, H / 2, D / 2);
    box(T, H, T, 'parede', W / 2 - 0.35, H / 2, D / 2);
    box(W - 1.6, 0.12, T, M.destaque, 0, H - 0.06, D / 2);

    plan.itens.forEach(function (it) {
      if (it.t === 'banheiro') {
        box(it.w, it.h, T, 'azulejo', it.x, it.h / 2, it.z - it.d / 2);
        box(T, it.h, it.d, 'azulejo', it.x - it.w / 2, it.h / 2, it.z);
        box(it.w, 0.1, it.d, 'azulejo', it.x, 0.05, it.z);
        box(0.5, 0.85, 0.4, 'colchao', it.x + it.w / 2 - 0.45, 0.42, it.z);
        return;
      }
      if (it.t === 'cama' || it.t === 'solteiro') {
        box(it.w, 0.3, it.d, 'movel', it.x, 0.15, it.z);
        box(it.w - 0.08, 0.22, it.d - 0.08, 'colchao', it.x, 0.41, it.z);
        box(it.w, 0.65, 0.1, 'movel', it.x, 0.5, it.z - it.d / 2);
        box(it.w * 0.8, 0.1, 0.4, M.destaque, it.x, 0.54, it.z - it.d / 2 + 0.3);
        return;
      }
      box(it.w, it.h, it.d, 'movel', it.x, it.h / 2, it.z);
      if (it.t === 'mesa') { box(it.w * 0.9, 0.05, it.d * 0.9, M.destaque, it.x, it.h, it.z); }
    });

    // referencia de escala: figura de 1,70 m junto da porta
    var pessoa = new THREE.Group();
    var corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.3, 12), M.pessoa);
    corpo.position.y = 0.72;
    var cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M.pessoa);
    cabeca.position.y = 1.52;
    pessoa.add(corpo); pessoa.add(cabeca);
    pessoa.position.set(W / 2 - 0.6, 0, D / 2 - 0.7);
    room.add(pessoa);

    var radius = Math.max(W, D) * 1.35;
    var state = { az: 0, pol: 1.15, dist: 1.0 };
    var needs = true;

    function apply() {
      var r = radius * state.dist;
      var sp = Math.sin(state.pol), cp = Math.cos(state.pol);
      camera.position.set(Math.sin(state.az) * sp * r, cp * r + 0.6, Math.cos(state.az) * sp * r);
      camera.lookAt(0, H * 0.35, 0);
      needs = true;
    }

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { return false; }
      if (canvas.width !== w || canvas.height !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        needs = true;
      }
      return true;
    }

    var visible = true;
    function tick() {
      window.requestAnimationFrame(tick);
      if (!visible) { return; }
      if (!resize()) { return; }
      if (!needs) { return; }          // render sob demanda: parado nao gasta GPU
      needs = false;
      renderer.render(scene, camera);
    }

    function setView(name) {
      var v = VIEWS[name];
      if (!v) { return; }
      state.az = v.az; state.pol = v.pol; state.dist = v.dist;
      apply();
      if (status) { status.textContent = v.nome + '.'; }
    }

    /* Orbita propria. O canvas fica com touch-action pan-y: gesto que comeca
       vertical rola a pagina, gesto horizontal gira a maquete. */
    var drag = false, lastX = 0, lastY = 0, startX = 0, startY = 0, decided = false;

    canvas.addEventListener('pointerdown', function (e) {
      drag = true; decided = e.pointerType !== 'touch';
      startX = lastX = e.clientX; startY = lastY = e.clientY;
      if (decided) { canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) { return; }
      if (!decided) {
        var dx0 = Math.abs(e.clientX - startX), dy0 = Math.abs(e.clientY - startY);
        if (dx0 < 6 && dy0 < 6) { return; }
        if (dy0 > dx0) { drag = false; return; }   // o dedo quer rolar a pagina
        decided = true;
        canvas.setPointerCapture(e.pointerId);
      }
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      state.az -= dx * 0.008;
      state.pol = Math.max(0.1, Math.min(1.45, state.pol - dy * 0.006));
      apply();
    });
    function endDrag(e) {
      drag = false;
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    root.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    root.querySelectorAll('[data-nudge]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-nudge');
        if (k === 'esq') { state.az -= 0.4; }
        if (k === 'dir') { state.az += 0.4; }
        if (k === 'mais') { state.dist = Math.max(0.6, state.dist - 0.15); }
        if (k === 'menos') { state.dist = Math.min(1.6, state.dist + 0.15); }
        apply();
        if (status) { status.textContent = k === 'mais' ? 'Aproximou.' : k === 'menos' ? 'Afastou.' : 'Girou a planta.'; }
      });
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) { visible = en.isIntersecting; if (visible) { needs = true; } });
      }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      if (visible) { needs = true; }
    });

    setView('porta');
    tick();
    return true;
  }

  function init() {
    var root = document.querySelector('[data-maquete]');
    if (!root) { return; }
    var canvas = root.querySelector('[data-room3d]');
    var btn = root.querySelector('[data-room3d-start]');
    var fallback = root.querySelector('[data-room3d-fallback]');
    var status = root.querySelector('[data-room3d-status]');
    if (!canvas || !btn) { return; }

    var plan = PLANS[canvas.getAttribute('data-room3d')];
    if (!plan) { return; }

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Carregando a planta';
      loadThree().then(function () {
        root.setAttribute('data-ready', 'true');
        var ok = build(root, canvas, plan, status);
        if (!ok) {
          root.removeAttribute('data-ready');
          if (fallback) { fallback.hidden = false; }
          btn.textContent = 'Planta indisponível neste navegador';
          return;
        }
        btn.hidden = true;
      }).catch(function () {
        if (fallback) { fallback.hidden = false; }
        btn.disabled = false;
        btn.textContent = 'Não foi possível carregar a planta';
      });
    });

    // Sem movimento: a maquete so abre a pedido, e abre parada na vista da porta.
    if (reduced && status) {
      status.textContent = 'Movimento reduzido ativo. A planta abre parada.';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
