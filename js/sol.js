// Posicao do sol para uma latitude, longitude, data e hora.
//
// Algoritmo do NOAA, na forma resumida que basta para mover uma luz numa cena:
// equacao do tempo e declinacao por serie de Fourier, angulo horario, e dai
// elevacao e azimute. Erro de alguns minutos de arco, muito abaixo do que
// qualquer pessoa percebe numa sombra.
//
// Convencao de eixos, que e onde isso costuma dar errado: o azimute aqui e
// medido a partir do NORTE, crescendo para LESTE, que e a convencao do NOAA e
// da bussola. Na cena, -Z e o norte e +X e o leste, entao a conversao inverte
// o sinal de Z. Trocar essas duas coisas poe o sol nascendo no lugar errado e
// o engano nao salta aos olhos, porque a cena continua plausivel.

const RAD = Math.PI / 180;
const GRAU = 180 / Math.PI;

function diaDoAno(data) {
  const inicio = Date.UTC(data.getUTCFullYear(), 0, 1);
  const agora = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
  return Math.floor((agora - inicio) / 86400000) + 1;
}

/**
 * @param {number} lat graus, positivo ao norte
 * @param {number} lng graus, positivo a leste
 * @param {Date} data dia do ano
 * @param {number} horaLocal hora decimal no fuso informado
 * @param {number} fuso horas em relacao a UTC, -3 no Brasil
 * @returns {{elevacao: number, azimute: number}} graus
 */
export function posicaoDoSol(lat, lng, data, horaLocal, fuso) {
  const n = diaDoAno(data);
  const gama = (2 * Math.PI / 365) * (n - 1 + (horaLocal - 12) / 24);

  const eqTempo = 229.18 * (0.000075
    + 0.001868 * Math.cos(gama) - 0.032077 * Math.sin(gama)
    - 0.014615 * Math.cos(2 * gama) - 0.040849 * Math.sin(2 * gama));

  const decl = 0.006918
    - 0.399912 * Math.cos(gama) + 0.070257 * Math.sin(gama)
    - 0.006758 * Math.cos(2 * gama) + 0.000907 * Math.sin(2 * gama)
    - 0.002697 * Math.cos(3 * gama) + 0.001480 * Math.sin(3 * gama);

  // O deslocamento corrige a diferenca entre o meio-dia do relogio e o meio-dia
  // solar: a longitude dentro do fuso mais a excentricidade da orbita.
  const desloc = eqTempo + 4 * lng - 60 * fuso;
  const tempoSolar = horaLocal * 60 + desloc;
  const anguloHorario = (tempoSolar / 4) - 180;

  const latR = lat * RAD;
  const ha = anguloHorario * RAD;
  const cosZenite = Math.sin(latR) * Math.sin(decl)
    + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zenite = Math.acos(Math.min(1, Math.max(-1, cosZenite)));
  const elevacao = 90 - zenite * GRAU;

  // Azimute por atan2, nao por acos. Com acos e preciso desempatar o sinal
  // olhando o angulo horario, e o desempate errado poe o sol de meio-dia no
  // sul em vez do norte, que e o que acontece no hemisferio sul quando a
  // formula vem de um exemplo do hemisferio norte. Conferido: em Sao Vicente,
  // meio-dia de junho da azimute perto de zero, que e o norte.
  const azRad = Math.atan2(
    -Math.cos(decl) * Math.sin(ha),
    Math.sin(decl) * Math.cos(latR) - Math.cos(decl) * Math.sin(latR) * Math.cos(ha));
  const azimute = (azRad * GRAU + 360) % 360;
  return { elevacao, azimute };
}

/**
 * Vetor unitario apontando para o sol, nos eixos da cena: -Z norte, +X leste.
 */
export function direcaoDoSol(elevacao, azimute) {
  const e = elevacao * RAD;
  const a = azimute * RAD;
  const horizontal = Math.cos(e);
  return {
    x: Math.sin(a) * horizontal,
    y: Math.sin(e),
    z: -Math.cos(a) * horizontal,
  };
}

/**
 * Faixa de horas em que uma fachada recebe sol direto no dia informado.
 * A fachada recebe sol quando ele esta acima do horizonte e a normal dela
 * aponta para o lado dele.
 * @param {{x: number, z: number}} normal normal da fachada, nos eixos da cena
 * @returns {{de: number, ate: number}|null} horas, ou null se nao pega sol
 */
export function horasDeSol(lat, lng, data, fuso, normal) {
  let de = null;
  let ate = null;
  for (let h = 4; h <= 20; h += 1 / 6) {
    const { elevacao, azimute } = posicaoDoSol(lat, lng, data, h, fuso);
    if (elevacao < 3) continue;          // abaixo disso o sol nao ilumina fachada
    const d = direcaoDoSol(elevacao, azimute);
    if (d.x * normal.x + d.z * normal.z <= 0.12) continue;
    if (de === null) de = h;
    ate = h;
  }
  if (de === null) return null;
  return { de: Math.round(de), ate: Math.round(ate) };
}
