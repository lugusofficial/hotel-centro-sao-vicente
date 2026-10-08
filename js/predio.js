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
//
// M2, tres estados de camera:
//   geral  -> predio inteiro, orbita livre, todos os andares solidos
//   quarto -> andares afastados, so o escolhido solido, camera perto da janela
//   vista  -> camera dentro do quarto, olhando para fora pela janela
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

const DUR = 800;            // duracao padrao das transicoes, em ms
const SEP = 1.5;            // afastamento em pes-direitos por andar de distancia
const OPACIDADE_FANTASMA = 0.3;
const DIST_ORBITA = 58;     // distancia da camera a janela no modo quarto. A 26 m via-se a janela e nada
                            // da pilha aberta, que e justamente o que o modo tem de melhor
                            // o bastante para ler a janela, longe o bastante para
                            // o afastamento dos andares aparecer
const RECUO_OLHO = 1.6;     // quanto a camera entra no quarto no modo vista
const ALCANCE_VISTA = 11;   // alvo a frente da janela no modo vista
const CIMA = new THREE.Vector3(0, 1, 0);

const semMovimento = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// easeInOutCubic, sem biblioteca de animacao
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// menor caminho angular, para o giro nao dar a volta longa
const curto = (d) => THREE.MathUtils.euclideanModulo(d + Math.PI, Math.PI * 2) - Math.PI;

export async function montarPredio({ canvas, tooltip, onSelecionar, onQuadro, onModo }) {
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

  // Andar fora de foco vira fantasma APAGADO E OPACO, nao translucido.
  // A primeira versao usava alphaHash, que e a tecnica recomendada quando se
  // quer mesmo ver atraves: mantem o material na fila de opacos e resolve a
  // ordenacao por construcao. So que o hash descarta fragmentos sem escurecer
  // os que ficam, e concreto ao sol pontilhado sobre ceu escuro vira chuvisco
  // de televisao. Como aqui o objetivo e so tirar o andar do primeiro plano, e
  // nao enxergar atraves dele, apagar resolve melhor: sem dither, sem custo de
  // ordenacao e sem precisar de antialiasing temporal.
  const clonarFantasma = (mat, hex) => {
    const m = mat.clone();
    m.color.setHex(hex);
    m.roughness = 1;
    m.metalness = 0;
    if (m.emissive) m.emissive.setHex(0x000000);
    return m;
  };
  const F = {
    concreto: clonarFantasma(M.concreto, 0x3a3b45),
    faixa: clonarFantasma(M.faixa, 0x323239),
    esquadria: clonarFantasma(M.esquadria, 0x24232a),
    // MeshBasicMaterial multiplica a cor do material pela cor da instancia:
    // esta serve de atenuador das janelas acesas do andar fora de foco.
    janela: clonarFantasma(M.janela, 0x6f6e78),
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
    const baseY = D.terreo + ai * D.peDireito;
    grupo.position.y = baseY;
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

    andares.push({ grupo, corpo, faixa, molduras, janelas, meta, locais, baseY, alvoY: baseY, fantasma: false });
  });

  const topo = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.7, 0.8, prof + 0.7), M.faixa);
  const topoBase = alturaTotal + 0.4;
  topo.position.y = topoBase;
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
  controls.touches = {}; // o toque e nosso: OrbitControls poe touch-action none
  canvas.style.touchAction = 'pan-y';

  function limitesGerais() {
    controls.minDistance = esfera.radius * 0.9;
    controls.maxDistance = esfera.radius * 4.2;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.enableZoom = true;
    controls.enablePan = false;
  }
  function limitesQuarto() {
    controls.minDistance = 3;
    controls.maxDistance = esfera.radius * 3.4;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.enableZoom = true;
    controls.enablePan = false;
  }
  // "Olhar ao redor pela janela" sem escrever controlador de primeira pessoa:
  // o alvo vai para um ponto la fora, a distancia fica travada e os angulos
  // limitados. O OrbitControls continua o mesmo, so que preso.
  function limitesVista(olho, mira) {
    const s = new THREE.Spherical().setFromVector3(olho.clone().sub(mira));
    controls.minDistance = controls.maxDistance = s.radius;
    controls.minAzimuthAngle = s.theta - 0.5;
    controls.maxAzimuthAngle = s.theta + 0.5;
    controls.minPolarAngle = Math.max(0.08, s.phi - 0.3);
    controls.maxPolarAngle = Math.min(Math.PI - 0.08, s.phi + 0.3);
    controls.enableZoom = false; // distancia travada: deixa a roda rolar a pagina
    controls.enablePan = false;
  }
  limitesGerais();
  controls.update();

  let precisa = true;
  let mexeu = false;
  const invalidar = () => { precisa = true; };
  controls.addEventListener('change', invalidar);
  controls.addEventListener('start', () => { mexeu = true; });

  // ---------------------------------------------------------------- animacao
  // Sem biblioteca: performance.now, easeInOutCubic, e um passo por frame no
  // mesmo tick do render sob demanda. Cada animacao tem chave: comecar uma nova
  // com a mesma chave substitui a anterior.
  const animacoes = new Map();
  function animar(chave, duracao, passo, fim) {
    animacoes.delete(chave);
    if (!(duracao > 0)) {
      passo(1);
      if (fim) fim();
      invalidar();
      return;
    }
    animacoes.set(chave, { t0: performance.now(), dur: duracao, passo, fim });
    invalidar();
  }
  function passarAnimacoes(agora) {
    for (const [chave, a] of [...animacoes]) {
      const bruto = Math.min((agora - a.t0) / a.dur, 1);
      a.passo(suave(bruto));
      if (bruto >= 1 && animacoes.get(chave) === a) {
        animacoes.delete(chave);
        if (a.fim) a.fim();
      }
    }
    invalidar(); // render sob demanda: cada frame de animacao pede o seu
  }
  const duracaoDe = (d) => (semMovimento() ? 0 : (d === undefined ? DUR : d));

  // Voo de camera. Em esfericas (radius, phi, theta) em torno de um alvo que
  // tambem e interpolado: lerp linear entre posicoes atravessa o predio.
  // controls.enabled fica false durante o voo e so volta no fim, nesta ordem:
  // alvo, limites, update, religar. Escrever camera.position com o controls
  // ativo no mesmo frame e o que faz a camera pular de volta.
  const alvoAgora = new THREE.Vector3();
  const sAgora = new THREE.Spherical();
  const deslocamento = new THREE.Vector3();
  function voar({ alvoFim, posFim, reto = false, duracao, fim }) {
    controls.enabled = false;
    // O ponteiro nao acompanha o voo: o balao que estava sob o cursor ficaria
    // parado no meio da tela apontando para uma janela que saiu de baixo dele.
    pendente = null;
    aplicarHover(null, null);
    const alvoIni = controls.target.clone();
    const posIni = camera.position.clone();
    const s0 = new THREE.Spherical().setFromVector3(posIni.clone().sub(alvoIni));
    const s1 = new THREE.Spherical().setFromVector3(posFim.clone().sub(alvoFim));
    s1.theta = s0.theta + curto(s1.theta - s0.theta);
    animar('camera', duracaoDe(duracao), (t) => {
      alvoAgora.lerpVectors(alvoIni, alvoFim, t);
      if (reto) {
        camera.position.lerpVectors(posIni, posFim, t);
      } else {
        sAgora.set(
          THREE.MathUtils.lerp(s0.radius, s1.radius, t),
          THREE.MathUtils.lerp(s0.phi, s1.phi, t),
          THREE.MathUtils.lerp(s0.theta, s1.theta, t));
        sAgora.makeSafe();
        camera.position.copy(alvoAgora).add(deslocamento.setFromSpherical(sAgora));
      }
      camera.lookAt(alvoAgora);
    }, () => {
      camera.position.copy(posFim);
      controls.target.copy(alvoFim);
      if (fim) fim();
      controls.update();
      controls.enabled = true;
      invalidar();
    });
  }

  // ------------------------------------------------------- andares e fantasma
  function definirFantasma(a, ligar) {
    if (a.fantasma === ligar) return;
    a.fantasma = ligar;
    a.corpo.material = ligar ? F.concreto : M.concreto;
    a.faixa.material = ligar ? F.faixa : M.faixa;
    a.molduras.material = ligar ? F.esquadria : M.esquadria;
    a.janelas.material = ligar ? F.janela : M.janela;
    a.corpo.castShadow = a.faixa.castShadow = a.molduras.castShadow = !ligar;
  }

  // Afastamento de SEP pes-direitos por andar de distancia do escolhido. O
  // conjunto e reancorado no terreo depois, senao os andares abaixo do foco
  // afundariam no chao.
  function alvosDeAndar(foco) {
    const bruto = andares.map((a, i) => a.baseY + (foco === null ? 0 : (i - foco) * D.peDireito * SEP));
    const desvio = Math.max(0, D.terreo - Math.min(...bruto));
    return bruto.map((y) => y + desvio);
  }

  // A caixa de sombra e dimensionada para o predio fechado; aberto ele fica bem
  // mais alto e sairia do frustum do sol.
  function ajustarSombra(aberto) {
    const r = aberto ? raio * 2.2 : raio;
    Object.assign(sol.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: r * 8 });
    sol.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  }

  function separar(foco, duracao) {
    const destino = alvosDeAndar(foco);
    const inicio = andares.map((a) => a.grupo.position.y);
    const topoIni = topo.position.y;
    const topoFim = destino[destino.length - 1] + D.peDireito + 0.4;
    andares.forEach((a, i) => {
      a.alvoY = destino[i];
      definirFantasma(a, foco !== null && i !== foco);
    });
    ajustarSombra(foco !== null);
    animar('andares', duracaoDe(duracao), (t) => {
      for (let i = 0; i < andares.length; i++) {
        andares[i].grupo.position.y = inicio[i] + (destino[i] - inicio[i]) * t;
      }
      topo.position.y = topoIni + (topoFim - topoIni) * t;
    }, () => {
      renderer.shadowMap.needsUpdate = true;
    });
  }

  // Posicao da janela ja no lugar de DESTINO do andar, nao no atual: a camera
  // precisa mirar onde o andar vai parar, nao onde ele esta no meio do caminho.
  const vTmp = new THREE.Vector3();
  function pontoDaJanela(ref) {
    const a = andares[ref.andarIdx];
    vTmp.copy(a.locais[ref.instanceId]);
    vTmp.y += a.alvoY;
    predio.updateWorldMatrix(true, false);
    return predio.localToWorld(vTmp.clone());
  }
  function normalDaJanela(ref) {
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    return new THREE.Vector3(0, 0, q.fachada === 'S' ? 1 : -1)
      .applyQuaternion(predio.quaternion).normalize();
  }
  function poseQuarto(ref) {
    const p = pontoDaJanela(ref);
    const n = normalDaJanela(ref);
    const lado = new THREE.Vector3().crossVectors(n, CIMA).normalize();
    const dir = n.clone().addScaledVector(lado, 0.3).addScaledVector(CIMA, 0.2).normalize();
    // Em tela estreita a ficha ocupa a faixa de baixo da cena, entao a mira
    // desce um pouco e a janela sobe na tela, para fora de tras dela.
    const alvoFim = p.clone();
    if (camera.aspect < 1.1) alvoFim.y -= DIST_ORBITA * 0.1;
    return { alvoFim, posFim: p.clone().addScaledVector(dir, DIST_ORBITA) };
  }

  // ------------------------------------------------------------ interatividade
  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  const projetado = new THREE.Vector3();
  let hover = null, escolhido = null, pendente = null;
  let modo = 'geral';
  let tempoFoco = 0;

  const mesmo = (a, b) => a && b && a.andarIdx === b.andarIdx && a.instanceId === b.instanceId;
  const avisarModo = () => { if (onModo) onModo(modo, escolhido ? andares[escolhido.andarIdx].meta[escolhido.instanceId] : null); };

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
    if (modo === 'vista') return null;
    const r = canvas.getBoundingClientRect();
    ponteiro.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ponteiro.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ponteiro, camera);
    for (const [ai, a] of andares.entries()) {
      if (a.fantasma) continue; // andar fora de foco nao recebe clique
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

  // ----------------------------------------------------------------- estados
  function restaurarInterior() {
    andares.forEach((a) => { a.janelas.visible = true; a.molduras.visible = true; });
    camera.near = 1;
    camera.far = 3000;
    camera.updateProjectionMatrix();
    invalidar();
  }

  function focar(ref) {
    separar(ref.andarIdx);
    modo = 'quarto';
    avisarModo();
    voar({ ...poseQuarto(ref), fim: limitesQuarto });
  }

  function selecionar(numero, opcoes = {}) {
    const ref = porQuarto.get(numero);
    if (!ref) return;
    clearTimeout(tempoFoco);
    if (modo === 'vista') restaurarInterior();
    const antigo = escolhido;
    escolhido = ref;
    if (antigo) pintar(antigo);
    pintar(escolhido);
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    if (onSelecionar) onSelecionar(q, hotel.tipos[q.tipo]);
    if (opcoes.voar === false) { avisarModo(); return; }
    // Vindo da lista HTML por hover ou foco, um respiro antes de voar: passar
    // o mouse de raspao pela lista nao dispara quatro voos seguidos.
    if (opcoes.atraso) tempoFoco = setTimeout(() => { if (escolhido === ref) focar(ref); }, opcoes.atraso);
    else focar(ref);
  }

  // Camera dentro do quarto olhando para fora. De dentro, a propria janela e a
  // esquadria sao caixas opacas bem na frente do olho: ficam invisiveis
  // enquanto estamos la dentro. As paredes do andar somem sozinhas, porque o
  // material e FrontSide e a camera esta dentro da caixa.
  function verVista() {
    if (!escolhido || modo === 'vista') return;
    clearTimeout(tempoFoco);
    const a = andares[escolhido.andarIdx];
    const p = pontoDaJanela(escolhido);
    const n = normalDaJanela(escolhido);
    const olho = p.clone().addScaledVector(n, -RECUO_OLHO).add(new THREE.Vector3(0, 0.12, 0));
    const mira = p.clone().addScaledVector(n, ALCANCE_VISTA);
    a.janelas.visible = false;
    a.molduras.visible = false;
    camera.near = 0.1;
    camera.far = 500;
    camera.updateProjectionMatrix();
    modo = 'vista';
    avisarModo();
    // Reta, nao esferica: entrar pela janela e um avanco curto. Em esfericas o
    // alvo passa para o outro lado da camera no meio do caminho e o raio chega
    // a zero, o que viraria um arco de 180 graus em volta do ponto de mira.
    voar({ alvoFim: mira, posFim: olho, reto: true, fim: () => limitesVista(olho, mira) });
  }

  function voltarDaVista() {
    if (modo !== 'vista' || !escolhido) return;
    const ref = escolhido;
    const pose = poseQuarto(ref);
    modo = 'quarto';
    avisarModo();
    voar({
      ...pose,
      reto: true,
      fim: () => { restaurarInterior(); limitesQuarto(); },
    });
  }

  function verGeral() {
    clearTimeout(tempoFoco);
    restaurarInterior();
    const antigo = escolhido;
    escolhido = null;
    if (antigo) pintar(antigo);
    separar(null);
    modo = 'geral';
    avisarModo();
    voar({
      alvoFim: alvo.clone(),
      posFim: alvo.clone().addScaledVector(direcao, distanciaParaCaber()),
      fim: limitesGerais,
    });
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || modo === 'geral') return;
    ev.preventDefault();
    if (modo === 'vista') voltarDaVista();
    else verGeral();
  });

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
      modo,
    });
  }

  function enquadrar() {
    camera.position.copy(alvo).addScaledVector(direcao, distanciaParaCaber());
    controls.target.copy(alvo);
    controls.update();
  }

  let visivel = true;
  function tick() {
    requestAnimationFrame(tick);
    if (!visivel) return;
    if (animacoes.size) passarAnimacoes(performance.now());
    if (pendente) { aplicarHover(achar(pendente), pendente); pendente = null; }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!mexeu && modo === 'geral' && !animacoes.has('camera')) enquadrar();
      precisa = true;
    }
    // update() do OrbitControls reescreve camera.position a partir do alvo: no
    // meio de um voo ele desfaria o frame inteiro.
    if (!animacoes.has('camera') && controls.enableDamping) controls.update();
    if (!precisa) return;
    precisa = false;
    renderer.render(scene, camera);
    avisarQuadro();
  }

  new IntersectionObserver((es) => es.forEach((e) => { visivel = e.isIntersecting; if (visivel) invalidar(); }),
    { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visivel = !document.hidden; if (visivel) invalidar(); });

  avisarModo();
  tick();
  return { hotel, selecionar, invalidar, verVista, voltarDaVista, verGeral, modo: () => modo };
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
