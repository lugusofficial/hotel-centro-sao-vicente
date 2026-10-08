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

  // Revestimento vem de imagem: o predio real e de tijolo, e cor chapada num
  // bloco deste tamanho le como maquete de papel. Uma textura por escala, nao
  // um clone: clone feito antes do download fica sem imagem para sempre.
  const carregador = new THREE.TextureLoader();
  function textura(arquivo, metros, u, v) {
    const t = carregador.load(`assets/${arquivo}`, () => { invalidar(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(u / metros)), Math.max(1, Math.round(v / metros)));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  const M = {
    concreto: new THREE.MeshStandardMaterial({ color: 0xb9a893, roughness: 0.85, metalness: 0 }),
    faixa: new THREE.MeshStandardMaterial({ color: 0xa7967a, roughness: 0.58, metalness: 0.08 }),
    base: new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 0.55, metalness: 0.15 }),
    soleira: new THREE.MeshStandardMaterial({ color: 0x8e8070, roughness: 0.7, metalness: 0.05 }),
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

  // Volume em forma de estadio: trecho reto mais a meia cana da ponta. A folga
  // f afasta o contorno INTEIRO do corpo, inclusive na curva, e e por isso que
  // o eixo da cana nao se mexe com a folga: so o raio cresce. Somar a folga ao
  // raio e ao eixo ao mesmo tempo, que foi o que eu fiz antes, faz a peca sair
  // o dobro bem na ponta e vira uma aleta saindo do predio.
  function estadio(f, alturaY, material) {
    const g = new THREE.Group();
    const caixa = new THREE.Mesh(
      new THREE.BoxGeometry(largura + f, alturaY, prof + 2 * f), material);
    caixa.position.x = -f / 2;          // termina no eixo da cana, do lado da ponta
    const cana = new THREE.Mesh(
      new THREE.CylinderGeometry(prof / 2 + f, prof / 2 + f, alturaY, 28, 1, true, 0, Math.PI),
      material);
    cana.position.x = largura / 2;
    g.add(caixa, cana);
    g.pecas = [caixa, cana];
    return g;
  }

  const predio = new THREE.Group();
  predio.rotation.y = THREE.MathUtils.degToRad(hotel.rotacaoGraus);
  scene.add(predio);

  const chao = new THREE.Mesh(new THREE.CircleGeometry(Math.max(largura, prof) * 7, 64), M.chao);
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  scene.add(chao);

  // O terreo era MAIS LARGO que a torre, o que da aspecto de bolo. No predio
  // real ele e recuado e escuro, e a torre avanca por cima: a sombra dessa
  // aba e o que diz "predio de rua" antes de qualquer outro detalhe.
  // ------------------------------------------------------------------ terreo
  // Era uma caixa recuada um metro e meio de cada lado, com um unico retangulo
  // branco colado na frente. De longe lia como fita cassete: bloco escuro,
  // etiqueta, e a torre pairando sem encostar em nada. Tres coisas resolvem.
  // O recuo cai para um palmo, o bastante para a aba marcar sombra sem a torre
  // ficar em balanco. A curva da ponta desce ate o chao, em vez de parar no
  // primeiro andar. E a vitrine vira uma fileira de vaos na mesma cadencia das
  // janelas de cima, que e o que amarra o terreo ao resto do predio.
  const RECUO = 0.35;
  const baseR = prof / 2 - RECUO;          // raio da curva do terreo

  M.base.map = textura('tex-pedra-base.jpg', 2.2, largura - RECUO, D.terreo);
  M.base.needsUpdate = true;  // sair de sem mapa para com mapa recompila o shader
  const terreo = estadio(-RECUO, D.terreo, M.base);
  terreo.position.y = D.terreo / 2;
  terreo.pecas.forEach((m) => { m.castShadow = m.receiveShadow = true; });
  predio.add(terreo);

  // Aba entre o terreo e a torre
  const aba = estadio(0.15, 0.35, M.faixa);
  aba.position.y = D.terreo - 0.175;
  aba.pecas.forEach((m) => { m.castShadow = m.receiveShadow = true; });
  predio.add(aba);

  // Loja e recepcao: um vao por eixo de janela, nas duas fachadas. O vao do
  // meio da fachada da frente e a entrada, mais alta e mais acesa.
  const M_VIDRO = new THREE.MeshStandardMaterial({
    color: 0xffdcae, emissive: 0xffc98a, emissiveIntensity: 1.0, roughness: 0.3 });
  const M_PORTA = new THREE.MeshStandardMaterial({
    color: 0xfff0d6, emissive: 0xffd49a, emissiveIntensity: 1.5, roughness: 0.3 });
  const geoVao = new THREE.BoxGeometry(3.2, 2.7, 0.12);
  const geoVidro = new THREE.BoxGeometry(2.9, 2.3, 0.1);
  const geoPorta = new THREE.BoxGeometry(2.9, 3.0, 0.1);
  const meio = Math.floor(porFachada / 2);

  for (const frente of [true, false]) {
    const s = frente ? 1 : -1;
    for (let i = 0; i < porFachada; i += 1) {
      const x = (i - (porFachada - 1) / 2) * D.larguraPorQuarto;
      const entrada = frente && i === meio;
      const altura = entrada ? 3.0 : 2.3;
      const centro = entrada ? altura / 2 + 0.1 : 1.75;

      // A esquadria fica atras do vidro, pelo mesmo motivo das janelas de
      // cima: e caixa cheia, nao aro, e na frente apagaria o vao.
      const vao = new THREE.Mesh(geoVao, M.esquadria);
      vao.position.set(x, centro, s * (baseR + 0.02));
      vao.castShadow = true;
      predio.add(vao);

      const vidro = new THREE.Mesh(entrada ? geoPorta : geoVidro,
        entrada ? M_PORTA : M_VIDRO);
      vidro.position.set(x, centro, s * (baseR + 0.07));
      predio.add(vidro);
    }
  }

  // Marquise sobre a entrada
  const marquise = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 1.5), M.faixa);
  marquise.position.set((meio - (porFachada - 1) / 2) * D.larguraPorQuarto,
                        3.45, baseR + 0.75);
  marquise.castShadow = true;
  predio.add(marquise);

  // Calcada. Fica fora do grupo do predio porque o enquadramento da camera
  // mede o grupo: incluindo a calcada, a cena abriria para caber o passeio.
  const rua = new THREE.Group();
  rua.rotation.y = predio.rotation.y;
  scene.add(rua);
  const calcada = new THREE.Mesh(
    new THREE.BoxGeometry(largura + 9, 0.14, prof + 9),
    new THREE.MeshStandardMaterial({ color: 0x5d5547, roughness: 0.95 }));
  calcada.position.y = 0.07;
  calcada.receiveShadow = true;
  rua.add(calcada);

  const geoJanela = new THREE.BoxGeometry(2.05, 1.42, 0.1);
  const geoMoldura = new THREE.BoxGeometry(2.34, 1.72, 0.12);
  const matriz = new THREE.Matrix4();
  const cor = new THREE.Color();

  // Uma lista de materiais por face: o tijolo tem de ter o mesmo tamanho na
  // frente e na lateral, e a caixa tem larguras diferentes nos dois eixos.
  // Ordem das faces na BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
  const alturaCorpo = D.peDireito - 0.34;
  const tijoloLado = M.concreto.clone();
  tijoloLado.map = textura('tex-tijolo.jpg', 2.4, prof, alturaCorpo);
  tijoloLado.needsUpdate = true;
  const tijoloFrente = M.concreto.clone();
  tijoloFrente.map = textura('tex-tijolo.jpg', 2.4, largura, alturaCorpo);
  tijoloFrente.needsUpdate = true;
  const matCorpo = [tijoloLado, tijoloLado, M.concreto, M.concreto, tijoloFrente, tijoloFrente];
  const matCorpoFantasma = [F.concreto, F.concreto, F.concreto, F.concreto, F.concreto, F.concreto];

  // Soleira sob cada janela: e o que faz o vao parecer cavado na parede em vez
  // de colado nela.
  const geoSoleira = new THREE.BoxGeometry(2.5, 0.12, 0.34);

  // Ponta arredondada. O eixo fica na quina do volume e o raio e a metade da
  // profundidade, entao as duas bordas da meia cana encostam exatamente nas
  // quinas da caixa e o encontro nao aparece. As janelas da ultima posicao de
  // cada fachada saem do plano e passam a acompanhar a curva, inclinadas: e o
  // que o predio real tem de mais reconhecivel depois do tijolo.
  const BAIA_R = prof / 2;
  const BAIA_X = largura / 2;
  const BAIA_ANG = THREE.MathUtils.degToRad(40);
  const ULTIMA = porFachada - 1;
  // No CylinderGeometry do three o angulo corre de +Z para +X, entao comecar em
  // zero e varrer meia volta da a metade virada para a ponta.
  const geoBaia = new THREE.CylinderGeometry(
    BAIA_R, BAIA_R, alturaCorpo, 28, 1, true, 0, Math.PI);
  const tijoloBaia = M.concreto.clone();
  tijoloBaia.map = textura('tex-tijolo.jpg', 2.4, Math.PI * BAIA_R, alturaCorpo);
  tijoloBaia.needsUpdate = true;

  const andares = [];
  const porQuarto = new Map();

  hotel.andares.forEach((andar, ai) => {
    const grupo = new THREE.Group();
    const baseY = D.terreo + ai * D.peDireito;
    grupo.position.y = baseY;
    predio.add(grupo);

    const corpo = new THREE.Mesh(new THREE.BoxGeometry(largura, D.peDireito - 0.34, prof), matCorpo);
    corpo.position.y = (D.peDireito - 0.34) / 2;
    corpo.castShadow = corpo.receiveShadow = true;
    grupo.add(corpo);

    const baia = new THREE.Mesh(geoBaia, tijoloBaia);
    baia.position.set(BAIA_X, alturaCorpo / 2, 0);
    baia.castShadow = baia.receiveShadow = true;
    grupo.add(baia);

    const faixa = estadio(0.25, 0.34, M.faixa);
    faixa.position.y = D.peDireito - 0.17;
    faixa.pecas.forEach((m) => { m.castShadow = m.receiveShadow = true; });
    grupo.add(faixa);

    const n = andar.quartos.length;
    const janelas = new THREE.InstancedMesh(geoJanela, M.janela, n);
    const molduras = new THREE.InstancedMesh(geoMoldura, M.esquadria, n);
    const soleiras = new THREE.InstancedMesh(geoSoleira, M.soleira, n);
    janelas.frustumCulled = molduras.frustumCulled = soleiras.frustumCulled = false;
    molduras.castShadow = soleiras.castShadow = true;

    const meta = [];
    const locais = [];
    const normais = [];
    andar.quartos.forEach((q, i) => {
      const sul = q.fachada === 'S';
      const x = (q.posicaoNaFachada - (porFachada - 1) / 2) * D.larguraPorQuarto;
      // A esquadria fica ATRAS do vidro, nao na frente: ela e uma caixa cheia,
      // nao um aro, entao na frente tapa a luz da janela e o predio apaga.
      // A profundidade do vao vem da soleira embaixo e da sombra que ela joga.
      const s = sul ? 1 : -1;
      const y = alturaCorpo / 2;
      // Na ponta a janela gira com a curva; no plano ela so olha para a frente
      // ou para tras. Nos dois casos a esquadria fica ATRAS do vidro: ela e uma
      // caixa cheia, nao um aro, e na frente taparia a luz da janela.
      const naBaia = q.posicaoNaFachada === ULTIMA;
      const ang = naBaia ? (sul ? BAIA_ANG : Math.PI - BAIA_ANG) : (sul ? 0 : Math.PI);
      const nx = Math.sin(ang), nz = Math.cos(ang);
      const cx = naBaia ? BAIA_X : x;
      const raioBase = naBaia ? BAIA_R : prof / 2;
      const ponto = (fora) => [cx + nx * (raioBase + fora), nz * (raioBase + fora)];

      matriz.makeRotationY(ang);
      const [jx, jz] = ponto(0.07);
      matriz.setPosition(jx, y, jz);
      janelas.setMatrixAt(i, matriz);
      const [mx, mz] = ponto(0.02);
      matriz.setPosition(mx, y, mz);
      molduras.setMatrixAt(i, matriz);
      const [sx, sz] = ponto(0.14);
      matriz.setPosition(sx, y - 0.95, sz);
      soleiras.setMatrixAt(i, matriz);
      normais.push(new THREE.Vector3(nx, 0, nz));
      janelas.setColorAt(i, cor.setHex(q.status === 'disponivel' ? COR.disponivel : COR.indisponivel));
      meta.push(q);
      locais.push(new THREE.Vector3(jx, y, jz));
      porQuarto.set(q.numero, { andarIdx: ai, instanceId: i });
    });

    janelas.instanceMatrix.needsUpdate = true;
    molduras.instanceMatrix.needsUpdate = true;
    soleiras.instanceMatrix.needsUpdate = true;
    janelas.instanceColor.needsUpdate = true;
    janelas.computeBoundingSphere();
    molduras.computeBoundingSphere();
    soleiras.computeBoundingSphere();
    grupo.add(molduras, soleiras, janelas);

    andares.push({ grupo, corpo, baia, faixa, molduras, soleiras, janelas,
                   meta, locais, normais, baseY, alvoY: baseY, fantasma: false });
  });

  const topoBase = alturaTotal + 0.4;
  const topo = estadio(0.35, 0.8, M.faixa);
  topo.position.y = topoBase;
  topo.pecas.forEach((m) => { m.castShadow = true; });
  predio.add(topo);

  sol.target.position.set(0, alturaTotal * 0.45, 0);
  sol.target.updateMatrixWorld();

  const alvo = new THREE.Vector3();
  const caixa = new THREE.Box3().setFromObject(predio);
  const esfera = caixa.getBoundingSphere(new THREE.Sphere());

  // O alvo acompanha o formato da tela. Na paisagem o predio vai para a direita
  // porque o texto do heroi ocupa a esquerda; no retrato o texto fica em cima,
  // entao o predio centraliza e desce. Olhar mais alto desce o predio no quadro.
  function posicionarAlvo() {
    const retrato = camera.aspect < 1.1;
    alvo.set(retrato ? -largura * 0.06 : -largura * 0.52,
             alturaTotal * (retrato ? 0.90 : 0.46), 0);
  }

  // Distancia derivada do predio e do campo de visao, sem numero magico.
  // Pela esfera nao serve: o alvo fica fora do centro do predio para abrir
  // espaco ao texto, e somar essa folga ao raio trata uma folga horizontal como
  // se fosse vertical. Entao cada canto da caixa e levado para os eixos da tela
  // e cada um diz a distancia minima para caber no seu eixo; vale a maior.
  const eixoDir = new THREE.Vector3();
  const eixoCima = new THREE.Vector3();
  const canto = new THREE.Vector3();
  function distanciaParaCaber() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const tanV = Math.tan(vFov / 2);
    const tanH = tanV * camera.aspect;
    eixoDir.crossVectors(direcao, camera.up).normalize();
    eixoCima.crossVectors(eixoDir, direcao).normalize();
    let d = 0;
    for (let i = 0; i < 8; i += 1) {
      canto.set(i & 1 ? caixa.max.x : caixa.min.x,
                i & 2 ? caixa.max.y : caixa.min.y,
                i & 4 ? caixa.max.z : caixa.min.z).sub(alvo);
      // Profundidade do canto na direcao da camera: um canto mais perto dela
      // exige recuar mais para continuar dentro do tronco de visao.
      const z = canto.dot(direcao);
      d = Math.max(d, z + Math.abs(canto.dot(eixoDir)) / tanH,
                      z + Math.abs(canto.dot(eixoCima)) / tanV);
    }
    return d * 1.06;
  }
  posicionarAlvo();
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
    // O teto acompanha o enquadramento. Era um multiplo fixo do raio, e em tela
    // de celular o enquadramento pede quase o dobro disso: o OrbitControls
    // puxava a camera de volta no update seguinte e a fachada saia cortada.
    controls.maxDistance = Math.max(esfera.radius * 4.2, distanciaParaCaber() * 1.25);
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
    a.corpo.material = ligar ? matCorpoFantasma : matCorpo;
    a.baia.material = ligar ? F.concreto : tijoloBaia;
    a.faixa.pecas.forEach((m) => { m.material = ligar ? F.faixa : M.faixa; });
    a.molduras.material = ligar ? F.esquadria : M.esquadria;
    a.soleiras.material = ligar ? F.faixa : M.soleira;
    a.janelas.material = ligar ? F.janela : M.janela;
    a.corpo.castShadow = a.molduras.castShadow = !ligar;
    a.soleiras.castShadow = a.baia.castShadow = !ligar;
    a.faixa.pecas.forEach((m) => { m.castShadow = !ligar; });
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
    // Guardada na montagem: na ponta arredondada a janela nao olha para a
    // fachada, olha para a tangente da curva, entao deduzir pela letra N ou S
    // deixaria a camera de esguelha nesses quartos.
    return andares[ref.andarIdx].normais[ref.instanceId].clone()
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
  function focar(ref) {
    separar(ref.andarIdx);
    modo = 'quarto';
    avisarModo();
    voar({ ...poseQuarto(ref), fim: limitesQuarto });
  }

  function selecionar(numero, opcoes = {}) {
    const ref = porQuarto.get(numero);
    if (!ref) return;
    // Pedir de novo o quarto que ja esta em foco nao refaz o voo: senao mover o
    // mouse dentro do mesmo cartao reiniciava a animacao a cada quadro.
    if (ref === escolhido && modo === 'quarto') return;
    const antigo = escolhido;
    escolhido = ref;
    if (antigo) pintar(antigo);
    pintar(escolhido);
    const q = andares[ref.andarIdx].meta[ref.instanceId];
    if (onSelecionar) onSelecionar(q, hotel.tipos[q.tipo]);
    if (opcoes.voar === false) { avisarModo(); return; }
    focar(ref);
  }

  function verGeral() {
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
    verGeral();
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
    posicionarAlvo();
    if (modo === 'geral') limitesGerais();
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
  return { hotel, selecionar, invalidar, verGeral, modo: () => modo };
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
