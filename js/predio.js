// Predio do hotel em 3D: fachada navegavel, cada janela e um quarto clicavel.
// Gerado por inteiro a partir de data/hotel.json. Trocar o hotel e trocar o JSON.
//
// Decisoes, todas vindas da pesquisa de boas praticas:
// - three r186 por import map, sem build step. r186 so publica ESM.
// - Uma InstancedMesh de janelas por ANDAR, dentro de um Group por andar: o
//   afastamento dos andares vira uma transformacao de grupo, nao a reescrita de N matrizes.
// - setColorAt roda para TODAS as instancias antes do primeiro render, senao o
//   atributo instanceColor nem existe no shader e nada funciona depois.
// - computeBoundingSphere depois de setMatrixAt, senao o clique erra o alvo.
// - Render sob demanda. Predio parado nao gasta GPU.
// - shadowMap.autoUpdate = false: geometria estatica nao precisa recalcular sombra 60x/s.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const COR = {
  disponivel: 0x8fa9ba,
  indisponivel: 0x4e565b,
  hover: 0xffc061,
  escolhido: 0xe09a1f,
};

export async function montarPredio({ canvas, tooltip, onSelecionar, onHover }) {
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
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap saiu no r186
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = ceuGradiente();

  // Reflexo e luz de ambiente sem baixar HDRI
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);

  const sol = new THREE.DirectionalLight(0xffeccd, 3.4);
  sol.position.set(largura * 1.5, alturaTotal * 1.05, prof * 2.2);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.bias = -0.0005;
  sol.shadow.normalBias = 0.02;
  const raio = Math.max(largura, alturaTotal) * 0.95;
  Object.assign(sol.shadow.camera, { left: -raio, right: raio, top: raio, bottom: -raio, near: 1, far: raio * 6 });
  sol.shadow.camera.updateProjectionMatrix();
  scene.add(sol, sol.target);

  scene.add(new THREE.HemisphereLight(0xcfe3f5, 0xb09a7c, 0.55));

  const M = {
    concreto: new THREE.MeshStandardMaterial({ color: 0xded3c0, roughness: 0.78, metalness: 0.03 }),
    faixa: new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.55, metalness: 0.1 }),
    base: new THREE.MeshStandardMaterial({ color: 0x5d5346, roughness: 0.55, metalness: 0.15 }),
    esquadria: new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.42, metalness: 0.55 }),
    janela: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.72, envMapIntensity: 2.4 }),
    chao: new THREE.MeshStandardMaterial({ color: 0xd9cfbb, roughness: 0.95 }),
  };

  const predio = new THREE.Group();
  predio.rotation.y = THREE.MathUtils.degToRad(hotel.rotacaoGraus);
  scene.add(predio);

  const chao = new THREE.Mesh(new THREE.CircleGeometry(Math.max(largura, prof) * 3.2, 64), M.chao);
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  scene.add(chao);

  // Terreo: embasamento escuro com vitrine
  const terreo = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.6, D.terreo, prof + 0.6), M.base);
  terreo.position.y = D.terreo / 2;
  terreo.castShadow = terreo.receiveShadow = true;
  predio.add(terreo);

  const geoJanela = new THREE.BoxGeometry(2.05, 1.42, 0.1);
  const geoMoldura = new THREE.BoxGeometry(2.34, 1.72, 0.12);
  const matriz = new THREE.Matrix4();
  const cor = new THREE.Color();

  const andares = [];      // { grupo, janelas, molduras, meta[] }
  const porQuarto = new Map(); // numero do quarto -> { andarIdx, instanceId }

  hotel.andares.forEach((andar, ai) => {
    const grupo = new THREE.Group();
    grupo.position.y = D.terreo + ai * D.peDireito;
    grupo.userData.andar = andar.numero;
    predio.add(grupo);

    const corpo = new THREE.Mesh(new THREE.BoxGeometry(largura, D.peDireito - 0.34, prof), M.concreto);
    corpo.position.y = (D.peDireito - 0.34) / 2;
    corpo.castShadow = corpo.receiveShadow = true;
    grupo.add(corpo);

    // Faixa de laje, levemente maior: cria a linha horizontal e pega luz na quina
    const faixa = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.5, 0.34, prof + 0.5), M.faixa);
    faixa.position.y = D.peDireito - 0.17;
    faixa.castShadow = faixa.receiveShadow = true;
    grupo.add(faixa);

    const n = andar.quartos.length;
    const janelas = new THREE.InstancedMesh(geoJanela, M.janela, n);
    const molduras = new THREE.InstancedMesh(geoMoldura, M.esquadria, n);
    janelas.frustumCulled = molduras.frustumCulled = false;
    janelas.castShadow = false;
    molduras.castShadow = true;

    const meta = [];
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
      // Obrigatorio antes do primeiro render, para instanceColor existir
      janelas.setColorAt(i, cor.setHex(q.status === 'disponivel' ? COR.disponivel : COR.indisponivel));
      meta.push(q);
      porQuarto.set(q.numero, { andarIdx: ai, instanceId: i });
    });

    janelas.instanceMatrix.needsUpdate = true;
    molduras.instanceMatrix.needsUpdate = true;
    janelas.instanceColor.needsUpdate = true;
    janelas.computeBoundingSphere();
    molduras.computeBoundingSphere();
    grupo.add(molduras, janelas);

    andares.push({ grupo, janelas, meta, baseY: grupo.position.y });
  });

  // Platibanda
  const topo = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.7, 0.8, prof + 0.7), M.faixa);
  topo.position.y = alturaTotal + 0.4;
  topo.castShadow = true;
  predio.add(topo);

  sol.target.position.set(0, alturaTotal * 0.45, 0);
  sol.target.updateMatrixWorld();

  // Camera em tres quartos, nunca de frente
  const alvo = new THREE.Vector3(0, alturaTotal * 0.44, 0);
  camera.position.set(largura * 1.55, alturaTotal * 0.72, prof * 3.05);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(alvo);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = Math.max(largura, alturaTotal) * 0.7;
  controls.maxDistance = Math.max(largura, alturaTotal) * 2.6;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  // O toque e tratado por nos: OrbitControls poe touch-action none e trava o scroll
  controls.touches = {};
  canvas.style.touchAction = 'pan-y';
  controls.update();

  let precisa = true;
  const invalidar = () => { precisa = true; };
  controls.addEventListener('change', invalidar);

  /* ---------- selecao ---------- */
  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  let hover = null, escolhido = null, pendente = null;

  const pintar = (andarIdx, instanceId, hex) => {
    const a = andares[andarIdx];
    a.janelas.setColorAt(instanceId, cor.setHex(hex));
    a.janelas.instanceColor.needsUpdate = true;
    invalidar();
  };

  const corBase = (q) => (q.status === 'disponivel' ? COR.disponivel : COR.indisponivel);

  function repintar(ref, estado) {
    if (!ref) return;
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    const ehEscolhido = escolhido && escolhido.andarIdx === ref.andarIdx && escolhido.instanceId === ref.instanceId;
    pintar(ref.andarIdx, ref.instanceId,
      estado === 'hover' ? COR.hover : ehEscolhido ? COR.escolhido : corBase(q));
  }

  function achar(ev) {
    const r = canvas.getBoundingClientRect();
    ponteiro.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ponteiro.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ponteiro, camera);
    for (const [ai, a] of andares.entries()) {
      const hit = raycaster.intersectObject(a.janelas, false);
      if (hit.length && hit[0].instanceId !== undefined) {
        return { andarIdx: ai, instanceId: hit[0].instanceId, ponto: hit[0].point };
      }
    }
    return null;
  }

  function aplicarHover(ref, ev) {
    const mudou = JSON.stringify(ref && [ref.andarIdx, ref.instanceId]) !== JSON.stringify(hover && [hover.andarIdx, hover.instanceId]);
    if (mudou) {
      if (hover) repintar(hover, null);
      hover = ref;
      if (hover) repintar(hover, 'hover');
      if (onHover) onHover(ref ? andares[ref.andarIdx].meta[ref.instanceId] : null);
    }
    canvas.style.cursor = ref ? 'pointer' : 'grab';
    if (tooltip) {
      if (ref && ev) {
        const q = andares[ref.andarIdx].meta[ref.instanceId];
        const t = hotel.tipos[q.tipo];
        const r = canvas.getBoundingClientRect();
        tooltip.hidden = false;
        tooltip.style.left = `${ev.clientX - r.left}px`;
        tooltip.style.top = `${ev.clientY - r.top}px`;
        tooltip.innerHTML =
          `<strong>Quarto ${q.numero}</strong><span>${t.nome}</span>` +
          `<span>R$ ${q.precoBase} a diária</span>` +
          `<span>${q.status === 'disponivel' ? 'Disponível' : 'Indisponível'} · vista ${q.vista}</span>`;
      } else {
        tooltip.hidden = true;
      }
    }
  }

  // Um raycast por frame, no maximo
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    pendente = ev;
  });
  canvas.addEventListener('pointerleave', () => { pendente = null; aplicarHover(null, null); });

  canvas.addEventListener('click', (ev) => {
    const ref = achar(ev);
    if (!ref) return;
    selecionar(andares[ref.andarIdx].meta[ref.instanceId].numero);
  });

  function selecionar(numero) {
    const ref = porQuarto.get(numero);
    if (!ref) return;
    if (escolhido) repintar(escolhido, null);
    escolhido = ref;
    repintar(escolhido, null);
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    if (onSelecionar) onSelecionar(q, hotel.tipos[q.tipo]);
  }

  /* ---------- loop ---------- */
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
      precisa = true;
    }
    if (controls.enableDamping) controls.update();
    if (!precisa) return;
    precisa = false;
    renderer.render(scene, camera);
  }

  new IntersectionObserver((es) => es.forEach((e) => { visivel = e.isIntersecting; if (visivel) invalidar(); }),
    { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visivel = !document.hidden; if (visivel) invalidar(); });

  tick();
  return { hotel, selecionar, invalidar };
}

function ceuGradiente() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#9fc3dd');
  g.addColorStop(0.55, '#d8e4ea');
  g.addColorStop(1, '#efe7d8');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
