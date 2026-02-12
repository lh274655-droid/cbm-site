const contadores = document.querySelectorAll('.contador');

contadores.forEach(contador => {
    const atualizar = () => {
        const numeroFinal = +contador.getAttribute('data-numero');
        const numeroAtual = +contador.innerText;

        const incremento = numeroFinal / 100;

        if (numeroAtual < numeroFinal) {
            contador.innerText = Math.ceil(numeroAtual + incremento);
            setTimeout(atualizar, 20);
        } else {
            contador.innerText = numeroFinal;
        }
    };

    atualizar();
});
