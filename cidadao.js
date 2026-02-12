const form = document.getElementById("formSolicitacao");
const lista = document.getElementById("listaSolicitacoes");

// Carregar histórico ao abrir
document.addEventListener("DOMContentLoaded", carregarSolicitacoes);

form.addEventListener("submit", function(e){
    e.preventDefault();

    const nome = document.getElementById("nome").value;
    const email = document.getElementById("email").value;
    const tipo = document.getElementById("tipo").value;
    const descricao = document.getElementById("descricao").value;

    const protocolo = Math.floor(Math.random() * 1000000);

    const solicitacao = {
        protocolo,
        nome,
        email,
        tipo,
        descricao,
        status: "Em análise"
    };

    salvarSolicitacao(solicitacao);
    adicionarNaLista(solicitacao);

    alert("Solicitação enviada! Protocolo: " + protocolo);

    form.reset();
});

function salvarSolicitacao(solicitacao){
    let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes")) || [];
    solicitacoes.push(solicitacao);
    localStorage.setItem("solicitacoes", JSON.stringify(solicitacoes));
}

function carregarSolicitacoes(){
    let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes")) || [];
    solicitacoes.forEach(adicionarNaLista);
}

function adicionarNaLista(solicitacao){
    const li = document.createElement("li");
    li.innerHTML = `
        <strong>Protocolo:</strong> ${solicitacao.protocolo} <br>
        <strong>Tipo:</strong> ${solicitacao.tipo} <br>
        <strong>Status:</strong> ${solicitacao.status}
        <hr>
    `;
    lista.appendChild(li);
}
