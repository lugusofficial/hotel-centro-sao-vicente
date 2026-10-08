// Maquete do andar: os quatro tipos de quarto lado a lado, em corte, na escala real
// entre si. E a entrada do site e o seletor: girar, passar o mouse, clicar e abrir o quarto.
// A lista ao lado e navegacao HTML de verdade e espelha o estado da maquete, entao tudo
// funciona sem WebGL, sem JavaScript e por teclado.
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ROOMS = [
    { key: 'solteiro', w: 3.0, d: 4.0, camas: [{ x: -0.75, z: -0.6, w: 0.9, d: 2.0 }] },
    { key: 'casal',    w: 3.4, d: 5.3, camas: [{ x: 0, z: -1.0, w: 1.6, d: 2.0 }] },
    { key: 'superior', w: 4.0, d: 6.0, camas: [{ x: 0, z: -1.4, w: 1.8, d: 2.0 }] },
    { key: 'familia',  w: 4.2, d: 6.7, camas: [{ x: -1.05, z: -1.6, w: 1.5, d: 2.0 },
                                               { x: 1.05, z: -1.6, w: 1.5, d: 2.0 }] }
  ];

  var root = document.querySelector('[data-hotel3d]');
  if (!root) { return; }
  var canvas = root.querySelector('canvas');
  var links = [].slice.call(root.querySelectorAll('[data-room-link]'));
  var status = root.querySelector('[data-hotel3d-status]');
  var cover = root.querySelector('[data-hotel3d-cover]');
  if (!canvas || !links.length) { return; }

  function loadThree() {
    if (window.THREE) { return Promise.resolve(); }
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'js/three.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function start() {
    var THREE = window.THREE;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    var k = new THREE.DirectionalLight(0xfff3e0, 0.7); k.position.set(6, 12, 8); scene.add(k);
    var f = new THREE.DirectionalLight(0xdce8ff, 0.3); f.position.set(-8, 4, -6); scene.add(f);

    var M = {
      piso:   new THREE.MeshStandardMaterial({ color: 0xd8c3a0, roughness: 0.92 }),
      pisoOn: new THREE.MeshStandardMaterial({ color: 0xd9a63f, roughness: 0.7 }),
      par:    new THREE.MeshStandardMaterial({ color: 0xf1ebdf, roughness: 0.95 }),
      cama:   new THREE.MeshStandardMaterial({ color: 0x6f5636, roughness: 0.7 }),
      len:    new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.85 }),
      vidro:  new THREE.MeshStandardMaterial({ color: 0xbcd4e0, roughness: 0.2,
                                               transparent: true, opacity: 0.6 }),
      cor:    new THREE.MeshStandardMaterial({ color: 0xc9bca6, roughness: 0.95 }),
      gente:  new THREE.MeshStandardMaterial({ color: 0x8d9aa2, roughness: 0.85 })
    };

    var andar = new THREE.Group();
    scene.add(andar);

    var GAP = 0.25, HW = 0.9;   // HW: altura das paredes em corte
    var total = ROOMS.reduce(function (a, r) { return a + r.w; }, 0) + GAP * (ROOMS.length - 1);
    var cursor = -total / 2;
    var picks = [];

    ROOMS.forEach(function (r, i) {
      var g = new THREE.Group();
      var cx = cursor + r.w / 2;
      g.position.x = cx;
      cursor += r.w + GAP;
      andar.add(g);

      function box(w, h, d, mat, x, y, z) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        g.add(m);
        return m;
      }

      var piso = box(r.w, 0.12, r.d, M.piso, 0, 0, -r.d / 2);
      piso.userData.index = i;
      picks.push(piso);

      box(0.1, HW, r.d, M.par, -r.w / 2, HW / 2, -r.d / 2);
      box(0.1, HW, r.d, M.par, r.w / 2, HW / 2, -r.d / 2);
      box(r.w, HW, 0.1, M.par, 0, HW / 2, -r.d);
      box(Math.min(1.8, r.w * 0.6), 0.5, 0.06, M.vidro, 0, 0.55, -r.d + 0.06);

      r.camas.forEach(function (c) {
        box(c.w, 0.28, c.d, M.cama, c.x, 0.2, -r.d / 2 + c.z);
        box(c.w - 0.1, 0.18, c.d - 0.1, M.len, c.x, 0.41, -r.d / 2 + c.z);
      });

      // figura de 1,70 m junto da porta, referencia de escala
      var p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1.2, 10), M.gente);
      p.position.set(r.w / 2 - 0.5, 0.66, -0.6);
      g.add(p);
    });

    // corredor na frente dos quartos
    var cor = new THREE.Mesh(new THREE.BoxGeometry(total + 1.2, 0.1, 2.0), M.cor);
    cor.position.set(0, -0.01, 1.0);
    andar.add(cor);

    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var hovered = -1, picked = -1, needs = true;

    function paint() {
      picks.forEach(function (m, i) {
        var on = i === hovered || i === picked;
        m.material = on ? M.pisoOn : M.piso;
        m.position.y = on ? 0.06 : 0;
      });
      links.forEach(function (a, i) { a.classList.toggle('is-active', i === hovered || i === picked); });
      needs = true;
    }

    function setHover(i) { if (i !== hovered) { hovered = i; paint(); } }

    function select(i) {
      picked = i;
      paint();
      var a = links[i];
      if (!a) { return; }
      root.setAttribute('data-picked', ROOMS[i].key);
      if (status) { status.textContent = a.getAttribute('data-announce') || ''; }
    }

    function pick(ev) {
      var r = canvas.getBoundingClientRect();
      pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hit = raycaster.intersectObjects(picks, false);
      return hit.length ? hit[0].object.userData.index : -1;
    }

    var radius = total * 0.95;
    var st = { az: 0, pol: 0.72, dist: 1 };
    function apply() {
      var rr = radius * st.dist, sp = Math.sin(st.pol), cp = Math.cos(st.pol);
      camera.position.set(Math.sin(st.az) * sp * rr, cp * rr + 1.5, Math.cos(st.az) * sp * rr + 2);
      camera.lookAt(0, 0, -2.2);
      needs = true;
    }

    var drag = false, dec = false, lx = 0, ly = 0, sx = 0, sy = 0, moved = false;
    canvas.addEventListener('pointerdown', function (e) {
      drag = true; moved = false; dec = e.pointerType !== 'touch';
      sx = lx = e.clientX; sy = ly = e.clientY;
      if (dec) { canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) { setHover(pick(e)); return; }
      if (!dec) {
        var ax = Math.abs(e.clientX - sx), ay = Math.abs(e.clientY - sy);
        if (ax < 6 && ay < 6) { return; }
        if (ay > ax) { drag = false; return; }
        dec = true; canvas.setPointerCapture(e.pointerId);
      }
      moved = true;
      st.az -= (e.clientX - lx) * 0.007;
      st.pol = Math.max(0.18, Math.min(1.25, st.pol - (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
      apply();
    });
    canvas.addEventListener('pointerup', function (e) {
      if (drag && !moved) { var i = pick(e); if (i >= 0) { select(i); } }
      drag = false;
    });
    canvas.addEventListener('pointerleave', function () { drag = false; setHover(-1); });

    links.forEach(function (a, i) {
      a.addEventListener('mouseenter', function () { setHover(i); });
      a.addEventListener('focus', function () { setHover(i); });
      a.addEventListener('blur', function () { setHover(-1); });
    });

    root.querySelectorAll('[data-hview]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-hview');
        if (v === 'cima') { st.pol = 0.2; st.az = 0; }
        if (v === 'frente') { st.pol = 0.78; st.az = 0; }
        if (v === 'esq') { st.az -= 0.45; }
        if (v === 'dir') { st.az += 0.45; }
        apply();
        if (status) {
          status.textContent = v === 'cima' ? 'Vista de cima, planta do andar.'
            : v === 'frente' ? 'Vista de frente, do corredor.' : 'Girou a maquete.';
        }
      });
    });

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { return false; }
      if (canvas.width !== w || canvas.height !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true;
      }
      return true;
    }

    var vis = true;
    function loop() {
      window.requestAnimationFrame(loop);
      if (!vis || !resize() || !needs) { return; }
      needs = false;
      renderer.render(scene, camera);
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) { vis = en.isIntersecting; if (vis) { needs = true; } });
      }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      vis = !document.hidden; if (vis) { needs = true; }
    });

    apply();
    select(1);                  // abre no quarto casal, o mais procurado
    canvas.style.cursor = 'grab';
    root.setAttribute('data-ready', 'true');
    loop();
    return true;
  }

  function boot() {
    loadThree().then(function () {
      if (!start()) {
        root.setAttribute('data-failed', 'true');
      }
    }).catch(function () {
      root.setAttribute('data-failed', 'true');
    });
  }

  if (cover) {
    var btn = cover.querySelector('button');
    if (btn) { btn.addEventListener('click', boot); }
  }
  // Em tela grande e sem economia de dados, a maquete abre sozinha: ela e a entrada do site.
  var conn = navigator.connection || {};
  var leve = conn.saveData !== true && conn.effectiveType !== '2g' && conn.effectiveType !== 'slow-2g';
  if (leve && window.innerWidth >= 700 && !reduced) {
    if (window.requestIdleCallback) { window.requestIdleCallback(boot, { timeout: 1200 }); }
    else { window.setTimeout(boot, 300); }
  }
})();
