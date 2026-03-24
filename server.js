const express = require('express');

const app = express();

// 🔧 Choisis le port que tu veux tester
const PORT = 1789; // ou n'importe quel port libre

app.get('/', (req, res) => {
  res.send('Serveur Express fonctionne ! 🚀');
});

app.listen(PORT, () => {
  console.log(`Serveur de test démarré sur http://127.0.0.1:${PORT}`);
});