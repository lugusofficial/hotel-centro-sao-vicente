// Liga o predio 3D a interface HTML. Progressivo: a lista de quartos e os links
// existem no HTML e funcionam sem WebGL, sem este modulo e por teclado.
import { montarPredio } from './predio.js';

const root = document.querySelector('[data-predio]');
if (root) {
  const canvas = root.querySelector('[data-predio-canvas]');
  const tooltip = root.querySelector('[data-predio-tooltip]');
  const ficha = root.querySelector('[data-predio-ficha]');
  const aviso = root.querySelector('[data-predio-aviso]');
  const status = root.querySelector('[data-predio-status]');

  const semWebgl = () => {
    root.removeAttribute('data-pronto');
    if (aviso) aviso.hidden = false;
  };

  // Testa num canvas descartavel: pedir o contexto no canvas real faria o
  // Three.js reaproveitar esse contexto e ignorar antialias e demais atributos.
  try {
    const teste = document.createElement('canvas');
    if (!teste.getContext('webgl2') && !teste.getContext('webgl')) throw new Error('sem webgl');
  } catch (e) {
    semWebgl();
  }

  if (!aviso || aviso.hidden) {
    montarPredio({
      canvas,
      tooltip,
      onSelecionar(q, tipo) {
        if (!ficha) return;
        ficha.hidden = false;
        const disp = q.status === 'disponivel';
        ficha.innerHTML = `
          <p class="ficha__num">Quarto ${q.numero}</p>
          <p class="ficha__tipo">${tipo.nome}</p>
          <dl class="ficha__dados">
            <div><dt>Diária</dt><dd>R$ ${q.precoBase}</dd></div>
            <div><dt>Andar</dt><dd>${String(q.numero).slice(0, -2)}</dd></div>
            <div><dt>Vista</dt><dd>${q.vista}</dd></div>
            <div><dt>Hóspedes</dt><dd>${tipo.hosp}</dd></div>
          </dl>
          <p class="ficha__estado" data-disp="${disp}">${disp ? 'Disponível' : 'Indisponível nas datas'}</p>
          <p><a class="btn btn--primary" href="${tipo.pagina}">Ver o ${tipo.nome}</a></p>`;
        if (status) {
          status.textContent = `Quarto ${q.numero} selecionado. ${tipo.nome}, R$ ${q.precoBase} a diária, vista ${q.vista}, ${disp ? 'disponível' : 'indisponível'}.`;
        }
      },
      // A ficha acompanha a janela escolhida, saindo de dentro do prédio.
      // Em tela estreita o CSS a tira do posicionamento absoluto e isto não atrapalha.
      onQuadro(p) {
        if (!ficha || ficha.hidden || !p) return;
        if (window.matchMedia('(max-width: 55.99em)').matches) {
          ficha.style.left = ficha.style.top = '';
          return;
        }
        const margem = 24;
        const meia = ficha.offsetWidth / 2 || 150;
        const altura = ficha.offsetHeight / 2 || 120;
        const paraDireita = p.x < p.largura * 0.62;
        const x = paraDireita ? p.x + meia + margem : p.x - meia - margem;
        ficha.style.left = `${Math.min(Math.max(x, meia + 8), p.largura - meia - 8)}px`;
        ficha.style.top = `${Math.min(Math.max(p.y, altura + 8), p.altura - altura - 8)}px`;
        ficha.style.opacity = p.frente ? '1' : '0.25';
      },
    })
      .then((api) => {
        root.setAttribute('data-pronto', 'true');
        // A lista HTML comanda o 3D: passar o mouse ou focar destaca o quarto
        root.querySelectorAll('[data-quarto]').forEach((a) => {
          const n = Number(a.getAttribute('data-quarto'));
          const sel = () => api.selecionar(n);
          a.addEventListener('mouseenter', sel);
          a.addEventListener('focus', sel);
        });
      })
      .catch(semWebgl);
  }
}
