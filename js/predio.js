// Predio do hotel em 3D ao fim da tarde: a cena preenche a secao e e a imagem
// principal do site. Cada janela e um quarto clicavel, e os quartos livres
// estao com a luz acesa por dentro.
//
// Decisoes vindas da pesquisa de boas praticas:
// - three r186 por import map, sem build step. O three.module.js e um involucro,
//   o three.core.js precisa estar ao lado dele.
// - Uma InstancedMesh de janelas por ANDAR, dentro de um Group por andar, para
//   que separar andares depois seja mover um grupo, nao reescrever N matrizes.
// - setColorAt roda para TODAS as instancias antes do primeiro render, senao o
//   atributo instanceColor nem existe no shader.
// - computeBoundingSphere depois de setMatrixAt, senao o clique erra o alvo.
// - Render sob demanda e shadowMap.autoUpdate = false.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Fim de tarde: quarto livre com a luz acesa, ocupado as escuras.
const COR = {
  disponivel: 0xffc27a,
  indisponivel: 0x272d35,
  hover: 0xfff3dc,
  escolhido: 0xffffff,
};

export async function montarPredio({ canvas, tooltip, onSelecionar, onQuadro }) {
  const hotel = await fetch('data/hotel.json').then((r) => r.json());
  const D = hotel.dimensoes;
  const porFachada = hotel.quartosPorFachada;
  const largura = porFachada * D.larguraPorQuarto;
  const prof = D.profundidade;
  const nAndares = hotel.andares.length;
  const alturaTotal = D.terreo + nAndares * D.peDireito;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap saiu no r186
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = ceuEntardecer();
  scene.fog = new THREE.Fog(0x3a3a55, alturaTotal * 3.5, alturaTotal * 12);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);

  // Sol baixo e rasante, cor de poente
  const sol = new THREE.DirectionalLight(0xffb267, 4.0);
  sol.position.set(largura * 2.8, alturaTotal * 0.55, prof * 1.4);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.bias = -0.0006;
  sol.shadow.normalBias = 0.02;
  const raio = Math.max(largura, alturaTotal) * 1.1;
  Object.assign(sol.shadow.camera, { left: -raio, right: raio, top: raio, bottom: -raio, near: 1, far: raio * 8 });
  sol.shadow.camera.updateProjectionMatrix();
  scene.add(sol, sol.target);

  // Ceu anoitecendo por cima, calor do poente refletindo do chao
  scene.add(new THREE.HemisphereLight(0x3b4877, 0x7a5436, 0.9));

  const M = {
    concreto: new THREE.MeshStandardMaterial({ color: 0xc6bba6, roughness: 0.8, metalness: 0.03 }),
    faixa: new THREE.MeshStandardMaterial({ color: 0xa7967a, roughness: 0.58, metalness: 0.08 }),
    base: new THREE.MeshStandardMaterial({ color: 0x332d27, roughness: 0.6, metalness: 0.2 }),
    esquadria: new THREE.MeshStandardMaterial({ color: 0x1f1c18, roughness: 0.45, metalness: 0.5 }),
    // A janela e a propria luz: MeshBasicMaterial ignora as luzes da cena, entao
    // a cor da instancia vira brilho direto. Quarto livre fica quente e aceso,
    // ocupado fica apagado. Sem emissivo por instancia, que o three nao oferece,
    // e sem transparencia, que traria problema de ordenacao.
    janela: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    chao: new THREE.MeshStandardMaterial({ color: 0x6f6454, roughness: 0.95 }),
  };

  const predio = new THREE.Group();
  predio.rotation.y = THREE.MathUtils.degToRad(hotel.rotacaoGraus);
  scene.add(predio);

  const chao = new THREE.Mesh(new THREE.CircleGeometry(Math.max(largura, prof) * 7, 64), M.chao);
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  scene.add(chao);

  const terreo = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.6, D.terreo, prof + 0.6), M.base);
  terreo.position.y = D.terreo / 2;
  terreo.castShadow = terreo.receiveShadow = true;
  predio.add(terreo);

  // Vitrine acesa do terreo: a recepcao vista da rua
  const vitrine = new THREE.Mesh(
    new THREE.BoxGeometry(largura * 0.74, 2.3, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffdcae, emissive: 0xffc98a, emissiveIntensity: 1.6 }));
  vitrine.position.set(0, D.terreo * 0.5, prof / 2 + 0.36);
  predio.add(vitrine);

  const geoJanela = new THREE.BoxGeometry(2.05, 1.42, 0.1);
  const geoMoldura = new THREE.BoxGeometry(2.34, 1.72, 0.12);
  const matriz = new THREE.Matrix4();
  const cor = new THREE.Color();

  const andares = [];
  const porQuarto = new Map();

  hotel.andares.forEach((andar, ai) => {
    const grupo = new THREE.Group();
    grupo.position.y = D.terreo + ai * D.peDireito;
    predio.add(grupo);

    const corpo = new THREE.Mesh(new THREE.BoxGeometry(largura, D.peDireito - 0.34, prof), M.concreto);
    corpo.position.y = (D.peDireito - 0.34) / 2;
    corpo.castShadow = corpo.receiveShadow = true;
    grupo.add(corpo);

    const faixa = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.5, 0.34, prof + 0.5), M.faixa);
    faixa.position.y = D.peDireito - 0.17;
    faixa.castShadow = faixa.receiveShadow = true;
    grupo.add(faixa);

    const n = andar.quartos.length;
    const janelas = new THREE.InstancedMesh(geoJanela, M.janela, n);
    const molduras = new THREE.InstancedMesh(geoMoldura, M.esquadria, n);
    janelas.frustumCulled = molduras.frustumCulled = false;
    molduras.castShadow = true;

    const meta = [];
    const locais = [];
    andar.quartos.forEach((q, i) => {
      const sul = q.fachada === 'S';
      const x = (q.posicaoNaFachada - (porFachada - 1) / 2) * D.larguraPorQuarto;
      const z = sul ? prof / 2 + 0.08 : -(prof / 2 + 0.08);
      const y = (D.peDireito - 0.34) / 2;
      matriz.makeRotationY(sul ? 0 : Math.PI);
      matriz.setPosition(x, y, z);
      janelas.setMatrixAt(i, matriz);
      matriz.setPosition(x, y, sul ? z - 0.04 : z + 0.04);
      molduras.setMatrixAt(i, matriz);
      janelas.setColorAt(i, cor.setHex(q.status === 'disponivel' ? COR.disponivel : COR.indisponivel));
      meta.push(q);
      locais.push(new THREE.Vector3(x, y, z));
      porQuarto.set(q.numero, { andarIdx: ai, instanceId: i });
    });

    janelas.instanceMatrix.needsUpdate = true;
    molduras.instanceMatrix.needsUpdate = true;
    janelas.instanceColor.needsUpdate = true;
    janelas.computeBoundingSphere();
    molduras.computeBoundingSphere();
    grupo.add(molduras, janelas);

    andares.push({ grupo, janelas, meta, locais });
  });

  const topo = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.7, 0.8, prof + 0.7), M.faixa);
  topo.position.y = alturaTotal + 0.4;
  topo.castShadow = true;
  predio.add(topo);

  sol.target.position.set(0, alturaTotal * 0.45, 0);
  sol.target.updateMatrixWorld();

  const alvo = new THREE.Vector3(-largura * 0.52, alturaTotal * 0.46, 0);
  // Distancia derivada do tamanho real do predio e do campo de visao, para a
  // cena caber em qualquer proporcao de tela em vez de depender de numero magico.
  const caixa = new THREE.Box3().setFromObject(predio);
  const esfera = caixa.getBoundingSphere(new THREE.Sphere());
  function distanciaParaCaber() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return (esfera.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;
  }
  const direcao = new THREE.Vector3(0.58, 0.17, 1).normalize();
  camera.position.copy(alvo).addScaledVector(direcao, Math.max(largura, alturaTotal) * 2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(alvo);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = esfera.radius * 0.9;
  controls.maxDistance = esfera.radius * 4.2;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.touches = {}; // o toque e nosso: OrbitControls poe touch-action none
  canvas.style.touchAction = 'pan-y';
  controls.update();

  let precisa = true;
  let mexeu = false;
  const invalidar = () => { precisa = true; };
  controls.addEventListener('change', invalidar);
  controls.addEventListener('start', () => { mexeu = true; });

  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  const projetado = new THREE.Vector3();
  let hover = null, escolhido = null, pendente = null;

  const mesmo = (a, b) => a && b && a.andarIdx === b.andarIdx && a.instanceId === b.instanceId;

  function pintar(ref) {
    const a = andares[ref.andarIdx];
    const q = a.meta[ref.instanceId];
    const base = q.status === 'disponivel' ? COR.disponivel : COR.indisponivel;
    const hex = mesmo(ref, escolhido) ? COR.escolhido : mesmo(ref, hover) ? COR.hover : base;
    a.janelas.setColorAt(ref.instanceId, cor.setHex(hex));
    a.janelas.instanceColor.needsUpdate = true;
    invalidar();
  }

  function achar(ev) {
    const r = canvas.getBoundingClientRect();
    ponteiro.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ponteiro.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ponteiro, camera);
    for (const [ai, a] of andares.entries()) {
      const hit = raycaster.intersectObject(a.janelas, false);
      if (hit.length && hit[0].instanceId !== undefined) {
        return { andarIdx: ai, instanceId: hit[0].instanceId };
      }
    }
    return null;
  }

  function aplicarHover(ref, ev) {
    if (!mesmo(ref, hover)) {
      const antigo = hover;
      hover = ref;
      if (antigo) pintar(antigo);
      if (hover) pintar(hover);
    }
    canvas.style.cursor = ref ? 'pointer' : 'grab';
    if (!tooltip) return;
    if (ref && ev) {
      const q = andares[ref.andarIdx].meta[ref.instanceId];
      const t = hotel.tipos[q.tipo];
      const r = canvas.getBoundingClientRect();
      tooltip.hidden = false;
      tooltip.style.left = `${ev.clientX - r.left}px`;
      tooltip.style.top = `${ev.clientY - r.top}px`;
      tooltip.innerHTML = `<strong>Quarto ${q.numero}</strong><span>${t.nome} · R$ ${q.precoBase}</span>` +
        `<span>${q.status === 'disponivel' ? 'Disponível' : 'Ocupado'} · vista ${q.vista}</span>`;
    } else {
      tooltip.hidden = true;
    }
  }

  canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch') pendente = ev; });
  canvas.addEventListener('pointerleave', () => { pendente = null; aplicarHover(null, null); });
  canvas.addEventListener('click', (ev) => {
    const ref = achar(ev);
    if (ref) selecionar(andares[ref.andarIdx].meta[ref.instanceId].numero);
  });

  function selecionar(numero) {
    const ref = porQuarto.get(numero);
    if (!ref) return;
    const antigo = escolhido;
    escolhido = ref;
    if (antigo) pintar(antigo);
    pintar(escolhido);
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    if (onSelecionar) onSelecionar(q, hotel.tipos[q.tipo]);
  }

  // Onde a janela escolhida cai na tela, para a ficha sair de dentro do predio
  function avisarQuadro() {
    if (!onQuadro) return;
    if (!escolhido) { onQuadro(null); return; }
    const a = andares[escolhido.andarIdx];
    projetado.copy(a.locais[escolhido.instanceId]);
    a.grupo.localToWorld(projetado);
    projetado.project(camera);
    const r = canvas.getBoundingClientRect();
    onQuadro({
      x: (projetado.x * 0.5 + 0.5) * r.width,
      y: (-projetado.y * 0.5 + 0.5) * r.height,
      frente: projetado.z < 1,
      largura: r.width,
      altura: r.height,
    });
  }

  let visivel = true;
  function tick() {
    requestAnimationFrame(tick);
    if (!visivel) return;
    if (pendente) { aplicarHover(achar(pendente), pendente); pendente = null; }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!mexeu) {
        camera.position.copy(alvo).addScaledVector(direcao, distanciaParaCaber());
        controls.update();
      }
      precisa = true;
    }
    if (controls.enableDamping) controls.update();
    if (!precisa) return;
    precisa = false;
    renderer.render(scene, camera);
    avisarQuadro();
  }

  new IntersectionObserver((es) => es.forEach((e) => { visivel = e.isIntersecting; if (visivel) invalidar(); }),
    { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visivel = !document.hidden; if (visivel) invalidar(); });

  tick();
  return { hotel, selecionar, invalidar };
}

function ceuEntardecer() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.00, '#16213f');
  g.addColorStop(0.32, '#2f3c67');
  g.addColorStop(0.58, '#7a5f80');
  g.addColorStop(0.78, '#d4875c');
  g.addColorStop(0.92, '#f0ad68');
  g.addColorStop(1.00, '#8a6951');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
